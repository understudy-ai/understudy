/**
 * Understudy runtime orchestrator.
 * Central place to build tools + prompt and start a runtime adapter session.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Model, type ThinkingLevel } from "@mariozechner/pi-ai";
import type { AgentMessage, AgentTool } from "@mariozechner/pi-agent-core";
import type { ToolEntry, UnderstudyConfig } from "@understudy/types";
import { ConfigManager } from "../config.js";
import { ToolRegistry } from "../tool-registry.js";
import { TrustEngine } from "../trust-engine.js";
import {
	buildUnderstudySystemPrompt,
	type ContextFile,
	type PromptMode,
	type SystemPromptOptions,
} from "../system-prompt.js";
import { buildSystemPromptParams } from "../system-prompt-params.js";
import { buildToolSummaryMap } from "../tool-summaries.js";
import {
	buildUnderstudyPromptReport,
	type UnderstudyPromptReport,
	type UnderstudySessionMeta,
} from "../prompt-report.js";
import {
	createOpenClawCompatibilityToolAliases,
	filterOpenClawCompatibilityToolNames,
	shouldHideOpenClawCompatibilityToolName,
} from "../openclaw-compat.js";
import { createLogger } from "../logger.js";
import type {
	RuntimeAdapter,
	RuntimeCreateSessionResult,
	RuntimeSessionManager,
	RuntimeToolDefinition,
} from "./types.js";
import { buildWorkspaceSkillSnapshot } from "../skills/workspace.js";
import {
	buildTaughtTaskDraftPromptContent,
	loadPersistedTaughtTaskDraftLedger,
} from "../task-drafts.js";
import {
	type RuntimeProfile,
} from "./identity-policy.js";
import { applySystemPromptOverrideToSession } from "./system-prompt-override.js";
import { buildPreflightPromptContent, runRuntimePreflight } from "./preflight.js";
import {
	wrapToolsWithWatchdog,
} from "./tool-watchdog.js";
import {
	installToolResultContextGuard,
	recoverContextAfterOverflowInPlace,
} from "./tool-result-context-guard.js";
import {
	RuntimePolicyPipeline,
	wrapToolsWithPolicyPipeline,
	type RuntimePolicy,
} from "./policy-pipeline.js";
import {
	wrapToolsWithExecutionTrace,
	type UnderstudySessionToolEvent,
} from "./tool-execution-trace.js";
import {
	createDefaultRuntimePolicyRegistry,
	type RuntimePolicyRegistry,
} from "./policy-registry.js";
import { ensureRuntimeEngineAgentDirEnv, resolveUnderstudyAgentDir } from "../runtime-paths.js";
import { createSandboxBashSpawnHook } from "./sandbox-bash-hook.js";
import {
	resolveRuntimeModelCandidates,
	type RuntimeResolvedModelCandidate,
} from "./bridge/model-resolution-bridge.js";
import { prepareRuntimeAuthContext } from "../auth.js";
import { resolveWorkspaceContext } from "../workspace-context.js";
import { getModel } from "@mariozechner/pi-ai";
import {
	buildPromptImageModeGuidance,
	preparePromptImageSupport,
	resolvePromptImageSupportMode,
} from "./prompt-image-support.js";

export interface UnderstudySessionPromptBuiltEvent {
	config: UnderstudyConfig;
	systemPrompt: string;
	promptReport: UnderstudyPromptReport;
	sessionMeta: UnderstudySessionMeta;
}

export interface UnderstudySessionCreatedEvent extends UnderstudySessionPromptBuiltEvent {
	session: RuntimeCreateSessionResult["session"];
	runtimeSession: RuntimeCreateSessionResult["runtimeSession"];
	extensionsResult?: unknown;
}

export interface UnderstudySessionAssistantReplyEvent {
	message: AgentMessage;
	sessionMeta: UnderstudySessionMeta;
}

export interface UnderstudySessionClosedEvent {
	sessionMeta: UnderstudySessionMeta;
}

export interface UnderstudySessionLifecycleHooks {
	onPromptBuilt?(
		event: UnderstudySessionPromptBuiltEvent,
	): Promise<void> | void;
	onSessionCreated?(
		event: UnderstudySessionCreatedEvent,
	): Promise<void> | void;
	onAssistantReply?(
		event: UnderstudySessionAssistantReplyEvent,
	): Promise<void> | void;
	onToolEvent?(
		event: UnderstudySessionToolEvent,
	): Promise<void> | void;
	onSessionClosed?(
		event: UnderstudySessionClosedEvent,
	): Promise<void> | void;
}

export interface UnderstudySessionOptions {
	/** Path to config file */
	configPath?: string;
	/** In-memory config (overrides configPath) */
	config?: Partial<UnderstudyConfig>;
	/** Working directory */
	cwd?: string;
	/** Explicit model to use */
	model?: Model<any>;
	/** Thinking level */
	thinkingLevel?: ThinkingLevel;
	/** Additional custom tools (AgentTool format) */
	extraTools?: AgentTool<any>[];
	/** Optional allowlist of tool names exposed to the runtime session */
	allowedToolNames?: string[];
	/** Custom approval handler */
	onApprovalRequired?: (toolName: string, params?: unknown) => Promise<boolean>;
	/** Disable specific tool categories */
	disableCategories?: string[];
	/** Explicit session manager for resume/branch control */
	sessionManager?: RuntimeSessionManager;
	/** Runtime storage directory for auth/settings/models/sessions */
	agentDir?: string;
	/** Channel name for runtime info (e.g., "web", "telegram") */
	channel?: string;
	/** Channel capabilities for runtime info */
	capabilities?: string[];
	/** System prompt mode override */
	promptMode?: PromptMode;
	/** Extra system prompt context appended after the base sections */
	extraSystemPrompt?: string;
	/** Optional reaction guidance for the current runtime/channel */
	reactionGuidance?: SystemPromptOptions["reactionGuidance"];
	/** Whether to include reasoning format guidance */
	reasoningTagHint?: boolean;
	/** Reasoning behavior hint shown in the prompt */
	reasoningLevel?: string;
	/** Optional sandbox runtime info exposed in the prompt */
	sandboxInfo?: SystemPromptOptions["sandboxInfo"];
	/** Runtime behavior profile */
	runtimeProfile?: RuntimeProfile;
	/** Runtime backend hint (resolved by createUnderstudySession entrypoint). */
	runtimeBackend?: "embedded" | "acp";
	/** Additional runtime policies appended after the built-in defaults */
	runtimePolicies?: RuntimePolicy[];
	/** Runtime policy registry override (used for custom module registration/testing) */
	runtimePolicyRegistry?: RuntimePolicyRegistry;
	/** Optional lifecycle hooks for prompt/session/reply/close events */
	lifecycleHooks?: UnderstudySessionLifecycleHooks;
}

