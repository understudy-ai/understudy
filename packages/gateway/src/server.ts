/**
 * GatewayServer: HTTP + WebSocket server for Understudy.
 * Provides RPC methods, event streaming, and routes channel messages to the agent.
 */

import { createServer, type Server } from "node:http";
import express, { type Express } from "express";
import { WebSocketServer, WebSocket } from "ws";
import type { ImageContent } from "@mariozechner/pi-ai";
import { createLogger } from "@understudy/core";
import type {
	GatewayCapabilitiesResult,
	GatewayCapabilityInventory,
	GatewayCapabilityMethodDescriptor,
	GatewayCapabilityTransportInfo,
	GatewayRequest,
	GatewayResponse,
	GatewayEvent,
} from "./protocol.js";
import { MessageRouter } from "./router.js";
import { PairingManager } from "./security.js";
import type {
	Attachment,
	ChannelAdapter,
	InboundMessage,
	GatewayRateLimitConfig,
} from "@understudy/types";
import { resolveGatewayAuth, createAuthMiddleware, authorizeGatewayRequest, type GatewayAuthConfig } from "./auth.js";
import {
	buildInlineImageAttachments,
	extractRenderableAssistantImages,
	hasRenderableAssistantMedia,
} from "./assistant-media.js";
import { AuthRateLimiter } from "./rate-limiter.js";
import { securityHeaders } from "./security-headers.js";
import { resolveClientIp } from "./net.js";
import { HandlerRegistry, type HandlerContext, type RpcHandler } from "./handler-registry.js";
import { chatAbort, chatSend, chatStream, normalizeChatResult } from "./handlers/chat-handlers.js";
import { channelList, channelLogout, channelStatus } from "./handlers/channel-handlers.js";
import { createConfigHandlers, type ConfigHandlerDeps } from "./handlers/config-handlers.js";
import { createScheduleHandlers, type ScheduleHandlerDeps } from "./handlers/schedule-handlers.js";
import { createDiscoveryHandlers, type DiscoveryHandlerDeps } from "./handlers/discovery-handlers.js";
import { createHealthHandlers, type HealthHandlerDeps } from "./handlers/health-handlers.js";
import { messageAction } from "./handlers/message-handlers.js";
import { pairingApprove, pairingReject, pairingRequest } from "./handlers/pairing-handlers.js";
import {
	sessionCreate,
	sessionGet,
	sessionHistory,
	sessionList,
	sessionTeachCreate,
	sessionTeachList,
	sessionTeachRecordStart,
	sessionTeachRecordStatus,
	sessionTeachRecordStop,
	sessionTeachPublish,
	sessionTeachUpdate,
	sessionTeachValidate,
	sessionTeachVideo,
	sessionTrace,
	sessionSend,
	subagentsAction,
	sessionBranch,
	sessionCompact,
	sessionDelete,
	sessionPatch,
	sessionReset,
	sessionsSpawn,
} from "./handlers/session-handlers.js";
import { createUsageHandlers, type UsageHandlerDeps } from "./handlers/usage-handlers.js";
import { mountControlUi } from "./control-ui.js";
import { buildWebChatHtml } from "./webchat-ui.js";
import { asRecord, asString } from "./value-coerce.js";

export const GATEWAY_VERSION = "0.1.0";

function describeCapabilityMethod(name: string): GatewayCapabilityMethodDescriptor {
	const parts = name.split(".");
	return {
		name,
		namespace: parts.length > 1 ? parts[0] : "core",
		group: parts.length > 1 ? parts.slice(0, -1).join(".") : "core",
	};
}

function compareByName<T extends { name: string }>(a: T, b: T): number {
	return a.name.localeCompare(b.name);
}

export type GatewayCapabilitiesHookResult =
	| GatewayCapabilitiesResult
	| Partial<GatewayCapabilitiesResult>
	| Record<string, unknown>
	| void;

export interface GatewayCapabilitiesHookInput {
	request: GatewayRequest;
	defaults: GatewayCapabilitiesResult;
	context: HandlerContext;
	methods: string[];
	namespaces: Array<{ id: string; count: number; methods: string[] }>;
	authMode: string;
	transport: {
		httpRpc: true;
		wsRpc: true;
		wsEvents: true;
		singlePort: true;
	};
}

export interface GatewayServerOptions {
	port: number;
	host?: string;
	pairingStorePath?: string;
	requirePairing?: boolean;
	channelAutoRestart?: boolean;
	channelRestartBaseDelayMs?: number;
	channelRestartMaxDelayMs?: number;
	/** Auth config from GatewayConfig.auth */
	auth?: Partial<GatewayAuthConfig>;
	/** Trusted proxy addresses */
	trustedProxies?: string[];
	/** Rate limiter config */
	rateLimitConfig?: GatewayRateLimitConfig;
	/** Optional RPC config handler dependencies */
	configHandlers?: ConfigHandlerDeps;
	/** Optional RPC schedule handler dependencies */
	scheduleHandlers?: ScheduleHandlerDeps;
	/** Optional RPC discovery handler dependencies */
	discoveryHandlers?: DiscoveryHandlerDeps;
	/** Optional capabilities.get enrichment hook */
	capabilitiesGet?: (input: GatewayCapabilitiesHookInput) => Promise<GatewayCapabilitiesHookResult> | GatewayCapabilitiesHookResult;
	/** Optional RPC usage handler dependencies */
	usageHandlers?: UsageHandlerDeps;
	/** Optional RPC health handler dependencies */
	healthHandlers?: Pick<HealthHandlerDeps, "getReadiness">;
	/** Optional RPC agent identity handler */
	agentIdentityGet?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC agent wait handler */
	agentWait?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC agents list handler */
	agentsList?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC agents create handler */
	agentsCreate?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC agents update handler */
	agentsUpdate?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC agents delete handler */
	agentsDelete?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC agents files list handler */
	agentsFilesList?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC agents files get handler */
	agentsFilesGet?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC agents files set handler */
	agentsFilesSet?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC web login start handler */
	webLoginStart?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC web login wait handler */
	webLoginWait?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC exec approval request handler */
	execApprovalRequest?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC exec approval wait-decision handler */
	execApprovalWaitDecision?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC exec approval resolve handler */
	execApprovalResolve?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC exec approvals get handler */
	execApprovalsGet?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC exec approvals set handler */
	execApprovalsSet?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC exec approvals node.get handler */
	execApprovalsNodeGet?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC exec approvals node.set handler */
	execApprovalsNodeSet?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC browser request handler */
	browserRequest?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC secrets reload handler */
	secretsReload?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC secrets resolve handler */
	secretsResolve?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC skills install handler */
	skillsInstall?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC skills update handler */
	skillsUpdate?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC logs tail handler */
	logsTail?: (params: Record<string, unknown>) => Promise<unknown>;
	/** Optional RPC config reload hook */
	reloadConfig?: () => Promise<unknown> | unknown;
}

