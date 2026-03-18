/**
 * Shared exec-session registry for Understudy.
 *
 * Stores background exec runs so the `process` tool can inspect, poll, and
 * control them across turns.
 */

import type { ChildProcessWithoutNullStreams } from "node:child_process";

const DEFAULT_MAX_OUTPUT_CHARS = 200_000;
const DEFAULT_PENDING_OUTPUT_CHARS = 30_000;
const DEFAULT_FINISHED_SESSION_TTL_MS = 30 * 60 * 1000;

export type ExecSessionStatus = "running" | "completed" | "failed" | "killed";

export type ExecSessionStdin = {
	write: (chunk: string | Uint8Array, cb?: (err?: Error | null) => void) => void;
	end: () => void;
	destroy?: () => void;
	destroyed?: boolean;
};

export interface ExecSessionRecord {
	id: string;
	command: string;
	cwd?: string;
	child?: ChildProcessWithoutNullStreams;
	stdin?: ExecSessionStdin;
	pid?: number;
	startedAt: number;
	endedAt?: number;
	outputVersion: number;
	maxOutputChars: number;
	pendingMaxOutputChars: number;
	totalOutputChars: number;
	pendingStdout: string[];
	pendingStderr: string[];
	pendingStdoutChars: number;
	pendingStderrChars: number;
	aggregated: string;
	tail: string;
	exitCode?: number | null;
	exitSignal?: NodeJS.Signals | number | null;
	exited: boolean;
	truncated: boolean;
	backgrounded: boolean;
	timedOut: boolean;
}

export interface FinishedExecSessionRecord {
	id: string;
	command: string;
	cwd?: string;
	startedAt: number;
	endedAt: number;
	status: ExecSessionStatus;
	exitCode?: number | null;
	exitSignal?: NodeJS.Signals | number | null;
	aggregated: string;
	tail: string;
	truncated: boolean;
	totalOutputChars: number;
}

const runningSessions = new Map<string, ExecSessionRecord>();
const finishedSessions = new Map<string, FinishedExecSessionRecord>();

let finishedSessionTtlMs = DEFAULT_FINISHED_SESSION_TTL_MS;
let sweeper: NodeJS.Timeout | null = null;

function ensureSweeper(): void {
	if (sweeper) {
		return;
	}
	sweeper = setInterval(() => {
		const now = Date.now();
		for (const [id, session] of finishedSessions) {
			if (now - session.endedAt >= finishedSessionTtlMs) {
				finishedSessions.delete(id);
			}
		}
		if (finishedSessions.size === 0 && runningSessions.size === 0 && sweeper) {
			clearInterval(sweeper);
			sweeper = null;
		}
	}, 60_000);
	sweeper.unref?.();
}

function trimWithCap(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}
	return text.slice(text.length - maxChars);
}

function sumPendingChars(chunks: string[]): number {
	let total = 0;
	for (const chunk of chunks) {
		total += chunk.length;
	}
	return total;
}

function capPendingBuffer(buffer: string[], currentChars: number, cap: number): number {
	if (currentChars <= cap) {
		return currentChars;
	}
	const combined = buffer.join("");
	buffer.length = 0;
	buffer.push(combined.slice(combined.length - cap));
	return Math.min(cap, combined.length);
}

export function tailExecOutput(text: string, maxChars = 2_000): string {
	if (text.length <= maxChars) {
		return text;
	}
	return text.slice(text.length - maxChars);
}

