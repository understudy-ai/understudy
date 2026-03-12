/**
 * System prompt builder for Understudy.
 * Builds a modular, mode-aware system prompt with sections for tooling,
 * safety, skills, memory, runtime info, project context, and more.
 */

import type { Skill } from "@mariozechner/pi-coding-agent";
import type { RuntimeInfo } from "./system-prompt-params.js";
import {
	buildAuthorizedSendersSection,
	buildCapabilitySections,
	buildCliSection,
	buildDocsSection,
	buildHeartbeatsSection,
	buildIdentitySection,
	buildMemorySection,
	buildMessagingSection,
	buildModelAliasesSection,
	buildProjectContextSection,
	buildReactionsSection,
	buildReasoningFormatSection,
	buildReplyTagsSection,
	buildSafetySection,
	buildSandboxSection,
	buildSelfUpdateSection,
	buildSilentRepliesSection,
	buildSkillsSection,
	buildTimeSection,
	buildVoiceSection,
	buildWorkspaceSection,
} from "./system-prompt-sections.js";

/**
 * Controls which hardcoded sections are included in the system prompt.
 * - "full": All sections (default, for main agent)
 * - "minimal": Reduced sections (Tooling, Workspace, Runtime) - used for subagents/gateway
 * - "none": Just basic identity line, no sections
 */
export type PromptMode = "full" | "minimal" | "none";

/** How to display owner IDs in the prompt */
export type OwnerIdDisplay = "raw" | "hash";

/** Memory citations mode */
export type MemoryCitationsMode = "on" | "off";

/** A context file injected into the prompt (e.g., SOUL.md) */
export interface ContextFile {
	path: string;
	content: string;
}

/** Sandbox runtime info */
export interface SandboxInfo {
	enabled: boolean;
	containerWorkspaceDir?: string;
	workspaceDir?: string;
	workspaceAccess?: string;
	browserNoVncUrl?: string;
	hostBrowserAllowed?: boolean;
	elevated?: {
		allowed: boolean;
		defaultLevel?: string;
	};
}

export interface SystemPromptOptions {
	/** Custom identity section */
	identity?: string;
	/** List of available tool names */
	toolNames: string[];
	/** External tool summaries (from AgentTool descriptions) */
	toolSummaries?: Record<string, string>;
	/** Loaded skills */
	skills?: Skill[];
	/** Current working directory */
	cwd?: string;
	/** Custom safety instructions */
	safetyInstructions?: string;
	/** Additional prompt sections */
	extraSections?: Array<{ title: string; content: string }>;
	/** Prompt mode: full (main agent), minimal (subagents), none (identity only) */
	promptMode?: PromptMode;
	/** Runtime info (OS, arch, model, channel, etc.) */
	runtimeInfo?: RuntimeInfo;
	/** User timezone string */
	userTimezone?: string;
	/** Formatted user time string */
	userTime?: string;
	/** Default thinking level */
	defaultThinkLevel?: string;
	/** Authorized owner IDs */
	ownerIds?: string[];
	/** How to display owner IDs */
	ownerDisplay?: OwnerIdDisplay;
	/** Secret for hashing owner IDs */
	ownerDisplaySecret?: string;
	/** Project context files (SOUL.md, AGENTS.md, etc.) */
	contextFiles?: ContextFile[];
	/** Memory citations mode */
	memoryCitationsMode?: MemoryCitationsMode;
	/** Extra system prompt (e.g., group chat context, channel override) */
	extraSystemPrompt?: string;
	/** Heartbeat prompt text */
	heartbeatPrompt?: string;
	/** TTS hint for voice output channels */
	ttsHint?: string;
	/** Reaction guidance for channel-specific emoji reactions */
	reactionGuidance?: { level: "minimal" | "extensive"; channel: string };
	/** Whether to include reasoning format tags (<think>/<final>) */
	reasoningTagHint?: boolean;
	/** Reasoning level (off | on | stream) */
	reasoningLevel?: string;
	/** Additional workspace guidance notes */
	workspaceNotes?: string[];
	/** Bootstrap truncation warning lines for Project Context */
	bootstrapTruncationWarningLines?: string[];
	/** URL or path to documentation */
	docsUrl?: string;
	/** Optional model alias lines shown in prompt (e.g., "fast -> provider/model") */
	modelAliasLines?: string[];
	/** Optional sandbox runtime info */
	sandboxInfo?: SandboxInfo;
}

// ────────────────────────────────────────────────────────────────────────────
// Core tool summaries — hardcoded, overridable by toolSummaries from AgentTool
// ────────────────────────────────────────────────────────────────────────────

