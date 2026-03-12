import { describe, expect, it, vi } from "vitest";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import {
	RuntimePolicyPipeline,
	wrapToolsWithPolicyPipeline,
	type BeforeToolInput,
	type BeforeToolOutput,
	type RuntimePolicyContext,
	type RuntimePolicy,
} from "../runtime/policy-pipeline.js";
import { createDefaultRuntimePolicyRegistry } from "../runtime/policy-registry.js";
import { createRouteRetryGuardPolicy } from "../runtime/policies/route-guard-policy.js";

function makeContext() {
	return {
		runtimeProfile: "assistant" as const,
		modelLabel: "google/gemini-3-flash-preview",
		cwd: "/tmp/understudy",
		config: {} as any,
	};
}

describe("RuntimePolicyPipeline", () => {
	it("keeps input unchanged when no default beforePrompt policies are configured", async () => {
		const registry = createDefaultRuntimePolicyRegistry();
		const { policies } = await registry.build({ context: makeContext() });
		const pipeline = new RuntimePolicyPipeline({
			context: makeContext(),
			policies,
		});

		const rewritten = await pipeline.runBeforePrompt({ text: "who are you" });
		expect(rewritten.text).toBe("who are you");
	});

	it("allows beforePromptBuild policies to rewrite system prompt options", async () => {
		const pipeline = new RuntimePolicyPipeline({
			context: makeContext(),
			policies: [
				{
					name: "prompt-build",
					beforePromptBuild: async (_context, input) => ({
						options: {
							...input.options,
							extraSystemPrompt: "Injected prompt-build context",
						},
					}),
				},
			],
		});

		const result = await pipeline.runBeforePromptBuild({
			options: {
				toolNames: [],
			},
		});

		expect(result.options.extraSystemPrompt).toBe("Injected prompt-build context");
	});

	it("allows afterTool policies to modify tool results", async () => {
		const policy: RuntimePolicy = {
			name: "append-marker",
			afterTool: async (_context, input) => ({
				...input.result,
				content: [
					...(input.result.content ?? []),
					{ type: "text" as const, text: "[after-tool-policy]" },
				],
			}),
		};
		const pipeline = new RuntimePolicyPipeline({
			context: makeContext(),
			policies: [policy],
		});

		const result = await pipeline.runAfterTool({
			toolName: "web_search",
			toolCallId: "tc1",
			params: { query: "beijing weather" },
			result: {
				content: [{ type: "text", text: "ok" }],
				details: {},
			},
		});
		const text = result.content
			.filter((item: any) => item.type === "text")
			.map((item: any) => item.text)
			.join("\n");
		expect(text).toContain("ok");
		expect(text).toContain("[after-tool-policy]");
	});

	it("allows beforeTool policies to rewrite tool params before execution", async () => {
		const policy: RuntimePolicy = {
			name: "rewrite-query",
			beforeTool: async <TParams = unknown>(
				_context: RuntimePolicyContext,
				input: BeforeToolInput<TParams>,
			): Promise<BeforeToolOutput<TParams>> => {
				const nextParams = {
					...(input.params as Record<string, unknown>),
					query: "rewritten query",
				};
				return {
					params: nextParams as unknown as TParams,
					signal: input.signal,
					onUpdate: input.onUpdate,
				};
			},
		};
		const pipeline = new RuntimePolicyPipeline({
			context: makeContext(),
			policies: [policy],
		});
		const tool: AgentTool<any> = {
			name: "web_search",
			label: "Web Search",
			description: "Searches the web",
			parameters: Type.Object({ query: Type.String() }),
			execute: vi.fn(async (_toolCallId, params: any) => ({
				content: [{ type: "text" as const, text: params.query }],
				details: { query: params.query },
			})),
		};

		const [wrapped] = wrapToolsWithPolicyPipeline([tool], pipeline);
		const result = await wrapped.execute("call1", { query: "original query" });

		expect(tool.execute).toHaveBeenCalledTimes(1);
		expect((result.details as any).query).toBe("rewritten query");
	});

	it("allows beforeTool policies to short-circuit tool execution", async () => {
		const tool: AgentTool<any> = {
			name: "web_fetch",
			label: "Web Fetch",
			description: "Fetch a URL",
			parameters: Type.Object({ url: Type.String() }),
			execute: vi.fn(async () => ({
				content: [{ type: "text" as const, text: "should not run" }],
				details: {},
			})),
		};
		const pipeline = new RuntimePolicyPipeline({
			context: makeContext(),
			policies: [
				{
					name: "short-circuit",
					beforeTool: async <TParams = unknown>(
						_context: RuntimePolicyContext,
						input: BeforeToolInput<TParams>,
					): Promise<BeforeToolOutput<TParams>> => ({
						params: input.params,
						result: {
							content: [{ type: "text" as const, text: "blocked by policy" }],
								details: { status: { code: "blocked", summary: "blocked by policy" } },
						},
					}),
				},
			],
		});

		const [wrapped] = wrapToolsWithPolicyPipeline([tool], pipeline);
		const result = await wrapped.execute("call-short", { url: "https://example.com" });

		expect(tool.execute).not.toHaveBeenCalled();
		expect((result.content[0] as any).text).toBe("blocked by policy");
	});

	it("runs beforeReply policies in order", async () => {
		const p1: RuntimePolicy = {
			name: "tag-1",
			beforeReply: (_context, input) => ({
				message: {
					...input.message,
					content: [{ type: "text", text: "first" }],
				} as any,
			}),
		};
		const p2: RuntimePolicy = {
			name: "tag-2",
			beforeReply: (_context, input) => ({
				message: {
					...input.message,
					content: [{ type: "text", text: "second" }],
				} as any,
			}),
		};
		const pipeline = new RuntimePolicyPipeline({
			context: makeContext(),
			policies: [p1, p2],
		});

		const result = await pipeline.runBeforeReply({
			message: {
				role: "assistant",
				content: [{ type: "text", text: "raw" }],
			} as any,
		});
		expect((result.message as any).content[0].text).toBe("second");
	});

	it("runs afterReply policies in order", async () => {
		const p1: RuntimePolicy = {
			name: "after-1",
			afterReply: (_context, input) => ({
				message: {
					...input.message,
					content: [{ type: "text", text: "after-first" }],
				} as any,
			}),
		};
		const p2: RuntimePolicy = {
			name: "after-2",
			afterReply: (_context, input) => ({
				message: {
					...input.message,
					content: [{ type: "text", text: "after-second" }],
				} as any,
			}),
		};
		const pipeline = new RuntimePolicyPipeline({
			context: makeContext(),
			policies: [p1, p2],
		});

		const result = await pipeline.runAfterReply({
			message: {
				role: "assistant",
				content: [{ type: "text", text: "raw" }],
			} as any,
		});
		expect((result.message as any).content[0].text).toBe("after-second");
	});
});

