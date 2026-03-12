/**
 * WebSocket channel adapter.
 * Provides a WebSocket server for browser-based chat clients.
 */

import { WebSocketServer, WebSocket } from "ws";
import type {
	ChannelCapabilities,
	ChannelMessagingAdapter,
	ChannelStreamingAdapter,
	StreamHandle,
	OutboundMessage,
} from "@understudy/types";
import { BaseChannel } from "../shared/channel-base.js";
import {
	type WireMessage,
	inboundFromWire,
	outboundToWire,
	generateMessageId,
} from "../shared/message-format.js";

export interface WebChannelOptions {
	port: number;
	host?: string;
}

function normalizeRequestedClientId(value: string | null | undefined): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) {
		return undefined;
	}
	return /^[a-zA-Z0-9._:-]{1,128}$/.test(trimmed)
		? trimmed
		: undefined;
}

export class WebChannel extends BaseChannel {
	readonly id = "web";
	readonly name = "WebSocket";
	readonly capabilities: ChannelCapabilities = {
		streaming: true,
		threads: false,
		reactions: false,
		attachments: true,
		groups: false,
	};

	readonly messaging: ChannelMessagingAdapter;
	readonly streaming: ChannelStreamingAdapter;

	private wss: WebSocketServer | null = null;
	private clients = new Map<string, WebSocket>();
	private options: WebChannelOptions;

	constructor(options: WebChannelOptions) {
		super();
		this.options = options;
		this.messaging = this.createMessagingAdapter(this.sendMessage.bind(this));
		this.streaming = {
			startStream: this.startStream.bind(this),
		};
	}

	async start(): Promise<void> {
		if (this.running) return;

		this.wss = new WebSocketServer({
			port: this.options.port,
			host: this.options.host ?? "127.0.0.1",
		});

		this.wss.on("connection", (ws, request) => {
			const requestedClientId = normalizeRequestedClientId(
				new URL(request.url ?? "/", "http://understudy.local").searchParams.get("clientId"),
			);
			const clientId =
				requestedClientId ??
				`web_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
			const previousClient = this.clients.get(clientId);
			if (previousClient && previousClient !== ws) {
				previousClient.close(1000, "Replaced by a newer connection");
				this.clients.delete(clientId);
			}
			this.clients.set(clientId, ws);

			ws.on("message", (data) => {
				try {
					const wire = JSON.parse(data.toString()) as WireMessage;
					wire.senderId = clientId;
					wire.channelId = "web";
					const message = inboundFromWire(wire);
					this.emitMessage(message);
				} catch {
					this.sendWire(ws, {
						type: "error",
						channelId: "web",
						error: "Invalid message format",
					});
				}
			});

			ws.on("close", () => {
				this.clients.delete(clientId);
			});

			ws.on("error", (error) => {
				console.error(`[web] Client error (${clientId}):`, error.message);
				this.clients.delete(clientId);
			});

			// Send welcome
			this.sendWire(ws, {
				type: "ack",
				channelId: "web",
				id: clientId,
				text: "Connected to Understudy",
			});
		});

		this.running = true;
	}

	async stop(): Promise<void> {
		if (!this.running || !this.wss) return;

		for (const ws of this.clients.values()) {
			ws.close(1001, "Server shutting down");
		}
		this.clients.clear();

		await new Promise<void>((resolve) => {
			this.wss!.close(() => resolve());
		});

		this.wss = null;
		this.running = false;
	}

	private async sendMessage(msg: OutboundMessage): Promise<string> {
		const messageId = generateMessageId();
		const wire = outboundToWire(msg);
		wire.id = messageId;

		if (msg.recipientId) {
			const client = this.clients.get(msg.recipientId);
			if (!client || client.readyState !== WebSocket.OPEN) {
				throw new Error(`Web recipient is offline: ${msg.recipientId}`);
			}
			this.sendWire(client, wire);
		} else {
			for (const ws of this.clients.values()) {
				if (ws.readyState === WebSocket.OPEN) {
					this.sendWire(ws, wire);
				}
			}
		}

		return messageId;
	}

	private startStream(channelId: string, recipientId: string, threadId?: string): StreamHandle {
		const streamId = generateMessageId();
		let fullText = "";

		const getTargets = (): WebSocket[] => {
			if (recipientId) {
				const client = this.clients.get(recipientId);
				if (!client || client.readyState !== WebSocket.OPEN) {
					throw new Error(`Web recipient is offline: ${recipientId}`);
				}
				return [client];
			}
			return Array.from(this.clients.values()).filter(
				(ws) => ws.readyState === WebSocket.OPEN,
			);
		};

		// Send stream_start
		for (const ws of getTargets()) {
			this.sendWire(ws, {
				type: "stream_start",
				channelId,
				id: streamId,
				threadId,
			});
		}

		return {
			update: async (text: string) => {
				fullText += text;
				for (const ws of getTargets()) {
					this.sendWire(ws, {
						type: "stream_chunk",
						channelId,
						id: streamId,
						text,
					});
				}
			},
			finish: async () => {
				for (const ws of getTargets()) {
					this.sendWire(ws, {
						type: "stream_end",
						channelId,
						id: streamId,
						text: fullText,
					});
				}
				return streamId;
			},
			cancel: async () => {
				for (const ws of getTargets()) {
					this.sendWire(ws, {
						type: "stream_end",
						channelId,
						id: streamId,
						error: "cancelled",
					});
				}
			},
		};
	}

	private sendWire(ws: WebSocket, wire: WireMessage): void {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(wire));
		}
	}
}
