import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ComputerUseGuiRuntime } from "@understudy/gui";
import type { ChannelAdapter, UnderstudyConfig } from "@understudy/types";
import { createApplyPatchTool } from "./apply-patch-tool.js";
import { createBrowserTool } from "./browser/browser-tool.js";
import type { BrowserManagerOptions } from "./browser/browser-manager.js";
import { createAgentsListTool } from "./bridge/agents-list-tool.js";
import { createGatewayTool } from "./bridge/gateway-tool.js";
import { createSessionsSpawnTool } from "./bridge/sessions-spawn-tool.js";
import { createSubagentsTool } from "./bridge/subagents-tool.js";
import { createExecTool } from "./exec-tool.js";
import {
	createGuiToolset,
} from "./gui-tools.js";
import { createImageTool } from "./image-tool.js";
import { createMemoryGetTool, createMemoryManageTool, createMemorySearchTool } from "./memory/memory-tool.js";
import type { MemoryProvider } from "./memory/provider.js";
import { createMessageTool } from "./message-tool.js";
import { createPdfTool } from "./pdf-tool.js";
import { createPlatformCapabilitiesTool } from "./platform-capabilities-tool.js";
import {
	type RuntimePlatformCapability,
} from "./platform-capabilities.js";
import { createProcessTool } from "./process-tool.js";
import { createRuntimeStatusTool } from "./runtime-status-tool.js";
import { createScheduleTool } from "./schedule/schedule-tool.js";
import type { ScheduleService } from "./schedule/schedule-service.js";
import {
	createSessionStatusTool,
	createSessionsHistoryTool,
	createSessionsListTool,
	createSessionsSendTool,
} from "./sessions-tool.js";
import { createVisionReadTool } from "./vision-read-tool.js";
import { createWebFetchTool } from "./web-fetch.js";
import { createWebSearchTool } from "./web-search.js";

export interface RuntimeToolsetOptions {
	cwd: string;
	config?: UnderstudyConfig;
	guiRuntime?: ComputerUseGuiRuntime;
	memoryProvider?: MemoryProvider;
	scheduleService?: ScheduleService;
	browserOptions?: BrowserManagerOptions | (() => BrowserManagerOptions);
	getChannel?: (channelId: string) => ChannelAdapter | undefined;
	channel?: string;
	senderId?: string;
	threadId?: string;
	capabilities?: string[];
	platformCapabilities?:
		| RuntimePlatformCapability[]
		| (() => RuntimePlatformCapability[] | undefined);
	gatewayUrl?: string;
	requesterSessionId?: string;
	spawnSubagent?: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
	manageSubagents?: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
	toolFactories?: RuntimeToolFactory[];
	additionalTools?: Array<AgentTool<any>>;
}

export type RuntimeToolFactory = (
	options: RuntimeToolsetOptions,
) => AgentTool<any> | AgentTool<any>[] | null | undefined;

export type RuntimeToolCategory =
	| "web"
	| "workspace"
	| "media"
	| "browser"
	| "gui"
	| "platform"
	| "memory"
	| "messaging"
	| "automation"
	| "system"
	| "sessions"
	| "agents"
	| "gateway"
	| "mcp"
	| "custom";

export type RuntimeToolSurface = "runtime" | "gateway" | "mcp" | "custom";

export interface RuntimeToolCatalogEntry {
	name: string;
	label: string;
	description: string;
	category: RuntimeToolCategory;
	surface: RuntimeToolSurface;
}

export interface RuntimeToolCatalogSummaryEntry<T extends string> {
	id: T;
	count: number;
}

export interface RuntimeToolCatalog {
	tools: RuntimeToolCatalogEntry[];
	summary: {
		total: number;
		byCategory: Array<RuntimeToolCatalogSummaryEntry<RuntimeToolCategory>>;
		bySurface: Array<RuntimeToolCatalogSummaryEntry<RuntimeToolSurface>>;
	};
}

const GATEWAY_TOOL_NAMES = new Set([
	"sessions_list",
	"sessions_history",
	"session_status",
	"sessions_send",
	"agents_list",
	"gateway",
	"sessions_spawn",
	"subagents",
]);

function categorizeRuntimeTool(name: string): RuntimeToolCategory {
	if (name === "web_search" || name === "web_fetch") {
		return "web";
	}
	if (name === "process" || name === "apply_patch") {
		return "workspace";
	}
	if (name === "exec") {
		return "workspace";
	}
	if (name === "runtime_status") {
		return "system";
	}
	if (name === "image" || name === "vision_read" || name === "pdf") {
		return "media";
	}
	if (name === "browser") {
		return "browser";
	}
	if (name === "platform_capabilities" || name.startsWith("platform_")) {
		return "platform";
	}
	if (name.startsWith("gui_")) {
		return "gui";
	}
	if (name.startsWith("memory_")) {
		return "memory";
	}
	if (name === "message_send") {
		return "messaging";
	}
	if (name === "schedule") {
		return "automation";
	}
	if (name === "cron") {
		return "automation";
	}
	if (
		name === "sessions_list" ||
		name === "sessions_history" ||
		name === "session_status" ||
		name === "sessions_send"
	) {
		return "sessions";
	}
	if (name === "agents_list" || name === "sessions_spawn" || name === "subagents") {
		return "agents";
	}
	if (name === "gateway") {
		return "gateway";
	}
	if (name.startsWith("mcp_")) {
		return "mcp";
	}
	return "custom";
}

