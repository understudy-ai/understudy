/**
 * Configuration management for Understudy.
 * Loads from $UNDERSTUDY_HOME/config.json5 (default: ~/.understudy/config.json5)
 * with environment variable overrides.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import JSON5 from "json5";
import dotenv from "dotenv";
import { DEFAULT_CONFIG, type UnderstudyConfig } from "@understudy/types";
import { resolveUnderstudyHomeDir } from "./runtime-paths.js";
import { validateUnderstudyConfig } from "./config-schema.js";

const CONFIG_FILE_NAME = "config.json5";

export class ConfigManager {
	private config: UnderstudyConfig;
	private configPath: string;

	private constructor(config: UnderstudyConfig, configPath: string) {
		this.config = config;
		this.configPath = configPath;
	}

	/** Load config from file with env overrides */
	static async load(configPath?: string): Promise<ConfigManager> {
		const resolvedPath = configPath ?? getDefaultConfigPath();
		loadDotenvFiles(resolvedPath);

		let fileConfig: Partial<UnderstudyConfig> = {};
		if (existsSync(resolvedPath)) {
			const raw = readFileSync(resolvedPath, "utf-8");
			fileConfig = JSON5.parse(raw) as Partial<UnderstudyConfig>;
		}

		const merged = deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, fileConfig as unknown as Record<string, unknown>) as unknown as UnderstudyConfig;
		const withEnv = applyEnvOverrides(merged);
		const validated = validateUnderstudyConfig(withEnv);

		return new ConfigManager(validated, resolvedPath);
	}

	/** Create an in-memory config (for testing) */
	static inMemory(overrides: Partial<UnderstudyConfig> = {}): ConfigManager {
		const config = validateUnderstudyConfig(
			deepMerge(
				DEFAULT_CONFIG as unknown as Record<string, unknown>,
				overrides as unknown as Record<string, unknown>,
			),
		);
		return new ConfigManager(config, ":memory:");
	}

	get(): UnderstudyConfig {
		return this.config;
	}

	getPath(): string {
		return this.configPath;
	}

	/** Save current config to disk */
	save(): void {
		if (this.configPath === ":memory:") return;
		const dir = dirname(this.configPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		writeFileSync(this.configPath, JSON5.stringify(this.config, null, "\t"), "utf-8");
	}

	/** Update config with partial overrides */
	update(overrides: Partial<UnderstudyConfig>): void {
		this.config = validateUnderstudyConfig(
			deepMerge(
				this.config as unknown as Record<string, unknown>,
				overrides as unknown as Record<string, unknown>,
			),
		);
	}
}

export function getConfigDir(): string {
	return resolveUnderstudyHomeDir();
}

export function getDefaultConfigPath(): string {
	return join(getConfigDir(), CONFIG_FILE_NAME);
}

function updateAgentConfig(
	config: UnderstudyConfig,
	patch: Partial<UnderstudyConfig["agent"]>,
): void {
	config.agent = {
		...config.agent,
		...patch,
	};
}

function updateAgentAcpConfig(
	config: UnderstudyConfig,
	patch: Partial<NonNullable<UnderstudyConfig["agent"]["acp"]>>,
): void {
	updateAgentConfig(config, {
		acp: {
			...config.agent.acp,
			...patch,
		},
	});
}

function updateAgentSandboxConfig(
	config: UnderstudyConfig,
	patch: Partial<NonNullable<UnderstudyConfig["agent"]["sandbox"]>>,
): void {
	updateAgentConfig(config, {
		sandbox: {
			...config.agent.sandbox,
			...patch,
		},
	});
}

function updateAgentRuntimePoliciesConfig(
	config: UnderstudyConfig,
	patch: Partial<NonNullable<UnderstudyConfig["agent"]["runtimePolicies"]>>,
): void {
	updateAgentConfig(config, {
		runtimePolicies: {
			...config.agent.runtimePolicies,
			...patch,
		},
	});
}

function updateGatewayConfig(
	config: UnderstudyConfig,
	patch: Partial<NonNullable<UnderstudyConfig["gateway"]>>,
): void {
	config.gateway = {
		...(config.gateway ?? DEFAULT_CONFIG.gateway!),
		...patch,
	};
}

