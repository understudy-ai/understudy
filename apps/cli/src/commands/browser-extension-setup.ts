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

function resolveRelayPortFromUrl(value: string | undefined): number {
	if (!value) {
		return 23336;
	}
	try {
		const parsed = new URL(value);
		const port = Number.parseInt(parsed.port || "", 10);
		if (Number.isFinite(port) && port > 0 && port <= 65535) {
			return port;
		}
	} catch {
		// Fall back to the default relay port.
	}
	return 23336;
}

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
	const browserCdpUrl = resolveConfiguredBrowserCdpUrl(params.config);
	const patch = buildBrowserExtensionConfigPatch({
		installDir,
		browserCdpUrl,
	});
	const nextConfig = mergeBrowserExtensionConfig(params.config, patch);
	const { token: gatewayToken, source: tokenSource } = ensureGatewayBrowserTokenInConfig(nextConfig);
	const installed = await installChromeExtension({
		installDir,
		seedConfig: {
			relayPort: resolveRelayPortFromUrl(browserCdpUrl),
			gatewayToken,
		},
	});
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
