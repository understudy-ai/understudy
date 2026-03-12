import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { GatewayServer } from "../../packages/gateway/src/server.js";

function gatewayPort(gateway: GatewayServer): number {
	const address = (gateway as any).server?.address();
	if (!address || typeof address === "string") {
		throw new Error("Gateway server is not listening on a TCP port");
	}
	return address.port;
}

async function waitForSocketOpen(ws: WebSocket): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error("ws connect timeout")), 5000);
		const cleanup = () => {
			clearTimeout(timeout);
			ws.off("open", onOpen);
			ws.off("error", onError);
		};
		const onOpen = () => {
			cleanup();
			resolve();
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		ws.on("open", onOpen);
		ws.on("error", onError);
	});
}

async function waitForJsonMessage(
	ws: WebSocket,
	predicate: (payload: any) => boolean,
	timeoutMs = 7000,
): Promise<any> {
	return await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error("gateway websocket timeout"));
		}, timeoutMs);
		const cleanup = () => {
			clearTimeout(timeout);
			ws.off("message", onMessage);
			ws.off("error", onError);
		};
		const onMessage = (raw: WebSocket.RawData) => {
			try {
				const payload = JSON.parse(String(raw));
				if (predicate(payload)) {
					cleanup();
					resolve(payload);
				}
			} catch {
				// Ignore malformed frames and unrelated payloads.
			}
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		ws.on("message", onMessage);
		ws.on("error", onError);
	});
}

describe("e2e: webchat -> gateway websocket -> agent -> webchat", () => {
	let gateway: GatewayServer | null = null;

	afterEach(async () => {
		if (gateway) {
			await gateway.stop();
			gateway = null;
		}
	});

	it("round-trips a live webchat stream on the main gateway websocket", async () => {
		gateway = new GatewayServer({ port: 0, host: "127.0.0.1" });
		gateway.setChatHandler(async (text, context) => {
			const runId = "run-e2e-webchat";
			setTimeout(() => {
				const timestamp = Date.now();
				gateway?.broadcastEvent({
					type: "stream_start",
					data: {
						channelId: context?.channelId ?? "webchat",
						senderId: context?.senderId ?? "browser-e2e",
						runId,
					},
					timestamp,
				});
				gateway?.broadcastEvent({
					type: "stream_chunk",
					data: {
						channelId: context?.channelId ?? "webchat",
						senderId: context?.senderId ?? "browser-e2e",
						runId,
						text: `E2E Echo: ${text}`,
					},
					timestamp: timestamp + 1,
				});
				gateway?.broadcastEvent({
					type: "stream_end",
					data: {
						channelId: context?.channelId ?? "webchat",
						senderId: context?.senderId ?? "browser-e2e",
						runId,
						text: `E2E Echo: ${text}`,
					},
					timestamp: timestamp + 2,
				});
			}, 20);
			return {
				response: "",
				runId,
				status: "in_flight",
			};
		});
		await gateway.start();
		const port = gatewayPort(gateway);
		const ws = new WebSocket(`ws://127.0.0.1:${port}`);
		await waitForSocketOpen(ws);

		const rpcResponsePromise = waitForJsonMessage(
			ws,
			(payload) => payload && payload.id === "chat_stream_1",
		);
		const streamStartPromise = waitForJsonMessage(
			ws,
			(payload) => payload && payload.type === "stream_start" && payload.data?.runId === "run-e2e-webchat",
		);
		const streamChunkPromise = waitForJsonMessage(
			ws,
			(payload) => payload && payload.type === "stream_chunk" && payload.data?.runId === "run-e2e-webchat",
		);
		const streamEndPromise = waitForJsonMessage(
			ws,
			(payload) => payload && payload.type === "stream_end" && payload.data?.runId === "run-e2e-webchat",
		);

		ws.send(JSON.stringify({
			id: "chat_stream_1",
			method: "chat.stream",
			params: {
				text: "ping from e2e",
				channelId: "webchat",
				senderId: "browser-e2e",
				waitForCompletion: false,
			},
		}));

		const rpcResponse = await rpcResponsePromise;
		expect(rpcResponse.result).toMatchObject({
			runId: "run-e2e-webchat",
			status: "in_flight",
		});

		const streamStart = await streamStartPromise;
		expect(streamStart.data).toMatchObject({
			channelId: "webchat",
			senderId: "browser-e2e",
			runId: "run-e2e-webchat",
		});

		const streamChunk = await streamChunkPromise;
		expect(streamChunk.data).toMatchObject({
			channelId: "webchat",
			senderId: "browser-e2e",
			runId: "run-e2e-webchat",
			text: "E2E Echo: ping from e2e",
		});

		const streamEnd = await streamEndPromise;
		expect(streamEnd.data).toMatchObject({
			channelId: "webchat",
			senderId: "browser-e2e",
			runId: "run-e2e-webchat",
			text: "E2E Echo: ping from e2e",
		});
		expect(streamStart.timestamp).toBeLessThan(streamChunk.timestamp);
		expect(streamChunk.timestamp).toBeLessThan(streamEnd.timestamp);

		ws.close();
	}, 15000);
});
