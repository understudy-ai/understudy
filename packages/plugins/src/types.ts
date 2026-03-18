import type { Command } from "commander";
import type { ChannelFactory } from "@understudy/channels";
import type { RuntimeToolFactory } from "@understudy/tools";
import type { UnderstudyConfig } from "@understudy/types";

export type UnderstudyPluginGatewayMethodHandler = (
	params?: Record<string, unknown>,
) => Promise<unknown> | unknown;

export type UnderstudyPluginCliRegistrar = (
	program: Command,
) => Promise<void> | void;

export interface UnderstudyPluginLogger {
	info: (message: string) => void;
	warn: (message: string) => void;
	error: (message: string) => void;
	debug?: (message: string) => void;
}

export interface UnderstudyPluginDiagnostic {
	level: "info" | "warn" | "error";
	message: string;
	code?: string;
	details?: Record<string, unknown>;
	pluginId?: string;
	source?: string;
}

export interface UnderstudyPluginConfigUiHint {
	label?: string;
	help?: string;
	tags?: string[];
	advanced?: boolean;
	sensitive?: boolean;
	placeholder?: string;
}

export type UnderstudyPluginConfigValidation =
	| { ok: true; value?: unknown }
	| { ok: false; errors: string[] };

export interface UnderstudyPluginConfigSchema {
	safeParse?: (value: unknown) => {
		success: boolean;
		data?: unknown;
		error?: {
			issues?: Array<{ path: Array<string | number>; message: string }>;
		};
	};
	parse?: (value: unknown) => unknown;
	validate?: (value: unknown) => UnderstudyPluginConfigValidation;
	uiHints?: Record<string, UnderstudyPluginConfigUiHint>;
	jsonSchema?: Record<string, unknown>;
}

export type UnderstudyPluginHookName =
	| "gateway_start"
	| "gateway_stop"
	| "session_create"
	| "before_session_prompt"
	| "after_session_prompt";

export interface UnderstudyPluginHookEvent {
	name: UnderstudyPluginHookName;
	config?: UnderstudyConfig;
	gatewayUrl?: string;
	sessionId?: string;
	sessionKey?: string;
	channelId?: string;
	senderId?: string;
	threadId?: string;
	workspaceDir?: string;
	runId?: string;
	prompt?: string;
	response?: string;
	error?: string;
	meta?: Record<string, unknown>;
	details?: Record<string, unknown>;
}

export type UnderstudyPluginHookHandler = (
	event: UnderstudyPluginHookEvent,
) => Promise<void> | void;

export interface UnderstudyPluginHookRegistration {
	pluginId: string;
	source: string;
	hookName: UnderstudyPluginHookName;
	handler: UnderstudyPluginHookHandler;
}

export interface UnderstudyPluginServiceContext {
	config: UnderstudyConfig;
	gatewayUrl?: string;
	cwd?: string;
	stateDir?: string;
	logger: UnderstudyPluginLogger;
}

export interface UnderstudyPluginService {
	id: string;
	start: (context: UnderstudyPluginServiceContext) => Promise<void> | void;
	stop?: (context: UnderstudyPluginServiceContext) => Promise<void> | void;
}

export interface UnderstudyPluginServiceRegistration {
	pluginId: string;
	source: string;
	service: UnderstudyPluginService;
}

export interface UnderstudyPluginPlatformCapability {
	id: string;
	label: string;
	description: string;
	source?: "plugin";
	tags?: string[];
	metadata?: Record<string, unknown>;
	toolFactories?: RuntimeToolFactory[];
}

export interface UnderstudyPluginPlatformCapabilityRegistration {
	pluginId: string;
	source: string;
	capability: UnderstudyPluginPlatformCapability;
}

export interface UnderstudyPluginConfigSchemaRegistration {
	pluginId: string;
	source: string;
	schema: UnderstudyPluginConfigSchema;
}

export interface UnderstudyPluginApi {
	registerTool(factory: RuntimeToolFactory): void;
	registerGatewayMethod(
		method: string,
		handler: UnderstudyPluginGatewayMethodHandler,
	): void;
	registerChannelFactory(channelId: string, factory: ChannelFactory): void;
	registerCli(registrar: UnderstudyPluginCliRegistrar): void;
	registerHook(name: UnderstudyPluginHookName, handler: UnderstudyPluginHookHandler): void;
	registerService(service: UnderstudyPluginService): void;
	registerPlatformCapability(capability: UnderstudyPluginPlatformCapability): void;
	registerConfigSchema(schema: UnderstudyPluginConfigSchema): void;
	registerDiagnostic(diagnostic: UnderstudyPluginDiagnostic): void;
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
