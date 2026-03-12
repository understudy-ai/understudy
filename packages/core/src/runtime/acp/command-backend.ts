import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AgentAcpConfig } from "@understudy/types";
import { normalizeBackendId, type AcpRuntimeBackend } from "./registry.js";
import type {
	AcpRuntime,
	AcpRuntimeEvent,
	AcpRuntimeHandle,
	AcpRuntimeTurnInput,
} from "./types.js";

type QueuedEventState = {
	queue: AcpRuntimeEvent[];
	waiters: Array<() => void>;
	done: boolean;
};

function createQueueState(): QueuedEventState {
	return {
		queue: [],
		waiters: [],
		done: false,
	};
}

function enqueueEvent(state: QueuedEventState, event: AcpRuntimeEvent): void {
	state.queue.push(event);
	while (state.waiters.length > 0) {
		const waiter = state.waiters.shift();
		waiter?.();
	}
}

async function waitForQueuedEvent(state: QueuedEventState): Promise<void> {
	if (state.queue.length > 0 || state.done) {
		return;
	}
	await new Promise<void>((resolve) => {
		state.waiters.push(resolve);
	});
}

function resolveBackendId(config?: AgentAcpConfig): string {
	return normalizeBackendId(config?.backend) || "command";
}

function resolveOutputFormat(config?: AgentAcpConfig): "text" | "json" | "jsonl" {
	const value = config?.outputFormat?.trim().toLowerCase();
	if (value === "json" || value === "jsonl") {
		return value;
	}
	return "text";
}

function summarizeProcessFailure(params: {
	command: string;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	stderr: string;
	error?: Error;
}): string {
	const stderr = params.stderr.trim();
	if (stderr) {
		return stderr;
	}
	if (params.error?.message) {
		return params.error.message;
	}
	if (params.signal) {
		return `${params.command} terminated by signal ${params.signal}`;
	}
	if (typeof params.exitCode === "number") {
		return `${params.command} exited with code ${params.exitCode}`;
	}
	return `${params.command} failed`;
}

function normalizeEventPayload(payload: unknown): AcpRuntimeEvent[] {
	if (!payload || typeof payload !== "object") {
		return [];
	}
	if (Array.isArray(payload)) {
		return payload.flatMap((entry) => normalizeEventPayload(entry));
	}
	const record = payload as Record<string, unknown>;
	const type = typeof record.type === "string" ? record.type : undefined;
	if (type === "text_delta" && typeof record.text === "string") {
		return [{
			type,
			text: record.text,
			...(record.stream === "output" || record.stream === "thought" ? { stream: record.stream } : {}),
		}];
	}
	if (type === "status" && typeof record.text === "string") {
		return [{ type, text: record.text }];
	}
	if (type === "tool_call" && typeof record.text === "string") {
		return [{
			type,
			text: record.text,
			...(typeof record.toolCallId === "string" ? { toolCallId: record.toolCallId } : {}),
			...(typeof record.status === "string" ? { status: record.status } : {}),
			...(typeof record.title === "string" ? { title: record.title } : {}),
		}];
	}
	if (type === "done") {
		return [{
			type,
			...(typeof record.stopReason === "string" ? { stopReason: record.stopReason } : {}),
			...(typeof record.text === "string" ? { text: record.text } : {}),
			...(record.meta && typeof record.meta === "object" && !Array.isArray(record.meta)
				? { meta: record.meta as Record<string, unknown> }
				: {}),
		}];
	}
	if (type === "error" && typeof record.message === "string") {
		return [{
			type,
			message: record.message,
			...(typeof record.code === "string" ? { code: record.code } : {}),
			...(typeof record.retryable === "boolean" ? { retryable: record.retryable } : {}),
		}];
	}
	if (Array.isArray(record.events)) {
		return record.events.flatMap((entry) => normalizeEventPayload(entry));
	}
	if (typeof record.text === "string") {
		return [{ type: "done", text: record.text }];
	}
	if (typeof record.message === "string") {
		return [{ type: "error", message: record.message }];
	}
	return [];
}

class CommandAcpRuntime implements AcpRuntime {
	private readonly activeRuns = new Map<string, ChildProcessWithoutNullStreams>();
	private readonly backendId: string;
	private readonly outputFormat: "text" | "json" | "jsonl";

	constructor(private readonly config: AgentAcpConfig) {
		this.backendId = resolveBackendId(config);
		this.outputFormat = resolveOutputFormat(config);
	}

	async ensureSession(input: { sessionKey: string; cwd?: string }): Promise<AcpRuntimeHandle> {
		return {
			sessionKey: input.sessionKey,
			backend: this.backendId,
			runtimeSessionName: input.sessionKey,
			cwd: input.cwd,
		};
	}