export function createExecSessionId(): string {
	while (true) {
		const id = `exec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
		if (!runningSessions.has(id) && !finishedSessions.has(id)) {
			return id;
		}
	}
}

export function createExecSessionRecord(input: {
	command: string;
	cwd?: string;
	child?: ChildProcessWithoutNullStreams;
	stdin?: ExecSessionStdin;
	maxOutputChars?: number;
	pendingMaxOutputChars?: number;
}): ExecSessionRecord {
	return {
		id: createExecSessionId(),
		command: input.command,
		cwd: input.cwd,
		child: input.child,
		stdin: input.stdin,
		pid: input.child?.pid,
		startedAt: Date.now(),
		outputVersion: 0,
		maxOutputChars: Math.max(1_000, Math.floor(input.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS)),
		pendingMaxOutputChars: Math.max(
			1_000,
			Math.floor(input.pendingMaxOutputChars ?? DEFAULT_PENDING_OUTPUT_CHARS),
		),
		totalOutputChars: 0,
		pendingStdout: [],
		pendingStderr: [],
		pendingStdoutChars: 0,
		pendingStderrChars: 0,
		aggregated: "",
		tail: "",
		exited: false,
		truncated: false,
		backgrounded: false,
		timedOut: false,
	};
}

export function addExecSession(session: ExecSessionRecord): void {
	runningSessions.set(session.id, session);
	ensureSweeper();
}

export function getExecSession(id: string): ExecSessionRecord | undefined {
	return runningSessions.get(id);
}

export function getFinishedExecSession(id: string): FinishedExecSessionRecord | undefined {
	return finishedSessions.get(id);
}

export function listRunningExecSessions(): ExecSessionRecord[] {
	return Array.from(runningSessions.values());
}

export function listFinishedExecSessions(): FinishedExecSessionRecord[] {
	return Array.from(finishedSessions.values());
}

export function appendExecOutput(
	session: ExecSessionRecord,
	stream: "stdout" | "stderr",
	chunk: string,
): void {
	const buffer = stream === "stdout" ? session.pendingStdout : session.pendingStderr;
	const currentChars =
		stream === "stdout" ? session.pendingStdoutChars : session.pendingStderrChars;
	buffer.push(chunk);
	let nextChars = currentChars + chunk.length;
	const pendingCap = Math.min(session.pendingMaxOutputChars, session.maxOutputChars);
	if (nextChars > pendingCap) {
		session.truncated = true;
		nextChars = capPendingBuffer(buffer, nextChars, pendingCap);
	}
	if (stream === "stdout") {
		session.pendingStdoutChars = nextChars;
	} else {
		session.pendingStderrChars = nextChars;
	}
	session.totalOutputChars += chunk.length;
	const nextAggregated = trimWithCap(session.aggregated + chunk, session.maxOutputChars);
	session.truncated =
		session.truncated || nextAggregated.length < session.aggregated.length + chunk.length;
	session.aggregated = nextAggregated;
	session.tail = tailExecOutput(session.aggregated);
	session.outputVersion += 1;
}

export function drainExecSession(
	session: ExecSessionRecord,
): { stdout: string; stderr: string } {
	const stdout = session.pendingStdout.join("");
	const stderr = session.pendingStderr.join("");
	session.pendingStdout = [];
	session.pendingStderr = [];
	session.pendingStdoutChars = 0;
	session.pendingStderrChars = 0;
	return { stdout, stderr };
}

export function markExecSessionBackgrounded(session: ExecSessionRecord): void {
	session.backgrounded = true;
}

function cleanupSessionHandles(session: ExecSessionRecord): void {
	session.child?.stdin?.destroy?.();
	session.child?.stdout?.destroy?.();
	session.child?.stderr?.destroy?.();
	session.child?.removeAllListeners();
	if (session.stdin) {
		try {
			session.stdin.destroy?.();
		} catch {
			// Best effort cleanup only.
		}
		try {
			session.stdin.destroyed = true;
		} catch {
			// Ignore readonly wrappers.
		}
	}
	delete session.child;
	delete session.stdin;
}

export function finalizeExecSession(
	session: ExecSessionRecord,
	status: Exclude<ExecSessionStatus, "running">,
	outcome: {
		exitCode: number | null;
		exitSignal: NodeJS.Signals | number | null;
		timedOut?: boolean;
	},
): void {
	session.exited = true;
	session.exitCode = outcome.exitCode;
	session.exitSignal = outcome.exitSignal;
	session.timedOut = outcome.timedOut === true;
	session.endedAt = Date.now();
	session.tail = tailExecOutput(session.aggregated);
	session.outputVersion += 1;
	runningSessions.delete(session.id);
	cleanupSessionHandles(session);
	if (!session.backgrounded) {
		return;
	}
	finishedSessions.set(session.id, {
		id: session.id,
		command: session.command,
		cwd: session.cwd,
		startedAt: session.startedAt,
		endedAt: session.endedAt,
		status,
		exitCode: session.exitCode,
		exitSignal: session.exitSignal,
		aggregated: session.aggregated,
		tail: session.tail,
		truncated: session.truncated,
		totalOutputChars: session.totalOutputChars,
	});
	ensureSweeper();
}

export function deleteExecSession(id: string): void {
	runningSessions.delete(id);
	finishedSessions.delete(id);
	if (runningSessions.size === 0 && finishedSessions.size === 0 && sweeper) {
		clearInterval(sweeper);
		sweeper = null;
	}
}

export function setFinishedExecSessionTtlMs(value: number): void {
	if (!Number.isFinite(value) || value <= 0) {
		return;
	}
	finishedSessionTtlMs = Math.floor(value);
}

export function clearExecSessionsForTest(): void {
	for (const [id, session] of Array.from(runningSessions.entries())) {
		try {
			session.child?.kill("SIGKILL");
		} catch {
			// Best effort test cleanup only.
		}
		cleanupSessionHandles(session);
		deleteExecSession(id);
	}
	finishedSessions.clear();
	if (sweeper) {
		clearInterval(sweeper);
		sweeper = null;
	}
}

export function getPendingCharsForSession(
	session: ExecSessionRecord,
): { stdout: number; stderr: number } {
	return {
		stdout: session.pendingStdoutChars || sumPendingChars(session.pendingStdout),
		stderr: session.pendingStderrChars || sumPendingChars(session.pendingStderr),
	};
}
