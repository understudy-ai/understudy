// Agent session
export { createUnderstudySession } from "./agent.js";
export type { UnderstudySessionOptions, UnderstudySessionResult } from "./agent.js";
export { resolveRuntimeBackendForSession } from "./agent.js";

// Tool registry
export { ToolRegistry } from "./tool-registry.js";

// Config
export { ConfigManager, getConfigDir, getDefaultConfigPath } from "./config.js";
export { resolveUnderstudyPackageVersion, UNDERSTUDY_PACKAGE_VERSION } from "./version.js";

// Config schema validation
export { validateUnderstudyConfig } from "./config-schema.js";

// System prompt
export { buildUnderstudySystemPrompt } from "./system-prompt.js";
export type { SystemPromptOptions, PromptMode, OwnerIdDisplay, MemoryCitationsMode, ContextFile } from "./system-prompt.js";
export { buildSkillsSection } from "./system-prompt-sections.js";
export { buildUnderstudyPromptReport } from "./prompt-report.js";
export type { UnderstudyPromptReport, UnderstudySessionMeta } from "./prompt-report.js";
export {
	buildTaughtTaskDraftFromRun,
	createTaughtTaskDraft,
	createTaughtTaskDraftFromVideo,
	listTaughtTaskDrafts,
	loadTaughtTaskDraft,
	persistTaughtTaskDraft,
	publishTaughtTaskDraft,
	loadPersistedTaughtTaskDraftLedger,
	lintTaughtTaskDraft,
	updateTaughtTaskDraft,
	updatePersistedTaughtTaskDraft,
	buildTaughtTaskDraftPromptContent,
	extractTaughtTaskToolArgumentsFromRecord,
	normalizeTaughtTaskToolArguments,
} from "./task-drafts.js";
export type {
	BuildTaughtTaskDraftFromRunOptions,
	CreateTaughtTaskDraftOptions,
	CreateTaughtTaskDraftFromVideoOptions,
	CreateTaughtTaskDraftRunLike,
	ListTaughtTaskDraftsOptions,
	LoadPersistedTaughtTaskDraftLedgerOptions,
	LoadTaughtTaskDraftOptions,
	PersistTaughtTaskDraftOptions,
	PublishTaughtTaskDraftOptions,
	PublishTaughtTaskDraftResult,
	TaughtTaskDraft,
	TaughtTaskDraftLedger,
	TaughtTaskCard,
	TaughtTaskDraftParameter,
	TaughtTaskDraftPublishedSkill,
	TaughtTaskDraftLintIssue,
	TaughtTaskKind,
	TaughtTaskExecutionPolicy,
	TaughtTaskExecutionRoute,
	TaughtTaskProcedureStep,
	TaughtTaskDraftRevision,
	TaughtTaskSkillDependency,
	TaughtTaskStepRouteOption,
	TaughtTaskDraftStep,
	TaughtTaskToolArgumentObject,
	TaughtTaskToolArgumentPrimitive,
	TaughtTaskToolArgumentValue,
	TaughtTaskToolArguments,
	UpdatePersistedTaughtTaskDraftOptions,
} from "./task-drafts.js";
export {
	appendPersistedWorkflowCrystallizationTurnFromRun,
	buildWorkflowCrystallizationTurnFromRun,
	loadPersistedWorkflowCrystallizationLedger,
	markWorkflowCrystallizationSkillNotified,
	persistWorkflowCrystallizationLedger,
	publishWorkflowCrystallizedSkill,
	replaceWorkflowCrystallizationClusters,
	replaceWorkflowCrystallizationDayEpisodes,
	replaceWorkflowCrystallizationDaySegments,
	replaceWorkflowCrystallizationSkills,
	updatePersistedWorkflowCrystallizationLedger,
} from "./workflow-crystallization.js";
export type {
	AppendWorkflowCrystallizationTurnFromRunOptions,
	LoadPersistedWorkflowCrystallizationLedgerOptions,
	PersistWorkflowCrystallizationLedgerOptions,
	PublishWorkflowCrystallizedSkillOptions,
	WorkflowCrystallizationAnalysisState,
	WorkflowCrystallizationCluster,
	WorkflowCrystallizationCompletion,
	WorkflowCrystallizationDayRecord,
	WorkflowCrystallizationEpisode,
	WorkflowCrystallizationLedger,
	WorkflowCrystallizationNotificationState,
	WorkflowCrystallizationPublishedSkill,
	WorkflowCrystallizationRouteOption,
	WorkflowCrystallizationSegment,
	WorkflowCrystallizationSkill,
	WorkflowCrystallizationSkillStage,
	WorkflowCrystallizationStatusCounts,
	WorkflowCrystallizationToolStep,
	WorkflowCrystallizationTurn,
	WorkflowCrystallizationTurnEvidence,
} from "./workflow-crystallization.js";

// System prompt params
export { buildSystemPromptParams, formatUserTime } from "./system-prompt-params.js";
export type { RuntimeInfo, SystemPromptRuntimeParams } from "./system-prompt-params.js";
export { findGitRoot, resolveWorkspaceContext, resolveWorkspaceDir } from "./workspace-context.js";
export type { ResolveWorkspaceContextParams, ResolvedWorkspaceContext } from "./workspace-context.js";

// Skills
export { buildWorkspaceSkillSnapshot } from "./skills/workspace.js";
export { resolveBundledSkillsDir } from "./skills/workspace.js";
export type { SkillSnapshot } from "./skills/workspace.js";

