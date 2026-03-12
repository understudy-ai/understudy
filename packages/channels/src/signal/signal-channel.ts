/**
 * Signal channel adapter using signal-cli for outbound messaging.
 *
 * This adapter currently supports outbound sends only. Inbound message
 * monitoring can be added later via signal-cli receive mode.
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

export interface SignalChannelOptions {
	sender: string;
	cliPath?: string;
	timeoutMs?: number;
}

export class SignalChannel extends BaseChannel {
	readonly id = "signal";
	readonly name = "Signal";
	readonly capabilities: ChannelCapabilities = {
		streaming: false,
		threads: false,
		reactions: false,
		attachments: true,
		groups: true,
	};

	readonly messaging: ChannelMessagingAdapter;
	private readonly options: SignalChannelOptions;

	constructor(options: SignalChannelOptions) {
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
			throw new Error("Signal channel is not started");
		}
		const text = msg.text.trim();
		const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
		if (!text && attachments.length === 0) {
			throw new Error("signal send requires text or attachments");
		}

		const materialized = await Promise.all(
			attachments.map((attachment) => materializeOutboundAttachment(attachment, { channelId: this.id })),
		);
		const args: string[] = ["-u", this.options.sender, "send"];
		try {
			if (text) {
				args.push("-m", text);
			}

			for (const attachment of materialized) {
				args.push("-a", attachment.filePath);
			}
			args.push(msg.recipientId);

			await execFileAsync(this.options.cliPath ?? "signal-cli", args, {
				timeout: this.options.timeoutMs ?? 30_000,
				maxBuffer: 1024 * 1024,
			});
		} finally {
			await Promise.all(materialized.map((attachment) => attachment.cleanup?.()));
		}

		return generateMessageId();
	}
}
