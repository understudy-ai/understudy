/**
 * Channel adapter interfaces for multi-platform messaging.
 *
 * Each channel (Telegram, Discord, Slack, WhatsApp, WebSocket) implements
 * a subset of these interfaces based on its capabilities.
 */

export interface ChannelIdentity {
	/** Unique channel type identifier (e.g., "telegram", "discord", "web") */
	readonly id: string;
	/** Human-readable channel name */
	readonly name: string;
}

export type ChannelRuntimeState =
	| "stopped"
	| "starting"
	| "running"
	| "reconnecting"
	| "awaiting_pairing"
	| "error";

export interface ChannelRuntimeStatus {
	state: ChannelRuntimeState;
	updatedAt: number;
	startedAt?: number;
	summary?: string;
	lastError?: string;
	restartAttempt?: number;
	details?: Record<string, unknown>;
}

export type ChannelRuntimeStatusPatch = Partial<ChannelRuntimeStatus>;

/** Inbound message from a channel */
export interface InboundMessage {
	channelId: string;
	senderId: string;
	senderName?: string;
	conversationName?: string;
	conversationType?: "direct" | "group" | "thread";
	externalMessageId?: string;
	text: string;
	threadId?: string;
	replyToMessageId?: string;
	attachments?: Attachment[];
	timestamp: number;
}

export interface Attachment {
	type: "image" | "file" | "audio" | "video";
	url: string;
	name?: string;
	mimeType?: string;
	size?: number;
}

/** Outbound message to a channel */
export interface OutboundMessage {
	channelId: string;
	recipientId: string;
	text: string;
	threadId?: string;
	replyToMessageId?: string;
	attachments?: Attachment[];
}

/** Authentication adapter — handles login/credentials for the channel */
export interface ChannelAuthAdapter {
	/** Whether the channel is currently authenticated */
	isAuthenticated(): Promise<boolean>;
	/** Perform login/authentication */
	authenticate(credentials?: Record<string, string>): Promise<void>;
	/** Revoke authentication */
	logout(): Promise<void>;
}

/** Core messaging adapter — send and receive messages */
export interface ChannelMessagingAdapter {
	/** Send a message through this channel */
	sendMessage(message: OutboundMessage): Promise<string>;
	/**
	 * Execute a channel-specific outbound action that is not part of the core
	 * cross-channel messaging surface (for example: polls, pins, permissions).
	 */
	performAction?(params: {
		action: string;
		channelId: string;
		recipientId?: string;
		messageId?: string;
		threadId?: string;
		text?: string;
		payload?: Record<string, unknown>;
	}): Promise<unknown>;
	/** Edit an existing message if supported by channel */
	editMessage?(params: {
		channelId: string;
		messageId: string;
		text: string;
		recipientId?: string;
		threadId?: string;
	}): Promise<void>;
	/** Delete an existing message if supported by channel */
	deleteMessage?(params: {
		channelId: string;
		messageId: string;
		recipientId?: string;
		threadId?: string;
	}): Promise<void>;
	/** Add/remove reaction on a message if supported by channel */
	reactToMessage?(params: {
		channelId: string;
		messageId: string;
		emoji: string;
		recipientId?: string;
		remove?: boolean;
	}): Promise<void>;
	/** Subscribe to incoming messages */
	onMessage(handler: (message: InboundMessage) => void): () => void;
}

/** Streaming adapter — for channels that support chunked/streaming responses */
export interface ChannelStreamingAdapter {
	/** Start a streaming response */
	startStream(channelId: string, recipientId: string, threadId?: string): StreamHandle;
}

export interface StreamHandle {
	/** Append text chunk to the stream */
	update(text: string): Promise<void>;
	/** Finalize the streamed message */
	finish(): Promise<string>;
	/** Cancel the stream */
	cancel(): Promise<void>;
}

/** Group management adapter */
export interface ChannelGroupAdapter {
	/** List groups/channels the bot is a member of */
	listGroups(): Promise<GroupInfo[]>;
	/** Get group info by ID */
	getGroup(groupId: string): Promise<GroupInfo | null>;
}

export interface GroupInfo {
	id: string;
	name: string;
	memberCount?: number;
}

/** Full channel adapter combining all interfaces */
export interface ChannelAdapter extends ChannelIdentity {
	/** Start listening for messages */
	start(): Promise<void>;
	/** Stop the channel */
	stop(): Promise<void>;
	/** Channel capabilities */
	capabilities: ChannelCapabilities;
	/** Core messaging */
	messaging: ChannelMessagingAdapter;
	/** Optional adapters */
	auth?: ChannelAuthAdapter;
	streaming?: ChannelStreamingAdapter;
	groups?: ChannelGroupAdapter;
	/** Optional runtime health/status snapshot */
	getRuntimeStatus?(): ChannelRuntimeStatus | Promise<ChannelRuntimeStatus>;
	/** Optional runtime status updater used by the gateway/router */
	updateRuntimeStatus?(status: ChannelRuntimeStatusPatch): void;
}

export interface ChannelCapabilities {
	streaming: boolean;
	threads: boolean;
	reactions: boolean;
	attachments: boolean;
	groups: boolean;
}
