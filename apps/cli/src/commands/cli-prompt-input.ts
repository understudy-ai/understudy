import type { ImageContent } from "@mariozechner/pi-ai";
import { expandHome } from "@understudy/core";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_FILE_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_FILE_MAX_CHARS = 200_000;

export interface CliPromptInputOptions {
	cwd?: string;
	files?: string[];
	images?: string[];
}

export interface CliPromptInput {
	text: string;
	images?: ImageContent[];
}

function isHttpUrl(value: string): boolean {
	return value.startsWith("http://") || value.startsWith("https://");
}

function isFileUrl(value: string): boolean {
	return value.startsWith("file://");
}

function resolveLocalPath(value: string, cwd: string): string {
	return resolvePath(cwd, expandHome(value));
}

function detectImageMimeTypeFromPath(filePath: string): string | undefined {
	switch (extname(filePath).trim().toLowerCase()) {
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".png":
			return "image/png";
		case ".gif":
			return "image/gif";
		case ".webp":
			return "image/webp";
		case ".bmp":
			return "image/bmp";
		default:
			return undefined;
	}
}

function detectImageMimeTypeFromBuffer(buffer: Buffer): string | undefined {
	if (
		buffer.length >= 8 &&
		buffer[0] === 0x89 &&
		buffer[1] === 0x50 &&
		buffer[2] === 0x4e &&
		buffer[3] === 0x47 &&
		buffer[4] === 0x0d &&
		buffer[5] === 0x0a &&
		buffer[6] === 0x1a &&
		buffer[7] === 0x0a
	) {
		return "image/png";
	}
	if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
		return "image/jpeg";
	}
	if (
		buffer.length >= 6 &&
		buffer.subarray(0, 6).toString("ascii") === "GIF87a"
	) {
		return "image/gif";
	}
	if (
		buffer.length >= 6 &&
		buffer.subarray(0, 6).toString("ascii") === "GIF89a"
	) {
		return "image/gif";
	}
	if (
		buffer.length >= 12 &&
		buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
		buffer.subarray(8, 12).toString("ascii") === "WEBP"
	) {
		return "image/webp";
	}
	if (buffer.length >= 2 && buffer.subarray(0, 2).toString("ascii") === "BM") {
		return "image/bmp";
	}
	return undefined;
}

function detectImageMimeType(params: {
	buffer: Buffer;
	filePath?: string;
	contentType?: string | null;
}): string | undefined {
	const normalizedContentType = params.contentType?.split(";")[0]?.trim().toLowerCase();
	if (normalizedContentType?.startsWith("image/")) {
		return normalizedContentType;
	}
	return (
		detectImageMimeTypeFromBuffer(params.buffer) ??
		(params.filePath ? detectImageMimeTypeFromPath(params.filePath) : undefined)
	);
}

function clampText(value: string): string {
	if (value.length <= DEFAULT_FILE_MAX_CHARS) {
		return value;
	}
	return value.slice(0, DEFAULT_FILE_MAX_CHARS);
}

function mergeSegments(segments: string[]): string {
	return segments.join("");
}

export function mergeCliPromptText(baseMessage: string | undefined, input: CliPromptInput): string {
	return `${input.text}${baseMessage ?? ""}`;
}

async function readLocalFileBuffer(filePath: string, maxBytes: number): Promise<Buffer | null> {
	const fileStats = await stat(filePath);
	if (fileStats.size === 0) {
		return null;
	}
	if (fileStats.size > maxBytes) {
		throw new Error(`File exceeds ${maxBytes} bytes: ${filePath}`);
	}
	return await readFile(filePath);
}

