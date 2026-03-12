import type { RuntimeEngineSession } from "./types.js";

type MutableRuntimeEngineSession = RuntimeEngineSession & {
	_baseSystemPrompt?: string;
	_rebuildSystemPrompt?: (toolNames: string[]) => string;
};

export function applySystemPromptOverrideToSession(
	session: RuntimeEngineSession,
	override: string | ((defaultPrompt?: string) => string),
): void {
	const prompt = typeof override === "function" ? override() : override.trim();
	session.agent.setSystemPrompt(prompt);
	const mutableSession = session as MutableRuntimeEngineSession;
	mutableSession._baseSystemPrompt = prompt;
	mutableSession._rebuildSystemPrompt = () => prompt;
}
