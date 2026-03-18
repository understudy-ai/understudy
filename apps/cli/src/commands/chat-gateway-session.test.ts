import { beforeEach, describe, expect, it, vi } from "vitest";

const wsMocks = vi.hoisted(() => {
	const webSocketCtor = vi.fn();

	class MockWebSocket {
		static readonly OPEN = 1;
		readonly readyState = MockWebSocket.OPEN;

		constructor(public readonly url: string) {
			webSocketCtor(url);
		}

		on(_event: string, _handler: (...args: unknown[]) => void): this {
			return this;
		}

		once(_event: string, _handler: (...args: unknown[]) => void): this {
			return this;
		}

		removeAllListeners(): this {
			return this;
		}

		close(): void {}
	}

	return {
		webSocketCtor,
		MockWebSocket,
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

describe("createGatewayBackedInteractiveSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.UNDERSTUDY_GATEWAY_TOKEN;
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
	});
});
