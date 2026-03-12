import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createImageTool } from "../image-tool.js";

const ONE_BY_ONE_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6W2y0AAAAASUVORK5CYII=";

describe("createImageTool", () => {
	it("inspects a local PNG image", async () => {
		const dir = await mkdtemp(join(tmpdir(), "understudy-image-test-"));
		const imagePath = join(dir, "tiny.png");
		await writeFile(imagePath, Buffer.from(ONE_BY_ONE_PNG_BASE64, "base64"));

		const tool = createImageTool();
		const result = await tool.execute("id", { image: imagePath });
		const text = (result.content[0] as any).text as string;

		expect(text).toContain("MIME: image/png");
		expect(text).toContain("Dimensions: 1x1");
		expect((result.details as any).mimeType).toBe("image/png");
		expect((result.details as any).width).toBe(1);
		expect((result.details as any).height).toBe(1);
	});

	it("returns base64 image payload when includeBase64 is true", async () => {
		const dir = await mkdtemp(join(tmpdir(), "understudy-image-test-"));
		const imagePath = join(dir, "tiny.png");
		await writeFile(imagePath, Buffer.from(ONE_BY_ONE_PNG_BASE64, "base64"));

		const tool = createImageTool();
		const result = await tool.execute("id", { image: imagePath, includeBase64: true });

		expect(result.content[0]).toMatchObject({ type: "text" });
		const image = result.content[1] as any;
		expect(image.type).toBe("image");
		expect(image.mimeType).toBe("image/png");
		expect(typeof image.data).toBe("string");
		expect(image.data.length).toBeGreaterThan(0);
	});

	it("returns a readable error for missing image", async () => {
		const tool = createImageTool();
		const result = await tool.execute("id", { image: "/tmp/does-not-exist.png" });
		expect((result.content[0] as any).text).toContain("Failed to inspect image");
		expect((result.details as any).error).toBeTruthy();
	});
});

