import { resolveUnderstudyHomeDir } from "@understudy/core";
import { asBoolean, asNumber, asString, isPlainObject } from "./gateway-support.js";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ExecApprovalsAllowlistEntry = {
	id?: string;
	pattern: string;
	lastUsedAt?: number;
	lastUsedCommand?: string;
	lastResolvedPath?: string;
};

export type ExecApprovalsDefaults = {
	security?: string;
	ask?: string;
	autoAllowSkills?: boolean;
};

export type ExecApprovalsAgent = ExecApprovalsDefaults & {
	allowlist?: ExecApprovalsAllowlistEntry[];
};

export type ExecApprovalsFile = {
	version: 1;
	socket?: {
		path?: string;
		token?: string;
	};
	defaults?: ExecApprovalsDefaults;
	agents?: Record<string, ExecApprovalsAgent>;
};

export type ExecApprovalsSnapshot = {
	path: string;
	exists: boolean;
	hash: string;
	file: ExecApprovalsFile;
};

export const EXEC_APPROVALS_FILE_NAME = "exec-approvals.json";
export const EXEC_APPROVAL_WAIT_TIMEOUT_DEFAULT_MS = 300_000;
export const EXEC_APPROVAL_REQUEST_TIMEOUT_DEFAULT_MS = 300_000;

export function hashJsonPayload(value: unknown): string {
	const json = JSON.stringify(value);
	return createHash("sha256").update(json).digest("hex");
}

export function normalizeExecApprovalsFile(input: unknown, current?: ExecApprovalsFile): ExecApprovalsFile {
	const root = isPlainObject(input) ? input : {};
	const currentSocket = isPlainObject(current?.socket) ? current.socket : {};
	const defaultsInput = isPlainObject(root.defaults) ? root.defaults : {};
	const agentsInput = isPlainObject(root.agents) ? root.agents : {};

	const defaults: ExecApprovalsDefaults = {};
	const security = asString(defaultsInput.security);
	const ask = asString(defaultsInput.ask);
	const autoAllowSkills = asBoolean(defaultsInput.autoAllowSkills);
	if (security) defaults.security = security;
	if (ask) defaults.ask = ask;
	if (autoAllowSkills !== undefined) defaults.autoAllowSkills = autoAllowSkills;

	const agents: Record<string, ExecApprovalsAgent> = {};
	for (const [agentIdRaw, rawAgent] of Object.entries(agentsInput)) {
		const agentId = asString(agentIdRaw);
		if (!agentId || !isPlainObject(rawAgent)) continue;
		const nextAgent: ExecApprovalsAgent = {};
		const agentSecurity = asString(rawAgent.security);
		const agentAsk = asString(rawAgent.ask);
		const agentAutoAllowSkills = asBoolean(rawAgent.autoAllowSkills);
		if (agentSecurity) nextAgent.security = agentSecurity;
		if (agentAsk) nextAgent.ask = agentAsk;
		if (agentAutoAllowSkills !== undefined) nextAgent.autoAllowSkills = agentAutoAllowSkills;

		if (Array.isArray(rawAgent.allowlist)) {
			const entries = rawAgent.allowlist
				.filter((entry): entry is Record<string, unknown> => isPlainObject(entry))
				.map((entry) => {
					const pattern = asString(entry.pattern);
					if (!pattern) return null;
					const nextEntry: ExecApprovalsAllowlistEntry = { pattern };
					const id = asString(entry.id);
					const lastUsedAt = asNumber(entry.lastUsedAt);
					const lastUsedCommand = asString(entry.lastUsedCommand);
					const lastResolvedPath = asString(entry.lastResolvedPath);
					if (id) nextEntry.id = id;
					if (lastUsedAt !== undefined) nextEntry.lastUsedAt = lastUsedAt;
					if (lastUsedCommand) nextEntry.lastUsedCommand = lastUsedCommand;
					if (lastResolvedPath) nextEntry.lastResolvedPath = lastResolvedPath;
					return nextEntry;
				})
				.filter((entry): entry is ExecApprovalsAllowlistEntry => Boolean(entry));
			if (entries.length > 0) {
				nextAgent.allowlist = entries;
			}
		}

		agents[agentId] = nextAgent;
	}

	const socketPath =
		asString(isPlainObject(root.socket) ? root.socket.path : undefined) ??
		asString(currentSocket.path);
	const socketToken = asString(isPlainObject(root.socket) ? root.socket.token : undefined);

	return {
		version: 1,
		socket: socketPath || socketToken ? {
			...(socketPath ? { path: socketPath } : {}),
			...(socketToken ? { token: socketToken } : {}),
		} : undefined,
		defaults: Object.keys(defaults).length > 0 ? defaults : undefined,
		agents: Object.keys(agents).length > 0 ? agents : undefined,
	};
}

export function redactExecApprovalsFile(file: ExecApprovalsFile): ExecApprovalsFile {
	const socketPath = asString(file.socket?.path);
	return {
		...file,
		socket: socketPath ? { path: socketPath } : undefined,
	};
}

export async function readExecApprovalsSnapshot(): Promise<ExecApprovalsSnapshot> {
	const filePath = join(resolveUnderstudyHomeDir(), EXEC_APPROVALS_FILE_NAME);
	let exists = false;
	let parsed: unknown;
	if (existsSync(filePath)) {
		exists = true;
		try {
			parsed = JSON.parse(await readFile(filePath, "utf-8"));
		} catch {
			parsed = {};
		}
	}
	const normalized = normalizeExecApprovalsFile(parsed);
	return {
		path: filePath,
		exists,
		hash: hashJsonPayload(normalized),
		file: normalized,
	};
}

export async function saveExecApprovalsFile(filePath: string, file: ExecApprovalsFile): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true });
	await writeFile(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
}

function escapeRegExp(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesExecApprovalPattern(patternRaw: string, commandRaw: string): boolean {
	const pattern = patternRaw.trim();
	const command = commandRaw.trim();
	if (!pattern || !command) return false;

	if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
		const lastSlash = pattern.lastIndexOf("/");
		const source = pattern.slice(1, lastSlash);
		const flags = pattern.slice(lastSlash + 1);
		try {
			return new RegExp(source, flags).test(command);
		} catch {
			return false;
		}
	}

	if (pattern.includes("*")) {
		const wildcardPattern = `^${pattern.split("*").map(escapeRegExp).join(".*")}$`;
		try {
			return new RegExp(wildcardPattern).test(command);
		} catch {
			return false;
		}
	}

	return pattern === command;
}

export function summarizeApprovalCommand(toolName: string, params?: unknown): {
	command: string;
	commandArgv?: string[];
	resolvedPath?: string;
} {
	const toolParams = isPlainObject(params) ? params : {};
	if (toolName === "bash") {
		const command = asString(toolParams.command) ?? "[empty command]";
		return {
			command,
			resolvedPath: asString(toolParams.cwd) ?? asString(toolParams.path),
		};
	}
	if (toolName === "process") {
		const action = asString(toolParams.action) ?? "unknown";
		const pid = asNumber(toolParams.pid);
		const signal = asString(toolParams.signal);
		const segments = [
			`process action=${action}`,
			pid !== undefined ? `pid=${pid}` : undefined,
			signal ? `signal=${signal}` : undefined,
		].filter(Boolean) as string[];
		return {
			command: segments.join(" "),
		};
	}
	const compact = JSON.stringify(toolParams);
	const command =
		compact && compact !== "{}"
			? `${toolName} ${compact}`.slice(0, 2048)
			: toolName;
	return { command };
}
