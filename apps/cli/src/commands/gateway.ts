/**
 * Gateway subcommand — starts the HTTP + WebSocket gateway server.
 * This is spawned by the daemon command.
 */

import {
	ConfigManager,
	buildWorkspaceSkillSnapshot,
	createSessionTraceLifecycleHooks,
	createUnderstudySession,
	expandHome,
	inspectProviderAuthStatuses,
	resolveToolExecutionRoute,
	resolveWorkspaceContext,
	resolveUnderstudyHomeDir,
	resolveUnderstudyAgentDir,
	UsageTracker,
	type UnderstudySessionLifecycleHooks,
} from "@understudy/core";
import {
	GatewayServer,
	GatewayLock,
	LifecycleManager,
	ConfigReloader,
	buildGatewayChannelConfigOverride,
	buildInlineImageAttachments,
	mergeUnderstudyConfigOverride,
	buildSessionKey,
	buildWorkspaceScopeDiscriminator,
	createGatewaySessionRuntime,
	extractRenderableAssistantImages,
	GatewayRunRegistry,
	MAX_INLINE_IMAGE_DATA_CHARS,
	normalizeChatResult,
	seedRuntimeMessagesFromHistory,
	type AgentRunSnapshot,
	type SessionEntry,
	type SessionRunTrace,
} from "@understudy/gateway";
import { buildChannelsFromConfig } from "@understudy/channels";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { AgentProfileConfig, Attachment, ChannelAdapter, UnderstudyConfig } from "@understudy/types";
import { loadUnderstudyPlugins } from "@understudy/plugins";
import { createGatewayPluginRuntime } from "./gateway-plugin-runtime.js";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, cp, lstat, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import {
	createBrowserTool,
	ScheduleService,
	createMemoryProvider,
	type MemoryProvider,
} from "@understudy/tools";
import { Type } from "@sinclair/typebox";
import { McpRuntimeManager } from "./mcp-runtime.js";
import { resolveConfiguredBrowserOptions } from "./browser-extension.js";
import {
	ensureUnderstudyChromeExtensionRelayServer,
	type UnderstudyChromeExtensionRelayServer,
} from "../browser/extension-relay.js";
import {
	FileGatewaySessionMetadataStore,
	resolveGatewaySessionStorePath,
} from "./gateway-session-store.js";
import { resolveGatewaySessionRoute } from "./gateway-session-routing.js";
import {
	FileGatewayTranscriptStore,
	resolveGatewayTranscriptStoreDir,
} from "./gateway-transcript-store.js";
import {
	FileGatewayRunTraceStore,
	resolveGatewayRunTraceStoreDir,
} from "./gateway-run-trace-store.js";
import { FileGatewaySessionQueryStore } from "./gateway-session-query-store.js";
import {
	DEFAULT_AGENT_ID,
	DEFAULT_MAIN_SESSION_KEY,
	AGENT_BOOTSTRAP_FILE_NAMES,
	AGENT_MEMORY_FILE_NAME,
	ensureAgentWorkspaceFiles,
	isValidAgentWorkspaceFileName,
	isWorkspaceOnboardingCompleted,
	normalizeAgentId,
	parseAgentEntries,
	resolveAgentSessionScope,
	resolveAgentWorkspaceFile,
	resolveDefaultAgentWorkspace,
	sanitizeAgentEntry,
	sanitizeAgentIdentity,
	statAgentWorkspaceFile,
} from "./gateway-agent-workspace.js";
import {
	asBoolean,
	asNumber,
	asRecord,
	asString,
	collectSecretAssignments,
	dayStampFor,
	isPlainObject,
	normalizeBrowserRoute,
	normalizeMcpResultContent,
	normalizeMcpToolName,
	resolveMemoryDbPath,
	resolveSkillInstallSource,
} from "./gateway-support.js";
import {
	EXEC_APPROVAL_REQUEST_TIMEOUT_DEFAULT_MS,
	EXEC_APPROVAL_WAIT_TIMEOUT_DEFAULT_MS,
	matchesExecApprovalPattern,
	normalizeExecApprovalsFile,
	readExecApprovalsSnapshot,
	redactExecApprovalsFile,
	saveExecApprovalsFile,
	summarizeApprovalCommand,
	type ExecApprovalsAgent,
	type ExecApprovalsFile,
} from "./gateway-exec-approvals.js";
import {
	filterExecApprovalItemsForContext,
	formatExecApprovalDecisionResult,
	formatExecApprovalList,
	formatExecApprovalPrompt,
	parseExecApprovalChatCommand,
	resolveExecApprovalChatTarget,
	type ExecApprovalChatItem,
} from "./gateway-exec-approval-chat.js";
import { extractLatestAssistantUsage } from "./gateway-usage.js";
import { collectGatewayRuntimeReadiness } from "./gateway-runtime-readiness.js";
import { BUILTIN_MODELS, mergeKnownModels } from "./model-support.js";
import {
	createConfiguredRuntimeToolset,
	listConfiguredRuntimeToolCatalog,
	resolveConfiguredPlatformCapabilities,
} from "./runtime-tooling.js";
interface GatewayOptions {
	port?: string;
	webPort?: string;
	host?: string;
	config?: string;
}

function resolveGatewayBrowserSurfaceUrls(params: {
	host: string;
	port: number;
	authMode: string;
	authToken?: string;
}): { dashboardUrl: string; webchatUrl: string } {
	const base = `http://${params.host}:${params.port}`;
	if (params.authMode === "token" && params.authToken) {
		const token = encodeURIComponent(params.authToken);
		return {
			dashboardUrl: `${base}/ui?token=${token}`,
			webchatUrl: `${base}/webchat?token=${token}`,
		};
	}
	return {
		dashboardUrl: `${base}/ui`,
		webchatUrl: `${base}/webchat`,
	};
}

export { resolveMemoryDbPath, buildChannelsFromConfig };

export function resolveGatewayWorkspaceDir(currentConfig: UnderstudyConfig): string {
	const configuredWorkspace = asString(currentConfig.agent?.cwd)?.trim();
	if (configuredWorkspace) {
		return expandHome(configuredWorkspace);
	}

	const mainEntry = parseAgentEntries(currentConfig).find(
		(entry) => normalizeAgentId(entry.id) === DEFAULT_AGENT_ID,
	);
	return expandHome(
		asString(mainEntry?.workspace) ?? resolveDefaultAgentWorkspace(DEFAULT_AGENT_ID),
	);
}

export async function ensureGatewayWorkspaceReady(workspaceDir: string): Promise<string> {
	const resolvedWorkspaceDir = expandHome(workspaceDir);
	await mkdir(resolvedWorkspaceDir, { recursive: true });
	return resolvedWorkspaceDir;
}

