/**
 * Interactive terminal chat.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
	ConfigManager,
	createUnderstudySession,
	normalizeAssistantDisplayText,
	resolveUnderstudyPackageVersion,
} from "@understudy/core";
import {
	ConfigReloader,
	normalizeAssistantRenderableText,
} from "@understudy/gateway";
import { InteractiveMode, SessionManager } from "@mariozechner/pi-coding-agent";
import { createMemoryProvider, ScheduleService } from "@understudy/tools";
import type { Model } from "@mariozechner/pi-ai";
import type { UnderstudyConfig } from "@understudy/types";
import { mergeCliPromptText, prepareCliPromptInput } from "./cli-prompt-input.js";
import { resolveMemoryDbPath } from "./gateway-support.js";
import { applyUnderstudyBranding } from "./chat-branding.js";
import { resolveConfiguredBrowserOptions } from "./browser-extension.js";
import { createBrowserExtensionRelayController } from "./browser-extension-relay-controller.js";
import { installInteractiveBrowserExtensionSupport } from "./chat-interactive-browser-extension.js";
import { installInteractiveChatMediaSupport } from "./chat-interactive-media.js";
import { installInteractiveTeachSupport } from "./chat-interactive-teach.js";
import { CLI_MODEL_FORMAT_ERROR, parseThinkingLevel, resolveCliModel } from "./model-support.js";
import { createConfiguredRuntimeToolset } from "./runtime-tooling.js";

interface ChatOptions {
	model?: string;
	thinking?: string;
	cwd?: string;
	message?: string;
	file?: string[];
	image?: string[];
	config?: string;
	continue?: boolean;
}

interface InteractiveChatRuntime {
	tools: any[];
	relayController: ReturnType<typeof createBrowserExtensionRelayController>;
	attachSession(session: { runScheduledJob?: (text: string) => Promise<void> | void }): void;
	close(): Promise<void>;
}

function buildScheduledJobExecutionPrompt(command: string): string {
	return [
		"A scheduled job is firing now.",
		"Execute the scheduled instruction immediately.",
		"Do not acknowledge the task, mention scheduling, or say you will do it later.",
		"Return only the final user-visible content that should be delivered now.",
		"",
		"Scheduled instruction:",
		command,
	].join("\n");
}

function cloneSessionMessages(session: {
	messages?: unknown[];
	agent?: { state?: { messages?: unknown[] }; replaceMessages?: (messages: unknown[]) => void };
}): unknown[] {
	const messages = Array.isArray(session.messages)
		? session.messages
		: Array.isArray(session.agent?.state?.messages)
			? session.agent?.state?.messages
			: [];
	if (!Array.isArray(messages) || messages.length === 0) {
		return [];
	}
	if (typeof structuredClone === "function") {
		return structuredClone(messages);
	}
	return JSON.parse(JSON.stringify(messages)) as unknown[];
}

function extractAssistantReplyText(message: unknown): string {
	if (!message || typeof message !== "object") {
		return "";
	}
	const record = message as {
		content?: unknown;
	};
	if (typeof record.content === "string") {
		return record.content;
	}
	if (!Array.isArray(record.content)) {
		return "";
	}
	return record.content
		.filter((part): part is { type?: unknown; text?: unknown } => Boolean(part && typeof part === "object"))
		.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text as string)
		.join("");
}

const UNDERSTUDY_CLI_VERSION = resolveCliVersion();

function isTruthyEnvValue(value: string | undefined): boolean {
	return typeof value === "string" && /^(1|true|yes|on)$/i.test(value.trim());
}

function commandExists(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
	try {
		const result = spawnSync(command, ["--version"], { stdio: "ignore", env });
		return !result.error;
	} catch {
		return false;
	}
}

export function shouldDisableManagedTuiToolDownloads(env: NodeJS.ProcessEnv = process.env): boolean {
	if (isTruthyEnvValue(env.UNDERSTUDY_TUI_ALLOW_TOOL_DOWNLOADS)) {
		return false;
	}
	return !commandExists("fd", env);
}

export function applyManagedTuiToolDownloadPolicy(
	env: NodeJS.ProcessEnv = process.env,
	log: (message: string) => void = console.log,
): () => void {
	if (isTruthyEnvValue(env.PI_OFFLINE) || !shouldDisableManagedTuiToolDownloads(env)) {
		return () => {};
	}
	const previous = env.PI_OFFLINE;
	env.PI_OFFLINE = "1";
	log(
		"fd is not installed locally. Starting TUI without managed binary downloads; install `fd` or set UNDERSTUDY_TUI_ALLOW_TOOL_DOWNLOADS=1 to enable automatic downloads and full path autocomplete.",
	);
	return () => {
		if (previous === undefined) {
			delete env.PI_OFFLINE;
			return;
		}
		env.PI_OFFLINE = previous;
	};
}

function normalizeGatewayUrl(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	return trimmed.replace(/\/$/, "");
}

async function probeGatewayHealth(gatewayUrl: string): Promise<boolean> {
	try {
		const signal =
			typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
				? AbortSignal.timeout(600)
				: undefined;
		const response = await fetch(`${gatewayUrl}/health`, { signal });
		return response.ok;
	} catch {
		return false;
	}
}

async function resolveInteractiveGatewayUrl(config: UnderstudyConfig): Promise<string | undefined> {
	if (config.gateway?.auth?.mode === "password") {
		return undefined;
	}
	const explicitUrl = normalizeGatewayUrl(process.env.UNDERSTUDY_GATEWAY_URL);
	if (explicitUrl) {
		return await probeGatewayHealth(explicitUrl) ? explicitUrl : undefined;
	}
	const host = process.env.UNDERSTUDY_GATEWAY_HOST?.trim() || config.gateway?.host || "127.0.0.1";
	const port = process.env.UNDERSTUDY_GATEWAY_PORT?.trim() || String(config.gateway?.port ?? 23333);
	const candidate = normalizeGatewayUrl(`http://${host}:${port}`);
	return candidate && await probeGatewayHealth(candidate) ? candidate : undefined;
}

async function createInteractiveChatRuntime(params: {
	cwd: string;
	config: UnderstudyConfig;
	configManager: ConfigManager;
	model?: Model<any>;
}): Promise<InteractiveChatRuntime> {
	const relayController = createBrowserExtensionRelayController();
	const configReloader = new ConfigReloader({
		configPath: params.configManager.getPath(),
		currentConfig: params.configManager.get(),
		handler: (newConfig) => {
			params.configManager.update(newConfig);
			params.config.browser = newConfig.browser;
			void relayController.ensureForConfig(newConfig).catch(() => {});
		},
	});
	configReloader.start();
	await relayController.ensureForConfig(params.config).catch(() => {});

	const memoryProvider = params.config.memory.enabled
		? await createMemoryProvider({
			dbPath: resolveMemoryDbPath(params.config),
		})
		: null;
	const gatewayUrl = await resolveInteractiveGatewayUrl(params.config);
	let activeSession:
		| { runScheduledJob?: (text: string) => Promise<void> | void }
		| undefined;
	let resolveActiveSessionReady: (() => void) | undefined;
	const activeSessionReady = new Promise<void>((resolve) => {
		resolveActiveSessionReady = resolve;
	});
	const scheduleTempDir = await mkdtemp(join(tmpdir(), "understudy-tui-schedule-"));
	const scheduleService = new ScheduleService({
		storePath: join(scheduleTempDir, "jobs.json"),
		onJobTrigger: async (job) => {
			await activeSessionReady;
			if (!activeSession?.runScheduledJob) {
				return;
			}
			await activeSession.runScheduledJob(job.command);
		},
	});
	await scheduleService.start();
	const gatewayToken = process.env.UNDERSTUDY_GATEWAY_TOKEN?.trim()
		|| params.config.gateway?.auth?.token?.trim();
	if (gatewayUrl && gatewayToken && !process.env.UNDERSTUDY_GATEWAY_TOKEN) {
		process.env.UNDERSTUDY_GATEWAY_TOKEN = gatewayToken;
	}
	return {
		tools: await createConfiguredRuntimeToolset({
			cwd: params.cwd,
			config: params.config,
			explicitModel: params.model,
			browserOptions: () => resolveConfiguredBrowserOptions(params.configManager.get()),
			memoryProvider: memoryProvider ?? undefined,
			scheduleService,
			channel: "tui",
			gatewayUrl,
		}),
		relayController,
		attachSession: (session) => {
			activeSession = session;
			resolveActiveSessionReady?.();
			resolveActiveSessionReady = undefined;
		},
		close: async () => {
			configReloader.stop();
			scheduleService.stop();
			await relayController.stop();
			await memoryProvider?.close().catch(() => {});
			await rm(scheduleTempDir, { recursive: true, force: true }).catch(() => {});
		},
	};
}

export function resolveCliVersion(startDir?: string): string | undefined {
	return resolveUnderstudyPackageVersion(startDir);
}

async function runInteractiveTuiChat(opts: ChatOptions, promptInput: Awaited<ReturnType<typeof prepareCliPromptInput>>): Promise<void> {
	process.title = "understudy-cli";
	const cwd = resolve(opts.cwd ?? process.cwd());

	let model: Model<any> | undefined;
	if (opts.model) {
		try {
			model = resolveCliModel(opts.model);
			if (!model) {
				throw new Error("missing model");
			}
		} catch {
			console.error(`Unknown model: ${opts.model}`);
			console.error(CLI_MODEL_FORMAT_ERROR);
			process.exit(1);
			return;
		}
	}

	const thinkingLevel = parseThinkingLevel(opts.thinking);
	const configManager = await ConfigManager.load(opts.config);
	const config = configManager.get();
	const toolRuntime = await createInteractiveChatRuntime({
		cwd,
		config,
		configManager,
		model,
	});

	let sessionManager: SessionManager | undefined;
	if (opts.continue) {
		sessionManager = SessionManager.continueRecent(cwd);
		console.log(`Using session: ${sessionManager.getSessionId()}`);
	}

	const initialMessageRaw = mergeCliPromptText(opts.message, promptInput);
	const initialMessage = initialMessageRaw.trim().length > 0 ? initialMessageRaw : undefined;
	const createdSession = await createUnderstudySession({
		config,
		configPath: configManager.getPath(),
		cwd,
		channel: "tui",
		model,
		thinkingLevel,
		extraTools: toolRuntime.tools,
		sessionManager,
	} as any);
	const session = createdSession.session as {
		sendCustomMessage?: (
			message: {
				customType: string;
				content: string;
				display: boolean;
				details?: Record<string, unknown>;
			},
			options?: { triggerTurn?: boolean },
		) => Promise<void>;
		agent?: {
			state?: { messages?: unknown[] };
			replaceMessages?: (messages: unknown[]) => void;
		};
		messages?: unknown[];
	};

	const restoreManagedToolDownloadPolicy = applyManagedTuiToolDownloadPolicy();
	let interactive: InteractiveMode | undefined;

	try {
		interactive = new InteractiveMode(session as any, {
			modelFallbackMessage: undefined,
			initialMessage,
			initialImages: promptInput.images,
		});
		applyUnderstudyBranding(interactive as any, { cliVersion: UNDERSTUDY_CLI_VERSION });
		await installInteractiveChatMediaSupport({
			interactive: interactive as any,
			session: session as any,
			cwd,
		});
		await installInteractiveBrowserExtensionSupport({
			interactive: interactive as any,
			configManager,
			configPath: opts.config,
			config,
			relayController: toolRuntime.relayController,
		});
		await installInteractiveTeachSupport({
			interactive: interactive as any,
			cwd,
			configPath: opts.config,
		});
			toolRuntime.attachSession({
				runScheduledJob: async (command) => {
					let assistantReply:
						| {
							text: string;
						}
						| undefined;
					const scheduledTurn = await createUnderstudySession({
						config,
						configPath: configManager.getPath(),
						cwd,
						channel: "tui",
						model,
						thinkingLevel,
						extraTools: toolRuntime.tools,
						sessionManager: SessionManager.inMemory(cwd),
						lifecycleHooks: {
							onAssistantReply: async ({ message }: { message: unknown }) => {
								assistantReply = {
									text: extractAssistantReplyText(message),
								};
							},
						},
					} as any);
				try {
					const scheduledSession = scheduledTurn.session as {
						prompt: (text: string, options?: Record<string, unknown>) => Promise<void>;
						agent?: {
							state?: { messages?: unknown[] };
							replaceMessages?: (messages: unknown[]) => void;
						};
					};
					const history = cloneSessionMessages(session);
					if (history.length > 0) {
						if (typeof scheduledSession.agent?.replaceMessages === "function") {
							scheduledSession.agent.replaceMessages(history);
						} else if (scheduledSession.agent?.state) {
							scheduledSession.agent.state.messages = history;
						}
					}
					await scheduledSession.prompt(buildScheduledJobExecutionPrompt(command));
				} finally {
					await scheduledTurn.runtimeSession?.close?.();
				}
				const visibleText = normalizeAssistantDisplayText(
					normalizeAssistantRenderableText(assistantReply?.text),
				).text.trim();
				if (!visibleText) {
					return;
				}
				await session.sendCustomMessage?.({
					customType: "understudy-schedule",
					content: visibleText,
					display: true,
					details: {
						source: "schedule",
						command,
					},
				}, { triggerTurn: false });
			},
		});
		await interactive.run();
	} finally {
		restoreManagedToolDownloadPolicy();
		await toolRuntime.close();
	}
}

export async function runChatCommand(opts: ChatOptions = {}): Promise<void> {
	let promptInput: Awaited<ReturnType<typeof prepareCliPromptInput>>;
	try {
		promptInput = await prepareCliPromptInput({
			cwd: resolve(opts.cwd ?? process.cwd()),
			files: opts.file,
			images: opts.image,
		});
	} catch (error) {
		console.error("Error:", error instanceof Error ? error.message : String(error));
		process.exit(1);
		return;
	}

	await runInteractiveTuiChat(opts, promptInput);
}
