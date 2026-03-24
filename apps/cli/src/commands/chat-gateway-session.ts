import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { UnderstudyConfig } from "@understudy/types";
import type { ImageContent, Model } from "@mariozechner/pi-ai";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import type { GatewayRpcClient } from "../rpc-client.js";
import {
	CHAT_GATEWAY_CHANNEL_ID,
	CHAT_GATEWAY_SENDER_ID,
	GATEWAY_COMPACT_KEEP,
	GATEWAY_MESSAGE_API,
	GATEWAY_SESSION_PATH_PREFIX,
} from "./chat-constants.js";
import { parseModelRef, resolveCliModel } from "./model-support.js";

type InteractiveSessionLike = {
	agent: {
		state: {
			messages: Array<Record<string, unknown>>;
		};
		replaceMessages?: (messages: Array<Record<string, unknown>>) => void;
		sessionId?: string;
	};
	sessionManager: {
		getSessionId?: () => string;
		getSessionName?: () => string | undefined;
		appendSessionInfo?: (name: string) => unknown;
		getSessionFile?: () => string | undefined;
		getSessionDir?: () => string;
		getCwd?: () => string;
		getEntries?: () => Array<Record<string, unknown>>;
		getEntry?: (id: string) => Record<string, unknown> | undefined;
		getLabel?: (id: string) => string | undefined;
		appendLabelChange?: (id: string, label?: string) => unknown;
		getTree?: () => Array<Record<string, unknown>>;
		getLeafId?: () => string | null | undefined;
		getBranch?: (id?: string | null) => Array<Record<string, unknown>>;
		buildSessionContext?: () => {
			messages: Array<Record<string, unknown>>;
			thinkingLevel: string;
			model: { provider: string; modelId: string } | null;
		};
	};
	model?: Model<any>;
	thinkingLevel?: string;
	promptTemplates?: Array<{ name: string; description?: string; content?: string }>;
	extensionRunner?: {
		getCommand?: (name: string) => unknown;
		hasHandlers?: (name: string) => boolean;
		emitInput?: (
			text: string,
			images: ImageContent[] | undefined,
			source: string,
		) => Promise<{
			action: "handled" | "transform" | "continue";
			text: string;
			images?: ImageContent[];
		}>;
	};
	prompt?: (text: string, options?: Record<string, unknown>) => Promise<void>;
	followUp?: (text: string, images?: ImageContent[]) => Promise<void>;
	steer?: (text: string, images?: ImageContent[]) => Promise<void>;
	clearQueue?: () => { steering: string[]; followUp: string[] };
	getUserMessagesForForking?: () => Array<{ entryId: string; text: string }>;
	sendCustomMessage?: (
		message: {
			customType: string;
			content: string;
			display: boolean;
			details?: Record<string, unknown>;
		},
		options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
	) => Promise<void>;
	getSessionStats?: () => unknown;
	getLastAssistantText?: () => string;
	compact?: (customInstructions?: string) => Promise<Record<string, unknown>>;
	reload?: () => Promise<void>;
	abort?: () => Promise<void>;
	fork?: (entryId: string) => Promise<Record<string, unknown>>;
	navigateTree?: (
		entryId: string,
		options?: { summarize?: boolean; customInstructions?: string },
	) => Promise<Record<string, unknown>>;
	newSession?: (options?: Record<string, unknown>) => Promise<boolean>;
	switchSession?: (sessionPath: string) => Promise<boolean>;
	setModel?: (model: Model<any>) => Promise<void>;
	cycleModel?: (
		direction?: "forward" | "backward",
	) => Promise<{ model: Model<any>; thinkingLevel: string; isScoped: boolean } | undefined>;
	setThinkingLevel?: (level: string) => void;
	cycleThinkingLevel?: () => string | undefined;
	_expandSkillCommand?: (text: string) => string;
	_queueFollowUp?: (text: string, images?: ImageContent[]) => Promise<void>;
	_queueSteer?: (text: string, images?: ImageContent[]) => Promise<void>;
};

interface GatewaySessionSummary {
	id: string;
	sessionName?: string;
	model?: string;
	thinkingLevel?: string;
	messageCount?: number;
	workspaceDir?: string;
	parentId?: string;
	senderName?: string;
	conversationName?: string;
	createdAt?: number;
	lastActiveAt?: number;
}

interface GatewaySessionHistoryEntry {
	role: "user" | "assistant";
	text: string;
	timestamp: number;
}

interface GatewaySessionHistoryResult {
	sessionId: string;
	messages?: GatewaySessionHistoryEntry[];
}

interface GatewaySessionSendResult {
	response?: string;
	runId?: string;
	sessionId?: string;
	status?: string;
	meta?: Record<string, unknown>;
}

interface SyntheticGatewayEntry {
	type: "message";
	id: string;
	parentId: string | null;
	timestamp: string;
	message: Record<string, unknown>;
}

interface CreateGatewayBackedInteractiveSessionOptions {
	baseSession: InteractiveSessionLike;
	client: GatewayRpcClient;
	gatewayUrl: string;
	gatewayToken?: string;
	cwd: string;
	forceNew: boolean;
	configOverride?: Partial<UnderstudyConfig>;
}

function cloneValue<T>(value: T): T {
	if (typeof structuredClone === "function") {
		return structuredClone(value);
	}
	return JSON.parse(JSON.stringify(value)) as T;
}

function zeroUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
	};
}

