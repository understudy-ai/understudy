import { describe, it, expect } from "vitest";
import { UsageTracker } from "../usage-tracker.js";

describe("UsageTracker", () => {
	it("records and summarizes usage", () => {
		const tracker = new UsageTracker();
		tracker.record({
			inputTokens: 100,
			outputTokens: 50,
			model: "claude-sonnet",
			provider: "anthropic",
			timestamp: Date.now(),
			channelId: "telegram",
		});
		tracker.record({
			inputTokens: 200,
			outputTokens: 100,
			model: "claude-sonnet",
			provider: "anthropic",
			timestamp: Date.now(),
			channelId: "discord",
		});

		const summary = tracker.getSummary();
		expect(summary.totalInputTokens).toBe(300);
		expect(summary.totalOutputTokens).toBe(150);
		expect(summary.totalTokens).toBe(450);
		expect(summary.recordCount).toBe(2);
		expect(summary.byModel["anthropic/claude-sonnet"].count).toBe(2);
		expect(summary.byChannel["telegram"].input).toBe(100);
		expect(summary.byChannel["discord"].input).toBe(200);
	});

	it("filters by sinceMs", () => {
		const tracker = new UsageTracker();
		const now = Date.now();
		tracker.record({
			inputTokens: 100, outputTokens: 50,
			model: "m", provider: "p", timestamp: now - 10000,
		});
		tracker.record({
			inputTokens: 200, outputTokens: 100,
			model: "m", provider: "p", timestamp: now,
		});

		const summary = tracker.getSummary(now - 5000);
		expect(summary.recordCount).toBe(1);
		expect(summary.totalInputTokens).toBe(200);
	});

	it("respects max capacity", () => {
		const tracker = new UsageTracker(5);
		for (let i = 0; i < 10; i++) {
			tracker.record({
				inputTokens: i, outputTokens: 0,
				model: "m", provider: "p", timestamp: i,
			});
		}
		expect(tracker.size).toBe(5);
	});

	it("getDaily filters to last 24h", () => {
		const tracker = new UsageTracker();
		const now = Date.now();
		tracker.record({
			inputTokens: 100, outputTokens: 50,
			model: "m", provider: "p", timestamp: now - 25 * 60 * 60 * 1000,
		});
		tracker.record({
			inputTokens: 200, outputTokens: 100,
			model: "m", provider: "p", timestamp: now,
		});
		const daily = tracker.getDaily();
		expect(daily.recordCount).toBe(1);
		expect(daily.totalInputTokens).toBe(200);
	});
});
