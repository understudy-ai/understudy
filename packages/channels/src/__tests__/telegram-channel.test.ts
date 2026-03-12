import { describe, expect, it, vi } from "vitest";
import { TelegramChannel } from "../telegram/telegram-channel.js";

describe("TelegramChannel", () => {
	it("formats inbound sender names from full name and username", async () => {
		const channel = new TelegramChannel({
			botToken: "telegram-test-token",
		});
		const senderName = (channel as any).resolveSenderName({
			first_name: "Alice",
			last_name: "Example",
			username: "alice",
		});

		expect(senderName).toBe("Alice Example (@alice)");
	});

	it("formats Telegram conversation names for groups and private chats", async () => {
		const channel = new TelegramChannel({
			botToken: "telegram-test-token",
		});

		expect((channel as any).resolveConversationName(
			{ type: "supergroup", title: "Team Ops" },
			{ first_name: "Alice", username: "alice" },
		)).toBe("Team Ops");
		expect((channel as any).resolveConversationName(
			{ type: "private" },
			{ first_name: "Alice", last_name: "Example", username: "alice" },
		)).toBe("Alice Example (@alice)");
	});

	it("falls back to username-only sender labels when no real name is available", async () => {
		const channel = new TelegramChannel({
			botToken: "telegram-test-token",
		});
		const senderName = (channel as any).resolveSenderName({
			username: "alice",
		});

		expect(senderName).toBe("@alice");
	});

	it("sends inline image attachments as Telegram photos", async () => {
		const channel = new TelegramChannel({
			botToken: "telegram-test-token",
		});
		const sendPhoto = vi.fn().mockResolvedValue({ message_id: 42 });
		(channel as any).bot = {
			api: {
				sendPhoto,
				sendMessage: vi.fn(),
			},
		};

		const messageId = await (channel as any).sendMessage({
			channelId: "telegram",
			recipientId: "12345",
			text: "已截图。",
			attachments: [
				{
					type: "image",
					url: "data:image/png;base64,c2NyZWVuc2hvdA==",
					name: "screenshot.png",
					mimeType: "image/png",
				},
			],
		});

		expect(messageId).toBe("42");
		expect(sendPhoto).toHaveBeenCalledTimes(1);
		expect(sendPhoto).toHaveBeenCalledWith(
			"12345",
			expect.anything(),
			expect.objectContaining({
				caption: "已截图。",
			}),
		);
	});
});
