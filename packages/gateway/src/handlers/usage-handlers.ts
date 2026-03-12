/**
 * Usage RPC handlers: usage.summary, usage.daily, usage.status, usage.cost
 */

import type { RpcHandler } from "../handler-registry.js";
import type { UsageTracker } from "@understudy/core";

export interface UsageHandlerDeps {
	tracker?: UsageTracker;
}

export function createUsageHandlers(deps: UsageHandlerDeps = {}) {
	const usageSummary: RpcHandler = async (request) => {
		if (!deps.tracker) {
			return { id: request.id, result: { totalTokens: 0, recordCount: 0 } };
		}
		const sinceMs = request.params.sinceMs as number | undefined;
		return { id: request.id, result: deps.tracker.getSummary(sinceMs) };
	};

	const usageDaily: RpcHandler = async (request) => {
		if (!deps.tracker) {
			return { id: request.id, result: { totalTokens: 0, recordCount: 0 } };
		}
		return { id: request.id, result: deps.tracker.getDaily() };
	};

	const usageStatus: RpcHandler = async (request) => {
		return {
			id: request.id,
			result: {
				tracking: Boolean(deps.tracker),
				recordCount: deps.tracker?.size ?? 0,
			},
		};
	};

	const usageCost: RpcHandler = async (request) => {
		if (!deps.tracker) {
			return { id: request.id, result: { estimatedCost: 0 } };
		}
		const summary = deps.tracker.getSummary();
		// Rough cost estimate (Claude Sonnet-like pricing)
		const inputCost = (summary.totalInputTokens / 1_000_000) * 3;
		const outputCost = (summary.totalOutputTokens / 1_000_000) * 15;
		return {
			id: request.id,
			result: {
				estimatedCost: Math.round((inputCost + outputCost) * 100) / 100,
				currency: "USD",
				breakdown: { inputCost, outputCost },
			},
		};
	};

	return { usageSummary, usageDaily, usageStatus, usageCost };
}
