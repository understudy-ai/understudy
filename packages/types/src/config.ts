/**
 * Configuration types for Understudy.
 */

import type { ToolPolicy } from "./tool-schema.js";

export type ChannelToolPolicyPreset = "off" | "private_conservative";
export type BrowserConnectionMode = "managed" | "extension" | "auto";
export const DEFAULT_BROWSER_EXTENSION_CDP_URL = "http://127.0.0.1:23336";

/** Top-level Understudy configuration (stored in $UNDERSTUDY_HOME/config.json5, default ~/.understudy/config.json5) */
export interface UnderstudyConfig {
	/** Default LLM provider */
	defaultProvider: string;
	/** Default model ID */
	defaultModel: string;
	/** Default thinking level */
	defaultThinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	/** Agent configuration */
	agent: AgentConfig;
	/** Channel configurations */
	channels: Record<string, ChannelConfig>;
	/** Tool trust policies */
	tools: ToolsConfig;
	/** Memory configuration */
	memory: MemoryConfig;
	/** Skills loading and prompt limits */
	skills?: SkillsConfig;
	/** Gateway-managed agent profiles and workspaces */
	agents?: AgentsConfig;
	/** Session defaults shared by agent management surfaces */
	session?: SessionConfig;
	/** Browser runtime defaults shared by chat and gateway */
	browser?: BrowserConfig;
	/** Gateway configuration */
	gateway?: GatewayConfig;
	/** Plugin loading configuration */
	plugins?: PluginsConfig;
}

/** Agent behavior configuration */
export interface AgentConfig {
	/** Runtime behavior profile */
	runtimeProfile?: "assistant" | "headless";
	/** Runtime backend implementation */
	runtimeBackend?: "embedded" | "acp";
	/** Dedicated GUI grounding thinking level override */
	guiGroundingThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	/** ACP runtime bridge configuration */
	acp?: AgentAcpConfig;
	/** Shell sandbox execution settings for high-risk commands */
	sandbox?: AgentSandboxConfig;
	/** Model fallback chain in provider/model format */
	modelFallbacks?: string[];
	/** Runtime policy pipeline module configuration */
	runtimePolicies?: RuntimePoliciesConfig;
	/** System prompt identity section */
	identity?: string;
	/** Custom safety instructions */
	safetyInstructions?: string;
	/** Working directory override */
	cwd?: string;
	/** Optional MCP runtime config path override */
	mcpConfigPath?: string;
	/** Additional skill directories */
	skillDirs?: string[];
	/** User timezone (e.g., "Asia/Shanghai"). Auto-detected if not set. */
	userTimezone?: string;
	/** Authorized owner/sender IDs */
	ownerIds?: string[];
	/** How to display owner IDs in prompt: "raw" or "hash" */
	ownerDisplay?: "raw" | "hash";
	/** Secret for hashing owner IDs (HMAC-SHA256) */
	ownerDisplaySecret?: string;
	/** Explicit git repo root path */
	repoRoot?: string;
	/** Prompt mode: "full" (default), "minimal" (subagents), "none" (identity only) */
	promptMode?: "full" | "minimal" | "none";
	/** Memory citations mode: "on" (default) or "off" */
	memoryCitationsMode?: "on" | "off";
	/** Paths to project context files to inject (e.g., SOUL.md) */
	contextFiles?: string[];
	/** Heartbeat prompt text */
	heartbeatPrompt?: string;
	/** TTS hint for voice output channels */
	ttsHint?: string;
	/** URL or path to documentation */
	docsUrl?: string;
	/** Optional model alias lines shown in the system prompt */
	modelAliasLines?: string[];
}

export interface AgentAcpConfig {
	/** Enable ACP runtime dispatch for this agent */
	enabled?: boolean;
	/** Optional ACP backend identifier resolved through the runtime registry */
	backend?: string;
	/** External command used by the built-in command ACP backend */
	command?: string;
	/** Arguments for the external ACP command */
	args?: string[];
	/** Extra environment variables injected into the ACP process */
	env?: Record<string, string>;
	/** How the external ACP command writes replies */
	outputFormat?: "text" | "json" | "jsonl";
}

