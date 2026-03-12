import { describe, expect, it } from "vitest";
import type {
	ChannelCapabilities,
	ChannelMessagingAdapter,
	InboundMessage,
	OutboundMessage,
} from "@understudy/types";
import { BaseChannel } from "../shared/channel-base.js";

class DummyChannel extends BaseChannel {
	readonly id = "dummy";
	readonly name = "Dummy";
	readonly capabilities: ChannelCapabilities = {
		streaming: false,
		threads: false,
		reactions: false,
		attachments: true,
		groups: false,
	};

	readonly messaging: ChannelMessagingAdapter;

	constructor() {
		super();
		this.messaging = this.createMessagingAdapter(async (_msg: OutboundMessage) => "dummy-message");
	}

	async start(): Promise<void> {
		this.running = true;
	}

	async stop(): Promise<void> {
		this.running = false;
	}

	dispatch(message: InboundMessage): void {
		this.emitMessage(message);
	}
}

function createInbound(overrides: Partial<InboundMessage> = {}): InboundMessage {
	return {
		channelId: "dummy",
		senderId: "sender-1",
		text: "",
		timestamp: Date.now(),
		...overrides,
	};
}

describe("BaseChannel inbound media normalization", () => {
	it("rewrites image-only inbound messages into a structured prompt", () => {
		const channel = new DummyChannel();
		const received: InboundMessage[] = [];
		channel.messaging.onMessage((message) => received.push(message));

		channel.dispatch(createInbound({
			attachments: [{ type: "image", url: "/tmp/screenshot.png", name: "screenshot.png" }],
		}));

		expect(received).toHaveLength(1);
		expect(received[0].text).toBe(
			"[Image message]\nAttachments: screenshot.png\nPlease inspect the attached image.",
		);
	});

	it("keeps user text first for captioned image messages", () => {
		const channel = new DummyChannel();
		const received: InboundMessage[] = [];
		channel.messaging.onMessage((message) => received.push(message));

		channel.dispatch(createInbound({
			text: "What does this screenshot mean?",
			attachments: [{ type: "image", url: "/tmp/error.png", name: "error.png" }],
		}));

		expect(received[0].text).toBe(
			"What does this screenshot mean?\n\n[Image message]\nAttachments: error.png\nPlease inspect the attached image.",
		);
	});

	it("preserves leading slash commands before the media section", () => {
		const channel = new DummyChannel();
		const received: InboundMessage[] = [];
		channel.messaging.onMessage((message) => received.push(message));

		channel.dispatch(createInbound({
			text: "/reset",
			attachments: [{ type: "image", url: "/tmp/reset.png", name: "reset.png" }],
		}));

		expect(received[0].text.startsWith("/reset\n\n[Image message]")).toBe(true);
	});

	it("uses a generic media header when the inbound message mixes images with other attachments", () => {
		const channel = new DummyChannel();
		const received: InboundMessage[] = [];
		channel.messaging.onMessage((message) => received.push(message));

		channel.dispatch(createInbound({
			attachments: [
				{ type: "image", url: "/tmp/shot.png", name: "shot.png" },
				{ type: "file", url: "/tmp/report.pdf", name: "report.pdf" },
			],
		}));

		expect(received[0].text).toBe(
			"[Media message]\nAttachments: shot.png, report.pdf\nPlease inspect the attached image and related media.",
		);
	});

	it("rewrites non-image attachments into a structured attachment prompt", () => {
		const channel = new DummyChannel();
		const received: InboundMessage[] = [];
		channel.messaging.onMessage((message) => received.push(message));

		channel.dispatch(createInbound({
			attachments: [{ type: "file", url: "/tmp/report.pdf", name: "report.pdf" }],
		}));

		expect(received[0].text).toBe(
			"[Attachment message]\nAttachments: report.pdf\nPlease inspect the attached file.",
		);
	});
});
