/**
 * Models command: list and manage available AI models.
 */

import { ConfigManager, inspectProviderAuthStatuses } from "@understudy/core";
import { createRpcClient } from "../rpc-client.js";
import { BUILTIN_MODELS, mergeKnownModels, parseModelRef } from "./model-support.js";

interface ModelsOptions {
	list?: boolean;
	scan?: boolean;
	set?: string;
}

const KNOWN_MODELS = mergeKnownModels(BUILTIN_MODELS);

interface ModelItem {
	provider: string;
	id: string;
	authAvailable?: boolean;
	authSource?: string;
	authType?: string;
}

function formatProviderAuthBadge(item: ModelItem | undefined): string {
	if (!item?.authAvailable) {
		return "no auth";
	}
	const authType = item.authType === "oauth"
		? "oauth"
		: item.authType === "api_key"
			? "api key"
			: "auth";
	switch (item.authSource) {
		case "primary":
			return authType;
		case "env":
			return `env ${authType}`;
		default:
			return authType;
	}
}

function printModels(modelItems: ModelItem[], defaultProvider?: string, defaultModel?: string): void {
	if (modelItems.length === 0) {
		console.log("No models available.");
		return;
	}

	const groups = new Map<string, ModelItem[]>();
	for (const model of modelItems) {
		const provider = model.provider.trim();
		if (!groups.has(provider)) {
			groups.set(provider, []);
		}
		groups.get(provider)!.push(model);
	}

	console.log("Available models:");
	for (const [provider, models] of groups.entries()) {
		console.log(`\n  ${provider} (${formatProviderAuthBadge(models[0])}):`);
		for (const model of models) {
			const isDefault = defaultProvider === provider && defaultModel === model.id;
			console.log(`    ${provider}/${model.id}${isDefault ? "  [default]" : ""}`);
		}
	}
}

export async function runModelsCommand(opts: ModelsOptions = {}): Promise<void> {
	if (opts.set) {
		const parsed = parseModelRef(opts.set);
		if (!parsed) {
			console.error("Model format: provider/model-id (e.g., openai-codex/gpt-5.4)");
			process.exitCode = 1;
			return;
		}
		try {
			const configManager = await ConfigManager.load();
			configManager.update({
				defaultProvider: parsed.provider,
				defaultModel: parsed.modelId,
			});
			configManager.save();
			console.log(`Default model set to: ${parsed.provider}/${parsed.modelId}`);
			console.log(`Saved to: ${configManager.getPath()}`);
		} catch (error) {
			console.error("Failed to update config:", error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		}
		return;
	}

	if (opts.scan) {
		console.log("Scanning provider auth...");
		const authStates = inspectProviderAuthStatuses(Object.keys(KNOWN_MODELS));
		for (const provider of Object.keys(KNOWN_MODELS)) {
			const authState = authStates.get(provider);
			console.log(`  ${provider}: ${formatProviderAuthBadge({
				provider,
				id: "",
				authAvailable: authState?.available,
				authSource: authState?.source,
				authType: authState?.credentialType,
			})}`);
		}
		return;
	}

	let defaultProvider: string | undefined;
	let defaultModel: string | undefined;
	try {
		const configManager = await ConfigManager.load();
		const config = configManager.get();
		defaultProvider = config.defaultProvider;
		defaultModel = config.defaultModel;
	} catch {
		// Ignore config read errors and continue.
	}

	try {
		const client = createRpcClient();
		const result = await client.call<{
			models?: Array<{
				provider?: string;
				id?: string;
				authAvailable?: boolean;
				authSource?: string;
				authType?: string;
			}>;
		}>("models.list", {});
		const rpcModels = (result.models ?? [])
			.map((item): ModelItem | null => {
				const provider = typeof item.provider === "string" ? item.provider.trim() : "";
				const id = typeof item.id === "string" ? item.id.trim() : "";
				if (!provider || !id) return null;
				return {
					provider,
					id,
					authAvailable: item.authAvailable === true,
					authSource: typeof item.authSource === "string" ? item.authSource : undefined,
					authType: typeof item.authType === "string" ? item.authType : undefined,
				};
			})
			.filter((item): item is ModelItem => item !== null);
		if (rpcModels.length > 0) {
			printModels(rpcModels, defaultProvider, defaultModel);
			return;
		}
	} catch {
		// Fallback to local known model map when gateway is unavailable.
	}

	const authStates = inspectProviderAuthStatuses(Object.keys(KNOWN_MODELS));
	const localModels: ModelItem[] = Object.entries(KNOWN_MODELS).flatMap(([provider, models]) => {
		const authState = authStates.get(provider);
		return models.map((id) => ({
			provider,
			id,
			authAvailable: authState?.available,
			authSource: authState?.source,
			authType: authState?.credentialType,
		}));
	});
	printModels(localModels, defaultProvider, defaultModel);
}