function mergeAgentMessage(target: AgentMessage, source: AgentMessage): AgentMessage {
	return Object.assign(target, source);
}

export interface UnderstudySessionResult extends RuntimeCreateSessionResult {
	config: UnderstudyConfig;
	toolRegistry: ToolRegistry;
	sessionMeta: UnderstudySessionMeta;
}

const logger = createLogger("UnderstudySession");

/**
 * Convert an AgentTool to a runtime tool-definition compatible with adapter customTools.
 * Runtime tool execute supports an optional extra `context` parameter; AgentTool ignores it.
 */
function agentToolToDefinition(tool: AgentTool<any>): RuntimeToolDefinition {
	return {
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
		execute: async (toolCallId, params, signal, onUpdate, _ctx) => {
			return tool.execute(toolCallId, params, signal, onUpdate);
		},
	};
}

function isHiddenCompatibilityToolDefinition(name: string, presentToolNames: string[]): boolean {
	return shouldHideOpenClawCompatibilityToolName(name, presentToolNames);
}

function describeUnknownError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function resolveErrorStatusCode(error: unknown): number | undefined {
	if (!error || typeof error !== "object") {
		return undefined;
	}
	const direct = (error as { status?: unknown; statusCode?: unknown; code?: unknown });
	for (const candidate of [direct.status, direct.statusCode, direct.code]) {
		if (typeof candidate === "number" && Number.isFinite(candidate)) {
			return candidate;
		}
		if (typeof candidate === "string" && /^\d{3}$/.test(candidate.trim())) {
			return Number(candidate);
		}
	}
	const nested = (error as { response?: { status?: unknown } }).response?.status;
	if (typeof nested === "number" && Number.isFinite(nested)) {
		return nested;
	}
	if (typeof nested === "string" && /^\d{3}$/.test(nested.trim())) {
		return Number(nested);
	}
	return undefined;
}

