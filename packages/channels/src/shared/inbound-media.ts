import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveUnderstudyHomeDir } from "@understudy/core";
import type { Attachment } from "@understudy/types";
import { extFromMimeType, normalizeMimeType } from "./media-utils.js";

const DEFAULT_MAX_INBOUND_BYTES = 20 * 1024 * 1024;

function extFromFileName(fileName?: string): string | undefined {
	if (!fileName) return undefined;
	const ext = path.extname(fileName.trim()).toLowerCase();
	return ext.length > 0 ? ext : undefined;
}

function sanitizeFileName(name: string): string {
	const trimmed = name.trim();
	const collapsed = trimmed.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_");
	return collapsed.length > 0 ? collapsed.slice(0, 96) : "attachment";
}

function buildFileName(params: {
	type: Attachment["type"];
	fileName?: string;
	mimeType?: string;
}): string {
	const rawName = params.fileName?.trim();
	const ext = extFromFileName(rawName) ?? extFromMimeType(params.mimeType);
	if (rawName) {
		const parsed = path.parse(rawName);
		const base = sanitizeFileName(parsed.name || parsed.base);
		return `${base}${ext ?? parsed.ext ?? ""}`;
	}
	const base =
		params.type === "image"
			? "image"
			: params.type === "audio"
				? "audio"
				: params.type === "video"
					? "video"
					: "attachment";
	return `${base}${ext ?? ""}`;
}

function buildStorageDir(channelId: string, messageId?: string): string {
	const safeChannel = sanitizeFileName(channelId || "channel");
	const safeMessage = sanitizeFileName(messageId?.trim() || randomUUID());
	return path.join(resolveUnderstudyHomeDir(), "inbound-media", safeChannel, safeMessage);
}

export async function materializeInboundAttachment(params: {
	channelId: string;
	messageId?: string;
	type: Attachment["type"];
	bytes: Uint8Array | Buffer;
	fileName?: string;
	mimeType?: string;
	maxBytes?: number;
}): Promise<Attachment> {
	const bytes = Buffer.isBuffer(params.bytes) ? params.bytes : Buffer.from(params.bytes);
	const maxBytes = Math.max(1_024, params.maxBytes ?? DEFAULT_MAX_INBOUND_BYTES);
	if (bytes.byteLength > maxBytes) {
		throw new Error(`inbound_media_too_large (${bytes.byteLength} > ${maxBytes})`);
	}

	const dir = buildStorageDir(params.channelId, params.messageId);
	await mkdir(dir, { recursive: true, mode: 0o700 });

	const name = buildFileName({
		type: params.type,
		fileName: params.fileName,
		mimeType: params.mimeType,
	});
	const filePath = path.join(dir, name);
	await writeFile(filePath, bytes, { mode: 0o600 });

	return {
		type: params.type,
		url: filePath,
		name,
		mimeType: normalizeMimeType(params.mimeType),
		size: bytes.byteLength,
	};
}

function collectAttachmentLabels(attachments: Attachment[], max = 3): { labels: string[]; suffix: string } {
	const labels = attachments
		.slice(0, max)
		.map((attachment) => attachment.name?.trim() || attachment.type)
		.filter(Boolean);
	const suffix = attachments.length > max ? ", ..." : "";
	return { labels, suffix };
}

function summarizeAttachmentLabels(attachments: Attachment[]): string {
	const { labels, suffix } = collectAttachmentLabels(attachments);
	return labels.join(", ") + suffix;
}

function countAttachmentsByType(attachments: Attachment[]): Record<Attachment["type"], number> {
	return attachments.reduce<Record<Attachment["type"], number>>(
		(acc, attachment) => {
			acc[attachment.type] += 1;
			return acc;
		},
		{
			image: 0,
			file: 0,
			audio: 0,
			video: 0,
		},
	);
}

function describeImageInstruction(imageCount: number, totalCount: number): string {
	if (totalCount === imageCount) {
		return `Please inspect the attached image${imageCount === 1 ? "" : "s"}.`;
	}
	return `Please inspect the attached image${imageCount === 1 ? "" : "s"} and related media.`;
}

function describeNonImageInstruction(counts: Record<Attachment["type"], number>, totalCount: number): string {
	if (counts.file === totalCount) {
		return `Please inspect the attached file${totalCount === 1 ? "" : "s"}.`;
	}
	if (counts.audio === totalCount) {
		return `Please inspect the attached audio clip${totalCount === 1 ? "" : "s"}.`;
	}
	if (counts.video === totalCount) {
		return `Please inspect the attached video${totalCount === 1 ? "" : "s"}.`;
	}
	return "Please inspect the attached media.";
}

function describeMessageTitle(counts: Record<Attachment["type"], number>, totalCount: number): string {
	if (counts.image === totalCount) {
		return "[Image message]";
	}
	if (counts.image > 0) {
		return "[Media message]";
	}
	if (counts.file === totalCount) {
		return "[Attachment message]";
	}
	if (counts.audio === totalCount) {
		return "[Audio message]";
	}
	if (counts.video === totalCount) {
		return "[Video message]";
	}
	return "[Media message]";
}

export function buildInboundMediaPromptText(params: {
	text?: string;
	attachments?: Attachment[];
}): string {
	const attachments = Array.isArray(params.attachments) ? params.attachments : [];
	if (attachments.length === 0) {
		return params.text?.trim() ?? "";
	}
	const baseText = params.text?.trim() ?? "";

	const counts = countAttachmentsByType(attachments);
	const imageCount = counts.image;
	const summary = summarizeAttachmentLabels(attachments);
	const lines: string[] = [];

	if (baseText) {
		lines.push(baseText, "");
	}
	lines.push(describeMessageTitle(counts, attachments.length));
	lines.push(`Attachments: ${summary}`);
	lines.push(
		imageCount > 0
			? describeImageInstruction(imageCount, attachments.length)
			: describeNonImageInstruction(counts, attachments.length),
	);

	return lines.join("\n");
}
