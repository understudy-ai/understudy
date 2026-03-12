import { rm } from "node:fs/promises";
import { join } from "node:path";
import { resolveUnderstudyHomeDir } from "@understudy/core";
import type { SessionRunTrace } from "@understudy/gateway";
import {
	readSessionJsonEntries,
	resolveSessionFileStorePath,
	withSessionFileLock,
	writeSessionJsonEntries,
} from "./gateway-file-store-utils.js";

export interface GatewayRunTraceStore {
	getBaseDir(): string;
	append(params: {
		sessionId: string;
		trace: SessionRunTrace;
	}): Promise<void>;
	list(params: {
		sessionId: string;
		limit?: number;
	}): Promise<SessionRunTrace[]>;
	remove(sessionId: string): Promise<void>;
}

export function resolveGatewayRunTraceStoreDir(): string {
	return join(resolveUnderstudyHomeDir(), "gateway", "run-traces");
}

export class FileGatewayRunTraceStore implements GatewayRunTraceStore {
	private readonly sessionLocks = new Map<string, Promise<void>>();

	constructor(private readonly baseDir: string = resolveGatewayRunTraceStoreDir()) {}

	getBaseDir(): string {
		return this.baseDir;
	}

	async append(params: {
		sessionId: string;
		trace: SessionRunTrace;
	}): Promise<void> {
		await withSessionFileLock(this.sessionLocks, params.sessionId, async () => {
			const path = this.resolveTracePath(params.sessionId);
			const current = await this.readEntries(path);
			const next = [
				params.trace,
				...current.filter((entry) => entry.runId !== params.trace.runId),
			];
			await writeSessionJsonEntries(path, "runs", next);
		});
	}

	async list(params: {
		sessionId: string;
		limit?: number;
	}): Promise<SessionRunTrace[]> {
		return await withSessionFileLock(this.sessionLocks, params.sessionId, async () => {
			const path = this.resolveTracePath(params.sessionId);
			const entries = await this.readEntries(path);
			const limit = Math.max(1, params.limit ?? 20);
			return entries.slice(0, limit);
		});
	}

	async remove(sessionId: string): Promise<void> {
		await withSessionFileLock(this.sessionLocks, sessionId, async () => {
			await rm(this.resolveTracePath(sessionId), { force: true });
		});
	}

	private resolveTracePath(sessionId: string): string {
		return resolveSessionFileStorePath(this.baseDir, sessionId);
	}

	private async readEntries(path: string): Promise<SessionRunTrace[]> {
		return await readSessionJsonEntries(path, "runs", (entry) => ({
			runId: String(entry.runId ?? ""),
			recordedAt: Number(entry.recordedAt),
			userPromptPreview: typeof entry.userPromptPreview === "string" ? entry.userPromptPreview : "",
			responsePreview: typeof entry.responsePreview === "string" ? entry.responsePreview : "",
			durationMs: typeof entry.durationMs === "number" ? entry.durationMs : undefined,
			thoughtText: typeof entry.thoughtText === "string" ? entry.thoughtText : undefined,
			progressSteps: Array.isArray(entry.progressSteps) ? entry.progressSteps : undefined,
			toolTrace: Array.isArray(entry.toolTrace) ? entry.toolTrace : [],
			attempts: Array.isArray(entry.attempts) ? entry.attempts : [],
			teachValidation: entry.teachValidation && typeof entry.teachValidation === "object" && !Array.isArray(entry.teachValidation)
				? entry.teachValidation as Record<string, unknown>
				: undefined,
			agentMeta: entry.agentMeta && typeof entry.agentMeta === "object" && !Array.isArray(entry.agentMeta)
				? entry.agentMeta as Record<string, unknown>
				: undefined,
		}));
	}

}