function isRetryableRuntimeSessionCreationError(error: unknown): boolean {
	const status = resolveErrorStatusCode(error);
	if (
		typeof status === "number" &&
		(status === 401 ||
			status === 403 ||
			status === 404 ||
			status === 408 ||
			status === 409 ||
			status === 422 ||
			status === 429 ||
			status >= 500)
	) {
		return true;
	}

	const message = describeUnknownError(error).toLowerCase();
	return [
		"unauthorized",
		"forbidden",
		"authentication",
		"auth",
		"api key",
		"credential",
		"oauth",
		"token",
		"rate limit",
		"quota",
		"model not found",
		"unknown model",
		"unsupported model",
		"provider not found",
		"no model",
		"not available",
		"temporarily unavailable",
		"overloaded",
		"timeout",
	].some((fragment) => message.includes(fragment));
}

function isContextWindowOverflowError(error: unknown): boolean {
	const status = resolveErrorStatusCode(error);
	if (status === 400 || status === 413 || status === 422 || status === 429) {
		return true;
	}

	const message = describeUnknownError(error).toLowerCase();
	return [
		"context length",
		"context window",
		"maximum context length",
		"maximum context size",
		"prompt is too long",
		"input is too long",
		"too many tokens",
		"token limit",
		"context limit",
		"request too large",
	].some((fragment) => message.includes(fragment));
}

function isRetryablePromptDispatchError(error: unknown): boolean {
	const status = resolveErrorStatusCode(error);
	if (
		typeof status === "number" &&
		(status === 408 || status === 409 || status === 425 || status === 429 || status >= 500)
	) {
		return true;
	}

	const message = describeUnknownError(error).toLowerCase();
	return [
		"server_error",
		"internal server error",
		"temporarily unavailable",
		"temporary outage",
		"overloaded",
		"try again",
		"connection reset",
		"connection aborted",
		"socket hang up",
		"fetch failed",
		"econnreset",
		"etimedout",
	].some((fragment) => message.includes(fragment));
}

function promptRetryBackoffMs(attempt: number): number {
	return attempt <= 1 ? 500 : 1_500;
}

async function runLifecycleHook<TEvent>(
	name: keyof UnderstudySessionLifecycleHooks,
	hook: ((event: TEvent) => Promise<void> | void) | undefined,
	event: TEvent,
): Promise<void> {
	if (!hook) {
		return;
	}
	try {
		await hook(event);
	} catch (error) {
		logger.warn(`Runtime lifecycle hook "${String(name)}" failed: ${String(error)}`);
	}
}

