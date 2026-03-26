/**
 * Tool registry for Understudy.
 * Combines runtime built-in tools with Understudy custom tools.
 */

import {
	codingTools,
	createCodingTools,
	type BashSpawnHook,
} from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import type { ToolEntry, ToolRiskLevel, ToolCategory } from "@understudy/types";

/** Default risk/category mappings for built-in tools */
const BUILTIN_META: Record<string, { riskLevel: ToolRiskLevel; category: ToolCategory }> = {
	read: { riskLevel: "read", category: "filesystem" },
	grep: { riskLevel: "read", category: "search" },
	find: { riskLevel: "read", category: "search" },
	ls: { riskLevel: "read", category: "filesystem" },
	bash: { riskLevel: "execute", category: "shell" },
	edit: { riskLevel: "write", category: "filesystem" },
	write: { riskLevel: "write", category: "filesystem" },
};

const KNOWN_TOOL_META: Record<string, { riskLevel: ToolRiskLevel; category: ToolCategory }> = {
	gui_observe: { riskLevel: "execute", category: "gui" },
	gui_click: { riskLevel: "execute", category: "gui" },
	gui_drag: { riskLevel: "execute", category: "gui" },
	gui_scroll: { riskLevel: "execute", category: "gui" },
	gui_type: { riskLevel: "execute", category: "gui" },
	gui_key: { riskLevel: "execute", category: "gui" },
	gui_wait: { riskLevel: "execute", category: "gui" },
	gui_move: { riskLevel: "execute", category: "gui" },
	browser: { riskLevel: "execute", category: "browser" },
	web_search: { riskLevel: "network", category: "web" },
	web_fetch: { riskLevel: "network", category: "web" },
	process: { riskLevel: "execute", category: "process" },
	apply_patch: { riskLevel: "write", category: "filesystem" },
	image: { riskLevel: "read", category: "filesystem" },
	vision_read: { riskLevel: "read", category: "filesystem" },
	pdf: { riskLevel: "read", category: "filesystem" },
	memory_search: { riskLevel: "read", category: "memory" },
	memory_get: { riskLevel: "read", category: "memory" },
	memory_manage: { riskLevel: "write", category: "memory" },
	exec: { riskLevel: "execute", category: "shell" },
	message_send: { riskLevel: "execute", category: "messaging" },
	schedule: { riskLevel: "execute", category: "schedule" },
	runtime_status: { riskLevel: "read", category: "system" },
	sessions_list: { riskLevel: "read", category: "system" },
	sessions_history: { riskLevel: "read", category: "system" },
	session_status: { riskLevel: "read", category: "system" },
	sessions_send: { riskLevel: "execute", category: "system" },
	agents_list: { riskLevel: "read", category: "system" },
	gateway: { riskLevel: "execute", category: "system" },
	sessions_spawn: { riskLevel: "dangerous", category: "system" },
	subagents: { riskLevel: "dangerous", category: "system" },
};

export interface BuiltinToolRegistryOptions {
	bashSpawnHook?: BashSpawnHook;
}

export class ToolRegistry {
	private tools = new Map<string, ToolEntry>();

	/** Register runtime built-in tools */
	registerBuiltins(cwd?: string, options: BuiltinToolRegistryOptions = {}): void {
		const builtins = cwd
			? createCodingTools(cwd, {
				bash: options.bashSpawnHook
					? {
						spawnHook: options.bashSpawnHook,
					}
					: undefined,
			})
			: codingTools;
		for (const tool of builtins) {
			this.register(tool, BUILTIN_META[tool.name]);
		}
	}

	/** Register a single tool */
	register(
		tool: AgentTool<TSchema>,
		meta?: { riskLevel: ToolRiskLevel; category: ToolCategory },
	): void {
		const fallbackMeta = KNOWN_TOOL_META[tool.name];
		this.tools.set(tool.name, {
			tool,
			riskLevel: meta?.riskLevel ?? fallbackMeta?.riskLevel ?? "execute",
			category: meta?.category ?? fallbackMeta?.category ?? "system",
		});
	}

	/** Unregister a tool by name */
	unregister(name: string): boolean {
		return this.tools.delete(name);
	}

	/** Get all registered tool entries */
	getEntries(): ToolEntry[] {
		return Array.from(this.tools.values());
	}

	/** Get all registered AgentTools */
	getTools(): AgentTool<TSchema>[] {
		return this.getEntries().map((e) => e.tool);
	}

	/** Get tool names */
	getToolNames(): string[] {
		return Array.from(this.tools.keys());
	}

	/** Get tool entry by name */
	get(name: string): ToolEntry | undefined {
		return this.tools.get(name);
	}

	/** Number of registered tools */
	get size(): number {
		return this.tools.size;
	}
}
