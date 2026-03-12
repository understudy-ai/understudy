import { describe, expect, it, vi } from "vitest";
import { createMessageTool } from "../message-tool.js";
import type { ChannelAdapter, OutboundMessage } from "@understudy/types";

function createChannel(
	overrides: Partial<{
		sendImpl: (msg: OutboundMessage) => Promise<string>;
		attachments: boolean;
		editImpl: (params: {
			channelId: string;
			messageId: string;
			text: string;
			recipientId?: string;
			threadId?: string;
		}) => Promise<void>;
		deleteImpl: (params: {
			channelId: string;
			messageId: string;
			recipientId?: string;
			threadId?: string;
		}) => Promise<void>;
		reactImpl: (params: {
			channelId: string;
			messageId: string;
			emoji: string;
			recipientId?: string;
			remove?: boolean;
		}) => Promise<void>;
	}> = {},
): ChannelAdapter {
	return {
		id: "web",
		name: "Web",
		capabilities: {
			streaming: true,
			threads: false,
			reactions: true,
			attachments: overrides.attachments ?? false,
			groups: false,
		},
		messaging: {
			sendMessage: overrides.sendImpl ?? vi.fn().mockResolvedValue("msg_123"),
			editMessage: overrides.editImpl,
			deleteMessage: overrides.deleteImpl,
			reactToMessage: overrides.reactImpl,
			onMessage: () => () => {},
		},
		start: async () => {},
		stop: async () => {},
	};
}

describe("createMessageTool", () => {
	it("uses message_send as the canonical tool name", async () => {
		const tool = createMessageTool({
			getChannel: () => undefined,
		});

		expect(tool.name).toBe("message_send");
	});

	it("returns unknown channel error", async () => {
		const tool = createMessageTool({
			getChannel: () => undefined,
		});

		const result = await tool.execute("id", {
			channel: "missing",
			recipient: "u1",
			text: "hello",
		});

		expect((result.content[0] as any).text).toContain("Unknown channel");
		expect((result.details as any).error).toBe("unknown channel");
	});

	it("sends message through target channel", async () => {
		const sendMessage = vi.fn().mockResolvedValue("m-1");
		const channel = createChannel({ sendImpl: sendMessage });
		const tool = createMessageTool({
			getChannel: (id) => (id === "web" ? channel : undefined),
		});

		const result = await tool.execute("id", {
			channel: "web",
			recipient: "user_1",
			text: "hello",
			threadId: "t-1",
			replyTo: "r-1",
		});

		expect(sendMessage).toHaveBeenCalledWith({
			channelId: "web",
			recipientId: "user_1",
			text: "hello",
			threadId: "t-1",
			replyToMessageId: "r-1",
		});
		expect((result.content[0] as any).text).toContain("Message send succeeded via web");
		expect((result.details as any).messageId).toBe("m-1");
	});

	it("supports reply action", async () => {
		const sendMessage = vi.fn().mockResolvedValue("m-2");
		const channel = createChannel({ sendImpl: sendMessage });
		const tool = createMessageTool({
			getChannel: () => channel,
		});

		const result = await tool.execute("id", {
			action: "reply",
			channel: "web",
			recipient: "u1",
			text: "reply",
			replyTo: "origin-1",
		});

		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				replyToMessageId: "origin-1",
				text: "reply",
			}),
		);
		expect((result.content[0] as any).text).toContain("Message reply succeeded");
	});

	it("supports edit/delete/react actions on channels that expose action adapters", async () => {
		const editMessage = vi.fn().mockResolvedValue(undefined);
		const deleteMessage = vi.fn().mockResolvedValue(undefined);
		const reactToMessage = vi.fn().mockResolvedValue(undefined);
		const channel = createChannel({
			editImpl: editMessage,
			deleteImpl: deleteMessage,
			reactImpl: reactToMessage,
		});
		const tool = createMessageTool({ getChannel: () => channel });

		const editResult = await tool.execute("id", {
			action: "edit",
			channel: "web",
			recipient: "u1",
			messageId: "m-1",
			text: "updated",
		});
		expect(editMessage).toHaveBeenCalledWith({
			channelId: "u1",
			messageId: "m-1",
			text: "updated",
			recipientId: "u1",
			threadId: undefined,
		});
		expect((editResult.content[0] as any).text).toContain("Message edited");

		const reactResult = await tool.execute("id", {
			action: "react",
			channel: "web",
			recipient: "u1",
			messageId: "m-1",
			emoji: "👍",
		});
		expect(reactToMessage).toHaveBeenCalledWith({
			channelId: "u1",
			messageId: "m-1",
			emoji: "👍",
			recipientId: "u1",
			remove: false,
		});
		expect((reactResult.content[0] as any).text).toContain("Reaction sent");

		const deleteResult = await tool.execute("id", {
			action: "delete",
			channel: "web",
			recipient: "u1",
			messageId: "m-1",
		});
		expect(deleteMessage).toHaveBeenCalledWith({
			channelId: "u1",
			messageId: "m-1",
			recipientId: "u1",
			threadId: undefined,
		});
		expect((deleteResult.content[0] as any).text).toContain("Message deleted");
	});

	it("sends attachment payload through sendAttachment action", async () => {
		const sendMessage = vi.fn().mockResolvedValue("m-3");
		const channel = createChannel({ sendImpl: sendMessage, attachments: true });
		const tool = createMessageTool({ getChannel: () => channel });

		const result = await tool.execute("id", {
			action: "sendAttachment",
			channel: "web",
			recipient: "u1",
			text: "report",
			attachmentUrl: "https://example.com/report.pdf",
			attachmentName: "report.pdf",
			attachmentType: "file",
			attachmentMimeType: "application/pdf",
		});

		expect(sendMessage).toHaveBeenCalledWith({
			channelId: "web",
			recipientId: "u1",
			text: "report",
			threadId: undefined,
			replyToMessageId: undefined,
			attachments: [
				{
					type: "file",
					url: "https://example.com/report.pdf",
					name: "report.pdf",
					mimeType: "application/pdf",
				},
			],
		});
		expect((result.content[0] as any).text).toContain("Message sendattachment succeeded");
	});

	it("returns unsupported action errors when channel adapter lacks optional methods", async () => {
		const channel = createChannel();
		const tool = createMessageTool({ getChannel: () => channel });

		const editResult = await tool.execute("id", {
			action: "edit",
			channel: "web",
			messageId: "m-1",
			text: "updated",
		});
		expect((editResult.content[0] as any).text).toContain("does not support edit action");

		const reactResult = await tool.execute("id", {
			action: "react",
			channel: "web",
			messageId: "m-1",
			emoji: "👍",
		});
		expect((reactResult.content[0] as any).text).toContain("does not support react action");
	});

	it("returns action failure text on channel errors", async () => {
		const channel = createChannel({
			sendImpl: async () => {
				throw new Error("network down");
			},
		});
		const tool = createMessageTool({
			getChannel: () => channel,
		});

		const result = await tool.execute("id", {
			channel: "web",
			recipient: "u1",
			text: "hello",
		});

		expect((result.content[0] as any).text).toContain("Message action failed via web");
		expect((result.details as any).error).toContain("network down");
	});
});
