/**
 * AuthRateLimiter: in-memory sliding-window rate limiter for auth attempts.
 * Loopback addresses (127.0.0.1, ::1) are exempt by default.
 */

import { isLoopbackAddress } from "./net.js";

export interface RateLimiterConfig {
	/** Max failed attempts before lockout (default: 10) */
	maxAttempts?: number;
	/** Sliding window in ms (default: 15 minutes) */
	windowMs?: number;
	/** Lockout duration in ms (default: 15 minutes) */
	lockoutMs?: number;
	/** Whether to exempt loopback addresses (default: true) */
	exemptLoopback?: boolean;
}

interface AttemptRecord {
	timestamps: number[];
	lockedUntil?: number;
}

export class AuthRateLimiter {
	private records = new Map<string, AttemptRecord>();
	private maxAttempts: number;
	private windowMs: number;
	private lockoutMs: number;
	private exemptLoopback: boolean;
	private pruneTimer: ReturnType<typeof setInterval>;

	constructor(config: RateLimiterConfig = {}) {
		this.maxAttempts = config.maxAttempts ?? 10;
		this.windowMs = config.windowMs ?? 15 * 60 * 1000;
		this.lockoutMs = config.lockoutMs ?? 15 * 60 * 1000;
		this.exemptLoopback = config.exemptLoopback !== false;

		// Prune stale records every 5 minutes
		this.pruneTimer = setInterval(() => this.prune(), 5 * 60 * 1000);
		this.pruneTimer.unref();
	}

	/**
	 * Check if the IP is allowed to attempt authentication.
	 * Returns true if allowed, false if rate limited.
	 */
	check(ip: string): boolean {
		if (this.exemptLoopback && isLoopbackAddress(ip)) return true;

		const record = this.records.get(ip);
		if (!record) return true;

		const now = Date.now();
		if (record.lockedUntil && now < record.lockedUntil) {
			return false;
		}

		// Clear lockout if expired
		if (record.lockedUntil && now >= record.lockedUntil) {
			record.lockedUntil = undefined;
			record.timestamps = [];
		}

		return true;
	}

	/**
	 * Record a failed authentication attempt from the given IP.
	 */
	record(ip: string): void {
		if (this.exemptLoopback && isLoopbackAddress(ip)) return;

		const now = Date.now();
		let record = this.records.get(ip);
		if (!record) {
			record = { timestamps: [] };
			this.records.set(ip, record);
		}

		// Remove timestamps outside the window
		record.timestamps = record.timestamps.filter((t) => now - t < this.windowMs);
		record.timestamps.push(now);

		if (record.timestamps.length >= this.maxAttempts) {
			record.lockedUntil = now + this.lockoutMs;
			record.timestamps = [];
		}
	}

	/**
	 * Remove stale records (no timestamps and no active lockout).
	 */
	private prune(): void {
		const now = Date.now();
		for (const [ip, record] of this.records) {
			const hasActiveLockout = record.lockedUntil && now < record.lockedUntil;
			const hasRecentAttempts = record.timestamps.some((t) => now - t < this.windowMs);
			if (!hasActiveLockout && !hasRecentAttempts) {
				this.records.delete(ip);
			}
		}
	}

	/** Dispose the periodic prune timer */
	dispose(): void {
		clearInterval(this.pruneTimer);
	}

	/** Get record count (for testing) */
	get size(): number {
		return this.records.size;
	}
}
