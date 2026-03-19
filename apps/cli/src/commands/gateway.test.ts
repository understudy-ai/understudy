import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
	UnderstudyPluginRegistry,
	type UnderstudyPluginHookEvent,
	type UnderstudyPluginLogger,
	type UnderstudyPluginServiceContext,
} from "@understudy/plugins";
import { DEFAULT_CONFIG, type UnderstudyConfig } from "@understudy/types";
import {
	buildChannelsFromConfig,
	deliverScheduledJobResult,
	ensureGatewayWorkspaceReady,
	resolveGatewayWorkspaceDir,
	resolveMemoryDbPath,
} from "./gateway.js";
import { createGatewayPluginRuntime } from "./gateway-plugin-runtime.js";
import { extractLatestAssistantUsage } from "./gateway-usage.js";

const originalUnderstudyHome = process.env.UNDERSTUDY_HOME;
const tempDirs: string[] = [];

function createConfig(overrides: Partial<UnderstudyConfig> = {}): UnderstudyConfig {
	return {
		...DEFAULT_CONFIG,
		...overrides,
		agent: {
			...DEFAULT_CONFIG.agent,
			...overrides.agent,
		},
		channels: {
			...overrides.channels,
		},
		tools: {
			...DEFAULT_CONFIG.tools,
			...overrides.tools,
		},
		memory: {
			...DEFAULT_CONFIG.memory,
			...overrides.memory,
		},
	};
}

