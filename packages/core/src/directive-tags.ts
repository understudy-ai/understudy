type StripInlineDirectiveTagsResult = {
	text: string;
	changed: boolean;
};

export type AssistantReplyTarget =
	| { mode: "current" }
	| { mode: "message"; messageId: string };

type NormalizeAssistantDisplayTextResult = {
	text: string;
	changed: boolean;
	silent: boolean;
	replyTarget?: AssistantReplyTarget;
};

const SILENT_REPLY_TOKEN = "[[SILENT]]";
const AUDIO_TAG_PATTERN = String.raw`\[\[\s*audio_as_voice\s*\]\]`;
const REPLY_TAG_PATTERN = String.raw`\[\[\s*(?:reply_to_current|reply_to\s*:\s*[^\]\n]+)\s*\]\]`;
const INLINE_DIRECTIVE_TAG_PATTERN = String.raw`(?:${AUDIO_TAG_PATTERN}|${REPLY_TAG_PATTERN})`;
const REPLY_TARGET_EXTRACT_RE = /\[\[\s*(reply_to_current|reply_to\s*:\s*([^\]\n]+))\s*\]\]/gi;

const INLINE_DIRECTIVE_TAG_RE = new RegExp(INLINE_DIRECTIVE_TAG_PATTERN, "gi");
const LEADING_INLINE_DIRECTIVE_TAG_RE = new RegExp(`^(?:${INLINE_DIRECTIVE_TAG_PATTERN}\\s*)+`, "i");
const TRAILING_INLINE_DIRECTIVE_TAG_RE = new RegExp(`(?:\\s*${INLINE_DIRECTIVE_TAG_PATTERN})+$`, "i");

/**
 * Removes inline control tags like [[reply_to_current]] from user-visible text.
 * If tags were only present at the start/end, trim whitespace introduced by stripping them.
 */
export function stripInlineDirectiveTagsForDisplay(text: string): StripInlineDirectiveTagsResult {
	if (!text) {
		return { text, changed: false };
	}
	const hadLeadingDirective = LEADING_INLINE_DIRECTIVE_TAG_RE.test(text);
	const hadTrailingDirective = TRAILING_INLINE_DIRECTIVE_TAG_RE.test(text);
	const stripped = text.replace(INLINE_DIRECTIVE_TAG_RE, "");
	let normalized = stripped;
	if (hadLeadingDirective) {
		normalized = normalized.replace(/^\s+/, "");
	}
	if (hadTrailingDirective) {
		normalized = normalized.replace(/\s+$/, "");
	}
	return {
		text: normalized,
		changed: normalized !== text,
	};
}

function extractAssistantReplyTarget(text: string): AssistantReplyTarget | undefined {
	if (!text) {
		return undefined;
	}
	let match: RegExpExecArray | null = null;
	let replyTarget: AssistantReplyTarget | undefined;
	REPLY_TARGET_EXTRACT_RE.lastIndex = 0;
	while ((match = REPLY_TARGET_EXTRACT_RE.exec(text))) {
		const explicitMessageId = match[2]?.trim();
		replyTarget = explicitMessageId
			? { mode: "message", messageId: explicitMessageId }
			: { mode: "current" };
	}
	return replyTarget;
}

export function normalizeAssistantDisplayText(text: string): NormalizeAssistantDisplayTextResult {
	const stripped = stripInlineDirectiveTagsForDisplay(text);
	const replyTarget = extractAssistantReplyTarget(text);
	if (stripped.text.trim() === SILENT_REPLY_TOKEN) {
		return {
			text: "",
			changed: true,
			silent: true,
			replyTarget,
		};
	}
	return {
		text: stripped.text,
		changed: stripped.changed,
		silent: false,
		replyTarget,
	};
}

export { SILENT_REPLY_TOKEN };
export type { StripInlineDirectiveTagsResult, NormalizeAssistantDisplayTextResult };
