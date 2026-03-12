/**
 * Slack channel adapter using @slack/bolt.
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

const MAX_SLACK_MEDIA_REDIRECTS = 5;

export interface SlackChannelOptions {
	botToken: string;
	signingSecret: string;
	appToken?: string;
	port?: number;
	allowedChannelIds?: string[];
	allowedUserIds?: string[];
}

function resolveUploadedMessageTs(result: unknown): string | undefined {
	const candidateFiles = (result as { files?: unknown[] } | undefined)?.files;
	const files = Array.isArray(candidateFiles) ? candidateFiles : [];
	for (const file of files) {
		if (!file || typeof file !== "object") {
			continue;
		}
		const shares = (file as { shares?: unknown }).shares;
		if (!shares || typeof shares !== "object") {
			continue;
		}
		for (const visibility of ["public", "private"] as const) {
			const buckets = (shares as Record<string, unknown>)[visibility];
			if (!buckets || typeof buckets !== "object") {
				continue;
			}
			for (const entries of Object.values(buckets as Record<string, unknown>)) {
				if (!Array.isArray(entries)) {
					continue;
				}
				for (const entry of entries) {
					if (!entry || typeof entry !== "object") {
						continue;
					}
					const ts = typeof (entry as { ts?: unknown }).ts === "string"
						? (entry as { ts: string }).ts.trim()
						: "";
					if (ts) {
						return ts;
					}
				}
			}
		}
	}
	return undefined;
}

export class SlackChannel extends BaseChannel {
	readonly id = "slack";
	readonly name = "Slack";
	readonly capabilities: ChannelCapabilities = {
		streaming: false,
		threads: true,
		reactions: true,
		attachments: true,
		groups: true,
	};

	readonly messaging: ChannelMessagingAdapter;
	readonly groups: ChannelGroupAdapter;
	private options: SlackChannelOptions;
	private app: any = null;
	private readonly senderNameCache = new Map<string, string>();
	private readonly conversationNameCache = new Map<string, string>();

	constructor(options: SlackChannelOptions) {
		super();
		this.options = options;
		this.messaging = this.createMessagingAdapter(this.sendMessage.bind(this), {
			editMessage: async (params) => {
				if (!this.app) throw new Error("Slack app not started");
				await this.app.client.chat.update({
					channel: params.channelId,
					ts: params.messageId,
					text: params.text,
				});
			},
			deleteMessage: async (params) => {
				if (!this.app) throw new Error("Slack app not started");
				await this.app.client.chat.delete({
					channel: params.channelId,
					ts: params.messageId,
				});
			},
			reactToMessage: async (params) => {
				if (!this.app) throw new Error("Slack app not started");
				if (params.remove) {
					await this.app.client.reactions.remove({
						channel: params.channelId,
						timestamp: params.messageId,
						name: params.emoji,
					});
					return;
				}
				await this.app.client.reactions.add({
					channel: params.channelId,
					timestamp: params.messageId,
					name: params.emoji,
				});
			},
		});
		this.groups = {
			listGroups: this.listGroups.bind(this),
			getGroup: this.getGroup.bind(this),
		};
	}

	async start(): Promise<void> {
		if (this.running) return;

		const { App } = await import("@slack/bolt");
		this.app = new App({
			token: this.options.botToken,
			signingSecret: this.options.signingSecret,
			appToken: this.options.appToken,
			socketMode: !!this.options.appToken,
			port: this.options.port,
		});

		this.app.message(async ({ message }: any) => {
			await this.handleInboundMessage(message);
		});

		await this.app.start();
		this.running = true;
	}

	async stop(): Promise<void> {
		if (!this.running || !this.app) return;
		await this.app.stop();
		this.app = null;
		this.running = false;
	}

	private async sendMessage(msg: OutboundMessage): Promise<string> {
		if (!this.app) throw new Error("Slack app not started");
		const text = msg.text?.trim() ?? "";
		const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
		const threadTs = msg.threadId ?? msg.replyToMessageId;
		if (!text && attachments.length === 0) {
			throw new Error("slack send requires text or attachments");
		}
		if (attachments.length === 0) {
			const result = await this.app.client.chat.postMessage({
				channel: msg.recipientId,
				text,
				thread_ts: threadTs,
			});
			return result.ts ?? "";
		}

		const fileUploads = await Promise.all(attachments.map(async (attachment) => {
			const prepared = await readOutboundAttachmentBytes(attachment);
			return {
				file: prepared.bytes,
				filename: prepared.name,
				title: prepared.name,
				...(attachment.type === "image" ? { alt_text: prepared.name } : {}),
			};
		}));
		const result = await this.app.client.files.uploadV2({
			channel_id: msg.recipientId,
			initial_comment: text || undefined,
			thread_ts: threadTs,
			file_uploads: fileUploads,
		});
		const uploadedMessageTs = resolveUploadedMessageTs(result);
		if (uploadedMessageTs) {
			return uploadedMessageTs;
		}
		return Array.isArray((result as { files?: Array<{ id?: string }> }).files)
			? (result as { files?: Array<{ id?: string }> }).files?.[0]?.id ?? ""
			: "";
	}

	private async handleInboundMessage(message: any): Promise<void> {
		if (this.shouldSkipInboundMessage(message)) {
			return;
		}
		if (!this.isAllowedInboundMessage(message)) {
			return;
		}

		const attachments = await this.extractInboundAttachments(message).catch((error) => {
			const detail = error instanceof Error ? error.message : String(error);
			console.warn(`[slack] failed to materialize inbound media: ${detail}`);
			return [] as Attachment[];
		});
		const text = this.extractIncomingText(message);
		if (!text && attachments.length === 0) {
			return;
		}

		this.emitMessage({
			channelId: "slack",
			senderId: message.channel,
			senderName: await this.resolveSenderName(message),
			conversationName: await this.resolveConversationName(message),
			conversationType:
				typeof message.thread_ts === "string" && message.thread_ts !== message.ts
					? "thread"
					: message.channel_type === "im"
						? "direct"
						: "group",
			externalMessageId:
				typeof message.client_msg_id === "string"
					? message.client_msg_id
					: typeof message.ts === "string"
						? message.ts
						: undefined,
			text,
			threadId:
				typeof message.thread_ts === "string" && message.thread_ts !== message.ts
					? message.thread_ts
					: undefined,
			timestamp:
				typeof message.ts === "string" ? Math.round(parseFloat(message.ts) * 1000) : Date.now(),
			attachments: attachments.length > 0 ? attachments : undefined,
		});
	}

	private shouldSkipInboundMessage(message: any): boolean {
		if (!message || typeof message !== "object") return true;
		const subtype = typeof message.subtype === "string" ? message.subtype.trim() : "";
		if (!subtype) return false;
		return subtype !== "file_share";
	}

	private isAllowedInboundMessage(message: any): boolean {
		const channelId = typeof message?.channel === "string" ? message.channel.trim() : "";
		const userId = typeof message?.user === "string" ? message.user.trim() : "";
		const allowedChannelIds = (this.options.allowedChannelIds ?? [])
			.map((value) => value.trim())
			.filter(Boolean);
		if (allowedChannelIds.length > 0 && !allowedChannelIds.includes(channelId)) {
			return false;
		}
		const allowedUserIds = (this.options.allowedUserIds ?? [])
			.map((value) => value.trim())
			.filter(Boolean);
		if (allowedUserIds.length > 0 && !allowedUserIds.includes(userId)) {
			return false;
		}
		return true;
	}

	private extractIncomingText(message: any): string {
		return typeof message?.text === "string" ? message.text : "";
	}

	private async extractInboundAttachments(message: any): Promise<Attachment[]> {
		const files = Array.isArray(message?.files) ? message.files : [];
		if (files.length === 0) {
			return [];
		}

		const attachments: Attachment[] = [];
		const messageId =
			typeof message?.client_msg_id === "string"
				? message.client_msg_id
				: typeof message?.ts === "string"
					? message.ts
					: undefined;
		for (const file of files) {
			const url = this.resolveSlackFileUrl(file);
			if (!url) continue;

			try {
				const downloaded = await this.downloadSlackFile(url);
				const mimeType = normalizeMimeType(file?.mimetype ?? downloaded.contentType);
				attachments.push(
					await materializeInboundAttachment({
						channelId: this.id,
						messageId,
						type: resolveAttachmentType(mimeType, file?.name),
						bytes: downloaded.bytes,
						fileName: file?.name,
						mimeType,
					}),
				);
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				const label = typeof file?.name === "string" ? file.name : url;
				console.warn(`[slack] failed to download inbound file ${label}: ${detail}`);
			}
		}
		return attachments;
	}

	private resolveSlackFileUrl(file: any): string | undefined {
		for (const key of ["url_private_download", "url_private"] as const) {
			const value = typeof file?.[key] === "string" ? file[key].trim() : "";
			if (value) return value;
		}
		return undefined;
	}

	private async downloadSlackFile(
		url: string,
	): Promise<{ bytes: Buffer; contentType?: string }> {
		let currentUrl = url;
		let includeAuth = true;

		for (let hop = 0; hop < MAX_SLACK_MEDIA_REDIRECTS; hop += 1) {
			const response = await fetch(currentUrl, {
				headers: includeAuth
					? {
							authorization: `Bearer ${this.options.botToken}`,
						}
					: undefined,
				redirect: "manual",
			});
			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get("location");
				if (!location) {
					throw new Error(`Slack media redirect missing location (HTTP ${response.status})`);
				}
				currentUrl = new URL(location, currentUrl).toString();
				includeAuth = false;
				continue;
			}
			if (!response.ok) {
				throw new Error(`Slack media download failed: HTTP ${response.status}`);
			}
			return {
				bytes: Buffer.from(await response.arrayBuffer()),
				contentType: normalizeMimeType(response.headers.get("content-type")),
			};
		}

		throw new Error("Slack media download followed too many redirects");
	}

	private async resolveSenderName(message: any): Promise<string | undefined> {
		const inlineName = this.firstDefinedSlackName([
			message?.user_profile?.display_name_normalized,
			message?.user_profile?.display_name,
			message?.user_profile?.real_name,
			message?.bot_profile?.name,
			message?.username,
		]);
		if (inlineName) {
			return inlineName;
		}

		const userId = typeof message?.user === "string" ? message.user.trim() : "";
		if (!userId) {
			return undefined;
		}
		const cached = this.senderNameCache.get(userId);
		if (cached) {
			return cached;
		}
		if (!this.app?.client?.users?.info) {
			return userId;
		}
		try {
			const result = await this.app.client.users.info({ user: userId });
			const resolved = this.firstDefinedSlackName([
				result?.user?.profile?.display_name_normalized,
				result?.user?.profile?.display_name,
				result?.user?.profile?.real_name,
				result?.user?.real_name,
				result?.user?.name,
				userId,
			]);
			if (resolved) {
				this.senderNameCache.set(userId, resolved);
				return resolved;
			}
		} catch {
			// Fall through to the stable Slack user id when profile lookup fails.
		}
		return userId;
	}

	private async resolveConversationName(message: any): Promise<string | undefined> {
		const channelType = typeof message?.channel_type === "string" ? message.channel_type.trim() : "";
		const inlineName = this.firstDefinedSlackName([
			typeof message?.channel_name === "string"
				? `#${message.channel_name.replace(/^#/, "").trim()}`
				: undefined,
		]);
		if (inlineName) {
			return inlineName;
		}

		const channelId = typeof message?.channel === "string" ? message.channel.trim() : "";
		if (!channelId) {
			return undefined;
		}
		const cached = this.conversationNameCache.get(channelId);
		if (cached) {
			return cached;
		}
		if (channelType === "im") {
			return "Direct message";
		}
		if (!this.app?.client?.conversations?.info) {
			return channelId;
		}
		try {
			const result = await this.app.client.conversations.info({ channel: channelId });
			const rawName = this.firstDefinedSlackName([
				result?.channel?.name,
				result?.channel?.user,
			]);
			const resolved = rawName
				? rawName.startsWith("#") || channelType === "im"
					? rawName
					: `#${rawName}`
				: channelId;
			this.conversationNameCache.set(channelId, resolved);
			return resolved;
		} catch {
			return channelId;
		}
	}

	private firstDefinedSlackName(values: unknown[]): string | undefined {
		for (const value of values) {
			if (typeof value !== "string") {
				continue;
			}
			const trimmed = value.trim();
			if (trimmed) {
				return trimmed;
			}
		}
		return undefined;
	}

	private async listGroups(): Promise<GroupInfo[]> {
		if (!this.app) return [];

		const result = await this.app.client.conversations.list({
			types: "public_channel,private_channel",
			limit: 100,
		});

		return (result.channels ?? []).map((ch: any) => ({
			id: ch.id,
			name: ch.name ?? ch.id,
			memberCount: ch.num_members,
		}));
	}

	private async getGroup(groupId: string): Promise<GroupInfo | null> {
		if (!this.app) return null;

		try {
			const result = await this.app.client.conversations.info({
				channel: groupId,
			});
			const ch = result.channel;
			return ch
				? {
						id: ch.id,
						name: ch.name ?? ch.id,
						memberCount: ch.num_members,
					}
				: null;
		} catch {
			return null;
		}
	}
}
