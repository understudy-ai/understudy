import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { asString } from "@understudy/core";
import {
	callGatewayRpc,
	errorResult,
	jsonResult,
	textResult,
	type BridgeGatewayOptions,
} from "./bridge-rpc.js";

const SubagentsSchema = Type.Object({
	action: Type.Optional(Type.String({ description: "Subagent action: list, wait, kill, steer." })),
	target: Type.Optional(Type.String({ description: "Target session ID for kill/steer." })),
	message: Type.Optional(Type.String({ description: "Steer message for action=steer." })),
	recentMinutes: Type.Optional(Type.Number({ minimum: 1 })),
	gatewayUrl: Type.Optional(Type.String()),
	gatewayToken: Type.Optional(Type.String()),
	timeoutMs: Type.Optional(Type.Number()),
});

type SubagentsParams = Static<typeof SubagentsSchema>;

interface NativeSubagentsOptions extends BridgeGatewayOptions {
	requesterSessionId?: string;
	subagentsHandler?: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export function createSubagentsTool(options: NativeSubagentsOptions = {}): AgentTool<typeof SubagentsSchema> {
	return {
		name: "subagents",
		label: "Subagents",
		description: "List, wait on, terminate, or steer native child sessions created by the current Understudy session.",
		parameters: SubagentsSchema,
		execute: async (_toolCallId, params: SubagentsParams): Promise<AgentToolResult<unknown>> => {
			const action = (asString(params.action) ?? "list").toLowerCase();
			const gateway = {
				...options,
				...params,
			};
			try {
				const result = options.subagentsHandler
					? await options.subagentsHandler({
						action,
						parentSessionId: options.requesterSessionId,
						target: asString(params.target),
						message: asString(params.message),
						recentMinutes: params.recentMinutes,
						timeoutMs: params.timeoutMs,
					})
					: await callGatewayRpc<Record<string, unknown>>(
						"subagents",
						{
							action,
							parentSessionId: options.requesterSessionId,
							target: asString(params.target),
							message: asString(params.message),
							recentMinutes: params.recentMinutes,
							timeoutMs: params.timeoutMs,
						},
						gateway,
					);
				if (action === "list") {
					const sessions = Array.isArray(result.subagents)
						? result.subagents as Array<Record<string, unknown>>
						: [];
					if (sessions.length === 0) {
						return textResult("No active child sessions found.", { subagents: [] });
					}
					const lines = sessions.map((entry, index) => {
						const id = asString(entry.sessionId) ?? asString(entry.id) ?? `session_${index + 1}`;
						const status = asString(entry.latestRunStatus) ?? "idle";
						const label = asString(entry.label);
						return `${index + 1}. ${id}${label ? ` [${label}]` : ""} status=${status}`;
					});
					return textResult(`subagents list:\n${lines.join("\n")}`, {
						subagents: sessions,
					});
				}
				return jsonResult(result, { action });
			} catch (error) {
				return errorResult("Failed to execute subagents action", error, { action });
			}
		},
	};
}
