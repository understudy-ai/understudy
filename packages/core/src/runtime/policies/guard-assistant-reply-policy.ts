import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { RuntimePolicy } from "../policy-pipeline.js";

type ReplyMessage = AgentMessage & {
	content?: unknown;
};

function hasRenderableContent(message: unknown): boolean {
	if (!message || typeof message !== "object") return false;
	const candidate = message as Record<string, unknown>;
	const content = candidate.content;
	if (typeof content === "string") {
		return content.trim().length > 0;
	}
	if (!Array.isArray(content)) {
		return false;
	}
	return content.some((item) => {
		if (!item || typeof item !== "object") return false;
		const chunk = item as Record<string, unknown>;
		return chunk.type === "text" && typeof chunk.text === "string" && chunk.text.trim().length > 0;
	});
}

function hasToolCallContent(message: unknown): boolean {
	if (!message || typeof message !== "object") return false;
	const candidate = message as Record<string, unknown>;
	const content = candidate.content;
	if (!Array.isArray(content)) {
		return false;
	}
	return content.some((item) => {
		if (!item || typeof item !== "object") return false;
		const chunk = item as Record<string, unknown>;
		return chunk.type === "toolCall";
	});
}

function hasRenderableMediaContent(message: unknown): boolean {
	if (!message || typeof message !== "object") return false;
	const candidate = message as Record<string, unknown>;
	const content = candidate.content;
	if (!Array.isArray(content)) {
		return false;
	}
	return content.some((item) => {
		if (!item || typeof item !== "object") return false;
		const chunk = item as Record<string, unknown>;
		return chunk.type === "image" &&
			typeof chunk.mimeType === "string" &&
			chunk.mimeType.startsWith("image/") &&
			(typeof chunk.data === "string" || typeof chunk.imageData === "string");
	});
}

/**
 * Guarantees assistant messages contain user-visible content.
 * Tool-call-only assistant messages are valid and should pass through.
 */
export function createGuardAssistantReplyPolicy(): RuntimePolicy {
	return {
		name: "guard_assistant_reply",
		beforeReply: (_context, input) => {
			if (
				hasRenderableContent(input.message) ||
				hasToolCallContent(input.message) ||
				hasRenderableMediaContent(input.message)
			) {
				return;
			}
			const message: ReplyMessage = {
				...input.message,
				content: [{ type: "text", text: "Assistant produced no renderable output." }],
			};
			return {
				message,
			};
		},
	};
}
