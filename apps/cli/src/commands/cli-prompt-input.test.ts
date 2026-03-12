import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeCliPromptText, prepareCliPromptInput } from "./cli-prompt-input.js";

const ONE_PIXEL_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9XYAAAAASUVORK5CYII=";

const tempDirs: string[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("prepareCliPromptInput", () => {
	it("inlines text files and converts image files into prompt images", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "understudy-cli-input-"));
		tempDirs.push(tempDir);
		const textPath = join(tempDir, "notes.txt");
		const imagePath = join(tempDir, "pixel.png");
		await writeFile(textPath, "alpha\nbeta", "utf8");
		await writeFile(imagePath, Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));

		const result = await prepareCliPromptInput({
			cwd: tempDir,
			files: ["notes.txt", "pixel.png"],
		});

		expect(result.text).toContain(`<file name="${textPath}">`);
		expect(result.text).toContain("alpha\nbeta");
		expect(result.text).toContain(`<file name="${imagePath}"></file>`);
		expect(result.images).toEqual([
			{
				type: "image",
				data: ONE_PIXEL_PNG_BASE64,
				mimeType: "image/png",
			},
		]);
	});

	it("loads remote images from --image inputs", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"), {
				status: 200,
				headers: {
					"content-type": "image/png",
					"content-length": "68",
				},
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await prepareCliPromptInput({
			images: ["https://example.com/demo.png"],
		});

		expect(fetchMock).toHaveBeenCalledWith("https://example.com/demo.png");
		expect(result.text).toContain('<file name="https://example.com/demo.png"></file>');
		expect(result.images).toEqual([
			{
				type: "image",
				data: ONE_PIXEL_PNG_BASE64,
				mimeType: "image/png",
			},
		]);
	});
});

describe("mergeCliPromptText", () => {
	it("prepends generated file context ahead of the user message", () => {
		expect(
			mergeCliPromptText("Summarize this", {
				text: '<file name="/tmp/demo.txt">\nhello\n</file>\n',
			}),
		).toBe('<file name="/tmp/demo.txt">\nhello\n</file>\nSummarize this');
	});
});