export async function deliverScheduledJobResult(params: {
	channel?: ChannelAdapter;
	channelId: string;
	recipientId: string;
	threadId?: string;
	result: unknown;
}): Promise<string | undefined> {
	if (!params.channel) {
		return undefined;
	}
	const normalized = normalizeChatResult(params.result);
	const attachments =
		Array.isArray(normalized.attachments) && normalized.attachments.length > 0
			? normalized.attachments
			: buildInlineImageAttachments(normalized.images);
	if (normalized.response.trim().length === 0 && !(attachments?.length)) {
		return undefined;
	}
	try {
		return await params.channel.messaging.sendMessage({
			channelId: params.channelId,
			recipientId: params.recipientId,
			text: normalized.response,
			threadId: params.threadId,
			...(attachments?.length ? { attachments } : {}),
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (params.channelId === "web" && /offline/i.test(message)) {
			return undefined;
		}
		throw error;
	}
}

function resolveSessionWorkspaceContext(
	currentConfig: UnderstudyConfig,
	requestedWorkspaceDir?: string,
): ReturnType<typeof resolveWorkspaceContext> {
	const configuredWorkspaceDir = resolveGatewayWorkspaceDir(currentConfig);
	return resolveWorkspaceContext({
		requestedWorkspaceDir,
		configuredWorkspaceDir,
		fallbackWorkspaceDir: configuredWorkspaceDir,
		configuredRepoRoot: currentConfig.agent.repoRoot,
	});
}

function mergeSessionConfig(
	base: UnderstudyConfig,
	override?: Partial<UnderstudyConfig>,
): UnderstudyConfig {
	if (!override) {
		return base;
	}
	return {
		...base,
		...override,
		agent: {
			...base.agent,
			...override.agent,
			sandbox: {
				...base.agent.sandbox,
				...override.agent?.sandbox,
			},
		},
		channels: {
			...base.channels,
			...override.channels,
		},
		tools: {
			...base.tools,
			...override.tools,
		},
		memory: {
			...base.memory,
			...override.memory,
		},
		...(base.skills || override.skills
			? {
				skills: {
					...base.skills,
					...override.skills,
					entries: {
						...base.skills?.entries,
						...override.skills?.entries,
					},
					limits: {
						...base.skills?.limits,
						...override.skills?.limits,
					},
				},
			}
			: {}),
		...(base.agents || override.agents
			? {
				agents: {
					...base.agents,
					...override.agents,
					list: override.agents?.list ?? base.agents?.list,
					defaults: {
						...base.agents?.defaults,
						...override.agents?.defaults,
					},
				},
			}
			: {}),
		...(base.session || override.session
			? {
				session: {
					...base.session,
					...override.session,
				},
			}
			: {}),
		gateway: {
			...base.gateway,
			...override.gateway,
		},
	} as UnderstudyConfig;
}

function mergeLifecycleHooks(
	...hooks: Array<UnderstudySessionLifecycleHooks | undefined>
): UnderstudySessionLifecycleHooks {
	return {
		onPromptBuilt: async (event) => {
			for (const hook of hooks) {
				await hook?.onPromptBuilt?.(event);
			}
		},
		onSessionCreated: async (event) => {
			for (const hook of hooks) {
				await hook?.onSessionCreated?.(event);
			}
		},
		onAssistantReply: async (event) => {
			for (const hook of hooks) {
				await hook?.onAssistantReply?.(event);
			}
		},
		onToolEvent: async (event) => {
			for (const hook of hooks) {
				await hook?.onToolEvent?.(event);
			}
		},
		onSessionClosed: async (event) => {
			for (const hook of hooks) {
				await hook?.onSessionClosed?.(event);
			}
		},
	};
}

export async function runGatewayCommand(opts: GatewayOptions = {}): Promise<void> {
	const port = parseInt(opts.port ?? "23333", 10);
	const requestedWebPort = parseInt(opts.webPort ?? `${port + 1}`, 10);
	const host = opts.host ?? "127.0.0.1";
	const webPort = requestedWebPort === port ? port + 1 : requestedWebPort;
	const gatewayUrl = `http://${host}:${port}`;
	const configManager = await ConfigManager.load(opts.config);
	const config = configManager.get();
	await ensureGatewayWorkspaceReady(resolveGatewayWorkspaceDir(config));
	const startupBrowserToken =
		process.env.UNDERSTUDY_GATEWAY_TOKEN?.trim() ||
		config.gateway?.auth?.token?.trim() ||
		undefined;
	const pluginRegistry = await loadUnderstudyPlugins({
		config,
		configPath: configManager.getPath(),
		cwd: process.cwd(),
	});
	const pluginRuntime = createGatewayPluginRuntime({
		configManager,
		pluginRegistry,
		gatewayUrl,
		stateRoot: join(resolveUnderstudyHomeDir(), "plugins"),
		cwd: process.cwd(),
	});
	pluginRuntime.logDiagnostics();
	const { channels, warnings } = buildChannelsFromConfig({
		channels: config.channels ?? {},
		host,
		webPort,
	});
	const agentConfig = asRecord(config.agent);
	const explicitMcpConfigPath = asString(agentConfig.mcpConfigPath) ?? process.env.UNDERSTUDY_MCP_CONFIG;
	const { manager: mcpRuntime, warnings: mcpWarnings } = await McpRuntimeManager.load(
		resolveUnderstudyHomeDir(),
		explicitMcpConfigPath,
	);

	// Acquire lock to prevent multiple instances
	const lockPath = join(resolveUnderstudyHomeDir(), "gateway.lock");
	const lock = new GatewayLock(lockPath);
	if (!lock.acquire(port)) {
		console.error("Another gateway instance is already running. Use 'understudy status' to check.");
		process.exit(1);
	}

	const usageTracker = new UsageTracker(20_000);
	const browserGatewayTool = createBrowserTool(() => resolveConfiguredBrowserOptions(configManager.get()));
	const browserExtensionRelayUrl = process.env.UNDERSTUDY_BROWSER_EXTENSION_RELAY_URL?.trim() || "http://127.0.0.1:23336";
	let browserExtensionRelay: UnderstudyChromeExtensionRelayServer | null = null;
	let readinessSnapshot:
		| { expiresAt: number; value: Awaited<ReturnType<typeof collectGatewayRuntimeReadiness>> }
		| undefined;
	let readinessInFlight: Promise<Awaited<ReturnType<typeof collectGatewayRuntimeReadiness>>> | null = null;
	const agentRuns = new Map<string, AgentRunSnapshot>();
	const latestRunBySessionId = new Map<string, string>();
	const maxAgentRuns = 1000;
	const activeSessionBindings = new Map<string, string>();
	const metadataStore = new FileGatewaySessionMetadataStore(resolveGatewaySessionStorePath());
	const transcriptStore = new FileGatewayTranscriptStore(resolveGatewayTranscriptStoreDir());
	const runTraceStore = new FileGatewayRunTraceStore(resolveGatewayRunTraceStoreDir());
	const sessionQueryStore = new FileGatewaySessionQueryStore(
		metadataStore,
		transcriptStore,
		runTraceStore,
	);
	let sessionEntriesRef: Map<string, SessionEntry> | null = null;
		let gateway: GatewayServer;
		let memoryProvider: MemoryProvider | null = null;
		let memoryProviderDbPath: string | null = null;
		const pendingExecApprovals = new Map<
		string,
		{
			id: string;
			request: Record<string, unknown>;
			createdAtMs: number;
			expiresAtMs: number;
			decision: string | null;
			decisionPromise: Promise<string | null>;
			resolveDecision: (decision: string | null) => void;
			timeout: ReturnType<typeof setTimeout>;
			sessionId?: string;
			runId?: string;
			turnSourceChannel?: string | null;
			turnSourceTo?: string | null;
			turnSourceThreadId?: string | null;
		}
	>();
	const resolvedExecApprovals = new Map<
		string,
		{
			decision: string | null;
			createdAtMs: number;
			expiresAtMs: number;
			resolvedAtMs: number;
		}
	>();
	const maxResolvedExecApprovals = 2000;
	const resolvedExecApprovalTtlMs = 10 * 60_000;
	const scheduleStorePath = join(resolveUnderstudyHomeDir(), "schedule", "jobs.json");
	let scheduleService: ScheduleService | null = null;
	let stateSaveTimer: ReturnType<typeof setTimeout> | null = null;
	let stateSaveInFlight: Promise<void> | null = null;

	const flushGatewayState = async (): Promise<void> => {
		if (!sessionEntriesRef) {
			return;
		}
		const nextSave = metadataStore.save({
			sessionEntries: sessionEntriesRef,
			agentRuns,
			activeSessionBindings,
		}).catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			console.warn(`[gateway] failed to persist session state: ${message}`);
		});
		stateSaveInFlight = nextSave.finally(() => {
			if (stateSaveInFlight === nextSave) {
				stateSaveInFlight = null;
			}
		});
		await stateSaveInFlight;
	};

	const scheduleGatewayStateSave = (): void => {
		if (!sessionEntriesRef) {
			return;
		}
		if (stateSaveTimer) {
			return;
		}
		stateSaveTimer = setTimeout(() => {
			stateSaveTimer = null;
			void flushGatewayState();
		}, 50);
	};

	const runRegistry = new GatewayRunRegistry({
		runs: agentRuns,
		latestRunBySessionId,
		maxRuns: maxAgentRuns,
		onRunChanged: scheduleGatewayStateSave,
		onEvent: (event) => {
			if (gateway) {
				gateway.broadcastEvent(event);
			}
		},
	});

	const syncMemoryProviderForConfig = async (nextConfig: UnderstudyConfig): Promise<void> => {
		const nextEnabled = nextConfig.memory.enabled === true;
		const nextDbPath = nextEnabled ? resolveMemoryDbPath(nextConfig) : null;
		const shouldResetExisting = Boolean(
			memoryProvider &&
			(!nextEnabled || memoryProviderDbPath !== nextDbPath),
		);
		if (shouldResetExisting && memoryProvider) {
			await memoryProvider.close().catch(() => {});
			memoryProvider = null;
			memoryProviderDbPath = null;
		}
		if (nextEnabled && !memoryProvider && nextDbPath) {
			memoryProvider = await createMemoryProvider({
				dbPath: nextDbPath,
			});
			memoryProviderDbPath = nextDbPath;
		}
	};

	const pruneResolvedExecApprovals = (): void => {
		const now = Date.now();
		for (const [id, record] of resolvedExecApprovals) {
			if (now - record.resolvedAtMs > resolvedExecApprovalTtlMs) {
				resolvedExecApprovals.delete(id);
			}
		}
		while (resolvedExecApprovals.size > maxResolvedExecApprovals) {
			const oldest = resolvedExecApprovals.keys().next().value;
			if (!oldest) break;
			resolvedExecApprovals.delete(oldest);
		}
	};

	const resolvePendingExecApproval = (id: string, decision: string | null): boolean => {
		const record = pendingExecApprovals.get(id);
		if (!record) {
			return false;
		}
		clearTimeout(record.timeout);
		record.decision = decision;
			record.resolveDecision(decision);
			pendingExecApprovals.delete(id);
			resolvedExecApprovals.set(id, {
				decision,
				createdAtMs: record.createdAtMs,
				expiresAtMs: record.expiresAtMs,
				resolvedAtMs: Date.now(),
			});
		pruneResolvedExecApprovals();
		return true;
	};

	const listPendingExecApprovalItems = (
		context?: {
			channelId?: string;
			senderId?: string;
			threadId?: string;
		},
	): ExecApprovalChatItem[] => {
		const items = Array.from(pendingExecApprovals.values()).map((record) => ({
			id: record.id,
			command: asString(record.request.command) ?? record.id,
			createdAtMs: record.createdAtMs,
			expiresAtMs: record.expiresAtMs,
			channelId: record.turnSourceChannel,
			senderId: record.turnSourceTo,
			threadId: record.turnSourceThreadId,
			sessionId: record.sessionId ?? null,
		}));
		if (!context) {
			return items;
		}
		return filterExecApprovalItemsForContext(items, context);
	};

	const emitExecApprovalRuntimeStatus = (record: {
		runId?: string;
		sessionId?: string;
	}, text: string): void => {
		if (!record.runId || !record.sessionId) {
			return;
		}
		runRegistry.emitRuntimeEvent(record.runId, record.sessionId, {
			type: "status",
			text,
		});
	};

	const broadcastExecApprovalEvent = (params: {
		type: "exec.approval.requested" | "exec.approval.resolved";
		record: {
			id: string;
			runId?: string;
			sessionId?: string;
			turnSourceChannel?: string | null;
			turnSourceTo?: string | null;
			turnSourceThreadId?: string | null;
		};
		text: string;
		decision?: string | null;
	}): void => {
		gateway.broadcastEvent({
			type: params.type,
			data: {
				runId: params.record.runId,
				sessionId: params.record.sessionId,
				approvalId: params.record.id,
				channelId: params.record.turnSourceChannel,
				senderId: params.record.turnSourceTo,
				threadId: params.record.turnSourceThreadId,
				text: params.text,
				...(params.decision ? { decision: params.decision } : {}),
			},
			timestamp: Date.now(),
		});
	};

	const resolveExecApprovalFromChat = async (params: {
		text: string;
		context?: {
			channelId?: string;
			senderId?: string;
			threadId?: string;
		};
	}): Promise<string | null> => {
		const command = parseExecApprovalChatCommand(params.text);
		if (!command) {
			return null;
		}
		const scopedItems = listPendingExecApprovalItems(params.context);
		if (command.kind === "list") {
			return formatExecApprovalList(scopedItems);
		}
		const target = resolveExecApprovalChatTarget({
			items: scopedItems,
			approvalId: command.approvalId,
		});
		if (!target.item) {
			return target.errorText ?? "No pending approvals for this conversation.";
		}
		const record = pendingExecApprovals.get(target.item.id);
		if (!record) {
			return `Approval "${target.item.id}" is no longer pending.`;
		}
		const resolved = resolvePendingExecApproval(target.item.id, command.decision);
		if (!resolved) {
			return `Approval "${target.item.id}" is no longer pending.`;
		}
		const resultText = formatExecApprovalDecisionResult(target.item, command.decision);
		emitExecApprovalRuntimeStatus(record, resultText);
		broadcastExecApprovalEvent({
			type: "exec.approval.resolved",
			record,
			text: resultText,
			decision: command.decision,
		});
		return resultText;
	};
	const mcpTools: Array<AgentTool<any>> = [];
	const mcpStatuses = mcpRuntime.getStatus();
	const mcpToolBindings = mcpRuntime.getTools();
	const DynamicMcpSchema = Type.Object({}, { additionalProperties: true });
	for (const binding of mcpToolBindings) {
		const registeredName = normalizeMcpToolName(binding.server, binding.name);
		mcpTools.push({
			name: registeredName,
			label: `MCP ${binding.server}.${binding.name}`,
			description: binding.description ?? `MCP tool ${binding.server}.${binding.name}`,
			parameters: DynamicMcpSchema,
			execute: async (_toolCallId: string, params: unknown) => {
				const args = isPlainObject(params) ? params : {};
				const raw = await mcpRuntime.call(binding.server, binding.name, args);
				return {
					content: normalizeMcpResultContent(raw),
					details: {
						source: "mcp",
						server: binding.server,
						tool: binding.name,
					},
				};
			},
		});
	}
	mcpTools.push({
		name: "mcp_server_status",
		label: "MCP Server Status",
		description: "Show MCP server connection status and loaded tool counts.",
		parameters: Type.Object({
			server: Type.Optional(Type.String()),
		}),
		execute: async (_toolCallId: string, params: unknown) => {
			const filter = asString(isPlainObject(params) ? params.server : undefined);
			const statuses = mcpRuntime
				.getStatus()
				.filter((status) => (filter ? status.server === filter : true));
			return {
				content: [{
					type: "text",
					text: JSON.stringify({ servers: statuses }, null, 2),
				}],
				details: {
					source: "mcp",
					servers: statuses.length,
				},
			};
		},
	});
	const readGatewayLogs = async (params: Record<string, unknown>): Promise<unknown> => {
		const limit = Math.max(1, asNumber(params.limit) ?? asNumber(params.tail) ?? 50);
		const homeDir = resolveUnderstudyHomeDir();
		const logPath = join(homeDir, "daemon.log");
		if (!existsSync(logPath)) {
			return { path: logPath, lines: [] };
		}
		const content = await readFile(logPath, "utf-8");
		const lines = content
			.split("\n")
			.filter(Boolean)
			.slice(-limit);
		return { path: logPath, lines };
	};

	const applyConfigPartial = (partial: Record<string, unknown>): void => {
		configManager.update(partial as Partial<UnderstudyConfig>);
		configManager.save();
	};

	const listToolCatalog = async (): Promise<unknown> => {
		const currentConfig = configManager.get();
		const platformCapabilities = await resolveConfiguredPlatformCapabilities({
			cwd: resolveGatewayWorkspaceDir(currentConfig),
			config: currentConfig,
			browserOptions: () => resolveConfiguredBrowserOptions(configManager.get()),
			memoryProvider: memoryProvider ?? undefined,
			scheduleService: scheduleService ?? undefined,
			getChannel: () => undefined,
			gatewayUrl,
			platformCapabilities: pluginRegistry.getPlatformCapabilities(),
		});
		return {
			...await listConfiguredRuntimeToolCatalog({
				cwd: resolveGatewayWorkspaceDir(currentConfig),
				config: currentConfig,
				browserOptions: () => resolveConfiguredBrowserOptions(configManager.get()),
				memoryProvider: memoryProvider ?? undefined,
				scheduleService: scheduleService ?? undefined,
				getChannel: () => undefined,
				gatewayUrl,
				toolFactories: pluginRegistry.getToolFactories(),
				platformCapabilities: pluginRegistry.getPlatformCapabilities(),
				additionalTools: mcpTools,
			}),
			platformCapabilities,
			mcpServers: mcpStatuses.map((status) => ({
				server: status.server,
				connected: status.connected,
				toolCount: status.toolCount,
			})),
		};
	};

	const listAgents = (): AgentProfileConfig[] => parseAgentEntries(configManager.get());

	const persistAgents = (entries: AgentProfileConfig[]): void => {
		const currentAgents = asRecord(configManager.get().agents);
		const nextList = entries
			.map((entry) => sanitizeAgentEntry(entry))
			.filter((entry) => entry.id.length > 0);
		configManager.update({
			agents: {
				...currentAgents,
				list: nextList,
			},
		} as unknown as Partial<UnderstudyConfig>);
		configManager.save();
	};

	const buildMainAgent = (): AgentProfileConfig => {
		const cfg = configManager.get();
		const configuredMain = listAgents().find((entry) => entry.id === DEFAULT_AGENT_ID);
		const explicitIdentity = sanitizeAgentIdentity(configuredMain?.identity);
		const fallbackIdentity = {
			name: "Understudy",
		};
		return sanitizeAgentEntry({
			id: DEFAULT_AGENT_ID,
			name: configuredMain?.name ?? "Understudy",
			workspace:
				configuredMain?.workspace ??
				resolveDefaultAgentWorkspace(DEFAULT_AGENT_ID),
			model: configuredMain?.model ?? cfg.defaultModel,
			identity: explicitIdentity ?? fallbackIdentity,
		});
	};

	const resolveKnownAgent = (agentIdRaw: string): AgentProfileConfig | null => {
		const agentId = normalizeAgentId(agentIdRaw);
		if (!agentId) {
			return null;
		}
		if (agentId === DEFAULT_AGENT_ID) {
			return buildMainAgent();
		}
		const configured = listAgents().find((entry) => entry.id === agentId);
		if (!configured) {
			return null;
		}
		const normalized = sanitizeAgentEntry(configured);
		return {
			...normalized,
			workspace:
				normalized.workspace ??
				resolveDefaultAgentWorkspace(normalized.id),
		};
	};

	const resolveAgentWorkspaceDir = (entry: AgentProfileConfig): string =>
		expandHome(entry.workspace ?? resolveDefaultAgentWorkspace(entry.id));

	const resolveSkipBootstrap = (): boolean => {
		const defaults = asRecord(asRecord(configManager.get().agents).defaults);
		return asBoolean(defaults.skipBootstrap) ?? false;
	};

	const agentsList = async (): Promise<unknown> => {
		const cfg = configManager.get();
		const configured = listAgents()
			.filter((entry) => entry.id !== DEFAULT_AGENT_ID)
			.map((entry) => sanitizeAgentEntry(entry))
			.sort((a, b) => a.id.localeCompare(b.id));
		const mainEntry = buildMainAgent();
		const agents = [mainEntry, ...configured].map((entry) => ({
			id: entry.id,
			name: entry.name,
			identity: sanitizeAgentIdentity(entry.identity),
		}));
		return {
			defaultId: DEFAULT_AGENT_ID,
			mainKey: asString(cfg.session?.mainKey) ?? DEFAULT_MAIN_SESSION_KEY,
			scope: resolveAgentSessionScope(cfg),
			agents,
		};
	};

	const agentsCreate = async (params: Record<string, unknown>): Promise<unknown> => {
		const rawName = asString(params.name);
		const rawWorkspace = asString(params.workspace);
		if (!rawName || !rawWorkspace) {
			throw new Error("agents.create requires name and workspace");
		}
		const agentId = normalizeAgentId(rawName);
		if (!agentId) {
			throw new Error("agents.create name is invalid");
		}
		if (agentId === DEFAULT_AGENT_ID) {
			throw new Error(`"${DEFAULT_AGENT_ID}" is reserved`);
		}
		const existing = listAgents();
		if (existing.some((entry) => entry.id === agentId)) {
			throw new Error(`agent "${agentId}" already exists`);
		}
		const workspaceDir = expandHome(rawWorkspace);
		const emoji = asString(params.emoji);
		const avatar = asString(params.avatar);
		await ensureAgentWorkspaceFiles({
			workspaceDir,
			agentName: rawName,
			emoji,
			avatar,
			skipBootstrap: resolveSkipBootstrap(),
		});
		existing.push(
			sanitizeAgentEntry({
				id: agentId,
				name: rawName,
				workspace: workspaceDir,
				identity: {
					name: rawName,
					emoji,
					avatar,
				},
			}),
		);
		persistAgents(existing);
		return {
			ok: true,
			agentId,
			name: rawName,
			workspace: workspaceDir,
		};
	};

	const agentsUpdate = async (params: Record<string, unknown>): Promise<unknown> => {
		const agentId = normalizeAgentId(asString(params.agentId) ?? "");
		if (!agentId) {
			throw new Error("agents.update requires agentId");
		}
		const entries = listAgents();
		const index = entries.findIndex((entry) => entry.id === agentId);
		if (index < 0) {
			throw new Error(`agent "${agentId}" not found`);
		}
		const current = entries[index]!;
		const nextName = asString(params.name) ?? current.name ?? agentId;
		const nextWorkspace = asString(params.workspace)
			? expandHome(asString(params.workspace)!)
			: (current.workspace ?? resolveDefaultAgentWorkspace(agentId));
		const nextModel = asString(params.model) ?? current.model;
		const nextAvatar = asString(params.avatar);

		await ensureAgentWorkspaceFiles({
			workspaceDir: nextWorkspace,
			agentName: nextName,
			avatar: nextAvatar,
			skipBootstrap: resolveSkipBootstrap(),
		});

		if (nextAvatar) {
			await appendFile(join(nextWorkspace, "IDENTITY.md"), `\n- Avatar: ${nextAvatar}\n`, "utf-8");
		}

		entries[index] = sanitizeAgentEntry({
			...current,
			id: agentId,
			name: nextName,
			workspace: nextWorkspace,
			model: nextModel,
			identity: {
				...current.identity,
				name: nextName,
				avatar: nextAvatar ?? current.identity?.avatar,
			},
		});
		persistAgents(entries);
		return {
			ok: true,
			agentId,
		};
	};

	const agentsDelete = async (params: Record<string, unknown>): Promise<unknown> => {
		const agentId = normalizeAgentId(asString(params.agentId) ?? "");
		if (!agentId) {
			throw new Error("agents.delete requires agentId");
		}
		if (agentId === DEFAULT_AGENT_ID) {
			throw new Error(`"${DEFAULT_AGENT_ID}" cannot be deleted`);
		}
		const entries = listAgents();
		const index = entries.findIndex((entry) => entry.id === agentId);
		if (index < 0) {
			throw new Error(`agent "${agentId}" not found`);
		}
		const [removed] = entries.splice(index, 1);
		persistAgents(entries);

		const deleteFiles = asBoolean(params.deleteFiles) ?? true;
		if (deleteFiles) {
			const workspaceDir = resolveAgentWorkspaceDir(removed!);
			const agentDir = join(resolveUnderstudyHomeDir(), "agents", agentId);
			await Promise.all([
				rm(workspaceDir, { recursive: true, force: true }).catch(() => {}),
				rm(agentDir, { recursive: true, force: true }).catch(() => {}),
			]);
		}

		return {
			ok: true,
			agentId,
			removedBindings: 1,
		};
	};

	const agentsFilesList = async (params: Record<string, unknown>): Promise<unknown> => {
		const agentId = normalizeAgentId(asString(params.agentId) ?? "");
		if (!agentId) {
			throw new Error("agents.files.list requires agentId");
		}
		const resolved = resolveKnownAgent(agentId);
		if (!resolved) {
			throw new Error("unknown agent id");
		}
		const workspaceDir = resolveAgentWorkspaceDir(resolved);
		await mkdir(workspaceDir, { recursive: true });
		const hideBootstrap = await isWorkspaceOnboardingCompleted(workspaceDir);
		const fileNames = [
			...(hideBootstrap
				? AGENT_BOOTSTRAP_FILE_NAMES.filter((name) => name !== "BOOTSTRAP.md")
				: AGENT_BOOTSTRAP_FILE_NAMES),
			AGENT_MEMORY_FILE_NAME,
		];
		const files: Array<{
			name: string;
			path: string;
			missing: boolean;
			size?: number;
			updatedAtMs?: number;
		}> = [];
		for (const name of fileNames) {
			const { filePath } = await resolveAgentWorkspaceFile({ workspaceDir, name });
			const meta = await statAgentWorkspaceFile(filePath);
			if (meta) {
				files.push({
					name,
					path: filePath,
					missing: false,
					size: meta.size,
					updatedAtMs: meta.updatedAtMs,
				});
			} else {
				files.push({
					name,
					path: filePath,
					missing: true,
				});
			}
		}
		return {
			agentId: resolved.id,
			workspace: workspaceDir,
			files,
		};
	};

	const agentsFilesGet = async (params: Record<string, unknown>): Promise<unknown> => {
		const agentId = normalizeAgentId(asString(params.agentId) ?? "");
		if (!agentId) {
			throw new Error("agents.files.get requires agentId");
		}
		const fileName = asString(params.name) ?? "";
		if (!isValidAgentWorkspaceFileName(fileName)) {
			throw new Error(`unsupported file "${fileName}"`);
		}
		const resolved = resolveKnownAgent(agentId);
		if (!resolved) {
			throw new Error("unknown agent id");
		}
		const workspaceDir = resolveAgentWorkspaceDir(resolved);
		await mkdir(workspaceDir, { recursive: true });
		const { filePath } = await resolveAgentWorkspaceFile({
			workspaceDir,
			name: fileName,
		});
		let fileLstat;
		try {
			fileLstat = await lstat(filePath);
		} catch (error: any) {
			if (error?.code === "ENOENT") {
				return {
					agentId: resolved.id,
					workspace: workspaceDir,
					file: {
						name: fileName,
						path: filePath,
						missing: true,
					},
				};
			}
			throw error;
		}
		if (fileLstat.isSymbolicLink() || !fileLstat.isFile() || fileLstat.nlink > 1) {
			throw new Error(`unsafe workspace file "${fileName}"`);
		}
		const fileStat = await stat(filePath);
		if (!fileStat.isFile() || fileStat.nlink > 1) {
			throw new Error(`unsafe workspace file "${fileName}"`);
		}
		const content = await readFile(filePath, "utf-8");
		return {
			agentId: resolved.id,
			workspace: workspaceDir,
			file: {
				name: fileName,
				path: filePath,
				missing: false,
				size: fileStat.size,
				updatedAtMs: Math.floor(fileStat.mtimeMs),
				content,
			},
		};
	};

	const agentsFilesSet = async (params: Record<string, unknown>): Promise<unknown> => {
		const agentId = normalizeAgentId(asString(params.agentId) ?? "");
		if (!agentId) {
			throw new Error("agents.files.set requires agentId");
		}
		const fileName = asString(params.name) ?? "";
		if (!isValidAgentWorkspaceFileName(fileName)) {
			throw new Error(`unsupported file "${fileName}"`);
		}
		const resolved = resolveKnownAgent(agentId);
		if (!resolved) {
			throw new Error("unknown agent id");
		}
		const workspaceDir = resolveAgentWorkspaceDir(resolved);
		await mkdir(workspaceDir, { recursive: true });
		const { filePath } = await resolveAgentWorkspaceFile({
			workspaceDir,
			name: fileName,
		});
		try {
			const existing = await lstat(filePath);
			if (existing.isSymbolicLink() || !existing.isFile() || existing.nlink > 1) {
				throw new Error(`unsafe workspace file "${fileName}"`);
			}
		} catch (error: any) {
			if (error?.code !== "ENOENT") {
				throw error;
			}
		}

		const content = typeof params.content === "string" ? params.content : "";
		await writeFile(filePath, content, "utf-8");
		const meta = await statAgentWorkspaceFile(filePath);
		return {
			ok: true,
			agentId: resolved.id,
			workspace: workspaceDir,
			file: {
				name: fileName,
				path: filePath,
				missing: false,
				size: meta?.size,
				updatedAtMs: meta?.updatedAtMs,
				content,
			},
		};
	};

	const resolveWebLoginChannel = (): ChannelAdapter | undefined => {
		return gateway.router.getChannel("whatsapp") ?? gateway.router.getChannel("web");
	};

	const isChannelRunning = (channel: ChannelAdapter | undefined): boolean => {
		if (!channel) return false;
		return (channel as unknown as { running?: boolean }).running === true;
	};

	const startChannelWithTimeout = async (channel: ChannelAdapter, timeoutMs: number): Promise<void> => {
		if (timeoutMs <= 0) {
			await channel.start();
			return;
		}
		await Promise.race([
			channel.start(),
			new Promise<never>((_, reject) => {
				setTimeout(() => reject(new Error(`web login timed out after ${timeoutMs}ms`)), timeoutMs);
			}),
		]);
	};

	const webLoginStart = async (params: Record<string, unknown>): Promise<unknown> => {
		const channel = resolveWebLoginChannel();
		if (!channel) {
			throw new Error("web login provider is not available");
		}
		const force = asBoolean(params.force) ?? false;
		const timeoutMs = Math.max(0, asNumber(params.timeoutMs) ?? 30_000);
		if (force && isChannelRunning(channel)) {
			await channel.stop().catch(() => {});
		}
		if (isChannelRunning(channel) && !force) {
			return {
				message: `${channel.id} is already connected`,
				connected: true,
			};
		}
		await startChannelWithTimeout(channel, timeoutMs);
		return {
			message:
				channel.id === "whatsapp"
					? "Login started. If pairing is required, scan the QR shown in gateway logs."
					: `Login started for ${channel.id}.`,
			connected: isChannelRunning(channel),
			qrDataUrl: null,
		};
	};

	const webLoginWait = async (params: Record<string, unknown>): Promise<unknown> => {
		const channel = resolveWebLoginChannel();
		if (!channel) {
			throw new Error("web login provider is not available");
		}
		const timeoutMs = Math.max(0, asNumber(params.timeoutMs) ?? 120_000);
		if (!isChannelRunning(channel)) {
			await startChannelWithTimeout(channel, timeoutMs);
		}
		return {
			message: `${channel.id} connection ${isChannelRunning(channel) ? "ready" : "pending"}`,
			connected: isChannelRunning(channel),
		};
	};

	const execApprovalsGet = async (): Promise<unknown> => {
		const snapshot = await readExecApprovalsSnapshot();
		return {
			path: snapshot.path,
			exists: snapshot.exists,
			hash: snapshot.hash,
			file: redactExecApprovalsFile(snapshot.file),
		};
	};

	const execApprovalsSet = async (params: Record<string, unknown>): Promise<unknown> => {
		const snapshot = await readExecApprovalsSnapshot();
		const baseHash = asString(params.baseHash);
		if (snapshot.exists) {
			if (!baseHash) {
				throw new Error("exec approvals base hash required; re-run exec.approvals.get and retry");
			}
			if (baseHash !== snapshot.hash) {
				throw new Error("exec approvals changed since last load; re-run exec.approvals.get and retry");
			}
		}
		if (!isPlainObject(params.file)) {
			throw new Error("exec approvals file is required");
		}
		const normalized = normalizeExecApprovalsFile(params.file, snapshot.file);
		await saveExecApprovalsFile(snapshot.path, normalized);
		const next = await readExecApprovalsSnapshot();
		return {
			path: next.path,
			exists: next.exists,
			hash: next.hash,
			file: redactExecApprovalsFile(next.file),
		};
	};

	const execApprovalRequest = async (params: Record<string, unknown>): Promise<unknown> => {
		const command = asString(params.command);
		if (!command) {
			throw new Error("exec.approval.request requires command");
		}
		const explicitId = asString(params.id);
		const approvalId = explicitId ?? `approval_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
		if (pendingExecApprovals.has(approvalId)) {
			throw new Error("approval id already pending");
		}
		const timeoutMs = Math.max(1, asNumber(params.timeoutMs) ?? EXEC_APPROVAL_REQUEST_TIMEOUT_DEFAULT_MS);
		const now = Date.now();
		const expiresAtMs = now + timeoutMs;
		const twoPhase = asBoolean(params.twoPhase) ?? false;
		const requestPayload: Record<string, unknown> = {
			command,
			commandArgv: Array.isArray(params.commandArgv) ? params.commandArgv : undefined,
			cwd: asString(params.cwd) ?? null,
			nodeId: asString(params.nodeId) ?? null,
			host: asString(params.host) ?? null,
			security: asString(params.security) ?? null,
			ask: asString(params.ask) ?? null,
			agentId: asString(params.agentId) ?? null,
			resolvedPath: asString(params.resolvedPath) ?? null,
			sessionKey: asString(params.sessionKey) ?? null,
			runId: asString(params.runId) ?? null,
			systemRunPlan: isPlainObject(params.systemRunPlan) ? params.systemRunPlan : undefined,
			turnSourceChannel: asString(params.turnSourceChannel) ?? null,
			turnSourceTo: asString(params.turnSourceTo) ?? null,
			turnSourceAccountId: asString(params.turnSourceAccountId) ?? null,
			turnSourceThreadId: params.turnSourceThreadId ?? null,
		};
		let resolveDecision: (decision: string | null) => void = () => {};
		const decisionPromise = new Promise<string | null>((resolve) => {
			resolveDecision = resolve;
		});
		const timeout = setTimeout(() => {
			resolvePendingExecApproval(approvalId, null);
		}, timeoutMs);
		pendingExecApprovals.set(approvalId, {
			id: approvalId,
			request: requestPayload,
			createdAtMs: now,
			expiresAtMs,
			decision: null,
			decisionPromise,
			resolveDecision,
			timeout,
			sessionId: asString(params.sessionKey),
			runId: asString(params.runId),
			turnSourceChannel: asString(params.turnSourceChannel) ?? null,
			turnSourceTo: asString(params.turnSourceTo) ?? null,
			turnSourceThreadId: asString(params.turnSourceThreadId) ?? null,
		});
		const approvalPrompt = formatExecApprovalPrompt({
			id: approvalId,
			command,
			createdAtMs: now,
			expiresAtMs,
			channelId: asString(params.turnSourceChannel) ?? null,
			senderId: asString(params.turnSourceTo) ?? null,
			threadId: asString(params.turnSourceThreadId) ?? null,
			sessionId: asString(params.sessionKey) ?? null,
		});
		emitExecApprovalRuntimeStatus({
			runId: asString(params.runId),
			sessionId: asString(params.sessionKey),
		}, approvalPrompt);
		broadcastExecApprovalEvent({
			type: "exec.approval.requested",
			record: {
				id: approvalId,
				runId: asString(params.runId),
				sessionId: asString(params.sessionKey),
				turnSourceChannel: asString(params.turnSourceChannel) ?? null,
				turnSourceTo: asString(params.turnSourceTo) ?? null,
				turnSourceThreadId: asString(params.turnSourceThreadId) ?? null,
			},
			text: approvalPrompt,
		});
		if (twoPhase) {
			return {
				status: "accepted",
				id: approvalId,
				createdAtMs: now,
				expiresAtMs,
			};
		}
		const decision = await decisionPromise;
		return {
			id: approvalId,
			decision,
			createdAtMs: now,
			expiresAtMs,
		};
	};

	const execApprovalWaitDecision = async (params: Record<string, unknown>): Promise<unknown> => {
		const id = asString(params.id);
		if (!id) {
			throw new Error("id is required");
		}
		const resolved = resolvedExecApprovals.get(id);
		if (resolved) {
			return {
				id,
				decision: resolved.decision,
				createdAtMs: resolved.createdAtMs,
				expiresAtMs: resolved.expiresAtMs,
			};
		}
		const pending = pendingExecApprovals.get(id);
		if (!pending) {
			throw new Error("approval expired or not found");
		}
		const waitMs = Math.max(1, asNumber(params.timeoutMs) ?? EXEC_APPROVAL_WAIT_TIMEOUT_DEFAULT_MS);
		const timeoutToken = Symbol("timeout");
		const decision = await Promise.race<string | null | symbol>([
			pending.decisionPromise,
			new Promise<symbol>((resolve) => {
				setTimeout(() => resolve(timeoutToken), waitMs);
			}),
		]);
		if (decision === timeoutToken) {
			throw new Error("approval wait timed out");
		}
		const resolvedAfter = resolvedExecApprovals.get(id);
		return {
			id,
			decision,
			createdAtMs: resolvedAfter?.createdAtMs ?? pending.createdAtMs,
			expiresAtMs: resolvedAfter?.expiresAtMs ?? pending.expiresAtMs,
		};
	};

	const execApprovalResolve = async (params: Record<string, unknown>): Promise<unknown> => {
		const id = asString(params.id);
		const decision = asString(params.decision);
		if (!id) {
			throw new Error("id is required");
		}
		if (!decision || !["allow-once", "allow-always", "deny"].includes(decision)) {
			throw new Error("invalid decision");
		}
		const ok = resolvePendingExecApproval(id, decision);
		if (!ok) {
			throw new Error("unknown approval id");
		}
		return { ok: true };
	};

	const resolveExecApprovalAgentSettings = (file: ExecApprovalsFile, agentId: string): ExecApprovalsAgent => {
		const defaults = file.defaults ?? {};
		const scoped = file.agents?.[agentId] ?? {};
		return {
			...defaults,
			...scoped,
			allowlist: scoped.allowlist ?? [],
		};
	};

	const findAllowlistedApproval = async (agentId: string, command: string): Promise<boolean> => {
		const snapshot = await readExecApprovalsSnapshot();
		const settings = resolveExecApprovalAgentSettings(snapshot.file, agentId);
		const allowlist = settings.allowlist ?? [];
		const matched = allowlist.find((entry) => matchesExecApprovalPattern(entry.pattern, command));
		if (!matched) return false;
		matched.lastUsedAt = Date.now();
		matched.lastUsedCommand = command;
		await saveExecApprovalsFile(snapshot.path, snapshot.file);
		return true;
	};

	const persistAllowAlwaysApproval = async (agentId: string, command: string, resolvedPath?: string): Promise<void> => {
		const snapshot = await readExecApprovalsSnapshot();
		const next = normalizeExecApprovalsFile(snapshot.file, snapshot.file);
		const nextAgents = next.agents ?? {};
		const currentAgent = nextAgents[agentId] ?? {};
		const allowlist = Array.isArray(currentAgent.allowlist) ? currentAgent.allowlist.slice() : [];
		const existing = allowlist.find((entry) => entry.pattern === command);
		if (existing) {
			existing.lastUsedAt = Date.now();
			existing.lastUsedCommand = command;
			if (resolvedPath) {
				existing.lastResolvedPath = resolvedPath;
			}
		} else {
			allowlist.push({
				id: randomUUID().slice(0, 8),
				pattern: command,
				lastUsedAt: Date.now(),
				lastUsedCommand: command,
				...(resolvedPath ? { lastResolvedPath: resolvedPath } : {}),
			});
		}
		nextAgents[agentId] = {
			...currentAgent,
			allowlist,
		};
		next.agents = nextAgents;
		await saveExecApprovalsFile(snapshot.path, next);
	};

	const skillsInstall = async (params: Record<string, unknown>): Promise<unknown> => {
		const name = asString(params.name);
		const installId = asString(params.installId);
		if (!name || !installId) {
			throw new Error("skills.install requires name and installId");
		}
		const targetDir = join(resolveUnderstudyHomeDir(), "skills", name);
		const targetSkillMd = join(targetDir, "SKILL.md");
		if (existsSync(targetSkillMd)) {
			return {
				ok: true,
				name,
				installId,
				message: `Skill "${name}" is already installed.`,
			};
		}
		const sourceDir = resolveSkillInstallSource({ name, installId });
		if (!sourceDir) {
			if (/^https?:\/\//i.test(installId)) {
				throw new Error("remote skill install is not supported by the local gateway installer");
			}
			throw new Error(`skill install source not found: ${installId}`);
		}
		await mkdir(join(resolveUnderstudyHomeDir(), "skills"), { recursive: true });
		const sourceReal = await realpath(sourceDir).catch(() => resolvePath(sourceDir));
		const targetReal = await realpath(targetDir).catch(() => resolvePath(targetDir));
		if (sourceReal !== targetReal) {
			await cp(sourceDir, targetDir, { recursive: true });
		}

		const cfg = configManager.get();
		const skills = asRecord((cfg.skills as unknown) ?? {});
		const entries = asRecord(skills.entries);
		const current = asRecord(entries[name]);
		entries[name] = { ...current, enabled: true };
		configManager.update({
			skills: {
				...skills,
				entries,
			},
		} as unknown as Partial<UnderstudyConfig>);
		configManager.save();

		return {
			ok: true,
			name,
			installId,
			message: `Installed skill "${name}".`,
		};
	};

	const skillsUpdate = async (params: Record<string, unknown>): Promise<unknown> => {
		const skillKey = asString(params.skillKey);
		if (!skillKey) {
			throw new Error("skills.update requires skillKey");
		}
		const cfg = configManager.get();
		const workspaceDir = resolveGatewayWorkspaceDir(cfg);
		const snapshot = buildWorkspaceSkillSnapshot({
			workspaceDir,
			config: cfg,
		});
		const skills = asRecord((cfg.skills as unknown) ?? {});
		const entries = asRecord(skills.entries);
		const resolvedSkill = snapshot.skills.find(
			(skill) => skill.name === skillKey || skill.skillKey === skillKey,
		);
		const entryKey = entries[skillKey]
			? skillKey
			: resolvedSkill?.name ?? skillKey;
		const current = asRecord(entries[entryKey]);
		if (asBoolean(params.enabled) !== undefined) {
			current.enabled = asBoolean(params.enabled);
		}
		if (typeof params.apiKey === "string") {
			const trimmed = params.apiKey.trim();
			if (trimmed.length > 0) {
				current.apiKey = trimmed;
			} else {
				delete current.apiKey;
			}
		}
		if (isPlainObject(params.env)) {
			const envCurrent = asRecord(current.env);
			for (const [key, value] of Object.entries(params.env)) {
				const normalizedKey = key.trim();
				if (!normalizedKey) continue;
				if (typeof value !== "string" || value.trim().length === 0) {
					delete envCurrent[normalizedKey];
				} else {
					envCurrent[normalizedKey] = value.trim();
				}
			}
			current.env = envCurrent;
		}
		entries[entryKey] = current;
		configManager.update({
			skills: {
				...skills,
				entries,
			},
		} as unknown as Partial<UnderstudyConfig>);
		configManager.save();
		return {
			ok: true,
			skillKey,
			entryKey,
			config: current,
		};
	};

	const agentIdentityGet = async (params: Record<string, unknown>): Promise<unknown> => {
		const cfg = configManager.get();
		const sessionKey = asString(params.sessionKey);
		const agentId = asString(params.agentId) ?? DEFAULT_AGENT_ID;
		const identity = asString(cfg.agent.identity) ?? "You are Understudy.";
		return {
			agentId,
			sessionKey,
			identity,
			name: "Understudy",
			displayName: "Understudy",
			runtimeProfile: cfg.agent.runtimeProfile ?? "assistant",
			avatar: null,
		};
	};

	const agentWait = async (params: Record<string, unknown>): Promise<unknown> => {
		const timeoutMs = Math.max(0, asNumber(params.timeoutMs) ?? 30_000);
		const sessionId = asString(params.sessionId);
		const runId =
			asString(params.runId) ??
			(sessionId ? runRegistry.getLatestRunId(sessionId) : undefined);

		if (!runId) {
			return {
				status: "timeout",
				error: "runId is required",
			};
		}

		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const snapshot = agentRuns.get(runId);
			if (snapshot && snapshot.status !== "in_flight") {
				return {
					runId,
					status: snapshot.status,
					startedAt: snapshot.startedAt,
					endedAt: snapshot.endedAt,
					error: snapshot.error,
					response: snapshot.response,
					sessionId: snapshot.sessionId,
					...(snapshot.images?.length ? { images: snapshot.images } : {}),
					...(snapshot.meta ? { meta: snapshot.meta } : {}),
				};
			}

			if (Date.now() >= deadline) {
				const progress = runRegistry.getProgress(runId);
				return {
					runId,
					status: "timeout",
					startedAt: snapshot?.startedAt,
					sessionId: snapshot?.sessionId ?? sessionId,
					...(progress ? { progress } : {}),
				};
			}

			await new Promise<void>((resolve) => setTimeout(resolve, 50));
		}
	};

	const browserRequest = async (params: Record<string, unknown>): Promise<unknown> => {
		const method = (asString(params.method) ?? "GET").toUpperCase();
		const path = normalizeBrowserRoute(asString(params.path) ?? "/");
		const body = asRecord(params.body);
		const query = asRecord(params.query);
		const actionFromParams = asString(params.action);

		const pick = (key: string): unknown =>
			body[key] ??
			query[key] ??
			params[key];

		let toolParams: Record<string, unknown>;
		if (actionFromParams) {
			toolParams = { ...params, action: actionFromParams };
		} else {
			switch (path) {
				case "/start":
					toolParams = { action: "start" };
					break;
				case "/stop":
					toolParams = { action: "stop" };
					break;
				case "/tabs":
					toolParams = { action: "tabs" };
					break;
				case "/open":
					toolParams = { action: "open", url: asString(pick("url")) };
					break;
				case "/focus":
					toolParams = { action: "focus", targetId: asString(pick("targetId")) };
					break;
				case "/navigate":
					toolParams = { action: "navigate", url: asString(pick("url")) };
					break;
				case "/click":
					toolParams = { action: "click", selector: asString(pick("selector")) };
					break;
				case "/type":
					toolParams = {
						action: "type",
						selector: asString(pick("selector")),
						text: asString(pick("text")),
					};
					break;
				case "/screenshot":
					toolParams = {
						action: "screenshot",
						targetId: asString(pick("targetId")),
						ref: asString(pick("ref")),
						element: asString(pick("element")),
						fullPage: typeof pick("fullPage") === "boolean" ? pick("fullPage") : undefined,
						type: asString(pick("type")),
					};
					break;
				case "/snapshot":
					toolParams = {
						action: "snapshot",
						targetId: asString(pick("targetId")),
						selector: asString(pick("selector")),
						format: asString(pick("format")),
						limit: asNumber(pick("limit")),
						depth: asNumber(pick("depth")),
						labels: typeof pick("labels") === "boolean" ? pick("labels") : undefined,
						interactive: typeof pick("interactive") === "boolean" ? pick("interactive") : undefined,
						compact: typeof pick("compact") === "boolean" ? pick("compact") : undefined,
						fullPage: typeof pick("fullPage") === "boolean" ? pick("fullPage") : undefined,
						type: asString(pick("type")),
					};
					break;
				case "/evaluate":
					toolParams = {
						action: "evaluate",
						targetId: asString(pick("targetId")),
						ref: asString(pick("ref")),
						selector: asString(pick("selector")),
						fn: asString(pick("fn")),
						maxChars: asNumber(pick("maxChars")),
					};
					break;
				case "/console":
					toolParams = {
						action: "console",
						targetId: asString(pick("targetId")),
						level: asString(pick("level")),
						limit: asNumber(pick("limit")),
					};
					break;
				case "/dialog":
					toolParams = {
						action: "dialog",
						targetId: asString(pick("targetId")),
						accept: typeof pick("accept") === "boolean" ? pick("accept") : undefined,
						promptText: asString(pick("promptText")),
						limit: asNumber(pick("limit")),
					};
					break;
				case "/response/body":
					toolParams = {
						action: "response_body",
						targetId: asString(pick("targetId")),
						url: asString(pick("url")),
						timeoutMs: asNumber(pick("timeoutMs")),
						maxChars: asNumber(pick("maxChars")),
					};
					break;
				case "/close":
					toolParams = { action: "close", targetId: asString(pick("targetId")) };
					break;
				case "/pdf":
					toolParams = { action: "pdf", path: asString(pick("path")) };
					break;
				case "/upload":
					toolParams = {
						action: "upload",
						targetId: asString(pick("targetId")),
						ref: asString(pick("ref")),
						selector: asString(pick("selector")),
						path: asString(pick("path")),
						paths: Array.isArray(pick("paths")) ? pick("paths") : undefined,
					};
					break;
				default:
					throw new Error(`Unsupported browser.request path: ${path}`);
			}
		}

		if (!["GET", "POST", "DELETE"].includes(method)) {
			throw new Error("browser.request method must be GET, POST, or DELETE");
		}

		const result = await browserGatewayTool.execute(randomUUID(), toolParams as any);
		const content = Array.isArray(result.content) ? result.content : [];
		const text = content
			.filter((item: any) => item?.type === "text" && typeof item.text === "string")
			.map((item: any) => item.text as string)
			.join("\n")
			.trim();
		if (text.startsWith("Browser error:")) {
			throw new Error(text);
		}
		return {
			ok: true,
			method,
			path,
			action: toolParams.action,
			text,
			details: result.details ?? {},
			content,
		};
	};

	const secretsReload = async (): Promise<unknown> => {
		const fresh = await ConfigManager.load(configManager.getPath());
		configManager.update(fresh.get());
		return {
			ok: true,
			warningCount: 0,
			path: configManager.getPath(),
			reloadedAt: Date.now(),
		};
	};

	const secretsResolve = async (params: Record<string, unknown>): Promise<unknown> => {
		const commandName = asString(params.commandName);
		if (!commandName) {
			throw new Error("secrets.resolve requires commandName");
		}
		const targetIds = Array.isArray(params.targetIds)
			? params.targetIds
				.filter((entry): entry is string => typeof entry === "string")
				.map((entry) => entry.trim())
				.filter(Boolean)
			: [];
		if (targetIds.length === 0) {
			return {
				ok: true,
				commandName,
				assignments: [],
				diagnostics: ["No targetIds provided; nothing resolved."],
				inactiveRefPaths: [],
			};
		}
		const allAssignments = collectSecretAssignments(configManager.get());
		const normalizedTargets = targetIds.map((entry) => entry.toLowerCase());
		const assignments = allAssignments
			.filter((assignment) =>
				normalizedTargets.some((target) => assignment.path.toLowerCase().includes(target)),
			)
			.map((assignment) => ({
				path: assignment.path,
				pathSegments: assignment.pathSegments,
				value: typeof assignment.value === "string"
					? assignment.value.slice(0, 4) + "***"
					: "[REDACTED]",
			}));
		const diagnostics: string[] = [];
		if (assignments.length === 0) {
			diagnostics.push("No matching secrets found in config/env for requested targetIds.");
		}
		return {
			ok: true,
			commandName,
			assignments,
			diagnostics,
			inactiveRefPaths: [],
		};
	};

	const requireScheduleService = (): ScheduleService => {
		if (!scheduleService) {
			throw new Error("schedule service is not initialized");
		}
		return scheduleService;
	};

	const resolveScheduleJobId = (params: Record<string, unknown>, operation: string): string => {
		const requested = asString(params.id);
		if (!requested) {
			throw new Error(`${operation} requires id`);
		}
		const service = requireScheduleService();
		const direct = service.getJob(requested);
		if (direct) {
			return direct.id;
		}
		const byName = service
			.list({ includeDisabled: true })
			.find((entry) => entry.name === requested);
		if (!byName) {
			throw new Error(`Job not found: ${requested}`);
		}
		return byName.id;
	};

	const getSkillsStatus = async (): Promise<Record<string, unknown>> => {
		const currentConfig = configManager.get();
		const workspaceDir = resolveGatewayWorkspaceDir(currentConfig);
		const snapshot = buildWorkspaceSkillSnapshot({
			workspaceDir,
			config: currentConfig,
		});
		const available = snapshot.resolvedSkills.length;
		const loaded = snapshot.resolvedSkills.filter(
			(skill) => asRecord(skill).disableModelInvocation !== true,
		).length;
		return {
			loaded,
			available,
			truncated: snapshot.truncated,
			workspaceDir,
			skills: snapshot.skills.map((entry) => entry.name),
			skillEntries: snapshot.skills,
		};
	};

		const listModels = async (): Promise<Record<string, unknown>> => {
			const mergedModels = mergeKnownModels(BUILTIN_MODELS);
			const authStatuses = inspectProviderAuthStatuses(Object.keys(mergedModels), {
				agentDir: resolveUnderstudyAgentDir(),
			});
			return {
				models: Object.entries(mergedModels).flatMap(([provider, models]) => {
					const authStatus = authStatuses.get(provider);
					return models.map((id) => ({
						provider,
						id,
						authAvailable: authStatus?.available === true,
						authSource: authStatus?.source,
						authType: authStatus?.credentialType,
					}));
				}),
			};
		};

		const getGatewayCapabilities = async ({ defaults }: { defaults: Record<string, unknown> }) => {
			const inventory = asRecord(defaults.inventory);
			const methods = Array.isArray(inventory.methods)
				? inventory.methods
					.map((entry) => asString(asRecord(entry).name))
					.filter((entry): entry is string => Boolean(entry))
				: [];
			const namespaces = Array.isArray(inventory.namespaces)
				? inventory.namespaces.map((entry) => {
					const record = asRecord(entry);
					return {
						id: asString(record.name) ?? "core",
						count: asNumber(record.methodCount) ?? 0,
						methods: Array.isArray(record.methods)
							? record.methods.map((value) => String(value))
							: [],
					};
				})
				: [];
			const groups = Array.isArray(inventory.groups)
				? inventory.groups.map((entry) => {
					const record = asRecord(entry);
					return {
						id: asString(record.name) ?? "core",
						namespace: asString(record.namespace) ?? "core",
						count: asNumber(record.methodCount) ?? 0,
						methods: Array.isArray(record.methods)
							? record.methods.map((value) => String(value))
							: [],
					};
				})
				: [];
			const tools = await listToolCatalog() as Record<string, unknown>;
			const skills = await getSkillsStatus();
			const models = await listModels();
			return {
				auth: asRecord(asRecord(defaults.transport).http).auth ?? { mode: "none", required: false },
				methods,
				namespaces,
				groups,
				transport: {
					httpRpc: true,
					wsRpc: true,
					wsEvents: true,
					singlePort: true,
				},
				media: {
					images: true,
					attachments: true,
					inlineFiles: true,
				},
				features: {
					liveChat: methods.includes("chat.stream"),
					quickChat: methods.includes("chat.send"),
					sessions: methods.includes("session.send"),
					sessionHistory: methods.includes("session.history"),
					sessionTrace: methods.includes("session.trace"),
					modelConfig: methods.includes("config.apply"),
					toolsDiscovery: methods.includes("tools.catalog"),
					skillsDiscovery: methods.includes("skills.status"),
				},
				discovery: {
					models,
					tools,
					skills,
				},
				models,
				tools,
				skills,
			};
		};

		// Create and start gateway
		gateway = new GatewayServer({
		port,
		host,
		channelAutoRestart: config.gateway?.channelAutoRestart,
		channelRestartBaseDelayMs: config.gateway?.channelRestartBaseDelayMs,
		channelRestartMaxDelayMs: config.gateway?.channelRestartMaxDelayMs,
		auth: config.gateway?.auth,
		trustedProxies: config.gateway?.trustedProxies,
		rateLimitConfig: config.gateway?.rateLimit,
		agentIdentityGet,
		agentWait,
		agentsList,
		agentsCreate,
		agentsUpdate,
		agentsDelete,
		agentsFilesList,
		agentsFilesGet,
		agentsFilesSet,
		webLoginStart,
		webLoginWait,
		execApprovalRequest,
		execApprovalWaitDecision,
		execApprovalResolve,
		execApprovalsGet,
		execApprovalsSet,
		browserRequest,
		secretsReload,
		secretsResolve,
		skillsInstall,
		skillsUpdate,
			logsTail: readGatewayLogs,
			capabilitiesGet: getGatewayCapabilities,
			healthHandlers: {
				getReadiness: async () =>
					await getRuntimeReadiness() as unknown as Record<string, unknown>,
		},
		configHandlers: {
			getConfig: () => configManager.get() as unknown as Record<string, unknown>,
			applyConfig: applyConfigPartial,
		},
		scheduleHandlers: {
			list: async () => requireScheduleService().list({ includeDisabled: true }),
			status: async () => {
				const service = requireScheduleService();
				const status = service.status();
				const runCount = service
					.list({ includeDisabled: true })
					.reduce((sum, job) => sum + job.runCount, 0);
				return {
					...status,
					runCount,
					enabled: status.running,
					storePath: scheduleStorePath,
				};
			},
			add: async (params) => {
				const command = asString(params.command);
				if (!command) {
					throw new Error("schedule.add requires command");
				}
				const schedule = asString(params.schedule);
				if (!schedule) {
					throw new Error("schedule.add requires schedule");
				}
				const service = requireScheduleService();
				const delivery = asRecord(params.delivery);
				const scheduleOptions = asRecord(params.scheduleOptions);
				const normalizedDelivery = {
					channelId: asString(delivery.channelId),
					senderId: asString(delivery.senderId),
					sessionId: asString(delivery.sessionId),
					threadId: asString(delivery.threadId),
				};
				const normalizedScheduleOptions = {
					timezone: asString(scheduleOptions.timezone),
					startAt: asString(scheduleOptions.startAt),
					stopAt: asString(scheduleOptions.stopAt),
					intervalSeconds: asNumber(scheduleOptions.intervalSeconds),
				};
				const hasDelivery = Boolean(
					normalizedDelivery.channelId ||
					normalizedDelivery.senderId ||
					normalizedDelivery.sessionId ||
					normalizedDelivery.threadId,
				);
				const hasScheduleOptions = Boolean(
					normalizedScheduleOptions.timezone ||
					normalizedScheduleOptions.startAt ||
					normalizedScheduleOptions.stopAt ||
					typeof normalizedScheduleOptions.intervalSeconds === "number",
				);
				return await service.add({
					name: asString(params.name) ?? `job_${Date.now().toString(36)}`,
					schedule: schedule,
					command,
					enabled: asBoolean(params.enabled) ?? true,
					delivery: hasDelivery ? normalizedDelivery : undefined,
					scheduleOptions: hasScheduleOptions ? normalizedScheduleOptions : undefined,
				});
			},
			update: async (params) => {
				const service = requireScheduleService();
				const id = resolveScheduleJobId(params, "schedule.update");
				const delivery = asRecord(params.delivery);
				const scheduleOptions = asRecord(params.scheduleOptions);
				const patch: {
					name?: string;
					command?: string;
					schedule?: string;
					enabled?: boolean;
					delivery?: {
						channelId?: string;
						senderId?: string;
						sessionId?: string;
						threadId?: string;
					};
					scheduleOptions?: {
						timezone?: string;
						startAt?: string;
						stopAt?: string;
						intervalSeconds?: number;
					};
				} = {};
				const name = asString(params.name);
				if (name) patch.name = name;
				const command = asString(params.command);
				if (command) patch.command = command;
				const schedule = asString(params.schedule);
				if (schedule) patch.schedule = schedule;
				const enabled = asBoolean(params.enabled);
				if (enabled !== undefined) patch.enabled = enabled;
					if (Object.keys(delivery).length > 0) {
						const normalizedDelivery = {
							channelId: asString(delivery.channelId),
							senderId: asString(delivery.senderId),
							sessionId: asString(delivery.sessionId),
							threadId: asString(delivery.threadId),
						};
						if (
							normalizedDelivery.channelId ||
							normalizedDelivery.senderId ||
							normalizedDelivery.sessionId ||
							normalizedDelivery.threadId
						) {
							patch.delivery = normalizedDelivery;
						}
					}
				if (Object.keys(scheduleOptions).length > 0) {
					const normalizedScheduleOptions = {
						timezone: asString(scheduleOptions.timezone),
						startAt: asString(scheduleOptions.startAt),
						stopAt: asString(scheduleOptions.stopAt),
						intervalSeconds: asNumber(scheduleOptions.intervalSeconds),
					};
					if (
						normalizedScheduleOptions.timezone ||
						normalizedScheduleOptions.startAt ||
						normalizedScheduleOptions.stopAt ||
						typeof normalizedScheduleOptions.intervalSeconds === "number"
					) {
						patch.scheduleOptions = normalizedScheduleOptions;
					}
				}
				return await service.update(id, patch);
			},
			remove: async (params) => {
				const service = requireScheduleService();
				const id = resolveScheduleJobId(params, "schedule.remove");
				const result = await service.remove(id);
				return { id, deleted: result.removed, ok: result.ok };
			},
			run: async (params) => {
				const service = requireScheduleService();
				const id = resolveScheduleJobId(params, "schedule.run");
				const result = await service.run(id);
				return { id, ...result };
			},
			runs: async (params) => {
				const service = requireScheduleService();
				const limit = Math.max(1, asNumber(params.limit) ?? 20);
				const id = asString(params.id);
				if (!id) {
					const runs = service
						.list({ includeDisabled: true })
						.flatMap((job) =>
							service.getRuns(job.id, limit).map((run) => ({
								...run,
								jobName: job.name,
							})),
						)
						.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
						.slice(0, limit);
					return { runs };
				}
				const resolvedId = resolveScheduleJobId({ id }, "schedule.runs");
				return {
					id: resolvedId,
					runs: service.getRuns(resolvedId, limit),
				};
			},
			},
			discoveryHandlers: {
				listModels,
				listTools: listToolCatalog,
				getSkillsStatus,
			},
			usageHandlers: {
				tracker: usageTracker,
			},
			reloadConfig: async () => {
				const fresh = await ConfigManager.load(configManager.getPath());
				await syncMemoryProviderForConfig(fresh.get());
				configManager.update(fresh.get());
				return {
					reloaded: true,
					path: configManager.getPath(),
				};
			},
		});
	for (const channel of channels) {
		gateway.addChannel(channel);
	}
	for (const warning of warnings) {
		console.warn(`[gateway] ${warning}`);
	}
	for (const warning of mcpWarnings) {
		console.warn(`[mcp] ${warning}`);
	}

	await syncMemoryProviderForConfig(config);

	const sessionScope = config.gateway?.sessionScope ?? "channel_sender";
	const dmScope = config.gateway?.dmScope ?? "sender";
	const idleResetMinutes = Math.max(0, config.gateway?.idleResetMinutes ?? 0);
	const idleResetMs = idleResetMinutes > 0 ? idleResetMinutes * 60_000 : 0;
	const dailyReset = config.gateway?.dailyReset !== false;
	const sessionEntries = new Map<string, SessionEntry>();
	sessionEntriesRef = sessionEntries;
	const inFlightSessionIds = new Set<string>();
	const maxHistory = 200;
	const maxHistoryImages = 4;
	const maxHistoryAttachments = 8;
	const maxHistoryImageDataChars = 2_000_000;

	function normalizeHistoryImages(value: ImageContent[] | undefined): ImageContent[] | undefined {
		if (!Array.isArray(value)) {
			return undefined;
		}
		const images = value
			.filter((image): image is ImageContent =>
				Boolean(image) &&
				image.type === "image" &&
				typeof image.data === "string" &&
				typeof image.mimeType === "string" &&
				image.mimeType.startsWith("image/") &&
				image.data.length > 0 &&
				image.data.length <= maxHistoryImageDataChars,
			)
			.slice(0, maxHistoryImages)
			.map((image) => ({
				type: "image" as const,
				data: image.data,
				mimeType: image.mimeType,
			}));
		return images.length > 0 ? images : undefined;
	}

	function normalizeHistoryAttachments(value: Attachment[] | undefined): Attachment[] | undefined {
		if (!Array.isArray(value)) {
			return undefined;
		}
		const attachments = value
			.filter((attachment): attachment is Attachment =>
				Boolean(attachment) &&
				typeof attachment.type === "string" &&
				typeof attachment.url === "string" &&
				attachment.url.trim().length > 0,
			)
			.slice(0, maxHistoryAttachments)
			.map((attachment) => ({
				type: attachment.type,
				url: attachment.url,
				name: attachment.name,
				mimeType: attachment.mimeType,
				size: attachment.size,
			}));
		return attachments.length > 0 ? attachments : undefined;
	}

	function trimHistory(history: SessionEntry["history"]): void {
		if (history.length <= maxHistory) return;
		history.splice(0, history.length - maxHistory);
	}

	function appendHistory(
		entry: SessionEntry,
		role: "user" | "assistant",
		text: string,
		timestamp = Date.now(),
		options?: {
			images?: ImageContent[];
			attachments?: Attachment[];
		},
	): void {
		const images = normalizeHistoryImages(options?.images);
		const attachments = normalizeHistoryAttachments(options?.attachments);
		entry.history.push({
			role,
			text,
			timestamp,
			...(images ? { images } : {}),
			...(attachments ? { attachments } : {}),
		});
		trimHistory(entry.history);
		void transcriptStore.append({
			sessionId: entry.id,
			role,
			text,
			timestamp,
			channelId: entry.channelId,
			senderId: entry.senderId,
			threadId: entry.threadId,
			...(images || attachments
				? {
					meta: {
						...(images ? { images } : {}),
						...(attachments ? { attachments } : {}),
					},
				}
				: {}),
		}).catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			console.warn(`[gateway] failed to persist transcript entry: ${message}`);
		});
	}

	async function loadPersistedHistory(sessionId: string): Promise<SessionEntry["history"]> {
		return (await transcriptStore.list({ sessionId, limit: maxHistory })).map((entry) => ({
			role: entry.role,
			text: entry.text,
			timestamp: entry.timestamp,
			...(Array.isArray(entry.meta?.images) ? { images: entry.meta.images as SessionEntry["history"][number]["images"] } : {}),
			...(Array.isArray(entry.meta?.attachments)
				? { attachments: entry.meta.attachments as SessionEntry["history"][number]["attachments"] }
				: {}),
		}));
	}

	function estimateTokens(text: string): number {
		const chars = text.trim().length;
		if (chars === 0) return 0;
		return Math.max(1, Math.ceil(chars / 4));
	}

	async function getRuntimeReadiness(
		forceRefresh: boolean = false,
	): Promise<Awaited<ReturnType<typeof collectGatewayRuntimeReadiness>>> {
		const now = Date.now();
		if (!forceRefresh && readinessSnapshot && readinessSnapshot.expiresAt > now) {
			return readinessSnapshot.value;
		}
		if (!forceRefresh && readinessInFlight) {
			return await readinessInFlight;
		}
		readinessInFlight = collectGatewayRuntimeReadiness({
			config: configManager.get(),
			browserExtensionRelay,
		}).then((value) => {
			readinessSnapshot = {
				value,
				expiresAt: Date.now() + 15_000,
			};
			return value;
		}).finally(() => {
			readinessInFlight = null;
		});
		return await readinessInFlight;
	}

	function extractLatestAssistantText(messages: Array<any>): string {
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role !== "assistant" || !Array.isArray(msg.content)) {
				continue;
			}
			return msg.content
				.filter((chunk: any) => chunk.type === "text")
				.map((chunk: any) => chunk.text)
				.join("\n");
		}
		return "";
	}

	function extractLatestAssistantImages(messages: Array<any>): ImageContent[] | undefined {
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg?.role !== "assistant") {
				continue;
			}
			const images = extractRenderableAssistantImages(msg);
			if (images?.length) {
				return images;
			}
		}
		return undefined;
	}

	function extractToolResultPreview(content: unknown): string {
		if (typeof content === "string") {
			return content.trim().slice(0, 400);
		}
		if (!Array.isArray(content)) {
			return "";
		}
		return content
			.map((chunk) => {
				const record = asRecord(chunk);
				return typeof record.text === "string" ? record.text : "";
			})
			.filter(Boolean)
			.join("\n")
			.trim()
			.slice(0, 400);
	}

	const TOOL_TRACE_MAX_EMBEDDED_IMAGES = 2;
	const TOOL_TRACE_MAX_IMAGE_DATA_CHARS = MAX_INLINE_IMAGE_DATA_CHARS;

	function extractToolResultImages(content: unknown): Array<Record<string, string>> {
		if (!Array.isArray(content)) {
			return [];
		}
		const images: Array<Record<string, string>> = [];
		for (const chunk of content) {
			const record = asRecord(chunk);
			if (!record || asString(record.type) !== "image") {
				continue;
			}
			const imageData = asString(record.data);
			const mimeType = asString(record.mimeType);
			if (!imageData || !mimeType?.startsWith("image/")) {
				continue;
			}
			if (imageData.length > TOOL_TRACE_MAX_IMAGE_DATA_CHARS) {
				continue;
			}
			images.push({
				imageData,
				mimeType,
			});
			if (images.length >= TOOL_TRACE_MAX_EMBEDDED_IMAGES) {
				break;
			}
		}
		return images;
	}

	function summarizeToolResultDetails(details: Record<string, unknown>): Record<string, unknown> {
		const summary: Record<string, unknown> = {};
		const statusInfo = asRecord(details.status);
		if (typeof details.grounding_method === "string") {
			summary.groundingMethod = details.grounding_method;
		}
		const confidence = asNumber(details.confidence);
		if (confidence !== undefined) {
			summary.confidence = confidence;
		}
		if (typeof details.action_kind === "string") {
			summary.actionKind = details.action_kind;
		}
		if (typeof details.timeoutType === "string") {
			summary.timeoutType = details.timeoutType;
		}
		const attempts = asNumber(details.attempts);
		if (attempts !== undefined) {
			summary.attempts = attempts;
		}
		if (typeof details.error === "string") {
			summary.error = details.error;
		}
		if (statusInfo && Object.keys(statusInfo).length > 0) {
			summary.status = statusInfo;
		}
		return summary;
	}

	function buildRunToolTrace(messages: Array<any>): Array<Record<string, unknown>> {
		const trace: Array<Record<string, unknown>> = [];
		for (const message of messages) {
			if (!message || typeof message !== "object") {
				continue;
			}
			const timestamp = asString((message as Record<string, unknown>).timestamp);
			if ((message as Record<string, unknown>).role === "assistant" && Array.isArray((message as any).content)) {
				for (const block of (message as any).content) {
					if (!block || typeof block !== "object" || block.type !== "toolCall") {
						continue;
					}
						const name = asString(block.name) ?? "unknown";
					trace.push({
						type: "toolCall",
						timestamp,
						id: asString(block.id),
						name,
						route: resolveToolExecutionRoute(name),
						arguments: block.arguments,
					});
				}
				continue;
			}
			if ((message as Record<string, unknown>).role === "toolResult") {
				const details = asRecord((message as Record<string, unknown>).details);
				const name = asString((message as Record<string, unknown>).toolName) ?? "unknown";
				const images = extractToolResultImages((message as Record<string, unknown>).content);
				trace.push({
					type: "toolResult",
					timestamp,
					id: asString((message as Record<string, unknown>).toolCallId),
					name,
					route: resolveToolExecutionRoute(name, details),
					isError:
						(message as Record<string, unknown>).isError === true ||
						typeof details?.error === "string",
					textPreview: extractToolResultPreview((message as Record<string, unknown>).content),
					...(images.length > 0 ? { images } : {}),
					...summarizeToolResultDetails(details ?? {}),
				});
			}
		}
		return trace;
	}

	function buildSessionHookPayload(
		entry: SessionEntry,
		runId: string,
	): Record<string, unknown> {
		return {
			sessionId: entry.id,
			sessionKey: entry.id,
			channelId: entry.channelId,
			senderId: entry.senderId,
			threadId: entry.threadId,
			workspaceDir: entry.workspaceDir,
			runId,
		};
	}

	async function promptSession(
		entry: SessionEntry,
		text: string,
		providedRunId?: string,
		promptOptions?: Record<string, unknown>,
	): Promise<{ response: string; runId: string; images?: ImageContent[]; meta?: Record<string, unknown> }> {
		const runtimeSession = entry.session as {
			prompt: (input: string, options?: Record<string, unknown>) => Promise<void>;
			agent: { state: { messages: Array<any> } };
		};
		const runtimeLifecycle = (entry as SessionEntry & {
			runtimeSession?: unknown;
		}).runtimeSession as
			| { onEvent?: (listener: (event: Record<string, unknown>) => void) => () => void }
			| undefined;
		const runId = providedRunId ?? randomUUID();
		const startedAt = Date.now();
		const beforeMessageCount = Array.isArray(runtimeSession.agent.state.messages)
			? runtimeSession.agent.state.messages.length
			: 0;
		runRegistry.startRun({
			runId,
			sessionId: entry.id,
			status: "in_flight",
			startedAt,
			channelId: entry.channelId,
			senderId: entry.senderId,
			threadId: entry.threadId,
			conversationType: entry.conversationType,
		});
		inFlightSessionIds.add(entry.id);
		const unsubscribeRuntimeEvents =
			typeof runtimeLifecycle?.onEvent === "function"
				? runtimeLifecycle.onEvent((event) => {
					(runRegistry as GatewayRunRegistry & {
						emitRuntimeEvent: (runtimeRunId: string, sessionId: string, payload: Record<string, unknown>) => void;
					}).emitRuntimeEvent(runId, entry.id, event);
				})
				: undefined;
		try {
			await pluginRuntime.runHook("before_session_prompt", {
				...buildSessionHookPayload(entry, runId),
				prompt: text,
				details: promptOptions ? { promptOptions } : undefined,
			});
			const aggregatedToolTrace: Array<Record<string, unknown>> = [];
			const aggregatedUsage: Record<string, number> = {};
			const attempts: Array<Record<string, unknown>> = [];
			const attemptStartedAt = Date.now();
			await runtimeSession.prompt(text, promptOptions);
			const attemptEndedAt = Date.now();
			const messages = runtimeSession.agent.state.messages as Array<any>;
			const newMessages = messages.slice(beforeMessageCount);
			const response =
				extractLatestAssistantText(newMessages) ||
				extractLatestAssistantText(messages);
			const usage = extractLatestAssistantUsage(newMessages) ?? extractLatestAssistantUsage(messages);
			const toolTrace = buildRunToolTrace(newMessages);
			aggregatedToolTrace.push(...toolTrace);
			for (const [key, value] of Object.entries(usage ?? {})) {
				const numericValue = asNumber(value);
				if (numericValue === undefined) {
					continue;
				}
				aggregatedUsage[key] = (aggregatedUsage[key] ?? 0) + numericValue;
			}
			attempts.push({
				attempt: 1,
				promptKind: "user",
				promptPreview: text.trim().slice(0, 240),
				responsePreview: response.trim().slice(0, 240),
				durationMs: attemptEndedAt - attemptStartedAt,
				toolTrace,
				...(usage ? { usage } : {}),
			});

			const endedAt = Date.now();
			const usageInput =
				(aggregatedUsage.input ?? 0) +
				(aggregatedUsage.cacheRead ?? 0) +
				(aggregatedUsage.cacheWrite ?? 0);
			const usageOutput = aggregatedUsage.output ?? 0;
			const meta: Record<string, unknown> = {
				durationMs: endedAt - startedAt,
				toolTrace: aggregatedToolTrace,
				attempts,
				...(Object.keys(aggregatedUsage).length > 0
					? {
						agentMeta: {
							usage: aggregatedUsage,
							promptTokens: usageInput,
							outputTokens: usageOutput,
						},
					}
					: {}),
				...(entry.workspaceDir ? { workspaceDir: entry.workspaceDir } : {}),
				...(entry.repoRoot ? { repoRoot: entry.repoRoot } : {}),
				...(entry.validationRoot ? { validationRoot: entry.validationRoot } : {}),
				...(entry.sessionMeta ? { sessionMeta: entry.sessionMeta } : {}),
			};
			const images =
				extractLatestAssistantImages(newMessages) ??
				extractLatestAssistantImages(messages) ??
				extractRenderableAssistantImages(meta);
			runRegistry.completeRun({
				runId,
				sessionId: entry.id,
				startedAt,
				endedAt,
				response,
				...(images?.length ? { images } : {}),
				meta,
			});
			await pluginRuntime.runHook("after_session_prompt", {
				...buildSessionHookPayload(entry, runId),
				prompt: text,
				response,
				meta,
				details: promptOptions ? { promptOptions } : undefined,
			});
			return {
				response,
				runId,
				...(images?.length ? { images } : {}),
				meta,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await pluginRuntime.runHook("after_session_prompt", {
				...buildSessionHookPayload(entry, runId),
				prompt: text,
				error: message,
				details: promptOptions ? { promptOptions } : undefined,
			});
			runRegistry.errorRun({
				runId,
				sessionId: entry.id,
				startedAt,
				endedAt: Date.now(),
				error: message,
			});
			throw error;
		} finally {
			unsubscribeRuntimeEvents?.();
			inFlightSessionIds.delete(entry.id);
		}
	}

	async function abortSessionEntry(entry: SessionEntry): Promise<boolean> {
		const abortFn = (entry.session as unknown as { abort?: () => Promise<void> | void }).abort;
		if (typeof abortFn !== "function") {
			return false;
		}
		await abortFn.call(entry.session);
		return true;
	}

	const buildGatewaySessionLifecycleHooks = (sessionId: string): UnderstudySessionLifecycleHooks => ({
		onToolEvent: async (event) => {
			runRegistry.emitToolEvent(sessionId, event);
		},
	});
	let sessionRuntime: ReturnType<typeof createGatewaySessionRuntime> | null = null;

	async function createScopedSession(context: {
		sessionKey: string;
		parentId?: string;
		forkPoint?: number;
		channelId?: string;
		senderId?: string;
		senderName?: string;
		conversationName?: string;
		conversationType?: "direct" | "group" | "thread";
		threadId?: string;
		workspaceDir?: string;
		explicitWorkspace?: boolean;
		configOverride?: Partial<UnderstudyConfig>;
		sandboxInfo?: {
			enabled: boolean;
			containerWorkspaceDir?: string;
			workspaceDir?: string;
			workspaceAccess?: string;
		};
		executionScopeKey?: string;
		allowedToolNames?: string[];
		extraSystemPrompt?: string;
		thinkingLevel?: UnderstudyConfig["defaultThinkingLevel"];
	}): Promise<SessionEntry> {
		const explicitConfig = mergeSessionConfig(configManager.get(), context.configOverride);
		const channelScopedOverride = buildGatewayChannelConfigOverride({
			config: explicitConfig,
			channelId: context.channelId,
			conversationType: context.conversationType,
		});
		const effectiveConfigOverride = mergeUnderstudyConfigOverride(
			context.configOverride,
			channelScopedOverride,
		);
		const currentConfig = mergeSessionConfig(configManager.get(), effectiveConfigOverride);
		const workspaceContext = resolveSessionWorkspaceContext(currentConfig, context.workspaceDir);
			const workspaceDir = await ensureGatewayWorkspaceReady(workspaceContext.workspaceDir);
			const sessionTrace = createSessionTraceLifecycleHooks({
				traceId: `gateway_${createHash("sha1").update(context.sessionKey).digest("hex").slice(0, 12)}`,
			});
			const extraTools = await createConfiguredRuntimeToolset({
				cwd: workspaceDir,
				config: currentConfig,
				browserOptions: () =>
					resolveConfiguredBrowserOptions(
						mergeSessionConfig(configManager.get(), effectiveConfigOverride),
					),
				memoryProvider: memoryProvider ?? undefined,
				scheduleService: scheduleService ?? undefined,
				getChannel: (channelId: string) => gateway.router.getChannel(channelId),
				channel: context.channelId,
				gatewayUrl,
				requesterSessionId: context.sessionKey,
				threadId: context.threadId,
				...(context.senderId ? { senderId: context.senderId } : {}),
				toolFactories: pluginRegistry.getToolFactories(),
				platformCapabilities: () => pluginRegistry.getPlatformCapabilities(),
				spawnSubagent: async (params) => {
				if (!sessionRuntime?.sessionHandlers.spawnSubagent) {
					throw new Error("Subagent spawning is not available yet");
				}
				return await sessionRuntime.sessionHandlers.spawnSubagent(params) as Record<string, unknown>;
			},
			manageSubagents: async (params) => {
				if (!sessionRuntime?.sessionHandlers.subagents) {
					throw new Error("Subagent management is not available yet");
				}
				return await sessionRuntime.sessionHandlers.subagents(params) as Record<string, unknown>;
			},
			additionalTools: mcpTools,
		});

		const sessionConfig = context.thinkingLevel
			? {
				...currentConfig,
				defaultThinkingLevel: context.thinkingLevel,
			}
			: currentConfig;
		const result = await createUnderstudySession({
			config: sessionConfig,
			cwd: workspaceDir,
			channel: context.channelId,
			extraTools,
			allowedToolNames: context.allowedToolNames,
			extraSystemPrompt: context.extraSystemPrompt,
			sandboxInfo: context.sandboxInfo,
			onApprovalRequired: async (toolName: string, toolParams?: unknown) => {
				const { command, commandArgv, resolvedPath } = summarizeApprovalCommand(toolName, toolParams);
				const agentId = DEFAULT_AGENT_ID;
				const runId = runRegistry.getLatestRunId(context.sessionKey);
				if (await findAllowlistedApproval(agentId, command)) {
					return true;
				}
				const settingsSnapshot = await readExecApprovalsSnapshot();
				const settings = resolveExecApprovalAgentSettings(settingsSnapshot.file, agentId);
				const approvalResult = await execApprovalRequest({
					command,
					commandArgv,
					cwd: resolvedPath ?? workspaceDir,
					agentId,
						sessionKey: context.sessionKey,
						runId,
						resolvedPath: resolvedPath ?? null,
						security: settings.security ?? null,
						ask: settings.ask ?? null,
						turnSourceChannel: context.channelId,
						turnSourceTo: context.senderId,
						turnSourceThreadId: context.threadId,
					});
				const decision = asString((approvalResult as Record<string, unknown>).decision);
				if (!decision) {
					const timeoutText = `Approval timed out for "${command}".`;
					emitExecApprovalRuntimeStatus({ runId, sessionId: context.sessionKey }, timeoutText);
					broadcastExecApprovalEvent({
						type: "exec.approval.resolved",
						record: {
							id: asString((approvalResult as Record<string, unknown>).id) ?? "unknown",
							runId,
							sessionId: context.sessionKey,
							turnSourceChannel: context.channelId ?? null,
							turnSourceTo: context.senderId ?? null,
							turnSourceThreadId: context.threadId ?? null,
						},
						text: timeoutText,
						decision: null,
					});
				}
				if (decision === "allow-always") {
					await persistAllowAlwaysApproval(agentId, command, resolvedPath);
					return true;
				}
				return decision === "allow-once";
			},
			lifecycleHooks: mergeLifecycleHooks(
				sessionTrace.lifecycleHooks,
				buildGatewaySessionLifecycleHooks(context.sessionKey),
			),
		} as any);
		const now = Date.now();
		const sessionMeta = {
			...(result.sessionMeta as unknown as Record<string, unknown>),
			traceId: sessionTrace.traceId,
			thinkingLevel:
				context.thinkingLevel ??
				currentConfig.defaultThinkingLevel ??
				(result.sessionMeta as { thinkingLevel?: unknown } | undefined)?.thinkingLevel,
		};
		const sessionEntry = {
			id: context.sessionKey,
			parentId: context.parentId,
			forkPoint: context.forkPoint,
			channelId: context.channelId,
			senderId: context.senderId,
			senderName: context.senderName,
			conversationName: context.conversationName,
			conversationType: context.conversationType,
			threadId: context.threadId,
			createdAt: now,
			lastActiveAt: now,
			dayStamp: dayStampFor(now),
			messageCount: 0,
			session: result.session,
			runtimeSession: result.runtimeSession,
			workspaceDir,
			repoRoot: workspaceContext.repoRoot,
			validationRoot: workspaceContext.validationRoot,
			configOverride: effectiveConfigOverride,
			sandboxInfo: context.sandboxInfo,
			executionScopeKey: context.executionScopeKey,
			traceId: sessionTrace.traceId,
			sessionMeta,
			history: [],
		} as SessionEntry & { runtimeSession?: unknown };
		await pluginRuntime.runHook("session_create", {
			sessionId: sessionEntry.id,
			sessionKey: context.sessionKey,
			channelId: context.channelId,
			senderId: context.senderId,
			threadId: context.threadId,
			workspaceDir: workspaceDir,
			details: {
				parentId: context.parentId,
				executionScopeKey: context.executionScopeKey,
				explicitWorkspace: context.explicitWorkspace === true,
			},
		});
		return sessionEntry;
	}

	async function getOrCreateSession(context: {
		channelId?: string;
		senderId?: string;
		senderName?: string;
		conversationName?: string;
		conversationType?: "direct" | "group" | "thread";
		threadId?: string;
		forceNew?: boolean;
		workspaceDir?: string;
		explicitWorkspace?: boolean;
		configOverride?: Partial<UnderstudyConfig>;
		sandboxInfo?: {
			enabled: boolean;
			containerWorkspaceDir?: string;
			workspaceDir?: string;
			workspaceAccess?: string;
		};
		executionScopeKey?: string;
	}): Promise<SessionEntry> {
		const currentConfig = mergeSessionConfig(configManager.get(), context.configOverride);
		const workspaceContext = resolveSessionWorkspaceContext(currentConfig, context.workspaceDir);
		const workspaceScopeDiscriminator = context.explicitWorkspace
			? buildWorkspaceScopeDiscriminator(workspaceContext.validationRoot)
			: undefined;
		const baseSessionKey = buildSessionKey({
			scope: sessionScope,
			dmScope,
			channelId: context.channelId,
			senderId: context.senderId,
			threadId: context.threadId,
			scopeDiscriminator: workspaceScopeDiscriminator,
		});
		const mappedActiveSessionId = (() => {
			if (context.executionScopeKey) {
				return undefined;
			}
			const activeSessionId = activeSessionBindings.get(baseSessionKey);
			if (!activeSessionId) {
				return undefined;
			}
			if (sessionEntries.has(activeSessionId)) {
				return activeSessionId;
			}
			activeSessionBindings.delete(baseSessionKey);
			scheduleGatewayStateSave();
			return undefined;
		})();
		const resolvedRoute = resolveGatewaySessionRoute({
			scope: sessionScope,
			dmScope,
			channelId: context.channelId,
			senderId: context.senderId,
			threadId: context.threadId,
			workspaceScopeDiscriminator,
			executionScopeKey: context.executionScopeKey,
			forceNew: context.forceNew,
			activeSessionId: mappedActiveSessionId,
		});
		const sessionKey = resolvedRoute.sessionKey;
		const now = Date.now();
		const currentDay = dayStampFor(now);
		const existing = sessionEntries.get(sessionKey);
		const shouldResetByIdle =
			Boolean(existing) &&
			idleResetMs > 0 &&
			now - (existing?.lastActiveAt ?? 0) > idleResetMs;
		const shouldResetByDay =
			Boolean(existing) &&
			dailyReset &&
			existing?.dayStamp !== currentDay;
		const shouldReset = Boolean(context.forceNew) || shouldResetByIdle || shouldResetByDay;

		if (existing && !shouldReset) {
			existing.lastActiveAt = now;
			existing.senderName = context.senderName ?? existing.senderName;
			existing.conversationName = context.conversationName ?? existing.conversationName;
			if (resolvedRoute.shouldPromoteToActive) {
				activeSessionBindings.set(resolvedRoute.baseSessionKey, existing.id);
			}
			scheduleGatewayStateSave();
			return existing;
		}

		const created = await createScopedSession({
			sessionKey,
			channelId: context.channelId,
			senderId: context.senderId,
			senderName: context.senderName,
			conversationName: context.conversationName,
			conversationType: context.conversationType,
			threadId: context.threadId,
			workspaceDir: workspaceContext.workspaceDir,
			explicitWorkspace: context.explicitWorkspace,
			configOverride: context.configOverride,
			sandboxInfo: context.sandboxInfo,
			executionScopeKey: existing?.executionScopeKey ?? resolvedRoute.executionScopeKey,
		});
		sessionEntries.set(sessionKey, created);
		if (resolvedRoute.shouldPromoteToActive) {
			activeSessionBindings.set(resolvedRoute.baseSessionKey, created.id);
		}
		scheduleGatewayStateSave();
		return created;
	}

	sessionRuntime = createGatewaySessionRuntime({
		sessionEntries,
		inFlightSessionIds,
		config,
		usageTracker,
		estimateTokens,
		appendHistory,
		getOrCreateSession,
		createScopedSession,
		promptSession,
		abortSessionEntry,
		resolveAgentTarget: (agentId: string) => {
			const resolved = resolveKnownAgent(agentId);
			if (!resolved) {
				return null;
			}
			return {
				agentId: resolved.id,
				workspaceDir: resolveAgentWorkspaceDir(resolved),
				model: resolved.model,
			};
		},
		waitForRun: async ({ runId, sessionId, timeoutMs }: { runId?: string; sessionId?: string; timeoutMs?: number }) =>
			asRecord(await agentWait({
				runId,
				sessionId,
				timeoutMs,
			})),
		listPersistedSessions: async ({ channelId, senderId, limit }: { channelId?: string; senderId?: string; limit?: number } = {}) =>
			await sessionQueryStore.listSessions({ channelId, senderId, limit }),
		readPersistedSession: async ({ sessionId }: { sessionId: string }) =>
			await sessionQueryStore.getSessionSummary(sessionId),
		readTranscriptHistory: async ({ sessionId, limit }: { sessionId: string; limit?: number }) =>
			await sessionQueryStore.listHistory({ sessionId, limit }),
		readPersistedTrace: async ({ sessionId, limit }: { sessionId: string; limit?: number }) =>
			await sessionQueryStore.listRunTraces({ sessionId, limit }),
		persistSessionRunTrace: async ({ sessionId, trace }: { sessionId: string; trace: SessionRunTrace }) =>
			await sessionQueryStore.appendRunTrace({ sessionId, trace }),
		deletePersistedSession: async ({ sessionId }: { sessionId: string }) => {
			await Promise.all([
				transcriptStore.remove(sessionId),
				runTraceStore.remove(sessionId),
			]);
		},
		onStateChanged: scheduleGatewayStateSave,
		notifyUser: async ({ entry, text, title }: { entry: SessionEntry; text: string; title?: string }) => {
			if (!entry.channelId || !entry.senderId) {
				return;
			}
			const channel = gateway.router.getChannel(entry.channelId);
			if (!channel) {
				return;
			}
			const messageText = [title?.trim(), text.trim()].filter(Boolean).join("\n\n");
			if (!messageText) {
				return;
			}
			try {
				await channel.messaging.sendMessage({
					channelId: entry.channelId,
					recipientId: entry.senderId,
					threadId: entry.threadId,
					text: messageText,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (entry.channelId === "web" && /offline/i.test(message)) {
					return;
				}
				throw error;
			}
		},
	} as any);
	const sessionHandlers = sessionRuntime.sessionHandlers;
	const deleteSessionHandler = sessionHandlers.delete;
	if (deleteSessionHandler) {
		sessionHandlers.delete = async (params) => {
			const result = await deleteSessionHandler(params);
			const deletedSessionId = asString(params?.sessionId);
			const normalizedResult = asRecord(result);
			if (normalizedResult?.deleted === true && deletedSessionId) {
				for (const [routeKey, sessionId] of activeSessionBindings.entries()) {
					if (sessionId === deletedSessionId) {
						activeSessionBindings.delete(routeKey);
					}
				}
				scheduleGatewayStateSave();
			}
			return result;
		};
	}
	gateway.setChatHandler(async (text, context) => {
		const approvalReply = await resolveExecApprovalFromChat({
			text,
			context: {
				channelId: context?.channelId,
				senderId: context?.senderId,
				threadId: context?.threadId,
			},
		});
		if (approvalReply !== null) {
			return {
				response: approvalReply,
				status: "ok",
			};
		}
		return await sessionRuntime.chatHandler(text, context);
	});
	gateway.setSessionHandlers(sessionHandlers);
	for (const [method, handler] of pluginRegistry.getGatewayMethods()) {
		gateway.registerRpcHandler(method, async (request) => ({
			id: request.id,
			result: await handler(asRecord(request.params) ?? {}),
		}));
	}
		scheduleService = new ScheduleService({
			storePath: scheduleStorePath,
			onJobTrigger: async (job) => {
				const delivery = asRecord(job.delivery);
				const channelId = asString(delivery.channelId) ?? "schedule";
				const senderId = asString(delivery.senderId) ?? "scheduler";
				const deliverySessionId = asString(delivery.sessionId);
				const deliveryThreadId = asString(delivery.threadId);
				const scoped = deliverySessionId
					? sessionEntries.get(deliverySessionId) ?? await getOrCreateSession({
						channelId,
						senderId,
						threadId: deliveryThreadId,
					})
					: await getOrCreateSession({
						channelId,
						senderId,
						threadId: deliveryThreadId,
					});
				if (!sessionHandlers.send) {
					throw new Error("Session send handler not configured");
				}
				const result = await sessionHandlers.send({
					sessionId: scoped.id,
				message: job.command,
				waitForCompletion: true,
			});
				await deliverScheduledJobResult({
					channel: gateway.router.getChannel(channelId),
					channelId,
					recipientId: senderId,
					threadId: deliveryThreadId,
					result,
				});
			},
		log: {
			info: (message) => console.log(`[schedule] ${message}`),
			warn: (message) => console.warn(`[schedule] ${message}`),
			error: (message) => console.error(`[schedule] ${message}`),
		},
	});
	await scheduleService.start();

	const persistedGatewayState = await metadataStore.load();
	if (persistedGatewayState) {
		for (const persistedSession of persistedGatewayState.sessions) {
			try {
				const restored = await createScopedSession({
					sessionKey: persistedSession.id,
					parentId: persistedSession.parentId,
					forkPoint: persistedSession.forkPoint,
					channelId: persistedSession.channelId,
					senderId: persistedSession.senderId,
					senderName: persistedSession.senderName,
					conversationName: persistedSession.conversationName,
					conversationType: persistedSession.conversationType,
					threadId: persistedSession.threadId,
					workspaceDir: persistedSession.workspaceDir,
					explicitWorkspace: Boolean(persistedSession.workspaceDir),
					configOverride: persistedSession.configOverride as Partial<UnderstudyConfig> | undefined,
					sandboxInfo: persistedSession.sandboxInfo as SessionEntry["sandboxInfo"] | undefined,
					executionScopeKey: persistedSession.executionScopeKey,
				});
				const restoredHistory = await loadPersistedHistory(persistedSession.id);
				trimHistory(restoredHistory);
				restored.createdAt = persistedSession.createdAt;
				restored.lastActiveAt = persistedSession.lastActiveAt;
				restored.dayStamp = persistedSession.dayStamp;
				restored.messageCount = persistedSession.messageCount;
				restored.repoRoot = persistedSession.repoRoot ?? restored.repoRoot;
				restored.validationRoot = persistedSession.validationRoot ?? restored.validationRoot;
				restored.traceId = asString(persistedSession.traceId) ?? restored.traceId;
				restored.sessionMeta = persistedSession.sessionMeta ?? restored.sessionMeta;
				restored.subagentMeta = persistedSession.subagentMeta ?? restored.subagentMeta;
				restored.history = restoredHistory;
				seedRuntimeMessagesFromHistory(restored, restoredHistory);
				sessionEntries.set(restored.id, restored);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.warn(`[gateway] failed to restore session ${persistedSession.id}: ${message}`);
			}
		}
		for (const binding of persistedGatewayState.activeSessionBindings ?? []) {
			if (sessionEntries.has(binding.sessionId)) {
				activeSessionBindings.set(binding.routeKey, binding.sessionId);
			}
		}

		const restoredRuns = persistedGatewayState.runs.slice(-maxAgentRuns);
		let restoredIncompleteRuns = 0;
		for (const persistedRun of restoredRuns) {
			const restoredRun: AgentRunSnapshot =
				persistedRun.status === "in_flight"
					? {
						...persistedRun,
						status: "error",
						endedAt: Date.now(),
						error: "Understudy gateway restarted before this run completed.",
					}
					: persistedRun;
			if (persistedRun.status === "in_flight") {
				restoredIncompleteRuns += 1;
			}
			runRegistry.restore(restoredRun);
		}
		if (sessionEntries.size > 0 || agentRuns.size > 0) {
			console.log(
				`[gateway] restored ${sessionEntries.size} session(s) and ${agentRuns.size} run snapshot(s).`,
			);
		}
		if (restoredIncompleteRuns > 0) {
			scheduleGatewayStateSave();
		}
	}

	await gateway.start();
	await pluginRuntime.onGatewayStart({
		host,
		port,
		webPort,
	});

		try {
			browserExtensionRelay = await ensureUnderstudyChromeExtensionRelayServer({
				cdpUrl: browserExtensionRelayUrl,
				gatewayToken: startupBrowserToken,
			});
		readinessSnapshot = undefined;
		console.log(`Understudy browser extension relay ready at ${browserExtensionRelay.baseUrl}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		readinessSnapshot = undefined;
		console.warn(`[gateway] browser extension relay unavailable: ${message}`);
	}

	console.log(`Understudy gateway running at http://${host}:${port}`);
	const browserSurfaceUrls = resolveGatewayBrowserSurfaceUrls({
		host,
		port,
		authMode: gateway.authMode,
		authToken: startupBrowserToken,
	});
	console.log(`Understudy dashboard: ${browserSurfaceUrls.dashboardUrl}`);
	console.log(`Understudy webchat: ${browserSurfaceUrls.webchatUrl}`);
	if (channels.some((channel) => channel.id === "web")) {
		console.log(`Understudy web channel adapter running at ws://${host}:${webPort}`);
	}
	console.log(
		`Understudy channels active: ${gateway.router
			.listChannels()
			.map((channel) => channel.id)
			.join(", ")}`,
	);
	if (gateway.authMode !== "none") {
		console.log(`Understudy auth mode: ${gateway.authMode}`);
	}
	if (mcpStatuses.length > 0) {
		const connected = mcpStatuses.filter((status) => status.connected);
		console.log(`Understudy MCP servers connected: ${connected.length}/${mcpStatuses.length}`);
	}

	// Set up config hot-reload for in-memory settings.
	const configReloader = new ConfigReloader({
		configPath: configManager.getPath(),
		currentConfig: config,
		handler: (newConfig, _oldConfig) => {
			configManager.update(newConfig);
			void syncMemoryProviderForConfig(newConfig).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				console.warn(`[gateway] failed to sync memory provider after config reload: ${message}`);
			});
			readinessSnapshot = undefined;
			console.log("[gateway] Config reloaded. Non-destructive settings updated.");
		},
	});
	configReloader.start();

	// Install lifecycle manager for graceful shutdown
	const lifecycle = new LifecycleManager({
		gateway,
		lock,
		onShutdown: async () => {
			if (browserExtensionRelay) {
				await browserExtensionRelay.stop().catch((error) => {
					const message = error instanceof Error ? error.message : String(error);
					console.warn(`[gateway] failed to stop browser extension relay: ${message}`);
				});
				browserExtensionRelay = null;
				readinessSnapshot = undefined;
			}
			scheduleService?.stop();
			scheduleService = null;
			if (stateSaveTimer) {
				clearTimeout(stateSaveTimer);
				stateSaveTimer = null;
			}
			await flushGatewayState();
			for (const record of pendingExecApprovals.values()) {
				clearTimeout(record.timeout);
				record.resolveDecision(null);
			}
			pendingExecApprovals.clear();
			resolvedExecApprovals.clear();
			await mcpRuntime.close().catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				console.warn(`[mcp] failed to close MCP runtime: ${message}`);
			});
			if (memoryProvider) {
				await memoryProvider.close().catch(() => {});
			}
			await pluginRuntime.onGatewayStop({
				host,
				port,
				webPort,
			});
			configReloader.stop();
		},
	});
	lifecycle.install();

	// Wait forever (lifecycle manager handles signals)
	await new Promise<void>(() => {});
}
