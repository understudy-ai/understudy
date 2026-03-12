/**
 * Discovery RPC handlers: models.list, tools.catalog, skills.status, capabilities.get
 */

import type { RpcHandler } from "../handler-registry.js";
import type { GatewayCapabilitiesResult, GatewayRequest } from "../protocol.js";

export interface CapabilitiesDiscoveryInput {
	request: GatewayRequest;
	defaults: GatewayCapabilitiesResult;
}

type CapabilitiesDiscoveryResult =
	| GatewayCapabilitiesResult
	| Partial<GatewayCapabilitiesResult>
	| Record<string, unknown>
	| void;

export interface DiscoveryHandlerDeps {
	listModels?: () => Promise<unknown>;
	listTools?: () => Promise<unknown>;
	getSkillsStatus?: () => Promise<unknown>;
	buildCapabilities?: () => Promise<GatewayCapabilitiesResult> | GatewayCapabilitiesResult;
	getCapabilities?: (input: CapabilitiesDiscoveryInput) => Promise<CapabilitiesDiscoveryResult> | CapabilitiesDiscoveryResult;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeDiscoveryValue<T>(base: T, extra: unknown): T {
	if (extra === undefined) {
		return base;
	}
	if (!isPlainRecord(extra)) {
		return extra as T;
	}
	const baseRecord: Record<string, unknown> = isPlainRecord(base)
		? base
		: {};
	const merged: Record<string, unknown> = { ...baseRecord };
	for (const [key, value] of Object.entries(extra)) {
		if (value === undefined) {
			continue;
		}
		merged[key] = key in baseRecord
			? mergeDiscoveryValue(baseRecord[key], value)
			: value;
	}
	return merged as T;
}

function defaultCapabilities(): GatewayCapabilitiesResult {
	return {
		schemaVersion: 1,
		generatedAt: Date.now(),
		inventory: {
			methods: [],
			namespaces: [],
			groups: [],
		},
		transport: {
			http: {
				enabled: false,
				host: "",
				port: 0,
				auth: {
					mode: "none",
					required: false,
				},
				routes: {
					rpc: "/rpc",
					rpcView: "/rpc-view",
					health: "/health",
					chat: "/chat",
					channels: "/channels",
				},
			},
			websocket: {
				enabled: false,
				host: "",
				port: 0,
				path: "/",
				sharedPort: true,
				auth: {
					mode: "none",
					required: false,
				},
			},
		},
	};
}

export function createDiscoveryHandlers(deps: DiscoveryHandlerDeps = {}) {
	const modelsList: RpcHandler = async (request) => {
		if (deps.listModels) {
			return { id: request.id, result: await deps.listModels() };
		}
		// Return known model list as fallback
		return {
			id: request.id,
			result: {
				models: [
					{ provider: "openai-codex", id: "gpt-5.4" },
					{ provider: "anthropic", id: "claude-opus-4-20250514" },
					{ provider: "anthropic", id: "claude-sonnet-4-6" },
					{ provider: "anthropic", id: "claude-haiku-4-20250414" },
					{ provider: "openai", id: "gpt-4o" },
					{ provider: "openai", id: "gpt-4o-mini" },
					{ provider: "google", id: "gemini-2.0-flash" },
				],
			},
		};
	};

	const toolsCatalog: RpcHandler = async (request) => {
		if (deps.listTools) {
			return { id: request.id, result: await deps.listTools() };
		}
		return { id: request.id, result: { tools: [] } };
	};

	const skillsStatus: RpcHandler = async (request) => {
		if (deps.getSkillsStatus) {
			return { id: request.id, result: await deps.getSkillsStatus() };
		}
		return { id: request.id, result: { loaded: 0, available: 0 } };
	};

	const capabilitiesGet: RpcHandler = async (request) => {
		const defaults = deps.buildCapabilities
			? await deps.buildCapabilities()
			: defaultCapabilities();
		if (!deps.getCapabilities) {
			return { id: request.id, result: defaults };
		}
		const discovered = await deps.getCapabilities({ request, defaults });
		return {
			id: request.id,
			result: mergeDiscoveryValue(defaults, discovered),
		};
	};

	return { modelsList, toolsCatalog, skillsStatus, capabilitiesGet };
}