afterEach(() => {
	delete process.env.TELEGRAM_BOT_TOKEN;
	delete process.env.DISCORD_BOT_TOKEN;
	delete process.env.SLACK_BOT_TOKEN;
	delete process.env.SLACK_SIGNING_SECRET;
	delete process.env.SLACK_APP_TOKEN;
	delete process.env.SIGNAL_SENDER;
	delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
	if (originalUnderstudyHome === undefined) {
		delete process.env.UNDERSTUDY_HOME;
	} else {
		process.env.UNDERSTUDY_HOME = originalUnderstudyHome;
	}
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("buildChannelsFromConfig", () => {
	it("includes explicitly enabled configured channels", () => {
		const config = createConfig({
			channels: {
				web: { enabled: true, settings: {} },
				telegram: { enabled: true, settings: { botToken: "tg-token", allowedChatIds: ["1001"] } },
				discord: { enabled: true, settings: { botToken: "dc-token", allowedGuildIds: ["g-1"] } },
				slack: {
					enabled: true,
					settings: { botToken: "sl-token", signingSecret: "sign-secret", appToken: "app-token" },
				},
				whatsapp: { enabled: true, settings: { allowedNumbers: ["+8613800138000"] } },
			},
		});

		const { channels, warnings } = buildChannelsFromConfig({
			channels: config.channels ?? {},
			host: "127.0.0.1",
			webPort: 18888,
		});
		const ids = channels.map((channel) => channel.id).sort();

		expect(ids).toEqual(["discord", "slack", "telegram", "web", "whatsapp"]);
		expect(warnings).toHaveLength(0);
	});

	it("uses environment fallback credentials when settings are missing", () => {
		process.env.TELEGRAM_BOT_TOKEN = "env-telegram";
		process.env.DISCORD_BOT_TOKEN = "env-discord";
		process.env.SLACK_BOT_TOKEN = "env-slack";
		process.env.SLACK_SIGNING_SECRET = "env-signing";

		const config = createConfig({
			channels: {
				telegram: { enabled: true, settings: {} },
				discord: { enabled: true, settings: {} },
				slack: { enabled: true, settings: {} },
			},
		});

		const { channels, warnings } = buildChannelsFromConfig({
			channels: config.channels ?? {},
			host: "127.0.0.1",
			webPort: 18889,
		});
		const ids = channels.map((channel) => channel.id).sort();

		expect(ids).toEqual(["discord", "slack", "telegram"]);
		expect(warnings).toHaveLength(0);
	});

	it("warns and skips channels with missing credentials or unknown ids", () => {
		const config = createConfig({
			channels: {
				telegram: { enabled: true, settings: {} },
				slack: { enabled: true, settings: { botToken: "only-bot" } },
				custom_channel: { enabled: true, settings: {} },
			},
		});

		const { channels, warnings } = buildChannelsFromConfig({
			channels: config.channels ?? {},
			host: "127.0.0.1",
			webPort: 18890,
		});
		const ids = channels.map((channel) => channel.id);

		expect(ids).toEqual([]);
		expect(warnings.some((line) => line.includes("telegram"))).toBe(true);
		expect(warnings.some((line) => line.includes("slack"))).toBe(true);
		expect(warnings.some((line) => line.includes("custom_channel"))).toBe(true);
	});

	it("supports signal/line channel factories and platform-guards imessage", () => {
		process.env.SIGNAL_SENDER = "+15550001111";
		process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-token";

		const config = createConfig({
			channels: {
				signal: { enabled: true, settings: {} },
				line: { enabled: true, settings: {} },
				imessage: { enabled: true, settings: {} },
			},
		});

		const { channels, warnings } = buildChannelsFromConfig({
			channels: config.channels ?? {},
			host: "127.0.0.1",
			webPort: 18891,
		});
		const ids = channels.map((channel) => channel.id).sort();
		expect(ids).toContain("signal");
		expect(ids).toContain("line");
		if (process.platform === "darwin") {
			expect(ids).toContain("imessage");
		} else {
			expect(ids).not.toContain("imessage");
			expect(warnings.some((line) => line.includes("imessage"))).toBe(true);
		}
	});

	it("does not accept legacy channel setting aliases", () => {
		const config = createConfig({
			channels: {
				telegram: { enabled: true, settings: { token: "legacy-telegram-token" } as any },
				signal: {
					enabled: true,
					settings: {
						senderId: "+15550001111",
						binaryPath: "/usr/local/bin/signal-cli",
					} as any,
				},
				line: { enabled: true, settings: { token: "legacy-line-token" } as any },
			},
		});

		const { channels, warnings } = buildChannelsFromConfig({
			channels: config.channels ?? {},
			host: "127.0.0.1",
			webPort: 18892,
		});

		expect(channels).toEqual([]);
		expect(warnings.some((line) => line.includes("telegram"))).toBe(true);
		expect(warnings.some((line) => line.includes("signal"))).toBe(true);
		expect(warnings.some((line) => line.includes("line"))).toBe(true);
	});
});

describe("resolveMemoryDbPath", () => {
	it("defaults to ~/.understudy/memory.db", () => {
		delete process.env.UNDERSTUDY_HOME;
		const config = createConfig();
		expect(resolveMemoryDbPath(config)).toBe(join(homedir(), ".understudy", "memory.db"));
	});

	it("supports ~/ path expansion from config", () => {
		const config = createConfig({
			memory: {
				enabled: true,
				dbPath: "~/tmp/understudy-memory.db",
			},
		});
		expect(resolveMemoryDbPath(config)).toBe(join(homedir(), "tmp", "understudy-memory.db"));
	});

	it("uses UNDERSTUDY_HOME for default memory path", () => {
		process.env.UNDERSTUDY_HOME = "/tmp/understudy-home";
		const config = createConfig();
		expect(resolveMemoryDbPath(config)).toBe("/tmp/understudy-home/memory.db");
	});
});

describe("resolveGatewayWorkspaceDir", () => {
	it("prefers configured agent.cwd over process cwd", () => {
		const config = createConfig({
			agent: {
				cwd: "~/projects/target-repo",
			},
		});
		expect(resolveGatewayWorkspaceDir(config)).toBe(join(homedir(), "projects", "target-repo"));
	});

	it("uses the configured main agent workspace when agent.cwd is unset", () => {
		const config = createConfig({
			agent: {
				cwd: undefined,
			},
			agents: {
				list: [{ id: "main", workspace: "/tmp/custom-main-workspace" }],
			},
		});
		expect(resolveGatewayWorkspaceDir(config)).toBe("/tmp/custom-main-workspace");
	});

	it("falls back to the default main agent workspace when agent.cwd is unset", () => {
		process.env.UNDERSTUDY_HOME = "/tmp/understudy-home";
		const config = createConfig({
			agent: {
				cwd: undefined,
			},
		});
		expect(resolveGatewayWorkspaceDir(config)).toBe("/tmp/understudy-home/agents/main/workspace");
	});

	it("creates the resolved workspace directory before web sessions use it", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "understudy-gateway-home-"));
		process.env.UNDERSTUDY_HOME = homeDir;
		const config = createConfig({
			agent: {
				cwd: undefined,
			},
		});
		const workspaceDir = resolveGatewayWorkspaceDir(config);
		expect(existsSync(workspaceDir)).toBe(false);
		await ensureGatewayWorkspaceReady(workspaceDir);
		expect(existsSync(workspaceDir)).toBe(true);
		rmSync(homeDir, { recursive: true, force: true });
	});
});

