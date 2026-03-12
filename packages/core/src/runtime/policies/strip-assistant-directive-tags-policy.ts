import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { stripInlineDirectiveTagsForDisplay } from "../../directive-tags.js";
import type { RuntimePolicy } from "../policy-pipeline.js";

type MessageRecord = Record<string, unknown>;
type MutableAgentMessage = AgentMessage & {
	text?: unknown;
	content?: unknown;
};

function sanitizeText(value: string): { text: string; changed: boolean } {
	return stripInlineDirectiveTagsForDisplay(value);
}

function sanitizeContent(content: unknown): { content: unknown; changed: boolean } {
	if (typeof content === "string") {
		const sanitized = sanitizeText(content);
		return {
			content: sanitized.text,
			changed: sanitized.changed,
		};
	}
	if (!Array.isArray(content)) {
		return { content, changed: false };
	}
	let changed = false;
	const nextContent = content.map((item) => {
		if (!item || typeof item !== "object") {
			return item;
		}
		const chunk = item as MessageRecord;
		if (chunk.type !== "text" || typeof chunk.text !== "string") {
			return item;
		}
		const sanitized = sanitizeText(chunk.text);
		if (!sanitized.changed) {
			return item;
		}
		changed = true;
		return {
			...chunk,
			text: sanitized.text,
		};
	});
	return {
		content: changed ? nextContent : content,
		changed,
	};
}

export function createStripAssistantDirectiveTagsPolicy(): RuntimePolicy {
	return {
		name: "strip_assistant_directive_tags",
		beforeReply: (_context, input) => {
			if (!input.message || typeof input.message !== "object") {
				return;
			}
			let changed = false;
			const nextMessage: MutableAgentMessage = { ...input.message };

			if (typeof nextMessage.text === "string") {
				const sanitized = sanitizeText(nextMessage.text);
				if (sanitized.changed) {
					nextMessage.text = sanitized.text;
					changed = true;
				}
			}

			const sanitizedContent = sanitizeContent(nextMessage.content);
			if (sanitizedContent.changed) {
				nextMessage.content = sanitizedContent.content;
				changed = true;
			}

			if (!changed) {
				return;
			}

			return {
				message: nextMessage,
			};
		},
	};
}
