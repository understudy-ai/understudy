import type { AgentAcpConfig } from "@understudy/types";
import type { AcpRuntime } from "./types.js";

export type AcpRuntimeBackend = {
	id: string;
	runtime: AcpRuntime;
	healthy?: () => boolean;
};

type AcpRuntimeRegistryState = {
	backendsById: Map<string, AcpRuntimeBackend>;
};

const ACP_RUNTIME_REGISTRY_STATE_KEY = Symbol.for("understudy.acpRuntimeRegistryState");

function createAcpRuntimeRegistryState(): AcpRuntimeRegistryState {
	return {
		backendsById: new Map<string, AcpRuntimeBackend>(),
	};
}

function resolveRegistryState(): AcpRuntimeRegistryState {
	const runtimeGlobal = globalThis as typeof globalThis & {
		[ACP_RUNTIME_REGISTRY_STATE_KEY]?: AcpRuntimeRegistryState;
	};
	if (!runtimeGlobal[ACP_RUNTIME_REGISTRY_STATE_KEY]) {
		runtimeGlobal[ACP_RUNTIME_REGISTRY_STATE_KEY] = createAcpRuntimeRegistryState();
	}
	return runtimeGlobal[ACP_RUNTIME_REGISTRY_STATE_KEY];
}

const BACKENDS_BY_ID = resolveRegistryState().backendsById;

export function normalizeBackendId(id: string | undefined): string {
	return id?.trim().toLowerCase() || "";
}

function isBackendHealthy(backend: AcpRuntimeBackend): boolean {
	if (!backend.healthy) {
		return true;
	}
	try {
		return backend.healthy();
	} catch {
		return false;
	}
}

export function registerAcpRuntimeBackend(backend: AcpRuntimeBackend): void {
	const id = normalizeBackendId(backend.id);
	if (!id) {
		throw new Error("ACP runtime backend id is required");
	}
	if (!backend.runtime) {
		throw new Error(`ACP runtime backend "${id}" is missing a runtime implementation`);
	}
	BACKENDS_BY_ID.set(id, {
		...backend,
		id,
	});
}

export function unregisterAcpRuntimeBackend(id: string): void {
	const normalized = normalizeBackendId(id);
	if (!normalized) {
		return;
	}
	BACKENDS_BY_ID.delete(normalized);
}

export function getAcpRuntimeBackend(id?: string): AcpRuntimeBackend | null {
	const normalized = normalizeBackendId(id);
	if (normalized) {
		return BACKENDS_BY_ID.get(normalized) ?? null;
	}
	for (const backend of BACKENDS_BY_ID.values()) {
		if (isBackendHealthy(backend)) {
			return backend;
		}
	}
	return BACKENDS_BY_ID.values().next().value ?? null;
}

export function resolveAcpRuntimeBackend(config?: AgentAcpConfig): AcpRuntimeBackend {
	const requestedId = normalizeBackendId(config?.backend);
	const backend = getAcpRuntimeBackend(requestedId || undefined);
	if (!backend) {
		throw new Error(
			'ACP runtime backend is not configured. Set `agent.acp.command` for the built-in command backend or register a custom ACP backend.',
		);
	}
	if (!isBackendHealthy(backend)) {
		throw new Error(`ACP runtime backend "${backend.id}" is currently unavailable.`);
	}
	if (requestedId && backend.id !== requestedId) {
		throw new Error(`ACP runtime backend "${requestedId}" is not registered.`);
	}
	return backend;
}

/**
 * Clear all registered ACP runtime backends.
 * Intended for test teardown — do not call in production code.
 * @internal test-only
 */
export function clearAllAcpRuntimeBackends(): void {
	BACKENDS_BY_ID.clear();
}
