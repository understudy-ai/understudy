import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveUnderstudyHomeDir } from "@understudy/core";
import type { AgentRunSnapshot, SessionEntry } from "@understudy/gateway";
import { atomicWriteJsonFile } from "./gateway-file-store-utils.js";

export type PersistedAgentRunSnapshot = AgentRunSnapshot;

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

export interface PersistedGatewaySessionState {
	version: 2;
	savedAt: number;
	sessions: PersistedGatewaySessionRecord[];
	runs: PersistedAgentRunSnapshot[];
}

export interface GatewaySessionMetadataStore {
	getPath(): string;
	load(): Promise<PersistedGatewaySessionState | null>;
	save(params: {
		sessionEntries: Map<string, SessionEntry>;
		agentRuns: Map<string, PersistedAgentRunSnapshot>;
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
	}): Promise<void> {
		await saveGatewaySessionState({
			storePath: this.storePath,
			sessionEntries: params.sessionEntries,
			agentRuns: params.agentRuns,
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

export async function saveGatewaySessionState(params: {
	storePath: string;
	sessionEntries: Map<string, SessionEntry>;
	agentRuns: Map<string, PersistedAgentRunSnapshot>;
}): Promise<void> {
	const payload: PersistedGatewaySessionState = {
		version: 2,
		savedAt: Date.now(),
		sessions: Array.from(params.sessionEntries.values()).map(serializeSessionEntry),
		runs: Array.from(params.agentRuns.values()),
	};
	await atomicWriteJsonFile(params.storePath, payload, "utf-8");
}
