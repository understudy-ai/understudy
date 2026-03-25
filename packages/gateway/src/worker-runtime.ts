import {
	loadPlaybookRun,
	loadWorkspaceArtifactByName,
	updatePlaybookRun,
	type PlaybookRunInputValue,
	type PlaybookRunRecord,
	type WorkspaceWorkerArtifactDefinition,
} from "@understudy/core";
import { formatInputValue } from "./value-coerce.js";

export interface LaunchWorkerStageOptions {
	workspaceDir: string;
	runId: string;
	workerName: string;
	parentSessionId: string;
	stageId?: string;
	label?: string;
	inputs?: Record<string, PlaybookRunInputValue>;
	contextNotes?: string[];
	spawnSubagent(params: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface LaunchWorkerStageResult {
	worker: WorkspaceWorkerArtifactDefinition;
	prompt: string;
	spawn: Record<string, unknown>;
	run: PlaybookRunRecord;
}

function parseBudgetLines(lines: string[]): Record<string, number> | undefined {
	const budget: Record<string, number> = {};
	for (const line of lines) {
		const match = line.match(/^(maxMinutes|maxActions|maxScreenshots)\s*=\s*(\d+)$/i);
		if (!match) {
			continue;
		}
		budget[match[1]] = Number.parseInt(match[2], 10);
	}
	return Object.keys(budget).length > 0 ? budget : undefined;
}

function buildWorkerPrompt(params: {
	worker: WorkspaceWorkerArtifactDefinition;
	run: PlaybookRunRecord;
	inputs: Record<string, PlaybookRunInputValue>;
	contextNotes?: string[];
}): string {
	const operatingContract = params.worker.operatingContract.length > 0
		? params.worker.operatingContract.map((line) => `- ${line}`)
		: ["- Preserve the assigned goal and required outputs while choosing the cheapest route that still yields strong evidence."];
	const budgetLines = params.worker.budget.length > 0
		? params.worker.budget.map((line) => `- ${line}`)
		: ["- maxMinutes=15", "- maxActions=80", "- maxScreenshots=0"];
	const allowedSurfaces = params.worker.allowedSurfaces.length > 0
		? params.worker.allowedSurfaces.map((line) => `- ${line}`)
		: ["- Only the surfaces required to accomplish the assigned goal."];
	const inputEntries = Object.entries(params.inputs);
	return [
		`You are the Worker artifact \`${params.worker.name}\`.`,
		"",
		"Playbook run:",
		`- playbookName=${params.run.playbookName}`,
		`- runId=${params.run.id}`,
		`- artifactsRootDir=${params.run.artifacts.rootDir}`,
		...(params.run.notesSummary ? [`- runSummary=${params.run.notesSummary}`] : []),
		"",
		"Goal:",
		`- ${params.worker.goal ?? "Carry out the open-ended worker objective and return the required outputs."}`,
		"",
		"Inputs:",
		...(inputEntries.length > 0
			? inputEntries.map(([key, value]) => `- ${key}=${formatInputValue(value)}`)
			: ["- No explicit inputs were provided. Inspect the assigned artifacts and context before acting."]),
		"",
		...(params.contextNotes && params.contextNotes.length > 0
			? [
				"Context Notes:",
				...params.contextNotes.map((note) => `- ${note}`),
				"",
			]
			: []),
		"Operating contract:",
		...operatingContract,
		"",
		"Allowed surfaces:",
		...allowedSurfaces,
		"",
		"Budget:",
		...budgetLines,
		"",
		"Required outputs:",
		...(params.worker.outputs.length > 0
			? params.worker.outputs.map((line) => `- ${line}`)
			: ["- Return the artifacts required by the worker contract."]),
		"",
		"Stop conditions:",
		...(params.worker.stopConditions.length > 0
			? params.worker.stopConditions.map((line) => `- ${line}`)
			: ["- Stop once the required outputs are supported by enough evidence."]),
		"",
		"Decision heuristics:",
		...(params.worker.decisionHeuristics.length > 0
			? params.worker.decisionHeuristics.map((line) => `- ${line}`)
			: ["- Prefer actions that produce evidence and move the task toward completion."]),
		"",
		"Escalate immediately if:",
		...(params.worker.failurePolicy.length > 0
			? params.worker.failurePolicy.map((line) => `- ${line}`)
			: ["- The worker becomes blocked and cannot preserve the intended outcome."]),
		"",
		"Return a concise final summary with:",
		"- status",
		"- producedArtifacts",
		"- keyFindings",
		"- blockers",
		"- nextRecommendation",
	].join("\n");
}

export async function launchWorkerStage(
	options: LaunchWorkerStageOptions,
): Promise<LaunchWorkerStageResult> {
	const run = await loadPlaybookRun(options.workspaceDir, options.runId);
	if (!run) {
		throw new Error(`Playbook run not found: ${options.runId}`);
	}
	const artifact = await loadWorkspaceArtifactByName({
		workspaceDir: options.workspaceDir,
		name: options.workerName,
	});
	if (!artifact || artifact.artifactKind !== "worker") {
		throw new Error(`Worker artifact not found: ${options.workerName}`);
	}
	const prompt = buildWorkerPrompt({
		worker: artifact,
		run,
		inputs: options.inputs ?? run.inputs,
		contextNotes: options.contextNotes,
	});
	const spawn = await options.spawnSubagent({
		parentSessionId: options.parentSessionId,
		task: prompt,
		label: options.label ?? artifact.name,
		runtime: "subagent",
		mode: "session",
		cleanup: "keep",
		thread: true,
		cwd: options.workspaceDir,
	});
	const childSessionId = typeof spawn.childSessionId === "string"
		? spawn.childSessionId
		: typeof spawn.sessionId === "string"
			? spawn.sessionId
			: undefined;
	if (!childSessionId) {
		throw new Error("Worker spawn did not return a child session id.");
	}
	const budget = parseBudgetLines(artifact.budget);
	const stageId = options.stageId ?? artifact.name;
	const updatedRun = await updatePlaybookRun({
		workspaceDir: options.workspaceDir,
		runId: options.runId,
		patch: {
			status: "running",
			childSessions: [
				...run.childSessions.filter((entry) => entry.sessionId !== childSessionId),
				{
					label: options.label ?? artifact.name,
					sessionId: childSessionId,
					status: typeof spawn.status === "string" ? spawn.status : "in_flight",
					stageId,
					runtime: "subagent",
				},
			],
			budgets: budget
				? {
					worker: {
						maxMinutes: budget.maxMinutes,
						maxActions: budget.maxActions,
						maxScreenshots: budget.maxScreenshots,
					},
				}
				: run.budgets,
			stages: Array.isArray(run.stages)
				? run.stages.map((stage) => ({
					...stage,
					status: stage.id === stageId ? "running" : stage.status,
				}))
				: run.stages,
		},
	});
	return {
		worker: artifact,
		prompt,
		spawn,
		run: updatedRun,
	};
}
