import { z } from "zod";
import type { UnderstudyConfig } from "@understudy/types";

const ThinkingLevel = z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]);
const RuntimeProfile = z.enum(["assistant", "headless"]);
const RuntimeBackend = z.enum(["embedded", "acp"]);

const strictObject = <TShape extends z.ZodRawShape>(shape: TShape) => z.object(shape).strict();

const ToolPolicySchema = strictObject({
	match: z.array(z.string()),
	action: z.enum(["allow", "deny", "require_approval"]),
	rateLimit: z.number().positive().optional(),
});

const RuntimePolicyModuleConfigSchema = strictObject({
	name: z.string().min(1),
	enabled: z.boolean().optional(),
	options: z.record(z.string(), z.unknown()).optional(),
});

const AgentAcpConfigSchema = strictObject({
	enabled: z.boolean().optional(),
	backend: z.string().optional(),
	command: z.string().optional(),
	args: z.array(z.string()).optional(),
	env: z.record(z.string(), z.string()).optional(),
	outputFormat: z.enum(["text", "json", "jsonl"]).optional(),
});

const AgentSandboxConfigSchema = strictObject({
	mode: z.enum(["off", "auto", "strict"]).optional(),
	dockerImage: z.string().optional(),
	workspaceMountMode: z.enum(["rw", "ro"]).optional(),
	disableNetwork: z.boolean().optional(),
});

const RuntimePoliciesConfigSchema = strictObject({
	enabled: z.boolean().optional(),
	modules: z.array(RuntimePolicyModuleConfigSchema).optional(),
});

const AgentConfigSchema = strictObject({
	runtimeProfile: RuntimeProfile.optional(),
	runtimeBackend: RuntimeBackend.optional(),
	guiGroundingThinkingLevel: ThinkingLevel.optional(),
	guiGroundingProvider: z.string().optional(),
	guiGroundingModel: z.string().optional(),
	acp: AgentAcpConfigSchema.optional(),
	sandbox: AgentSandboxConfigSchema.optional(),
	modelFallbacks: z.array(z.string()).optional(),
	runtimePolicies: RuntimePoliciesConfigSchema.optional(),
	identity: z.string().optional(),
	safetyInstructions: z.string().optional(),
	cwd: z.string().optional(),
	mcpConfigPath: z.string().optional(),
	skillDirs: z.array(z.string()).optional(),
	userTimezone: z.string().optional(),
	ownerIds: z.array(z.string()).optional(),
	ownerDisplay: z.enum(["raw", "hash"]).optional(),
	ownerDisplaySecret: z.string().optional(),
	repoRoot: z.string().optional(),
	promptMode: z.enum(["full", "minimal", "none"]).optional(),
	memoryCitationsMode: z.enum(["on", "off"]).optional(),
	contextFiles: z.array(z.string()).optional(),
	heartbeatPrompt: z.string().optional(),
	ttsHint: z.string().optional(),
	docsUrl: z.string().optional(),
	modelAliasLines: z.array(z.string()).optional(),
});

const ChannelConfigSchema = strictObject({
	enabled: z.boolean(),
	settings: z.record(z.string(), z.unknown()),
	toolPolicies: z.array(ToolPolicySchema).optional(),
	toolPolicyPreset: z.enum(["off", "private_conservative"]).optional(),
});

const SkillEntryConfigSchema = strictObject({
	enabled: z.boolean().optional(),
	env: z.record(z.string(), z.string()).optional(),
	apiKey: z.string().optional(),
});

const SkillLimitsConfigSchema = strictObject({
	maxSkillsLoadedPerSource: z.number().positive().optional(),
	maxSkillsInPrompt: z.number().positive().optional(),
	maxSkillsPromptChars: z.number().positive().optional(),
	maxCandidatesPerRoot: z.number().positive().optional(),
	maxSkillFileBytes: z.number().positive().optional(),
});

const SkillsConfigSchema = strictObject({
	allowBundled: z.array(z.string()).optional(),
	entries: z.record(z.string(), SkillEntryConfigSchema).optional(),
	limits: SkillLimitsConfigSchema.optional(),
});

