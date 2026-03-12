import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import type { UnderstudySessionMeta } from "../prompt-report.js";
import { asRecord } from "../value-helpers.js";

type ToolRoute =
	| "gui"
	| "browser"
	| "web"
	| "shell"
	| "process"
	| "memory"
	| "schedule"
	| "messaging"
	| "session"
	| "filesystem"
	| "system";

export interface UnderstudySessionToolResultSummary {
	route: ToolRoute;
	isError: boolean;
	contentTypes: string[];
	textPreview: string;
	images?: Array<{
		imageData: string;
		mimeType: string;
	}>;
	details?: unknown;
	status?: Record<string, unknown>;
	confidence?: number;
	groundingMethod?: string;
}

interface UnderstudySessionToolEventBase {
	toolName: string;
	toolCallId: string;
	route: ToolRoute;
	sessionMeta?: UnderstudySessionMeta;
	params: unknown;
	startedAt: number;
}

export interface UnderstudySessionToolStartEvent extends UnderstudySessionToolEventBase {
	phase: "start";
}

export interface UnderstudySessionToolFinishEvent extends UnderstudySessionToolEventBase {
	phase: "finish";
	endedAt: number;
	durationMs: number;
	result: UnderstudySessionToolResultSummary;
}

export interface UnderstudySessionToolErrorEvent extends UnderstudySessionToolEventBase {
	phase: "error";
	endedAt: number;
	durationMs: number;
	error: string;
}

export type UnderstudySessionToolEvent =
	| UnderstudySessionToolStartEvent
	| UnderstudySessionToolFinishEvent
	| UnderstudySessionToolErrorEvent;

export interface ToolExecutionTraceOptions {
	onEvent?: (event: UnderstudySessionToolEvent) => Promise<void> | void;
	getSessionMeta?: () => UnderstudySessionMeta | undefined;
}

