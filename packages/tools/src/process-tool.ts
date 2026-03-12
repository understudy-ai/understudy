/**
 * Process management tool for Understudy.
 *
 * The session-oriented actions in this file are intentional OpenClaw migration
 * compatibility so existing skills can continue using exec/process workflows
 * after moving to Understudy. They are product surface, not removable legacy
 * support for an old Understudy release.
 */

import { execSync } from "node:child_process";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@sinclair/typebox";
import {
	deleteExecSession,
	drainExecSession,
	getExecSession,
	getFinishedExecSession,
	listFinishedExecSessions,
	listRunningExecSessions,
	type ExecSessionRecord,
	type FinishedExecSessionRecord,
} from "./openclaw-exec-sessions.js";

const ProcessSchema = Type.Object({
	action: Type.String({
		description:
			'Action to perform. Host PID actions: "list", "info", "kill". ' +
			'OpenClaw-compatible exec session actions: "poll", "log", "write", "send-keys", "submit", "paste", "clear", "remove".',
	}),
	pid: Type.Optional(
		Type.Number({
			description: "Host process ID for info/kill actions.",
		}),
	),
	sessionId: Type.Optional(
		Type.String({
			description: "Exec session id for OpenClaw-compatible session actions.",
		}),
	),
	signal: Type.Optional(
		Type.String({
			description: 'Signal for kill action (default "SIGTERM").',
		}),
	),
	data: Type.Optional(
		Type.String({
			description: "Data to write to a session stdin stream.",
		}),
	),
	keys: Type.Optional(
		Type.Array(Type.String(), {
			description: "Key tokens for send-keys (for example ENTER, CTRL_C, UP).",
		}),
	),
	hex: Type.Optional(
		Type.Array(Type.String(), {
			description: "Raw bytes for send-keys as hex strings, for example 03 or 1b5b41.",
		}),
	),
	literal: Type.Optional(
		Type.String({
			description: "Literal text to send with send-keys.",
		}),
	),
	text: Type.Optional(
		Type.String({
			description: "Text to paste into the session stdin stream.",
		}),
	),
	bracketed: Type.Optional(
		Type.Boolean({
			description:
				"Compatibility flag from OpenClaw paste. Understudy keeps the field for portability but writes plain stdin text in this runtime.",
		}),
	),
	eof: Type.Optional(
		Type.Boolean({
			description: "Close stdin after write.",
		}),
	),
	offset: Type.Optional(
		Type.Number({
			description: "Log line offset for the log action.",
		}),
	),
	limit: Type.Optional(
		Type.Number({
			description: "Maximum number of log lines returned by the log action.",
		}),
	),
	timeout: Type.Optional(
		Type.Union([
			Type.Number({
				description:
					"Milliseconds to wait for new output during poll before returning.",
			}),
			Type.String({
				description:
					"OpenClaw-compatible string form of the poll timeout in milliseconds.",
			}),
		]),
	),
});

type ProcessParams = Static<typeof ProcessSchema>;

type SessionLike = ExecSessionRecord | FinishedExecSessionRecord;

const DEFAULT_LOG_TAIL_LINES = 200;
const MAX_POLL_WAIT_MS = 120_000;

const SEND_KEY_MAP: Record<string, string> = {
	ENTER: "\r",
	RETURN: "\r",
	TAB: "\t",
	ESC: "\u001b",
	SPACE: " ",
	BACKSPACE: "\u0008",
	DELETE: "\u007f",
	CTRL_C: "\u0003",
	CTRL_D: "\u0004",
	CTRL_Z: "\u001a",
	UP: "\u001b[A",
	DOWN: "\u001b[B",
	RIGHT: "\u001b[C",
	LEFT: "\u001b[D",
};

function textResult(
	text: string,
	details: Record<string, unknown> = {},
): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text }],
		details,
	};
}

function describeSessionCommand(command: string): string {
	const trimmed = command.trim();
	if (trimmed.length <= 120) {
		return trimmed;
	}
	return `${trimmed.slice(0, 117)}...`;
}

function resolvePollWaitMs(value: unknown): number {
	if (typeof value === "string") {
		const parsed = Number.parseInt(value.trim(), 10);
		if (Number.isFinite(parsed)) {
			return Math.max(0, Math.min(MAX_POLL_WAIT_MS, parsed));
		}
		return 0;
	}
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return 0;
	}
	return Math.max(0, Math.min(MAX_POLL_WAIT_MS, Math.floor(value)));
}

