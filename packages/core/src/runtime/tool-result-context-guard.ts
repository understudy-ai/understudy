import type { AgentMessage } from "@mariozechner/pi-agent-core";
import {
	CHARS_PER_TOKEN_ESTIMATE,
	TOOL_RESULT_CHARS_PER_TOKEN_ESTIMATE,
	type MessageCharEstimateCache,
	createMessageCharEstimateCache,
	estimateContextChars,
	estimateMessageCharsCached,
	getToolResultText,
	invalidateMessageCharsCacheEntry,
	isToolResultMessage,
} from "./tool-result-char-estimator.js";

// Keep a conservative input budget to absorb tokenizer variance and provider framing overhead.
const CONTEXT_INPUT_HEADROOM_RATIO = 0.75;
const SINGLE_TOOL_RESULT_CONTEXT_SHARE = 0.5;
const RETRY_CONTEXT_INPUT_HEADROOM_RATIO = 0.6;
const RETRY_SINGLE_TOOL_RESULT_CONTEXT_SHARE = 0.35;

export const CONTEXT_LIMIT_TRUNCATION_NOTICE = "[truncated: output exceeded context limit]";
const CONTEXT_LIMIT_TRUNCATION_SUFFIX = `\n${CONTEXT_LIMIT_TRUNCATION_NOTICE}`;

export const PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER =
	"[compacted: tool output removed to free context]";
const PREEMPTIVE_CONVERSATION_COMPACTION_PLACEHOLDER =
	"[compacted: earlier conversation removed to free context]";
const MIN_RECENT_MESSAGES_TO_KEEP = 8;

type GuardableTransformContext = (
	messages: AgentMessage[],
	signal: AbortSignal,
) => AgentMessage[] | Promise<AgentMessage[]>;

type GuardableAgent = object;

type GuardableAgentRecord = {
	transformContext?: GuardableTransformContext;
};

function getMessageText(msg: AgentMessage): string {
	const content = (msg as { content?: unknown }).content;
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.map((block) =>
			block && typeof block === "object" && (block as { type?: unknown }).type === "text"
				? (block as { text?: unknown }).text
				: undefined,
		)
		.filter((value): value is string => typeof value === "string")
		.join("\n");
}

function truncateTextToBudget(text: string, maxChars: number): string {
	if (text.length <= maxChars) {
		return text;
	}

	if (maxChars <= 0) {
		return CONTEXT_LIMIT_TRUNCATION_NOTICE;
	}

	const bodyBudget = Math.max(0, maxChars - CONTEXT_LIMIT_TRUNCATION_SUFFIX.length);
	if (bodyBudget <= 0) {
		return CONTEXT_LIMIT_TRUNCATION_NOTICE;
	}

	let cutPoint = bodyBudget;
	const newline = text.lastIndexOf("\n", bodyBudget);
	if (newline > bodyBudget * 0.7) {
		cutPoint = newline;
	}

	return text.slice(0, cutPoint) + CONTEXT_LIMIT_TRUNCATION_SUFFIX;
}

function replaceMessageText(
	msg: AgentMessage,
	text: string,
	options: { stripDetails?: boolean } = {},
): AgentMessage {
	const content = (msg as { content?: unknown }).content;
	const replacementContent =
		typeof content === "string" || content === undefined ? text : [{ type: "text", text }];

	const sourceRecord = msg as unknown as Record<string, unknown>;
	const rest =
		options.stripDetails === true
			? (({ details: _details, ...value }) => value)(sourceRecord)
			: sourceRecord;
	return {
		...rest,
		content: replacementContent,
	} as AgentMessage;
}

function truncateToolResultToChars(
	msg: AgentMessage,
	maxChars: number,
	cache: MessageCharEstimateCache,
): AgentMessage {
	if (!isToolResultMessage(msg)) {
		return msg;
	}

	const estimatedChars = estimateMessageCharsCached(msg, cache);
	if (estimatedChars <= maxChars) {
		return msg;
	}

	const rawText = getToolResultText(msg);
	if (!rawText) {
		return replaceMessageText(msg, CONTEXT_LIMIT_TRUNCATION_NOTICE, { stripDetails: true });
	}

	const truncatedText = truncateTextToBudget(rawText, maxChars);
	return replaceMessageText(msg, truncatedText, { stripDetails: true });
}

