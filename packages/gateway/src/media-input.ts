import { readFile } from "node:fs/promises";
import { extname, resolve as resolvePath } from "node:path";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { Attachment } from "@understudy/types";

const DEFAULT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_TEXT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_TEXT_ATTACHMENT_MAX_CHARS = 200_000;
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
	".txt",
	".md",
	".markdown",
	".log",
	".json",
	".jsonl",
	".yaml",
	".yml",
	".toml",
	".ini",
	".cfg",
	".conf",
	".csv",
	".tsv",
	".xml",
	".html",
	".htm",
	".css",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".ts",
	".tsx",
	".py",
	".sh",
	".bash",
	".zsh",
	".sql",
	".graphql",
	".gql",
]);

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("\"", "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function buildAttachmentTag(attachment: Attachment): string {
	const name = attachment.name?.trim();
	const source = attachment.url.trim();
	const label = name && name.length > 0 ? name : source;
	if (!source || source === label) {
		return `<file name="${escapeXml(label)}"></file>`;
	}
	return `<file name="${escapeXml(label)}" source="${escapeXml(source)}"></file>`;
}

function isHttpUrl(value: string): boolean {
	return value.startsWith("http://") || value.startsWith("https://");
}

function isFileUrl(value: string): boolean {
	return value.startsWith("file://");
}

function detectMimeTypeFromPath(filePath: string, fallback?: string): string | undefined {
	const normalizedFallback = fallback?.trim().toLowerCase();
	if (normalizedFallback) {
		return normalizedFallback;
	}
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

function isImageAttachment(attachment: Attachment): boolean {
	return attachment.type === "image";
}

function isTextLikeMimeType(value: string | undefined): boolean {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) {
		return false;
	}
	return (
		normalized.startsWith("text/") ||
		normalized === "application/json" ||
		normalized === "application/ld+json" ||
		normalized === "application/xml" ||
		normalized === "application/yaml" ||
		normalized === "application/x-yaml" ||
		normalized === "application/toml" ||
		normalized === "application/x-sh" ||
		normalized.endsWith("+json") ||
		normalized.endsWith("+xml")
	);
}

function isLikelyTextAttachment(attachment: Attachment): boolean {
	if (isTextLikeMimeType(attachment.mimeType)) {
		return true;
	}
	return TEXT_ATTACHMENT_EXTENSIONS.has(extname(attachment.url.trim()).toLowerCase());
}

function clampText(value: string): string {
	return value.length <= DEFAULT_TEXT_ATTACHMENT_MAX_CHARS
		? value
		: value.slice(0, DEFAULT_TEXT_ATTACHMENT_MAX_CHARS);
}

async function loadAttachmentText(attachment: Attachment): Promise<string | null> {
	if (isImageAttachment(attachment) || !isLikelyTextAttachment(attachment)) {
		return null;
	}
	const source = attachment.url.trim();
	if (!source) {
		return null;
	}

	let bytes: Buffer;
	if (isHttpUrl(source)) {
		const response = await fetch(source);
		if (!response.ok) {
			throw new Error(`Failed to fetch text attachment: HTTP ${response.status}`);
		}
		const arrayBuffer = await response.arrayBuffer();
		bytes = Buffer.from(arrayBuffer);
	} else {
		const resolvedPath = isFileUrl(source)
			? new URL(source)
			: resolvePath(source);
		bytes = await readFile(resolvedPath);
	}

	if (bytes.byteLength > DEFAULT_TEXT_ATTACHMENT_MAX_BYTES) {
		throw new Error(
			`Text attachment exceeds ${DEFAULT_TEXT_ATTACHMENT_MAX_BYTES} bytes: ${attachment.url}`,
		);
	}

	return clampText(bytes.toString("utf8"));
}

