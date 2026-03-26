import type { RuntimePolicy } from "../policy-pipeline.js";
import { createGuardAssistantReplyPolicy } from "./guard-assistant-reply-policy.js";
import { createNormalizeToolResultPolicy } from "./normalize-tool-result-policy.js";
import { createSanitizeToolParamsPolicy } from "./sanitize-tool-params-policy.js";
import { createStripAssistantDirectiveTagsPolicy } from "./strip-assistant-directive-tags-policy.js";

export interface RuntimePolicyModuleFactoryInput {
	options?: Record<string, unknown>;
}

export type RuntimePolicyModuleFactory = (
	input: RuntimePolicyModuleFactoryInput,
) => RuntimePolicy | RuntimePolicy[];

export const DEFAULT_RUNTIME_POLICY_MODULE_ORDER = [
	"sanitize_tool_params",
	"normalize_tool_result",
	"strip_assistant_directive_tags",
	"guard_assistant_reply",
] as const;

export const builtInRuntimePolicyFactories: Record<string, RuntimePolicyModuleFactory> = {
	sanitize_tool_params: () => createSanitizeToolParamsPolicy(),
	normalize_tool_result: () => createNormalizeToolResultPolicy(),
	route_retry_guard: () => [],
	strip_assistant_directive_tags: () => createStripAssistantDirectiveTagsPolicy(),
	guard_assistant_reply: () => createGuardAssistantReplyPolicy(),
};
