import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	createPlaybookRunFromPlaybook,
	loadPlaybookRun,
	loadWorkspaceArtifactByName,
	updatePlaybookRun,
	type PlaybookRunApprovalState,
	type PlaybookRunRecord,
	type WorkspacePlaybookArtifactDefinition,
	type WorkspacePlaybookStage,
} from "@understudy/core";
import {
	launchInlineStage,
	type LaunchInlineStageResult,
} from "./inline-runtime.js";
import {
	launchWorkerStage,
	type LaunchWorkerStageResult,
} from "./worker-runtime.js";
import {
	launchSkillStage,
	type LaunchSkillStageResult,
} from "./skill-runtime.js";

export interface StartPlaybookRunOptions {
	workspaceDir: string;
	playbookName: string;
	inputs?: PlaybookRunRecord["inputs"];
	runId?: string;
	now?: number;
}

export interface ResumePlaybookRunOptions {
	workspaceDir: string;
	runId: string;
	playbookName?: string;
}

export interface PlaybookRunResumeState {
	run: PlaybookRunRecord;
	playbook: WorkspacePlaybookArtifactDefinition;
	currentStage?: WorkspacePlaybookStage;
	nextStage?: WorkspacePlaybookStage;
}

export interface CompletePlaybookStageOptions {
	workspaceDir: string;
	runId: string;
	stageId: string;
	status: "completed" | "failed" | "skipped";
	summary: string;
	artifactPaths?: string[];
	approvalState?: Exclude<PlaybookRunApprovalState, "pending" | "not_required">;
	approvalNote?: string;
	now?: number;
}