describe("extractLatestAssistantUsage", () => {
	it("returns undefined when assistant messages do not carry usage", () => {
		expect(extractLatestAssistantUsage([
			{ role: "user", content: [{ type: "text", text: "hi" }] },
			{ role: "assistant", content: [{ type: "text", text: "hello" }] },
		])).toBeUndefined();
	});

	it("returns the latest non-empty assistant usage record", () => {
		expect(extractLatestAssistantUsage([
			{ role: "assistant", usage: {} },
			{ role: "assistant", usage: { input: 12, output: 4 } },
		])).toEqual({ input: 12, output: 4 });
	});
});

describe("deliverScheduledJobResult", () => {
	it("sends normalized scheduled replies back through the target channel", async () => {
		const sendMessage = vi.fn().mockResolvedValue("scheduled_1");
		const result = await deliverScheduledJobResult({
			channel: {
				id: "telegram",
				name: "telegram",
				capabilities: {
					streaming: false,
					threads: true,
					reactions: true,
					attachments: true,
					groups: true,
				},
				messaging: {
					sendMessage,
					onMessage: () => () => {},
				},
				start: async () => {},
				stop: async () => {},
			},
			channelId: "telegram",
			recipientId: "u123",
			threadId: "job_1",
			result: {
				response: "现在 19:53 了，我来叫你。",
				images: [
					{
						type: "image",
						mimeType: "image/png",
						data: "c2NyZWVuc2hvdA==",
					},
				],
			},
		});

		expect(result).toBe("scheduled_1");
		expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
			channelId: "telegram",
			recipientId: "u123",
			threadId: "job_1",
			text: "现在 19:53 了，我来叫你。",
			attachments: [
				expect.objectContaining({
					type: "image",
					url: "data:image/png;base64,c2NyZWVuc2hvdA==",
				}),
			],
		}));
	});

	it("skips delivery when the scheduled run produced no renderable output", async () => {
		const sendMessage = vi.fn();
		const result = await deliverScheduledJobResult({
			channel: {
				id: "telegram",
				name: "telegram",
				capabilities: {
					streaming: false,
					threads: true,
					reactions: true,
					attachments: true,
					groups: true,
				},
				messaging: {
					sendMessage,
					onMessage: () => () => {},
				},
				start: async () => {},
				stop: async () => {},
			},
			channelId: "telegram",
			recipientId: "u123",
			result: {
				response: "",
			},
		});

		expect(result).toBeUndefined();
		expect(sendMessage).not.toHaveBeenCalled();
	});

	it("does not fail web schedule delivery when the browser client is offline", async () => {
		const sendMessage = vi.fn().mockRejectedValue(new Error("Web recipient is offline: browser_client_1"));
		const result = await deliverScheduledJobResult({
			channel: {
				id: "web",
				name: "web",
				capabilities: {
					streaming: true,
					threads: false,
					reactions: false,
					attachments: true,
					groups: false,
				},
				messaging: {
					sendMessage,
					onMessage: () => () => {},
				},
				start: async () => {},
				stop: async () => {},
			},
			channelId: "web",
			recipientId: "browser_client_1",
			result: {
				response: "Reminder fired.",
			},
		});

		expect(result).toBeUndefined();
		expect(sendMessage).toHaveBeenCalledOnce();
	});
});