function parseCommandArgs(argsString: string): string[] {
	const args: string[] = [];
	let current = "";
	let inQuote: "\"" | "'" | null = null;
	for (const char of argsString) {
		if (inQuote) {
			if (char === inQuote) {
				inQuote = null;
			} else {
				current += char;
			}
			continue;
		}
		if (char === "\"" || char === "'") {
			inQuote = char;
			continue;
		}
		if (char === " " || char === "\t") {
			if (current) {
				args.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}
	if (current) {
		args.push(current);
	}
	return args;
}

function substituteArgs(template: string, args: string[]): string {
	let result = template.replace(/\$(\d+)/g, (_match, digits: string) => {
		const index = Number.parseInt(digits, 10) - 1;
		return args[index] ?? "";
	});
	result = result.replace(/\$\{@:(\d+)(?::(\d+))?\}/g, (_match, startDigits: string, lengthDigits?: string) => {
		const start = Math.max(0, Number.parseInt(startDigits, 10) - 1);
		if (lengthDigits) {
			const length = Number.parseInt(lengthDigits, 10);
			return args.slice(start, start + length).join(" ");
		}
		return args.slice(start).join(" ");
	});
	const joined = args.join(" ");
	result = result.replace(/\$ARGUMENTS/g, joined);
	result = result.replace(/\$@/g, joined);
	return result;
}

function expandPromptTemplateText(
	text: string,
	templates: Array<{ name: string; content?: string }>,
): string {
	if (!text.startsWith("/")) {
		return text;
	}
	const spaceIndex = text.indexOf(" ");
	const templateName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
	const argsString = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);
	const template = templates.find((entry) => entry.name === templateName && typeof entry.content === "string");
	if (!template?.content) {
		return text;
	}
	return substituteArgs(template.content, parseCommandArgs(argsString));
}

function buildUserMessage(text: string, images?: ImageContent[]): Record<string, unknown> {
	const content: Array<Record<string, unknown>> = [];
	if (text) {
		content.push({ type: "text", text });
	}
	if (Array.isArray(images)) {
		content.push(...images.map((image) => image as unknown as Record<string, unknown>));
	}
	return {
		role: "user",
		content,
		timestamp: Date.now(),
	};
}

function buildAssistantMessage(params?: {
	text?: string;
	thinking?: string;
	stopReason?: "stop" | "error" | "aborted";
	errorMessage?: string;
	model?: Model<any>;
}): Record<string, unknown> {
	const content: Array<Record<string, unknown>> = [];
	if (params?.thinking) {
		content.push({ type: "thinking", thinking: params.thinking });
	}
	if (params?.text) {
		content.push({ type: "text", text: params.text });
	}
	return {
		role: "assistant",
		content,
		api: GATEWAY_MESSAGE_API,
		provider: params?.model?.provider ?? "understudy-gateway",
		model: params?.model?.id ?? "gateway-history",
		usage: zeroUsage(),
		stopReason: params?.stopReason ?? "stop",
		...(params?.errorMessage ? { errorMessage: params.errorMessage } : {}),
		timestamp: Date.now(),
	};
}

function buildToolResultContent(payload: unknown, isError: boolean): Array<Record<string, unknown>> {
	if (payload && typeof payload === "object" && Array.isArray((payload as { content?: unknown[] }).content)) {
		return cloneValue((payload as { content: Array<Record<string, unknown>> }).content);
	}
	const text =
		payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
			? (payload as { error: string }).error
			: payload && typeof payload === "object" && typeof (payload as { summary?: unknown }).summary === "string"
				? (payload as { summary: string }).summary
				: isError
					? "Tool execution failed."
					: "Tool execution finished.";
	return [{ type: "text", text }];
}

function buildGatewaySocketUrl(gatewayUrl: string, token?: string): string {
	const url = new URL(gatewayUrl);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	if (token) {
		url.searchParams.set("token", token);
	}
	return url.toString();
}

function readCommandName(text: string): string | undefined {
	if (!text.startsWith("/")) {
		return undefined;
	}
	const trimmed = text.trim();
	const spaceIndex = trimmed.indexOf(" ");
	return (spaceIndex === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIndex)).trim() || undefined;
}

function buildGatewaySessionPath(sessionId: string): string {
	return `${GATEWAY_SESSION_PATH_PREFIX}${encodeURIComponent(sessionId)}`;
}

function parseGatewaySessionPath(sessionPath: string): string | undefined {
	const trimmed = sessionPath.trim();
	if (!trimmed) {
		return undefined;
	}
	if (trimmed.startsWith(GATEWAY_SESSION_PATH_PREFIX)) {
		try {
			return decodeURIComponent(trimmed.slice(GATEWAY_SESSION_PATH_PREFIX.length));
		} catch {
			return undefined;
		}
	}
	return trimmed;
}

function buildSyntheticTree(
	entries: SyntheticGatewayEntry[],
	labels: Map<string, string>,
): Array<Record<string, unknown>> {
	if (entries.length === 0) {
		return [];
	}
	const nodes = new Map<string, Record<string, unknown>>();
	for (const entry of entries) {
		nodes.set(entry.id, {
			entry,
			children: [],
			label: labels.get(entry.id),
		});
	}
	const roots: Array<Record<string, unknown>> = [];
	for (const entry of entries) {
		const node = nodes.get(entry.id)!;
		if (!entry.parentId) {
			roots.push(node);
			continue;
		}
		const parent = nodes.get(entry.parentId);
		if (parent) {
			(parent.children as Array<Record<string, unknown>>).push(node);
		} else {
			roots.push(node);
		}
	}
	return roots;
}

function messageRole(message: Record<string, unknown> | undefined): string | undefined {
	return typeof message?.role === "string" ? message.role : undefined;
}

type SessionManagerStaticApi = {
	list: (
		cwd: string,
		sessionDir?: string,
		onProgress?: (loaded: number, total: number) => void,
	) => Promise<unknown[]>;
	listAll: (onProgress?: (loaded: number, total: number) => void) => Promise<unknown[]>;
	open: (sessionPath: string, sessionDir?: string) => unknown;
};

type GatewaySessionManagerOverride = SessionManagerStaticApi;

const sessionManagerStatics = SessionManager as unknown as SessionManagerStaticApi;
const originalSessionManagerStatics: SessionManagerStaticApi = {
	list: sessionManagerStatics.list,
	listAll: sessionManagerStatics.listAll,
	open: sessionManagerStatics.open,
};
const gatewaySessionManagerOverrides = new Map<string, GatewaySessionManagerOverride>();
const gatewaySessionManagerOverrideOrder: string[] = [];
let gatewaySessionManagerPatched = false;

