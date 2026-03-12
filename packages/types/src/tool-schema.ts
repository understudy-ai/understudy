/**
 * Extended tool types for Understudy's trust-gated tool system.
 */

import type { TSchema } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

/** Risk levels for tool trust gating */
export type ToolRiskLevel = "read" | "write" | "execute" | "network" | "dangerous";

/** Tool categories for organization and policy */
export type ToolCategory =
	| "filesystem"
	| "shell"
	| "search"
	| "web"
	| "messaging"
	| "browser"
	| "gui"
	| "memory"
	| "process"
	| "schedule"
	| "system";

/** Extended tool entry with risk and category metadata */
export interface ToolEntry<TParameters extends TSchema = TSchema> {
	tool: AgentTool<TParameters>;
	riskLevel: ToolRiskLevel;
	category: ToolCategory;
}

/** Policy rule for tool trust gating */
export interface ToolPolicy {
	/** Tools this policy applies to (names or categories) */
	match: string[];
	/** Action to take */
	action: "allow" | "deny" | "require_approval";
	/** Optional rate limit (calls per minute) */
	rateLimit?: number;
}
