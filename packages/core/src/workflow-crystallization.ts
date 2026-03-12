import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	buildTaughtTaskDraftFromRun,
	type BuildTaughtTaskDraftFromRunOptions,
	type TaughtTaskDraftParameter,
	type TaughtTaskDraftStep,
	type TaughtTaskExecutionRoute,
} from "./task-drafts.js";
import { resolveUnderstudyHomeDir } from "./runtime-paths.js";
import { containsPath, normalizePath } from "./workspace-context.js";

const DEFAULT_MAX_DAYS = 30;
const DEFAULT_MAX_TURNS_PER_DAY = 200;
const DEFAULT_MAX_SEGMENTS_PER_DAY = 48;
const DEFAULT_MAX_EPISODES_PER_DAY = 48;
const DEFAULT_MAX_CLUSTERS = 24;
const DEFAULT_MAX_SKILLS = 12;
const DEFAULT_MAX_STAGE_INSTRUCTIONS = 6;

export type WorkflowCrystallizationCompletion = "complete" | "partial" | "failed";

export interface WorkflowCrystallizationStatusCounts {
	completeCount: number;
	partialCount: number;
	failedCount: number;
}

export interface WorkflowCrystallizationToolStep {
	index: number;
	toolName: string;
	route: string;
	instruction: string;
	summary?: string;
	inputs?: Record<string, string>;
	verificationStatus?: string;
	verificationSummary?: string;
	uncertain?: boolean;
}

export interface WorkflowCrystallizationTurnEvidence {
	titleGuess: string;
	objectiveGuess: string;
	parameterHints: string[];
	successSignals: string[];
	uncertainties: string[];
	routeSignature?: string;
	toolChain: WorkflowCrystallizationToolStep[];
}

export interface WorkflowCrystallizationTurn {
	id: string;
	runId: string;
	sessionId?: string;
	timestamp: number;
	dayStamp: string;
	userText: string;
	assistantText: string;
	evidence: WorkflowCrystallizationTurnEvidence;
}

export interface WorkflowCrystallizationSegment {
	id: string;
	dayStamp: string;
	startTurnIndex: number;
	endTurnIndex: number;
	turnIds: string[];
	startedAt: number;
	endedAt: number;
	completion: WorkflowCrystallizationCompletion;
}

export interface WorkflowCrystallizationEpisode {
	id: string;
	segmentId: string;
	dayStamp: string;
	startTurnIndex: number;
	endTurnIndex: number;
	turnIds: string[];
	startedAt: number;
	endedAt: number;
	title: string;
	objective: string;
	completion: WorkflowCrystallizationCompletion;
	summary?: string;
	workflowFamilyHint?: string;
	parameterHints: string[];
	successSignals: string[];
	uncertainties: string[];
	keyTools: string[];
	routeSignature?: string;
	triggers: string[];
}

export interface WorkflowCrystallizationCluster {
	id: string;
	title: string;
	objective: string;
	summary?: string;
	workflowFamilyHint?: string;
	parameterSchema: string[];
	episodeIds: string[];
	occurrenceCount: number;
	completeCount: number;
	partialCount: number;
	failedCount: number;
	firstSeenAt: number;
	lastSeenAt: number;
}

export interface WorkflowCrystallizationRouteOption {
	route: TaughtTaskExecutionRoute;
	preference: "preferred" | "fallback" | "observed";
	instruction: string;
	toolName?: string;
}

export interface WorkflowCrystallizationSkillStage {
	title: string;
	goal: string;
	instructions: string[];
}

export interface WorkflowCrystallizationPublishedSkill {
	name: string;
	skillDir: string;
	skillPath: string;
	publishedAt: number;
	contentFingerprint: string;
}

export interface WorkflowCrystallizationNotificationState {
	notifiedAt: number;
	sessionId?: string;
	message?: string;
}

export interface WorkflowCrystallizationSkill {
	id: string;
	clusterId: string;
	title: string;
	objective: string;
	summary?: string;
	triggers: string[];
	parameterSlots: TaughtTaskDraftParameter[];
	stages: WorkflowCrystallizationSkillStage[];
	routeOptions: WorkflowCrystallizationRouteOption[];
	successCriteria: string[];
	failurePolicy: string[];
	workflowFamilyHint?: string;
	sourceEpisodeIds: string[];
	sourceEpisodeCount: number;
	successfulEpisodeCount: number;
	observedStatusCounts: WorkflowCrystallizationStatusCounts;
	lastSynthesizedAt: number;
	publishedSkill?: WorkflowCrystallizationPublishedSkill;
	notification?: WorkflowCrystallizationNotificationState;
}

