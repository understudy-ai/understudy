/**
 * Session reset / greeting prompt for Understudy.
 * Generates the initial prompt sent when a session starts or resets,
 * so the agent greets the user in its configured persona.
 */

import { formatUserTime } from "./system-prompt-params.js";

const BARE_SESSION_RESET_PROMPT_BASE =
	"A new session was started via /new or /reset. Execute your Session Startup sequence now - read the required files before responding to the user. Then greet the user in your configured persona, if one is provided. Introduce yourself as Understudy first. Keep your product identity as the Understudy assistant. Do not claim to be Claude Code, Pi, a generic coding assistant, or an unnamed freshly awakened assistant. Keep it to 1-3 sentences and ask what they want to do. If the runtime model differs from default_model in the system prompt, mention the default model. Do not mention internal steps, files, tools, or reasoning.";

/**
 * Build the session reset prompt, optionally appending the current date/time
 * so agents know which daily memory files to read during startup.
 */
export function buildSessionResetPrompt(timezone?: string, nowMs?: number): string {
	const now = new Date(nowMs ?? Date.now());
	const resolvedTimezone = timezone?.trim() || "UTC";
	const formatted = formatUserTime(now, resolvedTimezone);
	const utcTime = now.toISOString().replace("T", " ").slice(0, 16) + " UTC";
	return `${BARE_SESSION_RESET_PROMPT_BASE}\nCurrent time: ${formatted} (${resolvedTimezone}) / ${utcTime}`;
}

/** The bare prompt without date/time (for testing or simple use cases) */
export const BARE_SESSION_RESET_PROMPT = BARE_SESSION_RESET_PROMPT_BASE;
