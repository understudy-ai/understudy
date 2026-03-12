import { describe, it, expect } from "vitest";
import { buildUnderstudySystemPrompt, buildRuntimeLine } from "../system-prompt.js";
import { buildSessionResetPrompt, BARE_SESSION_RESET_PROMPT } from "../session-reset-prompt.js";

describe("buildUnderstudySystemPrompt", () => {
	it("builds prompt with default identity", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: ["read", "bash", "edit"],
		});

		expect(prompt).toContain("You are Understudy, the assistant running inside Understudy.");
		expect(prompt).toContain("- read: Read file contents");
		expect(prompt).toContain("- bash: Run shell commands");
		expect(prompt).toContain("## Tool Call Style");
		expect(prompt).toContain("## Safety");
		expect(prompt).toContain("## Identity");
		expect(prompt).toContain("Do not claim to be Claude Code");
		expect(prompt).toContain("Do not describe yourself generically as a coding assistant");
		expect(prompt).toContain("exit code 0 confirms success");
	});

	it("uses custom identity", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			identity: "You are TestBot.",
		});

		expect(prompt).toContain("You are TestBot.");
	});

	it("returns minimal prompt in none mode", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: ["read"],
			promptMode: "none",
		});

		expect(prompt).toBe("You are Understudy, the assistant running inside Understudy.");
	});

	it("includes workspace section when cwd provided", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			cwd: "/home/user/project",
		});

		expect(prompt).toContain("/home/user/project");
		expect(prompt).toContain("## Workspace");
	});

	it("includes workspace notes", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			cwd: "/home/user/project",
			workspaceNotes: ["Note: This is a monorepo.", "Use pnpm for package management."],
		});

		expect(prompt).toContain("Note: This is a monorepo.");
		expect(prompt).toContain("Use pnpm for package management.");
	});

	it("includes extra sections", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			extraSections: [
				{ title: "Custom Rules", content: "Always be helpful." },
			],
		});

		expect(prompt).toContain("## Custom Rules");
		expect(prompt).toContain("Always be helpful.");
	});

	it("includes custom safety instructions with attribution", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			safetyInstructions: "Never access /etc/passwd",
		});

		expect(prompt).toContain("Never access /etc/passwd");
		expect(prompt).toContain("self-preservation");
		expect(prompt).toContain("Inspired by Anthropic's constitution");
	});

	it("includes CLI quick reference in full mode", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			promptMode: "full",
		});

		expect(prompt).toContain("## Understudy CLI Quick Reference");
		expect(prompt).toContain("understudy chat");
	});

	it("omits CLI quick reference in minimal mode", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			promptMode: "minimal",
		});

		expect(prompt).not.toContain("## Understudy CLI Quick Reference");
		expect(prompt).toContain("## Identity");
		expect(prompt).toContain("You are Understudy, the assistant running inside Understudy.");
		expect(prompt).toContain("Do not claim to be Claude Code");
	});

	it("includes capability guidance based on available tools", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [
				"web_search",
				"web_fetch",
				"vision_read",
				"browser",
				"gui_read",
				"gui_click",
				"gui_double_click",
				"gui_drag",
				"gui_scroll",
				"gui_keypress",
				"gui_hotkey",
				"gui_screenshot",
				"gui_wait",
				"process",
				"memory_search",
				"memory_get",
				"memory_manage",
				"schedule",
				"message_send",
			],
		});

		expect(prompt).toContain("## Web and External Content");
		expect(prompt).toContain("## Tool Routing");
		expect(prompt).toContain("## Image Inspection");
		expect(prompt).toContain("Use `vision_read` for screenshots or photos");
		expect(prompt).toContain("Prefer the lightest reliable route");
		expect(prompt).toContain("Do not jump to GUI when a simpler route");
		expect(prompt).toContain("Treat `gui_*` as the highest-overhead route");
		expect(prompt).toContain("Use GUI as a fallback");
		expect(prompt).not.toContain("app open");
		expect(prompt).toContain("Prefer lower-overhead routes such as direct tools, `bash`, `web_fetch`, or `browser` before `gui_*`");
		expect(prompt).toContain("Do not use GUI merely because it is general-purpose");
		expect(prompt).toContain("choose `gui_*` immediately instead of forcing an artificial waterfall");
		expect(prompt).toContain("Pay attention to repeated tool failures in the current turn");
		expect(prompt).toContain("surface repeated route failures in session context");
		expect(prompt).toContain("## Browser Automation");
		expect(prompt).toContain("## GUI Automation");
		expect(prompt).toContain("## Process Management");
		expect(prompt).toContain("## Scheduling");
		expect(prompt).toContain("## Memory Recall");
		expect(prompt).toContain("## Messaging");
		expect(prompt).toContain("generic visual computer-use route");
		expect(prompt).toContain("Typical GUI patterns");
		expect(prompt).toContain("`gui_read` -> `gui_scroll` -> `gui_read`");
		expect(prompt).toContain("re-describe the visible target on the current surface");
		expect(prompt).toContain("re-ground from the latest screenshot without relying on stale grounding history");
		expect(prompt).toContain("`groundingMode: \"single\"`");
		expect(prompt).toContain("the retry must use `groundingMode: \"complex\"`");
		expect(prompt).toContain("Use `gui_keypress` for single keys without modifiers");
		expect(prompt).toContain("Use `gui_hotkey` only for modifier combos like Command+O, Command+S, or Shift+Command+P");
		expect(prompt).toContain("`captureMode: \"window\"`");
		expect(prompt).toContain("`captureMode: \"display\"`");
		expect(prompt).toContain("Prefer setting `captureMode` explicitly");
		expect(prompt).toContain("`gui_screenshot` -> `vision_read`");
		expect(prompt).toContain("Prefer `browser` over `gui_*` for normal web pages");
		expect(prompt).toContain("GUI tools use screenshot capture plus visual grounding.");
		expect(prompt).toContain("describe the actionable or editable surface itself rather than a broad surrounding region");
		expect(prompt).toContain("Name the actionable control itself in `target`");
		expect(prompt).toContain("not surrounding whitespace, wallpaper, or generic container chrome");
		expect(prompt).toContain("name the editable field or caret-bearing interior itself");
		expect(prompt).toContain("For text fields, reference placeholder or current content");
		expect(prompt).toContain("When the target is visually subtle, include the visible label, symbol, indicator, local grouping, or nearby context");
		expect(prompt).toContain("When several similar controls are visible, include nearby text, order, or coarse location");
		expect(prompt).toContain("For list, menu, and navigation items, include the surrounding section or nearby neighbors");
		expect(prompt).toContain("revise the next target and scope");
	});

	it("omits capability sections when tools unavailable", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: ["read", "bash"],
		});

		expect(prompt).not.toContain("## Memory Recall");
		expect(prompt).not.toContain("## Scheduling");
	});

	it("describes the scheduling surface when schedule is available", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: ["schedule"],
		});

		expect(prompt).toContain("## Scheduling");
		expect(prompt).toContain("Use `schedule` to create recurring reminders or automations");
	});

	it("includes the vision_read tool summary", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: ["vision_read"],
		});

		expect(prompt).toContain("- vision_read: Inspect screenshots or photos, attach the image, and extract OCR text when available");
	});

	it("includes runtime info", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			runtimeInfo: {
				host: "testhost",
				os: "darwin 24.0.0",
				arch: "arm64",
				node: "v22.0.0",
				model: "anthropic/claude-sonnet-4",
			},
			defaultThinkLevel: "medium",
		});

		expect(prompt).toContain("## Runtime");
		expect(prompt).toContain("host=testhost");
		expect(prompt).toContain("os=darwin 24.0.0 (arm64)");
		expect(prompt).toContain("model=anthropic/claude-sonnet-4");
		expect(prompt).toContain("thinking=medium");
	});

	it("includes timezone and current local time when provided", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			userTimezone: "Asia/Shanghai",
			userTime: "Monday, March 4, 2026, 19:30:00",
		});

		expect(prompt).toContain("## Current Date & Time");
		expect(prompt).toContain("Time zone: Asia/Shanghai");
		expect(prompt).toContain("Current local time: Monday, March 4, 2026, 19:30:00");
		expect(prompt).not.toContain("prefer `runtime_status` over guessing from prompt context");
		expect(prompt).not.toContain("prefer `session_status` over guessing from prompt context");
	});

	it("prefers runtime_status for time when the tool is available", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: ["runtime_status"],
			userTimezone: "Asia/Shanghai",
		});

		expect(prompt).toContain("prefer `runtime_status` over guessing from prompt context");
		expect(prompt).not.toContain("prefer `session_status` over guessing from prompt context");
	});

	it("falls back to session_status for time when runtime_status is unavailable", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: ["session_status"],
			userTimezone: "Asia/Shanghai",
		});

		expect(prompt).toContain("prefer `session_status` over guessing from prompt context");
	});

	it("includes authorized senders", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			ownerIds: ["user123", "user456"],
		});

		expect(prompt).toContain("## Authorized Senders");
		expect(prompt).toContain("user123, user456");
	});

	it("hashes owner IDs when ownerDisplay is hash", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			ownerIds: ["user123"],
			ownerDisplay: "hash",
		});

		expect(prompt).toContain("## Authorized Senders");
		expect(prompt).not.toContain("user123");
		// Should contain a 12-char hex hash
		expect(prompt).toMatch(/Authorized senders: [a-f0-9]{12}/);
	});

	it("includes project context files", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			contextFiles: [
				{ path: "SOUL.md", content: "You are a friendly assistant named Buddy." },
				{ path: "project-notes.md", content: "This is a React project." },
			],
		});

		expect(prompt).toContain("# Project Context");
		expect(prompt).toContain("## SOUL.md");
		expect(prompt).toContain("friendly assistant named Buddy");
		expect(prompt).toContain("embody its persona and tone");
		expect(prompt).toContain("## project-notes.md");
		// Workspace Files injected label
		expect(prompt).toContain("## Workspace Files (injected)");
		expect(prompt).toContain("loaded by Understudy");
	});

	it("includes bootstrap truncation warnings", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			bootstrapTruncationWarningLines: [
				"AGENTS.md was truncated to 5000 chars",
				"SOUL.md was truncated to 3000 chars",
			],
		});

		expect(prompt).toContain("# Project Context");
		expect(prompt).toContain("Bootstrap truncation warning");
		expect(prompt).toContain("AGENTS.md was truncated to 5000 chars");
	});

	it("includes silent replies with examples in full mode", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			promptMode: "full",
		});

		expect(prompt).toContain("## Silent Replies");
		expect(prompt).toContain("[[SILENT]]");
		expect(prompt).toContain("Wrong:");
		expect(prompt).toContain("Right: [[SILENT]]");
	});

	it("includes heartbeats in full mode", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			promptMode: "full",
		});

		expect(prompt).toContain("## Heartbeats");
		expect(prompt).toContain("HEARTBEAT_OK");
	});

	it("omits silent replies and heartbeats in minimal mode", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			promptMode: "minimal",
		});

		expect(prompt).not.toContain("## Silent Replies");
		expect(prompt).not.toContain("## Heartbeats");
	});

	it("includes memory section with citations mode", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: ["memory_search", "memory_get"],
			memoryCitationsMode: "off",
		});

		expect(prompt).toContain("## Memory Recall");
		expect(prompt).toContain("Citations are disabled");
	});

	it("includes skills section with mandatory guidance", () => {
		const mockSkills = [
			{
				name: "commit",
				description: "Create a git commit",
				filePath: "/skills/commit/SKILL.md",
				baseDir: "/skills/commit",
				source: "project",
				disableModelInvocation: false,
			},
		] as any;

		const prompt = buildUnderstudySystemPrompt({
			toolNames: ["read"],
			skills: mockSkills,
		});

		// Skills section should exist with mandatory scanning guidance
		expect(prompt).toContain("## Skills (mandatory)");
		expect(prompt).toContain("scan <available_skills>");
		expect(prompt).toContain("assume rate limits");
		expect(prompt).toContain("respect 429/Retry-After");
	});

	it("uses external tool summaries when provided", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: ["custom_tool"],
			toolSummaries: {
				custom_tool: "A custom tool for special operations",
			},
		});

		expect(prompt).toContain("- custom_tool: A custom tool for special operations");
	});

	it("includes TOOLS.md guidance in tooling section", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: ["read"],
		});

		expect(prompt).toContain("TOOLS.md does not control tool availability");
	});

	it("includes anti-poll guidance when bash/process available", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: ["bash", "process"],
		});

		expect(prompt).toContain("avoid rapid poll loops");
	});

	it("omits anti-poll guidance when no bash/process", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: ["read", "edit"],
		});

		expect(prompt).not.toContain("avoid rapid poll loops");
	});

	it("includes reply tags section in full mode", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			promptMode: "full",
		});

		expect(prompt).toContain("## Reply Tags");
		expect(prompt).toContain("[[reply_to_current]]");
	});

	it("omits reply tags in minimal mode", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			promptMode: "minimal",
		});

		expect(prompt).not.toContain("## Reply Tags");
	});

	it("includes voice section when ttsHint provided", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			ttsHint: "Speak in a warm, friendly tone.",
		});

		expect(prompt).toContain("## Voice (TTS)");
		expect(prompt).toContain("Speak in a warm, friendly tone.");
	});

	it("omits voice section when no ttsHint", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
		});

		expect(prompt).not.toContain("## Voice (TTS)");
	});

	it("includes reactions section with minimal guidance", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			reactionGuidance: { level: "minimal", channel: "telegram" },
		});

		expect(prompt).toContain("## Reactions");
		expect(prompt).toContain("telegram");
		expect(prompt).toContain("MINIMAL mode");
		expect(prompt).toContain("at most 1 reaction per 5-10 exchanges");
	});

	it("includes reactions section with extensive guidance", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			reactionGuidance: { level: "extensive", channel: "discord" },
		});

		expect(prompt).toContain("## Reactions");
		expect(prompt).toContain("discord");
		expect(prompt).toContain("EXTENSIVE mode");
		expect(prompt).toContain("react whenever it feels natural");
	});

	it("includes reasoning format section when reasoningTagHint is true", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			reasoningTagHint: true,
		});

		expect(prompt).toContain("## Reasoning Format");
		expect(prompt).toContain("<think>");
		expect(prompt).toContain("<final>");
	});

	it("omits reasoning format when reasoningTagHint is false", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			reasoningTagHint: false,
		});

		expect(prompt).not.toContain("## Reasoning Format");
	});

	it("includes reasoning level line after runtime", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			reasoningLevel: "on",
		});

		expect(prompt).toContain("Reasoning: on (hidden unless on/stream).");
	});

	it("defaults reasoning level to off", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
		});

		expect(prompt).toContain("Reasoning: off (hidden unless on/stream).");
	});

	it("includes docs section when docsUrl provided", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			docsUrl: "https://docs.understudy.dev",
		});

		expect(prompt).toContain("## Documentation");
		expect(prompt).toContain("https://docs.understudy.dev");
		expect(prompt).toContain("consult local docs first");
	});

	it("omits docs section in minimal mode", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			promptMode: "minimal",
			docsUrl: "https://docs.understudy.dev",
		});

		expect(prompt).not.toContain("## Documentation");
	});

	it("includes self-update section when gateway tool is available", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: ["gateway"],
			promptMode: "full",
		});

		expect(prompt).toContain("## Understudy Self-Update");
		expect(prompt).toContain("self-update");
		expect(prompt).toContain("inspect the relevant config surface first");
		expect(prompt).toContain("narrowest relevant config or schema subtree");
	});

	it("includes session orchestration guidance when child-session tools are available", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: ["sessions_spawn", "subagents"],
			promptMode: "full",
		});

		expect(prompt).toContain("- sessions_spawn: Spawn a delegated child session or subagent run when supported");
		expect(prompt).toContain("- subagents: List, steer, or stop delegated child sessions");
		expect(prompt).toContain("## Session Orchestration");
		expect(prompt).toContain("mode=run");
		expect(prompt).toContain("independent branches");
		expect(prompt).toContain("not for the immediate next action when the main turn is blocked");
		expect(prompt).toContain("sandbox=require");
		expect(prompt).toContain("Do not poll spawned child sessions in a tight loop");
		expect(prompt).toContain("subagents(action=list|steer|kill)");
		expect(prompt).toContain("Do not loop on `subagents(action=list)`");
	});

	it("includes stronger messaging guidance when message and session tools are available", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: ["message_send", "runtime_status", "session_status", "sessions_list", "sessions_send"],
			promptMode: "full",
			userTimezone: "Asia/Hong_Kong",
		});

		expect(prompt).toContain("Prefer replying in the current session unless");
		expect(prompt).toContain("Do not use `message_send` for the normal reply");
		expect(prompt).toContain("Avoid duplicate delivery");
		expect(prompt).toContain("your normal assistant reply must be ONLY: [[SILENT]]");
		expect(prompt).toContain("If you need the current date, time, or day of week, prefer `runtime_status`");
		expect(prompt).toContain("Use `runtime_status` for current runtime details");
		expect(prompt).toContain("Use `session_status` to inspect one active gateway session");
	});

	it("includes model aliases section when aliases are provided", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			modelAliasLines: ["fast -> google/gemini-2.5-flash", "smart -> anthropic/claude-sonnet-4"],
		});

		expect(prompt).toContain("## Model Aliases");
		expect(prompt).toContain("fast -> google/gemini-2.5-flash");
		expect(prompt).toContain("smart -> anthropic/claude-sonnet-4");
	});

	it("includes sandbox section when sandbox runtime is enabled", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			sandboxInfo: {
				enabled: true,
				containerWorkspaceDir: "/workspace",
				workspaceDir: "/host/workspace",
				workspaceAccess: "rw",
				hostBrowserAllowed: false,
				elevated: { allowed: true, defaultLevel: "ask" },
			},
		});

		expect(prompt).toContain("## Sandbox");
		expect(prompt).toContain("Sandbox container workdir: /workspace");
		expect(prompt).toContain("Sandbox host mount source: /host/workspace");
		expect(prompt).toContain("use host workspace paths under /host/workspace");
		expect(prompt).toContain("use sandbox container paths under /workspace");
		expect(prompt).toContain("Prefer relative paths when possible");
		expect(prompt).toContain("Host browser control: blocked.");
		expect(prompt).toContain("default: ask");
		expect(prompt).toContain("Use elevated exec only when sandbox limits block a necessary step");
	});

	it("includes group chat context header for extraSystemPrompt", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			extraSystemPrompt: "This is a group chat with 5 participants.",
		});

		expect(prompt).toContain("## Group Chat Context");
		expect(prompt).toContain("5 participants");
	});

	it("uses subagent context header in minimal mode", () => {
		const prompt = buildUnderstudySystemPrompt({
			toolNames: [],
			promptMode: "minimal",
			extraSystemPrompt: "You are a sub-agent.",
		});

		expect(prompt).toContain("## Subagent Context");
	});
});

