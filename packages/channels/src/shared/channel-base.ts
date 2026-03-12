/**
 * Base class for channel adapters.
 */

import type {
	ChannelAdapter,
	ChannelCapabilities,
	ChannelMessagingAdapter,
	ChannelAuthAdapter,
	ChannelStreamingAdapter,
	ChannelGroupAdapter,
	ChannelRuntimeStatus,
	ChannelRuntimeStatusPatch,
	InboundMessage,
	OutboundMessage,
} from "@understudy/types";
import { buildInboundMediaPromptText } from "./inbound-media.js";

export type MessageHandler = (message: InboundMessage) => void;

export abstract class BaseChannel implements ChannelAdapter {
	abstract readonly id: string;
	abstract readonly name: string;
	abstract readonly capabilities: ChannelCapabilities;
	abstract readonly messaging: ChannelMessagingAdapter;

	auth?: ChannelAuthAdapter;
	streaming?: ChannelStreamingAdapter;
	groups?: ChannelGroupAdapter;

	protected messageHandlers = new Set<MessageHandler>();
	protected running = false;
	private runtimeStatus: ChannelRuntimeStatus = {
		state: "stopped",
		summary: "Stopped",
		updatedAt: Date.now(),
	};

	abstract start(): Promise<void>;
	abstract stop(): Promise<void>;

	getRuntimeStatus(): ChannelRuntimeStatus {
		return {
			...this.runtimeStatus,
			...(this.runtimeStatus.details ? { details: { ...this.runtimeStatus.details } } : {}),
		};
	}

	updateRuntimeStatus(status: ChannelRuntimeStatusPatch): void {
		const now = status.updatedAt ?? Date.now();
		const nextState = status.state ?? this.runtimeStatus.state;
		const startedAt =
			status.startedAt !== undefined
				? status.startedAt
				: nextState === "running"
					? this.runtimeStatus.startedAt ?? now
					: nextState === "starting"
						? this.runtimeStatus.startedAt ?? now
						: nextState === "stopped"
							? undefined
							: this.runtimeStatus.startedAt;

		this.runtimeStatus = {
			...this.runtimeStatus,
			...status,
			state: nextState,
			startedAt,
			summary: status.summary ?? defaultRuntimeSummary(nextState),
			updatedAt: now,
		};
	}

	protected emitMessage(message: InboundMessage): void {
		const normalizedMessage =
			Array.isArray(message.attachments) && message.attachments.length > 0
				? {
					...message,
					text: buildInboundMediaPromptText({
						text: message.text,
						attachments: message.attachments,
					}),
				}
				: message;
		for (const handler of this.messageHandlers) {
			try {
				handler(normalizedMessage);
			} catch (error) {
				console.error(`[${this.id}] Message handler error:`, error);
			}
		}
	}

	protected createMessagingAdapter(
		sendFn: (msg: OutboundMessage) => Promise<string>,
		extras: Partial<Omit<ChannelMessagingAdapter, "sendMessage" | "onMessage">> = {},
	): ChannelMessagingAdapter {
		return {
			sendMessage: sendFn,
			...extras,
			onMessage: (handler: MessageHandler) => {
				this.messageHandlers.add(handler);
				return () => {
					this.messageHandlers.delete(handler);
				};
			},
		};
	}
}

function defaultRuntimeSummary(state: ChannelRuntimeStatus["state"]): string {
	switch (state) {
		case "starting":
			return "Starting";
		case "running":
			return "Running";
		case "reconnecting":
			return "Reconnecting";
		case "awaiting_pairing":
			return "Waiting for pairing";
		case "error":
			return "Error";
		case "stopped":
		default:
			return "Stopped";
	}
}
