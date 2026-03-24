import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { WorkspacePlaybookStageKind } from "./workspace-artifact-types.js";

export type PlaybookRunStatus =
	| "queued"
	| "running"
	| "waiting_for_approval"
	| "completed"
	| "paused"
	| "failed"
	| "cancelled";

export type PlaybookRunApprovalState = "pending" | "approved" | "rejected" | "not_required";
export type PlaybookRunInputValue = string | number | boolean;

export interface PlaybookRunArtifactState {
	rootDir: string;
	stageSummaryDir: string;
}

export interface PlaybookRunChildSessionState {
	label: string;
	sessionId: string;
	status: string;
	stageId?: string;
	runtime?: string;
	updatedAt?: number;
}

export interface PlaybookRunBudgetState {
	maxMinutes?: number;
	maxActions?: number;
	maxScreenshots?: number;
}

export interface PlaybookRunApproval {
	required: boolean;
	state: PlaybookRunApprovalState;
	note?: string;
	updatedAt?: number;
}

export interface PlaybookRunStageState {
	id: string;
	name: string;
	kind: WorkspacePlaybookStageKind;
	status: "pending" | "running" | "completed" | "failed" | "skipped";
	updatedAt?: number;
}

export interface PlaybookRunRecord {
	id: string;
	workspaceDir: string;
	playbookName: string;
	status: PlaybookRunStatus;
	inputs: Record<string, PlaybookRunInputValue>;
	artifacts: PlaybookRunArtifactState;
	childSessions: PlaybookRunChildSessionState[];
	budgets?: {
		worker?: PlaybookRunBudgetState;
	};
	approval: PlaybookRunApproval;
	stages?: PlaybookRunStageState[];
	notesSummary?: string;
	createdAt: number;
	updatedAt: number;
}

export interface CreatePlaybookRunOptions {
	workspaceDir: string;
	playbookName: string;
	inputs?: Record<string, PlaybookRunInputValue>;
	approvalRequired?: boolean;
	runId?: string;
	now?: number;
}

export interface PersistPlaybookRunOptions {
	workspaceDir: string;
	record: PlaybookRunRecord;
}

export interface UpdatePlaybookRunOptions {
	workspaceDir: string;
	runId: string;
	patch: Partial<Omit<PlaybookRunRecord, "id" | "workspaceDir" | "createdAt" | "artifacts" | "inputs">> & {
		artifacts?: Partial<PlaybookRunArtifactState>;
		inputs?: Record<string, PlaybookRunInputValue>;
	};
	now?: number;
}

const PLAYBOOK_RUNS_DIR_NAME = "playbook-runs";

function normalizeWorkspaceDir(workspaceDir: string): string {
	return resolve(workspaceDir);
}

function buildPlaybookRunId(now: number): string {
	const date = new Date(now);
	const parts = [
		date.getUTCFullYear().toString().padStart(4, "0"),
		String(date.getUTCMonth() + 1).padStart(2, "0"),
		String(date.getUTCDate()).padStart(2, "0"),
		String(date.getUTCHours()).padStart(2, "0"),
		String(date.getUTCMinutes()).padStart(2, "0"),
		String(date.getUTCSeconds()).padStart(2, "0"),
	];
	const suffix = Math.random().toString(36).slice(2, 6);
	return `run_${parts.join("")}_${suffix}`;
}

function normalizeInputs(
	value: Record<string, PlaybookRunInputValue> | undefined,
): Record<string, PlaybookRunInputValue> {
	if (!value) {
		return {};
	}
	return Object.fromEntries(
		Object.entries(value).filter((entry) => (
			typeof entry[1] === "string" ||
			typeof entry[1] === "number" ||
			typeof entry[1] === "boolean"
		)),
	);
}

