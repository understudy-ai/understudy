/**
 * Web search tool for Understudy.
 * Supports provider auto-detection (Brave, Gemini).
 */

import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { sanitizeForPromptLiteral } from "@understudy/core";
import {
	readCache,
	writeCache,
	normalizeCacheKey,
	fetchWithTimeout,
	readResponseText,
	wrapWebContent,
	type CacheEntry,
} from "./web-shared.js";

const DEFAULT_SEARCH_COUNT = 5;
const MAX_SEARCH_COUNT = 10;
const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const SEARCH_PROVIDERS = ["brave", "gemini"] as const;

type SearchProvider = (typeof SEARCH_PROVIDERS)[number];

function sanitizeSearchPromptLiteral(value: string, maxLength = 500): string {
	const sanitized = sanitizeForPromptLiteral(value).trim();
	if (sanitized.length <= maxLength) {
		return sanitized;
	}
	return `${sanitized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

const WebSearchSchema = Type.Object({
	query: Type.String({
		description: "Search query text. Describe what you need to find; avoid embedding tool or role instructions.",
	}),
	count: Type.Optional(
		Type.Number({
			description: "Maximum number of results to return (1-10, default 5).",
			minimum: 1,
			maximum: MAX_SEARCH_COUNT,
		}),
	),
	country: Type.Optional(
		Type.String({
			description: "Optional 2-letter country code for localized results (for example: US, HK, JP).",
		}),
	),
});

type WebSearchParams = Static<typeof WebSearchSchema>;

interface SearchResult {
	title: string;
	url: string;
	description: string;
}

interface WebSearchConfig {
	provider?: SearchProvider;
	braveApiKey?: string;
	geminiApiKey?: string;
	geminiModel?: string;
	timeoutMs?: number;
	cacheTtlMs?: number;
}

const SEARCH_CACHE = new Map<string, CacheEntry<SearchResult[]>>();

export function createWebSearchTool(config: WebSearchConfig = {}): AgentTool<typeof WebSearchSchema> {
	return {
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web and return ranked results (title, URL, snippet). " +
			"Use this for current facts and discovery, then follow up with web_fetch for exact page content when needed.",
		parameters: WebSearchSchema,
		execute: async (_toolCallId, params: WebSearchParams): Promise<AgentToolResult<unknown>> => {
			const query = params.query.trim();
			if (!query) {
				return {
					content: [{ type: "text", text: "Error: empty search query" }],
					details: { error: "empty query" },
				};
			}

			const count = Math.min(params.count ?? DEFAULT_SEARCH_COUNT, MAX_SEARCH_COUNT);
			const providerConfig = resolveSearchProvider(config);
			if ("error" in providerConfig) {
				return {
					content: [{ type: "text", text: providerConfig.error }],
					details: { error: "missing api key" },
				};
			}

			// Check cache
			const cacheKey = normalizeCacheKey(
				`${providerConfig.provider}:${providerConfig.geminiModel}:${query}:${count}:${params.country ?? ""}`,
			);
			const cached = readCache(SEARCH_CACHE, cacheKey);
			if (cached) {
				return formatResults(cached, query, true, providerConfig.provider);
			}

			// Search
			try {
				const results =
					providerConfig.provider === "gemini"
						? await searchGemini(
								providerConfig.geminiApiKey,
								providerConfig.geminiModel,
								query,
								count,
								params.country,
								config.timeoutMs,
							)
						: await searchBrave(providerConfig.braveApiKey, query, count, params.country, config.timeoutMs);
				writeCache(SEARCH_CACHE, cacheKey, results, config.cacheTtlMs);
				return formatResults(results, query, false, providerConfig.provider);
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Search error: ${msg}` }],
					details: { error: msg },
				};
			}
		},
	};
}

function normalizeApiKey(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized ? normalized : undefined;
}

function normalizeProvider(value: unknown): SearchProvider | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return SEARCH_PROVIDERS.includes(normalized as SearchProvider)
		? (normalized as SearchProvider)
		: undefined;
}

function resolveSearchProvider(
	config: WebSearchConfig,
):
	| {
			provider: "brave";
			braveApiKey: string;
			geminiApiKey?: string;
			geminiModel: string;
	  }
	| {
			provider: "gemini";
			braveApiKey?: string;
			geminiApiKey: string;
			geminiModel: string;
	  }
	| {
			error: string;
	  } {
	const forcedProvider = normalizeProvider(config.provider ?? process.env.UNDERSTUDY_WEB_SEARCH_PROVIDER);
	const braveApiKey = normalizeApiKey(config.braveApiKey ?? process.env.BRAVE_API_KEY);
	const geminiApiKey = normalizeApiKey(config.geminiApiKey ?? process.env.GEMINI_API_KEY);
	const geminiModel =
		(config.geminiModel ?? process.env.UNDERSTUDY_GEMINI_WEB_MODEL ?? DEFAULT_GEMINI_MODEL).trim() ||
		DEFAULT_GEMINI_MODEL;

	if (forcedProvider === "brave") {
		if (!braveApiKey) {
			return { error: "Error: web_search provider=brave requires BRAVE_API_KEY." };
		}
		return { provider: "brave", braveApiKey, geminiApiKey, geminiModel };
	}
	if (forcedProvider === "gemini") {
		if (!geminiApiKey) {
			return { error: "Error: web_search provider=gemini requires GEMINI_API_KEY." };
		}
		return { provider: "gemini", braveApiKey, geminiApiKey, geminiModel };
	}

	// Auto-detect: prefer Brave first for ranked result fidelity, then Gemini.
	if (braveApiKey) {
		return { provider: "brave", braveApiKey, geminiApiKey, geminiModel };
	}
	if (geminiApiKey) {
		return { provider: "gemini", braveApiKey, geminiApiKey, geminiModel };
	}

	return {
		error:
			"Error: No web search API key configured. Set BRAVE_API_KEY or GEMINI_API_KEY (optionally UNDERSTUDY_WEB_SEARCH_PROVIDER=brave|gemini).",
	};
}

