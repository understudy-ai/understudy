import { createAgentSession } from "@mariozechner/pi-coding-agent";
import type { Model, ThinkingLevel } from "@mariozechner/pi-ai";
import {
	asRecord,
	AuthManager,
	inspectProviderAuthStatus,
	type RuntimeResolvedModelCandidate,
} from "@understudy/core";
import type { UnderstudyConfig } from "@understudy/types";
import {
	createModelLoopGroundingProvider,
	type GuiGroundingProvider,
} from "@understudy/tools";

type ProviderStatusResolver = typeof inspectProviderAuthStatus;

export interface ResolvedGuiGroundingProvider {
	available: boolean;
	label?: string;
	groundingProvider?: GuiGroundingProvider;
	unavailableReason?: string;
}

export interface GuiGroundingModelSelectionOptions {
	explicitModel?: Model<any>;
	modelCandidates?: RuntimeResolvedModelCandidate[];
}

const DEFAULT_RUNTIME_GROUNDING_TIMEOUT_MS = 25_000;
const RUNTIME_GROUNDING_MAX_ATTEMPTS = 4;
const RUNTIME_GROUNDING_STAGE_MAX_ATTEMPTS = 3;
const RUNTIME_GROUNDING_SYSTEM_PROMPT = [
	"You are a GUI grounding sidecar.",
	"You receive exactly one screenshot image and one structured grounding request.",
	"Return strict JSON only and never include markdown fences, commentary, or tool calls.",
].join("\n");

type ResolvedProviderModel = {
	provider: string;
	modelId: string;
	model: Model<any>;
};

type RuntimeCreateAgentSessionImpl = typeof createAgentSession;
type RuntimeCreatedSession = Awaited<ReturnType<RuntimeCreateAgentSessionImpl>>;
type RuntimeAgentSession = RuntimeCreatedSession["session"];
type RuntimeThinkingLevel = ThinkingLevel | "off";
type SharedModelLoopProviderOptions = Parameters<typeof createModelLoopGroundingProvider>[0];
type RuntimeGuideImageImpl = SharedModelLoopProviderOptions["guideImageImpl"];
type RuntimeSimulationImageImpl = SharedModelLoopProviderOptions["simulationImageImpl"];

function providerAliases(provider: string): string[] {
	const normalized = provider.trim().toLowerCase();
	switch (normalized) {
		case "openai-codex":
			return ["openai-codex", "openai"];
		case "openai":
			return ["openai", "openai-codex"];
		case "google":
			return ["google", "gemini"];
		case "gemini":
			return ["gemini", "google"];
		default:
			return [normalized];
	}
}

function resolveGuiGroundingThinkingLevel(config: UnderstudyConfig): RuntimeThinkingLevel {
	return config.agent.guiGroundingThinkingLevel ?? "medium";
}

function resolveProviderModel(params: {
	authManager: AuthManager;
	provider: string;
	modelId: string;
}): ResolvedProviderModel | undefined {
	const models = params.authManager.getAvailableModels();
	for (const alias of providerAliases(params.provider)) {
		const exact =
			params.authManager.findModel(alias, params.modelId) ??
			models.find((model) => model.provider === alias && model.id === params.modelId) ??
			models.find((model) => model.provider === alias);
		if (exact) {
			return {
				provider: exact.provider,
				modelId: exact.id,
				model: exact,
			};
		}
	}
	return undefined;
}

function buildGuiGroundingCandidates(
	options?: GuiGroundingModelSelectionOptions,
): RuntimeResolvedModelCandidate[] {
	if (options?.explicitModel) {
		return [
			{
				model: options.explicitModel,
				modelLabel: `${options.explicitModel.provider}/${options.explicitModel.id}`,
				provider: options.explicitModel.provider,
				modelId: options.explicitModel.id,
				source: "explicit",
			},
		];
	}
	if (Array.isArray(options?.modelCandidates) && options.modelCandidates.length > 0) {
		return options.modelCandidates;
	}
	return [];
}

