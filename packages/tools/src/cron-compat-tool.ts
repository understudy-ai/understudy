/**
 * OpenClaw-compatible cron tool for Understudy.
 *
 * This exists so OpenClaw skills and docs can migrate without rewriting their
 * scheduling calls around Understudy's native `schedule` tool. It is deliberate
 * cross-product compatibility, not a temporary shim for deprecated Understudy
 * behavior.
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@sinclair/typebox";
import { asRecord as coreAsRecord, asString, asBoolean, asNumber } from "@understudy/core";

function asRecord(value: unknown): Record<string, unknown> {
	return coreAsRecord(value) ?? {};
}

function asStrictNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) {
		return undefined;
	}
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) ? parsed : undefined;
}

const CronCompatibilitySchema = Type.Object(
	{
		action: Type.String({
			description:
				'OpenClaw-compatible action: "status", "list", "add", "update", "remove", "run", "runs", or "wake".',
		}),
		job: Type.Optional(Type.Object({}, { additionalProperties: true })),
		patch: Type.Optional(Type.Object({}, { additionalProperties: true })),
		id: Type.Optional(Type.String()),
		jobId: Type.Optional(Type.String()),
		name: Type.Optional(Type.String()),
		message: Type.Optional(Type.String()),
		schedule: Type.Optional(Type.Object({}, { additionalProperties: true })),
		payload: Type.Optional(Type.Object({}, { additionalProperties: true })),
		delivery: Type.Optional(Type.Object({}, { additionalProperties: true })),
		enabled: Type.Optional(Type.Boolean()),
		text: Type.Optional(Type.String()),
		limit: Type.Optional(Type.Number()),
		runMode: Type.Optional(Type.String()),
		mode: Type.Optional(Type.String()),
		contextMessages: Type.Optional(Type.Number()),
	},
	{ additionalProperties: true },
);

type CronCompatibilityParams = Static<typeof CronCompatibilitySchema>;

function prependNotes(
	result: AgentToolResult<unknown>,
	notes: string[],
): AgentToolResult<unknown> {
	if (notes.length === 0) {
		return result;
	}
	const content = Array.isArray(result.content) ? result.content.slice() : [];
	const noteText = notes.join("\n");
	const first = content[0];
	if (first && first.type === "text") {
		content[0] = {
			...first,
			text: `${noteText}\n\n${first.text}`,
		};
	} else {
		content.unshift({ type: "text", text: noteText });
	}
	return {
		...result,
		content,
	};
}

function errorResult(message: string): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text: message }],
		details: { status: "failed" },
	};
}

function normalizeSchedule(
	input: Record<string, unknown>,
	notes: string[],
): {
	schedule: string;
	scheduleOptions?: {
		timezone?: string;
		startAt?: string;
		intervalSeconds?: number;
	};
} {
	const kind = asString(input.kind)?.toLowerCase();
	if (!kind) {
		if (asString(input.expr)) {
			return { schedule: asString(input.expr)! };
		}
		if (asString(input.at)) {
			return { schedule: asString(input.at)! };
		}
		if (typeof input.atMs === "number" && Number.isFinite(input.atMs)) {
			return { schedule: new Date(input.atMs).toISOString() };
		}
		throw new Error("OpenClaw cron compatibility requires schedule.kind");
	}
	switch (kind) {
		case "cron": {
			const expr = asString(input.expr);
			if (!expr) {
				throw new Error("OpenClaw cron compatibility requires schedule.expr for kind=cron");
			}
			const timezone = asString(input.tz);
			if (typeof input.staggerMs === "number") {
				notes.push(
					"OpenClaw cron compatibility note: schedule.staggerMs is ignored because Understudy's scheduler has no equivalent jitter field.",
				);
			}
			return {
				schedule: expr,
				scheduleOptions: timezone ? { timezone } : undefined,
			};
		}
		case "at": {
			const at = asString(input.at)
				?? (typeof input.atMs === "number" && Number.isFinite(input.atMs)
					? new Date(input.atMs).toISOString()
					: undefined);
			if (!at) {
				throw new Error("OpenClaw cron compatibility requires schedule.at or schedule.atMs for kind=at");
			}
			const timezone = asString(input.tz);
			return {
				schedule: at,
				scheduleOptions: timezone ? { timezone } : undefined,
			};
		}
		case "every": {
			const everyMs = asStrictNumber(input.everyMs);
			if (!everyMs || everyMs <= 0) {
				throw new Error("OpenClaw cron compatibility requires a positive schedule.everyMs for kind=every");
			}
			const intervalSeconds = Math.max(1, Math.ceil(everyMs / 1000));
			if (intervalSeconds * 1000 !== everyMs) {
				notes.push(
					`OpenClaw cron compatibility note: everyMs=${everyMs} was rounded up to ${intervalSeconds}s because Understudy's scheduler stores second-level intervals.`,
				);
			}
			const anchorMs = asStrictNumber(input.anchorMs);
			return {
				schedule: "* * * * * *",
				scheduleOptions: {
					intervalSeconds,
					startAt:
						typeof anchorMs === "number" && Number.isFinite(anchorMs)
							? new Date(anchorMs).toISOString()
							: undefined,
				},
			};
		}
		default:
			throw new Error(`Unsupported OpenClaw schedule.kind: ${kind}`);
	}
}

function normalizePayload(
	input: Record<string, unknown>,
	notes: string[],
): string {
	const kind = asString(input.kind)?.toLowerCase();
	switch (kind) {
		case "agentturn": {
			const message = asString(input.message);
			if (!message) {
				throw new Error("OpenClaw cron compatibility requires payload.message for kind=agentTurn");
			}
			const ignored = ["model", "thinking", "timeoutSeconds", "lightContext"].filter(
				(key) => input[key] !== undefined,
			);
			if (ignored.length > 0) {
				notes.push(
					`OpenClaw cron compatibility note: payload.${ignored.join(", payload.")} is ignored; Understudy schedules preserve the prompt text and use the receiving session's runtime defaults.`,
				);
			}
			return message;
		}
		case "systemevent": {
			const text = asString(input.text);
			if (!text) {
				throw new Error("OpenClaw cron compatibility requires payload.text for kind=systemEvent");
			}
			return text;
		}
		default:
			throw new Error(`Unsupported OpenClaw payload.kind: ${kind ?? "(missing)"}`);
	}
}

function normalizeDelivery(
	input: Record<string, unknown> | undefined,
): { channelId?: string; senderId?: string } | undefined {
	if (!input) {
		return undefined;
	}
	const mode = asString(input.mode)?.toLowerCase();
	if (!mode || mode === "none") {
		return undefined;
	}
	if (mode === "webhook") {
		throw new Error("OpenClaw webhook delivery is not supported by Understudy's scheduler compatibility layer");
	}
	return {
		channelId: asString(input.channel),
		senderId: asString(input.to),
	};
}

function buildAddParams(
	params: CronCompatibilityParams,
	notes: string[],
): Record<string, unknown> {
	const job = asRecord(params.job);
	const jobData = asRecord(job.data);
	const effectiveJob = Object.keys(job).length > 0 ? job : {
		name: params.name,
		message: params.message,
		schedule: params.schedule,
		payload: params.payload,
		delivery: params.delivery,
		enabled: params.enabled,
	};
	const mergedJob = Object.keys(jobData).length > 0 ? { ...effectiveJob, ...jobData } : effectiveJob;
	const scheduleInput = asRecord(mergedJob.schedule);
	const schedule = normalizeSchedule(scheduleInput, notes);
	const payloadInput = asRecord(mergedJob.payload);
	const shorthandMessage = asString(mergedJob.message);
	const command = Object.keys(payloadInput).length > 0
		? normalizePayload(payloadInput, notes)
		: shorthandMessage
			? shorthandMessage
			: (() => {
				throw new Error("OpenClaw cron compatibility requires either job.payload or job.message");
			})();
	if (asString(mergedJob.sessionTarget)) {
		notes.push(
			"OpenClaw cron compatibility note: sessionTarget is ignored because Understudy schedules always execute through the scheduler's configured session routing.",
		);
	}
	return {
		action: "create",
		name: asString(mergedJob.name) ?? `job_${Date.now().toString(36)}`,
		schedule: schedule.schedule,
		command,
		...(typeof mergedJob.enabled === "boolean" ? { enabled: mergedJob.enabled } : {}),
		...(schedule.scheduleOptions ? { scheduleOptions: schedule.scheduleOptions } : {}),
		...(normalizeDelivery(asRecord(mergedJob.delivery)) ? { delivery: normalizeDelivery(asRecord(mergedJob.delivery)) } : {}),
	};
}

function buildUpdateParams(
	params: CronCompatibilityParams,
	notes: string[],
): Record<string, unknown> {
	const patch = Object.keys(asRecord(params.patch)).length > 0
		? asRecord(params.patch)
		: {
			...(params.name !== undefined ? { name: params.name } : {}),
			...(params.message !== undefined ? { message: params.message } : {}),
			...(params.schedule !== undefined ? { schedule: params.schedule } : {}),
			...(params.payload !== undefined ? { payload: params.payload } : {}),
			...(params.delivery !== undefined ? { delivery: params.delivery } : {}),
			...(params.enabled !== undefined ? { enabled: params.enabled } : {}),
		};
	const id = asString(params.jobId) ?? asString(params.id);
	if (!id) {
		throw new Error("OpenClaw cron compatibility requires jobId (or legacy id) for update");
	}

	const update: Record<string, unknown> = {
		action: "update",
		id,
	};
	if (patch.name !== undefined) update.name = asString(patch.name);
	if (patch.enabled !== undefined) update.enabled = asBoolean(patch.enabled);
	if (patch.schedule !== undefined) {
		const schedule = normalizeSchedule(asRecord(patch.schedule), notes);
		update.schedule = schedule.schedule;
		if (schedule.scheduleOptions) {
			update.scheduleOptions = schedule.scheduleOptions;
		}
	}
	if (patch.payload !== undefined) {
		update.command = normalizePayload(asRecord(patch.payload), notes);
	} else if (patch.message !== undefined) {
		update.command = asString(patch.message);
	}
	if (patch.delivery !== undefined) {
		const delivery = normalizeDelivery(asRecord(patch.delivery));
		if (delivery) {
			update.delivery = delivery;
		}
	}
	if (asString(patch.sessionTarget)) {
		notes.push(
			"OpenClaw cron compatibility note: update.sessionTarget is ignored because Understudy schedules do not expose that routing knob.",
		);
	}
	return update;
}

export function createOpenClawCronCompatibilityTool(
	scheduleTool: AgentTool<any>,
): AgentTool<typeof CronCompatibilitySchema> {
	return {
		name: "cron",
		label: "cron",
		description:
			"OpenClaw compatibility alias for Understudy schedule management. " +
			"Use this for direct OpenClaw skill migration when a skill already speaks cron job objects.",
		parameters: CronCompatibilitySchema,
		execute: async (_toolCallId, rawParams, signal, onUpdate) => {
			const notes: string[] = [];
			try {
				switch (String(rawParams.action || "").trim().toLowerCase()) {
					case "status":
						return prependNotes(
							await scheduleTool.execute(
								_toolCallId,
								{ action: "status" },
								signal,
								onUpdate,
							),
							notes,
						);
					case "list":
						return prependNotes(
							await scheduleTool.execute(
								_toolCallId,
								{
									action: "list",
									...(typeof rawParams.limit === "number" ? { limit: rawParams.limit } : {}),
								},
								signal,
								onUpdate,
							),
							notes,
						);
					case "add":
						return prependNotes(
							await scheduleTool.execute(
								_toolCallId,
								buildAddParams(rawParams, notes),
								signal,
								onUpdate,
							),
							notes,
						);
					case "update":
						return prependNotes(
							await scheduleTool.execute(
								_toolCallId,
								buildUpdateParams(rawParams, notes),
								signal,
								onUpdate,
							),
							notes,
						);
					case "remove":
						return await scheduleTool.execute(
							_toolCallId,
							{
								action: "remove",
								id: asString(rawParams.jobId) ?? asString(rawParams.id),
							},
							signal,
							onUpdate,
						);
					case "run":
						return prependNotes(
							await scheduleTool.execute(
								_toolCallId,
								{
									action: "run",
									id: asString(rawParams.jobId) ?? asString(rawParams.id),
								},
								signal,
								onUpdate,
							),
							typeof rawParams.runMode === "string"
								? [
									`OpenClaw cron compatibility note: runMode=${String(rawParams.runMode)} is ignored because Understudy's scheduler exposes a single immediate-run behavior.`,
								]
								: notes,
						);
					case "runs":
						return await scheduleTool.execute(
							_toolCallId,
							{
								action: "runs",
								id: asString(rawParams.jobId) ?? asString(rawParams.id),
								limit: asNumber(rawParams.limit),
							},
							signal,
							onUpdate,
						);
					case "wake":
						if (asString(rawParams.text)) {
							return errorResult(
								"OpenClaw cron compatibility does not support wake text injection in Understudy. Use a scheduled systemEvent/agentTurn job instead.",
							);
						}
						return await scheduleTool.execute(
							_toolCallId,
							{ action: "wake" },
							signal,
							onUpdate,
						);
					default:
						return errorResult(`Unknown cron action: ${rawParams.action}`);
				}
			} catch (error) {
				const message = error instanceof Error
					? `OpenClaw cron compatibility error: ${error.message}`
					: `OpenClaw cron compatibility error: ${String(error)}`;
				return errorResult(message);
			}
		},
	};
}
