import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordChannel } from "../discord/discord-channel.js";
import { SlackChannel } from "../slack/slack-channel.js";

const originalUnderstudyHome = process.env.UNDERSTUDY_HOME;
let testHomeDir = "";

async function cleanupInboundMedia(channelId: "slack" | "discord"): Promise<void> {
	await rm(join(testHomeDir, "inbound-media", channelId), {
		force: true,
		recursive: true,
	});
}

beforeEach(async () => {
	testHomeDir = await mkdtemp(join(tmpdir(), "understudy-channels-"));
	process.env.UNDERSTUDY_HOME = testHomeDir;
});

describe("SlackChannel inbound attachments", () => {
	afterEach(async () => {
		vi.restoreAllMocks();
		await cleanupInboundMedia("slack");
		await rm(testHomeDir, { force: true, recursive: true });
		if (originalUnderstudyHome === undefined) {
			delete process.env.UNDERSTUDY_HOME;
		} else {
			process.env.UNDERSTUDY_HOME = originalUnderstudyHome;
		}
	});

	it("materializes file-share images and emits structured media text", async () => {
		const channel = new SlackChannel({
			botToken: "xoxb-test",
			signingSecret: "secret",
		});
		const received: any[] = [];
		channel.messaging.onMessage((message) => received.push(message));

		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				new Response(null, {
					status: 302,
					headers: { location: "https://downloads.slack-edge.com/files-pri/T1/image.png" },
				}),
			)
			.mockResolvedValueOnce(
				new Response(Buffer.from("png-bytes"), {
					status: 200,
					headers: { "content-type": "image/png" },
				}),
			);
		vi.stubGlobal("fetch", fetchMock);

		await (channel as any).handleInboundMessage({
			subtype: "file_share",
			channel: "D123",
			channel_type: "im",
			user: "U456",
			ts: "1710000000.125",
			files: [
				{
					name: "error.png",
					mimetype: "image/png",
					url_private_download: "https://files.slack.com/files-pri/T1-F123/error.png",
				},
			],
		});

		expect(received).toHaveLength(1);
		expect(received[0].externalMessageId).toBe("1710000000.125");
		expect(received[0].conversationType).toBe("direct");
			expect(received[0].text).toContain("[Image message]");
			expect(received[0].text).toContain("Attachments: error.png");
			expect(received[0].attachments).toHaveLength(1);
			expect(received[0].attachments[0].type).toBe("image");
			expect(received[0].attachments[0].url).toContain(join(testHomeDir, "inbound-media", "slack"));
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
			headers: {
				authorization: "Bearer xoxb-test",
			},
			redirect: "manual",
		});
			expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
				redirect: "manual",
			});
		expect(fetchMock.mock.calls[1]?.[1]?.headers).toBeUndefined();
		});

	it("enforces optional Slack allowlists before emitting inbound messages", async () => {
		const channel = new SlackChannel({
			botToken: "xoxb-test",
			signingSecret: "secret",
			allowedChannelIds: ["D123"],
			allowedUserIds: ["U456"],
		});
		const received: any[] = [];
		channel.messaging.onMessage((message) => received.push(message));

		await (channel as any).handleInboundMessage({
			channel: "D999",
			channel_type: "im",
			user: "U456",
			ts: "1710000000.125",
			text: "hello",
		});
		await (channel as any).handleInboundMessage({
			channel: "D123",
			channel_type: "im",
			user: "U999",
			ts: "1710000000.126",
			text: "hello",
		});
		await (channel as any).handleInboundMessage({
			channel: "D123",
			channel_type: "im",
			user: "U456",
			ts: "1710000000.127",
			text: "hello",
		});

		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({
			channelId: "slack",
			senderId: "D123",
			senderName: "U456",
			text: "hello",
		});
	});

	it("resolves and caches Slack sender display names when user lookups are available", async () => {
		const channel = new SlackChannel({
			botToken: "xoxb-test",
			signingSecret: "secret",
		});
		const usersInfo = vi.fn().mockResolvedValue({
			user: {
				profile: {
					display_name: "Alice Example",
				},
			},
		});
		(channel as any).app = {
			client: {
				conversations: {
					info: vi.fn().mockResolvedValue({
						channel: {
							name: "ops",
						},
					}),
				},
				users: {
					info: usersInfo,
				},
			},
		};
		const received: any[] = [];
		channel.messaging.onMessage((message) => received.push(message));

		await (channel as any).handleInboundMessage({
			channel: "C123",
			channel_type: "channel",
			user: "U456",
			ts: "1710000000.200",
			text: "hello",
		});
		await (channel as any).handleInboundMessage({
			channel: "C123",
			channel_type: "channel",
			user: "U456",
			ts: "1710000000.201",
			text: "hello again",
		});

		expect(received).toHaveLength(2);
		expect(received[0].senderName).toBe("Alice Example");
		expect(received[0].conversationName).toBe("#ops");
		expect(received[1].senderName).toBe("Alice Example");
		expect(received[1].conversationName).toBe("#ops");
		expect(usersInfo).toHaveBeenCalledTimes(1);
		expect(usersInfo).toHaveBeenCalledWith({ user: "U456" });
		expect((channel as any).app.client.conversations.info).toHaveBeenCalledTimes(1);
		expect((channel as any).app.client.conversations.info).toHaveBeenCalledWith({ channel: "C123" });
	});

	it("uploads outbound image attachments as Slack files", async () => {
		const channel = new SlackChannel({
			botToken: "xoxb-test",
			signingSecret: "secret",
		});
		const uploadV2 = vi.fn().mockResolvedValue({
			files: [{
				id: "F123",
				shares: {
					public: {
						C123: [{ ts: "1710000000.321" }],
					},
				},
			}],
		});
		(channel as any).app = {
			client: {
				chat: {
					postMessage: vi.fn(),
				},
				files: {
					uploadV2,
				},
			},
		};

		const messageId = await (channel as any).sendMessage({
			channelId: "slack",
			recipientId: "C123",
			threadId: "1710000000.001",
			text: "已截图。",
			attachments: [
				{
					type: "image",
					url: "data:image/png;base64,c2NyZWVuc2hvdA==",
					name: "screen.png",
					mimeType: "image/png",
				},
			],
		});

		expect(messageId).toBe("1710000000.321");
		expect(uploadV2).toHaveBeenCalledWith(expect.objectContaining({
			channel_id: "C123",
			thread_ts: "1710000000.001",
			initial_comment: "已截图。",
			file_uploads: [
				expect.objectContaining({
					filename: "screen.png",
					title: "screen.png",
					file: Buffer.from("screenshot"),
				}),
			],
		}));
	});

	it("uses replyToMessageId as the Slack thread root when no explicit threadId is set", async () => {
		const postMessage = vi.fn().mockResolvedValue({ ts: "1710000000.654" });
		const channel = new SlackChannel({
			botToken: "xoxb-test",
			signingSecret: "secret",
		});
		(channel as any).app = {
			client: {
				chat: {
					postMessage,
				},
				files: {
					uploadV2: vi.fn(),
				},
			},
		};

		const messageId = await (channel as any).sendMessage({
			channelId: "slack",
			recipientId: "C123",
			replyToMessageId: "1710000000.500",
			text: "reply in thread",
		});

		expect(messageId).toBe("1710000000.654");
		expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
			channel: "C123",
			text: "reply in thread",
			thread_ts: "1710000000.500",
		}));
	});
});

