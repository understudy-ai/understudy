import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveUnderstudyHomeDir } from "@understudy/core";
import type { AgentRunSnapshot, SessionEntry } from "@understudy/gateway";
import { atomicWriteJsonFile } from "./gateway-file-store-utils.js";

export type PersistedAgentRunSnapshot = AgentRunSnapshot;

const MAX_PERSISTED_STRING_LENGTH = 16_000;
const MAX_PERSISTED_ARRAY_ITEMS = 50;
const MAX_PERSISTED_OBJECT_KEYS = 100;

export interface PersistedGatewaySessionRecord {
	id: string;
	parentId?: string;
	forkPoint?: number;
	channelId?: string;
	senderId?: string;
	senderName?: string;
	conversationName?: string;
	conversationType?: SessionEntry["conversationType"];
	threadId?: string;
	createdAt: number;
	lastActiveAt: number;
	dayStamp: string;
	messageCount: number;
	workspaceDir?: string;
	repoRoot?: string;
	validationRoot?: string;
	configOverride?: Record<string, unknown>;
	sandboxInfo?: Record<string, unknown>;
	executionScopeKey?: string;
	traceId?: string;
	sessionMeta?: Record<string, unknown>;
	subagentMeta?: SessionEntry["subagentMeta"];
}

export interface PersistedGatewayActiveSessionBinding {
	routeKey: string;
	sessionId: string;
}

export interface PersistedGatewaySessionState {
	version: 2;
	savedAt: number;
	sessions: PersistedGatewaySessionRecord[];
	runs: PersistedAgentRunSnapshot[];
	activeSessionBindings?: PersistedGatewayActiveSessionBinding[];
}

export interface GatewaySessionMetadataStore {
	getPath(): string;
	load(): Promise<PersistedGatewaySessionState | null>;
	save(params: {
		sessionEntries: Map<string, SessionEntry>;
		agentRuns: Map<string, PersistedAgentRunSnapshot>;
		activeSessionBindings: Map<string, string>;
	}): Promise<void>;
}

export function resolveGatewaySessionStorePath(): string {
	return join(resolveUnderstudyHomeDir(), "gateway", "state.json");
}

export class FileGatewaySessionMetadataStore implements GatewaySessionMetadataStore {
	constructor(private readonly storePath: string = resolveGatewaySessionStorePath()) {}

	getPath(): string {
		return this.storePath;
	}

	async load(): Promise<PersistedGatewaySessionState | null> {
		return await loadGatewaySessionState(this.storePath);
	}

	async save(params: {
		sessionEntries: Map<string, SessionEntry>;
		agentRuns: Map<string, PersistedAgentRunSnapshot>;
		activeSessionBindings: Map<string, string>;
	}): Promise<void> {
		await saveGatewaySessionState({
			storePath: this.storePath,
			sessionEntries: params.sessionEntries,
			agentRuns: params.agentRuns,
			activeSessionBindings: params.activeSessionBindings,
		});
	}
}

export async function loadGatewaySessionState(
	storePath: string,
): Promise<PersistedGatewaySessionState | null> {
	try {
		const raw = await readFile(storePath, "utf-8");
		const parsed = JSON.parse(raw) as PersistedGatewaySessionState | {
			version?: unknown;
			savedAt?: unknown;
			sessions?: unknown[];
			runs?: unknown[];
			activeSessionBindings?: unknown[];
		};
		if (
			!parsed ||
			typeof parsed !== "object" ||
			parsed.version !== 2 ||
			!Array.isArray(parsed.sessions) ||
			!Array.isArray(parsed.runs)
		) {
			return null;
		}
		return {
			version: 2,
			savedAt:
				typeof parsed.savedAt === "number" && Number.isFinite(parsed.savedAt)
					? parsed.savedAt
					: Date.now(),
			sessions: parsed.sessions
				.filter((session): session is PersistedGatewaySessionRecord =>
					Boolean(session) && typeof session === "object" && typeof (session as PersistedGatewaySessionRecord).id === "string")
				.map((session) => ({ ...(session as PersistedGatewaySessionRecord) })),
			runs: parsed.runs as PersistedAgentRunSnapshot[],
			activeSessionBindings: Array.isArray(parsed.activeSessionBindings)
				? parsed.activeSessionBindings
					.filter((binding): binding is PersistedGatewayActiveSessionBinding =>
						Boolean(binding) &&
						typeof binding === "object" &&
						typeof (binding as PersistedGatewayActiveSessionBinding).routeKey === "string" &&
						typeof (binding as PersistedGatewayActiveSessionBinding).sessionId === "string")
					.map((binding) => ({ ...(binding as PersistedGatewayActiveSessionBinding) }))
				: undefined,
		};
	} catch {
		return null;
	}
}

