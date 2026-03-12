import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
	createAgentSession: vi.fn(),
	prompt: vi.fn(),
	setSystemPrompt: vi.fn(),
	subscribeImpl: vi.fn(),
	disposeImpl: vi.fn(),
}));

vi.mock("@mariozechner/pi-coding-agent", async () => {
	const actual = await vi.importActual<any>("@mariozechner/pi-coding-agent");
	return {
		...actual,
		createAgentSession: mocks.createAgentSession,
	};
});

import { EmbeddedRuntimeAdapter } from "../runtime/adapters/embedded.js";
import { AcpRuntimeAdapter } from "../runtime/adapters/acp.js";
import { clearAllAcpRuntimeBackends, registerAcpRuntimeBackend } from "../runtime/acp/registry.js";

function makeSessionResult() {
	const unsubscribe = vi.fn();
	const session = {
		__subscribeCalledWithSelf: false,
		__disposeCalledWithSelf: false,
		prompt: mocks.prompt,
		subscribe(this: any, listener: unknown) {
			this.__subscribeCalledWithSelf = true;
			mocks.subscribeImpl(listener);
			return unsubscribe;
		},
		dispose(this: any) {
			this.__disposeCalledWithSelf = true;
			mocks.disposeImpl();
		},
		agent: {
			setSystemPrompt: mocks.setSystemPrompt,
			state: { messages: [] },
		},
	};
	return {
		session,
		extensionsResult: {},
	};
}

describe("runtime adapters lifecycle interface", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createAgentSession.mockResolvedValue(makeSessionResult());
		clearAllAcpRuntimeBackends();
	});

	it("embedded adapter returns runtimeSession lifecycle handle", async () => {
		const adapter = new EmbeddedRuntimeAdapter();
		const result = await adapter.createSession({
			cwd: "/tmp/understudy",
			customTools: [],
		});

		const listener = vi.fn();
		await adapter.prompt(result.session as any, "hello from embedded", { mode: "steer" } as any);
		adapter.setSystemPrompt(result.session as any, "You are embedded.");
		const unsubscribeViaAdapter = adapter.onEvent(result.session as any, listener);
		expect(typeof unsubscribeViaAdapter).toBe("function");
		expect(adapter.getMessages(result.session as any)).toEqual([]);
		await adapter.closeSession(result.session as any);

		await result.runtimeSession.prompt("hello from runtime session");
		result.runtimeSession.setSystemPrompt("You are runtime session.");
		const unsubscribe = result.runtimeSession.onEvent(listener);
		expect(typeof unsubscribe).toBe("function");
		await result.runtimeSession.close();

		expect(result.runtimeSession.session).toBeDefined();
		expect(mocks.createAgentSession).toHaveBeenCalledTimes(1);
		const args = mocks.createAgentSession.mock.calls[0][0] as any;
		expect(args.tools).toEqual([]);
		expect(mocks.prompt).toHaveBeenCalledWith("hello from embedded", { mode: "steer" });
		expect(mocks.prompt).toHaveBeenCalledWith("hello from runtime session", undefined);
		expect(mocks.setSystemPrompt).toHaveBeenCalledWith("You are embedded.");
		expect(mocks.setSystemPrompt).toHaveBeenCalledWith("You are runtime session.");
		expect(mocks.subscribeImpl).toHaveBeenCalledTimes(2);
		expect(mocks.disposeImpl).toHaveBeenCalledTimes(2);
	});

	it("acp adapter emits streamed events, supports steer mode, and closes via the backend handle", async () => {
		const ensureSession = vi.fn(async ({ sessionKey, cwd }) => ({
			sessionKey,
			backend: "mock-acp",
			runtimeSessionName: sessionKey,
			cwd,
		}));
		const cancel = vi.fn(async () => {});
		const close = vi.fn(async () => {});
		registerAcpRuntimeBackend({
			id: "mock-acp",
			runtime: {
				ensureSession,
				async *runTurn(input) {
					yield { type: "status" as const, text: `mode:${input.mode}` };
					yield { type: "text_delta" as const, text: `acp:${input.text}` };
					yield { type: "tool_call" as const, text: "browser.open", toolCallId: "tool-1", status: "running" };
					yield { type: "done" as const, text: `final:${input.text}` };
				},
				cancel,
				close,
			},
		});

		const adapter = new AcpRuntimeAdapter();
		const result = await adapter.createSession({
			cwd: "/tmp/understudy",
			customTools: [],
			acpConfig: { backend: "mock-acp" },
		});

		const events: any[] = [];
		const unsubscribe = result.runtimeSession.onEvent((event) => {
			events.push(event);
		});
		await result.runtimeSession.prompt("hello from acp", { mode: "steer" } as any);
		const messages = result.runtimeSession.getMessages();
		unsubscribe();
		await result.runtimeSession.close();

		expect(ensureSession).toHaveBeenCalledOnce();
		expect(messages).toHaveLength(2);
		expect((messages[0] as any).content?.[0]?.text).toBe("hello from acp");
		expect((messages[1] as any).content?.[0]?.text).toBe("acp:hello from acp");
		expect(events).toEqual(expect.arrayContaining([
			expect.objectContaining({ type: "message_start" }),
			expect.objectContaining({ type: "status", text: "mode:steer" }),
			expect.objectContaining({ type: "message_chunk", text: "acp:hello from acp" }),
			expect.objectContaining({ type: "tool_call", text: "browser.open", toolCallId: "tool-1", status: "running" }),
			expect.objectContaining({ type: "message_end" }),
		]));
		expect(close).toHaveBeenCalledOnce();
		expect(cancel).not.toHaveBeenCalled();
	});
});
