import { describe, expect, it } from "vitest";
import { injectTimestamp, timestampOptsFromConfig } from "@understudy/gateway";

describe("injectTimestamp", () => {
	it("injects compact timestamp envelope", () => {
		const text = injectTimestamp("hello", {
			timezone: "UTC",
			now: new Date("2026-03-05T13:47:00.000Z"),
		});
		expect(text).toContain("hello");
		expect(text).toMatch(/^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
	});

	it("skips already enveloped messages", () => {
		const message = "[Thu 2026-03-05 21:47 HKT] hello";
		expect(
			injectTimestamp(message, {
				timezone: "Asia/Hong_Kong",
				now: new Date("2026-03-05T13:47:00.000Z"),
			}),
		).toBe(message);
	});

	it("skips current time payloads that already carry their own timestamp", () => {
		const message = "Current time: Thursday, March 5, 2026, 21:47:00";
		expect(
			injectTimestamp(message, {
				timezone: "Asia/Hong_Kong",
				now: new Date("2026-03-05T13:47:00.000Z"),
			}),
		).toBe(message);
	});
});

describe("timestampOptsFromConfig", () => {
	it("uses configured user timezone", () => {
		const opts = timestampOptsFromConfig({
			agent: { userTimezone: "Asia/Hong_Kong" },
		} as any);
		expect(opts.timezone).toBe("Asia/Hong_Kong");
	});
});
