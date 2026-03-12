/**
 * Persistent schedule store backed by a JSON file.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface StoredScheduleJob {
	id: string;
	name: string;
	schedule: string;
	command: string;
	enabled: boolean;
	createdAt: number;
	updatedAt: number;
	lastRunAt?: number;
	nextRun?: string;
	runCount: number;
	failCount: number;
	delivery?: ScheduleDelivery;
	scheduleOptions?: ScheduleOptions;
}

export interface ScheduleDelivery {
	channelId?: string;
	senderId?: string;
	sessionId?: string;
	threadId?: string;
}

export interface ScheduleOptions {
	timezone?: string;
	startAt?: string;
	stopAt?: string;
	intervalSeconds?: number;
}

export interface ScheduleRunRecord {
	id: string;
	jobId: string;
	startedAt: string;
	finishedAt?: string;
	status: "ok" | "error";
	error?: string;
	duration?: number;
}

export interface ScheduleStoreData {
	jobs: StoredScheduleJob[];
	runs: ScheduleRunRecord[];
}

export class ScheduleStore {
	private data: ScheduleStoreData = { jobs: [], runs: [] };
	private loaded = false;
	private readonly maxRuns: number;

	constructor(
		private readonly storePath: string,
		opts?: { maxRuns?: number },
	) {
		this.maxRuns = opts?.maxRuns ?? 500;
	}

	load(): void {
		if (existsSync(this.storePath)) {
			try {
				const raw = readFileSync(this.storePath, "utf-8");
				const parsed = JSON.parse(raw);
				this.data = {
					jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
					runs: Array.isArray(parsed.runs) ? parsed.runs : [],
				};
			} catch {
				const bakPath = this.storePath + ".bak";
				if (existsSync(bakPath)) {
					try {
						const raw = readFileSync(bakPath, "utf-8");
						const parsed = JSON.parse(raw);
						this.data = {
							jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
							runs: Array.isArray(parsed.runs) ? parsed.runs : [],
						};
					} catch {
						this.data = { jobs: [], runs: [] };
					}
				} else {
					this.data = { jobs: [], runs: [] };
				}
			}
		}
		this.loaded = true;
	}

	save(): void {
		const dir = dirname(this.storePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		const tmpPath = this.storePath + ".tmp";
		const bakPath = this.storePath + ".bak";
		const content = JSON.stringify(this.data, null, 2);

		writeFileSync(tmpPath, content, "utf-8");

		try {
			if (existsSync(this.storePath)) {
				try {
					renameSync(this.storePath, bakPath);
				} catch {
					// Best-effort backup.
				}
			}
			renameSync(tmpPath, this.storePath);
		} catch (error) {
			if (!existsSync(this.storePath) && existsSync(bakPath)) {
				try {
					renameSync(bakPath, this.storePath);
				} catch {
					// Best-effort restore.
				}
			}
			throw error;
		}
	}

	private ensureLoaded(): void {
		if (!this.loaded) {
			this.load();
		}
	}

	list(): StoredScheduleJob[] {
		this.ensureLoaded();
		return [...this.data.jobs];
	}

	get(id: string): StoredScheduleJob | undefined {
		this.ensureLoaded();
		return this.data.jobs.find((job) => job.id === id);
	}

	add(job: StoredScheduleJob): void {
		this.ensureLoaded();
		if (this.data.jobs.some((existing) => existing.id === job.id)) {
			throw new Error(`Job already exists: ${job.id}`);
		}
		this.data.jobs.push(job);
		this.save();
	}

	update(id: string, patch: Partial<Omit<StoredScheduleJob, "id">>): StoredScheduleJob {
		this.ensureLoaded();
		const index = this.data.jobs.findIndex((job) => job.id === id);
		if (index === -1) {
			throw new Error(`Job not found: ${id}`);
		}
		const job = { ...this.data.jobs[index], ...patch, updatedAt: Date.now() };
		this.data.jobs[index] = job;
		this.save();
		return job;
	}

	remove(id: string): boolean {
		this.ensureLoaded();
		const before = this.data.jobs.length;
		this.data.jobs = this.data.jobs.filter((job) => job.id !== id);
		if (this.data.jobs.length < before) {
			this.data.runs = this.data.runs.filter((run) => run.jobId !== id);
			this.save();
			return true;
		}
		return false;
	}

	appendRun(run: ScheduleRunRecord): void {
		this.ensureLoaded();
		this.data.runs.push(run);
		this.pruneRuns();
		this.save();
	}

	getRuns(jobId: string, limit = 20): ScheduleRunRecord[] {
		this.ensureLoaded();
		return this.data.runs.filter((run) => run.jobId === jobId).slice(-limit);
	}

	pruneRuns(): void {
		if (this.data.runs.length > this.maxRuns) {
			this.data.runs = this.data.runs.slice(-this.maxRuns);
		}
	}
}
