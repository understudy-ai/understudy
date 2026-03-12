import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

const ONE_BY_ONE_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6W2y0AAAAASUVORK5CYII=";

const tempDirs: string[] = [];

export function createPngBuffer(width = 1, height = 1): Buffer {
	const bytes = Buffer.from(ONE_BY_ONE_PNG_BASE64, "base64");
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return bytes;
}

export async function createTestImage(width = 1, height = 1, filename = "tiny.png"): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "understudy-grounding-test-"));
	tempDirs.push(dir);
	const imagePath = join(dir, filename);
	await writeFile(imagePath, createPngBuffer(width, height));
	return imagePath;
}

export async function cleanupTempDirs(): Promise<void> {
	await Promise.allSettled(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

export function parseRequestBody(body: unknown): Record<string, unknown> {
	return JSON.parse(String(body ?? "{}")) as Record<string, unknown>;
}

export function requestInputContent(body: unknown): Array<Record<string, unknown>> {
	const request = parseRequestBody(body);
	const input = Array.isArray(request.input) ? request.input : [];
	const firstInput = input[0];
	return Array.isArray((firstInput as { content?: unknown } | undefined)?.content)
		? (firstInput as { content: Array<Record<string, unknown>> }).content
		: [];
}

export function extractPromptText(body: unknown): string {
	const promptBlock = requestInputContent(body).find((item) => item.type === "input_text");
	return typeof promptBlock?.text === "string" ? promptBlock.text : "";
}

export function createSequentialFetch(responses: string[]) {
	return vi.fn(async (_input: unknown, _init?: RequestInit) => {
		const outputText = responses.shift();
		if (!outputText) {
			throw new Error("Unexpected extra grounding request");
		}
		return {
			ok: true,
			json: async () => ({
				output_text: outputText,
			}),
		};
	});
}

export function createSimulationImageImpl() {
	return vi.fn(async (params: { width: number; height: number }) => ({
		imagePath: await createTestImage(params.width, params.height, `simulation-${params.width}x${params.height}.png`),
		cleanup: async () => {},
	}));
}