function extractTextPreview(content: unknown): string {
	if (typeof content === "string") {
		return content.trim().slice(0, 400);
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.map((chunk) => {
			if (!chunk || typeof chunk !== "object") {
				return "";
			}
			const text = (chunk as { text?: unknown }).text;
			return typeof text === "string" ? text : "";
		})
		.filter(Boolean)
		.join("\n")
		.trim()
		.slice(0, 400);
}

function extractContentTypes(content: unknown): string[] {
	if (!Array.isArray(content)) {
		return [];
	}
	return Array.from(
		new Set(
			content
				.map((chunk) => {
					if (!chunk || typeof chunk !== "object") {
						return "";
					}
					const type = (chunk as { type?: unknown }).type;
					return typeof type === "string" ? type : "";
				})
				.filter(Boolean),
		),
	);
}

function extractImages(content: unknown): UnderstudySessionToolResultSummary["images"] {
	if (!Array.isArray(content)) {
		return undefined;
	}
	const images = content
		.map((chunk) => {
			if (!chunk || typeof chunk !== "object") {
				return null;
			}
			const candidate = chunk as { type?: unknown; data?: unknown; imageData?: unknown; mimeType?: unknown };
			if (candidate.type !== "image") {
				return null;
			}
			const imageData = typeof candidate.imageData === "string"
				? candidate.imageData
				: typeof candidate.data === "string"
					? candidate.data
					: "";
			const mimeType = typeof candidate.mimeType === "string" ? candidate.mimeType : "";
			if (!imageData || !mimeType.startsWith("image/")) {
				return null;
			}
			return {
				imageData,
				mimeType,
			};
		})
		.filter((entry): entry is NonNullable<UnderstudySessionToolResultSummary["images"]>[number] => Boolean(entry));
	return images.length > 0 ? images.slice(0, 1) : undefined;
}

function extractStatus(details: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
	const status = asRecord(details?.status);
	if (!status || Object.keys(status).length === 0) {
		return undefined;
	}
	return status;
}

export function resolveToolExecutionRoute(
	toolName: string,
	details?: Record<string, unknown>,
): ToolRoute {
	const groundingMethod = typeof details?.grounding_method === "string"
		? details.grounding_method.trim().toLowerCase()
		: "";
	if (
		groundingMethod === "grounding" ||
		groundingMethod === "visual" ||
		groundingMethod === "screenshot" ||
		toolName.startsWith("gui_")
	) {
		return "gui";
	}
	if (toolName === "browser") {
		return "browser";
	}
	if (toolName === "web_search" || toolName === "web_fetch") {
		return "web";
	}
	if (toolName === "bash") {
		return "shell";
	}
	if (toolName === "process") {
		return "process";
	}
	if (toolName.startsWith("memory_")) {
		return "memory";
	}
	if (toolName === "schedule") {
		return "schedule";
	}
	if (toolName === "message_send") {
		return "messaging";
	}
	if (
		toolName === "sessions_list" ||
		toolName === "sessions_history" ||
		toolName === "session_status" ||
		toolName === "sessions_send" ||
		toolName === "sessions_spawn" ||
		toolName === "agents_list" ||
		toolName === "subagents"
	) {
		return "session";
	}
	if (toolName === "read" || toolName === "write" || toolName === "edit" || toolName === "apply_patch") {
		return "filesystem";
	}
	return "system";
}

export function buildToolExecutionResultSummary(
	toolName: string,
	result: AgentToolResult<unknown>,
): UnderstudySessionToolResultSummary {
	const details = asRecord(result.details);
	const images = extractImages(result.content);
	const confidence = typeof details?.confidence === "number" && Number.isFinite(details.confidence)
		? details.confidence
		: undefined;
	const groundingMethod = typeof details?.grounding_method === "string"
		? details.grounding_method
		: undefined;
	return {
			route: resolveToolExecutionRoute(toolName, details),
			isError:
				(result as { isError?: unknown }).isError === true ||
				typeof details?.error === "string",
			contentTypes: extractContentTypes(result.content),
			textPreview: extractTextPreview(result.content),
			...(images ? { images } : {}),
			details: details,
			status: extractStatus(details),
		confidence,
		groundingMethod,
	};
}

async function emitToolTraceEvent(
	options: ToolExecutionTraceOptions,
	event: UnderstudySessionToolEvent,
): Promise<void> {
	if (!options.onEvent) {
		return;
	}
	try {
		await options.onEvent(event);
	} catch {
		// Ignore trace sink errors. Tool execution must continue.
	}
}

function wrapTool<TParameters extends TSchema, TDetails>(
	tool: AgentTool<TParameters, TDetails>,
	options: ToolExecutionTraceOptions,
): AgentTool<TParameters, TDetails> {
	return {
		...tool,
		execute: async (toolCallId, params, signal, onUpdate) => {
			const startedAt = Date.now();
			await emitToolTraceEvent(options, {
				phase: "start",
				toolName: tool.name,
				toolCallId,
				params,
				route: resolveToolExecutionRoute(tool.name),
				startedAt,
				sessionMeta: options.getSessionMeta?.(),
			});
			try {
				const result = await tool.execute(toolCallId, params, signal, onUpdate);
				const endedAt = Date.now();
				await emitToolTraceEvent(options, {
					phase: "finish",
					toolName: tool.name,
					toolCallId,
					params,
					route: resolveToolExecutionRoute(tool.name, asRecord(result.details)),
					startedAt,
					endedAt,
					durationMs: Math.max(0, endedAt - startedAt),
					sessionMeta: options.getSessionMeta?.(),
					result: buildToolExecutionResultSummary(tool.name, result as AgentToolResult<unknown>),
				});
				return result;
			} catch (error) {
				const endedAt = Date.now();
				await emitToolTraceEvent(options, {
					phase: "error",
					toolName: tool.name,
					toolCallId,
					params,
					route: resolveToolExecutionRoute(tool.name),
					startedAt,
					endedAt,
					durationMs: Math.max(0, endedAt - startedAt),
					sessionMeta: options.getSessionMeta?.(),
					error: error instanceof Error ? error.message : String(error),
				});
				throw error;
			}
		},
	};
}

export function wrapToolsWithExecutionTrace(
	tools: AgentTool<TSchema>[],
	options: ToolExecutionTraceOptions,
): AgentTool<TSchema>[] {
	return tools.map((tool) => wrapTool(tool as AgentTool<TSchema, unknown>, options));
}
