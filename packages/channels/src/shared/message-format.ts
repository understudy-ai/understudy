/**
 * Unified message normalization for cross-channel message format.
 */

import type { Attachment, InboundMessage, OutboundMessage } from "@understudy/types";

/** Wire format for WebSocket messages */
export interface WireMessage {
	type:
		| "message"
		| "ack"
		| "error"
		| "stream_start"
		| "stream_chunk"
		| "stream_end";
	id?: string;
	channelId: string;
	senderId?: string;
	senderName?: string;
	conversationName?: string;
	conversationType?: "direct" | "group" | "thread";
	externalMessageId?: string;
	text?: string;
	threadId?: string;
	replyTo?: string;
	attachments?: Attachment[];
	timestamp?: number;
	error?: string;
}

export function inboundFromWire(wire: WireMessage): InboundMessage {
	return {
		channelId: wire.channelId,
		senderId: wire.senderId ?? "unknown",
		senderName: wire.senderName,
		conversationName: wire.conversationName,
		conversationType: wire.conversationType,
		externalMessageId: wire.externalMessageId ?? wire.id,
		text: wire.text ?? "",
		threadId: wire.threadId,
		replyToMessageId: wire.replyTo,
		attachments: wire.attachments,
		timestamp: wire.timestamp ?? Date.now(),
	};
}

export function outboundToWire(msg: OutboundMessage, type: WireMessage["type"] = "message"): WireMessage {
	return {
		type,
		channelId: msg.channelId,
		text: msg.text,
		threadId: msg.threadId,
		replyTo: msg.replyToMessageId,
		attachments: msg.attachments,
		timestamp: Date.now(),
	};
}

/** Generate a unique message ID */
export function generateMessageId(): string {
	return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
