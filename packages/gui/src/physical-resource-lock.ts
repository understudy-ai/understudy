import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface PhysicalResourceLockHolder {
	sessionId?: string;
	pid?: number;
	acquiredAt?: number;
	toolName?: string;
}

export interface PhysicalResourceLockRequest extends PhysicalResourceLockHolder {
	sessionId: string;
	pid: number;
	acquiredAt: number;
}

export interface PhysicalResourceLockAcquireResult {
	state: "fresh" | "reentrant" | "blocked";
	holder?: PhysicalResourceLockHolder;
}

export interface PhysicalResourceLock {
	acquire(request: PhysicalResourceLockRequest): Promise<PhysicalResourceLockAcquireResult>;
	release(request: Pick<PhysicalResourceLockRequest, "sessionId" | "pid">): Promise<boolean>;
}

interface FilePhysicalResourceLockOptions {
	path?: string;
	lockId?: string;
}

function defaultLockPath(): string {
	return process.env.UNDERSTUDY_GUI_LOCK_PATH?.trim() ||
		join(tmpdir(), "understudy-gui", "physical-resource.lock");
}

function isProcessAlive(pid: number | undefined): boolean {
	if (!Number.isInteger(pid) || !pid || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException | undefined)?.code === "EPERM";
	}
}

async function readLockHolder(path: string): Promise<PhysicalResourceLockHolder | undefined> {
	try {
		const raw = await readFile(path, "utf-8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		return {
			sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
			pid: typeof parsed.pid === "number" ? parsed.pid : undefined,
			acquiredAt: typeof parsed.acquiredAt === "number" ? parsed.acquiredAt : undefined,
			toolName: typeof parsed.toolName === "string" ? parsed.toolName : undefined,
		};
	} catch {
		return undefined;
	}
}

export class FilePhysicalResourceLock implements PhysicalResourceLock {
	private readonly path: string;
	private readonly lockId: string;
	private heldDepth = 0;

	constructor(options: FilePhysicalResourceLockOptions = {}) {
		this.path = options.path?.trim() || defaultLockPath();
		this.lockId = options.lockId?.trim() || randomUUID();
	}

	async acquire(request: PhysicalResourceLockRequest): Promise<PhysicalResourceLockAcquireResult> {
		if (this.heldDepth > 0) {
			this.heldDepth += 1;
			return { state: "reentrant" };
		}

		await mkdir(dirname(this.path), { recursive: true });
		const payload = JSON.stringify({
			lockId: this.lockId,
			sessionId: request.sessionId,
			pid: request.pid,
			acquiredAt: request.acquiredAt,
			toolName: request.toolName,
		});

		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				const handle = await open(this.path, "wx");
				try {
					await handle.writeFile(payload, "utf-8");
				} finally {
					await handle.close();
				}
				this.heldDepth = 1;
				return { state: "fresh" };
			} catch (error) {
				const code = (error as NodeJS.ErrnoException | undefined)?.code;
				if (code !== "EEXIST") {
					throw error;
				}
				const holder = await readLockHolder(this.path);
				if (holder?.sessionId === request.sessionId && holder.pid === request.pid) {
					this.heldDepth = 1;
					return { state: "reentrant", holder };
				}
				if (!isProcessAlive(holder?.pid)) {
					await unlink(this.path).catch(() => {});
					continue;
				}
				return { state: "blocked", holder };
			}
		}

		return {
			state: "blocked",
			holder: await readLockHolder(this.path),
		};
	}

	async release(request: Pick<PhysicalResourceLockRequest, "sessionId" | "pid">): Promise<boolean> {
		if (this.heldDepth <= 0) {
			return false;
		}
		this.heldDepth -= 1;
		if (this.heldDepth > 0) {
			return true;
		}

		const holder = await readLockHolder(this.path);
		if (holder?.sessionId !== request.sessionId || holder.pid !== request.pid) {
			return false;
		}
		await unlink(this.path).catch(() => {});
		return true;
	}
}
