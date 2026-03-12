import { AcpRuntimeAdapter } from "./runtime/adapters/acp.js";
import { EmbeddedRuntimeAdapter } from "./runtime/adapters/embedded.js";
import {
	createUnderstudySessionWithRuntime,
	type UnderstudySessionOptions,
	type UnderstudySessionResult,
} from "./runtime/orchestrator.js";
import { ConfigManager } from "./config.js";

export type { UnderstudySessionOptions, UnderstudySessionResult };

function normalizeRuntimeBackend(
	value: string | undefined,
): "embedded" | "acp" | undefined {
	if (value === "acp") {
		return "acp";
	}
	if (value === "embedded") {
		return "embedded";
	}
	return undefined;
}

export async function resolveRuntimeBackendForSession(
	opts: UnderstudySessionOptions,
): Promise<"embedded" | "acp"> {
	const explicitBackend = normalizeRuntimeBackend(opts.runtimeBackend);
	if (explicitBackend) {
		return explicitBackend;
	}

	const envBackend = normalizeRuntimeBackend(
		process.env.UNDERSTUDY_RUNTIME_BACKEND?.trim().toLowerCase(),
	);
	if (envBackend) {
		return envBackend;
	}

	const configBackend = normalizeRuntimeBackend(opts.config?.agent?.runtimeBackend);
	if (configBackend) {
		return configBackend;
	}

	if (opts.configPath) {
		try {
			const loaded = await ConfigManager.load(opts.configPath);
			const fromFile = normalizeRuntimeBackend(loaded.get().agent.runtimeBackend);
			if (fromFile) {
				return fromFile;
			}
		} catch {
			// Ignore config read failures here; orchestrator handles full config errors.
		}
	}

	return "embedded";
}

export async function createUnderstudySession(
	opts: UnderstudySessionOptions = {},
): Promise<UnderstudySessionResult> {
	const backend = await resolveRuntimeBackendForSession(opts);
	const adapter = backend === "acp"
		? new AcpRuntimeAdapter()
		: new EmbeddedRuntimeAdapter();
	return createUnderstudySessionWithRuntime(adapter, opts);
}