function extractLatestAssistantText(messages: unknown): string {
	if (!Array.isArray(messages)) {
		return "";
	}
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index] as { role?: unknown; content?: unknown } | undefined;
		if (!message || message.role !== "assistant") {
			continue;
		}
		if (typeof message.content === "string" && message.content.trim()) {
			return message.content.trim();
		}
		if (!Array.isArray(message.content)) {
			continue;
		}
		const text = message.content
			.map((chunk) => {
				if (!chunk || typeof chunk !== "object") {
					return "";
				}
				const typed = chunk as { type?: unknown; text?: unknown };
				return typed.type === "text" && typeof typed.text === "string"
					? typed.text.trim()
					: "";
			})
			.filter(Boolean)
			.join("\n")
			.trim();
		if (text) {
			return text;
		}
	}
	return "";
}

function summarizeLastAssistantMessage(messages: unknown): string {
	if (!Array.isArray(messages)) {
		return "no-messages";
	}
	type AssistantSummaryMessage = {
		stopReason?: unknown;
		errorMessage?: unknown;
		content?: Array<{ type?: unknown }>;
		provider?: unknown;
		model?: unknown;
	};
	const lastAssistant = (
		messages
		.slice()
		.reverse()
		.find((message) => (message as { role?: unknown } | undefined)?.role === "assistant")
	) as AssistantSummaryMessage | undefined;
	if (!lastAssistant) {
		return "no-assistant-message";
	}
	const contentTypes = Array.isArray(lastAssistant.content)
		? lastAssistant.content
			.map((chunk) => (chunk?.type && typeof chunk.type === "string" ? chunk.type : "unknown"))
			.join(",")
		: "non-array";
	return JSON.stringify({
		stopReason: lastAssistant.stopReason,
		errorMessage: lastAssistant.errorMessage,
		contentTypes,
		provider: lastAssistant.provider,
		model: lastAssistant.model,
	});
}

function isRetryableRuntimeGroundingError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	const normalized = message.toLowerCase();
	return normalized.includes("no assistant text") ||
		isRetryableRuntimeStageError(error);
}

function isRetryableRuntimeStageError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	const normalized = message.toLowerCase();
	return normalized.includes("timed out after") ||
		normalized.includes("server_error") ||
		normalized.includes("temporarily unavailable") ||
		normalized.includes("overloaded") ||
		normalized.includes("stopreason\\\":\\\"error");
}

async function promptRuntimeGroundingRound(params: {
	timeoutMs: number;
	prompt: string;
	images: Array<{ type: "image"; data: string; mimeType: string }>;
	session: RuntimeAgentSession;
	resetSession?: boolean;
	providerName: string;
}): Promise<{
	text: string;
	trace: {
		attempts: Array<{
			attempt: number;
			resetMs?: number;
			promptMs: number;
			timedOut: boolean;
		}>;
	};
}> {
	let lastError: Error | undefined;
	const stageTrace: {
		attempts: Array<{
			attempt: number;
			resetMs?: number;
			promptMs: number;
			timedOut: boolean;
		}>;
	} = { attempts: [] };
	for (let attempt = 1; attempt <= RUNTIME_GROUNDING_STAGE_MAX_ATTEMPTS; attempt += 1) {
		let promptTimer: ReturnType<typeof setTimeout> | undefined;
		const attemptTrace: {
			attempt: number;
			resetMs?: number;
			promptMs: number;
			timedOut: boolean;
		} = {
			attempt,
			promptMs: 0,
			timedOut: false,
		};
		stageTrace.attempts.push(attemptTrace);
		try {
			if (params.resetSession || attempt > 1) {
				const resetStart = performance.now();
				await params.session.newSession();
				attemptTrace.resetMs = Math.round(performance.now() - resetStart);
			}
			params.session.agent.setSystemPrompt(RUNTIME_GROUNDING_SYSTEM_PROMPT);
			const promptStart = performance.now();
			await Promise.race([
				params.session.prompt(params.prompt, { images: params.images }),
				new Promise<never>((_, reject) => {
					promptTimer = setTimeout(() => {
						reject(new Error(`Timed out after ${params.timeoutMs}ms.`));
					}, params.timeoutMs);
				}),
			]);
			attemptTrace.promptMs = Math.round(performance.now() - promptStart);
			const assistantText =
				(typeof (params.session as { getLastAssistantText?: () => string | undefined }).getLastAssistantText === "function"
					? (params.session as { getLastAssistantText: () => string | undefined }).getLastAssistantText()
					: undefined) ??
				extractLatestAssistantText(params.session.agent.state.messages);
			if (!assistantText) {
				throw new Error(
					`${params.providerName} runtime grounding returned no assistant text. ` +
					`last_assistant=${summarizeLastAssistantMessage(params.session.agent.state.messages)}`,
				);
			}
			return { text: assistantText, trace: stageTrace };
			} catch (error) {
				if (attemptTrace.promptMs === 0) {
					attemptTrace.promptMs = Math.round(params.timeoutMs);
				}
				lastError = error instanceof Error ? error : new Error(String(error));
				attemptTrace.timedOut = lastError.message.toLowerCase().includes("timed out after");
				if (attempt >= RUNTIME_GROUNDING_STAGE_MAX_ATTEMPTS || !isRetryableRuntimeStageError(lastError)) {
					throw lastError;
				}
				await params.session.abort().catch(() => {});
			} finally {
			if (promptTimer) {
				clearTimeout(promptTimer);
			}
		}
	}
	throw lastError ?? new Error(`${params.providerName} runtime grounding failed.`);
}