describe("createGatewayPluginRuntime", () => {
	it("runs plugin services and gateway hooks with gateway lifecycle context", async () => {
		const stateRoot = mkdtempSync(join(tmpdir(), "understudy-gateway-plugin-runtime-"));
		tempDirs.push(stateRoot);

		const events: string[] = [];
		const gatewayUrl = "http://127.0.0.1:23333";
		const details = {
			host: "127.0.0.1",
			port: 23333,
			webPort: 23334,
		};
		const config = createConfig({
			plugins: {
				modules: ["./demo-plugin.mjs"],
			},
		});
		const start = vi.fn(async (context: UnderstudyPluginServiceContext) => {
			events.push("service:start");
			expect(context.config).toBe(config);
			expect(context.gatewayUrl).toBe(gatewayUrl);
			expect(context.cwd).toBe("/tmp/understudy-workspace");
			expect(context.stateDir).toBe(join(stateRoot, "demo-plugin", "demo-service"));
		});
		const stop = vi.fn(async (context: UnderstudyPluginServiceContext) => {
			events.push("service:stop");
			expect(context.gatewayUrl).toBe(gatewayUrl);
			expect(context.stateDir).toBe(join(stateRoot, "demo-plugin", "demo-service"));
		});
		const onGatewayStart = vi.fn(async (event: UnderstudyPluginHookEvent) => {
			events.push("hook:gateway_start");
			expect(event).toMatchObject({
				name: "gateway_start",
				config,
				gatewayUrl,
				details,
			});
		});
		const onGatewayStop = vi.fn(async (event: UnderstudyPluginHookEvent) => {
			events.push("hook:gateway_stop");
			expect(event).toMatchObject({
				name: "gateway_stop",
				config,
				gatewayUrl,
				details,
			});
		});
		const logger: UnderstudyPluginLogger = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
		};
		const registry = new UnderstudyPluginRegistry();
		await registry.register({
			source: "./demo-plugin.mjs",
			module: {
				id: "demo-plugin",
				register(api) {
					api.registerDiagnostic({
						level: "warn",
						message: "demo warning",
					});
					api.registerService({
						id: "demo-service",
						start,
						stop,
					});
					api.registerHook("gateway_start", onGatewayStart);
					api.registerHook("gateway_stop", onGatewayStop);
				},
			},
		});

		const runtime = createGatewayPluginRuntime({
			configManager: {
				get: () => config,
			},
			pluginRegistry: registry,
			gatewayUrl,
			stateRoot,
			cwd: "/tmp/understudy-workspace",
			logger,
		});

		runtime.logDiagnostics();
		expect(logger.warn).toHaveBeenCalledWith("[plugins:demo-plugin] demo warning");

		await runtime.onGatewayStart(details);
		expect(events).toEqual(["service:start", "hook:gateway_start"]);
		expect(existsSync(join(stateRoot, "demo-plugin", "demo-service"))).toBe(true);

		await runtime.onGatewayStop(details);
		expect(events).toEqual([
			"service:start",
			"hook:gateway_start",
			"hook:gateway_stop",
			"service:stop",
		]);
		expect(start).toHaveBeenCalledTimes(1);
		expect(stop).toHaveBeenCalledTimes(1);
	});
});
