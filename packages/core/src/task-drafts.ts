import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resolveUnderstudyHomeDir } from "./runtime-paths.js";
import { asRecord, asString } from "./value-helpers.js";
import { containsPath, normalizePath } from "./workspace-context.js";

const DEFAULT_MAX_PROMPT_DRAFTS = 3;
const DEFAULT_MAX_PROMPT_STEPS = 4;
const DEFAULT_MAX_DRAFTS_PER_WORKSPACE = 16;
const TRACE_VARIABLE_ARGUMENT_KEYS = new Set([
	"value",
	"text",
	"query",
	"url",
	"path",
	"command",
	"message",
	"subject",
	"body",
	"name",
	"title",
	"input",
	"prompt",
	"to",
]);
const TRACE_HINT_ARGUMENT_KEYS = new Set([
	"target",
	"app",
	"scope",
]);

export interface TaughtTaskDraftParameter {
	name: string;
	label: string;
	sampleValue?: string;
	required: boolean;
	sourceKey?: string;
	source?: "prompt" | "tool_argument";
	notes?: string;
}

export type TaughtTaskKind = "fixed_demo" | "parameterized_workflow" | "batch_workflow";
export type TaughtTaskExecutionRoute = "skill" | "browser" | "shell" | "gui";

export interface TaughtTaskExecutionPolicy {
	toolBinding: "adaptive" | "fixed";
	preferredRoutes: TaughtTaskExecutionRoute[];
	stepInterpretation: "evidence" | "fallback_replay" | "strict_contract";
	notes: string[];
}

export interface TaughtTaskStepRouteOption {
	id: string;
	procedureStepId: string;
	route: TaughtTaskExecutionRoute;
	preference: "preferred" | "fallback" | "observed";
	instruction: string;
	toolName?: string;
	skillName?: string;
	when?: string;
	notes?: string;
}

export interface TaughtTaskDraftStep {
	id: string;
	index: number;
	toolName: string;
	route: string;
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
	verificationStatus?: string;
	verificationSummary?: string;
	uncertain?: boolean;
}

export interface TaughtTaskCard {
	goal?: string;
	scope?: string;
	loopOver?: string;
	inputs: string[];
	extract: string[];
	formula?: string;
	filter?: string;
	output?: string;
}

export interface TaughtTaskProcedureStep {
	id: string;
	index: number;
	instruction: string;
	kind?: "navigate" | "extract" | "transform" | "filter" | "output" | "skill" | "check";
	skillName?: string;
	notes?: string;
	uncertain?: boolean;
}

export interface TaughtTaskSkillDependency {
	name: string;
	reason?: string;
	required: boolean;
}

export interface TaughtTaskDraftRevision {
	revision: number;
	timestamp: number;
	action: "created" | "corrected" | "validated" | "published";
	actor?: "system" | "operator";
	summary?: string;
	changes?: string[];
	note?: string;
}

export interface TaughtTaskDraftPublishedSkill {
	name: string;
	skillDir: string;
	skillPath: string;
	publishedAt: number;
}

export interface TaughtTaskDraftValidationCheck {
	id: string;
	ok: boolean;
	summary: string;
	details?: string;
	source?: "replay" | "draft";
}

export interface TaughtTaskDraftValidation {
	state: "unvalidated" | "validated" | "requires_reset" | "failed";
	updatedAt: number;
	summary: string;
	runId?: string;
	responsePreview?: string;
	checks: TaughtTaskDraftValidationCheck[];
	mode?: "inspection" | "replay";
	usedMutatingTools?: boolean;
	toolNames?: string[];
	mutatingToolNames?: string[];
}

export interface TaughtTaskDraft {
	id: string;
	workspaceDir: string;
	repoRoot?: string;
	sessionId?: string;
	traceId?: string;
	sourceKind?: "run" | "video";
	sourceLabel?: string;
	sourceDetails?: Record<string, unknown>;
	runId: string;
	sourceRunId: string;
	createdAt: number;
	updatedAt: number;
	status: "draft" | "published";
	title: string;
	objective: string;
	intent: string;
	userPromptPreview: string;
	promptPreview: string;
	responsePreview?: string;
	routeSignature: string;
	taskKind: TaughtTaskKind;
	parameterSlots: TaughtTaskDraftParameter[];
	successCriteria: string[];
	openQuestions: string[];
	uncertainties: string[];
	taskCard?: TaughtTaskCard;
	procedure: TaughtTaskProcedureStep[];
	executionPolicy: TaughtTaskExecutionPolicy;
	stepRouteOptions: TaughtTaskStepRouteOption[];
	replayPreconditions: string[];
	resetSignals: string[];
	skillDependencies: TaughtTaskSkillDependency[];
	steps: TaughtTaskDraftStep[];
	validation?: TaughtTaskDraftValidation;
	revisions: TaughtTaskDraftRevision[];
	publishedSkill?: TaughtTaskDraftPublishedSkill;
}

export interface TaughtTaskDraftLedger {
	updatedAt: number;
	workspaceDir: string;
	repoRoot?: string;
	drafts: TaughtTaskDraft[];
}

export interface TaughtTaskDraftLintIssue {
	id: string;
	summary: string;
}

export interface BuildTaughtTaskDraftFromRunOptions {
	workspaceDir: string;
	repoRoot?: string;
	sessionId?: string;
	traceId?: string;
	runId: string;
	promptPreview: string;
	responsePreview?: string;
	toolTrace?: Array<Record<string, unknown>>;
	teachValidation?: Record<string, unknown>;
	title?: string;
	objective?: string;
	now?: number;
}

export interface CreateTaughtTaskDraftRunLike {
	runId: string;
	recordedAt?: number;
	userPromptPreview: string;
	responsePreview?: string;
	toolTrace?: Array<Record<string, unknown>>;
	teachValidation?: Record<string, unknown>;
}

export interface CreateTaughtTaskDraftOptions {
	workspaceDir: string;
	repoRoot?: string;
	sessionId?: string;
	traceId?: string;
	title?: string;
	objective?: string;
	run: CreateTaughtTaskDraftRunLike;
}

export interface CreateTaughtTaskDraftFromVideoOptions {
	workspaceDir: string;
	repoRoot?: string;
	sessionId?: string;
	traceId?: string;
	title?: string;
	objective?: string;
	sourceLabel?: string;
	sourceDetails?: Record<string, unknown>;
	promptPreview?: string;
	responsePreview?: string;
	taskKind?: TaughtTaskKind;
	parameterSlots?: Array<TaughtTaskDraftParameter | string>;
	successCriteria?: string[];
	openQuestions?: string[];
	uncertainties?: string[];
	taskCard?: TaughtTaskCard;
	procedure?: Array<Partial<TaughtTaskProcedureStep> | string>;
	executionPolicy?: TaughtTaskExecutionPolicy;
	stepRouteOptions?: Array<Partial<TaughtTaskStepRouteOption>>;
	replayPreconditions?: string[];
	resetSignals?: string[];
	skillDependencies?: Array<TaughtTaskSkillDependency | string>;
	steps?: Array<Partial<TaughtTaskDraftStep> | string>;
}

export interface LoadPersistedTaughtTaskDraftLedgerOptions {
	workspaceDir: string;
	learningDir?: string;
}

export interface PersistTaughtTaskDraftOptions {
	learningDir?: string;
	maxDraftsPerWorkspace?: number;
}

export interface UpdatePersistedTaughtTaskDraftOptions {
	workspaceDir: string;
	draftId: string;
		patch: {
			title?: string;
			intent?: string;
			objective?: string;
			taskKind?: TaughtTaskKind;
			parameterSlots?: Array<TaughtTaskDraftParameter | string>;
			successCriteria?: string[];
			openQuestions?: string[];
			uncertainties?: string[];
			taskCard?: TaughtTaskCard;
			procedure?: Array<Partial<TaughtTaskProcedureStep> | string>;
			executionPolicy?: TaughtTaskExecutionPolicy;
			stepRouteOptions?: Array<Partial<TaughtTaskStepRouteOption>>;
			replayPreconditions?: string[];
			resetSignals?: string[];
			skillDependencies?: Array<TaughtTaskSkillDependency | string>;
			steps?: Array<Partial<TaughtTaskDraftStep> | string>;
			validation?: TaughtTaskDraftValidation;
			note?: string;
		};
	learningDir?: string;
	note?: string;
	action?: TaughtTaskDraftRevision["action"];
}

export interface ListTaughtTaskDraftsOptions {
	workspaceDir: string;
	learningDir?: string;
}

export interface LoadTaughtTaskDraftOptions {
	workspaceDir: string;
	draftId: string;
	learningDir?: string;
}

export interface PublishTaughtTaskDraftOptions {
	workspaceDir: string;
	draftId: string;
	name?: string;
	learningDir?: string;
	skillsDir?: string;
	overwrite?: boolean;
}

export interface PublishTaughtTaskDraftResult {
	draft: TaughtTaskDraft;
	skill: TaughtTaskDraftPublishedSkill;
}

function matchesLearningWorkspaceScope(params: {
	requestedWorkspaceDir: string;
	payloadWorkspaceDir?: string;
	payloadRepoRoot?: string;
}): boolean {
	const requestedWorkspaceDir = normalizePath(params.requestedWorkspaceDir);
	const payloadWorkspaceDir = normalizePath(params.payloadWorkspaceDir);
	if (!requestedWorkspaceDir || !payloadWorkspaceDir) {
		return false;
	}
	if (requestedWorkspaceDir === payloadWorkspaceDir) {
		return true;
	}
	if (containsPath(requestedWorkspaceDir, payloadWorkspaceDir) || containsPath(payloadWorkspaceDir, requestedWorkspaceDir)) {
		return true;
	}
	const payloadRepoRoot = normalizePath(params.payloadRepoRoot);
	if (!payloadRepoRoot) {
		return false;
	}
	return (
		containsPath(payloadRepoRoot, requestedWorkspaceDir) ||
		containsPath(requestedWorkspaceDir, payloadRepoRoot)
	);
}

function scoreWorkspaceMatch(params: {
	requestedWorkspaceDir: string;
	payloadWorkspaceDir?: string;
	payloadRepoRoot?: string;
}): number {
	const requestedWorkspaceDir = normalizePath(params.requestedWorkspaceDir);
	const payloadWorkspaceDir = normalizePath(params.payloadWorkspaceDir);
	if (!requestedWorkspaceDir || !payloadWorkspaceDir) {
		return -1;
	}
	if (requestedWorkspaceDir === payloadWorkspaceDir) {
		return 10_000 + payloadWorkspaceDir.length;
	}
	if (containsPath(payloadWorkspaceDir, requestedWorkspaceDir)) {
		return 8_000 + payloadWorkspaceDir.length;
	}
	if (containsPath(requestedWorkspaceDir, payloadWorkspaceDir)) {
		return 6_000 + payloadWorkspaceDir.length;
	}
	const payloadRepoRoot = normalizePath(params.payloadRepoRoot);
	if (payloadRepoRoot && containsPath(payloadRepoRoot, requestedWorkspaceDir)) {
		return 4_000 + payloadRepoRoot.length;
	}
	return -1;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | undefined> {
	try {
		await stat(filePath);
		const raw = await readFile(filePath, "utf8");
		return JSON.parse(raw) as T;
	} catch {
		return undefined;
	}
}

async function loadBestMatchingPayload<T extends {
	workspaceDir?: string;
	repoRoot?: string;
}>(params: {
	dirPath: string;
	requestedWorkspaceDir: string;
}): Promise<T | undefined> {
	const names = await readdir(params.dirPath).catch(() => []);
	let best: { payload: T; score: number } | undefined;
	for (const name of names) {
		if (!name.endsWith(".json")) {
			continue;
		}
		const payload = await readJsonIfExists<T>(join(params.dirPath, name));
		if (!payload || !matchesLearningWorkspaceScope({
			requestedWorkspaceDir: params.requestedWorkspaceDir,
			payloadWorkspaceDir: payload.workspaceDir,
			payloadRepoRoot: payload.repoRoot,
		})) {
			continue;
		}
		const score = scoreWorkspaceMatch({
			requestedWorkspaceDir: params.requestedWorkspaceDir,
			payloadWorkspaceDir: payload.workspaceDir,
			payloadRepoRoot: payload.repoRoot,
		});
		if (!best || score > best.score) {
			best = { payload, score };
		}
	}
	return best?.payload;
}

function resolveLearningDir(override?: string): string {
	return override ?? join(resolveUnderstudyHomeDir(), "learning");
}

function buildWorkspaceKey(workspaceDir: string): string {
	return createHash("sha1").update(resolve(workspaceDir)).digest("hex").slice(0, 16);
}

function buildTaskDraftLedgerPath(workspaceDir: string, learningDir?: string): string {
	const effectiveLearningDir = resolveLearningDir(learningDir);
	return join(effectiveLearningDir, "task-drafts", `${buildWorkspaceKey(workspaceDir)}.json`);
}

function stripTimestampEnvelope(promptPreview: string): string {
	return promptPreview.replace(/^\[[^\]]+\]\s*/, "").trim();
}

