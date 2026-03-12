import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { callGatewayRpc, errorResult, textResult } from "./bridge/bridge-rpc.js";
import { resolveTimezone, formatLocalTime } from "./runtime-status-tool.js";

const SessionsListSchema = Type.Object({
	channelId: Type.Optional(Type.String({ description: "Filter by channel ID." })),
	senderId: Type.Optional(Type.String({ description: "Filter by sender ID." })),
	gatewayUrl: Type.Optional(Type.String({ description: "Gateway base URL (default: http://127.0.0.1:23333)." })),
});

const SessionsHistorySchema = Type.Object({
	sessionId: Type.String({ description: "Session ID returned by sessions_list." }),
	limit: Type.Optional(Type.Number({ description: "Maximum history messages to return." })),
	gatewayUrl: Type.Optional(Type.String({ description: "Gateway base URL (default: http://127.0.0.1:23333)." })),
});

const SessionStatusSchema = Type.Object({
	sessionId: Type.String({ description: "Session ID returned by sessions_list." }),
	gatewayUrl: Type.Optional(Type.String({ description: "Gateway base URL (default: http://127.0.0.1:23333)." })),
});

const SessionsSendSchema = Type.Object({
	sessionId: Type.String({ description: "Target session ID returned by sessions_list." }),
	message: Type.String({ description: "Message to send to the target session." }),
	gatewayUrl: Type.Optional(Type.String({ description: "Gateway base URL (default: http://127.0.0.1:23333)." })),
});

type SessionsListParams = Static<typeof SessionsListSchema>;
type SessionsHistoryParams = Static<typeof SessionsHistorySchema>;
type SessionStatusParams = Static<typeof SessionStatusSchema>;
type SessionsSendParams = Static<typeof SessionsSendSchema>;

export interface SessionsToolOptions {
	gatewayUrl?: string;
}

function resolveGatewayUrl(paramGatewayUrl: string | undefined, options?: SessionsToolOptions): string {
	return paramGatewayUrl?.trim() || options?.gatewayUrl?.trim() || process.env.UNDERSTUDY_GATEWAY_URL?.trim() || "http://127.0.0.1:23333";
}

export function createSessionsListTool(options?: SessionsToolOptions): AgentTool<typeof SessionsListSchema> {
	return {
		name: "sessions_list",
		label: "Sessions List",
		description:
			"List active gateway sessions. " +
			"Useful for inspecting sender/channel-isolated sessions before reading history.",
		parameters: SessionsListSchema,
		execute: async (_toolCallId, params: SessionsListParams): Promise<AgentToolResult<unknown>> => {
			try {
				const gatewayUrl = resolveGatewayUrl(params.gatewayUrl, options);
				const sessions = await callGatewayRpc<Array<Record<string, unknown>>>(
					"session.list",
					{
						channelId: params.channelId,
						senderId: params.senderId,
					},
					{ gatewayUrl },
				);
				if (!Array.isArray(sessions) || sessions.length === 0) {
					return textResult("No sessions found.", { sessions: [] });
				}
				const lines = sessions.map((session) =>
					`- ${String(session.id)} ` +
					`[channel=${String(session.channelId ?? "-")}, sender=${String(session.senderId ?? "-")}, messages=${String(session.messageCount ?? 0)}]`,
				);
				return textResult(`Sessions:\n${lines.join("\n")}`, { sessions });
			} catch (error) {
				return errorResult("Failed to list sessions", error);
			}
		},
	};
}