function compactExistingToolResultsInPlace(params: {
	messages: AgentMessage[];
	charsNeeded: number;
	cache: MessageCharEstimateCache;
}): number {
	const { messages, charsNeeded, cache } = params;
	if (charsNeeded <= 0) {
		return 0;
	}

	let reduced = 0;
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (!isToolResultMessage(msg)) {
			continue;
		}

		const before = estimateMessageCharsCached(msg, cache);
		if (before <= PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER.length) {
			continue;
		}

		const compacted = replaceMessageText(msg, PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER, {
			stripDetails: true,
		});
		applyMessageMutationInPlace(msg, compacted, cache);
		const after = estimateMessageCharsCached(msg, cache);
		if (after >= before) {
			continue;
		}

		reduced += before - after;
		if (reduced >= charsNeeded) {
			break;
		}
	}

	return reduced;
}

function isCompactableConversationMessage(msg: AgentMessage): boolean {
	const role = (msg as { role?: unknown }).role;
	return role === "user" || role === "assistant";
}

function compactExistingConversationMessagesInPlace(params: {
	messages: AgentMessage[];
	charsNeeded: number;
	cache: MessageCharEstimateCache;
}): number {
	const { messages, charsNeeded, cache } = params;
	if (charsNeeded <= 0) {
		return 0;
	}

	const maxIndexExclusive = Math.max(0, messages.length - MIN_RECENT_MESSAGES_TO_KEEP);
	let reduced = 0;
	for (let i = 0; i < maxIndexExclusive; i += 1) {
		const msg = messages[i];
		if (!isCompactableConversationMessage(msg)) {
			continue;
		}

		const before = estimateMessageCharsCached(msg, cache);
		if (before <= PREEMPTIVE_CONVERSATION_COMPACTION_PLACEHOLDER.length) {
			continue;
		}

		const compacted = replaceMessageText(
			msg,
			PREEMPTIVE_CONVERSATION_COMPACTION_PLACEHOLDER,
		);
		applyMessageMutationInPlace(msg, compacted, cache);
		const after = estimateMessageCharsCached(msg, cache);
		if (after >= before) {
			continue;
		}

		reduced += before - after;
		if (reduced >= charsNeeded) {
			break;
		}
	}

	return reduced;
}

function isPrunableCompactedMessage(msg: AgentMessage): boolean {
	const text = getMessageText(msg).trim();
	return (
		text === PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER ||
		text === PREEMPTIVE_CONVERSATION_COMPACTION_PLACEHOLDER
	);
}

function pruneCompactedMessagesInPlace(params: {
	messages: AgentMessage[];
	charsNeeded: number;
	cache: MessageCharEstimateCache;
}): number {
	const { messages, charsNeeded, cache } = params;
	if (charsNeeded <= 0) {
		return 0;
	}

	let reduced = 0;
	let index = 0;
	while (index < Math.max(0, messages.length - MIN_RECENT_MESSAGES_TO_KEEP)) {
		const msg = messages[index];
		if (!isPrunableCompactedMessage(msg)) {
			index += 1;
			continue;
		}

		const before = estimateMessageCharsCached(msg, cache);
		messages.splice(index, 1);
		reduced += before;
		if (reduced >= charsNeeded) {
			break;
		}
	}

	return reduced;
}

function dropOldestMessagesInPlace(params: {
	messages: AgentMessage[];
	charsNeeded: number;
	cache: MessageCharEstimateCache;
}): number {
	const { messages, charsNeeded, cache } = params;
	if (charsNeeded <= 0) {
		return 0;
	}

	let reduced = 0;
	let index = 0;
	while (index < Math.max(0, messages.length - MIN_RECENT_MESSAGES_TO_KEEP)) {
		const msg = messages[index];
		if (!isCompactableConversationMessage(msg) && !isToolResultMessage(msg)) {
			index += 1;
			continue;
		}

		const before = estimateMessageCharsCached(msg, cache);
		messages.splice(index, 1);
		reduced += before;
		if (reduced >= charsNeeded) {
			break;
		}
	}

	return reduced;
}

function applyMessageMutationInPlace(
	target: AgentMessage,
	source: AgentMessage,
	cache?: MessageCharEstimateCache,
): void {
	if (target === source) {
		return;
	}

	const targetRecord = target as unknown as Record<string, unknown>;
	const sourceRecord = source as unknown as Record<string, unknown>;
	for (const key of Object.keys(targetRecord)) {
		if (!(key in sourceRecord)) {
			delete targetRecord[key];
		}
	}
	Object.assign(targetRecord, sourceRecord);
	if (cache) {
		invalidateMessageCharsCacheEntry(cache, target);
	}
}

