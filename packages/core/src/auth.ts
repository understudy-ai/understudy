/**
 * Authentication management for Understudy.
 * Uses runtime engine auth storage and model registry implementations.
 */

import {
	AuthStorage,
	ModelRegistry,
	type AuthCredential,
} from "@mariozechner/pi-coding-agent";
import { getModel, type Model } from "@mariozechner/pi-ai";
import { join } from "node:path";
import { readResolvedCredentialMap, type StoredCredential } from "./auth-records.js";
import { resolveUnderstudyAgentDir } from "./runtime-paths.js";

export type AuthProviderSource =
	| "primary"
	| "env"
	| "missing";

export interface AuthProviderStatus {
	provider: string;
	available: boolean;
	source: AuthProviderSource;
	credentialType?: "api_key" | "oauth";
}

export interface PreparedRuntimeAuthContext {
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	report: {
		agentDir: string;
		authPath: string;
		modelsPath: string;
		primaryProviders: string[];
		envProviders: string[];
	};
}

function cloneCredential<T>(value: T): T {
	return structuredClone(value);
}

function toAuthCredential(credential: StoredCredential): AuthCredential | undefined {
	if (credential.type === "api_key" && typeof credential.key === "string" && credential.key.trim()) {
		return {
			type: "api_key",
			key: credential.key,
		};
	}
	if (
		credential.type === "oauth" &&
		typeof credential.access === "string" &&
		typeof credential.refresh === "string" &&
		typeof credential.expires === "number"
	) {
		return {
			type: "oauth",
			access: credential.access,
			refresh: credential.refresh,
			expires: credential.expires,
		};
	}
	return undefined;
}

/**
 * Single source of truth for provider ↔ env-var mapping.
 * Each key is a normalized provider name; the value lists the env vars that carry its API key.
 * Providers that share env vars (e.g. google/gemini) reference the same set.
 */
const PROVIDER_ENV_KEYS: Record<string, string[]> = {
	anthropic: ["ANTHROPIC_API_KEY"],
	openai: ["OPENAI_API_KEY"],
	"openai-codex": ["OPENAI_API_KEY"],
	google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
	gemini: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
	minimax: ["MINIMAX_API_KEY"],
	"minimax-cn": ["MINIMAX_API_KEY"],
};

function resolveProviderEnvKeys(provider: string): string[] {
	const normalized = provider.trim().toLowerCase();
	return PROVIDER_ENV_KEYS[normalized] ?? [`${normalized.toUpperCase()}_API_KEY`];
}

function collectEnvApiKeys(env: NodeJS.ProcessEnv = process.env): Map<string, string> {
	const providers = new Map<string, string>();

	// Build a reverse map: env-var → provider names
	const envToProviders = new Map<string, string[]>();
	for (const [provider, keys] of Object.entries(PROVIDER_ENV_KEYS)) {
		for (const key of keys) {
			const existing = envToProviders.get(key);
			if (existing) {
				existing.push(provider);
			} else {
				envToProviders.set(key, [provider]);
			}
		}
	}

	for (const [key, rawValue] of Object.entries(env)) {
		const value = rawValue?.trim();
		if (!value) {
			continue;
		}
		const mapped = envToProviders.get(key);
		if (mapped) {
			for (const provider of mapped) {
				providers.set(provider, value);
			}
		} else if (key.endsWith("_API_KEY")) {
			providers.set(key.slice(0, -"_API_KEY".length).toLowerCase(), value);
		}
	}
	return providers;
}

function normalizeCredentialType(value: unknown): "api_key" | "oauth" | undefined {
	return value === "api_key" || value === "oauth" ? value : undefined;
}

function resolveStatusFromCredential(
	provider: string,
	source: "primary",
	credential: StoredCredential | undefined,
): AuthProviderStatus | undefined {
	if (!credential) {
		return undefined;
	}
	return {
		provider,
		available: true,
		source,
		credentialType: normalizeCredentialType(credential.type),
	};
}

export class AuthManager {
	readonly authStorage: AuthStorage;
	readonly modelRegistry: ModelRegistry;

	constructor(authStorage: AuthStorage, modelRegistry: ModelRegistry) {
		this.authStorage = authStorage;
		this.modelRegistry = modelRegistry;
	}

