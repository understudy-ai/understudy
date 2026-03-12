import { describe, it, expect, vi, afterEach } from "vitest";
import { MessageRouter } from "../router.js";
import { PairingManager } from "../security.js";
import type { ChannelAdapter, InboundMessage, ChannelMessagingAdapter } from "@understudy/types";

function createMockChannel(id: string): ChannelAdapter & { triggerMessage: (msg: InboundMessage) => void } {
	let messageHandler: ((msg: InboundMessage) => void) | null = null;

	const messaging: ChannelMessagingAdapter = {
		sendMessage: vi.fn().mockResolvedValue("msg_123"),
		onMessage: (handler) => {
			messageHandler = handler;
			return () => { messageHandler = null; };
		},
	};

	return {
		id,
		name: id,
		capabilities: {
			streaming: false,
			threads: false,
			reactions: false,
			attachments: false,
			groups: false,
		},
		messaging,
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		triggerMessage: (msg: InboundMessage) => {
			messageHandler?.(msg);
		},
	};
}

describe("MessageRouter", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("registers channels", () => {
		const router = new MessageRouter();
		const channel = createMockChannel("test");

		router.addChannel(channel);
		expect(router.listChannels()).toHaveLength(1);
		expect(router.getChannel("test")).toBe(channel);
	});

	it("routes inbound messages to handler", async () => {
		const router = new MessageRouter();
		const channel = createMockChannel("test");
		router.addChannel(channel);

		const received: InboundMessage[] = [];
		router.onMessage(async (msg) => { received.push(msg); });

		channel.triggerMessage({
			channelId: "test",
			senderId: "user1",
			text: "Hello",
			timestamp: Date.now(),
		});

		await new Promise((r) => setTimeout(r, 50));
		expect(received).toHaveLength(1);
		expect(received[0].text).toBe("Hello");
	});

	it("drops duplicate inbound messages when external ids match", async () => {
		const router = new MessageRouter({ dedupeTtlMs: 1_000 });
		const channel = createMockChannel("test");
		router.addChannel(channel);

		const received: InboundMessage[] = [];
		router.onMessage(async (msg) => { received.push(msg); });

		const payload: InboundMessage = {
			channelId: "test",
			senderId: "user1",
			externalMessageId: "msg-1",
			text: "Hello",
			timestamp: Date.now(),
		};
		channel.triggerMessage(payload);
		channel.triggerMessage({ ...payload });

		await new Promise((r) => setTimeout(r, 50));
		expect(received).toHaveLength(1);
	});

	it("drops duplicate fallback messages within the same short time bucket", async () => {
		const router = new MessageRouter({ dedupeTtlMs: 5_000 });
		const channel = createMockChannel("test");
		router.addChannel(channel);

		const received: InboundMessage[] = [];
		router.onMessage(async (msg) => { received.push(msg); });

		channel.triggerMessage({
			channelId: "test",
			senderId: "user1",
			text: "same content",
			timestamp: 20_000,
		});
		channel.triggerMessage({
			channelId: "test",
			senderId: "user1",
			text: "same   content",
			timestamp: 20_100,
		});

		await new Promise((r) => setTimeout(r, 50));
		expect(received).toHaveLength(1);
	});

	it("allows repeated fallback messages once ttl has elapsed", async () => {
		vi.useFakeTimers();
		const router = new MessageRouter({ dedupeTtlMs: 10 });
		const channel = createMockChannel("test");
		router.addChannel(channel);

		const received: InboundMessage[] = [];
		router.onMessage(async (msg) => { received.push(msg); });

		const payload: InboundMessage = {
			channelId: "test",
			senderId: "user1",
			text: "Hello again",
			timestamp: 20_000,
		};
		channel.triggerMessage(payload);
		await vi.advanceTimersByTimeAsync(11);
		channel.triggerMessage({ ...payload, timestamp: 25_500 });
		await vi.advanceTimersByTimeAsync(1);

		expect(received).toHaveLength(2);
	});

	it("blocks unallowed senders when pairing required", async () => {
		const pairing = PairingManager.inMemory();
		const router = new MessageRouter({
			pairingManager: pairing,
			requirePairing: true,
		});

		const channel = createMockChannel("test");
		router.addChannel(channel);

		const received: InboundMessage[] = [];
		router.onMessage(async (msg) => { received.push(msg); });

		channel.triggerMessage({
			channelId: "test",
			senderId: "unknown_user",
			text: "Hello",
			timestamp: Date.now(),
		});

		await new Promise((r) => setTimeout(r, 50));
		expect(received).toHaveLength(0);
	});

	it("allows paired senders", async () => {
		const pairing = PairingManager.inMemory();
		pairing.addAllowed("test", "user1");

		const router = new MessageRouter({
			pairingManager: pairing,
			requirePairing: true,
		});

		const channel = createMockChannel("test");
		router.addChannel(channel);

		const received: InboundMessage[] = [];
		router.onMessage(async (msg) => { received.push(msg); });

		channel.triggerMessage({
			channelId: "test",
			senderId: "user1",
			text: "Hello",
			timestamp: Date.now(),
		});

		await new Promise((r) => setTimeout(r, 50));
		expect(received).toHaveLength(1);
	});

	it("accepts pairing approvals without message format precheck", async () => {
		const pairing = PairingManager.inMemory();
		const code = pairing.generateCode("test");
		const router = new MessageRouter({
			pairingManager: pairing,
			requirePairing: true,
		});
		const channel = createMockChannel("test");
		router.addChannel(channel);

		const received: InboundMessage[] = [];
		router.onMessage(async (msg) => { received.push(msg); });

		channel.triggerMessage({
			channelId: "test",
			senderId: "user2",
			text: `  ${code.toLowerCase()}  `,
			timestamp: Date.now(),
		});

		await new Promise((r) => setTimeout(r, 50));
		expect(received).toHaveLength(0);
		expect(pairing.isAllowed("test", "user2")).toBe(true);
		expect((channel.messaging.sendMessage as any).mock.calls.length).toBe(1);
	});

	it("starts and stops all channels", async () => {
		const router = new MessageRouter();
		const ch1 = createMockChannel("ch1");
		const ch2 = createMockChannel("ch2");

		router.addChannel(ch1);
		router.addChannel(ch2);

		await router.startAll();
		expect(ch1.start).toHaveBeenCalled();
		expect(ch2.start).toHaveBeenCalled();

		await router.stopAll();
		expect(ch1.stop).toHaveBeenCalled();
		expect(ch2.stop).toHaveBeenCalled();
	});

	it("tracks channel runtime state through start and stop", async () => {
		const router = new MessageRouter();
		const channel = createMockChannel("statusful");
		router.addChannel(channel);

		expect(await router.getChannelRuntimeStatus("statusful")).toMatchObject({
			state: "stopped",
		});

		await router.startAll();
		expect(await router.getChannelRuntimeStatus("statusful")).toMatchObject({
			state: "running",
		});

		await router.stopAll();
		expect(await router.getChannelRuntimeStatus("statusful")).toMatchObject({
			state: "stopped",
		});
	});

	it("retries failed channel start with backoff", async () => {
		vi.useFakeTimers();
		const channel = createMockChannel("flaky");
		let attempts = 0;
		(channel.start as any).mockImplementation(async () => {
			attempts += 1;
			if (attempts === 1) {
				throw new Error("boom");
			}
		});

		const router = new MessageRouter({
			autoRestart: true,
			restartBaseDelayMs: 10,
			restartMaxDelayMs: 10,
		});
		router.addChannel(channel);

		await router.startAll();
		expect(channel.start).toHaveBeenCalledTimes(1);
		expect(await router.getChannelRuntimeStatus("flaky")).toMatchObject({
			state: "reconnecting",
			restartAttempt: 1,
		});

		await vi.advanceTimersByTimeAsync(10);
		expect(channel.start).toHaveBeenCalledTimes(2);
		expect(await router.getChannelRuntimeStatus("flaky")).toMatchObject({
			state: "running",
			restartAttempt: 0,
		});

		await router.stopAll();
	});
});