function resolveSignal(signal?: string): NodeJS.Signals {
	return (signal?.trim() || "SIGTERM") as NodeJS.Signals;
}

function isRunningSession(
	session: SessionLike | undefined,
): session is ExecSessionRecord {
	return Boolean(session && "backgrounded" in session);
}

function resolveSession(sessionId: string | undefined): {
	running?: ExecSessionRecord;
	finished?: FinishedExecSessionRecord;
} {
	if (!sessionId) {
		return {};
	}
	return {
		running: getExecSession(sessionId),
		finished: getFinishedExecSession(sessionId),
	};
}

function listHostProcesses(): AgentToolResult<unknown> {
	try {
		const output = execSync("ps aux --sort=-%cpu 2>/dev/null || ps aux", {
			encoding: "utf-8",
			timeout: 5000,
		});
		const lines = output.trim().split("\n");
		const header = lines[0];
		const processes = lines.slice(1, 21);
		return textResult(`${header}\n${processes.join("\n")}`, {
			count: processes.length,
		});
	} catch (error) {
		return textResult(
			`Error listing processes: ${error instanceof Error ? error.message : String(error)}`,
			{ error: true },
		);
	}
}

function listExecSessions(): AgentToolResult<unknown> {
	const running = listRunningExecSessions().map((session) => ({
		sessionId: session.id,
		status: session.exited ? "failed" : "running",
		pid: session.pid,
		startedAt: session.startedAt,
		runtimeMs: Date.now() - session.startedAt,
		cwd: session.cwd,
		command: session.command,
		tail: session.tail,
		truncated: session.truncated,
	}));
	const finished = listFinishedExecSessions().map((session) => ({
		sessionId: session.id,
		status: session.status,
		startedAt: session.startedAt,
		endedAt: session.endedAt,
		runtimeMs: session.endedAt - session.startedAt,
		cwd: session.cwd,
		command: session.command,
		tail: session.tail,
		truncated: session.truncated,
		exitCode: session.exitCode,
		exitSignal: session.exitSignal,
	}));
	const sessions = [...running, ...finished].sort((left, right) => right.startedAt - left.startedAt);
	if (sessions.length === 0) {
		return listHostProcesses();
	}
	const lines = sessions.map((session) => {
		const runtimeSeconds = Math.max(0, Math.floor(session.runtimeMs / 1000));
		return `${session.sessionId} ${String(session.status).padEnd(9, " ")} ${runtimeSeconds}s :: ${describeSessionCommand(session.command)}`;
	});
	return textResult(lines.join("\n"), {
		status: "completed",
		sessions,
	});
}

function processInfo(pid: number | undefined): AgentToolResult<unknown> {
	if (pid === undefined) {
		return textResult("Error: pid is required for info action", {
			error: "missing pid",
		});
	}
	try {
		const output = execSync(`ps -p ${pid} -o pid,ppid,user,%cpu,%mem,stat,start,command`, {
			encoding: "utf-8",
			timeout: 5000,
		});
		return textResult(output.trim(), { pid });
	} catch {
		return textResult(`Process ${pid} not found`, {
			error: "not found",
			pid,
		});
	}
}

function sessionInfo(sessionId: string): AgentToolResult<unknown> {
	const { running, finished } = resolveSession(sessionId);
	if (running) {
		return textResult(
			[
				`Session: ${running.id}`,
				"Status: running",
				`PID: ${running.pid ?? "unknown"}`,
				`Started: ${new Date(running.startedAt).toISOString()}`,
				`CWD: ${running.cwd ?? process.cwd()}`,
				`Command: ${running.command}`,
			].join("\n"),
			{
				status: "running",
				sessionId: running.id,
				pid: running.pid,
			},
		);
	}
	if (finished) {
		return textResult(
			[
				`Session: ${finished.id}`,
				`Status: ${finished.status}`,
				`Started: ${new Date(finished.startedAt).toISOString()}`,
				`Ended: ${new Date(finished.endedAt).toISOString()}`,
				`CWD: ${finished.cwd ?? process.cwd()}`,
				`Command: ${finished.command}`,
				`Exit: ${finished.exitSignal ? `signal ${finished.exitSignal}` : `code ${finished.exitCode ?? 0}`}`,
			].join("\n"),
			{
				status: finished.status,
				sessionId: finished.id,
				exitCode: finished.exitCode ?? undefined,
				exitSignal: finished.exitSignal ?? undefined,
			},
		);
	}
	return textResult(`No session found for ${sessionId}`, {
		status: "failed",
	});
}