export interface ChatContext {
	channelId?: string;
	senderId?: string;
	senderName?: string;
	conversationName?: string;
	conversationType?: InboundMessage["conversationType"];
	threadId?: string;
	replyToMessageId?: string;
	cwd?: string;
	forceNew?: boolean;
	configOverride?: Record<string, unknown>;
	sandboxInfo?: Record<string, unknown>;
	executionScopeKey?: string;
	waitForCompletion?: boolean;
	images?: ImageContent[];
	attachments?: Attachment[];
}

export interface ChatHandlerResult {
	response: string;
	runId?: string;
	sessionId?: string;
	status?: string;
	images?: ImageContent[];
	attachments?: Attachment[];
	replyToCurrent?: boolean;
	replyToMessageId?: string;
	[key: string]: unknown;
}

/** Handler that processes a chat message and returns either raw text or a structured payload. */
export type ChatHandler = (text: string, context?: ChatContext) => Promise<string | ChatHandlerResult>;

const CHANNEL_FAST_WAIT_TIMEOUT_MS = 750;
const CHANNEL_BACKGROUND_WAIT_TIMEOUT_MS = 3_000;

function readMessageImages(value: unknown): ImageContent[] | undefined {
	return Array.isArray(value) ? value as ImageContent[] : undefined;
}

function readMessageAttachments(value: unknown): Attachment[] | undefined {
	return Array.isArray(value) ? value as Attachment[] : undefined;
}

function resolveOutboundMedia(value: unknown): {
	images?: ImageContent[];
	attachments?: Attachment[];
} | undefined {
	const record = asRecord(value);
	if (!record) {
		return undefined;
	}
	const images =
		readMessageImages(record.images) ??
		extractRenderableAssistantImages(record) ??
		extractRenderableAssistantImages(record.meta);
	const attachments = readMessageAttachments(record.attachments) ?? buildInlineImageAttachments(images);
	return hasRenderableAssistantMedia({ images, attachments })
		? {
			...(images?.length ? { images } : {}),
			...(attachments?.length ? { attachments } : {}),
		}
		: undefined;
}

function resolveProgressToolMedia(value: unknown): {
	toolCallId?: string;
	images?: ImageContent[];
	attachments?: Attachment[];
} | undefined {
	const progress = asRecord(value);
	const latestToolResult = asRecord(progress?.latestToolResult);
	if (!latestToolResult) {
		return undefined;
	}
	const images = readMessageImages(latestToolResult.images);
	const attachments = buildInlineImageAttachments(images);
	return hasRenderableAssistantMedia({ images, attachments })
		? {
			toolCallId: asString(latestToolResult.toolCallId),
			...(images?.length ? { images } : {}),
			...(attachments?.length ? { attachments } : {}),
		}
		: undefined;
}

function buildRenderableMediaKeys(params: {
	images?: ImageContent[];
	attachments?: Attachment[];
} | undefined): string[] {
	if (!params) {
		return [];
	}
	const keys: string[] = [];
	for (const attachment of params.attachments ?? []) {
		const url = typeof attachment.url === "string" ? attachment.url.trim() : "";
		if (!url) {
			continue;
		}
		if (attachment.type === "image" && /^data:image\//i.test(url)) {
			keys.push(`image:${url}`);
			continue;
		}
		keys.push(
			[
				"attachment",
				attachment.type,
				attachment.mimeType ?? "",
				attachment.name ?? "",
				url,
			].join(":"),
		);
	}
	for (const image of params.images ?? []) {
		if (typeof image?.mimeType !== "string" || typeof image?.data !== "string") {
			continue;
		}
		keys.push(`image:data:${image.mimeType};base64,${image.data}`);
	}
	return keys;
}

function filterRenderableMedia(params: {
	images?: ImageContent[];
	attachments?: Attachment[];
} | undefined, deliveredKeys: Set<string>): {
	images?: ImageContent[];
	attachments?: Attachment[];
} | undefined {
	if (!params) {
		return undefined;
	}
	const nextKeys = new Set(deliveredKeys);
	const filteredAttachments = (params.attachments ?? []).filter((attachment) => {
		const url = typeof attachment.url === "string" ? attachment.url.trim() : "";
		if (!url) {
			return false;
		}
		const key =
			attachment.type === "image" && /^data:image\//i.test(url)
				? `image:${url}`
				: [
					"attachment",
					attachment.type,
					attachment.mimeType ?? "",
					attachment.name ?? "",
					url,
				].join(":");
		if (nextKeys.has(key)) {
			return false;
		}
		nextKeys.add(key);
		return true;
	});
	const filteredImages = (params.images ?? []).filter((image) => {
		if (typeof image?.mimeType !== "string" || typeof image?.data !== "string") {
			return false;
		}
		const key = `image:data:${image.mimeType};base64,${image.data}`;
		if (nextKeys.has(key)) {
			return false;
		}
		nextKeys.add(key);
		return true;
	});
	return hasRenderableAssistantMedia({
		...(filteredImages.length ? { images: filteredImages } : {}),
		...(filteredAttachments.length ? { attachments: filteredAttachments } : {}),
	})
		? {
			...(filteredImages.length ? { images: filteredImages } : {}),
			...(filteredAttachments.length ? { attachments: filteredAttachments } : {}),
		}
		: undefined;
}

function humanizeProgressRoute(route?: string): string | undefined {
	const normalized = asString(route)?.toLowerCase();
	if (!normalized) {
		return undefined;
	}
	switch (normalized) {
		case "gui":
			return "GUI";
		case "browser":
			return "Browser";
		case "shell":
			return "Shell";
		default:
			return normalized.charAt(0).toUpperCase() + normalized.slice(1);
	}
}

function resolveInboundChannelRouteId(message: InboundMessage): string {
	return asString(message.senderId) ?? message.channelId;
}

