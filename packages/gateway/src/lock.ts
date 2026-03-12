/**
 * GatewayLock: prevents multiple gateway instances from running simultaneously.
 * Writes PID + port to a lock file, checks if existing PID is alive.
 */

import { existsSync, readFileSync, unlinkSync, mkdirSync, openSync, writeSync, closeSync } from "node:fs";
import { dirname } from "node:path";

export interface LockFileData {
	pid: number;
	port: number;
	startedAt: string;
}

export class GatewayLock {
	private lockPath: string;
	private acquired = false;

	constructor(lockPath: string) {
		this.lockPath = lockPath;
	}

	/**
	 * Attempt to acquire the lock.
	 * Returns true if acquired, false if another instance is running.
	 * If the existing PID is dead, steals the lock.
	 */
	acquire(port: number): boolean {
		if (existsSync(this.lockPath)) {
			try {
				const raw = readFileSync(this.lockPath, "utf-8");
				const data = JSON.parse(raw) as LockFileData;

				if (isProcessAlive(data.pid)) {
					return false;
				}
				// Stale lock — previous instance died without cleanup, remove it
				try { unlinkSync(this.lockPath); } catch { /* ignore */ }
			} catch {
				// Corrupted lock file — remove and re-create
				try { unlinkSync(this.lockPath); } catch { /* ignore */ }
			}
		}

		const dir = dirname(this.lockPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		const data: LockFileData = {
			pid: process.pid,
			port,
			startedAt: new Date().toISOString(),
		};

		// Use O_EXCL for atomic lock creation (prevents TOCTOU race)
		try {
			const fd = openSync(this.lockPath, "wx");
			writeSync(fd, JSON.stringify(data, null, "\t"));
			closeSync(fd);
		} catch (err: any) {
			if (err.code === "EEXIST") return false; // another process won the race
			throw err;
		}

		this.acquired = true;
		return true;
	}

	/**
	 * Release the lock (only if we acquired it).
	 */
	release(): void {
		if (!this.acquired) return;

		try {
			if (existsSync(this.lockPath)) {
				const raw = readFileSync(this.lockPath, "utf-8");
				const data = JSON.parse(raw) as LockFileData;
				// Only delete if it's our PID
				if (data.pid === process.pid) {
					unlinkSync(this.lockPath);
				}
			}
		} catch {
			// Best effort
		}
		this.acquired = false;
	}

	/**
	 * Read existing lock data (if any).
	 */
	static read(lockPath: string): LockFileData | null {
		try {
			if (!existsSync(lockPath)) return null;
			const raw = readFileSync(lockPath, "utf-8");
			return JSON.parse(raw) as LockFileData;
		} catch {
			return null;
		}
	}
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
