import { registerChannelFactory } from "@understudy/channels";
import type { RuntimeToolFactory } from "@understudy/tools";
import type {
	LoadedUnderstudyPlugin,
	UnderstudyPluginApi,
	UnderstudyPluginCliRegistrar,
	UnderstudyPluginGatewayMethodHandler,
	UnderstudyPluginModule,
} from "./types.js";

export class UnderstudyPluginRegistry {
	private readonly loadedPlugins: LoadedUnderstudyPlugin[] = [];
	private readonly toolFactories: RuntimeToolFactory[] = [];
	private readonly gatewayMethods = new Map<string, UnderstudyPluginGatewayMethodHandler>();
	private readonly cliRegistrars: UnderstudyPluginCliRegistrar[] = [];

	async register(params: {
		source: string;
		module: UnderstudyPluginModule;
	}): Promise<void> {
		const pluginId = params.module.id?.trim() || params.source;
		const api = this.createApi();
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

	private createApi(): UnderstudyPluginApi {
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
		};
	}
}
