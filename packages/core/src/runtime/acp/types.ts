import type { AgentMessage } from "@mariozechner/pi-agent-core";

export type AcpRuntimePromptMode = "prompt" | "steer";

export type AcpRuntimeSessionMode = "persistent" | "oneshot";

export type AcpRuntimeHandle = {
	sessionKey: string;
	backend: string;
	runtimeSessionName: string;
	cwd?: string;
};

export type AcpRuntimeEnsureInput = {
	sessionKey: string;
	mode: AcpRuntimeSessionMode;
	cwd?: string;
};

export type AcpRuntimeTurnInput = {
	handle: AcpRuntimeHandle;
	text: string;
	mode: AcpRuntimePromptMode;
	requestId: string;
	signal?: AbortSignal;
	systemPrompt?: string;
	messages?: AgentMessage[];
};

export type AcpRuntimeEvent =
	| {
			type: "text_delta";
			text: string;
			stream?: "output" | "thought";
	  }
	| {
			type: "status";
			text: string;
	  }
	| {
			type: "tool_call";
			text: string;
			toolCallId?: string;
			status?: string;
			title?: string;
	  }
	| {
			type: "done";
			stopReason?: string;
			text?: string;
			meta?: Record<string, unknown>;
	  }
	| {
			type: "error";
			message: string;
			code?: string;
			retryable?: boolean;
	  };

export interface AcpRuntime {
	ensureSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle>;
	runTurn(input: AcpRuntimeTurnInput): AsyncIterable<AcpRuntimeEvent>;
	cancel(input: { handle: AcpRuntimeHandle; reason?: string }): Promise<void>;
	close(input: { handle: AcpRuntimeHandle; reason: string }): Promise<void>;
}
