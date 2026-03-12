import { describe, it, expect } from "vitest";
import { inboundFromWire, outboundToWire, generateMessageId } from "../shared/message-format.js";

describe("message-format", () => {
	it("converts wire message to inbound", () => {
		const wire = {
			type: "message" as const,
			id: "telegram-msg-1",
			externalMessageId: "telegram-external-1",
			channelId: "telegram",
			senderId: "123",
			senderName: "Alice",
			conversationName: "Team Ops",
			text: "Hello",
			attachments: [{ type: "image" as const, url: "/tmp/image.jpg", name: "image.jpg" }],
			timestamp: 1700000000000,
		};

		const inbound = inboundFromWire(wire);
		expect(inbound.channelId).toBe("telegram");
		expect(inbound.senderId).toBe("123");
		expect(inbound.senderName).toBe("Alice");
		expect(inbound.conversationName).toBe("Team Ops");
		expect(inbound.externalMessageId).toBe("telegram-external-1");
		expect(inbound.text).toBe("Hello");
		expect(inbound.attachments).toEqual(wire.attachments);
		expect(inbound.timestamp).toBe(1700000000000);
	});

	it("handles missing fields in wire message", () => {
		const wire = {
			type: "message" as const,
			channelId: "web",
		};

		const inbound = inboundFromWire(wire);
		expect(inbound.senderId).toBe("unknown");
		expect(inbound.text).toBe("");
		expect(inbound.timestamp).toBeGreaterThan(0);
	});

	it("falls back to wire id when external message id is absent", () => {
		const wire = {
			type: "message" as const,
			id: "web-msg-1",
			channelId: "web",
			text: "Hello",
		};

		const inbound = inboundFromWire(wire);
		expect(inbound.externalMessageId).toBe("web-msg-1");
	});

	it("converts outbound to wire message", () => {
		const outbound = {
			channelId: "discord",
			recipientId: "456",
			text: "Reply",
			threadId: "thread1",
			attachments: [{ type: "file" as const, url: "/tmp/report.pdf", name: "report.pdf" }],
		};

		const wire = outboundToWire(outbound);
		expect(wire.type).toBe("message");
		expect(wire.channelId).toBe("discord");
		expect(wire.text).toBe("Reply");
		expect(wire.threadId).toBe("thread1");
		expect(wire.attachments).toEqual(outbound.attachments);
	});

	it("generates unique message IDs", () => {
		const id1 = generateMessageId();
		const id2 = generateMessageId();
		expect(id1).not.toBe(id2);
		expect(id1).toMatch(/^msg_/);
	});
});
