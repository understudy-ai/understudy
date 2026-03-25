import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	instances: [] as Array<{
		options: Record<string, unknown>;
		running: boolean;
	}>,
	inspectRelay: vi.fn(),
}));

vi.mock("../browser/browser-manager.js", () => ({
	BrowserManager: class BrowserManager {
		private state: { options: Record<string, unknown>; running: boolean };

		constructor(options: Record<string, unknown> = {}) {
			this.state = { options, running: false };
			mocks.instances.push(this.state);
		}

		isRunning() {
			return this.state.running;
		}

		async start() {
			this.state.running = true;
		}

		async close() {
			this.state.running = false;
		}

		async listTabs() {
			return [];
		}
	},
}));

vi.mock("../browser/extension-relay-auth.js", () => ({
	inspectAuthenticatedUnderstudyRelay: mocks.inspectRelay,
}));

import { createBrowserTool } from "../browser/browser-tool.js";

describe("createBrowserTool manager reuse", () => {
	beforeEach(() => {
		mocks.instances.length = 0;
		mocks.inspectRelay.mockReset();
		mocks.inspectRelay.mockResolvedValue({
			reachable: false,
			recognized: false,
			extensionConnected: false,
			attachedTargets: [],
			error: "connect ECONNREFUSED 127.0.0.1:23336",
		});
		delete process.env.UNDERSTUDY_BROWSER_CONNECTION_MODE;
		delete process.env.UNDERSTUDY_BROWSER_CDP_URL;
	});

	it("reuses an extension-mode manager for later commands without explicit connection params", async () => {
		const tool = createBrowserTool();

		const started = await tool.execute("id-1", {
			action: "start",
			browserConnectionMode: "extension",
			browserCdpUrl: "http://127.0.0.1:24444",
		});
		expect((started.content[0] as any).text).toContain("Browser started");
		expect(mocks.instances).toHaveLength(1);
		expect(mocks.instances[0]?.options).toMatchObject({
			browserConnectionMode: "extension",
			browserCdpUrl: "http://127.0.0.1:24444",
		});

		const status = await tool.execute("id-2", { action: "status" });
		expect((status.content[0] as any).text).toContain("Browser status: running");
		expect(mocks.instances).toHaveLength(1);

		const stopped = await tool.execute("id-3", { action: "stop" });
		expect((stopped.content[0] as any).text).toContain("Browser stopped");
		expect(mocks.instances).toHaveLength(1);
	});

	it("still rejects explicit connection switches while the browser is running", async () => {
		const tool = createBrowserTool();

		await tool.execute("id-1", {
			action: "start",
			browserConnectionMode: "extension",
			browserCdpUrl: "http://127.0.0.1:24444",
		});
		const switched = await tool.execute("id-2", {
			action: "status",
			browserConnectionMode: "managed",
		});

		expect((switched.content[0] as any).text).toContain("Browser error: Browser runtime is already running with a different connection configuration");
		expect(mocks.instances).toHaveLength(1);
	});

	it("defaults to auto for unmanaged browser config", async () => {
		const tool = createBrowserTool();

		const status = await tool.execute("id-auto", { action: "status" });

		expect((status.content[0] as any).text).toContain("Configured route: auto");
		expect((status.content[0] as any).text).toContain("Extension relay: unreachable");
		expect(mocks.instances).toHaveLength(1);
		expect(mocks.instances[0]?.options).toMatchObject({
			browserConnectionMode: "auto",
			browserCdpUrl: "http://127.0.0.1:23336",
		});
	});

	it("refreshes default manager options after config changes while the browser is stopped", async () => {
		const config: {
			browserConnectionMode: "managed" | "auto";
			browserCdpUrl: string;
		} = {
			browserConnectionMode: "managed",
			browserCdpUrl: "http://127.0.0.1:23336",
		};
		const tool = createBrowserTool(() => ({
			browserConnectionMode: config.browserConnectionMode,
			browserCdpUrl: config.browserCdpUrl,
		}));

		const initialStatus = await tool.execute("id-1", { action: "status" });
		expect((initialStatus.content[0] as any).text).toContain("Browser status: stopped");
		expect((initialStatus.content[0] as any).text).toContain("Configured route: managed");
		expect(mocks.instances).toHaveLength(1);
		expect(mocks.instances[0]?.options).toMatchObject({
			browserConnectionMode: "managed",
			browserCdpUrl: "http://127.0.0.1:23336",
		});

		config.browserConnectionMode = "auto";
		config.browserCdpUrl = "http://127.0.0.1:24444";

		const refreshedStatus = await tool.execute("id-2", { action: "status" });
		expect((refreshedStatus.content[0] as any).text).toContain("Configured route: auto");
		expect(mocks.instances).toHaveLength(2);
		expect(mocks.instances[1]?.options).toMatchObject({
			browserConnectionMode: "auto",
			browserCdpUrl: "http://127.0.0.1:24444",
		});
	});

	it("reports extension handoff readiness even before the browser runtime starts", async () => {
		mocks.inspectRelay.mockResolvedValue({
			reachable: true,
			recognized: true,
			extensionConnected: true,
			attachedTargets: [{
				id: "tab-1",
				type: "page",
				title: "Understudy Docs",
				url: "https://example.com/docs",
			}],
		});
		const tool = createBrowserTool(() => ({
			browserConnectionMode: "extension",
			browserCdpUrl: "http://127.0.0.1:23336",
		}));

		const status = await tool.execute("id-ready", { action: "status" });

		expect((status.content[0] as any).text).toContain("Browser status: ready (extension tab attached)");
		expect((status.content[0] as any).text).toContain("Attached tabs: 1");
		expect((status.content[0] as any).text).toContain("A page refresh should not be necessary");
		expect(mocks.inspectRelay).toHaveBeenCalledWith({
			baseUrl: "http://127.0.0.1:23336",
			timeoutMs: 800,
		});
	});

	it("reports an unreachable extension relay instead of a generic stopped state", async () => {
		mocks.inspectRelay.mockResolvedValue({
			reachable: false,
			recognized: false,
			extensionConnected: false,
			attachedTargets: [],
			error: "connect ECONNREFUSED 127.0.0.1:24444",
		});
		const tool = createBrowserTool(() => ({
			browserConnectionMode: "extension",
			browserCdpUrl: "http://127.0.0.1:24444",
		}));

		const status = await tool.execute("id-unreachable", { action: "status" });

		expect((status.content[0] as any).text).toContain("Extension relay: unreachable");
		expect((status.content[0] as any).text).toContain("connect ECONNREFUSED 127.0.0.1:24444");
	});

	it("restarts the cached manager when default browser config changes while running", async () => {
		const config: {
			browserConnectionMode: "managed" | "extension";
			browserCdpUrl: string;
		} = {
			browserConnectionMode: "managed",
			browserCdpUrl: "http://127.0.0.1:23336",
		};
		const tool = createBrowserTool(() => ({
			browserConnectionMode: config.browserConnectionMode,
			browserCdpUrl: config.browserCdpUrl,
		}));

		await tool.execute("id-1", { action: "start" });
		expect(mocks.instances).toHaveLength(1);
		expect(mocks.instances[0]?.running).toBe(true);

		config.browserConnectionMode = "extension";
		config.browserCdpUrl = "http://127.0.0.1:24444";

		const status = await tool.execute("id-2", { action: "status" });

		expect((status.content[0] as any).text).toContain("Configured route: extension");
		expect(mocks.instances).toHaveLength(2);
		expect(mocks.instances[0]?.running).toBe(false);
		expect(mocks.instances[1]?.options).toMatchObject({
			browserConnectionMode: "extension",
			browserCdpUrl: "http://127.0.0.1:24444",
		});
	});
});
