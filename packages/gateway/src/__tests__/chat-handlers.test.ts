import { describe, expect, it } from "vitest";
import { normalizeChatResult } from "../handlers/chat-handlers.js";

describe("normalizeChatResult", () => {
	it("extracts reply directive metadata from string results", () => {
		const result = normalizeChatResult("[[reply_to:msg-123]] Echo: hello");
		expect(result).toMatchObject({
			response: "Echo: hello",
			replyToMessageId: "msg-123",
		});
	});

	it("preserves direct assistant image content as renderable output", () => {
		const result = normalizeChatResult({
			response: "[[reply_to_current]] Assistant produced no renderable output.",
			content: [
				{
					type: "image",
					mimeType: "image/png",
					data: "c2NyZWVuc2hvdA==",
				},
			],
		});

		expect(result.response).toBe("");
		expect(result.images).toEqual([
			{
				type: "image",
				mimeType: "image/png",
				data: "c2NyZWVuc2hvdA==",
			},
		]);
		expect(result.replyToCurrent).toBe(true);
	});
});
