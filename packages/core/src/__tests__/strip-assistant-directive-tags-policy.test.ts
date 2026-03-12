import { describe, expect, it } from "vitest";
import { RuntimePolicyPipeline } from "../runtime/policy-pipeline.js";
import { createGuardAssistantReplyPolicy } from "../runtime/policies/guard-assistant-reply-policy.js";
import { createStripAssistantDirectiveTagsPolicy } from "../runtime/policies/strip-assistant-directive-tags-policy.js";

function makeContext() {
	return {
		runtimeProfile: "assistant" as const,
		modelLabel: "google/gemini-3-flash-preview",
		cwd: "/tmp/understudy",
		config: {} as any,
	};
}

describe("strip_assistant_directive_tags policy", () => {
	it("removes inline directive tags from assistant text chunks before display", () => {
		const policy = createStripAssistantDirectiveTagsPolicy();
		const result = policy.beforeReply?.(makeContext(), {
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "[[reply_to_current]] Hi! [[audio_as_voice]]" },
				],
			} as any,
		});

		expect(result).toBeDefined();
		expect((result as any).message.content[0].text).toBe("Hi!");
	});

	it("leaves non-text content unchanged", () => {
		const policy = createStripAssistantDirectiveTagsPolicy();
		const result = policy.beforeReply?.(makeContext(), {
			message: {
				role: "assistant",
				content: [
					{ type: "toolCall", id: "tc1", name: "bash", arguments: { cmd: "pwd" } },
				],
			} as any,
		});

		expect(result).toBeUndefined();
	});

	it("allows guard_assistant_reply to replace tag-only replies with deterministic fallback text", async () => {
		const pipeline = new RuntimePolicyPipeline({
			context: makeContext(),
			policies: [
				createStripAssistantDirectiveTagsPolicy(),
				createGuardAssistantReplyPolicy(),
			],
		});

		const result = await pipeline.runBeforeReply({
			message: {
				role: "assistant",
				content: [{ type: "text", text: "[[reply_to_current]]" }],
			} as any,
		});

		expect((result.message as any).content[0].text).toBe("Assistant produced no renderable output.");
	});
});
