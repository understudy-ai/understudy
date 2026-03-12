import type { UnderstudyConfig } from "@understudy/types";

const TIMESTAMP_ENVELOPE_PATTERN = /^\[.*\d{4}-\d{2}-\d{2} \d{2}:\d{2}/;
const CURRENT_TIME_PAYLOAD_PATTERN = /^Current time:\s/i;

export interface TimestampInjectionOptions {
	timezone?: string;
	now?: Date;
}

export function injectTimestamp(message: string, opts?: TimestampInjectionOptions): string {
	if (!message.trim()) return message;
	if (TIMESTAMP_ENVELOPE_PATTERN.test(message)) return message;
	if (CURRENT_TIME_PAYLOAD_PATTERN.test(message)) return message;

	const now = opts?.now ?? new Date();
	const timezone = opts?.timezone ?? "UTC";
	const formatted = formatZonedTimestamp(now, timezone);
	if (!formatted) return message;

	const dow = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		weekday: "short",
	}).format(now);

	return `[${dow} ${formatted}] ${message}`;
}

export function timestampOptsFromConfig(cfg: UnderstudyConfig): TimestampInjectionOptions {
	return {
		timezone: resolveUserTimezone(cfg.agent.userTimezone),
	};
}

function resolveUserTimezone(configured?: string): string {
	const value = configured?.trim();
	if (value) return value;
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

function formatZonedTimestamp(now: Date, timezone: string): string | undefined {
	try {
		const formatter = new Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
			timeZoneName: "short",
		});
		const parts = formatter.formatToParts(now);
		const get = (type: Intl.DateTimeFormatPartTypes) =>
			parts.find((part) => part.type === type)?.value ?? "";
		const year = get("year");
		const month = get("month");
		const day = get("day");
		const hour = get("hour");
		const minute = get("minute");
		const tzName = get("timeZoneName");
		if (!year || !month || !day || !hour || !minute) {
			return undefined;
		}
		const suffix = tzName ? ` ${tzName}` : "";
		return `${year}-${month}-${day} ${hour}:${minute}${suffix}`;
	} catch {
		return undefined;
	}
}