async function buildAttachmentPromptBlock(attachment: Attachment): Promise<{
	text: string;
	image?: ImageContent;
}> {
	const image = await loadAttachmentImage(attachment);
	if (image) {
		return {
			text: buildAttachmentTag(attachment),
			image,
		};
	}

	const text = await loadAttachmentText(attachment);
	if (text !== null) {
		return {
			text: `${buildAttachmentTag(attachment).replace("</file>", "")}\n${text}\n</file>`,
		};
	}

	return {
		text: buildAttachmentTag(attachment),
	};
}

async function loadAttachmentImage(attachment: Attachment): Promise<ImageContent | null> {
	if (!isImageAttachment(attachment)) {
		return null;
	}
	const source = attachment.url.trim();
	if (!source) {
		return null;
	}

	let bytes: Buffer;
	let mimeType = detectMimeTypeFromPath(source, attachment.mimeType);

	if (isHttpUrl(source)) {
		const response = await fetch(source);
		if (!response.ok) {
			throw new Error(`Failed to fetch image attachment: HTTP ${response.status}`);
		}
		const arrayBuffer = await response.arrayBuffer();
		bytes = Buffer.from(arrayBuffer);
		mimeType = detectMimeTypeFromPath(
			source,
			response.headers.get("content-type") ?? mimeType,
		);
	} else {
		const resolvedPath = isFileUrl(source)
			? new URL(source)
			: resolvePath(source);
		bytes = await readFile(resolvedPath);
	}

	if (bytes.byteLength > DEFAULT_IMAGE_MAX_BYTES) {
		throw new Error(
			`Image attachment exceeds ${DEFAULT_IMAGE_MAX_BYTES} bytes: ${attachment.url}`,
		);
	}
	if (!mimeType?.startsWith("image/")) {
		return null;
	}

	return {
		type: "image",
		data: bytes.toString("base64"),
		mimeType,
	};
}

function normalizeTextWithAttachments(params: {
	text: string;
	attachmentBlocks: string[];
	imageCount: number;
}): string {
	const baseText = params.text.trim();
	const attachmentTags = params.attachmentBlocks;
	if (attachmentTags.length === 0) {
		return baseText;
	}
	const attachmentHeader = attachmentTags.join("\n");
	if (baseText.length > 0) {
		return `${baseText}\n\n${attachmentHeader}`;
	}
	if (params.imageCount > 0) {
		return `Please inspect the attached image${params.imageCount > 1 ? "s" : ""}.\n\n${attachmentHeader}`;
	}
	return `Please inspect the attached file${attachmentTags.length > 1 ? "s" : ""}.\n\n${attachmentHeader}`;
}

export async function buildPromptInputFromMedia(params: {
	text: string;
	images?: ImageContent[];
	attachments?: Attachment[];
}): Promise<{ text: string; promptOptions?: { images?: ImageContent[] } }> {
	const attachments = Array.isArray(params.attachments)
		? params.attachments.filter(
			(attachment): attachment is Attachment =>
				Boolean(attachment) &&
				typeof attachment === "object" &&
				typeof attachment.url === "string" &&
				typeof attachment.type === "string",
		)
		: [];
	const promptImages: ImageContent[] = [];
	const existingImages = Array.isArray(params.images)
		? params.images.filter(
			(image): image is ImageContent =>
				Boolean(image) &&
				typeof image === "object" &&
				image.type === "image" &&
				typeof image.data === "string" &&
				typeof image.mimeType === "string",
			)
		: [];
	promptImages.push(...existingImages);
	const attachmentBlocks: string[] = [];
	for (const attachment of attachments) {
		const prepared = await buildAttachmentPromptBlock(attachment);
		attachmentBlocks.push(prepared.text);
		if (prepared.image) {
			promptImages.push(prepared.image);
		}
	}

	const text = normalizeTextWithAttachments({
		text: params.text,
		attachmentBlocks,
		imageCount: promptImages.length,
	});

	return promptImages.length > 0
		? { text, promptOptions: { images: promptImages } }
		: { text };
}
