import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FilePhysicalResourceLock } from "../physical-resource-lock.js";

const tempDirs: string[] = [];

async function createLockPath(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "understudy-gui-lock-test-"));
	tempDirs.push(dir);
	return join(dir, "physical-resource.lock");
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("FilePhysicalResourceLock", () => {
	it("acquires fresh, reenters for the same session, and releases cleanly", async () => {
		const path = await createLockPath();
		const lock = new FilePhysicalResourceLock({ path });
		const request = {
			sessionId: "session-a",
			pid: process.pid,
			acquiredAt: Date.now(),
			toolName: "gui_click",
		};

		await expect(lock.acquire(request)).resolves.toEqual({ state: "fresh" });
		await expect(lock.acquire(request)).resolves.toEqual({ state: "reentrant" });
		await expect(lock.release(request)).resolves.toBe(true);
		await expect(lock.release(request)).resolves.toBe(true);
	});

	it("reports blocked when another live session already holds the lock", async () => {
		const path = await createLockPath();
		const first = new FilePhysicalResourceLock({ path });
		const second = new FilePhysicalResourceLock({ path });

		await expect(
			first.acquire({
				sessionId: "session-a",
				pid: process.pid,
				acquiredAt: Date.now(),
				toolName: "gui_click",
			}),
		).resolves.toEqual({ state: "fresh" });

		await expect(
			second.acquire({
				sessionId: "session-b",
				pid: process.pid,
				acquiredAt: Date.now(),
				toolName: "gui_drag",
			}),
		).resolves.toMatchObject({
			state: "blocked",
			holder: {
				sessionId: "session-a",
				pid: process.pid,
				toolName: "gui_click",
			},
		});
	});

	it("reclaims a stale lock file before acquiring", async () => {
		const path = await createLockPath();
		await writeFile(
			path,
			JSON.stringify({
				sessionId: "stale-session",
				pid: -1,
				acquiredAt: Date.now() - 10_000,
				toolName: "gui_type",
			}),
			"utf-8",
		);
		const lock = new FilePhysicalResourceLock({ path });

		await expect(
			lock.acquire({
				sessionId: "session-b",
				pid: process.pid,
				acquiredAt: Date.now(),
				toolName: "gui_scroll",
			}),
		).resolves.toEqual({ state: "fresh" });
	});
});
