import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ImageContent } from "@mariozechner/pi-ai";
import {
	DEFAULT_MAX_IMAGE_BYTES,
	MAX_EMBEDDED_IMAGE_BYTES,
	loadImageSource,
	mimeTypeToExtension,
	toSha256,
} from "./image-shared.js";
import { textResult as baseTextResult } from "./bridge/bridge-rpc.js";

const DEFAULT_OCR_TIMEOUT_MS = 15_000;
const MAX_OCR_TEXT_CHARS = 20_000;

const VisionReadSchema = Type.Object({
	image: Type.String({
		description: "Local path, file:// URL, or http(s) URL of the image to inspect.",
	}),
	focus: Type.Optional(
		Type.String({
			description: "What to focus on, such as OCR, an error message, or UI state.",
		}),
	),
	includeImage: Type.Optional(
		Type.Boolean({
			description: "Attach the image to the tool result for downstream visual reasoning (default true).",
		}),
	),
	ocr: Type.Optional(
		Type.Boolean({
			description: "Run on-device OCR when available (default true).",
		}),
	),
	language: Type.Optional(
		Type.String({
			description: "Optional Tesseract language pack(s), for example eng, chi_sim, or eng+chi_sim.",
		}),
	),
	ocrTimeoutMs: Type.Optional(
		Type.Number({
			description: "Maximum OCR runtime in milliseconds (default 15000).",
		}),
	),
	maxBytes: Type.Optional(
		Type.Number({
			description: "Maximum bytes to read from the image source (default 10MB).",
		}),
	),
});

type VisionReadParams = Static<typeof VisionReadSchema>;

export interface VisionReadToolOptions {
	resolveOcrBinary?: () => Promise<string | null>;
	runOcr?: (params: {
		binary: string;
		imagePath: string;
		language?: string;
		timeoutMs: number;
	}) => Promise<string>;
}

let cachedTesseractBinary: Promise<string | null> | null = null;

function textResult(
	text: string,
	details: Record<string, unknown> = {},
	imageBlock?: { data: string; mimeType: string } | null,
): AgentToolResult<unknown> {
	const result = baseTextResult(text, details);
	if (imageBlock) {
		const imageContent: ImageContent = {
			type: "image",
			data: imageBlock.data,
			mimeType: imageBlock.mimeType,
		};
		result.content.push(imageContent);
	}
	return result;
}

function clampOcrText(value: string): { text: string; truncated: boolean } {
	if (value.length <= MAX_OCR_TEXT_CHARS) {
		return { text: value, truncated: false };
	}
	return {
		text: value.slice(0, MAX_OCR_TEXT_CHARS),
		truncated: true,
	};
}

function cleanOcrText(value: string): string {
	return value.replace(/\f/g, "\n").replace(/\r\n/g, "\n").trim();
}

async function isExecutable(filePath: string): Promise<boolean> {
	try {
		const fileStats = await stat(filePath);
		if (!fileStats.isFile()) {
			return false;
		}
		if (process.platform === "win32") {
			return true;
		}
		await access(filePath, fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function candidateBinaryNames(name: string): string[] {
	if (process.platform !== "win32") {
		return [name];
	}
	const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
	if (ext) {
		return [name];
	}
	const pathext = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
		.split(";")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => (entry.startsWith(".") ? entry : `.${entry}`));
	return [name, ...pathext.map((entry) => `${name}${entry}`)];
}

async function findBinary(name: string): Promise<string | null> {
	const searchName = name.trim();
	if (!searchName) {
		return null;
	}
	const pathEntries = (process.env.PATH ?? "")
		.split(process.platform === "win32" ? ";" : ":")
		.map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
		.filter(Boolean);
	for (const entry of pathEntries) {
		for (const candidate of candidateBinaryNames(searchName)) {
			const fullPath = join(entry, candidate);
			if (await isExecutable(fullPath)) {
				return fullPath;
			}
		}
	}
	return null;
}

async function resolveDefaultOcrBinary(): Promise<string | null> {
	if (!cachedTesseractBinary) {
		cachedTesseractBinary = findBinary("tesseract");
	}
	return await cachedTesseractBinary;
}

async function runDefaultOcr(params: {
	binary: string;
	imagePath: string;
	language?: string;
	timeoutMs: number;
}): Promise<string> {
	return await new Promise<string>((resolve, reject) => {
		const args = [
			params.imagePath,
			"stdout",
			...(params.language?.trim() ? ["-l", params.language.trim()] : []),
		];
		const child = spawn(params.binary, args, {
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let settled = false;
		const timeout = setTimeout(() => {
			if (!settled) {
				child.kill("SIGKILL");
				settled = true;
				reject(new Error(`OCR timed out after ${params.timeoutMs}ms`));
			}
		}, params.timeoutMs);

		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			reject(error);
		});
		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (code === 0) {
				resolve(stdout);
				return;
			}
			const message = stderr.trim() || `tesseract exited with code ${String(code)}`;
			reject(new Error(message));
		});
	});
}