function getActiveGatewaySessionManagerOverride(): GatewaySessionManagerOverride | undefined {
	for (let index = gatewaySessionManagerOverrideOrder.length - 1; index >= 0; index -= 1) {
		const overrideId = gatewaySessionManagerOverrideOrder[index];
		if (!overrideId) {
			continue;
		}
		const override = gatewaySessionManagerOverrides.get(overrideId);
		if (override) {
			return override;
		}
	}
	return undefined;
}

function ensureGatewaySessionManagerPatched(): void {
	if (gatewaySessionManagerPatched) {
		return;
	}
	sessionManagerStatics.list = async (...args) => {
		const override = getActiveGatewaySessionManagerOverride();
		return override
			? await override.list(...args)
			: await originalSessionManagerStatics.list(...args);
	};
	sessionManagerStatics.listAll = async (...args) => {
		const override = getActiveGatewaySessionManagerOverride();
		return override
			? await override.listAll(...args)
			: await originalSessionManagerStatics.listAll(...args);
	};
	sessionManagerStatics.open = (...args) => {
		const override = getActiveGatewaySessionManagerOverride();
		return override
			? override.open(...args)
			: originalSessionManagerStatics.open(...args);
	};
	gatewaySessionManagerPatched = true;
}

function registerGatewaySessionManagerOverride(
	override: GatewaySessionManagerOverride,
): () => void {
	ensureGatewaySessionManagerPatched();
	const overrideId = randomUUID();
	gatewaySessionManagerOverrides.set(overrideId, override);
	gatewaySessionManagerOverrideOrder.push(overrideId);
	let released = false;
	return () => {
		if (released) {
			return;
		}
		released = true;
		gatewaySessionManagerOverrides.delete(overrideId);
		const index = gatewaySessionManagerOverrideOrder.lastIndexOf(overrideId);
		if (index >= 0) {
			gatewaySessionManagerOverrideOrder.splice(index, 1);
		}
		if (gatewaySessionManagerOverrides.size === 0 && gatewaySessionManagerPatched) {
			sessionManagerStatics.list = originalSessionManagerStatics.list;
			sessionManagerStatics.listAll = originalSessionManagerStatics.listAll;
			sessionManagerStatics.open = originalSessionManagerStatics.open;
			gatewaySessionManagerPatched = false;
		}
	};
}

