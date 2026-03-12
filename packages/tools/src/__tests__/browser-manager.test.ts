import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	launch: vi.fn(),
	connectOverCDP: vi.fn(),
	newContext: vi.fn(),
	newPage: vi.fn(),
	pages: vi.fn(),
	setDefaultTimeout: vi.fn(),
	setViewportSize: vi.fn(),
	screenshot: vi.fn(),
	pdf: vi.fn(),
	title: vi.fn(),
	url: vi.fn(),
	pageClose: vi.fn(),
	browserClose: vi.fn(),
	getRelayHeaders: vi.fn(),
}));

vi.mock("playwright", () => ({
	chromium: {
		launch: mocks.launch,
		connectOverCDP: mocks.connectOverCDP,
	},
}));

vi.mock("../browser/extension-relay-auth.js", () => ({
	getUnderstudyChromeExtensionRelayAuthHeaders: mocks.getRelayHeaders,
}));

import { BrowserManager } from "../browser/browser-manager.js";

describe("BrowserManager", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		const page = {
			setDefaultTimeout: mocks.setDefaultTimeout,
			setViewportSize: mocks.setViewportSize,
			screenshot: mocks.screenshot,
			pdf: mocks.pdf,
			title: mocks.title,
			url: mocks.url,
			close: mocks.pageClose,
			bringToFront: vi.fn().mockResolvedValue(undefined),
		};
		const context = {
			newPage: mocks.newPage,
			pages: mocks.pages,
		};
		const browser = {
			newContext: mocks.newContext,
			contexts: vi.fn(() => [context]),
			close: mocks.browserClose,
		};

		mocks.launch.mockResolvedValue(browser);
		mocks.connectOverCDP.mockResolvedValue(browser);
		mocks.newContext.mockResolvedValue(context);
		mocks.newPage.mockResolvedValue(page);
		mocks.pages.mockReturnValue([page]);
		mocks.screenshot.mockResolvedValue(Buffer.from("png-data"));
		mocks.pdf.mockResolvedValue(undefined);
		mocks.setViewportSize.mockResolvedValue(undefined);
		mocks.title.mockResolvedValue("Understudy");
		mocks.url.mockReturnValue("https://example.com");
		mocks.pageClose.mockResolvedValue(undefined);
		mocks.browserClose.mockResolvedValue(undefined);
		mocks.getRelayHeaders.mockResolvedValue({
			"x-understudy-relay-token": "relay-token",
		});
	});

	it("lazy-initializes a managed browser and reuses the first page", async () => {
		const manager = new BrowserManager({
			headless: false,
			viewport: { width: 800, height: 600 },
			timeout: 1234,
		});

		expect(manager.isRunning()).toBe(false);
		const page1 = await manager.getPage();
		const page2 = await manager.getPage();

		expect(page1).toBe(page2);
		expect(mocks.launch).toHaveBeenCalledWith({ headless: false });
		expect(mocks.newContext).toHaveBeenCalledWith({
			viewport: { width: 800, height: 600 },
		});
		expect(mocks.setDefaultTimeout).toHaveBeenCalledWith(1234);
		expect(mocks.setViewportSize).toHaveBeenCalledWith({ width: 800, height: 600 });
		expect(manager.isRunning()).toBe(true);
	});

	it("connects through the extension relay with auth headers", async () => {
		const manager = new BrowserManager({
			browserConnectionMode: "extension",
			browserCdpUrl: "http://127.0.0.1:23336",
			timeout: 4321,
		});

		await manager.start();

		expect(mocks.getRelayHeaders).toHaveBeenCalledWith("http://127.0.0.1:23336");
		expect(mocks.connectOverCDP).toHaveBeenCalledWith("http://127.0.0.1:23336", {
			timeout: 4321,
			headers: { "x-understudy-relay-token": "relay-token" },
		});
		expect(mocks.launch).not.toHaveBeenCalled();
	});

	it("fails cleanly when the extension relay has no attached tab", async () => {
		mocks.connectOverCDP.mockResolvedValue({
			contexts: vi.fn(() => []),
			close: mocks.browserClose,
		});

		const manager = new BrowserManager({
			browserConnectionMode: "extension",
		});

		await expect(manager.start()).rejects.toThrow("Click the Understudy extension on a browser tab first");
		expect(mocks.browserClose).toHaveBeenCalled();
	});

	it("falls back to managed Playwright when auto mode cannot attach through the extension relay", async () => {
		mocks.getRelayHeaders.mockRejectedValue(new Error("missing relay token"));

		const manager = new BrowserManager({
			browserConnectionMode: "auto",
			headless: false,
		});

		await manager.start();

		expect(mocks.connectOverCDP).not.toHaveBeenCalled();
		expect(mocks.launch).toHaveBeenCalledWith({ headless: false });
		expect(manager.getConfiguredConnectionMode()).toBe("auto");
		expect(manager.getResolvedConnectionMode()).toBe("managed");
	});

	it("takes screenshot as base64 and closes the browser safely", async () => {
		const manager = new BrowserManager();
		const encoded = await manager.screenshot();
		expect(encoded).toBe(Buffer.from("png-data").toString("base64"));

		await manager.close();
		expect(mocks.browserClose).toHaveBeenCalled();
		expect(manager.isRunning()).toBe(false);
	});
});
