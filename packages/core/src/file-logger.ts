/**
 * File-based logger that appends timestamped entries to a file.
 * Auto-rotates by truncating the first half when maxSizeBytes is exceeded.
 */

import { existsSync, appendFileSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createLogger, LOG_LEVELS, type LogLevel } from "./logger.js";

export interface FileLoggerOptions {
	/** Max file size before rotation (default: 10MB) */
	maxSizeBytes?: number;
	/** Whether to also log to console (default: true) */
	consoleEcho?: boolean;
	/** Minimum log level (default: "info") */
	minLevel?: LogLevel;
}

export function createFileLogger(name: string, filePath: string, opts: FileLoggerOptions = {}) {
	const maxSizeBytes = opts.maxSizeBytes ?? 10 * 1024 * 1024;
	const consoleEcho = opts.consoleEcho !== false;
	const minLevel = opts.minLevel ?? "info";
	const consoleLogger = consoleEcho ? createLogger(name) : null;

	// Ensure directory exists
	const dir = dirname(filePath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	function shouldLog(level: LogLevel): boolean {
		return LOG_LEVELS[level] >= LOG_LEVELS[minLevel];
	}

	function formatLine(level: LogLevel, msg: string): string {
		const ts = new Date().toISOString();
		return `[${ts}] [${level.toUpperCase()}] [${name}] ${msg}\n`;
	}

	function maybeRotate(): void {
		try {
			if (!existsSync(filePath)) return;
			const stat = statSync(filePath);
			if (stat.size > maxSizeBytes) {
				const content = readFileSync(filePath, "utf-8");
				const midpoint = Math.floor(content.length / 2);
				// Find next newline after midpoint to avoid splitting a line
				const nextNewline = content.indexOf("\n", midpoint);
				const truncated = nextNewline >= 0 ? content.slice(nextNewline + 1) : content.slice(midpoint);
				writeFileSync(filePath, truncated, "utf-8");
			}
		} catch {
			// Rotation failure is non-critical
		}
	}

	function write(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
		if (!shouldLog(level)) return;

		const suffix = data ? " " + JSON.stringify(data) : "";
		const line = formatLine(level, msg + suffix);

		try {
			maybeRotate();
			appendFileSync(filePath, line, "utf-8");
		} catch {
			// File write failure is non-critical
		}

		if (consoleLogger) {
			consoleLogger[level](msg, data);
		}
	}

	return {
		debug: (msg: string, data?: Record<string, unknown>) => write("debug", msg, data),
		info: (msg: string, data?: Record<string, unknown>) => write("info", msg, data),
		warn: (msg: string, data?: Record<string, unknown>) => write("warn", msg, data),
		error: (msg: string, data?: Record<string, unknown>) => write("error", msg, data),
	};
}
