/**
 * ScheduleService wraps the persistent schedule store and Croner handles.
 */

import { ScheduleStore } from "./schedule-store.js";
import type { ScheduleOptions, StoredScheduleJob, ScheduleRunRecord } from "./schedule-store.js";

export interface ScheduleServiceConfig {
	storePath: string;
	maxRuns?: number;
	onJobTrigger: (job: StoredScheduleJob) => Promise<void>;
	log?: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void; debug?: (msg: string) => void };
}

export interface ScheduleServiceStatus {
	running: boolean;
	jobCount: number;
	enabledCount: number;
	nextWakeAtMs?: number;
}

async function createCronHandle(
	schedule: string,
	options?: ScheduleOptions,
	cb?: () => Promise<void> | void,
) {
	const { Cron } = await import("croner" as string);
	const normalizedOptions: Record<string, unknown> = {};
	if (options?.timezone?.trim()) {
		normalizedOptions.timezone = options.timezone.trim();
	}
	if (options?.startAt?.trim()) {
		normalizedOptions.startAt = options.startAt.trim();
	}
	if (options?.stopAt?.trim()) {
		normalizedOptions.stopAt = options.stopAt.trim();
	}
	if (typeof options?.intervalSeconds === "number" && Number.isFinite(options.intervalSeconds)) {
		normalizedOptions.interval = Math.max(1, Math.floor(options.intervalSeconds));
	}
	if (Object.keys(normalizedOptions).length === 0) {
		return cb ? new Cron(schedule, cb) : new Cron(schedule);
	}
	if (cb) {
		return new Cron(schedule, normalizedOptions, cb);
	}
	return new Cron(schedule, normalizedOptions);
}

async function computeNextRun(
	schedule: string,
	options?: ScheduleOptions,
): Promise<string | undefined> {
	const probe = await createCronHandle(schedule, options);
	const nextRun = probe.nextRun()?.toISOString();
	probe.stop();
	return nextRun;
}

export class ScheduleService {
	private readonly store: ScheduleStore;
	private readonly config: ScheduleServiceConfig;
	private readonly log: NonNullable<ScheduleServiceConfig["log"]>;
	private handles = new Map<string, { stop: () => void }>();
	private running = false;
	private opChain: Promise<void> = Promise.resolve();