export interface WorkflowCrystallizationDayRecord {
	dayStamp: string;
	updatedAt: number;
	turns: WorkflowCrystallizationTurn[];
	segments: WorkflowCrystallizationSegment[];
	episodes: WorkflowCrystallizationEpisode[];
	lastSegmentedAt?: number;
	lastSegmentedTurnCount?: number;
	lastSummarizedAt?: number;
}

export interface WorkflowCrystallizationAnalysisState {
	lastClusteredAt?: number;
	lastClusteredEpisodeCount?: number;
	lastClusteredFingerprint?: string;
	lastPublishedAt?: number;
	lastPublishedClusterCount?: number;
	lastPublishedFingerprint?: string;
}

export interface WorkflowCrystallizationLedger {
	updatedAt: number;
	workspaceDir: string;
	repoRoot?: string;
	days: WorkflowCrystallizationDayRecord[];
	clusters: WorkflowCrystallizationCluster[];
	skills: WorkflowCrystallizationSkill[];
	analysisState?: WorkflowCrystallizationAnalysisState;
}

export interface LoadPersistedWorkflowCrystallizationLedgerOptions {
	workspaceDir: string;
	learningDir?: string;
}

export interface PersistWorkflowCrystallizationLedgerOptions {
	learningDir?: string;
}

export interface AppendWorkflowCrystallizationTurnFromRunOptions extends BuildTaughtTaskDraftFromRunOptions {
	learningDir?: string;
	timestamp?: number;
}

export interface PublishWorkflowCrystallizedSkillOptions {
	workspaceDir: string;
	skill: WorkflowCrystallizationSkill;
	skillsDir?: string;
	overwrite?: boolean;
}

function resolveLearningDir(override?: string): string {
	return override ?? join(resolveUnderstudyHomeDir(), "learning");
}

function buildWorkspaceKey(workspaceDir: string): string {
	return createHash("sha1").update(resolve(workspaceDir)).digest("hex").slice(0, 16);
}

