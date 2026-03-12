import { describe, expect, it } from "vitest";
import {
	MAX_INLINE_IMAGE_DATA_CHARS,
	extractRenderableAssistantImages,
} from "../assistant-media.js";

describe("assistant-media", () => {
	it("keeps renderable screenshots larger than the old 1.5M-char cutoff", () => {
		const data = "a".repeat(2_000_000);
		const images = extractRenderableAssistantImages({
			content: [{
				type: "image",
				mimeType: "image/png",
				data,
			}],
		});

		expect(MAX_INLINE_IMAGE_DATA_CHARS).toBeGreaterThan(2_000_000);
		expect(images).toEqual([{
			type: "image",
			mimeType: "image/png",
			data,
		}]);
	});
});
