/**
 * Build runtime parameters for system prompt construction.
 */

import { hostname, platform, arch, release } from "node:os";
import { resolveWorkspaceContext } from "./workspace-context.js";

export interface RuntimeInfo {
	agentId?: string;
	host: string;
	os: string;
	arch: string;
	node: string;
	model?: string;
	defaultModel?: string;
	shell?: string;
	channel?: string;
	capabilities?: string[];
	repoRoot?: string;
}

export interface SystemPromptRuntimeParams {
	runtimeInfo: RuntimeInfo;
	userTimezone: string;
	userTime: string;
}

export function buildSystemPromptParams(params: {
	agentId?: string;
	model?: string;
	defaultModel?: string;
	channel?: string;
	capabilities?: string[];
	workspaceDir?: string;
	cwd?: string;
	userTimezone?: string;
	repoRoot?: string;
}): SystemPromptRuntimeParams {
	const workspaceContext = resolveWorkspaceContext({
		configuredRepoRoot: params.repoRoot,
		configuredWorkspaceDir: params.workspaceDir,
		fallbackWorkspaceDir: params.cwd,
	});

	const userTimezone = params.userTimezone ?? resolveTimezone();
	const userTime = formatUserTime(new Date(), userTimezone);

	return {
		runtimeInfo: {
			agentId: params.agentId,
			host: hostname(),
			os: `${platform()} ${release()}`,
			arch: arch(),
			node: process.version,
			model: params.model,
			defaultModel: params.defaultModel,
			shell: process.env.SHELL,
			channel: params.channel,
			capabilities: params.capabilities,
			repoRoot: workspaceContext.repoRoot,
		},
		userTimezone,
		userTime,
	};
}

function resolveTimezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone;
	} catch {
		return "UTC";
	}
}

export function formatUserTime(date: Date, timezone: string): string {
	try {
		return date.toLocaleString("en-US", {
			timeZone: timezone,
			weekday: "long",
			year: "numeric",
			month: "long",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		});
	} catch {
		return date.toISOString();
	}
}
