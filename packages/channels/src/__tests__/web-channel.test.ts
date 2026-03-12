import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "node:net";
import { WebChannel } from "../web/web-channel.js";
import WebSocket from "ws";

async function getFreePort(): Promise<number> {
	return await new Promise<number>((resolve, reject) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("Failed to get free port"));
				return;
			}
			const port = address.port;
			server.close(() => resolve(port));
		});
		server.on("error", reject);
	});
}

describe("WebChannel", () => {
	let channel: WebChannel | null = null;

	afterEach(async () => {
		if (channel) {
			await channel.stop();
			channel = null;
		}
	});

	it("starts and stops WebSocket server", async () => {
		const port = await getFreePort();
		channel = new WebChannel({ port });
		await channel.start();
		await channel.stop();
		channel = null;
	});

	it("has correct metadata", async () => {
		const port = await getFreePort();
		channel = new WebChannel({ port });
		expect(channel.id).toBe("web");
		expect(channel.name).toBe("WebSocket");
		expect(channel.capabilities.streaming).toBe(true);
	});

	it("does not expose legacy control-message actions", async () => {
		const port = await getFreePort();
		channel = new WebChannel({ port });
		expect(channel.messaging.editMessage).toBeUndefined();
		expect(channel.messaging.deleteMessage).toBeUndefined();
		expect(channel.messaging.reactToMessage).toBeUndefined();
	});

	it("accepts WebSocket connections and receives messages", async () => {
		const port = await getFreePort();
		channel = new WebChannel({ port });
		await channel.start();

		const receivedMessages: any[] = [];
		channel.messaging.onMessage((msg) => receivedMessages.push(msg));

		const client = new WebSocket(`ws://127.0.0.1:${port}`);

		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("Connect timeout")), 5000);
			client.on("open", () => {
				client.once("message", () => {
					clearTimeout(timeout);
					resolve();
				});
			});
			client.on("error", (err) => {
				clearTimeout(timeout);
				reject(err);
			});
		});

		client.send(JSON.stringify({
			type: "message",
			channelId: "web",
			text: "Hello from test",
		}));

		await new Promise<void>((resolve) => setTimeout(resolve, 200));

		expect(receivedMessages).toHaveLength(1);
		expect(receivedMessages[0].text).toBe("Hello from test");
		expect(receivedMessages[0].channelId).toBe("web");

		client.close();
		await new Promise<void>((resolve) => setTimeout(resolve, 100));
	}, 10000);

	it("reuses a caller-provided stable browser client id", async () => {
		const port = await getFreePort();
		channel = new WebChannel({ port });
		await channel.start();

		const receivedMessages: any[] = [];
		channel.messaging.onMessage((msg) => receivedMessages.push(msg));

		const client = new WebSocket(`ws://127.0.0.1:${port}?clientId=browser_client_1`);
		let ackId = "";

		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("Connect timeout")), 5000);
			client.on("message", (raw) => {
				try {
					const message = JSON.parse(raw.toString());
					if (message.type === "ack") {
						ackId = message.id;
						clearTimeout(timeout);
						resolve();
					}
				} catch {
					// ignore
				}
			});
			client.on("error", (err) => {
				clearTimeout(timeout);
				reject(err);
			});
		});

		client.send(JSON.stringify({
			type: "message",
			channelId: "web",
			text: "hello from a stable client",
		}));

		await new Promise<void>((resolve) => setTimeout(resolve, 200));

		expect(ackId).toBe("browser_client_1");
		expect(receivedMessages[0]?.senderId).toBe("browser_client_1");

		client.close();
		await new Promise<void>((resolve) => setTimeout(resolve, 100));
	}, 10000);

	it("normalizes inbound attachment messages the same way as other channels", async () => {
		const port = await getFreePort();
		channel = new WebChannel({ port });
		await channel.start();

		const receivedMessages: any[] = [];
		channel.messaging.onMessage((msg) => receivedMessages.push(msg));

		const client = new WebSocket(`ws://127.0.0.1:${port}`);

		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("Connect timeout")), 5000);
			client.on("open", () => {
				client.once("message", () => {
					clearTimeout(timeout);
					resolve();
				});
			});
			client.on("error", (err) => {
				clearTimeout(timeout);
				reject(err);
			});
		});

		client.send(JSON.stringify({
			type: "message",
			channelId: "web",
			text: "/review this screenshot",
			attachments: [{ type: "image", url: "/tmp/error.png", name: "error.png" }],
		}));

		await new Promise<void>((resolve) => setTimeout(resolve, 200));

		expect(receivedMessages).toHaveLength(1);
		expect(receivedMessages[0].text).toContain("/review this screenshot");
		expect(receivedMessages[0].text).toContain("[Image message]");
		expect(receivedMessages[0].text).toContain("Attachments: error.png");
		expect(receivedMessages[0].attachments).toEqual([
			{ type: "image", url: "/tmp/error.png", name: "error.png" },
		]);

		client.close();
		await new Promise<void>((resolve) => setTimeout(resolve, 100));
	}, 10000);

	it("sends outbound messages to a specific recipient", async () => {
		const port = await getFreePort();
		channel = new WebChannel({ port });
		await channel.start();

		const client = new WebSocket(`ws://127.0.0.1:${port}`);
		let clientId = "";

		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("Connect timeout")), 5000);
			client.on("message", (raw) => {
				try {
					const message = JSON.parse(raw.toString());
					if (message.type === "ack") {
						clientId = message.id;
						clearTimeout(timeout);
						resolve();
					}
				} catch {
					// ignore
				}
			});
			client.on("error", (err) => {
				clearTimeout(timeout);
				reject(err);
			});
		});

		const received = new Promise<any>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("Message timeout")), 5000);
			client.on("message", (raw) => {
				try {
					const message = JSON.parse(raw.toString());
					if (message.type === "message" && message.text === "hi recipient") {
						clearTimeout(timeout);
						resolve(message);
					}
				} catch {
					// ignore
				}
			});
		});

		await channel.messaging.sendMessage({
			channelId: "web",
			recipientId: clientId,
			text: "hi recipient",
		});

		const message = await received;
		expect(message.channelId).toBe("web");
		expect(message.text).toBe("hi recipient");

		client.close();
	}, 10000);

	it("broadcasts only when no explicit recipient is provided and rejects offline recipients", async () => {
		const port = await getFreePort();
		channel = new WebChannel({ port });
		await channel.start();

		const c1 = new WebSocket(`ws://127.0.0.1:${port}`);
		const c2 = new WebSocket(`ws://127.0.0.1:${port}`);

		const waitForAck = (client: WebSocket) =>
			new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => reject(new Error("Ack timeout")), 5000);
				client.on("message", (raw) => {
					try {
						const message = JSON.parse(raw.toString());
						if (message.type === "ack") {
							clearTimeout(timeout);
							resolve();
						}
					} catch {
						// ignore
					}
				});
			});

		await Promise.all([waitForAck(c1), waitForAck(c2)]);

		const c1Events: string[] = [];
		const c2Events: string[] = [];
		c1.on("message", (raw) => {
			try {
				c1Events.push(JSON.parse(raw.toString()).type);
			} catch {
				// ignore
			}
		});
		c2.on("message", (raw) => {
			try {
				c2Events.push(JSON.parse(raw.toString()).type);
			} catch {
				// ignore
			}
		});

		await expect(channel.messaging.sendMessage({
			channelId: "web",
			recipientId: "unknown-client",
			text: "should fail",
		})).rejects.toThrow("Web recipient is offline");

		await channel.messaging.sendMessage({
			channelId: "web",
			recipientId: "",
			text: "broadcast text",
		});

		if (!channel) {
			throw new Error("Expected test channel to be initialized");
		}

		const activeChannel = channel;
		const stream = activeChannel.streaming.startStream("web", "");
		await stream.update("hello ");
		await stream.update("world");
		await stream.finish();

		await new Promise<void>((resolve) => setTimeout(resolve, 200));

		expect(c1Events).toContain("message");
		expect(c1Events).toContain("stream_start");
		expect(c1Events).toContain("stream_chunk");
		expect(c1Events).toContain("stream_end");
		expect(c2Events).toContain("message");
		expect(c2Events).toContain("stream_start");
		expect(c2Events).toContain("stream_chunk");
		expect(c2Events).toContain("stream_end");
		expect(() => activeChannel.streaming.startStream("web", "unknown-client")).toThrow("Web recipient is offline");

		c1.close();
		c2.close();
	}, 10000);

	it("returns wire errors for malformed client payloads", async () => {
		const port = await getFreePort();
		channel = new WebChannel({ port });
		await channel.start();

		const client = new WebSocket(`ws://127.0.0.1:${port}`);

		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("Ack timeout")), 5000);
			client.on("message", (raw) => {
				try {
					const message = JSON.parse(raw.toString());
					if (message.type === "ack") {
						clearTimeout(timeout);
						resolve();
					}
				} catch {
					// ignore
				}
			});
		});

		const errorPromise = new Promise<any>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("Error timeout")), 5000);
			client.on("message", (raw) => {
				try {
					const message = JSON.parse(raw.toString());
					if (message.type === "error") {
						clearTimeout(timeout);
						resolve(message);
					}
				} catch {
					// ignore
				}
			});
		});

		client.send("{not-json");

		const wireError = await errorPromise;
		expect(wireError.error).toContain("Invalid message format");
		client.close();
	}, 10000);
});
