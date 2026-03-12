import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_EMBEDDED_IMAGE_BYTES = 5 * 1024 * 1024;

export interface ImageProbe {
	mimeType: string;
	width?: number;
	height?: number;
}

export interface LoadedImageSource {
	source: string;
	bytes: Buffer;
	probe: ImageProbe;
	localPath?: string;
}

export function isHttpUrl(value: string): boolean {
	return value.startsWith("http://") || value.startsWith("https://");
}

export function isFileUrl(value: string): boolean {
	return value.startsWith("file://");
}

export async function loadImageSource(
	source: string,
	maxBytes = DEFAULT_MAX_IMAGE_BYTES,
): Promise<LoadedImageSource> {
	if (isHttpUrl(source)) {
		const response = await fetch(source);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} when fetching image`);
		}
		const arrayBuffer = await response.arrayBuffer();
		const bytes = Buffer.from(arrayBuffer);
		if (bytes.byteLength > maxBytes) {
			throw new Error(`Image exceeds maxBytes (${maxBytes})`);
		}
		return {
			source,
			bytes,
			probe: probeImage(bytes),
		};
	}

	const localPath = isFileUrl(source)
		? fileURLToPath(new URL(source))
		: resolvePath(source);
	const bytes = await readFile(localPath);
	if (bytes.byteLength > maxBytes) {
		throw new Error(`Image exceeds maxBytes (${maxBytes})`);
	}
	return {
		source: localPath,
		bytes,
		localPath,
		probe: probeImage(bytes),
	};
}

export function toSha256(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export function mimeTypeToExtension(mimeType: string): string {
	switch (mimeType.trim().toLowerCase()) {
		case "image/jpeg":
			return ".jpg";
		case "image/png":
			return ".png";
		case "image/gif":
			return ".gif";
		case "image/webp":
			return ".webp";
		case "image/bmp":
			return ".bmp";
		default:
			return extname(mimeType).trim().toLowerCase() || ".img";
	}
}

export function detectMimeType(bytes: Buffer): string {
	if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
		return "image/png";
	}
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return "image/jpeg";
	}
	if (bytes.length >= 6) {
		const header = bytes.subarray(0, 6).toString("ascii");
		if (header === "GIF87a" || header === "GIF89a") {
			return "image/gif";
		}
	}
	if (
		bytes.length >= 12 &&
		bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
		bytes.subarray(8, 12).toString("ascii") === "WEBP"
	) {
		return "image/webp";
	}
	if (bytes.length >= 2 && bytes.subarray(0, 2).toString("ascii") === "BM") {
		return "image/bmp";
	}
	return "application/octet-stream";
}

export function probeImage(bytes: Buffer): ImageProbe {
	const mimeType = detectMimeType(bytes);
	switch (mimeType) {
		case "image/png": {
			const size = parsePngSize(bytes);
			return { mimeType, width: size?.width, height: size?.height };
		}
		case "image/gif": {
			const size = parseGifSize(bytes);
			return { mimeType, width: size?.width, height: size?.height };
		}
		case "image/jpeg": {
			const size = parseJpegSize(bytes);
			return { mimeType, width: size?.width, height: size?.height };
		}
		case "image/webp": {
			const size = parseWebpSize(bytes);
			return { mimeType, width: size?.width, height: size?.height };
		}
		default:
			return { mimeType };
	}
}

function parsePngSize(bytes: Buffer): { width: number; height: number } | undefined {
	if (bytes.length < 24) return undefined;
	return {
		width: bytes.readUInt32BE(16),
		height: bytes.readUInt32BE(20),
	};
}

function parseGifSize(bytes: Buffer): { width: number; height: number } | undefined {
	if (bytes.length < 10) return undefined;
	return {
		width: bytes.readUInt16LE(6),
		height: bytes.readUInt16LE(8),
	};
}

function parseJpegSize(bytes: Buffer): { width: number; height: number } | undefined {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
	let offset = 2;
	while (offset + 4 < bytes.length) {
		if (bytes[offset] !== 0xff) {
			offset += 1;
			continue;
		}
		const marker = bytes[offset + 1];
		const blockLength = bytes.readUInt16BE(offset + 2);
		if (blockLength < 2) return undefined;
		const isSofMarker =
			(marker >= 0xc0 && marker <= 0xc3) ||
			(marker >= 0xc5 && marker <= 0xc7) ||
			(marker >= 0xc9 && marker <= 0xcb) ||
			(marker >= 0xcd && marker <= 0xcf);
		if (isSofMarker) {
			if (offset + 9 >= bytes.length) return undefined;
			const height = bytes.readUInt16BE(offset + 5);
			const width = bytes.readUInt16BE(offset + 7);
			return { width, height };
		}
		offset += 2 + blockLength;
	}
	return undefined;
}

function parseWebpSize(bytes: Buffer): { width: number; height: number } | undefined {
	if (bytes.length < 30) return undefined;
	const chunk = bytes.subarray(12, 16).toString("ascii");
	if (chunk === "VP8 ") {
		const width = bytes.readUInt16LE(26) & 0x3fff;
		const height = bytes.readUInt16LE(28) & 0x3fff;
		return { width, height };
	}
	if (chunk === "VP8L") {
		if (bytes.length < 25) return undefined;
		const b0 = bytes[21];
		const b1 = bytes[22];
		const b2 = bytes[23];
		const b3 = bytes[24];
		const width = 1 + (((b1 & 0x3f) << 8) | b0);
		const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
		return { width, height };
	}
	if (chunk === "VP8X") {
		if (bytes.length < 30) return undefined;
		const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
		const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
		return { width, height };
	}
	return undefined;
}
