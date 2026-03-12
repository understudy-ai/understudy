/**
 * Session RPC handlers: session.list, session.get, session.history, etc.
 */

import { sanitizeHistoryPayload, sanitizeResponsePayload } from "../display-sanitize.js";
import type { RpcHandler } from "../handler-registry.js";

function sessionTeachHandler(
	handlerName:
		| "teachList"
		| "teachCreate"
		| "teachRecordStart"
		| "teachRecordStatus"
		| "teachRecordStop"
		| "teachVideo"
		| "teachUpdate"
		| "teachValidate"
		| "teachPublish",
	errorMessage: string,
): RpcHandler {
	return async (request, context) => {
		const handlers = context.getSessionHandlers();
		const handler = handlers?.[handlerName as keyof typeof handlers];
		if (!handler) {
			return { id: request.id, error: { code: 503, message: errorMessage } };
		}
		return { id: request.id, result: await (handler as (params?: Record<string, unknown>) => Promise<unknown>)(request.params) };
	};
}

export const sessionList: RpcHandler = async (request, context) => {
	const handlers = context.getSessionHandlers();
	if (!handlers) {
		return { id: request.id, error: { code: 503, message: "Session handlers not configured" } };
	}
	return { id: request.id, result: await handlers.list(request.params) };
};

export const sessionGet: RpcHandler = async (request, context) => {
	const handlers = context.getSessionHandlers();
	if (!handlers) {
		return { id: request.id, error: { code: 503, message: "Session handlers not configured" } };
	}
	return { id: request.id, result: await handlers.get(request.params) };
};

export const sessionHistory: RpcHandler = async (request, context) => {
	const handlers = context.getSessionHandlers();
	if (!handlers?.history) {
		return { id: request.id, error: { code: 503, message: "Session history handler not configured" } };
	}
	return { id: request.id, result: sanitizeHistoryPayload(await handlers.history(request.params)) };
};

export const sessionTrace: RpcHandler = async (request, context) => {
	const handlers = context.getSessionHandlers();
	if (!handlers?.trace) {
		return { id: request.id, error: { code: 503, message: "Session trace handler not configured" } };
	}
	return { id: request.id, result: await handlers.trace(request.params) };
};

export const sessionTeachList = sessionTeachHandler("teachList", "Session teach list handler not configured");
export const sessionTeachCreate = sessionTeachHandler("teachCreate", "Session teach create handler not configured");
export const sessionTeachRecordStart = sessionTeachHandler(
	"teachRecordStart",
	"Session teach record start handler not configured",
);
export const sessionTeachRecordStatus = sessionTeachHandler(
	"teachRecordStatus",
	"Session teach record status handler not configured",
);
export const sessionTeachRecordStop = sessionTeachHandler(
	"teachRecordStop",
	"Session teach record stop handler not configured",
);
export const sessionTeachVideo = sessionTeachHandler("teachVideo", "Session teach video handler not configured");
export const sessionTeachUpdate = sessionTeachHandler("teachUpdate", "Session teach update handler not configured");
export const sessionTeachValidate = sessionTeachHandler("teachValidate", "Session teach validate handler not configured");
export const sessionTeachPublish = sessionTeachHandler("teachPublish", "Session teach publish handler not configured");

export const sessionCreate: RpcHandler = async (request, context) => {
	const handlers = context.getSessionHandlers();
	if (!handlers?.create) {
		return { id: request.id, error: { code: 503, message: "Session create handler not configured" } };
	}
	return { id: request.id, result: await handlers.create(request.params) };
};

export const sessionSend: RpcHandler = async (request, context) => {
	const handlers = context.getSessionHandlers();
	if (!handlers?.send) {
		return { id: request.id, error: { code: 503, message: "Session send handler not configured" } };
	}
	return { id: request.id, result: sanitizeResponsePayload(await handlers.send(request.params)) };
};

export const sessionPatch: RpcHandler = async (request, context) => {
	const handlers = context.getSessionHandlers();
	if (!handlers?.patch) {
		return { id: request.id, error: { code: 503, message: "Session patch handler not configured" } };
	}
	return { id: request.id, result: await handlers.patch(request.params) };
};

export const sessionReset: RpcHandler = async (request, context) => {
	const handlers = context.getSessionHandlers();
	if (!handlers?.reset) {
		return { id: request.id, error: { code: 503, message: "Session reset handler not configured" } };
	}
	return { id: request.id, result: await handlers.reset(request.params) };
};

export const sessionDelete: RpcHandler = async (request, context) => {
	const handlers = context.getSessionHandlers();
	if (!handlers?.delete) {
		return { id: request.id, error: { code: 503, message: "Session delete handler not configured" } };
	}
	return { id: request.id, result: await handlers.delete(request.params) };
};

export const sessionCompact: RpcHandler = async (request, context) => {
	const handlers = context.getSessionHandlers();
	if (!handlers?.compact) {
		return { id: request.id, error: { code: 503, message: "Session compact handler not configured" } };
	}
	return { id: request.id, result: await handlers.compact(request.params) };
};

export const sessionBranch: RpcHandler = async (request, context) => {
	const handlers = context.getSessionHandlers();
	if (!handlers?.branch) {
		return { id: request.id, error: { code: 503, message: "Session branch handler not configured" } };
	}
	return { id: request.id, result: await handlers.branch(request.params) };
};

export const sessionsSpawn: RpcHandler = async (request, context) => {
	const handlers = context.getSessionHandlers();
	if (!handlers?.spawnSubagent) {
		return { id: request.id, error: { code: 503, message: "Session spawn handler not configured" } };
	}
	return { id: request.id, result: sanitizeResponsePayload(await handlers.spawnSubagent(request.params)) };
};

export const subagentsAction: RpcHandler = async (request, context) => {
	const handlers = context.getSessionHandlers();
	if (!handlers?.subagents) {
		return { id: request.id, error: { code: 503, message: "Subagents handler not configured" } };
	}
	return { id: request.id, result: sanitizeResponsePayload(await handlers.subagents(request.params)) };
};
