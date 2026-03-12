import { createHash } from "node:crypto";
import { resolve } from "node:path";

export function buildSessionKey(params: {
	scope: "global" | "channel" | "sender" | "channel_sender";
	dmScope: "sender" | "thread";
	channelId?: string;
	senderId?: string;
	threadId?: string;
	scopeDiscriminator?: string;
}): string {
	const channelId = params.channelId?.trim() || "unknown-channel";
	const senderId = params.senderId?.trim() || "unknown-sender";
	const threadId = params.threadId?.trim();
	const discriminator = params.scopeDiscriminator?.trim();
	let baseKey: string;

	switch (params.scope) {
		case "global":
			baseKey = "global";
			break;
		case "channel":
			baseKey = `channel:${channelId}`;
			break;
		case "sender":
			baseKey = `sender:${senderId}`;
			break;
		case "channel_sender":
		default: {
			if (params.dmScope === "thread" && threadId) {
				baseKey = `channel_sender_thread:${channelId}:${senderId}:${threadId}`;
				break;
			}
			baseKey = `channel_sender:${channelId}:${senderId}`;
			break;
		}
	}
	return discriminator ? `${baseKey}:${discriminator}` : baseKey;
}

export function buildWorkspaceScopeDiscriminator(workspaceDir: string): string {
	const normalized = resolve(workspaceDir);
	const hash = createHash("sha1").update(normalized).digest("hex").slice(0, 12);
	return `ws_${hash}`;
}
