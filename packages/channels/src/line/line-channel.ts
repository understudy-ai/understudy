/**
 * LINE channel adapter using LINE Messaging API push endpoint.
 *
 * This adapter currently supports outbound sends only.
 */

import type {
	Attachment,
	ChannelCapabilities,
	ChannelMessagingAdapter,
	OutboundMessage,
} from "@understudy/types";
import { generateMessageId } from "../shared/message-format.js";
import { isPublicHttpsAttachmentUrl } from "../shared/outbound-media.js";
import { BaseChannel } from "../shared/channel-base.js";

export interface LineChannelOptions {
	channelAccessToken: string;
	apiBaseUrl?: string;
}

export class LineChannel extends BaseChannel {
	readonly id = "line";
	readonly name = "LINE";
	readonly capabilities: ChannelCapabilities = {
		streaming: false,
		threads: false,
		reactions: false,
		attachments: true,
		groups: true,
	};

	readonly messaging: ChannelMessagingAdapter;
	private readonly options: LineChannelOptions;

	constructor(options: LineChannelOptions) {
		super();
		this.options = options;
		this.messaging = this.createMessagingAdapter(this.sendMessage.bind(this));
	}

	async start(): Promise<void> {
		if (this.running) return;
		this.running = true;
	}

	async stop(): Promise<void> {
		this.running = false;
	}

	private async sendMessage(msg: OutboundMessage): Promise<string> {
		if (!this.running) {
			throw new Error("LINE channel is not started");
		}

		const messages = this.buildOutboundMessages(msg);
		if (messages.length === 0) {
			throw new Error("line send requires text or attachments");
		}

		const response = await fetch(
			`${this.options.apiBaseUrl ?? "https://api.line.me"}/v2/bot/message/push`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${this.options.channelAccessToken}`,
				},
					body: JSON.stringify({
						to: msg.recipientId,
						messages,
					}),
				},
			);
		if (!response.ok) {
			const detail = await response.text();
			throw new Error(`LINE push failed (${response.status}): ${detail}`);
		}

		return response.headers.get("x-line-request-id") ?? generateMessageId();
	}

	private buildOutboundMessages(msg: OutboundMessage): Array<Record<string, unknown>> {
		const messages: Array<Record<string, unknown>> = [];
		const text = msg.text.trim();
		const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
		if (text) {
			messages.push({ type: "text", text });
		}
		const unsupported: Attachment[] = [];
		for (const attachment of attachments) {
			if (attachment.type === "image" && isPublicHttpsAttachmentUrl(attachment)) {
				messages.push({
					type: "image",
					originalContentUrl: attachment.url,
					previewImageUrl: attachment.url,
				});
				continue;
			}
			unsupported.push(attachment);
		}
		if (unsupported.length > 0) {
			const labels = unsupported
				.slice(0, 3)
				.map((attachment) => attachment.name?.trim() || attachment.type)
				.filter(Boolean)
				.join(", ");
			const suffix = unsupported.length > 3 ? ", ..." : "";
			const note = unsupported.some((attachment) => !isPublicHttpsAttachmentUrl(attachment))
				? "Attachment omitted: LINE outbound media requires a public HTTPS URL."
				: "Attachment omitted: LINE push currently supports image URLs only.";
			messages.push({
				type: "text",
				text: labels ? `${note} (${labels}${suffix})` : note,
			});
		}
		return messages.slice(0, 5);
	}
}