function buildAsyncReceiptText(progress?: Record<string, unknown>): string {
	const summary = asString(progress?.summary);
	const stage = asString(progress?.stage);
	const toolName = asString(progress?.toolName);
	const routeLabel = humanizeProgressRoute(asString(progress?.route));
	const steps = Array.isArray(progress?.steps)
		? progress.steps.filter((step): step is Record<string, unknown> => Boolean(step) && typeof step === "object")
		: [];
	if (!summary && !toolName && !routeLabel) {
		return "Thinking through the task...";
	}
	if (stage === "thinking" || stage === "status") {
		return summary ?? "Thinking through the task...";
	}
	const latestCompleted = [...steps]
		.reverse()
		.find((step) => asString(step.state) === "done" && asString(step.label));
	const completedLabel = asString(latestCompleted?.label);
	const toolLabel = [toolName, routeLabel]
		.filter((value, index, all) => Boolean(value) && all.indexOf(value) === index)
		.join(" · ");
	const lines = [
		"Working through the task...",
		...(toolLabel ? [`Current tool: ${toolLabel}`] : []),
		...(summary ? [`Current step: ${summary}`] : []),
		...(completedLabel && completedLabel !== summary ? [`Recent step: ${completedLabel}`] : []),
	];
	return lines.join("\n");
}

export interface SessionHandlers {
	list(params?: Record<string, unknown>): Promise<unknown>;
	get(params?: Record<string, unknown>): Promise<unknown>;
	history?(params?: Record<string, unknown>): Promise<unknown>;
	trace?(params?: Record<string, unknown>): Promise<unknown>;
	teachList?(params?: Record<string, unknown>): Promise<unknown>;
	teachCreate?(params?: Record<string, unknown>): Promise<unknown>;
	teachRecordStart?(params?: Record<string, unknown>): Promise<unknown>;
	teachRecordStatus?(params?: Record<string, unknown>): Promise<unknown>;
	teachRecordStop?(params?: Record<string, unknown>): Promise<unknown>;
	teachVideo?(params?: Record<string, unknown>): Promise<unknown>;
	teachUpdate?(params?: Record<string, unknown>): Promise<unknown>;
	teachValidate?(params?: Record<string, unknown>): Promise<unknown>;
	teachPublish?(params?: Record<string, unknown>): Promise<unknown>;
	create?(params?: Record<string, unknown>): Promise<unknown>;
	send?(params?: Record<string, unknown>): Promise<unknown>;
	patch?(params?: Record<string, unknown>): Promise<unknown>;
	reset?(params?: Record<string, unknown>): Promise<unknown>;
	delete?(params?: Record<string, unknown>): Promise<unknown>;
	compact?(params?: Record<string, unknown>): Promise<unknown>;
	branch?(params?: Record<string, unknown>): Promise<unknown>;
	spawnSubagent?(params?: Record<string, unknown>): Promise<unknown>;
	subagents?(params?: Record<string, unknown>): Promise<unknown>;
	abort?(params?: Record<string, unknown>): Promise<unknown>;
}

export class GatewayServer {
	private app: Express;
	private server: Server | null = null;
	private wss: WebSocketServer | null = null;
	private wsClients = new Set<WebSocket>();
	readonly router: MessageRouter;
	readonly pairingManager: PairingManager;
	private options: GatewayServerOptions;
	private logger = createLogger("Gateway");
	private chatHandler: ChatHandler | null = null;
	private sessionHandlers: SessionHandlers | null = null;
	private authConfig: GatewayAuthConfig;
	private rateLimiter: AuthRateLimiter | null = null;
	private startedAt: number = 0;
	private readonly rpcHandlers = new HandlerRegistry();

	constructor(options: GatewayServerOptions) {
		this.options = options;
		this.pairingManager = options.pairingStorePath
			? new PairingManager(options.pairingStorePath)
			: PairingManager.inMemory();

		this.router = new MessageRouter({
			pairingManager: this.pairingManager,
			requirePairing: options.requirePairing,
			autoRestart: options.channelAutoRestart,
			restartBaseDelayMs: options.channelRestartBaseDelayMs,
			restartMaxDelayMs: options.channelRestartMaxDelayMs,
		});

		// Resolve auth config (env vars take precedence)
		this.authConfig = resolveGatewayAuth(options.auth);

		// Set up rate limiter if auth is enabled
		if (this.authConfig.mode !== "none") {
			this.rateLimiter = new AuthRateLimiter(options.rateLimitConfig);
		}

		this.app = express();

		// Security headers on all responses
		this.app.use(securityHeaders());
		this.app.use(express.json({
			limit: process.env.UNDERSTUDY_GATEWAY_JSON_LIMIT?.trim() || "64mb",
		}));

		this.registerRpcHandlers();
		this.setupRoutes();
	}

	/** Set the chat handler that processes inbound messages via the agent */
	setChatHandler(handler: ChatHandler): void {
		this.chatHandler = handler;

		// Wire inbound channel messages to the chat handler
		this.router.onMessage(async (message: InboundMessage) => {
			if (!this.chatHandler) return;

			try {
				const chatResult = normalizeChatResult(await this.chatHandler(message.text, {
					channelId: message.channelId,
					senderId: message.senderId,
					senderName: message.senderName,
					conversationName: message.conversationName,
					conversationType: message.conversationType,
					threadId: message.threadId,
					replyToMessageId: message.replyToMessageId,
					waitForCompletion: this.options.agentWait ? false : undefined,
					attachments: message.attachments,
				}));
				await this.handleInboundChannelChatResult(message, chatResult);
			} catch (error) {
				await this.handleInboundChannelChatError(message, error);
			}
		});
	}

	setSessionHandlers(handlers: SessionHandlers): void {
		this.sessionHandlers = handlers;
	}

	/** Register a custom RPC handler. Returns false when the method already exists. */
	registerRpcHandler(method: string, handler: RpcHandler): boolean {
		if (this.rpcHandlers.has(method)) {
			return false;
		}
		this.rpcHandlers.register(method, handler);
		return true;
	}

	/** Check whether an RPC method is already registered. */
	hasRpcHandler(method: string): boolean {
		return this.rpcHandlers.has(method);
	}

	/** List all registered RPC methods. */
	listRpcMethods(): string[] {
		return this.rpcHandlers.listMethods();
	}

	private resolveTransportHost(): string {
		return asString(this.options.host) ?? "0.0.0.0";
	}

	private resolveTransportPort(): number {
		const address = this.server?.address();
		if (address && typeof address !== "string") {
			return address.port;
		}
		return this.options.port;
	}

	private buildCapabilityInventory(): GatewayCapabilityInventory {
		const methods = this.listRpcMethods()
			.slice()
			.sort((left, right) => left.localeCompare(right))
			.map(describeCapabilityMethod);
		const namespaces = new Map<string, { methods: string[]; groups: Set<string> }>();
		const groups = new Map<string, { namespace: string; methods: string[] }>();

		for (const method of methods) {
			const namespaceEntry = namespaces.get(method.namespace) ?? {
				methods: [],
				groups: new Set<string>(),
			};
			namespaceEntry.methods.push(method.name);
			namespaceEntry.groups.add(method.group);
			namespaces.set(method.namespace, namespaceEntry);

			const groupEntry = groups.get(method.group) ?? {
				namespace: method.namespace,
				methods: [],
			};
			groupEntry.methods.push(method.name);
			groups.set(method.group, groupEntry);
		}

		return {
			methods,
			namespaces: Array.from(namespaces.entries())
				.map(([name, entry]) => ({
					name,
					methodCount: entry.methods.length,
					methods: entry.methods,
					groups: Array.from(entry.groups).sort((left, right) => left.localeCompare(right)),
				}))
				.sort(compareByName),
			groups: Array.from(groups.entries())
				.map(([name, entry]) => ({
					name,
					namespace: entry.namespace,
					methodCount: entry.methods.length,
					methods: entry.methods,
				}))
				.sort(compareByName),
		};
	}

