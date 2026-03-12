/**
 * ConfigReloader: watches config file for changes and hot-reloads non-destructive settings.
 */

import { watch, type FSWatcher } from "node:fs";
import { ConfigManager, validateUnderstudyConfig } from "@understudy/core";
import type { UnderstudyConfig } from "@understudy/types";

export interface ConfigReloadHandler {
	(newConfig: UnderstudyConfig, oldConfig: UnderstudyConfig): void;
}

export class ConfigReloader {
	private watcher: FSWatcher | null = null;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private configPath: string;
	private debounceMs: number;
	private handler: ConfigReloadHandler;
	private currentConfig: UnderstudyConfig;

	constructor(options: {
		configPath: string;
		currentConfig: UnderstudyConfig;
		handler: ConfigReloadHandler;
		debounceMs?: number;
	}) {
		this.configPath = options.configPath;
		this.currentConfig = options.currentConfig;
		this.handler = options.handler;
		this.debounceMs = options.debounceMs ?? 1000;
	}

	/** Start watching the config file */
	start(): void {
		if (this.watcher) return;
		if (this.configPath === ":memory:") return;

		try {
			this.watcher = watch(this.configPath, (_eventType) => {
				this.scheduleReload();
			});
			this.watcher.on("error", () => {
				// Ignore watch errors (file might be temporarily unavailable)
			});
		} catch {
			// Watch not supported or file doesn't exist — skip
		}
	}

	/** Stop watching */
	stop(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}
	}

	private scheduleReload(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			this.reload().catch((error) => {
				console.error("[config-reload] Error:", error instanceof Error ? error.message : String(error));
			});
		}, this.debounceMs);
	}

	private async reload(): Promise<void> {
		try {
			const manager = await ConfigManager.load(this.configPath);
			const newConfig = manager.get();
			// Validate before applying
			validateUnderstudyConfig(newConfig);

			const oldConfig = this.currentConfig;
			this.currentConfig = newConfig;
			this.handler(newConfig, oldConfig);
			console.log("[config-reload] Configuration reloaded successfully.");
		} catch (error) {
			console.error(
				"[config-reload] Validation failed, keeping current config:",
				error instanceof Error ? error.message : String(error),
			);
		}
	}
}
