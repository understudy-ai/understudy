import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	rpcCall: vi.fn(),
	createRpcClient: vi.fn(),
}));

vi.mock("../rpc-client.js", () => ({
	createRpcClient: mocks.createRpcClient.mockImplementation(() => ({
		call: mocks.rpcCall,
	})),
}));

import { runMessageCommand } from "./message.js";

describe("runMessageCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = 0;
	});

	it("uses the canonical query option for message search", async () => {
		mocks.rpcCall
			.mockResolvedValueOnce([{ id: "session-1" }])
			.mockResolvedValueOnce({
				messages: [
					{ role: "user", text: "hello world", timestamp: 123 },
					{ role: "assistant", text: "done", timestamp: 124 },
				],
			});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runMessageCommand({
			action: "search",
			query: "hello",
			limit: "5",
		});

		expect(mocks.rpcCall).toHaveBeenNthCalledWith(1, "session.list", {});
		expect(mocks.rpcCall).toHaveBeenNthCalledWith(2, "session.history", {
			sessionId: "session-1",
			limit: 300,
		});
		expect(log.mock.calls.flat().join("\n")).toContain('Matches (1) for "hello":');
	});

	it("maps attachment sends to message.action without legacy recipient aliases", async () => {
		mocks.rpcCall.mockResolvedValue({ messageId: "msg-1" });
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runMessageCommand({
			action: "sendattachment",
			channel: "web",
			to: "user-1",
			attachment: "/tmp/report.pdf",
			attachmentType: "file",
			attachmentName: "report.pdf",
		});

		expect(mocks.rpcCall).toHaveBeenCalledWith("message.action", {
			action: "sendattachment",
			channelId: "web",
			recipientId: "user-1",
			attachmentUrl: "/tmp/report.pdf",
			attachmentType: "file",
			attachmentName: "report.pdf",
		});
		expect(log).toHaveBeenCalledWith("Attachment sent via web: msg-1");
	});

	it("rejects removed legacy action aliases", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		await runMessageCommand({
			action: "pollvote",
			channel: "web",
		} as any);

		expect(mocks.rpcCall).not.toHaveBeenCalled();
		expect(error).toHaveBeenCalledWith("Error:", "Unknown message action: pollvote");
		expect(process.exitCode).toBe(1);
	});

	it("requires an explicit action", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		await runMessageCommand({
			channel: "web",
			text: "hello",
		});

		expect(mocks.rpcCall).not.toHaveBeenCalled();
		expect(error).toHaveBeenCalledWith("Error:", "message action is required");
		expect(process.exitCode).toBe(1);
	});
});
