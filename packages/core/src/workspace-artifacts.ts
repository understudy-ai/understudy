import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createPlaybookRun, updatePlaybookRun, type PlaybookRunInputValue, type PlaybookRunRecord } from "./playbook-runs.js";
import { buildWorkspaceSkillSnapshot } from "./skills/workspace.js";
import { parseSkillFrontmatter, readSkillFrontmatterInfo } from "./skills/frontmatter.js";
import {
	normalizeWorkspacePlaybookApprovalGate,
	type WorkspaceArtifactChildRef,
	type WorkspaceArtifactKind,
	type WorkspacePlaybookApprovalGate,
	type WorkspacePlaybookStageKind,
} from "./workspace-artifact-types.js";

export interface WorkspaceArtifactBaseDefinition {
	name: string;
	description?: string;
	filePath: string;
	workspaceDir: string;
	artifactKind: WorkspaceArtifactKind;
	rawMarkdown: string;
	childArtifacts: WorkspaceArtifactChildRef[];
}

export interface WorkspaceWorkerArtifactDefinition extends WorkspaceArtifactBaseDefinition {
	artifactKind: "worker";
	goal?: string;
	operatingContract: string[];
	inputs: string[];
	outputs: string[];
	budget: string[];
	allowedSurfaces: string[];
	stopConditions: string[];
	decisionHeuristics: string[];
	failurePolicy: string[];
}

export interface WorkspacePlaybookStage {
	id: string;
	name: string;
	kind: WorkspacePlaybookStageKind;
	refName?: string;
	objective: string;
	inputs: string[];
	outputs: string[];
	retryPolicy?: "retry_once" | "skip_with_note" | "pause_for_human";
	approvalGate?: WorkspacePlaybookApprovalGate;
	budgetNotes: string[];
}

export interface WorkspacePlaybookArtifactDefinition extends WorkspaceArtifactBaseDefinition {
	artifactKind: "playbook";
	goal?: string;
	inputs: string[];
	outputContract: string[];
	approvalGates: string[];
	failurePolicy: string[];
	stages: WorkspacePlaybookStage[];
}

export interface WorkspaceSkillArtifactDefinition extends WorkspaceArtifactBaseDefinition {
	artifactKind: "skill";
}

export type WorkspaceArtifactDefinition =
	| WorkspaceSkillArtifactDefinition
	| WorkspaceWorkerArtifactDefinition
	| WorkspacePlaybookArtifactDefinition;

export interface LoadWorkspaceArtifactOptions {
	workspaceDir: string;
	name: string;
	config?: Record<string, unknown>;
}

export interface CreatePlaybookRunFromPlaybookOptions {
	workspaceDir: string;
	playbookName: string;
	inputs?: Record<string, PlaybookRunInputValue>;
	runId?: string;
	now?: number;
	approvalRequired?: boolean;
}

export interface CreatePlaybookRunFromPlaybookResult {
	playbook: WorkspacePlaybookArtifactDefinition;
	run: PlaybookRunRecord;
}