function truncateText(value: string, maxChars: number = 180): string {
	const trimmed = value.trim();
	return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}...` : trimmed;
}

function humanizeLabel(key: string): string {
	return key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\w/, (char) => char.toUpperCase());
}

function inferProcedureKind(_instruction: string, skillName?: string): TaughtTaskProcedureStep["kind"] {
	if (skillName) {
		return "skill";
	}
	return undefined;
}

const DEFAULT_EXECUTION_ROUTE_ORDER: TaughtTaskExecutionRoute[] = [
	"browser",
	"shell",
	"gui",
];

function normalizeExecutionRoute(value: string | undefined): TaughtTaskExecutionRoute | undefined {
	switch (value?.trim().toLowerCase()) {
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
	values: Array<TaughtTaskExecutionRoute | string> | undefined,
	fallback: TaughtTaskExecutionRoute[],
): TaughtTaskExecutionRoute[] {
	const next = Array.isArray(values)
		? values
			.map((entry) => normalizeExecutionRoute(typeof entry === "string" ? entry : entry))
			.filter((entry): entry is TaughtTaskExecutionRoute => Boolean(entry))
		: [];
	return Array.from(new Set(next.length > 0 ? next : fallback));
}

function inferExecutionPolicy(params: {
	steps: TaughtTaskDraftStep[];
	skillDependencies: TaughtTaskSkillDependency[];
}): TaughtTaskExecutionPolicy {
	const preferredRoutes: TaughtTaskExecutionRoute[] = [
		...(params.skillDependencies.length > 0 ? ["skill" as const] : []),
		...DEFAULT_EXECUTION_ROUTE_ORDER,
	];
	const notes = normalizeLineList([
		"Learn the workflow, not the exact tool sequence.",
		"Prefer semantically equivalent `browser`, `bash`, or linked skill routes before raw GUI replay when they preserve the same externally visible result.",
		"Use step route options as non-binding implementation choices for each major procedure step.",
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
	value: TaughtTaskExecutionPolicy | undefined,
	params: {
		steps: TaughtTaskDraftStep[];
		skillDependencies: TaughtTaskSkillDependency[];
		existing?: TaughtTaskExecutionPolicy;
	},
): TaughtTaskExecutionPolicy {
	const inferred = inferExecutionPolicy({
		steps: params.steps,
		skillDependencies: params.skillDependencies,
	});
	const existing = params.existing ?? inferred;
	if (!value) {
		return existing;
	}
	const notes = normalizeLineList(value.notes).slice(0, 8);
	return {
		toolBinding: value.toolBinding === "fixed" ? "fixed" : "adaptive",
		preferredRoutes: normalizeExecutionRouteList(value.preferredRoutes, existing.preferredRoutes),
		stepInterpretation:
			value.stepInterpretation === "evidence" ||
			value.stepInterpretation === "fallback_replay" ||
			value.stepInterpretation === "strict_contract"
				? value.stepInterpretation
				: existing.stepInterpretation,
		notes: notes.length > 0 ? notes : existing.notes,
	};
}

function areExecutionPolicyEqual(left: TaughtTaskExecutionPolicy, right: TaughtTaskExecutionPolicy): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function formatExecutionRouteOrder(routes: TaughtTaskExecutionRoute[]): string {
	return routes.join(" -> ");
}

function describeDetailedStepUsage(policy: TaughtTaskExecutionPolicy): string {
	switch (policy.stepInterpretation) {
		case "evidence":
			return "Use these structured step details as evidence from the demonstration, not as the only contract.";
		case "strict_contract":
			return "Treat these structured step details as the strict execution contract for this task.";
		default:
			return "Use these structured step details as fallback replay hints when a higher-level route is unavailable or would change the task semantics.";
	}
}

function normalizeRouteOptionPreference(
	value: string | undefined,
): TaughtTaskStepRouteOption["preference"] | undefined {
	switch (value?.trim().toLowerCase()) {
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
	steps: TaughtTaskDraftStep[];
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
		const observedRoute = normalizeExecutionRoute(observedStep.route) ?? normalizeExecutionRoute(observedStep.toolName);
		if (!observedRoute) {
			continue;
		}
		options.push({
			id: `${procedureStep.id}-route-${options.filter((option) => option.procedureStepId === procedureStep.id).length + 1}`,
			procedureStepId: procedureStep.id,
			route: observedRoute,
			preference: "observed",
			instruction: observedStep.instruction,
			toolName: observedStep.toolName,
			notes: observedStep.summary ?? observedStep.verificationSummary,
		});
	}
	return options;
}

function normalizeStepRouteOptions(
	values: Array<Partial<TaughtTaskStepRouteOption>> | undefined,
	params: {
		procedure: TaughtTaskProcedureStep[];
		steps: TaughtTaskDraftStep[];
		existing?: TaughtTaskStepRouteOption[];
	},
): TaughtTaskStepRouteOption[] {
	const inferred = inferStepRouteOptions({
		procedure: params.procedure,
		steps: params.steps,
	});
	if (!Array.isArray(values)) {
		return params.existing ?? inferred;
	}
	const validProcedureIds = new Set(params.procedure.map((step) => step.id));
	const next: TaughtTaskStepRouteOption[] = [];
	for (const [index, value] of values.entries()) {
		const procedureStepId = value.procedureStepId?.trim();
		if (!procedureStepId || !validProcedureIds.has(procedureStepId)) {
			continue;
		}
		const route =
			normalizeExecutionRoute(value.route) ||
			(value.skillName?.trim() ? "skill" : normalizeExecutionRoute(value.toolName));
		if (!route) {
			continue;
		}
		const instruction =
			value.instruction?.trim() ||
			(route === "skill" && value.skillName?.trim()
				? `Delegate this subtask to workspace skill \`${value.skillName.trim()}\`.`
				: `Use the ${route} route for this procedure step.`);
		const preference = normalizeRouteOptionPreference(value.preference) ?? "preferred";
		const skillName = value.skillName?.trim() || undefined;
		if (route === "skill" && !skillName) {
			continue;
		}
		next.push({
			id: value.id?.trim() || `${procedureStepId}-route-${index + 1}`,
			procedureStepId,
			route,
			preference,
			instruction,
			...(value.toolName?.trim() ? { toolName: value.toolName.trim() } : {}),
			...(skillName ? { skillName } : {}),
			...(value.when?.trim() ? { when: value.when.trim() } : {}),
			...(value.notes?.trim() ? { notes: value.notes.trim() } : {}),
		});
	}
	return next;
}

function areStepRouteOptionsEqual(left: TaughtTaskStepRouteOption[], right: TaughtTaskStepRouteOption[]): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function formatStepRouteOptionTarget(option: TaughtTaskStepRouteOption): string {
	if (option.route === "skill" && option.skillName) {
		return `${option.route}/${option.skillName}`;
	}
	return option.toolName ? `${option.route}/${option.toolName}` : option.route;
}