describe("DiscordChannel inbound attachments", () => {
	afterEach(async () => {
		vi.restoreAllMocks();
		await cleanupInboundMedia("discord");
		await rm(testHomeDir, { force: true, recursive: true });
		if (originalUnderstudyHome === undefined) {
			delete process.env.UNDERSTUDY_HOME;
		} else {
			process.env.UNDERSTUDY_HOME = originalUnderstudyHome;
		}
	});

	it("materializes attachments and preserves the message content ahead of media hints", async () => {
		const channel = new DiscordChannel({ botToken: "discord-token" });
		const received: any[] = [];
		channel.messaging.onMessage((message) => received.push(message));

		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(Buffer.from("png-bytes"), {
				status: 200,
				headers: { "content-type": "image/png" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		await (channel as any).handleInboundMessage({
			id: "discord-msg-1",
			content: "/review this screenshot",
			channel: {
				id: "DM123",
				isThread: () => false,
				isDMBased: () => true,
			},
			author: {
				bot: false,
				username: "Alice",
			},
			reference: {
				messageId: "discord-msg-0",
			},
			attachments: new Map([
				[
					"att-1",
					{
						id: "att-1",
						name: "screenshot.png",
						contentType: "image/png",
						url: "https://cdn.discordapp.com/attachments/1/screenshot.png",
					},
				],
			]),
			createdTimestamp: 1710000000123,
		});

		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({
			channelId: "discord",
			senderId: "DM123",
			senderName: "Alice",
			conversationType: "direct",
			externalMessageId: "discord-msg-1",
			replyToMessageId: "discord-msg-0",
		});
		expect(received[0].text).toContain("/review this screenshot");
			expect(received[0].text).toContain("[Image message]");
			expect(received[0].text).toContain("Attachments: screenshot.png");
			expect(received[0].attachments).toHaveLength(1);
			expect(received[0].attachments[0].type).toBe("image");
			expect(received[0].attachments[0].url).toContain(join(testHomeDir, "inbound-media", "discord"));
			expect(fetchMock).toHaveBeenCalledWith(
				"https://cdn.discordapp.com/attachments/1/screenshot.png",
			);
		});

	it("sends outbound attachments as Discord files", async () => {
		const send = vi.fn().mockResolvedValue({ id: "discord-out-1" });
		const fetchChannel = vi.fn().mockResolvedValue({
			isTextBased: () => true,
			send,
		});
		const channel = new DiscordChannel({ botToken: "discord-token" });
		(channel as any).client = {
			channels: {
				fetch: fetchChannel,
			},
		};

		const messageId = await (channel as any).sendMessage({
			channelId: "discord",
			recipientId: "DM123",
			replyToMessageId: "discord-msg-0",
			text: "已截图。",
			attachments: [
				{
					type: "image",
					url: "data:image/png;base64,c2NyZWVuc2hvdA==",
					name: "screen.png",
					mimeType: "image/png",
				},
			],
		});

		expect(messageId).toBe("discord-out-1");
		expect(fetchChannel).toHaveBeenCalledWith("DM123");
		expect(send).toHaveBeenCalledWith(expect.objectContaining({
			content: "已截图。",
			reply: {
				messageReference: "discord-msg-0",
			},
			files: [
				expect.objectContaining({
					name: "screen.png",
					attachment: Buffer.from("screenshot"),
				}),
			],
		}));
	});
});
