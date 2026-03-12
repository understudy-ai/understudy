import { randomUUID } from "node:crypto";

export type SubagentMode = "run" | "session";
export type SubagentRuntime = "subagent" | "acp";
export type SubagentCleanupMode = "delete" | "keep";
export type SubagentRunStatus = "idle" | "in_flight" | "ok" | "error" | "aborted";

export interface SubagentSessionMeta {
	parentSessionId: string;
	label?: string;
	runtime: SubagentRuntime;
	mode: SubagentMode;
	cleanup: SubagentCleanupMode;
	thread: boolean;
	createdAt: number;
	updatedAt: number;
	latestRunId?: string;
	latestRunStatus: SubagentRunStatus;
	latestResponsePreview?: string;
	latestError?: string;
	runCount: number;
}

type EntryLike = {
	id: string;
	createdAt: number;
	lastActiveAt: number;
	subagentMeta?: SubagentSessionMeta;
};

const RESPONSE_PREVIEW_CHARS = 240;

function compactText(value: string | undefined): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}
	return trimmed.length > RESPONSE_PREVIEW_CHARS
		? `${trimmed.slice(0, RESPONSE_PREVIEW_CHARS)}...`
		: trimmed;
}

export function buildSubagentSessionId(parentSessionId: string): string {
	return `${parentSessionId}:subagent:${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
}

export function createSubagentSessionMeta(input: {
	parentSessionId: string;
	label?: string;
	runtime?: SubagentRuntime;
	mode: SubagentMode;
	cleanup: SubagentCleanupMode;
	thread: boolean;
	createdAt?: number;
}): SubagentSessionMeta {
	const createdAt = typeof input.createdAt === "number" ? input.createdAt : Date.now();
	return {
		parentSessionId: input.parentSessionId,
		label: input.label?.trim() || undefined,
		runtime: input.runtime ?? "subagent",
		mode: input.mode,
		cleanup: input.cleanup,
		thread: input.thread,
		createdAt,
		updatedAt: createdAt,
		latestRunStatus: "idle",
		runCount: 0,
	};
}

export function isSubagentEntry(entry: EntryLike, parentSessionId?: string): boolean {
	if (!entry.subagentMeta) {
		return false;
	}
	return parentSessionId
		? entry.subagentMeta.parentSessionId === parentSessionId
		: true;
}

export function markSubagentRunStarted(
	meta: SubagentSessionMeta,
	runId: string,
	recordedAt: number = Date.now(),
): SubagentSessionMeta {
	return {
		...meta,
		latestRunId: runId,
		latestRunStatus: "in_flight",
		latestError: undefined,
		latestResponsePreview: undefined,
		updatedAt: recordedAt,
		runCount: meta.runCount + 1,
	};
}

export function markSubagentRunCompleted(
	meta: SubagentSessionMeta,
	params: {
		runId: string;
		response: string;
		recordedAt?: number;
	},
): SubagentSessionMeta {
	return {
		...meta,
		latestRunId: params.runId,
		latestRunStatus: "ok",
		latestError: undefined,
		latestResponsePreview: compactText(params.response),
		updatedAt: typeof params.recordedAt === "number" ? params.recordedAt : Date.now(),
	};
}

export function markSubagentRunFailed(
	meta: SubagentSessionMeta,
	params: {
		runId?: string;
		error: string;
		recordedAt?: number;
		aborted?: boolean;
	},
): SubagentSessionMeta {
	return {
		...meta,
		latestRunId: params.runId ?? meta.latestRunId,
		latestRunStatus: params.aborted === true ? "aborted" : "error",
		latestError: compactText(params.error),
		latestResponsePreview: undefined,
		updatedAt: typeof params.recordedAt === "number" ? params.recordedAt : Date.now(),
	};
}

export function listSubagentEntries<TEntry extends EntryLike>(
	entries: Iterable<TEntry>,
	parentSessionId: string,
): TEntry[] {
	return Array.from(entries)
		.filter((entry) => isSubagentEntry(entry, parentSessionId))
		.sort((left, right) => {
			const leftTs = left.subagentMeta?.updatedAt ?? left.lastActiveAt ?? left.createdAt;
			const rightTs = right.subagentMeta?.updatedAt ?? right.lastActiveAt ?? right.createdAt;
			return rightTs - leftTs;
		});
}

export function resolveSubagentEntry<TEntry extends EntryLike>(
	entries: Iterable<TEntry>,
	parentSessionId: string,
	target?: string,
): TEntry | undefined {
	const candidates = listSubagentEntries(entries, parentSessionId);
	const normalizedTarget = target?.trim();
	if (!normalizedTarget) {
		return candidates.length === 1 ? candidates[0] : undefined;
	}
	if (/^\d+$/.test(normalizedTarget)) {
		const index = Number(normalizedTarget) - 1;
		return index >= 0 && index < candidates.length ? candidates[index] : undefined;
	}
	return candidates.find((entry) =>
		entry.id === normalizedTarget || entry.subagentMeta?.label === normalizedTarget
	);
}
