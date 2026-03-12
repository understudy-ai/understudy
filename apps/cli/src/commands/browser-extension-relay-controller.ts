import type { UnderstudyConfig } from "@understudy/types";
import { inspectAuthenticatedUnderstudyRelay } from "@understudy/tools";
import type { UnderstudyChromeExtensionRelayServer } from "../browser/extension-relay.js";
import { ensureUnderstudyChromeExtensionRelayServer } from "../browser/extension-relay.js";
import {
	resolveConfiguredBrowserCdpUrl,
	resolveConfiguredBrowserConnectionMode,
} from "./browser-extension.js";

export interface BrowserExtensionRelayWaitOptions {
	timeoutMs?: number;
	pollIntervalMs?: number;
	onTick?: (params: { elapsedMs: number; remainingMs: number }) => void;
}

export interface BrowserExtensionRelayController {
	ensureForConfig(config: UnderstudyConfig): Promise<UnderstudyChromeExtensionRelayServer | null>;
	current(): UnderstudyChromeExtensionRelayServer | null;
	waitForConnection(options?: BrowserExtensionRelayWaitOptions): Promise<boolean>;
	stop(): Promise<void>;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveGatewayToken(config: UnderstudyConfig): string | undefined {
	const envToken = process.env.UNDERSTUDY_GATEWAY_TOKEN?.trim();
	if (envToken) {
		return envToken;
	}
	const configuredToken = config.gateway?.auth?.token?.trim();
	return configuredToken && configuredToken.length > 0 ? configuredToken : undefined;
}

export function createBrowserExtensionRelayController(): BrowserExtensionRelayController {
	let relay: UnderstudyChromeExtensionRelayServer | null = null;
	let currentCdpUrl: string | null = null;
	let currentGatewayToken: string | undefined;

	return {
		async ensureForConfig(config) {
			const mode = resolveConfiguredBrowserConnectionMode(config);
			if (mode === "managed") {
				if (relay) {
					await relay.stop().catch(() => {});
					relay = null;
					currentCdpUrl = null;
					currentGatewayToken = undefined;
				}
				return null;
			}

			const cdpUrl = resolveConfiguredBrowserCdpUrl(config);
			const gatewayToken = resolveGatewayToken(config);
			if (relay && currentCdpUrl === cdpUrl) {
				currentGatewayToken = gatewayToken;
				return relay;
			}

			if (relay) {
				await relay.stop().catch(() => {});
				relay = null;
				currentCdpUrl = null;
				currentGatewayToken = undefined;
			}

			relay = await ensureUnderstudyChromeExtensionRelayServer({
				cdpUrl,
				gatewayToken,
			});
			currentCdpUrl = cdpUrl;
			currentGatewayToken = gatewayToken;
			return relay;
		},
		current() {
			return relay;
		},
		async waitForConnection(options = {}) {
			const activeRelay = relay;
			const baseUrl = activeRelay?.baseUrl;
			if (!activeRelay || !baseUrl) {
				return false;
			}
			const hasAttachedTab = async (): Promise<boolean> => {
				const status = await inspectAuthenticatedUnderstudyRelay({
					baseUrl,
					timeoutMs: Math.max(500, Math.min(2_000, options.pollIntervalMs ?? 1_000)),
					gatewayToken: currentGatewayToken,
				}).catch(() => null);
				return Boolean(status?.attachedTargets.length);
			};
			if (await hasAttachedTab()) {
				return true;
			}

			const timeoutMs = options.timeoutMs ?? 90_000;
			const pollIntervalMs = options.pollIntervalMs ?? 1_000;
			const startedAt = Date.now();
			for (;;) {
				const elapsedMs = Date.now() - startedAt;
				const remainingMs = timeoutMs - elapsedMs;
				if (remainingMs <= 0) {
					return false;
				}
				options.onTick?.({ elapsedMs, remainingMs });
				await sleep(Math.min(pollIntervalMs, remainingMs));
				if (await hasAttachedTab()) {
					return true;
				}
			}
		},
		async stop() {
			if (!relay) {
				return;
			}
			await relay.stop().catch(() => {});
			relay = null;
			currentCdpUrl = null;
			currentGatewayToken = undefined;
		},
	};
}