function killHostProcess(pid: number | undefined, signal?: string): AgentToolResult<unknown> {
	if (pid === undefined) {
		return textResult("Error: pid is required for kill action", {
			error: "missing pid",
		});
	}
	const resolvedSignal = resolveSignal(signal);
	try {
		process.kill(pid, resolvedSignal);
		return textResult(`Sent ${resolvedSignal} to process ${pid}`, {
			pid,
			signal: resolvedSignal,
		});
	} catch (error) {
		return textResult(
			`Error killing process ${pid}: ${error instanceof Error ? error.message : String(error)}`,
			{ error: true, pid },
		);
	}
}

function sliceLogLines(
	text: string,
	offset?: number,
	limit?: number,
): { slice: string; totalLines: number; totalChars: number } {
	const lines = text.split(/\r?\n/);
	const totalLines = lines.length;
	const totalChars = text.length;
	if (offset === undefined && limit === undefined) {
		const tail = lines.slice(-DEFAULT_LOG_TAIL_LINES).join("\n");
		return { slice: tail, totalLines, totalChars };
	}
	const start = Math.max(0, Math.floor(offset ?? 0));
	const end = limit === undefined ? lines.length : start + Math.max(0, Math.floor(limit));
	return {
		slice: lines.slice(start, end).join("\n"),
		totalLines,
		totalChars,
	};
}

async function writeToSession(
	session: ExecSessionRecord | undefined,
	data: string | Uint8Array,
): Promise<AgentToolResult<unknown> | undefined> {
	if (!session) {
		return textResult("No active session found", { status: "failed" });
	}
	const stdin = session.stdin ?? session.child?.stdin;
	if (!stdin || stdin.destroyed) {
		return textResult(`Session ${session.id} stdin is not writable.`, {
			status: "failed",
		});
	}
	await new Promise<void>((resolve, reject) => {
		stdin.write(data, (error) => {
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		});
	});
	return undefined;
}

function decodeHexChunks(hexChunks: string[] | undefined): Uint8Array | undefined {
	if (!Array.isArray(hexChunks) || hexChunks.length === 0) {
		return undefined;
	}
	const buffers = hexChunks.map((value) => {
		const normalized = value.trim().replace(/^0x/i, "");
		return Buffer.from(normalized, "hex");
	});
	return Buffer.concat(buffers);
}

function encodeKeys(params: ProcessParams): {
	payload?: string | Uint8Array;
	warnings: string[];
} {
	const warnings: string[] = [];
	const parts: Array<string | Uint8Array> = [];
	if (params.literal) {
		parts.push(params.literal);
	}
	const hexPayload = decodeHexChunks(params.hex);
	if (hexPayload) {
		parts.push(hexPayload);
	}
	if (Array.isArray(params.keys)) {
		for (const rawKey of params.keys) {
			const key = rawKey.trim().toUpperCase();
			const mapped = SEND_KEY_MAP[key];
			if (mapped) {
				parts.push(mapped);
			} else {
				warnings.push(`Unsupported key token: ${rawKey}`);
			}
		}
	}
	if (parts.length === 0) {
		return { warnings };
	}
	const buffers = parts.map((part) =>
		typeof part === "string" ? Buffer.from(part, "utf8") : Buffer.from(part),
	);
	return {
		payload: Buffer.concat(buffers),
		warnings,
	};
}

async function waitForOutputChangeOrExit(
	session: ExecSessionRecord,
	timeoutMs: number,
): Promise<void> {
	if (timeoutMs <= 0) {
		return;
	}
	const startVersion = session.outputVersion;
	const deadline = Date.now() + timeoutMs;
	while (!session.exited && session.outputVersion === startVersion && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, Math.min(250, deadline - Date.now())));
	}
}

function runningSessionResult(session: ExecSessionRecord, text: string): AgentToolResult<unknown> {
	return textResult(text, {
		status: "running",
		sessionId: session.id,
	});
}

