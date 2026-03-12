/**
 * Telegram channel adapter using grammY.
 */

import type {
	Attachment,
	ChannelCapabilities,
	ChannelMessagingAdapter,
	OutboundMessage,
} from "@understudy/types";
import { BaseChannel } from "../shared/channel-base.js";
import {
	materializeInboundAttachment,
} from "../shared/inbound-media.js";
import { resolveAttachmentType } from "../shared/media-utils.js";
import { parseBase64DataUrl } from "../shared/outbound-media.js";

export interface TelegramChannelOptions {
	botToken: string;
	allowedChatIds?: string[];
}

export class TelegramChannel extends BaseChannel {
	readonly id = "telegram";
	readonly name = "Telegram";
	readonly capabilities: ChannelCapabilities = {
		streaming: false,
		threads: true,
		reactions: true,
		attachments: true,
		groups: true,
	};

	readonly messaging: ChannelMessagingAdapter;
	private options: TelegramChannelOptions;
	private bot: any = null;

	constructor(options: TelegramChannelOptions) {
		super();
		this.options = options;
		this.messaging = this.createMessagingAdapter(this.sendMessage.bind(this), {
			editMessage: async (params) => {
				if (!this.bot) throw new Error("Telegram bot not started");
				if (!params.recipientId) throw new Error("recipientId is required for telegram edit");
				await this.bot.api.editMessageText(
					params.recipientId,
					Number(params.messageId),
					params.text,
				);
			},
			deleteMessage: async (params) => {
				if (!this.bot) throw new Error("Telegram bot not started");
				if (!params.recipientId) throw new Error("recipientId is required for telegram delete");
				await this.bot.api.deleteMessage(params.recipientId, Number(params.messageId));
			},
			reactToMessage: async (params) => {
				if (!this.bot) throw new Error("Telegram bot not started");
				if (!params.recipientId) throw new Error("recipientId is required for telegram reaction");
				if (typeof this.bot.api.setMessageReaction !== "function") {
					throw new Error("Telegram reaction API is not available in current grammY runtime");
				}
				await this.bot.api.setMessageReaction(
					params.recipientId,
					Number(params.messageId),
					params.remove ? [] : [{ type: "emoji", emoji: params.emoji }],
				);
			},
		});
	}