function updateGatewayAuthConfig(
	config: UnderstudyConfig,
	patch: Partial<NonNullable<NonNullable<UnderstudyConfig["gateway"]>["auth"]>>,
): void {
	const currentAuth = config.gateway?.auth ?? DEFAULT_CONFIG.gateway?.auth ?? { mode: "none" as const };
	updateGatewayConfig(config, {
		auth: {
			...currentAuth,
			...patch,
		},
	});
}

function updateBrowserConfig(
	config: UnderstudyConfig,
	patch: Partial<NonNullable<UnderstudyConfig["browser"]>>,
): void {
	config.browser = {
		...(config.browser ?? DEFAULT_CONFIG.browser!),
		...patch,
	};
}

function updateBrowserExtensionConfig(
	config: UnderstudyConfig,
	patch: Partial<NonNullable<NonNullable<UnderstudyConfig["browser"]>["extension"]>>,
): void {
	updateBrowserConfig(config, {
		extension: {
			...config.browser?.extension,
			...patch,
		},
	});
}

function updatePluginsConfig(
	config: UnderstudyConfig,
	patch: Partial<NonNullable<UnderstudyConfig["plugins"]>>,
): void {
	config.plugins = {
		...config.plugins,
		...patch,
	};
}

function applyWhenDefined<T>(value: T | undefined, apply: (value: T) => void): void {
	if (value !== undefined) {
		apply(value);
	}
}

function readTrimmedEnv(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
}

function readLowercaseEnv(name: string): string | undefined {
	return readTrimmedEnv(name)?.toLowerCase();
}

function readBooleanEnv(name: string): boolean | undefined {
	const value = readLowercaseEnv(name);
	if (value === "true") {
		return true;
	}
	if (value === "false") {
		return false;
	}
	return undefined;
}

function readIntegerEnv(name: string, minimum: number): number | undefined {
	const raw = readTrimmedEnv(name);
	if (!raw) {
		return undefined;
	}
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed < minimum) {
		return undefined;
	}
	return parsed;
}

function readCsvEnv(name: string): string[] | undefined {
	const raw = readTrimmedEnv(name);
	if (!raw) {
		return undefined;
	}
	const values = raw
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	return values.length > 0 ? values : undefined;
}

function readEnumEnv<const TValue extends string>(
	name: string,
	allowedValues: readonly TValue[],
): TValue | undefined {
	const value = readLowercaseEnv(name);
	if (!value) {
		return undefined;
	}
	return allowedValues.includes(value as TValue) ? value as TValue : undefined;
}

function applyTopLevelEnvOverrides(config: UnderstudyConfig): void {
	const defaultProvider = readTrimmedEnv("UNDERSTUDY_DEFAULT_PROVIDER");
	if (defaultProvider) {
		config.defaultProvider = defaultProvider;
	}

	const defaultModel = readTrimmedEnv("UNDERSTUDY_DEFAULT_MODEL");
	if (defaultModel) {
		config.defaultModel = defaultModel;
	}

	const thinkingLevel = readTrimmedEnv("UNDERSTUDY_THINKING_LEVEL");
	if (thinkingLevel) {
		config.defaultThinkingLevel = thinkingLevel as UnderstudyConfig["defaultThinkingLevel"];
	}
}

