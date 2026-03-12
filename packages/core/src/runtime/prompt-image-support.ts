import { access, readFile } from "node:fs/promises";
import { extname, resolve as resolvePath } from "node:path";
import { constants as fsConstants } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ImageContent, Model } from "@mariozechner/pi-ai";
import { expandHome } from "../runtime-paths.js";

const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const FILE_BLOCK_RE = /<file\b[\s\S]*?<\/file>/gi;
const FILE_TAG_RE = /<file\b[^>]*>/gi;
const FILE_SOURCE_ATTR_RE = /\b(name|src|source|path|url)\s*=\s*("([^"]*)"|'([^']*)')/gi;
const MARKDOWN_IMAGE_RE = /!\[[^\]]*]\(([^)\s]+)\)/gi;
const GENERIC_IMAGE_REF_RE =
	/(?:(?:https?:\/\/|file:\/\/|~\/|\.{1,2}[\\/]|\/|[A-Za-z]:[\\/])?[^\s<>"'`()\]]+\.(?:png|jpe?g|gif|webp|bmp))(?!\w)/gi;
const SUPPRESSED_IMAGE_NOTE =
	"[Understudy note: The active model does not accept image input directly. Use `vision_read` on referenced image paths or URLs when image inspection is needed.]";

export type PromptImageSupportMode = "native" | "sidecar" | "unknown";

export interface PreparedPromptImageSupport {
	text: string;
	options?: Record<string, unknown>;
	mode: PromptImageSupportMode;
	referencedImageSources: string[];
	autoLoadedImages: ImageContent[];
	suppressedImageCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readPromptImages(options: unknown): ImageContent[] {
	if (!isRecord(options) || !Array.isArray(options.images)) {
		return [];
	}
	return options.images.filter(
		(image): image is ImageContent =>
			Boolean(image) &&
			typeof image === "object" &&
			(image as { type?: unknown }).type === "image" &&
			typeof (image as { data?: unknown }).data === "string" &&
			typeof (image as { mimeType?: unknown }).mimeType === "string",
	);
}

function clonePromptOptions(options: unknown): Record<string, unknown> | undefined {
	return isRecord(options) ? { ...options } : undefined;
}

function trimWrappedCandidate(value: string): string {
	let next = value.trim();
	next = next.replace(/^['"`(<[]+/, "");
	next = next.replace(/[>'"`)\],;:!?]+$/, "");
	return next.trim();
}

function stripFileBlocks(text: string): string {
	return text
		.replace(FILE_BLOCK_RE, " ")
		.replace(FILE_TAG_RE, " ");
}

function looksLikeResolvableReference(value: string): boolean {
	return (
		value.startsWith("http://") ||
		value.startsWith("https://") ||
		value.startsWith("file://") ||
		value.startsWith("~/") ||
		value.startsWith("~\\") ||
		value.startsWith("./") ||
		value.startsWith(".\\") ||
		value.startsWith("../") ||
		value.startsWith("..\\") ||
		value.startsWith("/") ||
		value.startsWith("\\") ||
		/^[A-Za-z]:[\\/]/.test(value) ||
		/[\\/]/.test(value)
	);
}

function normalizeReferenceCandidate(
	value: string,
	options: { requireLocator?: boolean } = {},
): string | null {
	const trimmed = trimWrappedCandidate(value);
	if (!trimmed) {
		return null;
	}
	if (options.requireLocator && !looksLikeResolvableReference(trimmed)) {
		return null;
	}
	const lowerExt = extname(trimmed).toLowerCase();
	if (![".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].includes(lowerExt)) {
		return null;
	}
	return trimmed;
}

export function resolvePromptImageSupportMode(
	model: Pick<Model<any>, "input"> | undefined | null,
): PromptImageSupportMode {
	if (!model || !Array.isArray(model.input)) {
		return "unknown";
	}
	return model.input.includes("image") ? "native" : "sidecar";
}

export function buildPromptImageModeGuidance(
	mode: PromptImageSupportMode,
): string {
	switch (mode) {
		case "native":
			return [
				"The active model supports native image input.",
				"When Understudy attaches images to the prompt, inspect them directly before reaching for `vision_read`.",
				"Use `vision_read` only when you specifically need OCR or a second focused pass over a path/URL image.",
			].join("\n");
		case "sidecar":
			return [
				"The active model does not support native image input.",
				"Prompt images are not injected directly on this session.",
				"When the user references screenshots or photos by path or URL, use `vision_read` to inspect them.",
			].join("\n");
		default:
			return [
				"Understudy could not confirm whether the active model supports native image input.",
				"If image understanding matters and the image is referenced by path or URL, prefer `vision_read` for a deterministic read.",
			].join("\n");
	}
}

export function extractReferencedImageSources(text: string): string[] {
	const discovered: Array<{ index: number; candidate: string }> = [];

	for (const match of text.matchAll(FILE_BLOCK_RE)) {
		const block = match[0] ?? "";
		const openingTag = block.match(FILE_TAG_RE)?.[0] ?? "";
		for (const attrMatch of openingTag.matchAll(FILE_SOURCE_ATTR_RE)) {
			const attributeName = (attrMatch[1] ?? "").trim().toLowerCase();
			const candidate = normalizeReferenceCandidate(attrMatch[3] ?? attrMatch[4] ?? "", {
				requireLocator: attributeName === "name",
			});
			if (!candidate) {
				continue;
			}
			discovered.push({
				index: match.index ?? Number.MAX_SAFE_INTEGER,
				candidate,
			});
		}
	}

	const sanitized = stripFileBlocks(text);

	for (const match of sanitized.matchAll(MARKDOWN_IMAGE_RE)) {
		const candidate = normalizeReferenceCandidate(match[1] ?? "");
		if (!candidate) {
			continue;
		}
		discovered.push({
			index: match.index ?? Number.MAX_SAFE_INTEGER,
			candidate,
		});
	}

	for (const match of sanitized.matchAll(GENERIC_IMAGE_REF_RE)) {
		const candidate = normalizeReferenceCandidate(match[0] ?? "");
		if (!candidate) {
			continue;
		}
		discovered.push({
			index: match.index ?? Number.MAX_SAFE_INTEGER,
			candidate,
		});
	}

	discovered.sort((left, right) => left.index - right.index);
	const matches: string[] = [];
	const seen = new Set<string>();
	for (const entry of discovered) {
		if (seen.has(entry.candidate)) {
			continue;
		}
		seen.add(entry.candidate);
		matches.push(entry.candidate);
	}
	return matches;
}

function isHttpUrl(value: string): boolean {
	return value.startsWith("http://") || value.startsWith("https://");
}

function isFileUrl(value: string): boolean {
	return value.startsWith("file://");
}

function detectMimeType(params: { filePath?: string; bytes: Buffer; contentType?: string | null }): string | undefined {
	const normalizedContentType = params.contentType?.split(";")[0]?.trim().toLowerCase();
	if (normalizedContentType?.startsWith("image/")) {
		return normalizedContentType;
	}
	const bytes = params.bytes;
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
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

	switch (extname(params.filePath ?? "").toLowerCase()) {
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

async function readImageFromReference(source: string, cwd: string): Promise<ImageContent | null> {
	let bytes: Buffer;
	let mimeType: string | undefined;
	let filePath: string | undefined;

	if (isHttpUrl(source)) {
		const response = await fetch(source);
		if (!response.ok) {
			return null;
		}
		const arrayBuffer = await response.arrayBuffer();
		bytes = Buffer.from(arrayBuffer);
		mimeType = detectMimeType({
			bytes,
			filePath: source,
			contentType: response.headers.get("content-type"),
		});
	} else {
		filePath = isFileUrl(source)
			? fileURLToPath(new URL(source))
			: resolvePath(cwd, expandHome(source));
		try {
			await access(filePath, fsConstants.R_OK);
		} catch {
			return null;
		}
		bytes = await readFile(filePath);
		mimeType = detectMimeType({ bytes, filePath });
	}

	if (!mimeType?.startsWith("image/")) {
		return null;
	}
	if (bytes.byteLength === 0 || bytes.byteLength > DEFAULT_MAX_IMAGE_BYTES) {
		return null;
	}

	return {
		type: "image",
		data: bytes.toString("base64"),
		mimeType,
	};
}

function appendSuppressedImageNote(text: string): string {
	if (text.includes(SUPPRESSED_IMAGE_NOTE)) {
		return text;
	}
	const trimmed = text.trim();
	return trimmed ? `${trimmed}\n\n${SUPPRESSED_IMAGE_NOTE}` : SUPPRESSED_IMAGE_NOTE;
}

function cleanPromptOptions(options?: Record<string, unknown>): Record<string, unknown> | undefined {
	if (!options) {
		return undefined;
	}
	const next = { ...options };
	if (!Array.isArray(next.images) || next.images.length === 0) {
		delete next.images;
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

export async function preparePromptImageSupport(params: {
	text: string;
	options?: unknown;
	cwd: string;
	model?: Pick<Model<any>, "input"> | null;
}): Promise<PreparedPromptImageSupport> {
	const mode = resolvePromptImageSupportMode(params.model);
	const explicitImages = readPromptImages(params.options);
	const referencedImageSources = extractReferencedImageSources(params.text);
	const clonedOptions = clonePromptOptions(params.options);

	if (mode === "native") {
		const autoLoadedImages: ImageContent[] = [];
		for (const source of referencedImageSources) {
			const image = await readImageFromReference(source, params.cwd);
			if (image) {
				autoLoadedImages.push(image);
			}
		}
		if (explicitImages.length > 0 || autoLoadedImages.length > 0) {
			const nextOptions = clonedOptions ?? {};
			nextOptions.images = [...explicitImages, ...autoLoadedImages];
			return {
				text: params.text,
				options: cleanPromptOptions(nextOptions),
				mode,
				referencedImageSources,
				autoLoadedImages,
				suppressedImageCount: 0,
			};
		}
		return {
			text: params.text,
			options: cleanPromptOptions(clonedOptions),
			mode,
			referencedImageSources,
			autoLoadedImages: [],
			suppressedImageCount: 0,
		};
	}

	if (mode === "sidecar") {
		const suppressedImageCount = explicitImages.length;
		if (clonedOptions) {
			delete clonedOptions.images;
		}
		const shouldNote = suppressedImageCount > 0 || referencedImageSources.length > 0;
		return {
			text: shouldNote ? appendSuppressedImageNote(params.text) : params.text,
			options: cleanPromptOptions(clonedOptions),
			mode,
			referencedImageSources,
			autoLoadedImages: [],
			suppressedImageCount,
		};
	}

	return {
		text: params.text,
		options: cleanPromptOptions(clonedOptions),
		mode,
		referencedImageSources,
		autoLoadedImages: [],
		suppressedImageCount: 0,
	};
}
