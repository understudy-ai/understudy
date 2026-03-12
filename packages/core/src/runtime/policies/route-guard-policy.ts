import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type {
	AfterToolInput,
	BeforePromptInput,
	BeforePromptOutput,
	RuntimePolicy,
	RuntimePolicyContext,
} from "../policy-pipeline.js";
import {
	buildToolExecutionResultSummary,
} from "../tool-execution-trace.js";

const DEFAULT_MAX_CONSECUTIVE_FAILURES = 2;
const DEFAULT_MAX_REPORTED_ROUTES = 3;
const GUARDED_ROUTES = new Set(["gui", "browser", "web", "shell", "process"]);
const ROUTE_GUARD_HEADER = "[Understudy runtime route guard]";

interface RouteFailureState {
	consecutiveFailures: number;
	lastToolName?: string;
	lastSummary?: string;
	lastParamsHint?: string;
	repeatedAttemptCount?: number;
	lastFailureFingerprint?: string;
}

function trimHint(value: string, maxLength: number = 120): string {
	const normalized = value.trim().replace(/\s+/g, " ");
	if (normalized.length <= maxLength) {
		return normalized;
	}
	return `${normalized.slice(0, maxLength - 3)}...`;
}

function summarizeFailureParams(params: unknown): string | undefined {
	if (!params || typeof params !== "object" || Array.isArray(params)) {
		return undefined;
	}
	const record = params as Record<string, unknown>;
	const candidates: string[] = [];
	const push = (label: string, value: unknown) => {
		if (typeof value !== "string" || value.trim().length === 0) {
			return;
		}
		candidates.push(`${label}=${trimHint(value)}`);
	};
	push("target", record.target);
	push("url", record.url);
	push("command", record.command);
	push("path", record.path);
	push("app", record.app);
	push("scope", record.scope);
	push("recipient", record.recipientId);
	push("query", record.query);
	return candidates.length > 0 ? candidates.slice(0, 2).join(", ") : undefined;
}

function describeFailure(
	toolName: string,
	summary: ReturnType<typeof buildToolExecutionResultSummary>,
): string {
	if (summary.status && typeof summary.status.summary === "string") {
		return summary.status.summary;
	}
	return summary.textPreview || `${toolName} failed.`;
}

function buildPromptGuardNote(entries: Array<[string, RouteFailureState]>): string {
	const lines = [
		ROUTE_GUARD_HEADER,
		"Repeated failures were already observed earlier in this session.",
		"For the current substep, prefer switching routes or replanning unless you now have materially new evidence that one of these routes should work.",
	];
	for (const [route, state] of entries) {
		lines.push(
			`- ${route}: ${state.consecutiveFailures} consecutive failure(s). Last tool: ${state.lastToolName ?? "unknown"}.${
				state.lastParamsHint ? ` Last params: ${state.lastParamsHint}.` : ""
			}${state.repeatedAttemptCount && state.repeatedAttemptCount > 1 ? ` Same attempt repeated ${state.repeatedAttemptCount} times.` : ""}${
				state.lastSummary ? ` Last failure: ${state.lastSummary}` : ""
			}`,
		);
	}
	lines.push("Prefer another viable route or replan instead of blind retrying.");
	return lines.join("\n");
}

export function createRouteRetryGuardPolicy(): RuntimePolicy {
	const routeFailures = new Map<string, RouteFailureState>();

	return {
		name: "route_retry_guard",
		beforePrompt: (
			_context: RuntimePolicyContext,
			input: BeforePromptInput,
		): BeforePromptOutput => {
			const blockedRoutes = Array.from(routeFailures.entries())
				.filter(([, state]) => state.consecutiveFailures >= DEFAULT_MAX_CONSECUTIVE_FAILURES)
				.slice(0, DEFAULT_MAX_REPORTED_ROUTES);
			if (blockedRoutes.length === 0 || input.text.includes(ROUTE_GUARD_HEADER)) {
				return input;
			}
			return {
				text: `${buildPromptGuardNote(blockedRoutes)}\n\n${input.text}`,
				options: input.options,
			};
		},
		afterTool: <TDetails = unknown>(
			_context: RuntimePolicyContext,
			input: AfterToolInput<TDetails>,
		) => {
			const summary = buildToolExecutionResultSummary(
				input.toolName,
				input.result as AgentToolResult<unknown>,
			);
			if (!GUARDED_ROUTES.has(summary.route)) {
				return input.result;
			}
				if (summary.isError) {
					const current = routeFailures.get(summary.route) ?? { consecutiveFailures: 0 };
					const lastParamsHint = summarizeFailureParams(input.params);
					const lastFailureFingerprint = `${input.toolName}::${lastParamsHint ?? "no-params"}`;
					routeFailures.set(summary.route, {
						consecutiveFailures: current.consecutiveFailures + 1,
						lastToolName: input.toolName,
						lastSummary: describeFailure(input.toolName, summary),
						lastParamsHint,
						lastFailureFingerprint,
						repeatedAttemptCount:
							current.lastFailureFingerprint === lastFailureFingerprint
								? (current.repeatedAttemptCount ?? 1) + 1
								: 1,
					});
					return input.result;
				}
			routeFailures.delete(summary.route);
			return input.result;
		},
	};
}
