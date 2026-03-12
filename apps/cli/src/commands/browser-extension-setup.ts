import type { UnderstudyConfig } from "@understudy/types";
import {
	buildBrowserExtensionConfigPatch,
	installChromeExtension,
	mergeBrowserExtensionConfig,
	resolveBrowserExtensionInstallDir,
	resolveConfiguredBrowserCdpUrl,
} from "./browser-extension.js";
import { ensureGatewayBrowserTokenInConfig } from "./gateway-browser-auth.js";
import type { BrowserExtensionRelayController } from "./browser-extension-relay-controller.js";

export interface InstallBrowserExtensionIntoConfigParams {
	config: UnderstudyConfig;
	target?: string;
	relayController?: BrowserExtensionRelayController;
	waitForConnection?: boolean;
	waitTimeoutMs?: number;
	onWaitTick?: (params: { elapsedMs: number; remainingMs: number }) => void;
}

export interface InstallBrowserExtensionIntoConfigResult {
	config: UnderstudyConfig;
	installDir: string;
	gatewayToken: string;
	tokenSource: "config" | "env" | "generated";
	connected: boolean;
	relayBaseUrl?: string;
}

export async function installBrowserExtensionIntoConfig(
	params: InstallBrowserExtensionIntoConfigParams,
): Promise<InstallBrowserExtensionIntoConfigResult> {
	const installDir = resolveBrowserExtensionInstallDir({
		config: params.config,
		target: params.target,
	});
	const installed = await installChromeExtension({ installDir });
	const patch = buildBrowserExtensionConfigPatch({
		installDir: installed.path,
		browserCdpUrl: resolveConfiguredBrowserCdpUrl(params.config),
	});
	const nextConfig = mergeBrowserExtensionConfig(params.config, patch);
	const { token: gatewayToken, source: tokenSource } = ensureGatewayBrowserTokenInConfig(nextConfig);
	const relay = await params.relayController?.ensureForConfig(nextConfig);
	const connected = params.waitForConnection
		? await params.relayController?.waitForConnection({
			timeoutMs: params.waitTimeoutMs,
			onTick: params.onWaitTick,
		}) ?? false
		: relay?.extensionConnected() ?? false;
	return {
		config: nextConfig,
		installDir: installed.path,
		gatewayToken,
		tokenSource,
		connected,
		relayBaseUrl: relay?.baseUrl,
	};
}
