/**
 * PairingManager: 8-char code pairing for DM security.
 * Manages pairing codes and AllowFrom store.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

const CODE_LENGTH = 8;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No I/O/0/1 to avoid confusion
const CODE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_PENDING_PER_CHANNEL = 3;

export interface PairingRequest {
	id: string;
	code: string;
	channelId: string;
	createdAt: number;
	lastSeenAt: number;
	meta?: Record<string, unknown>;
}

export interface AllowFromEntry {
	channelId: string;
	senderId: string;
	addedAt: number;
	pairedVia?: string;
}

interface PairingStore {
	pendingRequests: PairingRequest[];
	allowFrom: AllowFromEntry[];
}

export class PairingManager {
	private store: PairingStore;
	private storePath: string;

	constructor(storePath: string) {
		this.storePath = storePath;
		this.store = this.loadStore();
	}

	/** Create an in-memory pairing manager (for testing) */
	static inMemory(): PairingManager {
		const mgr = new PairingManager(":memory:");
		mgr.store = { pendingRequests: [], allowFrom: [] };
		return mgr;
	}

	/** Generate a new pairing code for a channel */
	generateCode(channelId: string, meta?: Record<string, unknown>): string {
		this.pruneExpired();

		// Enforce max pending per channel
		const channelPending = this.store.pendingRequests.filter(
			(r) => r.channelId === channelId,
		);
		if (channelPending.length >= MAX_PENDING_PER_CHANNEL) {
			// Remove oldest
			const oldest = channelPending.sort((a, b) => a.createdAt - b.createdAt)[0];
			this.store.pendingRequests = this.store.pendingRequests.filter(
				(r) => r.id !== oldest.id,
			);
		}

		const code = this.randomCode();
		const request: PairingRequest = {
			id: `pair_${Date.now()}_${randomBytes(4).toString("hex")}`,
			code,
			channelId,
			createdAt: Date.now(),
			lastSeenAt: Date.now(),
			meta,
		};

		this.store.pendingRequests.push(request);
		this.saveStore();

		return code;
	}

	/** Validate a pairing code and add sender to allowlist */
	approve(code: string, channelId: string, senderId: string): boolean {
		this.pruneExpired();

		const upperCode = code.toUpperCase().trim();
		const idx = this.store.pendingRequests.findIndex(
			(r) => r.code === upperCode && r.channelId === channelId,
		);

		if (idx === -1) return false;

		// Remove the pairing request
		this.store.pendingRequests.splice(idx, 1);

		// Add to allowlist (idempotent)
		if (!this.isAllowed(channelId, senderId)) {
			this.store.allowFrom.push({
				channelId,
				senderId,
				addedAt: Date.now(),
				pairedVia: "code",
			});
		}

		this.saveStore();
		return true;
	}

	/** Reject (invalidate) a pairing code without adding sender access */
	reject(code: string, channelId?: string): boolean {
		const upperCode = code.toUpperCase().trim();
		if (!upperCode) return false;
		const before = this.store.pendingRequests.length;
		this.store.pendingRequests = this.store.pendingRequests.filter((request) => {
			if (request.code !== upperCode) return true;
			if (channelId && request.channelId !== channelId) return true;
			return false;
		});
		if (this.store.pendingRequests.length !== before) {
			this.saveStore();
			return true;
		}
		return false;
	}

	/** Check if a sender is allowed on a channel */
	isAllowed(channelId: string, senderId: string): boolean {
		return this.store.allowFrom.some(
			(e) => e.channelId === channelId && e.senderId === senderId,
		);
	}

	/** Add a sender to the allowlist directly */
	addAllowed(channelId: string, senderId: string): void {
		if (this.isAllowed(channelId, senderId)) return;
		this.store.allowFrom.push({
			channelId,
			senderId,
			addedAt: Date.now(),
		});
		this.saveStore();
	}

	/** Remove a sender from the allowlist */
	removeAllowed(channelId: string, senderId: string): boolean {
		const before = this.store.allowFrom.length;
		this.store.allowFrom = this.store.allowFrom.filter(
			(e) => !(e.channelId === channelId && e.senderId === senderId),
		);
		if (this.store.allowFrom.length !== before) {
			this.saveStore();
			return true;
		}
		return false;
	}

	/** List pending pairing requests for a channel */
	listPending(channelId: string): PairingRequest[] {
		this.pruneExpired();
		return this.store.pendingRequests.filter((r) => r.channelId === channelId);
	}

	/** List all allowed entries */
	listAllowed(channelId?: string): AllowFromEntry[] {
		if (channelId) {
			return this.store.allowFrom.filter((e) => e.channelId === channelId);
		}
		return [...this.store.allowFrom];
	}

	private randomCode(): string {
		const bytes = randomBytes(CODE_LENGTH);
		return Array.from(bytes)
			.map((b) => CODE_CHARS[b % CODE_CHARS.length])
			.join("");
	}

	private pruneExpired(): void {
		const now = Date.now();
		this.store.pendingRequests = this.store.pendingRequests.filter(
			(r) => now - r.createdAt < CODE_TTL_MS,
		);
	}

	private loadStore(): PairingStore {
		if (this.storePath === ":memory:" || !existsSync(this.storePath)) {
			return { pendingRequests: [], allowFrom: [] };
		}
		try {
			return JSON.parse(readFileSync(this.storePath, "utf-8"));
		} catch {
			return { pendingRequests: [], allowFrom: [] };
		}
	}

	private saveStore(): void {
		if (this.storePath === ":memory:") return;
		const dir = dirname(this.storePath);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(this.storePath, JSON.stringify(this.store, null, "\t"), "utf-8");
	}
}
