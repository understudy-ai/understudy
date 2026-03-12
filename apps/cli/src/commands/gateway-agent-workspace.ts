import { resolveUnderstudyHomeDir } from "@understudy/core";
import type {
	AgentIdentityConfig,
	AgentProfileConfig,
	UnderstudyConfig,
} from "@understudy/types";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve as resolvePath, sep } from "node:path";
import { asRecord, asString } from "./gateway-support.js";

type AgentWorkspaceFileMeta = {
	size: number;
	updatedAtMs: number;
};

export const DEFAULT_AGENT_ID = "main";
export const DEFAULT_MAIN_SESSION_KEY = "agent:main:main";

export const AGENT_BOOTSTRAP_FILE_NAMES = [
	"AGENTS.md",
	"SOUL.md",
	"TOOLS.md",
	"IDENTITY.md",
	"USER.md",
	"HEARTBEAT.md",
	"BOOTSTRAP.md",
] as const;

export const AGENT_MEMORY_FILE_NAME = "MEMORY.md";
const AGENT_ALLOWED_FILE_NAMES = new Set<string>([
	...AGENT_BOOTSTRAP_FILE_NAMES,
	AGENT_MEMORY_FILE_NAME,
]);

export function normalizeAgentId(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized;
}

export function resolveDefaultAgentWorkspace(agentId: string): string {
	return join(resolveUnderstudyHomeDir(), "agents", agentId, "workspace");
}

export function sanitizeAgentIdentity(identity: AgentIdentityConfig | undefined): AgentIdentityConfig | undefined {
	if (!identity) return undefined;
	const next: AgentIdentityConfig = {};
	const name = asString(identity.name);
	const emoji = asString(identity.emoji);
	const avatar = asString(identity.avatar);
	const avatarUrl = asString(identity.avatarUrl);
	if (name) next.name = name;
	if (emoji) next.emoji = emoji;
	if (avatar) next.avatar = avatar;
	if (avatarUrl) next.avatarUrl = avatarUrl;
	return Object.keys(next).length > 0 ? next : undefined;
}

export function sanitizeAgentEntry(entry: AgentProfileConfig): AgentProfileConfig {
	const next: AgentProfileConfig = {
		id: normalizeAgentId(entry.id),
	};
	const name = asString(entry.name);
	const workspace = asString(entry.workspace);
	const model = asString(entry.model);
	const identity = sanitizeAgentIdentity(entry.identity);
	if (name) next.name = name;
	if (workspace) next.workspace = workspace;
	if (model) next.model = model;
	if (identity) next.identity = identity;
	return next;
}

export function parseAgentEntries(config: UnderstudyConfig): AgentProfileConfig[] {
	if (!Array.isArray(config.agents?.list)) {
		return [];
	}
	const unique = new Map<string, AgentProfileConfig>();
	for (const rawEntry of config.agents?.list ?? []) {
		const entry = asRecord(rawEntry);
		const agentId = normalizeAgentId(asString(entry.id) ?? "");
		if (!agentId) continue;
		const normalized = sanitizeAgentEntry({
			id: agentId,
			name: asString(entry.name),
			workspace: asString(entry.workspace),
			model: asString(entry.model),
			identity: {
				name: asString(asRecord(entry.identity).name),
				emoji: asString(asRecord(entry.identity).emoji),
				avatar: asString(asRecord(entry.identity).avatar),
				avatarUrl: asString(asRecord(entry.identity).avatarUrl),
			},
		});
		if (!normalized.id) continue;
		unique.set(normalized.id, normalized);
	}
	return Array.from(unique.values());
}

export function resolveAgentSessionScope(config: UnderstudyConfig): "global" | "per-sender" {
	const scope = asString(config.session?.scope);
	if (scope === "global") {
		return "global";
	}
	if (config.gateway?.sessionScope === "global") {
		return "global";
	}
	return "per-sender";
}