describe("wrapToolsWithPolicyPipeline", () => {
	it("passes tool execution through pipeline afterTool hook", async () => {
		const afterTool = vi.fn(async (_context, input) => ({
			...input.result,
			details: { ...(input.result.details as any), wrapped: true },
		}));
		const pipeline = new RuntimePolicyPipeline({
			context: makeContext(),
			policies: [{ name: "after-tool", afterTool }],
		});
		const tool: AgentTool<any> = {
			name: "demo_tool",
			label: "Demo",
			description: "Demo tool",
			parameters: Type.Object({}),
			execute: vi.fn(async () => ({
				content: [{ type: "text" as const, text: "ok" }],
				details: {},
			})),
		};

		const [wrapped] = wrapToolsWithPolicyPipeline([tool], pipeline);
		const result = await wrapped.execute("call1", {});

		expect(tool.execute).toHaveBeenCalledTimes(1);
		expect(afterTool).toHaveBeenCalledTimes(1);
		expect((result.details as any).wrapped).toBe(true);
	});

	it("surfaces repeated route failures in prompt context without hard-blocking execution", async () => {
		const pipeline = new RuntimePolicyPipeline({
			context: makeContext(),
			policies: [createRouteRetryGuardPolicy()],
		});
		const tool: AgentTool<any> = {
			name: "web_fetch",
			label: "Web Fetch",
			description: "Fetch a URL",
			parameters: Type.Object({ url: Type.String() }),
			execute: vi.fn(async () => ({
				content: [{ type: "text" as const, text: "401 unauthorized" }],
					details: {
						error: "401 unauthorized",
						status: {
							code: "blocked",
							summary: "401 unauthorized",
						},
					},
			})),
		};

		const [wrapped] = wrapToolsWithPolicyPipeline([tool], pipeline);
		const firstPrompt = await pipeline.runBeforePrompt({ text: "first turn" });
		expect(firstPrompt.text).toBe("first turn");
			await wrapped.execute("call-1", { url: "https://example.com/a" });
			await wrapped.execute("call-2", { url: "https://example.com/b" });
			const third = await wrapped.execute("call-3", { url: "https://example.com/c" });

		expect(tool.execute).toHaveBeenCalledTimes(3);
		expect((third.content[0] as any).text).toContain("401 unauthorized");

			const guardedPrompt = await pipeline.runBeforePrompt({ text: "second turn" });
			expect(guardedPrompt.text).toContain("[Understudy runtime route guard]");
			expect(guardedPrompt.text).toContain("web");
			expect(guardedPrompt.text).toContain("3 consecutive failure(s)");
			expect(guardedPrompt.text).toContain("url=https://example.com/c");

			await wrapped.execute("call-4", { url: "https://example.com/d" });
			expect(tool.execute).toHaveBeenCalledTimes(4);
		});

});
