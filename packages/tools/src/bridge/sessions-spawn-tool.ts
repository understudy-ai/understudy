import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { asString } from "@understudy/core";
import {
	callGatewayRpc,
	errorResult,
	textResult,
	type BridgeGatewayOptions,
} from "./bridge-rpc.js";

const AttachmentSchema = Type.Object({
	type: Type.Union([
		Type.Literal("image"),
		Type.Literal("file"),
		Type.Literal("audio"),
		Type.Literal("video"),
	]),
	url: Type.String(),
	name: Type.Optional(Type.String()),
	mimeType: Type.Optional(Type.String()),
	size: Type.Optional(Type.Number({ minimum: 0 })),
});

const SessionsSpawnSchema = Type.Object({
	task: Type.String({ description: "Task text for the spawned session." }),
	label: Type.Optional(Type.String()),
	runtime: Type.Optional(Type.Union([
		Type.Literal("subagent"),
		Type.Literal("acp"),
	], {
		description: 'Child runtime. Use "subagent" for native Understudy child sessions. Use "acp" only when ACP is configured.',
	})),
	agentId: Type.Optional(Type.String({
		description: "Optional Understudy agent profile id whose workspace/model defaults should be applied to the child session.",
	})),
	model: Type.Optional(Type.String()),
	thinking: Type.Optional(Type.String()),
	cwd: Type.Optional(Type.String()),
	runTimeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
	thread: Type.Optional(Type.Boolean({
		description: 'Request a reusable child thread. Supported for runtime="subagent" only.',
	})),
	mode: Type.Optional(Type.Union([
		Type.Literal("run"),
		Type.Literal("session"),
	], {
		description: 'Child lifetime. Use "run" for one-shot work and "session" for reusable children.',
	})),
	cleanup: Type.Optional(Type.Union([
		Type.Literal("keep"),
		Type.Literal("delete"),
	], {
		description: 'Cleanup policy for child runs. Use "delete" for disposable run-mode children.',
	})),
	sandbox: Type.Optional(Type.Union([
		Type.Literal("inherit"),
		Type.Literal("require"),
	], {
		description: 'Sandbox policy for the child. "require" is supported for runtime="subagent" only.',
	})),
	sessionId: Type.Optional(Type.String()),
	gatewayUrl: Type.Optional(Type.String()),
	gatewayToken: Type.Optional(Type.String()),
	timeoutMs: Type.Optional(Type.Number()),
	attachments: Type.Optional(Type.Array(AttachmentSchema, { maxItems: 20 })),
});

type SessionsSpawnParams = Static<typeof SessionsSpawnSchema>;

interface NativeSessionsSpawnOptions extends BridgeGatewayOptions {
	requesterSessionId?: string;
	spawnHandler?: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

const DEFAULT_SPAWN_TIMEOUT_MS = 120_000;
const UNSUPPORTED_DELIVERY_PARAMS = ["channel", "recipient", "threadId", "replyTo", "streamTo"] as const;

function resolveSpawnTimeoutMs(
	params: Pick<SessionsSpawnParams, "timeoutMs" | "runTimeoutSeconds">,
	options: BridgeGatewayOptions,
): number {
	if (typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs) && params.timeoutMs > 0) {
		return Math.max(1, Math.floor(params.timeoutMs));
	}
	const runTimeoutSeconds =
		typeof params.runTimeoutSeconds === "number" && Number.isFinite(params.runTimeoutSeconds)
			? params.runTimeoutSeconds
			: undefined;
	if (typeof runTimeoutSeconds === "number" && runTimeoutSeconds > 0) {
		return Math.max(1, Math.floor(runTimeoutSeconds * 1000));
	}
	if (typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) {
		return Math.max(1, Math.floor(options.timeoutMs));
	}
	return DEFAULT_SPAWN_TIMEOUT_MS;
}

// This tool opens a native child session through sessions.spawn rather than
// overloading session.send or session.branch semantics.
export function createSessionsSpawnTool(options: NativeSessionsSpawnOptions = {}): AgentTool<typeof SessionsSpawnSchema> {
	return {
		name: "sessions_spawn",
		label: "Sessions Spawn",
		description:
			"Spawn a native child session under the current Understudy session. " +
			"Use runtime=subagent for local delegated work. Use runtime=acp only for configured external ACP harnesses; ACP children do not support thread=true or sandbox=require.",
		parameters: SessionsSpawnSchema,
		execute: async (_toolCallId, params: SessionsSpawnParams): Promise<AgentToolResult<unknown>> => {
			const task = asString(params.task);
			if (!task) {
				return errorResult("Failed to spawn session", "task is required");
			}
			const rawParams = params as Record<string, unknown>;
			for (const paramName of UNSUPPORTED_DELIVERY_PARAMS) {
				if (paramName in rawParams && rawParams[paramName] !== undefined) {
					return errorResult(
						"Failed to spawn session",
						`sessions_spawn does not support "${paramName}". Use message_send or the current session reply path for channel delivery.`,
					);
				}
			}
			const gateway = {
				...params,
				...options,
				timeoutMs: resolveSpawnTimeoutMs(params, options),
			};
			try {
				const result = options.spawnHandler
					? await options.spawnHandler({
						parentSessionId: options.requesterSessionId,
						task,
						label: asString(params.label),
						runtime: asString(params.runtime),
						agentId: asString(params.agentId),
						model: asString(params.model),
						thinking: asString(params.thinking),
						cwd: asString(params.cwd),
						thread: params.thread === true,
						mode: asString(params.mode),
						cleanup: asString(params.cleanup),
						sandbox: asString(params.sandbox),
						sessionId: asString(params.sessionId),
						timeoutMs: params.timeoutMs,
						runTimeoutSeconds: params.runTimeoutSeconds,
						attachments: Array.isArray(params.attachments) ? params.attachments : undefined,
					})
					: await callGatewayRpc<{
						sessionId?: string;
						childSessionId?: string;
						runId?: string;
						status?: string;
						mode?: string;
						runtime?: string;
					}>(
						"sessions.spawn",
						{
							parentSessionId: options.requesterSessionId,
							task,
							label: asString(params.label),
							runtime: asString(params.runtime),
							agentId: asString(params.agentId),
							model: asString(params.model),
							thinking: asString(params.thinking),
							cwd: asString(params.cwd),
							thread: params.thread === true,
							mode: asString(params.mode),
							cleanup: asString(params.cleanup),
							sandbox: asString(params.sandbox),
							sessionId: asString(params.sessionId),
							timeoutMs: params.timeoutMs,
							runTimeoutSeconds: params.runTimeoutSeconds,
							attachments: Array.isArray(params.attachments) ? params.attachments : undefined,
						},
						gateway,
					);
				const sessionId = asString(result.sessionId) ?? "unknown";
				const status = asString(result.status) ?? "in_flight";
				const childSessionId = asString(result.childSessionId) ?? sessionId;
				return textResult(`sessions_spawn(${childSessionId}) status=${status}`, {
					sessionId,
					childSessionId,
					runId: asString(result.runId),
					status,
					runtime: asString(result.runtime) ?? asString(params.runtime) ?? "subagent",
					mode: asString(result.mode) ?? asString(params.mode) ?? "run",
				});
			} catch (error) {
				return errorResult("Failed to spawn session", error);
			}
		},
	};
}
