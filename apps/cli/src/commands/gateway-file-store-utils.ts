import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export function encodeSessionIdForFileStore(sessionId: string): string {
	const normalized = sessionId.trim();
	const safe = normalized.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "session";
	const suffix = createHash("sha1").update(normalized).digest("hex").slice(0, 10);
	return `${safe}-${suffix}`;
}

export function resolveSessionFileStorePath(baseDir: string, sessionId: string): string {
	return join(baseDir, `${encodeSessionIdForFileStore(sessionId)}.json`);
}

export async function readSessionJsonEntries<T>(
	path: string,
	key: string,
	normalizeEntry: (entry: Record<string, unknown>) => T | undefined,
): Promise<T[]> {
	try {
		const raw = await readFile(path, "utf8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const entries = parsed[key];
		if (!Array.isArray(entries)) {
			return [];
		}
		return entries
			.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
			.map((entry) => normalizeEntry(entry))
			.filter((entry): entry is T => entry !== undefined);
	} catch {
		return [];
	}
}

export async function writeSessionJsonEntries<T>(
	path: string,
	key: string,
	entries: T[],
): Promise<void> {
	await atomicWriteJsonFile(path, { [key]: entries }, "utf8");
}

export async function atomicWriteJsonFile(
	path: string,
	payload: unknown,
	encoding: BufferEncoding = "utf-8",
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tmpPath = `${path}.tmp`;
	await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, encoding);
	await rename(tmpPath, path);
}

export async function withSessionFileLock<T>(
	sessionLocks: Map<string, Promise<void>>,
	sessionId: string,
	operation: () => Promise<T>,
): Promise<T> {
	const previous = sessionLocks.get(sessionId) ?? Promise.resolve();
	let release: (() => void) | undefined;
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	const tail = previous.catch(() => {}).then(() => current);
	sessionLocks.set(sessionId, tail);
	void tail.finally(() => {
		if (sessionLocks.get(sessionId) === tail) {
			sessionLocks.delete(sessionId);
		}
	});
	await previous.catch(() => {});
	try {
		return await operation();
	} finally {
		release?.();
	}
}
