import { AuthManager } from "@understudy/core";
import type { UnderstudyConfig } from "@understudy/types";
import { getModel } from "@mariozechner/pi-ai";

export const CLI_MODEL_FORMAT_ERROR =
	"Format: provider/model-id (e.g., openai-codex/gpt-5.4)";
export const CLI_THINKING_LEVEL_ERROR =
	"Thinking level must be one of: off|minimal|low|medium|high|xhigh";

export const BUILTIN_MODELS: Record<string, string[]> = {
	anthropic: [
		"claude-opus-4-20250514",
		"claude-sonnet-4-6",
		"claude-haiku-4-20250414",
		"claude-3-5-sonnet-20241022",
	],
	"openai-codex": [
		"gpt-5.4",
	],
	openai: [
		"gpt-4o",
		"gpt-4o-mini",
		"gpt-4-turbo",
		"o1",
		"o1-mini",
	],
	google: [
		"gemini-2.0-flash",
		"gemini-2.0-pro",
		"gemini-1.5-pro",
	],
	minimax: [
		"MiniMax-M2.5",
		"MiniMax-M2.5-highspeed",
	],
};

export function parseModelRef(modelSpec: string | undefined): { provider: string; modelId: string } | undefined {
	const normalized = modelSpec?.trim();
	if (!normalized) {
		return undefined;
	}
	const slash = normalized.indexOf("/");
	if (slash <= 0 || slash === normalized.length - 1) {
		return undefined;
	}
	return {
		provider: normalized.slice(0, slash),
		modelId: normalized.slice(slash + 1),
	};
}

export function resolveCliModel(modelSpec: string | undefined) {
	const parsed = parseModelRef(modelSpec);
	if (!parsed) {
		return undefined;
	}
	const authManager = AuthManager.create();
	return authManager.findModel(parsed.provider, parsed.modelId)
		?? getModel(parsed.provider as any, parsed.modelId as any);
}

export function resolveCliModelOrThrow(modelSpec: string | undefined) {
	if (!modelSpec) {
		return undefined;
	}
	try {
		const resolved = resolveCliModel(modelSpec);
		if (resolved) {
			return resolved;
		}
	} catch {
		// Fall through to the formatted error below.
	}
	throw new Error(`Unknown model: ${modelSpec}\n${CLI_MODEL_FORMAT_ERROR}`);
}

export function mergeKnownModels(
	baseModels: Record<string, string[]>,
): Record<string, string[]> {
	const merged = new Map<string, Set<string>>();
	for (const [provider, models] of Object.entries(baseModels)) {
		merged.set(provider, new Set(models));
	}
	const authManager = AuthManager.create();
	for (const model of authManager.getAvailableModels()) {
		const provider = model.provider.trim();
		const id = model.id.trim();
		if (!provider || !id) {
			continue;
		}
		if (!merged.has(provider)) {
			merged.set(provider, new Set());
		}
		merged.get(provider)!.add(id);
	}
	return Object.fromEntries(
		Array.from(merged.entries())
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([provider, models]) => [provider, Array.from(models).sort()]),
	);
}

export function parseThinkingLevel(
	value: string | undefined,
): UnderstudyConfig["defaultThinkingLevel"] | undefined {
	const normalized = value?.trim().toLowerCase();
	switch (normalized) {
		case undefined:
		case "":
			return undefined;
		case "off":
		case "minimal":
		case "low":
		case "medium":
		case "high":
		case "xhigh":
			return normalized;
		default:
			throw new Error(CLI_THINKING_LEVEL_ERROR);
	}
}

export function buildGatewayConfigOverride(
	modelSpec: string | undefined,
	thinkingSpec: string | undefined,
): Partial<UnderstudyConfig> | undefined {
	const override: Partial<UnderstudyConfig> = {};
	if (modelSpec) {
		const parsed = parseModelRef(modelSpec);
		if (!parsed) {
			throw new Error(CLI_MODEL_FORMAT_ERROR);
		}
		override.defaultProvider = parsed.provider;
		override.defaultModel = parsed.modelId;
	}
	const thinkingLevel = parseThinkingLevel(thinkingSpec);
	if (thinkingLevel) {
		override.defaultThinkingLevel = thinkingLevel;
	}
	return Object.keys(override).length > 0 ? override : undefined;
}