function applyAgentEnvOverrides(config: UnderstudyConfig): void {
	const guiGroundingThinkingLevel = readEnumEnv(
		"UNDERSTUDY_GUI_GROUNDING_THINKING_LEVEL",
		["off", "minimal", "low", "medium", "high", "xhigh"] as const,
	);
	applyWhenDefined(guiGroundingThinkingLevel, (value) => {
		updateAgentConfig(config, { guiGroundingThinkingLevel: value });
	});

	const fallbackModels = readCsvEnv("UNDERSTUDY_MODEL_FALLBACKS");
	applyWhenDefined(fallbackModels, (modelFallbacks) => {
		updateAgentConfig(config, { modelFallbacks });
	});

	const runtimeProfile = readEnumEnv(
		"UNDERSTUDY_RUNTIME_PROFILE",
		["assistant", "headless"] as const,
	);
	applyWhenDefined(runtimeProfile, (value) => {
		updateAgentConfig(config, { runtimeProfile: value });
	});

	const runtimeBackend = readEnumEnv(
		"UNDERSTUDY_RUNTIME_BACKEND",
		["embedded", "acp"] as const,
	);
	applyWhenDefined(runtimeBackend, (value) => {
		updateAgentConfig(config, { runtimeBackend: value });
	});

	const acpEnabled = readBooleanEnv("UNDERSTUDY_ACP_ENABLED");
	applyWhenDefined(acpEnabled, (enabled) => {
		updateAgentAcpConfig(config, { enabled });
	});

	const acpBackend = readTrimmedEnv("UNDERSTUDY_ACP_BACKEND");
	applyWhenDefined(acpBackend, (backend) => {
		updateAgentAcpConfig(config, { backend });
	});

	const acpCommand = readTrimmedEnv("UNDERSTUDY_ACP_COMMAND");
	applyWhenDefined(acpCommand, (command) => {
		updateAgentAcpConfig(config, { command });
	});

	const acpArgsRaw = readTrimmedEnv("UNDERSTUDY_ACP_ARGS");
	applyWhenDefined(acpArgsRaw, (raw) => {
		updateAgentAcpConfig(config, { args: parseEnvArgList(raw) });
	});

	const acpOutputFormat = readEnumEnv(
		"UNDERSTUDY_ACP_OUTPUT_FORMAT",
		["text", "json", "jsonl"] as const,
	);
	applyWhenDefined(acpOutputFormat, (outputFormat) => {
		updateAgentAcpConfig(config, { outputFormat });
	});

	const sandboxMode = readEnumEnv(
		"UNDERSTUDY_SANDBOX_MODE",
		["off", "auto", "strict"] as const,
	);
	applyWhenDefined(sandboxMode, (mode) => {
		updateAgentSandboxConfig(config, { mode });
	});

	const runtimePoliciesEnabled = readBooleanEnv("UNDERSTUDY_RUNTIME_POLICIES_ENABLED");
	applyWhenDefined(runtimePoliciesEnabled, (enabled) => {
		updateAgentRuntimePoliciesConfig(config, { enabled });
	});

	const runtimePolicyModules = readCsvEnv("UNDERSTUDY_RUNTIME_POLICY_MODULES");
	applyWhenDefined(runtimePolicyModules, (modules) => {
		updateAgentRuntimePoliciesConfig(config, {
			modules: modules.map((name) => ({ name, enabled: true })),
		});
	});
}

function applyGatewayEnvOverrides(config: UnderstudyConfig): void {
	const sessionScope = readEnumEnv(
		"UNDERSTUDY_GATEWAY_SESSION_SCOPE",
		["global", "channel", "sender", "channel_sender"] as const,
	);
	applyWhenDefined(sessionScope, (value) => {
		updateGatewayConfig(config, { sessionScope: value });
	});

	const dmScope = readEnumEnv(
		"UNDERSTUDY_GATEWAY_DM_SCOPE",
		["sender", "thread"] as const,
	);
	applyWhenDefined(dmScope, (value) => {
		updateGatewayConfig(config, { dmScope: value });
	});

	const idleResetMinutes = readIntegerEnv("UNDERSTUDY_GATEWAY_IDLE_RESET_MINUTES", 0);
	applyWhenDefined(idleResetMinutes, (value) => {
		updateGatewayConfig(config, { idleResetMinutes: value });
	});

	const dailyReset = readBooleanEnv("UNDERSTUDY_GATEWAY_DAILY_RESET");
	applyWhenDefined(dailyReset, (value) => {
		updateGatewayConfig(config, { dailyReset: value });
	});

	const authMode = readEnumEnv(
		"UNDERSTUDY_GATEWAY_AUTH_MODE",
		["none", "token", "password"] as const,
	);
	applyWhenDefined(authMode, (mode) => {
		updateGatewayAuthConfig(config, { mode });
	});

	const token = readTrimmedEnv("UNDERSTUDY_GATEWAY_TOKEN");
	applyWhenDefined(token, (gatewayToken) => {
		updateGatewayAuthConfig(config, {
			mode: config.gateway?.auth?.mode ?? "token",
			token: gatewayToken,
		});
	});

	const password = readTrimmedEnv("UNDERSTUDY_GATEWAY_PASSWORD");
	applyWhenDefined(password, (gatewayPassword) => {
		updateGatewayAuthConfig(config, {
			mode: config.gateway?.auth?.mode ?? "password",
			password: gatewayPassword,
		});
	});

	const channelAutoRestart = readBooleanEnv("UNDERSTUDY_GATEWAY_CHANNEL_AUTORESTART");
	applyWhenDefined(channelAutoRestart, (value) => {
		updateGatewayConfig(config, { channelAutoRestart: value });
	});

	const channelRestartBaseDelayMs = readIntegerEnv("UNDERSTUDY_GATEWAY_CHANNEL_RESTART_BASE_MS", 0);
	applyWhenDefined(channelRestartBaseDelayMs, (value) => {
		updateGatewayConfig(config, { channelRestartBaseDelayMs: value });
	});

	const channelRestartMaxDelayMs = readIntegerEnv("UNDERSTUDY_GATEWAY_CHANNEL_RESTART_MAX_MS", 0);
	applyWhenDefined(channelRestartMaxDelayMs, (value) => {
		updateGatewayConfig(config, { channelRestartMaxDelayMs: value });
	});
}

