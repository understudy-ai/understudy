import {
	createAgentSession,
} from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
	RuntimeAdapter,
	RuntimeCreateSessionOptions,
	RuntimeCreateSessionResult,
	RuntimeEngineSession,
	RuntimePromptOptions,
	RuntimeSessionEvent,
} from "../types.js";
import { createRuntimeSessionHandle } from "./session-handle.js";

/**
 * Embedded runtime adapter.
 * Uses pi-coding-agent createAgentSession as the execution engine,
 * while orchestration policies are applied in Understudy core.
 */
export class EmbeddedRuntimeAdapter implements RuntimeAdapter {
	readonly name = "embedded";

	async createSession(options: RuntimeCreateSessionOptions): Promise<RuntimeCreateSessionResult> {
		const result = await createAgentSession({
			cwd: options.cwd,
			agentDir: options.agentDir,
			authStorage: options.authStorage,
			modelRegistry: options.modelRegistry,
			model: options.model,
			thinkingLevel: options.thinkingLevel,
			// Keep built-in tools disabled; Understudy provides wrapped tool definitions.
			tools: [],
			customTools: options.customTools as any,
			sessionManager: options.sessionManager as any,
		});
		return {
			...result,
			runtimeSession: createRuntimeSessionHandle(this, result.session as RuntimeEngineSession),
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
		const subscribe = session.subscribe;
		if (typeof subscribe !== "function") {
			return () => {};
		}
		return subscribe.call(session, listener);
	}

	closeSession(session: RuntimeEngineSession): Promise<void> | void {
		const dispose = session.dispose;
		if (typeof dispose === "function") {
			dispose.call(session);
		}
	}
}
