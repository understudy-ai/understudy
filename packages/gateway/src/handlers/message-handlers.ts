/**
 * Message RPC handlers: message.action
 */

import { resolveAttachmentType } from "@understudy/core";
import type { Attachment, ChannelAdapter } from "@understudy/types";
import type { RpcHandler } from "../handler-registry.js";
import { asBoolean, asString } from "../value-coerce.js";

type MessageAction =
	| "send"
	| "reply"
	| "edit"
	| "delete"
	| "react"
	| "sendattachment"
	| "broadcast"
	| "poll"
	| "poll-vote"
	| "reactions"
	| "read"
	| "pin"
	| "unpin"
	| "list-pins"
	| "permissions"
	| "thread-create"
	| "thread-list"
	| "thread-reply";

type PerformActionFn = (params: {
	action: string;
	channelId: string;
	recipientId?: string;
	messageId?: string;
	threadId?: string;
	text?: string;
	payload?: Record<string, unknown>;
}) => Promise<unknown>;

const BUILTIN_PARAM_KEYS = new Set([
	"action",
	"channel",
	"channelId",
	"recipientId",
	"text",
	"messageId",
	"replyToMessageId",
	"threadId",
	"emoji",
	"remove",
	"attachmentUrl",
	"attachmentType",
	"attachmentName",
	"attachmentMimeType",
	"attachments",
]);

function asStringArray(value: unknown): string[] | undefined {
	if (Array.isArray(value)) {
		const normalized = value
			.map((entry) => asString(entry))
			.filter((entry): entry is string => Boolean(entry));
		return normalized.length > 0 ? normalized : undefined;
	}
	if (typeof value === "string") {
		const parts = value
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean);
		return parts.length > 0 ? parts : undefined;
	}
	return undefined;
}

function readAttachments(params: Record<string, unknown>): Attachment[] | undefined {
	if (Array.isArray(params.attachments)) {
		const normalized = params.attachments
			.map((raw): Attachment | null => {
				if (!raw || typeof raw !== "object") return null;
				const attachment = raw as Record<string, unknown>;
				const url = asString(attachment.url);
				if (!url) return null;
				return {
					type: resolveAttachmentType(
						asString(attachment.mimeType),
						asString(attachment.name),
						asString(attachment.type),
					),
					url,
					name: asString(attachment.name),
					mimeType: asString(attachment.mimeType),
				};
			})
			.filter((item): item is Attachment => item !== null);
		return normalized.length > 0 ? normalized : undefined;
	}

	const attachmentUrl = asString(params.attachmentUrl);
	if (!attachmentUrl) {
		return undefined;
	}
	return [{
		type: resolveAttachmentType(
			asString(params.attachmentMimeType),
			asString(params.attachmentName),
			asString(params.attachmentType),
		),
		url: attachmentUrl,
		name: asString(params.attachmentName),
		mimeType: asString(params.attachmentMimeType),
	}];
}

function readCustomPayload(params: Record<string, unknown>): Record<string, unknown> {
	const payload: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(params)) {
		if (BUILTIN_PARAM_KEYS.has(key)) {
			continue;
		}
		payload[key] = value;
	}
	return payload;
}

function resolvePerformAction(channel: ChannelAdapter): PerformActionFn | undefined {
	return (channel.messaging as ChannelAdapter["messaging"] & { performAction?: PerformActionFn }).performAction;
}