// Runtime policy helpers
export type { RuntimeProfile } from "./runtime/identity-policy.js";
export { AcpRuntimeAdapter } from "./runtime/adapters/acp.js";
export { applySystemPromptOverrideToSession } from "./runtime/system-prompt-override.js";
export { runRuntimePreflight, buildPreflightPromptContent } from "./runtime/preflight.js";
export type { RuntimeCapabilityManifest, RuntimeDependencyStatus, ToolAvailability } from "./runtime/preflight.js";
export {
	wrapToolsWithWatchdog,
} from "./runtime/tool-watchdog.js";
export {
	RuntimePolicyPipeline,
	wrapToolsWithPolicyPipeline,
} from "./runtime/policy-pipeline.js";
export {
	wrapToolsWithExecutionTrace,
	resolveToolExecutionRoute,
	buildToolExecutionResultSummary,
} from "./runtime/tool-execution-trace.js";
export {
	RuntimePolicyRegistry,
	createDefaultRuntimePolicyRegistry,
} from "./runtime/policy-registry.js";
export type {
	RuntimePolicy,
	RuntimePolicyContext,
	BeforePromptBuildInput,
	BeforePromptBuildOutput,
	BeforePromptInput,
	BeforePromptOutput,
	BeforeToolInput,
	BeforeToolOutput,
	AfterToolInput,
	BeforeReplyInput,
	BeforeReplyOutput,
	AfterReplyInput,
	AfterReplyOutput,
} from "./runtime/policy-pipeline.js";
export {
	DEFAULT_RUNTIME_POLICY_MODULE_ORDER,
} from "./runtime/policies/index.js";
export {
	resolveRuntimeModelCandidates,
} from "./runtime/bridge/model-resolution-bridge.js";
export type {
	RuntimeModelCandidatesResult,
	RuntimeModelResolutionAttempt,
	RuntimeResolvedModelCandidate,
} from "./runtime/bridge/model-resolution-bridge.js";
export type {
	RuntimePolicyModuleFactory,
	RuntimePolicyModuleFactoryInput,
} from "./runtime/policies/index.js";
export type {
	RuntimeAdapter,
	RuntimeCreateSessionOptions,
	RuntimeCreateSessionResult,
	RuntimeEngineSession,
	RuntimePromptOptions,
	RuntimeSessionEvent,
	RuntimeSessionManager,
	RuntimeToolDefinition,
	RuntimeSession,
} from "./runtime/types.js";
export type {
	AcpRuntime,
	AcpRuntimeEnsureInput,
	AcpRuntimeEvent,
	AcpRuntimeHandle,
	AcpRuntimePromptMode,
	AcpRuntimeSessionMode,
	AcpRuntimeTurnInput,
} from "./runtime/acp/types.js";
export {
	registerAcpRuntimeBackend,
	unregisterAcpRuntimeBackend,
	getAcpRuntimeBackend,
	resolveAcpRuntimeBackend,
} from "./runtime/acp/registry.js";
export {
	installToolResultContextGuard,
	CONTEXT_LIMIT_TRUNCATION_NOTICE,
	PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER,
	recoverContextAfterOverflowInPlace,
} from "./runtime/tool-result-context-guard.js";
export type {
	UnderstudySessionLifecycleHooks,
	UnderstudySessionPromptBuiltEvent,
	UnderstudySessionCreatedEvent,
	UnderstudySessionAssistantReplyEvent,
	UnderstudySessionClosedEvent,
} from "./runtime/orchestrator.js";
export type {
	UnderstudySessionToolEvent,
	UnderstudySessionToolStartEvent,
	UnderstudySessionToolFinishEvent,
	UnderstudySessionToolErrorEvent,
	UnderstudySessionToolResultSummary,
} from "./runtime/tool-execution-trace.js";
export {
	createSessionTraceLifecycleHooks,
} from "./session-trace.js";
export type {
	CreateSessionTraceLifecycleHooksOptions,
	SessionTraceLifecycleHandle,
} from "./session-trace.js";

// Usage tracking
export { UsageTracker } from "./usage-tracker.js";
export type { TokenUsage, UsageSummary } from "./usage-tracker.js";

// File logger
export { createFileLogger } from "./file-logger.js";
export type { FileLoggerOptions } from "./file-logger.js";

// Utils
export { withTimeout } from "./utils/with-timeout.js";

// Value helpers
export { asRecord, asString, asNumber, asBoolean, asStringArray } from "./value-helpers.js";
export { extFromMimeType, normalizeMimeType, resolveAttachmentType } from "./media-utils.js";

// Session reset prompt
export { buildSessionResetPrompt, BARE_SESSION_RESET_PROMPT } from "./session-reset-prompt.js";

// Sanitization
export { sanitizeForPromptLiteral } from "./sanitize-for-prompt.js";
export { SILENT_REPLY_TOKEN, normalizeAssistantDisplayText, stripInlineDirectiveTagsForDisplay } from "./directive-tags.js";
export type {
	AssistantReplyTarget,
	NormalizeAssistantDisplayTextResult,
	StripInlineDirectiveTagsResult,
} from "./directive-tags.js";

// Auth
export {
	AuthManager,
	inspectProviderAuthStatus,
	inspectProviderAuthStatuses,
	prepareRuntimeAuthContext,
} from "./auth.js";
export type {
	AuthProviderSource,
	AuthProviderStatus,
	PreparedRuntimeAuthContext,
} from "./auth.js";

// Logger
export { createLogger } from "./logger.js";
export type { Logger, LogLevel } from "./logger.js";

// Runtime storage paths
export {
	expandHome,
	ensureRuntimeEngineAgentDirEnv,
	resolveUnderstudyAgentDir,
	resolveUnderstudyHomeDir,
	getDefaultUnderstudyAgentDir,
	getDefaultUnderstudyHomeDir,
	getUnderstudySessionDir,
	encodeSessionScope,
} from "./runtime-paths.js";
