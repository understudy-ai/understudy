import type { Attachment, UnderstudyConfig } from "@understudy/types";
import type {
	SubagentCleanupMode,
	SubagentMode,
	SubagentRuntime,
} from "./subagent-registry.js";

const ALLOWED_THINKING_LEVELS = new Set([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
]);

export interface SpawnSubagentParams {
	parentSessionId: string;
	task: string;
	label?: string;
	runtime?: string;
	agentId?: string;
	model?: string;
	thinking?: string;
	cwd?: string;
	thread?: boolean;
	mode?: string;
	cleanup?: string;
	sandbox?: string;
	sessionId?: string;
	timeoutMs?: number;
	runTimeoutSeconds?: number;
	attachments?: Attachment[];
}

export interface ResolvedSubagentAgentTarget {
	agentId: string;
	workspaceDir?: string;
	model?: string;
}

export interface SubagentSpawnPlan {
	runtime: SubagentRuntime;
	mode: SubagentMode;
	cleanup: SubagentCleanupMode;
	threadRequested: boolean;
	workspaceDir?: string;
	configOverride?: Partial<UnderstudyConfig>;
}

function resolveSubagentMode(
	value: string | undefined,
	threadRequested: boolean,
): SubagentMode {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) {
		return threadRequested ? "session" : "run";
	}
	if (normalized === "session" || normalized === "run") {
		return normalized;
	}
	throw new Error('mode must be "run" or "session"');
}

function resolveSubagentCleanup(
	value: string | undefined,
): SubagentCleanupMode {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) {
		return "keep";
	}
	if (normalized === "keep" || normalized === "delete") {
		return normalized;
	}
	throw new Error('cleanup must be "keep" or "delete"');
}

function resolveSubagentRuntime(
	value: string | undefined,
): SubagentRuntime {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) {
		return "subagent";
	}
	if (normalized === "subagent" || normalized === "acp") {
		return normalized;
	}
	throw new Error('runtime must be "subagent" or "acp"');
}

function splitModelRef(
	value: string | undefined,
): { provider?: string; model?: string } {
	const trimmed = value?.trim();
	if (!trimmed) {
		return {};
	}
	const slashIndex = trimmed.indexOf("/");
	if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) {
		return { model: trimmed };
	}
	return {
		provider: trimmed.slice(0, slashIndex),
		model: trimmed.slice(slashIndex + 1),
	};
}

function buildSubagentConfigOverride(params: {
	model?: string;
	thinking?: string;
	runtime: SubagentRuntime;
	sandbox?: string;
}): Partial<UnderstudyConfig> | undefined {
	const override: Partial<UnderstudyConfig> = {};
	const modelRef = splitModelRef(params.model);
	if (modelRef.provider) {
		override.defaultProvider = modelRef.provider;
	}
	if (modelRef.model) {
		override.defaultModel = modelRef.model;
	}
	const thinking = normalizeSubagentThinkingLevel(params.thinking);
	if (thinking) {
		override.defaultThinkingLevel = thinking;
	}
	if (params.runtime === "acp") {
		override.agent = Object.assign({}, override.agent, {
			runtimeBackend: "acp",
		}) as UnderstudyConfig["agent"];
	}
	if (params.sandbox === "require") {
		override.agent = Object.assign({}, override.agent, {
			sandbox: {
				...override.agent?.sandbox,
				mode: "strict",
			},
		}) as UnderstudyConfig["agent"];
	}
	return Object.keys(override).length > 0 ? override : undefined;
}

function normalizeSubagentThinkingLevel(
	value: string | undefined,
): UnderstudyConfig["defaultThinkingLevel"] | undefined {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) {
		return undefined;
	}
	if (!ALLOWED_THINKING_LEVELS.has(normalized)) {
		throw new Error('thinking must be one of "off", "minimal", "low", "medium", "high", or "xhigh"');
	}
	return normalized as UnderstudyConfig["defaultThinkingLevel"];
}

export function resolveSubagentSpawnPlan(params: {
	request: Pick<
		SpawnSubagentParams,
		"runtime" | "mode" | "cleanup" | "thread" | "model" | "thinking" | "cwd" | "sandbox" | "agentId"
	>;
	agentTarget?: ResolvedSubagentAgentTarget | null;
}): SubagentSpawnPlan {
	const runtime = resolveSubagentRuntime(params.request.runtime);
	const threadRequested = params.request.thread === true;
	const mode = resolveSubagentMode(params.request.mode, threadRequested);
	const cleanup = resolveSubagentCleanup(params.request.cleanup);
	const sandbox = params.request.sandbox?.trim();
	if (sandbox && sandbox !== "inherit" && sandbox !== "require") {
		throw new Error('sandbox must be "inherit" or "require"');
	}
	if (runtime === "acp" && threadRequested) {
		throw new Error('runtime="acp" does not support `thread=true` yet; use runtime="subagent" or omit `thread`.');
	}
	if (runtime === "acp" && sandbox === "require") {
		throw new Error('runtime="acp" does not support `sandbox="require"`; use runtime="subagent" or keep sandbox inheritance.');
	}
	if (params.request.agentId && !params.agentTarget) {
		throw new Error(`Unknown agentId "${params.request.agentId}".`);
	}
	const resolvedModel = params.request.model?.trim() || params.agentTarget?.model?.trim();
	return {
		runtime,
		mode,
		cleanup,
		threadRequested,
		workspaceDir: params.request.cwd?.trim() || params.agentTarget?.workspaceDir?.trim(),
		configOverride: buildSubagentConfigOverride({
			model: resolvedModel,
			thinking: params.request.thinking,
			runtime,
			sandbox,
		}),
	};
}
