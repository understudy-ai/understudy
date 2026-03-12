import { afterEach, describe, expect, it, vi } from "vitest";
import { Type } from "@sinclair/typebox";
import type { RuntimeAdapter } from "../runtime/types.js";
import { createUnderstudySessionWithRuntime } from "../runtime/orchestrator.js";
import type { RuntimePolicy } from "../runtime/policy-pipeline.js";

const originalUnderstudyHome = process.env.UNDERSTUDY_HOME;

afterEach(() => {
	if (originalUnderstudyHome === undefined) {
		delete process.env.UNDERSTUDY_HOME;
	} else {
		process.env.UNDERSTUDY_HOME = originalUnderstudyHome;
	}
});

describe("orchestrator policy pipeline integration", () => {
	it("applies beforePrompt, beforeReply and afterReply hooks via runtime policy pipeline", async () => {
		const listeners = new Set<(event: any) => void>();
		const basePrompt = vi.fn(async (_text: string) => {
			const assistantMessage = {
				role: "assistant",
				content: [{ type: "text", text: "raw reply" }],
			} as any;
			session.agent.state.messages.push(assistantMessage);
			for (const listener of listeners) {
				listener({ type: "message_end", message: assistantMessage });
			}
		});

		const session: any = {
			agent: {
				setSystemPrompt: vi.fn(),
				state: { messages: [] as any[] },
			},
			prompt: basePrompt,
			subscribe: (listener: (event: any) => void) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			dispose: vi.fn(),
		};

		const adapter: RuntimeAdapter = {
			name: "embedded",
			prompt: async (sessionArg, text, options) => sessionArg.prompt(text, options),
			setSystemPrompt: (sessionArg, prompt) => sessionArg.agent.setSystemPrompt(prompt),
			getMessages: (sessionArg) => sessionArg.agent.state.messages,
			onEvent: (sessionArg, listener) =>
				typeof sessionArg.subscribe === "function"
					? sessionArg.subscribe(listener)
					: () => {},
			closeSession: async (sessionArg) => {
				sessionArg.dispose?.();
			},
			createSession: vi.fn(async () => ({
				session,
				runtimeSession: {
					session,
					prompt: async (text: string, options?: any) => session.prompt(text, options),
					setSystemPrompt: (prompt: string) => session.agent.setSystemPrompt(prompt),
					getMessages: () => session.agent.state.messages,
					onEvent: (listener: (event: any) => void) => {
						listeners.add(listener);
						return () => listeners.delete(listener);
					},
					close: async () => session.dispose(),
				},
				extensionsResult: {},
			})),
		};
		const afterReplyHook = vi.fn((_context, input) => ({
			message: {
				...input.message,
				content: [{ type: "text", text: "after policy reply" }],
			} as any,
		}));

		const customPolicy: RuntimePolicy = {
			name: "test-policy",
			beforePromptBuild: (_context, input) => ({
				options: {
					...input.options,
					extraSystemPrompt: "policy-built system prompt context",
				},
			}),
			beforePrompt: (_context, input) => ({
				...input,
				text: `POLICY:${input.text}`,
			}),
			beforeReply: (_context, input) => ({
				message: {
					...input.message,
					content: [{ type: "text", text: "policy reply" }],
				} as any,
			}),
			afterReply: afterReplyHook,
		};

		const result = await createUnderstudySessionWithRuntime(adapter, {
			config: {
				defaultProvider: "google",
				defaultModel: "gemini-3-flash-preview",
			},
			runtimePolicies: [customPolicy],
		});

		expect(session.agent.setSystemPrompt).toHaveBeenCalledWith(
			expect.stringContaining("policy-built system prompt context"),
		);
		await result.session.prompt("hello", { source: "unit-test" });

		expect(basePrompt.mock.calls[0]).toEqual(["POLICY:hello", { source: "unit-test" }]);
		await vi.waitFor(() => {
			const lastMessage = result.session.agent.state.messages[result.session.agent.state.messages.length - 1] as any;
			expect(lastMessage.content[0].text).toBe("after policy reply");
			expect(afterReplyHook).toHaveBeenCalledTimes(1);
		});
		expect(result.extensionsResult).toEqual({});
	});

	it("emits lifecycle hooks for prompt build, reply, and close events", async () => {
		const listeners = new Set<(event: any) => void>();
		const basePrompt = vi.fn(async (_text: string) => {
			const assistantMessage = {
				role: "assistant",
				content: [{ type: "text", text: "hooked reply" }],
			} as any;
			session.agent.state.messages.push(assistantMessage);
			for (const listener of listeners) {
				listener({ type: "message_end", message: assistantMessage });
			}
		});

		const session: any = {
			agent: {
				setSystemPrompt: vi.fn(),
				state: { messages: [] as any[] },
			},
			prompt: basePrompt,
			subscribe: (listener: (event: any) => void) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			dispose: vi.fn(),
		};
		const adapter: RuntimeAdapter = {
			name: "embedded",
			prompt: async (sessionArg, text, options) => sessionArg.prompt(text, options),
			setSystemPrompt: (sessionArg, prompt) => sessionArg.agent.setSystemPrompt(prompt),
			getMessages: (sessionArg) => sessionArg.agent.state.messages,
			onEvent: (sessionArg, listener) =>
				typeof sessionArg.subscribe === "function"
					? sessionArg.subscribe(listener)
					: () => {},
			closeSession: async (sessionArg) => {
				sessionArg.dispose?.();
			},
			createSession: vi.fn(async () => ({
				session,
				runtimeSession: {
					session,
					prompt: async (text: string, options?: any) => session.prompt(text, options),
					setSystemPrompt: (prompt: string) => session.agent.setSystemPrompt(prompt),
					getMessages: () => session.agent.state.messages,
					onEvent: (listener: (event: any) => void) => {
						listeners.add(listener);
						return () => listeners.delete(listener);
					},
					close: async () => session.dispose(),
				},
				extensionsResult: {},
			})),
		};
		const onPromptBuilt = vi.fn();
		const onSessionCreated = vi.fn();
		const onAssistantReply = vi.fn();
		const onSessionClosed = vi.fn();

		const result = await createUnderstudySessionWithRuntime(adapter, {
			config: {
				defaultProvider: "google",
				defaultModel: "gemini-3-flash-preview",
			},
			lifecycleHooks: {
				onPromptBuilt,
				onSessionCreated,
				onAssistantReply,
				onSessionClosed,
			},
		});

		expect(onPromptBuilt).toHaveBeenCalledTimes(1);
		expect(onSessionCreated).toHaveBeenCalledTimes(1);
		expect(onPromptBuilt.mock.calls[0][0].sessionMeta.backend).toBe("embedded");

		await result.session.prompt("hello");
		await vi.waitFor(() => {
			expect(onAssistantReply).toHaveBeenCalledTimes(1);
			expect(onAssistantReply.mock.calls[0][0].message.content[0].text).toBe("hooked reply");
		});

		await result.runtimeSession.close();
		expect(onSessionClosed).toHaveBeenCalledTimes(1);
	});

	it("emits tool execution lifecycle events through the traced runtime wrappers", async () => {
		const listeners = new Set<(event: any) => void>();
		let customTools: any[] = [];
		const basePrompt = vi.fn(async (_text: string) => {
			const guiClickTool = customTools.find((tool) => tool.name === "gui_click");
			await guiClickTool?.execute("tool-call-1", { target: "Send button" }, new AbortController().signal);
			const assistantMessage = {
				role: "assistant",
				content: [{ type: "text", text: "tool reply" }],
			} as any;
			session.agent.state.messages.push(assistantMessage);
			for (const listener of listeners) {
				listener({ type: "message_end", message: assistantMessage });
			}
		});

		const session: any = {
			agent: {
				setSystemPrompt: vi.fn(),
				state: { messages: [] as any[] },
			},
			prompt: basePrompt,
			subscribe: (listener: (event: any) => void) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			dispose: vi.fn(),
		};

		const adapter: RuntimeAdapter = {
			name: "embedded",
			prompt: async (sessionArg, text, options) => sessionArg.prompt(text, options),
			setSystemPrompt: (sessionArg, prompt) => sessionArg.agent.setSystemPrompt(prompt),
			getMessages: (sessionArg) => sessionArg.agent.state.messages,
			onEvent: (sessionArg, listener) =>
				typeof sessionArg.subscribe === "function"
					? sessionArg.subscribe(listener)
					: () => {},
			closeSession: async (sessionArg) => {
				sessionArg.dispose?.();
			},
			createSession: vi.fn(async (options: any) => {
				customTools = options.customTools ?? [];
				return {
					session,
					runtimeSession: {
						session,
						prompt: async (text: string, options?: any) => session.prompt(text, options),
						setSystemPrompt: (prompt: string) => session.agent.setSystemPrompt(prompt),
						getMessages: () => session.agent.state.messages,
						onEvent: (listener: (event: any) => void) => {
							listeners.add(listener);
							return () => listeners.delete(listener);
						},
						close: async () => session.dispose(),
					},
					extensionsResult: {},
				};
			}),
		};

		const onToolEvent = vi.fn();
		const result = await createUnderstudySessionWithRuntime(adapter, {
			config: {
				defaultProvider: "google",
				defaultModel: "gemini-3-flash-preview",
			},
			extraTools: [
				{
					name: "gui_click",
					label: "GUI Click",
					description: "Click a GUI target",
					parameters: Type.Object({ target: Type.String() }),
					execute: vi.fn(async () => ({
						content: [{ type: "text" as const, text: "Clicked Send button" }],
						details: {
							grounding_method: "grounding",
							confidence: 0.91,
							status: {
								code: "action_sent",
								summary: "Triggered Send button",
							},
						},
					})),
				},
			],
			lifecycleHooks: {
				onToolEvent,
			},
		});

		await result.session.prompt("hello");

		await vi.waitFor(() => {
			expect(onToolEvent).toHaveBeenCalledTimes(2);
			expect(onToolEvent.mock.calls[0][0]).toMatchObject({
				phase: "start",
				toolName: "gui_click",
				route: "gui",
			});
			expect(onToolEvent.mock.calls[1][0]).toMatchObject({
				phase: "finish",
				toolName: "gui_click",
				route: "gui",
				result: {
					confidence: 0.91,
					groundingMethod: "grounding",
				},
			});
		});
	});

});