const AgentIdentityConfigSchema = strictObject({
	name: z.string().optional(),
	emoji: z.string().optional(),
	avatar: z.string().optional(),
	avatarUrl: z.string().optional(),
});

const AgentProfileConfigSchema = strictObject({
	id: z.string().min(1),
	name: z.string().optional(),
	workspace: z.string().optional(),
	model: z.string().optional(),
	identity: AgentIdentityConfigSchema.optional(),
});

const AgentDefaultsConfigSchema = strictObject({
	skipBootstrap: z.boolean().optional(),
});

const AgentsConfigSchema = strictObject({
	list: z.array(AgentProfileConfigSchema).optional(),
	defaults: AgentDefaultsConfigSchema.optional(),
});

const SessionConfigSchema = strictObject({
	mainKey: z.string().optional(),
	scope: z.enum(["global", "per-sender"]).optional(),
});

const BrowserExtensionConfigSchema = strictObject({
	installDir: z.string().optional(),
});

const BrowserConfigSchema = strictObject({
	connectionMode: z.enum(["managed", "extension", "auto"]).optional(),
	cdpUrl: z.string().optional(),
	extension: BrowserExtensionConfigSchema.optional(),
});

const GatewayAuthConfigSchema = strictObject({
	mode: z.enum(["none", "token", "password"]),
	token: z.string().optional(),
	password: z.string().optional(),
});

const GatewayRateLimitConfigSchema = strictObject({
	maxAttempts: z.number().int().positive().optional(),
	windowMs: z.number().int().positive().optional(),
	lockoutMs: z.number().int().positive().optional(),
	exemptLoopback: z.boolean().optional(),
});

const ControlUiConfigSchema = strictObject({
	enabled: z.boolean().optional(),
	basePath: z.string().optional(),
	assetRoot: z.string().optional(),
	assistantName: z.string().optional(),
	assistantAvatarUrl: z.string().optional(),
	allowedOrigins: z.array(z.string()).optional(),
});

const GatewayConfigSchema = strictObject({
	port: z.number().int().positive(),
	host: z.string().min(1),
	enableWebSocket: z.boolean(),
	sessionScope: z.enum(["global", "channel", "sender", "channel_sender"]).optional(),
	dmScope: z.enum(["sender", "thread"]).optional(),
	idleResetMinutes: z.number().int().min(0).optional(),
	dailyReset: z.boolean().optional(),
	channelAutoRestart: z.boolean().optional(),
	channelRestartBaseDelayMs: z.number().int().min(0).optional(),
	channelRestartMaxDelayMs: z.number().int().min(0).optional(),
	auth: GatewayAuthConfigSchema.optional(),
	trustedProxies: z.array(z.string()).optional(),
	rateLimit: GatewayRateLimitConfigSchema.optional(),
	controlUi: ControlUiConfigSchema.optional(),
});

const PluginsConfigSchema = strictObject({
	enabled: z.boolean().optional(),
	modules: z.array(z.string()).optional(),
});

const ToolsConfigSchema = strictObject({
	policies: z.array(ToolPolicySchema),
	autoApproveReadOnly: z.boolean(),
});

const MemoryConfigSchema = strictObject({
	enabled: z.boolean(),
	dbPath: z.string().optional(),
});

const UnderstudyConfigSchema = strictObject({
	defaultProvider: z.string().min(1),
	defaultModel: z.string().min(1),
	defaultThinkingLevel: ThinkingLevel,
	agent: AgentConfigSchema,
	channels: z.record(z.string(), ChannelConfigSchema),
	tools: ToolsConfigSchema,
	memory: MemoryConfigSchema,
	skills: SkillsConfigSchema.optional(),
	agents: AgentsConfigSchema.optional(),
	session: SessionConfigSchema.optional(),
	browser: BrowserConfigSchema.optional(),
	gateway: GatewayConfigSchema.optional(),
	plugins: PluginsConfigSchema.optional(),
});

export function validateUnderstudyConfig(config: unknown): UnderstudyConfig {
	const parsed = UnderstudyConfigSchema.safeParse(config);
	if (parsed.success) {
		return parsed.data as UnderstudyConfig;
	}
	const issues = parsed.error.issues
		.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
		.join("; ");
	throw new Error(`Config validation failed: ${issues}`);
}
