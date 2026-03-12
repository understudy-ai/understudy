import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { extFromMimeType, normalizeMimeType, resolveUnderstudyHomeDir } from "@understudy/core";
import type { Attachment } from "@understudy/types";

const DEFAULT_MAX_OUTBOUND_BYTES = 20 * 1024 * 1024;

function sanitizeFileName(name: string): string {
	const trimmed = name.trim();
	const collapsed = trimmed.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_");
	return collapsed.length > 0 ? collapsed.slice(0, 96) : "attachment";
}

function extFromFileName(fileName?: string): string | undefined {
	if (!fileName) return undefined;
	const ext = path.extname(fileName.trim()).toLowerCase();
	return ext.length > 0 ? ext : undefined;
}

function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

function deriveAttachmentName(attachment: Attachment, mimeType?: string): string {
	const explicitName = attachment.name?.trim();
	if (explicitName) {
		const parsed = path.parse(explicitName);
		const ext = extFromFileName(explicitName) ?? extFromMimeType(mimeType);
		return `${sanitizeFileName(parsed.name || parsed.base)}${ext ?? parsed.ext ?? ""}`;
	}
	if (isHttpUrl(attachment.url)) {
		try {
			const url = new URL(attachment.url);
			const candidate = decodeURIComponent(path.basename(url.pathname));
			if (candidate) {
				const parsed = path.parse(candidate);
				const ext = extFromFileName(candidate) ?? extFromMimeType(mimeType);
				return `${sanitizeFileName(parsed.name || parsed.base)}${ext ?? parsed.ext ?? ""}`;
			}
		} catch {
			// ignore parse failures
		}
	} else {
		const candidate = path.basename(attachment.url.trim());
		if (candidate) {
			const parsed = path.parse(candidate);
			const ext = extFromFileName(candidate) ?? extFromMimeType(mimeType);
			return `${sanitizeFileName(parsed.name || parsed.base)}${ext ?? parsed.ext ?? ""}`;
		}
	}
	const base =
		attachment.type === "image"
			? "image"
			: attachment.type === "audio"
				? "audio"
				: attachment.type === "video"
					? "video"
					: "attachment";
	return `${base}${extFromMimeType(mimeType) ?? ""}`;
}

function enforceMaxBytes(bytes: Buffer, maxBytes: number): void {
	if (bytes.byteLength > maxBytes) {
		throw new Error(`outbound_media_too_large (${bytes.byteLength} > ${maxBytes})`);
	}
}

export function parseBase64DataUrl(url: string): { mimeType: string; bytes: Buffer } | undefined {
	const match = url.match(/^data:([^;,]+);base64,([\s\S]+)$/);
	if (!match) {
		return undefined;
	}
	return {
		mimeType: normalizeMimeType(match[1] ?? "application/octet-stream") ?? "application/octet-stream",
		bytes: Buffer.from(match[2] ?? "", "base64"),
	};
}

export interface OutboundAttachmentBytes {
	bytes: Buffer;
	mimeType?: string;
	name: string;
	size: number;
}

export interface MaterializedOutboundAttachment {
	filePath: string;
	mimeType?: string;
	name: string;
	size?: number;
	cleanup?: () => Promise<void>;
}

export async function readOutboundAttachmentBytes(
	attachment: Attachment,
	options: { maxBytes?: number } = {},
): Promise<OutboundAttachmentBytes> {
	const source = attachment.url.trim();
	if (!source) {
		throw new Error("attachment url is required");
	}
	const maxBytes = Math.max(1_024, options.maxBytes ?? DEFAULT_MAX_OUTBOUND_BYTES);

	const inlineData = parseBase64DataUrl(source);
	if (inlineData) {
		enforceMaxBytes(inlineData.bytes, maxBytes);
		const mimeType = normalizeMimeType(attachment.mimeType ?? inlineData.mimeType);
		return {
			bytes: inlineData.bytes,
			mimeType,
			name: deriveAttachmentName(attachment, mimeType),
			size: inlineData.bytes.byteLength,
		};
	}

	if (isHttpUrl(source)) {
		const response = await fetch(source);
		if (!response.ok) {
			throw new Error(`attachment download failed: HTTP ${response.status}`);
		}
		const bytes = Buffer.from(await response.arrayBuffer());
		enforceMaxBytes(bytes, maxBytes);
		const mimeType = normalizeMimeType(attachment.mimeType ?? response.headers.get("content-type"));
		return {
			bytes,
			mimeType,
			name: deriveAttachmentName(attachment, mimeType),
			size: bytes.byteLength,
		};
	}

	const bytes = await readFile(source);
	enforceMaxBytes(bytes, maxBytes);
	const mimeType = normalizeMimeType(attachment.mimeType);
	return {
		bytes,
		mimeType,
		name: deriveAttachmentName(attachment, mimeType),
		size: bytes.byteLength,
	};
}

export async function materializeOutboundAttachment(
	attachment: Attachment,
	options: {
		channelId: string;
		maxBytes?: number;
	} = {
		channelId: "channel",
	},
): Promise<MaterializedOutboundAttachment> {
	const source = attachment.url.trim();
	if (!source) {
		throw new Error("attachment url is required");
	}
	if (!parseBase64DataUrl(source) && !isHttpUrl(source)) {
		const info = await stat(source);
		return {
			filePath: source,
			mimeType: normalizeMimeType(attachment.mimeType),
			name: deriveAttachmentName(attachment, attachment.mimeType),
			size: info.size,
		};
	}

	const prepared = await readOutboundAttachmentBytes(attachment, options);
	const dir = path.join(
		resolveUnderstudyHomeDir(),
		"outbound-media",
		sanitizeFileName(options.channelId || "channel"),
		randomUUID(),
	);
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const filePath = path.join(dir, prepared.name);
	await writeFile(filePath, prepared.bytes, { mode: 0o600 });
	return {
		filePath,
		mimeType: prepared.mimeType,
		name: prepared.name,
		size: prepared.size,
		cleanup: async () => {
			await rm(dir, { recursive: true, force: true });
		},
	};
}

export function isPublicHttpsAttachmentUrl(attachment: Attachment): boolean {
	try {
		return new URL(attachment.url.trim()).protocol === "https:";
	} catch {
		return false;
	}
}