function buildWorkflowCrystallizationLedgerPath(workspaceDir: string, learningDir?: string): string {
	return join(resolveLearningDir(learningDir), "workflow-crystallization", `${buildWorkspaceKey(workspaceDir)}.json`);
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
	return containsPath(payloadRepoRoot, requestedWorkspaceDir) || containsPath(requestedWorkspaceDir, payloadRepoRoot);
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
		return JSON.parse(await readFile(filePath, "utf8")) as T;
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

function dayStampFor(timestampMs: number): string {
	return new Date(timestampMs).toISOString().slice(0, 10);
}

function truncateText(value: string | undefined, maxChars: number = 280): string {
	const trimmed = value?.trim() ?? "";
	return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}...` : trimmed;
}

function uniqueStrings(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function compactToolChain(steps: TaughtTaskDraftStep[]): WorkflowCrystallizationToolStep[] {
	return steps.map((step) => ({
		index: step.index,
		toolName: step.toolName,
		route: step.route,
		instruction: truncateText(step.instruction, 180),
		...(step.summary ? { summary: truncateText(step.summary, 180) } : {}),
		...(step.inputs ? { inputs: step.inputs } : {}),
		...(step.verificationStatus ? { verificationStatus: step.verificationStatus } : {}),
		...(step.verificationSummary ? { verificationSummary: truncateText(step.verificationSummary, 180) } : {}),
		...(step.uncertain === true ? { uncertain: true } : {}),
	}));
}

function trimRouteOptions(options: WorkflowCrystallizationRouteOption[]): WorkflowCrystallizationRouteOption[] {
	return options
		.map((option) => ({
			...option,
			instruction: truncateText(option.instruction, 220),
		}))
		.slice(0, 16);
}

function trimStages(stages: WorkflowCrystallizationSkillStage[]): WorkflowCrystallizationSkillStage[] {
	return stages
		.map((stage) => ({
			...stage,
			title: truncateText(stage.title, 120),
			goal: truncateText(stage.goal, 220),
			instructions: uniqueStrings(stage.instructions.map((entry) => truncateText(entry, 220))).slice(0, DEFAULT_MAX_STAGE_INSTRUCTIONS),
		}))
		.slice(0, 8);
}

function buildEmptyWorkflowStatusCounts(): WorkflowCrystallizationStatusCounts {
	return {
		completeCount: 0,
		partialCount: 0,
		failedCount: 0,
	};
}

function limitDays(days: WorkflowCrystallizationDayRecord[]): WorkflowCrystallizationDayRecord[] {
	return [...days]
		.sort((left, right) => right.dayStamp.localeCompare(left.dayStamp))
		.slice(0, DEFAULT_MAX_DAYS)
		.sort((left, right) => left.dayStamp.localeCompare(right.dayStamp));
}

function createEmptyLedger(workspaceDir: string, repoRoot?: string): WorkflowCrystallizationLedger {
	return {
		updatedAt: Date.now(),
		workspaceDir: resolve(workspaceDir),
		...(repoRoot ? { repoRoot: resolve(repoRoot) } : {}),
		days: [],
		clusters: [],
		skills: [],
		analysisState: {},
	};
}

function quoteYamlString(value: string): string {
	return JSON.stringify(value);
}

function sanitizeSkillSlug(value: string | undefined, fallback: string = "workflow"): string {
	const base = value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ?? "";
	return (base || fallback).slice(0, 48);
}

function resolveDefaultWorkflowSkillsDir(workspaceDir: string): string {
	return join(resolve(workspaceDir), "skills");
}

function buildPublishedWorkflowSkillName(skill: WorkflowCrystallizationSkill): string {
	return `crystallized-${sanitizeSkillSlug(skill.title)}-${skill.clusterId.slice(0, 8)}`;
}

function buildWorkflowCrystallizedSkillMarkdown(params: {
	workspaceDir: string;
	skill: WorkflowCrystallizationSkill;
	name: string;
}): string {
	const { name, skill, workspaceDir } = params;
	const successfulEpisodeCount = skill.successfulEpisodeCount ?? skill.sourceEpisodeCount;
	const observedStatusCounts = {
		...buildEmptyWorkflowStatusCounts(),
		...skill.observedStatusCounts,
	};
	if (skill.observedStatusCounts?.completeCount === undefined) {
		observedStatusCounts.completeCount = successfulEpisodeCount;
	}
	return [
		"---",
		`name: ${name}`,
		`description: ${quoteYamlString(skill.summary ?? skill.objective)}`,
		...(skill.triggers.length > 0
			? [
				"triggers:",
				...skill.triggers.map((trigger) => `  - ${quoteYamlString(trigger)}`),
			]
			: []),
		"metadata:",
		"  understudy:",
		"    crystallized: true",
		`    workspaceDir: ${quoteYamlString(resolve(workspaceDir))}`,
		`    clusterId: ${quoteYamlString(skill.clusterId)}`,
		`    workflowSkillId: ${quoteYamlString(skill.id)}`,
		`    sourceEpisodeCount: ${skill.sourceEpisodeCount}`,
		`    successfulEpisodeCount: ${successfulEpisodeCount}`,
		"    observedStatusCounts:",
		`      complete: ${observedStatusCounts.completeCount}`,
		`      partial: ${observedStatusCounts.partialCount}`,
		`      failed: ${observedStatusCounts.failedCount}`,
		"---",
		"",
		`# ${name}`,
		"",
		`This workspace skill was crystallized from repeated workflow-family episodes observed in \`${resolve(workspaceDir)}\`. Successful runs were prioritized, while partial and failed runs informed failure handling.`,
		"",
		"## Overall Goal",
		"",
		skill.objective,
		"",
		"## When To Use",
		"",
		skill.summary ?? "Use this when the current request matches the repeated workflow captured by this crystallized skill.",
		"",
		"## Parameter Slots",
		"",
		...(skill.parameterSlots.length > 0
			? skill.parameterSlots.map((slot) =>
				`- ${slot.name}${slot.label ? ` (${slot.label})` : ""}${slot.sampleValue ? `: ${slot.sampleValue}` : ""}${slot.required === false ? " [optional]" : ""}${slot.notes ? ` - ${slot.notes}` : ""}`)
			: ["- No stable parameter slots were inferred. Confirm runtime inputs with the user before acting."]),
		"",
		"## Observed Run States",
		"",
		`- Complete runs: ${observedStatusCounts.completeCount}`,
		`- Partial runs: ${observedStatusCounts.partialCount}`,
		`- Failed runs: ${observedStatusCounts.failedCount}`,
		"",
		"## Staged Workflow",
		"",
		...(skill.stages.length > 0
			? skill.stages.flatMap((stage, index) => [
				`${index + 1}. ${stage.title}`,
				`   Goal: ${stage.goal}`,
				...stage.instructions.map((instruction) => `   - ${instruction}`),
			])
			: ["1. No staged workflow was synthesized. Re-observe the current task and verify the outcome carefully."]),
		"",
		"## Route Guidance",
		"",
		...(skill.routeOptions.length > 0
			? skill.routeOptions.map((option) =>
				`- [${option.preference}:${option.route}${option.toolName ? `:${option.toolName}` : ""}] ${option.instruction}`)
			: ["- No stable route guidance was inferred. Choose the safest route that preserves the externally visible outcome."]),
		"",
		"## Success Criteria",
		"",
		...(skill.successCriteria.length > 0
			? skill.successCriteria.map((criterion) => `- ${criterion}`)
			: ["- Verify the user-visible outcome before considering the workflow complete."]),
		"",
		"## Failure Policy",
		"",
		...(skill.failurePolicy.length > 0
			? skill.failurePolicy.map((entry) => `- ${entry}`)
			: [
				"- Re-observe the current state if the surface diverges from the repeated workflow.",
				"- Ask the user for missing parameters instead of guessing.",
				"- Prefer a safer higher-level route over brittle low-level replay when both preserve the same outcome.",
			]),
		"",
	].join("\n");
}