export interface RunPlaybookNextStageOptions {
	workspaceDir: string;
	runId: string;
	parentSessionId: string;
	now?: number;
	contextNotes?: string[];
	runSkillStage?(params: {
		run: PlaybookRunRecord;
		stage: WorkspacePlaybookStage;
		playbook: WorkspacePlaybookArtifactDefinition;
	}): Promise<{ summary: string; artifactPaths?: string[] }>;
	runInlineStage?(params: {
		run: PlaybookRunRecord;
		stage: WorkspacePlaybookStage;
		playbook: WorkspacePlaybookArtifactDefinition;
	}): Promise<{ summary: string; artifactPaths?: string[] }>;
	spawnSubagent?(params: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface RunPlaybookNextStageResult {
	mode: "skill" | "worker" | "inline" | "approval";
	stage: WorkspacePlaybookStage;
	run: PlaybookRunRecord;
	summary?: string;
	inlineLaunch?: LaunchInlineStageResult;
	skillLaunch?: LaunchSkillStageResult;
	workerLaunch?: LaunchWorkerStageResult;
}

function normalizeArtifactOutputPattern(value: string): string {
	return value.trim().replace(/^\.?\//, "").replaceAll("\\", "/");
}

function splitArtifactOutputAlternatives(value: string): string[] {
	return value
		.split(/\?\?|\|\|/)
		.map((entry) => normalizeArtifactOutputPattern(entry))
		.filter((entry) => entry.length > 0);
}

function outputPatternHasGlobMagic(value: string): boolean {
	return /[*?]/.test(value);
}

function globPatternToRegex(pattern: string): RegExp {
	let regex = "^";
	for (let index = 0; index < pattern.length; index += 1) {
		const char = pattern[index];
		if (char === "*") {
			if (pattern[index + 1] === "*") {
				regex += ".*";
				index += 1;
			} else {
				regex += "[^/]*";
			}
			continue;
		}
		if (char === "?") {
			regex += "[^/]";
			continue;
		}
		if ("\\.^$+{}()|[]".includes(char)) {
			regex += `\\${char}`;
			continue;
		}
		regex += char;
	}
	regex += "$";
	return new RegExp(regex);
}

async function collectArtifactFiles(
	rootDir: string,
	relativeDir = "",
): Promise<string[]> {
	const currentDir = relativeDir ? join(rootDir, relativeDir) : rootDir;
	const entries = await readdir(currentDir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const relativePath = normalizeArtifactOutputPattern(
			relativeDir ? `${relativeDir}/${entry.name}` : entry.name,
		);
		if (entry.isDirectory()) {
			files.push(...await collectArtifactFiles(rootDir, relativePath));
			continue;
		}
		files.push(relativePath);
	}
	return files;
}

async function findMissingStageOutputs(params: {
	workspaceDir: string;
	run: PlaybookRunRecord;
	stageId: string;
}): Promise<string[]> {
	const artifact = await loadWorkspaceArtifactByName({
		workspaceDir: params.workspaceDir,
		name: params.run.playbookName,
	});
	if (!artifact || artifact.artifactKind !== "playbook") {
		return [];
	}
	const stage = artifact.stages.find((entry) => entry.id === params.stageId);
	if (!stage || stage.kind === "approval" || stage.outputs.length === 0) {
		return [];
	}
	const outputGroups = stage.outputs
		.map((entry) => splitArtifactOutputAlternatives(entry))
		.filter((entry) => entry.length > 0);
	if (outputGroups.length === 0) {
		return [];
	}
	let artifactFiles: string[] | undefined;
	const missing: string[] = [];
	for (const patterns of outputGroups) {
		let satisfied = false;
		for (const pattern of patterns) {
			if (outputPatternHasGlobMagic(pattern)) {
				artifactFiles ??= await collectArtifactFiles(params.run.artifacts.rootDir);
				const regex = globPatternToRegex(pattern);
				if (artifactFiles.some((entry) => regex.test(entry))) {
					satisfied = true;
					break;
				}
				continue;
			}
			try {
				await stat(join(params.run.artifacts.rootDir, pattern));
				satisfied = true;
				break;
			} catch {
				// Try the next alternative.
			}
		}
		if (!satisfied) {
			missing.push(patterns.join(" ?? "));
		}
	}
	return missing;
}

function resolveCompletionRunStatus(params: {
	stage: { kind: WorkspacePlaybookStage["kind"] };
	status: CompletePlaybookStageOptions["status"];
	approvalState?: CompletePlaybookStageOptions["approvalState"];
	nextPendingStage?: { kind: WorkspacePlaybookStage["kind"] };
}): PlaybookRunRecord["status"] {
	if (params.status === "failed") {
		return "failed";
	}
	if (params.stage.kind === "approval" && params.approvalState === "rejected") {
		return "paused";
	}
	if (params.nextPendingStage?.kind === "approval") {
		return "waiting_for_approval";
	}
	return params.nextPendingStage ? "running" : "completed";
}

function resolveStageFromRun(
	run: PlaybookRunRecord,
	playbook: WorkspacePlaybookArtifactDefinition,
): { currentStage?: WorkspacePlaybookStage; nextStage?: WorkspacePlaybookStage } {
	const stageStates = run.stages ?? [];
	const runningStage = stageStates.find((stage) => stage.status === "running");
	if (runningStage) {
		const currentStage = playbook.stages.find((stage) => stage.id === runningStage.id);
		return { currentStage };
	}
	const nextPending = stageStates.find((stage) => stage.status === "pending");
	if (nextPending) {
		const nextStage = playbook.stages.find((stage) => stage.id === nextPending.id);
		return { nextStage };
	}
	return {};
}

async function loadCompletedStageArtifactPaths(
	run: PlaybookRunRecord,
): Promise<Record<string, string>> {
	const summaryDir = run.artifacts.stageSummaryDir;
	const bindings: Record<string, string> = {};
	let files: string[];
	try {
		files = await readdir(summaryDir);
	} catch {
		return bindings;
	}
	for (const file of files) {
		if (!file.endsWith(".md")) continue;
		const stageId = file.slice(0, -3);
		const filePath = join(summaryDir, file);
		try {
			const content = await readFile(filePath, "utf8");
			const artifactLines: string[] = [];
			let inArtifacts = false;
			for (const line of content.split("\n")) {
				if (line === "Artifacts:") {
					inArtifacts = true;
					continue;
				}
				if (inArtifacts && line.startsWith("- ")) {
					artifactLines.push(line.slice(2));
				} else if (inArtifacts) {
					break;
				}
			}
			if (artifactLines.length > 0) {
				bindings[`stage.${stageId}.artifactPaths`] = artifactLines.join(",");
			}
			bindings[`stage.${stageId}.summaryFile`] = filePath;
		} catch {
			// skip unreadable summaries
		}
	}
	return bindings;
}

async function resolveStageInputBindings(
	run: PlaybookRunRecord,
	stage: WorkspacePlaybookStage,
): Promise<Record<string, string | number | boolean>> {
	const completedArtifacts = await loadCompletedStageArtifactPaths(run);
	const combinedInputs: Record<string, string | number | boolean> = {
		playbookName: run.playbookName,
		playbookRunId: run.id,
		artifactsRootDir: run.artifacts.rootDir,
		stageSummaryDir: run.artifacts.stageSummaryDir,
		...completedArtifacts,
		...run.inputs,
	};
	if (stage.inputs.length === 0) {
		return combinedInputs;
	}
	return Object.fromEntries(
		stage.inputs
			.map((key) => [key, combinedInputs[key]] as const)
			.filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined),
	);
}

async function writeStageSummaryFile(
	run: PlaybookRunRecord,
	stageId: string,
	summary: string,
	artifactPaths?: string[],
): Promise<void> {
	const summaryDir = run.artifacts.stageSummaryDir;
	await mkdir(summaryDir, { recursive: true });
	const body = [
		`# ${stageId}`,
		"",
		summary,
		...(artifactPaths && artifactPaths.length > 0
			? ["", "Artifacts:", ...artifactPaths.map((entry) => `- ${entry}`)]
			: []),
		"",
	].join("\n");
	await writeFile(join(summaryDir, `${stageId}.md`), body, "utf8");
}

export async function startPlaybookRun(
	options: StartPlaybookRunOptions,
): Promise<PlaybookRunResumeState> {
	const created = await createPlaybookRunFromPlaybook({
		workspaceDir: options.workspaceDir,
		playbookName: options.playbookName,
		inputs: options.inputs,
		runId: options.runId,
		now: options.now,
	});
	return {
		run: created.run,
		playbook: created.playbook,
		nextStage: created.playbook.stages[0],
	};
}

export async function resumePlaybookRun(
	options: ResumePlaybookRunOptions,
): Promise<PlaybookRunResumeState> {
	const run = await loadPlaybookRun(options.workspaceDir, options.runId);
	if (!run) {
		throw new Error(`Playbook run not found: ${options.runId}`);
	}
	const artifact = await loadWorkspaceArtifactByName({
		workspaceDir: options.workspaceDir,
		name: options.playbookName ?? run.playbookName,
	});
	if (!artifact || artifact.artifactKind !== "playbook") {
		throw new Error(`Playbook not found: ${options.playbookName ?? run.playbookName}`);
	}
	const { currentStage, nextStage } = resolveStageFromRun(run, artifact);
	return {
		run,
		playbook: artifact,
		...(currentStage ? { currentStage } : {}),
		...(nextStage ? { nextStage } : {}),
	};
}

export async function completePlaybookStage(
	options: CompletePlaybookStageOptions,
): Promise<PlaybookRunRecord> {
	const run = await loadPlaybookRun(options.workspaceDir, options.runId);
	if (!run) {
		throw new Error(`Playbook run not found: ${options.runId}`);
	}
	const currentStages = run.stages ?? [];
	const currentStage = currentStages.find((stage) => stage.id === options.stageId);
	if (!currentStage) {
		throw new Error(`Playbook stage not found: ${options.stageId}`);
	}
	if (currentStage.kind === "approval" && options.status === "completed" && !options.approvalState) {
		throw new Error("approvalState is required when completing an approval stage.");
	}
	if (currentStage.kind !== "approval" && options.approvalState) {
		throw new Error("approvalState can only be provided for approval stages.");
	}
	let effectiveStatus = options.status;
	let effectiveSummary = options.summary;
	if (options.status === "completed") {
		const missingOutputs = await findMissingStageOutputs({
			workspaceDir: options.workspaceDir,
			run,
			stageId: options.stageId,
		});
		if (missingOutputs.length > 0) {
			effectiveStatus = "failed";
			effectiveSummary = [
				options.summary,
				"",
				"Playbook output validation failed. Missing expected outputs:",
				...missingOutputs.map((entry) => `- ${entry}`),
			].join("\n");
		}
	}
	await writeStageSummaryFile(run, options.stageId, effectiveSummary, options.artifactPaths);
	const currentIndex = currentStages.findIndex((stage) => stage.id === options.stageId);
	const nextPendingStage = currentIndex >= 0
		? currentStages.slice(currentIndex + 1).find((stage) => stage.status === "pending")
		: currentStages.find((stage) => stage.status === "pending");
	return await updatePlaybookRun({
		workspaceDir: options.workspaceDir,
		runId: options.runId,
		now: options.now,
		patch: {
			status: resolveCompletionRunStatus({
				stage: currentStage,
				status: effectiveStatus,
				approvalState: options.approvalState,
				nextPendingStage,
			}),
			notesSummary: effectiveSummary,
			...(currentStage.kind === "approval" && options.approvalState
				? {
					approval: {
						required: true,
						state: options.approvalState,
						...(options.approvalNote ? { note: options.approvalNote } : {}),
					},
				}
				: {}),
			stages: currentStages.map((stage) => ({
				...stage,
				status: stage.id === options.stageId ? effectiveStatus : stage.status,
				updatedAt: stage.id === options.stageId ? (options.now ?? Date.now()) : stage.updatedAt,
			})),
			childSessions: run.childSessions.map((entry) => (
				entry.stageId === options.stageId
					? {
						...entry,
						status: effectiveStatus,
						updatedAt: options.now ?? Date.now(),
					}
					: entry
			)),
		},
	});
}

export async function runPlaybookNextStage(
	options: RunPlaybookNextStageOptions,
): Promise<RunPlaybookNextStageResult> {
	const resumed = await resumePlaybookRun({
		workspaceDir: options.workspaceDir,
		runId: options.runId,
	});
	const stage = resumed.nextStage;
	if (!stage) {
		const currentInfo = resumed.currentStage
			? ` Current stage "${resumed.currentStage.name}" is still running.`
			: "";
		throw new Error(`No pending stage to advance in run ${options.runId}.${currentInfo}`);
	}
	if (stage.kind === "approval") {
		const run = await updatePlaybookRun({
			workspaceDir: options.workspaceDir,
			runId: options.runId,
			now: options.now,
			patch: {
				status: "waiting_for_approval",
				stages: (resumed.run.stages ?? []).map((entry) => ({
					...entry,
					status: entry.id === stage.id ? "running" : entry.status,
					updatedAt: entry.id === stage.id ? (options.now ?? Date.now()) : entry.updatedAt,
				})),
				approval: {
					required: true,
					state: "pending",
					note: stage.objective,
				},
			},
		});
		return {
			mode: "approval",
			stage,
			run,
		};
	}
	if (stage.kind === "worker") {
		if (!stage.refName) {
			throw new Error(`Stage "${stage.name}" (kind: ${stage.kind}) requires a refName to reference the target artifact.`);
		}
		if (!options.spawnSubagent) {
			throw new Error("spawnSubagent is required to run worker stages.");
		}
		const workerLaunch = await launchWorkerStage({
			workspaceDir: options.workspaceDir,
			runId: options.runId,
			workerName: stage.refName,
			parentSessionId: options.parentSessionId,
			stageId: stage.id,
			label: stage.refName ?? stage.name,
			inputs: await resolveStageInputBindings(resumed.run, stage),
			contextNotes: options.contextNotes,
			spawnSubagent: options.spawnSubagent,
		});
		return {
			mode: "worker",
			stage,
			run: workerLaunch.run,
			workerLaunch,
		};
	}
	if (stage.kind === "skill" && !options.runSkillStage) {
		if (!stage.refName) {
			throw new Error(`Stage "${stage.name}" (kind: ${stage.kind}) requires a refName to reference the target artifact.`);
		}
		if (!options.spawnSubagent) {
			throw new Error("spawnSubagent is required to launch skill stages without a custom handler.");
		}
		const skillLaunch = await launchSkillStage({
			workspaceDir: options.workspaceDir,
			runId: options.runId,
			skillName: stage.refName,
			parentSessionId: options.parentSessionId,
			stageId: stage.id,
			label: stage.refName ?? stage.name,
			inputs: await resolveStageInputBindings(resumed.run, stage),
			objective: stage.objective,
			expectedOutputs: stage.outputs,
			contextNotes: options.contextNotes,
			spawnSubagent: options.spawnSubagent,
		});
		return {
			mode: "skill",
			stage,
			run: skillLaunch.run,
			skillLaunch,
		};
	}
	if (stage.kind === "inline") {
		if (!options.spawnSubagent) {
			throw new Error("spawnSubagent is required to launch inline stages without a custom handler.");
		}
		const inlineLaunch = await launchInlineStage({
			workspaceDir: options.workspaceDir,
			runId: options.runId,
			parentSessionId: options.parentSessionId,
			stage,
			playbook: resumed.playbook,
			stageId: stage.id,
			label: stage.name,
			inputs: await resolveStageInputBindings(resumed.run, stage),
			contextNotes: options.contextNotes,
			spawnSubagent: options.spawnSubagent,
		});
		return {
			mode: "inline",
			stage,
			run: inlineLaunch.run,
			inlineLaunch,
		};
	}
	const handler = stage.kind === "skill" ? options.runSkillStage : options.runInlineStage;
	if (!handler) {
		throw new Error(`${stage.kind} stage handler is required for stage ${stage.id}.`);
	}
	const result = await handler({
		run: resumed.run,
		stage,
		playbook: resumed.playbook,
	});
	const completed = await completePlaybookStage({
		workspaceDir: options.workspaceDir,
		runId: options.runId,
		stageId: stage.id,
		status: "completed",
		summary: result.summary,
		artifactPaths: result.artifactPaths,
		now: options.now,
	});
	return {
		mode: stage.kind,
		stage,
		run: completed,
		summary: result.summary,
	};
}
