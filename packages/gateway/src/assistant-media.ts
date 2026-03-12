import type { ImageContent } from "@mariozechner/pi-ai";
import type { Attachment } from "@understudy/types";
import { asRecord, asString } from "./value-coerce.js";

export const NON_RENDERABLE_ASSISTANT_RESPONSE = "Assistant produced no renderable output.";

const MAX_RENDERABLE_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_INLINE_IMAGE_DATA_CHARS = Math.ceil((MAX_RENDERABLE_IMAGE_BYTES * 4) / 3);

function normalizeImageCandidate(candidate: unknown): ImageContent | undefined {
	const record = asRecord(candidate);
	if (!record) {
		return undefined;
	}
	const type = asString(record.type);
	if (type && type !== "image") {
		return undefined;
	}
	const mimeType = asString(record.mimeType);
	const data = asString(record.data) ?? asString(record.imageData);
	if (!mimeType?.startsWith("image/") || !data || data.length > MAX_INLINE_IMAGE_DATA_CHARS) {
		return undefined;
	}
	return {
		type: "image",
		mimeType,
		data,
	};
}

function collectImageCandidateArrays(value: unknown): unknown[][] {
	const arrays: unknown[][] = [];
	if (Array.isArray(value)) {
		arrays.push(value);
	}
	const record = asRecord(value);
	if (!record) {
		return arrays;
	}
	if (Array.isArray(record.images)) {
		arrays.push(record.images);
	}
	if (Array.isArray(record.content)) {
		arrays.push(record.content);
	}
	if (Array.isArray(record.toolTrace)) {
		arrays.push(record.toolTrace);
	}
	return arrays;
}

export function extractRenderableAssistantImages(
	value: unknown,
	options?: { limit?: number },
): ImageContent[] | undefined {
	const candidateArrays = collectImageCandidateArrays(value);
	if (candidateArrays.length === 0) {
		return undefined;
	}
	const limit = Math.max(1, Math.floor(options?.limit ?? 4));
	const images: ImageContent[] = [];
	const seen = new Set<string>();

	const pushImage = (candidate: unknown): boolean => {
		const image = normalizeImageCandidate(candidate);
		if (!image) {
			return false;
		}
		const key = `${image.mimeType}:${image.data.length}:${image.data.slice(0, 48)}`;
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		images.push(image);
		return images.length >= limit;
	};

	for (const candidates of candidateArrays) {
		for (const candidate of candidates) {
			if (pushImage(candidate)) {
				return images;
			}
			const nestedImages = Array.isArray(asRecord(candidate)?.images)
				? asRecord(candidate)?.images as unknown[]
				: [];
			for (const nestedCandidate of nestedImages) {
				if (pushImage(nestedCandidate)) {
					return images;
				}
			}
		}
	}
	return images.length > 0 ? images : undefined;
}

function extensionForMimeType(mimeType: string): string {
	switch (mimeType) {
		case "image/jpeg":
			return ".jpg";
		case "image/webp":
			return ".webp";
		case "image/gif":
			return ".gif";
		default:
			return ".png";
	}
}

export function buildInlineImageAttachments(images: ImageContent[] | undefined): Attachment[] | undefined {
	if (!Array.isArray(images) || images.length === 0) {
		return undefined;
	}
	return images.map((image, index) => ({
		type: "image",
		url: `data:${image.mimeType};base64,${image.data}`,
		name: `understudy-image-${index + 1}${extensionForMimeType(image.mimeType)}`,
		mimeType: image.mimeType,
	}));
}

export function hasRenderableAssistantMedia(params: {
	images?: ImageContent[];
	attachments?: Attachment[];
} | undefined): boolean {
	return Boolean((params?.images?.length ?? 0) > 0 || (params?.attachments?.length ?? 0) > 0);
}

export function normalizeAssistantRenderableText(
	text: string | undefined,
	params?: {
		images?: ImageContent[];
		attachments?: Attachment[];
	},
): string {
	const normalized = typeof text === "string" ? text : "";
	if (
		normalized.trim() === NON_RENDERABLE_ASSISTANT_RESPONSE &&
		hasRenderableAssistantMedia(params)
	) {
		return "";
	}
	return normalized;
}