async function prepareOcrInput(params: {
	source: string;
	localPath?: string;
	bytes: Buffer;
	mimeType: string;
}): Promise<{ imagePath: string; cleanup: () => Promise<void> }> {
	if (params.localPath) {
		return {
			imagePath: params.localPath,
			cleanup: async () => {},
		};
	}

	const tempDir = await mkdtemp(join(tmpdir(), "understudy-vision-read-"));
	const tempPath = join(
		tempDir,
		`${basename(params.source).replace(/[^\w.-]+/g, "_") || "image"}${mimeTypeToExtension(params.mimeType)}`,
	);
	await writeFile(tempPath, params.bytes);
	return {
		imagePath: tempPath,
		cleanup: async () => {
			await rm(tempDir, { recursive: true, force: true }).catch(() => {});
		},
	};
}

export function createVisionReadTool(options: VisionReadToolOptions = {}): AgentTool<typeof VisionReadSchema> {
	return {
		name: "vision_read",
		label: "Vision Read",
		description:
			"Inspect a screenshot or photo, attach the image for visual reasoning, and extract on-device OCR text when available.",
		parameters: VisionReadSchema,
		execute: async (_toolCallId, params: VisionReadParams): Promise<AgentToolResult<unknown>> => {
			const maxBytes = Math.max(1_024, Math.floor(params.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES));
			const includeImage = params.includeImage !== false;
			const ocrEnabled = params.ocr !== false;
			const focus = params.focus?.trim();
			const language = params.language?.trim() || undefined;
			const ocrTimeoutMs = Math.max(1_000, Math.floor(params.ocrTimeoutMs ?? DEFAULT_OCR_TIMEOUT_MS));

			try {
				const loaded = await loadImageSource(params.image, maxBytes);
				const probe = loaded.probe;
				if (!probe.mimeType.startsWith("image/")) {
					throw new Error(`Unsupported image type: ${probe.mimeType}`);
				}

				let imageAttached = false;
				let imageAttachedReason = "Image payload omitted by request.";
				let imageBlock: { data: string; mimeType: string } | null = null;
				if (includeImage) {
					if (loaded.bytes.byteLength <= MAX_EMBEDDED_IMAGE_BYTES) {
						imageAttached = true;
						imageAttachedReason = "Image payload attached for downstream visual reasoning.";
						imageBlock = {
							data: loaded.bytes.toString("base64"),
							mimeType: probe.mimeType,
						};
					} else {
						imageAttachedReason =
							`Image payload omitted because it exceeds ${MAX_EMBEDDED_IMAGE_BYTES} bytes.`;
					}
				}

				const details: Record<string, unknown> = {
					source: loaded.source,
					mimeType: probe.mimeType,
					sizeBytes: loaded.bytes.byteLength,
					width: probe.width,
					height: probe.height,
					sha256: toSha256(loaded.bytes),
					imageAttached,
					imageAttachedReason,
				};
				if (focus) {
					details.focus = focus;
				}

				const lines = [
					"Understudy vision read",
					`Source: ${loaded.source}`,
					...(focus ? [`Focus: ${focus}`] : []),
					`MIME: ${probe.mimeType}`,
					`Bytes: ${loaded.bytes.byteLength}`,
					`Dimensions: ${probe.width && probe.height ? `${probe.width}x${probe.height}` : "unknown"}`,
					`SHA256: ${String(details.sha256)}`,
				];

				if (!ocrEnabled) {
					lines.push("OCR: skipped (ocr=false)");
					details.ocr = {
						requested: false,
						available: false,
					};
				} else {
					const resolveOcrBinary = options.resolveOcrBinary ?? resolveDefaultOcrBinary;
					const runOcr = options.runOcr ?? runDefaultOcr;
					const binary = await resolveOcrBinary();
					if (!binary) {
						lines.push("OCR: unavailable (install `tesseract` to enable on-device text extraction)");
						details.ocr = {
							requested: true,
							available: false,
							reason: "tesseract_not_found",
							language,
						};
					} else {
						const ocrInput = await prepareOcrInput({
							source: loaded.source,
							localPath: loaded.localPath,
							bytes: loaded.bytes,
							mimeType: probe.mimeType,
						});
						try {
							const rawOcrText = await runOcr({
								binary,
								imagePath: ocrInput.imagePath,
								language,
								timeoutMs: ocrTimeoutMs,
							});
							const normalizedText = cleanOcrText(rawOcrText);
							const clamped = clampOcrText(normalizedText);
							if (clamped.text) {
								lines.push(`OCR: extracted ${normalizedText.length} characters`);
								lines.push("");
								lines.push("OCR text:");
								lines.push(clamped.text);
								if (clamped.truncated) {
									lines.push("");
									lines.push(`OCR output truncated to ${MAX_OCR_TEXT_CHARS} characters.`);
								}
							} else {
								lines.push("OCR: no text detected");
							}
							details.ocr = {
								requested: true,
								available: true,
								language,
								text: clamped.text,
								textLength: normalizedText.length,
								truncated: clamped.truncated,
							};
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
							lines.push(`OCR failed: ${message}`);
							details.ocr = {
								requested: true,
								available: true,
								language,
								error: message,
							};
						} finally {
							await ocrInput.cleanup();
						}
					}
				}

				lines.push(imageAttachedReason);

				return textResult(lines.join("\n"), details, imageBlock);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return textResult(`Understudy vision read failed: ${message}`, { error: message });
			}
		},
	};
}
