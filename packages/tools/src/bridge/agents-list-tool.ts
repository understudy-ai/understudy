import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import {
	callGatewayRpc,
	errorResult,
	textResult,
	type BridgeGatewayOptions,
} from "./bridge-rpc.js";

const AgentsListSchema = Type.Object({
	gatewayUrl: Type.Optional(Type.String({ description: "Gateway base URL (default: http://127.0.0.1:23333)." })),
	gatewayToken: Type.Optional(Type.String({ description: "Gateway auth token when auth is enabled." })),
	timeoutMs: Type.Optional(Type.Number({ description: "Gateway request timeout in milliseconds." })),
});

type AgentsListParams = Static<typeof AgentsListSchema>;

export function createAgentsListTool(options: BridgeGatewayOptions = {}): AgentTool<typeof AgentsListSchema> {
	return {
		name: "agents_list",
		label: "Agents List",
		description: "List available gateway agent profiles.",
		parameters: AgentsListSchema,
		execute: async (_toolCallId, params: AgentsListParams): Promise<AgentToolResult<unknown>> => {
			try {
				const result = await callGatewayRpc<Record<string, unknown>>(
					"agents.list",
					{},
					{
						...options,
						...params,
					},
				);
				const agents = Array.isArray(result.agents) ? result.agents : [];
				if (agents.length === 0) {
					return textResult("No gateway agents found.", { agents: [] });
				}
				const lines = agents.map((entry) => {
					const item = entry as Record<string, unknown>;
					const id = typeof item.id === "string" ? item.id : "unknown";
					const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : undefined;
					return `- ${id}${name ? ` (${name})` : ""}`;
				});
				return textResult(`Agents:\n${lines.join("\n")}`, {
					agents,
					defaultId: result.defaultId,
				});
			} catch (error) {
				return errorResult("Failed to list agents", error);
			}
		},
	};
}
