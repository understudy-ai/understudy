import {
	ConfigManager,
	createUnderstudySession,
	type TaughtTaskDraftChildArtifact,
	type TaughtTaskCard,
	type TaughtTaskExecutionPolicy,
	type TaughtTaskExecutionRoute,
	type TaughtTaskKind,
	type TaughtTaskPlaybookStage,
	type TaughtTaskProcedureStep,
	type TaughtTaskSkillDependency,
	type TaughtTaskStepRouteOption,
	type TaughtTaskToolArguments,
	type TaughtTaskWorkerContract,
	type WorkspaceArtifactKind,
	extractTaughtTaskToolArgumentsFromRecord,
	normalizeWorkspacePlaybookApprovalGate,
	normalizeTaughtTaskToolArguments,
} from "@understudy/core";
import type { UnderstudyConfig } from "@understudy/types";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { buildDataUrl, extractJsonObject, extractResponseText } from "./response-extract-helpers.js";
import { asNumber, asRecord, asString } from "@understudy/core";
import {
	formatTeachCapabilitySnapshotForPrompt,
	type TeachCapabilitySnapshot,
} from "./teach-capability-snapshot.js";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_EPISODES = 8;
const DEFAULT_MAX_KEYFRAMES = 24;
const HARD_MAX_EPISODES = 18;
const HARD_MAX_KEYFRAMES = 64;
const DEFAULT_MAX_FRAME_BYTES = 20 * 1024 * 1024;
const DEFAULT_SCENE_THRESHOLD = 0.12;
const DEFAULT_FRAME_MAX_WIDTH = 1600;
const DEFAULT_FRAME_RETRY_OFFSETS_MS = [0, -250, -1000];
const DEFAULT_SESSION_PROVIDER = "openai-codex";
const DEFAULT_SESSION_MODEL = "gpt-5.4";
const DEFAULT_MAX_OUTPUT_TOKENS = 2_400;
const MAX_PROMPT_EVENTS = 24;
const MAX_PROMPT_EPISODES = 18;
const MODEL_REQUEST_MAX_ATTEMPTS = 3;
const INVALID_JSON_RETRY_INSTRUCTION =
	"Your previous response was not valid strict JSON. Return exactly one JSON object, with double-quoted keys and strings, and no markdown fences or commentary.";

function isNonRetryableModelRequestError(error: Error): boolean {
	return /\bHTTP (400|401|403|404|413|422)\b/.test(error.message);
}

export interface VideoTeachParameterSlot {
	name: string;
	label?: string;
	sampleValue?: string;
	required?: boolean;
	notes?: string;
}

export interface VideoTeachStep {
	route: string;
	toolName: string;
	instruction: string;
	summary?: string;
	target?: string;
	app?: string;
	scope?: string;
	inputs?: Record<string, string>;
	captureMode?: "window" | "display";
	groundingMode?: "single" | "complex";
	locationHint?: string;
	windowTitle?: string;
	toolArgs?: TaughtTaskToolArguments;
	verificationSummary?: string;
	uncertain?: boolean;
}

const VIDEO_TEACH_STEP_RESERVED_KEYS = new Set([
	"route",
	"toolName",
	"instruction",
	"summary",
	"target",
	"app",
	"scope",
	"inputs",
	"captureMode",
	"groundingMode",
	"locationHint",
	"windowTitle",
	"toolArgs",
	"verificationSummary",
	"uncertain",
]);

function extractVideoTeachStepToolArgs(record: Record<string, unknown>): TaughtTaskToolArguments | undefined {
	const explicit = normalizeTaughtTaskToolArguments(record.toolArgs);
	const implicit = extractTaughtTaskToolArgumentsFromRecord(record, VIDEO_TEACH_STEP_RESERVED_KEYS);
	if (!explicit && !implicit) {
		return undefined;
	}
	return {
		...implicit,
		...explicit,
	};
}

export interface DemonstrationEvent {
	id?: string;
	type: string;
	timestampMs: number;
	source?: string;
	app?: string;
	windowTitle?: string;
	target?: string;
	detail?: string;
	importance?: "low" | "medium" | "high";
	x?: number;
	y?: number;
	keyCode?: number;
	modifiers?: string[];
}

export interface DemonstrationEvidenceFrame {
	path: string;
	mimeType?: string;
	timestampMs?: number;
	label?: string;
	kind?: "before_action" | "action" | "after_action" | "settled" | "context";
	episodeId?: string;
}

export interface DemonstrationEpisode {
	id: string;
	startMs: number;
	endMs: number;
	centerMs: number;
	label: string;
	triggerTypes: string[];
	source: "event" | "scene" | "context";
	app?: string;
	windowTitle?: string;
	sourceEventIds?: string[];
	keyframes: DemonstrationEvidenceFrame[];
}

export interface DemonstrationEvidencePack {
	videoPath: string;
	sourceLabel: string;
	durationMs?: number;
	analysisMode: "event_guided_evidence_pack" | "adaptive_evidence_pack";
	events: DemonstrationEvent[];
	episodes: DemonstrationEpisode[];
	keyframes: DemonstrationEvidenceFrame[];
	summary: string;
	tempDir?: string;
}

export interface VideoTeachAnalysis {
	title: string;
	objective: string;
	summary?: string;
	artifactKind?: WorkspaceArtifactKind;
	taskKind: TaughtTaskKind;
	parameterSlots: VideoTeachParameterSlot[];
	successCriteria: string[];
	openQuestions: string[];
	taskCard?: TaughtTaskCard;
	procedure: TaughtTaskProcedureStep[];
	executionPolicy: TaughtTaskExecutionPolicy;
	stepRouteOptions: TaughtTaskStepRouteOption[];
	replayPreconditions: string[];
	resetSignals: string[];
	skillDependencies: TaughtTaskSkillDependency[];
	childArtifacts?: TaughtTaskDraftChildArtifact[];
	playbookStages?: TaughtTaskPlaybookStage[];
	workerContract?: TaughtTaskWorkerContract;
	steps: VideoTeachStep[];
	provider: string;
	model: string;
	sourceLabel: string;
	analysisMode: DemonstrationEvidencePack["analysisMode"];
	episodeCount: number;
	keyframeCount: number;
	eventCount: number;
	evidenceSummary: string;
	durationMs?: number;
	keyframes?: DemonstrationEvidenceFrame[];
}

export interface VideoTeachAnalyzerRequest {
	videoPath: string;
	sourceLabel?: string;
	objectiveHint?: string;
	capabilitySnapshot?: TeachCapabilitySnapshot;
	eventLogPath?: string;
	events?: DemonstrationEvent[];
	maxEpisodes?: number;
	maxKeyframes?: number;
	keyframeOutputDir?: string;
}

export interface VideoTeachAnalyzer {
	analyze(params: VideoTeachAnalyzerRequest): Promise<VideoTeachAnalysis>;
}

interface VideoTeachCapabilitySelection {
	executionPolicy: TaughtTaskExecutionPolicy;
	stepRouteOptions: TaughtTaskStepRouteOption[];
	skillDependencies: TaughtTaskSkillDependency[];
}

export interface BuildDemonstrationEvidencePackOptions {
	ffmpegPath?: string;
	ffprobePath?: string;
	sceneThreshold?: number;
	durationProbe?: (videoPath: string, ffprobePath: string) => Promise<number | undefined>;
	sceneDetector?: (params: {
		videoPath: string;
		ffmpegPath: string;
		durationMs?: number;
		sceneThreshold: number;
	}) => Promise<number[]>;
	frameExtractor?: (params: {
		videoPath: string;
		ffmpegPath: string;
		timestampMs: number;
		outputPath: string;
	}) => Promise<void>;
}

export interface ResponsesApiVideoTeachAnalyzerOptions extends BuildDemonstrationEvidencePackOptions {
	apiKey?: string;
	baseUrl: string;
	model: string;
	timeoutMs?: number;
	maxOutputTokens?: number;
	fetchImpl?: typeof fetch;
	providerName: string;
	evidenceBuilder?: (params: VideoTeachAnalyzerRequest) => Promise<DemonstrationEvidencePack>;
}

export interface SessionVideoTeachAnalyzerOptions extends BuildDemonstrationEvidencePackOptions {
	config?: UnderstudyConfig;
	configPath?: string;
	cwd?: string;
	provider?: string;
	model?: string;
	providerName?: string;
	thinkingLevel?: UnderstudyConfig["defaultThinkingLevel"];
	evidenceBuilder?: (params: VideoTeachAnalyzerRequest) => Promise<DemonstrationEvidencePack>;
}

interface CandidateEpisodeWindow {
	startMs: number;
	endMs: number;
	centerMs: number;
	score: number;
	label: string;
	triggerTypes: string[];
	source: DemonstrationEpisode["source"];
	app?: string;
	windowTitle?: string;
	sourceEventIds?: string[];
}


function detectFrameMimeType(filePath: string): string {
	switch (extname(filePath).toLowerCase()) {
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		default:
			return "image/png";
	}
}


function extractLatestAssistantText(messages: unknown[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = asRecord(messages[index]);
		if (asString(message?.role) !== "assistant") {
			continue;
		}
		const content = message?.content;
		if (typeof content === "string" && content.trim()) {
			return content;
		}
		if (!Array.isArray(content)) {
			continue;
		}
		const text = content
			.map((entry) => {
				if (typeof entry === "string") {
					return entry;
				}
				const record = asRecord(entry);
				return asString(record?.text) ?? asString(record?.content) ?? "";
			})
			.join("\n")
			.trim();
		if (text) {
			return text;
		}
	}
	return undefined;
}

