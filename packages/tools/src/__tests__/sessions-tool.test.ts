import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createSessionStatusTool,
	createSessionsHistoryTool,
	createSessionsListTool,
	createSessionsSendTool,
} from "../sessions-tool.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
	if (originalFetch) {
		globalThis.fetch = originalFetch;
	}
	vi.useRealTimers();
	vi.restoreAllMocks();
});

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-03-09T15:23:00.000Z"));
});

describe("sessions tools", () => {
	it("lists sessions via gateway RPC", async () => {
		globalThis.fetch = vi.fn(async () => ({
			ok: true,
			text: async () => JSON.stringify({
				result: [
					{ id: "s1", channelId: "web", senderId: "u1", messageCount: 2 },
				],
			}),
		})) as any;

		const tool = createSessionsListTool();
		const result = await tool.execute("id", {});
		expect((result.content[0] as any).text).toContain("Sessions:");
		expect((result.content[0] as any).text).toContain("s1");
	});

	it("returns history lines for session", async () => {
		globalThis.fetch = vi.fn(async () => ({
			ok: true,
			text: async () => JSON.stringify({
				result: {
					sessionId: "s1",
					messages: [
						{ role: "user", text: "hello" },
						{ role: "assistant", text: "hi" },
					],
				},
			}),
		})) as any;

		const tool = createSessionsHistoryTool();
		const result = await tool.execute("id", { sessionId: "s1" });
		expect((result.content[0] as any).text).toContain("History (s1)");
		expect((result.content[0] as any).text).toContain("assistant: hi");
	});

	it("returns session_status for an explicit sessionId", async () => {
		const originalTZ = process.env.TZ;
		process.env.TZ = "Asia/Hong_Kong";
		vi.useFakeTimers();
		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				text: async () => JSON.stringify({
					result: { id: "s2", channelId: "web", senderId: "u2", messageCount: 7 },
				}),
			}) as any;

		const tool = createSessionStatusTool();
		const result = await tool.execute("id", { sessionId: "s2" });
		expect((result.content[0] as any).text).toContain("Session: s2");
		expect((result.content[0] as any).text).toContain("Messages: 7");
		expect((result.content[0] as any).text).toContain("Time: Monday, March 9, 2026");
		expect((result.content[0] as any).text).toContain("(Asia/Hong_Kong)");
		if (originalTZ === undefined) {
			delete process.env.TZ;
		} else {
			process.env.TZ = originalTZ;
		}
	});

	it("requires sessionId for session_status", async () => {
		const tool = createSessionStatusTool();
		const result = await tool.execute("id", {} as any);
		expect((result.content[0] as any).text).toContain("sessionId is required");
	});

	it("sends messages to session via sessions_send", async () => {
		globalThis.fetch = vi.fn(async () => ({
			ok: true,
			text: async () => JSON.stringify({
				result: { sessionId: "s1", response: "pong" },
			}),
		})) as any;

		const tool = createSessionsSendTool();
		const result = await tool.execute("id", {
			sessionId: "s1",
			message: "ping",
		});
		expect((result.content[0] as any).text).toContain("sessions_send(s1) response");
		expect((result.content[0] as any).text).toContain("pong");
	});

	it("requires sessionId for sessions_send", async () => {
		const tool = createSessionsSendTool();
		const result = await tool.execute("id", { message: "ping" } as any);
		expect((result.content[0] as any).text).toContain("sessionId is required");
	});

	it("handles gateway rpc failures", async () => {
		globalThis.fetch = vi.fn(async () => ({
			ok: true,
			text: async () => JSON.stringify({
				error: { message: "boom" },
			}),
		})) as any;

		const tool = createSessionsListTool();
		const result = await tool.execute("id", {});
		expect((result.content[0] as any).text).toContain("Failed to list sessions");
	});
});
