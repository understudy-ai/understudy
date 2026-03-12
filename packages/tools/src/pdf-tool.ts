import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { isHttpUrl, toSha256 } from "./image-shared.js";
import { textResult } from "./bridge/bridge-rpc.js";

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_CHARS = 16_000;

const PdfSchema = Type.Object({
	action: Type.Optional(
		Type.String({
			description: 'Action: "inspect" or "extract" (default: "inspect").',
		}),
	),
	pdf: Type.String({
		description: "Local path or http(s) URL to a PDF.",
	}),
	maxBytes: Type.Optional(Type.Number({ description: "Maximum PDF bytes to read (default 20MB)." })),
	maxChars: Type.Optional(Type.Number({ description: "Maximum extracted text chars (default 16000)." })),
});

type PdfParams = Static<typeof PdfSchema>;

async function loadPdfBytes(source: string, maxBytes: number): Promise<{ source: string; bytes: Buffer }> {
	if (isHttpUrl(source)) {
		const response = await fetch(source);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} when fetching PDF`);
		}
		const arrayBuffer = await response.arrayBuffer();
		const bytes = Buffer.from(arrayBuffer);
		if (bytes.byteLength > maxBytes) {
			throw new Error(`PDF exceeds maxBytes (${maxBytes})`);
		}
		return { source, bytes };
	}
	const resolved = resolvePath(source);
	const bytes = await readFile(resolved);
	if (bytes.byteLength > maxBytes) {
		throw new Error(`PDF exceeds maxBytes (${maxBytes})`);
	}
	return { source: resolved, bytes };
}

function assertPdfHeader(bytes: Buffer): void {
	if (bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
		throw new Error("Input is not a PDF (missing %PDF- header)");
	}
}

function estimatePageCount(rawText: string): number {
	const matches = rawText.match(/\/Type\s*\/Page\b/g);
	return matches ? matches.length : 0;
}

function decodePdfLiteral(value: string): string {
	return value
		.replace(/\\\(/g, "(")
		.replace(/\\\)/g, ")")
		.replace(/\\n/g, "\n")
		.replace(/\\r/g, "\r")
		.replace(/\\t/g, "\t")
		.replace(/\\\\/g, "\\");
}

function extractPdfText(rawText: string): string {
	const tjMatches = [...rawText.matchAll(/\((?:\\.|[^\\)])*\)\s*T[Jj]/g)].map((match) => {
		const whole = match[0];
		const literal = whole.slice(1, whole.lastIndexOf(")"));
		return decodePdfLiteral(literal);
	});
	if (tjMatches.length > 0) {
		return tjMatches.join("\n");
	}

	const ascii = Array.from(rawText)
		.map((char) => {
			const code = char.charCodeAt(0);
			if ((code >= 32 && code <= 126) || code === 9 || code === 10 || code === 13) {
				return char;
			}
			return " ";
		})
		.join("")
		.split(/\s+/)
		.filter((part) => part.length >= 3)
		.join(" ")
		.trim();
	return ascii;
}

export function createPdfTool(): AgentTool<typeof PdfSchema> {
	return {
		name: "pdf",
		label: "PDF",
		description:
			"Inspect a PDF and optionally extract text. Supports local files and http(s) URLs.",
		parameters: PdfSchema,
		execute: async (_toolCallId, params: PdfParams): Promise<AgentToolResult<unknown>> => {
			const action = (params.action?.trim().toLowerCase() || "inspect") as "inspect" | "extract";
			const maxBytes = Math.max(1_024, Math.floor(params.maxBytes ?? DEFAULT_MAX_BYTES));
			const maxChars = Math.max(256, Math.floor(params.maxChars ?? DEFAULT_MAX_CHARS));

			try {
				const loaded = await loadPdfBytes(params.pdf, maxBytes);
				assertPdfHeader(loaded.bytes);
				const rawText = loaded.bytes.toString("latin1");
				const pages = estimatePageCount(rawText);
				const details: Record<string, unknown> = {
					source: loaded.source,
					sizeBytes: loaded.bytes.byteLength,
					sha256: toSha256(loaded.bytes),
					pages,
				};

				if (action === "inspect") {
					return textResult(
						[
							`PDF: ${loaded.source}`,
							`Bytes: ${loaded.bytes.byteLength}`,
							`Estimated Pages: ${pages > 0 ? pages : "unknown"}`,
							`SHA256: ${String(details.sha256)}`,
						].join("\n"),
						details,
					);
				}

				if (action === "extract") {
					const extracted = extractPdfText(rawText);
					if (!extracted) {
						return textResult("No extractable text found in PDF.", {
							...details,
							extractedChars: 0,
						});
					}
					const truncated = extracted.length > maxChars;
					const text = truncated ? extracted.slice(0, maxChars) : extracted;
					return textResult(
						`PDF Text (${loaded.source}):\n${text}${truncated ? "\n\n[truncated]" : ""}`,
						{
							...details,
							extractedChars: text.length,
							truncated,
						},
					);
				}

				return textResult(`Unknown action: ${params.action}`, { error: "unknown action" });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return textResult(`PDF tool failed: ${message}`, { error: message });
			}
		},
	};
}