export interface AgentSandboxConfig {
	/** Sandbox mode: off = disabled, auto = prefer sandbox with host fallback, strict = require sandbox */
	mode?: "off" | "auto" | "strict";
	/** Docker image used for sandboxed shell execution */
	dockerImage?: string;
	/** Workspace mount mode inside sandbox */
	workspaceMountMode?: "rw" | "ro";
	/** Disable network access inside sandbox container */
	disableNetwork?: boolean;
}

/** Channel adapter configuration */
export interface ChannelConfig {
	/** Whether this channel is enabled */
	enabled: boolean;
	/** Channel-specific settings */
	settings: Record<string, unknown>;
	/** Per-channel tool policies */
	toolPolicies?: ToolPolicy[];
	/** Optional per-channel default policy preset */
	toolPolicyPreset?: ChannelToolPolicyPreset;
}

/** Tool trust configuration */
export interface ToolsConfig {
	/** Global tool policies */
	policies: ToolPolicy[];
	/** Whether to auto-approve read-only tools */
	autoApproveReadOnly: boolean;
}

/** Memory system configuration */
export interface MemoryConfig {
	/** Whether memory is enabled */
	enabled: boolean;
	/** Path to memory database */
	dbPath?: string;
}

/** Skills configuration */
export interface SkillsConfig {
	/** Global skill source policy */
	allowBundled?: string[];
	/** Per-skill overrides (keyed by skill name) */
	entries?: Record<string, SkillEntryConfig>;
	/** Limits for skill loading and prompt injection */
	limits?: {
		maxSkillsLoadedPerSource?: number;
		maxSkillsInPrompt?: number;
		maxSkillsPromptChars?: number;
		maxCandidatesPerRoot?: number;
		maxSkillFileBytes?: number;
	};
}

export interface SkillEntryConfig {
	enabled?: boolean;
	env?: Record<string, string>;
	apiKey?: string;
}

export interface AgentIdentityConfig {
	name?: string;
	emoji?: string;
	avatar?: string;
	avatarUrl?: string;
}

export interface AgentProfileConfig {
	id: string;
	name?: string;
	workspace?: string;
	model?: string;
	identity?: AgentIdentityConfig;
}

export interface AgentsConfig {
	list?: AgentProfileConfig[];
	defaults?: {
		skipBootstrap?: boolean;
	};
}

export interface SessionConfig {
	mainKey?: string;
	scope?: "global" | "per-sender";
}

export interface BrowserExtensionConfig {
	/** Directory where the unpacked extension assets should be installed */
	installDir?: string;
}

export interface BrowserConfig {
	/** Preferred browser connection route */
	connectionMode?: BrowserConnectionMode;
	/** Explicit CDP URL for the extension relay route */
	cdpUrl?: string;
	/** Browser extension install settings */
	extension?: BrowserExtensionConfig;
}

/** Gateway authentication configuration */
export interface GatewayAuthConfig {
	/** Auth mode: "none" (open), "token" (bearer), or "password" */
	mode: "none" | "token" | "password";
	/** Token for "token" mode */
	token?: string;
	/** Password for "password" mode */
	password?: string;
}

/** Gateway rate limit configuration */
export interface GatewayRateLimitConfig {
	/** Max failed auth attempts before lockout (default: 10) */
	maxAttempts?: number;
	/** Sliding window in ms (default: 15 minutes) */
	windowMs?: number;
	/** Lockout duration in ms (default: 15 minutes) */
	lockoutMs?: number;
	/** Whether to exempt loopback addresses (default: true) */
	exemptLoopback?: boolean;
}