	async *runTurn(input: AcpRuntimeTurnInput): AsyncIterable<AcpRuntimeEvent> {
		const command = this.config.command?.trim();
		if (!command) {
			yield {
				type: "error",
				message: "ACP command backend is not configured. Set `agent.acp.command` before using runtime=acp.",
				code: "ACP_COMMAND_MISSING",
			};
			return;
		}

		const args = Array.isArray(this.config.args) ? this.config.args : [];
		const runKey = `${input.handle.sessionKey}:${input.requestId}`;
		const queueState = createQueueState();
		let stdoutBuffer = "";
		let stdoutLineBuffer = "";
		let stderrBuffer = "";
		let sawDoneEvent = false;
		let processError: Error | undefined;

		const child = spawn(command, args, {
			cwd: input.handle.cwd ?? process.cwd(),
			env: Object.assign({}, process.env, this.config.env, {
				UNDERSTUDY_ACP_BACKEND: this.backendId,
				UNDERSTUDY_ACP_SESSION_ID: input.handle.sessionKey,
				UNDERSTUDY_ACP_REQUEST_ID: input.requestId,
			}),
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.activeRuns.set(runKey, child);

		const payload = {
			protocol: "understudy_acp/v1",
			sessionId: input.handle.sessionKey,
			requestId: input.requestId,
			mode: input.mode,
			cwd: input.handle.cwd,
			systemPrompt: input.systemPrompt ?? "",
			prompt: input.text,
			messages: input.messages ?? [],
		};

		const enqueueNormalized = (payloadValue: unknown) => {
			for (const event of normalizeEventPayload(payloadValue)) {
				if (event.type === "done") {
					sawDoneEvent = true;
				}
				enqueueEvent(queueState, event);
			}
		};

		child.stdout.on("data", (chunk: Buffer | string) => {
			const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
			if (!text) {
				return;
			}
			stdoutBuffer += text;
			if (this.outputFormat === "text") {
				enqueueEvent(queueState, {
					type: "text_delta",
					text,
					stream: "output",
				});
				return;
			}
			if (this.outputFormat !== "jsonl") {
				return;
			}
			stdoutLineBuffer += text;
			const lines = stdoutLineBuffer.split(/\r?\n/);
			stdoutLineBuffer = lines.pop() ?? "";
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) {
					continue;
				}
				try {
					enqueueNormalized(JSON.parse(trimmed));
				} catch {
					enqueueEvent(queueState, {
						type: "text_delta",
						text: `${line}\n`,
						stream: "output",
					});
				}
			}
		});

		child.stderr.on("data", (chunk: Buffer | string) => {
			const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
			stderrBuffer += text;
		});

		child.on("error", (error) => {
			processError = error;
		});

		child.on("close", (code, signal) => {
			this.activeRuns.delete(runKey);
			if (this.outputFormat === "jsonl" && stdoutLineBuffer.trim()) {
				try {
					enqueueNormalized(JSON.parse(stdoutLineBuffer.trim()));
				} catch {
					enqueueEvent(queueState, {
						type: "text_delta",
						text: stdoutLineBuffer,
						stream: "output",
					});
				}
			}
			if (code === 0 && !processError) {
				if (this.outputFormat === "json") {
					const trimmed = stdoutBuffer.trim();
					if (trimmed) {
						try {
							enqueueNormalized(JSON.parse(trimmed));
						} catch {
							enqueueEvent(queueState, {
								type: "text_delta",
								text: stdoutBuffer,
								stream: "output",
							});
						}
					}
				}
				if (!sawDoneEvent) {
					enqueueEvent(queueState, {
						type: "done",
						text: this.outputFormat === "text" ? stdoutBuffer : undefined,
					});
				}
			} else {
				enqueueEvent(queueState, {
					type: "error",
					message: summarizeProcessFailure({
						command,
						exitCode: code,
						signal,
						stderr: stderrBuffer,
						error: processError,
					}),
					code: "ACP_COMMAND_FAILED",
				});
			}
			queueState.done = true;
			while (queueState.waiters.length > 0) {
				const waiter = queueState.waiters.shift();
				waiter?.();
			}
		});

		if (input.signal) {
			input.signal.addEventListener(
				"abort",
				() => {
					if (!child.killed) {
						child.kill("SIGTERM");
					}
				},
				{ once: true },
			);
		}

		child.stdin.end(JSON.stringify(payload));

		for (;;) {
			if (queueState.queue.length === 0) {
				await waitForQueuedEvent(queueState);
			}
			const next = queueState.queue.shift();
			if (next) {
				yield next;
				continue;
			}
			if (queueState.done) {
				return;
			}
		}
	}

	async cancel(input: { handle: AcpRuntimeHandle; reason?: string }): Promise<void> {
		for (const [runKey, child] of this.activeRuns.entries()) {
			if (!runKey.startsWith(`${input.handle.sessionKey}:`)) {
				continue;
			}
			if (!child.killed) {
				child.kill("SIGTERM");
			}
		}
	}

	async close(input: { handle: AcpRuntimeHandle; reason: string }): Promise<void> {
		await this.cancel({ handle: input.handle, reason: input.reason });
	}
}

export function createCommandAcpRuntimeBackend(config: AgentAcpConfig): AcpRuntimeBackend {
	return {
		id: resolveBackendId(config),
		runtime: new CommandAcpRuntime(config),
		healthy: () => typeof config.command === "string" && config.command.trim().length > 0,
	};
}
