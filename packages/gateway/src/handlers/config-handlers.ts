/**
 * Config RPC handlers: config.get, config.apply, config.schema
 */

import type { RpcHandler } from "../handler-registry.js";

export type ConfigGetter = () => Record<string, unknown>;
export type ConfigApplier = (partial: Record<string, unknown>) => void;

export interface ConfigHandlerDeps {
	getConfig: ConfigGetter;
	applyConfig?: ConfigApplier;
}

export function createConfigHandlers(deps: ConfigHandlerDeps) {
	const configGet: RpcHandler = async (request) => {
		const key = request.params.key as string | undefined;
		const config = deps.getConfig();
		if (key) {
			const value = key.split(".").reduce<any>((obj, k) => obj?.[k], config);
			return { id: request.id, result: { key, value } };
		}
		return { id: request.id, result: config };
	};

	const configApply: RpcHandler = async (request) => {
		if (!deps.applyConfig) {
			return { id: request.id, error: { code: 501, message: "config.apply not available" } };
		}
		const partial = request.params as Record<string, unknown>;
		deps.applyConfig(partial);
		return { id: request.id, result: { applied: true } };
	};

	const configSchema: RpcHandler = async (request) => {
		return {
			id: request.id,
			result: {
				type: "object",
				description: "Understudy configuration schema (simplified)",
				properties: {
					defaultProvider: { type: "string" },
					defaultModel: { type: "string" },
					defaultThinkingLevel: { type: "string", enum: ["off", "minimal", "low", "medium", "high", "xhigh"] },
				},
			},
		};
	};

	return { configGet, configApply, configSchema };
}
