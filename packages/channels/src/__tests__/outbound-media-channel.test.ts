import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	execFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execFile: mocks.execFile,
}));

import { IMessageChannel } from "../imessage/imessage-channel.js";
import { LineChannel } from "../line/line-channel.js";
import { SignalChannel } from "../signal/signal-channel.js";
import { WhatsAppChannel } from "../whatsapp/whatsapp-channel.js";

const originalUnderstudyHome = process.env.UNDERSTUDY_HOME;

let testHomeDir = "";

function installExecFileSuccessMock(): void {
	mocks.execFile.mockImplementation((...args: any[]) => {
		const callback = typeof args[2] === "function" ? args[2] : args[3];
		callback?.(null, "", "");
		return {} as any;
	});
}

beforeEach(async () => {
	testHomeDir = await mkdtemp(join(tmpdir(), "understudy-outbound-"));
	process.env.UNDERSTUDY_HOME = testHomeDir;
	vi.clearAllMocks();
	installExecFileSuccessMock();
});

afterEach(async () => {
	vi.unstubAllGlobals();
	await rm(testHomeDir, { force: true, recursive: true });
	if (originalUnderstudyHome === undefined) {
		delete process.env.UNDERSTUDY_HOME;
	} else {
		process.env.UNDERSTUDY_HOME = originalUnderstudyHome;
	}
});

describe("SignalChannel outbound media", () => {
	it("materializes inline attachments to temp files before invoking signal-cli", async () => {
		const channel = new SignalChannel({
			sender: "+15550001111",
			cliPath: "signal-cli",
		});
		(channel as any).running = true;

		await (channel as any).sendMessage({
			channelId: "signal",
			recipientId: "+15550002222",
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

		expect(mocks.execFile).toHaveBeenCalledTimes(1);
		const [file, args] = mocks.execFile.mock.calls[0] ?? [];
		expect(file).toBe("signal-cli");
		expect(args).toEqual(expect.arrayContaining(["-u", "+15550001111", "send", "-m", "已截图。", "+15550002222"]));
		const filePath = (args as string[])[(args as string[]).indexOf("-a") + 1];
		expect(filePath).toContain(join(testHomeDir, "outbound-media", "signal"));
		await expect(stat(filePath)).rejects.toBeDefined();
	});
});

describe("IMessageChannel outbound media", () => {
	it("sends attachments as POSIX files instead of leaking inline data URLs", async () => {
		const channel = new IMessageChannel({
			serviceName: "iMessage",
		});
		(channel as any).running = true;

		await (channel as any).sendMessage({
			channelId: "imessage",
			recipientId: "+15550003333",
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

		expect(mocks.execFile).toHaveBeenCalledTimes(1);
		const [file, args] = mocks.execFile.mock.calls[0] ?? [];
		expect(file).toBe("osascript");
		expect(args).toMatchObject(["-l", "AppleScript", "-e", expect.any(String)]);
		const script = String((args as string[])[3] ?? "");
		expect(script).toContain('send "已截图。" to targetBuddy');
		expect(script).not.toContain("data:image/png;base64");
		const match = script.match(/POSIX file "([^"]+)"/);
		expect(match?.[1]).toContain(join(testHomeDir, "outbound-media", "imessage"));
		await expect(stat(match?.[1] ?? "")).rejects.toBeDefined();
	});
});

describe("WhatsAppChannel outbound media", () => {
	it("sends every attachment instead of truncating to the first one", async () => {
		const sendMessage = vi
			.fn()
			.mockResolvedValueOnce({ key: { id: "wa-1" } })
			.mockResolvedValueOnce({ key: { id: "wa-2" } });
		const channel = new WhatsAppChannel();
		(channel as any).socket = { sendMessage };

		const messageId = await (channel as any).sendMessage({
			channelId: "whatsapp",
			recipientId: "+15550004444",
			text: "已截图。",
			attachments: [
				{
					type: "image",
					url: "data:image/png;base64,c2NyZWVuc2hvdA==",
					name: "screen-1.png",
					mimeType: "image/png",
				},
				{
					type: "image",
					url: "data:image/png;base64,c2NyZWVuc2hvdA==",
					name: "screen-2.png",
					mimeType: "image/png",
				},
			],
		});

		expect(messageId).toBe("wa-1");
		expect(sendMessage).toHaveBeenCalledTimes(2);
		expect(sendMessage).toHaveBeenNthCalledWith(
			1,
			"+15550004444@s.whatsapp.net",
			expect.objectContaining({
				image: Buffer.from("screenshot"),
				caption: "已截图。",
			}),
		);
		expect(sendMessage).toHaveBeenNthCalledWith(
			2,
			"+15550004444@s.whatsapp.net",
			expect.objectContaining({
				image: Buffer.from("screenshot"),
				caption: undefined,
			}),
		);
	});
});

describe("LineChannel outbound media", () => {
	it("downgrades inline image attachments to a concise note instead of sending the data URL as text", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(null, {
				status: 200,
				headers: { "x-line-request-id": "line-1" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const channel = new LineChannel({
			channelAccessToken: "line-token",
		});
		(channel as any).running = true;

		const messageId = await (channel as any).sendMessage({
			channelId: "line",
			recipientId: "U123",
			text: "",
			attachments: [
				{
					type: "image",
					url: "data:image/png;base64,c2NyZWVuc2hvdA==",
					name: "screen.png",
					mimeType: "image/png",
				},
			],
		});

		expect(messageId).toBe("line-1");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}"));
		expect(body.messages).toEqual([
			expect.objectContaining({
				type: "text",
				text: expect.stringContaining("public HTTPS URL"),
			}),
		]);
		expect(JSON.stringify(body.messages)).not.toContain("data:image/png;base64");
	});

	it("passes through public HTTPS image attachments as LINE image messages", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(null, {
				status: 200,
				headers: { "x-line-request-id": "line-2" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const channel = new LineChannel({
			channelAccessToken: "line-token",
		});
		(channel as any).running = true;

		await (channel as any).sendMessage({
			channelId: "line",
			recipientId: "U123",
			text: "已截图。",
			attachments: [
				{
					type: "image",
					url: "https://example.com/screen.png",
					name: "screen.png",
					mimeType: "image/png",
				},
			],
		});

		const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}"));
		expect(body.messages).toEqual([
			{
				type: "text",
				text: "已截图。",
			},
			{
				type: "image",
				originalContentUrl: "https://example.com/screen.png",
				previewImageUrl: "https://example.com/screen.png",
			},
		]);
	});
});