export function createSessionsHistoryTool(options?: SessionsToolOptions): AgentTool<typeof SessionsHistorySchema> {
	return {
		name: "sessions_history",
		label: "Sessions History",
		description: "Fetch chat history for a session ID from the gateway.",
		parameters: SessionsHistorySchema,
		execute: async (_toolCallId, params: SessionsHistoryParams): Promise<AgentToolResult<unknown>> => {
			try {
				const gatewayUrl = resolveGatewayUrl(params.gatewayUrl, options);
				const history = await callGatewayRpc<{ sessionId: string; messages: Array<Record<string, unknown>> }>(
					"session.history",
					{
						sessionId: params.sessionId,
						limit: params.limit,
					},
					{ gatewayUrl },
				);
				const messages = Array.isArray(history.messages) ? history.messages : [];
				if (messages.length === 0) {
					return textResult(`No history for session ${params.sessionId}.`, {
						sessionId: params.sessionId,
						messages: [],
					});
				}
				const lines = messages.map(
					(msg) => `- ${String(msg.role ?? "unknown")}: ${String(msg.text ?? "").slice(0, 200)}`,
				);
				return textResult(`History (${params.sessionId}):\n${lines.join("\n")}`, {
					sessionId: params.sessionId,
					messages,
				});
			} catch (error) {
				return errorResult("Failed to fetch session history", error);
			}
		},
	};
}

function formatSessionStatus(session: Record<string, unknown>): string {
	const timeLine = buildCurrentTimeLine();
	return [
		`Session: ${String(session.id)}`,
		`Channel: ${String(session.channelId ?? "-")}`,
		`Sender: ${String(session.senderId ?? "-")}`,
		`Thread: ${String(session.threadId ?? "-")}`,
		`Messages: ${String(session.messageCount ?? 0)}`,
		`Created: ${String(session.createdAt ?? "-")}`,
		`Last Active: ${String(session.lastActiveAt ?? "-")}`,
		timeLine,
	].join("\n");
}

function buildCurrentTimeLine(): string {
	const timezone = resolveTimezone();
	const formatted = formatLocalTime(new Date(), timezone);
	return formatted
		? `Time: ${formatted} (${timezone})`
		: `Time zone: ${timezone}`;
}

export function createSessionStatusTool(options?: SessionsToolOptions): AgentTool<typeof SessionStatusSchema> {
	return {
		name: "session_status",
		label: "Session Status",
		description: "Show metadata for one active gateway session by session ID.",
		parameters: SessionStatusSchema,
		execute: async (_toolCallId, params: SessionStatusParams): Promise<AgentToolResult<unknown>> => {
			try {
				const gatewayUrl = resolveGatewayUrl(params.gatewayUrl, options);
				const sessionId = params.sessionId?.trim();
				if (!sessionId) {
					return errorResult("Failed to fetch session status", "sessionId is required");
				}
				const session = await callGatewayRpc<Record<string, unknown> | null>(
					"session.get",
					{ sessionId },
					{ gatewayUrl },
				);
				if (!session) {
					return textResult(`Session not found: ${sessionId}`, { sessionId });
				}
				return textResult(formatSessionStatus(session), { session });
			} catch (error) {
				return errorResult("Failed to fetch session status", error);
			}
		},
	};
}

export function createSessionsSendTool(options?: SessionsToolOptions): AgentTool<typeof SessionsSendSchema> {
	return {
		name: "sessions_send",
		label: "Sessions Send",
		description: "Send a message to an active gateway session by session ID.",
		parameters: SessionsSendSchema,
		execute: async (_toolCallId, params: SessionsSendParams): Promise<AgentToolResult<unknown>> => {
			try {
				const gatewayUrl = resolveGatewayUrl(params.gatewayUrl, options);
				const sessionId = params.sessionId?.trim();
				if (!sessionId) {
					return errorResult("Failed to send to session", "sessionId is required");
				}
				const result = await callGatewayRpc<{
					sessionId: string;
					response: string;
				}>(
					"session.send",
					{
						sessionId,
						message: params.message,
					},
					{ gatewayUrl },
				);
				const response = result?.response ?? "";
				const resolvedSessionId = result?.sessionId ?? sessionId;
				return textResult(`sessions_send(${resolvedSessionId}) response:\n${response}`, {
					sessionId: resolvedSessionId,
					response,
				});
			} catch (error) {
				return errorResult("Failed to send to session", error);
			}
		},
	};
}