function enforceToolResultContextBudgetInPlace(params: {
	messages: AgentMessage[];
	contextBudgetChars: number;
	maxSingleToolResultChars: number;
}): void {
	const { messages, contextBudgetChars, maxSingleToolResultChars } = params;
	const estimateCache = createMessageCharEstimateCache();

	// Ensure each tool result has an upper bound before considering total context usage.
	for (const message of messages) {
		if (!isToolResultMessage(message)) {
			continue;
		}
		const truncated = truncateToolResultToChars(message, maxSingleToolResultChars, estimateCache);
		applyMessageMutationInPlace(message, truncated, estimateCache);
	}

	let currentChars = estimateContextChars(messages, estimateCache);
	if (currentChars <= contextBudgetChars) {
		return;
	}

	// Compact oldest tool outputs first until the context is back under budget.
	compactExistingToolResultsInPlace({
		messages,
		charsNeeded: currentChars - contextBudgetChars,
		cache: estimateCache,
	});

	currentChars = estimateContextChars(messages, estimateCache);
	if (currentChars <= contextBudgetChars) {
		return;
	}

	// If tool outputs are not enough, compact older user/assistant turns while
	// preserving a recent tail of messages for local coherence.
	compactExistingConversationMessagesInPlace({
		messages,
		charsNeeded: currentChars - contextBudgetChars,
		cache: estimateCache,
	});

	currentChars = estimateContextChars(messages, estimateCache);
	if (currentChars <= contextBudgetChars) {
		return;
	}

	// As a last resort, prune already-compacted placeholders from the oldest
	// portion of the context until the budget is satisfied.
	pruneCompactedMessagesInPlace({
		messages,
		charsNeeded: currentChars - contextBudgetChars,
		cache: estimateCache,
	});
}

export function recoverContextAfterOverflowInPlace(params: {
	messages: AgentMessage[];
	contextWindowTokens: number;
}): { changed: boolean; estimatedChars: number } {
	const contextWindowTokens = Math.max(1, Math.floor(params.contextWindowTokens));
	const contextBudgetChars = Math.max(
		1_024,
		Math.floor(contextWindowTokens * CHARS_PER_TOKEN_ESTIMATE * RETRY_CONTEXT_INPUT_HEADROOM_RATIO),
	);
	const maxSingleToolResultChars = Math.max(
		1_024,
		Math.floor(
			contextWindowTokens *
				TOOL_RESULT_CHARS_PER_TOKEN_ESTIMATE *
				RETRY_SINGLE_TOOL_RESULT_CONTEXT_SHARE,
		),
	);
	const cache = createMessageCharEstimateCache();
	const beforeLength = params.messages.length;
	const beforeChars = estimateContextChars(params.messages, cache);

	enforceToolResultContextBudgetInPlace({
		messages: params.messages,
		contextBudgetChars,
		maxSingleToolResultChars,
	});

	let currentChars = estimateContextChars(params.messages, cache);
	if (currentChars > contextBudgetChars) {
		dropOldestMessagesInPlace({
			messages: params.messages,
			charsNeeded: currentChars - contextBudgetChars,
			cache,
		});
		currentChars = estimateContextChars(params.messages, cache);
	}

	return {
		changed:
			params.messages.length !== beforeLength ||
			currentChars !== beforeChars,
		estimatedChars: currentChars,
	};
}

export function installToolResultContextGuard(params: {
	agent: GuardableAgent;
	contextWindowTokens: number;
}): () => void {
	const contextWindowTokens = Math.max(1, Math.floor(params.contextWindowTokens));
	const contextBudgetChars = Math.max(
		1_024,
		Math.floor(contextWindowTokens * CHARS_PER_TOKEN_ESTIMATE * CONTEXT_INPUT_HEADROOM_RATIO),
	);
	const maxSingleToolResultChars = Math.max(
		1_024,
		Math.floor(
			contextWindowTokens *
				TOOL_RESULT_CHARS_PER_TOKEN_ESTIMATE *
				SINGLE_TOOL_RESULT_CONTEXT_SHARE,
		),
	);

	// Agent.transformContext is private in pi-coding-agent, so access it via a
	// narrow runtime view to keep callsites type-safe while preserving behavior.
	const mutableAgent = params.agent as GuardableAgentRecord;
	const originalTransformContext = mutableAgent.transformContext;

	mutableAgent.transformContext = (async (
		messages: AgentMessage[],
		signal: AbortSignal,
	) => {
		const transformed = originalTransformContext
			? await originalTransformContext.call(mutableAgent, messages, signal)
			: messages;

		const contextMessages = Array.isArray(transformed) ? transformed : messages;
		enforceToolResultContextBudgetInPlace({
			messages: contextMessages,
			contextBudgetChars,
			maxSingleToolResultChars,
		});

		return contextMessages;
	}) as GuardableTransformContext;

	return () => {
		mutableAgent.transformContext = originalTransformContext;
	};
}
