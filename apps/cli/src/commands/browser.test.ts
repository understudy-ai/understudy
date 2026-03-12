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

import { runBrowserCommand } from "./browser.js";

describe("runBrowserCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = 0;
	});

	it("maps --open to browser.request open action", async () => {
		mocks.rpcCall.mockResolvedValue({ ok: true, text: "Opened tab" });
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runBrowserCommand({ open: "https://example.com" });

		expect(mocks.rpcCall).toHaveBeenCalledWith("browser.request", {
			action: "open",
			url: "https://example.com",
		});
		expect(log).toHaveBeenCalledWith("Opened tab");
	});

		it("maps --extension without another action to browser.request start in extension mode", async () => {
			mocks.rpcCall.mockResolvedValue({ ok: true, text: "Browser started" });
			vi.spyOn(console, "log").mockImplementation(() => {});

		await runBrowserCommand({
			extension: "http://127.0.0.1:23336",
		});

		expect(mocks.rpcCall).toHaveBeenCalledWith("browser.request", {
			action: "start",
			browserConnectionMode: "extension",
			browserCdpUrl: "http://127.0.0.1:23336",
		});
	});

		it("maps --extension and --open to browser.request open with extension config", async () => {
			mocks.rpcCall.mockResolvedValue({ ok: true, text: "Opened tab" });
			vi.spyOn(console, "log").mockImplementation(() => {});

		await runBrowserCommand({
			extension: true,
			cdpUrl: "http://127.0.0.1:23336",
			open: "https://www.barrons.com",
		});

		expect(mocks.rpcCall).toHaveBeenCalledWith("browser.request", {
			action: "open",
			url: "https://www.barrons.com",
			browserConnectionMode: "extension",
			browserCdpUrl: "http://127.0.0.1:23336",
		});
	});

	it("defaults to status and forwards host/port overrides to the RPC client", async () => {
		mocks.rpcCall.mockResolvedValue({ connected: true });
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runBrowserCommand({
			host: "127.0.0.1",
			port: "4321",
		});

		expect(mocks.createRpcClient).toHaveBeenCalledWith({
			host: "127.0.0.1",
			port: 4321,
		});
		expect(mocks.rpcCall).toHaveBeenCalledWith("browser.request", {
			action: "status",
		});
		expect(log).toHaveBeenCalledWith(JSON.stringify({ connected: true }, null, 2));
	});

	it("prints raw JSON when --json is set", async () => {
		mocks.rpcCall.mockResolvedValue({
			text: "human readable",
			tabs: [{ id: "tab-1" }],
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runBrowserCommand({
			tabs: true,
			json: true,
			managed: true,
		});

		expect(mocks.rpcCall).toHaveBeenCalledWith("browser.request", {
			action: "tabs",
			browserConnectionMode: "managed",
		});
		expect(log).toHaveBeenCalledWith(JSON.stringify({
			text: "human readable",
			tabs: [{ id: "tab-1" }],
		}, null, 2));
	});

	it("maps --fn to browser.request evaluate with fn", async () => {
		mocks.rpcCall.mockResolvedValue({ ok: true, text: "2" });
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runBrowserCommand({
			fn: "1+1",
		});

		expect(mocks.rpcCall).toHaveBeenCalledWith("browser.request", {
			action: "evaluate",
			fn: "1+1",
		});
		expect(log).toHaveBeenCalledWith("2");
	});

	it("reports RPC failures and sets a failing exit code", async () => {
		mocks.rpcCall.mockRejectedValue(new Error("gateway offline"));
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		await runBrowserCommand({
			screenshot: true,
		});

		expect(error).toHaveBeenCalledWith("Error:", "gateway offline");
		expect(process.exitCode).toBe(1);
	});
});
