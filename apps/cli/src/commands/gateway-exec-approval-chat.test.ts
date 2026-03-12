import { describe, expect, it } from "vitest";
import {
	filterExecApprovalItemsForContext,
	formatExecApprovalDecisionResult,
	formatExecApprovalList,
	formatExecApprovalPrompt,
	parseExecApprovalChatCommand,
	resolveExecApprovalChatTarget,
	type ExecApprovalChatItem,
} from "./gateway-exec-approval-chat.js";

function createItem(overrides: Partial<ExecApprovalChatItem> = {}): ExecApprovalChatItem {
	return {
		id: "appr_1",
		command: 'gui_click {"target":"Continue"}',
		createdAtMs: 1,
		expiresAtMs: 2,
		channelId: "telegram",
		senderId: "u1",
		threadId: undefined,
		sessionId: "s1",
		...overrides,
	};
}

describe("gateway exec approval chat helpers", () => {
	it("parses list and resolve commands", () => {
		expect(parseExecApprovalChatCommand("/approvals")).toEqual({ kind: "list" });
		expect(parseExecApprovalChatCommand("/approve appr_1")).toEqual({
			kind: "resolve",
			decision: "allow-once",
			approvalId: "appr_1",
		});
		expect(parseExecApprovalChatCommand("/approve appr_1 always")).toEqual({
			kind: "resolve",
			decision: "allow-always",
			approvalId: "appr_1",
		});
		expect(parseExecApprovalChatCommand("/deny appr_1")).toEqual({
			kind: "resolve",
			decision: "deny",
			approvalId: "appr_1",
		});
	});

	it("filters approvals by channel sender and thread", () => {
		const items = [
			createItem(),
			createItem({ id: "appr_2", senderId: "u2" }),
			createItem({ id: "appr_3", threadId: "t1" }),
		];
		expect(
			filterExecApprovalItemsForContext(items, {
				channelId: "telegram",
				senderId: "u1",
			}).map((item) => item.id),
		).toEqual(["appr_1"]);
		expect(
			filterExecApprovalItemsForContext(items, {
				channelId: "telegram",
				senderId: "u1",
				threadId: "t1",
			}).map((item) => item.id),
		).toEqual(["appr_3"]);
	});

	it("requires an explicit id when multiple approvals are pending", () => {
		const items = [createItem(), createItem({ id: "appr_2" })];
		expect(resolveExecApprovalChatTarget({ items })).toEqual({
			errorText:
				"Multiple approvals are pending here. Use /approvals to list them, then reply with /approve <id> or /deny <id>.",
		});
		expect(resolveExecApprovalChatTarget({ items, approvalId: "appr_2" }).item?.id).toBe("appr_2");
	});

	it("formats prompts and result text", () => {
		const item = createItem();
		expect(formatExecApprovalPrompt(item)).toContain("/approve appr_1");
		expect(formatExecApprovalList([item])).toContain("Pending approvals:");
		expect(formatExecApprovalDecisionResult(item, "allow-once")).toContain("Approved appr_1 once");
		expect(formatExecApprovalDecisionResult(item, "allow-always")).toContain("saved");
		expect(formatExecApprovalDecisionResult(item, "deny")).toContain("Denied approval appr_1");
	});
});
