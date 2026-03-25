import {
	loadPlaybookRun,
	loadWorkspaceArtifactByName,
	updatePlaybookRun,
	type PlaybookRunInputValue,
	type PlaybookRunRecord,
	type WorkspaceSkillArtifactDefinition,
} from "@understudy/core";
import { formatInputValue } from "./value-coerce.js";

export interface LaunchSkillStageOptions {
	workspaceDir: string;
	runId: string;
	skillName: string;
	parentSessionId: string;
	stageId?: string;
	label?: string;
	inputs?: Record<string, PlaybookRunInputValue>;
	objective?: string;
	expectedOutputs?: string[];
	contextNotes?: string[];
	spawnSubagent(params: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface LaunchSkillStageResult {
	skill: WorkspaceSkillArtifactDefinition;
	prompt: string;
	spawn: Record<string, unknown>;
	run: PlaybookRunRecord;
}

function buildSkillPrompt(params: {
	skill: WorkspaceSkillArtifactDefinition;
	run: PlaybookRunRecord;
	inputs: Record<string, PlaybookRunInputValue>;
	objective?: string;
	expectedOutputs?: string[];
	contextNotes?: string[];
}): string {
	const inputEntries = Object.entries(params.inputs);
	return [
		`Execute the workspace skill artifact \`${params.skill.name}\`.`,
		"",
		"Playbook run:",
		`- playbookName=${params.run.playbookName}`,
		`- runId=${params.run.id}`,
		`- artifactsRootDir=${params.run.artifacts.rootDir}`,
		`- skillPath=${params.skill.filePath}`,
		...(params.run.notesSummary ? [`- runSummary=${params.run.notesSummary}`] : []),
		"",
		...(params.objective
			? [
				"Stage objective:",
				`- ${params.objective}`,
				"",
			]
			: []),
		"Inputs:",
		...(inputEntries.length > 0
			? inputEntries.map(([key, value]) => `- ${key}=${formatInputValue(value)}`)
			: ["- No explicit inputs were provided. Inspect the run artifacts and the skill contract before acting."]),
		"",
		...(params.expectedOutputs && params.expectedOutputs.length > 0
			? [
				"Expected outputs:",
				...params.expectedOutputs.map((entry) => `- ${entry}`),
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
		"- Read the skill artifact from the workspace and follow its contract.",
		"- Treat the declared expected outputs as a strict completion contract, not a suggestion.",
		"- Do not claim the stage is completed until those outputs actually exist on disk and you have verified the important ones with file checks or equivalent direct evidence.",
		"- If the skill contract says one route is primary and another is fallback-only, do not silently swap in the fallback as the main path.",
		"- Prefer the highest-level route that preserves the intended externally visible outcome.",
		"- Write outputs into the playbook run artifacts root unless the skill contract says otherwise.",
		"",
		"Return a concise final summary with:",
		"- status",
		"- producedArtifacts",
		"- verification",
		"- blockers",
	].join("\n");
}

export async function launchSkillStage(
	options: LaunchSkillStageOptions,
): Promise<LaunchSkillStageResult> {
	const run = await loadPlaybookRun(options.workspaceDir, options.runId);
	if (!run) {
		throw new Error(`Playbook run not found: ${options.runId}`);
	}
	const artifact = await loadWorkspaceArtifactByName({
		workspaceDir: options.workspaceDir,
		name: options.skillName,
	});
	if (!artifact || artifact.artifactKind !== "skill") {
		throw new Error(`Skill artifact not found: ${options.skillName}`);
	}
	const prompt = buildSkillPrompt({
		skill: artifact,
		run,
		inputs: options.inputs ?? run.inputs,
		objective: options.objective,
		expectedOutputs: options.expectedOutputs,
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
		throw new Error("Skill spawn did not return a child session id.");
	}
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
			stages: Array.isArray(run.stages)
				? run.stages.map((stage) => ({
					...stage,
					status: stage.id === stageId ? "running" : stage.status,
				}))
				: run.stages,
		},
	});
	return {
		skill: artifact,
		prompt,
		spawn,
		run: updatedRun,
	};
}