async function searchBrave(
	apiKey: string,
	query: string,
	count: number,
	country?: string,
	timeoutMs?: number,
): Promise<SearchResult[]> {
	const url = new URL(BRAVE_SEARCH_ENDPOINT);
	url.searchParams.set("q", query);
	url.searchParams.set("count", String(count));
	if (country) {
		url.searchParams.set("country", country);
	}

	const response = await fetchWithTimeout(
		url.toString(),
		{
			headers: {
				Accept: "application/json",
				"Accept-Encoding": "gzip",
				"X-Subscription-Token": apiKey,
			},
		},
		timeoutMs ?? 30_000,
	);

	if (!response.ok) {
		throw new Error(`Brave API error: ${response.status} ${response.statusText}`);
	}

	const body = JSON.parse(await readResponseText(response));
	const webResults = body?.web?.results ?? [];

	return webResults.map((r: any) => ({
		title: r.title ?? "",
		url: r.url ?? "",
		description: r.description ?? "",
	}));
}

interface GeminiGroundingResponse {
	candidates?: Array<{
		content?: {
			parts?: Array<{ text?: string }>;
		};
		groundingMetadata?: {
			groundingChunks?: Array<{
				web?: {
					uri?: string;
					title?: string;
				};
			}>;
		};
	}>;
	error?: {
		code?: number;
		message?: string;
		status?: string;
	};
}

async function searchGemini(
	apiKey: string,
	model: string,
	query: string,
	count: number,
	country?: string,
	timeoutMs?: number,
): Promise<SearchResult[]> {
	const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`;
	const sanitizedQuery = sanitizeSearchPromptLiteral(query);
	const sanitizedCountry = country ? sanitizeSearchPromptLiteral(country, 16) : undefined;
	const prompt = [
		`Search the web for: ${sanitizedQuery}`,
		sanitizedCountry ? `Prioritize sources relevant to country code ${sanitizedCountry}.` : "",
		"Return concise findings with reliable, citable sources.",
	]
		.filter(Boolean)
		.join("\n");

	const response = await fetchWithTimeout(
		url,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-goog-api-key": apiKey,
			},
			body: JSON.stringify({
				contents: [{ parts: [{ text: prompt }] }],
				tools: [{ google_search: {} }],
			}),
		},
		timeoutMs ?? 30_000,
	);

	if (!response.ok) {
		const detail = await readResponseText(response).catch(() => "");
		throw new Error(`Gemini API error: ${response.status} ${response.statusText}${detail ? ` (${detail})` : ""}`);
	}

	const body = JSON.parse(await readResponseText(response)) as GeminiGroundingResponse;
	if (body.error) {
		const msg = body.error.message ?? body.error.status ?? "unknown error";
		throw new Error(`Gemini API error: ${msg}`);
	}

	const candidate = body.candidates?.[0];
	const summary = (candidate?.content?.parts ?? [])
		.map((part) => part.text?.trim() ?? "")
		.filter(Boolean)
		.join("\n");

	const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
	const seenUrls = new Set<string>();
	const results: SearchResult[] = [];

	for (const chunk of chunks) {
		const url = chunk.web?.uri?.trim();
		if (!url || seenUrls.has(url)) continue;
		seenUrls.add(url);
		results.push({
			title: chunk.web?.title?.trim() || inferTitleFromUrl(url),
			url,
			description: summarizeGeminiText(summary),
		});
		if (results.length >= count) break;
	}

	if (results.length > 0) {
		return results;
	}

	if (summary) {
		return [
			{
				title: "Gemini synthesis",
				url: "",
				description: summarizeGeminiText(summary),
			},
		];
	}

	return [];
}

function inferTitleFromUrl(url: string): string {
	try {
		const host = new URL(url).hostname;
		return host || "Untitled";
	} catch {
		return "Untitled";
	}
}

function summarizeGeminiText(text: string): string {
	const cleaned = text.replace(/\s+/g, " ").trim();
	if (!cleaned) return "Source discovered via Gemini grounding.";
	if (cleaned.length <= 280) return cleaned;
	return `${cleaned.slice(0, 277)}...`;
}

function formatResults(
	results: SearchResult[],
	query: string,
	fromCache: boolean,
	provider: SearchProvider,
): AgentToolResult<unknown> {
	if (results.length === 0) {
		return {
			content: [{ type: "text", text: `No results found for: ${query}` }],
			details: { resultCount: 0, fromCache, provider },
		};
	}

	const formatted = results
		.map((r, i) => {
			const lines = [`${i + 1}. **${r.title || "Untitled"}**`];
			if (r.url) lines.push(`   ${r.url}`);
			if (r.description) lines.push(`   ${r.description}`);
			return lines.join("\n");
		})
		.join("\n\n");

	const text = wrapWebContent(formatted, `web_search:${provider}: ${query}`);

	return {
		content: [{ type: "text", text }],
		details: { resultCount: results.length, fromCache, provider },
	};
}
