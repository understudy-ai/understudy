import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPromptInputFromMedia } from "./media-input.js";

const cleanupDirs: string[] = [];

afterEach(async () => {
	while (cleanupDirs.length > 0) {
		const dir = cleanupDirs.pop();
		if (!dir) continue;
		await rm(dir, { recursive: true, force: true });
	}
});

describe("buildPromptInputFromMedia", () => {
	it("inlines local text attachments into the prompt body", async () => {
		const dir = await mkdtemp(join(tmpdir(), "understudy-media-input-"));
		cleanupDirs.push(dir);
		const filePath = join(dir, "build.log");
		await writeFile(filePath, "line one\nline two\n", "utf8");

		const result = await buildPromptInputFromMedia({
			text: "Summarize the attached log.",
			attachments: [
				{
					type: "file",
					url: filePath,
					name: "build.log",
					mimeType: "text/plain",
				},
			],
		});

		expect(result.text).toContain("Summarize the attached log.");
		expect(result.text).toContain(`<file name="build.log" source="${filePath}">`);
		expect(result.text).toContain("line one\nline two");
		expect(result.promptOptions).toBeUndefined();
	});

	it("keeps image attachments as prompt images while preserving the file tag", async () => {
		const dir = await mkdtemp(join(tmpdir(), "understudy-media-input-"));
		cleanupDirs.push(dir);
		const imagePath = join(dir, "pixel.png");
		await writeFile(
			imagePath,
			Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9XYAAAAASUVORK5CYII=",
				"base64",
			),
		);

		const result = await buildPromptInputFromMedia({
			text: "",
			attachments: [
				{
					type: "image",
					url: imagePath,
					name: "pixel.png",
					mimeType: "image/png",
				},
			],
		});

		expect(result.text).toContain("Please inspect the attached image.");
		expect(result.text).toContain(`<file name="pixel.png" source="${imagePath}"></file>`);
		expect(result.promptOptions?.images).toHaveLength(1);
		expect(result.promptOptions?.images?.[0]).toMatchObject({
			type: "image",
			mimeType: "image/png",
		});
	});
});