async function readJsonIfExists<T>(filePath: string): Promise<T | undefined> {
	try {
		const raw = await readFile(filePath, "utf8");
		return JSON.parse(raw) as T;
	} catch {
		return undefined;
	}
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function resolvePlaybookRunsDir(workspaceDir: string): string {
	return join(normalizeWorkspaceDir(workspaceDir), ".understudy", PLAYBOOK_RUNS_DIR_NAME);
}

export function resolvePlaybookRunDir(workspaceDir: string, runId: string): string {
	return join(resolvePlaybookRunsDir(workspaceDir), runId);
}

export function resolvePlaybookRunPath(workspaceDir: string, runId: string): string {
	return join(resolvePlaybookRunDir(workspaceDir, runId), "run.json");
}

export function resolvePlaybookRunArtifactsDir(workspaceDir: string, runId: string): string {
	return join(resolvePlaybookRunDir(workspaceDir, runId), "artifacts");
}

export async function ensurePlaybookRunDirs(workspaceDir: string, runId: string): Promise<{
	runDir: string;
	artifactsDir: string;
	stageSummaryDir: string;
}> {
	const runDir = resolvePlaybookRunDir(workspaceDir, runId);
	const artifactsDir = resolvePlaybookRunArtifactsDir(workspaceDir, runId);
	const stageSummaryDir = join(artifactsDir, "stage-summaries");
	await mkdir(stageSummaryDir, { recursive: true });
	return { runDir, artifactsDir, stageSummaryDir };
}

export async function createPlaybookRun(
	options: CreatePlaybookRunOptions,
): Promise<PlaybookRunRecord> {
	const now = options.now ?? Date.now();
	const runId = options.runId ?? buildPlaybookRunId(now);
	const { artifactsDir, stageSummaryDir } = await ensurePlaybookRunDirs(options.workspaceDir, runId);
	const record: PlaybookRunRecord = {
		id: runId,
		workspaceDir: normalizeWorkspaceDir(options.workspaceDir),
		playbookName: options.playbookName,
		status: "queued",
		inputs: normalizeInputs(options.inputs),
		artifacts: {
			rootDir: artifactsDir,
			stageSummaryDir,
		},
		childSessions: [],
		approval: {
			required: options.approvalRequired !== false,
			state: options.approvalRequired === false ? "not_required" : "pending",
			updatedAt: now,
		},
		createdAt: now,
		updatedAt: now,
	};
	return await persistPlaybookRun({
		workspaceDir: options.workspaceDir,
		record,
	});
}

export async function loadPlaybookRun(
	workspaceDir: string,
	runId: string,
): Promise<PlaybookRunRecord | undefined> {
	return await readJsonIfExists<PlaybookRunRecord>(resolvePlaybookRunPath(workspaceDir, runId));
}

export async function listPlaybookRuns(workspaceDir: string): Promise<PlaybookRunRecord[]> {
	const runsDir = resolvePlaybookRunsDir(workspaceDir);
	const names = await readdir(runsDir).catch(() => []);
	const records = await Promise.all(names.map(async (name) => await loadPlaybookRun(workspaceDir, name)));
	return records
		.filter((entry): entry is PlaybookRunRecord => Boolean(entry))
		.sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function persistPlaybookRun(
	options: PersistPlaybookRunOptions,
): Promise<PlaybookRunRecord> {
	await ensurePlaybookRunDirs(options.workspaceDir, options.record.id);
	await writeJson(resolvePlaybookRunPath(options.workspaceDir, options.record.id), options.record);
	return options.record;
}

export async function updatePlaybookRun(
	options: UpdatePlaybookRunOptions,
): Promise<PlaybookRunRecord> {
	const current = await loadPlaybookRun(options.workspaceDir, options.runId);
	if (!current) {
		throw new Error(`Playbook run not found: ${options.runId}`);
	}
	const now = options.now ?? Date.now();
	const next: PlaybookRunRecord = {
		...current,
		...options.patch,
		inputs: options.patch.inputs
			? {
				...current.inputs,
				...normalizeInputs(options.patch.inputs),
			}
			: current.inputs,
		artifacts: options.patch.artifacts
			? {
				...current.artifacts,
				...options.patch.artifacts,
			}
			: current.artifacts,
		approval: options.patch.approval
			? {
				...current.approval,
				...options.patch.approval,
				updatedAt: options.patch.approval.updatedAt ?? now,
			}
			: current.approval,
		updatedAt: now,
	};
	return await persistPlaybookRun({
		workspaceDir: options.workspaceDir,
		record: next,
	});
}
