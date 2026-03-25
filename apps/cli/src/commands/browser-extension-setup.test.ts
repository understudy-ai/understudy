import { beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserExtensionIntoConfig } from "./browser-extension-setup.js";

const mocks = vi.hoisted(() => ({
	resolveBrowserExtensionInstallDir: vi.fn(),
	installChromeExtension: vi.fn(),
	buildBrowserExtensionConfigPatch: vi.fn(),
	mergeBrowserExtensionConfig: vi.fn(),
	resolveConfiguredBrowserCdpUrl: vi.fn(),
	ensureGatewayBrowserTokenInConfig: vi.fn(),
}));

vi.mock("./browser-extension.js", () => ({
	resolveBrowserExtensionInstallDir: mocks.resolveBrowserExtensionInstallDir,
	installChromeExtension: mocks.installChromeExtension,
	buildBrowserExtensionConfigPatch: mocks.buildBrowserExtensionConfigPatch,
	mergeBrowserExtensionConfig: mocks.mergeBrowserExtensionConfig,
	resolveConfiguredBrowserCdpUrl: mocks.resolveConfiguredBrowserCdpUrl,
}));

vi.mock("./gateway-browser-auth.js", () => ({
	ensureGatewayBrowserTokenInConfig: mocks.ensureGatewayBrowserTokenInConfig,
}));

describe("installBrowserExtensionIntoConfig", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.resolveBrowserExtensionInstallDir.mockReturnValue("/Users/test/Downloads/Understudy Chrome Extension");
		mocks.installChromeExtension.mockResolvedValue({
			path: "/Users/test/Downloads/Understudy Chrome Extension",
		});
		mocks.resolveConfiguredBrowserCdpUrl.mockReturnValue("http://127.0.0.1:23336");
		mocks.buildBrowserExtensionConfigPatch.mockReturnValue({
			browser: {
				connectionMode: "extension",
				cdpUrl: "http://127.0.0.1:23336",
				extension: {
					installDir: "/Users/test/Downloads/Understudy Chrome Extension",
				},
			},
		});
		mocks.mergeBrowserExtensionConfig.mockImplementation((base, patch) => ({
			...base,
			browser: {
				...base.browser,
				...patch.browser,
				extension: {
					...base.browser?.extension,
					...patch.browser?.extension,
				},
			},
			gateway: {
				...base.gateway,
				auth: {
					mode: "none",
					token: "test-relay-token",
				},
			},
		}));
		mocks.ensureGatewayBrowserTokenInConfig.mockImplementation((config) => {
			config.gateway = Object.assign({}, config.gateway, {
				auth: {
					mode: "none",
					token: "test-relay-token",
				},
			});
			return {
				token: "test-relay-token",
				source: "generated",
			};
		});
	});

	it("installs, updates config, and waits on the relay when requested", async () => {
		const relayController = {
			ensureForConfig: vi.fn().mockResolvedValue({
				baseUrl: "http://127.0.0.1:23336",
				extensionConnected: () => false,
			}),
			waitForConnection: vi.fn().mockResolvedValue(true),
		};

		const result = await installBrowserExtensionIntoConfig({
			config: { browser: {} } as any,
			target: "/tmp/custom-extension",
			relayController: relayController as any,
			waitForConnection: true,
			waitTimeoutMs: 12_000,
		});

		expect(mocks.resolveBrowserExtensionInstallDir).toHaveBeenCalledWith({
			config: { browser: {} },
			target: "/tmp/custom-extension",
		});
		expect(mocks.installChromeExtension).toHaveBeenCalledWith({
			installDir: "/Users/test/Downloads/Understudy Chrome Extension",
			seedConfig: {
				relayPort: 23336,
				gatewayToken: "test-relay-token",
			},
		});
		expect(relayController.ensureForConfig).toHaveBeenCalledWith(expect.objectContaining({
			browser: expect.objectContaining({
				connectionMode: "extension",
			}),
		}));
		expect(relayController.waitForConnection).toHaveBeenCalledWith({
			timeoutMs: 12_000,
			onTick: undefined,
		});
		expect(result.installDir).toBe("/Users/test/Downloads/Understudy Chrome Extension");
		expect(result.gatewayToken).toBe("test-relay-token");
		expect(result.tokenSource).toBe("generated");
		expect(result.connected).toBe(true);
		expect(result.relayBaseUrl).toBe("http://127.0.0.1:23336");
	});

	it("skips waiting when immediate connection is not requested", async () => {
		const relayController = {
			ensureForConfig: vi.fn().mockResolvedValue({
				baseUrl: "http://127.0.0.1:23336",
				extensionConnected: () => true,
			}),
			waitForConnection: vi.fn(),
		};

		const result = await installBrowserExtensionIntoConfig({
			config: { browser: {} } as any,
			relayController: relayController as any,
		});

		expect(mocks.installChromeExtension).toHaveBeenCalledWith({
			installDir: "/Users/test/Downloads/Understudy Chrome Extension",
			seedConfig: {
				relayPort: 23336,
				gatewayToken: "test-relay-token",
			},
		});
		expect(relayController.waitForConnection).not.toHaveBeenCalled();
		expect(result.connected).toBe(true);
	});
});