export function isValidAgentWorkspaceFileName(name: string): boolean {
	if (!name || basename(name) !== name) {
		return false;
	}
	return AGENT_ALLOWED_FILE_NAMES.has(name);
}

function ensureAgentPathWithinWorkspace(workspaceRoot: string, filePath: string): void {
	if (filePath === workspaceRoot) return;
	if (!filePath.startsWith(`${workspaceRoot}${sep}`)) {
		throw new Error("unsafe workspace file path");
	}
}

export async function resolveAgentWorkspaceFile(params: {
	workspaceDir: string;
	name: string;
}): Promise<{ workspaceRoot: string; filePath: string }> {
	const workspaceRoot = await realpath(params.workspaceDir).catch(() => resolvePath(params.workspaceDir));
	const filePath = resolvePath(workspaceRoot, params.name);
	ensureAgentPathWithinWorkspace(workspaceRoot, filePath);
	return { workspaceRoot, filePath };
}

export async function statAgentWorkspaceFile(filePath: string): Promise<AgentWorkspaceFileMeta | null> {
	try {
		const [fileStat, fileLstat] = await Promise.all([stat(filePath), lstat(filePath)]);
		if (!fileStat.isFile() || fileLstat.isSymbolicLink() || fileStat.nlink > 1) {
			return null;
		}
		return {
			size: fileStat.size,
			updatedAtMs: Math.floor(fileStat.mtimeMs),
		};
	} catch {
		return null;
	}
}

export async function ensureAgentWorkspaceFiles(params: {
	workspaceDir: string;
	agentName: string;
	emoji?: string;
	avatar?: string;
	skipBootstrap?: boolean;
}): Promise<void> {
	await mkdir(params.workspaceDir, { recursive: true });

	const identityLines = [
		"# Identity",
		"",
		`- Name: ${params.agentName}`,
		...(params.emoji ? [`- Emoji: ${params.emoji}`] : []),
		...(params.avatar ? [`- Avatar: ${params.avatar}`] : []),
		"",
	];

	const defaults: Record<string, string> = {
		"AGENTS.md": "# Agent Rules\n\nDefine behavior, constraints, and style for this agent.\n",
		"SOUL.md": "# Persona\n\nDescribe voice, tone, and personality.\n",
		"TOOLS.md": "# Tools\n\nList how this agent should use available tools.\n",
		"IDENTITY.md": `${identityLines.join("\n")}\n`,
		"USER.md": "# User\n\nAdd persistent user preferences here.\n",
		"HEARTBEAT.md": "# Heartbeat\n\nAdd periodic reminders and maintenance checks.\n",
		"BOOTSTRAP.md": "# Bootstrap\n\nInitial setup steps for this agent workspace.\n",
		"MEMORY.md": "# Memory\n\nLong-term notes and facts.\n",
	};

	for (const fileName of AGENT_BOOTSTRAP_FILE_NAMES) {
		if (params.skipBootstrap) break;
		const targetPath = join(params.workspaceDir, fileName);
		if (!existsSync(targetPath)) {
			await writeFile(targetPath, defaults[fileName], "utf-8");
		}
	}

	const memoryPath = join(params.workspaceDir, AGENT_MEMORY_FILE_NAME);
	if (!existsSync(memoryPath)) {
		await writeFile(memoryPath, defaults[AGENT_MEMORY_FILE_NAME], "utf-8");
	}

	const identityPath = join(params.workspaceDir, "IDENTITY.md");
	if (!existsSync(identityPath)) {
		await writeFile(identityPath, defaults["IDENTITY.md"], "utf-8");
	}
}

export async function isWorkspaceOnboardingCompleted(workspaceDir: string): Promise<boolean> {
	const statePath = join(workspaceDir, "workspace-state.json");
	try {
		const raw = await readFile(statePath, "utf-8");
		const parsed = JSON.parse(raw) as { onboardingCompletedAt?: unknown };
		return typeof parsed.onboardingCompletedAt === "string" && parsed.onboardingCompletedAt.trim().length > 0;
	} catch {
		return false;
	}
}
