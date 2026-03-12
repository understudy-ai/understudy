import {
	describeChromeExtensionInstallNextSteps,
	parseBrowserExtensionSlashCommand,
} from "./browser-extension.js";
import { ConfigManager } from "@understudy/core";
import type { UnderstudyConfig } from "@understudy/types";
import { installBrowserExtensionIntoConfig } from "./browser-extension-setup.js";
import type { BrowserExtensionRelayController } from "./browser-extension-relay-controller.js";

interface InteractiveEditorLike {
	onSubmit?: (text: string) => Promise<void> | void;
	setText?: (text: string) => void;
}

interface InteractiveModeLike {
	init?: () => Promise<void>;
	defaultEditor?: InteractiveEditorLike;
	showStatus?: (text: string) => void;
	showError?: (text: string) => void;
}

function syncBrowserConfig(target: UnderstudyConfig | undefined, source: UnderstudyConfig): void {
	if (!target) {
		return;
	}
	if (source.browser) {
		target.browser = {
			...source.browser,
			extension: source.browser.extension
				? { ...source.browser.extension }
				: undefined,
		};
	}
	if (source.gateway) {
		target.gateway = {
			...source.gateway,
			auth: source.gateway.auth
				? { ...source.gateway.auth }
				: undefined,
		};
	}
}

export async function installInteractiveBrowserExtensionSupport(params: {
	interactive: InteractiveModeLike;
	configManager?: ConfigManager;
	configPath?: string;
	config?: UnderstudyConfig;
	relayController?: BrowserExtensionRelayController;
}): Promise<void> {
	if (!params.interactive.defaultEditor?.onSubmit && typeof params.interactive.init === "function") {
		await params.interactive.init();
	}

	const editor = params.interactive.defaultEditor;
	if (!editor?.onSubmit) {
		return;
	}

	const originalOnSubmit = editor.onSubmit.bind(editor);
	editor.onSubmit = async (text: string) => {
		const command = parseBrowserExtensionSlashCommand(text);
		if (!command) {
			await originalOnSubmit(text);
			return;
		}

		editor.setText?.("");
		try {
			const configManager = params.configManager ?? await ConfigManager.load(params.configPath);
			const currentConfig = configManager.get();
			params.interactive.showStatus?.("Installing the Understudy browser extension and waiting for a tab handoff...");
			const result = await installBrowserExtensionIntoConfig({
				config: currentConfig,
				target: command.target,
				relayController: params.relayController,
				waitForConnection: true,
				waitTimeoutMs: 60_000,
			});
			const nextConfig = result.config;
			configManager.update({
				browser: nextConfig.browser,
				gateway: nextConfig.gateway,
			});
			configManager.save();
			syncBrowserConfig(params.config, nextConfig);
			params.interactive.showStatus?.([
				describeChromeExtensionInstallNextSteps({
					path: result.installDir,
					relayPort: 23336,
					gatewayToken: result.gatewayToken,
				}),
				"",
				result.connected
					? "Browser extension connected. Subsequent browser actions in this session can use your current Chrome tab immediately."
					: "Browser extension installed. If it has not connected yet, click the Understudy toolbar button on your Chrome tab and try again.",
			].join("\n"));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			params.interactive.showError?.(`Browser extension install failed: ${message}`);
		}
	};
}
