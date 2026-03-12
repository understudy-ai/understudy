import type { AgentMessage, AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Static, TSchema } from "@sinclair/typebox";
import type { UnderstudyConfig } from "@understudy/types";
import type { SystemPromptOptions } from "../system-prompt.js";
import type { RuntimeProfile } from "./identity-policy.js";

export interface RuntimePolicyContext {
	runtimeProfile: RuntimeProfile;
	modelLabel: string;
	cwd: string;
	config: UnderstudyConfig;
}

export interface BeforePromptInput {
	text: string;
	options?: unknown;
}

export interface BeforePromptOutput {
	text: string;
	options?: unknown;
}

export interface BeforePromptBuildInput {
	options: SystemPromptOptions;
}

export interface BeforePromptBuildOutput {
	options: SystemPromptOptions;
}

export interface BeforeToolInput<TParams = unknown> {
	toolName: string;
	toolCallId: string;
	params: TParams;
	signal?: AbortSignal;
	onUpdate?: unknown;
}

export interface BeforeToolOutput<TParams = unknown> {
	params: TParams;
	signal?: AbortSignal;
	onUpdate?: unknown;
	result?: AgentToolResult<unknown>;
}

export interface AfterToolInput<TDetails = unknown> {
	toolName: string;
	toolCallId: string;
	params: unknown;
	result: AgentToolResult<TDetails>;
}

export interface BeforeReplyInput {
	message: AgentMessage;
}

export interface BeforeReplyOutput {
	message?: AgentMessage;
}

export interface AfterReplyInput {
	message: AgentMessage;
}

export interface AfterReplyOutput {
	message?: AgentMessage;
}

export interface RuntimePolicy {
	name: string;
	beforePromptBuild?: (
		context: RuntimePolicyContext,
		input: BeforePromptBuildInput,
	) =>
		| Promise<BeforePromptBuildOutput | void>
		| BeforePromptBuildOutput
		| void;
	beforePrompt?: (
		context: RuntimePolicyContext,
		input: BeforePromptInput,
	) => Promise<BeforePromptOutput | void> | BeforePromptOutput | void;
	beforeTool?: <TParams = unknown>(
		context: RuntimePolicyContext,
		input: BeforeToolInput<TParams>,
	) => Promise<BeforeToolOutput<TParams> | void> | BeforeToolOutput<TParams> | void;
	afterTool?: <TDetails = unknown>(
		context: RuntimePolicyContext,
		input: AfterToolInput<TDetails>,
	) => Promise<AgentToolResult<TDetails> | void> | AgentToolResult<TDetails> | void;
	beforeReply?: (
		context: RuntimePolicyContext,
		input: BeforeReplyInput,
	) => Promise<BeforeReplyOutput | void> | BeforeReplyOutput | void;
	afterReply?: (
		context: RuntimePolicyContext,
		input: AfterReplyInput,
	) => Promise<AfterReplyOutput | void> | AfterReplyOutput | void;
}

export interface RuntimePolicyPipelineOptions {
	context: RuntimePolicyContext;
	policies: RuntimePolicy[];
	onPolicyError?: (
		policyName: string,
		phase:
			| "beforePromptBuild"
			| "beforePrompt"
			| "beforeTool"
			| "afterTool"
			| "beforeReply"
			| "afterReply",
		error: unknown,
	) => void;
}

export class RuntimePolicyPipeline {
	private readonly context: RuntimePolicyContext;
	private readonly policies: RuntimePolicy[];
	private readonly onPolicyError?: RuntimePolicyPipelineOptions["onPolicyError"];

	constructor(options: RuntimePolicyPipelineOptions) {
		this.context = options.context;
		this.policies = options.policies;
		this.onPolicyError = options.onPolicyError;
	}

	getPolicyNames(): string[] {
		return this.policies.map((policy) => policy.name);
	}

	async runBeforePromptBuild(
		input: BeforePromptBuildInput,
	): Promise<BeforePromptBuildOutput> {
		let current: BeforePromptBuildOutput = {
			options: { ...input.options },
		};
		for (const policy of this.policies) {
			if (!policy.beforePromptBuild) continue;
			try {
				const next = await policy.beforePromptBuild(this.context, current);
				if (next?.options) {
					current = next;
				}
			} catch (error) {
				this.onPolicyError?.(policy.name, "beforePromptBuild", error);
			}
		}
		return current;
	}