function applyBrowserEnvOverrides(config: UnderstudyConfig): void {
	const connectionMode = readEnumEnv(
		"UNDERSTUDY_BROWSER_CONNECTION_MODE",
		["managed", "extension", "auto"] as const,
	);
	applyWhenDefined(connectionMode, (value) => {
		updateBrowserConfig(config, { connectionMode: value });
	});

	const cdpUrl = readTrimmedEnv("UNDERSTUDY_BROWSER_CDP_URL");
	applyWhenDefined(cdpUrl, (value) => {
		updateBrowserConfig(config, { cdpUrl: value });
	});

	const installDir = readTrimmedEnv("UNDERSTUDY_BROWSER_EXTENSION_INSTALL_DIR");
	applyWhenDefined(installDir, (value) => {
		updateBrowserExtensionConfig(config, { installDir: value });
	});
}

function applyPluginsEnvOverrides(config: UnderstudyConfig): void {
	const pluginsEnabled = readBooleanEnv("UNDERSTUDY_PLUGINS_ENABLED");
	applyWhenDefined(pluginsEnabled, (enabled) => {
		updatePluginsConfig(config, { enabled });
	});

	const modules = readCsvEnv("UNDERSTUDY_PLUGIN_MODULES");
	applyWhenDefined(modules, (value) => {
		updatePluginsConfig(config, { modules: value });
	});
}

function applyEnvOverrides(config: UnderstudyConfig): UnderstudyConfig {
	const result = { ...config };
	applyTopLevelEnvOverrides(result);
	applyAgentEnvOverrides(result);
	applyGatewayEnvOverrides(result);
	applyBrowserEnvOverrides(result);
	applyPluginsEnvOverrides(result);
	return result;
}

function parseEnvArgList(raw: string): string[] {
	const trimmed = raw.trim();
	if (!trimmed) {
		return [];
	}
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) {
				return parsed
					.filter((value): value is string => typeof value === "string")
					.map((value) => value.trim())
					.filter(Boolean);
			}
		} catch {
			// Fall through to shell-like splitting below.
		}
	}
	const matches = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
	return matches
		.map((value) => value.replace(/^"(.*)"$/, "$1").trim())
		.filter(Boolean);
}

function loadDotenvFiles(resolvedConfigPath: string): void {
	const explicit = process.env.UNDERSTUDY_ENV_FILE?.trim();
	const candidates = [
		explicit,
		join(process.cwd(), ".env"),
		join(dirname(resolvedConfigPath), ".env"),
	].filter((candidate): candidate is string => Boolean(candidate && candidate.length > 0));

	const unique = Array.from(new Set(candidates));
	for (const filePath of unique) {
		if (!existsSync(filePath)) continue;
		dotenv.config({
			path: filePath,
			override: false,
		});
	}
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
	const result = { ...target };
	for (const key of Object.keys(source)) {
		const sourceVal = source[key];
		const targetVal = target[key];
		if (
			sourceVal &&
			typeof sourceVal === "object" &&
			!Array.isArray(sourceVal) &&
			targetVal &&
			typeof targetVal === "object" &&
			!Array.isArray(targetVal)
		) {
			result[key] = deepMerge(targetVal as Record<string, unknown>, sourceVal as Record<string, unknown>);
		} else {
			result[key] = sourceVal;
		}
	}
	return result;
}
