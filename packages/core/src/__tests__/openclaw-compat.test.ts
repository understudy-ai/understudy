import { describe, expect, it } from "vitest";
import {
	expandOpenClawCompatibleToolNames,
	filterOpenClawCompatibilityToolNames,
	shouldHideOpenClawCompatibilityToolName,
} from "../openclaw-compat.js";

describe("openclaw compatibility tool surfaces", () => {
	it("still expands exec for bash-only runtime compatibility", () => {
		expect(expandOpenClawCompatibleToolNames(["exec", "schedule", "message_send"])).toEqual([
			"exec",
			"bash",
			"schedule",
			"message_send",
		]);
	});

	it("no longer hides removed message/cron aliases from prompt/tool summaries", () => {
		expect(filterOpenClawCompatibilityToolNames([
			"exec",
			"bash",
			"schedule",
			"message_send",
		])).toEqual([
			"exec",
			"bash",
			"schedule",
			"message_send",
		]);
		expect(shouldHideOpenClawCompatibilityToolName("exec", ["bash"])).toBe(false);
		expect(shouldHideOpenClawCompatibilityToolName("message", ["message_send"])).toBe(false);
		expect(shouldHideOpenClawCompatibilityToolName("cron", ["schedule"])).toBe(false);
	});
});
