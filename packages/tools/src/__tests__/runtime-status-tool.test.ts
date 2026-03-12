import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntimeStatusTool } from "../runtime-status-tool.js";

describe("runtime_status tool", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-09T15:23:00.000Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("reports current runtime context without gateway session tools", async () => {
		const tool = createRuntimeStatusTool({
			cwd: "/tmp/workspace",
			config: {
				defaultProvider: "anthropic",
				defaultModel: "claude-sonnet-4-6",
				defaultThinkingLevel: "off",
				agent: {
					userTimezone: "Asia/Hong_Kong",
				},
				channels: {},
				tools: {
					policies: [],
					autoApproveReadOnly: true,
				},
				memory: {
					enabled: false,
				},
			} as any,
			channel: "tui",
		});

		const result = await tool.execute("id", {});
		const text = (result.content[0] as any).text as string;

		expect(text).toContain("Time: Monday, March 9, 2026");
		expect(text).toContain("(Asia/Hong_Kong)");
		expect(text).toContain("UTC: 2026-03-09 15:23 UTC");
		expect(text).toContain("Workspace: /tmp/workspace");
		expect(text).toContain("Default model: anthropic/claude-sonnet-4-6");
		expect(text).toContain("Channel: tui");
		expect(text).toContain("Gateway session tools: unavailable in this runtime");
	});

	it("reports gateway session tool availability when bridged", async () => {
		const tool = createRuntimeStatusTool({
			cwd: "/tmp/workspace",
			channel: "telegram",
			capabilities: ["threaded", "reactions"],
			gatewayUrl: "http://127.0.0.1:23333",
		});

		const result = await tool.execute("id", {});
		const text = (result.content[0] as any).text as string;

		expect(text).toContain("Channel: telegram");
		expect(text).toContain("Capabilities: threaded, reactions");
		expect(text).toContain("Gateway session tools: available");
	});
});