function resolveRuntimeToolSurface(name: string): RuntimeToolSurface {
	if (name.startsWith("mcp_")) {
		return "mcp";
	}
	if (GATEWAY_TOOL_NAMES.has(name)) {
		return "gateway";
	}
	if (categorizeRuntimeTool(name) === "custom") {
		return "custom";
	}
	return "runtime";
}

function summarizeCatalogEntries<T extends string>(values: Array<T>): Array<RuntimeToolCatalogSummaryEntry<T>> {
	const counts = new Map<T, number>();
	for (const value of values) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return Array.from(counts.entries())
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([id, count]) => ({ id, count }));
}

export function createRuntimeToolset(options: RuntimeToolsetOptions): Array<AgentTool<any>> {
	const tools: Array<AgentTool<any>> = [
		createWebSearchTool(),
		createWebFetchTool(),
		createRuntimeStatusTool({
			cwd: options.cwd,
			config: options.config,
			channel: options.channel,
			capabilities: options.capabilities,
			gatewayUrl: options.gatewayUrl,
		}),
		createProcessTool(),
		createExecTool(),
		createApplyPatchTool({ cwd: options.cwd }),
		createImageTool(),
		createVisionReadTool(),
		createPdfTool(),
		createBrowserTool(options.browserOptions),
	];

	if (options.platformCapabilities !== undefined) {
		tools.push(createPlatformCapabilitiesTool(options.platformCapabilities));
	}

	if (options.guiRuntime) {
		tools.push(...createGuiToolset(options.guiRuntime));
	}

	if (options.memoryProvider) {
		tools.push(
			createMemorySearchTool(options.memoryProvider),
			createMemoryGetTool(options.memoryProvider),
			createMemoryManageTool(options.memoryProvider),
		);
	}

	if (options.getChannel) {
		tools.push(
			createMessageTool({
				getChannel: options.getChannel,
			}),
		);
	}

	const hasLocalSchedulingSurface = Boolean(options.scheduleService);
	if (hasLocalSchedulingSurface) {
		const scheduleTool = createScheduleTool({
			scheduleService: options.scheduleService,
			gateway: options.gatewayUrl ? { gatewayUrl: options.gatewayUrl } : undefined,
			defaultDelivery: options.channel || options.senderId
				? {
					channelId: options.channel,
					senderId: options.senderId,
					sessionId: options.requesterSessionId,
					threadId: options.threadId,
				}
				: (options.requesterSessionId || options.threadId)
					? {
						sessionId: options.requesterSessionId,
						threadId: options.threadId,
					}
					: undefined,
		});
		tools.push(scheduleTool);
	}

	if (options.gatewayUrl) {
		const gatewayScheduleTool = !hasLocalSchedulingSurface
			? createScheduleTool({
				gateway: { gatewayUrl: options.gatewayUrl },
				defaultDelivery: options.channel || options.senderId
					? {
						channelId: options.channel,
						senderId: options.senderId,
						sessionId: options.requesterSessionId,
						threadId: options.threadId,
					}
					: (options.requesterSessionId || options.threadId)
						? {
							sessionId: options.requesterSessionId,
							threadId: options.threadId,
						}
						: undefined,
			})
			: null;
		tools.push(
			createSessionsListTool({ gatewayUrl: options.gatewayUrl }),
			createSessionsHistoryTool({ gatewayUrl: options.gatewayUrl }),
			createSessionStatusTool({ gatewayUrl: options.gatewayUrl }),
			createSessionsSendTool({ gatewayUrl: options.gatewayUrl }),
			createAgentsListTool({ gatewayUrl: options.gatewayUrl }),
			...(!hasLocalSchedulingSurface ? [gatewayScheduleTool!] : []),
			createGatewayTool({ gatewayUrl: options.gatewayUrl }),
			createSessionsSpawnTool({
				gatewayUrl: options.gatewayUrl,
				requesterSessionId: options.requesterSessionId,
				spawnHandler: options.spawnSubagent,
			}),
			createSubagentsTool({
				gatewayUrl: options.gatewayUrl,
				requesterSessionId: options.requesterSessionId,
				subagentsHandler: options.manageSubagents,
			}),
		);
	}

	if (options.additionalTools?.length) {
		tools.push(...options.additionalTools);
	}

	if (options.toolFactories?.length) {
		for (const factory of options.toolFactories) {
			const produced = factory(options);
			if (!produced) {
				continue;
			}
			if (Array.isArray(produced)) {
				tools.push(...produced);
				continue;
			}
			tools.push(produced);
		}
	}

	return tools;
}

export function listRuntimeToolCatalog(options: RuntimeToolsetOptions): RuntimeToolCatalog {
	const tools = createRuntimeToolset(options).map<RuntimeToolCatalogEntry>((tool) => ({
		name: tool.name,
		label: typeof tool.label === "string" && tool.label.length > 0 ? tool.label : tool.name,
		description: typeof tool.description === "string" ? tool.description : "",
		category: categorizeRuntimeTool(tool.name),
		surface: resolveRuntimeToolSurface(tool.name),
	}));

	return {
		tools,
		summary: {
			total: tools.length,
			byCategory: summarizeCatalogEntries(tools.map((tool) => tool.category)),
			bySurface: summarizeCatalogEntries(tools.map((tool) => tool.surface)),
		},
	};
}
