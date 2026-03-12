import { rm } from "node:fs/promises";
import { join } from "node:path";
import { resolveUnderstudyHomeDir } from "@understudy/core";
import {
	readSessionJsonEntries,
	resolveSessionFileStorePath,
	withSessionFileLock,
	writeSessionJsonEntries,
} from "./gateway-file-store-utils.js";

export interface GatewayTranscriptEntry {
	sessionId: string;
	role: "user" | "assistant";
	text: string;
	timestamp: number;
	channelId?: string;
	senderId?: string;
	threadId?: string;
	meta?: Record<string, unknown>;
}

export interface GatewayTranscriptStore {
	getBaseDir(): string;
	append(entry: GatewayTranscriptEntry): Promise<void>;
	list(params: {
		sessionId: string;
		limit?: number;
	}): Promise<GatewayTranscriptEntry[]>;
	remove(sessionId: string): Promise<void>;
}

export function resolveGatewayTranscriptStoreDir(): string {
	return join(resolveUnderstudyHomeDir(), "gateway", "transcripts");
}

export class FileGatewayTranscriptStore implements GatewayTranscriptStore {
	private readonly sessionLocks = new Map<string, Promise<void>>();

	constructor(private readonly baseDir: string = resolveGatewayTranscriptStoreDir()) {}

	getBaseDir(): string {
		return this.baseDir;
	}

	async append(entry: GatewayTranscriptEntry): Promise<void> {
		await withSessionFileLock(this.sessionLocks, entry.sessionId, async () => {
			const path = this.resolveTranscriptPath(entry.sessionId);
			const current = await this.readEntries(path);
			current.push(entry);
			await writeSessionJsonEntries(path, "entries", current);
		});
	}

	async list(params: {
		sessionId: string;
		limit?: number;
	}): Promise<GatewayTranscriptEntry[]> {
		return await withSessionFileLock(this.sessionLocks, params.sessionId, async () => {
			const path = this.resolveTranscriptPath(params.sessionId);
			const entries = await this.readEntries(path);
			const limit = Math.max(1, params.limit ?? 50);
			return entries.slice(-limit);
		});
	}

	async remove(sessionId: string): Promise<void> {
		await withSessionFileLock(this.sessionLocks, sessionId, async () => {
			await rm(this.resolveTranscriptPath(sessionId), { force: true });
		});
	}

	private resolveTranscriptPath(sessionId: string): string {
		return resolveSessionFileStorePath(this.baseDir, sessionId);
	}

	private async readEntries(path: string): Promise<GatewayTranscriptEntry[]> {
		return await readSessionJsonEntries(path, "entries", (entry) => ({
			sessionId: String(entry.sessionId ?? ""),
			role: entry.role === "assistant" ? "assistant" : "user",
			text: String(entry.text ?? ""),
			timestamp: Number(entry.timestamp),
			channelId: typeof entry.channelId === "string" ? entry.channelId : undefined,
			senderId: typeof entry.senderId === "string" ? entry.senderId : undefined,
			threadId: typeof entry.threadId === "string" ? entry.threadId : undefined,
			meta: entry.meta && typeof entry.meta === "object" && !Array.isArray(entry.meta)
				? entry.meta as Record<string, unknown>
				: undefined,
		}));
	}

}