function rankRouteOptionPreference(
	preference: TaughtTaskStepRouteOption["preference"],
): number {
	switch (preference) {
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

function normalizeReferenceMatchTokens(value: string | undefined): string[] {
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

function scoreReferenceStepMatch(queryTokens: string[], step: TaughtTaskDraftStep): number {
	if (queryTokens.length === 0) {
		return 0;
	}
	const stepTokens = new Set(normalizeReferenceMatchTokens([
		step.instruction,
		step.summary,
		step.target,
		step.app,
		step.scope,
		step.locationHint,
		step.windowTitle,
	].filter(Boolean).join(" ")));
	let score = 0;
	for (const token of queryTokens) {
		if (stepTokens.has(token)) {
			score += 1;
		}
	}
	return score;
}

function findDetailedStepForProcedureStep(params: {
	draft: TaughtTaskDraft;
	procedureStep: TaughtTaskProcedureStep;
	preferredToolName?: string;
	preferredInstruction?: string;
}): TaughtTaskDraftStep | undefined {
	const queryTokens = normalizeReferenceMatchTokens([
		params.preferredInstruction,
		params.procedureStep.instruction,
		params.procedureStep.notes,
	].filter(Boolean).join(" "));
	const candidates = params.preferredToolName
		? params.draft.steps.filter((step) => step.toolName === params.preferredToolName)
		: params.draft.steps;
	const scored = (candidates.length > 0 ? candidates : params.draft.steps)
		.map((step) => ({
			step,
			score: scoreReferenceStepMatch(queryTokens, step),
		}))
		.sort((left, right) => right.score - left.score || left.step.index - right.step.index);
	return scored[0]?.step;
}

function buildStagedWorkflowLines(procedure: TaughtTaskProcedureStep[]): string[] {
	return procedure.flatMap((step) => [
		`${step.index}. ${step.instruction}${step.kind === "skill" && step.skillName ? ` (delegate to skill \`${step.skillName}\`)` : ""}`,
		...(step.notes ? [`   Notes: ${step.notes}`] : []),
	]);
}

function buildGuiReferencePathLines(params: {
	draft: TaughtTaskDraft;
	procedure: TaughtTaskProcedureStep[];
}): string[] {
	return params.procedure.flatMap((procedureStep) => {
		const guiOption = params.draft.stepRouteOptions
			.filter((option) => option.procedureStepId === procedureStep.id && option.route === "gui")
			.sort((left, right) => rankRouteOptionPreference(left.preference) - rankRouteOptionPreference(right.preference))[0];
		const observedStep = guiOption?.preference === "observed"
			? undefined
			: !guiOption && (procedureStep.kind === "transform" || procedureStep.kind === "filter")
			? undefined
			: findDetailedStepForProcedureStep({
				draft: params.draft,
				procedureStep,
				preferredToolName: guiOption?.toolName,
				preferredInstruction: guiOption?.instruction,
			});
		const instruction =
			guiOption?.instruction ||
			observedStep?.instruction ||
			procedureStep.instruction;
		const lines = [
			`${procedureStep.index}. ${instruction}`,
		];
		const meta: string[] = [];
		if (guiOption) {
			meta.push(`reference: [${guiOption.preference}] [${formatStepRouteOptionTarget(guiOption)}]`);
			if (guiOption.when) meta.push(`when: ${guiOption.when}`);
			if (guiOption.notes) meta.push(`notes: ${guiOption.notes}`);
		}
		if (observedStep?.target) meta.push(`target: ${observedStep.target}`);
		if (observedStep?.app) meta.push(`app: ${observedStep.app}`);
		if (observedStep?.scope) meta.push(`scope: ${observedStep.scope}`);
		if (meta.length > 0) {
			lines.push(`   ${meta.join(" | ")}`);
		}
		return lines;
	});
}

function buildToolRouteReferenceLines(params: {
	draft: TaughtTaskDraft;
	procedure: TaughtTaskProcedureStep[];
}): string[] {
	const lines: string[] = [];
	for (const step of params.procedure) {
		const options = params.draft.stepRouteOptions.filter((option) => option.procedureStepId === step.id);
		if (options.length === 0) {
			continue;
		}
		lines.push(`${step.index}. ${step.instruction}`);
		lines.push(
			...options.flatMap((option) => [
				`   - [${option.preference}] [${formatStepRouteOptionTarget(option)}] ${option.instruction}`,
				...(option.when ? [`     When: ${option.when}`] : []),
				...(option.notes ? [`     Notes: ${option.notes}`] : []),
			]),
		);
	}
	return lines;
}

function normalizeTaskCard(value: TaughtTaskCard | undefined, existing?: TaughtTaskCard): TaughtTaskCard | undefined {
	if (!value && !existing) {
		return undefined;
	}
	const goal = value?.goal?.trim() || existing?.goal?.trim() || undefined;
	const scope = value?.scope?.trim() || existing?.scope?.trim() || undefined;
	const loopOver = value?.loopOver?.trim() || existing?.loopOver?.trim() || undefined;
	const inputs = normalizeLineList(value?.inputs ?? existing?.inputs ?? []);
	const extract = normalizeLineList(value?.extract ?? existing?.extract ?? []);
	const formula = value?.formula?.trim() || existing?.formula?.trim() || undefined;
	const filter = value?.filter?.trim() || existing?.filter?.trim() || undefined;
	const output = value?.output?.trim() || existing?.output?.trim() || undefined;
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

function buildTaskCardFromDraftSeed(params: {
	title: string;
	objective: string;
	parameterSlots: TaughtTaskDraftParameter[];
	successCriteria: string[];
	procedure: TaughtTaskProcedureStep[];
}): TaughtTaskCard | undefined {
	const inputs = normalizeLineList(params.parameterSlots.map((slot) => slot.label || humanizeLabel(slot.name)));
	const output = normalizeLineList(params.successCriteria)[0];
	return normalizeTaskCard({
		goal: params.objective || params.title,
		scope: "Reusable workflow derived from the demonstration.",
		inputs,
		extract: [],
		...(output ? { output } : {}),
	});
}

function normalizeTaskKind(value: string | undefined): TaughtTaskKind | undefined {
	switch (value?.trim().toLowerCase()) {
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
	taskKind?: TaughtTaskKind;
	objective?: string;
	taskCard?: TaughtTaskCard;
	parameterSlots: TaughtTaskDraftParameter[];
	procedure: TaughtTaskProcedureStep[];
	steps: TaughtTaskDraftStep[];
}): TaughtTaskKind {
	if (params.taskKind) {
		return params.taskKind;
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

function normalizeReplayHintList(values: string[] | undefined): string[] {
	return normalizeLineList(values).slice(0, 12);
}

function alignTaskCardToTaskKind(params: {
	taskCard: TaughtTaskCard | undefined;
	taskKind: TaughtTaskKind;
	parameterSlots: TaughtTaskDraftParameter[];
}): TaughtTaskCard | undefined {
	const taskCard = params.taskCard;
	if (!taskCard) {
		return undefined;
	}
	const derivedInputs = normalizeLineList(
		params.parameterSlots.map((slot) => slot.label || humanizeLabel(slot.name)),
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

function buildProcedureFromSteps(steps: TaughtTaskDraftStep[]): TaughtTaskProcedureStep[] {
	return steps.map((step, index) => {
		const kind = inferProcedureKind(step.instruction);
		return {
			id: `procedure-${index + 1}`,
			index: index + 1,
			instruction: step.instruction,
			...(kind ? { kind } : {}),
			...(step.verificationSummary ? { notes: step.verificationSummary } : {}),
			uncertain: step.uncertain === true,
		};
	});
}

function draftTitleFromPrompt(promptPreview: string): string {
	const raw = stripTimestampEnvelope(promptPreview);
	if (!raw) {
		return "Teach draft";
	}
	const compact = raw.replace(/\s+/g, " ").trim();
	return compact.length <= 72 ? compact : `${compact.slice(0, 72)}...`;
}

function inferRoute(name?: string, explicitRoute?: string): string {
	if (explicitRoute) {
		return explicitRoute;
	}
	if (!name) {
		return "system";
	}
	if (name.startsWith("gui_")) return "gui";
	if (name === "browser") return "browser";
	if (name === "web_search" || name === "web_fetch") return "web";
	if (name === "bash") return "shell";
	if (name === "process") return "process";
	if (name.startsWith("memory_")) return "memory";
	if (name === "schedule") return "schedule";
	if (name === "message_send") return "messaging";
	if (name.startsWith("session") || name.startsWith("sessions_") || name === "subagents") return "session";
	return "system";
}

function summarizeArgumentValue(value: unknown): string | undefined {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > 0 ? truncateText(trimmed, 120) : undefined;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return undefined;
}

function extractStepInputs(args: Record<string, unknown>): Record<string, string> | undefined {
	const entries = Object.entries(args)
		.filter(([key]) => TRACE_VARIABLE_ARGUMENT_KEYS.has(key) || TRACE_HINT_ARGUMENT_KEYS.has(key))
		.map(([key, value]) => [key, summarizeArgumentValue(value)] as const)
		.filter((entry): entry is [string, string] => typeof entry[1] === "string");
	if (entries.length === 0) {
		return undefined;
	}
	return Object.fromEntries(entries);
}

function buildInstruction(toolName: string, args: Record<string, unknown>, fallbackSummary?: string): string {
	const target = asString(args.target);
	const app = asString(args.app);
	const scope = asString(args.scope);
	const value = asString(args.value) ?? asString(args.text) ?? asString(args.query) ?? asString(args.command);
	const suffix = [app, scope].filter(Boolean).join(" / ");
	switch (toolName) {
		case "gui_click":
			return `Click ${target ?? "the target"}${suffix ? ` in ${suffix}` : ""}.`;
		case "gui_right_click":
			return `Right click ${target ?? "the target"}${suffix ? ` in ${suffix}` : ""}.`;
		case "gui_double_click":
			return `Double click ${target ?? "the target"}${suffix ? ` in ${suffix}` : ""}.`;
		case "gui_hover":
			return `Hover ${target ?? "the target"}${suffix ? ` in ${suffix}` : ""}.`;
		case "gui_click_and_hold":
			return `Click and hold ${target ?? "the target"}${suffix ? ` in ${suffix}` : ""}.`;
		case "gui_drag":
			return `Drag ${target ?? "from the source"}${suffix ? ` in ${suffix}` : ""}.`;
		case "gui_scroll":
			return `Scroll ${target ?? scope ?? "the interface"}${app ? ` in ${app}` : ""}.`;
		case "gui_type":
			return `Type ${value ? `"${truncateText(value, 72)}"` : "the required text"}${target ? ` into ${target}` : ""}.`;
		case "gui_keypress":
			return `Press ${value ? `${truncateText(value, 72)}` : "the key"}${app ? ` in ${app}` : ""}.`;
		case "gui_hotkey":
			return `Send shortcut ${value ? `${truncateText(value, 72)}` : "the keyboard shortcut"}${app ? ` in ${app}` : ""}.`;
		case "gui_wait":
			return `Wait for ${target ?? "the expected UI state"}${scope ? ` in ${scope}` : ""}.`;
		case "browser":
			return fallbackSummary ?? `Use browser automation${target ? ` for ${target}` : ""}.`;
		case "web_fetch":
		case "web_search":
			return fallbackSummary ?? `Use ${toolName} to gather the required web information.`;
		case "bash":
			return value ? `Run \`${truncateText(value, 96)}\`.` : (fallbackSummary ?? "Run the required shell command.");
		default:
			return fallbackSummary ?? `Use ${toolName} on the ${inferRoute(toolName)} route.`;
	}
}

function classifyUncertainStep(params: {
	entry: Record<string, unknown>;
	statusInfo?: Record<string, unknown>;
}): boolean {
	if (params.entry.isError === true || typeof params.entry.error === "string") {
		return true;
	}
	const status = asString(params.statusInfo?.code)?.toLowerCase();
	return status === "timeout" || status === "unsupported" || status === "blocked" || status === "not_found" || status === "action_sent";
}

function resolvePairedSteps(toolTrace: Array<Record<string, unknown>>): TaughtTaskDraftStep[] {
	const pendingById = new Map<string, Record<string, unknown>>();
	const pendingByName = new Map<string, Array<Record<string, unknown>>>();
	const steps: TaughtTaskDraftStep[] = [];
	let index = 0;

	const rememberCall = (call: Record<string, unknown>): void => {
		const id = asString(call.id);
		const name = asString(call.name) ?? "unknown";
		if (id) {
			pendingById.set(id, call);
			return;
		}
		const bucket = pendingByName.get(name) ?? [];
		bucket.push(call);
		pendingByName.set(name, bucket);
	};

	const resolveCall = (result: Record<string, unknown>): Record<string, unknown> | undefined => {
		const id = asString(result.id);
		if (id && pendingById.has(id)) {
			const call = pendingById.get(id);
			pendingById.delete(id);
			return call;
		}
		const name = asString(result.name) ?? "unknown";
		const bucket = pendingByName.get(name) ?? [];
		const call = bucket.shift();
		if (bucket.length === 0) {
			pendingByName.delete(name);
		}
		return call;
	};

	for (const entry of toolTrace) {
		const type = asString(entry.type);
		if (type === "toolCall") {
			rememberCall(entry);
			continue;
		}
		if (type !== "toolResult") {
			continue;
		}
		const pairedCall = resolveCall(entry);
		const callArgs = asRecord(pairedCall?.arguments) ?? {};
		const name = asString(entry.name) ?? asString(pairedCall?.name) ?? "unknown";
		const route = inferRoute(name, asString(entry.route));
		const statusInfo = asRecord(entry.status);
		const summary = asString(entry.textPreview) ?? asString(entry.error);
		const instruction = buildInstruction(name, callArgs, summary);
		index += 1;
		steps.push({
			id: `${name}-${index}`,
			index,
			toolName: name,
			route,
			instruction,
			...(summary ? { summary } : {}),
			...(asString(callArgs.target) ? { target: asString(callArgs.target) } : {}),
			...(asString(callArgs.app) ? { app: asString(callArgs.app) } : {}),
			...(asString(callArgs.scope) ? { scope: asString(callArgs.scope) } : {}),
			...(extractStepInputs(callArgs) ? { inputs: extractStepInputs(callArgs) } : {}),
			...(asString(statusInfo?.code) ? { verificationStatus: asString(statusInfo?.code) } : {}),
			...(asString(statusInfo?.summary) ? { verificationSummary: asString(statusInfo?.summary) } : {}),
			uncertain: classifyUncertainStep({ entry, statusInfo }),
		});
	}

	return steps;
}

function buildParameterSlots(steps: TaughtTaskDraftStep[]): TaughtTaskDraftParameter[] {
	const slots: TaughtTaskDraftParameter[] = [];
	const seen = new Set<string>();
	for (const step of steps) {
		const inputs = step.inputs ?? {};
		for (const [key, value] of Object.entries(inputs)) {
			if (!TRACE_VARIABLE_ARGUMENT_KEYS.has(key)) {
				continue;
			}
			const slotName = key.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || key;
			const fingerprint = `${slotName}:${value}`;
			if (seen.has(fingerprint)) {
				continue;
			}
			seen.add(fingerprint);
			slots.push({
				name: slotName,
				label: humanizeLabel(key),
				sampleValue: value,
				required: true,
				sourceKey: key,
				source: "tool_argument",
			});
		}
	}
	return slots.slice(0, 8);
}

function extractPromptQuotedParameterSlots(promptPreview: string): TaughtTaskDraftParameter[] {
	const slots: TaughtTaskDraftParameter[] = [];
	const seen = new Set<string>();
	const patterns = [/"([^"\n]{2,120})"/g, /'([^'\n]{2,120})'/g];
	let index = 0;
	for (const pattern of patterns) {
		for (const match of promptPreview.matchAll(pattern)) {
			const sampleValue = match[1]?.trim();
			if (!sampleValue || seen.has(sampleValue)) {
				continue;
			}
			seen.add(sampleValue);
			index += 1;
			slots.push({
				name: `input_${index}`,
				label: `Prompt Input ${index}`,
				sampleValue,
				required: true,
				source: "prompt",
				notes: "Captured from the taught prompt text.",
			});
		}
	}
	return slots;
}

function collectSuccessCriteria(params: {
	validation?: Record<string, unknown>;
	steps: TaughtTaskDraftStep[];
}): string[] {
	const checks = Array.isArray(asRecord(params.validation)?.checks)
		? (asRecord(params.validation)?.checks as Array<unknown>)
		: [];
	const fromChecks = checks
		.map((entry) => asRecord(entry))
		.filter((entry): entry is Record<string, unknown> => Boolean(entry))
		.filter((entry) => entry.ok !== false)
		.map((entry) => asString(entry.summary))
		.filter((entry): entry is string => Boolean(entry));
	if (fromChecks.length > 0) {
		return Array.from(new Set(fromChecks)).slice(0, 6);
	}
	const fromSteps = params.steps
		.map((step) => step.verificationSummary)
		.filter((entry): entry is string => Boolean(entry));
	return Array.from(new Set(fromSteps)).slice(0, 6);
}

function collectUncertainties(params: {
	validation?: Record<string, unknown>;
	steps: TaughtTaskDraftStep[];
}): string[] {
	const items: string[] = [];
	for (const step of params.steps) {
		if (!step.uncertain) {
			continue;
		}
		if (step.verificationStatus === "action_sent") {
			items.push(`Step ${step.index} only confirmed that the action was sent; visible completion still needs verification.`);
			continue;
		}
		if (step.verificationSummary) {
			items.push(`Step ${step.index} needs attention: ${step.verificationSummary}`);
			continue;
		}
		if (step.summary) {
			items.push(`Step ${step.index} needs attention: ${step.summary}`);
		}
	}
	const checks = Array.isArray(asRecord(params.validation)?.checks)
		? (asRecord(params.validation)?.checks as Array<unknown>)
		: [];
	for (const entry of checks) {
		const record = asRecord(entry);
		if (!record || record.ok !== false) {
			continue;
		}
		const summary = asString(record.summary);
		if (summary) {
			items.push(summary);
		}
	}
	return Array.from(new Set(items)).slice(0, 6);
}

function normalizeLineList(value: string[] | undefined): string[] {
	return Array.from(new Set((value ?? []).map((entry) => entry.trim()).filter(Boolean)));
}

function areStringListsEqual(left: string[], right: string[]): boolean {
	return JSON.stringify(normalizeLineList(left)) === JSON.stringify(normalizeLineList(right));
}

function normalizeParameterSlots(values: Array<TaughtTaskDraftParameter | string> | undefined): TaughtTaskDraftParameter[] {
	const slots: TaughtTaskDraftParameter[] = [];
	for (const value of values ?? []) {
		if (typeof value === "string") {
			const [namePart, ...rest] = value.split(":");
			const name = namePart.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
			if (!name) {
				continue;
			}
			slots.push({
				name,
				label: humanizeLabel(name),
				sampleValue: rest.join(":").trim() || undefined,
				required: true,
				source: "tool_argument",
			});
			continue;
		}
		const name = value.name?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
		if (!name) {
			continue;
		}
		slots.push({
			name,
			label: value.label?.trim() || humanizeLabel(name),
			sampleValue: value.sampleValue?.trim() || undefined,
			required: value.required !== false,
			sourceKey: value.sourceKey?.trim() || undefined,
			source: value.source,
			notes: value.notes?.trim() || undefined,
		});
	}
	return slots.slice(0, 12);
}

function areParameterSlotsEqual(left: TaughtTaskDraftParameter[], right: TaughtTaskDraftParameter[]): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeProcedure(
	values: Array<Partial<TaughtTaskProcedureStep> | string> | undefined,
	baseProcedure: TaughtTaskProcedureStep[],
): TaughtTaskProcedureStep[] {
	if (!Array.isArray(values) || values.length === 0) {
		return baseProcedure;
	}
	const next: TaughtTaskProcedureStep[] = [];
	for (const [index, value] of values.entries()) {
		const base = baseProcedure[index] ?? {
			id: `procedure-${index + 1}`,
			index: index + 1,
			instruction:
				typeof value === "string"
					? value.trim()
					: value.instruction?.trim() || "Perform the demonstrated subtask.",
		};
		if (typeof value === "string") {
			const instruction = value.trim();
			if (!instruction) {
				continue;
			}
			const kind = inferProcedureKind(instruction);
			next.push({
				id: `procedure-${next.length + 1}`,
				index: next.length + 1,
				instruction,
				...(kind ? { kind } : {}),
			});
			continue;
		}
		const instruction = value.instruction?.trim() || base.instruction;
		if (!instruction) {
			continue;
		}
		const skillName = value.skillName?.trim() || undefined;
		const kind = value.kind ?? inferProcedureKind(instruction, skillName);
		next.push({
			...base,
			...value,
			id: `procedure-${next.length + 1}`,
			index: next.length + 1,
			instruction,
			...(kind ? { kind } : {}),
			...(skillName ? { skillName } : {}),
			notes: value.notes?.trim() || undefined,
			uncertain: value.uncertain === true,
		});
	}
	return next.length > 0 ? next : baseProcedure;
}

function areProcedureEqual(left: TaughtTaskProcedureStep[], right: TaughtTaskProcedureStep[]): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeSkillDependencies(values: Array<TaughtTaskSkillDependency | string> | undefined): TaughtTaskSkillDependency[] {
	const next: TaughtTaskSkillDependency[] = [];
	for (const value of values ?? []) {
		if (typeof value === "string") {
			const [namePart, ...rest] = value.split(":");
			const name = namePart.trim();
			if (!name) {
				continue;
			}
			next.push({
				name,
				reason: rest.join(":").trim() || undefined,
				required: true,
			});
			continue;
		}
		const name = value.name?.trim();
		if (!name) {
			continue;
		}
		next.push({
			name,
			reason: value.reason?.trim() || undefined,
			required: value.required !== false,
		});
	}
	return next.slice(0, 16);
}

function areSkillDependenciesEqual(left: TaughtTaskSkillDependency[], right: TaughtTaskSkillDependency[]): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function areTaskCardsEqual(left: TaughtTaskCard | undefined, right: TaughtTaskCard | undefined): boolean {
	return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function normalizeSteps(values: Array<Partial<TaughtTaskDraftStep> | string> | undefined, baseSteps: TaughtTaskDraftStep[]): TaughtTaskDraftStep[] {
	if (!Array.isArray(values) || values.length === 0) {
		return baseSteps;
	}
	const next: TaughtTaskDraftStep[] = [];
	for (const [index, value] of values.entries()) {
		const base = baseSteps[index] ?? {
			id: `gui_wait-${index + 1}`,
			index: index + 1,
			toolName:
				typeof value === "string"
					? "gui_wait"
					: value.toolName?.trim() || "gui_wait",
			route:
				typeof value === "string"
					? "gui"
					: value.route?.trim() || "gui",
			instruction:
				typeof value === "string"
					? value.trim()
					: value.instruction?.trim() || value.summary?.trim() || "Wait for the demonstrated UI state to settle.",
		};
		if (typeof value === "string") {
			const instruction = value.trim();
			if (!instruction) {
				continue;
			}
			next.push({
				...base,
				index: next.length + 1,
				id: `${base.toolName}-${next.length + 1}`,
				instruction,
			});
			continue;
		}
		const instruction = value.instruction?.trim() || value.summary?.trim() || base.instruction;
		if (!instruction) {
			continue;
		}
		next.push({
			...base,
			...value,
			index: next.length + 1,
			id: `${base.toolName}-${next.length + 1}`,
			instruction,
		});
	}
	return next.length > 0 ? next : baseSteps;
}

function areStepsEqual(left: TaughtTaskDraftStep[], right: TaughtTaskDraftStep[]): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeValidationCheck(value: TaughtTaskDraftValidationCheck): TaughtTaskDraftValidationCheck | undefined {
	const id = value.id?.trim();
	const summary = value.summary?.trim();
	if (!id || !summary) {
		return undefined;
	}
	return {
		id,
		ok: value.ok !== false,
		summary,
		details: value.details?.trim() || undefined,
		source: value.source === "replay" ? "replay" : value.source === "draft" ? "draft" : undefined,
	};
}

function normalizeValidationState(
	value: TaughtTaskDraftValidation["state"] | undefined,
): TaughtTaskDraftValidation["state"] {
	switch (value) {
		case "validated":
		case "requires_reset":
		case "failed":
			return value;
		default:
			return "unvalidated";
	}
}

function hasOwnValidationField<Value extends object>(value: Value, key: keyof Value): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeValidationOptionalTrimmedField<
	Key extends "runId" | "responsePreview",
>(
	value: TaughtTaskDraftValidation,
	key: Key,
	existing?: TaughtTaskDraftValidation,
): TaughtTaskDraftValidation[Key] {
	if (!hasOwnValidationField(value, key)) {
		return existing?.[key];
	}
	const nextValue = value[key];
	return typeof nextValue === "string" && nextValue.trim().length > 0
		? nextValue.trim()
		: undefined;
}

function normalizeValidationOptionalMode(
	value: TaughtTaskDraftValidation,
	existing?: TaughtTaskDraftValidation,
): TaughtTaskDraftValidation["mode"] {
	if (!hasOwnValidationField(value, "mode")) {
		return existing?.mode;
	}
	return value.mode === "inspection" || value.mode === "replay"
		? value.mode
		: undefined;
}

function normalizeValidationOptionalBoolean(
	value: TaughtTaskDraftValidation,
	key: "usedMutatingTools",
	existing?: TaughtTaskDraftValidation,
): boolean | undefined {
	if (!hasOwnValidationField(value, key)) {
		return existing?.[key];
	}
	return typeof value[key] === "boolean" ? value[key] : undefined;
}

function normalizeValidationOptionalLineList(
	value: TaughtTaskDraftValidation,
	key: "toolNames" | "mutatingToolNames",
	existing?: TaughtTaskDraftValidation,
): string[] | undefined {
	if (!hasOwnValidationField(value, key)) {
		return existing?.[key];
	}
	if (!Array.isArray(value[key])) {
		return undefined;
	}
	return normalizeLineList(value[key]);
}

function normalizeValidation(
	value: TaughtTaskDraftValidation | undefined,
	existing?: TaughtTaskDraftValidation,
): TaughtTaskDraftValidation | undefined {
	if (!value) {
		return existing;
	}
	const summary = value.summary?.trim() || existing?.summary?.trim() || "Teach draft validation updated.";
	const checks = Array.isArray(value.checks)
		? value.checks
			.map((entry) => normalizeValidationCheck(entry))
			.filter((entry): entry is TaughtTaskDraftValidationCheck => Boolean(entry))
		: (existing?.checks ?? []);
	return {
		state: normalizeValidationState(value.state ?? existing?.state),
		updatedAt:
			typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
				? value.updatedAt
				: (existing?.updatedAt ?? Date.now()),
		summary,
		runId: normalizeValidationOptionalTrimmedField(value, "runId", existing),
		responsePreview: normalizeValidationOptionalTrimmedField(value, "responsePreview", existing),
		checks,
		mode: normalizeValidationOptionalMode(value, existing),
		usedMutatingTools: normalizeValidationOptionalBoolean(value, "usedMutatingTools", existing),
		toolNames: normalizeValidationOptionalLineList(value, "toolNames", existing),
		mutatingToolNames: normalizeValidationOptionalLineList(value, "mutatingToolNames", existing),
	};
}

function areValidationEqual(left: TaughtTaskDraftValidation | undefined, right: TaughtTaskDraftValidation | undefined): boolean {
	return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function lintTaughtTaskDraft(draft: TaughtTaskDraft): TaughtTaskDraftLintIssue[] {
	const issues: TaughtTaskDraftLintIssue[] = [];
	if (draft.taskKind === "fixed_demo" && draft.parameterSlots.length > 0) {
		issues.push({
			id: "task-kind:fixed-demo-parameters",
			summary: "Fixed-demo drafts cannot keep parameter slots.",
		});
	}
	if (draft.taskKind === "fixed_demo" && (draft.taskCard?.inputs.length ?? 0) > 0) {
		issues.push({
			id: "task-kind:fixed-demo-inputs",
			summary: "Fixed-demo drafts cannot advertise runtime task-card inputs.",
		});
	}
	if (draft.taskKind === "parameterized_workflow" && draft.parameterSlots.length === 0) {
		issues.push({
			id: "task-kind:parameterized-missing-parameters",
			summary: "Parameterized workflows must define at least one parameter slot.",
		});
	}
	if (draft.taskKind === "batch_workflow" && !draft.taskCard?.loopOver?.trim()) {
		issues.push({
			id: "task-kind:batch-missing-loop",
			summary: "Batch workflows must state what collection or loop target is being iterated.",
		});
	}
	if (draft.procedure.length === 0 && draft.steps.length > 0) {
		issues.push({
			id: "procedure:missing",
			summary: "Teach draft is missing a high-level procedure.",
		});
	}
	if (!Array.isArray(draft.executionPolicy.preferredRoutes) || draft.executionPolicy.preferredRoutes.length === 0) {
		issues.push({
			id: "execution-policy:missing-routes",
			summary: "Teach draft execution policy must declare at least one preferred route.",
		});
	}
	const validProcedureIds = new Set(draft.procedure.map((step) => step.id));
	for (const option of draft.stepRouteOptions) {
		if (!validProcedureIds.has(option.procedureStepId)) {
			issues.push({
				id: `step-route-option:${option.id}:invalid-procedure-step`,
				summary: `Step route option ${option.id} must reference a known procedure step.`,
			});
		}
		if (option.route === "skill" && !option.skillName?.trim()) {
			issues.push({
				id: `step-route-option:${option.id}:missing-skill`,
				summary: `Step route option ${option.id} uses the skill route but does not name a skill.`,
			});
		}
	}
	return issues;
}

function summarizeRevisionChanges(params: {
	current: TaughtTaskDraft;
	nextTitle: string;
	nextObjective: string;
	nextIntent: string;
	nextTaskKind: TaughtTaskKind;
	nextParameterSlots: TaughtTaskDraftParameter[];
	nextSuccessCriteria: string[];
	nextOpenQuestions: string[];
	nextUncertainties: string[];
	nextTaskCard: TaughtTaskCard | undefined;
	nextProcedure: TaughtTaskProcedureStep[];
	nextExecutionPolicy: TaughtTaskExecutionPolicy;
	nextStepRouteOptions: TaughtTaskStepRouteOption[];
	nextReplayPreconditions: string[];
	nextResetSignals: string[];
	nextSkillDependencies: TaughtTaskSkillDependency[];
	nextSteps: TaughtTaskDraftStep[];
	nextValidation: TaughtTaskDraftValidation | undefined;
}): string[] {
	const changes: string[] = [];
	if (params.current.title !== params.nextTitle) {
		changes.push("title");
	}
	if (params.current.objective !== params.nextObjective || params.current.intent !== params.nextIntent) {
		changes.push("objective");
	}
	if (params.current.taskKind !== params.nextTaskKind) {
		changes.push("task kind");
	}
	if (!areParameterSlotsEqual(params.current.parameterSlots, params.nextParameterSlots)) {
		changes.push("parameter slots");
	}
	if (!areStringListsEqual(params.current.successCriteria, params.nextSuccessCriteria)) {
		changes.push("success criteria");
	}
	if (!areStringListsEqual(params.current.openQuestions, params.nextOpenQuestions)) {
		changes.push("open questions");
	}
	if (!areStringListsEqual(params.current.uncertainties, params.nextUncertainties)) {
		changes.push("uncertainties");
	}
	if (!areTaskCardsEqual(params.current.taskCard, params.nextTaskCard)) {
		changes.push("task card");
	}
	if (!areProcedureEqual(params.current.procedure, params.nextProcedure)) {
		changes.push("procedure");
	}
	if (!areExecutionPolicyEqual(params.current.executionPolicy, params.nextExecutionPolicy)) {
		changes.push("execution policy");
	}
	if (!areStepRouteOptionsEqual(params.current.stepRouteOptions, params.nextStepRouteOptions)) {
		changes.push("step route options");
	}
	if (!areStringListsEqual(params.current.replayPreconditions, params.nextReplayPreconditions)) {
		changes.push("replay preconditions");
	}
	if (!areStringListsEqual(params.current.resetSignals, params.nextResetSignals)) {
		changes.push("reset signals");
	}
	if (!areSkillDependenciesEqual(params.current.skillDependencies, params.nextSkillDependencies)) {
		changes.push("skill dependencies");
	}
	if (!areStepsEqual(params.current.steps, params.nextSteps)) {
		changes.push("steps");
	}
	if (!areValidationEqual(params.current.validation, params.nextValidation)) {
		changes.push("validation");
	}
	return changes;
}

function buildRevisionSummary(params: {
	action: TaughtTaskDraftRevision["action"];
	draft: TaughtTaskDraft;
	sourceLabel?: string;
	changes?: string[];
	note?: string;
	publishedSkillName?: string;
}): string {
	if (params.action === "created") {
		if (params.draft.sourceKind === "video") {
			return `Created teach draft from demo video ${params.sourceLabel ?? params.draft.sourceLabel ?? "input"}.`;
		}
		return `Created teach draft from traced run ${params.sourceLabel ?? params.draft.sourceRunId ?? params.draft.runId}.`;
	}
	if (params.action === "published") {
		return params.publishedSkillName
			? `Published teach draft to workspace skill ${params.publishedSkillName}.`
			: "Published teach draft to workspace skills.";
	}
	if (params.action === "validated") {
		return params.note?.trim() || "Validated teach draft replay readiness.";
	}
	if (params.changes && params.changes.length > 0) {
		return `Corrected ${params.changes.join(", ")}.`;
	}
	return params.note?.trim() || "Corrected teach draft.";
}

function sanitizeSkillNameSegment(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function quoteYamlString(value: string): string {
	return JSON.stringify(value);
}

function buildPublishedSkillName(draft: TaughtTaskDraft, explicitName?: string): string {
	const provided = sanitizeSkillNameSegment(explicitName ?? "");
	if (provided) {
		return sanitizeSkillNameSegment(`taught-${provided}-${createHash("sha1").update(draft.id).digest("hex").slice(0, 6)}`);
	}
	const base = sanitizeSkillNameSegment(draft.title || draft.objective || "routine") || "routine";
	return sanitizeSkillNameSegment(`taught-${base}-${createHash("sha1").update(draft.id).digest("hex").slice(0, 6)}`);
}

function normalizePublishedSkillText(value: string | undefined, maxLength = 160): string | undefined {
	const trimmed = value?.replace(/\s+/g, " ").trim();
	if (!trimmed) return undefined;
	if (trimmed.length <= maxLength) return trimmed;
	return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function stripTrailingSentencePunctuation(value: string): string {
	return value.replace(/[.!?。]+$/u, "").trim();
}

function extractQuotedLabels(value: string | undefined): string[] {
	if (!value?.trim()) return [];
	const labels: string[] = [];
	const patterns = [/"([^"]{1,12})"/g, /“([^”]{1,12})”/g];
	for (const pattern of patterns) {
		for (const match of value.matchAll(pattern)) {
			const label = normalizePublishedSkillText(match[1], 48);
			if (label) labels.push(label);
		}
	}
	return Array.from(new Set(labels));
}

function buildPublishedSkillTriggers(draft: TaughtTaskDraft): string[] {
	const goal = normalizePublishedSkillText(draft.taskCard?.goal ?? draft.objective ?? draft.intent ?? draft.title, 180);
	const objective = normalizePublishedSkillText(draft.objective, 180);
	const output = normalizePublishedSkillText(draft.taskCard?.output, 180);
	const appNames = Array.from(new Set(
		draft.steps
			.map((step) => normalizePublishedSkillText(step.app, 80))
			.filter((value): value is string => Boolean(value)),
	));
	const parameterHints = draft.parameterSlots
		.map((slot) => normalizePublishedSkillText(slot.label || slot.name, 40))
		.filter((value): value is string => Boolean(value));
	const visibleLabels = Array.from(new Set(
		draft.steps.flatMap((step) => [
			...extractQuotedLabels(step.target),
			...extractQuotedLabels(step.instruction),
		]),
	)).slice(0, 3);
	const candidates = [
		appNames.length > 0 && visibleLabels.length > 0
			? normalizePublishedSkillText(`${appNames[0]} ${visibleLabels.join(" ")}`, 96)
			: undefined,
		appNames.length > 0 && parameterHints.length > 0
			? normalizePublishedSkillText(`${appNames[0]} ${parameterHints.join(", ")}`, 96)
			: undefined,
		goal ? normalizePublishedSkillText(stripTrailingSentencePunctuation(goal), 120) : undefined,
		objective ? normalizePublishedSkillText(stripTrailingSentencePunctuation(objective), 120) : undefined,
		output ? normalizePublishedSkillText(stripTrailingSentencePunctuation(output), 120) : undefined,
		goal && parameterHints.length > 0
			? normalizePublishedSkillText(`${stripTrailingSentencePunctuation(goal)} with ${parameterHints.join(", ")}`, 120)
			: undefined,
	]
		.filter((value): value is string => Boolean(value));
	return Array.from(new Set(candidates)).slice(0, 5);
}

function buildPublishedSkillDescription(draft: TaughtTaskDraft): string {
	const goal = normalizePublishedSkillText(draft.taskCard?.goal ?? draft.objective ?? draft.intent ?? draft.title, 220)
		?? "Reusable taught workflow.";
	const appNames = Array.from(new Set(
		draft.steps
			.map((step) => normalizePublishedSkillText(step.app, 60))
			.filter((value): value is string => Boolean(value)),
	));
	const parameterHints = draft.parameterSlots
		.map((slot) => normalizePublishedSkillText(slot.label || slot.name, 32))
		.filter((value): value is string => Boolean(value));
	const triggers = buildPublishedSkillTriggers(draft).slice(0, 3);
	const parts = [
		stripTrailingSentencePunctuation(goal),
		appNames.length > 0 ? `Primary surface: ${appNames.join(", ")}` : undefined,
		parameterHints.length > 0 ? `Inputs: ${parameterHints.join(", ")}` : undefined,
		triggers.length > 0 ? `Trigger cues: ${triggers.join(" | ")}` : undefined,
	].filter((value): value is string => Boolean(value));
	const description = parts.join(". ");
	return description.length <= 900
		? `${description}${/[.!?]$/.test(description) ? "" : "."}`
		: `${description.slice(0, 897).trimEnd()}...`;
}

function resolveDefaultTaughtTaskSkillsDir(workspaceDir: string): string {
	return join(resolve(workspaceDir), "skills");
}

function resolveDraftProcedure(draft: TaughtTaskDraft): TaughtTaskProcedureStep[] {
	return draft.procedure.length > 0 ? draft.procedure : buildProcedureFromSteps(draft.steps);
}

function buildPublishedSkillMarkdown(params: {
	name: string;
	draft: TaughtTaskDraft;
}): string {
	const { draft, name } = params;
	const procedure = resolveDraftProcedure(draft);
	const stagedWorkflowLines = buildStagedWorkflowLines(procedure);
	const guiReferenceLines = buildGuiReferencePathLines({ draft, procedure });
	const toolRouteReferenceLines = buildToolRouteReferenceLines({ draft, procedure });
	const triggers = buildPublishedSkillTriggers(draft);
	return [
		"---",
		`name: ${name}`,
		`description: ${quoteYamlString(buildPublishedSkillDescription(draft))}`,
		...(triggers.length > 0
			? [
				"triggers:",
				...triggers.map((trigger) => `  - ${quoteYamlString(trigger)}`),
			]
			: []),
		"metadata:",
		"  understudy:",
		"    taught: true",
		`    workspaceDir: ${quoteYamlString(resolve(draft.workspaceDir))}`,
		`    draftId: ${quoteYamlString(draft.id)}`,
		`    runId: ${quoteYamlString(draft.runId)}`,
		`    routeSignature: ${quoteYamlString(draft.routeSignature)}`,
		"---",
		"",
		`# ${name}`,
		"",
		`This workspace skill was taught from an explicit teach draft captured in \`${resolve(draft.workspaceDir)}\`.`,
		"",
			"## Overall Goal",
		"",
			draft.objective || draft.intent || draft.title,
			"",
			"## Staged Workflow",
			"",
			...(stagedWorkflowLines.length > 0
				? stagedWorkflowLines
				: ["1. No staged workflow was captured. Use the task card and validation criteria below."]),
			"",
			"## GUI Reference Path",
			"",
			"The GUI reference path below is for replay and grounding reference only.",
			...(guiReferenceLines.length > 0
				? ["", ...guiReferenceLines]
				: ["", "1. No dedicated GUI reference path was captured. Re-observe the current UI if a GUI-only route is required."]),
			"",
			"## Tool Route Options",
			"",
			"These route options are references only. Choose the best route at runtime based on the current surface, available capabilities, and the need to preserve the same externally visible result.",
			...(toolRouteReferenceLines.length > 0
				? ["", ...toolRouteReferenceLines]
				: ["", "- No alternative tool routes were captured."]),
			"",
			"## Task Kind",
			"",
			draft.taskKind,
			"",
			"## Parameter Slots",
		"",
		...(draft.parameterSlots.length > 0
			? draft.parameterSlots.map((slot) => `- ${slot.name}${slot.sampleValue ? `: ${slot.sampleValue}` : ""}`)
			: ["- No parameter slots were captured. Confirm runtime inputs from the user when needed."]),
		"",
		"## Task Card",
		"",
		...(draft.taskCard
			? [
				`- Goal: ${draft.taskCard.goal ?? draft.objective ?? draft.intent ?? draft.title}`,
				`- Scope: ${draft.taskCard.scope ?? "Reusable workflow."}`,
				...(draft.taskKind === "batch_workflow"
					? [`- Loop over: ${draft.taskCard.loopOver ?? "The demonstrated collection or repeated unit."}`]
					: []),
				`- Inputs: ${draft.taskCard.inputs.length > 0 ? draft.taskCard.inputs.join("; ") : "No structured inputs captured."}`,
				`- Extract: ${draft.taskCard.extract.length > 0 ? draft.taskCard.extract.join("; ") : "No structured extracts captured."}`,
				`- Formula: ${draft.taskCard.formula ?? "None captured."}`,
				`- Filter: ${draft.taskCard.filter ?? "None captured."}`,
				`- Output: ${draft.taskCard.output ?? "Verify the externally visible task outcome."}`,
			]
			: ["- No task card was captured. Use the objective and procedure below."]),
		"",
			"## Compose With Skills",
		"",
			...(draft.skillDependencies.length > 0
				? draft.skillDependencies.map((dependency) =>
					`- ${dependency.name}${dependency.reason ? `: ${dependency.reason}` : ""}${dependency.required ? " (required)" : ""}`)
				: ["- No existing workspace skills were linked to this taught task."]),
			"",
			"## Replay Preconditions",
			"",
			...(draft.replayPreconditions.length > 0
				? draft.replayPreconditions.map((entry) => `- ${entry}`)
				: ["- No explicit replay preconditions were captured. Confirm the starting UI state before acting."]),
			"",
			"## Reset Signals",
			"",
			...(draft.resetSignals.length > 0
				? draft.resetSignals.map((entry) => `- ${entry}`)
				: ["- If the current UI state does not match the taught starting state, reset before replaying the procedure."]),
			"",
			"## Success Criteria",
		"",
		...(draft.successCriteria.length > 0
			? draft.successCriteria.map((criterion) => `- ${criterion}`)
			: ["- Verify the externally visible outcome before considering the task complete."]),
		"",
		"## Validation Status",
		"",
		draft.validation?.summary || "Replay validation has not been run for this teach draft yet.",
		...(draft.validation?.mode ? [`Validation mode: ${draft.validation.mode}`] : []),
		...(draft.validation?.mutatingToolNames && draft.validation.mutatingToolNames.length > 0
			? [`Mutating tools used during validation: ${draft.validation.mutatingToolNames.join(", ")}`]
			: []),
		"",
		"## Execution Strategy",
		"",
		`- Tool binding: ${draft.executionPolicy.toolBinding}`,
		`- Preferred routes: ${formatExecutionRouteOrder(draft.executionPolicy.preferredRoutes)}`,
		`- Detailed steps: ${draft.executionPolicy.stepInterpretation}`,
		...draft.executionPolicy.notes.map((note) => `- ${note}`),
		...(draft.steps.length > 0
			? [
				"## Detailed GUI Replay Hints",
				"",
				describeDetailedStepUsage(draft.executionPolicy),
				"",
				...draft.steps.flatMap((step) => {
					const parts = [`${step.index}. [${step.route}/${step.toolName}] ${step.instruction}`];
					const meta: string[] = [];
					if (step.target) meta.push(`target: ${step.target}`);
					if (step.app) meta.push(`app: ${step.app}`);
					if (step.scope) meta.push(`scope: ${step.scope}`);
					if (step.captureMode) meta.push(`captureMode: ${step.captureMode}`);
					if (step.groundingMode) meta.push(`groundingMode: ${step.groundingMode}`);
					if (step.locationHint) meta.push(`locationHint: ${step.locationHint}`);
					if (step.windowTitle) meta.push(`windowTitle: ${step.windowTitle}`);
					if (meta.length > 0) parts.push(`   ${meta.join(" | ")}`);
					if (step.inputs && Object.keys(step.inputs).length > 0) {
						parts.push(`   inputs: ${Object.entries(step.inputs).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}`);
					}
					if (step.verificationSummary) parts.push(`   verify: ${step.verificationSummary}`);
					return parts;
				}),
				"",
			]
			: []),
		"## Failure Policy",
		"",
		"- Use `gui_read` before each `gui_click`/`gui_type` to confirm the target is visible on the current surface.",
		"- Use `groundingMode: \"complex\"` after any grounding failure or when the UI is dense/ambiguous.",
		"- Use `captureMode: \"display\"` for menu bar, Dock, or cross-window operations; `captureMode: \"window\"` for in-app work.",
		"- Describe targets using visible text labels from the current screenshot, not memorized positions from the teach recording.",
		"- Re-observe the UI after each significant state change.",
		"- Prefer reusing linked workspace skills for matching substeps before falling back to raw UI replay.",
		"- If the route diverges or verification weakens, replan instead of blindly replaying the taught steps.",
		"- Ask the user for missing parameters when the current request does not fully match the taught draft.",
		"",
	].join("\n");
}

export function buildTaughtTaskDraftFromRun(
	options: BuildTaughtTaskDraftFromRunOptions,
): TaughtTaskDraft {
	const now = options.now ?? Date.now();
	const teachValidation = options.teachValidation;
	const steps = resolvePairedSteps(options.toolTrace ?? []);
	const promptPreview = stripTimestampEnvelope(options.promptPreview);
	const title = options.title?.trim() || draftTitleFromPrompt(promptPreview);
	const objective = options.objective?.trim() || promptPreview || title;
	const routeSignature = steps.length > 0 ? steps.map((step) => step.route).join(" -> ") : "system";
	const parameterSlots = [
		...buildParameterSlots(steps),
		...extractPromptQuotedParameterSlots(promptPreview),
	].slice(0, 8);
	const successCriteria = collectSuccessCriteria({
		validation: teachValidation,
		steps,
	});
	const uncertainties = collectUncertainties({
		validation: teachValidation,
		steps,
	});
	const procedure = buildProcedureFromSteps(steps);
	const executionPolicy = inferExecutionPolicy({
		steps,
		skillDependencies: [],
	});
	const stepRouteOptions = normalizeStepRouteOptions(undefined, {
		procedure,
		steps,
	});
	const taskKind = inferTaskKind({
		objective,
		parameterSlots,
		procedure,
		steps,
	});
	const effectiveParameterSlots = taskKind === "fixed_demo" ? [] : parameterSlots;
	const taskCard = alignTaskCardToTaskKind({
		taskCard: buildTaskCardFromDraftSeed({
			title,
			objective,
			parameterSlots: effectiveParameterSlots,
			successCriteria,
			procedure,
		}),
		taskKind,
		parameterSlots: effectiveParameterSlots,
	});
	return {
		id: createHash("sha1")
			.update(resolve(options.workspaceDir))
			.update(options.sessionId ?? "")
			.update(options.runId)
			.digest("hex")
			.slice(0, 12),
		workspaceDir: resolve(options.workspaceDir),
		repoRoot: options.repoRoot ? resolve(options.repoRoot) : undefined,
		sessionId: options.sessionId,
		traceId: options.traceId,
		sourceKind: "run",
		sourceLabel: options.runId,
		runId: options.runId,
		sourceRunId: options.runId,
		createdAt: now,
		updatedAt: now,
		status: "draft",
		title,
		objective,
		intent: objective,
		userPromptPreview: promptPreview,
		promptPreview,
		responsePreview: options.responsePreview?.trim() || undefined,
		routeSignature,
		taskKind,
		parameterSlots: effectiveParameterSlots,
		successCriteria,
		openQuestions: uncertainties,
		uncertainties,
		...(taskCard ? { taskCard } : {}),
		procedure,
		executionPolicy,
		stepRouteOptions,
		replayPreconditions: [],
		resetSignals: [],
		skillDependencies: [],
		steps,
		validation: teachValidation
			? normalizeValidation({
				state: (() => {
					const validationState = asString(teachValidation.state);
					switch (validationState) {
						case "validated":
						case "requires_reset":
						case "failed":
						case "unvalidated":
							return validationState;
						default:
							return "unvalidated";
					}
				})(),
				updatedAt: now,
				summary:
					asString(teachValidation.summary)?.trim() ||
					"Source run was captured without a replay-validation result.",
				runId: options.runId,
				checks: Array.isArray(teachValidation.checks)
					? (teachValidation.checks as TaughtTaskDraftValidationCheck[])
					: [],
				mode:
					asString(teachValidation.mode) === "replay"
						? "replay"
						: "inspection",
				usedMutatingTools: typeof teachValidation.usedMutatingTools === "boolean"
					? teachValidation.usedMutatingTools
					: undefined,
				toolNames: Array.isArray(teachValidation.toolNames)
					? normalizeLineList(teachValidation.toolNames)
					: undefined,
				mutatingToolNames: Array.isArray(teachValidation.mutatingToolNames)
					? normalizeLineList(teachValidation.mutatingToolNames)
					: undefined,
			})
			: undefined,
		revisions: [
			{
				revision: 1,
				timestamp: now,
				action: "created",
				actor: "system",
				summary: `Created teach draft from traced run ${options.runId}.`,
				changes: ["source"],
			},
		],
	};
}

export function createTaughtTaskDraftFromVideo(
	options: CreateTaughtTaskDraftFromVideoOptions,
): TaughtTaskDraft {
	const now = Date.now();
	const resolvedWorkspaceDir = resolve(options.workspaceDir);
	const stepSeedValues = Array.isArray(options.steps) && options.steps.length > 0
		? options.steps
		: [
			{
				toolName: "gui_wait",
				route: "gui",
				instruction: "Wait for the demonstrated UI state to settle.",
			},
		];
	const normalizedSteps = normalizeSteps(
		stepSeedValues,
		stepSeedValues.map((entry, index) => ({
			id: `gui_wait-${index + 1}`,
			index: index + 1,
			toolName:
				typeof entry === "string"
					? "gui_wait"
					: entry.toolName?.trim() || "gui_wait",
			route:
				typeof entry === "string"
					? "gui"
					: entry.route?.trim() || "gui",
			instruction:
				typeof entry === "string"
					? entry
					: entry.instruction?.trim() || entry.summary?.trim() || "Wait for the demonstrated UI state to settle.",
		})),
	);
	const routeSignature = normalizedSteps.length > 0
		? normalizedSteps.map((step) => step.route).join(" -> ")
		: "gui";
	const parameterSlots = normalizeParameterSlots(options.parameterSlots);
	const procedure = normalizeProcedure(
		options.procedure,
		buildProcedureFromSteps(normalizedSteps),
	);
	const sourceLabel = options.sourceLabel?.trim() || "demo video";
	const promptPreview = options.promptPreview?.trim() || `Teach from video: ${sourceLabel}`;
	const title = options.title?.trim() || draftTitleFromPrompt(promptPreview);
	const objective = options.objective?.trim() || promptPreview || title;
	const successCriteria = normalizeLineList(options.successCriteria);
	const taskKind = inferTaskKind({
		taskKind: options.taskKind,
		objective,
		taskCard: options.taskCard,
		parameterSlots,
		procedure,
		steps: normalizedSteps,
	});
	const effectiveParameterSlots = taskKind === "fixed_demo" ? [] : parameterSlots;
	const taskCard = alignTaskCardToTaskKind({
		taskCard: normalizeTaskCard(
			options.taskCard,
			buildTaskCardFromDraftSeed({
				title,
				objective,
				parameterSlots: effectiveParameterSlots,
				successCriteria,
				procedure,
			}),
		),
		taskKind,
		parameterSlots: effectiveParameterSlots,
	});
	const replayPreconditions = normalizeReplayHintList(options.replayPreconditions);
	const resetSignals = normalizeReplayHintList(options.resetSignals);
	const skillDependencies = normalizeSkillDependencies(options.skillDependencies);
	const executionPolicy = normalizeExecutionPolicy(options.executionPolicy, {
		steps: normalizedSteps,
		skillDependencies,
	});
	const stepRouteOptions = normalizeStepRouteOptions(options.stepRouteOptions, {
		procedure,
		steps: normalizedSteps,
	});
	const runId = `video-${createHash("sha1")
		.update(resolvedWorkspaceDir)
		.update(sourceLabel)
		.update(objective)
		.update(String(now))
		.digest("hex")
		.slice(0, 12)}`;
	return {
		id: createHash("sha1")
			.update(resolvedWorkspaceDir)
			.update(options.sessionId ?? "")
			.update(runId)
			.digest("hex")
			.slice(0, 12),
		workspaceDir: resolvedWorkspaceDir,
		repoRoot: options.repoRoot ? resolve(options.repoRoot) : undefined,
		sessionId: options.sessionId,
		traceId: options.traceId,
		sourceKind: "video",
		sourceLabel,
		sourceDetails: options.sourceDetails,
		runId,
		sourceRunId: runId,
		createdAt: now,
		updatedAt: now,
		status: "draft",
		title,
		objective,
		intent: objective,
		userPromptPreview: promptPreview,
		promptPreview,
		responsePreview: options.responsePreview?.trim() || undefined,
		routeSignature,
		taskKind,
		parameterSlots: effectiveParameterSlots,
		successCriteria,
		openQuestions: normalizeLineList(options.openQuestions),
		uncertainties: normalizeLineList(options.uncertainties ?? options.openQuestions),
		...(taskCard ? { taskCard } : {}),
		procedure,
		executionPolicy,
		stepRouteOptions,
		replayPreconditions,
		resetSignals,
		skillDependencies,
		steps: normalizedSteps,
		validation: normalizeValidation({
			state: "unvalidated",
			updatedAt: now,
			summary: `Teach draft derived from ${sourceLabel}; replay validation has not been run yet.`,
			checks: [],
			mode: "replay",
		}),
		revisions: [
			{
				revision: 1,
				timestamp: now,
				action: "created",
				actor: "system",
				summary: `Created teach draft from demo video ${sourceLabel}.`,
				changes: ["source"],
				note: `Derived from video demonstration: ${sourceLabel}`,
			},
		],
	};
}

function hydrateTaughtTaskDraft(draft: TaughtTaskDraft): TaughtTaskDraft {
	if (!draft.executionPolicy) {
		throw new Error(`Teach draft ${draft.id} is missing executionPolicy.`);
	}
	if (!Array.isArray(draft.stepRouteOptions)) {
		throw new Error(`Teach draft ${draft.id} is missing stepRouteOptions.`);
	}
	const steps = Array.isArray(draft.steps) ? draft.steps : [];
	const procedureSeed = Array.isArray(draft.procedure) ? draft.procedure : [];
	const procedure = normalizeProcedure(
		procedureSeed,
		buildProcedureFromSteps(steps),
	);
	const parameterSlots = normalizeParameterSlots(Array.isArray(draft.parameterSlots) ? draft.parameterSlots : []);
	const taskKind = inferTaskKind({
		taskKind: normalizeTaskKind(draft.taskKind),
		objective: draft.objective || draft.intent || draft.title,
		taskCard: draft.taskCard,
		parameterSlots,
		procedure,
		steps,
	});
	const effectiveParameterSlots = taskKind === "fixed_demo" ? [] : parameterSlots;
	return {
		...draft,
		taskKind,
		parameterSlots: effectiveParameterSlots,
		taskCard: alignTaskCardToTaskKind({
			taskCard: normalizeTaskCard(
				draft.taskCard,
				buildTaskCardFromDraftSeed({
					title: draft.title,
					objective: draft.objective || draft.intent || draft.title,
					parameterSlots: effectiveParameterSlots,
					successCriteria: Array.isArray(draft.successCriteria) ? draft.successCriteria : [],
					procedure,
				}),
			),
			taskKind,
			parameterSlots: effectiveParameterSlots,
		}),
		procedure,
		replayPreconditions: normalizeReplayHintList(draft.replayPreconditions),
		resetSignals: normalizeReplayHintList(draft.resetSignals),
		skillDependencies: normalizeSkillDependencies(draft.skillDependencies),
		executionPolicy: normalizeExecutionPolicy(draft.executionPolicy, {
			steps,
			skillDependencies: normalizeSkillDependencies(draft.skillDependencies),
		}),
		stepRouteOptions: normalizeStepRouteOptions(draft.stepRouteOptions, {
			procedure,
			steps,
			existing: draft.stepRouteOptions,
		}),
		steps,
		validation: normalizeValidation(draft.validation),
	};
}

async function persistTaughtTaskDraftLedger(
	ledger: TaughtTaskDraftLedger,
	learningDir?: string,
): Promise<void> {
	const ledgerPath = buildTaskDraftLedgerPath(ledger.workspaceDir, learningDir);
	await mkdir(join(resolveLearningDir(learningDir), "task-drafts"), { recursive: true });
	await writeFile(
		ledgerPath,
		JSON.stringify(ledger, null, 2),
		"utf8",
	);
}

export async function loadPersistedTaughtTaskDraftLedger(
	options: LoadPersistedTaughtTaskDraftLedgerOptions,
): Promise<TaughtTaskDraftLedger | undefined> {
	const workspaceDir = resolve(options.workspaceDir);
	const learningDir = resolveLearningDir(options.learningDir);
	const ledgerPath = buildTaskDraftLedgerPath(workspaceDir, learningDir);
	let payload = await readJsonIfExists<TaughtTaskDraftLedger>(ledgerPath);
	if (!payload) {
		payload = await loadBestMatchingPayload<TaughtTaskDraftLedger>({
			dirPath: join(learningDir, "task-drafts"),
			requestedWorkspaceDir: workspaceDir,
		});
	}
	if (!payload) {
		return undefined;
	}
	return {
		updatedAt: payload.updatedAt ?? 0,
		workspaceDir: payload.workspaceDir ?? workspaceDir,
		repoRoot: payload.repoRoot,
		drafts: Array.isArray(payload.drafts)
			? payload.drafts
				.filter((draft): draft is TaughtTaskDraft => Boolean(draft && typeof draft.id === "string"))
				.flatMap((draft) => {
					try {
						return [hydrateTaughtTaskDraft(draft)];
					} catch {
						return [];
					}
				})
				.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
			: [],
	};
}

export async function persistTaughtTaskDraft(
	draft: TaughtTaskDraft,
	options: PersistTaughtTaskDraftOptions = {},
): Promise<TaughtTaskDraftLedger> {
	const hydratedDraft = hydrateTaughtTaskDraft(draft);
	const current = await loadPersistedTaughtTaskDraftLedger({
		workspaceDir: hydratedDraft.workspaceDir,
		learningDir: options.learningDir,
	});
	const otherDrafts = (current?.drafts ?? []).filter((entry) => entry.id !== hydratedDraft.id);
	const nextDrafts = [hydratedDraft, ...otherDrafts]
		.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
		.slice(0, options.maxDraftsPerWorkspace ?? DEFAULT_MAX_DRAFTS_PER_WORKSPACE);
	const nextLedger: TaughtTaskDraftLedger = {
		updatedAt: Date.now(),
		workspaceDir: resolve(hydratedDraft.workspaceDir),
		repoRoot: hydratedDraft.repoRoot,
		drafts: nextDrafts,
	};
	await persistTaughtTaskDraftLedger(nextLedger, options.learningDir);
	return nextLedger;
}

export function createTaughtTaskDraft(options: CreateTaughtTaskDraftOptions): TaughtTaskDraft {
	return buildTaughtTaskDraftFromRun({
		workspaceDir: options.workspaceDir,
		repoRoot: options.repoRoot,
		sessionId: options.sessionId,
		traceId: options.traceId,
		runId: options.run.runId,
		promptPreview: options.run.userPromptPreview,
		responsePreview: options.run.responsePreview,
		toolTrace: options.run.toolTrace,
		teachValidation: options.run.teachValidation,
		title: options.title,
		objective: options.objective,
	});
}

export async function listTaughtTaskDrafts(
	options: ListTaughtTaskDraftsOptions,
): Promise<TaughtTaskDraft[]> {
	const ledger = await loadPersistedTaughtTaskDraftLedger(options);
	return ledger?.drafts ?? [];
}

export async function loadTaughtTaskDraft(
	options: LoadTaughtTaskDraftOptions,
): Promise<TaughtTaskDraft | undefined> {
	const drafts = await listTaughtTaskDrafts({
		workspaceDir: options.workspaceDir,
		learningDir: options.learningDir,
	});
	return drafts.find((draft) => draft.id === options.draftId);
}

export async function updatePersistedTaughtTaskDraft(
	options: UpdatePersistedTaughtTaskDraftOptions,
): Promise<TaughtTaskDraft> {
	const ledger = await loadPersistedTaughtTaskDraftLedger({
		workspaceDir: options.workspaceDir,
		learningDir: options.learningDir,
	});
	if (!ledger) {
		throw new Error(`No teach drafts found for workspace: ${resolve(options.workspaceDir)}`);
	}
	const draftIndex = ledger.drafts.findIndex((draft) => draft.id === options.draftId);
	if (draftIndex < 0) {
		throw new Error(`Task draft not found: ${options.draftId}`);
	}
	const current = ledger.drafts[draftIndex];
	const nextSteps = normalizeSteps(options.patch.steps, current.steps);
	const nextTitle = options.patch.title?.trim() || current.title;
	const nextObjective = options.patch.objective?.trim() || options.patch.intent?.trim() || current.objective || current.intent;
	const nextIntent = options.patch.intent?.trim() || options.patch.objective?.trim() || current.intent;
	const rawNextParameterSlots = Object.prototype.hasOwnProperty.call(options.patch, "parameterSlots")
		? normalizeParameterSlots(options.patch.parameterSlots)
		: current.parameterSlots;
	const nextSuccessCriteria = Object.prototype.hasOwnProperty.call(options.patch, "successCriteria")
		? normalizeLineList(options.patch.successCriteria)
		: current.successCriteria;
	const nextOpenQuestions = Object.prototype.hasOwnProperty.call(options.patch, "openQuestions")
		? normalizeLineList(options.patch.openQuestions)
		: current.openQuestions;
	const nextUncertainties = Object.prototype.hasOwnProperty.call(options.patch, "uncertainties")
		? normalizeLineList(options.patch.uncertainties)
		: (Object.prototype.hasOwnProperty.call(options.patch, "openQuestions")
			? normalizeLineList(options.patch.openQuestions)
			: current.uncertainties);
	const nextProcedure = Object.prototype.hasOwnProperty.call(options.patch, "procedure")
		? normalizeProcedure(options.patch.procedure, current.procedure)
		: (Object.prototype.hasOwnProperty.call(options.patch, "steps")
			? buildProcedureFromSteps(nextSteps)
			: current.procedure);
	const rawNextTaskCard = Object.prototype.hasOwnProperty.call(options.patch, "taskCard")
		? normalizeTaskCard(options.patch.taskCard, current.taskCard)
		: current.taskCard;
	const nextTaskKind = inferTaskKind({
		taskKind: Object.prototype.hasOwnProperty.call(options.patch, "taskKind")
			? normalizeTaskKind(options.patch.taskKind)
			: current.taskKind,
		objective: nextObjective,
		taskCard: rawNextTaskCard,
		parameterSlots: rawNextParameterSlots,
		procedure: nextProcedure,
		steps: nextSteps,
	});
	const nextParameterSlots = nextTaskKind === "fixed_demo" ? [] : rawNextParameterSlots;
	const nextTaskCard = alignTaskCardToTaskKind({
		taskCard: rawNextTaskCard,
		taskKind: nextTaskKind,
		parameterSlots: nextParameterSlots,
	});
	const nextReplayPreconditions = Object.prototype.hasOwnProperty.call(options.patch, "replayPreconditions")
		? normalizeReplayHintList(options.patch.replayPreconditions)
		: current.replayPreconditions;
	const nextResetSignals = Object.prototype.hasOwnProperty.call(options.patch, "resetSignals")
		? normalizeReplayHintList(options.patch.resetSignals)
		: current.resetSignals;
	const nextSkillDependencies = Object.prototype.hasOwnProperty.call(options.patch, "skillDependencies")
		? normalizeSkillDependencies(options.patch.skillDependencies)
		: current.skillDependencies;
	const nextExecutionPolicy = Object.prototype.hasOwnProperty.call(options.patch, "executionPolicy")
		? normalizeExecutionPolicy(options.patch.executionPolicy, {
			steps: nextSteps,
			skillDependencies: nextSkillDependencies,
			existing: current.executionPolicy,
		})
		: normalizeExecutionPolicy(current.executionPolicy, {
			steps: nextSteps,
			skillDependencies: nextSkillDependencies,
			existing: current.executionPolicy,
		});
	const nextStepRouteOptions = Object.prototype.hasOwnProperty.call(options.patch, "stepRouteOptions")
		? normalizeStepRouteOptions(options.patch.stepRouteOptions, {
			procedure: nextProcedure,
			steps: nextSteps,
			existing: current.stepRouteOptions,
		})
		: normalizeStepRouteOptions(current.stepRouteOptions, {
			procedure: nextProcedure,
			steps: nextSteps,
			existing: current.stepRouteOptions,
		});
	const nextValidation = Object.prototype.hasOwnProperty.call(options.patch, "validation")
		? normalizeValidation(options.patch.validation, current.validation)
		: current.validation;
	const revisionAction = options.action ?? "corrected";
	const revisionChanges = revisionAction === "corrected"
		? summarizeRevisionChanges({
			current,
			nextTitle,
			nextObjective,
			nextIntent,
			nextTaskKind,
			nextParameterSlots,
			nextSuccessCriteria,
			nextOpenQuestions,
			nextUncertainties,
			nextTaskCard,
			nextProcedure,
			nextExecutionPolicy,
			nextStepRouteOptions,
			nextReplayPreconditions,
			nextResetSignals,
			nextSkillDependencies,
			nextSteps,
			nextValidation,
		})
		: revisionAction === "published"
			? ["status"]
			: ["validation"];
	const updatedAt = Date.now();
	const updated: TaughtTaskDraft = {
		...current,
		title: nextTitle,
		objective: nextObjective,
		intent: nextIntent,
		taskKind: nextTaskKind,
		parameterSlots: nextParameterSlots,
		successCriteria: nextSuccessCriteria,
		openQuestions: nextOpenQuestions,
		uncertainties: nextUncertainties,
		taskCard: nextTaskCard,
		procedure: nextProcedure,
		executionPolicy: nextExecutionPolicy,
		stepRouteOptions: nextStepRouteOptions,
		replayPreconditions: nextReplayPreconditions,
		resetSignals: nextResetSignals,
		skillDependencies: nextSkillDependencies,
		steps: nextSteps,
		validation: nextValidation
			? {
				...nextValidation,
				updatedAt:
					options.patch.validation
						? updatedAt
						: nextValidation.updatedAt,
			}
			: undefined,
		routeSignature: nextSteps.length > 0 ? nextSteps.map((step) => step.route).join(" -> ") : current.routeSignature,
		updatedAt,
		revisions: [
			...current.revisions,
			{
				revision: current.revisions.length + 1,
				timestamp: updatedAt,
				action: revisionAction,
				actor: "operator",
				summary: buildRevisionSummary({
					action: revisionAction,
					draft: current,
					sourceLabel: current.sourceLabel,
					changes: revisionChanges,
					note: options.note?.trim() || options.patch.note?.trim() || undefined,
				}),
				changes: revisionChanges,
				note: options.note?.trim() || options.patch.note?.trim() || undefined,
			},
		],
	};
	ledger.drafts[draftIndex] = updated;
	ledger.updatedAt = updatedAt;
	ledger.drafts.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
	await persistTaughtTaskDraftLedger(ledger, options.learningDir);
	return updated;
}

export async function updateTaughtTaskDraft(
	options: UpdatePersistedTaughtTaskDraftOptions,
): Promise<TaughtTaskDraft> {
	return await updatePersistedTaughtTaskDraft(options);
}

export async function publishTaughtTaskDraft(
	options: PublishTaughtTaskDraftOptions,
): Promise<PublishTaughtTaskDraftResult> {
	const draft = await loadTaughtTaskDraft({
		workspaceDir: options.workspaceDir,
		draftId: options.draftId,
		learningDir: options.learningDir,
	});
	if (!draft) {
		throw new Error(`Task draft not found: ${options.draftId}`);
	}
	const skillsDir = options.skillsDir ?? resolveDefaultTaughtTaskSkillsDir(draft.workspaceDir);
	const name = buildPublishedSkillName(draft, options.name);
	const skillDir = join(skillsDir, name);
	const skillPath = join(skillDir, "SKILL.md");
	if (!options.overwrite) {
		const existing = await stat(skillPath).then(() => true).catch(() => false);
		if (existing) {
			throw new Error(`workspace skill already exists: ${name}`);
		}
	}
	await mkdir(skillDir, { recursive: true });
	await writeFile(
		skillPath,
		buildPublishedSkillMarkdown({
			name,
			draft,
		}),
		"utf8",
	);
	const publishedAt = Date.now();
	const updatedDraft = await updatePersistedTaughtTaskDraft({
		workspaceDir: options.workspaceDir,
		draftId: options.draftId,
		learningDir: options.learningDir,
		patch: {},
		note: `Published to workspace skill ${name}.`,
		action: "published",
	});
	const finalizedDraft: TaughtTaskDraft = {
		...updatedDraft,
		status: "published",
		publishedSkill: {
			name,
			skillDir,
			skillPath,
			publishedAt,
		},
	};
	const revisionIndex = finalizedDraft.revisions.length - 1;
	if (revisionIndex >= 0 && finalizedDraft.revisions[revisionIndex]?.action === "published") {
		finalizedDraft.revisions[revisionIndex] = {
			...finalizedDraft.revisions[revisionIndex],
			summary: buildRevisionSummary({
				action: "published",
				draft: finalizedDraft,
				publishedSkillName: name,
				note: finalizedDraft.revisions[revisionIndex]?.note,
			}),
			changes: ["status", "published skill"],
		};
	}
	await persistTaughtTaskDraft(finalizedDraft, { learningDir: options.learningDir });
	return {
		draft: finalizedDraft,
		skill: finalizedDraft.publishedSkill!,
	};
}

export function buildTaughtTaskDraftPromptContent(
	ledger: TaughtTaskDraftLedger | undefined,
	maxEntries: number = DEFAULT_MAX_PROMPT_DRAFTS,
): string | undefined {
	const entries = (ledger?.drafts ?? []).slice(0, maxEntries);
	if (entries.length === 0) {
		return undefined;
	}
	return [
		"Teach drafts captured from explicit teach/correct events in this workspace. Reuse them only when the current request clearly matches, ask for missing parameters, and keep verification strict.",
		"Prefer semantically equivalent browser, bash, or linked-skill routes over raw GUI replay when they preserve the same externally visible outcome and are more efficient for the agent.",
		"Use step route options as non-binding implementation choices. Prefer the best matching option, and treat detailed replay steps as fallback evidence unless the draft explicitly says the route is fixed.",
		...entries.map((draft) => {
			const params = draft.parameterSlots.map((slot) => slot.name);
			const success = draft.successCriteria.slice(0, 3);
			const uncertainties = draft.uncertainties.slice(0, 2);
			const routeOptions = draft.stepRouteOptions
				.slice(0, DEFAULT_MAX_PROMPT_STEPS)
				.map((option) =>
					`    ${option.procedureStepId}. [${option.preference}:${formatStepRouteOptionTarget(option)}] ${option.instruction}`);
			const steps = draft.steps
				.slice(0, DEFAULT_MAX_PROMPT_STEPS)
				.map((step) => `    ${step.index}. [${step.route}/${step.toolName}] ${step.instruction}`);
			return [
					`- ${draft.title}`,
					`  draft_id=${draft.id}`,
					`  intent=${draft.objective || draft.intent}`,
					`  route_signature=${draft.routeSignature}`,
					`  execution_policy=${draft.executionPolicy.toolBinding}:${formatExecutionRouteOrder(draft.executionPolicy.preferredRoutes)}:${draft.executionPolicy.stepInterpretation}`,
					...(draft.validation ? [`  validation=${draft.validation.state}`] : []),
					...(params.length > 0 ? [`  parameters=${params.join(", ")}`] : []),
					...(success.length > 0 ? [`  success=${success.join(" | ")}`] : []),
					...(uncertainties.length > 0 ? [`  uncertainties=${uncertainties.join(" | ")}`] : []),
				...(routeOptions.length > 0 ? ["  step_route_options:", ...routeOptions] : []),
				"  steps:",
				...steps,
			].join("\n");
		}),
		"If the current UI or outcome diverges from the taught draft, re-observe and adapt instead of blindly replaying it.",
	].join("\n");
}
