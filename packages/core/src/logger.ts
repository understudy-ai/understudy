/**
 * Structured logging for Understudy.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
	debug(msg: string, data?: Record<string, unknown>): void;
	info(msg: string, data?: Record<string, unknown>): void;
	warn(msg: string, data?: Record<string, unknown>): void;
	error(msg: string, data?: Record<string, unknown>): void;
}

export const LOG_LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

export function createLogger(name: string, minLevel: LogLevel = "info"): Logger {
	const threshold = LOG_LEVELS[minLevel];

	function log(level: LogLevel, msg: string, data?: Record<string, unknown>) {
		if (LOG_LEVELS[level] < threshold) return;
		const timestamp = new Date().toISOString();
		const prefix = `[${timestamp}] [${level.toUpperCase()}] [${name}]`;
		if (data) {
			console.error(`${prefix} ${msg}`, JSON.stringify(data));
		} else {
			console.error(`${prefix} ${msg}`);
		}
	}

	return {
		debug: (msg, data) => log("debug", msg, data),
		info: (msg, data) => log("info", msg, data),
		warn: (msg, data) => log("warn", msg, data),
		error: (msg, data) => log("error", msg, data),
	};
}
