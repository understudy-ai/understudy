import {
	buildSessionSummary,
	type SessionEntry,
	type SessionRunTrace,
	type SessionSummary,
} from "@understudy/gateway";
import type {
	GatewaySessionMetadataStore,
	PersistedGatewaySessionRecord,
} from "./gateway-session-store.js";
import type { GatewayTranscriptStore } from "./gateway-transcript-store.js";
import type { GatewayRunTraceStore } from "./gateway-run-trace-store.js";

export interface GatewaySessionQueryStore {
	listSessions(params?: {
		channelId?: string;
		senderId?: string;
		limit?: number;
	}): Promise<SessionSummary[]>;
	getSessionSummary(sessionId: string): Promise<SessionSummary | null>;
	listHistory(params: {
		sessionId: string;
		limit?: number;
	}): Promise<Array<SessionEntry["history"][number]>>;
	listRunTraces(params: {
		sessionId: string;
		limit?: number;
	}): Promise<SessionRunTrace[]>;
	appendRunTrace(params: {
		sessionId: string;
		trace: SessionRunTrace;
	}): Promise<void>;
}

async function summarizePersistedSession(
	record: PersistedGatewaySessionRecord,
	runTraceStore: GatewayRunTraceStore,
): Promise<SessionSummary> {
	const recentRuns = await runTraceStore.list({ sessionId: record.id, limit: 1 });
	return buildSessionSummary({
		id: record.id,
		parentId: record.parentId,
		forkPoint: record.forkPoint,
		channelId: record.channelId,
		senderId: record.senderId,
		senderName: record.senderName,
		conversationName: record.conversationName,
		conversationType: record.conversationType,
		threadId: record.threadId,
		createdAt: record.createdAt,
		lastActiveAt: record.lastActiveAt,
		messageCount: record.messageCount,
		workspaceDir: record.workspaceDir,
		traceId: record.traceId,
		sessionMeta: record.sessionMeta,
		subagentMeta: record.subagentMeta,
		recentRuns: recentRuns.length > 0 ? recentRuns : undefined,
	});
}

export class FileGatewaySessionQueryStore implements GatewaySessionQueryStore {
	constructor(
		private readonly metadataStore: GatewaySessionMetadataStore,
		private readonly transcriptStore: GatewayTranscriptStore,
		private readonly runTraceStore: GatewayRunTraceStore,
	) {}

	async listSessions(params?: {
		channelId?: string;
		senderId?: string;
		limit?: number;
	}): Promise<SessionSummary[]> {
		const state = await this.metadataStore.load();
		if (!state) {
			return [];
		}
		const limit = Math.max(1, params?.limit ?? Number.MAX_SAFE_INTEGER);
		return await Promise.all(state.sessions
			.filter((record) => (params?.channelId ? record.channelId === params.channelId : true))
			.filter((record) => (params?.senderId ? record.senderId === params.senderId : true))
			.sort((left, right) => right.lastActiveAt - left.lastActiveAt)
			.slice(0, limit)
			.map((record) => summarizePersistedSession(record, this.runTraceStore)));
	}

	async getSessionSummary(sessionId: string): Promise<SessionSummary | null> {
		const state = await this.metadataStore.load();
		const record = state?.sessions.find((entry) => entry.id === sessionId);
		return record ? await summarizePersistedSession(record, this.runTraceStore) : null;
	}

	async listHistory(params: {
		sessionId: string;
		limit?: number;
	}): Promise<Array<SessionEntry["history"][number]>> {
		return (await this.transcriptStore.list(params)).map((entry) => ({
			role: entry.role,
			text: entry.text,
			timestamp: entry.timestamp,
			...(Array.isArray(entry.meta?.images) ? { images: entry.meta.images as SessionEntry["history"][number]["images"] } : {}),
			...(Array.isArray(entry.meta?.attachments) ? { attachments: entry.meta.attachments as SessionEntry["history"][number]["attachments"] } : {}),
		}));
	}

	async listRunTraces(params: {
		sessionId: string;
		limit?: number;
	}): Promise<SessionRunTrace[]> {
		return await this.runTraceStore.list(params);
	}

	async appendRunTrace(params: {
		sessionId: string;
		trace: SessionRunTrace;
	}): Promise<void> {
		await this.runTraceStore.append(params);
	}
}
