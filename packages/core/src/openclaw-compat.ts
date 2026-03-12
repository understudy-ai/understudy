import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

// These aliases are intentional OpenClaw migration surfaces. They exist so
// OpenClaw skills can move into Understudy without being rewritten, even when a
// given runtime only exposes Understudy-native tool names. This is product
// compatibility, not cleanup debt from an older Understudy implementation.
const OPENCLAW_COMPATIBILITY_ALIAS_TARGETS = {
	message: "message_send",
	cron: "schedule",
	exec: "bash",
} as const;

const OPENCLAW_PROMPT_ALIAS_TARGETS = {
	message: "message_send",
} as const;

const ExecCompatibilitySchema = Type.Object({
	command: Type.String({
		description: "Shell command to execute.",
	}),
	timeout: Type.Optional(
		Type.Number({
			description: "Timeout in seconds.",
		}),
	),
	background: Type.Optional(
		Type.Boolean({
			description: "OpenClaw compatibility field. Understudy runs exec synchronously.",
		}),
	),
	yieldMs: Type.Optional(
		Type.Number({
			description: "OpenClaw compatibility field. Understudy runs exec synchronously.",
		}),
	),
	pty: Type.Optional(
		Type.Boolean({
			description: "OpenClaw compatibility field. Understudy forwards to bash without PTY mode.",
		}),
	),
});

export const OPENCLAW_COMPATIBILITY_TOOL_NAMES = new Set(
	Object.keys(OPENCLAW_COMPATIBILITY_ALIAS_TARGETS),
);

function normalizeToolName(name: string | undefined): string {
	return name?.trim().toLowerCase() ?? "";
}

function prependCompatibilityNotice(
	result: AgentToolResult<unknown>,
	message: string,
): AgentToolResult<unknown> {
	const content = Array.isArray(result.content) ? result.content.slice() : [];
	const first = content[0];
	if (first && first.type === "text") {
		content[0] = {
			...first,
			text: `${message}\n\n${first.text}`,
		};
	} else {
		content.unshift({ type: "text", text: message });
	}
	return {
		...result,
		content,
	};
}

function cloneToolWithAlias(
	target: AgentTool<any>,
	aliasName: string,
	description: string,
): AgentTool<any> {
	return {
		...target,
		name: aliasName,
		label: aliasName,
		description,
	};
}

function createExecCompatibilityAlias(target: AgentTool<any>): AgentTool<any> {
	return {
		name: "exec",
		label: "exec",
		description:
			"Fallback OpenClaw compatibility alias for Understudy bash execution. " +
			"This keeps direct skill portability in runtimes that have not installed the native exec migration surface. " +
			"Runs synchronously and ignores background/yieldMs/pty-only semantics.",
		parameters: ExecCompatibilitySchema,
		execute: async (_toolCallId, params, signal, onUpdate) => {
			const result = await target.execute(
				_toolCallId,
				{
					command: params.command,
					timeout: params.timeout,
				},
				signal,
				onUpdate,
			);
			const ignored: string[] = [];
			if (params.background === true) ignored.push("background");
			if (typeof params.yieldMs === "number") ignored.push("yieldMs");
			if (params.pty === true) ignored.push("pty");
			if (ignored.length === 0) {
				return result;
			}
			return prependCompatibilityNotice(
				result,
				`OpenClaw exec compatibility note: Understudy ignored ${ignored.join(", ")} and ran the command synchronously via \`bash\`.`,
			);
		},
	};
}

export function isOpenClawCompatibilityToolName(name: string | undefined): boolean {
	return OPENCLAW_COMPATIBILITY_TOOL_NAMES.has(normalizeToolName(name));
}

export function resolveOpenClawCompatibilityTarget(
	name: string | undefined,
): string | undefined {
	const normalized = normalizeToolName(name);
	return OPENCLAW_COMPATIBILITY_ALIAS_TARGETS[
		normalized as keyof typeof OPENCLAW_COMPATIBILITY_ALIAS_TARGETS
	];
}

export function expandOpenClawCompatibleToolNames(toolNames: string[]): string[] {
	const expanded = new Set<string>();
	for (const rawName of toolNames) {
		const name = rawName.trim();
		if (!name) continue;
		expanded.add(name);
		const aliasTarget = resolveOpenClawCompatibilityTarget(name);
		if (aliasTarget) {
			expanded.add(aliasTarget);
		}
	}
	return Array.from(expanded);
}

export function filterOpenClawCompatibilityToolNames(toolNames: string[]): string[] {
	const present = new Set(toolNames.map((name) => normalizeToolName(name)));
	return toolNames.filter((name) => {
		const normalized = normalizeToolName(name);
		const target = OPENCLAW_PROMPT_ALIAS_TARGETS[
			normalized as keyof typeof OPENCLAW_PROMPT_ALIAS_TARGETS
		];
		if (!target) {
			return true;
		}
		return !present.has(normalizeToolName(target));
	});
}

export function shouldHideOpenClawCompatibilityToolName(
	name: string,
	presentToolNames: string[],
): boolean {
	const normalized = normalizeToolName(name);
	const target = OPENCLAW_PROMPT_ALIAS_TARGETS[
		normalized as keyof typeof OPENCLAW_PROMPT_ALIAS_TARGETS
	];
	if (!target) return false;
	const present = new Set(presentToolNames.map((value) => normalizeToolName(value)));
	return present.has(normalizeToolName(target));
}

export function createOpenClawCompatibilityToolAliases(
	tools: Array<AgentTool<any>>,
): Array<AgentTool<any>> {
	const byName = new Map(
		tools.map((tool) => [normalizeToolName(tool.name), tool] as const),
	);
	const aliases: Array<AgentTool<any>> = [];

	const messageTarget = byName.get("message_send");
	if (messageTarget && !byName.has("message")) {
		aliases.push(
			cloneToolWithAlias(
				messageTarget,
				"message",
				"OpenClaw compatibility alias for Understudy message_send.",
			),
		);
	}

	const cronTarget = byName.get("schedule");
	if (cronTarget && !byName.has("cron")) {
		aliases.push(
			cloneToolWithAlias(
				cronTarget,
				"cron",
				"OpenClaw compatibility alias for Understudy schedule.",
			),
		);
	}

	const execTarget = byName.get("bash");
	if (execTarget && !byName.has("exec")) {
		aliases.push(createExecCompatibilityAlias(execTarget));
	}

	return aliases;
}