	/** Create AuthManager with default file-based storage */
	static create(agentDir?: string): AuthManager {
		const dir = agentDir?.trim() || resolveUnderstudyAgentDir();
		const authPath = join(dir, "auth.json");
		const modelsPath = join(dir, "models.json");
		const authStorage = AuthStorage.create(authPath);
		const modelRegistry = new ModelRegistry(authStorage, modelsPath);
		return new AuthManager(authStorage, modelRegistry);
	}

	/** Create an in-memory AuthManager (for testing) */
	static inMemory(): AuthManager {
		const authStorage = AuthStorage.inMemory();
		const modelRegistry = new ModelRegistry(authStorage);
		return new AuthManager(authStorage, modelRegistry);
	}

	/** Get available models */
	getAvailableModels(): Model<any>[] {
		return this.modelRegistry.getAvailable();
	}

	/** Find a model by provider and ID */
	findModel(provider: string, modelId: string): Model<any> | undefined {
		return this.modelRegistry.find(provider, modelId)
			?? (() => {
				try {
					return getModel(provider as any, modelId as any);
				} catch {
					return undefined;
				}
			})();
	}

	/** Get API key for a model */
	async getApiKey(model: Model<any>): Promise<string | undefined> {
		return this.modelRegistry.getApiKey(model);
	}

	/** Set a runtime API key */
	setApiKey(provider: string, apiKey: string): void {
		this.authStorage.setRuntimeApiKey(provider, apiKey);
	}
}

export function resolveProviderApiKey(
	provider: string,
	options: {
		agentDir?: string;
	} = {},
): string | undefined {
	const agentDir = options.agentDir?.trim() || resolveUnderstudyAgentDir();
	const credential = readResolvedCredentialMap(agentDir)[provider];
	if (credential?.type === "api_key" && typeof credential.key === "string" && credential.key.trim()) {
		return credential.key.trim();
	}
	for (const envKey of resolveProviderEnvKeys(provider)) {
		const value = process.env[envKey]?.trim();
		if (value) {
			return value;
		}
	}
	return undefined;
}

export function inspectProviderAuthStatus(
	provider: string,
	options: {
		agentDir?: string;
	} = {},
): AuthProviderStatus {
	const agentDir = options.agentDir?.trim() || resolveUnderstudyAgentDir();
	const primaryCredential = readResolvedCredentialMap(agentDir)[provider];
	const primaryStatus = resolveStatusFromCredential(provider, "primary", primaryCredential);
	if (primaryStatus) {
		return primaryStatus;
	}

	if (resolveProviderEnvKeys(provider).some((key) => Boolean(process.env[key]?.trim()))) {
		return {
			provider,
			available: true,
			source: "env",
			credentialType: "api_key",
		};
	}

	return {
		provider,
		available: false,
		source: "missing",
	};
}

export function inspectProviderAuthStatuses(
	providers: Iterable<string>,
	options: {
		agentDir?: string;
	} = {},
): Map<string, AuthProviderStatus> {
	const statuses = new Map<string, AuthProviderStatus>();
	for (const provider of providers) {
		const normalized = provider.trim();
		if (!normalized || statuses.has(normalized)) {
			continue;
		}
		statuses.set(normalized, inspectProviderAuthStatus(normalized, options));
	}
	return statuses;
}

export function prepareRuntimeAuthContext(
	options: {
		agentDir?: string;
	} = {},
): PreparedRuntimeAuthContext {
	const agentDir = options.agentDir?.trim() || resolveUnderstudyAgentDir();
	const authPath = join(agentDir, "auth.json");
	const modelsPath = join(agentDir, "models.json");
	const authStorage = AuthStorage.create(authPath);
	const primaryCredentials = readResolvedCredentialMap(agentDir);
	const primaryProviders = Object.keys(primaryCredentials);
	const envProviders: string[] = [];

	for (const [provider, credential] of Object.entries(primaryCredentials)) {
		if (authStorage.has(provider)) {
			continue;
		}
		const clonedCredential = toAuthCredential(cloneCredential(credential));
		if (clonedCredential) {
			authStorage.set(provider, clonedCredential);
		}
	}

	for (const [provider, apiKey] of collectEnvApiKeys()) {
		authStorage.setRuntimeApiKey(provider, apiKey);
		envProviders.push(provider);
	}

	const modelRegistry = new ModelRegistry(authStorage, modelsPath);
	return {
		authStorage,
		modelRegistry,
		report: {
			agentDir,
			authPath,
			modelsPath,
			primaryProviders,
			envProviders,
		},
	};
}
