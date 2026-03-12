import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	managerInstances: [] as Array<{
		options: Record<string, unknown>;
		start: ReturnType<typeof vi.fn>;
		isRunning: ReturnType<typeof vi.fn>;
		listTabs: ReturnType<typeof vi.fn>;
		close: ReturnType<typeof vi.fn>;
	}>,
}));

vi.mock("../browser/browser-manager.js", () => ({
	BrowserManager: class MockBrowserManager {
		options: Record<string, unknown>;
		private running = false;
		start = vi.fn(async () => {
			this.running = true;
		});
		isRunning = vi.fn(() => this.running);
		listTabs = vi.fn(async () => [
			{ id: "tab_1", title: "Understudy", url: "https://example.com", active: true },
		]);
		close = vi.fn(async () => {
			this.running = false;
		});

		constructor(options: Record<string, unknown> = {}) {
			this.options = options;
			mocks.managerInstances.push(this);
		}
	},
}));

import { createBrowserTool } from "../browser/browser-tool.js";

describe("createBrowserTool connection config reuse", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.managerInstances.length = 0;
	});

	it("reuses extension mode configuration when later commands omit the override", async () => {
		const tool = createBrowserTool();

		const start = await tool.execute("id", {
			action: "start",
			browserConnectionMode: "extension",
			browserCdpUrl: "http://127.0.0.1:24444",
		});
		expect((start.content[0] as any).text).toContain("Browser started");
		expect(mocks.managerInstances).toHaveLength(1);
		expect(mocks.managerInstances[0]?.options).toEqual({
			browserConnectionMode: "extension",
			browserCdpUrl: "http://127.0.0.1:24444",
		});

		const status = await tool.execute("id", { action: "status" });
		expect((status.content[0] as any).text).toContain("Browser status: running");
		expect(mocks.managerInstances).toHaveLength(1);

		const stop = await tool.execute("id", { action: "stop" });
		expect((stop.content[0] as any).text).toContain("Browser stopped");
		expect(mocks.managerInstances[0]?.close).toHaveBeenCalledTimes(1);
	});

	it("rejects explicit connection mode switches while the runtime is running", async () => {
		const tool = createBrowserTool();

		await tool.execute("id", {
			action: "start",
			browserConnectionMode: "extension",
			browserCdpUrl: "http://127.0.0.1:24444",
		});

		const result = await tool.execute("id", {
			action: "status",
			browserConnectionMode: "managed",
		});

		expect((result.content[0] as any).text).toContain("different connection configuration");
		expect((result.details as any).error).toContain("different connection configuration");
		expect(mocks.managerInstances).toHaveLength(1);
	});
});
