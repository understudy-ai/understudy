import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildPromptImageModeGuidance,
	extractReferencedImageSources,
	preparePromptImageSupport,
	resolvePromptImageSupportMode,
} from "../runtime/prompt-image-support.js";

const ONE_BY_ONE_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6W2y0AAAAASUVORK5CYII=";

async function createTestImage(name = "shot.png"): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "understudy-core-image-"));
	const imagePath = join(dir, name);
	await writeFile(imagePath, Buffer.from(ONE_BY_ONE_PNG_BASE64, "base64"));
	return imagePath;
}

describe("prompt image support", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("detects prompt image support mode from model input", () => {
		expect(resolvePromptImageSupportMode({ input: ["text", "image"] } as any)).toBe("native");
		expect(resolvePromptImageSupportMode({ input: ["text"] } as any)).toBe("sidecar");
		expect(resolvePromptImageSupportMode(undefined)).toBe("unknown");
		expect(buildPromptImageModeGuidance("native")).toContain("supports native image input");
		expect(buildPromptImageModeGuidance("sidecar")).toContain("does not support native image input");
	});

	it("extracts image references from prompt text and file-tag source attributes", () => {
		const references = extractReferencedImageSources(
			'Look at `./screen.png` and ![shot](./docs/error.jpg)\n' +
				'<file name="attached.png" source="/tmp/attached.png"></file>\n' +
				'<file name="/tmp/direct-name.png"></file>',
		);
		expect(references).toEqual([
			"./screen.png",
			"./docs/error.jpg",
			"/tmp/attached.png",
			"/tmp/direct-name.png",
		]);
	});

	it("auto-loads prompt image references when the model supports vision", async () => {
		const imagePath = await createTestImage();
		const prepared = await preparePromptImageSupport({
			text: `Please inspect ${imagePath}`,
			cwd: "/tmp",
			model: { input: ["text", "image"] } as any,
		});

		expect(prepared.mode).toBe("native");
		expect(prepared.referencedImageSources).toEqual([imagePath]);
		expect(prepared.autoLoadedImages).toHaveLength(1);
		expect((prepared.options?.images as any[])?.[0]).toMatchObject({
			type: "image",
			mimeType: "image/png",
		});
		expect(prepared.text).not.toContain("does not accept image input directly");
	});

	it("passes a timeout signal when auto-loading HTTP image references", async () => {
		const imageBytes = Buffer.from(ONE_BY_ONE_PNG_BASE64, "base64");
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			headers: new Headers({
				"content-type": "image/png",
			}),
			arrayBuffer: async () =>
				imageBytes.buffer.slice(
					imageBytes.byteOffset,
					imageBytes.byteOffset + imageBytes.byteLength,
				),
		});
		vi.stubGlobal("fetch", fetchMock);

		const prepared = await preparePromptImageSupport({
			text: "Please inspect https://example.com/screenshot.png",
			cwd: "/tmp",
			model: { input: ["text", "image"] } as any,
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"https://example.com/screenshot.png",
			expect.objectContaining({
				signal: expect.any(AbortSignal),
			}),
		);
		expect(prepared.autoLoadedImages).toHaveLength(1);
	});

	it("suppresses direct prompt images and appends guidance for sidecar models", async () => {
		const imagePath = await createTestImage("sidecar.png");
		const prepared = await preparePromptImageSupport({
			text: `Inspect ${imagePath}`,
			cwd: "/tmp",
			model: { input: ["text"] } as any,
			options: {
				images: [
					{
						type: "image",
						data: "ZmFrZQ==",
						mimeType: "image/png",
					},
				],
			},
		});

		expect(prepared.mode).toBe("sidecar");
		expect(prepared.suppressedImageCount).toBe(1);
		expect(prepared.options).toBeUndefined();
		expect(prepared.text).toContain("Use `vision_read` on referenced image paths or URLs");
	});
});
