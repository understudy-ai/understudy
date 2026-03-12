import { describe, it, expect, vi, afterEach } from "vitest";
import { createWebFetchTool } from "../web-fetch.js";

describe("createWebFetchTool", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("creates a tool with correct metadata", () => {
		const tool = createWebFetchTool();
		expect(tool.name).toBe("web_fetch");
		expect(tool.label).toBe("Web Fetch");
	});

	it("returns error for empty URL", async () => {
		const tool = createWebFetchTool();
		const result = await tool.execute("id", { url: "  " });
		expect((result.content[0] as any).text).toContain("empty URL");
	});

	it("blocks SSRF attempts (localhost)", async () => {
		const tool = createWebFetchTool();
		const result = await tool.execute("id", { url: "http://localhost:8080/admin" });
		expect((result.content[0] as any).text).toContain("Blocked host");
	});

	it("blocks SSRF attempts (private IPs)", async () => {
		const tool = createWebFetchTool();
		const result = await tool.execute("id", { url: "http://192.168.1.1/admin" });
		expect((result.content[0] as any).text).toContain("Blocked private IP");
	});

	it("blocks SSRF attempts (metadata endpoint)", async () => {
		const tool = createWebFetchTool();
		const result = await tool.execute("id", { url: "http://169.254.169.254/latest/meta-data" });
		expect((result.content[0] as any).text).toContain("Blocked host");
	});

	it("fetches and extracts HTML content", async () => {
		const html = `
			<html>
			<head><title>Test Page</title></head>
			<body>
				<main>
					<h1>Hello World</h1>
					<p>This is a test paragraph.</p>
				</main>
			</body>
			</html>
		`;

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			headers: new Headers({ "content-type": "text/html" }),
			arrayBuffer: async () => new TextEncoder().encode(html).buffer,
		});

		const tool = createWebFetchTool();
		const result = await tool.execute("id", { url: "https://example.com" });
		const text = (result.content[0] as any).text;

		expect(text).toContain("Test Page");
		expect(text).toContain("Hello World");
		expect(text).toContain("test paragraph");
	});

	it("handles JSON responses", async () => {
		const json = JSON.stringify({ key: "value", nested: { a: 1 } });

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			headers: new Headers({ "content-type": "application/json" }),
			arrayBuffer: async () => new TextEncoder().encode(json).buffer,
		});

		const tool = createWebFetchTool();
		const result = await tool.execute("id", { url: "https://api.example.com/data" });
		const text = (result.content[0] as any).text;

		expect(text).toContain('"key": "value"');
	});

	it("supports plain-text extraction mode and truncates oversized content", async () => {
		const html = `
			<html>
			<head><title>Readable Title</title></head>
			<body>
				<main>
					<h1>Hello World</h1>
					<p>${"A".repeat(120)}</p>
				</main>
			</body>
			</html>
		`;

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			headers: new Headers({ "content-type": "text/html" }),
			arrayBuffer: async () => new TextEncoder().encode(html).buffer,
		});

		const tool = createWebFetchTool();
		const result = await tool.execute("id", {
			url: "https://example.com/readable",
			extractMode: "text",
			maxChars: 40,
		});
		const text = (result.content[0] as any).text as string;

		expect(text).toContain("Readable Title");
		expect(text).toContain("[Content truncated]");
		expect(result.details).toEqual({ fromCache: false, chars: 61 });
	});

	it("returns cached results on repeated fetches of the same URL and mode", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			headers: new Headers({ "content-type": "text/plain" }),
			arrayBuffer: async () => new TextEncoder().encode("cached page").buffer,
		});

		const tool = createWebFetchTool();
		await tool.execute("id1", { url: "https://example.com/cache" });
		const result = await tool.execute("id2", { url: "https://example.com/cache" });

		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		expect((result.content[0] as any).text).toContain("cached page");
		expect(result.details).toEqual({ fromCache: true, chars: 11 });
	});

	it("rejects oversized responses before extraction", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			headers: new Headers({
				"content-type": "text/plain",
				"content-length": "999",
			}),
			arrayBuffer: async () => new TextEncoder().encode("too large").buffer,
		});

		const tool = createWebFetchTool({ maxResponseBytes: 100 });
		const result = await tool.execute("id", { url: "https://example.com/large" });

		expect((result.content[0] as any).text).toContain("Fetch error: Response too large");
	});

	it("handles HTTP errors", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 404,
			statusText: "Not Found",
		});

		const tool = createWebFetchTool();
		const result = await tool.execute("id", { url: "https://example.com/missing" });
		expect((result.content[0] as any).text).toContain("HTTP 404");
	});
});
