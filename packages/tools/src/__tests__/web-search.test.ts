import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWebSearchTool } from "../web-search.js";

describe("createWebSearchTool", () => {
	const originalFetch = globalThis.fetch;
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv, BRAVE_API_KEY: "test-key" };
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		process.env = originalEnv;
	});

	it("creates a tool with correct metadata", () => {
		const tool = createWebSearchTool();
		expect(tool.name).toBe("web_search");
		expect(tool.label).toBe("Web Search");
	});

	it("returns error for empty query", async () => {
		const tool = createWebSearchTool();
		const result = await tool.execute("id", { query: "   " });
		expect(result.content[0]).toEqual({ type: "text", text: "Error: empty search query" });
	});

	it("returns error when no API key", async () => {
		delete process.env.BRAVE_API_KEY;
		delete process.env.GEMINI_API_KEY;
		const tool = createWebSearchTool();
		const result = await tool.execute("id", { query: "test" });
		expect((result.content[0] as any).text).toContain("BRAVE_API_KEY or GEMINI_API_KEY");
	});

	it("fetches results from Brave API", async () => {
		const mockResults = {
			web: {
				results: [
					{ title: "Result 1", url: "https://example.com/1", description: "Desc 1" },
					{ title: "Result 2", url: "https://example.com/2", description: "Desc 2" },
				],
			},
		};

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			headers: new Headers(),
			arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(mockResults)).buffer,
		});

		const tool = createWebSearchTool();
		const result = await tool.execute("id", { query: "test query" });
		const text = (result.content[0] as any).text;

		expect(text).toContain("Result 1");
		expect(text).toContain("https://example.com/1");
		expect(text).toContain("Result 2");
		expect(result.details).toEqual({ resultCount: 2, fromCache: false, provider: "brave" });
	});

	it("passes count and country through to Brave search", async () => {
		globalThis.fetch = vi.fn().mockImplementation(async (input: unknown) => {
			const url = new URL(String(input));
			expect(url.searchParams.get("q")).toBe("hong kong weather");
			expect(url.searchParams.get("count")).toBe("3");
			expect(url.searchParams.get("country")).toBe("HK");
			return {
				ok: true,
				headers: new Headers(),
				arrayBuffer: async () =>
					new TextEncoder().encode(JSON.stringify({
						web: {
							results: [
								{ title: "HK Weather", url: "https://example.com/hk-weather", description: "Sunny" },
							],
						},
					})).buffer,
			};
		});

		const tool = createWebSearchTool();
		const result = await tool.execute("id", { query: "hong kong weather", count: 3, country: "HK" });
		expect((result.content[0] as any).text).toContain("HK Weather");
	});

	it("auto-detects Gemini provider when Brave key is missing", async () => {
		delete process.env.BRAVE_API_KEY;
		process.env.GEMINI_API_KEY = "gemini-test-key";

		const geminiPayload = {
			candidates: [
				{
					content: {
						parts: [{ text: "Weather is snowy in Beijing with low temperatures." }],
					},
					groundingMetadata: {
						groundingChunks: [
							{ web: { uri: "https://example.com/weather", title: "Beijing Weather Report" } },
						],
					},
				},
			],
		};

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			headers: new Headers(),
			arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(geminiPayload)).buffer,
		});

		const tool = createWebSearchTool();
		const result = await tool.execute("id", { query: "beijing weather" });
		const text = (result.content[0] as any).text;

		expect(text).toContain("Beijing Weather Report");
		expect(text).toContain("https://example.com/weather");
		expect(result.details).toEqual({ resultCount: 1, fromCache: false, provider: "gemini" });
	});

	it("falls back to a Gemini synthesis result when grounding chunks are absent", async () => {
		delete process.env.BRAVE_API_KEY;
		process.env.GEMINI_API_KEY = "gemini-test-key";

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			headers: new Headers(),
			arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({
				candidates: [
					{
						content: {
							parts: [{ text: "A concise synthesized answer about the topic." }],
						},
					},
				],
			})).buffer,
		});

		const tool = createWebSearchTool();
		const result = await tool.execute("id", { query: "synth only" });
		const text = (result.content[0] as any).text as string;

		expect(text).toContain("Gemini synthesis");
		expect(text).toContain("A concise synthesized answer about the topic.");
		expect(result.details).toEqual({ resultCount: 1, fromCache: false, provider: "gemini" });
	});

	it("handles API errors gracefully", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 429,
			statusText: "Too Many Requests",
		});

		const tool = createWebSearchTool();
		const result = await tool.execute("id", { query: "test" });
		expect((result.content[0] as any).text).toContain("Search error");
	});

	it("returns cached results on second call", async () => {
		const mockResults = {
			web: {
				results: [{ title: "Cached", url: "https://example.com", description: "Desc" }],
			},
		};

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			headers: new Headers(),
			arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(mockResults)).buffer,
		});

		const tool = createWebSearchTool();
		await tool.execute("id1", { query: "cache test" });
		const result = await tool.execute("id2", { query: "cache test" });

		expect(result.details).toEqual({ resultCount: 1, fromCache: true, provider: "brave" });
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it("supports forcing provider via UNDERSTUDY_WEB_SEARCH_PROVIDER", async () => {
		delete process.env.BRAVE_API_KEY;
		delete process.env.GEMINI_API_KEY;
		process.env.UNDERSTUDY_WEB_SEARCH_PROVIDER = "gemini";

		const tool = createWebSearchTool();
		const result = await tool.execute("id", { query: "test" });
		expect((result.content[0] as any).text).toContain("provider=gemini requires GEMINI_API_KEY");
	});

	it("supports forcing Brave when the Brave API key is configured", async () => {
		process.env.UNDERSTUDY_WEB_SEARCH_PROVIDER = "brave";
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			headers: new Headers(),
			arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({
				web: {
					results: [
						{ title: "Forced Brave", url: "https://example.com/forced", description: "forced provider" },
					],
				},
			})).buffer,
		});

		const tool = createWebSearchTool();
		const result = await tool.execute("id", { query: "forced brave" });

		expect((result.content[0] as any).text).toContain("Forced Brave");
		expect(result.details).toEqual({ resultCount: 1, fromCache: false, provider: "brave" });
	});
});
