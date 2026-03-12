import { inspectGuiEnvironmentReadiness } from "@understudy/gui";
import {
	createGuiRuntime,
	createRuntimeToolset,
	listRuntimeToolCatalog,
	setDefaultGuiRuntime,
	type RuntimeToolCatalog,
	type RuntimeToolsetOptions,
} from "@understudy/tools";
import {
	AuthManager,
	prepareRuntimeAuthContext,
	resolveRuntimeModelCandidates,
	type RuntimeResolvedModelCandidate,
} from "@understudy/core";
import { getModel, type Model } from "@mariozechner/pi-ai";
import type { UnderstudyConfig } from "@understudy/types";
import { primeGuiGroundingForConfig } from "./gui-grounding.js";

function resolveConfiguredModelCandidates(params: {
	config: UnderstudyConfig;
	explicitModel?: Model<any>;
	agentDir?: string;
}): {
	authManager: AuthManager;
	modelCandidates: RuntimeResolvedModelCandidate[];
} {
	const authContext = prepareRuntimeAuthContext({
		agentDir: params.agentDir,
	});
	const authManager = new AuthManager(authContext.authStorage, authContext.modelRegistry);
	const resolution = resolveRuntimeModelCandidates({
		explicitModel: params.explicitModel,
		defaultProvider: params.config.defaultProvider,
		defaultModel: params.config.defaultModel,
		modelFallbacks: params.config.agent.modelFallbacks,
		resolveModel: (provider, modelId) =>
			authContext.modelRegistry.find(provider, modelId) ??
			getModel(provider as any, modelId as any),
	});
	return {
		authManager,
		modelCandidates: resolution.candidates,
	};
}

export async function createConfiguredGuiRuntime(
	config: UnderstudyConfig,
	options: {
		explicitModel?: Model<any>;
		agentDir?: string;
	} = {},
): Promise<ReturnType<typeof createGuiRuntime>> {
	const { authManager, modelCandidates } = resolveConfiguredModelCandidates({
		config,
		explicitModel: options.explicitModel,
		agentDir: options.agentDir,
	});
	const guiGrounding = await primeGuiGroundingForConfig(config, authManager, undefined, {
		explicitModel: options.explicitModel,
		modelCandidates,
	});
	const guiEnvironmentReadiness = await inspectGuiEnvironmentReadiness();
	const runtime = createGuiRuntime({
		groundingProvider: guiGrounding.available ? guiGrounding.groundingProvider : undefined,
		environmentReadiness: guiEnvironmentReadiness,
	});
	setDefaultGuiRuntime(runtime);
	return runtime;
}

type ConfiguredRuntimeToolingOptions = RuntimeToolsetOptions & {
	config: UnderstudyConfig;
	explicitModel?: Model<any>;
	agentDir?: string;
};

export async function createConfiguredRuntimeToolset(
	options: ConfiguredRuntimeToolingOptions,
) {
	const guiRuntime = await createConfiguredGuiRuntime(options.config, {
		explicitModel: options.explicitModel,
		agentDir: options.agentDir,
	});
	return createRuntimeToolset({
		...options,
		guiRuntime,
	});
}

export async function listConfiguredRuntimeToolCatalog(
	options: ConfiguredRuntimeToolingOptions,
): Promise<RuntimeToolCatalog> {
	const guiRuntime = await createConfiguredGuiRuntime(options.config, {
		explicitModel: options.explicitModel,
		agentDir: options.agentDir,
	});
	return listRuntimeToolCatalog({
		...options,
		guiRuntime,
	});
}
