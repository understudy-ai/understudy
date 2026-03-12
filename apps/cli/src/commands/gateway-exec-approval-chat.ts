export type ExecApprovalChatDecision = "allow-once" | "allow-always" | "deny";

export type ExecApprovalChatCommand =
	| {
		kind: "list";
	}
	| {
		kind: "resolve";
		decision: ExecApprovalChatDecision;
		approvalId?: string;
	};

export interface ExecApprovalChatItem {
	id: string;
	command: string;
	createdAtMs: number;
	expiresAtMs: number;
	channelId?: string | null;
	senderId?: string | null;
	threadId?: string | null;
	sessionId?: string | null;
}

function trimToUndefined(value: string | undefined): string | undefined {
	const normalized = value?.trim();
	return normalized ? normalized : undefined;
}

function shortenCommand(command: string, maxLength: number = 96): string {
	const normalized = command.trim().replace(/\s+/g, " ");
	if (normalized.length <= maxLength) {
		return normalized;
	}
	return `${normalized.slice(0, maxLength - 3)}...`;
}

function formatApprovalCommandSnippet(item: ExecApprovalChatItem): string {
	return `"${shortenCommand(item.command)}"`;
}

export function parseExecApprovalChatCommand(text: string): ExecApprovalChatCommand | undefined {
	const trimmed = text.trim();
	if (!trimmed.startsWith("/")) {
		return undefined;
	}
	const tokens = trimmed.split(/\s+/).filter(Boolean);
	const command = tokens[0]?.toLowerCase();
	if (command === "/approvals") {
		return { kind: "list" };
	}
	if (command !== "/approve" && command !== "/deny") {
		return undefined;
	}
	if (command === "/deny") {
		return {
			kind: "resolve",
			decision: "deny",
			approvalId: trimToUndefined(tokens[1]),
		};
	}
	const firstArg = trimToUndefined(tokens[1]);
	const secondArg = trimToUndefined(tokens[2])?.toLowerCase();
	if (firstArg?.toLowerCase() === "always") {
		return {
			kind: "resolve",
			decision: "allow-always",
		};
	}
	return {
		kind: "resolve",
		decision: secondArg === "always" ? "allow-always" : "allow-once",
		approvalId: firstArg,
	};
}

export function filterExecApprovalItemsForContext(
	items: ExecApprovalChatItem[],
	context: {
		channelId?: string;
		senderId?: string;
		threadId?: string;
	},
): ExecApprovalChatItem[] {
	const channelId = trimToUndefined(context.channelId);
	const senderId = trimToUndefined(context.senderId);
	const threadId = trimToUndefined(context.threadId) ?? "";
	return items.filter((item) =>
		(trimToUndefined(item.channelId ?? undefined) ?? "") === (channelId ?? "") &&
		(trimToUndefined(item.senderId ?? undefined) ?? "") === (senderId ?? "") &&
		(trimToUndefined(item.threadId ?? undefined) ?? "") === threadId);
}

export function resolveExecApprovalChatTarget(params: {
	items: ExecApprovalChatItem[];
	approvalId?: string;
}): {
	item?: ExecApprovalChatItem;
	errorText?: string;
} {
	const requestedId = trimToUndefined(params.approvalId);
	if (requestedId) {
		const matched = params.items.find((item) => item.id === requestedId);
		return matched
			? { item: matched }
			: { errorText: `Approval "${requestedId}" was not found for this conversation.` };
	}
	if (params.items.length === 0) {
		return { errorText: "No pending approvals for this conversation." };
	}
	if (params.items.length > 1) {
		return {
			errorText:
				"Multiple approvals are pending here. Use /approvals to list them, then reply with /approve <id> or /deny <id>.",
		};
	}
	return { item: params.items[0] };
}

export function formatExecApprovalPrompt(item: ExecApprovalChatItem): string {
	return [
		`Approval required for ${formatApprovalCommandSnippet(item)}.`,
		`Reply /approve ${item.id}, /approve ${item.id} always, or /deny ${item.id}.`,
	].join(" ");
}

export function formatExecApprovalList(items: ExecApprovalChatItem[]): string {
	if (items.length === 0) {
		return "No pending approvals for this conversation.";
	}
	return [
		"Pending approvals:",
		...items.map((item) =>
			`- ${item.id}: ${shortenCommand(item.command, 72)} (reply /approve ${item.id} or /deny ${item.id})`),
	].join("\n");
}

export function formatExecApprovalDecisionResult(
	item: ExecApprovalChatItem,
	decision: ExecApprovalChatDecision,
): string {
	if (decision === "deny") {
		return `Denied approval ${item.id} for ${formatApprovalCommandSnippet(item)}.`;
	}
	if (decision === "allow-always") {
		return `Approved ${item.id} and saved ${formatApprovalCommandSnippet(item)} to the allowlist.`;
	}
	return `Approved ${item.id} once for ${formatApprovalCommandSnippet(item)}.`;
}
