export { GatewayServer, GATEWAY_VERSION } from "./server.js";
export type {
	GatewayServerOptions,
	GatewayCapabilitiesHookInput,
	GatewayCapabilitiesHookResult,
	ChatHandler,
	ChatContext,
	SessionHandlers,
} from "./server.js";

export { MessageRouter } from "./router.js";
export type { RouteHandler, MessageRouterOptions } from "./router.js";

export { PairingManager } from "./security.js";
export type { PairingRequest, AllowFromEntry } from "./security.js";

export type {
	GatewayCapabilitiesResult,
	GatewayCapabilityInventory,
	GatewayCapabilityMethodDescriptor,
	GatewayCapabilityNamespaceDescriptor,
	GatewayCapabilityGroupDescriptor,
	GatewayCapabilityTransportInfo,
	GatewayCapabilityHttpTransport,
	GatewayCapabilityWebSocketTransport,
	GatewayCapabilityTransportAuth,
	GatewayMethod,
	GatewayEventType,
	GatewayRequest,
	GatewayResponse,
	GatewayEvent,
} from "./protocol.js";

export { resolveGatewayAuth, safeEqualSecret, authorizeGatewayRequest, createAuthMiddleware, extractCredential } from "./auth.js";
export type { GatewayAuthMode, GatewayAuthConfig, AuthMiddlewareOptions } from "./auth.js";

export { AuthRateLimiter } from "./rate-limiter.js";
export type { RateLimiterConfig } from "./rate-limiter.js";

export { resolveClientIp, isLoopbackAddress, normalizeIp } from "./net.js";
export { securityHeaders } from "./security-headers.js";

export { GatewayLock } from "./lock.js";
export type { LockFileData } from "./lock.js";

export { LifecycleManager } from "./lifecycle.js";
export type { ActiveTask, LifecycleManagerOptions } from "./lifecycle.js";

export { ConfigReloader } from "./config-reload.js";
export type { ConfigReloadHandler } from "./config-reload.js";
export { buildSessionKey, buildWorkspaceScopeDiscriminator } from "./session-scope.js";
export {
	buildGatewayChannelConfigOverride,
	mergeUnderstudyConfigOverride,
	shouldApplyPrivateChannelToolPreset,
} from "./channel-policy.js";
export { buildPromptInputFromMedia } from "./media-input.js";
export { injectTimestamp, timestampOptsFromConfig } from "./message-timestamp.js";
export type { TimestampInjectionOptions } from "./message-timestamp.js";
export {
	buildSessionSummary,
	createGatewaySessionRuntime,
	seedRuntimeMessagesFromHistory,
	storeSessionRunTrace,
} from "./session-runtime.js";
export type {
	SessionEntry,
	SessionRunTrace,
	SessionSummary,
	SessionSandboxInfo,
} from "./session-runtime.js";
export { GatewayRunRegistry } from "./run-registry.js";
export type { AgentRunSnapshot, GatewayRunRegistryOptions } from "./run-registry.js";
export {
	NON_RENDERABLE_ASSISTANT_RESPONSE,
	MAX_INLINE_IMAGE_DATA_CHARS,
	buildInlineImageAttachments,
	extractRenderableAssistantImages,
	hasRenderableAssistantMedia,
	normalizeAssistantRenderableText,
} from "./assistant-media.js";
export {
	buildSubagentSessionId,
	createSubagentSessionMeta,
	isSubagentEntry,
	listSubagentEntries,
	markSubagentRunCompleted,
	markSubagentRunFailed,
	markSubagentRunStarted,
	resolveSubagentEntry,
} from "./subagent-registry.js";
export type {
	SubagentCleanupMode,
	SubagentMode,
	SubagentRunStatus,
	SubagentRuntime,
	SubagentSessionMeta,
} from "./subagent-registry.js";
export { createGatewayTaskDraftHandlers } from "./task-drafts.js";
export type {
	CreateGatewayTaskDraftHandlersOptions,
	GatewayTaskDraftHandlers,
} from "./task-drafts.js";

export { EventBus } from "./event-bus.js";
export type { GatewayBusEventType, BusEvent, BusEventListener } from "./event-bus.js";

export { HandlerRegistry } from "./handler-registry.js";
export type { HandlerContext, RpcHandler } from "./handler-registry.js";

// Handler modules
export { chatSend, chatStream, chatAbort, normalizeChatResult } from "./handlers/chat-handlers.js";
export {
	sessionList,
	sessionGet,
	sessionHistory,
	sessionTrace,
	sessionCreate,
	sessionSend,
	sessionPatch,
	sessionReset,
	sessionDelete,
	sessionCompact,
	sessionBranch,
	sessionsSpawn,
	subagentsAction,
} from "./handlers/session-handlers.js";
export { channelList, channelStatus, channelLogout } from "./handlers/channel-handlers.js";
export { messageAction } from "./handlers/message-handlers.js";
export { pairingRequest, pairingApprove, pairingReject } from "./handlers/pairing-handlers.js";
export { createConfigHandlers } from "./handlers/config-handlers.js";
export { createScheduleHandlers } from "./handlers/schedule-handlers.js";
export { createDiscoveryHandlers } from "./handlers/discovery-handlers.js";
export { createUsageHandlers } from "./handlers/usage-handlers.js";
export { createHealthHandlers } from "./handlers/health-handlers.js";

export { mountControlUi } from "./control-ui.js";
export type { ControlUiOptions } from "./control-ui.js";
