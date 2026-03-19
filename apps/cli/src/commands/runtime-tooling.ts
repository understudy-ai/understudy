import { inspectGuiEnvironmentReadiness } from "@understudy/gui";
import {
	createGuiRuntime,
	createRuntimeToolset,
	listRuntimeToolCatalog,
	normalizeRuntimePlatformCapabilities,
	setDefaultGuiRuntime,
	type RuntimePlatformCapability,
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

function resolveConfiguredPlatformCapabilitySource(
	capabilities: RuntimeToolsetOptions["platformCapabilities"],
): RuntimePlatformCapability[] {
	if (typeof capabilities === "function") {
		return capabilities() ?? [];
	}
	return capabilities ?? [];
}

function buildCorePlatformCapabilities(
	options: RuntimeToolsetOptions & {
		guiRuntime?: ReturnType<typeof createGuiRuntime>;
	},
): RuntimePlatformCapability[] {
	const capabilities: RuntimePlatformCapability[] = [
		{
			id: "workspace",
			label: "Workspace",
			description: "Local file editing, patching, and shell execution inside the current workspace.",
			source: "core",
			tags: ["process", "exec", "apply_patch"],
		},
		{
			id: "media",
			label: "Media Understanding",
			description: "Image, PDF, and visual parsing tools for multimodal tasks.",
			source: "core",
			tags: ["image", "vision", "pdf"],
		},
		{
			id: "browser",
			label: "Browser Automation",
			description: "Managed browser control, navigation, and page inspection.",
			source: "core",
			tags: ["browser", "web"],
		},
	];

	if (options.guiRuntime) {
		const guiCapabilities = options.guiRuntime.describeCapabilities?.();
		capabilities.push({
			id: "desktop_gui",
			label: "Desktop GUI",
			description:
				guiCapabilities?.groundingAvailable === true
					? "Desktop observation and grounded GUI actions are available."
					: "Desktop observation is available and GUI control can degrade based on local helper readiness.",
			source: "core",
			tags: ["gui", "desktop", "grounding"],
			metadata: guiCapabilities ? {
				enabledToolNames: guiCapabilities.enabledToolNames,
				disabledToolNames: guiCapabilities.disabledToolNames,
				platformSupported: guiCapabilities.platformSupported,
				groundingAvailable: guiCapabilities.groundingAvailable,
			} : undefined,
		});
	}

	if (options.memoryProvider) {
		capabilities.push({
			id: "memory",
			label: "Memory",
			description: "Persistent searchable memory and recall tools are enabled for this runtime.",
			source: "core",
			tags: ["memory", "retrieval"],
		});
	}

	if (options.getChannel) {
		capabilities.push({
			id: "messaging",
			label: "Messaging",
			description: "Outbound channel messaging tools are available for cross-channel delivery flows.",
			source: "core",
			tags: ["channels", "message_send"],
		});
	}

	if (options.scheduleService || options.gatewayUrl) {
		capabilities.push({
			id: "automation",
			label: "Automation",
			description: "Scheduled job creation, execution, and delivery tooling are available.",
			source: "core",
			tags: ["schedule", "automation"],
		});
	}

	if (options.gatewayUrl) {
		capabilities.push({
			id: "gateway",
			label: "Gateway Bridge",
			description: "Gateway session, status, and orchestration tools are available in this runtime.",
			source: "core",
			tags: ["gateway", "sessions"],
		});
	}

	if (options.gatewayUrl || options.spawnSubagent || options.manageSubagents) {
		capabilities.push({
			id: "agents",
			label: "Agent Orchestration",
			description: "Subagent spawning, inspection, and cross-session coordination are available.",
			source: "core",
			tags: ["agents", "subagents"],
		});
	}

	return capabilities;
}

function buildConfiguredPlatformCapabilities(
	options: ConfiguredRuntimeToolingOptions & {
		guiRuntime: ReturnType<typeof createGuiRuntime>;
	},
): RuntimePlatformCapability[] {
	return normalizeRuntimePlatformCapabilities([
		...buildCorePlatformCapabilities(options),
		...resolveConfiguredPlatformCapabilitySource(options.platformCapabilities),
	]);
}

async function resolveConfiguredRuntimeContext(
	options: ConfiguredRuntimeToolingOptions,
): Promise<{
	guiRuntime: ReturnType<typeof createGuiRuntime>;
	platformCapabilities: RuntimePlatformCapability[];
}> {
	const guiRuntime = await createConfiguredGuiRuntime(options.config, {
		explicitModel: options.explicitModel,
		agentDir: options.agentDir,
	});
	return {
		guiRuntime,
		platformCapabilities: buildConfiguredPlatformCapabilities({
			...options,
			guiRuntime,
		}),
	};
}

export async function resolveConfiguredPlatformCapabilities(
	options: ConfiguredRuntimeToolingOptions,
): Promise<RuntimePlatformCapability[]> {
	const context = await resolveConfiguredRuntimeContext(options);
	return context.platformCapabilities;
}

export async function createConfiguredRuntimeToolset(
	options: ConfiguredRuntimeToolingOptions,
) {
	const { guiRuntime } = await resolveConfiguredRuntimeContext(options);
	return createRuntimeToolset({
		...options,
		guiRuntime,
		platformCapabilities: () =>
			buildConfiguredPlatformCapabilities({
				...options,
				guiRuntime,
			}),
	});
}

export async function listConfiguredRuntimeToolCatalog(
	options: ConfiguredRuntimeToolingOptions,
): Promise<RuntimeToolCatalog> {
	const { guiRuntime, platformCapabilities } = await resolveConfiguredRuntimeContext(options);
	return listRuntimeToolCatalog({
		...options,
		guiRuntime,
		platformCapabilities,
	});
}
