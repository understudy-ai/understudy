import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import {
	formatRuntimePlatformCapabilities,
	normalizeRuntimePlatformCapabilities,
	type RuntimePlatformCapability,
} from "./platform-capabilities.js";

function resolvePlatformCapabilities(
	capabilities:
		| RuntimePlatformCapability[]
		| (() => RuntimePlatformCapability[] | undefined)
		| undefined,
): RuntimePlatformCapability[] {
	return normalizeRuntimePlatformCapabilities(
		typeof capabilities === "function" ? capabilities() : capabilities,
	);
}

export function createPlatformCapabilitiesTool(
	capabilities:
		| RuntimePlatformCapability[]
		| (() => RuntimePlatformCapability[] | undefined)
		| undefined,
): AgentTool<any> {
	return {
		name: "platform_capabilities",
		label: "Platform Capabilities",
		description: "Inspect built-in and plugin-provided platform capability surfaces available in this runtime.",
		parameters: Type.Object({
			format: Type.Optional(Type.Union([
				Type.Literal("text"),
				Type.Literal("json"),
			])),
		}),
		execute: async (_id: string, params: { format?: "text" | "json" } = {}) => {
			const normalized = resolvePlatformCapabilities(capabilities);
			if (params.format === "json") {
				return {
					content: [{
						type: "text",
						text: JSON.stringify({ capabilities: normalized }, null, 2),
					}],
				};
			}
			return {
				content: [{
					type: "text",
					text: formatRuntimePlatformCapabilities(normalized),
				}],
			};
		},
	} as AgentTool<any>;
}
