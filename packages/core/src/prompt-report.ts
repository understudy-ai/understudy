import { formatSkillsForPrompt, type Skill } from "@mariozechner/pi-coding-agent";
import type { ContextFile } from "./system-prompt.js";
import { resolveUnderstudyToolLines } from "./system-prompt.js";
import { buildProjectContextSection, buildSkillsSection } from "./system-prompt-sections.js";
import type { RuntimeToolDefinition } from "./runtime/types.js";

export interface UnderstudyPromptReport {
	generatedAt: number;
	workspaceDir: string;
	systemPrompt: {
		chars: number;
		projectContextChars: number;
		nonProjectContextChars: number;
	};
	contextFiles: Array<{
		path: string;
		rawChars: number;
		injectedChars: number;
	}>;
	skills: {
		promptChars: number;
		entries: Array<{
			name: string;
			blockChars: number;
		}>;
	};
	tools: {
		listChars: number;
		schemaChars: number;
		entries: Array<{
			name: string;
			summaryChars: number;
			schemaChars: number;
		}>;
	};
}

export interface UnderstudySessionMeta {
	backend: string;
	model: string;
	runtimeProfile: string;
	workspaceDir: string;
	toolNames: string[];
	promptReport: UnderstudyPromptReport;
	auth?: {
		agentDir: string;
		authPath: string;
		modelsPath: string;
		primaryProviders: string[];
		envProviders: string[];
	};
}

interface BuildUnderstudyPromptReportParams {
	workspaceDir: string;
	systemPrompt: string;
	contextFiles: ContextFile[];
	skills: Skill[];
	toolNames: string[];
	toolSummaries: Record<string, string>;
	toolDefinitions: RuntimeToolDefinition[];
}

function measureSchemaChars(parameters: unknown): number {
	try {
		return JSON.stringify(parameters ?? {}).length;
	} catch {
		return 0;
	}
}

function measureSkillBlockChars(skill: Skill): number {
	try {
		return formatSkillsForPrompt([skill]).trim().length;
	} catch {
		return 0;
	}
}

export function buildUnderstudyPromptReport(
	params: BuildUnderstudyPromptReportParams,
): UnderstudyPromptReport {
	const projectContextChars = buildProjectContextSection(params.contextFiles).join("\n").length;
	const skillsPromptChars = buildSkillsSection(params.skills).join("\n").length;
	const { toolLines } = resolveUnderstudyToolLines({
		toolNames: params.toolNames,
		toolSummaries: params.toolSummaries,
	});

	const toolEntries = params.toolDefinitions.map((toolDef) => {
		const summary = (
			params.toolSummaries[toolDef.name.toLowerCase()] ??
			toolDef.description ??
			toolDef.label ??
			""
		).trim();
		return {
			name: toolDef.name,
			summaryChars: summary.length,
			schemaChars: measureSchemaChars(toolDef.parameters),
		};
	});

	return {
		generatedAt: Date.now(),
		workspaceDir: params.workspaceDir,
		systemPrompt: {
			chars: params.systemPrompt.length,
			projectContextChars,
			nonProjectContextChars: Math.max(0, params.systemPrompt.length - projectContextChars),
		},
		contextFiles: params.contextFiles.map((file) => ({
			path: file.path,
			rawChars: file.content.length,
			injectedChars: file.content.trim().length,
		})),
		skills: {
			promptChars: skillsPromptChars,
			entries: params.skills.map((skill) => ({
				name: skill.name,
				blockChars: measureSkillBlockChars(skill),
			})),
		},
		tools: {
			listChars: toolLines.join("\n").length,
			schemaChars: toolEntries.reduce((total, entry) => total + entry.schemaChars, 0),
			entries: toolEntries,
		},
	};
}
