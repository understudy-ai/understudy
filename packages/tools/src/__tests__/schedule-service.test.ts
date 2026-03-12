import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { ScheduleService } from "../schedule/schedule-service.js";

describe("ScheduleService", () => {
	const testDir = join(tmpdir(), `understudy-schedule-svc-test-${process.pid}`);
	const storePath = join(testDir, "schedule-store.json");
	let service: ScheduleService;

	afterEach(() => {
		service?.stop();
		try { rmSync(testDir, { recursive: true, force: true }); } catch {}
	});

	function createService(onTrigger?: (job: any) => Promise<void>): ScheduleService {
		service = new ScheduleService({
			storePath,
			onJobTrigger: onTrigger ?? (async () => {}),
		});
		return service;
	}

	it("starts and stops without errors", async () => {
		const svc = createService();
		await svc.start();
		const status = svc.status();
		expect(status.running).toBe(true);
		expect(status.jobCount).toBe(0);
		svc.stop();
		expect(svc.status().running).toBe(false);
	});

	it("adds, lists, and removes jobs with persistence", async () => {
		const svc = createService();
		await svc.start();

		const job = await svc.add({
			name: "test-job",
			schedule: "0 * * * *",
			command: "echo hello",
		});

		expect(job.id).toBeTruthy();
		expect(job.name).toBe("test-job");
		expect(job.enabled).toBe(true);
		expect(job.nextRun).toBeTruthy();

		const list = svc.list({ includeDisabled: true });
		expect(list).toHaveLength(1);

		// Verify persistence — create new service from same store
		svc.stop();
		const svc2 = new ScheduleService({
			storePath,
			onJobTrigger: async () => {},
		});
		await svc2.start();
		expect(svc2.list({ includeDisabled: true })).toHaveLength(1);
		expect(svc2.getJob(job.id)?.name).toBe("test-job");

		const result = await svc2.remove(job.id);
		expect(result.removed).toBe(true);
		expect(svc2.list().length).toBe(0);

		service = svc2; // for cleanup
	});

	it("updates job schedule and name", async () => {
		const svc = createService();
		await svc.start();

		const job = await svc.add({
			name: "old-name",
			schedule: "0 * * * *",
			command: "echo test",
		});

		const updated = await svc.update(job.id, {
			name: "new-name",
			schedule: "30 * * * *",
		});

		expect(updated.name).toBe("new-name");
		expect(updated.schedule).toBe("30 * * * *");
	});

	it("manually runs a job and records run history", async () => {
		let triggered = false;
		const svc = createService(async () => { triggered = true; });
		await svc.start();

		const job = await svc.add({
			name: "manual-test",
			schedule: "0 0 1 1 *", // yearly — won't auto-trigger
			command: "echo manual",
		});

		const result = await svc.run(job.id);
		expect(result.ok).toBe(true);
		expect(result.ran).toBe(true);
		expect(triggered).toBe(true);

		const runs = svc.getRuns(job.id);
		expect(runs).toHaveLength(1);
		expect(runs[0].status).toBe("ok");
		expect(runs[0].jobId).toBe(job.id);
	});

	it("records failed runs", async () => {
		const svc = createService(async () => { throw new Error("boom"); });
		await svc.start();

		const job = await svc.add({
			name: "fail-test",
			schedule: "0 0 1 1 *",
			command: "fail",
		});

		await svc.run(job.id);

		const runs = svc.getRuns(job.id);
		expect(runs).toHaveLength(1);
		expect(runs[0].status).toBe("error");
		expect(runs[0].error).toBe("boom");

		const updated = svc.getJob(job.id);
		expect(updated?.failCount).toBe(1);
		expect(updated?.runCount).toBe(1);
	});

	it("returns error for non-existent job run", async () => {
		const svc = createService();
		await svc.start();
		const result = await svc.run("nonexistent");
		expect(result.ok).toBe(false);
		expect(result.reason).toBe("Job not found");
	});
});
