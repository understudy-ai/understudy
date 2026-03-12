import type { Model, ThinkingLevel } from "@mariozechner/pi-ai";
import type { AgentMessage, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { Static, TSchema } from "@sinclair/typebox";
import type { AgentAcpConfig, ToolCategory, ToolRiskLevel } from "@understudy/types";

/**
 * Runtime-level prompt options intentionally stay engine-agnostic.
 * Concrete adapters can pass richer provider-specific options internally.
 */
export type RuntimePromptOptions = Record<string, unknown>;

/**
 * Engine-agnostic runtime session event shape.
 * Adapters may include additional fields.
 */
export interface RuntimeSessionEvent {
	type?: string;
	[key: string]: unknown;
}

/**
 * Understudy-owned executable tool definition contract used by runtime adapters.
 */
export interface RuntimeToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown> {
	name: string;
	label?: string;
	description?: string;
	riskLevel?: ToolRiskLevel;
	category?: ToolCategory;
	parameters: TParams;
	execute: (
		toolCallId: string,
		params: Static<TParams>,
		signal: AbortSignal,
		onUpdate?: (update: AgentToolResult<TDetails>) => void,
		context?: unknown,
	) => Promise<AgentToolResult<TDetails>> | AgentToolResult<TDetails>;
}

/**
 * Opaque runtime session manager handle.
 * Current adapters pass through engine-specific managers.
 */
export type RuntimeSessionManager = unknown;

/**
 * Minimal engine session contract required by Understudy runtime orchestration.
 */
export interface RuntimeEngineSession {
	agent: {
		setSystemPrompt(prompt: string): void;
		state: {
			messages: AgentMessage[];
		};
	};
	prompt(text: string, options?: RuntimePromptOptions): Promise<void>;
	subscribe?(listener: (event: RuntimeSessionEvent) => void): () => void;
	dispose?(): void;
}

export interface RuntimeCreateSessionOptions {
	cwd: string;
	model?: Model<any>;
	thinkingLevel?: ThinkingLevel;
	/** Runtime storage directory for auth/settings/models managed by the engine */
	agentDir?: string;
	authStorage?: AuthStorage;
	modelRegistry?: ModelRegistry;
	customTools: RuntimeToolDefinition[];
	sessionManager?: RuntimeSessionManager;
	acpConfig?: AgentAcpConfig;
}

export interface RuntimeSession {
	readonly session: RuntimeEngineSession;
	prompt(text: string, options?: RuntimePromptOptions): Promise<void>;
	setSystemPrompt(prompt: string): void;
	getMessages(): AgentMessage[];
	onEvent(listener: (event: RuntimeSessionEvent) => void): () => void;
	close(): Promise<void> | void;
}

export interface RuntimeCreateSessionResult {
	session: RuntimeEngineSession;
	runtimeSession: RuntimeSession;
	extensionsResult?: unknown;
	[key: string]: unknown;
}

export interface RuntimeAdapterLifecycle {
	prompt(
		session: RuntimeEngineSession,
		text: string,
		options?: RuntimePromptOptions,
	): Promise<void>;
	setSystemPrompt(session: RuntimeEngineSession, prompt: string): void;
	getMessages(session: RuntimeEngineSession): AgentMessage[];
	onEvent(
		session: RuntimeEngineSession,
		listener: (event: RuntimeSessionEvent) => void,
	): () => void;
	closeSession(session: RuntimeEngineSession): Promise<void> | void;
}

export interface RuntimeAdapter extends RuntimeAdapterLifecycle {
	readonly name: string;
	createSession(options: RuntimeCreateSessionOptions): Promise<RuntimeCreateSessionResult>;
}
