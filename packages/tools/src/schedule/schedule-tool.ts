/**
 * Schedule tool for Understudy.
 * Uses a single real scheduler backend: ScheduleService locally or gateway RPC remotely.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import {
	callGatewayRpc,
	errorResult,
	textResult,
	type BridgeGatewayOptions,
} from "../bridge/bridge-rpc.js";
import type { ScheduleService } from "./schedule-service.js";

const ScheduleSchema = Type.Object({
	action: Type.String({
		description: 'Action: "status", "create", "list", "update", "remove", "run", "runs", or "wake".',
	}),
	name: Type.Optional(Type.String({ description: "Job name for create, or the replacement name during update." })),
	schedule: Type.Optional(
		Type.String({
			description:
				'Schedule expression for create/update actions. Supports cron syntax, or an ISO timestamp for one-shot jobs.',
		}),
	),
	command: Type.Optional(
		Type.String({
			description: "Prompt text/command to run when the scheduled job triggers.",
		}),
	),
	enabled: Type.Optional(
		Type.Boolean({
			description: "Whether the job should start enabled.",
		}),
	),
	delivery: Type.Optional(
		Type.Object({
			channelId: Type.Optional(Type.String()),
			senderId: Type.Optional(Type.String()),
			sessionId: Type.Optional(Type.String()),
			threadId: Type.Optional(Type.String()),
		}),
	),
	scheduleOptions: Type.Optional(
		Type.Object({
			timezone: Type.Optional(Type.String()),
			startAt: Type.Optional(Type.String()),
			stopAt: Type.Optional(Type.String()),
			intervalSeconds: Type.Optional(Type.Number()),
		}),
	),
	limit: Type.Optional(Type.Number({ description: "Maximum number of runs returned by runs action." })),
	id: Type.Optional(Type.String({ description: "Job ID for update/remove/run/runs actions." })),
});

type ScheduleParams = Static<typeof ScheduleSchema>;

export interface ScheduleToolConfig {
	scheduleService?: ScheduleService;
	gateway?: BridgeGatewayOptions;
	defaultDelivery?: {
		channelId?: string;
		senderId?: string;
		sessionId?: string;
		threadId?: string;
	};
}

function unavailableResult(): AgentToolResult<unknown> {
	return textResult("Schedule error: scheduler backend is not configured");
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

function formatScheduleValue(job: Record<string, unknown>, fallback?: string): string {
	const value = job.schedule;
	const raw = typeof value === "string" && value.trim().length > 0 ? value.trim() : (fallback ?? "");
	const options = asRecord(job.scheduleOptions);
	const intervalSeconds = typeof options.intervalSeconds === "number" ? options.intervalSeconds : undefined;
	const timezone = typeof options.timezone === "string" && options.timezone.trim()
		? options.timezone.trim()
		: undefined;
	const startAt = typeof options.startAt === "string" && options.startAt.trim()
		? options.startAt.trim()
		: undefined;
	if (typeof intervalSeconds === "number" && Number.isFinite(intervalSeconds)) {
		return `every ${intervalSeconds}s${startAt ? ` starting ${startAt}` : ""}`;
	}
	if (timezone) {
		return `${raw} [tz=${timezone}]`;
	}
	return raw;
}

function resolveDelivery(
	requestedDelivery:
		| {
			channelId?: string;
			senderId?: string;
			sessionId?: string;
			threadId?: string;
		}
		| undefined,
	defaultDelivery:
		| {
			channelId?: string;
			senderId?: string;
			sessionId?: string;
			threadId?: string;
		}
		| undefined,
): {
	channelId?: string;
	senderId?: string;
	sessionId?: string;
	threadId?: string;
} | undefined {
	const merged = {
		channelId: requestedDelivery?.channelId ?? defaultDelivery?.channelId,
		senderId: requestedDelivery?.senderId ?? defaultDelivery?.senderId,
		sessionId: requestedDelivery?.sessionId ?? defaultDelivery?.sessionId,
		threadId: requestedDelivery?.threadId ?? defaultDelivery?.threadId,
	};
	return merged.channelId || merged.senderId || merged.sessionId || merged.threadId ? merged : undefined;
}

export function createScheduleTool(config: ScheduleToolConfig): AgentTool<typeof ScheduleSchema> {
	const gateway = !config.scheduleService && config.gateway ? config.gateway : undefined;
	const scheduleService = config.scheduleService;

	async function callScheduleGateway<T>(
		method: string,
		params: Record<string, unknown>,
	): Promise<T> {
		if (!gateway) {
			throw new Error("gateway scheduling bridge is not configured");
		}
		return await callGatewayRpc<T>(method, params, gateway);
	}

	return {
		name: "schedule",
		label: "Scheduler",
		description:
			"Primary scheduling surface for recurring jobs and wake events in Understudy. " +
			'Actions: "status", "create", "list", "update", "remove", "run", "runs", and "wake".',
		parameters: ScheduleSchema,
		execute: async (_toolCallId, params: ScheduleParams): Promise<AgentToolResult<unknown>> => {
			switch (params.action) {
				case "status": {
					if (gateway) {
						try {
							const status = await callScheduleGateway<Record<string, unknown>>("schedule.status", {});
							const running = status.running === true;
							const jobCount = typeof status.jobCount === "number" ? status.jobCount : 0;
							const enabledCount = typeof status.enabledCount === "number" ? status.enabledCount : jobCount;
							return textResult(
								`Scheduler status: ${running ? "active" : "idle"}\n` +
								`Jobs: ${jobCount} (${enabledCount} enabled)`,
							);
						} catch (error) {
							return errorResult("Schedule error", error);
						}
					}
					if (scheduleService) {
						const status = scheduleService.status();
						return textResult(
							`Scheduler status: ${status.running ? "active" : "idle"}\n` +
							`Jobs: ${status.jobCount} (${status.enabledCount} enabled)`,
						);
					}
					return unavailableResult();
				}

				case "create": {
					if (!params.name || !params.schedule || !params.command) {
						return textResult("Error: name, schedule, and command are required for create");
					}
					const delivery = resolveDelivery(params.delivery, config.defaultDelivery);

					if (gateway) {
						try {
							const job = await callScheduleGateway<Record<string, unknown>>("schedule.add", {
								name: params.name,
								schedule: params.schedule,
								command: params.command,
								enabled: params.enabled,
								delivery,
								scheduleOptions: params.scheduleOptions,
							});
							return textResult(
								`Scheduled job "${String(job.name ?? params.name)}" (${String(job.id ?? "unknown")})\n` +
								`Schedule: ${formatScheduleValue(job, params.schedule)}\n` +
								`Next run: ${String(job.nextRun ?? "unknown")}`,
							);
						} catch (error) {
							return errorResult("Schedule error", error);
						}
					}

					if (scheduleService) {
						try {
							const job = await scheduleService.add({
								name: params.name,
								schedule: params.schedule,
								command: params.command,
								enabled: params.enabled,
								delivery,
								scheduleOptions: params.scheduleOptions,
							});
							return textResult(
								`Scheduled job "${job.name}" (${job.id})\nSchedule: ${formatScheduleValue(job as unknown as Record<string, unknown>, job.schedule)}\nNext run: ${job.nextRun ?? "unknown"}`,
							);
						} catch (error) {
							const msg = error instanceof Error ? error.message : String(error);
							return textResult(`Schedule error: ${msg}`);
						}
					}

					return unavailableResult();
				}

				case "list": {
					if (gateway) {
						try {
							const list = await callScheduleGateway<Array<Record<string, unknown>>>("schedule.list", {
								includeDisabled: true,
							});
							if (!Array.isArray(list) || list.length === 0) {
								return textResult("No scheduled jobs.");
							}
							const lines = list.map((job) =>
								`- ${String(job.name ?? "unnamed")} (${String(job.id ?? "unknown")}): ${formatScheduleValue(job)} → "${String(job.command ?? "")}" ` +
								`[next: ${String(job.nextRun ?? "unknown")}; runs: ${String(job.runCount ?? 0)}; ${job.enabled === false ? "disabled" : "enabled"}]`,
							).join("\n");
							return textResult(`Scheduled jobs:\n${lines}`);
						} catch (error) {
							return errorResult("Schedule error", error);
						}
					}
					if (scheduleService) {
						const list = scheduleService.list({ includeDisabled: true });
						if (list.length === 0) return textResult("No scheduled jobs.");
						const lines = list.map((job) =>
							`- ${job.name} (${job.id}): ${formatScheduleValue(job as unknown as Record<string, unknown>, job.schedule)} → "${job.command}" ` +
							`[next: ${job.nextRun ?? "unknown"}; runs: ${job.runCount}; ${job.enabled ? "enabled" : "disabled"}]`,
						).join("\n");
						return textResult(`Scheduled jobs:\n${lines}`);
					}
					return unavailableResult();
				}

				case "update": {
					if (!params.id) {
						return textResult("Error: id is required for update");
					}
					const delivery = params.delivery
						? resolveDelivery(params.delivery, config.defaultDelivery)
						: undefined;

					if (gateway) {
						try {
							const updated = await callScheduleGateway<Record<string, unknown>>("schedule.update", {
								id: params.id,
								name: params.name,
								schedule: params.schedule,
								command: params.command,
								enabled: params.enabled,
								delivery,
								scheduleOptions: params.scheduleOptions,
							});
							return textResult(`Updated job: ${String(updated.name ?? params.name ?? params.id)} (${String(updated.id ?? params.id)})`);
						} catch (error) {
							return errorResult("Schedule error", error);
						}
					}

					if (scheduleService) {
						try {
							const patch: {
								name?: string;
								schedule?: string;
								command?: string;
								enabled?: boolean;
								delivery?: {
									channelId?: string;
									senderId?: string;
								};
								scheduleOptions?: {
									timezone?: string;
									startAt?: string;
									stopAt?: string;
									intervalSeconds?: number;
								};
							} = {};
							if (params.name) {
								patch.name = params.name;
							}
							if (params.schedule) {
								patch.schedule = params.schedule;
							}
							if (params.command) {
								patch.command = params.command;
							}
							if (typeof params.enabled === "boolean") {
								patch.enabled = params.enabled;
							}
							if (delivery) {
								patch.delivery = delivery;
							}
							if (params.scheduleOptions) {
								patch.scheduleOptions = params.scheduleOptions;
							}
							const updated = await scheduleService.update(params.id, patch);
							return textResult(`Updated job: ${updated.name} (${updated.id})`);
						} catch (error) {
							return textResult(error instanceof Error ? error.message : String(error));
						}
					}

					return unavailableResult();
				}

				case "run": {
					if (!params.id) {
						return textResult("Error: id is required for run");
					}

					if (gateway) {
						try {
							const result = await callScheduleGateway<Record<string, unknown>>("schedule.run", {
								id: params.id,
							});
							if (result.ok === false) {
								return textResult(String(result.reason ?? "Failed to run job"));
							}
							return textResult(`Triggered job: ${String(result.id ?? params.id)}`);
						} catch (error) {
							return errorResult("Schedule error", error);
						}
					}

					if (scheduleService) {
						const result = await scheduleService.run(params.id);
						if (!result.ok) return textResult(result.reason ?? "Failed to run job");
						return textResult(`Triggered job: ${params.id}`);
					}

					return unavailableResult();
				}

				case "runs": {
					if (!params.id) {
						return textResult("Error: id is required for runs");
					}
					const limit = Math.max(1, Math.floor(params.limit ?? 20));

					if (gateway) {
						try {
							const result = await callScheduleGateway<Record<string, unknown>>("schedule.runs", {
								id: params.id,
								limit,
							});
							const runs = Array.isArray(result.runs) ? result.runs : [];
							if (runs.length === 0) {
								return textResult(`No runs for job ${params.id}`);
							}
							const lines = runs.map(
								(run) =>
									`- ${String((run as Record<string, unknown>).id ?? "unknown")}: ${String((run as Record<string, unknown>).status ?? "unknown")}` +
									` started=${String((run as Record<string, unknown>).startedAt ?? "")}` +
									`${(run as Record<string, unknown>).finishedAt ? ` finished=${String((run as Record<string, unknown>).finishedAt)}` : ""}` +
									`${(run as Record<string, unknown>).error ? ` error=${String((run as Record<string, unknown>).error)}` : ""}`,
							);
							return textResult(`Runs for ${params.id}:\n${lines.join("\n")}`);
						} catch (error) {
							return errorResult("Schedule error", error);
						}
					}

					if (scheduleService) {
						if (!scheduleService.getJob(params.id)) {
							return textResult(`Job not found: ${params.id}`);
						}
						const runs = scheduleService.getRuns(params.id, limit);
						if (runs.length === 0) return textResult(`No runs for job ${params.id}`);
						const lines = runs.map(
							(run) =>
								`- ${run.id}: ${run.status} started=${run.startedAt}` +
								`${run.finishedAt ? ` finished=${run.finishedAt}` : ""}` +
								`${run.error ? ` error=${run.error}` : ""}`,
						);
						return textResult(`Runs for ${params.id}:\n${lines.join("\n")}`);
					}

					return unavailableResult();
				}

				case "wake": {
					if (gateway) {
						try {
							const list = await callScheduleGateway<Array<Record<string, unknown>>>("schedule.list", {
								includeDisabled: false,
							});
							if (!Array.isArray(list) || list.length === 0) {
								return textResult("No jobs available to wake.");
							}
							for (const job of list) {
								await callScheduleGateway("schedule.run", { id: job.id });
							}
							return textResult(`Wake complete: triggered ${list.length} jobs.`);
						} catch (error) {
							return errorResult("Schedule error", error);
						}
					}

					if (scheduleService) {
						const list = scheduleService.list();
						if (list.length === 0) return textResult("No jobs available to wake.");
						for (const job of list) {
							await scheduleService.run(job.id);
						}
						return textResult(`Wake complete: triggered ${list.length} jobs.`);
					}

					return unavailableResult();
				}

				case "remove": {
					if (!params.id) {
						return textResult("Error: id is required for remove");
					}

					if (gateway) {
						try {
							const result = await callScheduleGateway<Record<string, unknown>>("schedule.remove", {
								id: params.id,
							});
							if (result.deleted === true || result.ok === true) {
								return textResult(`Removed job: ${String(result.id ?? params.id)}`);
							}
							return textResult(`Job not found: ${params.id}`);
						} catch (error) {
							return errorResult("Schedule error", error);
						}
					}

					if (scheduleService) {
						const result = await scheduleService.remove(params.id);
						if (result.removed) return textResult(`Removed job: ${params.id}`);
						return textResult(`Job not found: ${params.id}`);
					}

					return unavailableResult();
				}

				default:
					return textResult(`Unknown action: ${params.action}`);
			}
		},
	};
}
