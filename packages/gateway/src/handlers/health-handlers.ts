/**
 * Health RPC handlers: health, runtime.readiness
 */

import type { RpcHandler } from "../handler-registry.js";
import { GATEWAY_VERSION } from "../server.js";

export interface HealthHandlerDeps {
	getUptime: () => number;
	getAuthMode: () => string;
	getChannelStatuses?: () => Promise<Array<Record<string, unknown>>>;
	getReadiness?: () => Promise<unknown>;
}

export function createHealthHandlers(deps: HealthHandlerDeps) {
	async function resolveChannelStatuses(context: Parameters<RpcHandler>[1]) {
		return deps.getChannelStatuses
			? await deps.getChannelStatuses()
			: context.getRouter().listChannels().map((c) => ({ id: c.id }));
	}

	const health: RpcHandler = async (request, context) => {
		const mem = process.memoryUsage();
		const channelStatuses = await resolveChannelStatuses(context);
		return {
			id: request.id,
			result: {
				status: "ok",
				version: GATEWAY_VERSION,
				uptime: deps.getUptime(),
				channels: context.getRouter().listChannels().map((c) => c.id),
				channelStatuses,
				memory: {
					heapUsed: mem.heapUsed,
					heapTotal: mem.heapTotal,
				},
				auth: { mode: deps.getAuthMode() },
				...(deps.getReadiness ? { readiness: await deps.getReadiness() } : {}),
			},
		};
	};

	const runtimeReadiness: RpcHandler = async (request) => {
		if (!deps.getReadiness) {
			return {
				id: request.id,
				error: { code: 501, message: "runtime.readiness not available" },
			};
		}
		return {
			id: request.id,
			result: await deps.getReadiness(),
		};
	};

	return { health, runtimeReadiness };
}
