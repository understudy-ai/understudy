import type { UnderstudySessionToolEvent } from "@understudy/core";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { GatewayEvent } from "./protocol.js";
import { asRecord, asString } from "./value-coerce.js";

export interface AgentRunSnapshot {
	runId: string;
	sessionId: string;
	status: "in_flight" | "ok" | "error";
	startedAt: number;
	endedAt?: number;
	error?: string;
	response?: string;
	images?: ImageContent[];
	meta?: Record<string, unknown>;
}

type ActiveRunStage = "thinking" | "status" | "tool" | "reply";

interface ActiveRunStep {
	id: string;
	kind: "status" | "tool";
	label: string;
	state: "running" | "done" | "error";
	toolName?: string;
	route?: string;
	updatedAt: number;
}

interface ActiveRunState {
	runId: string;
	sessionId: string;
	channelId?: string;
	senderId?: string;
	threadId?: string;
	conversationType?: string;
	streamStarted: boolean;
	streamEnded: boolean;
	streamedText: string;
	thoughtText: string;
	steps: ActiveRunStep[];
	progress?: {
		summary: string;
		toolName?: string;
		route?: string;
		phase?: "start" | "finish" | "error";
		stage: ActiveRunStage;
		updatedAt: number;
	};
	latestToolResult?: {
		toolCallId: string;
		toolName: string;
		route?: string;
		textPreview?: string;
		images?: ImageContent[];
	};
}

interface StartRunParams extends AgentRunSnapshot {
	channelId?: string;
	senderId?: string;
	threadId?: string;
	conversationType?: string;
}

interface CompleteRunParams {
	runId: string;
	sessionId: string;
	startedAt: number;
	endedAt: number;
	response: string;
	images?: ImageContent[];
	meta?: Record<string, unknown>;
}

interface ErrorRunParams {
	runId: string;
	sessionId: string;
	startedAt: number;
	endedAt: number;
	error: string;
}

export interface GatewayRunRegistryOptions {
	runs: Map<string, AgentRunSnapshot>;
	latestRunBySessionId: Map<string, string>;
	maxRuns?: number;
	onRunChanged?: () => void;
	onEvent?: (event: GatewayEvent) => void;
}


function humanizeToolName(toolName: string): string {
	return toolName
		.replace(/^gui_/, "")
		.replace(/^browser$/, "browser action")
		.replace(/_/g, " ")
		.trim();
}

function describeGuiTarget(params: Record<string, unknown> | undefined): string | undefined {
	const target = asString(params?.target);
	if (target) {
		return target;
	}
	const fromTarget = asString(params?.fromTarget);
	const toTarget = asString(params?.toTarget);
	if (fromTarget && toTarget) {
		return `${fromTarget} -> ${toTarget}`;
	}
	return undefined;
}

function summarizeToolProgress(event: UnderstudySessionToolEvent): string {
	const params = asRecord(event.params);
	const appName = asString(params?.app);
	const target = describeGuiTarget(params);
	switch (event.toolName) {
		case "gui_read":
			return `Inspecting the GUI${appName ? ` in ${appName}` : ""}${target ? ` for "${target}"` : ""}.`;
		case "gui_click":
			return `Clicking${target ? ` "${target}"` : " a GUI target"}${appName ? ` in ${appName}` : ""}.`;
		case "gui_right_click":
			return `Right-clicking${target ? ` "${target}"` : " a GUI target"}${appName ? ` in ${appName}` : ""}.`;
		case "gui_double_click":
			return `Double-clicking${target ? ` "${target}"` : " a GUI target"}${appName ? ` in ${appName}` : ""}.`;
		case "gui_hover":
			return `Hovering${target ? ` "${target}"` : " over a GUI target"}${appName ? ` in ${appName}` : ""}.`;
		case "gui_click_and_hold":
			return `Pressing and holding${target ? ` "${target}"` : " a GUI target"}${appName ? ` in ${appName}` : ""}.`;
		case "gui_drag":
			return `Dragging${target ? ` ${target}` : " between GUI targets"}${appName ? ` in ${appName}` : ""}.`;
		case "gui_scroll":
			return `Scrolling${target ? ` "${target}"` : " the GUI"}${appName ? ` in ${appName}` : ""}.`;
		case "gui_type":
			return `Typing${target ? ` into "${target}"` : " into the GUI"}${appName ? ` in ${appName}` : ""}.`;
		case "gui_wait":
			return `Waiting for "${target ?? "the requested GUI state"}"${appName ? ` in ${appName}` : ""}.`;
		case "browser":
			return `Working in the browser${asString(params?.action) ? `: ${asString(params?.action)}` : ""}.`;
		case "bash":
			return "Running a shell command.";
		default:
			return `Running ${humanizeToolName(event.toolName)}.`;
	}
}

