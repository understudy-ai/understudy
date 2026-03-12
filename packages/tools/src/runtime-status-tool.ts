import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { UnderstudyConfig } from "@understudy/types";
import { textResult } from "./bridge/bridge-rpc.js";

const RuntimeStatusSchema = Type.Object({});

type RuntimeStatusParams = Static<typeof RuntimeStatusSchema>;

export interface RuntimeStatusToolOptions {
	cwd?: string;
	config?: UnderstudyConfig;
	channel?: string;
	capabilities?: string[];
	gatewayUrl?: string;
}

export function createRuntimeStatusTool(
	options: RuntimeStatusToolOptions = {},
): AgentTool<typeof RuntimeStatusSchema> {
	return {
		name: "runtime_status",
		label: "Runtime Status",
		description:
			"Show current runtime status such as local time, timezone, workspace, default model, and whether gateway session tools are available.",
		parameters: RuntimeStatusSchema,
		execute: async (_toolCallId, _params: RuntimeStatusParams): Promise<AgentToolResult<unknown>> => {
			const timezone = resolveTimezone(options.config?.agent.userTimezone);
			const now = new Date();
			const formatted = formatLocalTime(now, timezone);
			const utcTime = now.toISOString().replace("T", " ").slice(0, 16) + " UTC";
			const defaultModel = resolveDefaultModel(options.config);
			const capabilities = (options.capabilities ?? []).map((value) => value.trim()).filter(Boolean);
			const hasGatewaySessionTools = Boolean(options.gatewayUrl?.trim());

			const lines = [
				formatted ? `Time: ${formatted} (${timezone})` : `Time zone: ${timezone}`,
				`UTC: ${utcTime}`,
				`Workspace: ${options.cwd?.trim() || process.cwd()}`,
				defaultModel ? `Default model: ${defaultModel}` : undefined,
				options.channel?.trim() ? `Channel: ${options.channel.trim()}` : undefined,
				capabilities.length > 0 ? `Capabilities: ${capabilities.join(", ")}` : undefined,
				`Gateway session tools: ${hasGatewaySessionTools ? "available" : "unavailable in this runtime"}`,
			].filter((line): line is string => Boolean(line));

			return textResult(lines.join("\n"), {
				timezone,
				time: formatted || undefined,
				utcTime,
				workspace: options.cwd?.trim() || process.cwd(),
				defaultModel: defaultModel || undefined,
				channel: options.channel?.trim() || undefined,
				capabilities,
				hasGatewaySessionTools,
			});
		},
	};
}

function resolveDefaultModel(config?: UnderstudyConfig): string | undefined {
	if (!config?.defaultProvider || !config.defaultModel) {
		return undefined;
	}
	return `${config.defaultProvider}/${config.defaultModel}`;
}

export function resolveTimezone(configured?: string): string {
	const value = configured?.trim();
	if (value) {
		return value;
	}
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

export function formatLocalTime(date: Date, timezone: string): string {
	try {
		return new Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			weekday: "long",
			year: "numeric",
			month: "long",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		}).format(date);
	} catch {
		return "";
	}
}
