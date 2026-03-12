import type { Attachment } from "@understudy/types";

function normalizeExplicitAttachmentType(value?: string | null): Attachment["type"] | undefined {
	const normalized = value?.trim().toLowerCase();
	switch (normalized) {
		case "image":
			return "image";
		case "audio":
			return "audio";
		case "video":
			return "video";
		case "file":
			return "file";
		default:
			return undefined;
	}
}

/**
 * Normalize a MIME type string by stripping parameters (for example: charset)
 * and converting to lowercase.
 */
export function normalizeMimeType(value?: string | null): string | undefined {
	const normalized = value?.split(";")[0]?.trim().toLowerCase();
	return normalized && normalized.length > 0 ? normalized : undefined;
}

/**
 * Resolve an attachment type from an explicit type and/or MIME+filename
 * heuristics. Explicit values win when present.
 */
export function resolveAttachmentType(
	mimeType?: string,
	fileName?: string,
	explicitType?: string | null,
): Attachment["type"] {
	const explicit = normalizeExplicitAttachmentType(explicitType);
	if (explicit) return explicit;

	const normalizedMimeType = normalizeMimeType(mimeType);
	if (normalizedMimeType?.startsWith("image/")) return "image";
	if (normalizedMimeType?.startsWith("video/")) return "video";
	if (normalizedMimeType?.startsWith("audio/")) return "audio";

	const normalizedFileName = fileName?.trim().toLowerCase() ?? "";
	if (/\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(normalizedFileName)) return "image";
	if (/\.(mp4|mov|webm|m4v)$/i.test(normalizedFileName)) return "video";
	if (/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(normalizedFileName)) return "audio";
	return "file";
}

const MIME_EXTENSIONS: Record<string, string> = {
	"application/pdf": ".pdf",
	"audio/mpeg": ".mp3",
	"audio/mp4": ".m4a",
	"audio/ogg": ".ogg",
	"audio/wav": ".wav",
	"image/gif": ".gif",
	"image/heic": ".heic",
	"image/heif": ".heif",
	"image/jpeg": ".jpg",
	"image/png": ".png",
	"image/webp": ".webp",
	"text/plain": ".txt",
	"video/mp4": ".mp4",
	"video/quicktime": ".mov",
	"video/webm": ".webm",
};

export function extFromMimeType(mimeType?: string): string | undefined {
	const normalized = normalizeMimeType(mimeType);
	return normalized ? MIME_EXTENSIONS[normalized] : undefined;
}