/** Gateway server configuration */
export interface GatewayConfig {
	/** HTTP port */
	port: number;
	/** Hostname to bind to */
	host: string;
	/** Whether to enable WebSocket */
	enableWebSocket: boolean;
	/** Session key granularity for inbound channel routing */
	sessionScope?: "global" | "channel" | "sender" | "channel_sender";
	/** Thread-aware mode for DM-like channels */
	dmScope?: "sender" | "thread";
	/** Reset session when idle for this many minutes (0 = disabled) */
	idleResetMinutes?: number;
	/** Reset session when local date changes */
	dailyReset?: boolean;
	/** Restart failed channels automatically */
	channelAutoRestart?: boolean;
	/** Base retry delay for channel restart attempts */
	channelRestartBaseDelayMs?: number;
	/** Max retry delay for channel restart attempts */
	channelRestartMaxDelayMs?: number;
	/** Authentication configuration */
	auth?: GatewayAuthConfig;
	/** Trusted proxy addresses for X-Forwarded-For resolution */
	trustedProxies?: string[];
	/** Rate limiting for failed auth attempts */
	rateLimit?: GatewayRateLimitConfig;
	/** Control UI configuration */
	controlUi?: ControlUiConfig;
}

/** Runtime policy module config */
export interface RuntimePolicyModuleConfig {
	/** Registered runtime policy module name */
	name: string;
	/** Module enable flag (default: true) */
	enabled?: boolean;
	/** Module-specific options passed to policy factory */
	options?: Record<string, unknown>;
}

/** Runtime policies configuration */
export interface RuntimePoliciesConfig {
	/** Global runtime policy enable flag (default: true) */
	enabled?: boolean;
	/** Ordered runtime policy modules */
	modules?: RuntimePolicyModuleConfig[];
}

/** Control UI configuration */
export interface ControlUiConfig {
	/** Whether the control UI is enabled */
	enabled?: boolean;
	/** Base path for the UI (default: "/ui") */
	basePath?: string;
	/** Path to custom static assets */
	assetRoot?: string;
	/** Assistant display name */
	assistantName?: string;
	/** Assistant avatar URL */
	assistantAvatarUrl?: string;
	/** Allowed CORS origins */
	allowedOrigins?: string[];
}

export interface PluginsConfig {
	/** Global enable flag for plugin loading */
	enabled?: boolean;
	/** Plugin module paths or package ids */
	modules?: string[];
}

/** Default configuration values */
export const DEFAULT_CONFIG: UnderstudyConfig = {
	defaultProvider: "openai-codex",
	defaultModel: "gpt-5.4",
	defaultThinkingLevel: "off",
	agent: {
		runtimeProfile: "assistant",
		runtimeBackend: "embedded",
		guiGroundingThinkingLevel: "medium",
		sandbox: {
			mode: "auto",
			dockerImage: "alpine:3.20",
			workspaceMountMode: "rw",
			disableNetwork: true,
		},
		runtimePolicies: {
			enabled: true,
			modules: [
				{ name: "sanitize_tool_params", enabled: true },
				{ name: "normalize_tool_result", enabled: true },
				{ name: "route_retry_guard", enabled: false },
				{ name: "strip_assistant_directive_tags", enabled: true },
				{ name: "guard_assistant_reply", enabled: true },
			],
		},
	},
	channels: {},
	tools: {
		policies: [],
		autoApproveReadOnly: true,
	},
	memory: {
		enabled: false,
	},
	browser: {
		connectionMode: "auto",
		cdpUrl: DEFAULT_BROWSER_EXTENSION_CDP_URL,
	},
	gateway: {
		port: 23333,
		host: "127.0.0.1",
		enableWebSocket: true,
		sessionScope: "channel_sender",
		dmScope: "sender",
		idleResetMinutes: 0,
		dailyReset: true,
		channelAutoRestart: true,
		channelRestartBaseDelayMs: 2000,
		channelRestartMaxDelayMs: 30000,
	},
};
