/**
 * Exec tool for Understudy.
 *
 * Supports foreground execution plus background sessions that can be inspected
 * and controlled through the companion `process` tool.
 */

import { spawn } from "node:child_process";
import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import {
	addExecSession,
	appendExecOutput,
	createExecSessionRecord,
	drainExecSession,
	finalizeExecSession,
	markExecSessionBackgrounded,
	type ExecSessionRecord,
} from "./exec-sessions.js";

const DEFAULT_YIELD_MS = 10_000;
const DEFAULT_TIMEOUT_SECONDS = 1_800;

const ExecToolSchema = Type.Object({
	command: Type.String({
		description: "Shell command to execute.",
	}),
	workdir: Type.Optional(
		Type.String({
			description: "Working directory. Defaults to the current process cwd.",
		}),
	),
	env: Type.Optional(
		Type.Record(Type.String(), Type.String(), {
			description: "Additional environment variables for the command.",
		}),
	),
	yieldMs: Type.Optional(
		Type.Number({
			description:
				"Milliseconds to wait before returning a background session. Defaults to 10000.",
		}),
	),
	background: Type.Optional(
		Type.Boolean({
			description: "Return immediately with a sessionId and continue via process tool.",
		}),
	),
	timeout: Type.Optional(
		Type.Number({
			description: "Timeout in seconds before the process is terminated.",
		}),
	),
	elevated: Type.Optional(
		Type.Boolean({
			description:
				"Reserved for elevated execution. This runtime does not implement elevated host execution here.",
		}),
	),
	pty: Type.Optional(
		Type.Boolean({
			description:
				"Reserved for PTY execution. This runtime currently uses piped stdio instead of a real PTY.",
		}),
	),
});

type ExecToolParams = Static<typeof ExecToolSchema>;

type ExecOutcome = {
	status: "completed" | "failed";
	exitCode: number | null;
	exitSignal: NodeJS.Signals | number | null;
	timedOut: boolean;
	error?: string;
};

interface ResolvedShellCommand {
	command: string;
	args: string[];
}

function resolveShellCommand(): ResolvedShellCommand {
	if (process.platform === "win32") {
		return {
			command: process.env.ComSpec?.trim() || "cmd.exe",
			args: ["/d", "/s", "/c"],
		};
	}
	return {
		command: process.env.SHELL?.trim() || "/bin/sh",
		args: ["-c"],
	};
}

function resolveYieldMs(params: ExecToolParams): number {
	if (params.background === true) {
		return 0;
	}
	const raw = params.yieldMs ?? DEFAULT_YIELD_MS;
	if (!Number.isFinite(raw)) {
		return DEFAULT_YIELD_MS;
	}
	return Math.max(0, Math.floor(raw));
}

