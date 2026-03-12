import { asRecord, asString } from "@understudy/core";
import { createRpcClient, type GatewayRpcClient } from "../rpc-client.js";
import { resolveGatewayBrowserToken } from "./gateway-browser-auth.js";

const TEACH_COMMAND_RE = /^\/teach(?:\s+(start|stop|confirm|validate|publish))?(?:\s+[\s\S]*)?$/i;
const CHAT_GATEWAY_CHANNEL_ID = "terminal";
const CHAT_GATEWAY_SENDER_ID = "understudy-chat";
const TEACH_GATEWAY_TIMEOUT_MS = 600_000;

interface InteractiveEditorLike {
	onSubmit?: (text: string) => Promise<void> | void;
	setText?: (text: string) => void;
}

interface InteractiveModeLike {
	init?: () => Promise<void>;
	defaultEditor?: InteractiveEditorLike;
	showStatus?: (text: string) => void;
	showError?: (text: string) => void;
	addMessageToChat?: (message: Record<string, unknown>, options?: { populateHistory?: boolean }) => void;
	ui?: {
		requestRender?: () => void;
	};
}

interface SessionSummary {
	id: string;
	teachClarification?: {
		draftId?: string;
		status?: "clarifying" | "ready";
		nextQuestion?: string;
		summary?: string;
	};
}

interface SessionSendResult {
	response?: string;
	sessionId?: string;
	meta?: Record<string, unknown>;
}

interface TeachRoutingState {
	clarificationActive: boolean;
	draftId?: string;
}

interface TeachProgressHandle {
	finish(kind: "ok" | "error"): void;
}

function isTeachCommand(text: string): boolean {
	return TEACH_COMMAND_RE.test(text.trim());
}

function parseTeachCommandAction(text: string): string | undefined {
	return TEACH_COMMAND_RE.exec(text.trim())?.[1]?.toLowerCase();
}

function shouldTeachConfirmValidate(text: string): boolean {
	const trimmed = text.trim().toLowerCase();
	if (!trimmed.startsWith("/teach confirm")) {
		return false;
	}
	const trailing = trimmed.replace(/^\/teach\s+confirm\b/, "").trim();
	if (!trailing) {
		return false;
	}
	return trailing.split(/\s+/).some((token) => token === "validate" || token === "--validate");
}

function createZeroUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
	};
}

function renderTeachTranscriptMessage(
	interactive: InteractiveModeLike,
	role: "user" | "assistant",
	text: string,
	options?: { populateHistory?: boolean },
): boolean {
	const trimmed = text.trim();
	if (!trimmed || typeof interactive.addMessageToChat !== "function") {
		return false;
	}
	if (role === "user") {
		interactive.addMessageToChat({
			role: "user",
			content: trimmed,
			timestamp: Date.now(),
		}, {
			populateHistory: options?.populateHistory ?? true,
		});
	} else {
		interactive.addMessageToChat({
			role: "assistant",
			content: [{ type: "text", text: trimmed }],
			api: "openai-codex-responses",
			provider: "understudy-gateway",
			model: "teach-clarification",
			usage: createZeroUsage(),
			stopReason: "stop",
			timestamp: Date.now(),
		}, options?.populateHistory === false ? { populateHistory: false } : undefined);
	}
	interactive.ui?.requestRender?.();
	return true;
}

