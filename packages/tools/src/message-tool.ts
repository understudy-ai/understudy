/**
 * Cross-channel message sending tool for Understudy.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Attachment, OutboundMessage, ChannelAdapter } from "@understudy/types";
import { resolveAttachmentType } from "@understudy/core";
import { textResult } from "./bridge/bridge-rpc.js";

const MessageSchema = Type.Object({
	action: Type.Optional(
		Type.String({
			description: 'Action: "send", "reply", "edit", "react", "delete", "sendAttachment". Default: "send".',
		}),
	),
	channel: Type.String({
		description: 'Target Understudy channel ID (for example: "web", "telegram", "discord", "slack", "whatsapp").',
	}),
	recipient: Type.Optional(
		Type.String({
			description: "Recipient identifier for the selected channel (user/chat/thread target as defined by adapter).",
		}),
	),
	text: Type.Optional(
		Type.String({
			description: "Message text content.",
		}),
	),
	threadId: Type.Optional(
		Type.String({
			description: "Optional thread/topic ID when channel supports threaded delivery.",
		}),
	),
	replyTo: Type.Optional(
		Type.String({
			description: "Optional message ID to reply to when supported.",
		}),
	),
	messageId: Type.Optional(
		Type.String({
			description: "Target message ID for edit/react/delete actions.",
		}),
	),
	emoji: Type.Optional(
		Type.String({
			description: "Emoji for react action (for example: 👍, fire).",
		}),
	),
	remove: Type.Optional(
		Type.Boolean({
			description: "If true, remove the reaction instead of adding it.",
		}),
	),
	attachmentUrl: Type.Optional(
		Type.String({
			description: "Attachment URL or local path for sendAttachment.",
		}),
	),
	attachmentType: Type.Optional(
		Type.String({
			description: 'Attachment type for sendAttachment: "image", "file", "audio", or "video".',
		}),
	),
	attachmentName: Type.Optional(
		Type.String({
			description: "Optional attachment display name.",
		}),
	),
	attachmentMimeType: Type.Optional(
		Type.String({
			description: "Optional attachment MIME type.",
		}),
	),
});

type MessageParams = Static<typeof MessageSchema>;

export interface MessageToolConfig {
	/** Registry of available channel adapters */
	getChannel: (channelId: string) => ChannelAdapter | undefined;
}

export function createMessageTool(config: MessageToolConfig): AgentTool<typeof MessageSchema> {
	return {
		name: "message_send",
		label: "Message",
		description:
			"Send and manage outbound messages via connected Understudy channels. " +
			'Supports actions: "send", "reply", "edit", "react", "delete", "sendAttachment".',
		parameters: MessageSchema,
		execute: async (_toolCallId, params: MessageParams): Promise<AgentToolResult<unknown>> => {
			const channel = config.getChannel(params.channel);
			if (!channel) {
				return textResult(
					`Unknown channel: ${params.channel}. Available channels can be listed with the status command.`,
					{ error: "unknown channel" },
				);
			}
			const action = (params.action?.trim().toLowerCase() || "send") as
				| "send"
				| "reply"
				| "edit"
				| "react"
				| "delete"
				| "sendattachment";
			const recipient = params.recipient?.trim();
			const text = params.text ?? "";
			const routeChannelId = recipient || params.channel;

			const sendMessage = async (message: OutboundMessage): Promise<AgentToolResult<unknown>> => {
				const messageId = await channel.messaging.sendMessage(message);
				return textResult(`Message ${action} succeeded via ${params.channel} (id: ${messageId})`, {
					action,
					messageId,
					channel: params.channel,
				});
			};

			try {
				switch (action) {
					case "send": {
						if (!recipient) return textResult("Error: recipient is required for send", { error: "missing recipient" });
						if (!text.trim()) return textResult("Error: text is required for send", { error: "missing text" });
						return await sendMessage({
							channelId: params.channel,
							recipientId: recipient,
							text,
							threadId: params.threadId,
							replyToMessageId: params.replyTo,
						});
					}

					case "reply": {
						if (!recipient) return textResult("Error: recipient is required for reply", { error: "missing recipient" });
						if (!params.replyTo) return textResult("Error: replyTo is required for reply", { error: "missing replyTo" });
						if (!text.trim()) return textResult("Error: text is required for reply", { error: "missing text" });
						return await sendMessage({
							channelId: params.channel,
							recipientId: recipient,
							text,
							threadId: params.threadId,
							replyToMessageId: params.replyTo,
						});
					}

					case "sendattachment": {
						if (!recipient) return textResult("Error: recipient is required for sendAttachment", { error: "missing recipient" });
						if (!params.attachmentUrl) {
							return textResult("Error: attachmentUrl is required for sendAttachment", { error: "missing attachmentUrl" });
						}
						if (!channel.capabilities.attachments) {
							return textResult(`Channel ${params.channel} does not support attachment sends`, {
								error: "unsupported action",
							});
						}
						const attachment: Attachment = {
							type: resolveAttachmentType(
								params.attachmentMimeType,
								params.attachmentName,
								params.attachmentType,
							),
							url: params.attachmentUrl,
							name: params.attachmentName,
							mimeType: params.attachmentMimeType,
						};
						return await sendMessage({
							channelId: params.channel,
							recipientId: recipient,
							text,
							threadId: params.threadId,
							replyToMessageId: params.replyTo,
							attachments: [attachment],
						});
					}

					case "edit": {
						if (!params.messageId) return textResult("Error: messageId is required for edit", { error: "missing messageId" });
						if (!text.trim()) return textResult("Error: text is required for edit", { error: "missing text" });
						if (!channel.messaging.editMessage) {
							return textResult(`Channel ${params.channel} does not support edit action`, { error: "unsupported action" });
						}
						await channel.messaging.editMessage({
							channelId: routeChannelId,
							messageId: params.messageId,
							text,
							recipientId: recipient,
							threadId: params.threadId,
						});
						return textResult(`Message edited via ${params.channel}`, {
							action,
							channel: params.channel,
							messageId: params.messageId,
						});
					}

					case "delete": {
						if (!params.messageId) return textResult("Error: messageId is required for delete", { error: "missing messageId" });
						if (!channel.messaging.deleteMessage) {
							return textResult(`Channel ${params.channel} does not support delete action`, { error: "unsupported action" });
						}
						await channel.messaging.deleteMessage({
							channelId: routeChannelId,
							messageId: params.messageId,
							recipientId: recipient,
							threadId: params.threadId,
						});
						return textResult(`Message deleted via ${params.channel}`, {
							action,
							channel: params.channel,
							messageId: params.messageId,
						});
					}

					case "react": {
						if (!params.messageId) return textResult("Error: messageId is required for react", { error: "missing messageId" });
						if (!params.emoji?.trim()) return textResult("Error: emoji is required for react", { error: "missing emoji" });
						if (!channel.messaging.reactToMessage) {
							return textResult(`Channel ${params.channel} does not support react action`, { error: "unsupported action" });
						}
						await channel.messaging.reactToMessage({
							channelId: routeChannelId,
							messageId: params.messageId,
							emoji: params.emoji.trim(),
							recipientId: recipient,
							remove: params.remove === true,
						});
						return textResult(
							`Reaction ${params.remove ? "removed" : "sent"} via ${params.channel}`,
							{
								action,
								channel: params.channel,
								messageId: params.messageId,
							},
						);
					}

					default:
						return textResult(`Unknown action: ${params.action}`, { error: "unknown action" });
				}
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return textResult(`Message action failed via ${params.channel}: ${msg}`, { error: msg, action });
			}
		},
	};
}
