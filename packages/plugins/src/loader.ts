import { pathToFileURL } from "node:url";
import { basename, dirname, isAbsolute, resolve as resolvePath } from "node:path";
import type { UnderstudyConfig } from "@understudy/types";
import { UnderstudyPluginRegistry } from "./registry.js";
import type { UnderstudyPluginModule } from "./types.js";

function resolvePluginSources(params: {
	config: UnderstudyConfig;
}): string[] {
	if (params.config.plugins?.enabled === false) {
		return [];
	}
	return (params.config.plugins?.modules ?? []).map((entry) => entry.trim()).filter(Boolean);
}

function resolveImportTarget(source: string, baseDir: string): string {
	if (source.startsWith(".") || source.startsWith("/")) {
		return pathToFileURL(
			isAbsolute(source) ? source : resolvePath(baseDir, source),
		).href;
	}
	return source;
}

function normalizeImportedPlugin(params: {
	source: string;
	imported: Record<string, unknown>;
}): UnderstudyPluginModule {
	if (typeof params.imported.register === "function") {
		return {
			id: typeof params.imported.id === "string" ? params.imported.id : basename(params.source),
			register: params.imported.register as UnderstudyPluginModule["register"],
		};
	}
	throw new Error(`Plugin module "${params.source}" must export a named register(api) function.`);
}

export async function loadUnderstudyPlugins(params: {
	config: UnderstudyConfig;
	configPath?: string;
	cwd?: string;
	registry?: UnderstudyPluginRegistry;
}): Promise<UnderstudyPluginRegistry> {
	const registry = params.registry ?? new UnderstudyPluginRegistry();
	const sources = resolvePluginSources({
		config: params.config,
	});
	if (sources.length === 0) {
		return registry;
	}
	const baseDir = params.configPath ? dirname(params.configPath) : params.cwd ?? process.cwd();
	for (const source of sources) {
		const imported = await import(resolveImportTarget(source, baseDir)) as Record<string, unknown>;
		const plugin = normalizeImportedPlugin({
			source,
			imported,
		});
		await registry.register({
			source,
			module: plugin,
		});
	}
	return registry;
}
