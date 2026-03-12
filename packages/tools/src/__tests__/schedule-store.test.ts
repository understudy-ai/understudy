import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, rmSync } from "node:fs";
import { ScheduleStore } from "../schedule/schedule-store.js";
import type { StoredScheduleJob } from "../schedule/schedule-store.js";

describe("ScheduleStore", () => {
	const storeDir = join(tmpdir(), `understudy-schedule-test-${process.pid}`);
	const storePath = join(storeDir, "schedule-store.json");
	let store: ScheduleStore;

	afterEach(() => {
		rmSync(storeDir, { recursive: true, force: true });
	});

	function makeJob(id: string, name?: string): StoredScheduleJob {
		return {
			id,
			name: name ?? id,
			schedule: "0 * * * *",
			command: `echo ${id}`,
			enabled: true,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			runCount: 0,
			failCount: 0,
		};
	}

	it("creates store file on first save", () => {
		store = new ScheduleStore(storePath);
		store.load();
		expect(store.list()).toHaveLength(0);

		store.add(makeJob("j1"));
		expect(existsSync(storePath)).toBe(true);
		expect(store.list()).toHaveLength(1);
	});

	it("persists and reloads jobs", () => {
		store = new ScheduleStore(storePath);
		store.add(makeJob("j1", "Job 1"));
		store.add(makeJob("j2", "Job 2"));

		// Reload from disk
		const store2 = new ScheduleStore(storePath);
		store2.load();
		expect(store2.list()).toHaveLength(2);
		expect(store2.get("j1")?.name).toBe("Job 1");
		expect(store2.get("j2")?.name).toBe("Job 2");
	});

	it("updates and removes jobs", () => {
		store = new ScheduleStore(storePath);
		store.add(makeJob("j1"));
		store.update("j1", { name: "Updated" });
		expect(store.get("j1")?.name).toBe("Updated");

		store.remove("j1");
		expect(store.list()).toHaveLength(0);
	});

	it("manages run records with pruning", () => {
		store = new ScheduleStore(storePath, { maxRuns: 3 });
		store.add(makeJob("j1"));

		for (let i = 0; i < 5; i++) {
			store.appendRun({
				id: `run_${i}`,
				jobId: "j1",
				startedAt: new Date().toISOString(),
				status: "ok",
			});
		}

		// Should prune to maxRuns=3
		const runs = store.getRuns("j1");
		expect(runs.length).toBe(3);
		// Should have the last 3 runs
		expect(runs[0].id).toBe("run_2");
	});

	it("removes run records when job is deleted", () => {
		store = new ScheduleStore(storePath);
		store.add(makeJob("j1"));
		store.appendRun({ id: "r1", jobId: "j1", startedAt: new Date().toISOString(), status: "ok" });
		expect(store.getRuns("j1").length).toBe(1);

		store.remove("j1");
		expect(store.getRuns("j1").length).toBe(0);
	});

	it("creates backup file on save", () => {
		store = new ScheduleStore(storePath);
		store.add(makeJob("j1"));
		// First save creates the file
		// Second save should create .bak
		store.add(makeJob("j2"));
		expect(existsSync(storePath + ".bak")).toBe(true);
	});

	it("throws on duplicate job ID", () => {
		store = new ScheduleStore(storePath);
		store.add(makeJob("j1"));
		expect(() => store.add(makeJob("j1"))).toThrow("already exists");
	});
});
