import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type {
	AfterToolInput,
	RuntimePolicy,
	RuntimePolicyContext,
} from "../policy-pipeline.js";

function normalizeToolContent(
	toolName: string,
	content: unknown,
): AgentToolResult<unknown>["content"] {
	if (!Array.isArray(content) || content.length === 0) {
		return [{ type: "text", text: `Tool ${toolName} completed with no structured output.` }];
	}

	const normalized: AgentToolResult<unknown>["content"] = [];
	for (const item of content) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const candidate = item as Record<string, unknown>;
		if (candidate.type === "text" && typeof candidate.text === "string") {
			normalized.push({ type: "text", text: candidate.text });
			continue;
		}
		if (
			candidate.type === "image" &&
			(typeof candidate.data === "string" || typeof candidate.imageData === "string") &&
			typeof candidate.mimeType === "string"
		) {
			normalized.push({
				type: "image",
				data:
					typeof candidate.data === "string"
						? candidate.data
						: (candidate.imageData as string),
				mimeType: candidate.mimeType,
			});
		}
	}

	if (normalized.length > 0) {
		return normalized;
	}

	return [{ type: "text", text: `Tool ${toolName} returned unsupported content format.` }];
}

/**
 * Ensures tool outputs keep the canonical AgentToolResult shape.
 */
export function createNormalizeToolResultPolicy(): RuntimePolicy {
	return {
		name: "normalize_tool_result",
		afterTool: <TDetails = unknown>(
			_context: RuntimePolicyContext,
			input: AfterToolInput<TDetails>,
		): AgentToolResult<TDetails> => {
			const content = normalizeToolContent(input.toolName, input.result.content);
			const details = (input.result.details ?? ({} as TDetails)) as TDetails;
			return {
				...input.result,
				content: content as AgentToolResult<TDetails>["content"],
				details,
			};
		},
	};
}
