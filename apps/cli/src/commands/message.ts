/**
 * Message command: send/search/manage channel messages via RPC.
 */

import { createRpcClient, type GatewayRpcClient } from "../rpc-client.js";

type MessageAction =
	| "send"
	| "reply"
	| "edit"
	| "delete"
	| "react"
	| "sendattachment"
	| "search"
	| "poll"
	| "poll-vote"
	| "pin"
	| "unpin"
	| "list-pins"
	| "permissions"
	| "thread-create"
	| "thread-list"
	| "thread-reply";

const MESSAGE_ACTIONS: readonly MessageAction[] = [
	"send",
	"reply",
	"edit",
	"delete",
	"react",
	"sendattachment",
	"search",
	"poll",
	"poll-vote",
	"pin",
	"unpin",
	"list-pins",
	"permissions",
	"thread-create",
	"thread-list",
	"thread-reply",
];

interface MessageOptions {
	action?: string;
	channel?: string;
	to?: string;
	text?: string;
	messageId?: string;
	replyTo?: string;
	thread?: string;
	emoji?: string;
	remove?: boolean;
	attachment?: string;
	attachmentType?: string;
	attachmentName?: string;
	attachmentMimeType?: string;
	query?: string;
	limit?: string;
	pollQuestion?: string;
	pollOption?: string | string[];
	pollOptions?: string;
	pollId?: string;
	pollChoice?: string;
	pinReason?: string;
	permissions?: string;
	permissionsTarget?: string;
	threadTitle?: string;
	threadTopic?: string;
	threadOwner?: string;
	dryRun?: boolean;
	json?: boolean;
	port?: string;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function trim(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const next = value.trim();
	return next.length > 0 ? next : undefined;
}

function parseStringList(value: string | string[] | undefined): string[] | undefined {
	if (Array.isArray(value)) {
		const items = value
			.map((entry) => trim(entry))
			.filter((entry): entry is string => Boolean(entry));
		return items.length > 0 ? items : undefined;
	}

	const normalized = trim(value);
	if (!normalized) return undefined;
	const items = normalized
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	return items.length > 0 ? items : undefined;
}

function parseJsonOrText(value: string | undefined): unknown {
	const normalized = trim(value);
	if (!normalized) return undefined;
	try {
		return JSON.parse(normalized);
	} catch {
		return normalized;
	}
}

function resolveAction(opts: MessageOptions): MessageAction {
	const normalized = trim(opts.action);
	if (!normalized) {
		throw new Error("message action is required");
	}
	if ((MESSAGE_ACTIONS as readonly string[]).includes(normalized)) {
		return normalized as MessageAction;
	}
	throw new Error(`Unknown message action: ${normalized}`);
}

async function runSearch(
	client: GatewayRpcClient,
	query: string,
	maxResults: number,
	outputJson: boolean,
): Promise<void> {
	const sessions = await client.call<Array<{ id: string }>>("session.list", {});
	const queryLower = query.toLowerCase();
	const matches: Array<{
		sessionId: string;
		role: string;
		text: string;
		timestamp?: number;
	}> = [];

	for (const session of sessions) {
		const history = await client.call<{ messages?: Array<{ role?: string; text?: string; timestamp?: number }> }>(
			"session.history",
			{
				sessionId: session.id,
				limit: 300,
			},
		);

		for (const message of history.messages ?? []) {
			const text = typeof message.text === "string" ? message.text : "";
			if (!text.toLowerCase().includes(queryLower)) continue;
			matches.push({
				sessionId: session.id,
				role: message.role ?? "unknown",
				text,
				timestamp: message.timestamp,
			});
			if (matches.length >= maxResults) break;
		}
		if (matches.length >= maxResults) break;
	}

	if (outputJson) {
		console.log(JSON.stringify({ query, count: matches.length, matches }, null, 2));
		return;
	}

	if (matches.length === 0) {
		console.log(`No message matches for "${query}".`);
		return;
	}

	console.log(`Matches (${matches.length}) for "${query}":`);
	for (const entry of matches) {
		const when = entry.timestamp ? new Date(entry.timestamp).toISOString() : "unknown-time";
		console.log(`  [${entry.sessionId}] ${entry.role} @ ${when}`);
		console.log(`    ${entry.text}`);
	}
}

export async function runMessageCommand(opts: MessageOptions = {}): Promise<void> {
	const client = createRpcClient({ port: opts.port ? parseInt(opts.port, 10) : undefined });

	try {
		const hasInput = Boolean(
			opts.action ||
			opts.channel ||
			opts.to ||
			opts.text ||
			opts.messageId ||
			opts.replyTo ||
			opts.emoji ||
			opts.attachment ||
			opts.query ||
			opts.pollQuestion ||
			opts.pollOptions ||
			opts.permissions ||
			opts.threadTitle,
		);
		if (!hasInput) {
			console.log("Usage:");
			console.log("  understudy message send --channel web --to <recipient> --text 'hello'");
			console.log("  understudy message reply --channel web --to <recipient> --reply-to <messageId> --text 'hi'");
			console.log("  understudy message edit --channel web --message-id <messageId> --text 'updated'");
			console.log("  understudy message delete --channel web --message-id <messageId>");
			console.log("  understudy message react --channel web --message-id <messageId> --emoji 👍");
			console.log("  understudy message poll --channel web --to <recipient> --poll-question 'Lunch?' --poll-option Pizza --poll-option Sushi");
			console.log("  understudy message pin --channel web --message-id <messageId>");
			console.log("  understudy message permissions --channel web --permissions '{\"canSend\":true}'");
			console.log("  understudy message search --query 'keyword'");
			return;
		}

		const action = resolveAction(opts);
		if (action === "search") {
			const query = trim(opts.query);
			if (!query) {
				throw new Error("query is required for message search");
			}
			const maxResults = parsePositiveInt(opts.limit, 20);
			await runSearch(client, query, maxResults, opts.json === true);
			return;
		}

		const channelId = trim(opts.channel);
		const recipientId = trim(opts.to);
		const text = trim(opts.text);
		const messageId = trim(opts.messageId);
		const replyToMessageId = trim(opts.replyTo);
		const threadId = trim(opts.thread);
		const emoji = trim(opts.emoji);
		const pollQuestion = trim(opts.pollQuestion);
		const pollOptions = parseStringList(opts.pollOption) ?? parseStringList(opts.pollOptions);
		const pollId = trim(opts.pollId);
		const pollChoice = trim(opts.pollChoice);
		const pinReason = trim(opts.pinReason);
		const permissionsTarget = trim(opts.permissionsTarget);
		const permissions = parseJsonOrText(opts.permissions);
		const threadTitle = trim(opts.threadTitle);
		const threadTopic = trim(opts.threadTopic);
		const threadOwner = trim(opts.threadOwner);

		const payload: Record<string, unknown> = { action, channelId };
		if (recipientId) payload.recipientId = recipientId;
		if (text) payload.text = text;
		if (messageId) payload.messageId = messageId;
		if (replyToMessageId) payload.replyToMessageId = replyToMessageId;
		if (threadId) payload.threadId = threadId;
		if (emoji) payload.emoji = emoji;
		if (opts.remove) payload.remove = true;
		if (opts.attachment) payload.attachmentUrl = opts.attachment;
		if (opts.attachmentType) payload.attachmentType = opts.attachmentType;
		if (opts.attachmentName) payload.attachmentName = opts.attachmentName;
		if (opts.attachmentMimeType) payload.attachmentMimeType = opts.attachmentMimeType;
		if (pollQuestion) payload.pollQuestion = pollQuestion;
		if (pollOptions && pollOptions.length > 0) payload.pollOptions = pollOptions;
		if (pollId) payload.pollId = pollId;
		if (pollChoice) payload.pollChoice = pollChoice;
		if (pinReason) payload.pinReason = pinReason;
		if (permissionsTarget) payload.permissionsTarget = permissionsTarget;
		if (permissions !== undefined) payload.permissions = permissions;
		if (threadTitle) payload.threadTitle = threadTitle;
		if (threadTopic) payload.threadTopic = threadTopic;
		if (threadOwner) payload.threadOwner = threadOwner;
		if (opts.dryRun) payload.dryRun = true;

		if (!channelId) {
			throw new Error("channel is required");
		}

		const result = await client.call<Record<string, unknown>>("message.action", payload);
		if (opts.json) {
			console.log(JSON.stringify(result, null, 2));
			return;
		}

		switch (action) {
			case "send":
				console.log(`Message sent via ${channelId}: ${String(result.messageId ?? "ok")}`);
				break;
			case "reply":
				console.log(`Reply sent via ${channelId}: ${String(result.messageId ?? "ok")}`);
				break;
			case "sendattachment":
				console.log(`Attachment sent via ${channelId}: ${String(result.messageId ?? "ok")}`);
				break;
			case "edit":
				console.log(`Message edited via ${channelId}: ${messageId ?? ""}`.trim());
				break;
			case "delete":
				console.log(`Message deleted via ${channelId}: ${messageId ?? ""}`.trim());
				break;
			case "react":
				console.log(
					`Reaction ${opts.remove ? "removed" : "sent"} via ${channelId}: ${messageId ?? ""} ${emoji ?? ""}`.trim(),
				);
				break;
			default: {
				const resolvedMessageId =
					typeof result.messageId === "string"
						? result.messageId
						: undefined;
				if (resolvedMessageId) {
					console.log(`Action ${action} completed via ${channelId}: ${resolvedMessageId}`);
				} else {
					console.log(`Action ${action} completed via ${channelId}.`);
				}
				break;
			}
		}
	} catch (error) {
		console.error("Error:", error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