function trimToUndefined(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function stripFrontmatter(raw: string): string {
	if (!raw.startsWith("---")) {
		return raw;
	}
	const endMarker = raw.indexOf("\n---", 3);
	if (endMarker === -1) {
		return raw;
	}
	return raw.slice(endMarker + 4).replace(/^\s+/, "");
}

function parseMarkdownSections(rawMarkdown: string): Map<string, string[]> {
	const body = stripFrontmatter(rawMarkdown);
	const lines = body.split(/\r?\n/);
	const sections = new Map<string, string[]>();
	let current = "_root";
	let bucket: string[] = [];
	for (const line of lines) {
		const headingMatch = line.match(/^##\s+(.+?)\s*$/);
		if (headingMatch) {
			sections.set(current, bucket);
			current = headingMatch[1].trim().toLowerCase();
			bucket = [];
			continue;
		}
		bucket.push(line);
	}
	sections.set(current, bucket);
	return sections;
}

function collectBulletValues(lines: string[] | undefined): string[] {
	if (!lines) {
		return [];
	}
	return lines
		.map((line) => {
			const match = line.match(/^\s*[-*]\s+(.+?)\s*$/);
			return trimToUndefined(match?.[1]);
		})
		.filter((value): value is string => Boolean(value));
}

function collectFreeformText(lines: string[] | undefined): string | undefined {
	if (!lines) {
		return undefined;
	}
	return trimToUndefined(lines.join("\n").replace(/\n{3,}/g, "\n\n"));
}

function normalizeStageSlug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		|| "stage";
}

function parseCommaSeparatedList(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((entry) => trimToUndefined(entry))
		.filter((entry): entry is string => Boolean(entry));
}

function parsePlaybookStageLine(line: string, index: number): WorkspacePlaybookStage | undefined {
	const match = line.match(/^\s*\d+\.\s+\[(skill|worker|inline|approval)\]\s+([a-zA-Z0-9._-]+)(?:\s+->\s+([^|]+?))?(?:\s*\|\s*(.+))?\s*$/i);
	if (!match) {
		return undefined;
	}
	const kind = match[1].toLowerCase() as WorkspacePlaybookStageKind;
	const refName = trimToUndefined(match[2]);
	const objective = trimToUndefined(match[3]) ?? refName ?? `Stage ${index + 1}`;
	const modifiers = (match[4] ?? "").split("|").map((entry) => entry.trim()).filter(Boolean);
	const modifierMap = new Map<string, string>();
	for (const modifier of modifiers) {
		const [rawKey, ...rest] = modifier.split(":");
		const key = rawKey?.trim().toLowerCase();
		const value = rest.join(":").trim();
		if (key && value) {
			modifierMap.set(key, value);
		}
	}
	const retryPolicyValue = trimToUndefined(modifierMap.get("retry"));
	const approvalGateValue = normalizeWorkspacePlaybookApprovalGate(modifierMap.get("approval"));
	const stageName = refName
		? refName.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
		: objective;
	return {
		id: `${normalizeStageSlug(refName ?? objective)}-${index + 1}`,
		name: stageName,
		kind,
		...(kind === "skill" || kind === "worker" ? (refName ? { refName } : {}) : {}),
		objective,
		inputs: parseCommaSeparatedList(modifierMap.get("inputs")),
		outputs: parseCommaSeparatedList(modifierMap.get("outputs")),
		...(retryPolicyValue === "retry_once" || retryPolicyValue === "skip_with_note" || retryPolicyValue === "pause_for_human"
			? { retryPolicy: retryPolicyValue }
			: {}),
		...(approvalGateValue ? { approvalGate: approvalGateValue } : {}),
		budgetNotes: parseCommaSeparatedList(modifierMap.get("budget")),
	};
}

function parsePlaybookStages(lines: string[] | undefined): WorkspacePlaybookStage[] {
	if (!lines) {
		return [];
	}
	return lines
		.map((line, index) => parsePlaybookStageLine(line, index))
		.filter((stage): stage is WorkspacePlaybookStage => Boolean(stage));
}

function resolveArtifactKind(filePath: string): WorkspaceArtifactKind {
	const frontmatter = readSkillFrontmatterInfo(filePath);
	return frontmatter?.metadata?.artifactKind ?? "skill";
}

async function loadRawArtifact(filePath: string): Promise<{
	frontmatter: Record<string, unknown>;
	rawMarkdown: string;
}> {
	const [frontmatter, rawMarkdown] = await Promise.all([
		Promise.resolve(parseSkillFrontmatter(filePath) ?? {}),
		readFile(filePath, "utf8"),
	]);
	return { frontmatter, rawMarkdown };
}

export async function loadWorkspaceArtifactByName(
	options: LoadWorkspaceArtifactOptions,
): Promise<WorkspaceArtifactDefinition | undefined> {
	const snapshot = buildWorkspaceSkillSnapshot({
		workspaceDir: options.workspaceDir,
		config: options.config as any,
	});
	const skill = snapshot.resolvedSkills.find((entry) => entry.name === options.name);
	if (!skill) {
		return undefined;
	}
	return await loadWorkspaceArtifactFromFile({
		filePath: skill.filePath,
		workspaceDir: options.workspaceDir,
	});
}

export async function loadWorkspaceArtifactFromFile(params: {
	filePath: string;
	workspaceDir?: string;
}): Promise<WorkspaceArtifactDefinition> {
	const filePath = resolve(params.filePath);
	const { frontmatter, rawMarkdown } = await loadRawArtifact(filePath);
	const artifactKind = resolveArtifactKind(filePath);
	const sections = parseMarkdownSections(rawMarkdown);
	const workspaceDir = resolve(params.workspaceDir ?? (typeof frontmatter.metadata === "object" &&
		frontmatter.metadata &&
		typeof (frontmatter.metadata as Record<string, unknown>).understudy === "object" &&
		(frontmatter.metadata as Record<string, unknown>).understudy
		? (((frontmatter.metadata as Record<string, unknown>).understudy as Record<string, unknown>).workspaceDir as string | undefined) ?? process.cwd()
		: process.cwd()));
	const base: WorkspaceArtifactBaseDefinition = {
		name: trimToUndefined(typeof frontmatter.name === "string" ? frontmatter.name : undefined)
			?? filePath.split("/").at(-2)
			?? "artifact",
		description: trimToUndefined(typeof frontmatter.description === "string" ? frontmatter.description : undefined),
		filePath,
		workspaceDir,
		artifactKind,
		rawMarkdown,
		childArtifacts: readSkillFrontmatterInfo(filePath)?.metadata?.childArtifacts ?? [],
	};
	if (artifactKind === "worker") {
		return {
			...base,
			artifactKind: "worker",
			goal: collectFreeformText(sections.get("goal")),
			operatingContract: collectBulletValues(sections.get("operating contract")),
			inputs: collectBulletValues(sections.get("inputs")),
			outputs: collectBulletValues(sections.get("outputs")),
			budget: collectBulletValues(sections.get("budget")),
			allowedSurfaces: collectBulletValues(sections.get("allowed surfaces")),
			stopConditions: collectBulletValues(sections.get("stop conditions")),
			decisionHeuristics: collectBulletValues(sections.get("decision heuristics")),
			failurePolicy: collectBulletValues(sections.get("failure policy")),
		};
	}
	if (artifactKind === "playbook") {
		return {
			...base,
			artifactKind: "playbook",
			goal: collectFreeformText(sections.get("goal")),
			inputs: collectBulletValues(sections.get("inputs")),
			outputContract: collectBulletValues(sections.get("output contract")),
			approvalGates: collectBulletValues(sections.get("approval gates")),
			failurePolicy: collectBulletValues(sections.get("failure policy")),
			stages: parsePlaybookStages(sections.get("stage plan")),
		};
	}
	return {
		...base,
		artifactKind: "skill",
	};
}

export async function createPlaybookRunFromPlaybook(
	options: CreatePlaybookRunFromPlaybookOptions,
): Promise<CreatePlaybookRunFromPlaybookResult> {
	const artifact = await loadWorkspaceArtifactByName({
		workspaceDir: options.workspaceDir,
		name: options.playbookName,
	});
	if (!artifact) {
		throw new Error(`Playbook not found: ${options.playbookName}`);
	}
	if (artifact.artifactKind !== "playbook") {
		throw new Error(`Artifact ${options.playbookName} is not a playbook.`);
	}
	const approvalRequired = options.approvalRequired ?? artifact.stages.some((stage) => stage.kind === "approval");
	const run = await createPlaybookRun({
		workspaceDir: options.workspaceDir,
		playbookName: artifact.name,
		inputs: options.inputs,
		approvalRequired,
		runId: options.runId,
		now: options.now,
	});
	const stagedRun = await updatePlaybookRun({
		workspaceDir: options.workspaceDir,
		runId: run.id,
		now: options.now,
		patch: {
			status: "queued",
			notesSummary: artifact.goal,
			stages: artifact.stages.map((stage) => ({
				id: stage.id,
				name: stage.name,
				kind: stage.kind,
				status: "pending",
				updatedAt: options.now ?? Date.now(),
			})),
		},
	});
	return {
		playbook: artifact,
		run: stagedRun,
	};
}

export function resolveWorkspaceArtifactPath(workspaceDir: string, artifactName: string): string {
	return join(resolve(workspaceDir), "skills", artifactName, "SKILL.md");
}
