import type { Command } from "commander";
import type { ChannelFactory } from "@understudy/channels";
import type { RuntimeToolFactory } from "@understudy/tools";

export type UnderstudyPluginGatewayMethodHandler = (
	params?: Record<string, unknown>,
) => Promise<unknown> | unknown;

export type UnderstudyPluginCliRegistrar = (
	program: Command,
) => Promise<void> | void;

export interface UnderstudyPluginApi {
	registerTool(factory: RuntimeToolFactory): void;
	registerGatewayMethod(
		method: string,
		handler: UnderstudyPluginGatewayMethodHandler,
	): void;
	registerChannelFactory(channelId: string, factory: ChannelFactory): void;
	registerCli(registrar: UnderstudyPluginCliRegistrar): void;
}

export interface UnderstudyPluginModule {
	id?: string;
	register(api: UnderstudyPluginApi): Promise<void> | void;
}

export interface LoadedUnderstudyPlugin {
	id: string;
	source: string;
	module: UnderstudyPluginModule;
}