	constructor(config: ScheduleServiceConfig) {
		this.config = config;
		this.store = new ScheduleStore(config.storePath, { maxRuns: config.maxRuns });
		this.log = config.log ?? { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
	}

	async start(): Promise<void> {
		this.store.load();
		this.running = true;

		const jobs = this.store.list().filter((job) => job.enabled);
		for (const job of jobs) {
			await this.armJob(job);
		}

		this.log.info(`ScheduleService started with ${jobs.length} enabled job(s)`);
	}

	stop(): void {
		this.running = false;
		for (const [, handle] of this.handles) {
			handle.stop();
		}
		this.handles.clear();
		this.log.info("ScheduleService stopped");
	}

	status(): ScheduleServiceStatus {
		const jobs = this.store.list();
		const enabledCount = jobs.filter((job) => job.enabled).length;
		return {
			running: this.running,
			jobCount: jobs.length,
			enabledCount,
		};
	}

	list(opts?: { includeDisabled?: boolean }): StoredScheduleJob[] {
		const jobs = this.store.list();
		if (opts?.includeDisabled) {
			return jobs;
		}
		return jobs.filter((job) => job.enabled);
	}

	async add(input: {
		name: string;
		schedule: string;
		command: string;
		enabled?: boolean;
		delivery?: StoredScheduleJob["delivery"];
		scheduleOptions?: ScheduleOptions;
	}): Promise<StoredScheduleJob> {
		return this.locked(async () => {
			const nextRun = await computeNextRun(input.schedule, input.scheduleOptions);

			const now = Date.now();
			const job: StoredScheduleJob = {
				id: `job_${now}_${Math.random().toString(36).slice(2, 6)}`,
				name: input.name,
				schedule: input.schedule,
				command: input.command,
				enabled: input.enabled ?? true,
				createdAt: now,
				updatedAt: now,
				runCount: 0,
				failCount: 0,
				nextRun,
				delivery: input.delivery,
				scheduleOptions: input.scheduleOptions,
			};

			this.store.add(job);

			if (job.enabled && this.running) {
				await this.armJob(job);
			}

			this.log.info(`Job added: ${job.name} (${job.id})`);
			return job;
		});
	}

	async update(id: string, patch: {
		name?: string;
		schedule?: string;
		command?: string;
		enabled?: boolean;
		delivery?: StoredScheduleJob["delivery"];
		scheduleOptions?: ScheduleOptions;
	}): Promise<StoredScheduleJob> {
		return this.locked(async () => {
			const existing = this.store.get(id);
			if (!existing) {
				throw new Error(`Job not found: ${id}`);
			}

			let nextRun = existing.nextRun;
			const scheduleChanged =
				patch.schedule && patch.schedule !== existing.schedule;
			const scheduleOptionsChanged =
				patch.scheduleOptions &&
				JSON.stringify(patch.scheduleOptions) !== JSON.stringify(existing.scheduleOptions ?? {});
			if (scheduleChanged || scheduleOptionsChanged) {
				nextRun = await computeNextRun(
					patch.schedule ?? existing.schedule,
					patch.scheduleOptions ?? existing.scheduleOptions,
				);
			}

			const updated = this.store.update(id, { ...patch, nextRun });

			if (this.running) {
				this.disarmJob(id);
				if (updated.enabled) {
					await this.armJob(updated);
				}
			}

			this.log.info(`Job updated: ${updated.name} (${updated.id})`);
			return updated;
		});
	}

	async remove(id: string): Promise<{ ok: boolean; removed: boolean }> {
		return this.locked(async () => {
			this.disarmJob(id);
			const removed = this.store.remove(id);
			if (removed) {
				this.log.info(`Job removed: ${id}`);
			}
			return { ok: true, removed };
		});
	}

	async run(id: string): Promise<{ ok: boolean; ran: boolean; reason?: string }> {
		const job = this.store.get(id);
		if (!job) {
			return { ok: false, ran: false, reason: "Job not found" };
		}

		await this.executeJob(job);
		return { ok: true, ran: true };
	}

	getRuns(jobId: string, limit?: number): ScheduleRunRecord[] {
		return this.store.getRuns(jobId, limit);
	}

	getJob(id: string): StoredScheduleJob | undefined {
		return this.store.get(id);
	}

	private async executeJob(job: StoredScheduleJob): Promise<void> {
		const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
		const startedAt = new Date().toISOString();

		const run: ScheduleRunRecord = {
			id: runId,
			jobId: job.id,
			startedAt,
			status: "ok",
		};

		try {
			await this.config.onJobTrigger(job);
			const finishedAt = new Date().toISOString();
			run.finishedAt = finishedAt;
			run.duration = Date.parse(finishedAt) - Date.parse(startedAt);

			this.store.update(job.id, {
				lastRunAt: Date.now(),
				runCount: job.runCount + 1,
			});
		} catch (error) {
			const finishedAt = new Date().toISOString();
			run.status = "error";
			run.error = error instanceof Error ? error.message : String(error);
			run.finishedAt = finishedAt;
			run.duration = Date.parse(finishedAt) - Date.parse(startedAt);

			this.store.update(job.id, {
				lastRunAt: Date.now(),
				runCount: job.runCount + 1,
				failCount: job.failCount + 1,
			});

			this.log.error(`Job ${job.name} (${job.id}) failed: ${run.error}`);
		}

		this.store.appendRun(run);

		try {
			const nextRun = await computeNextRun(job.schedule, job.scheduleOptions);
			this.store.update(job.id, { nextRun });
		} catch (error) {
			this.log.debug?.(
				`Skipped post-run nextRun recompute for job ${job.id}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private async armJob(job: StoredScheduleJob): Promise<void> {
		this.disarmJob(job.id);

		try {
			const handle = await createCronHandle(job.schedule, job.scheduleOptions, async () => {
				if (!this.running) {
					return;
				}
				const current = this.store.get(job.id);
				if (current?.enabled) {
					await this.executeJob(current);
				}
			});

			this.handles.set(job.id, handle);

			const nextRun = handle.nextRun()?.toISOString();
			this.store.update(job.id, { nextRun });
		} catch (error) {
			this.log.error(
				`Failed to arm job ${job.id}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
			);
		}
	}

	private disarmJob(id: string): void {
		const handle = this.handles.get(id);
		if (handle) {
			handle.stop();
			this.handles.delete(id);
		}
	}

	private locked<T>(fn: () => Promise<T>): Promise<T> {
		const chainPromise = this.opChain.catch(() => {}).then(fn);
		this.opChain = chainPromise.then(() => {}, () => {});
		return chainPromise;
	}
}
