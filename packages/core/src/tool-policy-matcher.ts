import type { ToolEntry, ToolPolicy } from "@understudy/types";

export type ToolPolicyMatchEntry = Partial<Pick<ToolEntry, "riskLevel" | "category">>;

type ToolPolicyPatternKind = "any" | "tool" | "category" | "risk";

interface CompiledToolPolicyPattern {
	kind: ToolPolicyPatternKind;
	matches: (value: string | undefined) => boolean;
}

export interface CompiledToolPolicy {
	source: ToolPolicy;
	patterns: CompiledToolPolicyPattern[];
}

export interface ResolvedCompiledToolPolicyMatch {
	policy: CompiledToolPolicy;
	rateLimitKey: string;
}

function normalizeMatchValue(value: string | undefined): string {
	return value?.trim().toLowerCase() ?? "";
}

function escapeRegExp(value: string): string {
	return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

function compilePatternMatcher(pattern: string): (value: string | undefined) => boolean {
	const normalized = normalizeMatchValue(pattern);
	if (!normalized || normalized === "*") {
		return (value) => normalizeMatchValue(value).length > 0 || normalized === "*";
	}
	if (!normalized.includes("*") && !normalized.includes("?")) {
		return (value) => normalizeMatchValue(value) === normalized;
	}
	const regex = new RegExp(`^${escapeRegExp(normalized).replace(/\\\*/g, ".*").replace(/\\\?/g, ".")}$`);
	return (value) => regex.test(normalizeMatchValue(value));
}

function compilePolicyPattern(pattern: string): CompiledToolPolicyPattern | null {
	const normalized = normalizeMatchValue(pattern);
	if (!normalized) {
		return null;
	}
	if (normalized === "*") {
		return {
			kind: "any",
			matches: () => true,
		};
	}
	if (normalized.startsWith("category:")) {
		return {
			kind: "category",
			matches: compilePatternMatcher(normalized.slice("category:".length)),
		};
	}
	if (normalized.startsWith("risk:")) {
		return {
			kind: "risk",
			matches: compilePatternMatcher(normalized.slice("risk:".length)),
		};
	}
	return {
		kind: "tool",
		matches: compilePatternMatcher(
			normalized.startsWith("tool:") ? normalized.slice("tool:".length) : normalized,
		),
	};
}

export function compileToolPolicies(policies: ToolPolicy[]): CompiledToolPolicy[] {
	return policies.map((policy) => ({
		source: policy,
		patterns: policy.match
			.map((pattern) => compilePolicyPattern(pattern))
			.filter((pattern): pattern is CompiledToolPolicyPattern => pattern !== null),
	}));
}

function resolveRateLimitKey(
	pattern: CompiledToolPolicyPattern,
	toolName: string,
	entry?: ToolPolicyMatchEntry,
): string {
	switch (pattern.kind) {
		case "any":
			return "*";
		case "tool":
			return `tool:${normalizeMatchValue(toolName)}`;
		case "category":
			return `category:${normalizeMatchValue(entry?.category)}`;
		case "risk":
			return `risk:${normalizeMatchValue(entry?.riskLevel)}`;
	}
}

export function resolveCompiledPolicyMatch(
	policy: CompiledToolPolicy,
	toolName: string,
	entry?: ToolPolicyMatchEntry,
): ResolvedCompiledToolPolicyMatch | null {
	for (const pattern of policy.patterns) {
		switch (pattern.kind) {
			case "any":
			case "tool":
				if (pattern.matches(toolName)) {
					return {
						policy,
						rateLimitKey: resolveRateLimitKey(pattern, toolName, entry),
					};
				}
				break;
			case "category":
				if (entry?.category !== undefined && pattern.matches(entry.category)) {
					return {
						policy,
						rateLimitKey: resolveRateLimitKey(pattern, toolName, entry),
					};
				}
				break;
			case "risk":
				if (entry?.riskLevel !== undefined && pattern.matches(entry.riskLevel)) {
					return {
						policy,
						rateLimitKey: resolveRateLimitKey(pattern, toolName, entry),
					};
				}
				break;
		}
	}
	return null;
}

export function normalizeToolPolicyRateLimitKey(rateLimitKey: string): string {
	return normalizeMatchValue(rateLimitKey);
}