	async runBeforePrompt(input: BeforePromptInput): Promise<BeforePromptOutput> {
		let current: BeforePromptOutput = { ...input };
		for (const policy of this.policies) {
			if (!policy.beforePrompt) continue;
			try {
				const next = await policy.beforePrompt(this.context, current);
				if (next && typeof next.text === "string") {
					current = next;
				}
			} catch (error) {
				this.onPolicyError?.(policy.name, "beforePrompt", error);
			}
		}
		return current;
	}

	async runBeforeTool<TParams = unknown>(
		input: BeforeToolInput<TParams>,
	): Promise<BeforeToolOutput<TParams>> {
		let current: BeforeToolOutput<TParams> = {
			params: input.params,
			signal: input.signal,
			onUpdate: input.onUpdate,
		};
		for (const policy of this.policies) {
			if (!policy.beforeTool) continue;
			if (current.result) {
				break;
			}
			try {
				const next = await policy.beforeTool<TParams>(this.context, {
					...input,
					params: current.params,
					signal: current.signal,
					onUpdate: current.onUpdate,
				});
				if (next && "params" in next) {
					current = {
						params: next.params,
						signal: next.signal ?? current.signal,
						onUpdate: next.onUpdate ?? current.onUpdate,
						result: next.result ?? current.result,
					};
				}
			} catch (error) {
				this.onPolicyError?.(policy.name, "beforeTool", error);
			}
		}
		return current;
	}

	async runAfterTool<TDetails = unknown>(
		input: AfterToolInput<TDetails>,
	): Promise<AgentToolResult<TDetails>> {
		let current = input.result;
		for (const policy of this.policies) {
			if (!policy.afterTool) continue;
			try {
				const next = await policy.afterTool<TDetails>(this.context, { ...input, result: current });
				if (next) {
					current = next;
				}
			} catch (error) {
				this.onPolicyError?.(policy.name, "afterTool", error);
			}
		}
		return current;
	}

	async runBeforeReply(input: BeforeReplyInput): Promise<BeforeReplyOutput> {
		let current: BeforeReplyOutput = { message: input.message };
		for (const policy of this.policies) {
			if (!policy.beforeReply) continue;
			try {
				const next = await policy.beforeReply(this.context, {
					message: current.message ?? input.message,
				});
				if (next?.message) {
					current = next;
				}
			} catch (error) {
				this.onPolicyError?.(policy.name, "beforeReply", error);
			}
		}
		return current;
	}

	async runAfterReply(input: AfterReplyInput): Promise<AfterReplyOutput> {
		let current: AfterReplyOutput = { message: input.message };
		for (const policy of this.policies) {
			if (!policy.afterReply) continue;
			try {
				const next = await policy.afterReply(this.context, {
					message: current.message ?? input.message,
				});
				if (next?.message) {
					current = next;
				}
			} catch (error) {
				this.onPolicyError?.(policy.name, "afterReply", error);
			}
		}
		return current;
	}
}

export function wrapToolsWithPolicyPipeline(
	tools: AgentTool<TSchema>[],
	pipeline: RuntimePolicyPipeline,
): AgentTool<TSchema>[] {
	return tools.map((tool) => {
		const wrapped: AgentTool<TSchema> = {
			...tool,
			execute: async (toolCallId, params, signal, onUpdate) => {
				const transformed = await pipeline.runBeforeTool({
					toolName: tool.name,
					toolCallId,
					params,
					signal,
					onUpdate,
				});
				if (transformed.result) {
					return transformed.result as any;
				}
				const result = await tool.execute(
					toolCallId,
					transformed.params as Static<TSchema>,
					(transformed.signal ?? signal) as AbortSignal,
					(transformed.onUpdate ?? onUpdate) as any,
				);
				return pipeline.runAfterTool({
					toolName: tool.name,
					toolCallId,
					params: transformed.params,
					result,
				});
			},
		};
		return wrapped;
	});
}
