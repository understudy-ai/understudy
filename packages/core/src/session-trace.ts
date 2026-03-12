import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
	UnderstudySessionClosedEvent,
	UnderstudySessionCreatedEvent,
	UnderstudySessionLifecycleHooks,
} from "./runtime/orchestrator.js";
import type { UnderstudySessionToolEvent } from "./runtime/tool-execution-trace.js";
import { resolveUnderstudyHomeDir } from "./runtime-paths.js";

const DEFAULT_STRING_PREVIEW = 240;
const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_ENTRIES = 20;
const SENSITIVE_KEY_PATTERN = /(pass(word)?|secret|token|api[_-]?key|auth(orization)?|cookie|session)/i;

export interface CreateSessionTraceLifecycleHooksOptions {
	traceId?: string;
	tracesDir?: string;
}

export interface SessionTraceLifecycleHandle {
	traceId: string;
	filePath: string;
	lifecycleHooks: UnderstudySessionLifecycleHooks;
	flush(): Promise<void>;
}

function sanitizeTraceId(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		return randomUUID().slice(0, 12);
	}
	return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 96) || randomUUID().slice(0, 12);
}

function sanitizeTraceValue(
	value: unknown,
	depth: number = 0,
	keyHint?: string,
): unknown {
	if (value === null || value === undefined) {
		return value;
	}
	if (typeof value === "string") {
		if (keyHint && SENSITIVE_KEY_PATTERN.test(keyHint)) {
			return `[REDACTED:${value.length}]`;
		}
		return value.length > DEFAULT_STRING_PREVIEW
			? `${value.slice(0, DEFAULT_STRING_PREVIEW)}...`
			: value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	if (typeof value === "bigint") {
		return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
	}
	if (depth >= DEFAULT_MAX_DEPTH) {
		return "[Truncated]";
	}
	if (Array.isArray(value)) {
		return value
			.slice(0, DEFAULT_MAX_ENTRIES)
			.map((entry) => sanitizeTraceValue(entry, depth + 1, keyHint));
	}
	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).slice(0, DEFAULT_MAX_ENTRIES);
		return Object.fromEntries(
			entries.map(([key, entryValue]) => [
				key,
				sanitizeTraceValue(entryValue, depth + 1, key),
			]),
		);
	}
	return String(value);
}

function summarizeSessionCreated(event: UnderstudySessionCreatedEvent): Record<string, unknown> {
	return {
		backend: event.sessionMeta.backend,
		model: event.sessionMeta.model,
		runtimeProfile: event.sessionMeta.runtimeProfile,
		workspaceDir: event.sessionMeta.workspaceDir,
		toolCount: event.sessionMeta.toolNames.length,
		systemPromptChars: event.promptReport.systemPrompt.chars,
		projectContextChars: event.promptReport.systemPrompt.projectContextChars,
	};
}

function summarizeSessionClosed(event: UnderstudySessionClosedEvent): Record<string, unknown> {
	return {
		backend: event.sessionMeta.backend,
		model: event.sessionMeta.model,
		runtimeProfile: event.sessionMeta.runtimeProfile,
		workspaceDir: event.sessionMeta.workspaceDir,
	};
}

function summarizeToolEvent(event: UnderstudySessionToolEvent): Record<string, unknown> {
	const base = {
		phase: event.phase,
		toolName: event.toolName,
		toolCallId: event.toolCallId,
		route: event.route,
		startedAt: event.startedAt,
		params: sanitizeTraceValue(event.params),
		sessionMeta: event.sessionMeta
			? sanitizeTraceValue({
				backend: event.sessionMeta.backend,
				model: event.sessionMeta.model,
				workspaceDir: event.sessionMeta.workspaceDir,
			})
			: undefined,
	};
	if (event.phase === "finish") {
		return {
			...base,
			endedAt: event.endedAt,
			durationMs: event.durationMs,
			result: sanitizeTraceValue(event.result),
		};
	}
	if (event.phase === "error") {
		return {
			...base,
			endedAt: event.endedAt,
			durationMs: event.durationMs,
			error: event.error,
		};
	}
	return base;
}

export function createSessionTraceLifecycleHooks(
	options: CreateSessionTraceLifecycleHooksOptions = {},
): SessionTraceLifecycleHandle {
	const traceId = sanitizeTraceId(options.traceId ?? randomUUID().slice(0, 12));
	const filePath = join(options.tracesDir ?? join(resolveUnderstudyHomeDir(), "traces"), `${traceId}.jsonl`);
	let writeQueue = Promise.resolve();

	const appendRecord = (record: Record<string, unknown>): Promise<void> => {
		writeQueue = writeQueue
			.catch(() => {})
			.then(async () => {
				await mkdir(dirname(filePath), { recursive: true });
				await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf-8");
			});
		return writeQueue;
	};

	return {
		traceId,
		filePath,
		lifecycleHooks: {
			onSessionCreated: async (event) => {
				await appendRecord({
					type: "session_created",
					traceId,
					timestamp: Date.now(),
					session: summarizeSessionCreated(event),
				});
			},
			onToolEvent: async (event) => {
				await appendRecord({
					type: "tool_event",
					traceId,
					timestamp: Date.now(),
					event: summarizeToolEvent(event),
				});
			},
			onSessionClosed: async (event) => {
				await appendRecord({
					type: "session_closed",
					traceId,
					timestamp: Date.now(),
					session: summarizeSessionClosed(event),
				});
			},
		},
		flush: async () => {
			await writeQueue;
		},
	};
}
