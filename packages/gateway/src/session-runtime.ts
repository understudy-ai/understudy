import {
	appendPersistedWorkflowCrystallizationTurnFromRun,
	buildTaughtTaskDraftPromptContent,
	buildSkillsSection,
	buildWorkspaceSkillSnapshot,
	buildSessionResetPrompt,
	lintTaughtTaskDraft,
	loadPersistedWorkflowCrystallizationLedger,
	loadPersistedTaughtTaskDraftLedger,
	normalizeAssistantDisplayText,
	normalizeTaughtTaskToolArguments,
	publishWorkflowCrystallizedSkill,
	replaceWorkflowCrystallizationClusters,
	replaceWorkflowCrystallizationDayEpisodes,
	replaceWorkflowCrystallizationDaySegments,
	replaceWorkflowCrystallizationSkills,
	resolveUnderstudyHomeDir,
	stripInlineDirectiveTagsForDisplay,
	updatePersistedWorkflowCrystallizationLedger,
	withTimeout,
	extractTaughtTaskToolArgumentsFromRecord,
	type TaughtTaskDraftParameter,
	type TaughtTaskCard,
	type TaughtTaskDraft,
	type TaughtTaskDraftStep,
	type TaughtTaskExecutionPolicy,
	type TaughtTaskExecutionRoute,
	type TaughtTaskKind,
	type TaughtTaskProcedureStep,
	type TaughtTaskSkillDependency,
	type TaughtTaskStepRouteOption,
	type UsageTracker,
	type WorkflowCrystallizationCluster,
	type WorkflowCrystallizationCompletion,
	type WorkflowCrystallizationEpisode,
	type WorkflowCrystallizationLedger,
	type WorkflowCrystallizationRouteOption,
	type WorkflowCrystallizationSegment,
	type WorkflowCrystallizationSkill,
	type WorkflowCrystallizationSkillStage,
	type WorkflowCrystallizationStatusCounts,
	type WorkflowCrystallizationToolStep,
	type WorkflowCrystallizationTurn,
} from "@understudy/core";
import {
	createMacosDemonstrationRecorder,
	type GuiDemonstrationRecorder,
	type GuiDemonstrationRecordingSession,
} from "@understudy/gui";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { TeachCapabilitySnapshot, VideoTeachAnalyzer } from "@understudy/tools";
import { buildTeachCapabilitySnapshot, extractJsonObject, formatTeachCapabilitySnapshotForPrompt } from "@understudy/tools";
import type { Attachment, UnderstudyConfig } from "@understudy/types";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { buildPromptInputFromMedia } from "./media-input.js";
import { injectTimestamp, timestampOptsFromConfig } from "./message-timestamp.js";
import {
	extractRenderableAssistantImages,
	normalizeAssistantRenderableText,
} from "./assistant-media.js";
import type { ChatHandler, SessionHandlers } from "./server.js";
import {
	buildSubagentSessionId,
	createSubagentSessionMeta,
	listSubagentEntries,
	markSubagentRunCompleted,
	markSubagentRunFailed,
	markSubagentRunStarted,
	resolveSubagentEntry,
	type SubagentMode,
	type SubagentSessionMeta,
} from "./subagent-registry.js";
import {
	resolveSubagentSpawnPlan,
	type ResolvedSubagentAgentTarget,
	type SpawnSubagentParams,
} from "./subagent-spawn-plan.js";
import { createGatewayTaskDraftHandlers } from "./task-drafts.js";
import { asBoolean, asNumber, asRecord, asString, normalizeComparableText, sanitizePathSegment } from "./value-coerce.js";
import { mergeUnderstudyConfigOverride } from "./channel-policy.js";

export interface SessionEntry {
	id: string;
	parentId?: string;
	forkPoint?: number;
	channelId?: string;
	senderId?: string;
	senderName?: string;
	conversationName?: string;
	conversationType?: "direct" | "group" | "thread";
	threadId?: string;
	createdAt: number;
	lastActiveAt: number;
	dayStamp: string;
	messageCount: number;
	session: unknown;
	workspaceDir?: string;
	repoRoot?: string;
	validationRoot?: string;
	configOverride?: Partial<UnderstudyConfig>;
	sandboxInfo?: SessionSandboxInfo;
	executionScopeKey?: string;
	sessionMeta?: Record<string, unknown>;
	traceId?: string;
	subagentMeta?: SubagentSessionMeta;
	recentRuns?: SessionRunTrace[];
	history: Array<{
		role: "user" | "assistant";
		text: string;
		timestamp: number;
		images?: ImageContent[];
		attachments?: Attachment[];
	}>;
}

export interface SessionRunTrace {
	runId: string;
	recordedAt: number;
	userPromptPreview: string;
	responsePreview: string;
	durationMs?: number;
	thoughtText?: string;
	progressSteps?: Array<Record<string, unknown>>;
	toolTrace: Array<Record<string, unknown>>;
	attempts: Array<Record<string, unknown>>;
	teachValidation?: Record<string, unknown>;
	agentMeta?: Record<string, unknown>;
}

export interface SessionSummary {
	id: string;
	sessionName?: string;
	parentId?: string;
	forkPoint?: number;
	channelId?: string;
	senderId?: string;
	senderName?: string;
	conversationName?: string;
	conversationType?: "direct" | "group" | "thread";
	threadId?: string;
	createdAt: number;
	lastActiveAt: number;
	messageCount: number;
	workspaceDir?: string;
	model?: string;
	runtimeProfile?: string;
	traceId?: string;
	lastRunId?: string;
	lastRunAt?: number;
	lastToolName?: string;
	lastToolRoute?: string;
	lastToolStatus?: "ok" | "error";
	subagentParentId?: string;
	subagentLabel?: string;
	subagentMode?: SubagentMode;
	subagentStatus?: SubagentSessionMeta["latestRunStatus"];
	teachClarification?: {
		draftId: string;
		status: "clarifying" | "ready";
		summary?: string;
		nextQuestion?: string;
		pendingQuestions?: string[];
		updatedAt?: number;
	};
}

export interface SessionSandboxInfo {
	enabled: boolean;
	containerWorkspaceDir?: string;
	workspaceDir?: string;
	workspaceAccess?: string;
	browserNoVncUrl?: string;
	hostBrowserAllowed?: boolean;
	elevated?: {
		allowed: boolean;
		defaultLevel?: string;
	};
}

type SessionSummaryInput = Pick<
	SessionEntry,
	| "id"
	| "parentId"
	| "forkPoint"
	| "channelId"
	| "senderId"
	| "senderName"
	| "conversationName"
	| "conversationType"
	| "threadId"
	| "createdAt"
	| "lastActiveAt"
	| "messageCount"
	| "workspaceDir"
	| "traceId"
	| "sessionMeta"
	| "subagentMeta"
	| "recentRuns"
>;

type SessionLookupContext = {
	channelId?: string;
	senderId?: string;
	senderName?: string;
	conversationName?: string;
	conversationType?: "direct" | "group" | "thread";
	threadId?: string;
	forceNew?: boolean;
	workspaceDir?: string;
	explicitWorkspace?: boolean;
	configOverride?: Partial<UnderstudyConfig>;
	sandboxInfo?: SessionSandboxInfo;
	executionScopeKey?: string;
};

type SessionCreateContext = {
	sessionKey: string;
	parentId?: string;
	forkPoint?: number;
	channelId?: string;
	senderId?: string;
	senderName?: string;
	conversationName?: string;
	conversationType?: "direct" | "group" | "thread";
	threadId?: string;
	workspaceDir?: string;
	explicitWorkspace?: boolean;
	configOverride?: Partial<UnderstudyConfig>;
	sandboxInfo?: SessionSandboxInfo;
	executionScopeKey?: string;
	allowedToolNames?: string[];
	extraSystemPrompt?: string;
	thinkingLevel?: UnderstudyConfig["defaultThinkingLevel"];
};

interface WorkflowCrystallizationRuntimeOptions {
	minTurnsForSegmentation?: number;
	segmentationReanalyzeDelta?: number;
	minEpisodesForClustering?: number;
	minClusterOccurrencesForPromotion?: number;
	maxClusteringEpisodes?: number;
	maxPromotedWorkflowCandidates?: number;
	maxSynthesisEpisodeExamples?: number;
}

interface CreateGatewaySessionRuntimeParams {
	sessionEntries: Map<string, SessionEntry>;
	inFlightSessionIds: Set<string>;
	config: UnderstudyConfig;
	usageTracker: UsageTracker;
	estimateTokens: (text: string) => number;
	appendHistory: (
		entry: SessionEntry,
		role: "user" | "assistant",
		text: string,
		timestamp?: number,
		options?: {
			images?: ImageContent[];
			attachments?: Attachment[];
		},
	) => void;
	getOrCreateSession: (context: SessionLookupContext) => Promise<SessionEntry>;
	createScopedSession: (context: SessionCreateContext) => Promise<SessionEntry>;
	promptSession: (
		entry: SessionEntry,
		text: string,
		runId?: string,
		promptOptions?: Record<string, unknown>,
	) => Promise<{ response: string; runId: string; images?: ImageContent[]; meta?: Record<string, unknown> }>;
	abortSessionEntry: (entry: SessionEntry) => Promise<boolean>;
	resolveAgentTarget?: (agentId: string) => ResolvedSubagentAgentTarget | null;
	waitForRun?: (params: {
		runId?: string;
		sessionId?: string;
		timeoutMs?: number;
	}) => Promise<Record<string, unknown>>;
	listPersistedSessions?: (params?: {
		channelId?: string;
		senderId?: string;
		limit?: number;
	}) => Promise<SessionSummary[]>;
	readPersistedSession?: (params: {
		sessionId: string;
	}) => Promise<SessionSummary | null>;
	readTranscriptHistory?: (params: {
		sessionId: string;
		limit?: number;
	}) => Promise<Array<SessionEntry["history"][number]>>;
	readPersistedTrace?: (params: {
		sessionId: string;
		limit?: number;
	}) => Promise<SessionRunTrace[]>;
	persistSessionRunTrace?: (params: {
		sessionId: string;
		trace: SessionRunTrace;
	}) => Promise<void>;
	deletePersistedSession?: (params: {
		sessionId: string;
	}) => Promise<void>;
	onStateChanged?: () => void;
	videoTeachAnalyzer?: VideoTeachAnalyzer;
	demonstrationRecorder?: GuiDemonstrationRecorder;
	validateTeachDraft?: (params: {
		entry: SessionEntry;
		draft: TaughtTaskDraft;
		promptSession: CreateGatewaySessionRuntimeParams["promptSession"];
	}) => Promise<{
		state: "validated" | "requires_reset" | "failed";
		summary: string;
		checks: Array<{
			id: string;
			ok: boolean;
			summary: string;
			details?: string;
			source?: "replay" | "draft";
		}>;
		runId?: string;
		response?: string;
		meta?: Record<string, unknown>;
	}>;
	notifyUser?: (params: {
		entry: SessionEntry;
		text: string;
		title?: string;
		source: "workflow_crystallization";
		details?: Record<string, unknown>;
	}) => Promise<void>;
	workflowCrystallization?: WorkflowCrystallizationRuntimeOptions;
}

export const buildSessionSummary = (entry: SessionSummaryInput): SessionSummary => {
	const latestRun = Array.isArray(entry.recentRuns) ? entry.recentRuns[0] : undefined;
	const latestTool = latestRun
		? [...latestRun.toolTrace]
			.reverse()
			.map((item) => asRecord(item))
			.find((item) => item && typeof item.name === "string")
		: undefined;
	const sessionDisplayName = resolveSessionDisplayName(entry.sessionMeta);
	const teachClarification = resolveTeachClarificationSummary(entry.sessionMeta);
	return {
		id: entry.id,
		...(sessionDisplayName ? { sessionName: sessionDisplayName } : {}),
		parentId: entry.parentId,
		forkPoint: entry.forkPoint,
		channelId: entry.channelId,
		senderId: entry.senderId,
		senderName: entry.senderName,
		conversationName: entry.conversationName,
		conversationType: entry.conversationType,
		threadId: entry.threadId,
		createdAt: entry.createdAt,
		lastActiveAt: entry.lastActiveAt,
		messageCount: entry.messageCount,
		workspaceDir: entry.workspaceDir,
		model: asString(entry.sessionMeta?.model),
		runtimeProfile: asString(entry.sessionMeta?.runtimeProfile),
		traceId: entry.traceId,
		...(latestRun ? { lastRunId: latestRun.runId, lastRunAt: latestRun.recordedAt } : {}),
		...(latestTool && typeof latestTool.name === "string" ? { lastToolName: latestTool.name } : {}),
		...(latestTool && typeof latestTool.route === "string" ? { lastToolRoute: latestTool.route } : {}),
		...(latestTool ? { lastToolStatus: latestTool.isError === true ? "error" as const : "ok" as const } : {}),
		...(entry.subagentMeta
			? {
				subagentParentId: entry.subagentMeta.parentSessionId,
				subagentLabel: entry.subagentMeta.label,
				subagentMode: entry.subagentMeta.mode,
				subagentStatus: entry.subagentMeta.latestRunStatus,
			}
			: {}),
		...(teachClarification ? { teachClarification } : {}),
	};
};

function resolveSessionDisplayName(sessionMeta?: Record<string, unknown>): string | undefined {
	return trimToUndefined(asString(sessionMeta?.sessionName));
}

function resolveTeachClarificationSummary(sessionMeta?: Record<string, unknown>) {
	const record = asRecord(sessionMeta?.teachClarification);
	const draftId = trimToUndefined(asString(record?.draftId));
	if (!draftId) {
		return undefined;
	}
	return {
		draftId,
		status: asString(record?.status) === "ready" ? "ready" as const : "clarifying" as const,
		summary: trimToUndefined(asString(record?.summary)),
		nextQuestion: trimToUndefined(asString(record?.nextQuestion)),
		pendingQuestions: asStringList(record?.pendingQuestions),
		updatedAt: asNumber(record?.updatedAt),
	};
}

function extractSessionSystemPrompt(session: unknown): string | undefined {
	const messages = (session as {
		agent?: { state?: { messages?: Array<{ role?: unknown; content?: unknown }> } };
	})?.agent?.state?.messages;
	if (!Array.isArray(messages)) {
		return undefined;
	}
	const systemMessage = messages.find((message) => message?.role === "system");
	if (!systemMessage) {
		return undefined;
	}
	if (typeof systemMessage.content === "string") {
		return trimToUndefined(systemMessage.content);
	}
	if (!Array.isArray(systemMessage.content)) {
		return undefined;
	}
	const text = systemMessage.content
		.map((chunk) => {
			if (!chunk || typeof chunk !== "object") {
				return "";
			}
			const typed = chunk as { type?: unknown; text?: unknown };
			return typed.type === "text" && typeof typed.text === "string"
				? typed.text
				: "";
		})
		.join("\n")
		.trim();
	return trimToUndefined(text);
}

function updateSessionSystemPromptState(session: unknown, prompt: string): void {
	const messages = (session as {
		agent?: { state?: { messages?: Array<{ role?: unknown; content?: unknown }> } };
	})?.agent?.state?.messages;
	if (!Array.isArray(messages)) {
		return;
	}
	const nextMessage = {
		role: "system",
		content: [{ type: "text", text: prompt }],
	};
	const existingIndex = messages.findIndex((message) => message?.role === "system");
	if (existingIndex >= 0) {
		messages[existingIndex] = nextMessage;
		return;
	}
	messages.unshift(nextMessage);
}