const CORE_TOOL_SUMMARIES: Record<string, string> = {
	read: "Read file contents",
	write: "Create or overwrite files",
	edit: "Make precise edits to files",
	grep: "Search file contents for patterns",
	find: "Find files by glob pattern",
	ls: "List directory contents",
	bash: "Run shell commands",
	apply_patch: "Apply multi-file patches using *** Begin Patch format",
	process: "Manage background processes",
	web_search: "Search the web for current information",
	web_fetch: "Fetch and extract readable content from a URL",
	image: "Inspect image metadata and optionally return base64 image content",
	vision_read: "Inspect screenshots or photos, attach the image, and extract OCR text when available",
	pdf: "Inspect PDF metadata and extract text",
	browser: "Control a browser for navigation, AI/ARIA snapshots, ref-based interaction, waits, uploads, and screenshots",
	gui_read: "Capture the current GUI state as a visual computer-use snapshot and optionally ground a target",
	gui_click: "Click a visually grounded clickable/selectable GUI control and optionally self-verify the visible result",
	gui_right_click: "Right click a visually grounded actionable GUI control and optionally self-verify the visible result",
	gui_double_click: "Double click a visually grounded GUI control and optionally self-verify the visible result",
	gui_hover: "Hover a visually grounded GUI control without clicking and optionally self-verify the visible result",
	gui_click_and_hold: "Click and hold a visually grounded pressable GUI control before releasing, and optionally self-verify the visible result",
	gui_drag: "Drag between visually grounded GUI targets and optionally self-verify the visible result",
	gui_scroll: "Scroll a visually grounded GUI region or app and optionally self-verify the visible result",
	gui_type: "Type text into a visually grounded editable GUI field and optionally self-verify the visible result",
	gui_keypress: "Press a single key in the current or specified app on the visual GUI route and optionally self-verify the visible result",
	gui_hotkey: "Send a keyboard shortcut on the visual GUI route and optionally self-verify the visible result",
	gui_screenshot: "Capture a screenshot of the current GUI state for the visual GUI route",
	gui_wait: "Wait for a visually grounded GUI target to appear or disappear",
	memory_search: "Search previously stored memory entries",
	memory_get: "Retrieve a specific memory entry by ID",
	memory_manage: "Add or delete stored memory entries",
	agents_list: "List agent/runtime identifiers available in the current environment",
	gateway: "Inspect or update runtime configuration and gateway-managed operations when supported",
	schedule: "Primary scheduling surface for recurring jobs, manual runs, run history, and wake events",
	message_send: "Send messages and channel actions",
	runtime_status:
		"Show current runtime status such as local time, timezone, workspace, default model, and whether gateway session tools are available",
	session_status: "Show metadata/status for one active gateway session",
	sessions_list: "List active gateway sessions",
	sessions_history: "Get history for a gateway session",
	sessions_send: "Send a message into a specific gateway session",
	sessions_spawn:
		"Spawn a delegated child session or subagent run when supported; prefer this for independent parallel branches such as separate searches or checks",
	subagents: "List, steer, or stop delegated child sessions",
};

/** Preferred display order for tool listing */
const TOOL_ORDER = [
	"read", "write", "edit", "apply_patch", "grep", "find", "ls", "bash", "process",
	"web_search", "web_fetch", "image", "vision_read", "pdf", "browser",
	"gui_read", "gui_click", "gui_right_click", "gui_double_click", "gui_hover", "gui_click_and_hold", "gui_drag", "gui_scroll", "gui_type", "gui_keypress", "gui_hotkey", "gui_screenshot", "gui_wait",
	"memory_search", "memory_get", "memory_manage",
	"agents_list", "schedule", "gateway", "message_send",
	"runtime_status", "session_status", "sessions_list", "sessions_history", "sessions_send", "sessions_spawn", "subagents",
];

// ────────────────────────────────────────────────────────────────────────────
// Main builder
// ────────────────────────────────────────────────────────────────────────────

