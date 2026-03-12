import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import {
	DEFAULT_MAX_IMAGE_BYTES,
	MAX_EMBEDDED_IMAGE_BYTES,
	loadImageSource,
	toSha256,
} from "./image-shared.js";
import { textResult } from "./bridge/bridge-rpc.js";

const ImageSchema = Type.Object({
	image: Type.String({
		description: "Local path or http(s) URL of the image to inspect.",
	}),
	includeBase64: Type.Optional(
		Type.Boolean({
			description: "Include a base64 image payload in the tool result content.",
		}),
	),
	maxBytes: Type.Optional(
		Type.Number({
			description: "Maximum bytes to read (default 10MB).",
		}),
	),
});

type ImageParams = Static<typeof ImageSchema>;

export function createImageTool(): AgentTool<typeof ImageSchema> {
	return {
		name: "image",
		label: "Image",
		description:
			"Inspect a local or remote image and return metadata (mime, size, dimensions, hash).",
		parameters: ImageSchema,
		execute: async (_toolCallId, params: ImageParams): Promise<AgentToolResult<unknown>> => {
			const maxBytes = Math.max(1_024, Math.floor(params.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES));
			try {
				const loaded = await loadImageSource(params.image, maxBytes);
				const probe = loaded.probe;
				const details: Record<string, unknown> = {
					source: loaded.source,
					mimeType: probe.mimeType,
					sizeBytes: loaded.bytes.byteLength,
					width: probe.width,
					height: probe.height,
					sha256: toSha256(loaded.bytes),
				};
				const lines = [
					`Image: ${loaded.source}`,
					`MIME: ${probe.mimeType}`,
					`Bytes: ${loaded.bytes.byteLength}`,
					`Dimensions: ${probe.width && probe.height ? `${probe.width}x${probe.height}` : "unknown"}`,
					`SHA256: ${String(details.sha256)}`,
				];

				if (params.includeBase64 === true) {
					if (loaded.bytes.byteLength > MAX_EMBEDDED_IMAGE_BYTES) {
						return textResult(
							`${lines.join("\n")}\nBase64 omitted: image exceeds ${MAX_EMBEDDED_IMAGE_BYTES} bytes.`,
							details,
						);
					}
					return {
						content: [
							{ type: "text", text: lines.join("\n") },
							{
								type: "image",
								data: loaded.bytes.toString("base64"),
								mimeType: probe.mimeType,
							} as any,
						],
						details,
					};
				}

				return textResult(lines.join("\n"), details);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return textResult(`Failed to inspect image: ${message}`, { error: message });
			}
		},
	};
}
