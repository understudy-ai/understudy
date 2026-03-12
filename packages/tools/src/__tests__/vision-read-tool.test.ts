import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createVisionReadTool } from "../vision-read-tool.js";

const ONE_BY_ONE_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6W2y0AAAAASUVORK5CYII=";

async function createTestImage(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "understudy-vision-read-test-"));
	const imagePath = join(dir, "tiny.png");
	await writeFile(imagePath, Buffer.from(ONE_BY_ONE_PNG_BASE64, "base64"));
	return imagePath;
}

describe("createVisionReadTool", () => {
	it("returns OCR text and an image payload when OCR is available", async () => {
		const imagePath = await createTestImage();
		const tool = createVisionReadTool({
			resolveOcrBinary: async () => "/usr/bin/tesseract",
			runOcr: async ({ imagePath: inputPath }) => {
				expect(inputPath).toBe(imagePath);
				return "Hello Understudy";
			},
		});

		const result = await tool.execute("id", {
			image: imagePath,
			focus: "Read the visible text",
		});

		const text = (result.content[0] as any).text as string;
		expect(text).toContain("Understudy vision read");
		expect(text).toContain("Focus: Read the visible text");
		expect(text).toContain("OCR: extracted 16 characters");
		expect(text).toContain("OCR text:");
		expect(text).toContain("Hello Understudy");
		expect(text).toContain("Image payload attached for downstream visual reasoning.");
		expect(result.content[1]).toMatchObject({
			type: "image",
			mimeType: "image/png",
		});
		expect((result.details as any).ocr).toMatchObject({
			requested: true,
			available: true,
			text: "Hello Understudy",
			textLength: 16,
			truncated: false,
		});
		expect((result.details as any).imageAttached).toBe(true);
	});

	it("degrades cleanly when OCR is unavailable", async () => {
		const imagePath = await createTestImage();
		const tool = createVisionReadTool({
			resolveOcrBinary: async () => null,
		});

		const result = await tool.execute("id", {
			image: imagePath,
			includeImage: false,
		});

		const text = (result.content[0] as any).text as string;
		expect(text).toContain("OCR: unavailable");
		expect(text).toContain("Image payload omitted by request.");
		expect(result.content).toHaveLength(1);
		expect((result.details as any).ocr).toMatchObject({
			requested: true,
			available: false,
			reason: "tesseract_not_found",
		});
		expect((result.details as any).imageAttached).toBe(false);
	});

	it("returns a readable error for missing images", async () => {
		const tool = createVisionReadTool({
			resolveOcrBinary: async () => null,
		});
		const result = await tool.execute("id", { image: "/tmp/understudy-does-not-exist.png" });
		expect((result.content[0] as any).text).toContain("Understudy vision read failed");
		expect((result.details as any).error).toBeTruthy();
	});
});
