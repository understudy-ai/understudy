/**
 * Web fetch tool for Understudy.
 * Fetches URLs and extracts readable content via Readability-style parsing.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { parseHTML } from "linkedom";
import {
	readCache,
	writeCache,
	normalizeCacheKey,
	fetchWithTimeout,
	readResponseText,
	validateUrl,
	wrapWebContent,
	truncateText,
	type CacheEntry,
} from "./web-shared.js";

const DEFAULT_MAX_CHARS = 50_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000;
const DEFAULT_USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const WebFetchSchema = Type.Object({
	url: Type.String({
		description: "HTTP or HTTPS URL to fetch. Internal/private hosts are blocked by policy.",
	}),
	extractMode: Type.Optional(
		Type.String({
			description: 'Extraction mode: "markdown" (default) for structure or "text" for plain output.',
		}),
	),
	maxChars: Type.Optional(
		Type.Number({
			description: "Maximum characters to return after extraction (default 50000).",
			minimum: 100,
		}),
	),
});

type WebFetchParams = Static<typeof WebFetchSchema>;

interface WebFetchConfig {
	timeoutMs?: number;
	cacheTtlMs?: number;
	maxResponseBytes?: number;
	userAgent?: string;
}

const FETCH_CACHE = new Map<string, CacheEntry<string>>();

export function createWebFetchTool(config: WebFetchConfig = {}): AgentTool<typeof WebFetchSchema> {
	return {
		name: "web_fetch",
		label: "Web Fetch",
		description:
			"Fetch a URL and extract readable content (markdown/text). " +
			"Use after discovery or when you need exact on-page details from docs/articles/APIs.",
		parameters: WebFetchSchema,
		execute: async (_toolCallId, params: WebFetchParams): Promise<AgentToolResult<unknown>> => {
			const urlString = params.url.trim();
			if (!urlString) {
				return {
					content: [{ type: "text", text: "Error: empty URL" }],
					details: { error: "empty url" },
				};
			}

			// Validate URL (SSRF guard)
			try {
				validateUrl(urlString);
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `URL validation error: ${msg}` }],
					details: { error: msg },
				};
			}

			const maxChars = params.maxChars ?? DEFAULT_MAX_CHARS;
			const extractMode = params.extractMode ?? "markdown";

			// Check cache
			const cacheKey = normalizeCacheKey(`${urlString}:${extractMode}`);
			const cached = readCache(FETCH_CACHE, cacheKey);
			if (cached) {
				const truncated = truncateText(cached, maxChars);
				return {
					content: [{ type: "text", text: wrapWebContent(truncated, urlString) }],
					details: { fromCache: true, chars: truncated.length },
				};
			}

			try {
				const content = await fetchAndExtract(
					urlString,
					extractMode,
					config,
				);
				writeCache(FETCH_CACHE, cacheKey, content, config.cacheTtlMs);
				const truncated = truncateText(content, maxChars);

				return {
					content: [{ type: "text", text: wrapWebContent(truncated, urlString) }],
					details: { fromCache: false, chars: truncated.length },
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Fetch error: ${msg}` }],
					details: { error: msg },
				};
			}
		},
	};
}

async function fetchAndExtract(
	url: string,
	extractMode: string,
	config: WebFetchConfig,
): Promise<string> {
	const response = await fetchWithTimeout(
		url,
		{
			headers: {
				"User-Agent": config.userAgent ?? DEFAULT_USER_AGENT,
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			},
			redirect: "follow",
		},
		config.timeoutMs ?? 30_000,
	);

	if (!response.ok) {
		throw new Error(`HTTP ${response.status} ${response.statusText}`);
	}

	const contentType = response.headers.get("content-type") ?? "";
	const maxBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
	const rawText = await readResponseText(response, maxBytes);

	// Handle JSON responses
	if (contentType.includes("application/json")) {
		try {
			const parsed = JSON.parse(rawText);
			return JSON.stringify(parsed, null, 2);
		} catch {
			return rawText;
		}
	}

	// Handle plain text
	if (contentType.includes("text/plain")) {
		return rawText;
	}

	// Handle markdown response (e.g., Cloudflare Markdown for Agents)
	if (contentType.includes("text/markdown")) {
		return rawText;
	}

	// HTML → extract readable content
	return extractFromHtml(rawText, url, extractMode);
}

function extractFromHtml(html: string, url: string, mode: string): string {
	const { document } = parseHTML(html);

	// Remove script and style elements
	for (const el of document.querySelectorAll("script, style, nav, footer, header, aside")) {
		el.remove();
	}

	// Get title
	const title = document.querySelector("title")?.textContent?.trim() ?? "";

	// Try to find main content
	const main =
		document.querySelector("main") ??
		document.querySelector("article") ??
		document.querySelector('[role="main"]') ??
		document.querySelector("#content") ??
		document.querySelector(".content") ??
		document.body;

	if (!main) {
		return title ? `# ${title}\n\n[No readable content found]` : "[No readable content found]";
	}

	if (mode === "text") {
		const text = main.textContent?.replace(/\s+/g, " ").trim() ?? "";
		return title ? `${title}\n\n${text}` : text;
	}

	// Markdown extraction
	const markdown = htmlToMarkdown(main, url);
	return title ? `# ${title}\n\n${markdown}` : markdown;
}

function htmlToMarkdown(element: any, baseUrl: string): string {
	const lines: string[] = [];

	function walk(node: any): void {
		if (node.nodeType === 3) {
			// Text node
			const text = node.textContent?.replace(/\s+/g, " ") ?? "";
			if (text.trim()) lines.push(text);
			return;
		}

		if (node.nodeType !== 1) return; // Not an element

		const tag = node.tagName?.toLowerCase();

		switch (tag) {
			case "h1":
				lines.push(`\n# ${node.textContent?.trim()}\n`);
				return;
			case "h2":
				lines.push(`\n## ${node.textContent?.trim()}\n`);
				return;
			case "h3":
				lines.push(`\n### ${node.textContent?.trim()}\n`);
				return;
			case "h4":
			case "h5":
			case "h6":
				lines.push(`\n#### ${node.textContent?.trim()}\n`);
				return;
			case "p":
				lines.push(`\n${node.textContent?.trim()}\n`);
				return;
			case "br":
				lines.push("\n");
				return;
			case "a": {
				const href = node.getAttribute("href");
				const text = node.textContent?.trim();
				if (href && text) {
					try {
						const absoluteUrl = new URL(href, baseUrl).toString();
						lines.push(`[${text}](${absoluteUrl})`);
					} catch {
						lines.push(text);
					}
				}
				return;
			}
			case "img": {
				const alt = node.getAttribute("alt") ?? "";
				lines.push(alt ? `[Image: ${alt}]` : "");
				return;
			}
			case "li":
				lines.push(`\n- ${node.textContent?.trim()}`);
				return;
			case "pre":
			case "code":
				lines.push(`\n\`\`\`\n${node.textContent}\n\`\`\`\n`);
				return;
			case "blockquote":
				lines.push(
					`\n> ${node.textContent?.trim()}\n`,
				);
				return;
			case "hr":
				lines.push("\n---\n");
				return;
			default:
				break;
		}

		// Walk children
		for (const child of node.childNodes ?? []) {
			walk(child);
		}
	}

	walk(element);
	return lines.join("").replace(/\n{3,}/g, "\n\n").trim();
}
