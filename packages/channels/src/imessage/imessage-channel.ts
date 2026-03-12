/**
 * iMessage channel adapter using AppleScript (macOS only) for outbound sends.
 *
 * This adapter currently supports outbound sends only.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
	ChannelCapabilities,
	ChannelMessagingAdapter,
	OutboundMessage,
} from "@understudy/types";
import { generateMessageId } from "../shared/message-format.js";
import { materializeOutboundAttachment } from "../shared/outbound-media.js";
import { BaseChannel } from "../shared/channel-base.js";

const execFileAsync = promisify(execFile);

export interface IMessageChannelOptions {
	serviceName?: string;
}

function escapeAppleScriptText(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, "\\\"")
		.replace(/[\r\n]/g, " ")
		.replaceAll("\u0000", " ");
}

export class IMessageChannel extends BaseChannel {
	readonly id = "imessage";
	readonly name = "iMessage";
	readonly capabilities: ChannelCapabilities = {
		streaming: false,
		threads: false,
		reactions: false,
		attachments: true,
		groups: false,
	};

	readonly messaging: ChannelMessagingAdapter;
	private readonly options: IMessageChannelOptions;

	constructor(options: IMessageChannelOptions = {}) {
		super();
		this.options = options;
		this.messaging = this.createMessagingAdapter(this.sendMessage.bind(this));
	}

	async start(): Promise<void> {
		if (process.platform !== "darwin") {
			throw new Error("iMessage channel is only supported on macOS");
		}
		this.running = true;
	}

	async stop(): Promise<void> {
		this.running = false;
	}

	private async sendMessage(msg: OutboundMessage): Promise<string> {
		if (!this.running) {
			throw new Error("iMessage channel is not started");
		}
		const text = msg.text.trim();
		const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
		if (!text && attachments.length === 0) {
			throw new Error("imessage send requires text or attachments");
		}
		const materialized = await Promise.all(
			attachments.map((attachment) => materializeOutboundAttachment(attachment, { channelId: this.id })),
		);
		const escapedRecipient = escapeAppleScriptText(msg.recipientId);
		const escapedService = escapeAppleScriptText(this.options.serviceName ?? "iMessage");
		const scriptLines = [
			'tell application "Messages"',
			`set targetService to service "${escapedService}"`,
			`set targetBuddy to buddy "${escapedRecipient}" of targetService`,
			...(text ? [`send "${escapeAppleScriptText(text)}" to targetBuddy`] : []),
			...materialized.map((attachment) =>
				`send (POSIX file "${escapeAppleScriptText(attachment.filePath)}") to targetBuddy`
			),
			"end tell",
		];
		try {
			await execFileAsync("osascript", ["-l", "AppleScript", "-e", scriptLines.join("\n")], {
				timeout: 30_000,
				maxBuffer: 1024 * 1024,
			});
		} finally {
			await Promise.all(materialized.map((attachment) => attachment.cleanup?.()));
		}

		return generateMessageId();
	}
}
