/**
 * WhatsApp channel adapter powered by Baileys.
 */

import type {
	Attachment,
	ChannelCapabilities,
	ChannelMessagingAdapter,
	OutboundMessage,
} from "@understudy/types";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BaseChannel } from "../shared/channel-base.js";
import {
	materializeInboundAttachment,
} from "../shared/inbound-media.js";
import { readOutboundAttachmentBytes } from "../shared/outbound-media.js";

export interface WhatsAppChannelOptions {
	/** Allowed phone numbers (E.164 format) */
	allowedNumbers?: string[];
	/** Directory storing WhatsApp auth state */
	authDir?: string;
	/** Print QR code to terminal during pairing */
	printQr?: boolean;
}

const NOOP_BAILEYS_LOGGER = {
	trace() {},
	debug() {},
	info() {},
	warn() {},
	error() {},
	fatal() {},
	child() {
		return NOOP_BAILEYS_LOGGER;
	},
};

export class WhatsAppChannel extends BaseChannel {
	readonly id = "whatsapp";
	readonly name = "WhatsApp";
	readonly capabilities: ChannelCapabilities = {
		streaming: false,
		threads: false,
		reactions: true,
		attachments: true,
		groups: true,
	};

	readonly messaging: ChannelMessagingAdapter;
	private allowedNumbers: Set<string>;
	private authDir: string;
	private printQr: boolean;
	private socket: any = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private reconnectAttempt = 0;
	private sentTargetByMessageId = new Map<string, string>();

