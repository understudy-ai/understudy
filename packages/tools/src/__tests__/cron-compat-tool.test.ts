import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createOpenClawCronCompatibilityTool } from "../cron-compat-tool.js";
import { createScheduleTool } from "../schedule/schedule-tool.js";
import { ScheduleService } from "../schedule/schedule-service.js";
import type { StoredScheduleJob } from "../schedule/schedule-store.js";

const mocks = vi.hoisted(() => ({
	stopMock: vi.fn(),
	instances: [] as Array<{
		pattern: string;
		options?: Record<string, unknown>;
		fire: () => Promise<void>;
		stop: () => void;
	}>,
}));

vi.mock("croner", () => {
	class MockCron {
		readonly pattern: string;
		readonly options?: Record<string, unknown>;
		private readonly cb: () => Promise<void> | void;

		constructor(
			pattern: string,
			optionsOrCb?: Record<string, unknown> | (() => Promise<void> | void),
			cb?: () => Promise<void> | void,
		) {
			this.pattern = pattern;
			if (typeof optionsOrCb === "function") {
				this.cb = optionsOrCb;
				this.options = undefined;
			} else {
				this.options = optionsOrCb;
				this.cb = cb ?? (() => {});
			}
			mocks.instances.push(this as unknown as {
				pattern: string;
				options?: Record<string, unknown>;
				fire: () => Promise<void>;
				stop: () => void;
			});
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

async function createCronTool(onJobTrigger?: (job: StoredScheduleJob) => Promise<void>) {
	const tempDir = await mkdtemp(join(tmpdir(), "understudy-cron-compat-tool-"));
	tempDirs.push(tempDir);
	const scheduleService = new ScheduleService({
		storePath: join(tempDir, "jobs.json"),
		onJobTrigger: onJobTrigger ?? (async () => {}),
	});
	await scheduleService.start();
	services.push(scheduleService);
	const scheduleTool = createScheduleTool({ scheduleService });
	return {
		scheduleService,
		scheduleTool,
		cronTool: createOpenClawCronCompatibilityTool(scheduleTool),
	};
}

afterEach(async () => {
	for (const service of services.splice(0)) {
		service.stop();
	}
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createOpenClawCronCompatibilityTool", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.instances.length = 0;
	});

	it("translates OpenClaw cron jobs onto Understudy schedule entries", async () => {
		const { cronTool, scheduleService } = await createCronTool();
		const result = await cronTool.execute("id", {
			action: "add",
			job: {
				name: "daily-digest",
				schedule: {
					kind: "cron",
					expr: "0 9 * * *",
					tz: "Asia/Hong_Kong",
				},
				payload: {
					kind: "agentTurn",
					message: "summarize inbox",
				},
				enabled: false,
				delivery: {
					mode: "announce",
					channel: "telegram",
					to: "alice",
				},
			},
		});
		const text = (result.content[0] as { text: string }).text;
		const jobs = scheduleService.list({ includeDisabled: true });

		expect(text).toContain('Scheduled job "daily-digest"');
		expect(jobs).toHaveLength(1);
		expect(jobs[0]).toMatchObject({
			name: "daily-digest",
			schedule: "0 9 * * *",
			command: "summarize inbox",
			enabled: false,
			delivery: {
				channelId: "telegram",
				senderId: "alice",
			},
			scheduleOptions: {
				timezone: "Asia/Hong_Kong",
			},
		});
	});

	it("supports everyMs intervals and preserves them in schedule options", async () => {
		const { cronTool, scheduleService } = await createCronTool();
		await cronTool.execute("id", {
			action: "add",
			job: {
				name: "heartbeat",
				schedule: {
					kind: "every",
					everyMs: 2_500,
					anchorMs: Date.parse("2030-01-02T03:04:05.000Z"),
				},
				payload: {
					kind: "systemEvent",
					text: "wake up",
				},
			},
		});
		const job = scheduleService.list({ includeDisabled: true })[0];

		expect(job.schedule).toBe("* * * * * *");
		expect(job.scheduleOptions).toMatchObject({
			intervalSeconds: 3,
			startAt: "2030-01-02T03:04:05.000Z",
		});
	});

	it("rejects malformed numeric strings for everyMs instead of parsing a prefix", async () => {
		const { cronTool, scheduleService } = await createCronTool();
		const result = await cronTool.execute("id", {
			action: "add",
			job: {
				name: "heartbeat",
				schedule: {
					kind: "every",
					everyMs: "5m",
				},
				payload: {
					kind: "systemEvent",
					text: "wake up",
				},
			},
		});

		expect((result.content[0] as { text: string }).text).toContain(
			"OpenClaw cron compatibility requires a positive schedule.everyMs for kind=every",
		);
		expect(result.details).toMatchObject({
			status: "failed",
		});
		expect(scheduleService.list({ includeDisabled: true })).toHaveLength(0);
	});

	it("rejects OpenClaw webhook delivery that Understudy cannot emulate", async () => {
		const { cronTool } = await createCronTool();
		const result = await cronTool.execute("id", {
			action: "add",
			job: {
				name: "notify",
				schedule: {
					kind: "cron",
					expr: "0 * * * *",
				},
				payload: {
					kind: "systemEvent",
					text: "ping",
				},
				delivery: {
					mode: "webhook",
					to: "https://example.com/webhook",
				},
			},
		});

		expect((result.content[0] as { text: string }).text).toContain(
			"OpenClaw webhook delivery is not supported",
		);
		expect(result.details).toMatchObject({
			status: "failed",
		});
	});
});
