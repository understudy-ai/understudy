/**
 * Logs command: read gateway/daemon logs.
 */

import { existsSync, readFileSync, watch } from "node:fs";
import { join } from "node:path";
import { resolveUnderstudyHomeDir } from "@understudy/core";
import { createRpcClient } from "../rpc-client.js";

interface LogsOptions {
	tail?: string;
	follow?: boolean;
	filter?: string;
	port?: string;
}

function filterLines(lines: string[], pattern?: RegExp): string[] {
	if (!pattern) return lines;
	return lines.filter((line) => pattern.test(line));
}

function computeNewLines(previous: string[], current: string[]): string[] {
	if (previous.length === 0) return current;
	const maxOverlap = Math.min(previous.length, current.length);
	for (let overlap = maxOverlap; overlap >= 1; overlap--) {
		const prevTail = previous.slice(previous.length - overlap);
		const currHead = current.slice(0, overlap);
		let matches = true;
		for (let i = 0; i < overlap; i++) {
			if (prevTail[i] !== currHead[i]) {
				matches = false;
				break;
			}
		}
		if (matches) {
			return current.slice(overlap);
		}
	}
	return current;
}

export async function runLogsCommand(opts: LogsOptions = {}): Promise<void> {
	const tailParsed = opts.tail ? parseInt(opts.tail, 10) : 50;
	const tailCount = Number.isFinite(tailParsed) && tailParsed > 0 ? tailParsed : 50;
	const filterPattern = opts.filter ? new RegExp(opts.filter, "i") : undefined;
	const client = createRpcClient({ port: opts.port ? parseInt(opts.port, 10) : undefined });

	try {
		const result = await client.call<{ lines?: string[]; path?: string }>("logs.tail", {
			limit: tailCount,
		});
		const lines = filterLines((result.lines ?? []).map((line) => String(line)), filterPattern);
		for (const line of lines) {
			console.log(line);
		}

		if (!opts.follow) {
			return;
		}

		console.log("--- following (gateway rpc) ---");
		let previous = (result.lines ?? []).map((line) => String(line));
		for (;;) {
			await new Promise((resolve) => setTimeout(resolve, 1500));
			const next = await client.call<{ lines?: string[] }>("logs.tail", {
				limit: tailCount,
			});
			const current = (next.lines ?? []).map((line) => String(line));
			const added = computeNewLines(previous, current);
			for (const line of filterLines(added, filterPattern)) {
				console.log(line);
			}
			previous = current;
		}
	} catch {
		// Fallback to local daemon.log when gateway is unavailable.
	}

	const logPath = join(resolveUnderstudyHomeDir(), "daemon.log");
	if (!existsSync(logPath)) {
		console.log(`No log file found at ${logPath}`);
		return;
	}

	const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
	const output = filterLines(lines.slice(-tailCount), filterPattern);

	for (const line of output) {
		console.log(line);
	}

	if (opts.follow) {
		console.log("--- following (file) ---");
		let lastSize = lines.length;
		watch(logPath, () => {
			try {
				const newLines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
				// Handle log rotation (file was truncated)
				if (newLines.length < lastSize) {
					lastSize = 0;
				}
				const added = newLines.slice(lastSize);
				lastSize = newLines.length;
				for (const line of added) {
					if (filterPattern && !filterPattern.test(line)) continue;
					console.log(line);
				}
			} catch { /* ignore read errors during follow */ }
		});
		// Keep process alive
		await new Promise<void>(() => {});
	}
}