export async function createGatewayBackedInteractiveSession(
	options: CreateGatewayBackedInteractiveSessionOptions,
): Promise<InteractiveSessionLike & {
	close: () => Promise<void>;
	getGatewaySessionId: () => string | undefined;
}> {
	const listeners = new Set<(event: Record<string, unknown>) => void | Promise<void>>();
	const dynamicOverrides = new Map<PropertyKey, unknown>();
	const baseSession = options.baseSession;
	const agent = baseSession.agent;
	const originalManager = baseSession.sessionManager;
	const gatewayState = {
		sessionId: undefined as string | undefined,
		sessionName: undefined as string | undefined,
		currentTurn: undefined as {
			closed: boolean;
			streamStarted: boolean;
			assistantMessage?: Record<string, unknown>;
		} | undefined,
		isStreaming: false,
		socket: null as WebSocket | null,
		syntheticEntries: [] as SyntheticGatewayEntry[],
		syntheticLabels: new Map<string, string>(),
		forkTargets: new Map<string, { forkPoint: number; text: string }>(),
	};

	const patchedManager = Object.create(originalManager ?? {});
	const buildCurrentGatewayConfigOverride = (): Partial<UnderstudyConfig> | undefined => {
		const override: Partial<UnderstudyConfig> = {};
		const activeModel = (dynamicOverrides.get("model") as Model<any> | undefined) ?? baseSession.model;
		if (activeModel?.provider && activeModel.id) {
			override.defaultProvider = activeModel.provider;
			override.defaultModel = activeModel.id;
		}
		const activeThinkingLevel =
			(typeof dynamicOverrides.get("thinkingLevel") === "string"
				? dynamicOverrides.get("thinkingLevel")
				: baseSession.thinkingLevel) ?? undefined;
		if (typeof activeThinkingLevel === "string" && activeThinkingLevel.trim()) {
			override.defaultThinkingLevel = activeThinkingLevel as UnderstudyConfig["defaultThinkingLevel"];
		}
		if (Object.keys(override).length > 0) {
			return {
				...options.configOverride,
				...override,
			};
		}
		return options.configOverride;
	};
	const applyGatewayDisplayState = (summary: GatewaySessionSummary | undefined) => {
		if (!summary) {
			return;
		}
		if (typeof summary.model === "string" && summary.model.trim()) {
			const parsed = parseModelRef(summary.model);
			if (parsed) {
				const resolvedModel =
					resolveCliModel(summary.model) ??
					({
						provider: parsed.provider,
						id: parsed.modelId,
					} as Model<any>);
				dynamicOverrides.set("model", resolvedModel);
				(agent.state as Record<string, unknown>).model = resolvedModel;
			}
		}
		if (typeof summary.thinkingLevel === "string" && summary.thinkingLevel.trim()) {
			dynamicOverrides.set("thinkingLevel", summary.thinkingLevel);
			(agent.state as Record<string, unknown>).thinkingLevel = summary.thinkingLevel;
		}
	};
	const syncSessionSummary = (summary: GatewaySessionSummary | undefined) => {
		if (!summary?.id) {
			return;
		}
		gatewayState.sessionId = summary.id;
		gatewayState.sessionName = summary.sessionName?.trim() || undefined;
		agent.sessionId = summary.id;
		applyGatewayDisplayState(summary);
	};
	const buildGatewayPatchFromConfigOverride = (
		configOverride: Partial<UnderstudyConfig> | undefined,
	): Record<string, unknown> | undefined => {
		if (!configOverride) {
			return undefined;
		}
		const patch: Record<string, unknown> = {};
		if (configOverride.defaultProvider && configOverride.defaultModel) {
			patch.model = `${configOverride.defaultProvider}/${configOverride.defaultModel}`;
		}
		if (configOverride.defaultThinkingLevel) {
			patch.thinkingLevel = configOverride.defaultThinkingLevel;
		}
		return Object.keys(patch).length > 0 ? patch : undefined;
	};
	const pushGatewayConfigPatch = async (patch: Record<string, unknown> | undefined): Promise<void> => {
		if (!gatewayState.sessionId || !patch) {
			return;
		}
		const summary = await options.client.call<GatewaySessionSummary>("session.patch", {
			sessionId: gatewayState.sessionId,
			...patch,
		});
		syncSessionSummary(summary);
	};
	const listGatewaySessions = async (params: {
		cwd?: string;
		onProgress?: (loaded: number, total: number) => void;
		includeAll: boolean;
	}): Promise<Array<Record<string, unknown>>> => {
		const summaries = await options.client.call<GatewaySessionSummary[]>("session.list", {
			channelId: CHAT_GATEWAY_CHANNEL_ID,
			senderId: CHAT_GATEWAY_SENDER_ID,
			includePersisted: true,
			limit: 200,
		});
		const normalizedCwd = params.cwd?.trim() ? params.cwd : undefined;
		const filtered = summaries
			.filter((summary) =>
				params.includeAll ||
				!normalizedCwd ||
				(summary.workspaceDir?.trim() ? summary.workspaceDir === normalizedCwd : options.cwd === normalizedCwd))
			.sort((left, right) =>
				(right.lastActiveAt ?? right.createdAt ?? 0) - (left.lastActiveAt ?? left.createdAt ?? 0));
		params.onProgress?.(filtered.length, filtered.length);
		return filtered.map((summary) => {
			const fallbackLabel =
				summary.sessionName?.trim() ||
				summary.conversationName?.trim() ||
				summary.senderName?.trim() ||
				summary.id;
			return {
				path: buildGatewaySessionPath(summary.id),
				id: summary.id,
				cwd: summary.workspaceDir ?? options.cwd,
				name: summary.sessionName?.trim() || undefined,
				parentSessionPath: summary.parentId ? buildGatewaySessionPath(summary.parentId) : undefined,
				created: new Date(summary.createdAt ?? Date.now()),
				modified: new Date(summary.lastActiveAt ?? summary.createdAt ?? Date.now()),
				messageCount: summary.messageCount ?? 0,
				firstMessage: fallbackLabel,
				allMessagesText: [
					summary.sessionName,
					summary.conversationName,
					summary.senderName,
					summary.id,
				]
					.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
					.join(" "),
			};
		});
	};
	let releaseSessionManagerOverride = () => {};

	const replaceMessages = (messages: Array<Record<string, unknown>>) => {
		const supplemental = (Array.isArray(agent.state.messages) ? agent.state.messages : []).filter((message) => {
			const role = messageRole(message);
			return role !== "user" && role !== "assistant" && role !== "toolResult";
		});
		const nextMessages = [...messages, ...supplemental];
		if (typeof agent.replaceMessages === "function") {
			agent.replaceMessages(nextMessages);
			return;
		}
		agent.state.messages = nextMessages;
	};

	const emit = async (event: Record<string, unknown>) => {
		for (const listener of listeners) {
			await listener(event);
		}
	};

	const rebuildSyntheticEntries = (messages: GatewaySessionHistoryEntry[]) => {
		const entries: SyntheticGatewayEntry[] = [];
		const forkTargets = new Map<string, { forkPoint: number; text: string }>();
		let previousId: string | null = null;
		messages.forEach((message, index) => {
			const id = `gateway-${index}`;
			const entryMessage =
				message.role === "assistant"
					? buildAssistantMessage({
						text: message.text,
						model: baseSession.model,
					})
					: buildUserMessage(message.text);
			const entry: SyntheticGatewayEntry = {
				type: "message",
				id,
				parentId: previousId,
				timestamp: new Date(message.timestamp).toISOString(),
				message: {
					...entryMessage,
					timestamp: message.timestamp,
				},
			};
			entries.push(entry);
			previousId = id;
			if (message.role === "user" && message.text.trim()) {
				forkTargets.set(id, {
					forkPoint: index + 1,
					text: message.text,
				});
			}
		});
		gatewayState.syntheticEntries = entries;
		gatewayState.forkTargets = forkTargets;
	};

	const ensureSession = async (
		forceNew: boolean,
		configOverride?: Partial<UnderstudyConfig>,
	): Promise<GatewaySessionSummary> => {
		const summary = await options.client.call<GatewaySessionSummary>("session.create", {
			channelId: CHAT_GATEWAY_CHANNEL_ID,
			senderId: CHAT_GATEWAY_SENDER_ID,
			cwd: options.cwd,
			forceNew,
			...(configOverride ? { configOverride } : {}),
		});
		syncSessionSummary(summary);
		return summary;
	};

	const syncHistory = async (): Promise<void> => {
		if (!gatewayState.sessionId) {
			return;
		}
		const result = await options.client.call<GatewaySessionHistoryResult>("session.history", {
			sessionId: gatewayState.sessionId,
			limit: 200,
		});
		const history = Array.isArray(result.messages) ? result.messages : [];
		rebuildSyntheticEntries(history);
		replaceMessages(history.map((entry) =>
			entry.role === "assistant"
				? buildAssistantMessage({
					text: entry.text,
					model: baseSession.model,
				})
				: buildUserMessage(entry.text),
		));
	};

	const startAssistantIfNeeded = async (): Promise<Record<string, unknown>> => {
		if (gatewayState.currentTurn?.assistantMessage) {
			return gatewayState.currentTurn.assistantMessage;
		}
		const assistantMessage = buildAssistantMessage({
			model: baseSession.model,
		});
		if (!gatewayState.currentTurn) {
			gatewayState.currentTurn = {
				closed: false,
				streamStarted: true,
				assistantMessage,
			};
		} else {
			gatewayState.currentTurn.assistantMessage = assistantMessage;
			gatewayState.currentTurn.streamStarted = true;
		}
		await emit({
			type: "message_start",
			message: cloneValue(assistantMessage),
		});
		return assistantMessage;
	};

	const updateAssistantContent = async (mutate: (message: Record<string, unknown>) => void) => {
		const assistantMessage = await startAssistantIfNeeded();
		mutate(assistantMessage);
		await emit({
			type: "message_update",
			message: cloneValue(assistantMessage),
		});
	};

	const finalizeTurn = async (params: {
		status: "ok" | "error" | "aborted";
		text?: string;
		errorMessage?: string;
	}): Promise<void> => {
		if (!gatewayState.currentTurn || gatewayState.currentTurn.closed) {
			return;
		}
		gatewayState.currentTurn.closed = true;
		gatewayState.isStreaming = false;
		const assistantMessage = await startAssistantIfNeeded();
		const content = Array.isArray(assistantMessage.content)
			? assistantMessage.content as Array<Record<string, unknown>>
			: [];
		const lastText = content.findLast?.((part) => part.type === "text")
			?? [...content].reverse().find((part) => part.type === "text");
		if (params.text && (!lastText || typeof lastText.text !== "string" || lastText.text !== params.text)) {
			if (lastText && typeof lastText.text === "string") {
				lastText.text = params.text;
			} else {
				content.push({ type: "text", text: params.text });
			}
		}
		assistantMessage.content = content;
		assistantMessage.stopReason =
			params.status === "ok"
				? "stop"
				: params.status === "aborted"
					? "aborted"
					: "error";
		if (params.errorMessage) {
			assistantMessage.errorMessage = params.errorMessage;
		}
		await emit({
			type: "message_end",
			message: cloneValue(assistantMessage),
		});
		await emit({
			type: "agent_end",
			messages: cloneValue(agent.state.messages),
		});
		gatewayState.currentTurn = undefined;
	};

	const queuePromptWhileStreaming = async (
		text: string,
		images: ImageContent[] | undefined,
		mode: "steer" | "followUp",
	): Promise<void> => {
		if (mode === "followUp" && typeof baseSession._queueFollowUp === "function") {
			await baseSession._queueFollowUp(text, images);
			return;
		}
		if (mode === "steer" && typeof baseSession._queueSteer === "function") {
			await baseSession._queueSteer(text, images);
			return;
		}
		if (mode === "followUp" && typeof baseSession.followUp === "function") {
			await baseSession.followUp(text, images);
			return;
		}
		if (mode === "steer" && typeof baseSession.steer === "function") {
			await baseSession.steer(text, images);
		}
	};

	const preparePromptInput = async (
		text: string,
		options?: Record<string, unknown>,
	): Promise<{ handled: boolean; text: string; images?: ImageContent[] }> => {
		const expandPromptTemplates = options?.expandPromptTemplates !== false;
		let currentText = text;
		let currentImages = Array.isArray(options?.images) ? options.images as ImageContent[] : undefined;
		if (expandPromptTemplates && currentText.startsWith("/")) {
			const commandName = readCommandName(currentText);
			const command =
				commandName && typeof baseSession.extensionRunner?.getCommand === "function"
					? baseSession.extensionRunner.getCommand(commandName)
					: undefined;
			if (command && typeof baseSession.prompt === "function") {
				await baseSession.prompt.call(baseSession, currentText, options);
				return { handled: true, text: currentText, images: currentImages };
			}
		}
		if (typeof baseSession.extensionRunner?.hasHandlers === "function" &&
			baseSession.extensionRunner.hasHandlers("input") &&
			typeof baseSession.extensionRunner.emitInput === "function") {
			const inputResult = await baseSession.extensionRunner.emitInput(
				currentText,
				currentImages,
				typeof options?.source === "string" ? options.source : "interactive",
			);
			if (inputResult.action === "handled") {
				return { handled: true, text: currentText, images: currentImages };
			}
			if (inputResult.action === "transform") {
				currentText = inputResult.text;
				currentImages = inputResult.images ?? currentImages;
			}
		}
		if (expandPromptTemplates) {
			if (typeof baseSession._expandSkillCommand === "function") {
				currentText = baseSession._expandSkillCommand(currentText);
			}
			currentText = expandPromptTemplateText(currentText, [...(baseSession.promptTemplates ?? [])]);
		}
		return {
			handled: false,
			text: currentText,
			images: currentImages,
		};
	};

	const flushQueuedPrompts = async () => {
		if (gatewayState.isStreaming || typeof baseSession.clearQueue !== "function") {
			return;
		}
		const queued = baseSession.clearQueue();
		const messages = [
			...queued.steering.map((text) => ({ text, mode: "steer" as const })),
			...queued.followUp.map((text) => ({ text, mode: "followUp" as const })),
		];
		for (const message of messages) {
			const promptFn = (wrapper as Record<string, unknown>).prompt;
			if (typeof promptFn === "function") {
				await promptFn(message.text);
			}
		}
	};

	const gatewayPrompt = async (text: string, promptOptions?: Record<string, unknown>) => {
		const prepared = await preparePromptInput(text, promptOptions);
		if (prepared.handled) {
			return;
		}
		if (gatewayState.isStreaming) {
			const behavior = promptOptions?.streamingBehavior;
			if (behavior !== "steer" && behavior !== "followUp") {
				throw new Error("Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.");
			}
			await queuePromptWhileStreaming(prepared.text, prepared.images, behavior);
			return;
		}

		const summary = await ensureSession(options.forceNew && !gatewayState.sessionId);
		syncSessionSummary(summary);
		gatewayState.currentTurn = {
			closed: false,
			streamStarted: false,
		};
		gatewayState.isStreaming = true;
		const userMessage = buildUserMessage(prepared.text, prepared.images);
		agent.state.messages = [...agent.state.messages, cloneValue(userMessage)];
		await emit({ type: "message_start", message: cloneValue(userMessage) });
		await emit({ type: "message_end", message: cloneValue(userMessage) });
		await emit({ type: "agent_start" });
		let historySyncedFromGateway = false;
		try {
			const result = await options.client.call<GatewaySessionSendResult>("session.send", {
				sessionId: gatewayState.sessionId,
				message: prepared.text,
				cwd: options.cwd,
				waitForCompletion: true,
				...(prepared.images?.length ? { images: prepared.images } : {}),
			}, {
				timeout: 600_000,
			});
			if (result.sessionId) {
				syncSessionSummary({
					id: result.sessionId,
					sessionName: gatewayState.sessionName,
				});
			}
			if (!gatewayState.currentTurn?.closed) {
				await finalizeTurn({
					status: result.status === "error" ? "error" : "ok",
					text: typeof result.response === "string" ? result.response : "",
					errorMessage:
						result.status === "error" && typeof result.meta?.error === "string"
							? result.meta.error
							: undefined,
				});
			}
			historySyncedFromGateway = true;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await finalizeTurn({
				status: "error",
				errorMessage: message,
			});
			throw error;
		} finally {
			if (historySyncedFromGateway) {
				await syncHistory().catch(() => {});
			}
			await flushQueuedPrompts().catch(() => {});
		}
	};

	const close = async () => {
		gatewayState.isStreaming = false;
		gatewayState.currentTurn = undefined;
		gatewayState.socket?.removeAllListeners();
		if (gatewayState.socket && gatewayState.socket.readyState !== WebSocket.CLOSED) {
			await new Promise<void>((resolve) => {
				const socket = gatewayState.socket!;
				let settled = false;
				const finish = () => {
					if (settled) {
						return;
					}
					settled = true;
					resolve();
				};
				socket.once("close", finish);
				if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
					socket.close();
				}
				setTimeout(finish, 100);
			});
		}
		gatewayState.socket = null;
		releaseSessionManagerOverride();
		listeners.clear();
	};

	patchedManager.getSessionId = () => gatewayState.sessionId ?? originalManager?.getSessionId?.();
	patchedManager.getSessionName = () => gatewayState.sessionName;
	patchedManager.getSessionFile = () =>
		gatewayState.sessionId
			? buildGatewaySessionPath(gatewayState.sessionId)
			: originalManager?.getSessionFile?.();
	patchedManager.getSessionDir = () => originalManager?.getSessionDir?.() ?? options.cwd;
	patchedManager.getCwd = () => options.cwd;
	patchedManager.appendSessionInfo = (name: string) => {
		const trimmed = name.trim();
		gatewayState.sessionName = trimmed || undefined;
		if (gatewayState.sessionId) {
			void options.client.call("session.patch", {
				sessionId: gatewayState.sessionId,
				sessionName: trimmed,
			}).catch(() => {});
		}
		return `${gatewayState.sessionId ?? "gateway"}:session-info`;
	};
	patchedManager.buildSessionContext = () => ({
		messages: cloneValue(agent.state.messages),
		thinkingLevel:
			(typeof dynamicOverrides.get("thinkingLevel") === "string"
				? dynamicOverrides.get("thinkingLevel")
				: baseSession.thinkingLevel) ?? "off",
		model: ((dynamicOverrides.get("model") as Model<any> | undefined) ?? baseSession.model)
			? {
				provider: (((dynamicOverrides.get("model") as Model<any> | undefined) ?? baseSession.model) as Model<any>).provider,
				modelId: (((dynamicOverrides.get("model") as Model<any> | undefined) ?? baseSession.model) as Model<any>).id,
			}
			: null,
	});
	patchedManager.getEntries = () => cloneValue(gatewayState.syntheticEntries);
	patchedManager.getEntry = (id: string) => cloneValue(gatewayState.syntheticEntries.find((entry) => entry.id === id));
	patchedManager.getLabel = (id: string) => gatewayState.syntheticLabels.get(id);
	patchedManager.appendLabelChange = (id: string, label?: string) => {
		if (!label?.trim()) {
			gatewayState.syntheticLabels.delete(id);
		} else {
			gatewayState.syntheticLabels.set(id, label.trim());
		}
		return `${id}:label`;
	};
	patchedManager.getLeafId = () => gatewayState.syntheticEntries.at(-1)?.id ?? null;
	patchedManager.getBranch = (id?: string | null) => {
		if (!id) {
			return cloneValue(gatewayState.syntheticEntries);
		}
		const index = gatewayState.syntheticEntries.findIndex((entry) => entry.id === id);
		if (index === -1) {
			return [];
		}
		return cloneValue(gatewayState.syntheticEntries.slice(0, index + 1));
	};
	patchedManager.getTree = () => cloneValue(buildSyntheticTree(gatewayState.syntheticEntries, gatewayState.syntheticLabels));
	const buildGatewayPatchFromCurrentSession = (params?: {
		includeModel?: boolean;
		includeThinkingLevel?: boolean;
	}): Record<string, unknown> | undefined => {
		const patch: Record<string, unknown> = {};
		const activeModel = (dynamicOverrides.get("model") as Model<any> | undefined) ?? baseSession.model;
		if ((params?.includeModel ?? true) && activeModel?.provider && activeModel.id) {
			patch.model = `${activeModel.provider}/${activeModel.id}`;
		}
		const activeThinkingLevel =
			(typeof dynamicOverrides.get("thinkingLevel") === "string"
				? dynamicOverrides.get("thinkingLevel")
				: baseSession.thinkingLevel) ?? undefined;
		if ((params?.includeThinkingLevel ?? false) &&
			typeof activeThinkingLevel === "string" &&
			activeThinkingLevel.trim()) {
			patch.thinkingLevel = activeThinkingLevel;
		}
		return Object.keys(patch).length > 0 ? patch : undefined;
	};
	const switchGatewaySession = async (sessionPath: string): Promise<boolean> => {
		const sessionId = parseGatewaySessionPath(sessionPath);
		if (!sessionId) {
			throw new Error("Gateway-backed chat requires a gateway session id.");
		}
		if (gatewayState.isStreaming && gatewayState.sessionId) {
			await options.client.call("session.abort", {
				sessionId: gatewayState.sessionId,
			}).catch(() => {});
		}
		const summary = await options.client.call<GatewaySessionSummary | null>("session.get", {
			sessionId,
		});
		if (!summary?.id) {
			throw new Error(`Session not found: ${sessionId}`);
		}
		syncSessionSummary(summary);
		gatewayState.syntheticLabels.clear();
		await syncHistory();
		return true;
	};

	const wrapper = new Proxy(baseSession as Record<string, unknown>, {
		get(target, prop, receiver) {
			if (dynamicOverrides.has(prop)) {
				return dynamicOverrides.get(prop);
			}
			switch (prop) {
				case "sessionManager":
					return patchedManager;
				case "isStreaming":
					return gatewayState.isStreaming;
				case "prompt":
					return gatewayPrompt;
				case "subscribe":
					return (listener: (event: Record<string, unknown>) => void | Promise<void>) => {
						listeners.add(listener);
						return () => {
							listeners.delete(listener);
						};
					};
				case "abort":
					return async () => {
						if (!gatewayState.sessionId) {
							return;
						}
						await options.client.call("session.abort", {
							sessionId: gatewayState.sessionId,
						});
					};
				case "reload":
					return async () => {
						await syncHistory();
					};
				case "compact":
					return async (_customInstructions?: string) => {
						if (!gatewayState.sessionId) {
							return {
								summary: "No gateway session to compact.",
								tokensBefore: 0,
							};
						}
						const beforeText = agent.state.messages
							.map((message) => {
								const content = (message as { content?: unknown }).content;
								if (typeof content === "string") {
									return content;
								}
								if (!Array.isArray(content)) {
									return "";
								}
								return content
									.filter((part): part is { type?: unknown; text?: unknown } =>
										Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "text"),
									)
									.map((part) => typeof part.text === "string" ? part.text : "")
									.join("\n");
							})
							.join("\n");
						const tokensBefore = Math.max(1, Math.ceil(beforeText.trim().length / 4));
						const result = await options.client.call<Record<string, unknown>>("session.compact", {
							sessionId: gatewayState.sessionId,
							keep: GATEWAY_COMPACT_KEEP,
						});
						await syncHistory();
						return {
							summary: `Compacted the gateway session by keeping the most recent ${GATEWAY_COMPACT_KEEP} history items.`,
							tokensBefore,
							...result,
						};
					};
				case "newSession":
					return async (_opts?: Record<string, unknown>) => {
						const summary = await ensureSession(true, buildCurrentGatewayConfigOverride());
						syncSessionSummary(summary);
						gatewayState.syntheticLabels.clear();
						rebuildSyntheticEntries([]);
						replaceMessages([]);
						return true;
					};
				case "setModel":
					return async (model: Model<any>) => {
						await baseSession.setModel?.(model);
						dynamicOverrides.set("model", model);
						(agent.state as Record<string, unknown>).model = model;
						if (typeof baseSession.thinkingLevel === "string") {
							dynamicOverrides.set("thinkingLevel", baseSession.thinkingLevel);
							(agent.state as Record<string, unknown>).thinkingLevel = baseSession.thinkingLevel;
						}
						await pushGatewayConfigPatch(buildGatewayPatchFromCurrentSession({
							includeModel: true,
							includeThinkingLevel: true,
						}));
					};
				case "cycleModel":
					return async (direction?: "forward" | "backward") => {
						const result = await baseSession.cycleModel?.(direction);
						if (result) {
							dynamicOverrides.set("model", result.model);
							dynamicOverrides.set("thinkingLevel", result.thinkingLevel);
							(agent.state as Record<string, unknown>).model = result.model;
							(agent.state as Record<string, unknown>).thinkingLevel = result.thinkingLevel;
							await pushGatewayConfigPatch(buildGatewayPatchFromCurrentSession({
								includeModel: true,
								includeThinkingLevel: true,
							}));
						}
						return result;
					};
				case "setThinkingLevel":
					return (level: string) => {
						baseSession.setThinkingLevel?.(level);
						dynamicOverrides.set("thinkingLevel", level);
						(agent.state as Record<string, unknown>).thinkingLevel = level;
						void pushGatewayConfigPatch(buildGatewayPatchFromCurrentSession({
							includeModel: false,
							includeThinkingLevel: true,
						})).catch(() => {});
					};
				case "cycleThinkingLevel":
					return () => {
						const result = baseSession.cycleThinkingLevel?.();
						if (result) {
							dynamicOverrides.set("thinkingLevel", result);
							(agent.state as Record<string, unknown>).thinkingLevel = result;
							void pushGatewayConfigPatch(buildGatewayPatchFromCurrentSession({
								includeModel: false,
								includeThinkingLevel: true,
							})).catch(() => {});
						}
						return result;
					};
				case "getUserMessagesForForking":
					return () =>
						Array.from(gatewayState.forkTargets.entries()).map(([entryId, value]) => ({
							entryId,
							text: value.text,
						}));
				case "fork":
					return async (entryId: string) => {
						if (!gatewayState.sessionId) {
							return { cancelled: true };
						}
						const target = gatewayState.forkTargets.get(entryId);
						if (!target) {
							return { cancelled: true };
						}
						const result = await options.client.call<GatewaySessionSummary>("session.branch", {
							sessionId: gatewayState.sessionId,
							forkPoint: target.forkPoint,
						});
						syncSessionSummary(result);
						await syncHistory();
						return {
							cancelled: false,
							selectedText: target.text,
						};
					};
				case "navigateTree":
					return async (entryId: string, _navigateOptions?: Record<string, unknown>) => {
						if (!gatewayState.sessionId) {
							return { cancelled: true };
						}
						const index = gatewayState.syntheticEntries.findIndex((entry) => entry.id === entryId);
						if (index === -1) {
							return { cancelled: true };
						}
						const result = await options.client.call<GatewaySessionSummary>("session.branch", {
							sessionId: gatewayState.sessionId,
							forkPoint: index + 1,
						});
						syncSessionSummary(result);
						await syncHistory();
						const editorText =
							messageRole(gatewayState.syntheticEntries[index]?.message) === "user"
								? gatewayState.forkTargets.get(entryId)?.text ?? ""
								: "";
						return {
							cancelled: false,
							editorText,
						};
					};
				case "switchSession":
					return switchGatewaySession;
				case "sendCustomMessage":
					return async (
						message: {
							customType: string;
							content: string;
							display: boolean;
							details?: Record<string, unknown>;
						},
						sendOptions?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
					) => {
						if (typeof baseSession.sendCustomMessage === "function") {
							await baseSession.sendCustomMessage(message, sendOptions);
						}
						const customMessage = {
							role: "custom",
							customType: message.customType,
							content: message.content,
							display: message.display,
							details: message.details,
							timestamp: Date.now(),
						};
						await emit({ type: "message_start", message: cloneValue(customMessage) });
						await emit({ type: "message_end", message: cloneValue(customMessage) });
					};
				case "close":
					return close;
				case "getGatewaySessionId":
					return () => gatewayState.sessionId;
				default:
					return Reflect.get(target, prop, receiver);
			}
		},
		set(_target, prop, value) {
			dynamicOverrides.set(prop, value);
			return true;
		},
	}) as InteractiveSessionLike & {
		close: () => Promise<void>;
		getGatewaySessionId: () => string | undefined;
	};

	const connectEventStream = () => {
		const socketUrl = buildGatewaySocketUrl(
			options.gatewayUrl,
			options.gatewayToken ?? process.env.UNDERSTUDY_GATEWAY_TOKEN,
		);
		try {
			const socket = new WebSocket(socketUrl);
			gatewayState.socket = socket;
			socket.on("message", (raw) => {
				try {
					const parsed = JSON.parse(raw.toString()) as { type?: string; data?: Record<string, unknown> };
					if (!parsed.type || !parsed.data) {
						return;
					}
					const data = parsed.data;
					if (
						gatewayState.sessionId &&
						typeof data.sessionId === "string" &&
						data.sessionId !== gatewayState.sessionId
					) {
						return;
					}
					void (async () => {
						switch (parsed.type) {
							case "stream_start":
								if (!gatewayState.currentTurn) {
									gatewayState.currentTurn = { closed: false, streamStarted: true };
								} else {
									gatewayState.currentTurn.streamStarted = true;
								}
								break;
							case "stream_chunk": {
								const text = typeof data.text === "string" ? data.text : "";
								const stream = typeof data.stream === "string" ? data.stream : "text";
								if (!text) {
									return;
								}
								await updateAssistantContent((message) => {
									const content = Array.isArray(message.content)
										? message.content as Array<Record<string, unknown>>
										: [];
									const targetType = stream === "thought" ? "thinking" : "text";
									const key = stream === "thought" ? "thinking" : "text";
									const block = [...content].reverse().find((part) => part.type === targetType);
									if (block && typeof block[key] === "string") {
										block[key] = (block[key] as string) + text;
									} else {
										content.push(targetType === "thinking"
											? { type: "thinking", thinking: text }
											: { type: "text", text });
									}
									message.content = content;
								});
								break;
							}
							case "tool_start":
								await updateAssistantContent((message) => {
									const content = Array.isArray(message.content)
										? message.content as Array<Record<string, unknown>>
										: [];
									const toolCallId = typeof data.toolCallId === "string"
										? data.toolCallId
										: randomUUID();
									if (!content.some((part) => part.type === "toolCall" && part.id === toolCallId)) {
										content.push({
											type: "toolCall",
											id: toolCallId,
											name: typeof data.toolName === "string" ? data.toolName : "tool",
											arguments: data.params ?? {},
										});
									}
									message.content = content;
								});
								await emit({
									type: "tool_execution_start",
									toolCallId: data.toolCallId,
									toolName: data.toolName,
									args: data.params ?? {},
								});
								break;
							case "tool_end":
								await emit({
									type: "tool_execution_end",
									toolCallId: data.toolCallId,
									toolName: data.toolName,
									result: {
										content: buildToolResultContent(data.result ?? data.error, data.status === "error"),
									},
									isError: data.status === "error",
								});
								break;
							case "stream_end":
								await finalizeTurn({
									status:
										data.status === "error"
											? "error"
											: data.status === "aborted"
												? "aborted"
												: "ok",
									text: typeof data.text === "string" ? data.text : "",
									errorMessage: typeof data.error === "string" ? data.error : undefined,
								});
								break;
							default:
								break;
						}
					})().catch(() => {});
				} catch {
					// Ignore malformed WS messages.
				}
			});
		} catch {
			gatewayState.socket = null;
		}
	};

	try {
		releaseSessionManagerOverride = registerGatewaySessionManagerOverride({
			list: async (cwd, _sessionDir, onProgress) =>
				await listGatewaySessions({ cwd, onProgress, includeAll: false }),
			listAll: async (onProgress) =>
				await listGatewaySessions({ onProgress, includeAll: true }),
			open: (sessionPath: string, sessionDir?: string) => {
				const sessionId = parseGatewaySessionPath(sessionPath);
				if (!sessionPath.startsWith(GATEWAY_SESSION_PATH_PREFIX) || !sessionId) {
					return originalSessionManagerStatics.open(sessionPath, sessionDir);
				}
				return {
					appendSessionInfo(name: string) {
						const trimmed = name.trim();
						if (gatewayState.sessionId === sessionId) {
							gatewayState.sessionName = trimmed || undefined;
						}
						void options.client.call("session.patch", {
							sessionId,
							sessionName: trimmed,
						}).catch(() => {});
						return `${sessionId}:session-info`;
					},
				};
			},
		});
		const initialSummary = await ensureSession(
			options.forceNew,
			options.forceNew ? buildCurrentGatewayConfigOverride() : undefined,
		);
		syncSessionSummary(initialSummary);
		if (!options.forceNew) {
			await pushGatewayConfigPatch(buildGatewayPatchFromConfigOverride(options.configOverride));
		}
		await syncHistory();
		connectEventStream();
		return wrapper;
	} catch (error) {
		await close().catch(() => {});
		throw error;
	}
}
