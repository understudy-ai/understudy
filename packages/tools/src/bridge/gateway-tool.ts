import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { asString } from "@understudy/core";
import {
	callGatewayRpc,
	errorResult,
	jsonResult,
	type BridgeGatewayOptions,
} from "./bridge-rpc.js";

const GATEWAY_ACTIONS = [
	"restart",
	"config.get",
	"config.schema",
	"config.apply",
] as const;

const GatewaySchema = Type.Object({
	action: Type.String({
		description: "Gateway action: restart, config.get, config.schema, config.apply.",
	}),
	raw: Type.Optional(Type.String()),
	baseHash: Type.Optional(Type.String()),
	sessionKey: Type.Optional(Type.String()),
	note: Type.Optional(Type.String()),
	restartDelayMs: Type.Optional(Type.Number()),
	delayMs: Type.Optional(Type.Number()),
	reason: Type.Optional(Type.String()),
	gatewayUrl: Type.Optional(Type.String()),
	gatewayToken: Type.Optional(Type.String()),
	timeoutMs: Type.Optional(Type.Number()),
});

type GatewayParams = Static<typeof GatewaySchema>;

export function createGatewayTool(options: BridgeGatewayOptions = {}): AgentTool<typeof GatewaySchema> {
	return {
	name: "gateway",
	label: "Gateway",
	description: "Gateway bridge operations for config workflows.",
	parameters: GatewaySchema,
		execute: async (_toolCallId, params: GatewayParams): Promise<AgentToolResult<unknown>> => {
			const action = asString(params.action) ?? "";
			if (!GATEWAY_ACTIONS.includes(action as (typeof GATEWAY_ACTIONS)[number])) {
				return errorResult("Failed to execute gateway action", `Unknown action: ${params.action}`);
			}
			const gateway = {
				...options,
				...params,
			};
			try {
				switch (action) {
					case "restart":
						return jsonResult(
							await callGatewayRpc(
								"config.reload",
								{
									reason: asString(params.reason),
									delayMs: typeof params.delayMs === "number" ? params.delayMs : undefined,
									source: "gateway-tool",
								},
								gateway,
							),
						);
					case "config.get":
						return jsonResult(await callGatewayRpc("config.get", {}, gateway));
					case "config.schema":
						return jsonResult(await callGatewayRpc("config.schema", {}, gateway));
					case "config.apply": {
						const raw = asString(params.raw);
						if (!raw) {
							return errorResult("Failed to execute gateway action", "raw is required for config.apply");
						}
						return jsonResult(
							await callGatewayRpc(
								"config.apply",
								{
									raw,
									baseHash: asString(params.baseHash),
									sessionKey: asString(params.sessionKey),
									note: asString(params.note),
									restartDelayMs:
										typeof params.restartDelayMs === "number" ? params.restartDelayMs : undefined,
								},
								gateway,
							),
						);
					}
					default:
						return errorResult("Failed to execute gateway action", `Unsupported action: ${action}`);
				}
			} catch (error) {
				return errorResult("Failed to execute gateway action", error, { action });
			}
		},
	};
}