/**
 * Create a runtime-backed grounding provider that uses an agent session
 * with the given model. Works with any provider that supports image input.
 */
export function createRuntimeGroundingProvider(options: {
	authManager: AuthManager;
	model: Model<any>;
	providerName: string;
	thinkingLevel?: RuntimeThinkingLevel;
	timeoutMs?: number;
	createAgentSessionImpl?: RuntimeCreateAgentSessionImpl;
	guideImageImpl?: RuntimeGuideImageImpl;
	simulationImageImpl?: RuntimeSimulationImageImpl;
}): GuiGroundingProvider | undefined {
	if (Array.isArray(options.model.input) && !options.model.input.includes("image")) {
		return undefined;
	}
	const timeoutMs = Math.max(5_000, Math.floor(options.timeoutMs ?? DEFAULT_RUNTIME_GROUNDING_TIMEOUT_MS));
	const thinkingLevel = options.thinkingLevel ?? "medium";
	const createAgentSessionImpl = options.createAgentSessionImpl ?? createAgentSession;

	return {
		async ground(request) {
			for (let attempt = 1; attempt <= RUNTIME_GROUNDING_MAX_ATTEMPTS; attempt += 1) {
				let runtimeSession: RuntimeAgentSession | undefined;
				let stageCount = 0;
				const groundingStart = performance.now();
				const runtimeTrace: {
					sessionCreateMs?: number;
					totalMs?: number;
					stages: Array<{
						stage: "predict" | "validate";
						stageIndex: number;
						attempts: Array<{
							attempt: number;
							resetMs?: number;
							promptMs: number;
							timedOut: boolean;
						}>;
					}>;
				} = { stages: [] };
				try {
					const sessionCreateStart = performance.now();
					const created = await createAgentSessionImpl({
						cwd: process.cwd(),
						authStorage: options.authManager.authStorage,
						modelRegistry: options.authManager.modelRegistry,
						model: options.model,
						thinkingLevel,
						tools: [],
						customTools: [],
					});
					runtimeTrace.sessionCreateMs = Math.round(performance.now() - sessionCreateStart);
					runtimeSession = created.session;
					const activeSession = runtimeSession;
						const sharedProvider = createModelLoopGroundingProvider({
							providerName: options.providerName,
							guideImageImpl: options.guideImageImpl,
							simulationImageImpl: options.simulationImageImpl,
							invokeModel: async (params): Promise<string> => {
							const shouldResetSession = stageCount > 0;
							stageCount += 1;
							const stageResult = await promptRuntimeGroundingRound({
								timeoutMs,
								session: activeSession,
								resetSession: shouldResetSession,
								providerName: options.providerName,
								prompt: params.prompt,
								images: params.images.map((image): { type: "image"; data: string; mimeType: string } => ({
									type: "image",
									data: image.bytes.toString("base64"),
									mimeType: image.mimeType,
								})),
							});
							runtimeTrace.stages.push({
								stage: params.stage,
								stageIndex: stageCount,
								attempts: stageResult.trace.attempts,
							});
							return stageResult.text;
						},
					});
					const grounded = await sharedProvider.ground(request);
					runtimeTrace.totalMs = Math.round(performance.now() - groundingStart);
					if (!grounded) {
						return grounded;
					}
					const raw = asRecord(grounded.raw) ?? {};
					return {
						...grounded,
						raw: {
							...raw,
							runtime_grounding_trace: runtimeTrace,
						},
					};
				} catch (error) {
					if (attempt < RUNTIME_GROUNDING_MAX_ATTEMPTS && isRetryableRuntimeGroundingError(error)) {
						continue;
					}
					throw new Error(
						`${options.providerName} runtime grounding failed: ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
				} finally {
					await runtimeSession?.dispose?.();
				}
			}
			throw new Error(`${options.providerName} runtime grounding exhausted retries.`);
		},
	};
}

/**
 * Resolve a GUI grounding provider from the main model configuration.
 *
 * Uses the runtime-backed approach (agent session) for any provider whose
 * model supports image input. No provider-specific filtering is applied.
 */
export async function resolveMainModelGuiGroundingProvider(
	config: UnderstudyConfig,
	authManager: AuthManager = AuthManager.create(),
	providerStatusResolver: ProviderStatusResolver = inspectProviderAuthStatus,
	options?: GuiGroundingModelSelectionOptions,
): Promise<ResolvedGuiGroundingProvider | undefined> {
	const thinkingLevel = resolveGuiGroundingThinkingLevel(config);
	const candidates = buildGuiGroundingCandidates(options);
	if (candidates.length === 0) {
		const providerStatus = providerStatusResolver(config.defaultProvider);
		if (!providerStatus.available) {
			return undefined;
		}
		const resolved = resolveProviderModel({
			authManager,
			provider: config.defaultProvider,
			modelId: config.defaultModel,
		});
		if (!resolved) {
			return undefined;
		}
		const label = `main:${resolved.provider}/${resolved.modelId}`;
		const runtimeProvider = createRuntimeGroundingProvider({
			authManager,
			model: resolved.model,
			providerName: label,
			thinkingLevel,
		});
		if (runtimeProvider) {
			return {
				available: true,
				label,
				groundingProvider: runtimeProvider,
			};
		}
		return {
			available: false,
			label,
			unavailableReason: "The main model does not support image input required for GUI grounding.",
		};
	}
	for (const candidate of candidates) {
		const providerStatus = providerStatusResolver(candidate.provider);
		if (!providerStatus.available) {
			continue;
		}
		const label = `main:${candidate.provider}/${candidate.modelId}`;
		const runtimeProvider = createRuntimeGroundingProvider({
			authManager,
			model: candidate.model,
			providerName: label,
			thinkingLevel,
		});
		if (runtimeProvider) {
			return {
				available: true,
				label,
				groundingProvider: runtimeProvider,
			};
		}
	}

	return undefined;
}

/**
 * Resolve the GUI grounding provider for the current runtime.
 *
 * Uses the main LLM configuration — whatever the main model supports,
 * grounding supports as well.
 */
export async function primeGuiGroundingForConfig(
	config: UnderstudyConfig,
	authManager: AuthManager = AuthManager.create(),
	providerStatusResolver: ProviderStatusResolver = inspectProviderAuthStatus,
	options?: GuiGroundingModelSelectionOptions,
): Promise<ResolvedGuiGroundingProvider> {
	const mainProvider = await resolveMainModelGuiGroundingProvider(
		config,
		authManager,
		providerStatusResolver,
		options,
	);
	if (mainProvider) {
		return mainProvider;
	}

	return { available: false };
}
