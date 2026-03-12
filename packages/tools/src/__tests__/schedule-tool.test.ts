import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createScheduleTool } from "../schedule/schedule-tool.js";
import { ScheduleService } from "../schedule/schedule-service.js";
import type { StoredScheduleJob } from "../schedule/schedule-store.js";

const mocks = vi.hoisted(() => ({
	stopMock: vi.fn(),
	instances: [] as Array<{ expr: string; fire: () => Promise<void>; stop: () => void }>,
}));

vi.mock("croner", () => {
	class MockCron {
		readonly expr: string;
		private readonly cb: () => Promise<void> | void;

		constructor(expr: string, cb?: () => Promise<void> | void) {
			this.expr = expr;
			this.cb = cb ?? (() => {});
			mocks.instances.push(this as unknown as { expr: string; fire: () => Promise<void>; stop: () => void });
		}

		nextRun(): Date {
			return new Date("2030-01-01T00:00:00.000Z");
		}

		stop(): void {
			mocks.stopMock();
		}

		async fire(): Promise<void> {
			await this.cb();
		}
	}

	return { Cron: MockCron };
});

const tempDirs: string[] = [];
const services: ScheduleService[] = [];

async function createLocalScheduleTool(onJobTrigger: (job: StoredScheduleJob) => Promise<void>) {
	const tempDir = await mkdtemp(join(tmpdir(), "understudy-schedule-tool-"));
	tempDirs.push(tempDir);
	const scheduleService = new ScheduleService({
		storePath: join(tempDir, "jobs.json"),
		onJobTrigger,
	});
	await scheduleService.start();
	services.push(scheduleService);
	return createScheduleTool({ scheduleService });
}

function extractJobId(text: string): string {
	const match = text.match(/\((job_[^)]+)\)/);
	if (!match?.[1]) {
		throw new Error(`Unable to extract job id from: ${text}`);
	}
	return match[1];
}

