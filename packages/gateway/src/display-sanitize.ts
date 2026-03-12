import { stripInlineDirectiveTagsForDisplay } from "@understudy/core";

type MessageTextPart = {
	type: "text";
	text: string;
} & Record<string, unknown>;

type MessageRecord = Record<string, unknown>;

function isMessageTextPart(part: unknown): part is MessageTextPart {
	return Boolean(part) && typeof part === "object" && (part as { type?: unknown }).type === "text" &&
		typeof (part as { text?: unknown }).text === "string";
}

function sanitizeAssistantDisplayText(text: string): string {
	return stripInlineDirectiveTagsForDisplay(text).text;
}

export function sanitizeResponsePayload(result: unknown): unknown {
	if (typeof result === "string") {
		return sanitizeAssistantDisplayText(result);
	}
	if (!result || typeof result !== "object") {
		return result;
	}
	const record = result as MessageRecord;
	if (typeof record.response !== "string") {
		return result;
	}
	const response = sanitizeAssistantDisplayText(record.response);
	return response === record.response ? result : { ...record, response };
}

function sanitizeAssistantHistoryMessage(message: unknown): { message: unknown; changed: boolean } {
	if (!message || typeof message !== "object") {
		return { message, changed: false };
	}
	const record = message as MessageRecord;
	if (record.role !== "assistant") {
		return { message, changed: false };
	}
	let changed = false;
	const sanitized: MessageRecord = { ...record };

	if (typeof sanitized.text === "string") {
		const text = sanitizeAssistantDisplayText(sanitized.text);
		if (text !== sanitized.text) {
			sanitized.text = text;
			changed = true;
		}
	}

	if (typeof sanitized.content === "string") {
		const content = sanitizeAssistantDisplayText(sanitized.content);
		if (content !== sanitized.content) {
			sanitized.content = content;
			changed = true;
		}
	} else if (Array.isArray(sanitized.content)) {
		const nextContent = sanitized.content.map((part) => {
			if (!isMessageTextPart(part)) {
				return part;
			}
			const text = sanitizeAssistantDisplayText(part.text);
			if (text === part.text) {
				return part;
			}
			changed = true;
			return { ...part, text };
		});
		if (changed) {
			sanitized.content = nextContent;
		}
	}

	return { message: changed ? sanitized : message, changed };
}

export function sanitizeHistoryPayload(result: unknown): unknown {
	if (!result || typeof result !== "object") {
		return result;
	}
	const record = result as MessageRecord;
	if (!Array.isArray(record.messages)) {
		return result;
	}
	let changed = false;
	const messages = record.messages.map((message) => {
		const sanitized = sanitizeAssistantHistoryMessage(message);
		changed ||= sanitized.changed;
		return sanitized.message;
	});
	return changed ? { ...record, messages } : result;
}
