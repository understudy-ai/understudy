import { describe, expect, it } from "vitest";
import {
	expandOpenClawCompatibleToolNames,
	filterOpenClawCompatibilityToolNames,
	shouldHideOpenClawCompatibilityToolName,
} from "../openclaw-compat.js";

describe("openclaw compatibility tool surfaces", () => {
	it("still expands OpenClaw tool names for runtime compatibility", () => {
		expect(expandOpenClawCompatibleToolNames(["exec", "cron", "message"])).toEqual([
			"exec",
			"bash",
			"cron",
			"schedule",
			"message",
			"message_send",
		]);
	});

	it("only hides pure alias names from prompt/tool summaries", () => {
		expect(filterOpenClawCompatibilityToolNames([
			"exec",
			"bash",
			"cron",
			"schedule",
			"message",
			"message_send",
		])).toEqual([
			"exec",
			"bash",
			"cron",
			"schedule",
			"message_send",
		]);
		expect(shouldHideOpenClawCompatibilityToolName("message", ["message_send"])).toBe(true);
		expect(shouldHideOpenClawCompatibilityToolName("exec", ["bash"])).toBe(false);
		expect(shouldHideOpenClawCompatibilityToolName("cron", ["schedule"])).toBe(false);
	});
});