	async start(): Promise<void> {
		if (this.running) return;

		const { Bot } = await import("grammy");
		this.bot = new Bot(this.options.botToken);

		this.bot.on("message", async (ctx: any) => {
			const chatId = String(ctx.chat.id);

			// Enforce allowlist if configured
			if (this.options.allowedChatIds && !this.options.allowedChatIds.includes(chatId)) {
				return;
			}

			const attachments = await this.extractInboundAttachments(ctx).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				console.warn(`[telegram] failed to materialize inbound media: ${message}`);
				return [] as Attachment[];
			});
			const text = this.extractIncomingText(ctx.message);
			if (!text && attachments.length === 0) {
				return;
			}
			this.emitMessage({
				channelId: "telegram",
				senderId: chatId,
				senderName: this.resolveSenderName(ctx.from),
				conversationName: this.resolveConversationName(ctx.chat, ctx.from),
				conversationType:
					ctx.chat?.type === "private"
						? "direct"
						: ctx.message.message_thread_id
							? "thread"
							: "group",
				externalMessageId: String(ctx.message.message_id),
				text,
				threadId: ctx.message.message_thread_id ? String(ctx.message.message_thread_id) : undefined,
				replyToMessageId: ctx.message.reply_to_message?.message_id
					? String(ctx.message.reply_to_message.message_id)
					: undefined,
				attachments: attachments.length > 0 ? attachments : undefined,
				timestamp: ctx.message.date * 1000,
			});
		});

		this.bot.start();
		this.running = true;
	}

	async stop(): Promise<void> {
		if (!this.running || !this.bot) return;
		this.bot.stop();
		this.bot = null;
		this.running = false;
	}

	private async sendMessage(msg: OutboundMessage): Promise<string> {
		if (!this.bot) throw new Error("Telegram bot not started");
		const text = msg.text?.trim() ?? "";
		const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
		if (!text && attachments.length === 0) {
			throw new Error("telegram send requires text or attachments");
		}
		const common = {
			reply_to_message_id: msg.replyToMessageId ? Number(msg.replyToMessageId) : undefined,
			message_thread_id: msg.threadId ? Number(msg.threadId) : undefined,
		};
		if (attachments.length === 0) {
			const result = await this.bot.api.sendMessage(msg.recipientId, text, common);
			return String(result.message_id);
		}
		const { InputFile } = await import("grammy");
		let firstMessageId: string | undefined;
		let captionUsed = false;
		for (const attachment of attachments) {
			const inlineData = parseBase64DataUrl(attachment.url);
			const file = inlineData
				? new InputFile(inlineData.bytes, attachment.name)
				: /^https?:\/\//i.test(attachment.url)
					? attachment.url
					: new InputFile(attachment.url, attachment.name);
			const caption: string | undefined = !captionUsed && text ? text : undefined;
			let result: { message_id: number } | undefined;
			switch (attachment.type) {
				case "image":
					result = await this.bot.api.sendPhoto(msg.recipientId, file, {
						...common,
						caption,
					});
					break;
				case "video":
					result = await this.bot.api.sendVideo(msg.recipientId, file, {
						...common,
						caption,
					});
					break;
				case "audio":
					result = await this.bot.api.sendAudio(msg.recipientId, file, {
						...common,
						caption,
					});
					break;
				case "file":
				default:
					result = await this.bot.api.sendDocument(msg.recipientId, file, {
						...common,
						caption,
					});
					break;
			}
			if (!result) {
				throw new Error("Telegram media send produced no result");
			}
			firstMessageId ||= String(result.message_id);
			captionUsed ||= Boolean(caption);
		}
		return firstMessageId ?? "";
	}

	private extractIncomingText(message: any): string {
		if (!message || typeof message !== "object") return "";
		if (typeof message.text === "string") return message.text;
		if (typeof message.caption === "string") return message.caption;
		return "";
	}

	private resolveSenderName(sender: any): string | undefined {
		if (!sender || typeof sender !== "object") {
			return undefined;
		}
		const firstName = typeof sender.first_name === "string" ? sender.first_name.trim() : "";
		const lastName = typeof sender.last_name === "string" ? sender.last_name.trim() : "";
		const username = typeof sender.username === "string" ? sender.username.trim() : "";
		const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
		if (fullName && username) {
			return `${fullName} (@${username})`;
		}
		if (fullName) {
			return fullName;
		}
		return username ? `@${username}` : undefined;
	}

	private resolveConversationName(chat: any, sender: any): string | undefined {
		if (!chat || typeof chat !== "object") {
			return undefined;
		}
		const title = typeof chat.title === "string" ? chat.title.trim() : "";
		if (title) {
			return title;
		}
		if (chat.type === "private") {
			return this.resolveSenderName(sender);
		}
		const username = typeof chat.username === "string" ? chat.username.trim() : "";
		return username ? `@${username}` : undefined;
	}

	private async extractInboundAttachments(ctx: any): Promise<Attachment[]> {
		const message = ctx?.message;
		if (!message || !this.bot) {
			return [];
		}

		const attachments: Attachment[] = [];
		const messageId = String(message.message_id ?? Date.now());
		const mediaEntries: Array<{
			fileId?: string;
			type: Attachment["type"];
			fileName?: string;
			mimeType?: string;
		}> = [];

		if (Array.isArray(message.photo) && message.photo.length > 0) {
			const photo = message.photo[message.photo.length - 1];
			mediaEntries.push({
				fileId: photo?.file_id,
				type: "image",
				fileName: `telegram-photo-${messageId}.jpg`,
				mimeType: "image/jpeg",
			});
		}
		if (message.document?.file_id) {
			mediaEntries.push({
				fileId: message.document.file_id,
				type: resolveAttachmentType(message.document.mime_type),
				fileName: message.document.file_name,
				mimeType: message.document.mime_type,
			});
		}
		if (message.video?.file_id) {
			mediaEntries.push({
				fileId: message.video.file_id,
				type: "video",
				fileName: message.video.file_name,
				mimeType: message.video.mime_type,
			});
		}
		if (message.audio?.file_id) {
			mediaEntries.push({
				fileId: message.audio.file_id,
				type: "audio",
				fileName: message.audio.file_name,
				mimeType: message.audio.mime_type,
			});
		}
		if (message.voice?.file_id) {
			mediaEntries.push({
				fileId: message.voice.file_id,
				type: "audio",
				fileName: `telegram-voice-${messageId}.ogg`,
				mimeType: message.voice.mime_type ?? "audio/ogg",
			});
		}

		for (const entry of mediaEntries) {
			if (!entry.fileId) continue;
			const bytes = await this.downloadTelegramFile(entry.fileId);
			attachments.push(
				await materializeInboundAttachment({
					channelId: this.id,
					messageId,
					type: entry.type,
					bytes,
					fileName: entry.fileName,
					mimeType: entry.mimeType,
				}),
			);
		}

		return attachments;
	}

	private async downloadTelegramFile(fileId: string): Promise<Buffer> {
		if (!this.bot) {
			throw new Error("Telegram bot not started");
		}
		const file = await this.bot.api.getFile(fileId);
		const filePath = typeof file?.file_path === "string" ? file.file_path.trim() : "";
		if (!filePath) {
			throw new Error("Telegram getFile returned no file_path");
		}
		const response = await fetch(`https://api.telegram.org/file/bot${this.options.botToken}/${filePath}`);
		if (!response.ok) {
			throw new Error(`Telegram media download failed: HTTP ${response.status}`);
		}
		const arrayBuffer = await response.arrayBuffer();
		return Buffer.from(arrayBuffer);
	}
}
