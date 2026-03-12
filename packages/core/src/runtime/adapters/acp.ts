import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AgentAcpConfig } from "@understudy/types";
import type {
	RuntimeAdapter,
	RuntimeCreateSessionOptions,
	RuntimeCreateSessionResult,
	RuntimeEngineSession,
	RuntimePromptOptions,
	RuntimeSessionEvent,
} from "../types.js";
import { createRuntimeSessionHandle } from "./session-handle.js";
import { createCommandAcpRuntimeBackend } from "../acp/command-backend.js";
import { resolveAcpRuntimeBackend } from "../acp/registry.js";
import type {
	AcpRuntime,
	AcpRuntimeHandle,
	AcpRuntimePromptMode,
} from "../acp/types.js";

type RuntimeEventListener = (event: RuntimeSessionEvent) => void;

type ActiveRunState = {
	requestId: string;
	handle: AcpRuntimeHandle;
	abortController: AbortController;
};

function buildTextMessage(role: "user" | "assistant", text: string): AgentMessage {
	return {
		role,
		content: [{ type: "text", text }],
	} as unknown as AgentMessage;
}

class AcpEngineSession implements RuntimeEngineSession {
	agent = {
		setSystemPrompt: (prompt: string) => {
			this.systemPrompt = prompt;
		},
		state: {
			messages: [] as AgentMessage[],
		},
	};

	private readonly listeners = new Set<RuntimeEventListener>();
	private handlePromise?: Promise<AcpRuntimeHandle>;
	private activeRun?: ActiveRunState;
	private systemPrompt = "";

	constructor(
		private readonly runtime: AcpRuntime,
		private readonly cwd: string,
	) {}

	async prompt(text: string, options?: RuntimePromptOptions): Promise<void> {
		const handle = await this.ensureHandle();
		const requestId = randomUUID();
		const abortController = new AbortController();
		this.activeRun = {
			requestId,
			handle,
			abortController,
		};
		this.agent.state.messages.push(buildTextMessage("user", text));
		this.emit({
			type: "message_start",
			requestId,
		});

		let assistantText = "";
		const promptMode = this.resolvePromptMode(options);

		try {
			for await (const event of this.runtime.runTurn({
				handle,
				text,
				mode: promptMode,
				requestId,
				signal: abortController.signal,
				systemPrompt: this.systemPrompt,
				messages: this.agent.state.messages.slice(),
			})) {
				if (event.type === "text_delta") {
					assistantText += event.text;
					this.emit({
						type: "message_chunk",
						requestId,
						stream: event.stream ?? "output",
						text: event.text,
					});
					continue;
				}
				if (event.type === "tool_call") {
					this.emit({
						type: "tool_call",
						requestId,
						text: event.text,
						...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
						...(event.status ? { status: event.status } : {}),
						...(event.title ? { title: event.title } : {}),
					});
					continue;
				}
				if (event.type === "status") {
					this.emit({
						type: "status",
						requestId,
						text: event.text,
					});
					continue;
				}
				if (event.type === "done") {
					if (!assistantText.trim() && typeof event.text === "string") {
						assistantText = event.text;
					}
					continue;
				}
				throw Object.assign(new Error(event.message), {
					code: event.code,
				});
			}

			const assistantMessage = buildTextMessage("assistant", assistantText);
			this.agent.state.messages.push(assistantMessage);
			this.emit({
				type: "message_end",
				requestId,
				message: assistantMessage,
			});
		} finally {
			if (this.activeRun?.requestId === requestId) {
				this.activeRun = undefined;
			}
		}
	}

	subscribe(listener: RuntimeEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async abort(): Promise<void> {
		const active = this.activeRun;
		if (!active) {
			return;
		}
		active.abortController.abort();
		await this.runtime.cancel({
			handle: active.handle,
			reason: "session abort",
		});
	}

	async dispose(): Promise<void> {
		if (this.activeRun) {
			await this.abort();
		}
		const handle = await this.ensureHandle().catch(() => null);
		if (!handle) {
			return;
		}
		await this.runtime.close({
			handle,
			reason: "session dispose",
		});
	}

	private emit(event: RuntimeSessionEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	private async ensureHandle(): Promise<AcpRuntimeHandle> {
		if (!this.handlePromise) {
			this.handlePromise = this.runtime.ensureSession({
				sessionKey: `understudy:acp:${randomUUID()}`,
				mode: "persistent",
				cwd: this.cwd,
			});
		}
		return await this.handlePromise;
	}

	private resolvePromptMode(options?: RuntimePromptOptions): AcpRuntimePromptMode {
		const raw = (options as { mode?: unknown; steer?: unknown } | undefined);
		if (raw?.mode === "steer" || raw?.steer === true) {
			return "steer";
		}
		return "prompt";
	}
}

function resolveAcpRuntime(config?: AgentAcpConfig): { id: string; runtime: AcpRuntime } {
	if (config?.command?.trim()) {
		const backend = createCommandAcpRuntimeBackend(config);
		return {
			id: backend.id,
			runtime: backend.runtime,
		};
	}
	const backend = resolveAcpRuntimeBackend(config);
	return {
		id: backend.id,
		runtime: backend.runtime,
	};
}

export class AcpRuntimeAdapter implements RuntimeAdapter {
	readonly name = "acp";

	async createSession(options: RuntimeCreateSessionOptions): Promise<RuntimeCreateSessionResult> {
		const resolved = resolveAcpRuntime(options.acpConfig);
		const session = new AcpEngineSession(resolved.runtime, options.cwd);
		return {
			session,
			runtimeSession: createRuntimeSessionHandle(this, session),
			extensionsResult: {
				backendId: resolved.id,
			},
		};
	}

	async prompt(
		session: RuntimeEngineSession,
		text: string,
		options?: RuntimePromptOptions,
	): Promise<void> {
		await session.prompt(text, options);
	}

	setSystemPrompt(session: RuntimeEngineSession, prompt: string): void {
		session.agent.setSystemPrompt(prompt);
	}

	getMessages(session: RuntimeEngineSession): AgentMessage[] {
		return session.agent.state.messages as AgentMessage[];
	}

	onEvent(
		session: RuntimeEngineSession,
		listener: (event: RuntimeSessionEvent) => void,
	): () => void {
		return typeof session.subscribe === "function" ? session.subscribe(listener) : () => {};
	}

	closeSession(session: RuntimeEngineSession): Promise<void> | void {
		if (typeof session.dispose === "function") {
			return session.dispose();
		}
	}
}