afterEach(async () => {
	for (const service of services.splice(0)) {
		service.stop();
	}
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createScheduleTool", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.instances.length = 0;
	});

	it("returns list empty state", async () => {
		const tool = await createLocalScheduleTool(async () => {});
		const result = await tool.execute("id", { action: "list" });
		expect((result.content[0] as any).text).toContain("No scheduled jobs");
	});

	it("validates required fields on create", async () => {
		const tool = await createLocalScheduleTool(async () => {});
		const result = await tool.execute("id", { action: "create", name: "a" });
		expect((result.content[0] as any).text).toContain("name, schedule, and command are required");
	});

	it("creates jobs without auto-triggering and records successful manual runs", async () => {
		const onJobTrigger = vi.fn().mockResolvedValue(undefined);
		const tool = await createLocalScheduleTool(onJobTrigger);

		const create = await tool.execute("id", {
			action: "create",
			name: "daily-digest",
			schedule: "0 9 * * *",
			command: "summarize inbox",
		});
		const createText = (create.content[0] as any).text as string;
		const jobId = extractJobId(createText);

		expect(createText).toContain('Scheduled job "daily-digest"');
		expect(createText).toContain("Schedule: 0 9 * * *");
		expect(createText).toContain("Next run: 2030-01-01T00:00:00.000Z");
		expect(onJobTrigger).not.toHaveBeenCalled();
		expect(mocks.instances).toHaveLength(2);

		await mocks.instances[1]!.fire();

		expect(onJobTrigger).toHaveBeenCalledTimes(1);
		expect(onJobTrigger).toHaveBeenCalledWith(expect.objectContaining({
			id: jobId,
			name: "daily-digest",
			command: "summarize inbox",
		}));

		const runs = await tool.execute("id", { action: "runs", id: jobId });
		const runsText = (runs.content[0] as any).text as string;
		expect(runsText).toContain(`Runs for ${jobId}:`);
		expect(runsText).toContain(": ok started=");

		const remove = await tool.execute("id", { action: "remove", id: jobId });
		expect((remove.content[0] as any).text).toContain(`Removed job: ${jobId}`);
		expect(mocks.stopMock).toHaveBeenCalled();
	});

	it("recreates cron handles on schedule updates and targets jobs by id", async () => {
		const tool = await createLocalScheduleTool(async () => {});
		const created = await tool.execute("id", {
			action: "create",
			name: "nightly",
			schedule: "0 1 * * *",
			command: "backup",
		});
		const createdText = (created.content[0] as any).text as string;
		const jobId = extractJobId(createdText);

		const updated = await tool.execute("id", {
			action: "update",
			id: jobId,
			schedule: "0 2 * * *",
			command: "backup --full",
		});

		expect((updated.content[0] as any).text).toContain(`Updated job: nightly (${jobId})`);
		expect(mocks.instances).toHaveLength(4);
		expect(mocks.stopMock).toHaveBeenCalled();

		const list = await tool.execute("id", { action: "list" });
		expect((list.content[0] as any).text).toContain('0 2 * * * → "backup --full"');

		const remove = await tool.execute("id", { action: "remove", id: jobId });
		expect((remove.content[0] as any).text).toContain(`Removed job: ${jobId}`);
	});

	it("records failed runs and limits run history output", async () => {
		const onJobTrigger = vi.fn()
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValueOnce(undefined);
		const tool = await createLocalScheduleTool(onJobTrigger);
		const created = await tool.execute("id", {
			action: "create",
			name: "wake-me",
			schedule: "0 * * * *",
			command: "say hi",
		});
		const jobId = extractJobId((created.content[0] as any).text as string);

		const failed = await tool.execute("id", { action: "run", id: jobId });
		expect((failed.content[0] as any).text).toContain(`Triggered job: ${jobId}`);

		const second = await tool.execute("id", { action: "run", id: jobId });
		expect((second.content[0] as any).text).toContain(`Triggered job: ${jobId}`);

		const runs = await tool.execute("id", { action: "runs", id: jobId, limit: 1 });
		const runsText = (runs.content[0] as any).text as string;
		expect(runsText).toContain(`Runs for ${jobId}:`);
		expect(runsText).not.toContain("error=boom");

		const fullRuns = await tool.execute("id", { action: "runs", id: jobId, limit: 5 });
		expect((fullRuns.content[0] as any).text).toContain("error=boom");
	});

	it("inherits the current session delivery when create omits delivery", async () => {
		const onJobTrigger = vi.fn().mockResolvedValue(undefined);
		const tempDir = await mkdtemp(join(tmpdir(), "understudy-schedule-tool-default-delivery-"));
		tempDirs.push(tempDir);
		const scheduleService = new ScheduleService({
			storePath: join(tempDir, "jobs.json"),
			onJobTrigger,
		});
		await scheduleService.start();
		services.push(scheduleService);
		const tool = createScheduleTool({
			scheduleService,
			defaultDelivery: {
				channelId: "telegram",
				senderId: "u123",
				sessionId: "channel_sender:telegram:u123",
				threadId: "thread-1",
			},
		});

		const create = await tool.execute("id", {
			action: "create",
			name: "reminder",
			schedule: "0 9 * * *",
			command: "ping me",
		});
		const jobId = extractJobId((create.content[0] as any).text as string);
		const job = scheduleService.getJob(jobId);

		expect(job?.delivery).toEqual({
			channelId: "telegram",
			senderId: "u123",
			sessionId: "channel_sender:telegram:u123",
			threadId: "thread-1",
		});
	});

	it("uses the gateway bridge as the single scheduling surface when only gateway RPC is available", async () => {
		const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
			const payload = JSON.parse(String(init?.body ?? "{}")) as { method?: string; params?: Record<string, unknown> };
			switch (payload.method) {
				case "schedule.list":
					return new Response(JSON.stringify({
						result: [
							{
								id: "job-1",
								name: "daily-digest",
								schedule: "0 9 * * *",
								command: "summarize inbox",
								nextRun: "2030-01-01T00:00:00.000Z",
								runCount: 3,
								enabled: true,
							},
						],
					}), { status: 200 });
				case "schedule.run":
					return new Response(JSON.stringify({
						result: {
							id: payload.params?.id ?? "job-1",
							ok: true,
						},
					}), { status: 200 });
				default:
					return new Response(JSON.stringify({ result: {} }), { status: 200 });
			}
		});
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as typeof fetch;
		try {
			const tool = createScheduleTool({
				gateway: { gatewayUrl: "http://127.0.0.1:23333" },
			});

			const list = await tool.execute("id", { action: "list" });
			expect((list.content[0] as any).text).toContain("daily-digest");

			const runNow = await tool.execute("id", { action: "run", id: "job-1" });
			expect((runNow.content[0] as any).text).toContain("Triggered job: job-1");
			expect(fetchMock).toHaveBeenCalledTimes(2);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("requires ids for targeted operations", async () => {
		const tool = await createLocalScheduleTool(async () => {});

		expect((await tool.execute("id", { action: "update", name: "nightly" })).content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("id is required for update"),
		});
		expect((await tool.execute("id", { action: "run" })).content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("id is required for run"),
		});
		expect((await tool.execute("id", { action: "runs" })).content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("id is required for runs"),
		});
		expect((await tool.execute("id", { action: "remove" })).content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("id is required for remove"),
		});
	});

	it("returns unknown action text", async () => {
		const tool = await createLocalScheduleTool(async () => {});
		const result = await tool.execute("id", { action: "unknown" });
		expect((result.content[0] as any).text).toContain("Unknown action");
	});
});
