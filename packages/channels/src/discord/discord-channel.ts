/**
 * Discord channel adapter using discord.js.
 */

import type {
	Attachment,
	ChannelCapabilities,
	ChannelMessagingAdapter,
	ChannelGroupAdapter,
	GroupInfo,
	OutboundMessage,
} from "@understudy/types";
import { BaseChannel } from "../shared/channel-base.js";
import { materializeInboundAttachment } from "../shared/inbound-media.js";
import { normalizeMimeType, resolveAttachmentType } from "../shared/media-utils.js";
import { readOutboundAttachmentBytes } from "../shared/outbound-media.js";

export interface DiscordChannelOptions {
	botToken: string;
	allowedGuildIds?: string[];
}

export class DiscordChannel extends BaseChannel {
	readonly id = "discord";
	readonly name = "Discord";
	readonly capabilities: ChannelCapabilities = {
		streaming: false,
		threads: true,
		reactions: true,
		attachments: true,
		groups: true,
	};

	readonly messaging: ChannelMessagingAdapter;
	readonly groups: ChannelGroupAdapter;
	private options: DiscordChannelOptions;
	private client: any = null;

	constructor(options: DiscordChannelOptions) {
		super();
		this.options = options;
		this.messaging = this.createMessagingAdapter(this.sendMessage.bind(this), {
			editMessage: async (params) => {
				if (!this.client) throw new Error("Discord client not started");
				const channel = await this.client.channels.fetch(params.channelId);
				if (!channel?.isTextBased?.()) {
					throw new Error(`Channel ${params.channelId} is not a text channel`);
				}
				const message = await channel.messages.fetch(params.messageId);
				await message.edit(params.text);
			},
			deleteMessage: async (params) => {
				if (!this.client) throw new Error("Discord client not started");
				const channel = await this.client.channels.fetch(params.channelId);
				if (!channel?.isTextBased?.()) {
					throw new Error(`Channel ${params.channelId} is not a text channel`);
				}
				const message = await channel.messages.fetch(params.messageId);
				await message.delete();
			},
			reactToMessage: async (params) => {
				if (!this.client) throw new Error("Discord client not started");
				const channel = await this.client.channels.fetch(params.channelId);
				if (!channel?.isTextBased?.()) {
					throw new Error(`Channel ${params.channelId} is not a text channel`);
				}
				const message = await channel.messages.fetch(params.messageId);
				if (params.remove) {
					await message.reactions.removeAll();
				} else {
					await message.react(params.emoji);
				}
			},
		});
		this.groups = {
			listGroups: this.listGroups.bind(this),
			getGroup: this.getGroup.bind(this),
		};
	}

