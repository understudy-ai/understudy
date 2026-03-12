import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
	RuntimeAdapterLifecycle,
	RuntimeEngineSession,
	RuntimePromptOptions,
	RuntimeSession,
	RuntimeSessionEvent,
} from "../types.js";

export function createRuntimeSessionHandle(
	lifecycle: RuntimeAdapterLifecycle,
	session: RuntimeEngineSession,
): RuntimeSession {
	return {
		session,
		prompt: async (text: string, options?: RuntimePromptOptions) => {
			await lifecycle.prompt(session, text, options);
		},
		setSystemPrompt: (prompt: string) => {
			lifecycle.setSystemPrompt(session, prompt);
		},
		getMessages: () => lifecycle.getMessages(session) as AgentMessage[],
		onEvent: (listener: (event: RuntimeSessionEvent) => void) => {
			return lifecycle.onEvent(session, listener);
		},
		close: async () => {
			await lifecycle.closeSession(session);
		},
	};
}