async function createRuntimeSessionWithModelFallback(params: {
	adapter: RuntimeAdapter;
	cwd: string;
	agentDir: string;
	authContext: ReturnType<typeof prepareRuntimeAuthContext>;
	initialModel: Model<any> | undefined;
	initialModelLabel: string;
	candidates: RuntimeResolvedModelCandidate[];
	thinkingLevel: ThinkingLevel | undefined;
	customTools: RuntimeToolDefinition[];
	sessionManager?: RuntimeSessionManager;
	acpConfig?: UnderstudyConfig["agent"]["acp"];
	onModelLabelResolved?: (modelLabel: string) => void;
	explicitModelRequested: boolean;
}): Promise<{
	sessionResult: RuntimeCreateSessionResult;
	model: Model<any> | undefined;
	modelLabel: string;
	fallbackUsed: boolean;
}> {
	const fallbackCandidates =
		params.candidates.length > 0
			? params.candidates
			: [
				{
					model: params.initialModel as Model<any>,
					modelLabel: params.initialModelLabel,
					provider: params.initialModel?.provider ?? "",
					modelId: params.initialModel?.id ?? "",
					source: "default" as const,
				},
			];

	let lastError: unknown;
	for (let index = 0; index < fallbackCandidates.length; index += 1) {
		const candidate = fallbackCandidates[index];
		params.onModelLabelResolved?.(candidate.modelLabel);
		try {
			const sessionResult = await params.adapter.createSession({
				cwd: params.cwd,
				agentDir: params.agentDir,
				authStorage: params.authContext.authStorage,
				modelRegistry: params.authContext.modelRegistry,
				model: candidate.model,
				thinkingLevel: params.thinkingLevel,
				customTools: params.customTools,
				sessionManager: params.sessionManager,
				acpConfig: params.acpConfig,
			});
			return {
				sessionResult,
				model: candidate.model,
				modelLabel: candidate.modelLabel,
				fallbackUsed: index > 0,
			};
		} catch (error) {
			lastError = error;
			const canRetry =
				!params.explicitModelRequested &&
				index < fallbackCandidates.length - 1 &&
				isRetryableRuntimeSessionCreationError(error);
			if (!canRetry) {
				throw error;
			}
			const next = fallbackCandidates[index + 1];
			logger.warn(
				`Runtime session creation failed for ${candidate.modelLabel}: ${describeUnknownError(error)}. Retrying with ${next.modelLabel}.`,
			);
		}
	}

	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function createUnderstudySessionWithRuntime(
	adapter: RuntimeAdapter,
	opts: UnderstudySessionOptions = {},
): Promise<UnderstudySessionResult> {
	// Load config
	const configManager = opts.config
		? ConfigManager.inMemory(opts.config)
		: await ConfigManager.load(opts.configPath);
	const config = configManager.get();

	const workspaceContext = resolveWorkspaceContext({
		requestedWorkspaceDir: opts.cwd,
		configuredRepoRoot: config.agent.repoRoot,
		fallbackWorkspaceDir: process.cwd(),
	});
	const cwd = workspaceContext.workspaceDir;
	const agentDir = ensureRuntimeEngineAgentDirEnv(resolveUnderstudyAgentDir(opts.agentDir));
	const runtimeProfile = opts.runtimeProfile ?? config.agent.runtimeProfile ?? "assistant";
	const authContext = prepareRuntimeAuthContext({ agentDir });
	const modelCandidates = resolveRuntimeModelCandidates({
		explicitModel: opts.model,
		defaultProvider: config.defaultProvider,
		defaultModel: config.defaultModel,
		modelFallbacks: config.agent.modelFallbacks,
		resolveModel: (provider, modelId) =>
			authContext.modelRegistry.find(provider, modelId) ??
			getModel(provider as any, modelId as any),
	});
	const resolvedModel = opts.model
		? {
			model: modelCandidates.candidates[0]?.model ?? opts.model,
			modelLabel: modelCandidates.modelLabelFallback,
			source: "explicit" as const,
			attempts: modelCandidates.attempts,
		}
		: modelCandidates.candidates[0]
			? {
				model: modelCandidates.candidates[0].model,
				modelLabel: modelCandidates.candidates[0].modelLabel,
				source: modelCandidates.candidates[0].source,
				attempts: modelCandidates.attempts,
			}
			: {
				model: undefined,
				modelLabel: modelCandidates.modelLabelFallback,
				source: "default_label_only" as const,
				attempts: modelCandidates.attempts,
			};
	let model = resolvedModel.model;
	let modelLabel = resolvedModel.modelLabel;
	if (!model && resolvedModel.source !== "explicit") {
		logger.warn("Could not resolve configured model chain, will let createAgentSession handle it", {
			attempts: resolvedModel.attempts,
		});
	}

		// Set up the registry with builtin tools plus any runtime-specific extras.
		const toolRegistry = new ToolRegistry();
	toolRegistry.registerBuiltins(cwd, {
		bashSpawnHook: createSandboxBashSpawnHook(config, logger),
	});

	// Register extra AgentTools (if any)
	if (opts.extraTools) {
		for (const tool of opts.extraTools) {
			toolRegistry.register(tool);
		}
	}
	for (const tool of createOpenClawCompatibilityToolAliases(toolRegistry.getTools())) {
		toolRegistry.register(tool);
	}

	const allowedToolNameSet = new Set(
		(opts.allowedToolNames ?? [])
			.map((value) => value.trim())
			.filter(Boolean),
	);
	const filterAllowedToolEntries = (entries: ToolEntry[]): ToolEntry[] =>
		allowedToolNameSet.size > 0
			? entries.filter((entry) => allowedToolNameSet.has(entry.tool.name))
			: entries;

	// Set up trust engine
	const trustEngine = new TrustEngine({
		policies: config.tools.policies,
		autoApproveReadOnly: config.tools.autoApproveReadOnly,
		onApprovalRequired: opts.onApprovalRequired,
	});

	// Wrap all registered tools with trust gating.
	const trustedTools = trustEngine.wrapTools(filterAllowedToolEntries(toolRegistry.getEntries()));
	const preflight = runRuntimePreflight({
		profile: runtimeProfile,
		toolNames: trustedTools.map((tool) => tool.name),
	});
	for (const warning of preflight.warnings) {
		logger.warn(warning);
	}

	// Runtime watchdog enforces timeouts and preflight tool availability.
	const guardedTools = wrapToolsWithWatchdog(trustedTools, {
		runtimeProfile,
		preflight,
	});

	const runtimePolicyContext = {
		runtimeProfile,
		modelLabel,
		cwd,
		config,
	};
	const runtimePolicyRegistry =
		opts.runtimePolicyRegistry ??
		createDefaultRuntimePolicyRegistry({
			onModuleMissing: (moduleName) => {
				logger.warn(`Runtime policy module not found: ${moduleName}`);
			},
		});
	const configuredPolicies = await runtimePolicyRegistry.build({
		context: runtimePolicyContext,
		config: config.agent.runtimePolicies,
	});

	const policyPipeline = new RuntimePolicyPipeline({
		context: runtimePolicyContext,
		policies: [
			...configuredPolicies.policies,
			...(opts.runtimePolicies ?? []),
		],
		onPolicyError: (policyName, phase, error) => {
			logger.warn(`Runtime policy "${policyName}" failed during ${phase}: ${String(error)}`);
		},
	});
	const policyWrappedTools = wrapToolsWithPolicyPipeline(guardedTools, policyPipeline);
	let sessionMetaRef: UnderstudySessionMeta | undefined;
	const traceWrappedTools = wrapToolsWithExecutionTrace(policyWrappedTools, {
		onEvent: async (event) => {
			await runLifecycleHook("onToolEvent", opts.lifecycleHooks?.onToolEvent, event);
		},
		getSessionMeta: () => sessionMetaRef,
	});
	const customToolDefs: RuntimeToolDefinition[] = traceWrappedTools.map(agentToolToDefinition);

	const resolvedThinkingLevel =
		opts.thinkingLevel ??
		(config.defaultThinkingLevel === "off"
			? undefined
			: (config.defaultThinkingLevel as ThinkingLevel));

	// Create session via runtime adapter, retrying through the configured model
	// fallback chain only for model/auth-class failures.
	const sessionCreation = await createRuntimeSessionWithModelFallback({
		adapter,
		cwd,
		agentDir,
		authContext,
		initialModel: model,
		initialModelLabel: modelLabel,
		candidates: modelCandidates.candidates,
		thinkingLevel: resolvedThinkingLevel,
		customTools: customToolDefs,
		sessionManager: opts.sessionManager,
		acpConfig: config.agent.acp,
		onModelLabelResolved: (nextLabel) => {
			runtimePolicyContext.modelLabel = nextLabel;
		},
		explicitModelRequested: Boolean(opts.model),
	});
	const sessionResult = sessionCreation.sessionResult;
	model = sessionCreation.model;
	modelLabel = sessionCreation.modelLabel;
	runtimePolicyContext.modelLabel = modelLabel;

	const { session, runtimeSession } = sessionResult;

	// Build runtime parameters (OS, arch, timezone, git root, model info)
	const runtimeCapabilities = Array.from(
		new Set(filterOpenClawCompatibilityToolNames([
			...(opts.capabilities ?? []),
			...preflight.enabledToolNames,
		])),
	);
	const runtimeParams = buildSystemPromptParams({
		model: modelLabel,
		defaultModel: `${config.defaultProvider}/${config.defaultModel}`,
		channel: opts.channel,
		capabilities: runtimeCapabilities,
		workspaceDir: cwd,
		cwd,
		userTimezone: config.agent.userTimezone,
		repoRoot: workspaceContext.repoRoot ?? config.agent.repoRoot,
	});

	// Build dynamic tool summaries from AgentTool descriptions
	const toolSummaries = buildToolSummaryMap(policyWrappedTools);

	// Load project context files (SOUL.md, AGENTS.md, etc.)
	const contextFiles = loadContextFiles(cwd, config.agent.contextFiles);

	// Load skills via workspace snapshot resolver with precedence/limit controls.
	const skillsSnapshot = buildWorkspaceSkillSnapshot({
		workspaceDir: cwd,
		config,
	});

	const advertisedToolNames = Array.from(
		new Set(filterOpenClawCompatibilityToolNames(preflight.enabledToolNames)),
	);
	const modelFallbackSection = buildModelFallbackPromptContent(config.agent.modelFallbacks);
	const taughtDraftLedger = cwd
		? await loadPersistedTaughtTaskDraftLedger({ workspaceDir: cwd }).catch(() => undefined)
		: undefined;
	const taughtDraftPromptContent = buildTaughtTaskDraftPromptContent(taughtDraftLedger);
	const promptImageMode = resolvePromptImageSupportMode(model);
	const promptImageGuidance = buildPromptImageModeGuidance(promptImageMode);

	// Build and set Understudy system prompt
	const baseSystemPromptOptions: SystemPromptOptions = {
		identity: config.agent.identity,
		toolNames: advertisedToolNames,
		toolSummaries,
		skills: skillsSnapshot.resolvedSkills,
		cwd,
		safetyInstructions: config.agent.safetyInstructions,
		promptMode: opts.promptMode ?? (config.agent.promptMode as PromptMode | undefined) ?? "full",
		runtimeInfo: runtimeParams.runtimeInfo,
		userTimezone: runtimeParams.userTimezone,
		userTime: runtimeParams.userTime,
		defaultThinkLevel: config.defaultThinkingLevel,
		ownerIds: config.agent.ownerIds,
		ownerDisplay: config.agent.ownerDisplay,
		ownerDisplaySecret: config.agent.ownerDisplaySecret,
		contextFiles,
		memoryCitationsMode: config.agent.memoryCitationsMode,
		heartbeatPrompt: config.agent.heartbeatPrompt,
		ttsHint: config.agent.ttsHint,
		docsUrl: config.agent.docsUrl,
		modelAliasLines: config.agent.modelAliasLines,
		extraSystemPrompt: opts.extraSystemPrompt,
		reactionGuidance: opts.reactionGuidance,
		reasoningTagHint: opts.reasoningTagHint,
		reasoningLevel: opts.reasoningLevel,
		sandboxInfo: opts.sandboxInfo,
		extraSections: [
			{
				title: "Runtime Profile",
				content: `profile=${runtimeProfile}`,
			},
			{
				title: "Runtime Preflight",
				content: buildPreflightPromptContent(preflight),
			},
			...(modelFallbackSection
				? [
					{
						title: "Model Fallback",
						content: modelFallbackSection,
					},
				]
				: []),
				...(promptImageGuidance
					? [
						{
							title: "Image Input Mode",
							content: promptImageGuidance,
						},
					]
					: []),
				...(taughtDraftPromptContent
					? [
						{
							title: "Teach Drafts",
							content: taughtDraftPromptContent,
						},
					]
					: []),
			],
		};
	const promptBuild = await policyPipeline.runBeforePromptBuild({
		options: baseSystemPromptOptions,
	});
	const systemPrompt = buildUnderstudySystemPrompt(promptBuild.options);
	const visibleToolNames = customToolDefs.map((toolDef) => toolDef.name);
	const visibleToolDefinitions = customToolDefs.filter(
		(toolDef) => !isHiddenCompatibilityToolDefinition(toolDef.name, visibleToolNames),
	);
	const promptReport = buildUnderstudyPromptReport({
		workspaceDir: cwd,
		systemPrompt,
		contextFiles,
		skills: skillsSnapshot.resolvedSkills,
		toolNames: advertisedToolNames,
		toolSummaries,
		toolDefinitions: visibleToolDefinitions,
	});
	const sessionMeta: UnderstudySessionMeta = {
		backend: adapter.name,
		model: modelLabel || "auto",
		runtimeProfile,
		workspaceDir: cwd,
		toolNames: advertisedToolNames,
		promptReport,
		auth: authContext.report,
	};
	sessionMetaRef = sessionMeta;
	const promptBuiltEvent: UnderstudySessionPromptBuiltEvent = {
		config,
		systemPrompt,
		promptReport,
		sessionMeta,
	};
	await runLifecycleHook(
		"onPromptBuilt",
		opts.lifecycleHooks?.onPromptBuilt,
		promptBuiltEvent,
	);

	// Apply prompt override so session prompt rebuilds keep the Understudy system prompt.
	applySystemPromptOverrideToSession(session as any, systemPrompt);

	// Guard oversized tool results so context windows stay stable across long turns.
	const contextWindowTokens =
		typeof model?.contextWindow === "number" && model.contextWindow > 0
			? model.contextWindow
			: 128_000;
	installToolResultContextGuard({
		agent: session.agent as any,
		contextWindowTokens,
	});

	// Runtime policy pipeline: prompt rewriting and reply hooks.
	const originalPrompt = session.prompt.bind(session);
	(session as unknown as { prompt: (text: string, options?: unknown) => Promise<void> }).prompt = async (
		text: string,
		options?: unknown,
	) => {
		const transformed = await policyPipeline.runBeforePrompt({
			text,
			options,
		});
		const promptImageSupport = await preparePromptImageSupport({
			text: transformed.text,
			options: transformed.options,
			cwd,
			model,
		});
		let recoveredOverflow = false;
		for (let attempt = 1; attempt <= 3; attempt += 1) {
			const messageCountBeforePrompt = session.agent.state.messages.length;
			try {
				return await originalPrompt(promptImageSupport.text, promptImageSupport.options as any);
			} catch (error) {
				if (!recoveredOverflow && isContextWindowOverflowError(error)) {
					const recovery = recoverContextAfterOverflowInPlace({
						messages: session.agent.state.messages,
						contextWindowTokens,
					});
					if (!recovery.changed) {
						throw error;
					}
					recoveredOverflow = true;
					logger.warn(
						`Prompt hit a context overflow. Recovered context to ~${recovery.estimatedChars} chars and retrying once.`,
					);
					continue;
				}

				const messageCountAfterError = session.agent.state.messages.length;
				const safeToRetry = messageCountAfterError === messageCountBeforePrompt;
				if (attempt >= 3 || !safeToRetry || !isRetryablePromptDispatchError(error)) {
					throw error;
				}

				const backoffMs = promptRetryBackoffMs(attempt);
				logger.warn(
					`Prompt dispatch failed with a transient model error: ${describeUnknownError(error)}. ` +
					`Retrying in ${backoffMs}ms (attempt ${attempt + 1}/3).`,
				);
				await new Promise((resolve) => setTimeout(resolve, backoffMs));
			}
		}
	};
	(runtimeSession as unknown as { prompt: (text: string, options?: unknown) => Promise<void> }).prompt =
		(session as unknown as { prompt: (text: string, options?: unknown) => Promise<void> }).prompt;

	runtimeSession.onEvent((event) => {
		if ((event as { type?: string }).type !== "message_end") return;
		const message = (event as { message?: any }).message;
		if (!message || message.role !== "assistant") return;
		void (async () => {
				let workingMessage = message;
				const beforeReply = await policyPipeline.runBeforeReply({ message: workingMessage });
				if (beforeReply.message && beforeReply.message !== workingMessage) {
					workingMessage = mergeAgentMessage(workingMessage, beforeReply.message);
				}
				const afterReply = await policyPipeline.runAfterReply({
					message: workingMessage,
				});
				if (afterReply.message && afterReply.message !== workingMessage) {
					workingMessage = mergeAgentMessage(workingMessage, afterReply.message);
				}
			await runLifecycleHook("onAssistantReply", opts.lifecycleHooks?.onAssistantReply, {
				message: workingMessage,
				sessionMeta,
			});
		})().catch((error) => {
			logger.warn(`Runtime policy reply hooks failed: ${String(error)}`);
		});
	});

	let sessionClosed = false;
	const emitSessionClosed = async () => {
		if (sessionClosed) {
			return;
		}
		sessionClosed = true;
		await runLifecycleHook("onSessionClosed", opts.lifecycleHooks?.onSessionClosed, {
			sessionMeta,
		});
	};
	const runtimeSessionClose = runtimeSession.close.bind(runtimeSession);
	(runtimeSession as { close: () => Promise<void> | void }).close = async () => {
		try {
			return await runtimeSessionClose();
		} finally {
			await emitSessionClosed();
		}
	};
	const sessionWithDispose = session as { dispose?: () => Promise<void> | void };
	if (typeof sessionWithDispose.dispose === "function") {
		const originalDispose = sessionWithDispose.dispose.bind(sessionWithDispose);
		sessionWithDispose.dispose = async () => {
			try {
				return await originalDispose();
			} finally {
				await emitSessionClosed();
			}
		};
	}

	const mergedExtensions =
		sessionResult.extensionsResult && typeof sessionResult.extensionsResult === "object"
			? { ...(sessionResult.extensionsResult as Record<string, unknown>) }
			: {};

	logger.debug("Understudy session created", {
		backend: adapter.name,
		model: modelLabel || "auto",
		tools: advertisedToolNames,
		policies: policyPipeline.getPolicyNames(),
		policyModules: configuredPolicies.modules,
		runtime: `${runtimeParams.runtimeInfo.os} (${runtimeParams.runtimeInfo.arch})`,
		timezone: runtimeParams.userTimezone,
	});
	if (sessionCreation.fallbackUsed) {
		logger.info("Runtime session created via fallback candidate", {
			model: modelLabel,
			defaultModel: `${config.defaultProvider}/${config.defaultModel}`,
		});
	}

	await runLifecycleHook("onSessionCreated", opts.lifecycleHooks?.onSessionCreated, {
		...promptBuiltEvent,
		session,
		runtimeSession,
		extensionsResult: mergedExtensions,
	});

	return {
		...sessionResult,
		extensionsResult: mergedExtensions,
		config,
		toolRegistry,
		sessionMeta,
	};
}

/**
 * Load project context files from disk.
 * Searches for configured paths and auto-detected files (SOUL.md, AGENTS.md).
 */
function loadContextFiles(cwd: string, configuredPaths?: string[]): ContextFile[] {
	const files: ContextFile[] = [];
	const seen = new Set<string>();

	// Auto-detect standard context files in cwd
	const autoFiles = ["SOUL.md", "AGENTS.md", "CLAUDE.md"];
	const allPaths = [...autoFiles, ...(configuredPaths ?? [])];

	for (const filePath of allPaths) {
		const resolved = resolve(cwd, filePath);
		if (seen.has(resolved)) continue;
		seen.add(resolved);

		try {
			const content = readFileSync(resolved, "utf-8");
			if (content.trim()) {
				files.push({ path: filePath, content: content.trim() });
			}
		} catch {
			// File doesn't exist, skip
		}
	}

	return files;
}

function buildModelFallbackPromptContent(modelFallbacks?: string[]): string | undefined {
	const chain = (modelFallbacks ?? []).map((item) => item.trim()).filter(Boolean);
	if (chain.length === 0) {
		return undefined;
	}
	return [
		"Fallback candidates (ordered):",
		...chain.map((item) => `- ${item}`),
	].join("\n");
}
