/**
 * Schedule RPC handlers: schedule.list, schedule.status, schedule.add, schedule.update, schedule.remove, schedule.run, schedule.runs
 */

import type { RpcHandler } from "../handler-registry.js";

export interface ScheduleHandlerDeps {
	list: () => Promise<unknown[]>;
	status: () => Promise<Record<string, unknown>>;
	add?: (params: Record<string, unknown>) => Promise<unknown>;
	update?: (params: Record<string, unknown>) => Promise<unknown>;
	remove?: (params: Record<string, unknown>) => Promise<unknown>;
	run?: (params: Record<string, unknown>) => Promise<unknown>;
	runs?: (params: Record<string, unknown>) => Promise<unknown>;
}

export function createScheduleHandlers(deps: ScheduleHandlerDeps) {
	const scheduleList: RpcHandler = async (request) => {
		return { id: request.id, result: await deps.list() };
	};

	const scheduleStatus: RpcHandler = async (request) => {
		return { id: request.id, result: await deps.status() };
	};

	const scheduleAdd: RpcHandler = async (request) => {
		if (!deps.add) return { id: request.id, error: { code: 501, message: "schedule.add not available" } };
		return { id: request.id, result: await deps.add(request.params) };
	};

	const scheduleUpdate: RpcHandler = async (request) => {
		if (!deps.update) return { id: request.id, error: { code: 501, message: "schedule.update not available" } };
		return { id: request.id, result: await deps.update(request.params) };
	};

	const scheduleRemove: RpcHandler = async (request) => {
		if (!deps.remove) return { id: request.id, error: { code: 501, message: "schedule.remove not available" } };
		return { id: request.id, result: await deps.remove(request.params) };
	};

	const scheduleRun: RpcHandler = async (request) => {
		if (!deps.run) return { id: request.id, error: { code: 501, message: "schedule.run not available" } };
		return { id: request.id, result: await deps.run(request.params) };
	};

	const scheduleRuns: RpcHandler = async (request) => {
		if (!deps.runs) return { id: request.id, error: { code: 501, message: "schedule.runs not available" } };
		return { id: request.id, result: await deps.runs(request.params) };
	};

	return { scheduleList, scheduleStatus, scheduleAdd, scheduleUpdate, scheduleRemove, scheduleRun, scheduleRuns };
}
