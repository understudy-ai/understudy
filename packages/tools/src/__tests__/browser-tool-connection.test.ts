import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	managerInstances: [] as Array<{
		options: Record<string, unknown>;
		start: ReturnType<typeof vi.fn>;
		createTab: ReturnType<typeof vi.fn>;
		isRunning: ReturnType<typeof vi.fn>;
		listTabs: ReturnType<typeof vi.fn>;
		close: ReturnType<typeof vi.fn>;
	}>,
	throwOnExtensionStart: false,
}));

vi.mock("../browser/browser-manager.js", () => ({
		BrowserManager: class MockBrowserManager {
			options: Record<string, unknown>;
			private running = false;
			start = vi.fn(async () => {
				if (this.options.browserConnectionMode === "extension" && mocks.throwOnExtensionStart) {
					throw new Error("browserType.connectOverCDP: Invalid URL: undefined");
				}
				this.running = true;
			});
		createTab = vi.fn(async (url?: string) => {
			if (this.options.browserConnectionMode === "extension") {
				throw new Error("browserContext.newPage: Protocol error (Target.createTarget): No attached tab for method Target.createTarget");
			}
			this.running = true;
			return {
				id: "tab_1",
				title: "Understudy",
				url: url ?? "about:blank",
				active: true,
			};
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
		mocks.throwOnExtensionStart = false;
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

	it("falls back to managed mode when the default extension route has no attached tab", async () => {
		const tool = createBrowserTool(() => ({
			browserConnectionMode: "extension",
			browserCdpUrl: "http://127.0.0.1:24444",
		}));

		const open = await tool.execute("id", {
			action: "open",
			url: "https://example.com",
		});

		expect((open.content[0] as any).text).toContain("Opened tab_1: https://example.com");
		expect((open.content[0] as any).text).toContain("[fallback]");
		expect((open.details as any).connectionFallback).toMatchObject({
			from: "extension",
			to: "managed",
		});
		expect(mocks.managerInstances).toHaveLength(2);
		expect(mocks.managerInstances[0]?.options).toEqual({
			browserConnectionMode: "extension",
			browserCdpUrl: "http://127.0.0.1:24444",
		});
		expect(mocks.managerInstances[1]?.options).toEqual({
			browserConnectionMode: "managed",
		});
	});

	it("falls back to managed mode when the default extension route cannot start cleanly", async () => {
		mocks.throwOnExtensionStart = true;
		const tool = createBrowserTool(() => ({
			browserConnectionMode: "extension",
			browserCdpUrl: "http://127.0.0.1:24444",
		}));

		const start = await tool.execute("id", {
			action: "start",
		});

		expect((start.content[0] as any).text).toContain("Browser started (managed)");
		expect((start.content[0] as any).text).toContain("[fallback]");
		expect((start.details as any).connectionFallback).toMatchObject({
			from: "extension",
			to: "managed",
		});
		expect(mocks.managerInstances).toHaveLength(2);
		expect(mocks.managerInstances[0]?.options).toEqual({
			browserConnectionMode: "extension",
			browserCdpUrl: "http://127.0.0.1:24444",
		});
		expect(mocks.managerInstances[1]?.options).toEqual({
			browserConnectionMode: "managed",
		});
	});
});