async function loadLocalFileInput(filePath: string): Promise<{ text: string; image?: ImageContent }> {
	const buffer = await readLocalFileBuffer(filePath, DEFAULT_IMAGE_MAX_BYTES);
	if (!buffer) {
		return { text: "" };
	}

	const imageMimeType = detectImageMimeType({ buffer, filePath });
	if (imageMimeType) {
		if (buffer.byteLength > DEFAULT_IMAGE_MAX_BYTES) {
			throw new Error(`Image exceeds ${DEFAULT_IMAGE_MAX_BYTES} bytes: ${filePath}`);
		}
		return {
			text: `<file name="${filePath}"></file>\n`,
			image: {
				type: "image",
				data: buffer.toString("base64"),
				mimeType: imageMimeType,
			},
		};
	}

	if (buffer.byteLength > DEFAULT_FILE_MAX_BYTES) {
		throw new Error(`File exceeds ${DEFAULT_FILE_MAX_BYTES} bytes: ${filePath}`);
	}

	const content = clampText(buffer.toString("utf-8"));
	return {
		text: `<file name="${filePath}">\n${content}\n</file>\n`,
	};
}

async function loadImageFromSource(
	source: string,
	cwd: string,
): Promise<{ text: string; image: ImageContent }> {
	if (isHttpUrl(source)) {
		const response = await fetch(source);
		if (!response.ok) {
			throw new Error(`Failed to fetch image: HTTP ${response.status}`);
		}
		const contentLength = response.headers.get("content-length");
		if (contentLength) {
			const size = Number(contentLength);
			if (Number.isFinite(size) && size > DEFAULT_IMAGE_MAX_BYTES) {
				throw new Error(`Image exceeds ${DEFAULT_IMAGE_MAX_BYTES} bytes: ${source}`);
			}
		}
		const arrayBuffer = await response.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);
		if (buffer.byteLength > DEFAULT_IMAGE_MAX_BYTES) {
			throw new Error(`Image exceeds ${DEFAULT_IMAGE_MAX_BYTES} bytes: ${source}`);
		}
		const mimeType = detectImageMimeType({
			buffer,
			filePath: source,
			contentType: response.headers.get("content-type"),
		});
		if (!mimeType) {
			throw new Error(`Unsupported image type: ${source}`);
		}
		return {
			text: `<file name="${source}"></file>\n`,
			image: {
				type: "image",
				data: buffer.toString("base64"),
				mimeType,
			},
		};
	}

	const filePath = isFileUrl(source)
		? fileURLToPath(new URL(source))
		: resolveLocalPath(source, cwd);
	const label = filePath;
	const buffer = await readFile(filePath);
	if (buffer.byteLength === 0) {
		throw new Error(`Image file is empty: ${label}`);
	}
	if (buffer.byteLength > DEFAULT_IMAGE_MAX_BYTES) {
		throw new Error(`Image exceeds ${DEFAULT_IMAGE_MAX_BYTES} bytes: ${label}`);
	}
	const mimeType = detectImageMimeType({
		buffer,
		filePath,
	});
	if (!mimeType) {
		throw new Error(`Unsupported image type: ${label}`);
	}
	return {
		text: `<file name="${label}"></file>\n`,
		image: {
			type: "image",
			data: buffer.toString("base64"),
			mimeType,
		},
	};
}

export async function prepareCliPromptInput(
	options: CliPromptInputOptions = {},
): Promise<CliPromptInput> {
	const cwd = options.cwd ?? process.cwd();
	const textSegments: string[] = [];
	const images: ImageContent[] = [];

	for (const value of options.files ?? []) {
		const trimmed = value.trim();
		if (!trimmed) {
			continue;
		}
		const absolutePath = resolveLocalPath(trimmed, cwd);
		const fileInput = await loadLocalFileInput(absolutePath);
		if (fileInput.text) {
			textSegments.push(fileInput.text);
		}
		if (fileInput.image) {
			images.push(fileInput.image);
		}
	}

	for (const value of options.images ?? []) {
		const trimmed = value.trim();
		if (!trimmed) {
			continue;
		}
		const imageInput = await loadImageFromSource(trimmed, cwd);
		textSegments.push(imageInput.text);
		images.push(imageInput.image);
	}

	return {
		text: mergeSegments(textSegments),
		...(images.length > 0 ? { images } : {}),
	};
}
