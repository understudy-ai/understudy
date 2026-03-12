import { describe, expect, it, vi } from "vitest";
import { createBrowserTool } from "../browser/browser-tool.js";

function createManager() {
	const locators = new Map<string, any>();
	const getLocator = (selector: string) => {
		if (!locators.has(selector)) {
			const locator = {
				selector,
				first: vi.fn(function () {
					return locator;
				}),
				click: vi.fn().mockResolvedValue(undefined),
				dblclick: vi.fn().mockResolvedValue(undefined),
				fill: vi.fn().mockResolvedValue(undefined),
				pressSequentially: vi.fn().mockResolvedValue(undefined),
				press: vi.fn().mockResolvedValue(undefined),
				hover: vi.fn().mockResolvedValue(undefined),
				selectOption: vi.fn().mockResolvedValue(undefined),
				setInputFiles: vi.fn().mockResolvedValue(undefined),
				screenshot: vi.fn().mockResolvedValue(Buffer.from(`image:${selector}`)),
				evaluate: vi.fn().mockResolvedValue({ selector }),
				dragTo: vi.fn().mockResolvedValue(undefined),
				scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
				elementHandle: vi.fn().mockResolvedValue({}),
			};
			locators.set(selector, locator);
		}
		return locators.get(selector);
	};

	const page = {
		goto: vi.fn().mockResolvedValue(undefined),
		title: vi.fn().mockResolvedValue("Understudy"),
		setViewportSize: vi.fn().mockResolvedValue(undefined),
		screenshot: vi.fn().mockResolvedValue(Buffer.from("page-png-bytes")),
		waitForSelector: vi.fn().mockResolvedValue(undefined),
		waitForFunction: vi.fn().mockResolvedValue(undefined),
		waitForURL: vi.fn().mockResolvedValue(undefined),
		waitForLoadState: vi.fn().mockResolvedValue(undefined),
		waitForResponse: vi.fn().mockResolvedValue({
			text: vi.fn().mockResolvedValue("response-body"),
			url: vi.fn().mockReturnValue("https://example.com/api"),
			status: vi.fn().mockReturnValue(200),
		}),
		accessibility: {
			snapshot: vi.fn().mockResolvedValue({
				role: "document",
				name: "root",
				children: [{ role: "button", name: "Send" }],
			}),
		},
		evaluate: vi.fn(async (fnOrScript: unknown) => {
			if (typeof fnOrScript === "string") {
				return { ok: true };
			}
			return [
				{
					ref: "1",
					role: "button",
					name: "Send",
					selector: "#send",
					nth: 0,
					box: { x: 10, y: 20, width: 30, height: 12 },
				},
				{
					ref: "2",
					role: "textbox",
					name: "Query",
					value: "hello",
					selector: "#q",
					nth: 0,
					box: { x: 50, y: 70, width: 120, height: 20 },
				},
			];
		}),
		keyboard: {
			press: vi.fn().mockResolvedValue(undefined),
		},
		waitForTimeout: vi.fn().mockResolvedValue(undefined),
		locator: vi.fn((selector: string) => getLocator(selector)),
		on: vi.fn(),
		once: vi.fn(),
		url: vi.fn().mockReturnValue("https://example.com"),
	};

	const manager = {
		start: vi.fn().mockResolvedValue(undefined),
		isRunning: vi.fn().mockReturnValue(true),
		getPage: vi.fn().mockResolvedValue(page),
		listTabs: vi.fn().mockResolvedValue([{ id: "tab_1", title: "Understudy", url: "https://example.com", active: true }]),
		createTab: vi.fn().mockResolvedValue({ id: "tab_2", url: "https://example.com", active: true }),
		focusTab: vi.fn().mockResolvedValue(undefined),
		closeTab: vi.fn().mockResolvedValue(undefined),
		screenshot: vi.fn().mockResolvedValue(Buffer.from("png-bytes").toString("base64")),
		savePdf: vi.fn().mockResolvedValue("/tmp/understudy.pdf"),
		close: vi.fn().mockResolvedValue(undefined),
		getTabId: vi.fn().mockReturnValue("tab_1"),
	};

	return { manager, page, getLocator };
}