export function buildUnderstudySystemPrompt(options: SystemPromptOptions): string {
	const promptMode = options.promptMode ?? "full";
	const isMinimal = promptMode === "minimal";

	// "none" mode: just identity
	if (promptMode === "none") {
		return "You are Understudy, the assistant running inside Understudy.";
	}

	// Resolve tool names and summaries
	const { availableTools, toolLines } = resolveUnderstudyToolLines(options);
	const hasGateway = availableTools.has("gateway");
	const preferredTimeTool = availableTools.has("runtime_status")
		? "runtime_status"
		: availableTools.has("session_status")
			? "session_status"
			: undefined;

	const lines: string[] = [
		buildIdentityLine(options.identity),
		"",
		// ── Tooling ──
		"## Tooling",
		"Tool availability (filtered by policy):",
		"Tool names are case-sensitive. Call tools exactly as listed.",
		toolLines.length > 0 ? toolLines.join("\n") : "No tools currently available.",
		"TOOLS.md does not control tool availability; it is user guidance for how to use external tools.",
		...(availableTools.has("bash") || availableTools.has("process")
			? [`For long waits, avoid rapid poll loops: use bash with appropriate timeouts or process(action=poll, timeout=<ms>).`]
			: []),
		"",
		// ── Tool Call Style ──
		"## Tool Call Style",
		"Default: do not narrate routine, low-risk tool calls (just call the tool).",
		"Narrate only when it helps: multi-step work, complex/challenging problems, sensitive actions (e.g., deletions), or when the user explicitly asks.",
		"Keep narration brief and value-dense; avoid repeating obvious steps.",
			"Use plain human language for narration unless in a technical context.",
			"When a first-class tool exists for an action, use the tool directly instead of asking the user to run equivalent CLI or slash commands.",
			"",
			// ── Safety ──
			...buildSafetySection(options.safetyInstructions),
			// ── Identity ──
			...buildIdentitySection(isMinimal),
			// ── CLI Quick Reference ──
			...(!isMinimal ? buildCliSection() : []),
			// ── Self-Update ──
			...buildSelfUpdateSection(hasGateway, isMinimal),
			// ── Model Aliases ──
			...buildModelAliasesSection(isMinimal, options.modelAliasLines),
			// ── Skills ──
			...buildSkillsSection(options.skills),
		// ── Memory ──
		...buildMemorySection(isMinimal, availableTools, options.memoryCitationsMode),
		// ── Authorized Senders ──
		...buildAuthorizedSendersSection(options.ownerIds, options.ownerDisplay, options.ownerDisplaySecret, isMinimal),
		// ── Current Date & Time ──
		...buildTimeSection(options.userTimezone, options.userTime),
		...(options.userTimezone && preferredTimeTool
			? [`If you need the current date, time, or day of week, prefer \`${preferredTimeTool}\` over guessing from prompt context.`, ""]
			: []),
		// ── Workspace ──
			...buildWorkspaceSection(options.cwd, options.workspaceNotes),
			// ── Docs ──
			...buildDocsSection(isMinimal, options.docsUrl),
			// ── Sandbox ──
			...buildSandboxSection(options.sandboxInfo),
			// ── Capability guidance ──
			...buildCapabilitySections(availableTools, isMinimal),
		// ── Messaging ──
		...buildMessagingSection(isMinimal, availableTools),
		// ── Reply Tags ──
		...buildReplyTagsSection(isMinimal),
		// ── Voice (TTS) ──
		...buildVoiceSection(isMinimal, options.ttsHint),
	];

	// ── Extra system prompt (group chat context, channel override, etc.) ──
	if (options.extraSystemPrompt?.trim()) {
		const header = isMinimal ? "## Subagent Context" : "## Group Chat Context";
		lines.push(header, options.extraSystemPrompt.trim(), "");
	}

	// ── Reactions ──
	if (options.reactionGuidance && !isMinimal) {
		lines.push(...buildReactionsSection(options.reactionGuidance));
	}

	// ── Reasoning Format ──
	if (options.reasoningTagHint && !isMinimal) {
		lines.push(...buildReasoningFormatSection());
	}

	// ── Project Context (SOUL.md, AGENTS.md, etc.) ──
	if ((options.contextFiles && options.contextFiles.length > 0) ||
		(options.bootstrapTruncationWarningLines && options.bootstrapTruncationWarningLines.length > 0)) {
		lines.push(...buildProjectContextSection(
			options.contextFiles ?? [],
			options.bootstrapTruncationWarningLines,
		));
	}

	// ── Workspace Files (injected) label ──
	if (options.contextFiles && options.contextFiles.length > 0) {
		lines.push(
			"## Workspace Files (injected)",
			"These user-editable files are loaded by Understudy and included above in Project Context.",
			"",
		);
	}

	// ── Silent Replies (full mode only) ──
	if (!isMinimal) {
		lines.push(...buildSilentRepliesSection());
	}

	// ── Heartbeats (full mode only) ──
	if (!isMinimal) {
		lines.push(...buildHeartbeatsSection(options.heartbeatPrompt));
	}

	// ── Runtime ──
	lines.push(
		"## Runtime",
		buildRuntimeLine(options.runtimeInfo, options.defaultThinkLevel),
	);

	// ── Reasoning level line (after runtime) ──
	const reasoningLevel = options.reasoningLevel ?? "off";
	lines.push(
		`Reasoning: ${reasoningLevel} (hidden unless on/stream).`,
	);

	// ── Extra sections ──
	if (options.extraSections) {
		for (const section of options.extraSections) {
			lines.push(`## ${section.title}`, section.content, "");
		}
	}

	return lines.filter(Boolean).join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Section builders
// ────────────────────────────────────────────────────────────────────────────

function buildIdentityLine(identity?: string): string {
	if (identity) return identity;
	return "You are Understudy, the assistant running inside Understudy.";
}

export function resolveUnderstudyToolLines(
	options: Pick<SystemPromptOptions, "toolNames" | "toolSummaries">,
) {
	const rawToolNames = (options.toolNames ?? []).map((t) => t.trim()).filter(Boolean);

	// Dedup by lowercase, preserving caller casing
	const canonicalByNormalized = new Map<string, string>();
	for (const name of rawToolNames) {
		const normalized = name.toLowerCase();
		if (!canonicalByNormalized.has(normalized)) {
			canonicalByNormalized.set(normalized, name);
		}
	}
	const resolveToolName = (normalized: string) =>
		canonicalByNormalized.get(normalized) ?? normalized;

	const normalizedTools = rawToolNames.map((t) => t.toLowerCase());
	const availableTools = new Set(normalizedTools);

	// Merge core summaries + external summaries (external wins)
	const externalSummaries = new Map<string, string>();
	for (const [key, value] of Object.entries(options.toolSummaries ?? {})) {
		const normalized = key.trim().toLowerCase();
		if (normalized && value?.trim()) {
			externalSummaries.set(normalized, value.trim());
		}
	}

	// Build ordered tool lines
	const extraTools = Array.from(
		new Set(normalizedTools.filter((t) => !TOOL_ORDER.includes(t))),
	);
	const enabledTools = TOOL_ORDER.filter((t) => availableTools.has(t));

	const toolLines: string[] = [];
	for (const tool of enabledTools) {
		const summary = externalSummaries.get(tool) ?? CORE_TOOL_SUMMARIES[tool];
		const name = resolveToolName(tool);
		toolLines.push(summary ? `- ${name}: ${summary}` : `- ${name}`);
	}
	for (const tool of extraTools.toSorted()) {
		const summary = externalSummaries.get(tool) ?? CORE_TOOL_SUMMARIES[tool];
		const name = resolveToolName(tool);
		toolLines.push(summary ? `- ${name}: ${summary}` : `- ${name}`);
	}

	return { availableTools, toolLines };
}

// ────────────────────────────────────────────────────────────────────────────
// Runtime line
// ────────────────────────────────────────────────────────────────────────────

export function buildRuntimeLine(
	runtimeInfo?: RuntimeInfo,
	defaultThinkLevel?: string,
): string {
	if (!runtimeInfo) {
		return `Runtime: thinking=${defaultThinkLevel ?? "off"}`;
	}

	const parts = [
		runtimeInfo.agentId ? `agent=${runtimeInfo.agentId}` : "",
		runtimeInfo.host ? `host=${runtimeInfo.host}` : "",
		runtimeInfo.repoRoot ? `repo=${runtimeInfo.repoRoot}` : "",
		runtimeInfo.os
			? `os=${runtimeInfo.os}${runtimeInfo.arch ? ` (${runtimeInfo.arch})` : ""}`
			: runtimeInfo.arch
				? `arch=${runtimeInfo.arch}`
				: "",
		runtimeInfo.node ? `node=${runtimeInfo.node}` : "",
		runtimeInfo.model ? `model=${runtimeInfo.model}` : "",
		runtimeInfo.defaultModel ? `default_model=${runtimeInfo.defaultModel}` : "",
		runtimeInfo.shell ? `shell=${runtimeInfo.shell}` : "",
		runtimeInfo.channel ? `channel=${runtimeInfo.channel}` : "",
		runtimeInfo.channel
			? `capabilities=${(runtimeInfo.capabilities ?? []).length > 0 ? (runtimeInfo.capabilities ?? []).join(",") : "none"}`
			: "",
		`thinking=${defaultThinkLevel ?? "off"}`,
	];

	return `Runtime: ${parts.filter(Boolean).join(" | ")}`;
}