describe("buildRuntimeLine", () => {
	it("builds runtime line with all info", () => {
		const line = buildRuntimeLine(
			{
				agentId: "agent-1",
				host: "myhost",
				os: "darwin 24.0.0",
				arch: "arm64",
				node: "v22.0.0",
				model: "anthropic/claude-sonnet-4",
				shell: "/bin/zsh",
				channel: "telegram",
				capabilities: ["inlineButtons", "reactions"],
				repoRoot: "/home/user/project",
			},
			"high",
		);

		expect(line).toContain("agent=agent-1");
		expect(line).toContain("host=myhost");
		expect(line).toContain("repo=/home/user/project");
		expect(line).toContain("os=darwin 24.0.0 (arm64)");
		expect(line).toContain("node=v22.0.0");
		expect(line).toContain("model=anthropic/claude-sonnet-4");
		expect(line).toContain("shell=/bin/zsh");
		expect(line).toContain("channel=telegram");
		expect(line).toContain("capabilities=inlineButtons,reactions");
		expect(line).toContain("thinking=high");
	});

	it("handles missing runtime info", () => {
		const line = buildRuntimeLine(undefined, "off");
		expect(line).toBe("Runtime: thinking=off");
	});
});

describe("buildSessionResetPrompt", () => {
	it("includes base prompt text", () => {
		const prompt = buildSessionResetPrompt();

		expect(prompt).toContain("new session was started");
		expect(prompt).toContain("Session Startup sequence");
		expect(prompt).toContain("greet the user");
		expect(prompt).toContain("Understudy assistant");
		expect(prompt).toContain("Introduce yourself as Understudy first");
		expect(prompt).toContain("Do not claim to be Claude Code");
		expect(prompt).toContain("generic coding assistant");
		expect(prompt).toContain("freshly awakened assistant");
		expect(prompt).toContain("Current time:");
	});

	it("formats time with timezone and UTC anchor", () => {
		const prompt = buildSessionResetPrompt("America/New_York", 1709600000000);

		expect(prompt).toContain("Current time:");
		expect(prompt).toContain("(America/New_York) / ");
		expect(prompt).toContain("UTC");
	});

	it("falls back to UTC timezone when none is provided", () => {
		const prompt = buildSessionResetPrompt(undefined, 1709600000000);

		expect(prompt).toContain("Current time:");
		expect(prompt).toContain("(UTC) / ");
		expect(prompt).toContain("UTC");
	});

	it("exports bare prompt constant", () => {
		expect(BARE_SESSION_RESET_PROMPT).toContain("new session was started");
		expect(BARE_SESSION_RESET_PROMPT).not.toContain("Current time:");
	});
});
