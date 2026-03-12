import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SvgToPngResult {
	pngPath: string;
	cleanup: () => Promise<void>;
}

export async function convertSvgToPng(
	svgContent: string,
	prefix = "understudy-svg-",
): Promise<SvgToPngResult> {
	const tempDir = await mkdtemp(join(tmpdir(), prefix));
	try {
		const svgPath = join(tempDir, "image.svg");
		const pngPath = join(tempDir, "image.png");
		await writeFile(svgPath, svgContent, "utf-8");
		await execFileAsync("sips", [
			"-s",
			"format",
			"png",
			svgPath,
			"--out",
			pngPath,
		], {
			encoding: "utf-8",
			timeout: 15_000,
			maxBuffer: 8 * 1024 * 1024,
		});
		return {
			pngPath,
			cleanup: async () => {
				await rm(tempDir, { recursive: true, force: true }).catch(() => {});
			},
		};
	} catch (error) {
		await rm(tempDir, { recursive: true, force: true }).catch(() => {});
		throw error;
	}
}
