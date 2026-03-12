import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { ConfigManager, resolveUnderstudyHomeDir } from "@understudy/core";
import type { BrowserManagerOptions } from "@understudy/tools";
import {
	DEFAULT_BROWSER_EXTENSION_CDP_URL,
	type BrowserConnectionMode,
	type UnderstudyConfig,
} from "@understudy/types";
import { installBrowserExtensionIntoConfig } from "./browser-extension-setup.js";

export interface BrowserExtensionCommandSpec {
	action: "install";
	target?: string;
}

interface BrowserExtensionConfigCommandOptions {
	config?: string;
}

function toNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

const LEGACY_BROWSER_EXTENSION_TARGETS = new Set([
	"download",
	"understudy",
	"stable",
	"home",
]);

function hasManifest(dir: string): boolean {
	return existsSync(join(dir, "manifest.json"));
}

export function resolveBundledExtensionRootDir(
	here = dirname(fileURLToPath(import.meta.url)),
): string {
	let current = here;
	for (;;) {
		const candidate = join(current, "assets", "chrome-extension");
		if (hasManifest(candidate)) {
			return candidate;
		}
		const parent = dirname(current);
		if (parent === current) {
			break;
		}
		current = parent;
	}
	return join(here, "../../../../assets/chrome-extension");
}

export function resolveInstalledExtensionRootDir(): string {
	return join(resolveUnderstudyHomeDir(), "browser", "chrome-extension");
}

export function resolveDownloadsExtensionRootDir(homeDir = homedir()): string {
	return join(homeDir, "Downloads", "Understudy Chrome Extension");
}

export function resolveConfiguredBrowserConnectionMode(config?: UnderstudyConfig): BrowserConnectionMode {
	const normalized = toNonEmptyString(config?.browser?.connectionMode)?.toLowerCase();
	if (normalized === "managed" || normalized === "extension" || normalized === "auto") {
		return normalized;
	}
	return "managed";
}

export function resolveConfiguredBrowserCdpUrl(config?: UnderstudyConfig): string {
	return toNonEmptyString(config?.browser?.cdpUrl) ?? DEFAULT_BROWSER_EXTENSION_CDP_URL;
}

export function resolveConfiguredBrowserOptions(config?: UnderstudyConfig): BrowserManagerOptions {
	return {
		browserConnectionMode: resolveConfiguredBrowserConnectionMode(config),
		browserCdpUrl: resolveConfiguredBrowserCdpUrl(config),
	};
}

export function resolveBrowserExtensionInstallDir(params?: {
	config?: UnderstudyConfig;
	target?: string;
	homeDir?: string;
}): string {
	const requestedTarget = toNonEmptyString(params?.target);
	if (requestedTarget) {
		const normalized = requestedTarget.toLowerCase();
		if (normalized === "downloads") {
			return resolveDownloadsExtensionRootDir(params?.homeDir);
		}
		if (normalized === "managed") {
			return resolveInstalledExtensionRootDir();
		}
		if (LEGACY_BROWSER_EXTENSION_TARGETS.has(normalized)) {
			throw new Error(
				`Unsupported browser extension target "${requestedTarget}". Use "downloads", "managed", or a custom path.`,
			);
		}
		return requestedTarget;
	}

	return toNonEmptyString(params?.config?.browser?.extension?.installDir)
		?? resolveDownloadsExtensionRootDir(params?.homeDir);
}

export function buildBrowserExtensionConfigPatch(params: {
	installDir: string;
	browserConnectionMode?: BrowserConnectionMode;
	browserCdpUrl?: string;
}): Partial<UnderstudyConfig> {
	return {
		browser: {
			connectionMode: params.browserConnectionMode ?? "extension",
			cdpUrl: params.browserCdpUrl ?? DEFAULT_BROWSER_EXTENSION_CDP_URL,
			extension: {
				installDir: params.installDir,
			},
		},
	};
}

export function mergeBrowserExtensionConfig(
	base: UnderstudyConfig,
	patch: Partial<UnderstudyConfig>,
): UnderstudyConfig {
	if (!patch.browser) {
		return base;
	}
	const nextExtension =
		base.browser?.extension || patch.browser.extension
			? {
				...base.browser?.extension,
				...patch.browser.extension,
			}
			: undefined;
	return {
		...base,
		browser: {
			...base.browser,
			...patch.browser,
			extension: nextExtension,
		},
		gateway: base.gateway
			? {
				...base.gateway,
				auth: base.gateway.auth
					? { ...base.gateway.auth }
					: undefined,
			}
			: base.gateway,
	};
}

