import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConfigManager } from "../config.js";
import { DEFAULT_CONFIG } from "@understudy/types";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateUnderstudyConfig } from "../config-schema.js";
import { resolveWorkspaceContext } from "../workspace-context.js";

describe("ConfigManager", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("creates in-memory config with defaults", () => {
		const cm = ConfigManager.inMemory();
		const config = cm.get();

		expect(config.defaultProvider).toBe(DEFAULT_CONFIG.defaultProvider);
		expect(config.defaultModel).toBe(DEFAULT_CONFIG.defaultModel);
		expect(config.tools.autoApproveReadOnly).toBe(true);
		expect(config.memory.enabled).toBe(false);
		expect(config.agent.guiGroundingThinkingLevel).toBe("medium");
		expect(config.agent.runtimePolicies?.enabled).toBe(true);
		expect(config.agent.runtimePolicies?.modules?.map((module) => module.name)).toEqual([
			"sanitize_tool_params",
			"normalize_tool_result",
			"strip_assistant_directive_tags",
			"guard_assistant_reply",
		]);
		expect(config.agent.runtimePolicies?.modules?.every((module) => module.enabled !== false)).toBe(true);
	});

	it("merges overrides with defaults", () => {
		const cm = ConfigManager.inMemory({
			defaultProvider: "openai",
			memory: { enabled: true },
		});
		const config = cm.get();

		expect(config.defaultProvider).toBe("openai");
		expect(config.defaultModel).toBe(DEFAULT_CONFIG.defaultModel);
		expect(config.memory.enabled).toBe(true);
	});

	it("preserves typed agent profile and session defaults", () => {
		const cm = ConfigManager.inMemory({
			agents: {
				list: [{ id: "ops", name: "Ops", workspace: "/tmp/ops" }],
				defaults: { skipBootstrap: true },
			},
			session: {
				mainKey: "agent:main:main",
				scope: "per-sender",
			},
		});
		const config = cm.get();

		expect(config.agents?.list).toEqual([
			{ id: "ops", name: "Ops", workspace: "/tmp/ops" },
		]);
		expect(config.agents?.defaults?.skipBootstrap).toBe(true);
		expect(config.session).toEqual({
			mainKey: "agent:main:main",
			scope: "per-sender",
		});
	});

	it("preserves agent mcpConfigPath during validation", () => {
		const config = validateUnderstudyConfig({
			...DEFAULT_CONFIG,
			agent: {
				...DEFAULT_CONFIG.agent,
				mcpConfigPath: "/tmp/understudy-mcp.json",
			},
		});

		expect(config.agent.mcpConfigPath).toBe("/tmp/understudy-mcp.json");
	});

	it("applies environment variable overrides", async () => {
		process.env.UNDERSTUDY_DEFAULT_PROVIDER = "google";
		process.env.UNDERSTUDY_DEFAULT_MODEL = "gemini-2.0-flash";
		process.env.UNDERSTUDY_MODEL_FALLBACKS = "google/gemini-3-flash-preview,anthropic/claude-sonnet-4-6";
		process.env.UNDERSTUDY_THINKING_LEVEL = "medium";
		process.env.UNDERSTUDY_GUI_GROUNDING_THINKING_LEVEL = "high";
		process.env.UNDERSTUDY_RUNTIME_PROFILE = "headless";
		process.env.UNDERSTUDY_RUNTIME_BACKEND = "acp";
		process.env.UNDERSTUDY_ACP_ENABLED = "true";
		process.env.UNDERSTUDY_ACP_BACKEND = "command";
		process.env.UNDERSTUDY_ACP_COMMAND = "node";
		process.env.UNDERSTUDY_ACP_ARGS = "[\"bridge.mjs\",\"--json\"]";
		process.env.UNDERSTUDY_ACP_OUTPUT_FORMAT = "jsonl";
		process.env.UNDERSTUDY_SANDBOX_MODE = "strict";
		process.env.UNDERSTUDY_RUNTIME_POLICIES_ENABLED = "false";
		process.env.UNDERSTUDY_RUNTIME_POLICY_MODULES = "sanitize_tool_params,guard_assistant_reply";
		process.env.UNDERSTUDY_BROWSER_CONNECTION_MODE = "extension";
		process.env.UNDERSTUDY_BROWSER_CDP_URL = "http://127.0.0.1:29999";
		process.env.UNDERSTUDY_BROWSER_EXTENSION_INSTALL_DIR = "/tmp/understudy-extension";
		process.env.UNDERSTUDY_GATEWAY_SESSION_SCOPE = "channel_sender";
		process.env.UNDERSTUDY_GATEWAY_DM_SCOPE = "thread";
		process.env.UNDERSTUDY_GATEWAY_IDLE_RESET_MINUTES = "90";
		process.env.UNDERSTUDY_GATEWAY_DAILY_RESET = "false";
		process.env.UNDERSTUDY_GATEWAY_AUTH_MODE = "token";
		process.env.UNDERSTUDY_GATEWAY_TOKEN = "token-123";
		process.env.UNDERSTUDY_GATEWAY_CHANNEL_AUTORESTART = "false";
		process.env.UNDERSTUDY_GATEWAY_CHANNEL_RESTART_BASE_MS = "2000";
		process.env.UNDERSTUDY_GATEWAY_CHANNEL_RESTART_MAX_MS = "15000";
		process.env.UNDERSTUDY_PLUGINS_ENABLED = "true";
		process.env.UNDERSTUDY_PLUGIN_MODULES = "local-analytics,@understudy/example-plugin";

		// Load from a non-existent path to use defaults + env
		const cm = await ConfigManager.load("/tmp/nonexistent-understudy-config.json5");
		const config = cm.get();

		expect(config.defaultProvider).toBe("google");
		expect(config.defaultModel).toBe("gemini-2.0-flash");
		expect(config.defaultThinkingLevel).toBe("medium");
		expect(config.agent.guiGroundingThinkingLevel).toBe("high");
		expect(config.agent.modelFallbacks).toEqual([
			"google/gemini-3-flash-preview",
			"anthropic/claude-sonnet-4-6",
		]);
		expect(config.agent.runtimeProfile).toBe("headless");
		expect(config.agent.runtimeBackend).toBe("acp");
		expect(config.agent.acp).toEqual({
			enabled: true,
			backend: "command",
			command: "node",
			args: ["bridge.mjs", "--json"],
			outputFormat: "jsonl",
		});
		expect(config.agent.sandbox?.mode).toBe("strict");
		expect(config.agent.runtimePolicies?.enabled).toBe(false);
		expect(config.agent.runtimePolicies?.modules?.map((module) => module.name)).toEqual([
			"sanitize_tool_params",
			"guard_assistant_reply",
		]);
		expect(config.browser).toEqual({
			connectionMode: "extension",
			cdpUrl: "http://127.0.0.1:29999",
			extension: {
				installDir: "/tmp/understudy-extension",
			},
		});
		expect(config.gateway?.sessionScope).toBe("channel_sender");
		expect(config.gateway?.dmScope).toBe("thread");
		expect(config.gateway?.idleResetMinutes).toBe(90);
		expect(config.gateway?.dailyReset).toBe(false);
		expect(config.gateway?.auth).toEqual({
			mode: "token",
			token: "token-123",
		});
		expect(config.gateway?.channelAutoRestart).toBe(false);
		expect(config.gateway?.channelRestartBaseDelayMs).toBe(2000);
		expect(config.gateway?.channelRestartMaxDelayMs).toBe(15000);
		expect(config.plugins).toEqual({
			enabled: true,
			modules: ["local-analytics", "@understudy/example-plugin"],
		});
	});

	it("loads .env from config directory", async () => {
		delete process.env.UNDERSTUDY_DEFAULT_PROVIDER;
		delete process.env.UNDERSTUDY_DEFAULT_MODEL;
		const dir = await mkdtemp(join(tmpdir(), "understudy-config-env-"));
		await writeFile(
			join(dir, ".env"),
			"UNDERSTUDY_DEFAULT_PROVIDER=google\nUNDERSTUDY_DEFAULT_MODEL=gemini-3-flash-preview\n",
			"utf8",
		);

		const cm = await ConfigManager.load(join(dir, "config.json5"));
		const config = cm.get();
		expect(config.defaultProvider).toBe("google");
		expect(config.defaultModel).toBe("gemini-3-flash-preview");
	});

	it("rejects invalid config via schema validation", async () => {
		const dir = await mkdtemp(join(tmpdir(), "understudy-config-invalid-"));
		const file = join(dir, "config.json5");
		await writeFile(
			file,
			"{ defaultProvider: 123, defaultModel: 'ok', defaultThinkingLevel: 'off', agent: {}, channels: {}, tools: { policies: [], autoApproveReadOnly: true }, memory: { enabled: false } }",
			"utf8",
		);
		await expect(ConfigManager.load(file)).rejects.toThrow(/Config validation failed/);
	});

	it("accepts explicit gateway control UI config", () => {
		const config = validateUnderstudyConfig({
			...DEFAULT_CONFIG,
			gateway: {
				...DEFAULT_CONFIG.gateway!,
				controlUi: {
					enabled: true,
					basePath: "/dashboard",
					assistantName: "Ops Console",
					allowedOrigins: ["https://example.com"],
				},
			},
		});

		expect(config.gateway?.controlUi).toEqual({
			enabled: true,
			basePath: "/dashboard",
			assistantName: "Ops Console",
			allowedOrigins: ["https://example.com"],
		});
	});

	it("rejects typoed keys inside strict leaf config sections", async () => {
		const dir = await mkdtemp(join(tmpdir(), "understudy-config-leaf-typo-"));
		const file = join(dir, "config.json5");
		await writeFile(
			file,
			`{
				defaultProvider: "anthropic",
				defaultModel: "claude-sonnet-4-6",
				defaultThinkingLevel: "off",
				agent: {},
				channels: {},
				tools: { policies: [], autoApproveReadOnly: true },
				memory: { enabled: false },
				gateway: {
					port: 23333,
					host: "127.0.0.1",
					enableWebSocket: true,
					auth: { mode: "token", tokn: "bad-key" }
				}
			}`,
			"utf8",
		);

		await expect(ConfigManager.load(file)).rejects.toThrow(/gateway\.auth/);
	});

	it("updates config", () => {
		const cm = ConfigManager.inMemory();
		cm.update({ defaultProvider: "openai" });

		expect(cm.get().defaultProvider).toBe("openai");
	});

	it("rejects stale keys during validation and update", () => {
		expect(() => validateUnderstudyConfig({
			...DEFAULT_CONFIG,
			legacyTopLevel: true,
			agent: {
				...DEFAULT_CONFIG.agent,
				legacyAgentKey: "remove-me",
			},
		} as any)).toThrow(/unrecognized key/i);

		const cm = ConfigManager.inMemory();
		expect(() => cm.update({
			agent: {
				...(cm.get().agent as Record<string, unknown>),
				legacyAgentKey: "remove-me",
			} as any,
		})).toThrow(/unrecognized key/i);
	});

	it("in-memory save is a no-op", () => {
		const cm = ConfigManager.inMemory();
		expect(() => cm.save()).not.toThrow();
	});
});