	constructor(options: WhatsAppChannelOptions = {}) {
		super();
		this.allowedNumbers = new Set(
			(options.allowedNumbers ?? []).flatMap((value) => {
				const normalized = this.normalizePhone(value);
				return normalized ? [value, normalized] : [value];
			}),
		);
		this.authDir = options.authDir?.trim() || join(homedir(), ".understudy", "whatsapp");
		this.printQr = options.printQr !== false;
		this.messaging = this.createMessagingAdapter(this.sendMessage.bind(this), {
			editMessage: async (params) => {
				const targetJid = this.resolveMessageTarget(params.messageId, params.recipientId);
				await this.socket.sendMessage(
					targetJid,
					{ text: params.text },
					{
						edit: {
							id: params.messageId,
							remoteJid: targetJid,
							fromMe: true,
						},
					},
				);
			},
			deleteMessage: async (params) => {
				const targetJid = this.resolveMessageTarget(params.messageId, params.recipientId);
				await this.socket.sendMessage(targetJid, {
					delete: {
						id: params.messageId,
						remoteJid: targetJid,
						fromMe: true,
					},
				});
			},
			reactToMessage: async (params) => {
				const targetJid = this.resolveMessageTarget(params.messageId, params.recipientId);
				await this.socket.sendMessage(targetJid, {
					react: {
						text: params.remove ? "" : params.emoji,
						key: {
							id: params.messageId,
							remoteJid: targetJid,
							fromMe: true,
						},
					},
				});
			},
		});
	}

	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;
		this.updateRuntimeStatus({
			state: "starting",
			summary: "Connecting to WhatsApp",
			restartAttempt: this.reconnectAttempt,
			details: {
				authDir: this.authDir,
			},
		});
		await this.connect();
	}

	private async connect(): Promise<void> {
		let baileys: any;
		try {
			baileys = await import("@whiskeysockets/baileys");
		} catch {
			throw new Error(
				'WhatsApp channel dependency is missing. Install optional dependency "@whiskeysockets/baileys".',
			);
		}
		const makeWASocket = baileys.default;
		const downloadMediaMessage = baileys.downloadMediaMessage;
		const useMultiFileAuthState = baileys.useMultiFileAuthState;
		const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
		const DisconnectReason = baileys.DisconnectReason;

		mkdirSync(this.authDir, { recursive: true });
		const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
		const versionInfo = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

		this.socket = makeWASocket({
			auth: state,
			version: versionInfo.version,
			printQRInTerminal: false,
			syncFullHistory: false,
		});

		this.socket.ev.on("creds.update", saveCreds);
		this.socket.ev.on("connection.update", async (update: any) => {
			if (update.qr && this.printQr) {
				this.updateRuntimeStatus({
					state: "awaiting_pairing",
					summary: "Waiting for WhatsApp pairing",
					lastError: undefined,
					details: {
						authDir: this.authDir,
						qrAvailable: true,
					},
				});
				await this.printPairingQr(update.qr);
			}
			if (update.connection === "open") {
				this.reconnectAttempt = 0;
				this.updateRuntimeStatus({
					state: "running",
					summary: "Connected",
					lastError: undefined,
					restartAttempt: 0,
					details: {
						authDir: this.authDir,
					},
				});
				console.log("[whatsapp] connected");
				return;
			}
			if (update.connection === "close" && this.running) {
				const statusCode = update.lastDisconnect?.error?.output?.statusCode;
				const loggedOut = statusCode === DisconnectReason?.loggedOut;
				if (loggedOut) {
					this.updateRuntimeStatus({
						state: "awaiting_pairing",
						summary: "Logged out; re-pair required",
						lastError: undefined,
						details: {
							authDir: this.authDir,
							loggedOut: true,
						},
					});
					console.error("[whatsapp] disconnected (logged out). Re-pair by deleting auth dir and restarting.");
					this.running = false;
					return;
				}
				this.scheduleReconnect();
			}
		});
		this.socket.ev.on("messages.upsert", (payload: any) => {
			const items = payload?.messages;
			if (!Array.isArray(items)) return;
			void this.handleInboundMessages(items, downloadMediaMessage);
		});

		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				cleanup();
				reject(new Error("WhatsApp connection timeout"));
			}, 45_000);
			const onUpdate = (update: any) => {
				if (update.connection === "open") {
					cleanup();
					resolve();
				} else if (update.connection === "close") {
					const statusCode = update.lastDisconnect?.error?.output?.statusCode;
					if (statusCode) {
						cleanup();
						reject(new Error(`WhatsApp connection closed (code ${statusCode})`));
					}
				}
			};
			const cleanup = () => {
				clearTimeout(timeout);
				this.socket?.ev?.off?.("connection.update", onUpdate);
			};
			this.socket.ev.on("connection.update", onUpdate);
		});
	}

	private async printPairingQr(qr: string): Promise<void> {
		try {
			const qrcode: any = await import("qrcode-terminal");
			const generator = qrcode.default?.generate ?? qrcode.generate;
			console.log("[whatsapp] scan QR code to pair:");
			generator(qr, { small: true });
		} catch {
			console.log(`[whatsapp] pairing QR: ${qr}`);
		}
	}

	private scheduleReconnect(): void {
		if (this.reconnectTimer || !this.running) return;
		const backoffMs = Math.min(30_000, 2_000 * Math.max(1, this.reconnectAttempt + 1));
		this.reconnectAttempt += 1;
		this.updateRuntimeStatus({
			state: "reconnecting",
			summary: `Reconnecting in ${backoffMs}ms`,
			restartAttempt: this.reconnectAttempt,
			details: {
				authDir: this.authDir,
				backoffMs,
			},
		});
		this.reconnectTimer = setTimeout(async () => {
			this.reconnectTimer = null;
			if (!this.running) return;
			try {
				console.warn(`[whatsapp] reconnect attempt ${this.reconnectAttempt}`);
				await this.connect();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.updateRuntimeStatus({
					state: "reconnecting",
					summary: "Reconnect failed; retrying",
					lastError: message,
					restartAttempt: this.reconnectAttempt,
					details: {
						authDir: this.authDir,
					},
				});
				console.error(`[whatsapp] reconnect failed: ${message}`);
				this.scheduleReconnect();
			}
		}, backoffMs);
	}

	async stop(): Promise<void> {
		if (!this.running) return;
		this.running = false;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.socket) {
			try {
				this.socket.ws?.close?.();
				this.socket.end?.();
			} catch {
				// no-op
			}
			this.socket = null;
		}
		this.sentTargetByMessageId.clear();
		this.updateRuntimeStatus({
			state: "stopped",
			summary: "Stopped",
			lastError: undefined,
			restartAttempt: 0,
			details: {
				authDir: this.authDir,
			},
		});
	}

	private async sendMessage(msg: OutboundMessage): Promise<string> {
		if (!this.socket) {
			throw new Error("WhatsApp not connected. Run start() first and complete QR pairing.");
		}

		const recipient = this.normalizeRecipient(msg.recipientId);
		if (!this.isAllowed(recipient)) {
			throw new Error(`Recipient ${recipient} is not in WhatsApp allowlist.`);
		}
		const text = msg.text.trim();
		const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
		if (!text && attachments.length === 0) {
			throw new Error("whatsapp send requires text or attachments");
		}

		let firstMessageId = "";
		if (attachments.length === 0) {
			const result = await this.socket.sendMessage(recipient, { text });
			const messageId = result?.key?.id ?? "";
			if (messageId) {
				this.sentTargetByMessageId.set(messageId, recipient);
			}
			return messageId;
		}

		const firstCaptionIndex = attachments.findIndex((attachment) => attachment.type !== "audio");
		const sendStandaloneText = Boolean(text) && firstCaptionIndex !== 0;
		if (sendStandaloneText) {
			const result = await this.socket.sendMessage(recipient, { text });
			const messageId = result?.key?.id ?? "";
			if (messageId) {
				this.sentTargetByMessageId.set(messageId, recipient);
				firstMessageId ||= messageId;
			}
		}

		for (const [index, attachment] of attachments.entries()) {
			const prepared = await readOutboundAttachmentBytes(attachment);
			const caption = !sendStandaloneText && text && index === firstCaptionIndex ? text : undefined;
			const payload = this.buildOutboundPayload(attachment, prepared.bytes, prepared.name, caption);
			const result = await this.socket.sendMessage(recipient, payload);
			const messageId = result?.key?.id ?? "";
			if (messageId) {
				this.sentTargetByMessageId.set(messageId, recipient);
				firstMessageId ||= messageId;
			}
		}
		return firstMessageId;
	}

	private buildOutboundPayload(
		attachment: Attachment,
		media: Buffer,
		fileName: string,
		caption?: string,
	): Record<string, unknown> {
		switch (attachment.type) {
			case "image":
				return { image: media, caption, mimetype: attachment.mimeType };
			case "video":
				return { video: media, caption, mimetype: attachment.mimeType };
			case "audio":
				return { audio: media, ptt: false, mimetype: attachment.mimeType };
			case "file":
			default:
				return {
					document: media,
					fileName,
					mimetype: attachment.mimeType ?? "application/octet-stream",
					caption,
				};
		}
	}

	private normalizePhone(value: string | undefined): string | undefined {
		if (!value) return undefined;
		const plain = value.includes("@") ? value.split("@")[0] : value;
		const digits = plain.replace(/[^\d+]/g, "");
		return digits.length > 0 ? digits : undefined;
	}

	private normalizeRecipient(value: string): string {
		const trimmed = value.trim();
		if (trimmed.includes("@")) return trimmed;
		return `${trimmed}@s.whatsapp.net`;
	}

	private isAllowed(recipient: string): boolean {
		if (this.allowedNumbers.size === 0) return true;
		const phone = this.normalizePhone(recipient);
		return this.allowedNumbers.has(recipient) || (phone ? this.allowedNumbers.has(phone) : false);
	}

	private resolveMessageTarget(messageId: string, recipientId?: string): string {
		if (!this.socket) {
			throw new Error("WhatsApp not connected.");
		}
		const fromRecipient = recipientId?.trim();
		if (fromRecipient) return this.normalizeRecipient(fromRecipient);
		const cached = this.sentTargetByMessageId.get(messageId);
		if (cached) return cached;
		throw new Error("recipientId is required for this WhatsApp message action");
	}

	private extractIncomingText(message: any): string {
		if (!message) return "";
		if (typeof message.conversation === "string") return message.conversation;
		if (typeof message.extendedTextMessage?.text === "string") return message.extendedTextMessage.text;
		if (typeof message.imageMessage?.caption === "string") return message.imageMessage.caption;
		if (typeof message.videoMessage?.caption === "string") return message.videoMessage.caption;
		if (typeof message.documentMessage?.caption === "string") return message.documentMessage.caption;
		if (typeof message.buttonsResponseMessage?.selectedDisplayText === "string") {
			return message.buttonsResponseMessage.selectedDisplayText;
		}
		if (typeof message.listResponseMessage?.title === "string") {
			return message.listResponseMessage.title;
		}
		return "";
	}

	private async handleInboundMessages(items: any[], downloadMediaMessage: any): Promise<void> {
		for (const item of items) {
			if (!item || item.key?.fromMe) continue;
			const remoteJid = item.key?.remoteJid;
			if (!remoteJid) continue;
			if (!this.isAllowed(remoteJid)) continue;
			const attachments = await this.extractInboundAttachments(item, downloadMediaMessage).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				console.warn(`[whatsapp] failed to materialize inbound media: ${message}`);
				return [] as Attachment[];
			});
			const text = this.extractIncomingText(item.message);
			if (!text && attachments.length === 0) continue;
			if (item.key?.id) {
				this.sentTargetByMessageId.set(item.key.id, remoteJid);
			}
			const timestampSeconds =
				typeof item.messageTimestamp === "number"
					? item.messageTimestamp
					: Number(item.messageTimestamp ?? 0);
			this.emitMessage({
				channelId: "whatsapp",
				senderId: remoteJid,
				senderName: this.normalizePhone(remoteJid) ?? remoteJid,
				conversationType: remoteJid.endsWith("@g.us") ? "group" : "direct",
				externalMessageId: typeof item.key?.id === "string" ? item.key.id : undefined,
				text,
				replyToMessageId: item.message?.extendedTextMessage?.contextInfo?.stanzaId,
				attachments: attachments.length > 0 ? attachments : undefined,
				timestamp:
					Number.isFinite(timestampSeconds) && timestampSeconds > 0
						? timestampSeconds * 1000
						: Date.now(),
			});
		}
	}

	private async extractInboundAttachments(item: any, downloadMediaMessage: any): Promise<Attachment[]> {
		if (!item?.message || typeof downloadMediaMessage !== "function") {
			return [];
		}

		const mediaInfo = this.resolveInboundMediaInfo(item.message, item.key?.id);
		if (!mediaInfo) {
			return [];
		}
		const mediaData = await downloadMediaMessage(
			item,
			"buffer",
			{},
			{
				logger: NOOP_BAILEYS_LOGGER,
				reuploadRequest: this.socket?.updateMediaMessage?.bind(this.socket),
			},
		);
		const bytes =
			mediaData instanceof Uint8Array || Buffer.isBuffer(mediaData)
				? Buffer.from(mediaData)
				: null;
		if (!bytes || bytes.byteLength === 0) {
			return [];
		}
		return [
			await materializeInboundAttachment({
				channelId: this.id,
				messageId: typeof item.key?.id === "string" ? item.key.id : undefined,
				type: mediaInfo.type,
				bytes,
				fileName: mediaInfo.fileName,
				mimeType: mediaInfo.mimeType,
			}),
		];
	}

	private resolveInboundMediaInfo(
		message: any,
		messageId?: string,
	): { type: Attachment["type"]; fileName?: string; mimeType?: string } | null {
		if (message.imageMessage) {
			return {
				type: "image",
				fileName: `whatsapp-image-${messageId ?? Date.now()}.jpg`,
				mimeType: message.imageMessage.mimetype ?? "image/jpeg",
			};
		}
		if (message.videoMessage) {
			return {
				type: "video",
				fileName: `whatsapp-video-${messageId ?? Date.now()}.mp4`,
				mimeType: message.videoMessage.mimetype ?? "video/mp4",
			};
		}
		if (message.audioMessage) {
			return {
				type: "audio",
				fileName: `whatsapp-audio-${messageId ?? Date.now()}.ogg`,
				mimeType: message.audioMessage.mimetype ?? "audio/ogg",
			};
		}
		if (message.documentMessage) {
			return {
				type: "file",
				fileName: message.documentMessage.fileName,
				mimeType: message.documentMessage.mimetype,
			};
		}
		return null;
	}
}