export async function persistWorkflowCrystallizationLedger(
	ledger: WorkflowCrystallizationLedger,
	options: PersistWorkflowCrystallizationLedgerOptions = {},
): Promise<void> {
	const ledgerPath = buildWorkflowCrystallizationLedgerPath(ledger.workspaceDir, options.learningDir);
	const ledgerDir = join(resolveLearningDir(options.learningDir), "workflow-crystallization");
	await mkdir(ledgerDir, { recursive: true });
	const tempPath = `${ledgerPath}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(tempPath, JSON.stringify(ledger, null, 2), "utf8");
	await rename(tempPath, ledgerPath);
}

export async function loadPersistedWorkflowCrystallizationLedger(
	options: LoadPersistedWorkflowCrystallizationLedgerOptions,
): Promise<WorkflowCrystallizationLedger | undefined> {
	const workspaceDir = resolve(options.workspaceDir);
	const learningDir = resolveLearningDir(options.learningDir);
	const ledgerPath = buildWorkflowCrystallizationLedgerPath(workspaceDir, learningDir);
	const direct = await readJsonIfExists<WorkflowCrystallizationLedger>(ledgerPath);
	if (direct) {
		return direct;
	}
	return await loadBestMatchingPayload<WorkflowCrystallizationLedger>({
		dirPath: join(learningDir, "workflow-crystallization"),
		requestedWorkspaceDir: workspaceDir,
	});
}

export function buildWorkflowCrystallizationTurnFromRun(
	options: AppendWorkflowCrystallizationTurnFromRunOptions,
): WorkflowCrystallizationTurn {
	const timestamp = options.timestamp ?? options.now ?? Date.now();
	const draft = buildTaughtTaskDraftFromRun({
		...options,
		now: timestamp,
	});
	return {
		id: createHash("sha1")
			.update(resolve(options.workspaceDir))
			.update(options.sessionId ?? "")
			.update(options.runId)
			.digest("hex")
			.slice(0, 16),
		runId: options.runId,
		sessionId: options.sessionId,
		timestamp,
		dayStamp: dayStampFor(timestamp),
		userText: truncateText(options.promptPreview, 500),
		assistantText: truncateText(options.responsePreview, 500),
		evidence: {
			titleGuess: draft.title,
			objectiveGuess: draft.objective,
			parameterHints: uniqueStrings(draft.parameterSlots.map((slot) => slot.name)).slice(0, 8),
			successSignals: uniqueStrings(draft.successCriteria).slice(0, 8),
			uncertainties: uniqueStrings(draft.uncertainties).slice(0, 8),
			...(draft.routeSignature ? { routeSignature: draft.routeSignature } : {}),
			toolChain: compactToolChain(draft.steps).slice(0, 24),
		},
	};
}

export async function appendPersistedWorkflowCrystallizationTurnFromRun(
	options: AppendWorkflowCrystallizationTurnFromRunOptions,
): Promise<{ ledger: WorkflowCrystallizationLedger; turn: WorkflowCrystallizationTurn; day: WorkflowCrystallizationDayRecord }> {
	const workspaceDir = resolve(options.workspaceDir);
	const turn = buildWorkflowCrystallizationTurnFromRun(options);
	const current = await loadPersistedWorkflowCrystallizationLedger({
		workspaceDir,
		learningDir: options.learningDir,
	});
	const ledger = current ?? createEmptyLedger(workspaceDir, options.repoRoot);
	const days = [...ledger.days];
	const dayIndex = days.findIndex((day) => day.dayStamp === turn.dayStamp);
	const nextDay: WorkflowCrystallizationDayRecord = dayIndex >= 0
		? {
			...days[dayIndex],
			updatedAt: turn.timestamp,
			turns: [
				...days[dayIndex]!.turns.filter((entry) => entry.id !== turn.id),
				turn,
			]
				.sort((left, right) => left.timestamp - right.timestamp)
				.slice(-DEFAULT_MAX_TURNS_PER_DAY),
		}
		: {
			dayStamp: turn.dayStamp,
			updatedAt: turn.timestamp,
			turns: [turn],
			segments: [],
			episodes: [],
		};
	if (dayIndex >= 0) {
		days[dayIndex] = nextDay;
	} else {
		days.push(nextDay);
	}
	const nextLedger: WorkflowCrystallizationLedger = {
		...ledger,
		updatedAt: turn.timestamp,
		repoRoot: options.repoRoot ? resolve(options.repoRoot) : ledger.repoRoot,
		days: limitDays(days),
		clusters: ledger.clusters.slice(0, DEFAULT_MAX_CLUSTERS),
		skills: ledger.skills.slice(0, DEFAULT_MAX_SKILLS),
	};
	await persistWorkflowCrystallizationLedger(nextLedger, {
		learningDir: options.learningDir,
	});
	return {
		ledger: nextLedger,
		turn,
		day: nextLedger.days.find((entry) => entry.dayStamp === turn.dayStamp)!,
	};
}

export async function updatePersistedWorkflowCrystallizationLedger(
	options: {
		workspaceDir: string;
		learningDir?: string;
		updater: (ledger: WorkflowCrystallizationLedger) => WorkflowCrystallizationLedger;
	},
): Promise<WorkflowCrystallizationLedger> {
	const workspaceDir = resolve(options.workspaceDir);
	const current = await loadPersistedWorkflowCrystallizationLedger({
		workspaceDir,
		learningDir: options.learningDir,
	});
	const next = options.updater(current ?? createEmptyLedger(workspaceDir));
	await persistWorkflowCrystallizationLedger(next, {
		learningDir: options.learningDir,
	});
	return next;
}

export function replaceWorkflowCrystallizationDaySegments(
	ledger: WorkflowCrystallizationLedger,
	params: {
		dayStamp: string;
		segments: WorkflowCrystallizationSegment[];
		segmentedAt: number;
		segmentedTurnCount: number;
	},
): WorkflowCrystallizationLedger {
	return {
		...ledger,
		updatedAt: params.segmentedAt,
		days: limitDays(ledger.days.map((day) =>
			day.dayStamp !== params.dayStamp
				? day
				: {
					...day,
					updatedAt: params.segmentedAt,
					segments: params.segments.slice(0, DEFAULT_MAX_SEGMENTS_PER_DAY),
					lastSegmentedAt: params.segmentedAt,
					lastSegmentedTurnCount: params.segmentedTurnCount,
				})),
	};
}

export function replaceWorkflowCrystallizationDayEpisodes(
	ledger: WorkflowCrystallizationLedger,
	params: {
		dayStamp: string;
		episodes: WorkflowCrystallizationEpisode[];
		summarizedAt: number;
	},
): WorkflowCrystallizationLedger {
	return {
		...ledger,
		updatedAt: params.summarizedAt,
		days: limitDays(ledger.days.map((day) =>
			day.dayStamp !== params.dayStamp
				? day
				: {
					...day,
					updatedAt: params.summarizedAt,
					episodes: params.episodes.slice(0, DEFAULT_MAX_EPISODES_PER_DAY),
					lastSummarizedAt: params.summarizedAt,
				})),
	};
}

export function replaceWorkflowCrystallizationClusters(
	ledger: WorkflowCrystallizationLedger,
	params: {
		clusters: WorkflowCrystallizationCluster[];
		clusteredAt: number;
		clusteredEpisodeCount: number;
		clusteredFingerprint?: string;
	},
): WorkflowCrystallizationLedger {
	return {
		...ledger,
		updatedAt: params.clusteredAt,
		clusters: params.clusters.slice(0, DEFAULT_MAX_CLUSTERS),
		analysisState: {
			...ledger.analysisState,
			lastClusteredAt: params.clusteredAt,
			lastClusteredEpisodeCount: params.clusteredEpisodeCount,
			lastClusteredFingerprint: params.clusteredFingerprint,
		},
	};
}

export function replaceWorkflowCrystallizationSkills(
	ledger: WorkflowCrystallizationLedger,
	params: {
		skills: WorkflowCrystallizationSkill[];
		publishedAt: number;
		publishedClusterCount: number;
		publishedFingerprint?: string;
	},
): WorkflowCrystallizationLedger {
	return {
		...ledger,
		updatedAt: params.publishedAt,
		skills: params.skills
			.map((skill) => ({
				...skill,
				stages: trimStages(skill.stages),
				routeOptions: trimRouteOptions(skill.routeOptions),
				successfulEpisodeCount: skill.successfulEpisodeCount ?? skill.sourceEpisodeCount,
				observedStatusCounts: (() => {
					const observedStatusCounts = {
						...buildEmptyWorkflowStatusCounts(),
						...skill.observedStatusCounts,
					};
					if (skill.observedStatusCounts?.completeCount === undefined) {
						observedStatusCounts.completeCount = skill.successfulEpisodeCount ?? skill.sourceEpisodeCount;
					}
					return observedStatusCounts;
				})(),
			}))
			.slice(0, DEFAULT_MAX_SKILLS),
		analysisState: {
			...ledger.analysisState,
			lastPublishedAt: params.publishedAt,
			lastPublishedClusterCount: params.publishedClusterCount,
			lastPublishedFingerprint: params.publishedFingerprint,
		},
	};
}

export function markWorkflowCrystallizationSkillNotified(
	ledger: WorkflowCrystallizationLedger,
	params: {
		skillId: string;
		notifiedAt: number;
		sessionId?: string;
		message?: string;
	},
): WorkflowCrystallizationLedger {
	return {
		...ledger,
		updatedAt: params.notifiedAt,
		skills: ledger.skills.map((skill) =>
			skill.id !== params.skillId
				? skill
				: {
					...skill,
					notification: {
						notifiedAt: params.notifiedAt,
						...(params.sessionId ? { sessionId: params.sessionId } : {}),
						...(params.message ? { message: params.message } : {}),
					},
				}),
	};
}

export async function publishWorkflowCrystallizedSkill(
	options: PublishWorkflowCrystallizedSkillOptions,
): Promise<WorkflowCrystallizationPublishedSkill> {
	const workspaceDir = resolve(options.workspaceDir);
	const skillsDir = options.skillsDir ?? resolveDefaultWorkflowSkillsDir(workspaceDir);
	const name = options.skill.publishedSkill?.name ?? buildPublishedWorkflowSkillName(options.skill);
	const skillDir = options.skill.publishedSkill?.skillDir ?? join(skillsDir, name);
	const skillPath = options.skill.publishedSkill?.skillPath ?? join(skillDir, "SKILL.md");
	if (options.overwrite === false) {
		const existing = await stat(skillPath).then(() => true).catch(() => false);
		if (existing) {
			throw new Error(`workspace skill already exists: ${name}`);
		}
	}
	await mkdir(skillDir, { recursive: true });
	const markdown = buildWorkflowCrystallizedSkillMarkdown({
		workspaceDir,
		skill: options.skill,
		name,
	});
	const contentFingerprint = createHash("sha1").update(markdown).digest("hex").slice(0, 16);
	await writeFile(skillPath, markdown, "utf8");
	return {
		name,
		skillDir,
		skillPath,
		publishedAt: Date.now(),
		contentFingerprint,
	};
}
