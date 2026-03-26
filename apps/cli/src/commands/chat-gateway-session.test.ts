import { beforeEach, describe, expect, it, vi } from "vitest";

const wsMocks = vi.hoisted(() => {
	const webSocketCtor = vi.fn();
	let nextReadyState = 1;
	const sockets: MockWebSocket[] = [];

	class MockWebSocket {
		static readonly CONNECTING = 0;
		static readonly OPEN = 1;
		static readonly CLOSING = 2;
		static readonly CLOSED = 3;
		private readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>();
		readonly close = vi.fn(() => {
			this.readyState = MockWebSocket.CLOSED;
			for (const handler of this.closeHandlers) {
				handler();
			}
			this.closeHandlers = [];
		});
		readyState = MockWebSocket.OPEN;
		private closeHandlers: Array<() => void> = [];

		constructor(public readonly url: string) {
			this.readyState = nextReadyState;
			nextReadyState = MockWebSocket.OPEN;
			sockets.push(this);
			webSocketCtor(url);
		}

		on(event: string, handler: (...args: unknown[]) => void): this {
			const existing = this.handlers.get(event) ?? [];
			existing.push(handler);
			this.handlers.set(event, existing);
			return this;
		}

		once(event: string, handler: (...args: unknown[]) => void): this {
			if (event === "close") {
				this.closeHandlers.push(() => {
					handler();
				});
			}
			return this;
		}

		removeAllListeners(): this {
			this.closeHandlers = [];
			this.handlers.clear();
			return this;
		}

		emit(event: string, ...args: unknown[]): void {
			for (const handler of this.handlers.get(event) ?? []) {
				handler(...args);
			}
		}
	}

	return {
		webSocketCtor,
		MockWebSocket,
		sockets,
		setNextReadyState(value: number) {
			nextReadyState = value;
		},
	};
});

vi.mock("ws", () => ({
	default: wsMocks.MockWebSocket,
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
	SessionManager: {
		list: vi.fn(async () => []),
		listAll: vi.fn(async () => []),
		open: vi.fn(() => ({})),
	},
}));

import { SessionManager } from "@mariozechner/pi-coding-agent";
import { createGatewayBackedInteractiveSession } from "./chat-gateway-session.js";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function createBaseSession(overrides: Record<string, unknown> = {}) {
	return {
		agent: {
			state: {
				messages: [],
			},
		},
		sessionManager: {},
		model: {
			provider: "openai",
			id: "gpt-5",
		},
		thinkingLevel: "medium",
		...overrides,
	} as any;
}

function createClient(params: {
	sessionId: string;
	workspaceDir?: string;
	listedSessionIds?: string[];
	sendResult?: Record<string, unknown>;
	sendError?: Error;
}) {
	return {
		call: vi.fn(async (method: string, payload?: Record<string, unknown>) => {
			if (method === "session.create") {
				return { id: params.sessionId };
			}
			if (method === "session.history") {
				return { sessionId: params.sessionId, messages: [] };
			}
			if (method === "session.list") {
				return (params.listedSessionIds ?? [params.sessionId]).map((sessionId, index) => ({
					id: sessionId,
					workspaceDir: params.workspaceDir ?? "/tmp/workspace",
					createdAt: index + 1,
					lastActiveAt: index + 2,
				}));
			}
			if (method === "session.patch") {
				return {
					id: String(payload?.sessionId ?? params.sessionId),
					sessionName: payload?.sessionName,
				};
			}
			if (method === "session.send") {
				if (params.sendError) {
					throw params.sendError;
				}
				return {
					sessionId: params.sessionId,
					status: "ok",
					response: "",
					...params.sendResult,
				};
			}
			throw new Error(`unexpected RPC method: ${method}`);
		}),
	};
}

describe("createGatewayBackedInteractiveSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.UNDERSTUDY_GATEWAY_TOKEN;
		wsMocks.sockets.length = 0;
		wsMocks.setNextReadyState(wsMocks.MockWebSocket.OPEN);
	});

	it("waits for the gateway session id before opening the event stream", async () => {
		const sessionCreate = deferred<{ id: string }>();
		const client = {
			call: vi.fn(async (method: string) => {
				if (method === "session.create") {
					return await sessionCreate.promise;
				}
				if (method === "session.history") {
					return { sessionId: "gateway-session-1", messages: [] };
				}
				throw new Error(`unexpected RPC method: ${method}`);
			}),
		};

		const pendingSession = createGatewayBackedInteractiveSession({
			baseSession: {
				agent: {
					state: {
						messages: [],
					},
				},
				sessionManager: {},
			} as any,
			client: client as any,
			gatewayUrl: "https://gateway.example.com",
			gatewayToken: "secret-token",
			cwd: "/tmp/workspace",
			forceNew: true,
		});

		await Promise.resolve();
		expect(wsMocks.webSocketCtor).not.toHaveBeenCalled();

		sessionCreate.resolve({ id: "gateway-session-1" });
		await pendingSession;

		expect(wsMocks.webSocketCtor).toHaveBeenCalledWith(
			"https://gateway.example.com/?token=secret-token".replace("https://", "wss://"),
		);

		const session = await pendingSession;
		await session.close();
	});

	it("merges static config overrides into force-new gateway sessions", async () => {
		const client = createClient({ sessionId: "gateway-session-1" });

		const session = await createGatewayBackedInteractiveSession({
			baseSession: createBaseSession({
				model: {
					provider: "anthropic",
					id: "claude-sonnet-4",
				},
				thinkingLevel: "high",
			}),
			client: client as any,
			gatewayUrl: "https://gateway.example.com",
			cwd: "/tmp/workspace",
			forceNew: true,
			configOverride: {
				browser: {
					connectionMode: "managed",
				},
			} as any,
		});

		expect(client.call).toHaveBeenCalledWith("session.create", expect.objectContaining({
			configOverride: expect.objectContaining({
				browser: {
					connectionMode: "managed",
				},
				defaultProvider: "anthropic",
				defaultModel: "claude-sonnet-4",
				defaultThinkingLevel: "high",
			}),
		}));

		await session.close();
	});

	it("keeps SessionManager routing stable when gateway wrappers close out of order", async () => {
		const originalListAll = SessionManager.listAll;
		const firstClient = createClient({
			sessionId: "gateway-session-1",
			listedSessionIds: ["gateway-session-1"],
			workspaceDir: "/tmp/workspace-1",
		});
		const secondClient = createClient({
			sessionId: "gateway-session-2",
			listedSessionIds: ["gateway-session-2"],
			workspaceDir: "/tmp/workspace-2",
		});

		const firstSession = await createGatewayBackedInteractiveSession({
			baseSession: createBaseSession(),
			client: firstClient as any,
			gatewayUrl: "https://gateway-1.example.com",
			cwd: "/tmp/workspace-1",
			forceNew: true,
		});
		const secondSession = await createGatewayBackedInteractiveSession({
			baseSession: createBaseSession(),
			client: secondClient as any,
			gatewayUrl: "https://gateway-2.example.com",
			cwd: "/tmp/workspace-2",
			forceNew: true,
		});

		await expect(SessionManager.listAll()).resolves.toEqual([
			expect.objectContaining({ id: "gateway-session-2" }),
		]);
		const listCallsBeforeFirstClose = secondClient.call.mock.calls.filter(([method]) => method === "session.list").length;

		await firstSession.close();

		await expect(SessionManager.listAll()).resolves.toEqual([
			expect.objectContaining({ id: "gateway-session-2" }),
		]);
		expect(
			secondClient.call.mock.calls.filter(([method]) => method === "session.list").length,
		).toBe(listCallsBeforeFirstClose + 1);

		await secondSession.close();

		expect(SessionManager.listAll).toBe(originalListAll);
		await expect(SessionManager.listAll()).resolves.toEqual([]);
	});

	it("closes the gateway websocket even while it is still connecting", async () => {
		const client = createClient({ sessionId: "gateway-session-1" });
		wsMocks.setNextReadyState(wsMocks.MockWebSocket.CONNECTING);

		const session = await createGatewayBackedInteractiveSession({
			baseSession: createBaseSession(),
			client: client as any,
			gatewayUrl: "https://gateway.example.com",
			cwd: "/tmp/workspace",
			forceNew: true,
		});

		const socket = wsMocks.sockets.at(-1);
		await session.close();

		expect(socket?.close).toHaveBeenCalledTimes(1);
	});

	it("preserves the local failed turn when session.send throws before gateway history is updated", async () => {
		const client = createClient({
			sessionId: "gateway-session-1",
			sendError: new Error("send failed"),
		});
		const session = await createGatewayBackedInteractiveSession({
			baseSession: createBaseSession(),
			client: client as any,
			gatewayUrl: "https://gateway.example.com",
			cwd: "/tmp/workspace",
			forceNew: true,
		});

		await expect((session as any).prompt("hello gateway")).rejects.toThrow("send failed");

		expect(session.agent.state.messages).toEqual([
			expect.objectContaining({
				role: "user",
				content: [expect.objectContaining({ type: "text", text: "hello gateway" })],
			}),
		]);
		expect(client.call.mock.calls.filter(([method]) => method === "session.history")).toHaveLength(1);

		await session.close();
	});

	it("renders tool events before the final assistant message when the gateway produces tools first", async () => {
		const sendDeferred = deferred<Record<string, unknown>>();
		const client = {
			call: vi.fn(async (method: string) => {
				if (method === "session.create") {
					return { id: "gateway-session-1" };
				}
				if (method === "session.history") {
					return { sessionId: "gateway-session-1", messages: [] };
				}
				if (method === "session.send") {
					return await sendDeferred.promise;
				}
				throw new Error(`unexpected RPC method: ${method}`);
			}),
		};
		const session = await createGatewayBackedInteractiveSession({
			baseSession: createBaseSession(),
			client: client as any,
			gatewayUrl: "https://gateway.example.com",
			cwd: "/tmp/workspace",
			forceNew: true,
		});
		const events: string[] = [];
		(session as any).subscribe((event: Record<string, unknown>) => {
			const type = typeof event.type === "string" ? event.type : "unknown";
			if (type === "message_start" || type === "message_end") {
				const role = (event.message as { role?: string } | undefined)?.role ?? "unknown";
				events.push(`${type}:${role}`);
				return;
			}
			events.push(type);
		});

		const promptPromise = (session as any).prompt("delete saved messages");
		for (let attempt = 0; attempt < 10 && !events.includes("agent_start"); attempt += 1) {
			await Promise.resolve();
		}

		const socket = wsMocks.sockets.at(-1);
		expect(socket).toBeDefined();
		socket?.emit(
			"message",
			JSON.stringify({
				type: "tool_start",
				data: {
					sessionId: "gateway-session-1",
					toolCallId: "tool-1",
					toolName: "gui_observe",
					params: { app: "Telegram" },
				},
			}),
		);
		socket?.emit(
			"message",
			JSON.stringify({
				type: "tool_end",
				data: {
					sessionId: "gateway-session-1",
					toolCallId: "tool-1",
					toolName: "gui_observe",
					status: "ok",
					result: { content: [{ type: "text", text: "Captured Telegram." }] },
				},
			}),
		);
		socket?.emit(
			"message",
			JSON.stringify({
				type: "stream_end",
				data: {
					sessionId: "gateway-session-1",
					status: "ok",
					text: "Deleted Saved Messages.",
				},
			}),
		);

		sendDeferred.resolve({
			sessionId: "gateway-session-1",
			status: "ok",
			response: "Deleted Saved Messages.",
		});
		await promptPromise;

		expect(events).toEqual([
			"message_start:user",
			"message_end:user",
			"agent_start",
			"tool_execution_start",
			"tool_execution_end",
			"message_start:assistant",
			"message_end:assistant",
			"agent_end",
		]);

		await session.close();
	});
});
