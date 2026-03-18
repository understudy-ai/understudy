import { registerChannelFactory } from "@understudy/channels";
import type { RuntimeToolFactory } from "@understudy/tools";
import type {
	UnderstudyPluginConfigSchema,
	UnderstudyPluginConfigSchemaRegistration,
	UnderstudyPluginDiagnostic,
	UnderstudyPluginHookName,
	UnderstudyPluginHookRegistration,
	LoadedUnderstudyPlugin,
	UnderstudyPluginApi,
	UnderstudyPluginCliRegistrar,
	UnderstudyPluginGatewayMethodHandler,
	UnderstudyPluginModule,
	UnderstudyPluginPlatformCapability,
	UnderstudyPluginPlatformCapabilityRegistration,
	UnderstudyPluginService,
	UnderstudyPluginServiceRegistration,
} from "./types.js";

export class UnderstudyPluginRegistry {
	private readonly loadedPlugins: LoadedUnderstudyPlugin[] = [];
	private readonly toolFactories: RuntimeToolFactory[] = [];
	private readonly gatewayMethods = new Map<string, UnderstudyPluginGatewayMethodHandler>();
	private readonly cliRegistrars: UnderstudyPluginCliRegistrar[] = [];
	private readonly hookRegistrations: UnderstudyPluginHookRegistration[] = [];
	private readonly serviceRegistrations: UnderstudyPluginServiceRegistration[] = [];
	private readonly platformCapabilityRegistrations: UnderstudyPluginPlatformCapabilityRegistration[] = [];
	private readonly configSchemaRegistrations: UnderstudyPluginConfigSchemaRegistration[] = [];
	private readonly diagnostics: UnderstudyPluginDiagnostic[] = [];

	async register(params: {
		source: string;
		module: UnderstudyPluginModule;
	}): Promise<void> {
		const pluginId = params.module.id?.trim() || params.source;
		const api = this.createApi({
			pluginId,
			source: params.source,
		});
		await params.module.register(api);
		this.loadedPlugins.push({
			id: pluginId,
			source: params.source,
			module: params.module,
		});
	}

	listPlugins(): LoadedUnderstudyPlugin[] {
		return this.loadedPlugins.slice();
	}

	getToolFactories(): RuntimeToolFactory[] {
		return this.toolFactories.slice();
	}

	getGatewayMethods(): Array<[string, UnderstudyPluginGatewayMethodHandler]> {
		return Array.from(this.gatewayMethods.entries());
	}

	getCliRegistrars(): UnderstudyPluginCliRegistrar[] {
		return this.cliRegistrars.slice();
	}

	getHooks(hookName?: UnderstudyPluginHookName): UnderstudyPluginHookRegistration[] {
		if (!hookName) {
			return this.hookRegistrations.slice();
		}
		return this.hookRegistrations.filter((entry) => entry.hookName === hookName);
	}

	getServices(): UnderstudyPluginServiceRegistration[] {
		return this.serviceRegistrations.slice();
	}

	getPlatformCapabilities(): UnderstudyPluginPlatformCapability[] {
		return this.platformCapabilityRegistrations.map((entry) => ({
			...entry.capability,
		}));
	}

	getConfigSchemas(): UnderstudyPluginConfigSchemaRegistration[] {
		return this.configSchemaRegistrations.slice();
	}

	getDiagnostics(): UnderstudyPluginDiagnostic[] {
		return this.diagnostics.slice();
	}

	private createApi(context: {
		pluginId: string;
		source: string;
	}): UnderstudyPluginApi {
		return {
			registerTool: (factory) => {
				this.toolFactories.push(factory);
			},
			registerGatewayMethod: (method, handler) => {
				const normalized = method.trim();
				if (!normalized) {
					throw new Error("Plugin gateway method name is required");
				}
				this.gatewayMethods.set(normalized, handler);
			},
			registerChannelFactory: (channelId, factory) => {
				const normalized = channelId.trim().toLowerCase();
				if (!normalized) {
					throw new Error("Plugin channel factory id is required");
				}
				registerChannelFactory(normalized, factory);
			},
			registerCli: (registrar) => {
				this.cliRegistrars.push(registrar);
			},
			registerHook: (name, handler) => {
				this.hookRegistrations.push({
					pluginId: context.pluginId,
					source: context.source,
					hookName: name,
					handler,
				});
			},
			registerService: (service) => {
				const normalized = this.normalizeService(service);
				this.serviceRegistrations.push({
					pluginId: context.pluginId,
					source: context.source,
					service: normalized,
				});
			},
			registerPlatformCapability: (capability) => {
				const normalized = this.normalizePlatformCapability(capability);
				this.platformCapabilityRegistrations.push({
					pluginId: context.pluginId,
					source: context.source,
					capability: normalized,
				});
				for (const factory of normalized.toolFactories ?? []) {
					this.toolFactories.push(factory);
				}
			},
			registerConfigSchema: (schema) => {
				this.configSchemaRegistrations.push({
					pluginId: context.pluginId,
					source: context.source,
					schema: this.normalizeConfigSchema(schema),
				});
			},
			registerDiagnostic: (diagnostic) => {
				this.diagnostics.push({
					...diagnostic,
					level: diagnostic.level,
					message: diagnostic.message,
					pluginId: context.pluginId,
					source: context.source,
				});
			},
		};
	}

	private normalizeService(service: UnderstudyPluginService): UnderstudyPluginService {
		const id = service.id?.trim();
		if (!id) {
			throw new Error("Plugin service id is required");
		}
		if (typeof service.start !== "function") {
			throw new Error(`Plugin service "${id}" must provide a start(context) function`);
		}
		return {
			...service,
			id,
		};
	}

	private normalizePlatformCapability(
		capability: UnderstudyPluginPlatformCapability,
	): UnderstudyPluginPlatformCapability {
		const id = capability.id?.trim().toLowerCase();
		if (!id) {
			throw new Error("Plugin platform capability id is required");
		}
		const label = capability.label?.trim() || id;
		const description = capability.description?.trim() || `Platform capability: ${label}`;
		return {
			...capability,
			id,
			label,
			description,
			source: "plugin",
			tags: Array.isArray(capability.tags)
				? capability.tags.map((tag: string) => tag.trim()).filter(Boolean)
				: undefined,
		};
	}

	private normalizeConfigSchema(schema: UnderstudyPluginConfigSchema): UnderstudyPluginConfigSchema {
		return {
			...schema,
			uiHints:
				schema.uiHints && typeof schema.uiHints === "object"
					? schema.uiHints
					: undefined,
			jsonSchema:
				schema.jsonSchema && typeof schema.jsonSchema === "object"
					? schema.jsonSchema
					: undefined,
		};
	}
}