	async start(): Promise<void> {
		if (this.running) return;

		const { Client, GatewayIntentBits } = await import("discord.js");
		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.DirectMessages,
				GatewayIntentBits.MessageContent,
			],
		});

		this.client.on("messageCreate", (message: any) => {
			void this.handleInboundMessage(message);
		});

		await this.client.login(this.options.botToken);
		this.running = true;
	}

	async stop(): Promise<void> {
		if (!this.running || !this.client) return;
		this.client.destroy();
		this.client = null;
		this.running = false;
	}

	private async sendMessage(msg: OutboundMessage): Promise<string> {
		if (!this.client) throw new Error("Discord client not started");
		const text = msg.text?.trim() ?? "";
		const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
		if (!text && attachments.length === 0) {
			throw new Error("discord send requires text or attachments");
		}

		const channel = await this.client.channels.fetch(msg.recipientId);
		if (!channel?.isTextBased?.()) {
			throw new Error(`Channel ${msg.recipientId} is not a text channel`);
		}

		const options: any = {};
		if (text) {
			options.content = text;
		}
		if (msg.replyToMessageId) {
			options.reply = { messageReference: msg.replyToMessageId };
		}
		if (attachments.length > 0) {
			options.files = await Promise.all(attachments.map(async (attachment) => {
				const prepared = await readOutboundAttachmentBytes(attachment);
				return {
					attachment: prepared.bytes,
					name: prepared.name,
				};
			}));
		}

		const sent = await channel.send(options);
		return sent.id;
	}

	private async handleInboundMessage(message: any): Promise<void> {
		if (!message || message.author?.bot) return;

		if (this.options.allowedGuildIds && message.guild) {
			if (!this.options.allowedGuildIds.includes(message.guild.id)) return;
		}

		const attachments = await this.extractInboundAttachments(message).catch((error) => {
			const detail = error instanceof Error ? error.message : String(error);
			console.warn(`[discord] failed to materialize inbound media: ${detail}`);
			return [] as Attachment[];
		});
		const text = this.extractIncomingText(message);
		if (!text && attachments.length === 0) {
			return;
		}

		this.emitMessage({
			channelId: "discord",
			senderId: message.channel.id,
			senderName: message.author.username,
			conversationType: message.channel.isThread?.()
				? "thread"
				: message.channel.isDMBased?.() && !message.guild
					? "direct"
					: "group",
			externalMessageId: typeof message.id === "string" ? message.id : undefined,
			text,
			threadId: message.channel.isThread?.() ? message.channel.id : undefined,
			replyToMessageId: message.reference?.messageId,
			timestamp: message.createdTimestamp,
			attachments: attachments.length > 0 ? attachments : undefined,
		});
	}

	private extractIncomingText(message: any): string {
		return typeof message?.content === "string" ? message.content : "";
	}

	private async extractInboundAttachments(message: any): Promise<Attachment[]> {
		const entries = this.collectAttachmentEntries(message?.attachments);
		if (entries.length === 0) {
			return [];
		}

		const attachments: Attachment[] = [];
		const messageId = typeof message?.id === "string" ? message.id : undefined;
		for (const entry of entries) {
			try {
				const downloaded = await this.downloadDiscordAttachment(entry);
				const fileName = this.resolveDiscordFileName(entry);
				const mimeType = normalizeMimeType(
					entry?.contentType ?? entry?.content_type ?? downloaded.contentType,
				);
				attachments.push(
					await materializeInboundAttachment({
						channelId: this.id,
						messageId,
						type: resolveAttachmentType(mimeType, fileName),
						bytes: downloaded.bytes,
						fileName,
						mimeType,
					}),
				);
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				const label = this.resolveDiscordFileName(entry);
				console.warn(`[discord] failed to download inbound attachment ${label}: ${detail}`);
			}
		}
		return attachments;
	}

	private collectAttachmentEntries(collection: any): any[] {
		if (!collection) return [];
		if (Array.isArray(collection)) return collection;
		if (typeof collection.values === "function") {
			return Array.from(collection.values());
		}
		if (typeof collection.forEach === "function") {
			const values: any[] = [];
			collection.forEach((value: any) => values.push(value));
			return values;
		}
		return [];
	}

	private resolveDiscordFileName(entry: any): string {
		if (typeof entry?.name === "string" && entry.name.trim()) return entry.name.trim();
		if (typeof entry?.filename === "string" && entry.filename.trim()) return entry.filename.trim();
		return "attachment";
	}

	private async downloadDiscordAttachment(
		entry: any,
	): Promise<{ bytes: Buffer; contentType?: string }> {
		const urls = [entry?.url, entry?.proxyURL, entry?.proxy_url]
			.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
			.map((value) => value.trim());
		if (urls.length === 0) {
			throw new Error("Discord attachment is missing a download URL");
		}

		let lastError: Error | null = null;
		for (const url of new Set(urls)) {
			try {
				const response = await fetch(url);
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`);
				}
				return {
					bytes: Buffer.from(await response.arrayBuffer()),
					contentType: normalizeMimeType(response.headers.get("content-type")),
				};
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
			}
		}

		throw lastError ?? new Error("Discord attachment download failed");
	}

	private async listGroups(): Promise<GroupInfo[]> {
		if (!this.client) return [];
		return Array.from(this.client.guilds.cache.values()).map((guild: any) => ({
			id: guild.id,
			name: guild.name,
			memberCount: guild.memberCount,
		}));
	}

	private async getGroup(groupId: string): Promise<GroupInfo | null> {
		if (!this.client) return null;
		const guild = this.client.guilds.cache.get(groupId);
		if (!guild) return null;
		return {
			id: guild.id,
			name: guild.name,
			memberCount: guild.memberCount,
		};
	}
}
