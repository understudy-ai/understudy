import { createRpcClient } from "../rpc-client.js";

interface ScheduleOptions {
	list?: boolean;
	status?: boolean;
	add?: boolean;
	update?: string;
	remove?: string;
	run?: string;
	runs?: string;
	name?: string;
	schedule?: string;
	command?: string;
	enable?: boolean;
	disable?: boolean;
	channelId?: string;
	senderId?: string;
	limit?: string;
	json?: boolean;
	port?: string;
	timeout?: string;
}

const DEFAULT_SCHEDULE_TIMEOUT_MS = 600_000;

function resolveScheduleTimeout(rawTimeout?: string): number {
	const parsedTimeout = rawTimeout ? parseInt(rawTimeout, 10) : undefined;
	if (typeof parsedTimeout === "number" && Number.isFinite(parsedTimeout) && parsedTimeout > 0) {
		return parsedTimeout;
	}
	return DEFAULT_SCHEDULE_TIMEOUT_MS;
}

function printJobs(jobs: Array<Record<string, unknown>>): void {
	if (jobs.length === 0) {
		console.log("No schedule jobs configured.");
		return;
	}
	console.log(`Schedule jobs (${jobs.length}):`);
	for (const job of jobs) {
		console.log(
			`  ${String(job.id)} — ${String(job.name ?? "unnamed")} [${job.enabled === false ? "disabled" : "enabled"}] ${String(job.schedule ?? "")}`,
		);
	}
}

export async function runScheduleCommand(opts: ScheduleOptions = {}): Promise<void> {
	const client = createRpcClient({
		port: opts.port ? parseInt(opts.port, 10) : undefined,
		timeout: resolveScheduleTimeout(opts.timeout),
	});

	try {
		if (opts.add) {
			if (!opts.schedule || !opts.command) {
				throw new Error("schedule.add requires --schedule and --command");
			}
			const result = await client.call<Record<string, unknown>>("schedule.add", {
				name: opts.name,
				schedule: opts.schedule,
				command: opts.command,
				enabled: opts.disable ? false : true,
				delivery: opts.channelId || opts.senderId
					? {
						channelId: opts.channelId,
						senderId: opts.senderId,
					}
					: undefined,
			});
			if (opts.json) {
				console.log(JSON.stringify(result, null, 2));
				return;
			}
			console.log(`Schedule job added: ${String(result.id ?? result.name ?? "unknown")}`);
			return;
		}

		if (opts.update) {
			const enabled = opts.enable ? true : opts.disable ? false : undefined;
			const result = await client.call<Record<string, unknown>>("schedule.update", {
				id: opts.update,
				name: opts.name,
				schedule: opts.schedule,
				command: opts.command,
				enabled,
				delivery: opts.channelId || opts.senderId
					? {
						channelId: opts.channelId,
						senderId: opts.senderId,
					}
					: undefined,
			});
			if (opts.json) {
				console.log(JSON.stringify(result, null, 2));
				return;
			}
			console.log(`Schedule job updated: ${String(result.id ?? opts.update)}`);
			return;
		}

		if (opts.remove) {
			const result = await client.call<Record<string, unknown>>("schedule.remove", { id: opts.remove });
			if (opts.json) {
				console.log(JSON.stringify(result, null, 2));
				return;
			}
			console.log(`Schedule job removed: ${opts.remove}`);
			return;
		}

		if (opts.run) {
			const result = await client.call<Record<string, unknown>>("schedule.run", { id: opts.run });
			if (opts.json) {
				console.log(JSON.stringify(result, null, 2));
				return;
			}
			console.log(`Schedule job triggered: ${opts.run}`);
			if (result.reason) {
				console.log(`Result: ${String(result.reason)}`);
			}
			return;
		}

		if (opts.runs) {
			const result = await client.call<Record<string, unknown>>("schedule.runs", {
				id: opts.runs,
				limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
			});
			if (opts.json) {
				console.log(JSON.stringify(result, null, 2));
				return;
			}
			console.log(JSON.stringify(result, null, 2));
			return;
		}

		if (opts.status) {
			const result = await client.call<Record<string, unknown>>("schedule.status", {});
			if (opts.json) {
				console.log(JSON.stringify(result, null, 2));
				return;
			}
			console.log(JSON.stringify(result, null, 2));
			return;
		}

		const result = await client.call<Array<Record<string, unknown>>>("schedule.list", {});
		if (opts.json) {
			console.log(JSON.stringify(result, null, 2));
			return;
		}
		printJobs(Array.isArray(result) ? result : []);
	} catch (error) {
		console.error("Error:", error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