async function runCustomAction(params: {
	requestId: string;
	channel: ChannelAdapter;
	action: MessageAction;
	channelId: string;
	recipientId?: string;
	messageId?: string;
	threadId?: string;
	text?: string;
	payload: Record<string, unknown>;
	attachments?: Attachment[];
	replyToMessageId?: string;
}): Promise<{ id: string; result?: Record<string, unknown>; error?: { code: number; message: string } }> {
	const {
		requestId,
		channel,
		action,
		channelId,
		recipientId,
		messageId,
		threadId,
		text,
		payload,
		attachments,
		replyToMessageId,
	} = params;

	if (action === "poll") {
		const pollQuestion = asString(payload.pollQuestion) ?? text;
		const pollOptions = asStringArray(payload.pollOptions);
		if (!recipientId) {
			return { id: requestId, error: { code: 400, message: "recipientId is required for poll" } };
		}
		if (!pollQuestion) {
			return { id: requestId, error: { code: 400, message: "pollQuestion is required for poll" } };
		}

		const performAction = resolvePerformAction(channel);
		if (performAction) {
			const result = await performAction({
				action,
				channelId,
				recipientId,
				threadId,
				text: pollQuestion,
				payload: {
					...payload,
					pollQuestion,
					pollOptions,
				},
			});
			return { id: requestId, result: { action, channelId, recipientId, result } };
		}

		const formattedOptions = (pollOptions ?? []).map((option, idx) => `${idx + 1}. ${option}`).join("\n");
		const fallbackText = formattedOptions
			? `📊 ${pollQuestion}\n${formattedOptions}`
			: `📊 ${pollQuestion}`;
		const outboundId = await channel.messaging.sendMessage({
			channelId,
			recipientId,
			text: fallbackText,
			threadId,
			replyToMessageId,
			attachments,
		});
		return {
			id: requestId,
			result: {
				action,
				channelId,
				recipientId,
				messageId: outboundId,
				fallback: "sent-as-message",
			},
		};
	}

	if (action === "thread-reply") {
		if (!recipientId) {
			return { id: requestId, error: { code: 400, message: "recipientId is required for thread-reply" } };
		}
		if (!text) {
			return { id: requestId, error: { code: 400, message: "text is required for thread-reply" } };
		}
		if (!threadId) {
			return { id: requestId, error: { code: 400, message: "threadId is required for thread-reply" } };
		}

		const performAction = resolvePerformAction(channel);
		if (performAction) {
			const result = await performAction({
				action,
				channelId,
				recipientId,
				threadId,
				text,
				payload,
			});
			return { id: requestId, result: { action, channelId, recipientId, threadId, result } };
		}

		if (!channel.capabilities.threads) {
			return {
				id: requestId,
				error: { code: 501, message: `Channel ${channelId} does not support thread replies` },
			};
		}

		const outboundId = await channel.messaging.sendMessage({
			channelId,
			recipientId,
			text,
			threadId,
			replyToMessageId,
			attachments,
		});
		return { id: requestId, result: { action, channelId, recipientId, threadId, messageId: outboundId } };
	}

	const performAction = resolvePerformAction(channel);
	if (!performAction) {
		return {
			id: requestId,
			error: {
				code: 501,
				message: `Channel ${channelId} does not support action ${action}`,
			},
		};
	}

	const result = await performAction({
		action,
		channelId,
		recipientId,
		messageId,
		threadId,
		text,
		payload,
	});

	return {
		id: requestId,
		result: {
			action,
			channelId,
			recipientId,
			messageId,
			threadId,
			result,
		},
	};
}