function humanizeName(value: string): string {
	return value
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeLineList(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return Array.from(
		new Set(
			value
				.map((entry) => asString(entry))
				.filter((entry): entry is string => Boolean(entry)),
		),
	);
}

function normalizeStringMap(value: unknown): Record<string, string> | undefined {
	const record = asRecord(value);
	if (!record) {
		return undefined;
	}
	const normalized = Object.fromEntries(
		Object.entries(record)
			.map(([key, entry]) => [key, asString(entry)])
			.filter((entry): entry is [string, string] => Boolean(entry[1])),
	);
	return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeParameterSlots(value: unknown): VideoTeachParameterSlot[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const slots: VideoTeachParameterSlot[] = [];
	for (const entry of value) {
		if (typeof entry === "string") {
			const name = entry.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
			if (!name) continue;
			slots.push({
				name,
				label: humanizeName(name),
				required: true,
			});
			continue;
		}
		const record = asRecord(entry);
		const rawName = asString(record?.name);
		if (!rawName) {
			continue;
		}
		const name = rawName.toLowerCase().replace(/[^a-z0-9]+/g, "_");
		if (!name) {
			continue;
		}
		slots.push({
			name,
			label: asString(record?.label) ?? humanizeName(name),
			sampleValue: asString(record?.sampleValue),
			required: record?.required !== false,
			notes: asString(record?.notes),
		});
	}
	return slots.slice(0, 12);
}

function normalizeToolName(
	value: string | undefined,
	availableToolNames?: ReadonlySet<string>,
): string | undefined {
	if (!value) {
		return undefined;
	}
	const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
	const aliases = new Map<string, string>([
		["click", "gui_click"],
		["right_click", "gui_click"],
		["rightclick", "gui_click"],
		["context_click", "gui_click"],
		["double_click", "gui_click"],
		["doubleclick", "gui_click"],
		["hover", "gui_click"],
		["click_and_hold", "gui_click"],
		["clickandhold", "gui_click"],
		["long_press", "gui_click"],
		["drag", "gui_drag"],
		["scroll", "gui_scroll"],
		["type", "gui_type"],
		["keypress", "gui_key"],
		["hotkey", "gui_key"],
		["key", "gui_key"],
		["screenshot", "gui_observe"],
		["read", "gui_observe"],
		["observe", "gui_observe"],
		["move", "gui_move"],
		["wait", "gui_wait"],
		["terminal", "bash"],
		["shell", "bash"],
	]);
	const resolved = aliases.get(normalized) ?? normalized;
	if (availableToolNames && availableToolNames.size > 0) {
		return availableToolNames.has(resolved) ? resolved : undefined;
	}
	return /^[a-z][a-z0-9_:-]*$/.test(resolved) ? resolved : undefined;
}

function normalizeRoute(
	toolName: string,
	routeValue: string | undefined,
	toolRoutes?: ReadonlyMap<string, string>,
): string {
	if (routeValue) {
		const normalized = routeValue.trim().toLowerCase().replace(/[\s-]+/g, "_");
		if (normalized.length > 0) {
			return normalized;
		}
	}
	const mapped = toolRoutes?.get(toolName);
	if (mapped) return mapped;
	if (toolName === "browser") return "browser";
	if (toolName === "web_search" || toolName === "web_fetch") return "browser";
	if (toolName === "bash") return "shell";
	if (toolName === "exec" || toolName === "process" || toolName === "apply_patch") return "shell";
	if (toolName.startsWith("gui_")) return "gui";
	return "gui";
}

function normalizeSteps(
	value: unknown,
	options: {
		availableToolNames?: ReadonlySet<string>;
		toolRoutes?: ReadonlyMap<string, string>;
	} = {},
): VideoTeachStep[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const steps: VideoTeachStep[] = [];
	for (const entry of value) {
		if (typeof entry === "string") {
			const instruction = entry.trim();
			if (!instruction) continue;
			steps.push({
				route: "gui",
				toolName: "gui_wait",
				instruction,
			});
			continue;
		}
		const record = asRecord(entry);
		const instruction = asString(record?.instruction) ?? asString(record?.summary);
		const toolName = normalizeToolName(asString(record?.toolName), options.availableToolNames);
		if (!instruction || !toolName) {
			continue;
			}
			const captureMode = asString(record?.captureMode);
			const groundingMode = asString(record?.groundingMode);
			const toolArgs = record ? extractVideoTeachStepToolArgs(record) : undefined;
			steps.push({
				route: normalizeRoute(toolName, asString(record?.route), options.toolRoutes),
				toolName,
				instruction,
			summary: asString(record?.summary),
			target: asString(record?.target),
			app: asString(record?.app),
			scope: asString(record?.scope),
			inputs: normalizeStringMap(record?.inputs),
				...(captureMode === "window" || captureMode === "display" ? { captureMode } : {}),
				...(groundingMode === "single" || groundingMode === "complex" ? { groundingMode } : {}),
				...(asString(record?.locationHint) ? { locationHint: asString(record?.locationHint) } : {}),
				...(asString(record?.windowTitle) ? { windowTitle: asString(record?.windowTitle) } : {}),
				...(toolArgs ? { toolArgs } : {}),
				verificationSummary: asString(record?.verificationSummary),
				uncertain: record?.uncertain === true,
			});
	}
	return steps.slice(0, 20);
}

function normalizeTaskCard(value: unknown): TaughtTaskCard | undefined {
	const record = asRecord(value);
	if (!record) {
		return undefined;
	}
	const inputs = normalizeLineList(record.inputs);
	const extract = normalizeLineList(record.extract);
	const normalized: TaughtTaskCard = {
		inputs,
		extract,
		...(asString(record.goal) ? { goal: asString(record.goal) } : {}),
		...(asString(record.scope) ? { scope: asString(record.scope) } : {}),
		...(asString(record.loopOver)
			? { loopOver: asString(record.loopOver) }
			: {}),
		...(asString(record.formula) ? { formula: asString(record.formula) } : {}),
		...(asString(record.filter) ? { filter: asString(record.filter) } : {}),
		...(asString(record.output) ? { output: asString(record.output) } : {}),
	};
	return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeTaskKind(value: unknown): TaughtTaskKind | undefined {
	switch (asString(value)?.toLowerCase()) {
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

function detectBatchWorkflowLanguage(values: Array<string | undefined>): boolean {
	return values.some((value) =>
		/\b(each|every|all|for each|iterate|loop over|batch|top \d+|first \d+|across)\b/i.test(value ?? ""),
	);
}

function detectFixedDemoLanguage(values: Array<string | undefined>): boolean {
	return values.some((value) =>
		/\b(fixed|exact|exactly|specific|single|one-off|compute the fixed expression|the fixed expression)\b/i.test(value ?? ""),
	);
}

function inferTaskKind(params: {
	payloadTaskKind?: TaughtTaskKind;
	objective?: string;
	taskCard?: TaughtTaskCard;
	parameterSlots: VideoTeachParameterSlot[];
	procedure: TaughtTaskProcedureStep[];
	steps: VideoTeachStep[];
}): TaughtTaskKind {
	if (params.payloadTaskKind) {
		return params.payloadTaskKind;
	}
	const textValues = [
		params.objective,
		params.taskCard?.goal,
		params.taskCard?.scope,
		params.taskCard?.loopOver,
		...params.procedure.map((step) => step.instruction),
		...params.steps.map((step) => step.instruction),
	];
	if (params.taskCard?.loopOver || detectBatchWorkflowLanguage(textValues)) {
		return "batch_workflow";
	}
	if (detectFixedDemoLanguage(textValues)) {
		return "fixed_demo";
	}
	if (params.parameterSlots.length > 0) {
		return "parameterized_workflow";
	}
	return "fixed_demo";
}

function normalizeReplayHints(value: unknown): string[] {
	return normalizeLineList(value).slice(0, 12);
}

const DEFAULT_EXECUTION_ROUTE_ORDER: TaughtTaskExecutionRoute[] = [
	"browser",
	"shell",
	"gui",
];

function normalizeExecutionRoute(value: unknown): TaughtTaskExecutionRoute | undefined {
	switch (asString(value)?.trim().toLowerCase()) {
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

function normalizeExecutionRouteList(
	value: unknown,
	fallback: TaughtTaskExecutionRoute[],
): TaughtTaskExecutionRoute[] {
	if (!Array.isArray(value)) {
		return fallback;
	}
	const routes = value
		.map((entry) => normalizeExecutionRoute(entry))
		.filter((entry): entry is TaughtTaskExecutionRoute => Boolean(entry));
	return Array.from(new Set(routes.length > 0 ? routes : fallback));
}

function inferExecutionPolicy(params: {
	steps: VideoTeachStep[];
	skillDependencies: TaughtTaskSkillDependency[];
}): TaughtTaskExecutionPolicy {
	const preferredRoutes: TaughtTaskExecutionRoute[] = [
		...(params.skillDependencies.length > 0 ? ["skill" as const] : []),
		...DEFAULT_EXECUTION_ROUTE_ORDER,
	];
	const notes = normalizeLineList([
		"Learn the workflow, not the exact tool sequence.",
		"Prefer semantically equivalent `browser`, `bash`, or linked skill routes before raw GUI replay when they preserve the same externally visible result.",
		"Treat detailed steps as fallback replay hints from the demonstration, not as the only contract.",
		...(params.steps.some((step) =>
			step.route === "gui" && (step.toolName === "gui_drag" || step.captureMode === "display"))
			? ["Some observed interactions may still require GUI replay when no equivalent structured route exists."]
			: []),
	]);
	return {
		toolBinding: "adaptive",
		preferredRoutes: Array.from(new Set(preferredRoutes)),
		stepInterpretation: "fallback_replay",
		notes,
	};
}

function normalizeExecutionPolicy(
	value: unknown,
	params: {
		steps: VideoTeachStep[];
		skillDependencies: TaughtTaskSkillDependency[];
	},
): TaughtTaskExecutionPolicy {
	const inferred = inferExecutionPolicy(params);
	const record = asRecord(value);
	if (!record) {
		return inferred;
	}
	const notes = normalizeLineList(record.notes).slice(0, 8);
	return {
		toolBinding: asString(record.toolBinding) === "fixed" ? "fixed" : "adaptive",
		preferredRoutes: normalizeExecutionRouteList(record.preferredRoutes, inferred.preferredRoutes),
		stepInterpretation:
			asString(record.stepInterpretation) === "evidence" ||
			asString(record.stepInterpretation) === "fallback_replay" ||
			asString(record.stepInterpretation) === "strict_contract"
				? asString(record.stepInterpretation) as TaughtTaskExecutionPolicy["stepInterpretation"]
				: inferred.stepInterpretation,
		notes: notes.length > 0 ? notes : inferred.notes,
	};
}

function normalizeRouteOptionPreference(
	value: unknown,
): TaughtTaskStepRouteOption["preference"] | undefined {
	switch (asString(value)?.trim().toLowerCase()) {
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

function inferStepRouteOptions(params: {
	procedure: TaughtTaskProcedureStep[];
	steps: VideoTeachStep[];
}): TaughtTaskStepRouteOption[] {
	const options: TaughtTaskStepRouteOption[] = [];
	for (const procedureStep of params.procedure) {
		if (procedureStep.kind === "skill" && procedureStep.skillName) {
			options.push({
				id: `${procedureStep.id}-route-1`,
				procedureStepId: procedureStep.id,
				route: "skill",
				preference: "preferred",
				instruction: `Delegate this subtask to workspace skill \`${procedureStep.skillName}\`.`,
				skillName: procedureStep.skillName,
				notes: procedureStep.notes,
			});
		}
		const observedStep = params.steps[procedureStep.index - 1];
		if (!observedStep) {
			continue;
		}
		const route = normalizeExecutionRoute(observedStep.route) ?? normalizeExecutionRoute(observedStep.toolName);
		if (!route) {
			continue;
		}
		options.push({
			id: `${procedureStep.id}-route-${options.filter((option) => option.procedureStepId === procedureStep.id).length + 1}`,
			procedureStepId: procedureStep.id,
			route,
			preference: "observed",
			instruction: observedStep.instruction,
			toolName: observedStep.toolName,
			notes: observedStep.summary ?? observedStep.verificationSummary,
		});
	}
	return options;
}

function normalizeStepRouteOptions(
	value: unknown,
	params: {
		procedure: TaughtTaskProcedureStep[];
		steps: VideoTeachStep[];
	},
): TaughtTaskStepRouteOption[] {
	const inferred = inferStepRouteOptions(params);
	if (!Array.isArray(value) || value.length === 0) {
		return inferred;
	}
	const validProcedureIds = new Set(params.procedure.map((step) => step.id));
	const options: TaughtTaskStepRouteOption[] = [];
	for (const [index, entry] of value.entries()) {
		const record = asRecord(entry);
		const procedureStepId = asString(record?.procedureStepId)?.trim();
		if (!procedureStepId || !validProcedureIds.has(procedureStepId)) {
			continue;
		}
		const route =
			normalizeExecutionRoute(record?.route) ||
			(asString(record?.skillName)?.trim() ? "skill" : normalizeExecutionRoute(record?.toolName));
		if (!route) {
			continue;
		}
		const skillName = asString(record?.skillName)?.trim();
		if (route === "skill" && !skillName) {
			continue;
		}
		const instruction =
			asString(record?.instruction)?.trim() ||
			(route === "skill" && skillName
				? `Delegate this subtask to workspace skill \`${skillName}\`.`
				: `Use the ${route} route for this procedure step.`);
		options.push({
			id: asString(record?.id)?.trim() || `${procedureStepId}-route-${index + 1}`,
			procedureStepId,
			route,
			preference: normalizeRouteOptionPreference(record?.preference) ?? "preferred",
			instruction,
			...(asString(record?.toolName)?.trim() ? { toolName: asString(record?.toolName)!.trim() } : {}),
			...(skillName ? { skillName } : {}),
			...(asString(record?.when)?.trim() ? { when: asString(record?.when)!.trim() } : {}),
			...(asString(record?.notes)?.trim() ? { notes: asString(record?.notes)!.trim() } : {}),
		});
	}
	return options.length > 0 ? options.slice(0, 48) : inferred;
}

function alignTaskCardToTaskKind(params: {
	taskCard: TaughtTaskCard | undefined;
	taskKind: TaughtTaskKind;
	parameterSlots: VideoTeachParameterSlot[];
}): TaughtTaskCard | undefined {
	const taskCard = params.taskCard;
	if (!taskCard) {
		return undefined;
	}
	const derivedInputs = normalizeLineList(
		params.parameterSlots.map((slot) => slot.label || humanizeName(slot.name)),
	);
	return normalizeTaskCard({
		...taskCard,
		inputs:
			params.taskKind === "fixed_demo"
				? []
				: taskCard.inputs.length > 0
					? taskCard.inputs
					: derivedInputs,
		...(params.taskKind === "batch_workflow"
			? {}
			: { loopOver: undefined }),
	});
}

function normalizeProcedure(value: unknown): TaughtTaskProcedureStep[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const steps: TaughtTaskProcedureStep[] = [];
	for (const entry of value) {
		if (typeof entry === "string") {
			const instruction = asString(entry);
			if (!instruction) {
				continue;
			}
			steps.push({
				id: `procedure-${steps.length + 1}`,
				index: steps.length + 1,
				instruction,
			});
			continue;
		}
		const record = asRecord(entry);
		const instruction = asString(record?.instruction) ?? asString(record?.summary);
		if (!instruction) {
			continue;
		}
		const kind = asString(record?.kind);
		const normalizedKind =
			kind === "navigate" ||
			kind === "extract" ||
			kind === "transform" ||
			kind === "filter" ||
			kind === "output" ||
			kind === "skill" ||
			kind === "check"
				? kind
				: undefined;
		steps.push({
			id: `procedure-${steps.length + 1}`,
			index: steps.length + 1,
			instruction,
			...(normalizedKind ? { kind: normalizedKind } : {}),
			...(asString(record?.skillName)
				? { skillName: asString(record?.skillName) }
				: {}),
			...(asString(record?.notes) ? { notes: asString(record?.notes) } : {}),
			...(record?.uncertain === true ? { uncertain: true } : {}),
		});
	}
	return steps.slice(0, 24);
}

function normalizeSkillDependencies(value: unknown): TaughtTaskSkillDependency[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const dependencies: TaughtTaskSkillDependency[] = [];
	for (const entry of value) {
		if (typeof entry === "string") {
			const name = asString(entry);
			if (!name) {
				continue;
			}
			dependencies.push({
				name,
				required: true,
			});
			continue;
		}
		const record = asRecord(entry);
		const name = asString(record?.name);
		if (!name) {
			continue;
		}
		dependencies.push({
			name,
			...(asString(record?.reason) ? { reason: asString(record?.reason) } : {}),
			required: record?.required !== false,
		});
	}
	return dependencies.slice(0, 12);
}

function normalizeArtifactKind(value: unknown): WorkspaceArtifactKind | undefined {
	switch (asString(value)?.toLowerCase()) {
		case "skill":
			return "skill";
		case "worker":
			return "worker";
		case "playbook":
			return "playbook";
		default:
			return undefined;
	}
}

function normalizeChildArtifacts(value: unknown): TaughtTaskDraftChildArtifact[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const artifacts: TaughtTaskDraftChildArtifact[] = [];
	for (const [index, entry] of value.entries()) {
		const record = asRecord(entry);
		const name = asString(record?.name);
		const objective = asString(record?.objective);
		const artifactKind = normalizeArtifactKind(record?.artifactKind);
		if (!name || !objective || !artifactKind || artifactKind === "playbook") {
			continue;
		}
		artifacts.push({
			id: asString(record?.id) ?? `child-artifact-${index + 1}`,
			name,
			artifactKind,
			objective,
			required: record?.required !== false,
			...(asString(record?.reason) ? { reason: asString(record?.reason) } : {}),
		});
	}
	return artifacts.slice(0, 16);
}

function normalizePlaybookStages(value: unknown): TaughtTaskPlaybookStage[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const stages: TaughtTaskPlaybookStage[] = [];
	for (const [index, entry] of value.entries()) {
		const record = asRecord(entry);
		const kind = asString(record?.kind);
		const normalizedKind =
			kind === "skill" ||
			kind === "worker" ||
			kind === "inline" ||
			kind === "approval"
				? kind
				: undefined;
		const name = asString(record?.name);
		const objective = asString(record?.objective);
		if (!normalizedKind || !name || !objective) {
			continue;
		}
		const refName = asString(record?.refName);
		if ((normalizedKind === "skill" || normalizedKind === "worker") && !refName) {
			continue;
		}
		const retryPolicy = asString(record?.retryPolicy);
		const approvalGate = normalizeWorkspacePlaybookApprovalGate(record?.approvalGate);
		stages.push({
			id: asString(record?.id) ?? `playbook-stage-${index + 1}`,
			name,
			kind: normalizedKind,
			...(refName ? { refName } : {}),
			objective,
			inputs: normalizeLineList(record?.inputs),
			outputs: normalizeLineList(record?.outputs),
			budgetNotes: normalizeLineList(record?.budgetNotes),
			...(retryPolicy === "retry_once" || retryPolicy === "skip_with_note" || retryPolicy === "pause_for_human"
				? { retryPolicy }
				: {}),
			...(approvalGate ? { approvalGate } : {}),
		});
	}
	return stages.slice(0, 24);
}

function normalizeWorkerContract(value: unknown): TaughtTaskWorkerContract | undefined {
	const record = asRecord(value);
	const goal = asString(record?.goal);
	if (!goal) {
		return undefined;
	}
	const budget = asRecord(record?.budget);
	const asFiniteInt = (input: unknown): number | undefined =>
		typeof input === "number" && Number.isFinite(input) && input >= 0
			? Math.floor(input)
			: undefined;
	return {
		goal,
		...(asString(record?.scope) ? { scope: asString(record?.scope) } : {}),
		inputs: normalizeLineList(record?.inputs),
		outputs: normalizeLineList(record?.outputs),
		allowedRoutes: (Array.isArray(record?.allowedRoutes) ? record.allowedRoutes : [])
			.map((entry: unknown) => asString(entry))
			.filter((entry: string | undefined): entry is TaughtTaskExecutionRoute =>
				entry === "skill" || entry === "browser" || entry === "shell" || entry === "gui"),
		allowedSurfaces: normalizeLineList(record?.allowedSurfaces),
		...(budget
			? {
				budget: {
					...(asFiniteInt(budget.maxMinutes) !== undefined ? { maxMinutes: asFiniteInt(budget.maxMinutes) } : {}),
					...(asFiniteInt(budget.maxActions) !== undefined ? { maxActions: asFiniteInt(budget.maxActions) } : {}),
					...(asFiniteInt(budget.maxScreenshots) !== undefined ? { maxScreenshots: asFiniteInt(budget.maxScreenshots) } : {}),
				},
			}
			: {}),
		escalationPolicy: normalizeLineList(record?.escalationPolicy),
		stopConditions: normalizeLineList(record?.stopConditions),
		decisionHeuristics: normalizeLineList(record?.decisionHeuristics),
	};
}

function formatTimestampMs(value: number | undefined): string {
	if (value === undefined) {
		return "unknown time";
	}
	const totalSeconds = Math.max(0, Math.floor(value / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function probeVideoDurationMs(videoPath: string, ffprobePath: string): Promise<number | undefined> {
	try {
		const result = await execFileAsync(ffprobePath, [
			"-v",
			"error",
			"-show_entries",
			"format=duration",
			"-of",
			"default=noprint_wrappers=1:nokey=1",
			videoPath,
		], {
			encoding: "utf8",
			maxBuffer: 1024 * 1024,
		});
		const seconds = Number.parseFloat(result.stdout.trim());
		return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : undefined;
	} catch {
		return undefined;
	}
}

function normalizeEventType(value: unknown): string | undefined {
	const raw = asString(value);
	if (!raw) {
		return undefined;
	}
	return raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || undefined;
}

function normalizeEventImportance(value: unknown): DemonstrationEvent["importance"] | undefined {
	const raw = asString(value)?.toLowerCase();
	if (raw === "low" || raw === "medium" || raw === "high") {
		return raw;
	}
	return undefined;
}

function inferEventImportance(type: string): DemonstrationEvent["importance"] {
	if (
		type.includes("mouse_down") ||
		type.includes("mouse_up") ||
		type.includes("click") ||
		type.includes("drag") ||
		type.includes("key_down") ||
		type.includes("hotkey") ||
		type.includes("app_activated") ||
		type.includes("window") ||
		type.includes("menu")
	) {
		return "high";
	}
	if (
		type.includes("scroll") ||
		type.includes("mouse_move") ||
		type.includes("hover") ||
		type.includes("focus")
	) {
		return "medium";
	}
	return "low";
}

function normalizeDemonstrationEvents(value: unknown): DemonstrationEvent[] {
	const root = Array.isArray(value)
		? value
		: Array.isArray(asRecord(value)?.events)
			? asRecord(value)?.events as Array<unknown>
			: [];
	const normalized: DemonstrationEvent[] = [];
	for (const [index, entry] of root.entries()) {
		const record = asRecord(entry);
		if (!record) {
			continue;
		}
		const type = normalizeEventType(record.type);
		const timestampMs = asNumber(record.timestampMs) ?? asNumber(record.timestamp_ms);
		if (!type || timestampMs === undefined || timestampMs < 0) {
			continue;
		}
		normalized.push({
			id: asString(record.id) ?? `event-${index + 1}`,
			type,
			timestampMs: Math.round(timestampMs),
			source: asString(record.source),
			app: asString(record.app),
			windowTitle: asString(record.windowTitle) ?? asString(record.window_title),
			target: asString(record.target),
			detail: asString(record.detail),
			importance: normalizeEventImportance(record.importance) ?? inferEventImportance(type),
			x: asNumber(record.x),
			y: asNumber(record.y),
			keyCode: asNumber(record.keyCode) ?? asNumber(record.key_code),
			modifiers: Array.isArray(record.modifiers) ? normalizeLineList(record.modifiers) : undefined,
		});
	}
	return normalized.sort((left, right) => left.timestampMs - right.timestampMs);
}

async function loadDemonstrationEvents(params: {
	events?: DemonstrationEvent[];
	eventLogPath?: string;
}): Promise<DemonstrationEvent[]> {
	const direct = normalizeDemonstrationEvents(params.events);
	if (direct.length > 0) {
		return direct;
	}
	const eventLogPath = asString(params.eventLogPath);
	if (!eventLogPath) {
		return [];
	}
	const raw = await readFile(resolve(eventLogPath), "utf8");
	return normalizeDemonstrationEvents(JSON.parse(raw));
}

function parseSceneTimestampsMs(output: string, durationMs?: number): number[] {
	const timestamps = Array.from(output.matchAll(/pts_time:([0-9.]+)/g))
		.map((match) => Number.parseFloat(match[1] ?? ""))
		.filter((value) => Number.isFinite(value) && value >= 0)
		.map((value) => Math.round(value * 1000));
	return dedupeSortedTimestamps(timestamps, 900).filter((timestamp) =>
		durationMs ? timestamp > 0 && timestamp < durationMs : true
	);
}

async function detectSceneChangeTimestampsMs(params: {
	videoPath: string;
	ffmpegPath: string;
	durationMs?: number;
	sceneThreshold: number;
}): Promise<number[]> {
	try {
		const result = await execFileAsync(params.ffmpegPath, [
			"-hide_banner",
			"-loglevel",
			"info",
			"-i",
			params.videoPath,
			"-vf",
			`select='gt(scene,${params.sceneThreshold})',showinfo`,
			"-vsync",
			"vfr",
			"-an",
			"-f",
			"null",
			"-",
		], {
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
		});
		return parseSceneTimestampsMs(`${result.stdout}\n${result.stderr}`, params.durationMs);
	} catch (error) {
		const record = error as Error & { stdout?: string; stderr?: string };
		const parsed = parseSceneTimestampsMs(`${record.stdout ?? ""}\n${record.stderr ?? ""}`, params.durationMs);
		if (parsed.length > 0) {
			return parsed;
		}
		return [];
	}
}

function clampTimestampMs(timestampMs: number, durationMs?: number): number {
	if (!durationMs || durationMs <= 0) {
		return Math.max(0, Math.round(timestampMs));
	}
	const upperBound = Math.max(0, Math.round(durationMs) - 1);
	return Math.max(0, Math.min(upperBound, Math.round(timestampMs)));
}

function dedupeSortedTimestamps(values: number[], minGapMs: number): number[] {
	const sorted = values
		.filter((value) => Number.isFinite(value))
		.sort((left, right) => left - right);
	const deduped: number[] = [];
	for (const value of sorted) {
		if (deduped.length === 0 || value - deduped[deduped.length - 1] >= minGapMs) {
			deduped.push(value);
		}
	}
	return deduped;
}

function classifyEventFamily(type: string): "drag" | "pointer" | "scroll" | "keyboard" | "state" | "visual" | "other" {
	if (type.includes("drag")) return "drag";
	if (type.includes("hover") || type.includes("move")) return "pointer";
	if (type.includes("mouse") || type.includes("click") || type.includes("pointer")) return "pointer";
	if (type.includes("scroll")) return "scroll";
	if (type.includes("key") || type.includes("hotkey")) return "keyboard";
	if (type.includes("focus") || type.includes("window") || type.includes("dialog") || type.includes("menu") || type.includes("value") || type.includes("app")) {
		return "state";
	}
	if (type.includes("visual") || type.includes("scene")) return "visual";
	return "other";
}

function buildEpisodeLabel(params: {
	source: DemonstrationEpisode["source"];
	app?: string;
	windowTitle?: string;
	target?: string;
	detail?: string;
	centerMs: number;
}): string {
	if (params.target) {
		return params.app ? `${params.app}: ${params.target}` : params.target;
	}
	if (params.detail) {
		return params.detail;
	}
	if (params.windowTitle) {
		return params.app ? `${params.app}: ${params.windowTitle}` : params.windowTitle;
	}
	if (params.app) {
		return `${params.app} action`;
	}
	if (params.source === "scene") {
		return `Visual change near ${formatTimestampMs(params.centerMs)}`;
	}
	if (params.source === "context") {
		return `Context near ${formatTimestampMs(params.centerMs)}`;
	}
	return `Interaction near ${formatTimestampMs(params.centerMs)}`;
}

function scoreDemonstrationEvent(event: DemonstrationEvent): number {
	const family = classifyEventFamily(event.type);
	const familyScore =
		family === "drag"
			? 60
			: family === "pointer"
				? 42
				: family === "keyboard"
					? 34
					: family === "scroll"
						? 24
						: family === "state"
							? 36
							: 12;
	const importanceScore =
		event.importance === "high"
			? 30
			: event.importance === "medium"
				? 16
				: 6;
	const semanticScore = event.target || event.windowTitle ? 10 : 0;
	return familyScore + importanceScore + semanticScore;
}

function buildEventEpisodeWindows(events: DemonstrationEvent[], durationMs?: number): CandidateEpisodeWindow[] {
	if (events.length === 0) {
		return [];
	}
	const clusters: DemonstrationEvent[][] = [];
	let current: DemonstrationEvent[] = [];
	for (const event of events) {
		if (current.length === 0) {
			current = [event];
			continue;
		}
		const previous = current[current.length - 1];
		const previousFamily = classifyEventFamily(previous.type);
		const nextFamily = classifyEventFamily(event.type);
		const gapMs = event.timestampMs - previous.timestampMs;
		const clusterGapMs =
			previousFamily === "keyboard" && nextFamily === "keyboard"
				? 700
				: previousFamily === "scroll" && nextFamily === "scroll"
					? 900
					: 1_100;
		const contextChanged =
			(previous.app && event.app && previous.app !== event.app)
			|| (previous.windowTitle && event.windowTitle && previous.windowTitle !== event.windowTitle);
		if (contextChanged && gapMs > 120) {
			clusters.push(current);
			current = [event];
			continue;
		}
		if (gapMs <= clusterGapMs) {
			current.push(event);
			continue;
		}
		clusters.push(current);
		current = [event];
	}
	if (current.length > 0) {
		clusters.push(current);
	}

	return clusters.map((cluster) => {
		const first = cluster[0]!;
		const last = cluster[cluster.length - 1]!;
		const families = new Set(cluster.map((event) => classifyEventFamily(event.type)));
		const beforeMs =
			families.has("drag")
				? 450
				: families.has("pointer")
					? 350
					: families.has("keyboard")
						? 250
						: 500;
		const afterMs =
			families.has("drag")
				? 2_000
				: families.has("pointer")
					? 1_700
					: families.has("keyboard")
						? 1_250
						: 1_500;
		const startMs = clampTimestampMs(first.timestampMs - beforeMs, durationMs);
		const endMs = clampTimestampMs(last.timestampMs + afterMs, durationMs);
		const centerMs = clampTimestampMs((first.timestampMs + last.timestampMs) / 2, durationMs);
		const eventScore = cluster.reduce((sum, event) => sum + scoreDemonstrationEvent(event), 0);
		return {
			startMs,
			endMs: Math.max(startMs, endMs),
			centerMs,
			score: 220 + eventScore + (cluster.length * 8) + (families.size * 18),
			label: buildEpisodeLabel({
				source: "event",
				app: first.app ?? last.app,
				windowTitle: first.windowTitle ?? last.windowTitle,
				target: first.target ?? last.target,
				detail: first.detail ?? last.detail,
				centerMs,
			}),
			triggerTypes: Array.from(new Set(cluster.map((event) => event.type))),
			source: "event",
			app: first.app ?? last.app,
			windowTitle: first.windowTitle ?? last.windowTitle,
			sourceEventIds: cluster.map((event) => event.id).filter((id): id is string => Boolean(id)),
		};
	});
}

function buildSceneEpisodeWindows(sceneTimestampsMs: number[], durationMs?: number): CandidateEpisodeWindow[] {
	return sceneTimestampsMs.map((timestampMs) => ({
		startMs: clampTimestampMs(timestampMs - 800, durationMs),
		endMs: clampTimestampMs(timestampMs + 1_300, durationMs),
		centerMs: clampTimestampMs(timestampMs, durationMs),
		score: 140,
		label: buildEpisodeLabel({
			source: "scene",
			centerMs: timestampMs,
		}),
		triggerTypes: ["visual_delta"],
		source: "scene",
	}));
}

function shouldMergeCandidateWindows(previous: CandidateEpisodeWindow, next: CandidateEpisodeWindow): boolean {
	const gapMs = next.startMs - previous.endMs;
	if (gapMs > 400) {
		return false;
	}
	if (previous.source === "event" && next.source === "event") {
		const previousFamilies = new Set(previous.triggerTypes.map((type) => classifyEventFamily(type)));
		const nextFamilies = new Set(next.triggerTypes.map((type) => classifyEventFamily(type)));
		const sharedFamily = [...previousFamilies].some((family) => nextFamilies.has(family));
		const sameApp = previous.app && next.app ? previous.app === next.app : false;
		return gapMs <= 120 || (gapMs <= 250 && sharedFamily && sameApp);
	}
	return true;
}

function buildContextEpisodeWindows(durationMs?: number): CandidateEpisodeWindow[] {
	if (!durationMs || durationMs <= 0) {
		return [];
	}
	const markers = dedupeSortedTimestamps([
		Math.round(durationMs * 0.1),
		Math.round(durationMs * 0.5),
		Math.round(durationMs * 0.9),
	], 3_000);
	return markers.map((timestampMs, index) => ({
		startMs: clampTimestampMs(timestampMs - 700, durationMs),
		endMs: clampTimestampMs(timestampMs + 1_100, durationMs),
		centerMs: clampTimestampMs(timestampMs, durationMs),
		score: 40 - index,
		label: buildEpisodeLabel({
			source: "context",
			centerMs: timestampMs,
		}),
		triggerTypes: ["context"],
		source: "context",
	}));
}

function mergeCandidateWindows(windows: CandidateEpisodeWindow[], durationMs?: number): CandidateEpisodeWindow[] {
	if (windows.length === 0) {
		return [];
	}
	const sorted = windows
		.slice()
		.sort((left, right) => left.startMs - right.startMs || right.score - left.score);
	const merged: CandidateEpisodeWindow[] = [];
	for (const window of sorted) {
		const previous = merged[merged.length - 1];
		if (!previous || !shouldMergeCandidateWindows(previous, window)) {
			merged.push({ ...window });
			continue;
		}
		previous.startMs = Math.min(previous.startMs, window.startMs);
		previous.endMs = Math.max(previous.endMs, window.endMs);
		previous.centerMs = clampTimestampMs((previous.centerMs + window.centerMs) / 2, durationMs);
		previous.score = Math.max(previous.score, window.score);
		previous.triggerTypes = Array.from(new Set([...previous.triggerTypes, ...window.triggerTypes]));
		if (previous.source !== "event" && window.source === "event") {
			previous.source = "event";
		} else if (previous.source === "context" && window.source === "scene") {
			previous.source = "scene";
		}
		previous.app = previous.app ?? window.app;
		previous.windowTitle = previous.windowTitle ?? window.windowTitle;
		previous.sourceEventIds = Array.from(
			new Set([...(previous.sourceEventIds ?? []), ...(window.sourceEventIds ?? [])]),
		);
		if (window.score >= previous.score) {
			previous.label = window.label;
		}
	}
	return merged.map((window) => ({
		...window,
		startMs: clampTimestampMs(window.startMs, durationMs),
		endMs: clampTimestampMs(window.endMs, durationMs),
		centerMs: clampTimestampMs(window.centerMs, durationMs),
	}));
}

function pickCoverageWindows(
	windows: CandidateEpisodeWindow[],
	maxEpisodes: number,
	durationMs?: number,
): CandidateEpisodeWindow[] {
	if (!durationMs || windows.length === 0 || maxEpisodes <= 2) {
		return [];
	}
	const segmentCount = Math.max(2, Math.min(maxEpisodes, Math.ceil(durationMs / 45_000)));
	const selected: CandidateEpisodeWindow[] = [];
	for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
		const segmentStart = Math.floor((durationMs * segmentIndex) / segmentCount);
		const segmentEnd = Math.ceil((durationMs * (segmentIndex + 1)) / segmentCount);
		const candidate = windows
			.filter((window) => window.centerMs >= segmentStart && window.centerMs <= segmentEnd)
			.sort((left, right) => right.score - left.score || left.startMs - right.startMs)[0];
		if (!candidate) {
			continue;
		}
		if (selected.some((existing) => Math.abs(existing.centerMs - candidate.centerMs) < 700)) {
			continue;
		}
		selected.push(candidate);
		if (selected.length >= maxEpisodes) {
			break;
		}
	}
	return selected;
}

function selectCandidateWindows(
	windows: CandidateEpisodeWindow[],
	maxEpisodes: number,
	durationMs?: number,
): CandidateEpisodeWindow[] {
	if (windows.length <= maxEpisodes) {
		return windows.sort((left, right) => left.startMs - right.startMs);
	}
	const ranked = windows
		.slice()
		.sort((left, right) => right.score - left.score || left.startMs - right.startMs);
	const selected: CandidateEpisodeWindow[] = pickCoverageWindows(windows, maxEpisodes, durationMs);
	for (const window of ranked) {
		if (selected.length >= maxEpisodes) {
			break;
		}
		if (selected.some((entry) => Math.abs(entry.centerMs - window.centerMs) < 700)) {
			continue;
		}
		selected.push(window);
	}
	const sorted = selected.sort((left, right) => left.startMs - right.startMs);
	if (durationMs && sorted.length < maxEpisodes) {
		const nearStart = sorted.some((window) => window.startMs <= 1_000);
		const nearEnd = sorted.some((window) => durationMs - window.endMs <= 1_000);
		if (!nearStart) {
			const startWindow = windows.find((window) => window.source === "context" && window.centerMs <= durationMs * 0.2);
			if (startWindow) {
				sorted.unshift(startWindow);
			}
		}
		if (!nearEnd && sorted.length < maxEpisodes) {
			const endWindow = [...windows].reverse().find((window) => window.source === "context" && window.centerMs >= durationMs * 0.8);
			if (endWindow) {
				sorted.push(endWindow);
			}
		}
	}
	return sorted.slice(0, maxEpisodes);
}

function buildEpisodeKeyframePlan(params: {
	window: CandidateEpisodeWindow;
	episodeId: string;
	durationMs?: number;
	budget: number;
}): Array<Omit<DemonstrationEvidenceFrame, "path" | "mimeType"> & { fileName: string }> {
	const endMs = Math.max(params.window.startMs, params.window.endMs);
	const settledMs = Math.min(endMs, params.window.centerMs + 1_000);
	const candidates = [
		{ kind: "before_action" as const, timestampMs: params.window.startMs },
		{ kind: "action" as const, timestampMs: params.window.centerMs },
		{ kind: "settled" as const, timestampMs: settledMs },
		{ kind: "after_action" as const, timestampMs: Math.min(endMs, Math.round((params.window.centerMs + endMs) / 2)) },
		{ kind: "context" as const, timestampMs: Math.max(params.window.startMs, params.window.centerMs - 900) },
		{ kind: "context" as const, timestampMs: Math.max(params.window.startMs, Math.round((params.window.startMs + params.window.centerMs) / 2)) },
		{ kind: "context" as const, timestampMs: endMs },
	];
	const deduped = dedupeSortedTimestamps(candidates.map((item) => item.timestampMs), 450);
	const selected = candidates
		.filter((item) => deduped.includes(item.timestampMs))
		.slice(0, Math.max(2, Math.min(6, params.budget)));
	return selected.map((item, index) => ({
		episodeId: params.episodeId,
		timestampMs: clampTimestampMs(item.timestampMs, params.durationMs),
		kind: item.kind,
		label: `${params.window.label} (${item.kind.replace(/_/g, " ")})`,
		fileName: `${params.episodeId}-kf-${String(index + 1).padStart(2, "0")}.png`,
	}));
}

function resolveAdaptiveEvidenceBudget(params: {
	requestedMaxEpisodes?: number;
	requestedMaxKeyframes?: number;
	durationMs?: number;
	events: DemonstrationEvent[];
	sceneCount: number;
}): { maxEpisodes: number; maxKeyframes: number } {
	const clampInt = (value: number, min: number, max: number): number =>
		Math.max(min, Math.min(max, Math.floor(value)));
	const durationComplexity = params.durationMs ? Math.min(5, Math.floor(params.durationMs / 45_000)) : 0;
	const eventComplexity = Math.min(5, Math.floor(Math.max(0, params.events.length - 6) / 6));
	const sceneComplexity = Math.min(3, Math.floor(params.sceneCount / 8));
	const appComplexity = Math.min(2, Math.max(0, new Set(params.events.map((event) => event.app).filter(Boolean)).size - 1));
	const complexity = durationComplexity + eventComplexity + sceneComplexity + appComplexity;
	const desiredEpisodes = params.requestedMaxEpisodes !== undefined
		? clampInt(params.requestedMaxEpisodes, 1, HARD_MAX_EPISODES)
		: clampInt(DEFAULT_MAX_EPISODES + complexity, DEFAULT_MAX_EPISODES, HARD_MAX_EPISODES);
	const desiredKeyframes = params.requestedMaxKeyframes !== undefined
		? clampInt(params.requestedMaxKeyframes, 2, HARD_MAX_KEYFRAMES)
		: clampInt(
			Math.max(DEFAULT_MAX_KEYFRAMES, (desiredEpisodes * 4) + (complexity * 2)),
			DEFAULT_MAX_KEYFRAMES,
			HARD_MAX_KEYFRAMES,
		);
	const maxEpisodes = Math.max(1, Math.min(desiredEpisodes, Math.floor(desiredKeyframes / 2) || 1));
	const maxKeyframes = clampInt(
		Math.max(desiredKeyframes, maxEpisodes * 2),
		2,
		HARD_MAX_KEYFRAMES,
	);
	return {
		maxEpisodes,
		maxKeyframes,
	};
}

function allocateEpisodeKeyframeBudgets(params: {
	windows: CandidateEpisodeWindow[];
	maxKeyframes: number;
}): number[] {
	if (params.windows.length === 0) {
		return [];
	}
	const budgets = Array.from({ length: params.windows.length }, () => 2);
	let remaining = Math.max(0, params.maxKeyframes - (params.windows.length * 2));
	const rankedIndices = params.windows
		.map((window, index) => ({
			index,
			weight:
				window.score +
				(window.source === "event" ? 80 : window.source === "scene" ? 40 : 0) +
				(window.triggerTypes.length * 6),
		}))
		.sort((left, right) => right.weight - left.weight || left.index - right.index);
	while (remaining > 0) {
		let awarded = false;
		for (const entry of rankedIndices) {
			if (remaining <= 0) {
				break;
			}
			if (budgets[entry.index]! >= 6) {
				continue;
			}
			budgets[entry.index] = budgets[entry.index]! + 1;
			remaining -= 1;
			awarded = true;
		}
		if (!awarded) {
			break;
		}
	}
	return budgets;
}

async function extractFrameAtTimestamp(params: {
	videoPath: string;
	ffmpegPath: string;
	timestampMs: number;
	outputPath: string;
}): Promise<void> {
	const attempts = Array.from(
		new Set(DEFAULT_FRAME_RETRY_OFFSETS_MS.map((offsetMs) => Math.max(0, params.timestampMs + offsetMs))),
	);
	for (const attemptTimestampMs of attempts) {
		const timestampSeconds = attemptTimestampMs / 1000;
		await execFileAsync(params.ffmpegPath, [
			"-hide_banner",
			"-loglevel",
			"error",
			"-y",
			"-ss",
			timestampSeconds.toFixed(3),
			"-i",
			params.videoPath,
			"-frames:v",
			"1",
			"-vf",
			`scale='min(${DEFAULT_FRAME_MAX_WIDTH},iw)':-2`,
			params.outputPath,
		], {
			maxBuffer: 8 * 1024 * 1024,
		});
		const extracted = await stat(params.outputPath).catch(() => undefined);
		if (extracted && extracted.size > 0) {
			return;
		}
		await rm(params.outputPath, { force: true }).catch(() => {});
	}
	throw new Error(
		`ffmpeg did not produce a keyframe image near ${formatTimestampMs(params.timestampMs)} for ${params.videoPath}.`,
	);
}

function buildEvidenceSummary(pack: {
	analysisMode: DemonstrationEvidencePack["analysisMode"];
	sourceLabel: string;
	durationMs?: number;
	eventCount: number;
	episodeCount: number;
	keyframeCount: number;
}): string {
	const pieces = [
		pack.analysisMode === "event_guided_evidence_pack"
			? "event-guided evidence pack"
			: "adaptive evidence pack",
		`${pack.episodeCount} episode${pack.episodeCount === 1 ? "" : "s"}`,
		`${pack.keyframeCount} keyframe${pack.keyframeCount === 1 ? "" : "s"}`,
	];
	if (pack.eventCount > 0) {
		pieces.push(`${pack.eventCount} imported event${pack.eventCount === 1 ? "" : "s"}`);
	}
	if (pack.durationMs) {
		pieces.push(`duration ${formatTimestampMs(pack.durationMs)}`);
	}
	return `Built ${pieces.join(", ")} from ${pack.sourceLabel}.`;
}

export async function buildDemonstrationEvidencePack(
	request: VideoTeachAnalyzerRequest,
	options: BuildDemonstrationEvidencePackOptions = {},
): Promise<DemonstrationEvidencePack> {
	const videoPath = resolve(request.videoPath);
	const sourceLabel = request.sourceLabel?.trim() || basename(videoPath);
	const ffmpegPath = options.ffmpegPath?.trim() || "ffmpeg";
	const ffprobePath = options.ffprobePath?.trim() || "ffprobe";
	const durationProbe = options.durationProbe ?? probeVideoDurationMs;
	const sceneDetector = options.sceneDetector ?? detectSceneChangeTimestampsMs;
	const frameExtractor = options.frameExtractor ?? extractFrameAtTimestamp;
	const sceneThreshold = options.sceneThreshold ?? DEFAULT_SCENE_THRESHOLD;
	const keyframeOutputDir = asString(request.keyframeOutputDir);
	const durationMs = await durationProbe(videoPath, ffprobePath);
	const events = await loadDemonstrationEvents({
		events: request.events,
		eventLogPath: request.eventLogPath,
	});
	const sceneTimestampsMs = await sceneDetector({
		videoPath,
		ffmpegPath,
		durationMs,
		sceneThreshold,
	});
	const { maxEpisodes, maxKeyframes } = resolveAdaptiveEvidenceBudget({
		requestedMaxEpisodes: request.maxEpisodes,
		requestedMaxKeyframes: request.maxKeyframes,
		durationMs,
		events,
		sceneCount: sceneTimestampsMs.length,
	});
	const windows = mergeCandidateWindows([
		...buildEventEpisodeWindows(events, durationMs),
		...buildSceneEpisodeWindows(sceneTimestampsMs, durationMs),
		...buildContextEpisodeWindows(durationMs),
	], durationMs);
	const selectedWindows = selectCandidateWindows(
		windows.length > 0
			? windows
			: buildContextEpisodeWindows(durationMs),
		maxEpisodes,
		durationMs,
	);
	if (selectedWindows.length === 0) {
		throw new Error("Unable to derive any evidence episodes from the demonstration video.");
	}

	const frameOutputDir = keyframeOutputDir
		? resolve(keyframeOutputDir)
		: await mkdtemp(join(tmpdir(), "understudy-demonstration-evidence-"));
	if (keyframeOutputDir) {
		await mkdir(frameOutputDir, { recursive: true });
	}
	try {
		const perEpisodeBudgets = allocateEpisodeKeyframeBudgets({
			windows: selectedWindows,
			maxKeyframes,
		});
		const episodes: DemonstrationEpisode[] = [];
		const keyframes: DemonstrationEvidenceFrame[] = [];
		for (const [index, window] of selectedWindows.entries()) {
			const episodeId = `episode-${String(index + 1).padStart(2, "0")}`;
			const framePlan = buildEpisodeKeyframePlan({
				window,
				episodeId,
				durationMs,
				budget: perEpisodeBudgets[index] ?? 2,
			});
			const episodeFrames: DemonstrationEvidenceFrame[] = [];
			for (const frame of framePlan) {
				const outputPath = join(frameOutputDir, frame.fileName);
				await frameExtractor({
					videoPath,
					ffmpegPath,
					timestampMs: frame.timestampMs ?? 0,
					outputPath,
				});
				const evidenceFrame: DemonstrationEvidenceFrame = {
					path: outputPath,
					mimeType: detectFrameMimeType(outputPath),
					timestampMs: frame.timestampMs,
					label: frame.label,
					kind: frame.kind,
					episodeId: frame.episodeId,
				};
				episodeFrames.push(evidenceFrame);
				keyframes.push(evidenceFrame);
				if (keyframes.length >= maxKeyframes) {
					break;
				}
			}
			episodes.push({
				id: episodeId,
				startMs: window.startMs,
				endMs: window.endMs,
				centerMs: window.centerMs,
				label: window.label,
				triggerTypes: window.triggerTypes,
				source: window.source,
				app: window.app,
				windowTitle: window.windowTitle,
				sourceEventIds: window.sourceEventIds,
				keyframes: episodeFrames,
			});
			if (keyframes.length >= maxKeyframes) {
				break;
			}
		}
		if (keyframes.length === 0) {
			throw new Error("Evidence pack generation did not extract any keyframes.");
		}
		const analysisMode: DemonstrationEvidencePack["analysisMode"] =
			events.length > 0 ? "event_guided_evidence_pack" : "adaptive_evidence_pack";
		return {
			videoPath,
			sourceLabel,
			durationMs,
			analysisMode,
			events,
			episodes,
			keyframes,
			summary: buildEvidenceSummary({
				analysisMode,
				sourceLabel,
				durationMs,
				eventCount: events.length,
				episodeCount: episodes.length,
				keyframeCount: keyframes.length,
			}),
			tempDir: keyframeOutputDir ? undefined : frameOutputDir,
		};
	} catch (error) {
		await rm(frameOutputDir, { recursive: true, force: true }).catch(() => {});
		throw error;
	}
}

function summarizeEventsForPrompt(events: DemonstrationEvent[]): string[] {
	return events
		.map((event) => {
			const parts = [
				formatTimestampMs(event.timestampMs),
				event.type,
				event.source ? `source=${event.source}` : undefined,
				event.importance ? `importance=${event.importance}` : undefined,
				event.app,
				event.windowTitle,
				event.target,
				event.modifiers && event.modifiers.length > 0 ? `mods=${event.modifiers.join("+")}` : undefined,
				event.keyCode !== undefined ? `keyCode=${event.keyCode}` : undefined,
				event.detail,
			].filter(Boolean);
			return `- ${parts.join(" | ")}`;
		});
}

function selectRepresentativePromptEvents(pack: DemonstrationEvidencePack): DemonstrationEvent[] {
	if (pack.events.length <= MAX_PROMPT_EVENTS) {
		return pack.events;
	}
	const scoreEvent = (event: DemonstrationEvent): number =>
		scoreDemonstrationEvent(event) +
		(event.source === "workspace" ? 8 : 0) +
		(event.windowTitle ? 6 : 0);
	const selected: DemonstrationEvent[] = [];
	const addEvent = (event: DemonstrationEvent | undefined) => {
		if (!event) {
			return;
		}
		if (selected.some((entry) => entry.id === event.id || (entry.timestampMs === event.timestampMs && entry.type === event.type))) {
			return;
		}
		selected.push(event);
	};
	addEvent(pack.events[0]);
	for (const episode of pack.episodes.slice(0, MAX_PROMPT_EPISODES)) {
		const episodeEvents = pack.events.filter((event) =>
			(episode.sourceEventIds && event.id ? episode.sourceEventIds.includes(event.id) : false)
			|| (event.timestampMs >= episode.startMs && event.timestampMs <= episode.endMs),
		);
		const best = episodeEvents
			.slice()
			.sort((left, right) => scoreEvent(right) - scoreEvent(left) || left.timestampMs - right.timestampMs)[0];
		addEvent(best);
	}
	addEvent(pack.events.at(-1));
	return selected
		.sort((left, right) => left.timestampMs - right.timestampMs)
		.slice(0, MAX_PROMPT_EVENTS);
}

function buildPrompt(params: {
	sourceLabel: string;
	objectiveHint?: string;
	evidencePack: DemonstrationEvidencePack;
	capabilitySnapshot?: TeachCapabilitySnapshot;
}): string {
	const promptEvents = selectRepresentativePromptEvents(params.evidencePack);
	const episodeSummary = params.evidencePack.episodes
		.slice(0, MAX_PROMPT_EPISODES)
		.map((episode) => ({
			id: episode.id,
			window: `${formatTimestampMs(episode.startMs)} -> ${formatTimestampMs(episode.endMs)}`,
			label: episode.label,
			source: episode.source,
			trigger_types: episode.triggerTypes,
			app: episode.app,
			window_title: episode.windowTitle,
			keyframes: episode.keyframes.map((frame) => ({
				time: formatTimestampMs(frame.timestampMs),
				kind: frame.kind,
				label: frame.label,
			})),
		}));
		return [
			"You are extracting a reusable Understudy teach draft from a GUI demonstration.",
			"The canonical artifact is the demonstration video; the attached keyframes are derived evidence slices, not the full task contract.",
			"Treat the video timeline, episode windows, and keyframe ordering as a single event-guided demonstration record.",
		`Source: ${params.sourceLabel}`,
		...(params.objectiveHint ? [`User hint: ${params.objectiveHint}`] : []),
		`Evidence mode: ${params.evidencePack.analysisMode}`,
		`Episodes: ${params.evidencePack.episodes.length}`,
		`Keyframes: ${params.evidencePack.keyframes.length}`,
		`Imported events: ${params.evidencePack.events.length}`,
		...(params.evidencePack.durationMs ? [`Approximate duration: ${formatTimestampMs(params.evidencePack.durationMs)}`] : []),
		`Evidence summary: ${params.evidencePack.summary}`,
		"Episode summary JSON:",
		JSON.stringify(episodeSummary, null, 2),
		...(params.capabilitySnapshot
			? formatTeachCapabilitySnapshotForPrompt(params.capabilitySnapshot)
			: []),
		...(promptEvents.length > 0
			? [
				"Representative event timeline excerpt:",
				"(Event targets below are accessibility-derived labels from the OS. Map these to visual descriptions in your output steps — e.g. 'AXButton | Save' should become 'button labeled \"Save\"'.)",
				...summarizeEventsForPrompt(promptEvents),
			]
			: []),
			"Return strict JSON only.",
			"toolName may be any exact runtime function name from the capability snapshot. The schema examples below are illustrative, not an allowlist.",
			"Separate the semantic workflow from the observed GUI replay details.",
			"`procedure` should be the natural-language staged workflow.",
			"`steps` should stay close to the observed demonstration replay path after removing recording noise. For GUI demos, preserve GUI-oriented replay details here instead of rewriting them into a more abstract browser or shell path.",
			"Put higher-level or more efficient alternatives into `executionPolicy` and `stepRouteOptions`, not into `steps`.",
			"Prefer the most efficient semantically equivalent route in `executionPolicy` and `stepRouteOptions`. If browser, bash, or an existing skill could achieve the same externally visible result more directly and reliably for an agent, prefer that route there even when the demonstration happened through the GUI.",
			"Use gui_* steps in `steps` when the demonstration used direct UI interaction, and use gui_* routes in `stepRouteOptions` when a GUI reference path should remain available.",
			"If an existing workspace skill cleanly covers a subtask, prefer that skill over replaying the same work via lower-level functions.",
			"For each major procedure step, inspect the capability snapshot and include the best available candidates in stepRouteOptions. If multiple materially different routes are viable, list them there.",
			"When the demo clearly showed a GUI route for a procedure step, keep a GUI observed or fallback option for that step in `stepRouteOptions` even if a non-GUI route is preferred.",
			"If shell execution tools such as `exec` or `bash` are available, explicitly consider whether a shell command could produce the same externally visible result as the GUI step, especially for native desktop app automation or file/system actions.",
			"stepRouteOptions should be chosen from the listed capabilities, not invented from unstated assumptions.",
			"Do not output pixel coordinates. Describe targets, scopes, inputs, and visible verification in semantic terms.",
			"",
			"Target-description rules (critical for grounding accuracy during replay):",
			'When a control has visible text, QUOTE it: \'button labeled "Save"\', \'menu item "Export as PDF"\', \'tab titled "Settings"\'. Do NOT write generic descriptions like "the save button".',
			'For icon-only controls, describe the icon: \'gear icon button\', \'red circular close button\', \'magnifying glass icon\'.',
			'For list/table/tree/sidebar items, cite the row text: \'the row containing "report.pdf"\', \'sidebar item "Downloads"\', \'cell showing "$150.00"\'.',
			'For text fields, reference placeholder or content: \'search field with placeholder "Search..."\', \'the "Name" text field\'.',
			'For checkboxes/toggles, include the label: \'checkbox labeled "Remember me"\', \'toggle next to "Dark mode"\'.',
			'When a control has visual state (selected, disabled, checked), describe it: \'the selected "Network" tab\', \'disabled "Save" button\'.',
			'For empty-area targets: \'the empty desktop area\', \'blank area below the last file\'.',
			"Include the control role (button, link, checkbox, toggle, slider, input, menu item, etc.) and nearby context when they reduce ambiguity.",
			'Use scope for window/panel/dialog hints: \'Save As dialog\', \'left sidebar\', \'macOS top menu bar\'.',
			'Set captureMode to "display" for desktop-wide surfaces (menu bar, Dock, cross-window drags) and "window" for in-app work.',
			'Set groundingMode to "complex" for dense UIs (spreadsheets, code editors) or when multiple similar controls are visible.',
			"For gui_scroll targets, name the scrollable container, not a heading within it.",
			'For hover-only interactions, use gui_click with button: "none" instead of gui_move.',
			"For gui_key, use key names like Enter, Tab, Escape, Space, Delete, ArrowDown. For modifier combos, also use gui_key.",
			"Preserve exact replay-only tool parameters such as button, clicks, holdMs, windowSelector, fromTarget/toTarget, wait state, repeat, and modifiers inside steps[].toolArgs instead of dropping them.",
			"",
			"Choose artifactKind explicitly when the demo is clearly a higher-level reusable artifact: default to skill, use playbook for a staged production pipeline, and use worker only for goal-driven open-ended work.",
			"If artifactKind is worker, include workerContract with goal, inputs, outputs, allowed routes/surfaces, budget, escalation policy, stop conditions, and decision heuristics.",
			"If artifactKind is playbook, include childArtifacts and playbookStages. childArtifacts may reference skill or worker children. playbookStages should be an ordered linear stage plan.",
			"If a playbook stage needs approval, use approvalGate as a short reusable gate name such as delivery_preview, publish_preview, payment_review, or legal_review. Use none only when the approval stage does not need a named gate.",
			"Your first decision is taskKind. Choose exactly one: fixed_demo, parameterized_workflow, or batch_workflow.",
			"If taskKind is fixed_demo, parameterSlots must be empty and taskCard.inputs must be empty. Keep the exact demonstrated objective rather than inventing reusable parameters.",
			"If taskKind is parameterized_workflow, do not hard-code the demo's literal value as the only supported input. Use parameterSlots and semantic procedure wording instead.",
			"If taskKind is batch_workflow, taskCard.loopOver must be populated and the procedure should describe the repeated unit of work.",
			"Execution policy is separate from the raw observed steps. Default to toolBinding=adaptive unless the route itself is part of the task semantics.",
			"Use preferredRoutes to express the global route preference. Usually prefer skill -> browser -> shell -> gui when they preserve the same externally visible outcome.",
			"Use stepInterpretation=fallback_replay by default. Only use strict_contract when the exact route/tool sequence is semantically required.",
			"stepRouteOptions are non-binding implementation choices for specific procedure steps.",
			"Use stepRouteOptions when a simpler structured route exists than the observed GUI route, or when there are meaningful alternatives such as skill vs shell vs gui.",
			"Use preference=preferred for the best route, fallback for a backup route, and observed for what the demo literally showed.",
			"Remove recording-control noise such as returning to Understudy, typing `/teach stop`, or handling Ctrl+C unless the user hint explicitly says those actions are part of the task.",
			"When possible, output a reusable task card, a semantic high-level procedure, replay preconditions, reset signals, and references to existing workspace skill dependencies rather than only low-level UI steps.",
			'Schema: {"title":"...","objective":"...","summary":"...","artifactKind":"skill|worker|playbook","taskKind":"fixed_demo|parameterized_workflow|batch_workflow","parameterSlots":[{"name":"...","label":"...","sampleValue":"...","required":true,"notes":"..."}],"successCriteria":["..."],"openQuestions":["..."],"replayPreconditions":["..."],"resetSignals":["..."],"taskCard":{"goal":"...","scope":"...","loopOver":"...","inputs":["..."],"extract":["..."],"formula":"...","filter":"...","output":"..."},"procedure":[{"instruction":"...","kind":"navigate|extract|transform|filter|output|skill|check","skillName":"optional-skill-name","notes":"...","uncertain":false}],"executionPolicy":{"toolBinding":"adaptive|fixed","preferredRoutes":["skill","browser","shell","gui"],"stepInterpretation":"evidence|fallback_replay|strict_contract","notes":["..."]},"stepRouteOptions":[{"procedureStepId":"procedure-1","route":"skill|browser|shell|gui","preference":"preferred|fallback|observed","instruction":"...","toolName":"exact-available-tool-name","skillName":"optional-skill-name","when":"...","notes":"..."}],"skillDependencies":[{"name":"...","reason":"...","required":true}],"childArtifacts":[{"id":"child-1","name":"...","artifactKind":"skill|worker","objective":"...","required":true,"reason":"..."}],"playbookStages":[{"id":"stage-1","name":"...","kind":"skill|worker|inline|approval","refName":"optional-child-name","objective":"...","inputs":["..."],"outputs":["..."],"budgetNotes":["..."],"retryPolicy":"retry_once|skip_with_note|pause_for_human","approvalGate":"none|delivery_preview|publish_preview|payment_review"}],"workerContract":{"goal":"...","scope":"...","inputs":["..."],"outputs":["..."],"allowedRoutes":["skill","browser","shell","gui"],"allowedSurfaces":["..."],"budget":{"maxMinutes":12,"maxActions":60,"maxScreenshots":12},"escalationPolicy":["..."],"stopConditions":["..."],"decisionHeuristics":["..."]},"steps":[{"route":"gui|browser|shell|web|workspace|memory|messaging|automation|system|custom","toolName":"exact-available-tool-name","instruction":"...","summary":"...","target":"...","app":"...","scope":"...","locationHint":"...","windowTitle":"...","captureMode":"window|display","groundingMode":"single|complex","inputs":{"key":"value"},"toolArgs":{"button":"right","windowSelector":{"titleContains":"Draft"}},"verificationSummary":"...","uncertain":false}]}',
			"If the demonstration leaves gaps, record them in openQuestions and mark the affected step uncertain=true.",
		].join("\n");
	}

function buildCapabilitySelectionPrompt(params: {
	analysis: VideoTeachAnalysis;
	capabilitySnapshot: TeachCapabilitySnapshot;
}): string {
	const distilledDraft = {
		title: params.analysis.title,
		objective: params.analysis.objective,
		taskKind: params.analysis.taskKind,
		taskCard: params.analysis.taskCard,
		procedure: params.analysis.procedure,
		observedReferenceSteps: params.analysis.steps,
		executionPolicy: params.analysis.executionPolicy,
		stepRouteOptions: params.analysis.stepRouteOptions,
		skillDependencies: params.analysis.skillDependencies,
	};
	return [
		"You are refining route selection for an Understudy teach draft.",
		"The semantic workflow is already extracted. Do not rewrite the task itself.",
		"The `procedure` is the canonical staged workflow.",
		"The `observedReferenceSteps` are the GUI-oriented replay reference path from the demonstration. Keep those as reference-only context; do not try to replace them here.",
		"Your job is to choose the best non-binding implementation options from the current capability snapshot.",
		...(formatTeachCapabilitySnapshotForPrompt(params.capabilitySnapshot)),
		"Current extracted draft JSON:",
		JSON.stringify(distilledDraft, null, 2),
		"Return strict JSON only.",
		"Rules:",
		"- Consider the full capability snapshot before choosing options. Do not anchor on only browser/bash/gui.",
		"- Use `stepRouteOptions` to list concrete route choices for procedure steps.",
		"- Try to provide at least one preferred route for every procedure step that needs an implementation choice.",
		"- If a clearly matching workspace skill exists, include it as a skill route and add it to skillDependencies.",
		"- When the demo visibly showed a GUI route for a procedure step, keep one GUI observed or fallback option for that step when feasible.",
		"- If shell execution tools such as `exec` or `bash` are in the capability snapshot, explicitly consider shell automation as a candidate route when it could preserve the same externally visible result, especially for native desktop-app actions.",
		"- `stepRouteOptions` and `skillDependencies` are reference choices, not strict runtime requirements.",
		"- Use only exact `toolName` and `skillName` values from the capability snapshot.",
		'- Schema: {"executionPolicy":{"toolBinding":"adaptive|fixed","preferredRoutes":["skill","browser","shell","gui"],"stepInterpretation":"evidence|fallback_replay|strict_contract","notes":["..."]},"stepRouteOptions":[{"procedureStepId":"procedure-1","route":"skill|browser|shell|gui","preference":"preferred|fallback|observed","instruction":"...","toolName":"exact-available-tool-name","skillName":"optional-skill-name","when":"...","notes":"..."}],"skillDependencies":[{"name":"...","reason":"...","required":true}]}',
	].join("\n");
}

function parseAnalysis(params: {
	payload: Record<string, unknown>;
	sourceLabel: string;
	provider: string;
	model: string;
	evidencePack: DemonstrationEvidencePack;
	capabilitySnapshot?: TeachCapabilitySnapshot;
}): VideoTeachAnalysis {
	const availableToolNames = params.capabilitySnapshot
		? new Set(params.capabilitySnapshot.tools.map((tool) => tool.name))
		: undefined;
	const toolRoutes = params.capabilitySnapshot
		? new Map(
			params.capabilitySnapshot.tools
				.filter((tool) => tool.executionRoute)
				.map((tool) => [tool.name, tool.executionRoute!] as const),
		)
		: undefined;
	const steps = normalizeSteps(params.payload.steps, {
		availableToolNames,
		toolRoutes,
	});
	if (steps.length === 0) {
		throw new Error("Video teach analysis did not return any usable steps.");
	}
	const procedure = normalizeProcedure(params.payload.procedure);
	const parameterSlots = normalizeParameterSlots(params.payload.parameterSlots);
	const title =
		asString(params.payload.title) ??
		asString(params.payload.objective) ??
		`Teach from ${params.sourceLabel}`;
	const objective =
		asString(params.payload.objective) ??
		asString(params.payload.intent) ??
		title;
	const taskKind = inferTaskKind({
		payloadTaskKind: normalizeTaskKind(params.payload.taskKind),
		objective,
		taskCard: normalizeTaskCard(params.payload.taskCard),
		parameterSlots,
		procedure,
		steps,
	});
	const effectiveParameterSlots = taskKind === "fixed_demo" ? [] : parameterSlots;
	const taskCard = alignTaskCardToTaskKind({
		taskCard: normalizeTaskCard(params.payload.taskCard),
		taskKind,
		parameterSlots: effectiveParameterSlots,
	});
	const skillDependencies = normalizeSkillDependencies(params.payload.skillDependencies);
	const artifactKind = normalizeArtifactKind(params.payload.artifactKind);
	const childArtifacts = artifactKind === "playbook"
		? normalizeChildArtifacts(params.payload.childArtifacts)
		: [];
	const playbookStages = artifactKind === "playbook"
		? normalizePlaybookStages(params.payload.playbookStages)
		: [];
	const workerContract = artifactKind === "worker"
		? normalizeWorkerContract(params.payload.workerContract)
		: undefined;
	const resolvedProcedure = procedure.length > 0
		? procedure
		: steps.map((step, index) => ({
			id: `procedure-${index + 1}`,
			index: index + 1,
			instruction: step.instruction,
			...(step.toolName === "browser" || step.toolName === "bash"
				? { kind: "navigate" as const }
				: {}),
		}));
	const stepRouteOptions = normalizeStepRouteOptions(params.payload.stepRouteOptions, {
		procedure: resolvedProcedure,
		steps,
	});
	const executionPolicy = normalizeExecutionPolicy(params.payload.executionPolicy, {
		steps,
		skillDependencies,
	});
	return {
		title,
		objective,
		summary: asString(params.payload.summary),
		...(artifactKind ? { artifactKind } : {}),
		taskKind,
		parameterSlots: effectiveParameterSlots,
		successCriteria: normalizeLineList(params.payload.successCriteria),
		openQuestions: normalizeLineList(params.payload.openQuestions),
		taskCard,
		procedure: resolvedProcedure,
		executionPolicy,
		stepRouteOptions,
		replayPreconditions: normalizeReplayHints(params.payload.replayPreconditions),
		resetSignals: normalizeReplayHints(params.payload.resetSignals),
		skillDependencies,
		...(childArtifacts.length > 0 ? { childArtifacts } : {}),
		...(playbookStages.length > 0 ? { playbookStages } : {}),
		...(workerContract ? { workerContract } : {}),
		steps,
		provider: params.provider,
		model: params.model,
		sourceLabel: params.sourceLabel,
		analysisMode: params.evidencePack.analysisMode,
		episodeCount: params.evidencePack.episodes.length,
		keyframeCount: params.evidencePack.keyframes.length,
		eventCount: params.evidencePack.events.length,
		evidenceSummary: params.evidencePack.summary,
		durationMs: params.evidencePack.durationMs,
		keyframes: params.evidencePack.tempDir
			? undefined
			: params.evidencePack.keyframes.map((frame) => ({ ...frame })),
	};
}

function mergeSkillDependencies(
	base: TaughtTaskSkillDependency[],
	incoming: TaughtTaskSkillDependency[],
): TaughtTaskSkillDependency[] {
	const merged = new Map<string, TaughtTaskSkillDependency>();
	for (const dependency of [...base, ...incoming]) {
		const name = dependency.name.trim();
		const existing = merged.get(name);
		if (!existing) {
			merged.set(name, {
				name,
				required: dependency.required,
				...(dependency.reason ? { reason: dependency.reason } : {}),
			});
			continue;
		}
		merged.set(name, {
			name,
			required: existing.required || dependency.required,
			...(existing.reason || dependency.reason
				? { reason: existing.reason ?? dependency.reason }
				: {}),
		});
	}
	return Array.from(merged.values());
}

function parseCapabilitySelection(params: {
	payload: Record<string, unknown>;
	analysis: VideoTeachAnalysis;
}): VideoTeachCapabilitySelection {
	const parsedSkillDependencies = normalizeSkillDependencies(params.payload.skillDependencies);
	const explicitStepRouteOptions = Array.isArray(params.payload.stepRouteOptions)
		? normalizeStepRouteOptions(params.payload.stepRouteOptions, {
			procedure: params.analysis.procedure,
			steps: params.analysis.steps,
		})
		: [];
	const inferredSkillDependencies = normalizeSkillDependencies(
		explicitStepRouteOptions
			.filter((option) => option.route === "skill" && option.skillName)
			.map((option) => ({
				name: option.skillName!,
				reason: option.instruction,
				required: false,
			})),
	);
	const skillDependencies = mergeSkillDependencies(
		params.analysis.skillDependencies,
		mergeSkillDependencies(parsedSkillDependencies, inferredSkillDependencies),
	);
	const executionPolicy = Object.prototype.hasOwnProperty.call(params.payload, "executionPolicy")
		? normalizeExecutionPolicy(params.payload.executionPolicy, {
			steps: params.analysis.steps,
			skillDependencies,
		})
		: params.analysis.executionPolicy;
	return {
		executionPolicy,
		stepRouteOptions: explicitStepRouteOptions.length > 0 ? explicitStepRouteOptions : params.analysis.stepRouteOptions,
		skillDependencies,
	};
}

function applyCapabilitySelection(params: {
	analysis: VideoTeachAnalysis;
	payload: Record<string, unknown>;
}): VideoTeachAnalysis {
	const selection = parseCapabilitySelection(params);
	return {
		...params.analysis,
		executionPolicy: selection.executionPolicy,
		stepRouteOptions: selection.stepRouteOptions,
		skillDependencies: selection.skillDependencies,
	};
}

async function requestJsonViaResponsesApi(params: {
	fetchImpl: typeof fetch;
	baseUrl: string;
	apiKey: string;
	providerName: string;
	model: string;
	maxOutputTokens: number;
	controller: AbortController;
	promptText: string;
	imageBlocks?: Array<Record<string, unknown>>;
}): Promise<Record<string, unknown>> {
	let lastError: Error | undefined;
	let needsJsonRetryInstruction = false;
	for (let attempt = 1; attempt <= MODEL_REQUEST_MAX_ATTEMPTS; attempt += 1) {
		const content: Array<Record<string, unknown>> = [
			{
				type: "input_text",
				text: [
					params.promptText,
					needsJsonRetryInstruction ? INVALID_JSON_RETRY_INSTRUCTION : undefined,
				].filter(Boolean).join("\n"),
			},
			...(params.imageBlocks ?? []),
		];
		try {
			const response = await params.fetchImpl(params.baseUrl, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${params.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: params.model,
					max_output_tokens: params.maxOutputTokens,
					input: [
						{
							role: "user",
							content,
						},
					],
				}),
				signal: params.controller.signal,
			});
			const payload = await response.json().catch(() => ({}));
			if (!response.ok) {
				const message =
					asString(asRecord(asRecord(payload)?.error)?.message) ||
					extractResponseText(payload) ||
					`HTTP ${response.status}`;
				throw new Error(`${params.providerName} video teach request failed: ${message}`);
			}
			const jsonText = extractResponseText(payload);
			return extractJsonObject(jsonText, "Video teach response");
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			const parseFailure =
				lastError.message.includes("Video teach response") ||
				lastError.message.includes("JSON");
			if (parseFailure) {
				needsJsonRetryInstruction = true;
			}
			if (attempt >= MODEL_REQUEST_MAX_ATTEMPTS || (!parseFailure && isNonRetryableModelRequestError(lastError))) {
				throw lastError;
			}
			await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
		}
	}
	throw lastError ?? new Error("Video teach analysis did not return a usable response.");
}

async function requestJsonViaSession(params: {
	loadedConfig: UnderstudyConfig;
	cwd: string;
	provider: string;
	model: string;
	thinkingLevel?: UnderstudyConfig["defaultThinkingLevel"];
	promptText: string;
	images?: Array<Record<string, string>>;
}): Promise<Record<string, unknown>> {
	let lastParseError: Error | undefined;
	for (let attempt = 1; attempt <= 2; attempt += 1) {
		const sessionConfig: UnderstudyConfig = {
			...params.loadedConfig,
			defaultProvider: params.provider,
			defaultModel: params.model,
			defaultThinkingLevel: params.thinkingLevel ?? params.loadedConfig.defaultThinkingLevel ?? "off",
		};
		const sessionResult = await createUnderstudySession({
			cwd: params.cwd,
			config: sessionConfig,
		});
		try {
			await sessionResult.session.prompt(
				[
					params.promptText,
					attempt === 1 ? undefined : INVALID_JSON_RETRY_INSTRUCTION,
				].filter(Boolean).join("\n"),
				params.images?.length ? { images: params.images } : undefined,
			);
			const jsonText = extractLatestAssistantText(sessionResult.session.agent.state.messages) ?? "";
			try {
				return extractJsonObject(jsonText, "Video teach response");
			} catch (error) {
				lastParseError = error instanceof Error ? error : new Error(String(error));
				if (attempt === 2) {
					throw lastParseError;
				}
			}
		} finally {
			await sessionResult.runtimeSession.close();
		}
	}
	throw lastParseError ?? new Error("Video teach analysis did not return a usable response.");
}

export function createResponsesApiVideoTeachAnalyzer(
	options: ResponsesApiVideoTeachAnalyzerOptions,
): VideoTeachAnalyzer {
	const apiKey = options.apiKey?.trim();
	if (!apiKey) {
		throw new Error(`${options.providerName} video teach analyzer requires an API key.`);
	}
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = Math.max(1_000, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
	const maxOutputTokens = Math.max(512, Math.floor(options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS));
	const evidenceBuilder = options.evidenceBuilder ?? ((params: VideoTeachAnalyzerRequest) => buildDemonstrationEvidencePack(params, options));

	return {
		async analyze(params: VideoTeachAnalyzerRequest): Promise<VideoTeachAnalysis> {
			const videoPath = resolve(params.videoPath);
			const sourceLabel = params.sourceLabel?.trim() || basename(videoPath);
			const evidencePack = await evidenceBuilder({
				...params,
				videoPath,
				sourceLabel,
			});
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const imageBlocks: Array<Record<string, unknown>> = [];
				for (const [index, frame] of evidencePack.keyframes.entries()) {
					const bytes = await readFile(frame.path);
					if (bytes.byteLength > DEFAULT_MAX_FRAME_BYTES) {
						throw new Error(`Extracted keyframe exceeds ${DEFAULT_MAX_FRAME_BYTES} bytes: ${frame.path}`);
					}
					const mimeType = frame.mimeType?.trim() || detectFrameMimeType(frame.path);
					imageBlocks.push({
						type: "input_text",
						text: `Keyframe ${index + 1} for ${frame.episodeId ?? "episode"} at ~${formatTimestampMs(frame.timestampMs)} (${frame.kind ?? "context"}). ${frame.label ?? ""}`.trim(),
					});
					imageBlocks.push({
						type: "input_image",
						image_url: buildDataUrl(mimeType, bytes),
					});
				}
				const parsed = await requestJsonViaResponsesApi({
					fetchImpl,
					baseUrl: options.baseUrl,
					apiKey,
					providerName: options.providerName,
					model: options.model,
					maxOutputTokens,
					controller,
					promptText: buildPrompt({
						sourceLabel,
						objectiveHint: params.objectiveHint,
						evidencePack,
						capabilitySnapshot: params.capabilitySnapshot,
					}),
					imageBlocks,
				});
				let analysis = parseAnalysis({
					payload: parsed,
					sourceLabel,
					provider: options.providerName,
					model: options.model,
					evidencePack,
					capabilitySnapshot: params.capabilitySnapshot,
				});
				if (params.capabilitySnapshot && analysis.procedure.length > 0) {
					try {
						const selectionPayload = await requestJsonViaResponsesApi({
							fetchImpl,
							baseUrl: options.baseUrl,
							apiKey,
							providerName: options.providerName,
							model: options.model,
							maxOutputTokens,
							controller,
							promptText: buildCapabilitySelectionPrompt({
								analysis,
								capabilitySnapshot: params.capabilitySnapshot,
							}),
						});
						analysis = applyCapabilitySelection({
							analysis,
							payload: selectionPayload,
						});
					} catch {
						// Capability route selection is best-effort refinement.
					}
				}
				return analysis;
			} finally {
				clearTimeout(timeout);
				if (evidencePack.tempDir) {
					await rm(evidencePack.tempDir, { recursive: true, force: true }).catch(() => {});
				}
			}
		},
	};
}

export function createSessionVideoTeachAnalyzer(
	options: SessionVideoTeachAnalyzerOptions = {},
): VideoTeachAnalyzer {
	const evidenceBuilder = options.evidenceBuilder ?? ((params: VideoTeachAnalyzerRequest) => buildDemonstrationEvidencePack(params, options));

	return {
		async analyze(params: VideoTeachAnalyzerRequest): Promise<VideoTeachAnalysis> {
			const videoPath = resolve(params.videoPath);
			const sourceLabel = params.sourceLabel?.trim() || basename(videoPath);
			const evidencePack = await evidenceBuilder({
				...params,
				videoPath,
				sourceLabel,
			});
			try {
				const loadedConfig = options.config ?? (await ConfigManager.load(options.configPath)).get();
				const provider =
					options.provider?.trim() ||
					loadedConfig.defaultProvider ||
					DEFAULT_SESSION_PROVIDER;
				const model =
					options.model?.trim() ||
					loadedConfig.defaultModel ||
					DEFAULT_SESSION_MODEL;
				const providerName = options.providerName?.trim() || `${provider}:${model}`;
				const promptText = buildPrompt({
					sourceLabel,
					objectiveHint: params.objectiveHint,
					evidencePack,
					capabilitySnapshot: params.capabilitySnapshot,
				});
				const images: Array<Record<string, string>> = [];
				for (const frame of evidencePack.keyframes) {
					const bytes = await readFile(frame.path);
					if (bytes.byteLength > DEFAULT_MAX_FRAME_BYTES) {
						throw new Error(`Extracted keyframe exceeds ${DEFAULT_MAX_FRAME_BYTES} bytes: ${frame.path}`);
					}
					images.push({
						type: "image",
						mimeType: frame.mimeType?.trim() || detectFrameMimeType(frame.path),
						data: bytes.toString("base64"),
					});
				}
				const cwd = options.cwd?.trim() || process.cwd();
				const parsed = await requestJsonViaSession({
					loadedConfig,
					cwd,
					provider,
					model,
					thinkingLevel: options.thinkingLevel,
					promptText,
					images,
				});
				let analysis = parseAnalysis({
					payload: parsed,
					sourceLabel,
					provider: providerName,
					model,
					evidencePack,
					capabilitySnapshot: params.capabilitySnapshot,
				});
				if (params.capabilitySnapshot && analysis.procedure.length > 0) {
					try {
						const selectionPayload = await requestJsonViaSession({
							loadedConfig,
							cwd,
							provider,
							model,
							thinkingLevel: options.thinkingLevel,
							promptText: buildCapabilitySelectionPrompt({
								analysis,
								capabilitySnapshot: params.capabilitySnapshot,
							}),
						});
						analysis = applyCapabilitySelection({
							analysis,
							payload: selectionPayload,
						});
					} catch {
						// Capability route selection is best-effort refinement.
					}
				}
				return analysis;
			} finally {
				if (evidencePack.tempDir) {
					await rm(evidencePack.tempDir, { recursive: true, force: true }).catch(() => {});
				}
			}
		},
	};
}
