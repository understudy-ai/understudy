import { describe, it, expect } from "vitest";
import { EventBus, type BusEvent } from "../event-bus.js";

describe("EventBus", () => {
	it("emits events to listeners", () => {
		const bus = new EventBus();
		const received: BusEvent[] = [];
		bus.on("gateway.start", (e) => received.push(e));
		bus.emit("gateway.start", { port: 8080 });
		expect(received).toHaveLength(1);
		expect(received[0].data.port).toBe(8080);
	});

	it("supports wildcard listeners", () => {
		const bus = new EventBus();
		const received: BusEvent[] = [];
		bus.on("*", (e) => received.push(e));
		bus.emit("gateway.start");
		bus.emit("channel.start");
		expect(received).toHaveLength(2);
	});

	it("supports prefix pattern listeners", () => {
		const bus = new EventBus();
		const received: BusEvent[] = [];
		bus.on("channel.*", (e) => received.push(e));
		bus.emit("channel.start");
		bus.emit("channel.stop");
		bus.emit("gateway.start"); // Should not match
		expect(received).toHaveLength(2);
	});

	it("stores recent events", () => {
		const bus = new EventBus(5);
		for (let i = 0; i < 10; i++) {
			bus.emit("chat.start", { i });
		}
		expect(bus.recentCount).toBe(5);
		const recent = bus.getRecent();
		expect(recent).toHaveLength(5);
	});

	it("filters recent by prefix", () => {
		const bus = new EventBus();
		bus.emit("channel.start");
		bus.emit("gateway.start");
		bus.emit("channel.stop");
		const channelEvents = bus.getRecent("channel");
		expect(channelEvents).toHaveLength(2);
	});

	it("unsubscribes correctly", () => {
		const bus = new EventBus();
		const received: BusEvent[] = [];
		const unsub = bus.on("gateway.start", (e) => received.push(e));
		bus.emit("gateway.start");
		unsub();
		bus.emit("gateway.start");
		expect(received).toHaveLength(1);
	});

	it("clear removes everything", () => {
		const bus = new EventBus();
		bus.on("gateway.start", () => {});
		bus.emit("gateway.start");
		bus.clear();
		expect(bus.recentCount).toBe(0);
	});
});
