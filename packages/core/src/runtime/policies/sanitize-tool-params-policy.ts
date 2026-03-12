import type {
	BeforeToolInput,
	BeforeToolOutput,
	RuntimePolicy,
	RuntimePolicyContext,
} from "../policy-pipeline.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value
			.map((item) => sanitizeValue(item))
			.filter((item) => item !== undefined);
	}
	if (isPlainObject(value)) {
		const next: Record<string, unknown> = {};
		for (const [key, current] of Object.entries(value)) {
			const sanitized = sanitizeValue(current);
			if (sanitized !== undefined) {
				next[key] = sanitized;
			}
		}
		return next;
	}
	if (value === undefined) {
		return undefined;
	}
	return value;
}

/**
 * Removes undefined fields from tool params before execution.
 * This keeps tool payloads deterministic across providers and transports.
 */
export function createSanitizeToolParamsPolicy(): RuntimePolicy {
	return {
		name: "sanitize_tool_params",
		beforeTool: <TParams = unknown>(
			_context: RuntimePolicyContext,
			input: BeforeToolInput<TParams>,
		): BeforeToolOutput<TParams> => {
			return {
				params: sanitizeValue(input.params) as TParams,
				signal: input.signal,
				onUpdate: input.onUpdate,
			};
		},
	};
}
