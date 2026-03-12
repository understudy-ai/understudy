/**
 * Chat RPC handlers: chat.send, chat.stream, chat.abort
 */

import type { ImageContent } from "@mariozechner/pi-ai";
import { normalizeAssistantDisplayText } from "@understudy/core";
import type { Attachment } from "@understudy/types";
import {
	extractRenderableAssistantImages,
	normalizeAssistantRenderableText,
} from "../assistant-media.js";
import type { RpcHandler } from "../handler-registry.js";
import { asBoolean, asRecord, asString } from "../value-coerce.js";

export function normalizeChatResult(result: unknown): {
	response: string;
	runId?: string;
	sessionId?: string;
	status?: string;
	images?: ImageContent[];
	attachments?: Attachment[];
	replyToCurrent?: boolean;
	replyToMessageId?: string;
	meta?: Record<string, unknown>;
} {
	if (typeof result === "string") {
		const normalizedResponse = normalizeAssistantDisplayText(result);
		return {
			response: normalizedResponse.text,
			...(normalizedResponse.replyTarget?.mode === "current" ? { replyToCurrent: true } : {}),
			...(normalizedResponse.replyTarget?.mode === "message"
				? { replyToMessageId: normalizedResponse.replyTarget.messageId }
				: {}),
		};
	}
	if (!result || typeof result !== "object") {
		return { response: "" };
	}
	const record = result as Record<string, unknown>;
	const images = readImages(record.images) ?? extractRenderableAssistantImages(record) ?? extractRenderableAssistantImages(record.meta);
	const attachments = readAttachments(record.attachments);
	const normalizedResponse = normalizeAssistantDisplayText(typeof record.response === "string" ? record.response : "");
	const visibleResponse = normalizeAssistantRenderableText(normalizedResponse.text, { images, attachments });
	return {
		response: visibleResponse,
		runId: typeof record.runId === "string" ? record.runId : undefined,
		sessionId: typeof record.sessionId === "string" ? record.sessionId : undefined,
		status: typeof record.status === "string" ? record.status : undefined,
		...(images?.length ? { images } : {}),
		...(attachments?.length ? { attachments } : {}),
		...(normalizedResponse.replyTarget?.mode === "current" ? { replyToCurrent: true } : {}),
		...(normalizedResponse.replyTarget?.mode === "message"
			? { replyToMessageId: normalizedResponse.replyTarget.messageId }
			: {}),
		meta:
			record.meta && typeof record.meta === "object" && !Array.isArray(record.meta)
				? (record.meta as Record<string, unknown>)
				: undefined,
	};
}

function readConversationType(value: unknown): "direct" | "group" | "thread" | undefined {
	return value === "direct" || value === "group" || value === "thread"
		? value
		: undefined;
}

function readImages(value: unknown): ImageContent[] | undefined {
	return Array.isArray(value) ? value as ImageContent[] : undefined;
}

function readAttachments(value: unknown): Attachment[] | undefined {
	return Array.isArray(value) ? value as Attachment[] : undefined;
}

async function handleChatRequest(
	request: Parameters<RpcHandler>[0],
	context: Parameters<RpcHandler>[1],
	options?: {
		forceWaitForCompletion?: boolean;
	},
) {
	const chatHandler = context.getChatHandler();
	if (!chatHandler) {
		return { id: request.id, error: { code: 503, message: "No chat handler configured" } };
	}
	const text = asString(request.params.text) ?? "";
	const images = readImages(request.params.images);
	const attachments = readAttachments(request.params.attachments);
	if (!text && !(images?.length || attachments?.length)) {
		return { id: request.id, error: { code: 400, message: "text or media is required" } };
	}
	try {
		const chatResult = normalizeChatResult(await chatHandler(text, {
			channelId: asString(request.params.channelId),
			senderId: asString(request.params.senderId),
			senderName: asString(request.params.senderName),
			conversationName: asString(request.params.conversationName),
			conversationType: readConversationType(request.params.conversationType),
			threadId: asString(request.params.threadId),
			cwd: asString(request.params.cwd),
			forceNew: asBoolean(request.params.forceNew),
			configOverride: asRecord(request.params.configOverride),
			sandboxInfo: asRecord(request.params.sandboxInfo),
			executionScopeKey: asString(request.params.executionScopeKey),
			waitForCompletion: options?.forceWaitForCompletion ?? asBoolean(request.params.waitForCompletion),
			images,
			attachments,
		}));
		return { id: request.id, result: chatResult };
	} catch (error: any) {
		return { id: request.id, error: { code: 500, message: error.message } };
	}
}

export const chatSend: RpcHandler = async (request, context) =>
	handleChatRequest(request, context);

export const chatStream: RpcHandler = async (request, context) => {
	return await handleChatRequest(request, context, {
		forceWaitForCompletion: false,
	});
};

export const chatAbort: RpcHandler = async (request, context) => {
	const handlers = context.getSessionHandlers();
	if (!handlers?.abort) {
		return { id: request.id, error: { code: 503, message: "Chat abort handler not configured" } };
	}
	return { id: request.id, result: await handlers.abort(request.params) };
};
