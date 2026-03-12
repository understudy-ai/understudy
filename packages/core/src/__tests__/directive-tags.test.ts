import { describe, expect, it } from "vitest";
import { normalizeAssistantDisplayText, stripInlineDirectiveTagsForDisplay } from "../directive-tags.js";

describe("stripInlineDirectiveTagsForDisplay", () => {
	it("removes reply and audio directive tags from user-visible text", () => {
		const result = stripInlineDirectiveTagsForDisplay(
			"hello [[reply_to_current]] world [[reply_to:abc-123]] [[audio_as_voice]]",
		);
		expect(result.changed).toBe(true);
		expect(result.text).toBe("hello  world");
	});

	it("trims whitespace introduced by directives at the message boundaries", () => {
		const result = stripInlineDirectiveTagsForDisplay(
			"[[ reply_to_current ]]\nHello there [[ audio_as_voice ]]",
		);
		expect(result.changed).toBe(true);
		expect(result.text).toBe("Hello there");
	});

	it("leaves plain text unchanged", () => {
		const result = stripInlineDirectiveTagsForDisplay("  keep leading and trailing whitespace  ");
		expect(result.changed).toBe(false);
		expect(result.text).toBe("  keep leading and trailing whitespace  ");
	});
});

describe("normalizeAssistantDisplayText", () => {
	it("captures reply-to-current metadata while removing the visible tag", () => {
		const result = normalizeAssistantDisplayText("[[reply_to_current]] hello");
		expect(result.text).toBe("hello");
		expect(result.replyTarget).toEqual({ mode: "current" });
		expect(result.silent).toBe(false);
	});

	it("captures explicit reply message ids and prefers the last reply directive", () => {
		const result = normalizeAssistantDisplayText(
			"[[reply_to_current]] hi [[reply_to:msg-123]] [[reply_to:msg-456]]",
		);
		expect(result.text).toBe("hi");
		expect(result.replyTarget).toEqual({ mode: "message", messageId: "msg-456" });
	});

	it("keeps reply metadata even when the response is silent", () => {
		const result = normalizeAssistantDisplayText("[[reply_to:msg-123]] [[SILENT]]");
		expect(result.text).toBe("");
		expect(result.silent).toBe(true);
		expect(result.replyTarget).toEqual({ mode: "message", messageId: "msg-123" });
	});
});