function serializeSessionEntry(entry: SessionEntry): PersistedGatewaySessionRecord {
	return {
		id: entry.id,
		parentId: entry.parentId,
		forkPoint: entry.forkPoint,
		channelId: entry.channelId,
		senderId: entry.senderId,
		senderName: entry.senderName,
		conversationName: entry.conversationName,
		conversationType: entry.conversationType,
		threadId: entry.threadId,
		createdAt: entry.createdAt,
		lastActiveAt: entry.lastActiveAt,
		dayStamp: entry.dayStamp,
		messageCount: entry.messageCount,
		workspaceDir: entry.workspaceDir,
		repoRoot: entry.repoRoot,
		validationRoot: entry.validationRoot,
		configOverride: entry.configOverride as Record<string, unknown> | undefined,
		sandboxInfo: entry.sandboxInfo as Record<string, unknown> | undefined,
		executionScopeKey: entry.executionScopeKey,
		traceId: entry.traceId,
		sessionMeta: entry.sessionMeta,
		subagentMeta: entry.subagentMeta,
	};
}

function truncatePersistedString(value: string): string {
	if (value.length <= MAX_PERSISTED_STRING_LENGTH) {
		return value;
	}
	const omitted = value.length - MAX_PERSISTED_STRING_LENGTH;
	return `${value.slice(0, MAX_PERSISTED_STRING_LENGTH)}...[truncated ${omitted} chars]`;
}

function sanitizePersistedValue(value: unknown, depth = 0): unknown {
	if (value == null || typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	if (typeof value === "string") {
		return truncatePersistedString(value);
	}
	if (depth >= 6) {
		return "[truncated]";
	}
	if (Array.isArray(value)) {
		return value
			.slice(0, MAX_PERSISTED_ARRAY_ITEMS)
			.map((entry) => sanitizePersistedValue(entry, depth + 1));
	}
	if (typeof value !== "object") {
		return String(value);
	}
	const record = value as Record<string, unknown>;
	const output: Record<string, unknown> = {};
	const entries = Object.entries(record);
	for (const [index, [key, entryValue]] of entries.entries()) {
		if (index >= MAX_PERSISTED_OBJECT_KEYS) {
			output.__truncatedKeys = entries.length - MAX_PERSISTED_OBJECT_KEYS;
			break;
		}
		if (key === "images" && Array.isArray(entryValue)) {
			output.images = entryValue.slice(0, 10).map((image) => {
				if (!image || typeof image !== "object") {
					return "[image omitted]";
				}
				const imageRecord = image as Record<string, unknown>;
				return {
					type: typeof imageRecord.type === "string" ? imageRecord.type : "image",
					mimeType:
						typeof imageRecord.mimeType === "string"
							? imageRecord.mimeType
							: undefined,
					note: "image payload omitted from persisted gateway state",
				};
			});
			continue;
		}
		if ((key === "imageData" || key === "data") && typeof entryValue === "string") {
			output[key] = "[image payload omitted]";
			continue;
		}
		output[key] = sanitizePersistedValue(entryValue, depth + 1);
	}
	return output;
}

function serializeAgentRunSnapshot(run: PersistedAgentRunSnapshot): PersistedAgentRunSnapshot {
	return {
		...run,
		...(typeof run.response === "string" ? { response: truncatePersistedString(run.response) } : {}),
		...(typeof run.error === "string" ? { error: truncatePersistedString(run.error) } : {}),
		...(run.images?.length
			? {
				images: run.images.map((image) => ({
					...(image as unknown as Record<string, unknown>),
					data: "[image payload omitted]",
				})) as PersistedAgentRunSnapshot["images"],
			}
			: {}),
		...(run.meta ? { meta: sanitizePersistedValue(run.meta) as Record<string, unknown> } : {}),
	};
}

export async function saveGatewaySessionState(params: {
	storePath: string;
	sessionEntries: Map<string, SessionEntry>;
	agentRuns: Map<string, PersistedAgentRunSnapshot>;
	activeSessionBindings: Map<string, string>;
}): Promise<void> {
	const payload: PersistedGatewaySessionState = {
		version: 2,
		savedAt: Date.now(),
		sessions: Array.from(params.sessionEntries.values()).map(serializeSessionEntry),
		runs: Array.from(params.agentRuns.values()).map(serializeAgentRunSnapshot),
		activeSessionBindings: Array.from(params.activeSessionBindings.entries()).map(([routeKey, sessionId]) => ({
			routeKey,
			sessionId,
		})),
	};
	await atomicWriteJsonFile(params.storePath, payload, "utf-8");
}
