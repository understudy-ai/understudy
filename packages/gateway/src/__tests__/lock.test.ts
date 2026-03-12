import { describe, it, expect, afterEach } from "vitest";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GatewayLock } from "../lock.js";

describe("GatewayLock", () => {
	const testDir = join(tmpdir(), "understudy-lock-test-" + process.pid);
	const lockPath = join(testDir, "test.lock");

	afterEach(() => {
		try { unlinkSync(lockPath); } catch {}
	});

	it("acquires lock on first attempt", () => {
		mkdirSync(testDir, { recursive: true });
		const lock = new GatewayLock(lockPath);
		expect(lock.acquire(23333)).toBe(true);
		expect(existsSync(lockPath)).toBe(true);
		lock.release();
	});

	it("reads lock data", () => {
		mkdirSync(testDir, { recursive: true });
		const lock = new GatewayLock(lockPath);
		lock.acquire(23333);
		const data = GatewayLock.read(lockPath);
		expect(data).not.toBeNull();
		expect(data!.pid).toBe(process.pid);
		expect(data!.port).toBe(23333);
		lock.release();
	});

	it("releases lock and removes file", () => {
		mkdirSync(testDir, { recursive: true });
		const lock = new GatewayLock(lockPath);
		lock.acquire(23333);
		lock.release();
		expect(existsSync(lockPath)).toBe(false);
	});

	it("blocks second lock from same process", () => {
		mkdirSync(testDir, { recursive: true });
		const lock1 = new GatewayLock(lockPath);
		lock1.acquire(23333);
		// PID is alive (our own), so second acquire should fail
		const lock2 = new GatewayLock(lockPath);
		expect(lock2.acquire(18790)).toBe(false);
		lock1.release();
	});

	it("returns null for non-existent lock", () => {
		expect(GatewayLock.read("/tmp/non-existent-lock-file.lock")).toBeNull();
	});
});