export const messageAction: RpcHandler = async (request, context) => {
	const params = request.params as Record<string, unknown>;
	const channelId = asString(params.channelId);
	if (!channelId) {
		return { id: request.id, error: { code: 400, message: "channelId is required" } };
	}

	const channel = context.getRouter().getChannel(channelId);
	if (!channel) {
		return { id: request.id, error: { code: 404, message: `Unknown channel: ${channelId}` } };
	}

	const rawAction = (asString(params.action) ?? "send").toLowerCase();
	const action = rawAction as MessageAction;
	const recipientId = asString(params.recipientId);
	const threadId = asString(params.threadId);
	const text = asString(params.text);
	const replyToMessageId = asString(params.replyToMessageId);
	const messageId = asString(params.messageId);
	const emoji = asString(params.emoji);
	const remove = asBoolean(params.remove) ?? false;
	const routeChannelId = recipientId ?? channelId;
	const attachments = readAttachments(params);
	const customPayload = readCustomPayload(params);

	try {
			switch (action) {
			case "send": {
				if (!recipientId) {
					return { id: request.id, error: { code: 400, message: "recipientId is required for send" } };
				}
				if (!text) {
					return { id: request.id, error: { code: 400, message: "text is required for send" } };
				}
				const outboundId = await channel.messaging.sendMessage({
					channelId,
					recipientId,
					text,
					threadId,
					replyToMessageId,
					attachments,
				});
				return {
					id: request.id,
					result: { action, channelId, recipientId, messageId: outboundId },
				};
			}

			case "reply": {
				if (!recipientId) {
					return { id: request.id, error: { code: 400, message: "recipientId is required for reply" } };
				}
				if (!text) {
					return { id: request.id, error: { code: 400, message: "text is required for reply" } };
				}
				if (!replyToMessageId) {
					return { id: request.id, error: { code: 400, message: "replyToMessageId is required for reply" } };
				}
				const outboundId = await channel.messaging.sendMessage({
					channelId,
					recipientId,
					text,
					threadId,
					replyToMessageId,
					attachments,
				});
				return {
					id: request.id,
					result: { action, channelId, recipientId, messageId: outboundId, replyToMessageId },
				};
			}

			case "sendattachment": {
				if (!recipientId) {
					return {
						id: request.id,
						error: { code: 400, message: "recipientId is required for sendAttachment" },
					};
				}
				if (!attachments || attachments.length === 0) {
					return {
						id: request.id,
						error: { code: 400, message: "attachments or attachmentUrl is required for sendAttachment" },
					};
				}
				if (!channel.capabilities.attachments) {
					return {
						id: request.id,
						error: { code: 501, message: `Channel ${channelId} does not support attachments` },
					};
				}
				const outboundId = await channel.messaging.sendMessage({
					channelId,
					recipientId,
					text: text ?? "",
					threadId,
					replyToMessageId,
					attachments,
				});
				return {
					id: request.id,
					result: { action, channelId, recipientId, messageId: outboundId, attachmentCount: attachments.length },
				};
			}

			case "edit": {
				if (!messageId) {
					return { id: request.id, error: { code: 400, message: "messageId is required for edit" } };
				}
				if (!text) {
					return { id: request.id, error: { code: 400, message: "text is required for edit" } };
				}
				if (!channel.messaging.editMessage) {
					return {
						id: request.id,
						error: { code: 501, message: `Channel ${channelId} does not support edit` },
					};
				}
				await channel.messaging.editMessage({
					channelId: routeChannelId,
					messageId,
					text,
					recipientId,
					threadId,
				});
				return { id: request.id, result: { action, channelId, messageId } };
			}

			case "delete": {
				if (!messageId) {
					return { id: request.id, error: { code: 400, message: "messageId is required for delete" } };
				}
				if (!channel.messaging.deleteMessage) {
					return {
						id: request.id,
						error: { code: 501, message: `Channel ${channelId} does not support delete` },
					};
				}
				await channel.messaging.deleteMessage({
					channelId: routeChannelId,
					messageId,
					recipientId,
					threadId,
				});
				return { id: request.id, result: { action, channelId, messageId } };
			}

			case "react": {
				if (!messageId) {
					return { id: request.id, error: { code: 400, message: "messageId is required for react" } };
				}
				if (!emoji) {
					return { id: request.id, error: { code: 400, message: "emoji is required for react" } };
				}
				if (!channel.messaging.reactToMessage) {
					return {
						id: request.id,
						error: { code: 501, message: `Channel ${channelId} does not support reactions` },
					};
				}
				await channel.messaging.reactToMessage({
					channelId: routeChannelId,
					messageId,
					emoji,
					recipientId,
					remove,
				});
				return { id: request.id, result: { action, channelId, messageId, emoji, remove } };
			}

			case "broadcast":
			case "poll":
			case "poll-vote":
			case "reactions":
			case "read":
			case "pin":
			case "unpin":
			case "list-pins":
			case "permissions":
			case "thread-create":
			case "thread-list":
			case "thread-reply":
				return await runCustomAction({
					requestId: request.id,
					channel,
					action,
					channelId,
					recipientId,
					messageId,
					threadId,
					text,
					payload: customPayload,
					attachments,
					replyToMessageId,
				});

			default:
				return { id: request.id, error: { code: 400, message: `Unknown message action: ${rawAction}` } };
		}
	} catch (error: any) {
		return { id: request.id, error: { code: 500, message: error?.message ?? "Message action failed" } };
	}
};
