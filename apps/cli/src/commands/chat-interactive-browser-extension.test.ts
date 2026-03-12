import { beforeEach, describe, expect, it, vi } from "vitest";
import { installInteractiveBrowserExtensionSupport } from "./chat-interactive-browser-extension.js";

const mocks = vi.hoisted(() => ({
	configLoad: vi.fn(),
	parseBrowserExtensionSlashCommand: vi.fn(),
	describeChromeExtensionInstallNextSteps: vi.fn(),
	installBrowserExtensionIntoConfig: vi.fn(),
}));

vi.mock("@understudy/core", () => ({
	ConfigManager: {
		load: mocks.configLoad,
	},
}));

vi.mock("./browser-extension.js", () => ({
	parseBrowserExtensionSlashCommand: mocks.parseBrowserExtensionSlashCommand,
	describeChromeExtensionInstallNextSteps: mocks.describeChromeExtensionInstallNextSteps,
}));

vi.mock("./browser-extension-setup.js", () => ({
	installBrowserExtensionIntoConfig: mocks.installBrowserExtensionIntoConfig,
}));

describe("installInteractiveBrowserExtensionSupport", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.describeChromeExtensionInstallNextSteps.mockReturnValue("Install instructions");
	});

	it("installs the browser extension, saves config, and reports immediate readiness", async () => {
		mocks.parseBrowserExtensionSlashCommand.mockReturnValue({ action: "install" });
		mocks.installBrowserExtensionIntoConfig.mockResolvedValue({
			config: {
				browser: {
					connectionMode: "extension",
					cdpUrl: "http://127.0.0.1:23336",
					extension: {
						installDir: "/Users/test/Downloads/Understudy Chrome Extension",
					},
				},
				gateway: {
					auth: {
						mode: "none",
						token: "test-relay-token",
					},
				},
			},
			installDir: "/Users/test/Downloads/Understudy Chrome Extension",
			gatewayToken: "test-relay-token",
			tokenSource: "generated",
			connected: true,
		});
		const update = vi.fn();
		const save = vi.fn();
		mocks.configLoad.mockResolvedValue({
			get: () => ({ browser: {} }),
			update,
			save,
			getPath: () => "/tmp/config.json5",
		});

		const relayController = {
			ensureForConfig: vi.fn(),
			current: vi.fn(),
			waitForConnection: vi.fn(),
			stop: vi.fn(),
		};
		const originalSubmit = vi.fn().mockResolvedValue(undefined);
		const showStatus = vi.fn();
		const showError = vi.fn();
		const setText = vi.fn();
		const config = { browser: {} } as any;
		const interactive = {
			init: vi.fn().mockResolvedValue(undefined),
			defaultEditor: {
				onSubmit: originalSubmit,
				setText,
			},
			showStatus,
			showError,
		};

		await installInteractiveBrowserExtensionSupport({
			interactive,
			configPath: "/tmp/config.json",
			config,
			relayController: relayController as any,
		});

		await interactive.defaultEditor.onSubmit?.("/browser-extension");

		expect(originalSubmit).not.toHaveBeenCalled();
		expect(setText).toHaveBeenCalledWith("");
		expect(mocks.installBrowserExtensionIntoConfig).toHaveBeenCalledWith({
			config: { browser: {} },
			target: undefined,
			relayController,
			waitForConnection: true,
			waitTimeoutMs: 60_000,
		});
		expect(update).toHaveBeenCalledWith({
			browser: {
				connectionMode: "extension",
				cdpUrl: "http://127.0.0.1:23336",
				extension: {
					installDir: "/Users/test/Downloads/Understudy Chrome Extension",
				},
			},
			gateway: {
				auth: {
					mode: "none",
					token: "test-relay-token",
				},
			},
		});
		expect(save).toHaveBeenCalledOnce();
		expect(config.browser).toEqual({
			connectionMode: "extension",
			cdpUrl: "http://127.0.0.1:23336",
			extension: {
				installDir: "/Users/test/Downloads/Understudy Chrome Extension",
			},
		});
		expect(config.gateway).toEqual({
			auth: {
				mode: "none",
				token: "test-relay-token",
			},
		});
		expect(showError).not.toHaveBeenCalled();
		expect(showStatus).toHaveBeenNthCalledWith(
			1,
			"Installing the Understudy browser extension and waiting for a tab handoff...",
		);
		expect(showStatus).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining("Browser extension connected."),
		);
	});

	it("passes an explicit target path through the slash command parser", async () => {
		mocks.parseBrowserExtensionSlashCommand.mockReturnValue({
			action: "install",
			target: "managed",
		});
		mocks.installBrowserExtensionIntoConfig.mockResolvedValue({
			config: {
				browser: {
					connectionMode: "extension",
					cdpUrl: "http://127.0.0.1:23336",
					extension: {
						installDir: "/Users/test/.understudy/browser/chrome-extension",
					},
				},
			},
			installDir: "/Users/test/.understudy/browser/chrome-extension",
			gatewayToken: "test-relay-token",
			tokenSource: "existing",
			connected: false,
		});
		mocks.configLoad.mockResolvedValue({
			get: () => ({ browser: {} }),
			update: vi.fn(),
			save: vi.fn(),
			getPath: () => "/tmp/config.json5",
		});

		const interactive = {
			init: vi.fn().mockResolvedValue(undefined),
			defaultEditor: {
				onSubmit: vi.fn().mockResolvedValue(undefined),
				setText: vi.fn(),
			},
			showStatus: vi.fn(),
			showError: vi.fn(),
		};

		await installInteractiveBrowserExtensionSupport({
			interactive,
		});

		await interactive.defaultEditor.onSubmit?.("/browser-extension managed");

		expect(mocks.installBrowserExtensionIntoConfig).toHaveBeenCalledWith(expect.objectContaining({
			target: "managed",
		}));
		expect(interactive.showStatus).toHaveBeenLastCalledWith(
			expect.stringContaining("click the Understudy toolbar button"),
		);
	});
});