function beginTeachProgressFeedback(params: {
	interactive: InteractiveModeLike;
	text: string;
	state: TeachRoutingState;
}): TeachProgressHandle {
	const trimmed = params.text.trim();
	const action = parseTeachCommandAction(trimmed);
	let receipt: string | undefined;
	let completionStatus: string | undefined;
	let errorStatus: string | undefined;
	let initialProgressMessage: string | undefined;
	let delayedStatuses: Array<{ delayMs: number; text: string }> = [];

	if (action === "stop") {
		receipt = "Teach stop received. Stopping the recording and preparing the demo analysis...";
		initialProgressMessage = "Teach: stopping the recording and preparing the analysis...";
		completionStatus = "Teach analysis complete.";
		errorStatus = "Teach analysis failed.";
		delayedStatuses = [
			{ delayMs: 1_500, text: "Teach: extracting keyframes and event evidence..." },
			{ delayMs: 6_000, text: "Teach: running video analysis and drafting the first task card..." },
			{ delayMs: 15_000, text: "Teach: still working on the demo analysis. Longer recordings can take a while." },
		];
	} else if (action === "confirm") {
		if (shouldTeachConfirmValidate(trimmed)) {
			initialProgressMessage = "Teach: confirming the task card and running replay validation...";
			completionStatus = "Teach replay validation complete.";
			errorStatus = "Teach replay validation failed.";
			delayedStatuses = [
				{ delayMs: 4_000, text: "Teach: still validating the task card against the replay..." },
			];
		} else {
			initialProgressMessage = "Teach: confirming the task card without replay validation...";
			completionStatus = "Teach task card confirmed.";
			errorStatus = "Teach task card confirmation failed.";
			delayedStatuses = [
				{ delayMs: 4_000, text: "Teach: still finalizing the task card confirmation..." },
			];
		}
	} else if (action === "validate") {
		initialProgressMessage = "Teach: rerunning replay validation for the saved draft...";
		completionStatus = "Teach draft validation complete.";
		errorStatus = "Teach draft validation failed.";
		delayedStatuses = [
			{ delayMs: 4_000, text: "Teach: still replaying the saved draft for validation..." },
		];
	} else if (action === "publish") {
		receipt = "Teach publish received. Publishing the skill and refreshing matching workspace sessions...";
		initialProgressMessage = "Teach: publishing the skill and refreshing live workspace sessions...";
		completionStatus = "Teach skill published.";
		errorStatus = "Teach publish failed.";
		delayedStatuses = [
			{ delayMs: 4_000, text: "Teach: still publishing the skill and refreshing session prompts..." },
		];
	} else if (!trimmed.startsWith("/") && params.state.clarificationActive) {
		initialProgressMessage = "Teach: refining the task card from your latest reply...";
		completionStatus = "Teach task card updated.";
		errorStatus = "Teach task card update failed.";
		delayedStatuses = [
			{ delayMs: 4_000, text: "Teach: still processing your clarification and updating the task card..." },
		];
	}

	if (receipt) {
		renderTeachTranscriptMessage(params.interactive, "assistant", receipt, { populateHistory: false });
	}
	if (action === "stop") {
		renderTeachTranscriptMessage(
			params.interactive,
			"assistant",
			"Note: Screen keyframes captured during recording will be sent to your configured LLM provider for analysis.",
			{ populateHistory: false },
		);
	}
	if (initialProgressMessage) {
		renderTeachTranscriptMessage(params.interactive, "assistant", initialProgressMessage, {
			populateHistory: false,
		});
	}

	let finished = false;
	const timers = delayedStatuses.map((stage) => setTimeout(() => {
		if (finished) {
			return;
		}
		renderTeachTranscriptMessage(params.interactive, "assistant", stage.text, {
			populateHistory: false,
		});
	}, stage.delayMs));

	return {
		finish(kind: "ok" | "error") {
			if (finished) {
				return;
			}
			finished = true;
			for (const timer of timers) {
				clearTimeout(timer);
			}
			if (kind === "ok" && completionStatus) {
				params.interactive.showStatus?.(completionStatus);
			} else if (kind === "error" && errorStatus) {
				params.interactive.showStatus?.(errorStatus);
			}
		},
	};
}

function resolveTeachRoutingState(
	previous: TeachRoutingState,
	result: SessionSendResult,
): TeachRoutingState {
	const meta = asRecord(result.meta);
	if (!meta) {
		return previous;
	}
	const clarification = asRecord(meta.teachClarification);
	if (clarification) {
		return {
			clarificationActive: true,
			draftId: asString(clarification.draftId) ?? previous.draftId,
		};
	}
	switch (asString(meta.directCommand)) {
		case "teach_start":
		case "teach_stop":
		case "teach_clarify":
		case "teach_confirm":
		case "teach_validate":
		case "teach_publish":
		case "teach_help":
			return {
				clarificationActive: false,
			};
		default:
			return previous;
	}
}

