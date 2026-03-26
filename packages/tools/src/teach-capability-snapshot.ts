import {
	buildWorkspaceSkillSnapshot,
	type TaughtTaskExecutionRoute,
	type WorkspaceArtifactKind,
} from "@understudy/core";
import type { UnderstudyConfig } from "@understudy/types";
import { listGuiToolCatalog } from "./gui-tools.js";
import { listRuntimeToolCatalog, type RuntimeToolCatalogEntry } from "./runtime-toolset.js";

export interface TeachCapabilityTool {
	name: string;
	label: string;
	description: string;
	category: RuntimeToolCatalogEntry["category"];
	surface: RuntimeToolCatalogEntry["surface"];
	executionRoute?: TaughtTaskExecutionRoute;
}

export interface TeachCapabilitySkill {
	name: string;
	description?: string;
	artifactKind?: WorkspaceArtifactKind;
	allowedToolNames?: string[];
	primaryEnv?: string;
	requiredEnv?: string[];
}

export interface TeachCapabilitySnapshot {
	tools: TeachCapabilityTool[];
	skills: TeachCapabilitySkill[];
}

function inferExecutionRoute(tool: RuntimeToolCatalogEntry): TaughtTaskExecutionRoute | undefined {
	if (tool.name.startsWith("gui_") || tool.category === "gui") {
		return "gui";
	}
	if (
		tool.name === "browser"
		|| tool.name === "web_search"
		|| tool.name === "web_fetch"
		|| tool.category === "browser"
		|| tool.category === "web"
	) {
		return "browser";
	}
	if (
		tool.name === "bash"
		|| tool.name === "exec"
		|| tool.name === "process"
		|| tool.name === "apply_patch"
		|| tool.category === "workspace"
	) {
		return "shell";
	}
	return undefined;
}

function dedupeTools(tools: TeachCapabilityTool[]): TeachCapabilityTool[] {
	const deduped = new Map<string, TeachCapabilityTool>();
	for (const tool of tools) {
		deduped.set(tool.name, tool);
	}
	return Array.from(deduped.values()).sort((left, right) =>
		left.category.localeCompare(right.category)
		|| left.name.localeCompare(right.name),
	);
}

export function buildTeachCapabilitySnapshot(params: {
	workspaceDir: string;
	config?: UnderstudyConfig;
}): TeachCapabilitySnapshot {
	const runtimeTools = listRuntimeToolCatalog({
		cwd: params.workspaceDir,
		config: params.config,
	}).tools;
	const guiTools = listGuiToolCatalog().map<RuntimeToolCatalogEntry>((tool) => ({
		name: tool.name,
		label: tool.label,
		description: tool.description,
		category: "gui",
		surface: "runtime",
	}));
	const tools = dedupeTools(
		[...runtimeTools, ...guiTools].map((tool) => {
			const executionRoute = inferExecutionRoute(tool);
			return {
				name: tool.name,
				label: tool.label,
				description: tool.description,
				category: tool.category,
				surface: tool.surface,
				...(executionRoute ? { executionRoute } : {}),
			};
		}),
	);
	const skillSnapshot = (() => {
		try {
			return buildWorkspaceSkillSnapshot({
				workspaceDir: params.workspaceDir,
				config: params.config,
			});
		} catch {
			return {
				resolvedSkills: [],
			};
		}
	})();
	return {
		tools,
		skills: skillSnapshot.resolvedSkills.map((skill) => ({
			name: skill.name,
			...(skill.description?.trim() ? { description: skill.description.trim() } : {}),
			...(skill.artifactKind ? { artifactKind: skill.artifactKind } : {}),
			...(skill.allowedToolNames?.length ? { allowedToolNames: skill.allowedToolNames } : {}),
			...(skill.primaryEnv ? { primaryEnv: skill.primaryEnv } : {}),
			...(skill.requiredEnv?.length ? { requiredEnv: skill.requiredEnv } : {}),
		})),
	};
}

function truncateCapabilityText(value: string, maxChars: number): string {
	const trimmed = value.trim().replace(/\s+/g, " ");
	return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars - 3)}...` : trimmed;
}

export function formatTeachCapabilitySnapshotForPrompt(snapshot: TeachCapabilitySnapshot): string[] {
	const lines: string[] = [
		"Current teach-time capability snapshot:",
		`- Runtime functions: ${snapshot.tools.length}`,
		`- Workspace skills: ${snapshot.skills.length}`,
		"Use any exact tool name or skill name from this snapshot when it is the best fit. Do not assume only browser/bash/gui are available.",
		"Select concrete toolName and skillName values only from this snapshot.",
		"Do not invent capabilities that are not listed here.",
	];
	if (snapshot.tools.length > 0) {
		lines.push("Available runtime functions:");
		for (const tool of snapshot.tools) {
			lines.push(
				`- ${tool.name} [${tool.category}${tool.executionRoute ? `, route=${tool.executionRoute}` : ""}, ${tool.surface}]: ${truncateCapabilityText(tool.description || tool.label, 220)}`,
			);
		}
	}
	if (snapshot.skills.length > 0) {
		lines.push("Available workspace skills:");
		for (const skill of snapshot.skills) {
			lines.push(
				`- ${skill.name}${skill.artifactKind ? ` [${skill.artifactKind}]` : ""}${skill.description ? `: ${truncateCapabilityText(skill.description, 180)}` : ""}${skill.allowedToolNames?.length ? ` (allowed tools: ${skill.allowedToolNames.join(", ")})` : ""}${skill.primaryEnv ? ` (primary env: ${skill.primaryEnv})` : ""}`,
			);
		}
	}
	return lines;
}
