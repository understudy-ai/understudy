import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { UnderstudyConfig } from "@understudy/types";
import type { ConfigManager } from "@understudy/core";
import {
	loadUnderstudyPlugins,
	type UnderstudyPluginHookName,
	type UnderstudyPluginLogger,
} from "@understudy/plugins";

type GatewayPluginRegistry = Pick<
	Awaited<ReturnType<typeof loadUnderstudyPlugins>>,
	"getDiagnostics" | "getHooks" | "getServices"
>;

export interface GatewayPluginRuntime {
	logger: UnderstudyPluginLogger;
	logDiagnostics: () => void;
	runHook: (
		name: UnderstudyPluginHookName,
		payload?: Record<string, unknown>,
	) => Promise<void>;
	onGatewayStart: (details: Record<string, unknown>) => Promise<void>;
	onGatewayStop: (details: Record<string, unknown>) => Promise<void>;
}

export function createGatewayPluginRuntime(params: {
	configManager: Pick<ConfigManager, "get">;
	pluginRegistry: GatewayPluginRegistry;
	gatewayUrl: string;
	stateRoot: string;
	cwd?: string;
	logger?: UnderstudyPluginLogger;
}): GatewayPluginRuntime {
	const logger: UnderstudyPluginLogger = params.logger ?? {
		info: (message: string) => console.log(`[plugins] ${message}`),
		warn: (message: string) => console.warn(`[plugins] ${message}`),
		error: (message: string) => console.error(`[plugins] ${message}`),
		debug: (message: string) => console.debug?.(`[plugins] ${message}`),
	};
	const serviceStates: Array<{
		pluginId: string;
		serviceId: string;
		context: {
			config: UnderstudyConfig;
			gatewayUrl?: string;
			cwd?: string;
			stateDir?: string;
			logger: UnderstudyPluginLogger;
		};
		stop?: (context: {
			config: UnderstudyConfig;
			gatewayUrl?: string;
			cwd?: string;
			stateDir?: string;
			logger: UnderstudyPluginLogger;
		}) => Promise<void> | void;
	}> = [];

	const logDiagnostics = (): void => {
		for (const diagnostic of params.pluginRegistry.getDiagnostics()) {
			const prefix = diagnostic.pluginId ? `[plugins:${diagnostic.pluginId}]` : "[plugins]";
			const message = `${prefix} ${diagnostic.message}`;
			if (diagnostic.level === "error") {
				logger.error(message);
				continue;
			}
			if (diagnostic.level === "warn") {
				logger.warn(message);
				continue;
			}
			logger.info(message);
		}
	};

	const runHook = async (
		name: UnderstudyPluginHookName,
		payload: Record<string, unknown> = {},
	): Promise<void> => {
		for (const registration of params.pluginRegistry.getHooks(name)) {
			try {
				await registration.handler({
					name,
					config: params.configManager.get(),
					gatewayUrl: params.gatewayUrl,
					...payload,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.warn(`hook failed (${registration.pluginId}/${name}): ${message}`);
			}
		}
	};

	const startServices = async (): Promise<void> => {
		for (const registration of params.pluginRegistry.getServices()) {
			const stateDir = join(params.stateRoot, registration.pluginId, registration.service.id);
			await mkdir(stateDir, { recursive: true });
			const context = {
				config: params.configManager.get(),
				gatewayUrl: params.gatewayUrl,
				cwd: params.cwd,
				stateDir,
				logger,
			};
			try {
				await registration.service.start(context);
				serviceStates.push({
					pluginId: registration.pluginId,
					serviceId: registration.service.id,
					context,
					stop: registration.service.stop,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error(`service failed (${registration.pluginId}/${registration.service.id}): ${message}`);
			}
		}
	};

	const stopServices = async (): Promise<void> => {
		for (const registration of serviceStates.slice().reverse()) {
			if (typeof registration.stop !== "function") {
				continue;
			}
			try {
				await registration.stop(registration.context);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.warn(`service stop failed (${registration.pluginId}/${registration.serviceId}): ${message}`);
			}
		}
		serviceStates.length = 0;
	};

	return {
		logger,
		logDiagnostics,
		runHook,
		onGatewayStart: async (details) => {
			await startServices();
			await runHook("gateway_start", { details });
		},
		onGatewayStop: async (details) => {
			await runHook("gateway_stop", { details });
			await stopServices();
		},
	};
}