describe("createBrowserTool", () => {
	it("validates required inputs", async () => {
		const { manager } = createManager();
		const tool = createBrowserTool(manager as any);

		expect((await tool.execute("id", { action: "navigate" })).content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("url is required"),
		});

		expect((await tool.execute("id", { action: "click" })).content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("selector or ref is required"),
		});

		expect((await tool.execute("id", { action: "type", selector: "#q" })).content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("text is required"),
		});

		expect((await tool.execute("id", { action: "evaluate" })).content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("fn is required"),
		});
	});

	it("rejects unknown snapshot refs instead of treating them as selectors", async () => {
		const tool = createBrowserTool(createManager().manager as any);
		const result = await tool.execute("id", { action: "click", ref: "#legacy-selector" });
		expect((result.content[0] as any).text).toContain("Unknown snapshot ref: #legacy-selector");
	});

	it("executes navigate/click/type/snapshot/evaluate/close actions", async () => {
		const { manager, page, getLocator } = createManager();
		const tool = createBrowserTool(manager as any);

		const nav = await tool.execute("id", { action: "navigate", url: "https://example.com" });
		expect(page.goto).toHaveBeenCalledWith("https://example.com", { waitUntil: "domcontentloaded" });
		expect((nav.content[0] as any).text).toContain("Title: Understudy");

		const click = await tool.execute("id", { action: "click", selector: "button" });
		expect((click.content[0] as any).text).toContain("Clicked: selector button");
		expect(getLocator("button").click).toHaveBeenCalled();

		const type = await tool.execute("id", { action: "type", selector: "#q", text: "hello" });
		expect((type.content[0] as any).text).toContain("Typed into selector #q");
		expect(getLocator("#q").fill).toHaveBeenCalledWith("hello");

		const snapshot = await tool.execute("id", { action: "snapshot" });
		expect((snapshot.content[0] as any).text).toContain("[1] button \"Send\"");
		expect((snapshot.details as any).refs["1"]).toMatchObject({ selector: "#send" });

		const ariaSnapshot = await tool.execute("id", { action: "snapshot", format: "aria" });
		expect((ariaSnapshot.content[0] as any).text).toContain("ARIA snapshot");
		expect((ariaSnapshot.content[0] as any).text).toContain("- document \"root\"");

		const evaluate = await tool.execute("id", { action: "evaluate", fn: "1+1" });
		expect((evaluate.content[0] as any).text).toContain("\"ok\": true");

		const close = await tool.execute("id", { action: "close" });
		expect((close.content[0] as any).text).toContain("Browser closed");
		expect(manager.close).toHaveBeenCalled();
	});

	it("executes start/tabs/open/focus/press/wait/pdf/stop actions", async () => {
		const { manager, page } = createManager();
		const tool = createBrowserTool(manager as any);

		const start = await tool.execute("id", { action: "start" });
		expect((start.content[0] as any).text).toContain("Browser started");
		expect(manager.start).toHaveBeenCalled();

		const tabs = await tool.execute("id", { action: "tabs" });
		expect((tabs.content[0] as any).text).toContain("tab_1");
		expect(manager.listTabs).toHaveBeenCalled();

		const open = await tool.execute("id", { action: "open", url: "https://example.com" });
		expect((open.content[0] as any).text).toContain("tab_2");
		expect(manager.createTab).toHaveBeenCalledWith("https://example.com");

		const focus = await tool.execute("id", { action: "focus", targetId: "tab_1" });
		expect((focus.content[0] as any).text).toContain("Focused tab: tab_1");
		expect(manager.focusTab).toHaveBeenCalledWith("tab_1");

		await tool.execute("id", { action: "press", key: "Enter" });
		expect(page.keyboard.press).toHaveBeenCalledWith("Enter");

		await tool.execute("id", { action: "wait", waitMs: 5 });
		expect(page.waitForTimeout).toHaveBeenCalledWith(5);

		const pdf = await tool.execute("id", { action: "pdf" });
		expect((pdf.content[0] as any).text).toBe("FILE:/tmp/understudy.pdf");
		expect(manager.savePdf).toHaveBeenCalled();

		const stop = await tool.execute("id", { action: "stop" });
		expect((stop.content[0] as any).text).toContain("Browser stopped");
		expect(manager.close).toHaveBeenCalled();
	});

	it("supports status/console/dialog/pdf/upload and extended direct actions", async () => {
		const { manager, page, getLocator } = createManager();
		const tool = createBrowserTool(manager as any);

		const status = await tool.execute("id", { action: "status" });
		expect((status.content[0] as any).text).toContain("Browser status: running");

		const consoleResult = await tool.execute("id", { action: "console", limit: 5 });
		expect((consoleResult.content[0] as any).text).toContain("No console events");

		const dialogResult = await tool.execute("id", { action: "dialog", limit: 5 });
		expect((dialogResult.content[0] as any).text).toContain("No dialog events");

		await tool.execute("id", { action: "press", key: "Escape" });
		expect(page.keyboard.press).toHaveBeenCalledWith("Escape");

		await tool.execute("id", { action: "hover", selector: "#btn" });
		expect(getLocator("#btn").hover).toHaveBeenCalled();

		await tool.execute("id", { action: "select", selector: "#country", values: ["CN"] });
		expect(getLocator("#country").selectOption).toHaveBeenCalledWith(["CN"]);

		await tool.execute("id", { action: "fill", selector: "#name", text: "Understudy" });
		expect(getLocator("#name").fill).toHaveBeenCalledWith("Understudy");

		await tool.execute("id", { action: "resize", width: 1440, height: 900 });
		expect(page.setViewportSize).toHaveBeenCalledWith({ width: 1440, height: 900 });

		await tool.execute("id", { action: "evaluate", fn: "2+2" });
		expect(page.evaluate).toHaveBeenCalledWith("2+2");

		await tool.execute("id", { action: "close", targetId: "tab_1" });
		expect(manager.closeTab).toHaveBeenCalledWith("tab_1");

		const pdf = await tool.execute("id", { action: "pdf" });
		expect((pdf.content[0] as any).text).toBe("FILE:/tmp/understudy.pdf");

		const upload = await tool.execute("id", {
			action: "upload",
			selector: "#file",
			paths: ["/tmp/a.txt", "/tmp/b.txt"],
		});
		expect((upload.content[0] as any).text).toContain("Uploaded 2 file(s)");
		expect(getLocator("#file").setInputFiles).toHaveBeenCalledWith(["/tmp/a.txt", "/tmp/b.txt"]);

		const responseBody = await tool.execute("id", {
			action: "response_body",
			url: "**/api",
			maxChars: 20,
		});
		expect((responseBody.content[0] as any).text).toContain("response-body");
	});

	it("returns screenshot image payload", async () => {
		const { manager } = createManager();
		const tool = createBrowserTool(manager as any);

		const result = await tool.execute("id", { action: "screenshot" });
		const note = result.content[0] as any;
		const image = result.content[1] as any;
		expect(note.type).toBe("text");
		expect(note.text).toContain("Captured browser-screenshot.png.");
		expect(image.type).toBe("image");
		expect(image.mimeType).toBe("image/png");
		expect(typeof image.data).toBe("string");
		expect(result.details).toMatchObject({ action: "screenshot", mimeType: "image/png" });
	});

	it("adds a clear hint for empty managed tabs", async () => {
		const { manager, page } = createManager();
		page.url.mockReturnValue("about:blank");
		page.evaluate.mockResolvedValue([]);
		const tool = createBrowserTool(manager as any);

		const snapshot = await tool.execute("id", {
			action: "snapshot",
			browserConnectionMode: "managed",
		});

		expect((snapshot.content[0] as any).text).toContain("No interactive elements found");
		expect((snapshot.content[0] as any).text).toContain("browserConnectionMode: \"extension\"");
		expect(snapshot.details).toMatchObject({
			url: "about:blank",
			likelyCause: "managed_blank_tab",
		});
	});

	it("handles unknown action and execution errors", async () => {
		const { manager } = createManager();
		const tool = createBrowserTool(manager as any);

		const unknown = await tool.execute("id", { action: "noop" });
		expect((unknown.content[0] as any).text).toContain("Unknown action");

		const badManager = {
			getPage: vi.fn().mockRejectedValue(new Error("playwright unavailable")),
			screenshot: vi.fn().mockResolvedValue(""),
			close: vi.fn().mockResolvedValue(undefined),
		};
		const badTool = createBrowserTool(badManager as any);
		const failed = await badTool.execute("id", { action: "navigate", url: "https://example.com" });
		expect((failed.content[0] as any).text).toContain("Browser error: playwright unavailable");
	});
});