function summarizeRunStatus(text: string | undefined): string | undefined {
	const normalized = typeof text === "string" ? text.trim() : "";
	if (!normalized) {
		return undefined;
	}
	return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function serializeActiveRunSteps(steps: ActiveRunState["steps"]): Array<Record<string, unknown>> {
	return steps.map((step) => ({
		id: step.id,
		kind: step.kind,
		label: step.label,
		state: step.state,
		toolName: step.toolName,
		route: step.route,
		updatedAt: step.updatedAt,
	}));
}

function buildProgressSnapshot(active: ActiveRunState): Record<string, unknown> | undefined {
	if (!active.progress) {
		return undefined;
	}
	return {
		runId: active.runId,
		sessionId: active.sessionId,
		summary: active.progress.summary,
		toolName: active.progress.toolName,
		route: active.progress.route,
		phase: active.progress.phase,
		stage: active.progress.stage,
		updatedAt: active.progress.updatedAt,
		thoughtText: active.thoughtText,
		assistantText: active.streamedText,
		steps: serializeActiveRunSteps(active.steps),
		...(active.latestToolResult
			? {
				latestToolResult: {
					toolCallId: active.latestToolResult.toolCallId,
					toolName: active.latestToolResult.toolName,
					route: active.latestToolResult.route,
					textPreview: active.latestToolResult.textPreview,
					...(active.latestToolResult.images?.length ? { images: active.latestToolResult.images } : {}),
				},
			}
			: {}),
	};
}

export class GatewayRunRegistry {
	private readonly runs: Map<string, AgentRunSnapshot>;
	private readonly latestRunBySessionId: Map<string, string>;
	private readonly maxRuns: number;
	private readonly onRunChanged?: () => void;
	private readonly onEvent?: (event: GatewayEvent) => void;
	private readonly activeRunsBySessionId = new Map<string, ActiveRunState>();

	constructor(options: GatewayRunRegistryOptions) {
		this.runs = options.runs;
		this.latestRunBySessionId = options.latestRunBySessionId;
		this.maxRuns = Math.max(1, options.maxRuns ?? 1000);
		this.onRunChanged = options.onRunChanged;
		this.onEvent = options.onEvent;
	}

	get(runId: string): AgentRunSnapshot | undefined {
		return this.runs.get(runId);
	}

	getLatestRunId(sessionId: string): string | undefined {
		return this.latestRunBySessionId.get(sessionId);
	}

	getProgress(runId: string): Record<string, unknown> | undefined {
		for (const active of this.activeRunsBySessionId.values()) {
			if (active.runId !== runId || !active.progress) {
				continue;
			}
			return buildProgressSnapshot(active);
		}
		return undefined;
	}

	restore(run: AgentRunSnapshot): void {
		this.storeSnapshot(run);
	}

	startRun(params: StartRunParams): void {
		this.storeSnapshot({
			runId: params.runId,
			sessionId: params.sessionId,
			status: "in_flight",
			startedAt: params.startedAt,
		});
		const active: ActiveRunState = {
			runId: params.runId,
			sessionId: params.sessionId,
			channelId: params.channelId,
			senderId: params.senderId,
			threadId: params.threadId,
			conversationType: params.conversationType,
			streamStarted: false,
			streamEnded: false,
			streamedText: "",
			thoughtText: "",
			steps: [{
				id: "thinking",
				kind: "status",
				label: "Thinking through the task.",
				state: "running",
				updatedAt: params.startedAt,
			}],
			progress: {
				summary: "Thinking through the task.",
				stage: "thinking",
				phase: "start",
				updatedAt: params.startedAt,
			},
		};
		this.activeRunsBySessionId.set(params.sessionId, active);
		this.emitStreamStart(active);
	}

	completeRun(params: CompleteRunParams): void {
		const active = this.activeRunsBySessionId.get(params.sessionId);
		if (active?.runId === params.runId) {
			for (const step of active.steps) {
				if (step.state === "running") {
					step.state = "done";
					step.updatedAt = params.endedAt;
				}
			}
			active.progress = {
				summary: params.response.trim().length > 0 ? "Response ready." : "Completed.",
				stage: "reply",
				phase: "finish",
				updatedAt: params.endedAt,
			};
			if (params.meta) {
				if (active.thoughtText.trim().length > 0) {
					params.meta.thoughtText = active.thoughtText;
				}
				params.meta.progressSteps = serializeActiveRunSteps(active.steps);
			}
		}
		this.storeSnapshot({
			runId: params.runId,
			sessionId: params.sessionId,
			status: "ok",
			startedAt: params.startedAt,
			endedAt: params.endedAt,
			response: params.response,
			...(params.images?.length ? { images: params.images } : {}),
			meta: params.meta,
		});
		this.emitAssistantText(params.runId, params.sessionId, params.response);
		this.emitStreamEnd(params.runId, params.sessionId, {
			status: "ok",
			text: params.response,
			...(params.images?.length ? { images: params.images } : {}),
			meta: params.meta,
		});
		this.clearActiveRun(params.sessionId, params.runId);
	}

	errorRun(params: ErrorRunParams): void {
		const active = this.activeRunsBySessionId.get(params.sessionId);
		if (active?.runId === params.runId) {
			for (const step of active.steps) {
				if (step.state === "running") {
					step.state = "error";
					step.updatedAt = params.endedAt;
				}
			}
			active.progress = {
				summary: "The run failed.",
				stage: "reply",
				phase: "error",
				updatedAt: params.endedAt,
			};
		}
		this.storeSnapshot({
			runId: params.runId,
			sessionId: params.sessionId,
			status: "error",
			startedAt: params.startedAt,
			endedAt: params.endedAt,
			error: params.error,
		});
		this.emitStreamEnd(params.runId, params.sessionId, {
			status: "error",
			error: params.error,
		});
		this.clearActiveRun(params.sessionId, params.runId);
	}

	emitToolEvent(sessionId: string, event: UnderstudySessionToolEvent): void {
		const active = this.activeRunsBySessionId.get(sessionId);
		if (!active) {
			return;
		}
		const summary = summarizeToolProgress(event);
		const updatedAt = event.phase === "start" ? event.startedAt : event.endedAt;
		active.progress = {
			summary,
			toolName: event.toolName,
			route: event.route,
			phase: event.phase,
			stage: "tool",
			updatedAt,
		};
		const stepIndex = active.steps.findIndex((step) => step.id === event.toolCallId);
		const nextState = event.phase === "error" ? "error" : event.phase === "finish" ? "done" : "running";
		const nextStep: ActiveRunStep = {
			id: event.toolCallId,
			kind: "tool",
			label: summary,
			state: nextState,
			toolName: event.toolName,
			route: event.route,
			updatedAt,
		};
		if (stepIndex >= 0) {
			active.steps[stepIndex] = nextStep;
		} else {
			active.steps.push(nextStep);
		}
		if (event.phase === "start") {
			this.emitEvent({
				type: "tool_start",
				data: {
					runId: active.runId,
					sessionId,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					route: event.route,
					params: event.params,
					summary: active.progress.summary,
					startedAt: event.startedAt,
				},
			});
			return;
		}
		if (event.phase === "finish") {
			active.latestToolResult = {
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				route: event.route,
				textPreview: event.result.textPreview,
				...(event.result.images?.length
					? {
						images: event.result.images.map((image) => ({
							type: "image" as const,
							data: image.imageData,
							mimeType: image.mimeType,
						})),
					}
					: {}),
			};
			this.emitEvent({
				type: "tool_end",
				data: {
					runId: active.runId,
					sessionId,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					route: event.route,
					status: "ok",
					summary: active.progress.summary,
					startedAt: event.startedAt,
					endedAt: event.endedAt,
					durationMs: event.durationMs,
					result: event.result,
				},
			});
			return;
		}
		this.emitEvent({
			type: "tool_end",
			data: {
				runId: active.runId,
				sessionId,
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				route: event.route,
				status: "error",
				summary: active.progress.summary,
				startedAt: event.startedAt,
				endedAt: event.endedAt,
				durationMs: event.durationMs,
				error: event.error,
			},
		});
	}

	emitRuntimeEvent(runId: string, sessionId: string, event: Record<string, unknown>): void {
		const active = this.activeRunsBySessionId.get(sessionId);
		if (!active || active.runId !== runId) {
			return;
		}
		const type = asString(event.type);
		if (type === "status") {
			const text = summarizeRunStatus(asString(event.text));
			if (!text) {
				return;
			}
			active.progress = {
				summary: text,
				stage: "status",
				updatedAt: Date.now(),
			};
			const existing = active.steps.find((step) => step.id === "status");
			const nextStep: ActiveRunStep = {
				id: "status",
				kind: "status",
				label: text,
				state: "running",
				updatedAt: Date.now(),
			};
			if (existing) {
				Object.assign(existing, nextStep);
			} else {
				active.steps.push(nextStep);
			}
			this.emitEvent({
				type: "status_change",
				data: {
					runId,
					sessionId,
					scope: "run",
					text,
					stage: "status",
				},
			});
			return;
		}
		if (type === "message_chunk" && asString(event.stream) === "thought") {
			const thoughtDelta = asString(event.text);
			if (!thoughtDelta) {
				return;
			}
			active.thoughtText += thoughtDelta;
			this.emitEvent({
				type: "stream_chunk",
				data: {
					runId,
					sessionId,
					stream: "thought",
					text: thoughtDelta,
					fullText: active.thoughtText,
				},
			});
		}
	}

	private storeSnapshot(run: AgentRunSnapshot): void {
		this.runs.set(run.runId, run);
		this.latestRunBySessionId.set(run.sessionId, run.runId);
		if (this.runs.size > this.maxRuns) {
			const oldest = this.runs.keys().next().value;
			if (oldest) {
				const evicted = this.runs.get(oldest);
				this.runs.delete(oldest);
				if (evicted && this.latestRunBySessionId.get(evicted.sessionId) === oldest) {
					this.latestRunBySessionId.delete(evicted.sessionId);
				}
			}
		}
		this.onRunChanged?.();
	}

	private clearActiveRun(sessionId: string, runId: string): void {
		const active = this.activeRunsBySessionId.get(sessionId);
		if (active?.runId === runId) {
			this.activeRunsBySessionId.delete(sessionId);
		}
	}

	private ensureActiveRun(runId: string, sessionId: string): ActiveRunState {
		const existing = this.activeRunsBySessionId.get(sessionId);
		if (existing?.runId === runId) {
			return existing;
		}
		const restored: ActiveRunState = {
			runId,
			sessionId,
			streamStarted: false,
			streamEnded: false,
			streamedText: "",
			thoughtText: "",
			steps: [],
		};
		this.activeRunsBySessionId.set(sessionId, restored);
		return restored;
	}

	private emitStreamStart(active: ActiveRunState): void {
		if (active.streamStarted) {
			return;
		}
		active.streamStarted = true;
		this.emitEvent({
			type: "stream_start",
			data: {
				runId: active.runId,
				sessionId: active.sessionId,
				channelId: active.channelId,
				senderId: active.senderId,
				threadId: active.threadId,
				conversationType: active.conversationType,
			},
		});
	}

	private emitAssistantText(runId: string, sessionId: string, text: string): void {
		if (typeof text !== "string" || text.length === 0) {
			return;
		}
		const active = this.ensureActiveRun(runId, sessionId);
		this.emitStreamStart(active);
		const nextChunk =
			text.startsWith(active.streamedText)
				? text.slice(active.streamedText.length)
				: text;
		if (nextChunk.length === 0) {
			return;
		}
		active.streamedText = text;
		this.emitEvent({
			type: "stream_chunk",
			data: {
				runId,
				sessionId,
				text: nextChunk,
				fullText: text,
			},
		});
	}

	private emitStreamEnd(
		runId: string,
		sessionId: string,
		params: {
			status: "ok" | "error";
			text?: string;
			error?: string;
			images?: ImageContent[];
			meta?: Record<string, unknown>;
		},
	): void {
		const active = this.ensureActiveRun(runId, sessionId);
		if (active.streamEnded) {
			return;
		}
		if (params.text && params.text !== active.streamedText) {
			this.emitAssistantText(runId, sessionId, params.text);
		}
		active.streamEnded = true;
		this.emitEvent({
			type: "stream_end",
			data: {
				runId,
				sessionId,
				status: params.status,
				text: params.text ?? active.streamedText,
				error: params.error,
				...(params.images?.length ? { images: params.images } : {}),
				meta: params.meta,
			},
		});
	}

	private emitEvent(event: Omit<GatewayEvent, "timestamp">): void {
		if (!this.onEvent) {
			return;
		}
		const data = asRecord(event.data) ?? {};
		this.onEvent({
			type: event.type,
			data,
			timestamp: Date.now(),
		});
	}
}