function shouldRouteThroughTeach(text: string, state: TeachRoutingState): boolean {
	const trimmed = text.trim();
	if (!trimmed) {
		return false;
	}
	if (isTeachCommand(trimmed)) {
		return true;
	}
	return state.clarificationActive && !trimmed.startsWith("/");
}

async function ensureGatewayTeachSession(params: {
	client: GatewayRpcClient;
	cwd: string;
	sessionId?: string;
}): Promise<string> {
	if (params.sessionId) {
		return params.sessionId;
	}
	const session = await params.client.call<SessionSummary>("session.create", {
		channelId: CHAT_GATEWAY_CHANNEL_ID,
		senderId: CHAT_GATEWAY_SENDER_ID,
		cwd: params.cwd,
		forceNew: false,
	}, {
		timeout: TEACH_GATEWAY_TIMEOUT_MS,
	});
	return session.id;
}

function describeGatewayTeachError(error: unknown, gatewayUrl: string): string {
	const message = error instanceof Error ? error.message : String(error);
	return `Teach commands require a running gateway at ${gatewayUrl}. ${message}`;
}

export async function installInteractiveTeachSupport(params: {
	interactive: InteractiveModeLike;
	cwd: string;
	configPath?: string;
}): Promise<void> {
	if (!params.interactive.defaultEditor?.onSubmit && typeof params.interactive.init === "function") {
		await params.interactive.init();
	}

	const editor = params.interactive.defaultEditor;
	if (!editor?.onSubmit) {
		return;
	}

	const token = await resolveGatewayBrowserToken(params.configPath);
	const client = createRpcClient({
		token,
		timeout: TEACH_GATEWAY_TIMEOUT_MS,
	});
	let gatewaySessionId: string | undefined;
	let teachRoutingState: TeachRoutingState = { clarificationActive: false };
	let teachSubmissionInFlight = false;
	const originalOnSubmit = editor.onSubmit.bind(editor);

	editor.onSubmit = async (text: string) => {
		if (teachSubmissionInFlight) {
			params.interactive.showError?.(
				"Teach clarification is still processing. Wait for the current reply before sending another message.",
			);
			return;
		}
		if (!shouldRouteThroughTeach(text, teachRoutingState)) {
			await originalOnSubmit(text);
			return;
		}

		const trimmed = text.trim();
		editor.setText?.("");
		teachSubmissionInFlight = true;
		let progress: TeachProgressHandle | undefined;
		try {
			renderTeachTranscriptMessage(params.interactive, "user", trimmed);
			progress = beginTeachProgressFeedback({
				interactive: params.interactive,
				text: trimmed,
				state: teachRoutingState,
			});
			gatewaySessionId = await ensureGatewayTeachSession({
				client,
				cwd: params.cwd,
				sessionId: gatewaySessionId,
			});
			const result = await client.call<SessionSendResult>("session.send", {
				sessionId: gatewaySessionId,
				message: trimmed,
				cwd: params.cwd,
				waitForCompletion: true,
			}, {
				timeout: TEACH_GATEWAY_TIMEOUT_MS,
			});
			if (typeof result.sessionId === "string" && result.sessionId.trim()) {
				gatewaySessionId = result.sessionId.trim();
			}
			teachRoutingState = resolveTeachRoutingState(teachRoutingState, result);
			const responseText = typeof result.response === "string" && result.response.trim()
				? result.response.trim()
				: "Teach command completed.";
			if (!renderTeachTranscriptMessage(params.interactive, "assistant", responseText)) {
				params.interactive.showStatus?.(responseText);
			}
			progress?.finish("ok");
		} catch (error) {
			progress?.finish("error");
			params.interactive.showError?.(describeGatewayTeachError(error, client.url));
		} finally {
			teachSubmissionInFlight = false;
		}
	};
}