	private buildCapabilityTransportInfo(): GatewayCapabilityTransportInfo {
		const host = this.resolveTransportHost();
		const port = this.resolveTransportPort();
		const auth = {
			mode: this.authConfig.mode,
			required: this.authConfig.mode !== "none",
		};
		return {
			http: {
				enabled: true,
				host,
				port,
				auth,
				routes: {
					rpc: "/rpc",
					rpcView: "/rpc-view",
					health: "/health",
					chat: "/chat",
					channels: "/channels",
				},
			},
			websocket: {
				enabled: true,
				host,
				port,
				path: "/",
				sharedPort: true,
				auth,
			},
		};
	}

	private buildCapabilitiesResult(): GatewayCapabilitiesResult {
		return {
			schemaVersion: 1,
			generatedAt: Date.now(),
			inventory: this.buildCapabilityInventory(),
			transport: this.buildCapabilityTransportInfo(),
		};
	}

	/** Add a channel to the gateway */
	addChannel(channel: ChannelAdapter): void {
		this.router.addChannel(channel);
	}

	/** Start the gateway server */
	async start(): Promise<void> {
		if (this.server) return;

		this.startedAt = Date.now();
		await this.router.startAll();

		this.server = createServer(this.app);

		// Set up WebSocket server
		this.wss = new WebSocketServer({ server: this.server });
		this.wss.on("connection", (ws, req) => {
			// Authenticate WS connections
			if (this.authConfig.mode !== "none") {
				const clientIp = resolveClientIp(
					req as any,
					this.options.trustedProxies,
				);

				// Rate limit check
				if (this.rateLimiter && !this.rateLimiter.check(clientIp)) {
					ws.close(4029, "Too many authentication attempts");
					return;
				}

				// Extract credential: prefer Authorization header, fall back to query param
				let credential: string | undefined;
				const authHeader = req.headers.authorization;
				if (authHeader?.startsWith("Bearer ")) {
					credential = authHeader.slice(7).trim();
				} else {
					const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
					credential = url.searchParams.get("token") ?? undefined;
				}

				const authError = authorizeGatewayRequest(this.authConfig, credential);
				if (authError) {
					this.rateLimiter?.record(clientIp);
					ws.close(4001, authError);
					return;
				}
			}

			this.wsClients.add(ws);
			ws.on("close", () => this.wsClients.delete(ws));
			ws.on("error", () => this.wsClients.delete(ws));

			ws.on("message", (data) => {
				try {
					const request = JSON.parse(data.toString()) as GatewayRequest;
					this.handleRpcRequest(request)
						.then((response) => {
							if (ws.readyState === WebSocket.OPEN) {
								ws.send(JSON.stringify(response));
							}
						})
						.catch((error) => {
							const errResponse: GatewayResponse = {
								id: request.id,
								error: { code: -1, message: error.message },
							};
							if (ws.readyState === WebSocket.OPEN) {
								ws.send(JSON.stringify(errResponse));
							}
						});
				} catch {
					// Invalid JSON, ignore
				}
			});
		});

		const host = this.options.host ?? "127.0.0.1";
		const port = this.options.port;

		await new Promise<void>((resolve, reject) => {
			this.server!.once("error", reject);
			this.server!.listen(port, host, () => {
				this.logger.info(`Gateway running at http://${host}:${port}`);
				resolve();
			});
		});
	}

	/** Stop the gateway server */
	async stop(): Promise<void> {
		await this.router.stopAll();

		for (const ws of this.wsClients) {
			ws.close(1001, "Server shutting down");
		}
		this.wsClients.clear();

		if (this.wss) {
			this.wss.close();
			this.wss = null;
		}

		if (this.server) {
			await new Promise<void>((resolve) => {
				this.server!.close(() => resolve());
			});
			this.server = null;
		}

		// Dispose rate limiter
		this.rateLimiter?.dispose();
	}

	/** Get server uptime in milliseconds */
	get uptime(): number {
		return this.startedAt > 0 ? Date.now() - this.startedAt : 0;
	}

	/** Get auth mode */
	get authMode(): string {
		return this.authConfig.mode;
	}