function resolveTimeoutSeconds(params: ExecToolParams): number {
	const raw = params.timeout ?? DEFAULT_TIMEOUT_SECONDS;
	if (!Number.isFinite(raw)) {
		return DEFAULT_TIMEOUT_SECONDS;
	}
	return Math.max(1, Math.floor(raw));
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function combineOutput(stdout: string, stderr: string): string {
	return [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join("\n").trim();
}

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

function buildForegroundResult(
	session: ExecSessionRecord,
	outcome: ExecOutcome,
	notes: string[],
	timeoutSeconds: number,
): AgentToolResult<unknown> {
	const text = session.aggregated.trim() || "(no output)";
	const exitLine = outcome.timedOut
		? `Process timed out after ${timeoutSeconds} seconds.`
		: `Process exited with ${outcome.exitSignal ? `signal ${outcome.exitSignal}` : `code ${outcome.exitCode ?? 0}`}.`;
	return prependNotes(
		{
			content: [{ type: "text", text: `${text}\n\n${exitLine}` }],
			details: {
				status: outcome.status,
				exitCode: outcome.exitCode ?? undefined,
				exitSignal: outcome.exitSignal ?? undefined,
				timedOut: outcome.timedOut,
			},
		},
		notes,
	);
}

function buildBackgroundResult(
	session: ExecSessionRecord,
	initialOutput: string,
	notes: string[],
): AgentToolResult<unknown> {
	const outputText = initialOutput || "(no output yet)";
	return prependNotes(
		{
			content: [
				{
					type: "text",
					text:
						`${outputText}\n\n` +
						`Background exec session started: ${session.id}\n` +
						"Continue it with process.poll/log/write/submit/paste/kill using this sessionId.",
				},
			],
			details: {
				status: "running",
				sessionId: session.id,
				pid: session.pid,
			},
		},
		notes,
	);
}

function appendSpawnError(session: ExecSessionRecord, error: unknown): void {
	appendExecOutput(
		session,
		"stderr",
		`spawn error: ${error instanceof Error ? error.message : String(error)}\n`,
	);
}

export function createExecTool(): AgentTool<typeof ExecToolSchema> {
	return {
		name: "exec",
		label: "exec",
		description:
			"Execute shell commands with background continuation support. " +
			"Use process.* actions with sessionId for long-running or interactive commands.",
		parameters: ExecToolSchema,
		execute: async (
			_toolCallId,
			params: ExecToolParams,
			signal,
		): Promise<AgentToolResult<unknown>> => {
			const command = params.command.trim();
			if (!command) {
				return {
					content: [{ type: "text", text: "Error: command is required" }],
					details: { status: "failed", error: "missing command" },
				};
			}

			const notes: string[] = [];
			if (params.elevated === true) {
				notes.push(
					"Exec note: elevated=true is accepted, but this Understudy runtime executes in its normal local permission context.",
				);
			}
			if (params.pty === true) {
				notes.push(
					"Exec note: pty=true is accepted, but this Understudy runtime currently uses piped stdio instead of a real PTY.",
				);
			}

			const shell = resolveShellCommand();
			const child = spawn(shell.command, [...shell.args, command], {
				cwd: params.workdir?.trim() || process.cwd(),
				env: {
					...process.env,
					...params.env,
				},
				stdio: ["pipe", "pipe", "pipe"],
			});

			const session = createExecSessionRecord({
				command,
				cwd: params.workdir?.trim() || process.cwd(),
				child,
				stdin: child.stdin,
			});
			addExecSession(session);

			let settled = false;
			const timeoutSeconds = resolveTimeoutSeconds(params);
			const timeoutHandle = setTimeout(() => {
				session.timedOut = true;
				child.kill("SIGTERM");
				setTimeout(() => {
					if (!session.exited) {
						child.kill("SIGKILL");
					}
				}, 1_000).unref?.();
			}, timeoutSeconds * 1_000);
			timeoutHandle.unref?.();

			const outcomePromise = new Promise<ExecOutcome>((resolve) => {
				const finish = (
					status: "completed" | "failed",
					exitCode: number | null,
					exitSignal: NodeJS.Signals | number | null,
					error?: string,
				) => {
					if (settled) {
						return;
					}
					settled = true;
					clearTimeout(timeoutHandle);
					finalizeExecSession(session, status, {
						exitCode,
						exitSignal,
						timedOut: session.timedOut,
					});
					resolve({
						status,
						exitCode,
						exitSignal,
						timedOut: session.timedOut,
						error,
					});
				};

				child.stdout.on("data", (chunk: Buffer | string) => {
					appendExecOutput(session, "stdout", String(chunk));
				});
				child.stderr.on("data", (chunk: Buffer | string) => {
					appendExecOutput(session, "stderr", String(chunk));
				});
				child.once("error", (error) => {
					appendSpawnError(session, error);
					finish("failed", null, null, error instanceof Error ? error.message : String(error));
				});
				child.once("close", (code, exitSignal) => {
					const ok = code === 0 && exitSignal === null && session.timedOut !== true;
					finish(ok ? "completed" : "failed", code, exitSignal);
				});
			});

			const abortHandler = () => {
				if (session.backgrounded) {
					return;
				}
				child.kill("SIGTERM");
				setTimeout(() => {
					if (!session.exited) {
						child.kill("SIGKILL");
					}
				}, 1_000).unref?.();
			};
			if (signal) {
				signal.addEventListener("abort", abortHandler, { once: true });
			}

			try {
				if (params.background === true) {
					markExecSessionBackgrounded(session);
					const pending = drainExecSession(session);
					return buildBackgroundResult(session, combineOutput(pending.stdout, pending.stderr), notes);
				}

				const yieldMs = resolveYieldMs(params);
				if (yieldMs <= 0) {
					markExecSessionBackgrounded(session);
					const pending = drainExecSession(session);
					return buildBackgroundResult(session, combineOutput(pending.stdout, pending.stderr), notes);
				}

				const outcome = await Promise.race<
					{ kind: "outcome"; value: ExecOutcome } | { kind: "yield" }
				>([
					outcomePromise.then((value) => ({ kind: "outcome" as const, value })),
					sleep(yieldMs).then(() => ({ kind: "yield" as const })),
				]);

				if (outcome.kind === "outcome") {
					return buildForegroundResult(session, outcome.value, notes, timeoutSeconds);
				}

				markExecSessionBackgrounded(session);
				const pending = drainExecSession(session);
				return buildBackgroundResult(session, combineOutput(pending.stdout, pending.stderr), notes);
			} finally {
				if (signal) {
					signal.removeEventListener("abort", abortHandler);
				}
			}
		},
	};
}