describe("resolveWorkspaceContext", () => {
	it("ignores an unrelated configured repo root when the caller binds the run to another workspace", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "understudy-workspace-context-"));
		const requestedWorkspaceDir = join(rootDir, "requested-workspace");
		const configuredRepoRoot = join(rootDir, "configured-repo");
		await mkdir(requestedWorkspaceDir, { recursive: true });
		await mkdir(configuredRepoRoot, { recursive: true });

		const result = resolveWorkspaceContext({
			requestedWorkspaceDir,
			configuredWorkspaceDir: join(rootDir, "default-workspace"),
			configuredRepoRoot,
		});

		expect(result.workspaceDir).toBe(requestedWorkspaceDir);
		expect(result.repoRoot).toBeUndefined();
		expect(result.validationRoot).toBe(requestedWorkspaceDir);
	});

	it("keeps a configured repo root when the workspace remains inside that repository", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "understudy-workspace-context-"));
		const configuredRepoRoot = join(rootDir, "repo-root");
		const requestedWorkspaceDir = join(configuredRepoRoot, "packages", "app");
		await mkdir(requestedWorkspaceDir, { recursive: true });

		const result = resolveWorkspaceContext({
			requestedWorkspaceDir,
			configuredRepoRoot,
		});

		expect(result.workspaceDir).toBe(requestedWorkspaceDir);
		expect(result.repoRoot).toBe(configuredRepoRoot);
		expect(result.validationRoot).toBe(configuredRepoRoot);
	});
});
