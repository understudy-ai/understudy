import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentsListTool } from "../bridge/agents-list-tool.js";
import { createGatewayTool } from "../bridge/gateway-tool.js";
import { createSessionsSpawnTool } from "../bridge/sessions-spawn-tool.js";
import { createSubagentsTool } from "../bridge/subagents-tool.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
	if (originalFetch) {
		globalThis.fetch = originalFetch;
	}
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function mockRpc(handler: (method: string, params: Record<string, unknown>) => unknown): void {
	globalThis.fetch = vi.fn(async (_url, init) => {
		const payload = JSON.parse(String(init?.body ?? "{}")) as {
			method: string;
			params: Record<string, unknown>;
		};
		return {
			ok: true,
			text: async () => JSON.stringify({ result: handler(payload.method, payload.params) }),
		} as any;
	}) as any;
}

describe("gateway bridge tools", () => {
	it("agents_list maps to agents.list", async () => {
		let called = "";
		mockRpc((method) => {
			called = method;
			return {
				agents: [{ id: "main", name: "Main" }],
			};
		});

		const result = await createAgentsListTool().execute("id", {});
		expect(called).toBe("agents.list");
		expect((result.content[0] as any).text).toContain("main");
	});

	it("gateway restart maps to config.reload", async () => {
		let called = "";
		mockRpc((method) => {
			called = method;
			return { ok: true };
		});

		await createGatewayTool().execute("id", { action: "restart", reason: "test" });
		expect(called).toBe("config.reload");
	});

	it("sessions_spawn maps to sessions.spawn", async () => {
		let called = "";
		let sent: Record<string, unknown> = {};
		mockRpc((method, params) => {
			called = method;
			sent = params;
			return {
				sessionId: "spawned-1",
				childSessionId: "spawned-1",
				status: "in_flight",
			};
		});

		const result = await createSessionsSpawnTool().execute("id", {
			task: "do work",
			attachments: [
				{
					type: "file",
					url: "/tmp/spec.md",
					name: "spec.md",
					mimeType: "text/markdown",
				},
			],
		});

		expect(called).toBe("sessions.spawn");
		expect(sent.task).toBe("do work");
		expect(sent.attachments).toEqual([
			{
				type: "file",
				url: "/tmp/spec.md",
				name: "spec.md",
				mimeType: "text/markdown",
			},
		]);
		expect((result.content[0] as any).text).toContain("spawned-1");
	});

	it("sessions_spawn rejects unsupported delivery-style params instead of silently dropping them", async () => {
		const result = await createSessionsSpawnTool().execute("id", {
			task: "do work",
			threadId: "topic-1",
		} as any);

		expect((result.content[0] as any).text).toContain('does not support "threadId"');
	});

	it("sessions_spawn keeps the runtime gateway URL when params guess a different one", async () => {
		let calledUrl = "";
		globalThis.fetch = vi.fn(async (url, init) => {
			calledUrl = String(url);
			const payload = JSON.parse(String(init?.body ?? "{}")) as {
				method: string;
				params: Record<string, unknown>;
			};
			expect(payload.method).toBe("sessions.spawn");
			return {
				ok: true,
				text: async () =>
					JSON.stringify({
						result: {
							sessionId: "spawned-1",
							childSessionId: "spawned-1",
							status: "in_flight",
						},
					}),
			} as any;
		}) as any;

		await createSessionsSpawnTool({ gatewayUrl: "http://127.0.0.1:18889" }).execute("id", {
			task: "do work",
			gatewayUrl: "http://127.0.0.1:23333",
		});

		expect(calledUrl).toBe("http://127.0.0.1:18889/rpc");
	});

	it("sessions_spawn defaults to a longer timeout for real child work", async () => {
		let timeoutMs = 0;
		vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
			timeoutMs = ms;
			return new AbortController().signal;
		});
		globalThis.fetch = vi.fn(
			async () => ({
				ok: true,
				text: async () =>
					JSON.stringify({
						result: {
							sessionId: "spawned-1",
							childSessionId: "spawned-1",
							status: "in_flight",
						},
					}),
			}),
		) as any;

		await createSessionsSpawnTool().execute("id", { task: "do work" });

		expect(timeoutMs).toBe(120_000);
	});

	it("subagents kill maps to subagents", async () => {
		let called = "";
		mockRpc((method, params) => {
			called = method;
			expect(params.action).toBe("kill");
			return { aborted: true, childSessionId: "s1" };
		});

		await createSubagentsTool().execute("id", {
			action: "kill",
			target: "s1",
		});
		expect(called).toBe("subagents");
	});

	it("subagents list shows live child progress in the text output", async () => {
		mockRpc((method, params) => {
			expect(method).toBe("subagents");
			expect(params.action).toBe("list");
			return {
				subagents: [
					{
						sessionId: "s1",
						label: "research",
						latestRunStatus: "in_flight",
						activeRun: {
							status: "in_flight",
							summary: "Opening the App Store page.",
							assistantText: "I am checking the target listing now.",
							steps: [
								{ kind: "tool", toolName: "browser.snapshot", state: "running", title: "Capture page" },
							],
						},
					},
				],
			};
		});

		const result = await createSubagentsTool().execute("id", {
			action: "list",
		});

		const text = (result.content[0] as any).text as string;
		expect(text).toContain("s1 [research] status=in_flight");
		expect(text).toContain("progress: Opening the App Store page.");
		expect(text).toContain("reply: I am checking the target listing now.");
		expect(text).toContain("tool/running: Capture page - browser.snapshot");
	});

	it("sessions_spawn prefers a native spawn handler when available", async () => {
		const spawnHandler = vi.fn(async () => ({
			childSessionId: "native-1",
			sessionId: "native-1",
			runId: "run-1",
			status: "in_flight",
		}));

		const result = await createSessionsSpawnTool({
			requesterSessionId: "parent-1",
			spawnHandler,
		}).execute("id", {
			task: "delegate",
			mode: "session",
		});

		expect(spawnHandler).toHaveBeenCalledWith(
			expect.objectContaining({
				parentSessionId: "parent-1",
				task: "delegate",
				mode: "session",
			}),
		);
		expect((result.content[0] as any).text).toContain("native-1");
	});

	it("sessions_spawn forwards validated thinking overrides through the native spawn handler", async () => {
		const spawnHandler = vi.fn(async () => ({
			childSessionId: "native-1",
			sessionId: "native-1",
			runId: "run-1",
			status: "in_flight",
		}));

		await createSessionsSpawnTool({
			requesterSessionId: "parent-1",
			spawnHandler,
		}).execute("id", {
			task: "delegate",
			thinking: "high",
			attachments: [
				{
					type: "image",
					url: "/tmp/screenshot.png",
					name: "screenshot.png",
					mimeType: "image/png",
				},
			],
		});

		expect(spawnHandler).toHaveBeenCalledWith(
			expect.objectContaining({
				parentSessionId: "parent-1",
				task: "delegate",
				thinking: "high",
				attachments: [
					{
						type: "image",
						url: "/tmp/screenshot.png",
						name: "screenshot.png",
						mimeType: "image/png",
					},
				],
			}),
		);
	});

	it("subagents wait prefers a native handler when available", async () => {
		const subagentsHandler = vi.fn(async () => ({
			status: "ok",
			childSessionId: "native-1",
			response: "done",
		}));

		const result = await createSubagentsTool({
			requesterSessionId: "parent-1",
			subagentsHandler,
		}).execute("id", {
			action: "wait",
			target: "native-1",
		});

		expect(subagentsHandler).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "wait",
				parentSessionId: "parent-1",
				target: "native-1",
			}),
		);
		expect((result.content[0] as any).text).toContain("\"status\": \"ok\"");
	});

	it("subagents wait retries remote fetch failures and resumes polling until completion", async () => {
		const calls: Array<{ timeoutMs?: number }> = [];
		let attempt = 0;
		globalThis.fetch = vi.fn(async (_url, init) => {
			const payload = JSON.parse(String(init?.body ?? "{}")) as {
				method: string;
				params: Record<string, unknown>;
			};
			expect(payload.method).toBe("subagents");
			calls.push({ timeoutMs: payload.params.timeoutMs as number | undefined });
			attempt += 1;
			if (attempt === 1) {
				throw new Error("fetch failed");
			}
			if (attempt === 2) {
				return {
					ok: true,
					text: async () => JSON.stringify({ result: { status: "timeout", childSessionId: "remote-1" } }),
				} as any;
			}
			return {
				ok: true,
				text: async () => JSON.stringify({ result: { status: "ok", childSessionId: "remote-1", response: "done" } }),
			} as any;
		}) as any;

		const result = await createSubagentsTool({
			gatewayUrl: "http://127.0.0.1:23333",
			requesterSessionId: "parent-1",
		}).execute("id", {
			action: "wait",
			target: "remote-1",
			timeoutMs: 40_000,
		});

		expect(globalThis.fetch).toHaveBeenCalledTimes(3);
		expect(calls.every((call) => typeof call.timeoutMs === "number" && call.timeoutMs! <= 15_000)).toBe(true);
		expect((result.content[0] as any).text).toContain("\"status\": \"ok\"");
		expect((result.content[0] as any).text).toContain("\"response\": \"done\"");
	});

	it("handles gateway HTTP error gracefully", async () => {
		globalThis.fetch = vi.fn(async () => ({
			ok: false,
			status: 502,
			text: async () => JSON.stringify({ error: { message: "Bad Gateway" } }),
		})) as any;

		const result = await createAgentsListTool().execute("id", {});
		expect((result.content[0] as any).text).toContain("Bad Gateway");
	});

	it("handles gateway RPC error payload gracefully", async () => {
		globalThis.fetch = vi.fn(async () => ({
			ok: true,
			text: async () => JSON.stringify({ error: { code: 404, message: "Not found" } }),
		})) as any;

		const result = await createAgentsListTool().execute("id", {});
		expect((result.content[0] as any).text).toContain("Not found");
	});
});