	/** Broadcast an event to all WebSocket clients */
	broadcastEvent(event: GatewayEvent): void {
		const data = JSON.stringify(event);
		for (const ws of this.wsClients) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(data);
			}
		}
	}

	private async sendInboundChannelMessage(
		message: InboundMessage,
		payload:
			| string
			| {
				text?: string;
				images?: ImageContent[];
				attachments?: Attachment[];
				replyToCurrent?: boolean;
				replyToMessageId?: string;
			},
	): Promise<string | undefined> {
		const channel = this.router.getChannel(message.channelId);
		if (!channel) {
			return undefined;
		}
		const text = typeof payload === "string" ? payload : asString(payload.text) ?? "";
		const images = typeof payload === "string" ? undefined : payload.images;
		const attachments = typeof payload === "string"
			? undefined
			: payload.attachments ?? buildInlineImageAttachments(images);
		const replyToMessageId = typeof payload === "string" ? undefined : asString(payload.replyToMessageId);
		const replyToCurrent = typeof payload === "string" ? false : payload.replyToCurrent === true;
		if (text.trim().length === 0 && !(attachments?.length)) {
			return undefined;
		}
		return await channel.messaging.sendMessage({
			channelId: message.channelId,
			recipientId: message.senderId,
			text,
			threadId: message.threadId,
			replyToMessageId:
				replyToMessageId ||
				(replyToCurrent || !replyToMessageId
					? message.externalMessageId ?? message.replyToMessageId
					: undefined),
			...(attachments?.length ? { attachments } : {}),
		});
	}

	private async editInboundChannelMessage(
		message: InboundMessage,
		messageId: string | undefined,
		text: string,
	): Promise<boolean> {
		const channel = this.router.getChannel(message.channelId);
		if (!channel || !messageId || text.trim().length === 0 || typeof channel.messaging.editMessage !== "function") {
			return false;
		}
		await channel.messaging.editMessage({
			channelId: resolveInboundChannelRouteId(message),
			messageId,
			recipientId: message.senderId,
			threadId: message.threadId,
			text,
		});
		return true;
	}

	private async updateInboundChannelReceipt(params: {
		message: InboundMessage;
		messageId?: string;
		text: string;
		replyToCurrent?: boolean;
		replyToMessageId?: string;
	}): Promise<string | undefined> {
		const trimmedText = params.text.trim();
		if (!trimmedText) {
			return params.messageId;
		}

		try {
			const edited = await this.editInboundChannelMessage(
				params.message,
				params.messageId,
				trimmedText,
			);
			if (edited) {
				return params.messageId;
			}
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			this.logger.warn("Failed to edit channel receipt; sending a follow-up message instead", {
				channelId: params.message.channelId,
				routeChannelId: resolveInboundChannelRouteId(params.message),
				error: detail,
			});
		}

		return await this.sendInboundChannelMessage(params.message, {
			text: trimmedText,
			replyToCurrent: params.replyToCurrent,
			replyToMessageId: params.replyToMessageId,
		}) ?? params.messageId;
	}

	private broadcastInboundChannelResponse(
		message: InboundMessage,
		payload: {
			text: string;
			runId?: string;
			sessionId?: string;
			images?: ImageContent[];
			attachments?: Attachment[];
		},
	): void {
		this.broadcastEvent({
			type: "message",
			data: {
				channelId: message.channelId,
				senderId: "agent",
				text: payload.text,
				runId: payload.runId,
				sessionId: payload.sessionId,
				...(payload.images?.length ? { images: payload.images } : {}),
				...(payload.attachments?.length ? { attachments: payload.attachments } : {}),
			},
			timestamp: Date.now(),
		});
	}

	private async handleInboundChannelChatError(
		message: InboundMessage,
		error: unknown,
	): Promise<void> {
		const errorMessage = error instanceof Error ? error.message : String(error);
		this.logger.error("Chat handler error", {
			error: errorMessage,
		});
		await this.sendInboundChannelMessage(message, `Error: ${errorMessage}`);
		this.broadcastEvent({
			type: "error",
			data: {
				channelId: message.channelId,
				senderId: "agent",
				error: errorMessage,
			},
			timestamp: Date.now(),
		});
	}

	private async waitForChannelRunCompletion(params: {
		message: InboundMessage;
		runId: string;
		sessionId?: string;
		receiptMessageId?: string;
		receiptText?: string;
	}): Promise<void> {
		if (!this.options.agentWait) {
			return;
		}
		let receiptText = params.receiptText ?? buildAsyncReceiptText();
		let receiptMessageId = params.receiptMessageId;
		let lastDeliveredProgressToolCallId: string | undefined;
		const deliveredProgressMediaKeys = new Set<string>();
		for (;;) {
			try {
				const waitResult = asRecord(await this.options.agentWait({
					runId: params.runId,
					sessionId: params.sessionId,
					timeoutMs: CHANNEL_BACKGROUND_WAIT_TIMEOUT_MS,
				}));
				const status = asString(waitResult.status);
				if (status === "timeout") {
					const progress = asRecord(waitResult.progress);
					const progressMedia = resolveProgressToolMedia(progress);
					if (
						progressMedia &&
						progressMedia.toolCallId &&
						progressMedia.toolCallId !== lastDeliveredProgressToolCallId
					) {
						await this.sendInboundChannelMessage(params.message, {
							text: "",
							images: progressMedia.images,
							attachments: progressMedia.attachments,
						});
						lastDeliveredProgressToolCallId = progressMedia.toolCallId;
						for (const key of buildRenderableMediaKeys(progressMedia)) {
							deliveredProgressMediaKeys.add(key);
						}
					}
					const nextReceiptText = buildAsyncReceiptText(progress);
					if (nextReceiptText.trim().length > 0 && nextReceiptText !== receiptText) {
						receiptMessageId = await this.updateInboundChannelReceipt({
							message: params.message,
							messageId: receiptMessageId,
							text: nextReceiptText,
						});
						receiptText = nextReceiptText;
					}
					continue;
				}
				if (status === "ok") {
					const normalizedWaitResult = normalizeChatResult(waitResult);
					const response = normalizedWaitResult.response;
					const media = resolveOutboundMedia(waitResult);
					const undeliveredMedia = filterRenderableMedia(media, deliveredProgressMediaKeys);
					if (hasRenderableAssistantMedia(media)) {
						const receiptText = response.trim() || "Done.";
						if (receiptText) {
							receiptMessageId = await this.updateInboundChannelReceipt({
								message: params.message,
								messageId: receiptMessageId,
								text: receiptText,
								replyToCurrent: normalizedWaitResult.replyToCurrent,
								replyToMessageId: normalizedWaitResult.replyToMessageId,
							});
						}
						if (undeliveredMedia) {
							await this.sendInboundChannelMessage(params.message, {
								text: receiptMessageId ? "" : response,
								images: undeliveredMedia.images,
								attachments: undeliveredMedia.attachments,
								replyToCurrent: normalizedWaitResult.replyToCurrent,
								replyToMessageId: normalizedWaitResult.replyToMessageId,
							});
						}
						this.broadcastInboundChannelResponse(params.message, {
							text: response,
							runId: asString(waitResult.runId) ?? params.runId,
							sessionId: asString(waitResult.sessionId) ?? params.sessionId,
							...(media?.images?.length ? { images: media.images } : {}),
							...(media?.attachments?.length ? { attachments: media.attachments } : {}),
						});
						return;
					}
					if (response.trim().length > 0) {
						receiptMessageId = await this.updateInboundChannelReceipt({
							message: params.message,
							messageId: receiptMessageId,
							text: response,
							replyToCurrent: normalizedWaitResult.replyToCurrent,
							replyToMessageId: normalizedWaitResult.replyToMessageId,
						});
						this.broadcastInboundChannelResponse(params.message, {
							text: response,
							runId: asString(waitResult.runId) ?? params.runId,
							sessionId: asString(waitResult.sessionId) ?? params.sessionId,
						});
					}
					return;
				}
				if (status === "error") {
					const errorMessage = `Error: ${asString(waitResult.error) ?? "Agent run failed."}`;
					const nextMessageId = await this.updateInboundChannelReceipt({
						message: params.message,
						messageId: receiptMessageId,
						text: errorMessage,
					});
					if (!nextMessageId) {
						await this.handleInboundChannelChatError(
							params.message,
							asString(waitResult.error) ?? "Agent run failed.",
						);
					}
					return;
				}
				return;
			} catch (error) {
				await this.handleInboundChannelChatError(params.message, error);
				return;
			}
		}
	}

	private async handleInboundChannelChatResult(
		message: InboundMessage,
		chatResult: ChatHandlerResult,
	): Promise<void> {
		if (
			chatResult.status === "in_flight" &&
			typeof chatResult.runId === "string" &&
			this.options.agentWait
		) {
			try {
				const quickWait = asRecord(await this.options.agentWait({
					runId: chatResult.runId,
					sessionId: chatResult.sessionId,
					timeoutMs: CHANNEL_FAST_WAIT_TIMEOUT_MS,
				}));
				const quickStatus = asString(quickWait.status);
				if (quickStatus === "ok") {
					const normalizedQuickResult = normalizeChatResult(quickWait);
					const quickMedia = resolveOutboundMedia(quickWait);
					await this.sendInboundChannelMessage(message, {
						text: normalizedQuickResult.response,
						images: quickMedia?.images,
						attachments: quickMedia?.attachments,
						replyToCurrent: normalizedQuickResult.replyToCurrent,
						replyToMessageId: normalizedQuickResult.replyToMessageId,
					});
					this.broadcastInboundChannelResponse(message, {
						text: normalizedQuickResult.response,
						runId: asString(quickWait.runId) ?? chatResult.runId,
						sessionId: asString(quickWait.sessionId) ?? chatResult.sessionId,
						...(quickMedia?.images?.length ? { images: quickMedia.images } : {}),
						...(quickMedia?.attachments?.length ? { attachments: quickMedia.attachments } : {}),
					});
					return;
				}
				if (quickStatus === "error") {
					await this.handleInboundChannelChatError(
						message,
						asString(quickWait.error) ?? "Agent run failed.",
					);
					return;
				}
			} catch (error) {
				await this.handleInboundChannelChatError(message, error);
				return;
			}

			const receiptText = chatResult.response.trim() || buildAsyncReceiptText();
			const receiptMessageId = await this.sendInboundChannelMessage(message, receiptText);
			this.broadcastInboundChannelResponse(message, {
				text: receiptText,
				runId: chatResult.runId,
				sessionId: chatResult.sessionId,
			});
			void this.waitForChannelRunCompletion({
				message,
				runId: chatResult.runId,
				sessionId: chatResult.sessionId,
				receiptMessageId,
				receiptText,
			});
			return;
		}

		const chatMedia = resolveOutboundMedia(chatResult);
		await this.sendInboundChannelMessage(message, {
			text: chatResult.response,
			images: chatMedia?.images,
			attachments: chatMedia?.attachments,
			replyToCurrent: chatResult.replyToCurrent,
			replyToMessageId: chatResult.replyToMessageId,
		});
		this.broadcastInboundChannelResponse(message, {
			text: chatResult.response,
			runId: chatResult.runId,
			sessionId: chatResult.sessionId,
			...(chatMedia?.images?.length ? { images: chatMedia.images } : {}),
			...(chatMedia?.attachments?.length ? { attachments: chatMedia.attachments } : {}),
		});
	}

	private buildHandlerContext(): HandlerContext {
		return {
			getRouter: () => this.router,
			getPairingManager: () => this.pairingManager,
			getChatHandler: () => this.chatHandler,
			getSessionHandlers: () => this.sessionHandlers,
		};
	}

	private registerRpcHandlers(): void {
		const context = this.buildHandlerContext();

		const healthHandlers = createHealthHandlers({
			getUptime: () => this.uptime,
			getAuthMode: () => this.authMode,
			getReadiness: this.options.healthHandlers?.getReadiness,
			getChannelStatuses: async () =>
				(await this.router.listChannelRuntimeStatuses()).map(({ channel, runtime }) => ({
					id: channel.id,
					name: channel.name,
					state: runtime.state,
					summary: runtime.summary,
					updatedAt: runtime.updatedAt,
					...(runtime.startedAt ? { startedAt: runtime.startedAt } : {}),
					...(runtime.lastError ? { lastError: runtime.lastError } : {}),
					...(typeof runtime.restartAttempt === "number"
						? { restartAttempt: runtime.restartAttempt }
						: {}),
				})),
		});
		this.rpcHandlers.register("health", (request) => healthHandlers.health(request, context));
		this.rpcHandlers.register("runtime.readiness", (request) => healthHandlers.runtimeReadiness(request, context));
		const registerOptionalRpcHandler = (
			method: string,
			handler: ((params: Record<string, unknown>) => Promise<unknown>) | undefined,
			message: string = `${method} handler not configured`,
		): void => {
			this.rpcHandlers.register(method, async (request) => {
				if (!handler) {
					return {
						id: request.id,
						error: { code: 503, message },
					};
				}
				return {
					id: request.id,
					result: await handler(request.params),
				};
			});
		};
		this.rpcHandlers.register("chat.send", (request) => chatSend(request, context));
		this.rpcHandlers.register("chat.stream", (request) => chatStream(request, context));
		this.rpcHandlers.register("chat.abort", (request) => chatAbort(request, context));
		registerOptionalRpcHandler("agent.identity.get", this.options.agentIdentityGet);
		registerOptionalRpcHandler("agent.wait", this.options.agentWait);
		registerOptionalRpcHandler("agents.list", this.options.agentsList);
		registerOptionalRpcHandler("agents.create", this.options.agentsCreate);
		registerOptionalRpcHandler("agents.update", this.options.agentsUpdate);
		registerOptionalRpcHandler("agents.delete", this.options.agentsDelete);
		registerOptionalRpcHandler("agents.files.list", this.options.agentsFilesList);
		registerOptionalRpcHandler("agents.files.get", this.options.agentsFilesGet);
		registerOptionalRpcHandler("agents.files.set", this.options.agentsFilesSet);
		this.rpcHandlers.register("message.action", (request) => messageAction(request, context));
		registerOptionalRpcHandler("browser.request", this.options.browserRequest);
		registerOptionalRpcHandler("web.login.start", this.options.webLoginStart);
		registerOptionalRpcHandler("web.login.wait", this.options.webLoginWait);
		registerOptionalRpcHandler("secrets.reload", this.options.secretsReload);
		registerOptionalRpcHandler("secrets.resolve", this.options.secretsResolve);
		registerOptionalRpcHandler("exec.approval.request", this.options.execApprovalRequest);
		registerOptionalRpcHandler("exec.approval.waitDecision", this.options.execApprovalWaitDecision);
		registerOptionalRpcHandler("exec.approval.resolve", this.options.execApprovalResolve);
		registerOptionalRpcHandler("exec.approvals.get", this.options.execApprovalsGet);
		registerOptionalRpcHandler("exec.approvals.set", this.options.execApprovalsSet);
		registerOptionalRpcHandler("exec.approvals.node.get", this.options.execApprovalsNodeGet);
		registerOptionalRpcHandler("exec.approvals.node.set", this.options.execApprovalsNodeSet);

		this.rpcHandlers.register("channel.list", (request) => channelList(request, context));
		this.rpcHandlers.register("channel.status", (request) => channelStatus(request, context));
		this.rpcHandlers.register("channel.logout", (request) => channelLogout(request, context));

		this.rpcHandlers.register("session.list", (request) => sessionList(request, context));
		this.rpcHandlers.register("session.get", (request) => sessionGet(request, context));
		this.rpcHandlers.register("session.history", (request) => sessionHistory(request, context));
		this.rpcHandlers.register("session.trace", (request) => sessionTrace(request, context));
		this.rpcHandlers.register("session.teach.list", (request) => sessionTeachList(request, context));
		this.rpcHandlers.register("session.teach.create", (request) => sessionTeachCreate(request, context));
		this.rpcHandlers.register("session.teach.record.start", (request) =>
			sessionTeachRecordStart(request, context)
		);
		this.rpcHandlers.register("session.teach.record.status", (request) =>
			sessionTeachRecordStatus(request, context)
		);
		this.rpcHandlers.register("session.teach.record.stop", (request) =>
			sessionTeachRecordStop(request, context)
		);
		this.rpcHandlers.register("session.teach.video", (request) => sessionTeachVideo(request, context));
		this.rpcHandlers.register("session.teach.update", (request) => sessionTeachUpdate(request, context));
		this.rpcHandlers.register("session.teach.validate", (request) => sessionTeachValidate(request, context));
		this.rpcHandlers.register("session.teach.publish", (request) => sessionTeachPublish(request, context));
		this.rpcHandlers.register("session.create", (request) => sessionCreate(request, context));
		this.rpcHandlers.register("session.send", (request) => sessionSend(request, context));
		this.rpcHandlers.register("session.patch", (request) => sessionPatch(request, context));
		this.rpcHandlers.register("session.reset", (request) => sessionReset(request, context));
		this.rpcHandlers.register("session.delete", (request) => sessionDelete(request, context));
		this.rpcHandlers.register("session.compact", (request) => sessionCompact(request, context));
		this.rpcHandlers.register("session.branch", (request) => sessionBranch(request, context));
		this.rpcHandlers.register("sessions.spawn", (request) => sessionsSpawn(request, context));
		this.rpcHandlers.register("subagents", (request) => subagentsAction(request, context));

		this.rpcHandlers.register("pairing.request", (request) => pairingRequest(request, context));
		this.rpcHandlers.register("pairing.approve", (request) => pairingApprove(request, context));
		this.rpcHandlers.register("pairing.reject", (request) => pairingReject(request, context));

		const configHandlers = createConfigHandlers(this.options.configHandlers ?? {
			getConfig: () => ({}),
		});
		this.rpcHandlers.register("config.get", (request) => configHandlers.configGet(request, context));
		this.rpcHandlers.register("config.apply", (request) => configHandlers.configApply(request, context));
		this.rpcHandlers.register("config.schema", (request) => configHandlers.configSchema(request, context));
		this.rpcHandlers.register("config.reload", async (request) => {
			if (!this.options.reloadConfig) {
				return {
					id: request.id,
					result: { reloaded: false, message: "config.reload is not wired in this gateway mode" },
				};
			}
			const result = await this.options.reloadConfig();
			return { id: request.id, result: result ?? { reloaded: true } };
		});

		const scheduleHandlers = createScheduleHandlers(this.options.scheduleHandlers ?? {
				list: async () => [],
				status: async () => ({ enabled: false, count: 0 }),
			});
		this.rpcHandlers.register("schedule.list", (request) => scheduleHandlers.scheduleList(request, context));
		this.rpcHandlers.register("schedule.status", (request) => scheduleHandlers.scheduleStatus(request, context));
		this.rpcHandlers.register("schedule.add", (request) => scheduleHandlers.scheduleAdd(request, context));
		this.rpcHandlers.register("schedule.update", (request) => scheduleHandlers.scheduleUpdate(request, context));
		this.rpcHandlers.register("schedule.remove", (request) => scheduleHandlers.scheduleRemove(request, context));
		this.rpcHandlers.register("schedule.run", (request) => scheduleHandlers.scheduleRun(request, context));
		this.rpcHandlers.register("schedule.runs", (request) => scheduleHandlers.scheduleRuns(request, context));

		const discoveryHandlers = createDiscoveryHandlers(Object.assign({}, this.options.discoveryHandlers, {
			buildCapabilities: () => this.buildCapabilitiesResult(),
			getCapabilities: this.options.capabilitiesGet
				? ({ request, defaults }: Pick<GatewayCapabilitiesHookInput, "request" | "defaults">) =>
					this.options.capabilitiesGet?.({
						request,
						defaults,
						context,
						methods: defaults.inventory.methods.map((entry) => entry.name),
						namespaces: defaults.inventory.namespaces.map((entry) => ({
							id: entry.name,
							count: entry.methodCount,
							methods: entry.methods,
						})),
						authMode: this.authConfig.mode,
						transport: {
							httpRpc: true,
							wsRpc: true,
							wsEvents: true,
							singlePort: true,
						},
					})
				: this.options.discoveryHandlers?.getCapabilities,
		}));
		this.rpcHandlers.register("capabilities.get", (request) =>
			discoveryHandlers.capabilitiesGet(request, context),
		);
		this.rpcHandlers.register("models.list", (request) => discoveryHandlers.modelsList(request, context));
		this.rpcHandlers.register("tools.catalog", (request) =>
			discoveryHandlers.toolsCatalog(request, context),
		);
		this.rpcHandlers.register("skills.status", (request) =>
			discoveryHandlers.skillsStatus(request, context),
		);
		registerOptionalRpcHandler("skills.install", this.options.skillsInstall);
		registerOptionalRpcHandler("skills.update", this.options.skillsUpdate);

		const usageHandlers = createUsageHandlers(this.options.usageHandlers ?? {});
		this.rpcHandlers.register("usage.summary", (request) => usageHandlers.usageSummary(request, context));
		this.rpcHandlers.register("usage.daily", (request) => usageHandlers.usageDaily(request, context));
		this.rpcHandlers.register("usage.status", (request) => usageHandlers.usageStatus(request, context));
		this.rpcHandlers.register("usage.cost", (request) => usageHandlers.usageCost(request, context));

		this.rpcHandlers.register("logs.tail", async (request) => {
			if (this.options.logsTail) {
				return {
					id: request.id,
					result: await this.options.logsTail(request.params),
				};
			}
			const limitRaw = request.params.limit ?? request.params.tail ?? 50;
			const parsed = Number.parseInt(String(limitRaw), 10);
			const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
			return {
				id: request.id,
				result: {
					lines: [],
					limit,
					message: "No logs.tail handler configured",
				},
			};
		});
	}

	private setupRoutes(): void {
		mountControlUi(this.app, { assistantName: "Understudy" });

		this.app.get("/", (req, res) => {
			const query = req.originalUrl.includes("?")
				? req.originalUrl.slice(req.originalUrl.indexOf("?"))
				: "";
			res.redirect(`/webchat${query}`);
		});
		this.app.get("/chat", (req, res) => {
			const query = req.originalUrl.includes("?")
				? req.originalUrl.slice(req.originalUrl.indexOf("?"))
				: "";
			res.redirect(`/webchat${query}`);
		});
		this.app.get("/dashboard", (req, res) => {
			const query = req.originalUrl.includes("?")
				? req.originalUrl.slice(req.originalUrl.indexOf("?"))
				: "";
			res.redirect(`/ui${query}`);
		});

		// Health check — always accessible (no auth required)
		this.app.get("/health", (_req, res) => {
			const mem = process.memoryUsage();
			res.json({
				status: "ok",
				version: GATEWAY_VERSION,
				uptime: this.uptime,
				channels: this.router.listChannels().map((c) => c.id),
				memory: {
					heapUsed: mem.heapUsed,
					heapTotal: mem.heapTotal,
				},
				auth: { mode: this.authConfig.mode },
			});
		});

		// Auth middleware for protected routes
		const authMiddleware = createAuthMiddleware({
			auth: this.authConfig,
			rateLimiter: this.rateLimiter ?? undefined,
			trustedProxies: this.options.trustedProxies,
		});

		// RPC endpoint (auth-protected)
		this.app.post("/rpc", authMiddleware, async (req, res) => {
			try {
				const request = req.body as GatewayRequest;
				const response = await this.handleRpcRequest(request);
				res.json(response);
			} catch (error: any) {
				res.status(500).json({
					id: req.body?.id ?? "unknown",
					error: { code: -1, message: error.message },
				});
			}
		});

		// Direct HTTP chat endpoint (auth-protected)
		this.app.post("/chat", authMiddleware, async (req, res) => {
			if (!this.chatHandler) {
				res.status(503).json({ error: "No chat handler configured" });
				return;
			}
			const {
				text: rawText,
				channelId,
				senderId,
				conversationType,
				threadId,
				cwd,
				forceNew,
				configOverride,
				sandboxInfo,
				executionScopeKey,
				waitForCompletion,
				images,
				attachments,
			} = req.body ?? {};
			const text = asString(rawText);
			const chatImages = Array.isArray(images) ? images as ImageContent[] : undefined;
			const chatAttachments = Array.isArray(attachments) ? attachments as Attachment[] : undefined;
			if (!text && !(chatImages?.length || chatAttachments?.length)) {
				res.status(400).json({ error: "text or media is required" });
				return;
			}
			try {
				const result = normalizeChatResult(await this.chatHandler(text ?? "", {
					channelId: asString(channelId),
					senderId: asString(senderId),
					senderName: asString(req.body?.senderName),
					conversationName: asString(req.body?.conversationName),
					conversationType:
						conversationType === "direct" || conversationType === "group" || conversationType === "thread"
							? conversationType
							: undefined,
					threadId: asString(threadId),
					cwd: asString(cwd),
					forceNew: typeof forceNew === "boolean" ? forceNew : undefined,
					configOverride:
						configOverride && typeof configOverride === "object" && !Array.isArray(configOverride)
							? configOverride as Record<string, unknown>
							: undefined,
					sandboxInfo:
						sandboxInfo && typeof sandboxInfo === "object" && !Array.isArray(sandboxInfo)
							? sandboxInfo as Record<string, unknown>
							: undefined,
					executionScopeKey: asString(executionScopeKey),
					waitForCompletion: typeof waitForCompletion === "boolean" ? waitForCompletion : undefined,
					images: chatImages,
					attachments: chatAttachments,
				}));
				res.json(result);
			} catch (error: any) {
				res.status(500).json({ error: error.message });
			}
		});

		// Channel status
		this.app.get("/channels", async (_req, res) => {
			const channels = await this.router.listChannelRuntimeStatuses();
			res.json({
				channels: channels.map(({ channel, runtime }) => ({
					id: channel.id,
					name: channel.name,
					capabilities: channel.capabilities,
					runtime,
				})),
			});
		});

		// Built-in WebChat page
		this.app.get("/webchat", (_req, res) => {
			res.setHeader("content-type", "text/html; charset=utf-8");
			res.send(buildWebChatHtml());
		});

		this.app.get("/rpc-view", authMiddleware, async (req, res) => {
			const method = typeof req.query.method === "string" ? req.query.method : "";
			const params = Object.fromEntries(
				Object.entries(req.query)
					.filter(([key]) => key !== "method")
					.map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
			);
			if (!method) {
				res.status(400).send("method is required");
				return;
			}
			const result = await this.rpcHandlers.dispatch({
				id: "rpc-view",
				method: method as any,
				params,
			}, this.buildHandlerContext());
			res.setHeader("content-type", "text/html; charset=utf-8");
			if (result.error) {
				res.status(400).send(`<pre>${JSON.stringify(result.error, null, 2)}</pre>`);
				return;
			}
			res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${method}</title><style>body{font-family:ui-monospace,SFMono-Regular,monospace;margin:24px;background:#faf7f3;color:#231c18}pre{white-space:pre-wrap;word-break:break-word;border:1px solid #ddd;padding:16px;border-radius:12px;background:#fff}</style></head><body><h1>${method}</h1><pre>${JSON.stringify(result.result, null, 2)}</pre></body></html>`);
		});

		// Pairing endpoints (auth-protected)
		this.app.post("/pairing/request", authMiddleware, (req, res) => {
			const { channelId } = req.body;
			if (!channelId) {
				res.status(400).json({ error: "channelId required" });
				return;
			}
			const code = this.pairingManager.generateCode(channelId);
			res.json({ code });
		});

		this.app.get("/pairing/allowed/:channelId", authMiddleware, (req, res) => {
			const channelId = Array.isArray(req.params.channelId)
				? req.params.channelId[0]
				: req.params.channelId;
			const allowed = this.pairingManager.listAllowed(channelId);
			res.json({ allowed });
		});
	}

	private async handleRpcRequest(request: GatewayRequest): Promise<GatewayResponse> {
		return this.rpcHandlers.dispatch(request, this.buildHandlerContext());
	}
}