function summarizeSessionOutput(stdout: string, stderr: string): string {
	const output = [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join("\n").trim();
	return output || "(no new output)";
}

async function killExecSession(
	sessionId: string | undefined,
	signal?: string,
): Promise<AgentToolResult<unknown>> {
	if (!sessionId) {
		return textResult("sessionId is required for exec session kill", {
			status: "failed",
		});
	}
	const { running, finished } = resolveSession(sessionId);
	if (!running && finished) {
		return textResult(`Session ${sessionId} has already exited.`, {
			status: finished.status,
			sessionId,
		});
	}
	if (!running) {
		return textResult(`No active session found for ${sessionId}`, {
			status: "failed",
		});
	}
	try {
		const resolvedSignal = resolveSignal(signal);
		if (running.child?.kill) {
			running.child.kill(resolvedSignal);
		} else if (typeof running.pid === "number") {
			process.kill(running.pid, resolvedSignal);
		} else {
			return textResult(
				`Unable to terminate session ${sessionId}: no live child process is attached.`,
				{ status: "failed" },
			);
		}
		return textResult(`Termination requested for session ${sessionId}.`, {
			status: "running",
			sessionId,
			signal: resolvedSignal,
		});
	} catch (error) {
		return textResult(
			`Error killing session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
			{ status: "failed", sessionId },
		);
	}
}

export function createProcessTool(): AgentTool<typeof ProcessSchema> {
	return {
		name: "process",
		label: "Process Manager",
		description:
			"Inspect host processes and manage OpenClaw-compatible exec sessions. " +
			'Use "list/info/kill" for host PIDs and "poll/log/write/submit/paste/remove" for exec sessionIds.',
		parameters: ProcessSchema,
		execute: async (_toolCallId, params: ProcessParams): Promise<AgentToolResult<unknown>> => {
			switch (params.action) {
				case "list":
					return listExecSessions();

				case "info":
					if (params.sessionId) {
						return sessionInfo(params.sessionId);
					}
					return processInfo(params.pid);

				case "kill":
					if (params.sessionId) {
						return await killExecSession(params.sessionId, params.signal);
					}
					return killHostProcess(params.pid, params.signal);

				case "poll": {
					if (!params.sessionId) {
						return textResult("sessionId is required for poll", {
							status: "failed",
						});
					}
					const { running, finished } = resolveSession(params.sessionId);
					if (!running && finished) {
						return textResult(
							`${finished.tail || "(no output recorded)"}\n\nProcess exited with ${
								finished.exitSignal ? `signal ${finished.exitSignal}` : `code ${finished.exitCode ?? 0}`
							}.`,
							{
								status: finished.status,
								sessionId: finished.id,
								exitCode: finished.exitCode ?? undefined,
								exitSignal: finished.exitSignal ?? undefined,
							},
						);
					}
					if (!running) {
						return textResult(`No session found for ${params.sessionId}`, {
							status: "failed",
						});
					}
					await waitForOutputChangeOrExit(running, resolvePollWaitMs(params.timeout));
					const { stdout, stderr } = drainExecSession(running);
					if (running.exited) {
						return textResult(
							`${summarizeSessionOutput(stdout, stderr)}\n\nProcess exited with ${
								running.exitSignal ? `signal ${running.exitSignal}` : `code ${running.exitCode ?? 0}`
							}.`,
							{
								status:
									running.exitCode === 0 && running.exitSignal === null ? "completed" : "failed",
								sessionId: running.id,
								exitCode: running.exitCode ?? undefined,
								exitSignal: running.exitSignal ?? undefined,
								aggregated: running.aggregated,
							},
						);
					}
					return textResult(`${summarizeSessionOutput(stdout, stderr)}\n\nProcess still running.`, {
						status: "running",
						sessionId: running.id,
						aggregated: running.aggregated,
					});
				}

				case "log": {
					if (!params.sessionId) {
						return textResult("sessionId is required for log", {
							status: "failed",
						});
					}
					const { running, finished } = resolveSession(params.sessionId);
					const session = running ?? finished;
					if (!session) {
						return textResult(`No session found for ${params.sessionId}`, {
							status: "failed",
						});
					}
					const window = sliceLogLines(session.aggregated, params.offset, params.limit);
					return textResult(window.slice || "(no output yet)", {
						status: isRunningSession(session)
							? session.exited
								? "completed"
								: "running"
							: session.status,
						sessionId: params.sessionId,
						totalLines: window.totalLines,
						totalChars: window.totalChars,
						truncated: session.truncated,
					});
				}

				case "write": {
					if (!params.sessionId) {
						return textResult("sessionId is required for write", {
							status: "failed",
						});
					}
					const running = getExecSession(params.sessionId);
					if (!running) {
						return textResult(`No active session found for ${params.sessionId}`, {
							status: "failed",
						});
					}
					const writeResult = await writeToSession(running, params.data ?? "");
					if (writeResult) {
						return writeResult;
					}
					if (params.eof) {
						running.stdin?.end();
					}
					return runningSessionResult(
						running,
						`Wrote ${(params.data ?? "").length} bytes to session ${params.sessionId}${
							params.eof ? " (stdin closed)" : ""
						}.`,
					);
				}

				case "send-keys": {
					if (!params.sessionId) {
						return textResult("sessionId is required for send-keys", {
							status: "failed",
						});
					}
					const running = getExecSession(params.sessionId);
					if (!running) {
						return textResult(`No active session found for ${params.sessionId}`, {
							status: "failed",
						});
					}
					const encoded = encodeKeys(params);
					if (!encoded.payload) {
						const warningText = encoded.warnings.length
							? `\nWarnings:\n- ${encoded.warnings.join("\n- ")}`
							: "";
						return textResult(`No key data provided.${warningText}`, {
							status: "failed",
						});
					}
					const writeResult = await writeToSession(running, encoded.payload);
					if (writeResult) {
						return writeResult;
					}
					const warningText = encoded.warnings.length
						? `\nWarnings:\n- ${encoded.warnings.join("\n- ")}`
						: "";
					return runningSessionResult(
						running,
						`Sent key data to session ${params.sessionId}.${warningText}`,
					);
				}

				case "submit": {
					if (!params.sessionId) {
						return textResult("sessionId is required for submit", {
							status: "failed",
						});
					}
					const running = getExecSession(params.sessionId);
					if (!running) {
						return textResult(`No active session found for ${params.sessionId}`, {
							status: "failed",
						});
					}
					const prefix = params.data ?? "";
					if (prefix) {
						const prefixWrite = await writeToSession(running, prefix);
						if (prefixWrite) {
							return prefixWrite;
						}
					}
					const writeResult = await writeToSession(running, "\r");
					if (writeResult) {
						return writeResult;
					}
					return runningSessionResult(
						running,
						`Submitted session ${params.sessionId} (sent ${prefix ? "data + CR" : "CR"}).`,
					);
				}

				case "paste": {
					if (!params.sessionId) {
						return textResult("sessionId is required for paste", {
							status: "failed",
						});
					}
					const running = getExecSession(params.sessionId);
					if (!running) {
						return textResult(`No active session found for ${params.sessionId}`, {
							status: "failed",
						});
					}
					const writeResult = await writeToSession(running, params.text ?? "");
					if (writeResult) {
						return writeResult;
					}
					const note = params.bracketed === false
						? ""
						: "\nCompatibility note: Understudy writes plain stdin text here instead of terminal bracketed paste sequences.";
					return runningSessionResult(
						running,
						`Pasted ${params.text?.length ?? 0} chars to session ${params.sessionId}.${note}`,
					);
				}

				case "clear": {
					if (!params.sessionId) {
						return textResult("sessionId is required for clear", {
							status: "failed",
						});
					}
					const finished = getFinishedExecSession(params.sessionId);
					if (!finished) {
						return textResult(`No finished session found for ${params.sessionId}`, {
							status: "failed",
						});
					}
					deleteExecSession(params.sessionId);
					return textResult(`Cleared session ${params.sessionId}.`, {
						status: "completed",
					});
				}

				case "remove": {
					if (!params.sessionId) {
						return textResult("sessionId is required for remove", {
							status: "failed",
						});
					}
					const { running, finished } = resolveSession(params.sessionId);
					if (running) {
						await killExecSession(params.sessionId, params.signal);
						deleteExecSession(params.sessionId);
						return textResult(`Removed session ${params.sessionId}.`, {
							status: "completed",
						});
					}
					if (finished) {
						deleteExecSession(params.sessionId);
						return textResult(`Removed session ${params.sessionId}.`, {
							status: "completed",
						});
					}
					return textResult(`No session found for ${params.sessionId}`, {
						status: "failed",
					});
				}

				default:
					return textResult(
						`Unknown action: ${params.action}. Use "list", "info", "kill", "poll", "log", "write", "send-keys", "submit", "paste", "clear", or "remove".`,
						{ error: "unknown action" },
					);
			}
		},
	};
}