export function parseBrowserExtensionSlashCommand(text: string): BrowserExtensionCommandSpec | undefined {
	const match = text.trim().match(/^\/browser-extension(?:\s+(.+?))?\s*$/i);
	if (!match) {
		return undefined;
	}
	const target = toNonEmptyString(match[1]);
	const normalizedTarget = target?.toLowerCase();
	if (
		normalizedTarget === "install" ||
		normalizedTarget?.startsWith("install ") ||
		normalizedTarget === "path" ||
		normalizedTarget === "config" ||
		normalizedTarget?.startsWith("path ") ||
		normalizedTarget?.startsWith("config ")
	) {
		return undefined;
	}
	return {
		action: "install",
		target,
	};
}

export async function installChromeExtension(opts?: {
	sourceDir?: string;
	installDir?: string;
}): Promise<{ path: string }> {
	const sourceDir = opts?.sourceDir ?? resolveBundledExtensionRootDir();
	if (!hasManifest(sourceDir)) {
		throw new Error("Bundled Understudy browser extension is missing.");
	}
	const installDir = opts?.installDir ?? resolveInstalledExtensionRootDir();
	await mkdir(dirname(installDir), { recursive: true });
	await rm(installDir, { recursive: true, force: true });
	await cp(sourceDir, installDir, { recursive: true });
	if (!hasManifest(installDir)) {
		throw new Error("Browser extension install failed: manifest.json missing after copy.");
	}
	return { path: installDir };
}

export function describeChromeExtensionInstallNextSteps(params: {
	path: string;
	relayPort?: number;
	gatewayToken?: string;
}): string {
	const relayPort = params.relayPort ?? 23336;
	const gatewayToken = params.gatewayToken?.trim();
	return [
		`Installed the Understudy Chrome extension to: ${params.path}`,
		"",
		"Next:",
		"1. Open Chrome -> chrome://extensions",
		"2. Enable Developer mode",
		`3. Click Load unpacked -> select: ${params.path}`,
		"4. Open the extension options and set:",
		`   Relay port: ${relayPort}`,
		gatewayToken
			? `   Gateway token: ${gatewayToken}`
			: "   Gateway token: the same value as UNDERSTUDY_GATEWAY_TOKEN",
		"5. Pin the extension and click the Understudy toolbar button on the tab you want to hand over",
	].join("\n");
}

export function registerBrowserExtensionCommands(browserCommand: Command): void {
	const extensionCommand = browserCommand
		.command("extension")
		.description("Install and inspect the Chrome extension relay assets");

	extensionCommand
		.command("install")
		.description("Install the Understudy browser extension and save browser defaults")
		.argument("[targetOrPath]", "downloads | managed | /custom/path")
		.option("--config <path>", "Config file path")
		.action(async (targetOrPath: string | undefined, commandOpts: BrowserExtensionConfigCommandOptions) => {
			try {
				const configManager = await ConfigManager.load(commandOpts.config);
				const currentConfig = configManager.get();
				const result = await installBrowserExtensionIntoConfig({
					config: currentConfig,
					target: targetOrPath,
				});
				configManager.update({
					browser: result.config.browser,
					gateway: result.config.gateway,
				});
				configManager.save();
				console.log(result.installDir);
				console.error(
					describeChromeExtensionInstallNextSteps({
						path: result.installDir,
						gatewayToken: result.gatewayToken,
					}),
				);
				console.error(`Saved browser defaults to ${configManager.getPath()} (browser.connectionMode=extension).`);
			} catch (error) {
				console.error("Error:", error instanceof Error ? error.message : String(error));
				process.exitCode = 1;
			}
		});

	extensionCommand
		.command("path")
		.description("Print the configured browser extension path")
		.argument("[targetOrPath]", "downloads | managed | /custom/path")
		.option("--config <path>", "Config file path")
		.action(async (targetOrPath: string | undefined, commandOpts: BrowserExtensionConfigCommandOptions) => {
			try {
				const configManager = await ConfigManager.load(commandOpts.config);
				const installDir = resolveBrowserExtensionInstallDir({
					config: configManager.get(),
					target: targetOrPath,
				});
				console.log(installDir);
			} catch (error) {
				console.error("Error:", error instanceof Error ? error.message : String(error));
				process.exitCode = 1;
			}
		});
}
