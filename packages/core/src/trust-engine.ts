/**
 * TrustEngine: policy pipeline for tool risk gating.
 *
 * Evaluates tool calls against configured policies to determine
 * whether to allow, deny, or require approval.
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import type { ToolPolicy, ToolEntry } from "@understudy/types";
import { createLogger, type Logger } from "./logger.js";
import {
	compileToolPolicies,
	normalizeToolPolicyRateLimitKey,
	resolveCompiledPolicyMatch,
	type CompiledToolPolicy,
	type ToolPolicyMatchEntry,
} from "./tool-policy-matcher.js";

export type PolicyDecision = "allow" | "deny" | "require_approval";

export interface TrustEngineOptions {
	policies: ToolPolicy[];
	autoApproveReadOnly?: boolean;
	onApprovalRequired?: (toolName: string, params?: unknown) => Promise<boolean>;
}

export class TrustEngine {
	private compiledPolicies: CompiledToolPolicy[];
	private autoApproveReadOnly: boolean;
	private onApprovalRequired?: (toolName: string, params?: unknown) => Promise<boolean>;
	private callCounts = new Map<string, { count: number; windowStart: number }>();
	private logger: Logger;

	constructor(options: TrustEngineOptions) {
		this.compiledPolicies = compileToolPolicies(options.policies);
		this.autoApproveReadOnly = options.autoApproveReadOnly ?? true;
		this.onApprovalRequired = options.onApprovalRequired;
		this.logger = createLogger("TrustEngine");
	}

	/** Evaluate a tool call against policies */
	evaluate(toolName: string, entry?: ToolPolicyMatchEntry): PolicyDecision {
		// Check explicit policies first (order matters — first match wins)
		for (const policy of this.compiledPolicies) {
			const match = resolveCompiledPolicyMatch(policy, toolName, entry);
			if (match) {
				const { source } = policy;
				if (source.action === "deny") return "deny";
				if (source.action === "require_approval") return "require_approval";

				// Check rate limit
				if (source.rateLimit && !this.checkRateLimit(match.rateLimitKey, source.rateLimit)) {
					this.logger.warn(`Rate limit exceeded for ${toolName}`);
					return "deny";
				}
				return "allow";
			}
		}

		// Default: auto-approve read-only tools
		if (this.autoApproveReadOnly && entry?.riskLevel === "read") {
			return "allow";
		}

		return "allow";
	}

	/** Wrap tools with trust gating */
	wrapTools(entries: ToolEntry[]): AgentTool<TSchema>[] {
		return entries.map((entry) => this.wrapTool(entry));
	}

	private wrapTool(entry: ToolEntry): AgentTool<TSchema> {
		const { tool } = entry;

		return {
			...tool,
			execute: async (toolCallId, params, signal, onUpdate) => {
				const deniedResult = await this.resolveDeniedResult(tool.name, entry, params);
				if (deniedResult) {
					return deniedResult;
				}

				return tool.execute(toolCallId, params, signal, onUpdate);
			},
		};
	}

	private async resolveDeniedResult(
		toolName: string,
		entry: ToolPolicyMatchEntry | undefined,
		params?: unknown,
	): Promise<AgentToolResult<unknown> | null> {
		const decision = this.evaluate(toolName, entry);

		if (decision === "deny") {
			return {
				content: [{ type: "text", text: `Tool "${toolName}" is denied by policy.` }],
				details: { denied: true },
			} as AgentToolResult<unknown>;
		}

		if (decision === "require_approval") {
			if (!this.onApprovalRequired) {
				return {
					content: [{
						type: "text",
						text: `Tool "${toolName}" requires approval, but no approval handler is configured.`,
					}],
					details: { denied: true, reason: "approval_handler_missing" },
				} as AgentToolResult<unknown>;
			}
			const approved = await this.onApprovalRequired(toolName, params);
			if (!approved) {
				return {
					content: [{ type: "text", text: `Tool "${toolName}" was not approved by user.` }],
					details: { denied: true, reason: "approval_denied" },
				} as AgentToolResult<unknown>;
			}
		}

		return null;
	}

	private checkRateLimit(rateLimitKey: string, maxPerMinute: number): boolean {
		const normalizedRateLimitKey = normalizeToolPolicyRateLimitKey(rateLimitKey);
		const now = Date.now();
		const entry = this.callCounts.get(normalizedRateLimitKey);

		if (!entry || now - entry.windowStart > 60_000) {
			this.callCounts.set(normalizedRateLimitKey, { count: 1, windowStart: now });
			return true;
		}

		entry.count++;
		return entry.count <= maxPerMinute;
	}
}
