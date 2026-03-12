import { describe, expect, it } from "vitest";
import { createGuardAssistantReplyPolicy } from "../runtime/policies/guard-assistant-reply-policy.js";

function makeContext() {
	return {
		runtimeProfile: "assistant" as const,
		modelLabel: "google/gemini-3-flash-preview",
		cwd: "/tmp/understudy",
		config: {} as any,
	};
}

describe("guard_assistant_reply policy", () => {
	it("passes through assistant tool-call messages without injecting fallback text", () => {
		const policy = createGuardAssistantReplyPolicy();
		const result = policy.beforeReply?.(makeContext(), {
			message: {
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "tc1",
						name: "bash",
						arguments: { cmd: "open -a Calculator" },
					},
				],
			} as any,
		});
		expect(result).toBeUndefined();
	});

	it("passes through assistant image-only messages without injecting fallback text", () => {
		const policy = createGuardAssistantReplyPolicy();
		const result = policy.beforeReply?.(makeContext(), {
			message: {
				role: "assistant",
				content: [
					{
						type: "image",
						mimeType: "image/png",
						data: "c2NyZWVuc2hvdA==",
					},
				],
			} as any,
		});
		expect(result).toBeUndefined();
	});

	it("injects fallback text only when assistant output is empty", () => {
		const policy = createGuardAssistantReplyPolicy();
		const result = policy.beforeReply?.(makeContext(), {
			message: {
				role: "assistant",
				content: [],
			} as any,
		});
		expect(result).toBeDefined();
		const text = ((result as any).message.content?.[0]?.text as string | undefined) ?? "";
		expect(text).toBe("Assistant produced no renderable output.");
	});
});