function replaceSystemPromptSection(params: {
	prompt: string;
	header: string;
	sectionLines: string[];
	insertBeforeHeaders?: string[];
}): string {
	const lines = params.prompt.split("\n");
	const normalizedHeader = params.header.trim();
	const sectionStart = lines.findIndex((line) => line.trim() === normalizedHeader);
	const nextSectionStart = sectionStart >= 0
		? lines.findIndex((line, index) => index > sectionStart && /^##\s/.test(line.trim()))
		: -1;
	const replacement = params.sectionLines;
	if (sectionStart >= 0) {
		const before = lines.slice(0, sectionStart);
		const after = nextSectionStart >= 0 ? lines.slice(nextSectionStart) : [];
		return [...before, ...replacement, ...after]
			.join("\n")
			.replace(/\n{3,}/g, "\n\n")
			.trimEnd();
	}
	if (replacement.length === 0) {
		return params.prompt;
	}
	const insertBeforeHeaders = params.insertBeforeHeaders ?? [];
	let insertIndex = -1;
	for (const header of insertBeforeHeaders) {
		insertIndex = lines.findIndex((line) => line.trim() === header);
		if (insertIndex >= 0) {
			break;
		}
	}
	const before = insertIndex >= 0 ? lines.slice(0, insertIndex) : lines;
	const after = insertIndex >= 0 ? lines.slice(insertIndex) : [];
	const needsSeparator =
		before.length > 0 &&
		before[before.length - 1]?.trim().length > 0 &&
		replacement[0]?.trim().length > 0;
	return [
		...before,
		...(needsSeparator ? [""] : []),
		...replacement,
		...after,
	]
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trimEnd();
}


function resolveDemonstrationOutputDir(entry: SessionEntry): string {
	const workspaceKey = entry.workspaceDir
		? createHash("sha1").update(resolve(entry.workspaceDir)).digest("hex").slice(0, 12)
		: "global";
	return join(
		resolveUnderstudyHomeDir(),
		"learning",
		"demonstrations",
		workspaceKey,
		sanitizePathSegment(entry.id, "session"),
	);
}

function sanitizeTraceValue(
	value: unknown,
	depth: number = 0,
	keyHint?: string,
): unknown {
	if (value === null || value === undefined) {
		return value;
	}
	if (typeof value === "string") {
		if (keyHint && TRACE_SENSITIVE_KEY_PATTERN.test(keyHint)) {
			return `[REDACTED:${value.length}]`;
		}
		if (keyHint && TRACE_BINARY_PAYLOAD_KEY_PATTERN.test(keyHint)) {
			return value;
		}
		return value.length > TRACE_VALUE_PREVIEW_CHARS
			? `${value.slice(0, TRACE_VALUE_PREVIEW_CHARS)}...`
			: value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	if (depth >= TRACE_VALUE_MAX_DEPTH) {
		return "[Truncated]";
	}
	if (Array.isArray(value)) {
		return value
			.slice(0, TRACE_VALUE_MAX_ENTRIES)
			.map((entry) => sanitizeTraceValue(entry, depth + 1, keyHint));
	}
	if (typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.slice(0, TRACE_VALUE_MAX_ENTRIES)
				.map(([key, entry]) => [key, sanitizeTraceValue(entry, depth + 1, key)]),
		);
	}
	return String(value);
}

function compactRunMeta(params: {
	runId: string;
	userPrompt: string;
	response: string;
	meta?: Record<string, unknown>;
}): SessionRunTrace {
	const meta = params.meta ?? {};
	const teachValidation = asRecord(meta.teachValidation);
	const agentMeta = asRecord(meta.agentMeta);
	return {
		runId: params.runId,
		recordedAt: Date.now(),
		userPromptPreview: params.userPrompt.trim().slice(0, TRACE_VALUE_PREVIEW_CHARS),
		responsePreview: params.response.trim().slice(0, TRACE_VALUE_PREVIEW_CHARS),
		...(typeof meta.durationMs === "number" ? { durationMs: meta.durationMs } : {}),
		...(typeof meta.thoughtText === "string" && meta.thoughtText.trim().length > 0
			? { thoughtText: meta.thoughtText }
			: {}),
		...(Array.isArray(meta.progressSteps)
			? {
				progressSteps: meta.progressSteps
					.slice(-MAX_RECENT_RUN_TRACE_ENTRIES)
					.map((entry) => sanitizeTraceValue(entry) as Record<string, unknown>),
			}
			: {}),
		toolTrace: Array.isArray(meta.toolTrace)
			? meta.toolTrace
				.slice(-MAX_RECENT_RUN_TRACE_ENTRIES)
				.map((entry) => sanitizeTraceValue(entry) as Record<string, unknown>)
			: [],
		attempts: Array.isArray(meta.attempts)
			? meta.attempts
				.slice(-MAX_RECENT_RUN_ATTEMPTS)
				.map((entry) => sanitizeTraceValue(entry) as Record<string, unknown>)
			: [],
		...(teachValidation ? { teachValidation: sanitizeTraceValue(teachValidation) as Record<string, unknown> } : {}),
		...(agentMeta ? { agentMeta: sanitizeTraceValue(agentMeta) as Record<string, unknown> } : {}),
	};
}

function resolveTeachValidationTrace(
	run: SessionRunTrace | Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	if (!run || typeof run !== "object") {
		return undefined;
	}
	return asRecord((run as { teachValidation?: unknown }).teachValidation);
}

function normalizeSessionRunTrace(run: SessionRunTrace): SessionRunTrace {
	const teachValidation = resolveTeachValidationTrace(run);
	return {
		runId: run.runId,
		recordedAt: run.recordedAt,
		userPromptPreview: run.userPromptPreview,
		responsePreview: run.responsePreview,
		...(typeof run.durationMs === "number" ? { durationMs: run.durationMs } : {}),
		...(typeof run.thoughtText === "string" ? { thoughtText: run.thoughtText } : {}),
		...(Array.isArray(run.progressSteps) ? { progressSteps: run.progressSteps } : {}),
		toolTrace: Array.isArray(run.toolTrace) ? run.toolTrace : [],
		attempts: Array.isArray(run.attempts) ? run.attempts : [],
		...(teachValidation ? { teachValidation } : {}),
		...(run.agentMeta ? { agentMeta: run.agentMeta } : {}),
	};
}

function rememberSessionRun(entry: SessionEntry, run: SessionRunTrace): void {
	const existing = Array.isArray(entry.recentRuns) ? entry.recentRuns : [];
	entry.recentRuns = [run, ...existing].slice(0, MAX_RECENT_SESSION_RUNS);
}

export function storeSessionRunTrace(entry: SessionEntry, params: {
	runId: string;
	userPrompt: string;
	response: string;
	meta?: Record<string, unknown>;
}): SessionRunTrace {
	const run = compactRunMeta(params);
	rememberSessionRun(entry, run);
	return run;
}

function extractMessageText(message: unknown): string {
	const chunks = (message as { content?: unknown[] } | null | undefined)?.content;
	if (!Array.isArray(chunks)) return "";
	return chunks
		.filter(
			(chunk): chunk is { type?: unknown; text?: unknown } =>
				Boolean(chunk) && typeof chunk === "object",
		)
		.filter((chunk) => chunk.type === "text" && typeof chunk.text === "string")
		.map((chunk) => chunk.text)
		.join("\n")
		.trim();
}

const RESET_COMMAND_RE = /^\/(new|reset)(?:\s+([\s\S]*))?$/i;
const TEACH_COMMAND_RE = /^\/teach(?:\s+(start|stop|confirm|validate|publish))?(?:\s+([\s\S]*))?$/i;
const MAX_RECENT_SESSION_RUNS = 6;
const MAX_RECENT_RUN_ATTEMPTS = 6;
const MAX_RECENT_RUN_TRACE_ENTRIES = 60;
const TRACE_VALUE_MAX_DEPTH = 4;
const TRACE_VALUE_MAX_ENTRIES = 20;
const TRACE_VALUE_PREVIEW_CHARS = 240;
const TRACE_BINARY_PAYLOAD_KEY_PATTERN = /^(imageData)$/i;
const TRACE_SENSITIVE_KEY_PATTERN = /(pass(word)?|secret|token|api[_-]?key|auth(orization)?|cookie|session)/i;

type RuntimeSessionContextExtras = {
	configOverride?: Partial<UnderstudyConfig>;
	sandboxInfo?: SessionSandboxInfo;
	executionScopeKey?: string;
	images?: ImageContent[];
	attachments?: Attachment[];
};

type TeachSlashCommand = {
	action: "help" | "start" | "stop" | "confirm" | "validate" | "publish";
	trailing?: string;
};

type TeachDraftValidationResult = {
	state: "validated" | "requires_reset" | "failed" | "unvalidated";
	summary: string;
	checks: Array<{
		id: string;
		ok: boolean;
		summary: string;
		details?: string;
		source?: "replay" | "draft";
	}>;
	runId?: string;
	response?: string;
	meta?: Record<string, unknown>;
	mode?: "inspection" | "replay";
	usedMutatingTools?: boolean;
	toolNames?: string[];
	mutatingToolNames?: string[];
};

type TeachClarificationState = {
	draftId: string;
	status: "clarifying" | "ready";
	summary?: string;
	nextQuestion?: string;
	pendingQuestions: string[];
	taskCard?: TaughtTaskCard;
	excludedDemoSteps: string[];
	updatedAt: number;
};

type TeachClarificationExecutionPolicy = {
	toolBinding?: TaughtTaskExecutionPolicy["toolBinding"];
	preferredRoutes?: TaughtTaskExecutionRoute[];
	stepInterpretation?: TaughtTaskExecutionPolicy["stepInterpretation"];
	notes?: string[];
};

type TeachClarificationPayload = {
	title?: string;
	intent?: string;
	objective?: string;
	taskKind?: TaughtTaskKind;
	parameterSlots?: Array<Record<string, unknown> | string>;
	successCriteria?: string[];
	openQuestions?: string[];
	uncertainties?: string[];
	procedure?: Array<Record<string, unknown> | string>;
	executionPolicy?: TeachClarificationExecutionPolicy;
	stepRouteOptions?: Array<Record<string, unknown>>;
	replayPreconditions?: string[];
	resetSignals?: string[];
	skillDependencies?: Array<Record<string, unknown> | string>;
	steps?: Array<Record<string, unknown> | string>;
	summary?: string;
	nextQuestion?: string;
	readyForConfirmation?: boolean;
	taskCard?: Partial<TaughtTaskCard>;
	excludedDemoSteps?: string[];
};

function trimToUndefined(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function normalizeHistoryImages(value: unknown): ImageContent[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const images = value
		.map((entry) => asRecord(entry))
		.filter((entry): entry is Record<string, unknown> => Boolean(entry))
		.map((entry) => {
			const data = asString(entry.data);
			const mimeType = asString(entry.mimeType);
			if (asString(entry.type) !== "image" || !data || !mimeType) {
				return null;
			}
			return {
				type: "image" as const,
				data,
				mimeType,
			};
		})
		.filter((entry): entry is ImageContent => Boolean(entry));
	return images.length > 0 ? images : undefined;
}

function normalizeHistoryAttachments(value: unknown): Attachment[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const attachments = value
		.map((entry) => asRecord(entry))
		.filter((entry): entry is Record<string, unknown> => Boolean(entry))
		.map((entry) => {
			const type = asString(entry.type);
			const url = asString(entry.url);
			if (!type || !url || !["image", "file", "audio", "video"].includes(type)) {
				return null;
			}
			const attachment: Attachment = {
				type: type as Attachment["type"],
				url,
			};
			const name = asString(entry.name);
			const mimeType = asString(entry.mimeType);
			const size = asNumber(entry.size);
			if (name) attachment.name = name;
			if (mimeType) attachment.mimeType = mimeType;
			if (size !== undefined) attachment.size = size;
			return attachment;
		})
		.filter((entry): entry is Attachment => entry !== null);
	return attachments.length > 0 ? attachments : undefined;
}

function buildHistoryAttachmentSummary(attachments: Attachment[] | undefined): string | undefined {
	if (!attachments || attachments.length === 0) {
		return undefined;
	}
	const labels = attachments
		.slice(0, 3)
		.map((attachment) => attachment.name || attachment.url || attachment.type)
		.filter(Boolean);
	if (labels.length === 0) {
		return `Attached ${attachments.length} file${attachments.length === 1 ? "" : "s"}.`;
	}
	return `Attached ${attachments.length} file${attachments.length === 1 ? "" : "s"}: ${labels.join(", ")}${attachments.length > labels.length ? ", ..." : ""}`;
}

function buildRuntimeHistoryContent(entry: SessionEntry["history"][number]): Array<Record<string, unknown>> {
	const content: Array<Record<string, unknown>> = [];
	if (entry.text.trim().length > 0) {
		content.push({ type: "text", text: entry.text });
	}
	for (const image of entry.images ?? []) {
		content.push({
			type: "image",
			data: image.data,
			mimeType: image.mimeType,
		});
	}
	if (content.length === 0) {
		const attachmentSummary = buildHistoryAttachmentSummary(entry.attachments);
		if (attachmentSummary) {
			content.push({ type: "text", text: attachmentSummary });
		} else {
			content.push({ type: "text", text: entry.text });
		}
	}
	return content;
}

function asStringList(value: unknown): string[] {
	return Array.isArray(value)
		? value
			.map((entry) => asString(entry))
			.filter((entry): entry is string => Boolean(entry))
			: [];
}

function resolveRequestedWorkspaceDir(params?: Record<string, unknown>): string | undefined {
	return asString(params?.workspaceDir) ?? asString(params?.cwd);
}

function readTeachClarificationState(entry: SessionEntry): TeachClarificationState | undefined {
	const record = asRecord(entry.sessionMeta?.teachClarification);
	const draftId = trimToUndefined(asString(record?.draftId));
	if (!draftId) {
		return undefined;
	}
	const status = asString(record?.status) === "ready" ? "ready" : "clarifying";
	return {
		draftId,
		status,
		summary: trimToUndefined(asString(record?.summary)),
		nextQuestion: trimToUndefined(asString(record?.nextQuestion)),
		pendingQuestions: asStringList(record?.pendingQuestions),
		taskCard: normalizeTeachTaskCard(asRecord(record?.taskCard)),
		excludedDemoSteps: asStringList(record?.excludedDemoSteps),
		updatedAt: asNumber(record?.updatedAt) ?? Date.now(),
	};
}

function writeTeachClarificationState(entry: SessionEntry, state?: TeachClarificationState): void {
	if (!state) {
		if (entry.sessionMeta && typeof entry.sessionMeta === "object") {
			const nextMeta = { ...entry.sessionMeta };
			delete nextMeta.teachClarification;
			entry.sessionMeta = Object.keys(nextMeta).length > 0 ? nextMeta : undefined;
		}
		return;
	}
	entry.sessionMeta = Object.assign({}, entry.sessionMeta, {
		teachClarification: {
			draftId: state.draftId,
			status: state.status,
			summary: state.summary,
			nextQuestion: state.nextQuestion,
			pendingQuestions: state.pendingQuestions,
			taskCard: state.taskCard,
			excludedDemoSteps: state.excludedDemoSteps,
			updatedAt: state.updatedAt,
		},
	});
}

function isTeachControlNoiseText(value: string | undefined): boolean {
	const text = value?.trim();
	if (!text) {
		return false;
	}
	return /^\/teach(?:\s+(?:start|stop|confirm|validate|publish))\b/i.test(text)
		|| /\bctrl\+c\b/i.test(text);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
	const seen = new Set<string>();
	const next: string[] = [];
	for (const value of values) {
		const trimmed = trimToUndefined(value);
		if (!trimmed) {
			continue;
		}
		const key = trimmed.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		next.push(trimmed);
	}
	return next;
}

function normalizeTeachTaskKind(value: unknown): TaughtTaskKind | undefined {
	switch (trimToUndefined(asString(value))?.toLowerCase()) {
		case "fixed_demo":
			return "fixed_demo";
		case "parameterized_workflow":
			return "parameterized_workflow";
		case "batch_workflow":
			return "batch_workflow";
		default:
			return undefined;
	}
}

function normalizeTeachReplayHints(value: unknown): string[] | undefined {
	const next = uniqueStrings(asStringList(value));
	return next.length > 0 ? next : undefined;
}

function normalizeTeachExecutionRoute(value: unknown): TaughtTaskExecutionRoute | undefined {
	switch (trimToUndefined(asString(value))?.toLowerCase()) {
		case "skill":
			return "skill";
		case "browser":
			return "browser";
		case "shell":
		case "bash":
			return "shell";
		case "gui":
			return "gui";
		default:
			return undefined;
	}
}

function formatTeachExecutionRouteOrder(routes: TaughtTaskExecutionRoute[] | undefined): string | undefined {
	if (!Array.isArray(routes) || routes.length === 0) {
		return undefined;
	}
	return routes.join(" -> ");
}

function normalizeTeachExecutionPolicy(value: unknown): TeachClarificationExecutionPolicy | undefined {
	const record = asRecord(value);
	if (!record || Object.keys(record).length === 0) {
		return undefined;
	}
	const preferredRoutes = Array.isArray(record.preferredRoutes)
		? Array.from(new Set(
			record.preferredRoutes
				.map((entry) => normalizeTeachExecutionRoute(entry))
				.filter((entry): entry is TaughtTaskExecutionRoute => Boolean(entry)),
		))
		: undefined;
	const notes = uniqueStrings(asStringList(record.notes));
	const toolBinding = asString(record.toolBinding) === "fixed"
		? "fixed"
		: asString(record.toolBinding) === "adaptive"
			? "adaptive"
			: undefined;
	const rawStepInterpretation = asString(record.stepInterpretation);
	const stepInterpretation =
		rawStepInterpretation === "evidence" ||
		rawStepInterpretation === "fallback_replay" ||
		rawStepInterpretation === "strict_contract"
			? rawStepInterpretation
			: undefined;
	if (!toolBinding && !preferredRoutes?.length && !stepInterpretation && notes.length === 0) {
		return undefined;
	}
	return {
		...(toolBinding ? { toolBinding } : {}),
		...(preferredRoutes && preferredRoutes.length > 0 ? { preferredRoutes } : {}),
		...(stepInterpretation ? { stepInterpretation } : {}),
		...(notes.length > 0 ? { notes } : {}),
	};
}

function normalizeTeachRouteOptionPreference(
	value: unknown,
): TaughtTaskStepRouteOption["preference"] | undefined {
	switch (trimToUndefined(asString(value))?.toLowerCase()) {
		case "preferred":
			return "preferred";
		case "fallback":
			return "fallback";
		case "observed":
			return "observed";
		default:
			return undefined;
	}
}

function formatTeachRouteOptionTarget(option: Pick<TaughtTaskStepRouteOption, "route" | "toolName" | "skillName">): string {
	if (option.route === "skill" && option.skillName) {
		return `${option.route}/${option.skillName}`;
	}
	return option.toolName ? `${option.route}/${option.toolName}` : option.route;
}

function rankTeachRouteOptionPreference(
	value: TaughtTaskStepRouteOption["preference"] | undefined,
): number {
	switch (value) {
		case "observed":
			return 0;
		case "preferred":
			return 1;
		case "fallback":
			return 2;
		default:
			return 3;
	}
}

function scoreTeachReferenceStepMatch(
	queryTokens: string[],
	step: Record<string, unknown> | TaughtTaskDraftStep,
): number {
	if (queryTokens.length === 0) {
		return 0;
	}
	const stepTokens = new Set(normalizeTeachTextTokens([
		asString(step.instruction),
		asString(step.summary),
		asString(step.target),
		asString(step.app),
		asString(step.scope),
		asString(step.locationHint),
		asString(step.windowTitle),
		"toolArgs" in step && step.toolArgs ? JSON.stringify(step.toolArgs) : undefined,
	].filter(Boolean).join(" ")));
	let score = 0;
	for (const token of queryTokens) {
		if (stepTokens.has(token)) {
			score += 1;
		}
	}
	return score;
}

function buildTeachGuiReferencePathLines(params: {
	procedure: TaughtTaskProcedureStep[];
	stepRouteOptions: Array<TaughtTaskStepRouteOption | Record<string, unknown>>;
	steps: Array<TaughtTaskDraftStep | Record<string, unknown>>;
}): string[] {
	return params.procedure.flatMap((procedureStep) => {
		const guiOption = params.stepRouteOptions
			.map((option) => asRecord(option) ?? option)
			.filter((option) => Boolean(option))
			.filter((option) =>
				asString(option.procedureStepId) === procedureStep.id
				&& normalizeTeachExecutionRoute(option.route) === "gui")
			.sort((left, right) =>
				rankTeachRouteOptionPreference(normalizeTeachRouteOptionPreference(left.preference))
				- rankTeachRouteOptionPreference(normalizeTeachRouteOptionPreference(right.preference)))[0];
		const queryTokens = normalizeTeachTextTokens([
			asString(guiOption?.instruction),
			procedureStep.instruction,
			procedureStep.notes,
		].filter(Boolean).join(" "));
		const stepCandidates = params.steps
			.map((step) => asRecord(step) ?? step)
			.filter((step) =>
				!trimToUndefined(asString(guiOption?.toolName))
				|| trimToUndefined(asString(step.toolName)) === trimToUndefined(asString(guiOption?.toolName)));
		const observedStep =
			guiOption?.preference === "observed"
				? undefined
				: !guiOption && (procedureStep.kind === "transform" || procedureStep.kind === "filter")
				? undefined
				: (stepCandidates.length > 0 ? stepCandidates : params.steps.map((step) => asRecord(step) ?? step))
					.map((step) => ({
						step,
						score: scoreTeachReferenceStepMatch(queryTokens, step),
					}))
					.sort((left, right) =>
						right.score - left.score
						|| (asNumber(left.step.index) ?? 0) - (asNumber(right.step.index) ?? 0))[0]?.step;
		const instruction =
			asString(guiOption?.instruction)
			?? asString(observedStep?.instruction)
			?? procedureStep.instruction;
		const meta: string[] = [];
		if (guiOption) {
			const route = normalizeTeachExecutionRoute(guiOption.route) ?? "gui";
			meta.push(`reference: [${asString(guiOption.preference) ?? "observed"}] [${formatTeachRouteOptionTarget({
				route,
				toolName: trimToUndefined(asString(guiOption.toolName)),
				skillName: trimToUndefined(asString(guiOption.skillName)),
			})}]`);
			if (trimToUndefined(asString(guiOption.when))) meta.push(`when: ${trimToUndefined(asString(guiOption.when))}`);
			if (trimToUndefined(asString(guiOption.notes))) meta.push(`notes: ${trimToUndefined(asString(guiOption.notes))}`);
		}
		if (trimToUndefined(asString(observedStep?.target))) meta.push(`target: ${trimToUndefined(asString(observedStep?.target))}`);
		if (trimToUndefined(asString(observedStep?.app))) meta.push(`app: ${trimToUndefined(asString(observedStep?.app))}`);
		if (trimToUndefined(asString(observedStep?.scope))) meta.push(`scope: ${trimToUndefined(asString(observedStep?.scope))}`);
		return [
			`${procedureStep.index}. ${instruction}`,
			...(meta.length > 0 ? [`   ${meta.join(" | ")}`] : []),
		];
	});
}

function normalizeTeachStepRouteOptions(value: unknown): Array<Record<string, unknown>> | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const next = value
		.map((entry) => asRecord(entry))
		.filter((entry): entry is Record<string, unknown> => Boolean(entry))
		.flatMap<Record<string, unknown>>((entry) => {
			const procedureStepId = trimToUndefined(asString(entry.procedureStepId));
			const route =
				normalizeTeachExecutionRoute(entry.route) ||
				(trimToUndefined(asString(entry.skillName)) ? "skill" : normalizeTeachExecutionRoute(entry.toolName));
			const preference = normalizeTeachRouteOptionPreference(entry.preference);
			const instruction = trimToUndefined(asString(entry.instruction));
			if (!procedureStepId || !route || !instruction) {
				return [];
			}
			const skillName = trimToUndefined(asString(entry.skillName));
			if (route === "skill" && !skillName) {
				return [];
			}
			return [{
				...(trimToUndefined(asString(entry.id)) ? { id: trimToUndefined(asString(entry.id)) } : {}),
				procedureStepId,
				route,
				...(preference ? { preference } : {}),
				instruction,
				...(trimToUndefined(asString(entry.toolName)) ? { toolName: trimToUndefined(asString(entry.toolName)) } : {}),
				...(skillName ? { skillName } : {}),
				...(trimToUndefined(asString(entry.when)) ? { when: trimToUndefined(asString(entry.when)) } : {}),
				...(trimToUndefined(asString(entry.notes)) ? { notes: trimToUndefined(asString(entry.notes)) } : {}),
			}];
		});
	return next.length > 0 ? next : undefined;
}

function normalizeTeachTextTokens(value: string | undefined): string[] {
	const normalized = value
		?.toLowerCase()
		.replace(/[`"'“”‘’()[\]{}?!.,;:/\\|+-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!normalized) {
		return [];
	}
	return Array.from(new Set(
		normalized
			.split(" ")
			.map((entry) => entry.trim())
			.filter((entry) => entry.length >= 2),
	));
}

function isTeachTextRegression(previous: string | undefined, next: string | undefined): boolean {
	const previousValue = trimToUndefined(previous);
	const nextValue = trimToUndefined(next);
	if (!previousValue || !nextValue) {
		return false;
	}
	if (nextValue.length >= previousValue.length) {
		return false;
	}
	const previousTokens = new Set(normalizeTeachTextTokens(previousValue));
	const nextTokens = normalizeTeachTextTokens(nextValue);
	if (previousTokens.size === 0 || nextTokens.length === 0) {
		return false;
	}
	const overlap = nextTokens.filter((token) => previousTokens.has(token)).length;
	return overlap / nextTokens.length >= 0.7;
}

function preferTeachText(
	previous: string | undefined,
	explicit: string | undefined,
	inferred?: string,
): string | undefined {
	if (explicit && previous && isTeachTextRegression(previous, explicit)) {
		return previous;
	}
	return explicit ?? previous ?? inferred;
}

function normalizeTeachTaskCard(value?: Record<string, unknown>): TaughtTaskCard | undefined {
	if (!value || Object.keys(value).length === 0) {
		return undefined;
	}
	const goal = trimToUndefined(asString(value.goal));
	const scope = trimToUndefined(asString(value.scope));
	const loopOver = trimToUndefined(asString(value.loopOver));
	const inputs = uniqueStrings(asStringList(value.inputs));
	const extract = uniqueStrings(asStringList(value.extract));
	const formula = trimToUndefined(asString(value.formula));
	const filter = trimToUndefined(asString(value.filter));
	const output = trimToUndefined(asString(value.output));
	if (!goal && !scope && !loopOver && inputs.length === 0 && extract.length === 0 && !formula && !filter && !output) {
		return undefined;
	}
	return {
		...(goal ? { goal } : {}),
		...(scope ? { scope } : {}),
		...(loopOver ? { loopOver } : {}),
		inputs,
		extract,
		...(formula ? { formula } : {}),
		...(filter ? { filter } : {}),
		...(output ? { output } : {}),
	};
}

function normalizeTeachProcedureStep(
	value: Record<string, unknown> | string,
	index: number,
): TaughtTaskProcedureStep | undefined {
	if (typeof value === "string") {
		const instruction = trimToUndefined(value);
		return instruction
			? {
				id: `procedure-${index + 1}`,
				index: index + 1,
				instruction,
			}
			: undefined;
	}
	const instruction = trimToUndefined(asString(value.instruction) ?? asString(value.summary));
	if (!instruction) {
		return undefined;
	}
	const rawKind = asString(value.kind);
	const kind = rawKind && ["navigate", "extract", "transform", "filter", "output", "skill", "check"].includes(rawKind)
		? rawKind as TaughtTaskProcedureStep["kind"]
		: undefined;
	return {
		id: trimToUndefined(asString(value.id)) ?? `procedure-${index + 1}`,
		index: index + 1,
		instruction,
		...(kind ? { kind } : {}),
		...(trimToUndefined(asString(value.skillName)) ? {
			skillName: trimToUndefined(asString(value.skillName)),
		} : {}),
		...(trimToUndefined(asString(value.notes)) ? { notes: trimToUndefined(asString(value.notes)) } : {}),
		uncertain: asBoolean(value.uncertain) === true,
	};
}

function normalizeTeachProcedure(value: unknown): TaughtTaskProcedureStep[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const next = value
		.map((entry, index) => typeof entry === "string"
			? normalizeTeachProcedureStep(entry, index)
			: normalizeTeachProcedureStep(asRecord(entry) ?? {}, index))
		.filter((entry): entry is TaughtTaskProcedureStep => Boolean(entry));
	return next.length > 0 ? next : undefined;
}

function normalizeTeachSkillDependencies(value: unknown): TaughtTaskSkillDependency[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const next = value
		.map((entry) => {
			if (typeof entry === "string") {
				const name = trimToUndefined(entry);
				return name ? { name, required: true } : undefined;
			}
			const record = asRecord(entry);
			const name = trimToUndefined(asString(record?.name));
			return name
				? {
					name,
					...(trimToUndefined(asString(record?.reason)) ? { reason: trimToUndefined(asString(record?.reason)) } : {}),
					required: asBoolean(record?.required) !== false,
				}
				: undefined;
		})
		.filter((entry): entry is TaughtTaskSkillDependency => Boolean(entry));
	return next.length > 0 ? next : undefined;
}


function summarizeTeachDraftPublishBlocker(draft: TaughtTaskDraft): string | undefined {
	if (draft.openQuestions.length > 0) {
		return `Draft still has open questions: ${draft.openQuestions.join("; ")}`;
	}
	if (draft.uncertainties.length > 0) {
		return `Draft still has unresolved uncertainties: ${draft.uncertainties.join("; ")}`;
	}
	const uncertainSteps = draft.steps
		.filter((step) => step.uncertain === true)
		.map((step) => `${step.index}. ${step.instruction}`);
	if (uncertainSteps.length > 0) {
		return `Draft still has uncertain steps: ${uncertainSteps.join(" | ")}`;
	}
	return undefined;
}

function parseTeachDraftTarget(trailing?: string): { draftId?: string; name?: string } {
	const trimmed = trimToUndefined(trailing);
	if (!trimmed) {
		return {};
	}
	const [draftId, ...rest] = trimmed.split(/\s+/);
	const name = trimToUndefined(rest.join(" "));
	return draftId?.trim()
		? {
			draftId: draftId.trim(),
			...(name ? { name } : {}),
		}
		: {};
}

function resolveTeachConfirmValidationMode(trailing?: string): "skip" | "validate" {
	const trimmed = trimToUndefined(trailing)?.toLowerCase();
	if (!trimmed) {
		return "skip";
	}
	const tokens = trimmed.split(/\s+/).filter(Boolean);
	let mode: "skip" | "validate" = "skip";
	for (const token of tokens) {
		const normalized = token.replace(/^--/, "");
		if (normalized === "validate") {
			mode = "validate";
		} else if (normalized === "no-validate" || normalized === "skip-validation" || normalized === "skip") {
			mode = "skip";
		}
	}
	return mode;
}

function normalizeTeachValidationState(value: unknown): TeachDraftValidationResult["state"] | undefined {
	switch (asString(value)?.trim().toLowerCase()) {
		case "validated":
			return "validated";
		case "requires_reset":
			return "requires_reset";
		case "failed":
			return "failed";
		case "unvalidated":
			return "unvalidated";
		default:
			return undefined;
	}
}

function normalizeTeachValidationCheck(
	value: unknown,
	index: number,
	defaultSource: "replay" | "draft" = "replay",
): TeachDraftValidationResult["checks"][number] | undefined {
	if (typeof value === "string") {
		const summary = trimToUndefined(value);
		return summary
			? {
				id: `teach-validation-${index + 1}`,
				ok: false,
				summary,
				source: defaultSource,
			}
			: undefined;
	}
	const record = asRecord(value);
	const summary = trimToUndefined(asString(record?.summary));
	if (!summary) {
		return undefined;
	}
	const source = asString(record?.source) === "draft" ? "draft" : defaultSource;
	return {
		id: trimToUndefined(asString(record?.id)) ?? `teach-validation-${index + 1}`,
		ok: record?.ok === true,
		summary,
		details: trimToUndefined(asString(record?.details)),
		source,
	};
}

const READ_ONLY_TEACH_VALIDATION_TOOLS = new Set([
	"gui_observe",
	"gui_wait",
	"vision_read",
	"runtime_status",
	"session_status",
	"sessions_list",
	"sessions_history",
	"web_fetch",
	"web_search",
]);

const DEFAULT_TEACH_CLARIFY_TIMEOUT_MS = 60_000;
// GUI replays can legitimately take several minutes, so validation does not
// apply a default prompt timeout unless the operator configures one explicitly.
const DEFAULT_TEACH_VALIDATE_TIMEOUT_MS = 0;

function resolveTeachInternalPromptTimeoutMs(kind: "clarify" | "validate"): number {
	const envName = kind === "validate"
		? "UNDERSTUDY_TEACH_VALIDATE_TIMEOUT_MS"
		: "UNDERSTUDY_TEACH_CLARIFY_TIMEOUT_MS";
	const configured = asNumber(process.env[envName]);
	if (configured !== undefined && Number.isFinite(configured) && configured >= 0) {
		return Math.max(0, Math.floor(configured));
	}
	return kind === "validate" ? DEFAULT_TEACH_VALIDATE_TIMEOUT_MS : DEFAULT_TEACH_CLARIFY_TIMEOUT_MS;
}

function isTeachValidationMutatingTool(name: string): boolean {
	const normalized = name.trim().toLowerCase();
	if (!normalized) {
		return false;
	}
	if (READ_ONLY_TEACH_VALIDATION_TOOLS.has(normalized)) {
		return false;
	}
	if (normalized === "browser" || normalized === "bash" || normalized === "process") {
		return true;
	}
	return normalized.startsWith("gui_");
}

function draftExpectsMutatingReplay(draft: TaughtTaskDraft): boolean {
	return draft.steps.some((step) => isTeachValidationMutatingTool(step.toolName));
}

function analyzeTeachValidationTrace(meta?: Record<string, unknown>): {
	toolCalls: number;
	failures: string[];
	blockingFailures: string[];
	recoverableFailures: string[];
	toolNames: string[];
	mutatingToolNames: string[];
} {
	const toolTrace = Array.isArray(meta?.toolTrace) ? meta.toolTrace : [];
	let toolCalls = 0;
	const failures: string[] = [];
	const failureEvents: Array<{ index: number; detail: string }> = [];
	const recoveryPoints: number[] = [];
	const toolNames: string[] = [];
	const mutatingToolNames: string[] = [];
	for (let index = 0; index < toolTrace.length; index += 1) {
		const item = toolTrace[index];
		const record = asRecord(item);
		if (!record) {
			continue;
		}
		if (record.type === "toolCall") {
			toolCalls += 1;
			const toolName = trimToUndefined(asString(record.name));
			if (toolName) {
				toolNames.push(toolName);
				if (isTeachValidationMutatingTool(toolName)) {
					mutatingToolNames.push(toolName);
				}
			}
		}
		const statusInfo = asRecord(record.status);
		const statusCode = asString(statusInfo?.code)?.toLowerCase();
		if (record.type === "toolResult" && record.isError !== true) {
			const marksProgress = statusCode
				? ["action_sent", "condition_met", "completed", "observed", "resolved"].includes(statusCode)
				: false;
			if (marksProgress) {
				recoveryPoints.push(index);
			}
		}
		const hasFailureStatus = statusCode
			? ["failed", "blocked", "requires_user", "timeout", "unsupported"].includes(statusCode)
			: false;
		if (record.isError === true || hasFailureStatus) {
			const toolName = asString(record.name) ?? "unknown tool";
			const detail =
				trimToUndefined(asString(record.error))
				?? trimToUndefined(asString(statusInfo?.summary))
				?? statusCode;
			const failure = detail ? `${toolName}: ${detail}` : toolName;
			failures.push(failure);
			failureEvents.push({
				index,
				detail: failure,
			});
		}
	}
	const blockingFailures: string[] = [];
	const recoverableFailures: string[] = [];
	for (const failure of failureEvents) {
		const recovered = recoveryPoints.some((point) => point > failure.index);
		if (recovered) {
			recoverableFailures.push(failure.detail);
			continue;
		}
		blockingFailures.push(failure.detail);
	}
	return {
		toolCalls,
		failures,
		blockingFailures,
		recoverableFailures,
		toolNames: uniqueStrings(toolNames),
		mutatingToolNames: uniqueStrings(mutatingToolNames),
	};
}

function buildTeachDraftValidationPreflight(draft: TaughtTaskDraft): TeachDraftValidationResult | undefined {
	const blocker = summarizeTeachDraftPublishBlocker(draft);
	if (blocker) {
		return {
			state: "unvalidated",
			summary: blocker,
			checks: [
				{
					id: "draft-readiness:review_required",
					ok: false,
					summary: blocker,
					source: "draft",
				},
			],
		};
	}
	const lintIssues = lintTaughtTaskDraft(draft);
	if (lintIssues.length > 0) {
		const summary = `Teach draft is internally inconsistent: ${lintIssues.map((issue) => issue.summary).join(" ")}`;
		return {
			state: "failed",
			summary,
			checks: lintIssues.map((issue) => ({
				id: issue.id,
				ok: false,
				summary: issue.summary,
				source: "draft" as const,
			})),
		};
	}
	if (draft.steps.length === 0) {
		return {
			state: "failed",
			summary: "Teach draft does not contain any taught steps yet.",
			checks: [
				{
					id: "draft-readiness:steps",
					ok: false,
					summary: "Teach draft does not contain any taught steps yet.",
					source: "draft",
				},
			],
		};
	}
	if (draft.successCriteria.length === 0) {
		return {
			state: "failed",
			summary: "Teach draft does not define success criteria yet.",
			checks: [
				{
					id: "draft-readiness:success_criteria",
					ok: false,
					summary: "Teach draft does not define success criteria yet.",
					source: "draft",
				},
			],
		};
	}
	if (draft.procedure.length === 0) {
		return {
			state: "failed",
			summary: "Teach draft does not define a high-level procedure yet.",
			checks: [
				{
					id: "draft-readiness:procedure",
					ok: false,
					summary: "Teach draft does not define a high-level procedure yet.",
					source: "draft",
				},
			],
		};
	}
	if (!draft.objective.trim()) {
		return {
			state: "failed",
			summary: "Teach draft objective is missing.",
			checks: [
				{
					id: "draft-readiness:objective",
					ok: false,
					summary: "Teach draft objective is missing.",
					source: "draft",
				},
			],
		};
	}
	const missingSamples = draft.parameterSlots
		.filter((slot) => slot.required === true && !slot.sampleValue?.trim())
		.map((slot) => slot.name);
	if (missingSamples.length > 0) {
		return {
			state: "failed",
			summary: `Teach draft is missing sample values for required parameters: ${missingSamples.join(", ")}.`,
			checks: [
				{
					id: "draft-readiness:required_parameter_samples",
					ok: false,
					summary: `Teach draft is missing sample values for required parameters: ${missingSamples.join(", ")}.`,
					source: "draft",
				},
			],
		};
	}
	return undefined;
}

function summarizeTeachStepForPrompt(step: TaughtTaskDraft["steps"][number]): Record<string, unknown> {
	return {
		index: step.index,
		route: step.route,
		toolName: step.toolName,
		instruction: step.instruction,
		summary: step.summary,
		target: step.target,
		app: step.app,
		scope: step.scope,
		inputs: step.inputs,
		toolArgs: step.toolArgs,
		locationHint: step.locationHint,
		windowTitle: step.windowTitle,
		captureMode: step.captureMode,
		groundingMode: step.groundingMode,
		verificationStatus: step.verificationStatus,
		verificationSummary: step.verificationSummary,
		uncertain: step.uncertain === true,
	};
}

const TEACH_STEP_TOOL_ARG_RESERVED_KEYS = new Set([
	"index",
	"route",
	"toolName",
	"instruction",
	"summary",
	"target",
	"app",
	"scope",
	"inputs",
	"toolArgs",
	"locationHint",
	"windowTitle",
	"captureMode",
	"groundingMode",
	"verificationStatus",
	"verificationSummary",
	"uncertain",
]);

function buildTeachClarificationPrompt(params: {
	draft: TaughtTaskDraft;
	userReply?: string;
	state?: TeachClarificationState;
	capabilitySnapshot?: TeachCapabilitySnapshot;
}): string {
	const draftSummary = {
		id: params.draft.id,
		title: params.draft.title,
		intent: params.draft.intent,
		objective: params.draft.objective,
		taskKind: params.draft.taskKind,
		parameterSlots: params.draft.parameterSlots,
		successCriteria: params.draft.successCriteria,
		openQuestions: params.draft.openQuestions,
		uncertainties: params.draft.uncertainties,
		taskCard: params.draft.taskCard,
		procedure: params.draft.procedure,
		executionPolicy: params.draft.executionPolicy,
		stepRouteOptions: params.draft.stepRouteOptions,
		replayPreconditions: params.draft.replayPreconditions,
		resetSignals: params.draft.resetSignals,
		skillDependencies: params.draft.skillDependencies,
		steps: params.draft.steps.map((step) => summarizeTeachStepForPrompt(step)),
	};
	return [
		"You are shaping an Understudy teach draft into a reusable task spec through dialogue with the user.",
		"Your primary output is a reusable task card plus a high-level procedure. The raw observed steps are only evidence.",
		"The demo may show only one concrete instance; infer reusable intent only when the user explicitly asks for generalization.",
			"Choose taskKind explicitly: fixed_demo, parameterized_workflow, or batch_workflow.",
			"If taskKind is fixed_demo, parameterSlots must be empty and taskCard.inputs must be empty.",
			"If taskKind is parameterized_workflow, keep semantic parameters and do not leave the procedure hard-coded to only the demo literal value.",
			"If taskKind is batch_workflow, taskCard.loopOver must be populated and the procedure should describe the repeated unit of work.",
			"Default executionPolicy.toolBinding to adaptive. Use fixed only when the route or tool family is part of the task semantics.",
			"Use executionPolicy.preferredRoutes to express route preference, not to mirror the demo mechanically. Usually prefer skill -> browser -> shell -> gui when they preserve the same externally visible result.",
			"Use executionPolicy.stepInterpretation=fallback_replay by default. Only use strict_contract when the exact route or tool sequence is semantically required.",
			"Use stepRouteOptions to capture non-binding implementation choices for specific procedure steps.",
			"stepRouteOptions should list meaningful alternatives such as skill vs shell vs gui. They are examples and preferences, not a strict requirement to use that exact tool.",
			"Use preference=preferred for the best route, fallback for a backup route, and observed for what the demo literally showed.",
			"Choose toolName and skillName values only from the current teach-time capability snapshot.",
			"Do not invent tools or skills that are not present in that snapshot.",
			"Treat recording-control actions such as returning to Understudy, typing `/teach stop`, or sending Ctrl+C as demo-only noise unless the user explicitly wants them kept.",
			"Prefer semantic procedure steps over app-switching trivia and low-level click metadata.",
			"The GUI demonstration is evidence, not an execution ceiling. If a semantically equivalent browser, bash, or existing-skill route would achieve the same externally visible result more efficiently and reliably for an agent, prefer that route in the draft.",
			"Keep raw GUI steps only when direct UI interaction is actually required or when switching to a higher-level route would change the task semantics.",
			"Use any exact runtime function or workspace skill name from the current teach-time capability snapshot when it is the best fit. Do not assume only browser/bash/gui are available.",
		'Review step target descriptions for GUI grounding quality. Each target should quote visible text labels (e.g. \'button labeled "Save"\' not "the save button"), include control role, and have nearby context so the runtime can ground them visually during replay.',
			"Preserve previously confirmed task details unless the user explicitly changes them.",
			"Do not reintroduce an open question when the user's latest reply already answers it.",
			"Do not ask the same clarification again with different wording after the user has already answered it.",
			"When an existing workspace skill cleanly matches a subtask, list it in skillDependencies and reference it in procedure instead of restating low-level UI steps.",
			"Capture replayPreconditions for the minimum required starting state, and resetSignals for when the environment must be restored before replay.",
			"Keep exact replay-only GUI parameters such as button, clicks, holdMs, windowSelector, fromTarget/toTarget, wait state, repeat, and modifiers inside steps[].toolArgs so observed GUI steps stay faithful to the current runtime contract.",
			"When uncertainty remains, keep readyForConfirmation as false and list every material clarification question that still blocks a solid task card.",
			"Prefer 1-3 concise questions when possible, but do not force everything into a single nextQuestion.",
			"Teach confirmation is controlled only by the `/teach confirm` slash command.",
			"When the task card is ready, set readyForConfirmation to true, clear openQuestions and uncertainties, and leave nextQuestion empty.",
			"Use openQuestions and uncertainties as the canonical outstanding issues. nextQuestion is optional shorthand only when a single question is enough.",
			"Return strict JSON only.",
			'Schema: {"title":"...","intent":"...","objective":"...","taskKind":"fixed_demo|parameterized_workflow|batch_workflow","parameterSlots":[{"name":"...","label":"...","sampleValue":"...","required":true,"notes":"..."}],"successCriteria":["..."],"openQuestions":["..."],"uncertainties":["..."],"procedure":[{"instruction":"...","kind":"navigate|extract|transform|filter|output|skill|check","skillName":"optional-skill-name","notes":"...","uncertain":false}],"executionPolicy":{"toolBinding":"adaptive|fixed","preferredRoutes":["skill","browser","shell","gui"],"stepInterpretation":"evidence|fallback_replay|strict_contract","notes":["..."]},"stepRouteOptions":[{"procedureStepId":"procedure-1","route":"skill|browser|shell|gui","preference":"preferred|fallback|observed","instruction":"...","toolName":"exact-available-tool-name","skillName":"optional-skill-name","when":"...","notes":"..."}],"replayPreconditions":["..."],"resetSignals":["..."],"skillDependencies":[{"name":"...","reason":"...","required":true}],"steps":[{"route":"gui|browser|shell|web|workspace|memory|messaging|automation|system|custom","toolName":"exact-available-tool-name","instruction":"...","summary":"...","target":"...","app":"...","scope":"...","locationHint":"...","windowTitle":"...","captureMode":"window|display","groundingMode":"single|complex","inputs":{"key":"value"},"toolArgs":{"button":"right","windowSelector":{"titleContains":"Draft"}},"verificationSummary":"...","uncertain":false}],"taskCard":{"goal":"...","scope":"...","loopOver":"...","inputs":["..."],"extract":["..."],"formula":"...","filter":"...","output":"..."},"summary":"...","nextQuestion":"...","readyForConfirmation":false,"excludedDemoSteps":["..."]}',
			"Keep the task card concise and reusable.",
		"Current draft JSON:",
		JSON.stringify(draftSummary, null, 2),
		...(params.capabilitySnapshot
			? formatTeachCapabilitySnapshotForPrompt(params.capabilitySnapshot)
			: []),
		...(params.state?.taskCard
			? [
				"Current task card JSON:",
				JSON.stringify(params.state.taskCard, null, 2),
			]
			: []),
		...(params.state?.pendingQuestions?.length
			? [
				params.userReply
					? "Outstanding clarification topics the user's reply may be addressing:"
					: "Outstanding clarification topics:",
				...params.state.pendingQuestions.map((question, index) => `${index + 1}. ${question}`),
			]
			: []),
		...(params.userReply
			? [`User reply: ${params.userReply}`]
			: ["Bootstrap the clarification: clean the initial task card, remove demo-only noise when obvious, and ask the best next question."]),
	].join("\n");
}

function normalizeTeachClarificationPayload(payload: Record<string, unknown>): TeachClarificationPayload {
	const parameterSlots = Array.isArray(payload.parameterSlots) ? payload.parameterSlots : undefined;
	const successCriteria = Array.isArray(payload.successCriteria) ? payload.successCriteria : undefined;
	const openQuestions = Array.isArray(payload.openQuestions) ? payload.openQuestions : undefined;
	const procedure = Array.isArray(payload.procedure)
		? payload.procedure
		: undefined;
	const skillDependencies = Array.isArray(payload.skillDependencies) ? payload.skillDependencies : undefined;
	const nextQuestion = trimToUndefined(asString(payload.nextQuestion));
	const excludedDemoSteps = Array.isArray(payload.excludedDemoSteps) ? payload.excludedDemoSteps : undefined;
	const taskCard = normalizeTeachTaskCard(
		asRecord(payload.taskCard),
	);
	return {
		title: trimToUndefined(asString(payload.title)),
		intent: trimToUndefined(asString(payload.intent)),
		objective: trimToUndefined(asString(payload.objective)),
		taskKind: normalizeTeachTaskKind(payload.taskKind),
		parameterSlots: Array.isArray(parameterSlots)
			? parameterSlots.filter((entry): entry is Record<string, unknown> | string =>
					typeof entry === "string" || Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
			: undefined,
		successCriteria: Array.isArray(successCriteria) ? asStringList(successCriteria) : undefined,
		openQuestions: Array.isArray(openQuestions) ? asStringList(openQuestions) : undefined,
		uncertainties: Array.isArray(payload.uncertainties) ? asStringList(payload.uncertainties) : undefined,
		procedure: Array.isArray(procedure)
			? procedure.filter((entry): entry is Record<string, unknown> | string =>
					typeof entry === "string" || Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
			: undefined,
		executionPolicy: normalizeTeachExecutionPolicy(payload.executionPolicy),
		stepRouteOptions: normalizeTeachStepRouteOptions(payload.stepRouteOptions),
		replayPreconditions: normalizeTeachReplayHints(payload.replayPreconditions),
		resetSignals: normalizeTeachReplayHints(payload.resetSignals),
		skillDependencies: Array.isArray(skillDependencies)
			? skillDependencies.filter((entry): entry is Record<string, unknown> | string =>
					typeof entry === "string" || Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
			: undefined,
		steps: Array.isArray(payload.steps)
			? payload.steps.filter((entry): entry is Record<string, unknown> | string =>
				typeof entry === "string" || Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
			: undefined,
		taskCard,
		summary: trimToUndefined(asString(payload.summary)),
		nextQuestion,
		readyForConfirmation: asBoolean(payload.readyForConfirmation),
		excludedDemoSteps: Array.isArray(excludedDemoSteps) ? asStringList(excludedDemoSteps) : undefined,
	};
}

function inferTeachTaskCardFromDraft(draft: TaughtTaskDraft, previous?: TaughtTaskCard): TaughtTaskCard {
	const baseTaskCard = draft.taskCard;
	const goal = previous?.goal ?? baseTaskCard?.goal ?? trimToUndefined(draft.objective || draft.intent || draft.title);
	const scope = previous?.scope ?? baseTaskCard?.scope ?? "Reusable workflow derived from the demonstration.";
	const loopOver = previous?.loopOver ?? baseTaskCard?.loopOver;
	const extract = previous?.extract && previous.extract.length > 0
		? previous.extract
		: baseTaskCard?.extract && baseTaskCard.extract.length > 0
			? baseTaskCard.extract
			: [];
	const formula = previous?.formula ?? baseTaskCard?.formula;
	const filter = previous?.filter ?? baseTaskCard?.filter;
	const output = previous?.output ?? baseTaskCard?.output;
	return {
		...(goal ? { goal } : {}),
		...(scope ? { scope } : {}),
		...(loopOver ? { loopOver } : {}),
		inputs: previous?.inputs && previous.inputs.length > 0
			? previous.inputs
			: baseTaskCard?.inputs && baseTaskCard.inputs.length > 0
				? baseTaskCard.inputs
				: uniqueStrings(draft.parameterSlots.map((slot) => slot.label || slot.name)),
		extract,
		...(formula ? { formula } : {}),
		...(filter ? { filter } : {}),
		...(output ? { output } : {}),
	};
}

function resolveTeachTaskCard(params: {
	draft: TaughtTaskDraft;
	payload?: TeachClarificationPayload;
	previous?: TaughtTaskCard;
}): TaughtTaskCard {
	const inferred = inferTeachTaskCardFromDraft(params.draft, params.previous);
	const explicit = params.payload?.taskCard;
	return {
		goal: preferTeachText(params.previous?.goal, explicit?.goal, inferred.goal),
		scope: preferTeachText(params.previous?.scope, explicit?.scope, inferred.scope),
		loopOver: preferTeachText(params.previous?.loopOver, explicit?.loopOver, inferred.loopOver),
		inputs: explicit?.inputs && explicit.inputs.length > 0
			? explicit.inputs
			: params.previous?.inputs && params.previous.inputs.length > 0
				? params.previous.inputs
				: inferred.inputs,
		extract: explicit?.extract && explicit.extract.length > 0
			? explicit.extract
			: params.previous?.extract && params.previous.extract.length > 0
				? params.previous.extract
				: inferred.extract,
		...(preferTeachText(params.previous?.formula, explicit?.formula, inferred.formula)
			? { formula: preferTeachText(params.previous?.formula, explicit?.formula, inferred.formula) }
			: {}),
		...(preferTeachText(params.previous?.filter, explicit?.filter, inferred.filter)
			? { filter: preferTeachText(params.previous?.filter, explicit?.filter, inferred.filter) }
			: {}),
		...(preferTeachText(params.previous?.output, explicit?.output, inferred.output)
			? { output: preferTeachText(params.previous?.output, explicit?.output, inferred.output) }
			: {}),
	};
}

function defaultTeachClarificationQuestion(draft: TaughtTaskDraft): string | undefined {
	const pending = uniqueStrings([
		...draft.openQuestions,
		...draft.uncertainties,
	]);
	return pending.length === 1 ? pending[0] : undefined;
}

function resolveTeachClarificationQuestion(params: {
	draft: TaughtTaskDraft;
	preferred?: string;
}): string | undefined {
	const pending = uniqueStrings([
		...params.draft.openQuestions,
		...params.draft.uncertainties,
	]);
	if (pending.length === 0) {
		return undefined;
	}
	const preferred = trimToUndefined(params.preferred);
	if (preferred && pending.includes(preferred)) {
		return preferred;
	}
	return pending.length === 1 ? pending[0] : undefined;
}

function buildTeachControlNoisePatch(draft: TaughtTaskDraft): {
	steps?: TaughtTaskDraft["steps"];
	successCriteria?: string[];
	openQuestions?: string[];
	uncertainties?: string[];
	excludedDemoSteps: string[];
} {
	const keptSteps = draft.steps.filter((step) => {
		const inputsText = step.inputs ? Object.values(step.inputs).join(" ") : "";
		const toolArgsText = step.toolArgs ? JSON.stringify(step.toolArgs) : "";
		const haystack = [
			step.instruction,
			step.summary,
			step.target,
			step.app,
			step.scope,
			step.verificationSummary,
			inputsText,
			toolArgsText,
		].filter(Boolean).join(" ");
		return !isTeachControlNoiseText(haystack);
	});
	const excludedDemoSteps = draft.steps
		.filter((step) => !keptSteps.some((kept) => kept.index === step.index && kept.instruction === step.instruction))
		.map((step) => step.instruction);
	const keptSuccessCriteria = draft.successCriteria.filter((entry) => !isTeachControlNoiseText(entry));
	const keptOpenQuestions = draft.openQuestions.filter((entry) => !isTeachControlNoiseText(entry));
	const keptUncertainties = draft.uncertainties.filter((entry) => !isTeachControlNoiseText(entry));
	return {
		...(keptSteps.length !== draft.steps.length ? { steps: keptSteps } : {}),
		...(keptSuccessCriteria.length !== draft.successCriteria.length ? { successCriteria: keptSuccessCriteria } : {}),
		...(keptOpenQuestions.length !== draft.openQuestions.length ? { openQuestions: keptOpenQuestions } : {}),
		...(keptUncertainties.length !== draft.uncertainties.length ? { uncertainties: keptUncertainties } : {}),
		excludedDemoSteps,
	};
}

function buildTeachDraftValidationPrompt(draft: TaughtTaskDraft): string {
	const request =
		trimToUndefined(draft.objective)
		?? trimToUndefined(draft.intent)
		?? trimToUndefined(draft.title)
		?? "Please complete the taught task.";
	const procedure = draft.procedure.length > 0
		? draft.procedure.map((step) => step.instruction)
		: draft.steps.map((step) => step.instruction);
	const taskCardLines = [
		trimToUndefined(draft.taskCard?.goal) ? `Goal: ${trimToUndefined(draft.taskCard?.goal)}` : undefined,
		trimToUndefined(draft.taskCard?.scope) ? `Scope: ${trimToUndefined(draft.taskCard?.scope)}` : undefined,
		trimToUndefined(draft.taskCard?.loopOver) ? `Loop over: ${trimToUndefined(draft.taskCard?.loopOver)}` : undefined,
		Array.isArray(draft.taskCard?.inputs) && draft.taskCard.inputs.length > 0
			? `Inputs: ${draft.taskCard.inputs.join("; ")}`
			: undefined,
		Array.isArray(draft.taskCard?.extract) && draft.taskCard.extract.length > 0
			? `Extract: ${draft.taskCard.extract.join("; ")}`
			: undefined,
		trimToUndefined(draft.taskCard?.formula) ? `Formula: ${trimToUndefined(draft.taskCard?.formula)}` : undefined,
		trimToUndefined(draft.taskCard?.filter) ? `Filter: ${trimToUndefined(draft.taskCard?.filter)}` : undefined,
		trimToUndefined(draft.taskCard?.output) ? `Output: ${trimToUndefined(draft.taskCard?.output)}` : undefined,
	].filter((value): value is string => Boolean(value));
	const successCriteriaLines = draft.successCriteria
		.map((entry) => trimToUndefined(entry))
		.filter((value): value is string => Boolean(value))
		.map((value, index) => `${index + 1}. ${value}`);
	const sampleValues = draft.parameterSlots
		.map((slot) => {
			const sampleValue = trimToUndefined(slot.sampleValue);
			if (!sampleValue) {
				return undefined;
			}
			return `${trimToUndefined(slot.label) ?? slot.name}: ${sampleValue}`;
		})
		.filter((value): value is string => Boolean(value));
	const executionPolicyLines = [
		`- Tool binding: ${draft.executionPolicy.toolBinding}`,
		...(formatTeachExecutionRouteOrder(draft.executionPolicy.preferredRoutes)
			? [`- Preferred routes: ${formatTeachExecutionRouteOrder(draft.executionPolicy.preferredRoutes)}`]
			: []),
		`- Detailed steps meaning: ${draft.executionPolicy.stepInterpretation}`,
		...draft.executionPolicy.notes.map((note) => `- ${note}`),
	];
	const stepRouteOptionLines = draft.procedure.flatMap((step) => {
		const options = draft.stepRouteOptions.filter((option) => option.procedureStepId === step.id);
		if (options.length === 0) {
			return [];
		}
		return [
			`${step.index}. ${step.instruction}`,
			...options.flatMap((option) => [
				`- [${option.preference}] [${formatTeachRouteOptionTarget(option)}] ${option.instruction}`,
				...(option.when ? [`  when: ${option.when}`] : []),
				...(option.notes ? [`  notes: ${option.notes}`] : []),
			]),
		];
	});
	const procedureLines = draft.procedure.map((step) => `${step.index}. ${step.instruction}`);
	const guiReferencePathLines = buildTeachGuiReferencePathLines({
		procedure: draft.procedure,
		stepRouteOptions: draft.stepRouteOptions,
		steps: draft.steps,
	});
	return [
		request,
		...(sampleValues.length > 0
			? [`Use these sample values if the task needs concrete inputs: ${sampleValues.join("; ")}.`]
			: []),
		"Return only JSON.",
		"Required JSON shape:",
		JSON.stringify({
			state: "validated",
			summary: "Short outcome summary.",
			checks: [
				{
					ok: true,
					summary: "Concrete validation check.",
					details: "Optional supporting detail.",
				},
			],
		}),
		"Validation instructions:",
		"- Treat this as a fresh replay, not a passive inspection of the already-finished demo state.",
		"- Prefer a newly opened tab/window/app or another freshly entered surface when possible, instead of reusing an existing page or UI that may already reflect the completed result.",
		"- Do not count the task as validated just because the end state from the demonstration is still visible. Recreate the decisive state transition or report that reset is required.",
		"- If a semantically equivalent browser, bash, or linked-skill route reaches the same externally visible outcome more directly and reliably, prefer it over raw GUI replay.",
		"- Mark state as `validated` only if the task was actually replayed and the success criteria are satisfied.",
		"- If an exploratory attempt fails but a later attempt recovers and reaches the success criteria, report the final successful outcome in JSON and mention the recovery in `checks` instead of treating it as an automatic failure.",
		...(procedureLines.length > 0
			? [`Staged workflow:\n${procedureLines.join("\n")}`]
			: []),
		...(guiReferencePathLines.length > 0
			? [`GUI reference path (reference only):\n${guiReferencePathLines.join("\n")}`]
			: []),
		...(executionPolicyLines.length > 0
			? [`Execution policy:\n${executionPolicyLines.join("\n")}`]
			: []),
		...(stepRouteOptionLines.length > 0
			? [`Step route options (non-binding, prefer the best matching option first):\n${stepRouteOptionLines.join("\n")}`]
			: []),
		...(taskCardLines.length > 0
			? [`Task card:\n${taskCardLines.join("\n")}`]
			: []),
		...(successCriteriaLines.length > 0
			? [`Success criteria:\n${successCriteriaLines.join("\n")}`]
			: []),
		...(draft.replayPreconditions.length > 0
			? [
				"Replay preconditions:",
				...draft.replayPreconditions.map((entry) => `- ${entry}`),
			]
			: []),
		...(draft.resetSignals.length > 0
			? [
				"Reset signals:",
				...draft.resetSignals.map((entry) => `- ${entry}`),
			]
			: []),
		...(draft.skillDependencies.length > 0
			? [
				"Reusable skill dependencies:",
				...draft.skillDependencies.map((dependency) =>
					`- ${dependency.name}${dependency.reason ? `: ${dependency.reason}` : ""}`,
				),
			]
			: []),
		...(procedure.length > 0
			? [
				"Expected procedure:",
				...procedure.map((step, index) => `${index + 1}. ${step}`),
			]
			: []),
		...(trimToUndefined(draft.taskCard?.output)
			? [`Target outcome: ${trimToUndefined(draft.taskCard?.output)}.`]
			: []),
	].join("\n\n");
}

async function defaultTeachDraftValidator(params: {
	entry: SessionEntry;
	draft: TaughtTaskDraft;
	promptSession: CreateGatewaySessionRuntimeParams["promptSession"];
}): Promise<TeachDraftValidationResult> {
	const prompt = buildTeachDraftValidationPrompt(params.draft);
	const result = await params.promptSession(params.entry, prompt);
	let parsed: Record<string, unknown>;
	let parseError: string | undefined;
	try {
		parsed = extractJsonObject(result.response);
	} catch (error) {
		parsed = {};
		parseError = error instanceof Error ? error.message : String(error);
	}
	const checks = Array.isArray(parsed.checks)
		? parsed.checks
			.map((entry, index) => normalizeTeachValidationCheck(entry, index, "replay"))
			.filter((entry): entry is TeachDraftValidationResult["checks"][number] => Boolean(entry))
		: [];
	let state = normalizeTeachValidationState(parsed.state) ?? "failed";
	const trace = analyzeTeachValidationTrace(result.meta);
	const expectsMutation = draftExpectsMutatingReplay(params.draft);
	const missingReplay = trace.toolCalls === 0 || (expectsMutation && trace.mutatingToolNames.length === 0);
	const toolVerifications = Array.isArray(result.meta?.toolTrace)
		? result.meta.toolTrace
			.map((entry) => asRecord(entry))
			.map((entry) => asRecord(entry?.status))
			.filter((entry): entry is Record<string, unknown> => Boolean(entry))
		: [];
		const positiveVerification = toolVerifications.find((entry) => {
			const statusCode = trimToUndefined(asString(entry.code))?.toLowerCase();
			return statusCode === "condition_met" || statusCode === "observed" || statusCode === "completed";
		});
	if (trace.blockingFailures.length > 0) {
		state = "failed";
	}
	if (trace.blockingFailures.length === 0 && missingReplay) {
		state = "requires_reset";
	}
	if (parseError && !missingReplay && trace.blockingFailures.length === 0 && positiveVerification) {
		state = "validated";
	}
	const defaultSummary = state === "validated"
		? "Replay validation re-ran the taught task and satisfied the success criteria."
		: state === "requires_reset"
			? "Current workspace state needs reset before a faithful replay validation can run."
			: "Teach replay validation could not complete the taught task successfully.";
	const traceDerivedSummary = trimToUndefined(asString(positiveVerification?.summary));
	const summary = trimToUndefined(asString(parsed.summary))
		?? (parseError && traceDerivedSummary ? traceDerivedSummary : undefined)
		?? defaultSummary;
	const nextChecks = checks.length > 0
		? checks
		: [{
			id: "teach-validation:result",
			ok: state === "validated",
			summary,
			source: "replay" as const,
		}];
	if (trace.blockingFailures.length > 0) {
		nextChecks.push({
			id: "teach-validation:tool_failures",
			ok: false,
			summary: "Validation tools reported blocking failures.",
			details: trace.blockingFailures.join(" | "),
			source: "replay",
		});
	}
	if (trace.recoverableFailures.length > 0) {
		nextChecks.push({
			id: "teach-validation:recovered_failures",
			ok: true,
			summary: "Validation recovered from earlier tool failures and still completed the replay.",
			details: trace.recoverableFailures.join(" | "),
			source: "replay",
		});
	}
	if (trace.toolCalls === 0) {
		nextChecks.push({
			id: "teach-validation:no_replay",
			ok: false,
			summary: "Validation did not perform any replay actions or inspections.",
			source: "replay",
		});
	}
	if (expectsMutation && trace.mutatingToolNames.length === 0) {
		nextChecks.push({
			id: "teach-validation:no_mutating_replay",
			ok: false,
			summary: "Validation did not use any mutating tools, so the taught workflow was not actually replayed.",
			source: "replay",
		});
	}
	if (parseError) {
		nextChecks.push({
			id: "teach-validation:json_fallback",
			ok: false,
			summary: "Validation did not return valid JSON, so the result was normalized from the replay trace.",
			details: parseError,
			source: "replay",
		});
	}
	nextChecks.push({
		id: "teach-validation:tool_summary",
		ok: trace.toolCalls > 0,
		summary: trace.toolNames.length > 0
			? `Validation used tools: ${trace.toolNames.join(", ")}`
			: "Validation used no tools.",
		source: "replay",
	});
	return {
		state,
		summary:
			missingReplay
				? expectsMutation
					? "Teach validation did not perform a real replay of the taught task, so the draft still needs reset-aware replay validation."
					: "Teach validation did not perform any concrete replay actions, so the draft still needs replay validation."
				: summary,
		checks: nextChecks,
		runId: result.runId,
		response: result.response,
		meta: result.meta,
		mode: "replay",
		usedMutatingTools: trace.mutatingToolNames.length > 0,
		toolNames: trace.toolNames,
		mutatingToolNames: trace.mutatingToolNames,
	};
}

function sanitizeAssistantHistoryEntry(
	entry: SessionEntry["history"][number],
): SessionEntry["history"][number] {
	const nextEntry: SessionEntry["history"][number] = {
		...entry,
		...(normalizeHistoryImages(entry.images) ? { images: normalizeHistoryImages(entry.images) } : {}),
		...(normalizeHistoryAttachments(entry.attachments) ? { attachments: normalizeHistoryAttachments(entry.attachments) } : {}),
	};
	if (entry.role !== "assistant") {
		return nextEntry;
	}
	const text = stripInlineDirectiveTagsForDisplay(entry.text).text;
	return text === entry.text ? nextEntry : { ...nextEntry, text };
}

function normalizeActiveRunSnapshot(result: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
	if (!result) {
		return undefined;
	}
	const rawStatus = asString(result.status);
	if (rawStatus === "ok" || rawStatus === "error") {
		return undefined;
	}
	const progress = asRecord(result.progress);
	const steps = Array.isArray(progress?.steps)
		? progress.steps
			.map((entry) => asRecord(entry))
			.filter((entry): entry is Record<string, unknown> => Boolean(entry))
			.map((entry) => sanitizeTraceValue(entry) as Record<string, unknown>)
		: [];
	const summary = trimToUndefined(asString(progress?.summary));
	const thoughtText = trimToUndefined(asString(progress?.thoughtText));
	const assistantText = trimToUndefined(asString(progress?.assistantText));
	const runId = asString(result.runId);
	const startedAt = asNumber(result.startedAt);
	const updatedAt = asNumber(progress?.updatedAt) ?? asNumber(result.endedAt) ?? startedAt;
	const error = trimToUndefined(asString(result.error));
	if (!runId && !summary && !thoughtText && !assistantText && steps.length === 0 && !error) {
		return undefined;
	}
	return {
		...(runId ? { runId } : {}),
		status: "in_flight",
		...(startedAt !== undefined ? { startedAt } : {}),
		...(updatedAt !== undefined ? { updatedAt } : {}),
		...(summary ? { summary } : {}),
		...(thoughtText ? { thoughtText } : {}),
		...(assistantText ? { assistantText } : {}),
		...(steps.length > 0 ? { steps } : {}),
		...(error ? { error } : {}),
	};
}

function runSupportsHistoryChannels(run: SessionRunTrace | Record<string, unknown> | undefined): boolean {
	if (!run || typeof run !== "object") {
		return false;
	}
	return Boolean(trimToUndefined(asString(run.thoughtText)))
		|| (Array.isArray(run.progressSteps) && run.progressSteps.length > 0)
		|| (Array.isArray(run.toolTrace) && run.toolTrace.length > 0)
		|| (Array.isArray(run.attempts) && run.attempts.length > 0)
		|| Boolean(resolveTeachValidationTrace(run));
}

function assistantMessageMatchesRun(
	message: SessionEntry["history"][number],
	run: SessionRunTrace | undefined,
): boolean {
	if (!run || message.role !== "assistant") {
		return false;
	}
	const messageText = normalizeComparableText(stripInlineDirectiveTagsForDisplay(message.text).text);
	const preview = normalizeComparableText(asString(run.responsePreview) ?? "");
	if (!messageText || !preview) {
		return false;
	}
	if (messageText === preview || messageText.startsWith(preview)) {
		return true;
	}
	const prefixLength = Math.min(120, messageText.length, preview.length);
	return prefixLength >= 24 && messageText.slice(0, prefixLength) === preview.slice(0, prefixLength);
}

function buildHistoryTimeline(
	messages: SessionEntry["history"],
	runs: SessionRunTrace[],
): Array<Record<string, unknown>> {
	const sanitizedMessages = messages.map((message) => sanitizeAssistantHistoryEntry(message));
	const pairedRunsByMessageIndex = new Map<number, SessionRunTrace>();
	let runIndex = 0;
	for (let messageIndex = sanitizedMessages.length - 1; messageIndex >= 0 && runIndex < runs.length; messageIndex -= 1) {
		const message = sanitizedMessages[messageIndex];
		const candidate = runs[runIndex];
		if (assistantMessageMatchesRun(message, candidate)) {
			pairedRunsByMessageIndex.set(messageIndex, candidate);
			runIndex += 1;
		}
	}
	return sanitizedMessages.map((message, index) => {
		const pairedRun = pairedRunsByMessageIndex.get(index);
		if (message.role === "assistant" && pairedRun && runSupportsHistoryChannels(pairedRun)) {
			return {
				kind: "run",
				role: "assistant",
				timestamp: message.timestamp,
				runId: pairedRun.runId,
				recordedAt: pairedRun.recordedAt,
				durationMs: pairedRun.durationMs,
				assistantText: message.text,
				thoughtText: pairedRun.thoughtText,
				progressSteps: pairedRun.progressSteps,
				toolTrace: pairedRun.toolTrace,
				attempts: pairedRun.attempts,
				teachValidation: resolveTeachValidationTrace(pairedRun),
				agentMeta: pairedRun.agentMeta,
				responsePreview: pairedRun.responsePreview,
			};
		}
		return {
			kind: "message",
			role: message.role,
			text: message.text,
			timestamp: message.timestamp,
			...(message.images ? { images: message.images } : {}),
			...(message.attachments ? { attachments: message.attachments } : {}),
		};
	});
}

type RunTurnResult = {
	response: string;
	runId: string;
	sessionId: string;
	status: "ok" | "in_flight";
	images?: ImageContent[];
	meta?: Record<string, unknown>;
};

function touchSession(entry: SessionEntry, timestamp: number = Date.now()): void {
	entry.lastActiveAt = timestamp;
}

function cloneValue<T>(value: T): T {
	if (typeof structuredClone === "function") {
		return structuredClone(value);
	}
	return JSON.parse(JSON.stringify(value)) as T;
}

function forkRuntimeMessages(parentMessages: unknown[], forkHistory: SessionEntry["history"]): unknown[] {
	if (forkHistory.length === 0) {
		const preserved = parentMessages.filter((message) => {
			const role = (message as { role?: unknown } | null | undefined)?.role;
			return role === "system";
		});
		return cloneValue(preserved);
	}
	let targetIndex = 0;
	let lastMatchIndex = -1;
	for (let i = 0; i < parentMessages.length && targetIndex < forkHistory.length; i++) {
		const message = parentMessages[i] as { role?: unknown } | undefined;
		if (!message || (message.role !== "user" && message.role !== "assistant")) {
			continue;
		}
		const expected = forkHistory[targetIndex];
		if (!expected || message.role !== expected.role) {
			continue;
		}
		const text = normalizeComparableText(extractMessageText(message));
		const expectedText = normalizeComparableText(expected.text);
		if (!expectedText) {
			targetIndex += 1;
			lastMatchIndex = i;
			continue;
		}
		if (text === expectedText) {
			targetIndex += 1;
			lastMatchIndex = i;
		}
	}
	if (targetIndex === 0) {
		return cloneValue(parentMessages);
	}
	return cloneValue(parentMessages.slice(0, lastMatchIndex + 1));
}

function copyRuntimeMessagesForBranch(
	parent: SessionEntry,
	child: SessionEntry,
	forkHistory: SessionEntry["history"],
): void {
	const parentState = (parent.session as { agent?: { state?: { messages?: unknown[] } } } | undefined)?.agent?.state;
	const childState = (child.session as { agent?: { state?: { messages?: unknown[] } } } | undefined)?.agent?.state;
	if (!Array.isArray(parentState?.messages) || !Array.isArray(childState?.messages)) {
		return;
	}
	childState.messages = forkRuntimeMessages(parentState.messages, forkHistory);
}

function buildRuntimeMessagesFromHistory(
	existingMessages: unknown[],
	history: SessionEntry["history"],
): unknown[] {
	const preserved = existingMessages.filter((message) => {
		const role = (message as { role?: unknown } | null | undefined)?.role;
		return role === "system";
	});
	const seededAssistant = [...existingMessages]
		.reverse()
		.find((message) => (message as { role?: unknown } | null | undefined)?.role === "assistant") as
			| { api?: unknown; provider?: unknown; model?: unknown }
			| undefined;
	return [
		...cloneValue(preserved),
		...history.map((entry) => entry.role === "assistant"
			? {
				role: "assistant",
				content: buildRuntimeHistoryContent(entry),
				api: asString(seededAssistant?.api) ?? "openai-codex-responses",
				provider: asString(seededAssistant?.provider) ?? "understudy-gateway",
				model: asString(seededAssistant?.model) ?? "gateway-history",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						total: 0,
					},
				},
				stopReason: "stop",
				timestamp: entry.timestamp,
			}
			: {
				role: "user",
				content: buildRuntimeHistoryContent(entry),
				timestamp: entry.timestamp,
			}),
	];
}

export function seedRuntimeMessagesFromHistory(
	entry: SessionEntry,
	history: SessionEntry["history"],
): void {
	const state = (entry.session as { agent?: { state?: { messages?: unknown[] } } } | undefined)?.agent?.state;
	if (!Array.isArray(state?.messages)) {
		return;
	}
	state.messages = buildRuntimeMessagesFromHistory(state.messages, history);
}

function resolveWaitForCompletion(value: unknown): boolean {
	const explicit = asBoolean(value);
	return explicit !== undefined ? explicit : true;
}

export function createGatewaySessionRuntime(
	params: CreateGatewaySessionRuntimeParams,
): { chatHandler: ChatHandler; sessionHandlers: SessionHandlers } {
	const {
		sessionEntries,
		inFlightSessionIds,
		config,
		usageTracker,
		estimateTokens,
		appendHistory,
		getOrCreateSession,
		createScopedSession,
		promptSession,
		abortSessionEntry,
		resolveAgentTarget,
		waitForRun,
		listPersistedSessions,
		readPersistedSession,
		readTranscriptHistory,
		readPersistedTrace,
		persistSessionRunTrace,
		deletePersistedSession,
		onStateChanged,
		videoTeachAnalyzer,
		demonstrationRecorder = createMacosDemonstrationRecorder(),
		validateTeachDraft = defaultTeachDraftValidator,
		notifyUser,
		workflowCrystallization: workflowCrystallizationOptions = {},
	} = params;
	const runtimeLearningDir = join(resolveUnderstudyHomeDir(), "learning");

	const parseResetCommand = (message: string): { command: "new" | "reset"; trailing?: string } | null => {
		const match = message.match(RESET_COMMAND_RE);
		if (!match) return null;
		const command = match[1]?.toLowerCase() === "new" ? "new" : "reset";
		const trailing = match[2]?.trim();
		return trailing ? { command, trailing } : { command };
	};

	const parseTeachCommand = (message: string): TeachSlashCommand | null => {
		const match = message.match(TEACH_COMMAND_RE);
		if (!match) {
			return null;
		}
		const action = match[1]?.trim().toLowerCase();
		if (!action) {
			const trailing = match[2]?.trim();
			return trailing ? { action: "help", trailing } : { action: "help" };
		}
		if (action !== "start" && action !== "stop" && action !== "confirm" && action !== "validate" && action !== "publish") {
			return null;
		}
		const trailing = match[2]?.trim();
		return trailing ? { action, trailing } : { action };
	};

	const resolveResetPrompt = (reset: { command: "new" | "reset"; trailing?: string }, timezone?: string): string =>
		reset.trailing ?? buildSessionResetPrompt(timezone);

	const resolveTeachCapabilitySnapshot = (workspaceDir?: string): TeachCapabilitySnapshot | undefined => {
		if (!workspaceDir) {
			return undefined;
		}
		try {
			return buildTeachCapabilitySnapshot({
				workspaceDir,
				config,
			});
		} catch {
			return undefined;
		}
	};

	const recreateSessionEntry = async (entry: SessionEntry): Promise<SessionEntry> => {
		await deletePersistedSession?.({ sessionId: entry.id });
		const recreated = await createScopedSession({
			sessionKey: entry.id,
			parentId: entry.parentId,
			forkPoint: entry.forkPoint,
			channelId: entry.channelId,
			senderId: entry.senderId,
			senderName: entry.senderName,
			conversationName: entry.conversationName,
			conversationType: entry.conversationType,
			threadId: entry.threadId,
			workspaceDir: entry.workspaceDir,
			configOverride: entry.configOverride,
			sandboxInfo: entry.sandboxInfo,
			executionScopeKey: entry.executionScopeKey,
		});
		sessionEntries.set(entry.id, recreated);
		onStateChanged?.();
		return recreated;
	};

	const taskDraftHandlers = createGatewayTaskDraftHandlers({
		sessionEntries,
		videoTeachAnalyzer,
		config,
	});
	const applyPromptSectionToWorkspaceSessions = (params: {
		workspaceDir: string;
		header: string;
		sectionLines: string[];
		insertBeforeHeaders?: string[];
	}): number => {
		const normalizedWorkspaceDir = resolve(params.workspaceDir);
		let refreshed = 0;
		for (const candidate of sessionEntries.values()) {
			if (!candidate.workspaceDir || resolve(candidate.workspaceDir) !== normalizedWorkspaceDir) {
				continue;
			}
			const agent = (candidate.session as { agent?: { setSystemPrompt?: (prompt: string) => void } })?.agent;
			if (!agent || typeof agent.setSystemPrompt !== "function") {
				continue;
			}
			const currentPrompt = extractSessionSystemPrompt(candidate.session);
			if (!currentPrompt) {
				continue;
			}
			const nextPrompt = replaceSystemPromptSection({
				prompt: currentPrompt,
				header: params.header,
				sectionLines: params.sectionLines,
				insertBeforeHeaders: params.insertBeforeHeaders,
			});
			if (!nextPrompt || nextPrompt === currentPrompt) {
				continue;
			}
			agent.setSystemPrompt(nextPrompt);
			updateSessionSystemPromptState(candidate.session, nextPrompt);
			refreshed += 1;
		}
		return refreshed;
	};
	const applySkillsSectionToWorkspaceSessions = (
		workspaceDir: string,
		skillsSection: string[],
	): number =>
		applyPromptSectionToWorkspaceSessions({
			workspaceDir,
			header: "## Skills (mandatory)",
			sectionLines: skillsSection,
			insertBeforeHeaders: [
				"## Memory Recall",
				"## Authorized Senders",
				"## Current Date & Time",
				"## Workspace",
			],
		});
	const buildTeachDraftRefreshSection = async (workspaceDir: string): Promise<string[]> => {
		const ledger = await loadPersistedTaughtTaskDraftLedger({
			workspaceDir,
		}).catch(() => undefined);
		const content = buildTaughtTaskDraftPromptContent(ledger);
		return content ? ["## Teach Drafts", content, ""] : [];
	};
	const buildPublishedSkillRefreshSection = (published: {
		skill: { name?: string; skillPath?: string };
		draft?: { objective?: string };
	}): string[] => {
		const skillName = trimToUndefined(published.skill.name) ?? "new-workspace-skill";
		const skillPath = trimToUndefined(published.skill.skillPath) ?? "SKILL.md";
		const description =
			trimToUndefined(published.draft?.objective) ??
			"Newly published workspace skill. Read SKILL.md before using it.";
		return [
			"## Skills (mandatory)",
			"Before replying: scan <available_skills> <description> entries.",
			"- If exactly one skill clearly applies: read its SKILL.md at <location> with `read`, then follow it.",
			"- If multiple could apply: choose the most specific one, then read/follow it.",
			"- If none clearly apply: do not read any SKILL.md.",
			"Constraints: never read more than one skill up front; only read after selecting.",
			"- When a skill drives external API writes, assume rate limits: prefer fewer larger writes, avoid tight one-item loops, serialize bursts when possible, and respect 429/Retry-After.",
			[
				"<available_skills>",
				`  <skill name="${skillName}">`,
				`    <description>${description}</description>`,
				`    <location>${skillPath}</location>`,
				"  </skill>",
				"</available_skills>",
			].join("\n"),
			"",
		];
	};
	const refreshWorkspaceSkillPrompts = async (workspaceDir: string): Promise<number> => {
		const normalizedWorkspaceDir = resolve(workspaceDir);
		const skillSnapshot = buildWorkspaceSkillSnapshot({
			workspaceDir: normalizedWorkspaceDir,
			config,
		});
		const skillsSection = buildSkillsSection(skillSnapshot.resolvedSkills);
		return applySkillsSectionToWorkspaceSessions(normalizedWorkspaceDir, skillsSection);
	};
	const refreshWorkspaceTeachDraftPrompts = async (workspaceDir: string): Promise<number> =>
		applyPromptSectionToWorkspaceSessions({
			workspaceDir,
			header: "## Teach Drafts",
			sectionLines: await buildTeachDraftRefreshSection(workspaceDir),
			insertBeforeHeaders: [
				"## Memory Recall",
				"## Authorized Senders",
				"## Current Date & Time",
				"## Workspace",
			],
		});
	const refreshTeachDraftPrompts = async (entry: SessionEntry): Promise<void> => {
		if (!entry.workspaceDir) {
			return;
		}
		await refreshWorkspaceTeachDraftPrompts(entry.workspaceDir).catch(() => {});
	};
	const refreshPublishedSkillPrompts = async (
		entry: SessionEntry,
		published: {
			draft: { objective?: string };
			skill: { name?: string; skillPath?: string };
		},
	): Promise<string | undefined> => {
		if (!entry.workspaceDir) {
			return "Workspace-bound teach skill refresh is unavailable for this session.";
		}
		try {
			const refreshed = await refreshWorkspaceSkillPrompts(entry.workspaceDir);
			if (refreshed > 0) {
				return undefined;
			}
		} catch (error) {
			const fallbackRefreshed = applySkillsSectionToWorkspaceSessions(
				entry.workspaceDir,
				buildPublishedSkillRefreshSection(published),
			);
			if (fallbackRefreshed > 0) {
				return `Used a minimal prompt refresh for the new skill because the full workspace skill snapshot could not be rebuilt automatically: ${
					error instanceof Error ? error.message : String(error)
				}`;
			}
			return error instanceof Error ? error.message : String(error);
		}
		const fallbackRefreshed = applySkillsSectionToWorkspaceSessions(
			entry.workspaceDir,
			buildPublishedSkillRefreshSection(published),
		);
		if (fallbackRefreshed > 0) {
			return undefined;
		}
		return "No active workspace session prompt was available to hot-refresh.";
	};
	const activeTeachRecordings = new Map<string, GuiDemonstrationRecordingSession>();
	const activeTeachClarificationSessions = new Set<string>();
	const activeWorkflowCrystallizationAnalyses = new Map<string, Promise<void>>();
	const pendingWorkflowCrystallizationAnalyses = new Set<string>();
	const sessionTurnChains = new Map<string, Promise<unknown>>();
	const workflowLedgerMutationChains = new Map<string, Promise<unknown>>();

	const runSerializedSessionTurn = <T>(entry: SessionEntry, task: () => Promise<T>): Promise<T> => {
		const previous = sessionTurnChains.get(entry.id) ?? Promise.resolve();
		const queued = previous.catch(() => {}).then(task);
		let trackedPromise: Promise<unknown>;
		const cleanupPromise = queued.finally(() => {
			if (sessionTurnChains.get(entry.id) === trackedPromise) {
				sessionTurnChains.delete(entry.id);
			}
		});
		// The cleanup chain is internal bookkeeping only. Consume its rejection so
		// background run failures do not escape as unhandled rejections while still
		// leaving the original queued promise rejection visible to real callers.
		trackedPromise = cleanupPromise.catch(() => {});
		sessionTurnChains.set(entry.id, trackedPromise);
		return queued;
	};

	const runSerializedWorkflowLedgerMutation = <T>(workspaceDir: string, task: () => Promise<T>): Promise<T> => {
		const workspaceKey = resolve(workspaceDir);
		const previous = workflowLedgerMutationChains.get(workspaceKey) ?? Promise.resolve();
		const queued = previous.catch(() => {}).then(task);
		let trackedPromise: Promise<unknown>;
		const cleanupPromise = queued.finally(() => {
			if (workflowLedgerMutationChains.get(workspaceKey) === trackedPromise) {
				workflowLedgerMutationChains.delete(workspaceKey);
			}
		});
		trackedPromise = cleanupPromise.catch(() => {});
		workflowLedgerMutationChains.set(workspaceKey, trackedPromise);
		return queued;
	};

	const WORKFLOW_CRYSTALLIZATION_TIMEOUT_MS = 90_000;
	const MIN_TURNS_FOR_WORKFLOW_SEGMENTATION = Math.max(1, Math.floor(workflowCrystallizationOptions.minTurnsForSegmentation ?? 2));
	const WORKFLOW_SEGMENTATION_REANALYZE_DELTA = Math.max(1, Math.floor(workflowCrystallizationOptions.segmentationReanalyzeDelta ?? 3));
	const MIN_EPISODES_FOR_WORKFLOW_CLUSTERING = Math.max(1, Math.floor(workflowCrystallizationOptions.minEpisodesForClustering ?? 2));
	const MIN_CLUSTER_OCCURRENCES_FOR_PROMOTION = Math.max(1, Math.floor(workflowCrystallizationOptions.minClusterOccurrencesForPromotion ?? 3));
	const MAX_CLUSTERING_EPISODES = Math.max(1, Math.floor(workflowCrystallizationOptions.maxClusteringEpisodes ?? 80));
	const MAX_PROMOTED_WORKFLOW_CANDIDATES = Math.max(1, Math.floor(workflowCrystallizationOptions.maxPromotedWorkflowCandidates ?? 5));
	const MAX_SYNTHESIS_EPISODE_EXAMPLES = Math.max(1, Math.floor(workflowCrystallizationOptions.maxSynthesisEpisodeExamples ?? 6));

	const createWorkflowCrystallizationInternalSession = async (
		entry: SessionEntry,
		purpose: "segment" | "summarize" | "cluster" | "synthesize",
	): Promise<SessionEntry | undefined> => {
		try {
			return await createScopedSession({
				sessionKey: `${entry.id}::workflow-${purpose}::${randomUUID()}`,
				parentId: entry.id,
				channelId: entry.channelId,
				senderId: entry.senderId,
				senderName: entry.senderName,
				conversationName: entry.conversationName,
				conversationType: entry.conversationType,
				threadId: entry.threadId,
				workspaceDir: entry.workspaceDir,
				explicitWorkspace: true,
				configOverride: entry.configOverride,
				sandboxInfo: entry.sandboxInfo,
				executionScopeKey: entry.executionScopeKey,
				allowedToolNames: [],
				extraSystemPrompt: "This is an internal workflow crystallization analysis session. Never call tools. Return only the requested JSON payload.",
			});
		} catch {
			return undefined;
		}
	};

	const runWorkflowCrystallizationPrompt = async (params: {
		entry: SessionEntry;
		purpose: "segment" | "summarize" | "cluster" | "synthesize";
		prompt: string;
		timeoutMs?: number;
	}): Promise<string> => {
		const internalEntry = await createWorkflowCrystallizationInternalSession(params.entry, params.purpose);
		if (!internalEntry) {
			throw new Error("Could not create an isolated workflow crystallization session.");
		}
		try {
			const result = await withTimeout(
				runSerializedSessionTurn(
					internalEntry,
					async () => await promptSession(internalEntry, params.prompt),
				),
				params.timeoutMs ?? WORKFLOW_CRYSTALLIZATION_TIMEOUT_MS,
			);
			return normalizeAssistantDisplayText(result.response ?? "").text;
		} finally {
			if (internalEntry !== params.entry) {
				await abortSessionEntry(internalEntry).catch(() => false);
			}
		}
	};

	const buildWorkflowDialogueTurnPreview = (turn: WorkflowCrystallizationTurn, index: number): string => [
		`${index}. [${new Date(turn.timestamp).toISOString()}] session=${turn.sessionId ?? "unknown"} run=${turn.runId}`,
		`   user: ${turn.userText || "--"}`,
		`   assistant: ${turn.assistantText || "--"}`,
	].join("\n");

	const buildWorkflowExecutionTurnPreview = (turn: WorkflowCrystallizationTurn): string => [
		`   user: ${turn.userText || "--"}`,
		`   assistant: ${turn.assistantText || "--"}`,
		...(turn.evidence.parameterHints.length > 0 ? [`   parameters: ${turn.evidence.parameterHints.join(", ")}`] : []),
		...(turn.evidence.successSignals.length > 0 ? [`   outcome_signals: ${turn.evidence.successSignals.join(" | ")}`] : []),
		...(turn.evidence.uncertainties.length > 0 ? [`   open_issues: ${turn.evidence.uncertainties.join(" | ")}`] : []),
		...(turn.evidence.routeSignature ? [`   route_signature: ${turn.evidence.routeSignature}`] : []),
		...(turn.evidence.toolChain.length > 0
			? [
				"   tool_chain:",
				...turn.evidence.toolChain.slice(0, 6).map((step: WorkflowCrystallizationToolStep) =>
					`     - [${step.route}/${step.toolName}] ${step.instruction}${step.verificationSummary ? ` | verify: ${step.verificationSummary}` : ""}`),
			]
			: []),
	].join("\n");

	const normalizeWorkflowEpisodeCompletion = (value: unknown): WorkflowCrystallizationCompletion => {
		switch (trimToUndefined(asString(value))?.toLowerCase()) {
			case "failed":
				return "failed";
			case "partial":
				return "partial";
			default:
				return "complete";
		}
	};

	const buildEmptyWorkflowStatusCounts = (): WorkflowCrystallizationStatusCounts => ({
		completeCount: 0,
		partialCount: 0,
		failedCount: 0,
	});

	const countWorkflowEpisodeStatuses = (
		episodes: Array<Pick<WorkflowCrystallizationEpisode, "completion">>,
	): WorkflowCrystallizationStatusCounts => {
		const counts = buildEmptyWorkflowStatusCounts();
		for (const episode of episodes) {
			switch (episode.completion) {
				case "failed":
					counts.failedCount += 1;
					break;
				case "partial":
					counts.partialCount += 1;
					break;
				default:
					counts.completeCount += 1;
					break;
			}
		}
		return counts;
	};

	const buildWorkflowSegmentId = (workspaceDir: string, dayStamp: string, startTurnIndex: number, endTurnIndex: number): string =>
		createHash("sha1")
			.update(resolve(workspaceDir))
			.update(dayStamp)
			.update(String(startTurnIndex))
			.update(String(endTurnIndex))
			.digest("hex")
			.slice(0, 12);

	const buildWorkflowSegmentationPrompt = (params: {
		workspaceDir: string;
		dayStamp: string;
		turns: WorkflowCrystallizationTurn[];
	}): string => [
		"You are segmenting compressed Understudy workspace session dialogue into complete work segments.",
		"Use only the ordered user/assistant dialogue timeline below.",
		"Do not rely on tool chains, hidden state, or chain-of-thought.",
		"A complete work segment may span multiple consecutive turns and should represent one real-world job from request through meaningful completion.",
		"Ignore pure chit-chat, tiny acknowledgements, or fragments that do not belong to a larger work segment.",
		"Prefer fewer, larger segments when adjacent turns obviously belong to the same job.",
		"Mark completion=complete only when the segment appears to reach an externally meaningful outcome.",
		"Use completion=partial when the work clearly started but did not finish.",
		"Use completion=failed when the segment appears to conclude unsuccessfully or hits a clear dead end.",
		`Workspace: ${params.workspaceDir}`,
		`Day: ${params.dayStamp}`,
		"Dialogue timeline:",
		...params.turns.map((turn, index) => buildWorkflowDialogueTurnPreview(turn, index + 1)),
		"Return strict JSON only.",
		'Schema: {"segments":[{"startTurnIndex":1,"endTurnIndex":3,"completion":"complete|partial|failed"}]}',
	].join("\n");

	const normalizeWorkflowSegments = (params: {
		payload: Record<string, unknown>;
		dayStamp: string;
		turns: WorkflowCrystallizationTurn[];
		workspaceDir: string;
	}): WorkflowCrystallizationSegment[] => {
		const raw = Array.isArray(params.payload.segments) ? params.payload.segments : [];
		const segments: WorkflowCrystallizationSegment[] = [];
		for (const entry of raw) {
			const record = asRecord(entry);
			if (!record) {
				continue;
			}
			const startTurnIndex = Math.max(1, Math.floor(asNumber(record.startTurnIndex) ?? 0));
			const endTurnIndex = Math.min(params.turns.length, Math.floor(asNumber(record.endTurnIndex) ?? 0));
			if (endTurnIndex < startTurnIndex || startTurnIndex > params.turns.length) {
				continue;
			}
			const slice = params.turns.slice(startTurnIndex - 1, endTurnIndex);
			if (slice.length === 0) {
				continue;
			}
			segments.push({
				id: buildWorkflowSegmentId(params.workspaceDir, params.dayStamp, startTurnIndex, endTurnIndex),
				dayStamp: params.dayStamp,
				startTurnIndex,
				endTurnIndex,
				turnIds: slice.map((turn) => turn.id),
				startedAt: slice[0]?.timestamp ?? Date.now(),
				endedAt: slice[slice.length - 1]?.timestamp ?? Date.now(),
				completion: normalizeWorkflowEpisodeCompletion(record.completion),
			});
		}
		return segments
			.sort((left, right) => left.startTurnIndex - right.startTurnIndex || left.endTurnIndex - right.endTurnIndex)
			.filter((segment, index, list) => index === 0 || segment.startTurnIndex > list[index - 1]!.endTurnIndex);
	};

	const buildWorkflowEpisodeSummaryPrompt = (params: {
		workspaceDir: string;
		dayStamp: string;
		turns: WorkflowCrystallizationTurn[];
		segments: WorkflowCrystallizationSegment[];
	}): string => [
		"You are summarizing segmented Understudy workspace dialogue into reusable work episodes.",
		"The segment boundaries are already decided. For each segment, infer the real job, summarize the outcome, and extract stable reusable signals.",
		"Use the dialogue and compact execution evidence below. Ignore chain-of-thought and verbose intermediate outputs.",
		"Focus first on the underlying user need or work goal, even if the run completed only partially or failed.",
		"Provide workflowFamilyHint as a short stable label for the recurring user demand this segment belongs to.",
		"Parameter hints should name variable inputs that recur across runs.",
		"Success criteria should describe externally meaningful completion signals.",
		"Uncertainties should capture remaining ambiguity or weak evidence.",
		"Triggers should be short request cues that indicate when the future task matches this episode type.",
		`Workspace: ${params.workspaceDir}`,
		`Day: ${params.dayStamp}`,
		"Segments:",
		...params.segments.map((segment, index) => {
			const slice = params.turns.slice(segment.startTurnIndex - 1, segment.endTurnIndex);
			return [
				`${index + 1}. segment_id=${segment.id} turns=${segment.startTurnIndex}-${segment.endTurnIndex} completion=${segment.completion}`,
				...slice.map((turn) => buildWorkflowExecutionTurnPreview(turn)),
			].join("\n");
		}),
		"Return strict JSON only.",
		'Schema: {"episodes":[{"segmentId":"...","title":"...","objective":"...","summary":"...","workflowFamilyHint":"...","parameterHints":["..."],"successCriteria":["..."],"uncertainties":["..."],"keyTools":["browser","shell"],"routeSignature":"browser -> shell","triggers":["..."],"completion":"complete|partial|failed"}]}',
	].join("\n");

	const normalizeWorkflowEpisodes = (params: {
		payload: Record<string, unknown>;
		segments: WorkflowCrystallizationSegment[];
		turns: WorkflowCrystallizationTurn[];
		workspaceDir: string;
	}): WorkflowCrystallizationEpisode[] => {
		const segmentById = new Map(params.segments.map((segment) => [segment.id, segment] as const));
		const raw = Array.isArray(params.payload.episodes) ? params.payload.episodes : [];
		const episodes: WorkflowCrystallizationEpisode[] = [];
		for (const entry of raw) {
			const record = asRecord(entry);
			if (!record) {
				continue;
			}
			const segmentId = trimToUndefined(asString(record.segmentId));
			const segment = segmentId ? segmentById.get(segmentId) : undefined;
			if (!segment) {
				continue;
			}
			const slice = params.turns.slice(segment.startTurnIndex - 1, segment.endTurnIndex);
			if (slice.length === 0) {
				continue;
			}
			const title = trimToUndefined(asString(record.title))
				?? trimToUndefined(asString(record.objective))
				?? slice[0]?.evidence.titleGuess
				?? `Workflow episode ${episodes.length + 1}`;
			const objective = trimToUndefined(asString(record.objective)) ?? title;
			const summary = trimToUndefined(asString(record.summary))
				?? `Compressed workflow episode from turn ${segment.startTurnIndex} to ${segment.endTurnIndex}.`;
			const workflowFamilyHint = trimToUndefined(asString(record.workflowFamilyHint))
				?? trimToUndefined(asString(record.objective))
				?? slice[0]?.evidence.objectiveGuess
				?? title;
			const parameterHints = uniqueStrings([
				...asStringList(record.parameterHints),
				...slice.flatMap((turn) => turn.evidence.parameterHints),
			]).slice(0, 12);
			const successSignals = uniqueStrings([
				...asStringList(record.successCriteria),
				...slice.flatMap((turn) => turn.evidence.successSignals),
			]).slice(0, 12);
			const uncertainties = uniqueStrings([
				...asStringList(record.uncertainties),
				...slice.flatMap((turn) => turn.evidence.uncertainties),
			]).slice(0, 12);
			const keyTools = uniqueStrings([
				...asStringList(record.keyTools),
				...slice.flatMap((turn) => turn.evidence.toolChain.map((step) => step.toolName)),
			]).slice(0, 12);
			const routeSignature = trimToUndefined(asString(record.routeSignature))
				?? uniqueStrings(slice.map((turn) => turn.evidence.routeSignature ?? "")).join(" || ");
			const triggers = uniqueStrings([
				...asStringList(record.triggers),
				...slice.map((turn) => turn.userText).filter(Boolean),
			]).slice(0, 6);
			const id = createHash("sha1")
				.update(segment.id)
				.update(normalizeComparableText(title))
				.update(normalizeComparableText(objective))
				.digest("hex")
				.slice(0, 12);
			episodes.push({
				id,
				segmentId: segment.id,
				dayStamp: segment.dayStamp,
				startTurnIndex: segment.startTurnIndex,
				endTurnIndex: segment.endTurnIndex,
				turnIds: segment.turnIds,
				startedAt: segment.startedAt,
				endedAt: segment.endedAt,
				title,
				objective,
				summary,
				...(workflowFamilyHint ? { workflowFamilyHint } : {}),
				parameterHints,
				successSignals,
				uncertainties,
				keyTools,
				routeSignature,
				triggers,
				completion: normalizeWorkflowEpisodeCompletion(record.completion ?? segment.completion),
			});
		}
		return episodes.sort((left, right) => left.startTurnIndex - right.startTurnIndex || left.endTurnIndex - right.endTurnIndex);
	};

	const buildWorkflowClusterId = (
		title: string,
		objective: string,
		parameterSchema: string[],
		workflowFamilyHint?: string,
	): string =>
		createHash("sha1")
			.update(normalizeComparableText(title))
			.update(normalizeComparableText(objective))
			.update(normalizeComparableText(workflowFamilyHint ?? ""))
			.update(parameterSchema.map((value) => normalizeComparableText(value)).sort().join("|"))
			.digest("hex")
			.slice(0, 12);

	const buildWorkflowClusterPrompt = (params: {
		episodes: WorkflowCrystallizationEpisode[];
	}): string => [
		"You are clustering recurring workflow families inferred from compressed Understudy session history.",
		"Group episodes when they represent the same underlying user need or work objective despite different wording, parameters, or run status.",
		"Use user request cues and intended work goal first, then outcome, then stable execution evidence.",
		"Do not split the same workflow family only because one run was complete while another was partial or failed.",
		"Do not cluster generic chit-chat, one-off debugging, or unrelated work together.",
		"Only return clusters that contain at least 2 episode ids.",
		"Episode catalog:",
		...params.episodes.map((episode) => [
			`- ${episode.id}`,
			`  title=${episode.title}`,
			`  objective=${episode.objective}`,
			`  workflow_family_hint=${episode.workflowFamilyHint || "--"}`,
			`  summary=${episode.summary}`,
			`  triggers=${episode.triggers.join(" | ") || "--"}`,
			`  parameters=${episode.parameterHints.join(", ") || "--"}`,
			`  success=${episode.successSignals.join(" | ") || "--"}`,
			`  key_tools=${episode.keyTools.join(", ") || "--"}`,
			`  route_signature=${episode.routeSignature || "--"}`,
			`  completion=${episode.completion}`,
		].join("\n")),
		"Return strict JSON only.",
		'Schema: {"clusters":[{"episodeIds":["ep1","ep2"],"title":"...","objective":"...","summary":"...","workflowFamilyHint":"...","parameterSchema":["..."]}]}',
	].join("\n");

	const normalizeWorkflowClusters = (params: {
		payload: Record<string, unknown>;
		episodes: WorkflowCrystallizationEpisode[];
	}): WorkflowCrystallizationCluster[] => {
		const episodeById = new Map(params.episodes.map((episode) => [episode.id, episode] as const));
		const raw = Array.isArray(params.payload.clusters) ? params.payload.clusters : [];
		const clusters: WorkflowCrystallizationCluster[] = [];
		for (const entry of raw) {
			const record = asRecord(entry);
			if (!record) {
				continue;
			}
			const episodeIds = uniqueStrings(asStringList(record.episodeIds)).filter((id) => episodeById.has(id));
			if (episodeIds.length < 2) {
				continue;
			}
			const members = episodeIds
				.map((id) => episodeById.get(id))
				.filter((episode): episode is WorkflowCrystallizationEpisode => Boolean(episode));
			if (members.length < 2) {
				continue;
			}
			const title = trimToUndefined(asString(record.title))
				?? members[0]?.title
				?? `Workflow cluster ${clusters.length + 1}`;
			const objective = trimToUndefined(asString(record.objective))
				?? members[0]?.objective
				?? title;
			const summary = trimToUndefined(asString(record.summary));
			const workflowFamilyHint = trimToUndefined(asString(record.workflowFamilyHint))
				?? members[0]?.workflowFamilyHint
				?? objective;
			const parameterSchema = uniqueStrings([
				...asStringList(record.parameterSchema),
				...members.flatMap((episode) => episode.parameterHints),
			]).slice(0, 12);
			const statusCounts = countWorkflowEpisodeStatuses(members);
			clusters.push({
				id: buildWorkflowClusterId(title, objective, parameterSchema, workflowFamilyHint),
				title,
				objective,
				...(summary ? { summary } : {}),
				...(workflowFamilyHint ? { workflowFamilyHint } : {}),
				parameterSchema,
				episodeIds,
				occurrenceCount: members.length,
				completeCount: statusCounts.completeCount,
				partialCount: statusCounts.partialCount,
				failedCount: statusCounts.failedCount,
				firstSeenAt: Math.min(...members.map((episode) => episode.startedAt)),
				lastSeenAt: Math.max(...members.map((episode) => episode.endedAt)),
			});
		}
		return clusters.sort((left, right) =>
			right.occurrenceCount - left.occurrenceCount ||
			right.lastSeenAt - left.lastSeenAt);
	};

	const buildWorkflowSkillSynthesisPrompt = (params: {
		cluster: WorkflowCrystallizationCluster;
		episodes: WorkflowCrystallizationEpisode[];
		turnsById: Map<string, WorkflowCrystallizationTurn>;
	}): string => [
		"You are synthesizing a reusable Understudy workspace skill from repeated workflow-family episodes.",
		"Return a teach-like reusable skill spec, not a narrative recap.",
		"Describe functional stages, not low-level GUI clicks or pixel-based replay instructions.",
		"Each stage should explain the goal it accomplishes and list concrete instructions that preserve the same outcome.",
		"Separate stable invariants from variable parameters.",
		"Prefer higher-level routes when they preserve the same outcome: skill > browser > shell > gui.",
		"If the examples only prove a GUI path, keep higher-level routes as fallback or omit them.",
		"Prioritize complete runs when inferring the staged path and success criteria.",
		"Use partial and failed runs only to strengthen failurePolicy, guardrails, or missing-precondition notes.",
		`Cluster title: ${params.cluster.title}`,
		`Cluster objective: ${params.cluster.objective}`,
		`Observed occurrence count: ${params.cluster.occurrenceCount}`,
		`Observed status counts: complete=${params.cluster.completeCount} partial=${params.cluster.partialCount} failed=${params.cluster.failedCount}`,
		"Episode examples:",
		...params.episodes.slice(0, MAX_SYNTHESIS_EPISODE_EXAMPLES).map((episode, index) => {
			const sourceTurns = episode.turnIds
				.map((id) => params.turnsById.get(id))
				.filter((turn): turn is WorkflowCrystallizationTurn => Boolean(turn));
			return [
				`${index + 1}. ${episode.title}`,
				`   objective: ${episode.objective}`,
				`   workflow_family_hint: ${episode.workflowFamilyHint || "--"}`,
				`   completion: ${episode.completion}`,
				`   summary: ${episode.summary}`,
				`   parameters: ${episode.parameterHints.join(", ") || "--"}`,
				`   success: ${episode.successSignals.join(" | ") || "--"}`,
				`   route_signature: ${episode.routeSignature || "--"}`,
				...sourceTurns.map((turn) => buildWorkflowExecutionTurnPreview(turn)),
			].join("\n");
		}),
		"Return strict JSON only.",
		'Schema: {"title":"...","objective":"...","summary":"...","triggers":["..."],"parameterSlots":[{"name":"...","label":"...","sampleValue":"...","required":true,"notes":"..."}],"stages":[{"title":"...","goal":"...","instructions":["..."]}],"routeOptions":[{"route":"skill|browser|shell|gui","preference":"preferred|fallback|observed","instruction":"...","toolName":"optional-tool"}],"successCriteria":["..."],"failurePolicy":["..."]}',
	].join("\n");

	const normalizeWorkflowCandidateParameterSlots = (value: unknown): TaughtTaskDraftParameter[] => {
		const raw = Array.isArray(value) ? value : [];
		const slots: TaughtTaskDraftParameter[] = [];
		for (const entry of raw) {
			if (typeof entry === "string") {
				const name = trimToUndefined(entry)?.toLowerCase().replace(/[^a-z0-9]+/g, "_");
				if (!name) {
					continue;
				}
				slots.push({
					name,
					label: name.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
					required: true,
				});
				continue;
			}
			const record = asRecord(entry);
			if (!record) {
				continue;
			}
			const name = trimToUndefined(asString(record.name))?.toLowerCase().replace(/[^a-z0-9]+/g, "_");
			if (!name) {
				continue;
			}
			slots.push({
				name,
				label: trimToUndefined(asString(record.label))
					?? name.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
				sampleValue: trimToUndefined(asString(record.sampleValue)),
				required: record.required !== false,
				notes: trimToUndefined(asString(record.notes)),
			});
		}
		return slots.slice(0, 12);
	};

	const normalizeWorkflowCandidateRouteOptions = (value: unknown): WorkflowCrystallizationRouteOption[] => {
		const raw = Array.isArray(value) ? value : [];
		const options: WorkflowCrystallizationRouteOption[] = [];
		for (const entry of raw) {
			const record = asRecord(entry);
			if (!record) {
				continue;
			}
			const route = normalizeTeachExecutionRoute(record.route);
			const instruction = trimToUndefined(asString(record.instruction));
			if (!route || !instruction) {
				continue;
			}
			const preference = (() => {
				switch (trimToUndefined(asString(record.preference))?.toLowerCase()) {
					case "fallback":
						return "fallback" as const;
					case "observed":
						return "observed" as const;
					default:
						return "preferred" as const;
				}
			})();
			options.push({
				route,
				preference,
				instruction,
				...(trimToUndefined(asString(record.toolName)) ? { toolName: trimToUndefined(asString(record.toolName)) } : {}),
			});
		}
		return options.slice(0, 16);
	};

	const normalizeWorkflowSkillStages = (value: unknown): WorkflowCrystallizationSkillStage[] => {
		const raw = Array.isArray(value) ? value : [];
		const stages: WorkflowCrystallizationSkillStage[] = [];
		for (const entry of raw) {
			const record = asRecord(entry);
			if (!record) {
				continue;
			}
			const title = trimToUndefined(asString(record.title))
				?? `Stage ${stages.length + 1}`;
			const goal = trimToUndefined(asString(record.goal))
				?? trimToUndefined(asString(record.summary))
				?? title;
			const instructions = uniqueStrings([
				...asStringList(record.instructions),
				...asStringList(record.steps),
				...(trimToUndefined(asString(record.instruction)) ? [trimToUndefined(asString(record.instruction))!] : []),
			]).slice(0, 6);
			if (instructions.length === 0) {
				continue;
			}
			stages.push({
				title,
				goal,
				instructions,
			});
		}
		return stages.slice(0, 8);
	};

	const normalizeWorkflowSkill = (params: {
		payload: Record<string, unknown>;
		cluster: WorkflowCrystallizationCluster;
		sourceEpisodeIds: string[];
		successfulEpisodeIds: string[];
		now: number;
		existing?: WorkflowCrystallizationSkill;
	}): WorkflowCrystallizationSkill | undefined => {
		const title = trimToUndefined(asString(params.payload.title)) ?? params.cluster.title;
		const objective = trimToUndefined(asString(params.payload.objective)) ?? params.cluster.objective;
		if (!title || !objective) {
			return undefined;
		}
		const stages = normalizeWorkflowSkillStages(params.payload.stages);
		return {
			id: createHash("sha1")
				.update(params.cluster.id)
				.update(normalizeComparableText(title))
				.update(normalizeComparableText(objective))
				.digest("hex")
				.slice(0, 12),
			clusterId: params.cluster.id,
			title,
			objective,
			...(trimToUndefined(asString(params.payload.summary)) ? { summary: trimToUndefined(asString(params.payload.summary)) } : {}),
			...(params.cluster.workflowFamilyHint ? { workflowFamilyHint: params.cluster.workflowFamilyHint } : {}),
			triggers: uniqueStrings([
				...asStringList(params.payload.triggers),
				...(params.existing?.triggers ?? []),
			]).slice(0, 8),
			parameterSlots: normalizeWorkflowCandidateParameterSlots(params.payload.parameterSlots),
			stages,
			routeOptions: normalizeWorkflowCandidateRouteOptions(params.payload.routeOptions),
			successCriteria: uniqueStrings(asStringList(params.payload.successCriteria)).slice(0, 12),
			failurePolicy: uniqueStrings(asStringList(params.payload.failurePolicy)).slice(0, 12),
			sourceEpisodeIds: params.sourceEpisodeIds,
			sourceEpisodeCount: params.sourceEpisodeIds.length,
			successfulEpisodeCount: params.successfulEpisodeIds.length,
			observedStatusCounts: {
				completeCount: params.cluster.completeCount,
				partialCount: params.cluster.partialCount,
				failedCount: params.cluster.failedCount,
			},
			lastSynthesizedAt: params.now,
			...(params.existing?.publishedSkill ? { publishedSkill: params.existing.publishedSkill } : {}),
			...(params.existing?.notification ? { notification: params.existing.notification } : {}),
		};
	};

	const collectWorkflowEpisodes = (ledger: WorkflowCrystallizationLedger): WorkflowCrystallizationEpisode[] =>
		ledger.days
			.flatMap((day) => day.episodes);

	const buildWorkflowEpisodeFingerprint = (episodes: WorkflowCrystallizationEpisode[]): string =>
		createHash("sha1")
			.update(episodes.map((episode) =>
				`${episode.id}:${episode.segmentId}:${episode.completion}:${episode.workflowFamilyHint ?? ""}:${episode.summary}`).join("|"))
			.digest("hex")
			.slice(0, 16);

	const buildWorkflowPromotionFingerprint = (clusters: WorkflowCrystallizationCluster[]): string =>
		createHash("sha1")
			.update(clusters.map((cluster) =>
				`${cluster.id}:${cluster.occurrenceCount}:${cluster.completeCount}:${cluster.partialCount}:${cluster.failedCount}:${cluster.episodeIds.join(",")}`).join("|"))
			.digest("hex")
			.slice(0, 16);

	const buildWorkflowTurnsById = (ledger: WorkflowCrystallizationLedger): Map<string, WorkflowCrystallizationTurn> =>
		new Map(
			ledger.days
				.flatMap((day) => day.turns)
				.map((turn) => [turn.id, turn] as const),
		);

	const segmentWorkflowDay = async (params: {
		entry: SessionEntry;
		workspaceDir: string;
		dayStamp: string;
		turns: WorkflowCrystallizationTurn[];
	}): Promise<WorkflowCrystallizationSegment[]> => {
		const prompt = buildWorkflowSegmentationPrompt(params);
		const response = await runWorkflowCrystallizationPrompt({
			entry: params.entry,
			purpose: "segment",
			prompt,
		});
		return normalizeWorkflowSegments({
			payload: extractJsonObject(response),
			dayStamp: params.dayStamp,
			turns: params.turns,
			workspaceDir: params.workspaceDir,
		});
	};

	const summarizeWorkflowSegments = async (params: {
		entry: SessionEntry;
		workspaceDir: string;
		dayStamp: string;
		turns: WorkflowCrystallizationTurn[];
		segments: WorkflowCrystallizationSegment[];
	}): Promise<WorkflowCrystallizationEpisode[]> => {
		if (params.segments.length === 0) {
			return [];
		}
		const prompt = buildWorkflowEpisodeSummaryPrompt(params);
		const response = await runWorkflowCrystallizationPrompt({
			entry: params.entry,
			purpose: "summarize",
			prompt,
		});
		return normalizeWorkflowEpisodes({
			payload: extractJsonObject(response),
			segments: params.segments,
			turns: params.turns,
			workspaceDir: params.workspaceDir,
		});
	};

	const clusterWorkflowEpisodes = async (params: {
		entry: SessionEntry;
		episodes: WorkflowCrystallizationEpisode[];
	}): Promise<WorkflowCrystallizationCluster[]> => {
		const prompt = buildWorkflowClusterPrompt({
			episodes: params.episodes.slice(0, MAX_CLUSTERING_EPISODES),
		});
		const response = await runWorkflowCrystallizationPrompt({
			entry: params.entry,
			purpose: "cluster",
			prompt,
		});
		return normalizeWorkflowClusters({
			payload: extractJsonObject(response),
			episodes: params.episodes,
		});
	};

	const synthesizeWorkflowSkill = async (params: {
		entry: SessionEntry;
		cluster: WorkflowCrystallizationCluster;
		ledger: WorkflowCrystallizationLedger;
		existing?: WorkflowCrystallizationSkill;
	}): Promise<WorkflowCrystallizationSkill | undefined> => {
		const episodesById = new Map(collectWorkflowEpisodes(params.ledger).map((episode) => [episode.id, episode] as const));
		const clusterEpisodes = params.cluster.episodeIds
			.map((id) => episodesById.get(id))
			.filter((episode): episode is WorkflowCrystallizationEpisode => Boolean(episode))
			.sort((left, right) => right.endedAt - left.endedAt);
		const successfulEpisodes = clusterEpisodes.filter((episode) => episode.completion === "complete");
		if (successfulEpisodes.length < MIN_CLUSTER_OCCURRENCES_FOR_PROMOTION) {
			return undefined;
		}
		const sourceEpisodes = [
			...successfulEpisodes,
			...clusterEpisodes.filter((episode) => episode.completion !== "complete"),
		].slice(0, MAX_SYNTHESIS_EPISODE_EXAMPLES);
		const prompt = buildWorkflowSkillSynthesisPrompt({
			cluster: params.cluster,
			episodes: sourceEpisodes,
			turnsById: buildWorkflowTurnsById(params.ledger),
		});
		const response = await runWorkflowCrystallizationPrompt({
			entry: params.entry,
			purpose: "synthesize",
			prompt,
		});
		return normalizeWorkflowSkill({
			payload: extractJsonObject(response),
			cluster: params.cluster,
			sourceEpisodeIds: clusterEpisodes.map((episode) => episode.id),
			successfulEpisodeIds: successfulEpisodes.map((episode) => episode.id),
			now: Date.now(),
			existing: params.existing,
		});
	};

	const shouldReanalyzeWorkflowDay = (turnCount: number, lastSegmentedTurnCount?: number): boolean => {
		if (turnCount < MIN_TURNS_FOR_WORKFLOW_SEGMENTATION) {
			return false;
		}
		if (lastSegmentedTurnCount === undefined) {
			return true;
		}
		return turnCount - lastSegmentedTurnCount >= WORKFLOW_SEGMENTATION_REANALYZE_DELTA;
	};

	const notifyWorkflowCrystallizationPublished = async (params: {
		entry: SessionEntry;
		skills: Array<{
			skill: WorkflowCrystallizationSkill;
			previous?: WorkflowCrystallizationSkill;
		}>;
	}): Promise<number | undefined> => {
		if (!notifyUser || params.skills.length === 0) {
			return undefined;
		}
		const timestamp = Date.now();
		const summaryLines = params.skills.slice(0, 3).map(({ skill, previous }) =>
			`- ${skill.publishedSkill?.name ?? skill.title}: ${previous?.publishedSkill ? "updated" : "new"} skill from ${skill.successfulEpisodeCount} successful runs (${skill.sourceEpisodeCount} observed total).`);
		const extraCount = params.skills.length - summaryLines.length;
		const text = [
			params.skills.length === 1
				? "A crystallized workflow skill was published and hot-loaded into this workspace."
				: `${params.skills.length} crystallized workflow skills were published and hot-loaded into this workspace.`,
			...summaryLines,
			...(extraCount > 0 ? [`- ${extraCount} additional crystallized skills were also refreshed.`] : []),
		].join("\n");
		await notifyUser({
			entry: params.entry,
			source: "workflow_crystallization",
			title: "Crystallized workflow skill ready",
			text,
			details: {
				skills: params.skills.map(({ skill, previous }) => ({
					id: skill.id,
					title: skill.title,
					skillName: skill.publishedSkill?.name,
					skillPath: skill.publishedSkill?.skillPath,
					sourceEpisodeCount: skill.sourceEpisodeCount,
					successfulEpisodeCount: skill.successfulEpisodeCount,
					updated: Boolean(previous?.publishedSkill),
				})),
			},
		}).catch(() => {});
		return timestamp;
	};

	const runWorkflowCrystallizationAnalysis = (entry: SessionEntry): void => {
		if (!entry.workspaceDir) {
			return;
		}
		const workspaceKey = resolve(entry.workspaceDir);
		if (activeWorkflowCrystallizationAnalyses.has(workspaceKey)) {
			pendingWorkflowCrystallizationAnalyses.add(workspaceKey);
			return;
		}
		const task = (async () => {
			let ledger = await loadPersistedWorkflowCrystallizationLedger({
				workspaceDir: workspaceKey,
				learningDir: runtimeLearningDir,
			}).catch(() => undefined);
			if (!ledger) {
				return;
			}
			let dayNeedingSegmentation = [...ledger.days]
				.sort((left, right) => left.dayStamp.localeCompare(right.dayStamp))
				.find((day) => shouldReanalyzeWorkflowDay(day.turns.length, day.lastSegmentedTurnCount));
			while (dayNeedingSegmentation) {
				const segments = await segmentWorkflowDay({
					entry,
					workspaceDir: workspaceKey,
					dayStamp: dayNeedingSegmentation.dayStamp,
					turns: dayNeedingSegmentation.turns,
				});
				const segmentedAt = Date.now();
				ledger = await runSerializedWorkflowLedgerMutation(workspaceKey, async () =>
					await updatePersistedWorkflowCrystallizationLedger({
						workspaceDir: workspaceKey,
						learningDir: runtimeLearningDir,
						updater: (current) => replaceWorkflowCrystallizationDaySegments(current, {
							dayStamp: dayNeedingSegmentation!.dayStamp,
							segments,
							segmentedAt,
							segmentedTurnCount: dayNeedingSegmentation!.turns.length,
						}),
					}));
				const episodes = await summarizeWorkflowSegments({
					entry,
					workspaceDir: workspaceKey,
					dayStamp: dayNeedingSegmentation.dayStamp,
					turns: dayNeedingSegmentation.turns,
					segments,
				});
				ledger = await runSerializedWorkflowLedgerMutation(workspaceKey, async () =>
					await updatePersistedWorkflowCrystallizationLedger({
						workspaceDir: workspaceKey,
						learningDir: runtimeLearningDir,
						updater: (current) => replaceWorkflowCrystallizationDayEpisodes(current, {
							dayStamp: dayNeedingSegmentation!.dayStamp,
							episodes,
							summarizedAt: Date.now(),
						}),
					}));
				dayNeedingSegmentation = [...ledger.days]
					.sort((left, right) => left.dayStamp.localeCompare(right.dayStamp))
					.find((day) => shouldReanalyzeWorkflowDay(day.turns.length, day.lastSegmentedTurnCount));
			}
			const allEpisodes = collectWorkflowEpisodes(ledger);
			const episodeFingerprint = buildWorkflowEpisodeFingerprint(allEpisodes);
			if (allEpisodes.length >= MIN_EPISODES_FOR_WORKFLOW_CLUSTERING
				&& episodeFingerprint !== ledger.analysisState?.lastClusteredFingerprint) {
				const clusters = await clusterWorkflowEpisodes({
					entry,
					episodes: allEpisodes,
				});
				ledger = await runSerializedWorkflowLedgerMutation(workspaceKey, async () =>
					await updatePersistedWorkflowCrystallizationLedger({
						workspaceDir: workspaceKey,
						learningDir: runtimeLearningDir,
						updater: (current) => replaceWorkflowCrystallizationClusters(current, {
							clusters,
							clusteredAt: Date.now(),
							clusteredEpisodeCount: allEpisodes.length,
							clusteredFingerprint: episodeFingerprint,
						}),
					}));
			}
			const promotableClusters = [...ledger.clusters]
				.filter((cluster) => cluster.completeCount >= MIN_CLUSTER_OCCURRENCES_FOR_PROMOTION)
				.sort((left, right) =>
					right.completeCount - left.completeCount ||
					right.occurrenceCount - left.occurrenceCount ||
					right.lastSeenAt - left.lastSeenAt)
				.slice(0, MAX_PROMOTED_WORKFLOW_CANDIDATES);
			const promotionFingerprint = buildWorkflowPromotionFingerprint(promotableClusters);
			if (promotionFingerprint !== ledger.analysisState?.lastPublishedFingerprint) {
				const existingSkillsById = new Map(ledger.skills.map((skill) => [skill.id, skill] as const));
				const synthesized: WorkflowCrystallizationSkill[] = [];
				const publishedChanges: Array<{
					skill: WorkflowCrystallizationSkill;
					previous?: WorkflowCrystallizationSkill;
				}> = [];
				for (const cluster of promotableClusters) {
					const existing = [...existingSkillsById.values()].find((skill) => skill.clusterId === cluster.id);
					const skill = await synthesizeWorkflowSkill({
						entry,
						cluster,
						ledger,
						existing,
					}).catch(() => undefined);
					if (!skill) {
						continue;
					}
					const publishedSkill = await publishWorkflowCrystallizedSkill({
						workspaceDir: workspaceKey,
						skill,
						overwrite: true,
					}).catch(() => undefined);
					const finalized: WorkflowCrystallizationSkill = publishedSkill
						? {
							...skill,
							publishedSkill,
						}
						: skill;
					synthesized.push(finalized);
					const previousFingerprint = existing?.publishedSkill?.contentFingerprint;
					const nextFingerprint = finalized.publishedSkill?.contentFingerprint;
					if (!existing?.publishedSkill || !nextFingerprint || previousFingerprint !== nextFingerprint || !existing.notification?.notifiedAt) {
						publishedChanges.push({
							skill: finalized,
							previous: existing,
						});
					}
				}
				if (publishedChanges.length > 0) {
					const promptRefreshError = await refreshPublishedSkillPrompts(entry, {
						draft: { objective: publishedChanges[0]!.skill.objective },
						skill: {
							name: publishedChanges[0]!.skill.publishedSkill?.name,
							skillPath: publishedChanges[0]!.skill.publishedSkill?.skillPath,
						},
					});
					if (promptRefreshError) {
						publishedChanges[0]!.skill.failurePolicy = uniqueStrings([
							...publishedChanges[0]!.skill.failurePolicy,
							`Hot refresh warning: ${promptRefreshError}`,
						]).slice(0, 12);
					}
				}
				const notifiedAt = await notifyWorkflowCrystallizationPublished({
					entry,
					skills: publishedChanges,
				});
				const skills = synthesized.map((skill) =>
					publishedChanges.some((change) => change.skill.id === skill.id)
					&& skill.publishedSkill
					&& notifiedAt
						? {
							...skill,
							notification: {
								notifiedAt,
							},
						}
						: skill);
				ledger = await runSerializedWorkflowLedgerMutation(workspaceKey, async () =>
					await updatePersistedWorkflowCrystallizationLedger({
						workspaceDir: workspaceKey,
						learningDir: runtimeLearningDir,
						updater: (current) => replaceWorkflowCrystallizationSkills(current, {
							skills,
							publishedAt: Date.now(),
							publishedClusterCount: promotableClusters.length,
							publishedFingerprint: promotionFingerprint,
						}),
					}));
			}
		})()
			.catch(() => {})
			.finally(() => {
				activeWorkflowCrystallizationAnalyses.delete(workspaceKey);
				if (pendingWorkflowCrystallizationAnalyses.delete(workspaceKey)) {
					queueMicrotask(() => {
						runWorkflowCrystallizationAnalysis(entry);
					});
				}
			});
		activeWorkflowCrystallizationAnalyses.set(workspaceKey, task);
	};

	const createTeachInternalSession = async (
		entry: SessionEntry,
		kind: "clarify" | "validate",
		options?: {
			allowedToolNames?: string[];
			extraSystemPrompt?: string;
			thinkingLevel?: UnderstudyConfig["defaultThinkingLevel"];
		},
	): Promise<SessionEntry> => {
		try {
			const isolated = await createScopedSession({
				sessionKey: `${entry.id}::teach-${kind}::${randomUUID()}`,
				parentId: entry.id,
				channelId: entry.channelId,
				senderId: entry.senderId,
				senderName: entry.senderName,
				conversationName: entry.conversationName,
				conversationType: entry.conversationType,
				threadId: entry.threadId,
				workspaceDir: entry.workspaceDir,
				explicitWorkspace: true,
				configOverride: entry.configOverride,
				sandboxInfo: entry.sandboxInfo,
				executionScopeKey: entry.executionScopeKey,
				allowedToolNames: options?.allowedToolNames,
				extraSystemPrompt: options?.extraSystemPrompt,
				thinkingLevel: options?.thinkingLevel,
			});
			return isolated?.session ? isolated : entry;
		} catch {
			return entry;
		}
	};

	const runTeachInternalPrompt = async (params: {
		entry: SessionEntry;
		kind: "clarify" | "validate";
		prompt: string;
		timeoutMs?: number;
		allowedToolNames?: string[];
		extraSystemPrompt?: string;
		thinkingLevel?: UnderstudyConfig["defaultThinkingLevel"];
	}): Promise<Awaited<ReturnType<CreateGatewaySessionRuntimeParams["promptSession"]>>> => {
		const internalEntry = await createTeachInternalSession(params.entry, params.kind, {
			allowedToolNames: params.allowedToolNames,
			extraSystemPrompt: params.extraSystemPrompt,
			thinkingLevel: params.thinkingLevel,
		});
		const timeoutMs = params.timeoutMs ?? resolveTeachInternalPromptTimeoutMs(params.kind);
		const runPrompt = async (
			promptText: string,
			remainingBudgetMs: number,
		): Promise<Awaited<ReturnType<CreateGatewaySessionRuntimeParams["promptSession"]>>> =>
			await withTimeout(
				runSerializedSessionTurn(
					internalEntry,
					async () => await promptSession(internalEntry, promptText),
				),
				remainingBudgetMs,
			);
		try {
			return await runPrompt(params.prompt, timeoutMs);
		} catch (error) {
			if (error instanceof Error && error.message === "timeout") {
				if (internalEntry !== params.entry) {
					await abortSessionEntry(internalEntry).catch(() => false);
				}
				throw new Error(`Teach ${params.kind} prompt timed out after ${timeoutMs}ms`);
			}
			throw error;
		}
	};
	const runTeachValidationReplayPrompt = async (params: {
		entry: SessionEntry;
		prompt: string;
		timeoutMs?: number;
	}): Promise<Awaited<ReturnType<CreateGatewaySessionRuntimeParams["promptSession"]>>> => {
		const internalEntry = await createTeachInternalSession(params.entry, "validate");
		const timeoutMs = params.timeoutMs ?? resolveTeachInternalPromptTimeoutMs("validate");
		try {
			return await withTimeout(
				runSerializedSessionTurn(
					internalEntry,
					async () => await promptSession(internalEntry, params.prompt),
				),
				timeoutMs,
			);
		} catch (error) {
			if (error instanceof Error && error.message === "timeout") {
				if (internalEntry !== params.entry) {
					await abortSessionEntry(internalEntry).catch(() => false);
				}
				throw new Error(`Teach validate prompt timed out after ${timeoutMs}ms`);
			}
			throw error;
		}
	};

	const buildDirectSessionResponse = (params: {
		entry: SessionEntry;
		userText: string;
		assistantText: string;
		assistantImages?: ImageContent[];
		meta?: Record<string, unknown>;
		historyMedia?: {
			images?: ImageContent[];
			attachments?: Attachment[];
		};
	}): RunTurnResult => {
		appendHistory(params.entry, "user", params.userText, undefined, params.historyMedia);
		appendHistory(
			params.entry,
			"assistant",
			params.assistantText,
			undefined,
			params.assistantImages?.length ? { images: params.assistantImages } : undefined,
		);
		params.entry.lastActiveAt = Date.now();
		params.entry.messageCount += 1;
		seedRuntimeMessagesFromHistory(params.entry, params.entry.history);
		onStateChanged?.();
		return {
			response: params.assistantText,
			runId: `direct-${randomUUID()}`,
			sessionId: params.entry.id,
			status: "ok",
			...(params.assistantImages?.length ? { images: params.assistantImages } : {}),
			...(params.meta ? { meta: params.meta } : {}),
		};
	};

	const buildEphemeralSessionResponse = (params: {
		entry: SessionEntry;
		assistantText: string;
		meta?: Record<string, unknown>;
	}): RunTurnResult => ({
		response: params.assistantText,
		runId: `ephemeral-${randomUUID()}`,
		sessionId: params.entry.id,
		status: "ok",
		...(params.meta ? { meta: params.meta } : {}),
	});

	const resolveHistoryMedia = (params: {
		promptOptions?: Record<string, unknown>;
		images?: ImageContent[];
		attachments?: Attachment[];
	}): { images?: ImageContent[]; attachments?: Attachment[] } | undefined => {
		const promptOptionRecord = asRecord(params.promptOptions);
		const images = normalizeHistoryImages(promptOptionRecord?.images ?? params.images);
		const attachments = normalizeHistoryAttachments(params.attachments);
		return images || attachments
			? {
				...(images ? { images } : {}),
				...(attachments ? { attachments } : {}),
			}
			: undefined;
	};

	const formatTeachClockTime = (value: unknown): string | undefined => {
		const timestampMs = asNumber(value);
		if (timestampMs === undefined) {
			return undefined;
		}
		const totalSeconds = Math.max(0, Math.floor(timestampMs / 1000));
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
	};

	const formatTeachDuration = (value: unknown): string | undefined => {
		const durationMs = asNumber(value);
		if (durationMs === undefined) {
			return undefined;
		}
		if (durationMs < 1_000) {
			return `${Math.round(durationMs)} ms`;
		}
		if (durationMs < 60_000) {
			return `${(durationMs / 1_000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
		}
		const totalSeconds = Math.floor(durationMs / 1_000);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
	};

	const summarizeTeachList = (items: string[], prefix: string, limit: number): string[] => {
		if (items.length === 0) {
			return [];
		}
		const visible = items.slice(0, limit).map((item) => `${prefix}${item}`);
		if (items.length > limit) {
			visible.push(`${prefix}...and ${items.length - limit} more`);
		}
		return visible;
	};

	const summarizeTeachChecks = (value: unknown, limit: number = 5): string[] => {
		if (!Array.isArray(value) || value.length === 0) {
			return [];
		}
		const visible = value
			.map((entry) => asRecord(entry))
			.filter((entry): entry is Record<string, unknown> => Boolean(entry))
			.slice(0, limit)
			.map((check) => {
				const summary = asString(check.summary) ?? asString(check.id) ?? "Validation check";
				return `- ${check.ok === true ? "pass" : "fail"}: ${summary}`;
			});
		if (value.length > limit) {
			visible.push(`- ...and ${value.length - limit} more checks`);
		}
		return visible;
	};

	const summarizeTeachKeyframes = (draft: Record<string, unknown>, limit: number = 6): string[] => {
		const sourceDetails = asRecord(draft.sourceDetails);
		const keyframes = Array.isArray(sourceDetails?.keyframes)
			? sourceDetails.keyframes
				.map((entry) => asRecord(entry))
				.filter((entry): entry is Record<string, unknown> => Boolean(entry))
			: [];
		if (keyframes.length === 0) {
			return [];
		}
		const lines = keyframes.slice(0, limit).map((frame, index) => {
			const time = formatTeachClockTime(frame.timestampMs);
			const label = asString(frame.label);
			const kind = asString(frame.kind);
			const path = asString(frame.path);
			const parts = [
				`${index + 1}.`,
				time ? `@ ${time}` : undefined,
				kind,
				label,
				path ? `-> ${path}` : undefined,
			].filter(Boolean);
			return parts.join(" ");
		});
		if (keyframes.length > limit) {
			lines.push(`...and ${keyframes.length - limit} more keyframes`);
		}
		return lines;
	};

	const summarizeTeachDraft = (draft: Record<string, unknown>): string[] => {
		const lines: string[] = [];
		const draftId = asString(draft.id);
		const title = asString(draft.title);
		const objective = asString(draft.objective) ?? asString(draft.intent);
		const status = asString(draft.status);
		const routeSignature = asString(draft.routeSignature);
		const sourceDetails = asRecord(draft.sourceDetails);
		const evidenceSummary = asString(sourceDetails?.evidenceSummary);
		const analyzerProvider = asString(sourceDetails?.analyzerProvider);
		const analyzerModel = asString(sourceDetails?.analyzerModel);
		const taskKind = asString(draft.taskKind);
		const executionPolicy = normalizeTeachExecutionPolicy(draft.executionPolicy);
		const stepRouteOptions = Array.isArray(draft.stepRouteOptions)
			? draft.stepRouteOptions
				.map((entry) => asRecord(entry))
				.filter((entry): entry is Record<string, unknown> => Boolean(entry))
			: [];
		const taskCard = normalizeTeachTaskCard(asRecord(draft.taskCard));
		const procedure = normalizeTeachProcedure(
			Array.isArray(draft.procedure) ? draft.procedure : undefined,
		) ?? [];
		const replayPreconditions = asStringList(draft.replayPreconditions);
		const resetSignals = asStringList(draft.resetSignals);
		const skillDependencies = normalizeTeachSkillDependencies(
			Array.isArray(draft.skillDependencies) ? draft.skillDependencies : undefined,
		) ?? [];
		const steps = Array.isArray(draft.steps)
			? draft.steps
				.map((entry) => asRecord(entry))
				.filter((entry): entry is Record<string, unknown> => Boolean(entry))
			: [];
		const guiReferencePathLines = buildTeachGuiReferencePathLines({
			procedure,
			stepRouteOptions,
			steps,
		});
		if (draftId) {
			lines.push(`- Draft: \`${draftId}\`${status ? ` (${status})` : ""}`);
		}
		if (title) {
			lines.push(`- Title: ${title}`);
		}
		if (objective) {
			lines.push(`- Objective: ${objective}`);
		}
		if (routeSignature) {
			lines.push(`- Route: ${routeSignature}`);
		}
		if (evidenceSummary) {
			lines.push(`- Evidence: ${evidenceSummary}`);
		}
		if (analyzerProvider || analyzerModel) {
			lines.push(`- Analyzer: ${[analyzerProvider, analyzerModel].filter(Boolean).join(" / ")}`);
		}
		if (taskKind) {
			lines.push(`- Task kind: ${taskKind}`);
		}
		if (executionPolicy) {
			lines.push("- Execution strategy:");
			if (executionPolicy.toolBinding) {
				lines.push(`- Tool binding: ${executionPolicy.toolBinding}`);
			}
			const preferredRoutes = formatTeachExecutionRouteOrder(executionPolicy.preferredRoutes);
			if (preferredRoutes) {
				lines.push(`- Preferred routes: ${preferredRoutes}`);
			}
			if (executionPolicy.stepInterpretation) {
				lines.push(`- Detailed steps meaning: ${executionPolicy.stepInterpretation}`);
			}
			if (executionPolicy.notes && executionPolicy.notes.length > 0) {
				lines.push(...executionPolicy.notes.map((note) => `- ${note}`));
			}
		}
		if (procedure.length > 0) {
			lines.push("- Staged workflow:");
			lines.push(
				...procedure.slice(0, 8).map((step, index) => {
					const kind = trimToUndefined(asString(step.kind));
					const skillName = trimToUndefined(asString(step.skillName));
					const notes = trimToUndefined(asString(step.notes));
					return `${index + 1}. ${[
						asString(step.instruction) ?? "Step",
						kind ? `[${kind}]` : undefined,
						skillName ? `skill=${skillName}` : undefined,
						notes ? `(${notes})` : undefined,
					].filter(Boolean).join(" ")}`;
				}),
			);
			if (procedure.length > 8) {
				lines.push(`...and ${procedure.length - 8} more workflow phases`);
			}
		}
		if (guiReferencePathLines.length > 0) {
			lines.push("- GUI reference path (reference only):");
			lines.push(...guiReferencePathLines.slice(0, 16));
			if (guiReferencePathLines.length > 16) {
				lines.push(`...and ${guiReferencePathLines.length - 16} more GUI reference lines`);
			}
		}
		if (stepRouteOptions.length > 0) {
			lines.push("- Tool route options (reference only):");
			for (const procedureStep of procedure.slice(0, 8)) {
				const options = stepRouteOptions.filter((option) => asString(option.procedureStepId) === procedureStep.id);
				if (options.length === 0) {
					continue;
				}
				lines.push(`${procedureStep.index}. ${asString(procedureStep.instruction) ?? "Step"}`);
				lines.push(
					...options.slice(0, 4).map((option) => {
						const route = normalizeTeachExecutionRoute(option.route) ?? "gui";
						const target = formatTeachRouteOptionTarget({
							route,
							toolName: trimToUndefined(asString(option.toolName)),
							skillName: trimToUndefined(asString(option.skillName)),
						});
						return `- [${asString(option.preference) ?? "preferred"}] [${target}] ${asString(option.instruction) ?? "Route option"}`;
					}),
				);
			}
		}
		if (taskCard) {
			lines.push("- Task card:");
			lines.push(`- Goal: ${taskCard.goal ?? objective ?? title ?? "Not specified yet."}`);
			lines.push(`- Scope: ${taskCard.scope ?? "Reusable workflow."}`);
			lines.push(`- Loop over: ${taskCard.loopOver ?? "The current demonstrated item."}`);
			lines.push(`- Inputs: ${taskCard.inputs.length > 0 ? taskCard.inputs.join("; ") : "No structured inputs captured."}`);
			lines.push(`- Extract: ${taskCard.extract.length > 0 ? taskCard.extract.join("; ") : "No structured extracts captured."}`);
			lines.push(`- Formula: ${taskCard.formula ?? "None captured."}`);
			lines.push(`- Filter: ${taskCard.filter ?? "None captured."}`);
			lines.push(`- Output: ${taskCard.output ?? "Verify the externally visible task outcome."}`);
		}
		if (procedure.length === 0 && steps.length > 0) {
			lines.push("- Steps:");
			lines.push(
				...steps.slice(0, 8).map((step, index) =>
					`${index + 1}. ${asString(step.instruction) ?? asString(step.summary) ?? "Step"}`),
			);
			if (steps.length > 8) {
				lines.push(`...and ${steps.length - 8} more steps`);
			}
		}
		if (replayPreconditions.length > 0) {
			lines.push("- Replay preconditions:");
			lines.push(...replayPreconditions.map((entry) => `- ${entry}`));
		}
		if (resetSignals.length > 0) {
			lines.push("- Reset signals:");
			lines.push(...resetSignals.map((entry) => `- ${entry}`));
		}
		if (skillDependencies.length > 0) {
			lines.push("- Compose with skills:");
			lines.push(
				...skillDependencies.slice(0, 6).map((dependency) => {
					const name = asString(dependency.name) ?? "unknown-skill";
					const reason = trimToUndefined(asString(dependency.reason));
					return `- ${name}${reason ? `: ${reason}` : ""}`;
				}),
			);
			if (skillDependencies.length > 6) {
				lines.push(`- ...and ${skillDependencies.length - 6} more skill dependencies`);
			}
		}
		const successCriteria = asStringList(draft.successCriteria);
		if (successCriteria.length > 0) {
			lines.push("- Success criteria:");
			lines.push(...summarizeTeachList(successCriteria, "- ", 5));
		}
		const openQuestions = asStringList(draft.openQuestions);
		if (openQuestions.length > 0) {
			lines.push("- Open questions:");
			lines.push(...summarizeTeachList(openQuestions, "- ", 5));
		}
		const keyframeLines = summarizeTeachKeyframes(draft);
		if (keyframeLines.length > 0) {
			lines.push("- Keyframes:");
			lines.push(...keyframeLines);
		}
		return lines;
	};

		const summarizeTeachValidation = (validation: Record<string, unknown>): string[] => {
			const lines: string[] = [];
			const state = asString(validation.state);
			const summary = asString(validation.summary);
			const mode = asString(validation.mode);
			const notes = asStringList(validation.notes);
			const usedMutatingTools = asBoolean(validation.usedMutatingTools);
			const toolNames = asStringList(validation.toolNames);
			const mutatingToolNames = asStringList(validation.mutatingToolNames);
			const runId = asString(validation.runId);
		if (state || summary) {
			lines.push(`- Validation: ${[state, summary].filter(Boolean).join(" - ")}`);
		}
		if (mode) {
			lines.push(`- Mode: ${mode}`);
		}
		if (runId) {
			lines.push(`- Run ID: ${runId}`);
		}
		if (toolNames.length > 0) {
			lines.push(`- Tools: ${toolNames.join(", ")}`);
		}
			if (mutatingToolNames.length > 0 || usedMutatingTools !== undefined) {
				lines.push(`- Mutating replay tools: ${mutatingToolNames.length > 0 ? mutatingToolNames.join(", ") : "none"}`);
				lines.push(`- Real replay: ${usedMutatingTools === true ? "yes" : "no"}`);
			}
			if (notes.length > 0) {
				lines.push("- Notes:");
				lines.push(...summarizeTeachList(notes, "- ", 4));
			}
			const checks = summarizeTeachChecks(validation.checks);
			if (checks.length > 0) {
				lines.push("- Checks:");
				lines.push(...checks);
		}
		return lines;
	};

	const loadTeachSkillPreview = async (skillPath?: string): Promise<string | undefined> => {
		if (!skillPath) {
			return undefined;
		}
		try {
			const raw = await readFile(skillPath, "utf8");
			const lines = raw.trimEnd().split(/\r?\n/);
			const preview = lines.slice(0, 18).join("\n");
			return lines.length > 18 ? `${preview}\n...` : preview;
		} catch {
			return undefined;
		}
	};

	const summarizeTeachSkill = async (skill: Record<string, unknown>): Promise<string[]> => {
		const lines: string[] = [];
		const name = asString(skill.name);
		const skillPath = asString(skill.skillPath);
		if (name) {
			lines.push(`- Skill: \`${name}\``);
		}
		if (skillPath) {
			lines.push(`- Path: ${skillPath}`);
		}
		const preview = await loadTeachSkillPreview(skillPath);
		if (preview) {
			lines.push("- Preview:");
			lines.push("```md");
			lines.push(preview);
			lines.push("```");
		}
		return lines;
	};

	const buildTeachReport = async (params: {
		headline: string;
		recording?: Record<string, unknown>;
		draft?: Record<string, unknown>;
		validation?: Record<string, unknown>;
		skill?: Record<string, unknown>;
		analysisError?: string;
		nextSteps?: string[];
	}): Promise<string> => {
		const lines = [params.headline];
		const recording = params.recording ?? {};
		const draft = params.draft ?? {};
		const validation = Object.keys(params.validation ?? {}).length > 0
			? params.validation!
			: asRecord(draft.validation) ?? {};
		const skill = params.skill ?? asRecord(draft.publishedSkill) ?? {};
		const videoPath = asString(recording.videoPath);
		const eventLogPath = asString(recording.eventLogPath);
		const recordingDuration = formatTeachDuration(recording.durationMs);
		if (videoPath || eventLogPath || recordingDuration) {
			lines.push("", "Recording:");
			if (videoPath) {
				lines.push(`- Video: ${videoPath}`);
			}
			if (eventLogPath) {
				lines.push(`- Event log: ${eventLogPath}`);
			}
			if (recordingDuration) {
				lines.push(`- Duration: ${recordingDuration}`);
			}
		}
		if (params.analysisError) {
			lines.push("", "Analysis:");
			lines.push(`- Error: ${params.analysisError}`);
		}
		if (Object.keys(draft).length > 0) {
			lines.push("", "Draft:");
			lines.push(...summarizeTeachDraft(draft));
		}
		if (Object.keys(validation).length > 0) {
			lines.push("", "Validation:");
			lines.push(...summarizeTeachValidation(validation));
		}
		if (Object.keys(skill).length > 0) {
			lines.push("", "Skill:");
			lines.push(...await summarizeTeachSkill(skill));
		}
		if (Array.isArray(params.nextSteps) && params.nextSteps.length > 0) {
			lines.push("", "Next:");
			lines.push(...params.nextSteps.map((step) => `- ${step}`));
		}
		return lines.join("\n");
	};

	const buildTeachClarificationReport = async (params: {
		headline: string;
		recording?: Record<string, unknown>;
		draft: Record<string, unknown>;
		state: TeachClarificationState;
		nextSteps?: string[];
		includeDraftSnapshot?: boolean;
	}): Promise<string> => {
		const lines = [params.headline];
		const recording = params.recording ?? {};
		const videoPath = asString(recording.videoPath);
		const eventLogPath = asString(recording.eventLogPath);
		const recordingDuration = formatTeachDuration(recording.durationMs);
		if (videoPath || eventLogPath || recordingDuration) {
			lines.push("", "Recording:");
			if (videoPath) {
				lines.push(`- Video: ${videoPath}`);
			}
			if (eventLogPath) {
				lines.push(`- Event log: ${eventLogPath}`);
			}
			if (recordingDuration) {
				lines.push(`- Duration: ${recordingDuration}`);
			}
		}
		lines.push("", "Task Card:");
		const taskCard = params.state.taskCard;
		if (taskCard) {
			lines.push(`- Goal: ${taskCard.goal ?? "Not specified yet."}`);
			lines.push(`- Scope: ${taskCard.scope ?? "Not specified yet."}`);
			lines.push(`- Loop over: ${taskCard.loopOver ?? "Not specified yet."}`);
			lines.push(`- Inputs: ${taskCard.inputs.length > 0 ? taskCard.inputs.join("; ") : "Not specified yet."}`);
			lines.push(`- Extract: ${taskCard.extract.length > 0 ? taskCard.extract.join("; ") : "Not specified yet."}`);
			lines.push(`- Formula: ${taskCard.formula ?? "Not specified yet."}`);
			lines.push(`- Filter: ${taskCard.filter ?? "Not specified yet."}`);
			lines.push(`- Output: ${taskCard.output ?? "Not specified yet."}`);
		} else {
			lines.push("- Goal: Not specified yet.");
		}
		if (params.includeDraftSnapshot !== false) {
			lines.push("", "Draft Snapshot:");
			lines.push(...summarizeTeachDraft(params.draft));
		}
		lines.push("", "Clarification:");
		lines.push(`- Status: ${params.state.status}`);
		if (params.state.summary) {
			lines.push(`- Summary: ${params.state.summary}`);
		}
		if (params.state.excludedDemoSteps.length > 0) {
			lines.push("- Excluded demo-only steps:");
			lines.push(...summarizeTeachList(params.state.excludedDemoSteps, "- ", 4));
		}
		if (params.state.pendingQuestions.length > 0) {
			lines.push("- Pending questions:");
			lines.push(...summarizeTeachList(params.state.pendingQuestions, "- ", 6));
		} else if (params.state.nextQuestion) {
			lines.push(`- Next question: ${params.state.nextQuestion}`);
		}
		if (Array.isArray(params.nextSteps) && params.nextSteps.length > 0) {
			lines.push("", "Next:");
			lines.push(...params.nextSteps.map((step) => `- ${step}`));
		}
		return lines.join("\n");
	};

	const startTeachRecording = async (entry: SessionEntry, params?: Record<string, unknown>) => {
		if (!entry.workspaceDir) {
			throw new Error(`Session ${entry.id} is not bound to a workspace`);
		}
		const existing = activeTeachRecordings.get(entry.id);
		if (existing) {
			return {
				sessionId: entry.id,
				recording: existing.status(),
				alreadyActive: true,
			};
		}
		const recording = await demonstrationRecorder.start({
			outputDir: resolveDemonstrationOutputDir(entry),
			filePrefix: `session-${sanitizePathSegment(entry.id, "session")}-${Date.now()}`,
			displayIndex: Math.max(1, asNumber(params?.displayIndex) ?? 1),
			showClicks: asBoolean(params?.showClicks) !== false,
			captureAudio: asBoolean(params?.captureAudio) === true,
			maxDurationSec: asNumber(params?.maxDurationSec),
			app: asString(params?.app),
		});
		activeTeachRecordings.set(entry.id, recording);
		onStateChanged?.();
		return {
			sessionId: entry.id,
			recording: recording.status(),
			alreadyActive: false,
		};
	};

	const validateTeachDraftForEntry = async (entry: SessionEntry, draft: TaughtTaskDraft) => {
		const preflight = buildTeachDraftValidationPreflight(draft);
		if (preflight) {
			return preflight;
		}
		try {
			const timeoutMs = resolveTeachInternalPromptTimeoutMs("validate");
			const result = await validateTeachDraft({
				entry,
				draft,
				promptSession: async (_entry, text, _runId, _promptOptions) =>
					await runTeachValidationReplayPrompt({
						entry,
						prompt: text,
						timeoutMs,
					}),
				});
			const visibleResponse = normalizeAssistantDisplayText(result.response ?? "").text;
			if (result.runId) {
				const runTrace = storeSessionRunTrace(entry, {
					runId: result.runId,
					userPrompt: buildTeachDraftValidationPrompt(draft),
					response: visibleResponse,
					meta: result.meta,
				});
				if (persistSessionRunTrace) {
					await persistSessionRunTrace({
						sessionId: entry.id,
						trace: runTrace,
					});
				}
			}
			seedRuntimeMessagesFromHistory(entry, entry.history);
			onStateChanged?.();
			return {
				...result,
				response: visibleResponse,
			};
		} catch (error) {
			seedRuntimeMessagesFromHistory(entry, entry.history);
			const summary = error instanceof Error ? error.message : String(error);
			return {
				state: "failed" as const,
				summary: `Teach validation failed: ${summary}`,
				checks: [
					{
						id: "teach-validation:exception",
						ok: false,
						summary: `Teach validation failed: ${summary}`,
						source: "replay" as const,
					},
				],
				mode: "replay" as const,
				usedMutatingTools: false,
				toolNames: [],
				mutatingToolNames: [],
			};
		}
	};

	const updateTeachDraftValidation = async (entry: SessionEntry, draft: TaughtTaskDraft, validation: TeachDraftValidationResult) => {
		const updated = await taskDraftHandlers.update({
			sessionId: entry.id,
			draftId: draft.id,
			patch: {
				validation: {
					state: validation.state,
					summary: validation.summary,
					runId: validation.runId,
					responsePreview: trimToUndefined(validation.response?.slice(0, TRACE_VALUE_PREVIEW_CHARS)),
					checks: validation.checks,
					mode: validation.mode,
					usedMutatingTools: validation.usedMutatingTools,
					toolNames: validation.toolNames,
					mutatingToolNames: validation.mutatingToolNames,
				},
			},
			action: "validated",
			note: validation.summary,
		});
		await refreshTeachDraftPrompts(entry);
		return updated;
	};

	const persistInternalTeachPromptRun = async (params: {
		entry: SessionEntry;
		userPrompt: string;
		result: Awaited<ReturnType<CreateGatewaySessionRuntimeParams["promptSession"]>>;
	}): Promise<string> => {
		const visibleResponse = normalizeAssistantDisplayText(params.result.response ?? "").text;
		if (params.result.runId) {
			const runTrace = storeSessionRunTrace(params.entry, {
				runId: params.result.runId,
				userPrompt: params.userPrompt,
				response: visibleResponse,
				meta: params.result.meta,
			});
			if (persistSessionRunTrace) {
				await persistSessionRunTrace({
					sessionId: params.entry.id,
					trace: runTrace,
				});
			}
		}
		seedRuntimeMessagesFromHistory(params.entry, params.entry.history);
		onStateChanged?.();
		return visibleResponse;
	};

	const clearTeachClarificationForDraft = (entry: SessionEntry, draftId?: string): boolean => {
		if (!draftId) {
			return false;
		}
		const activeClarification = readTeachClarificationState(entry);
		if (activeClarification?.draftId !== draftId) {
			return false;
		}
		writeTeachClarificationState(entry, undefined);
		onStateChanged?.();
		return true;
	};

	const startTeachRecordingFromCommand = async (entry: SessionEntry, params?: Record<string, unknown>) => {
		const hadClarification = Boolean(readTeachClarificationState(entry));
		writeTeachClarificationState(entry, undefined);
		if (hadClarification) {
			onStateChanged?.();
		}
		return await startTeachRecording(entry, params);
	};

	const updateTeachDraftFromClarification = async (entry: SessionEntry, draft: TaughtTaskDraft, payload: TeachClarificationPayload, note?: string) => {
		const patch: Record<string, unknown> = {};
		const mergedTitle = preferTeachText(draft.title, payload.title);
		if (mergedTitle && mergedTitle !== draft.title) {
			patch.title = mergedTitle;
		}
		const mergedIntent = preferTeachText(draft.intent, payload.intent);
		if (mergedIntent && mergedIntent !== draft.intent) {
			patch.intent = mergedIntent;
		}
		const mergedObjective = preferTeachText(draft.objective, payload.objective);
		if (mergedObjective && mergedObjective !== draft.objective) {
			patch.objective = mergedObjective;
		}
		if (payload.taskKind !== undefined && payload.taskKind !== draft.taskKind) {
			patch.taskKind = payload.taskKind;
		}
		if (payload.parameterSlots !== undefined && (payload.parameterSlots.length > 0 || draft.parameterSlots.length === 0)) {
			patch.parameterSlots = payload.parameterSlots.map((entry) => {
				if (typeof entry === "string") {
					return entry;
				}
				return {
					name: asString(entry.name),
					label: asString(entry.label),
					sampleValue: asString(entry.sampleValue),
					required: asBoolean(entry.required) !== false,
					notes: asString(entry.notes),
				};
			});
		}
		if (payload.successCriteria !== undefined && (payload.successCriteria.length > 0 || draft.successCriteria.length === 0)) {
			patch.successCriteria = payload.successCriteria;
		}
		if (payload.openQuestions !== undefined) {
			patch.openQuestions = payload.openQuestions;
		}
		if (payload.uncertainties !== undefined) {
			patch.uncertainties = payload.uncertainties;
		}
		if (payload.taskCard !== undefined) {
			patch.taskCard = payload.taskCard;
		}
		if (payload.skillDependencies !== undefined) {
			patch.skillDependencies = payload.skillDependencies.map((entry) => {
				if (typeof entry === "string") {
					return entry;
				}
				return {
					name: asString(entry.name),
					reason: asString(entry.reason),
					required: asBoolean(entry.required) !== false,
				};
			});
		}
		if (payload.procedure !== undefined) {
			patch.procedure = payload.procedure.map((entry) => {
				if (typeof entry === "string") {
					return entry;
				}
				return {
					instruction: asString(entry.instruction) ?? asString(entry.summary),
					kind: asString(entry.kind),
					skillName: asString(entry.skillName),
					notes: asString(entry.notes),
					uncertain: asBoolean(entry.uncertain) === true,
				};
			});
		}
		if (payload.executionPolicy !== undefined) {
			patch.executionPolicy = payload.executionPolicy;
		}
		if (payload.stepRouteOptions !== undefined) {
			patch.stepRouteOptions = payload.stepRouteOptions.map((entry) => ({
				id: asString(entry.id),
				procedureStepId: asString(entry.procedureStepId),
				route: asString(entry.route),
				preference: asString(entry.preference),
				instruction: asString(entry.instruction),
				toolName: asString(entry.toolName),
				skillName: asString(entry.skillName),
				when: asString(entry.when),
				notes: asString(entry.notes),
			}));
		}
		if (payload.replayPreconditions !== undefined) {
			patch.replayPreconditions = payload.replayPreconditions;
		}
		if (payload.resetSignals !== undefined) {
			patch.resetSignals = payload.resetSignals;
		}
		if (payload.steps !== undefined) {
				patch.steps = payload.steps.map((entry, index) => {
					if (typeof entry === "string") {
						return entry;
					}
					const baseStep = draft.steps[index];
				const inputs = entry.inputs && typeof entry.inputs === "object" && !Array.isArray(entry.inputs)
					? entry.inputs as Record<string, unknown>
					: undefined;
					const captureMode = asString(entry.captureMode);
					const groundingMode = asString(entry.groundingMode);
					const uncertain = asBoolean(entry.uncertain);
					const explicitToolArgs = normalizeTaughtTaskToolArguments(entry.toolArgs);
					const implicitToolArgs = extractTaughtTaskToolArgumentsFromRecord(entry, TEACH_STEP_TOOL_ARG_RESERVED_KEYS);
					return {
						route: asString(entry.route) ?? baseStep?.route,
						toolName: asString(entry.toolName) ?? baseStep?.toolName,
					instruction: asString(entry.instruction) ?? asString(entry.summary) ?? baseStep?.instruction,
					summary: asString(entry.summary) ?? baseStep?.summary,
					target: asString(entry.target) ?? baseStep?.target,
					app: asString(entry.app) ?? baseStep?.app,
					scope: asString(entry.scope) ?? baseStep?.scope,
					inputs: inputs
						? Object.fromEntries(
							Object.entries(inputs)
								.map(([key, value]) => [key, asString(value)])
								.filter((pair): pair is [string, string] => Boolean(pair[1])),
						)
						: baseStep?.inputs,
						locationHint: asString(entry.locationHint) ?? baseStep?.locationHint,
						windowTitle: asString(entry.windowTitle) ?? baseStep?.windowTitle,
						toolArgs: explicitToolArgs || implicitToolArgs
							? {
								...implicitToolArgs,
								...explicitToolArgs,
							}
							: baseStep?.toolArgs,
						captureMode: captureMode === "window" || captureMode === "display"
							? captureMode
							: baseStep?.captureMode,
					groundingMode: groundingMode === "single" || groundingMode === "complex"
						? groundingMode
						: baseStep?.groundingMode,
					verificationStatus: asString(entry.verificationStatus) ?? baseStep?.verificationStatus,
					verificationSummary: asString(entry.verificationSummary) ?? baseStep?.verificationSummary,
					uncertain: uncertain === undefined ? baseStep?.uncertain === true : uncertain === true,
				};
			});
		}
		if (Object.keys(patch).length === 0) {
			return draft;
		}
		const updated = await taskDraftHandlers.update({
			sessionId: entry.id,
			draftId: draft.id,
			patch,
			action: "corrected",
			note: note ?? payload.summary,
		});
		await refreshTeachDraftPrompts(entry);
		return updated;
	};

	const applyTeachControlNoisePatch = async (entry: SessionEntry, draft: TaughtTaskDraft) => {
		const noisePatch = buildTeachControlNoisePatch(draft);
		const hasPatch = noisePatch.steps || noisePatch.successCriteria || noisePatch.openQuestions || noisePatch.uncertainties;
		if (!hasPatch) {
			return {
				draft,
				excludedDemoSteps: noisePatch.excludedDemoSteps,
			};
		}
		const updated = await taskDraftHandlers.update({
			sessionId: entry.id,
			draftId: draft.id,
			patch: {
				...(noisePatch.steps ? { steps: noisePatch.steps } : {}),
				...(noisePatch.successCriteria ? { successCriteria: noisePatch.successCriteria } : {}),
				...(noisePatch.openQuestions ? { openQuestions: noisePatch.openQuestions } : {}),
				...(noisePatch.uncertainties ? { uncertainties: noisePatch.uncertainties } : {}),
			},
			action: "corrected",
			note: "Removed demo-only recording control steps from the initial teach draft.",
		});
		return {
			draft: updated,
			excludedDemoSteps: noisePatch.excludedDemoSteps,
		};
	};

	const runTeachClarificationPass = async (params: {
		entry: SessionEntry;
		draft: TaughtTaskDraft;
		userReply?: string;
		state?: TeachClarificationState;
		excludedDemoSteps?: string[];
	}): Promise<{ draft: TaughtTaskDraft; state: TeachClarificationState }> => {
		const prompt = buildTeachClarificationPrompt({
			draft: params.draft,
			userReply: params.userReply,
			state: params.state,
			capabilitySnapshot: resolveTeachCapabilitySnapshot(params.entry.workspaceDir),
		});
		try {
			const result = await runTeachInternalPrompt({
				entry: params.entry,
				kind: "clarify",
				prompt,
			});
			const visibleResponse = await persistInternalTeachPromptRun({
				entry: params.entry,
				userPrompt: prompt,
				result,
			});
			const initialPayload = normalizeTeachClarificationPayload(extractJsonObject(visibleResponse));
			const payload = initialPayload;
			const readyForConfirmation = payload.readyForConfirmation === true;
			const updatedDraft = await updateTeachDraftFromClarification(
				params.entry,
				params.draft,
				readyForConfirmation
					? {
						...payload,
						openQuestions: payload.openQuestions ?? [],
						uncertainties: payload.uncertainties ?? [],
						steps: payload.steps ?? params.draft.steps.map((step) => ({
							route: step.route,
							toolName: step.toolName,
							instruction: step.instruction,
							summary: step.summary,
							target: step.target,
							app: step.app,
							scope: step.scope,
							inputs: step.inputs,
							toolArgs: step.toolArgs,
							locationHint: step.locationHint,
							windowTitle: step.windowTitle,
							captureMode: step.captureMode,
							groundingMode: step.groundingMode,
							verificationSummary: step.verificationSummary,
							uncertain: false,
						})),
					}
					: payload,
				payload.summary ?? (params.userReply ? "Updated teach task card from user clarification." : "Prepared the initial teach task card for clarification."),
			);
			const taskCard = resolveTeachTaskCard({
				draft: updatedDraft,
				payload,
				previous: params.state?.taskCard,
			});
			const blocker = summarizeTeachDraftPublishBlocker(updatedDraft);
			const pendingQuestions = uniqueStrings([
				...updatedDraft.openQuestions,
				...updatedDraft.uncertainties,
			]);
			const status = blocker ? "clarifying" : "ready";
			const nextQuestion = status === "clarifying"
				? resolveTeachClarificationQuestion({
					draft: updatedDraft,
					preferred: payload.nextQuestion,
				}) ?? defaultTeachClarificationQuestion(updatedDraft)
				: undefined;
			return {
				draft: updatedDraft,
				state: {
					draftId: updatedDraft.id,
					status,
					summary: payload.summary
						?? (status === "ready"
							? "Task card looks coherent and is ready for confirmation."
							: pendingQuestions.length > 1
								? `Task card updated. ${pendingQuestions.length} clarification questions remain.`
								: "Task card updated. One clarification question remains."),
					nextQuestion,
					pendingQuestions,
					taskCard,
					excludedDemoSteps: [...(params.excludedDemoSteps ?? params.state?.excludedDemoSteps ?? []), ...(payload.excludedDemoSteps ?? [])],
					updatedAt: Date.now(),
				},
			};
		} catch (error) {
			seedRuntimeMessagesFromHistory(params.entry, params.entry.history);
			const fallbackQuestion = resolveTeachClarificationQuestion({
				draft: params.draft,
				preferred: params.state?.nextQuestion,
			}) ?? defaultTeachClarificationQuestion(params.draft);
			const fallbackPendingQuestions = uniqueStrings([
				...params.draft.openQuestions,
				...params.draft.uncertainties,
			]);
			return {
				draft: params.draft,
				state: {
					draftId: params.draft.id,
					status: "clarifying",
					summary: `Teach clarification model could not refine the task card automatically: ${error instanceof Error ? error.message : String(error)}`,
					nextQuestion: fallbackQuestion ?? params.state?.nextQuestion,
					pendingQuestions: fallbackPendingQuestions,
					taskCard: params.state?.taskCard ?? inferTeachTaskCardFromDraft(params.draft),
					excludedDemoSteps: params.state?.excludedDemoSteps ?? params.excludedDemoSteps ?? [],
					updatedAt: Date.now(),
				},
			};
		}
	};

	const bootstrapTeachClarification = async (entry: SessionEntry, draft: TaughtTaskDraft) => {
		const primed = await applyTeachControlNoisePatch(entry, draft);
		return await runTeachClarificationPass({
			entry,
			draft: primed.draft,
			excludedDemoSteps: primed.excludedDemoSteps,
		});
	};

	const confirmTeachClarification = async (params: {
		entry: SessionEntry;
		userText: string;
		state: TeachClarificationState;
		draft: TaughtTaskDraft;
		validateAfterConfirm: boolean;
	}): Promise<RunTurnResult> => {
		const blocker = summarizeTeachDraftPublishBlocker(params.draft);
		if (blocker) {
			const pendingQuestions = uniqueStrings([
				...params.draft.openQuestions,
				...params.draft.uncertainties,
			]);
			const nextQuestion = resolveTeachClarificationQuestion({
				draft: params.draft,
				preferred: params.state.nextQuestion,
			}) ?? defaultTeachClarificationQuestion(params.draft);
			const nextState: TeachClarificationState = {
				...params.state,
				status: "clarifying",
				summary: blocker,
				nextQuestion,
				pendingQuestions,
				updatedAt: Date.now(),
			};
			writeTeachClarificationState(params.entry, nextState);
			onStateChanged?.();
			const assistantText = await buildTeachClarificationReport({
				headline: `Draft \`${params.draft.id}\` still needs clarification before replay validation can run.`,
				draft: {},
				state: nextState,
				includeDraftSnapshot: false,
				nextSteps: [
					"Reply in plain language to answer the next question or refine the task card.",
					"Run `/teach confirm` once the task card is complete.",
				],
			});
			return buildDirectSessionResponse({
				entry: params.entry,
				userText: params.userText,
				assistantText,
				meta: {
					directCommand: "teach_confirm",
					draft: params.draft,
					teachClarification: nextState,
				},
			});
		}
		if (!params.validateAfterConfirm) {
			writeTeachClarificationState(params.entry, undefined);
			onStateChanged?.();
			const assistantText = await buildTeachReport({
				headline: `Task card confirmed for draft \`${params.draft.id}\`. Replay validation was skipped.`,
				draft: params.draft as unknown as Record<string, unknown>,
				nextSteps: [
					`Publish it with \`/teach publish ${params.draft.id} [skill-name]\` whenever you're ready.`,
					`Run \`/teach validate ${params.draft.id}\` anytime if you want replay validation first.`,
				],
			});
			return buildDirectSessionResponse({
				entry: params.entry,
				userText: params.userText,
				assistantText,
				meta: {
					directCommand: "teach_confirm",
					draft: params.draft,
					validationSkipped: true,
				},
			});
		}
		const validation = await validateTeachDraftForEntry(params.entry, params.draft);
		const updated = await updateTeachDraftValidation(params.entry, params.draft, validation);
		writeTeachClarificationState(params.entry, undefined);
		onStateChanged?.();
		const assistantText = await buildTeachReport({
			headline: validation.state === "validated"
				? `Task card confirmed for draft \`${updated.id}\`, and replay validation passed.`
				: validation.state === "requires_reset"
					? `Task card confirmed for draft \`${updated.id}\`, but replay validation still needs a reset-aware check.`
					: validation.state === "unvalidated"
						? `Task card confirmed for draft \`${updated.id}\`, but it still needs review before replay validation can run.`
						: `Task card confirmed for draft \`${updated.id}\`, but replay validation failed.`,
			draft: updated as unknown as Record<string, unknown>,
			validation,
			nextSteps: validation.state === "validated"
				? [`Publish it with \`/teach publish ${updated.id} [skill-name]\`.`]
				: validation.state === "requires_reset"
					? [`Reset the workspace state, then rerun \`/teach validate ${updated.id}\`.`]
					: validation.state === "unvalidated"
						? ["Keep refining the draft and answer any remaining open questions, then validate again."]
						: [`Inspect the validation output, correct the task card, then rerun \`/teach validate ${updated.id}\`.`],
		});
		return buildDirectSessionResponse({
			entry: params.entry,
			userText: params.userText,
			assistantText,
			meta: {
				directCommand: "teach_confirm",
				draft: updated,
				validation,
			},
		});
	};

	const validateExistingTeachDraft = async (entry: SessionEntry, params?: Record<string, unknown>) => {
		const draftId = asString(params?.draftId);
		if (!draftId) {
			throw new Error("draftId is required");
		}
		const draft = await taskDraftHandlers.get({
			sessionId: entry.id,
			draftId,
		});
		if (!draft) {
			throw new Error(`Teach draft not found: ${draftId}`);
		}
		const validation = await validateTeachDraftForEntry(entry, draft);
		const updated = await updateTeachDraftValidation(entry, draft, validation);
		return {
			sessionId: entry.id,
			draft: updated,
			validation,
		};
	};

	const publishExistingTeachDraft = async (entry: SessionEntry, params?: Record<string, unknown>) => {
		const draftId = asString(params?.draftId);
		if (!draftId) {
			throw new Error("draftId is required");
		}
		const published = await taskDraftHandlers.publish({
			sessionId: entry.id,
			draftId,
			name: asString(params?.name),
			runId: asString(params?.runId),
		});
		await refreshTeachDraftPrompts(entry);
		const promptRefreshError = await refreshPublishedSkillPrompts(entry, published);
		return {
			...published,
			...(promptRefreshError ? { promptRefreshError } : {}),
		};
	};

	const stopTeachRecording = async (entry: SessionEntry, params?: Record<string, unknown>) => {
		if (!entry.workspaceDir) {
			throw new Error(`Session ${entry.id} is not bound to a workspace`);
		}
		const active = activeTeachRecordings.get(entry.id);
		if (!active) {
			throw new Error(`No active teach recording for session ${entry.id}`);
		}
		activeTeachRecordings.delete(entry.id);
		let recording: Awaited<ReturnType<GuiDemonstrationRecordingSession["stop"]>>;
		try {
			recording = await active.stop();
		} finally {
			onStateChanged?.();
		}
		if (asBoolean(params?.analyze) === false) {
			return {
				sessionId: entry.id,
				recording,
			};
		}
		try {
			const result = await taskDraftHandlers.createFromVideo({
				...params,
				sessionId: entry.id,
				videoPath: recording.videoPath,
				eventLogPath: recording.eventLogPath,
				videoName: basename(recording.videoPath),
				publish: false,
			});
			const shouldValidate = asBoolean(params?.validate) !== false;
			const shouldPublish = asBoolean(params?.publish) !== false;
			let draft = result.draft;
			await refreshTeachDraftPrompts(entry);
			let validation: TeachDraftValidationResult | undefined;
			if (shouldValidate) {
				validation = await validateTeachDraftForEntry(entry, draft);
				draft = await updateTeachDraftValidation(entry, draft, validation);
			}
			if (shouldPublish && validation?.state === "validated") {
				const published = await publishExistingTeachDraft(entry, {
					draftId: draft.id,
					name: asString(params?.name),
				});
				draft = published.draft;
			}
			return {
				sessionId: entry.id,
				recording,
				draft,
				...(validation ? { validation } : {}),
			};
		} catch (error) {
			return {
				sessionId: entry.id,
				recording,
				analysisError: error instanceof Error ? error.message : String(error),
			};
		}
	};

	const stopTeachRecordingFromCommand = async (entry: SessionEntry, params?: Record<string, unknown>) => {
		const result = await stopTeachRecording(entry, {
			...params,
			publish: false,
			validate: false,
		});
		const stopResult = result as Record<string, unknown>;
		const analysisError = asString(stopResult.analysisError);
		let draftRecord = asRecord(stopResult.draft);
		let clarificationState: TeachClarificationState | undefined;
		if (!analysisError && draftRecord?.id) {
			const draft = await taskDraftHandlers.get({
				sessionId: entry.id,
				draftId: asString(draftRecord.id),
			});
			if (draft) {
				const clarified = await bootstrapTeachClarification(entry, draft);
				writeTeachClarificationState(entry, clarified.state);
				onStateChanged?.();
				draftRecord = clarified.draft as unknown as Record<string, unknown>;
				clarificationState = clarified.state;
			}
		}
		return {
			sessionId: entry.id,
			recording: stopResult.recording,
			...(draftRecord ? { draft: draftRecord } : {}),
			...(clarificationState ? { teachClarification: clarificationState } : {}),
			...(stopResult.analysisError ? { analysisError: stopResult.analysisError } : {}),
		};
	};

	const handleTeachClarificationTurn = async (entry: SessionEntry, userText: string): Promise<RunTurnResult | undefined> => {
		const state = readTeachClarificationState(entry);
		if (!state) {
			return undefined;
		}
		if (activeTeachClarificationSessions.has(entry.id)) {
			return buildEphemeralSessionResponse({
				entry,
				assistantText: "Teach clarification is still processing. Wait for the current reply before sending another refinement.",
				meta: {
					directCommand: "teach_clarify",
					status: "busy",
					teachClarification: state,
				},
			});
		}
		activeTeachClarificationSessions.add(entry.id);
		try {
			const draft = await taskDraftHandlers.get({
				sessionId: entry.id,
				draftId: state.draftId,
			});
			if (!draft) {
				writeTeachClarificationState(entry, undefined);
				onStateChanged?.();
				return buildDirectSessionResponse({
					entry,
					userText,
					assistantText: "The active teach clarification draft could not be found, so clarification mode was cleared.",
					meta: {
						directCommand: "teach_clarify",
						status: "error",
					},
				});
			}

			const clarified = await runTeachClarificationPass({
				entry,
				draft,
				userReply: userText,
				state,
			});
			writeTeachClarificationState(entry, clarified.state);
			onStateChanged?.();
			const assistantText = await buildTeachClarificationReport({
				headline: `Updated teach task card for draft \`${clarified.draft.id}\`.`,
				draft: clarified.draft as unknown as Record<string, unknown>,
				state: clarified.state,
				nextSteps: clarified.state.status === "ready"
					? [
						"Run `/teach confirm` to lock the task card without replay validation.",
						`Run \`/teach confirm --validate\` or \`/teach validate ${clarified.draft.id}\` when you want replay validation.`,
					]
					: [
						"Reply in plain language to refine the task card.",
						"Run `/teach confirm` once the task card looks right.",
					],
			});
			return buildDirectSessionResponse({
				entry,
				userText,
				assistantText,
				meta: {
					directCommand: "teach_clarify",
					draft: clarified.draft,
					teachClarification: clarified.state,
				},
			});
		} finally {
			activeTeachClarificationSessions.delete(entry.id);
		}
	};

	const buildTeachHelpReport = async (entry: SessionEntry, trailing?: string): Promise<string> => {
		const lines: string[] = ["Teach status:"];
		const recording = activeTeachRecordings.get(entry.id);
		const clarification = readTeachClarificationState(entry);
		const clarificationDraft = clarification
			? await taskDraftHandlers.get({
				sessionId: entry.id,
				draftId: clarification.draftId,
			}).catch(() => null)
			: null;
		const draftValidation = asRecord(clarificationDraft?.validation);
		lines.push(`- Workspace: ${entry.workspaceDir ?? "not bound"}`);
		lines.push(`- Recording: ${recording ? "active" : "idle"}`);
		if (clarification) {
			lines.push(`- Clarification: ${clarification.status} for draft \`${clarification.draftId}\``);
			if (clarification.summary) {
				lines.push(`- Task summary: ${clarification.summary}`);
			}
			if (clarification.pendingQuestions && clarification.pendingQuestions.length > 0) {
				lines.push("- Pending questions:");
				lines.push(...summarizeTeachList(clarification.pendingQuestions, "- ", 5));
			} else if (clarification.nextQuestion) {
				lines.push(`- Next question: ${clarification.nextQuestion}`);
			}
			if (draftValidation?.state) {
				lines.push(`- Validation: ${String(draftValidation.state)}`);
			}
		} else {
			lines.push("- Clarification: inactive");
		}
		if (trimToUndefined(trailing)) {
			lines.push(`- Note: \`${trailing}\` is not a teach subcommand. Use one of the commands below.`);
		}
		lines.push("");
		lines.push("Available commands:");
		lines.push("- `/teach start` to begin recording a demonstration.");
		lines.push("- `/teach stop [objective]` to stop recording and open clarification.");
		lines.push("- Reply in plain language while clarification is active to refine the task card.");
		lines.push("- `/teach confirm [--validate]` to lock the task card. Add `--validate` to trigger replay validation immediately.");
		lines.push("- `/teach validate <draftId>` to rerun validation.");
		lines.push("- `/teach publish <draftId> [skill-name]` to publish a reusable skill.");
		lines.push("");
		if (recording) {
			lines.push("Next step: finish the demo, then run `/teach stop [objective]`.");
		} else if (clarification?.status === "ready") {
			lines.push(`Next step: run \`/teach confirm\` to lock the task card, then publish with \`/teach publish ${clarification.draftId} [skill-name]\`. Optional: use \`/teach confirm --validate\` or \`/teach validate ${clarification.draftId}\` first.`);
		} else if (clarification) {
			lines.push("Next step: answer the pending clarification in plain language.");
		} else {
			lines.push("Next step: run `/teach start` when you are ready to demonstrate the task.");
		}
		return lines.join("\n");
	};

	const runTeachSlashCommand = async (params: {
		entry: SessionEntry;
		command: TeachSlashCommand;
		rawText: string;
	}): Promise<RunTurnResult> => {
		sessionEntries.set(params.entry.id, params.entry);
		if (!params.entry.workspaceDir) {
			return buildDirectSessionResponse({
				entry: params.entry,
				userText: params.rawText,
				assistantText: "Teach recording requires a workspace-bound session because learned drafts and skills are stored per workspace.",
				meta: {
					directCommand: "teach",
					status: "error",
				},
			});
		}
		if (params.command.action === "help") {
			return buildDirectSessionResponse({
				entry: params.entry,
				userText: params.rawText,
				assistantText: await buildTeachHelpReport(params.entry, params.command.trailing),
				meta: {
					directCommand: "teach_help",
					...(readTeachClarificationState(params.entry)
						? { teachClarification: readTeachClarificationState(params.entry) }
						: {}),
					...(activeTeachRecordings.has(params.entry.id) ? { recordingActive: true } : {}),
				},
			});
		}
		if (params.command.action === "start") {
			const result = await startTeachRecordingFromCommand(params.entry, {});
			const state = asRecord(result.recording);
			const assistantText = await buildTeachReport({
				headline: result.alreadyActive
					? "Teach recording is already running for this session."
					: "Started teach recording for this workspace session.",
				recording: state,
				nextSteps: [
					"Demonstrate the full task, then run `/teach stop [objective]` when you are done.",
					"`/teach stop` now saves the draft and enters a clarification dialogue so you can shape the real task before validation and publish.",
				],
			});
			return buildDirectSessionResponse({
				entry: params.entry,
				userText: params.rawText,
				assistantText,
				meta: {
					directCommand: "teach_start",
					recording: result.recording,
				},
			});
		}
		if (params.command.action === "confirm") {
			const state = readTeachClarificationState(params.entry);
			if (!state) {
				return buildDirectSessionResponse({
					entry: params.entry,
					userText: params.rawText,
					assistantText: "No active teach clarification is open. Use `/teach stop` after a recording, or `/teach validate <draftId>` for an existing draft.",
					meta: {
						directCommand: "teach_confirm",
						status: "error",
					},
				});
			}
			if (activeTeachClarificationSessions.has(params.entry.id)) {
				return buildEphemeralSessionResponse({
					entry: params.entry,
					assistantText: "Teach clarification is still processing. Wait for the current reply before confirming the task card.",
					meta: {
						directCommand: "teach_confirm",
						status: "busy",
						teachClarification: state,
					},
				});
			}
			const draft = await taskDraftHandlers.get({
				sessionId: params.entry.id,
				draftId: state.draftId,
			});
			if (!draft) {
				writeTeachClarificationState(params.entry, undefined);
				onStateChanged?.();
				return buildDirectSessionResponse({
					entry: params.entry,
					userText: params.rawText,
					assistantText: "The active teach clarification draft could not be found, so clarification mode was cleared.",
					meta: {
						directCommand: "teach_confirm",
						status: "error",
					},
				});
			}
			return await confirmTeachClarification({
				entry: params.entry,
				userText: params.rawText,
				state,
				draft,
				validateAfterConfirm: resolveTeachConfirmValidationMode(params.command.trailing) === "validate",
			});
		}
		if (params.command.action === "validate") {
			const target = parseTeachDraftTarget(params.command.trailing);
			if (!target.draftId) {
				return buildDirectSessionResponse({
					entry: params.entry,
					userText: params.rawText,
					assistantText: "Teach validation requires a draft id. Use `/teach validate <draftId>`.",
					meta: {
						directCommand: "teach_validate",
						status: "error",
					},
				});
			}
			try {
				const result = await validateExistingTeachDraft(params.entry, { draftId: target.draftId });
				clearTeachClarificationForDraft(params.entry, target.draftId);
				const validation = result.validation;
				const assistantText = await buildTeachReport({
					headline: validation.state === "validated"
						? `Replay validation passed for draft \`${target.draftId}\`.`
						: validation.state === "requires_reset"
							? `Draft \`${target.draftId}\` still needs environment reset before replay validation can confirm it.`
							: validation.state === "unvalidated"
								? `Draft \`${target.draftId}\` still needs review before replay validation can run.`
							: `Replay validation failed for draft \`${target.draftId}\`.`,
					draft: asRecord(result.draft),
					validation: validation,
					nextSteps: validation.state === "validated"
						? [`Publish it with \`/teach publish ${target.draftId} [skill-name]\`.`]
						: validation.state === "requires_reset"
							? [`Reset or restore the workspace state, then rerun \`/teach validate ${target.draftId}\`.`]
							: validation.state === "unvalidated"
								? [`Resolve the draft's open questions or uncertain steps, then rerun \`/teach validate ${target.draftId}\`.`]
								: [`Inspect the validation output, correct the draft or workspace state, then rerun \`/teach validate ${target.draftId}\`.`],
				});
				return buildDirectSessionResponse({
					entry: params.entry,
					userText: params.rawText,
					assistantText,
					meta: {
						directCommand: "teach_validate",
						draft: result.draft,
						validation,
					},
				});
			} catch (error) {
				return buildDirectSessionResponse({
					entry: params.entry,
					userText: params.rawText,
					assistantText: `Could not validate teach draft \`${target.draftId}\`: ${error instanceof Error ? error.message : String(error)}`,
					meta: {
						directCommand: "teach_validate",
						status: "error",
					},
				});
			}
		}
		if (params.command.action === "publish") {
			const target = parseTeachDraftTarget(params.command.trailing);
			if (!target.draftId) {
				return buildDirectSessionResponse({
					entry: params.entry,
					userText: params.rawText,
					assistantText: "Teach publish requires a draft id. Use `/teach publish <draftId> [skill-name]`.",
					meta: {
						directCommand: "teach_publish",
						status: "error",
					},
				});
			}
			try {
				const published = await publishExistingTeachDraft(params.entry, {
					draftId: target.draftId,
					name: target.name,
				});
				clearTeachClarificationForDraft(params.entry, target.draftId);
				const assistantText = await buildTeachReport({
					headline: `Published workspace skill \`${published.skill.name}\` from teach draft \`${target.draftId}\`.`,
					draft: asRecord(published.draft),
					skill: asRecord(published.skill),
					nextSteps: [
						typeof (published as { promptRefreshError?: unknown }).promptRefreshError === "string"
							? "The skill was published, but live workspace sessions may still need a manual refresh."
							: "The skill was hot-refreshed into live workspace sessions for this workspace.",
						"Review the generated `SKILL.md` preview and refine the draft if the procedure still needs edits.",
						...(typeof (published as { promptRefreshError?: unknown }).promptRefreshError === "string"
							? [`Prompt hot-refresh warning: ${(published as { promptRefreshError: string }).promptRefreshError}`]
							: []),
					],
				});
				return buildDirectSessionResponse({
					entry: params.entry,
					userText: params.rawText,
					assistantText,
					meta: {
						directCommand: "teach_publish",
						draft: published.draft,
						skill: published.skill,
						...(typeof (published as { promptRefreshError?: unknown }).promptRefreshError === "string"
							? { promptRefreshError: (published as { promptRefreshError: string }).promptRefreshError }
							: {}),
					},
				});
			} catch (error) {
				return buildDirectSessionResponse({
					entry: params.entry,
					userText: params.rawText,
					assistantText: `Could not publish teach draft \`${target.draftId}\`: ${error instanceof Error ? error.message : String(error)}`,
					meta: {
						directCommand: "teach_publish",
						status: "error",
					},
				});
			}
		}

		const stopResult = await stopTeachRecordingFromCommand(params.entry, {
			objective: params.command.trailing,
		});
		const analysisError = asString(stopResult.analysisError);
		const recording = asRecord(stopResult.recording);
		const draft = asRecord(stopResult.draft);
		const clarificationState = readTeachClarificationState(params.entry);
		const sourceLabel = asString(draft?.sourceLabel) ?? asString(recording?.videoPath) ?? "the recording";
		const draftId = asString(draft?.id);
		const assistantText = analysisError || !draft || !clarificationState
			? await buildTeachReport({
				headline: analysisError
					? `Stopped teach recording for ${sourceLabel}, but analysis failed.`
					: `Stopped teach recording for ${sourceLabel}. Saved draft \`${draftId ?? "unknown"}\`.`,
				recording,
				draft,
				analysisError,
				nextSteps: analysisError
					? ["Inspect the saved video and event log, then retry the teach flow once the analysis issue is fixed."]
					: [
						"Reply in plain language to shape the real task from this draft.",
						`Run \`/teach validate ${draftId ?? "draft-id"}\` once the task card is complete.`,
					],
			})
			: await buildTeachClarificationReport({
				headline: `Stopped teach recording for ${sourceLabel}. Saved draft \`${draftId ?? "unknown"}\` and entered teach clarification mode so we can shape the reusable task before validation.`,
				recording,
				draft,
				state: clarificationState,
				nextSteps: clarificationState.status === "ready"
					? [
						"Run `/teach confirm` to lock the task card without replay validation.",
						`Run \`/teach confirm --validate\` or \`/teach validate ${draftId ?? "draft-id"}\` when you want replay validation.`,
					]
					: [
						"Reply in plain language to refine the task card.",
						"Run `/teach confirm` once the task card looks right.",
					],
			});
		return buildDirectSessionResponse({
			entry: params.entry,
			userText: params.rawText,
			assistantText,
			meta: {
				directCommand: "teach_stop",
				recording: stopResult.recording,
				...(draft ? { draft } : {}),
				...(clarificationState ? { teachClarification: clarificationState } : {}),
				...(stopResult.analysisError ? { analysisError: stopResult.analysisError } : {}),
			},
		});
	};

	const finalizePromptRun = async (params: {
		entry: SessionEntry;
		effectiveText: string;
		channelId?: string;
		promptOptions?: Record<string, unknown>;
		runPromise: Promise<{ response: string; runId: string; images?: ImageContent[]; meta?: Record<string, unknown> }>;
		}): Promise<RunTurnResult> => {
			const promptResult = await params.runPromise;
			const assistantImages =
				promptResult.images ??
				extractRenderableAssistantImages(promptResult) ??
				extractRenderableAssistantImages(promptResult.meta);
			const assistantResult = normalizeAssistantDisplayText(normalizeAssistantRenderableText(
				promptResult.response,
				{ images: assistantImages },
			));
			const visibleResponse = assistantResult.text;
			if (!assistantResult.silent) {
				appendHistory(
					params.entry,
					"assistant",
					visibleResponse,
					undefined,
					assistantImages?.length ? { images: assistantImages } : undefined,
				);
			}
			const runTrace = storeSessionRunTrace(params.entry, {
				runId: promptResult.runId,
				userPrompt: params.effectiveText,
			response: visibleResponse,
			meta: promptResult.meta,
		});
		if (persistSessionRunTrace) {
			await persistSessionRunTrace({
				sessionId: params.entry.id,
				trace: runTrace,
			});
		}
		const completedAt = Date.now();
		if (params.entry.subagentMeta) {
			params.entry.subagentMeta = markSubagentRunCompleted(params.entry.subagentMeta, {
				runId: promptResult.runId,
				response: visibleResponse,
				recordedAt: completedAt,
				});
			}
			params.entry.lastActiveAt = completedAt;
			if (!assistantResult.silent) {
				params.entry.messageCount += 1;
			}
			usageTracker.record({
			inputTokens: estimateTokens(params.effectiveText),
			outputTokens: estimateTokens(visibleResponse),
			model: config.defaultModel,
			provider: config.defaultProvider,
			timestamp: completedAt,
			sessionId: params.entry.id,
			channelId: params.channelId,
		});
		onStateChanged?.();
		if (params.entry.workspaceDir) {
			await runSerializedWorkflowLedgerMutation(params.entry.workspaceDir, async () =>
				await appendPersistedWorkflowCrystallizationTurnFromRun({
					workspaceDir: params.entry.workspaceDir!,
					repoRoot: params.entry.repoRoot,
					learningDir: runtimeLearningDir,
					sessionId: params.entry.id,
					traceId: params.entry.traceId,
					runId: promptResult.runId,
					promptPreview: params.effectiveText,
					responsePreview: visibleResponse,
					toolTrace: Array.isArray(runTrace.toolTrace) ? runTrace.toolTrace : [],
					teachValidation: runTrace.teachValidation,
					timestamp: completedAt,
				})).catch(() => undefined);
			runWorkflowCrystallizationAnalysis(params.entry);
		}
		return {
			response: visibleResponse,
			runId: promptResult.runId,
			sessionId: params.entry.id,
			status: "ok",
			...(assistantImages?.length ? { images: assistantImages } : {}),
			...(promptResult.meta ? { meta: promptResult.meta } : {}),
		};
	};

	const dispatchPromptTurn = async (params: {
		entry: SessionEntry;
		userText: string;
		effectiveText: string;
		channelId?: string;
		waitForCompletion: boolean;
		promptOptions?: Record<string, unknown>;
		historyMedia?: {
			images?: ImageContent[];
			attachments?: Attachment[];
		};
	}): Promise<RunTurnResult> => {
		const runId = randomUUID();
		const completion = runSerializedSessionTurn(params.entry, async () => {
			appendHistory(params.entry, "user", params.userText, undefined, params.historyMedia);
			onStateChanged?.();
			if (params.entry.subagentMeta) {
				params.entry.subagentMeta = markSubagentRunStarted(params.entry.subagentMeta, runId);
				touchSession(params.entry, params.entry.subagentMeta.updatedAt);
				onStateChanged?.();
			}
			const runPromise = promptSession(
				params.entry,
				params.effectiveText,
				runId,
				params.promptOptions,
			);
			// Background runs can fail before the outer completion chain awaits the
			// prompt promise. Observe the rejection immediately so quick auth/config
			// failures are reported through runRegistry instead of crashing the process
			// as an unhandled rejection.
			void runPromise.catch(() => {});
			try {
				return await finalizePromptRun({
					entry: params.entry,
					effectiveText: params.effectiveText,
					channelId: params.channelId,
					promptOptions: params.promptOptions,
					runPromise,
				});
			} catch (error) {
				if (params.entry.subagentMeta) {
					params.entry.subagentMeta = markSubagentRunFailed(params.entry.subagentMeta, {
						runId,
						error: error instanceof Error ? error.message : String(error),
					});
					touchSession(params.entry, params.entry.subagentMeta.updatedAt);
					onStateChanged?.();
				}
				throw error;
			}
		});
		if (params.waitForCompletion) {
			return await completion;
		}
		void completion.catch(() => {});
		return {
			response: "",
			runId,
			sessionId: params.entry.id,
			status: "in_flight",
		};
	};

	const requireSessionEntry = (source?: Record<string, unknown>): SessionEntry => {
		const sessionId = asString(source?.sessionId);
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const entry = sessionEntries.get(sessionId);
		if (!entry) {
			throw new Error(`Session not found: ${sessionId}`);
		}
		return entry;
	};

	const requireSubagentEntry = (parentSessionId: string, target?: string): SessionEntry => {
		const entry = resolveSubagentEntry(sessionEntries.values(), parentSessionId, target);
		if (!entry) {
			throw new Error(target
				? `Subagent not found: ${target}`
				: `Subagent target is required for parent session ${parentSessionId}`);
		}
		return entry;
	};

	const maybeCleanupSubagentEntry = (entry: SessionEntry): boolean => {
		if (!entry.subagentMeta) {
			return false;
		}
		if (entry.subagentMeta.mode !== "run" || entry.subagentMeta.cleanup !== "delete") {
			return false;
		}
		const deleted = sessionEntries.delete(entry.id);
		inFlightSessionIds.delete(entry.id);
		if (deleted) {
			onStateChanged?.();
		}
		return deleted;
	};

	const prepareSubagentSession = async (params: SpawnSubagentParams): Promise<{
				parent: SessionEntry;
				child: SessionEntry;
				created: boolean;
				notes: string[];
				attachments?: Attachment[];
			}> => {
			const parent = requireSessionEntry({ sessionId: params.parentSessionId });
			const notes: string[] = [];
			const resolvedAgent = params.agentId
				? resolveAgentTarget?.(params.agentId) ?? null
				: null;
			const plan = resolveSubagentSpawnPlan({
				request: {
					runtime: asString(params.runtime),
					mode: asString(params.mode),
					cleanup: asString(params.cleanup),
					thread: params.thread === true,
					model: asString(params.model),
					thinking: asString(params.thinking),
					cwd: asString(params.cwd),
					sandbox: asString(params.sandbox),
					agentId: asString(params.agentId),
				},
				agentTarget: resolvedAgent,
			});

			const existingChildId = asString(params.sessionId);
			if (existingChildId) {
				const hasReuseOverrides = Boolean(
					asString(params.agentId) ||
					asString(params.model) ||
					asString(params.thinking) ||
					asString(params.cwd) ||
					asString(params.runtime) ||
					asString(params.mode) ||
					asString(params.cleanup) ||
					asString(params.sandbox) ||
					params.thread === true,
				);
				if (hasReuseOverrides) {
					throw new Error(
						"Reusing an existing child session does not support runtime, workspace, profile, or sandbox overrides. Omit `sessionId` to create a fresh child.",
					);
				}
				const existing = requireSubagentEntry(parent.id, existingChildId);
				if (existing.subagentMeta) {
					existing.subagentMeta = {
						...existing.subagentMeta,
						label: asString(params.label) ?? existing.subagentMeta.label,
						runtime: plan.runtime,
						updatedAt: Date.now(),
					};
					touchSession(existing, existing.subagentMeta.updatedAt);
				}
				onStateChanged?.();
					return {
						parent,
						child: existing,
						created: false,
						notes,
						attachments: Array.isArray(params.attachments) ? params.attachments : undefined,
					};
				}
			if (resolvedAgent) {
				notes.push(`Using agent profile "${resolvedAgent.agentId}" for child workspace/model defaults.`);
			}

			const inheritContext = plan.threadRequested || plan.mode === "session";
			const forkPoint = inheritContext ? parent.history.length : 0;
			const forkHistory = inheritContext
				? cloneValue(parent.history.slice(0, forkPoint))
				: [];
			const child = await createScopedSession({
				sessionKey: buildSubagentSessionId(parent.id),
				parentId: parent.id,
				forkPoint,
				channelId: parent.channelId,
				senderId: parent.senderId,
				senderName: parent.senderName,
				conversationType: parent.conversationType,
				threadId: parent.threadId,
				workspaceDir: plan.workspaceDir ?? parent.workspaceDir,
				explicitWorkspace: Boolean(plan.workspaceDir),
				configOverride: mergeUnderstudyConfigOverride(parent.configOverride, plan.configOverride),
				sandboxInfo: parent.sandboxInfo,
				executionScopeKey: parent.executionScopeKey,
			});
			child.subagentMeta = createSubagentSessionMeta({
				parentSessionId: parent.id,
				label: asString(params.label),
				runtime: plan.runtime,
				mode: plan.mode,
				cleanup: plan.cleanup,
				thread: plan.threadRequested,
			});
			if (forkHistory.length > 0) {
				child.history = forkHistory;
				child.messageCount = forkHistory.filter((entry) => entry.role === "assistant").length;
				copyRuntimeMessagesForBranch(parent, child, forkHistory);
			}
			touchSession(child, child.subagentMeta.updatedAt);
			sessionEntries.set(child.id, child);
			onStateChanged?.();
				return {
					parent,
					child,
					created: true,
					notes,
					attachments: Array.isArray(params.attachments) ? params.attachments : undefined,
				};
			};

		const chatHandler: ChatHandler = async (text, context) => {
		const runtimeContext = (context ?? {}) as typeof context & RuntimeSessionContextExtras;
		const requestedWorkspaceDir = asString(context?.cwd);
		let scopedSession = await getOrCreateSession({
			channelId: context?.channelId,
			senderId: context?.senderId,
			senderName: context?.senderName,
			conversationName: context?.conversationName,
			conversationType: context?.conversationType as "direct" | "group" | "thread" | undefined,
			threadId: context?.threadId,
			workspaceDir: requestedWorkspaceDir,
			explicitWorkspace: Boolean(requestedWorkspaceDir),
			configOverride: runtimeContext.configOverride,
			sandboxInfo: runtimeContext.sandboxInfo,
			executionScopeKey: runtimeContext.executionScopeKey,
		});
		const reset = parseResetCommand(text);
		let effectiveText = text;
		if (reset) {
			scopedSession = reset.command === "new"
				? await getOrCreateSession({
					channelId: context?.channelId,
					senderId: context?.senderId,
					senderName: context?.senderName,
					conversationName: context?.conversationName,
					conversationType: context?.conversationType as "direct" | "group" | "thread" | undefined,
					threadId: context?.threadId,
					forceNew: true,
					workspaceDir: requestedWorkspaceDir,
					explicitWorkspace: Boolean(requestedWorkspaceDir),
					configOverride: runtimeContext.configOverride,
					sandboxInfo: runtimeContext.sandboxInfo,
					executionScopeKey: runtimeContext.executionScopeKey,
				})
				: await recreateSessionEntry(scopedSession);
			effectiveText = resolveResetPrompt(reset, config.agent.userTimezone);
		}
		const teach = parseTeachCommand(effectiveText);
		if (teach) {
			return await runTeachSlashCommand({
				entry: scopedSession,
				command: teach,
				rawText: effectiveText,
			});
		}
		const teachClarification = await handleTeachClarificationTurn(scopedSession, effectiveText);
		if (teachClarification) {
			return teachClarification;
		}
		const historyUserText = effectiveText;
		const skipTimestampInjection = Boolean(reset && !reset.trailing);
		if (!skipTimestampInjection) {
			effectiveText = injectTimestamp(effectiveText, timestampOptsFromConfig(config));
		}
		const promptInput = await buildPromptInputFromMedia({
			text: effectiveText,
			images: runtimeContext.images,
			attachments: runtimeContext.attachments,
		});
		const historyMedia = resolveHistoryMedia({
			promptOptions: promptInput.promptOptions,
			images: runtimeContext.images,
			attachments: runtimeContext.attachments,
		});
		return await dispatchPromptTurn({
			entry: scopedSession,
			userText: historyUserText,
			effectiveText: promptInput.text,
			channelId: context?.channelId,
			waitForCompletion: resolveWaitForCompletion(context?.waitForCompletion),
			promptOptions: promptInput.promptOptions,
			historyMedia,
		});
	};

	const sessionHandlers: SessionHandlers = {
		list: async (params) => {
			const channelFilter = asString(params?.channelId);
			const senderFilter = asString(params?.senderId);
			const limit = Math.max(1, asNumber(params?.limit) ?? Number.MAX_SAFE_INTEGER);
			const live = Array.from(sessionEntries.values())
				.filter((entry) => (channelFilter ? entry.channelId === channelFilter : true))
				.filter((entry) => (senderFilter ? entry.senderId === senderFilter : true))
				.map((entry) => buildSessionSummary(entry));
			if (!listPersistedSessions) {
				return live.slice(0, limit);
			}
			const includePersisted = params?.includePersisted === true || live.length === 0;
			if (!includePersisted) {
				return live.slice(0, limit);
			}
			const merged = new Map<string, SessionSummary>();
			for (const entry of live) {
				merged.set(entry.id, entry);
			}
			for (const entry of await listPersistedSessions({
				channelId: channelFilter,
				senderId: senderFilter,
				limit,
			})) {
				if (!merged.has(entry.id)) {
					merged.set(entry.id, entry);
				}
			}
			return Array.from(merged.values()).slice(0, limit);
		},
		get: async (params) => {
			const sessionId = asString(params?.sessionId);
			if (!sessionId) {
				throw new Error("sessionId is required");
			}
			const entry = sessionEntries.get(sessionId);
			if (!entry) {
				const persisted = await readPersistedSession?.({ sessionId });
				return persisted ? { ...persisted, source: "persisted" } : null;
			}
			return buildSessionSummary(entry);
		},
		history: async (params) => {
			const sessionId = asString(params?.sessionId);
			if (!sessionId) {
				throw new Error("sessionId is required");
			}
			const limit = Math.max(1, asNumber(params?.limit) ?? 50);
			const entry = sessionEntries.get(sessionId);
			const liveRuns = Array.isArray(entry?.recentRuns) ? entry.recentRuns.slice(0, limit) : [];
			let effectiveRuns = liveRuns;
			if (readPersistedTrace && (!entry || liveRuns.length < limit)) {
				try {
					const persistedRuns = await readPersistedTrace({ sessionId, limit });
					if (persistedRuns.length > liveRuns.length || (!entry && persistedRuns.length > 0)) {
						effectiveRuns = persistedRuns;
					}
				} catch {
					effectiveRuns = liveRuns;
				}
			}
			if (!entry && readTranscriptHistory) {
				const messages = await readTranscriptHistory({ sessionId, limit });
				const sanitizedMessages = messages.map((message) => sanitizeAssistantHistoryEntry(message));
				return {
					sessionId,
					messages: sanitizedMessages,
					timeline: buildHistoryTimeline(sanitizedMessages, effectiveRuns),
					source: "transcript",
				};
			}
			if (!entry) {
				return { sessionId, messages: [], timeline: [] };
			}
			if (readTranscriptHistory && entry.history.length < limit) {
				const messages = await readTranscriptHistory({ sessionId, limit });
				if (messages.length > entry.history.length) {
					const sanitizedMessages = messages.map((message) => sanitizeAssistantHistoryEntry(message));
					return {
						sessionId,
						messages: sanitizedMessages,
						timeline: buildHistoryTimeline(sanitizedMessages, effectiveRuns),
						source: "transcript",
					};
				}
			}
			const sanitizedMessages = entry.history.slice(-limit).map((message) => sanitizeAssistantHistoryEntry(message));
			return {
				sessionId,
				messages: sanitizedMessages,
				timeline: buildHistoryTimeline(sanitizedMessages, effectiveRuns),
			};
		},
		trace: async (params) => {
			const sessionId = asString(params?.sessionId);
			if (!sessionId) {
				throw new Error("sessionId is required");
			}
			const limit = Math.max(1, asNumber(params?.limit) ?? MAX_RECENT_SESSION_RUNS);
			const entry = sessionEntries.get(sessionId);
			const liveRuns = Array.isArray(entry?.recentRuns) ? entry.recentRuns.slice(0, limit) : [];
			let activeRun: Record<string, unknown> | undefined;
			if (entry && waitForRun) {
				try {
					const snapshot = asRecord(await waitForRun({
						sessionId,
						timeoutMs: 0,
					}));
					if (asRecord(snapshot?.progress)) {
						activeRun = normalizeActiveRunSnapshot(snapshot);
					}
				} catch {
					activeRun = undefined;
				}
			}
			if (readPersistedTrace && (!entry || liveRuns.length < limit)) {
				const persistedRuns = await readPersistedTrace({ sessionId, limit });
				if (persistedRuns.length > liveRuns.length || (!entry && persistedRuns.length > 0)) {
					return {
						sessionId,
						runs: persistedRuns.map((run) => normalizeSessionRunTrace(run)),
						...(activeRun ? { activeRun } : {}),
						source: "persisted",
					};
				}
			}
			return {
				sessionId,
				runs: liveRuns.map((run) => normalizeSessionRunTrace(run)),
				...(activeRun ? { activeRun } : {}),
			};
		},
			teachList: async (params?: Record<string, unknown>) => await taskDraftHandlers.list(params),
			teachCreate: async (params?: Record<string, unknown>) => (await taskDraftHandlers.create(params)).draft,
			teachRecordStart: async (params?: Record<string, unknown>) => {
				const entry = requireSessionEntry(params);
				return await startTeachRecordingFromCommand(entry, params);
			},
			teachRecordStatus: async (params?: Record<string, unknown>) => {
				const entry = requireSessionEntry(params);
				return {
					sessionId: entry.id,
					recording: activeTeachRecordings.get(entry.id)?.status() ?? null,
				};
			},
			teachRecordStop: async (params?: Record<string, unknown>) => {
				const entry = requireSessionEntry(params);
				return await stopTeachRecordingFromCommand(entry, params);
			},
			teachVideo: async (params?: Record<string, unknown>) => (await taskDraftHandlers.createFromVideo(params)).draft,
			teachUpdate: async (params?: Record<string, unknown>) => await taskDraftHandlers.update(params),
			teachValidate: async (params?: Record<string, unknown>) => {
				const entry = requireSessionEntry(params);
				const result = await validateExistingTeachDraft(entry, params);
				clearTeachClarificationForDraft(entry, asString(result.draft?.id) ?? asString(params?.draftId));
				return result;
			},
			teachPublish: async (params?: Record<string, unknown>) => {
				const entry = requireSessionEntry(params);
				const result = await publishExistingTeachDraft(entry, params);
				clearTeachClarificationForDraft(entry, asString(result.draft?.id) ?? asString(params?.draftId));
				return result;
			},
			create: async (params) => {
				const channelId = asString(params?.channelId);
				const senderId = asString(params?.senderId);
				const senderName = asString(params?.senderName);
				const conversationName = asString(params?.conversationName);
				const threadId = asString(params?.threadId);
				const conversationType = asString(params?.conversationType) as "direct" | "group" | "thread" | undefined;
				const forceNew = params?.forceNew === true;
				const requestedWorkspaceDir = resolveRequestedWorkspaceDir(params);
				const entry = await getOrCreateSession({
					channelId,
					senderId,
					senderName,
					conversationName,
					conversationType,
					threadId,
					forceNew,
					workspaceDir: requestedWorkspaceDir,
					explicitWorkspace: Boolean(requestedWorkspaceDir),
					configOverride: (params as RuntimeSessionContextExtras | undefined)?.configOverride,
					sandboxInfo: (params as RuntimeSessionContextExtras | undefined)?.sandboxInfo,
					executionScopeKey: (params as RuntimeSessionContextExtras | undefined)?.executionScopeKey,
				});
			onStateChanged?.();
			return buildSessionSummary(entry);
		},
		send: async (params) => {
			const requestedText = asString(params?.message) ?? "";
			const runtimeContext = (params ?? {}) as RuntimeSessionContextExtras;
			if (!requestedText && !Array.isArray(runtimeContext.images) && !Array.isArray(runtimeContext.attachments)) {
				throw new Error("message is required");
			}
			const requestedWorkspaceDir = resolveRequestedWorkspaceDir(params);
			const reset = parseResetCommand(requestedText);
			let effectiveText = requestedText;
			const sessionId = asString(params?.sessionId);
			let entry: SessionEntry | undefined;

			if (sessionId) {
				entry = sessionEntries.get(sessionId);
				if (!entry) {
					throw new Error(`Session not found: ${sessionId}`);
				}
				if (reset) {
					entry = await recreateSessionEntry(entry);
					effectiveText = resolveResetPrompt(reset, config.agent.userTimezone);
				}
			} else {
				const lookupContext = {
					channelId: asString(params?.channelId),
					senderId: asString(params?.senderId),
					senderName: asString(params?.senderName),
					conversationName: asString(params?.conversationName),
					conversationType: asString(params?.conversationType) as "direct" | "group" | "thread" | undefined,
					threadId: asString(params?.threadId),
					workspaceDir: requestedWorkspaceDir,
					explicitWorkspace: Boolean(requestedWorkspaceDir),
					configOverride: (params as RuntimeSessionContextExtras | undefined)?.configOverride,
					sandboxInfo: (params as RuntimeSessionContextExtras | undefined)?.sandboxInfo,
					executionScopeKey: (params as RuntimeSessionContextExtras | undefined)?.executionScopeKey,
				};
				if (reset?.command === "new") {
					entry = await getOrCreateSession({
						...lookupContext,
						forceNew: true,
					});
				} else {
					entry = await getOrCreateSession({
						...lookupContext,
						forceNew: params?.forceNew === true,
					});
					if (reset?.command === "reset") {
						entry = await recreateSessionEntry(entry);
					}
				}
				onStateChanged?.();
				if (reset) {
					effectiveText = resolveResetPrompt(reset, config.agent.userTimezone);
				}
			}
			const skipTimestampInjection = Boolean(reset && !reset.trailing);
			const teach = parseTeachCommand(effectiveText);
			if (teach) {
				return await runTeachSlashCommand({
					entry,
					command: teach,
					rawText: effectiveText,
				});
			}
			const teachClarification = await handleTeachClarificationTurn(entry, effectiveText);
			if (teachClarification) {
				return teachClarification;
			}
			const historyUserText = effectiveText;
			if (!skipTimestampInjection) {
				effectiveText = injectTimestamp(effectiveText, timestampOptsFromConfig(config));
			}
			const promptInput = await buildPromptInputFromMedia({
				text: effectiveText,
				images: runtimeContext.images,
				attachments: runtimeContext.attachments,
			});
			const historyMedia = resolveHistoryMedia({
				promptOptions: promptInput.promptOptions,
				images: runtimeContext.images,
				attachments: runtimeContext.attachments,
			});
			return await dispatchPromptTurn({
				entry,
				userText: historyUserText,
				effectiveText: promptInput.text,
				channelId: entry.channelId,
				waitForCompletion:
					resolveWaitForCompletion(params?.waitForCompletion) &&
					!(
						asBoolean(params?.async) === true
					),
				promptOptions: promptInput.promptOptions,
				historyMedia,
			});
		},
		patch: async (params) => {
			const sessionId = asString(params?.sessionId);
			if (!sessionId) {
				throw new Error("sessionId is required");
			}
			const entry = sessionEntries.get(sessionId);
			if (!entry) {
				throw new Error(`Session not found: ${sessionId}`);
			}
			const messageCount = asNumber(params?.messageCount);
			if (messageCount !== undefined) {
				entry.messageCount = messageCount;
			}
			const patchRecord = asRecord(params);
			if (patchRecord && "sessionName" in patchRecord) {
				const rawSessionName =
					typeof patchRecord.sessionName === "string"
						? patchRecord.sessionName
						: "";
				const sessionName = trimToUndefined(rawSessionName);
				const nextMeta = Object.assign({}, entry.sessionMeta);
				if (sessionName) {
					nextMeta.sessionName = sessionName;
				} else {
					delete nextMeta.sessionName;
				}
				entry.sessionMeta = Object.keys(nextMeta).length > 0 ? nextMeta : undefined;
			}
			entry.lastActiveAt = Date.now();
			onStateChanged?.();
			return buildSessionSummary(entry);
		},
		reset: async (params) => {
			const sessionId = asString(params?.sessionId);
			if (!sessionId) {
				throw new Error("sessionId is required");
			}
			const existing = sessionEntries.get(sessionId);
			if (!existing) {
				throw new Error(`Session not found: ${sessionId}`);
			}
			const recreated = await recreateSessionEntry(existing);
			return buildSessionSummary(recreated);
		},
		delete: async (params) => {
			const sessionId = asString(params?.sessionId);
			if (!sessionId) {
				throw new Error("sessionId is required");
			}
			const deleted = sessionEntries.delete(sessionId);
			inFlightSessionIds.delete(sessionId);
			if (deleted) {
				await deletePersistedSession?.({ sessionId });
			}
			onStateChanged?.();
			return { sessionId, deleted };
		},
		compact: async (params) => {
			const sessionId = asString(params?.sessionId);
			if (!sessionId) {
				throw new Error("sessionId is required");
			}
			const entry = sessionEntries.get(sessionId);
			if (!entry) {
				throw new Error(`Session not found: ${sessionId}`);
			}
			const keep = Math.max(1, asNumber(params?.keep) ?? 20);
			const before = entry.history.length;
			if (before > keep) {
				entry.history = entry.history.slice(-keep);
			}
			entry.lastActiveAt = Date.now();
			onStateChanged?.();
			return {
				sessionId,
				kept: entry.history.length,
				removed: Math.max(0, before - entry.history.length),
				summary: buildSessionSummary(entry),
			};
		},
		branch: async (params) => {
			const parentId = asString(params?.sessionId);
			if (!parentId) {
				throw new Error("sessionId is required");
			}
			const parent = sessionEntries.get(parentId);
			if (!parent) {
				throw new Error(`Session not found: ${parentId}`);
			}
			const explicitBranchId = asString(params?.branchId);
			const branchId =
				explicitBranchId ??
				`${parentId}:branch:${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
			if (sessionEntries.has(branchId)) {
				throw new Error(`Session already exists: ${branchId}`);
			}
			const requestedForkPoint = asNumber(params?.forkPoint);
			const forkPoint = requestedForkPoint === undefined
				? parent.history.length
				: Math.max(0, Math.min(parent.history.length, requestedForkPoint));
			const forkHistory = cloneValue(parent.history.slice(0, forkPoint));
			const created = await createScopedSession({
				sessionKey: branchId,
				parentId: parent.id,
				forkPoint,
				channelId: parent.channelId,
				senderId: parent.senderId,
				senderName: parent.senderName,
				conversationName: parent.conversationName,
				conversationType: parent.conversationType,
				threadId: parent.threadId,
				workspaceDir: parent.workspaceDir,
				configOverride: parent.configOverride,
				sandboxInfo: parent.sandboxInfo,
				executionScopeKey: parent.executionScopeKey,
			});
			created.history = forkHistory;
			created.messageCount = forkHistory.filter((entry) => entry.role === "assistant").length;
			created.lastActiveAt = Date.now();
			copyRuntimeMessagesForBranch(parent, created, forkHistory);
			sessionEntries.set(branchId, created);
			onStateChanged?.();
			return {
				...buildSessionSummary(created),
				inheritedMessages: forkHistory.length,
			};
		},
		spawnSubagent: async (params) => {
			const parentSessionId = asString(params?.parentSessionId);
			const task = asString(params?.task);
			if (!parentSessionId) {
				throw new Error("parentSessionId is required");
			}
			if (!task) {
				throw new Error("task is required");
			}
			const prepared = await prepareSubagentSession({
				parentSessionId,
				task,
				label: asString(params?.label),
				runtime: asString(params?.runtime),
				agentId: asString(params?.agentId),
				model: asString(params?.model),
				thinking: asString(params?.thinking),
				cwd: asString(params?.cwd),
				thread: asBoolean(params?.thread) === true,
				mode: asString(params?.mode),
				cleanup: asString(params?.cleanup),
				sandbox: asString(params?.sandbox),
				sessionId: asString(params?.childSessionId),
				timeoutMs: asNumber(params?.timeoutMs),
				runTimeoutSeconds: asNumber(params?.runTimeoutSeconds),
				attachments: Array.isArray(params?.attachments) ? params.attachments as Attachment[] : undefined,
			});
			const promptInput = await buildPromptInputFromMedia({
				text: task,
				attachments: prepared.attachments,
			});
			const historyMedia = resolveHistoryMedia({
				promptOptions: promptInput.promptOptions,
				attachments: prepared.attachments,
			});
			const turn = await dispatchPromptTurn({
				entry: prepared.child,
				userText: task,
				effectiveText: promptInput.text,
				channelId: prepared.child.channelId,
				waitForCompletion: false,
				promptOptions: promptInput.promptOptions,
				historyMedia,
			});
			return {
				status: turn.status,
				parentSessionId: prepared.parent.id,
				childSessionId: prepared.child.id,
				sessionId: prepared.child.id,
				runId: turn.runId,
				runtime: prepared.child.subagentMeta?.runtime ?? "subagent",
				mode: prepared.child.subagentMeta?.mode ?? "run",
				created: prepared.created,
				reused: !prepared.created,
				notes: prepared.notes,
			};
		},
		subagents: async (params) => {
			const action = (asString(params?.action) ?? "list").toLowerCase();
			const parentSessionId = asString(params?.parentSessionId);
			if (!parentSessionId) {
				throw new Error("parentSessionId is required");
			}
			switch (action) {
				case "list": {
					const children = listSubagentEntries(sessionEntries.values(), parentSessionId);
					return {
						parentSessionId,
						subagents: children.map((entry) => ({
							...buildSessionSummary(entry),
							sessionId: entry.id,
							latestRunId: entry.subagentMeta?.latestRunId,
							latestRunStatus: entry.subagentMeta?.latestRunStatus ?? "idle",
							label: entry.subagentMeta?.label,
							runtime: entry.subagentMeta?.runtime ?? "subagent",
							mode: entry.subagentMeta?.mode ?? "run",
							cleanup: entry.subagentMeta?.cleanup ?? "keep",
							thread: entry.subagentMeta?.thread ?? false,
							latestResponsePreview: entry.subagentMeta?.latestResponsePreview,
							latestError: entry.subagentMeta?.latestError,
						})),
					};
				}
				case "wait": {
					if (!waitForRun) {
						throw new Error("waitForRun is not configured");
					}
					const target = requireSubagentEntry(parentSessionId, asString(params?.target));
					const latestRunId = target.subagentMeta?.latestRunId;
					if (!latestRunId) {
						return {
							status: target.subagentMeta?.latestRunStatus ?? "idle",
							parentSessionId,
							childSessionId: target.id,
							sessionId: target.id,
						};
					}
					const result = await waitForRun({
						runId: latestRunId,
						sessionId: target.id,
						timeoutMs: Math.max(0, asNumber(params?.timeoutMs) ?? 30_000),
					});
					const status = asString(result.status);
					if (target.subagentMeta && status === "ok") {
						target.subagentMeta = markSubagentRunCompleted(target.subagentMeta, {
							runId: latestRunId,
							response: asString(result.response) ?? "",
						});
						touchSession(target, target.subagentMeta.updatedAt);
						onStateChanged?.();
					} else if (target.subagentMeta && status === "error") {
						target.subagentMeta = markSubagentRunFailed(target.subagentMeta, {
							runId: latestRunId,
							error: asString(result.error) ?? "Subagent run failed",
						});
						touchSession(target, target.subagentMeta.updatedAt);
						onStateChanged?.();
					}
					const cleanedUp =
						(status === "ok" || status === "error") &&
						maybeCleanupSubagentEntry(target);
					return {
						...result,
						parentSessionId,
						childSessionId: target.id,
						sessionId: target.id,
						cleanedUp,
					};
				}
				case "kill": {
					const target = requireSubagentEntry(parentSessionId, asString(params?.target));
					const aborted = await abortSessionEntry(target);
					if (target.subagentMeta) {
						target.subagentMeta = markSubagentRunFailed(target.subagentMeta, {
							runId: target.subagentMeta.latestRunId,
							error: aborted ? "Subagent aborted" : "Subagent abort is not supported by this runtime",
							aborted,
						});
						touchSession(target, target.subagentMeta.updatedAt);
					}
					const cleanedUp = aborted && maybeCleanupSubagentEntry(target);
					onStateChanged?.();
					return {
						aborted,
						parentSessionId,
						childSessionId: target.id,
						sessionId: target.id,
						cleanedUp,
					};
				}
				case "steer": {
					const target = requireSubagentEntry(parentSessionId, asString(params?.target));
					const message = asString(params?.message);
					if (!message) {
						throw new Error("message is required for steer");
					}
					const turn = await dispatchPromptTurn({
						entry: target,
						userText: message,
						effectiveText: message,
						channelId: target.channelId,
						waitForCompletion: false,
					});
					return {
						status: turn.status,
						parentSessionId,
						childSessionId: target.id,
						sessionId: target.id,
						runId: turn.runId,
					};
				}
				default:
					throw new Error(`Unknown subagents action: ${action}`);
			}
		},
		abort: async (params) => {
			const sessionId = asString(params?.sessionId);
			if (sessionId) {
				const entry = sessionEntries.get(sessionId);
				if (!entry) {
					throw new Error(`Session not found: ${sessionId}`);
				}
				const aborted = await abortSessionEntry(entry);
				return {
					aborted,
					sessionId,
					active: inFlightSessionIds.has(sessionId),
				};
			}

			const targets = Array.from(inFlightSessionIds)
				.map((id) => sessionEntries.get(id))
				.filter((entry): entry is SessionEntry => Boolean(entry));

			let abortedCount = 0;
			const abortedSessionIds: string[] = [];
			for (const entry of targets) {
				const aborted = await abortSessionEntry(entry);
				if (aborted) {
					abortedCount += 1;
					abortedSessionIds.push(entry.id);
				}
			}
			return {
				aborted: abortedCount > 0,
				abortedCount,
				sessionIds: abortedSessionIds,
				inFlight: inFlightSessionIds.size,
			};
		},
	};

	return {
		chatHandler,
		sessionHandlers,
	};
}
