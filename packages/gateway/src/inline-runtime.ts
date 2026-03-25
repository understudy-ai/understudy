import {
	loadPlaybookRun,
	updatePlaybookRun,
	type PlaybookRunInputValue,
	type PlaybookRunRecord,
	type WorkspacePlaybookArtifactDefinition,
	type WorkspacePlaybookStage,
} from "@understudy/core";
import { formatInputValue } from "./value-coerce.js";

export interface LaunchInlineStageOptions {
	workspaceDir: string;
	runId: string;
	parentSessionId: string;
	stage: WorkspacePlaybookStage;
	playbook: WorkspacePlaybookArtifactDefinition;
	stageId?: string;
	label?: string;
	inputs?: Record<string, PlaybookRunInputValue>;
	contextNotes?: string[];
	spawnSubagent(params: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface LaunchInlineStageResult {
	prompt: string;
	spawn: Record<string, unknown>;
	run: PlaybookRunRecord;
}

function buildInlineStagePrompt(params: {
	stage: WorkspacePlaybookStage;
	playbook: WorkspacePlaybookArtifactDefinition;
	run: PlaybookRunRecord;
	inputs: Record<string, PlaybookRunInputValue>;
	contextNotes?: string[];
}): string {
	const inputEntries = Object.entries(params.inputs);
	return [
		`Execute the inline playbook stage \`${params.stage.name}\`.`,
		"",
		"Playbook run:",
		`- playbookName=${params.playbook.name}`,
		`- runId=${params.run.id}`,
		`- artifactsRootDir=${params.run.artifacts.rootDir}`,
		`- stageId=${params.stage.id}`,
		...(params.run.notesSummary ? [`- runSummary=${params.run.notesSummary}`] : []),
		"",
		"Stage objective:",
		`- ${params.stage.objective}`,
		"",
		"Inputs:",
		...(inputEntries.length > 0
			? inputEntries.map(([key, value]) => `- ${key}=${formatInputValue(value)}`)
			: ["- No explicit inputs were provided. Inspect the run artifacts before acting."]),
		"",
		...(params.stage.outputs.length > 0
			? [
				"Expected outputs:",
				...params.stage.outputs.map((entry) => `- ${entry}`),
				"",
			]
			: []),
		...(params.stage.budgetNotes.length > 0
			? [
				"Budget notes:",
				...params.stage.budgetNotes.map((entry) => `- ${entry}`),
				"",
			]
			: []),
		...(params.contextNotes && params.contextNotes.length > 0
			? [
				"Context notes:",
				...params.contextNotes.map((entry) => `- ${entry}`),
				"",
			]
			: []),
		"Execution notes:",
		"- Treat this as a reusable playbook stage rather than a task-specific hardcoded flow.",
		"- Use the available tools to produce the required outputs in the run artifacts root.",
		"- Prefer concise, externally verifiable progress over speculative exploration.",
		"",
		"Return a concise final summary with:",
		"- status",
		"- producedArtifacts",
		"- verification",
		"- blockers",
	].join("\n");
}

export async function launchInlineStage(
	options: LaunchInlineStageOptions,
): Promise<LaunchInlineStageResult> {
	const run = await loadPlaybookRun(options.workspaceDir, options.runId);
	if (!run) {
		throw new Error(`Playbook run not found: ${options.runId}`);
	}
	const prompt = buildInlineStagePrompt({
		stage: options.stage,
		playbook: options.playbook,
		run,
		inputs: options.inputs ?? run.inputs,
		contextNotes: options.contextNotes,
	});
	const spawn = await options.spawnSubagent({
		parentSessionId: options.parentSessionId,
		task: prompt,
		label: options.label ?? options.stage.name,
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
		throw new Error("Inline stage spawn did not return a child session id.");
	}
	const stageId = options.stageId ?? options.stage.id;
	const updatedRun = await updatePlaybookRun({
		workspaceDir: options.workspaceDir,
		runId: options.runId,
		patch: {
			status: "running",
			childSessions: [
				...run.childSessions.filter((entry) => entry.sessionId !== childSessionId),
				{
					label: options.label ?? options.stage.name,
					sessionId: childSessionId,
					status: typeof spawn.status === "string" ? spawn.status : "in_flight",
					stageId,
					runtime: "subagent",
				},
			],
			stages: Array.isArray(run.stages)
				? run.stages.map((stage) => ({
					...stage,
					status: stage.id === stageId ? "running" : stage.status,
				}))
				: run.stages,
		},
	});
	return {
		prompt,
		spawn,
		run: updatedRun,
	};
}
