import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	ensureRelayServer: vi.fn(),
	inspectRelay: vi.fn(),
	stopRelay: vi.fn(),
}));

vi.mock("@understudy/tools", () => ({
	inspectAuthenticatedUnderstudyRelay: mocks.inspectRelay,
}));

vi.mock("../browser/extension-relay.js", () => ({
	ensureUnderstudyChromeExtensionRelayServer: mocks.ensureRelayServer,
}));

import { createBrowserExtensionRelayController } from "./browser-extension-relay-controller.js";

describe("createBrowserExtensionRelayController", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.stopRelay.mockResolvedValue(undefined);
		mocks.ensureRelayServer.mockResolvedValue({
			baseUrl: "http://127.0.0.1:23336",
			extensionConnected: () => true,
			stop: mocks.stopRelay,
		});
	});

	it("waits for an attached browser tab instead of only the extension worker", async () => {
		mocks.inspectRelay
			.mockResolvedValueOnce({
				reachable: true,
				recognized: true,
				extensionConnected: true,
				attachedTargets: [],
			})
			.mockResolvedValueOnce({
				reachable: true,
				recognized: true,
				extensionConnected: true,
				attachedTargets: [{
					id: "tab-1",
					type: "page",
					title: "Example",
					url: "https://example.com",
				}],
			});
		const controller = createBrowserExtensionRelayController();

		await controller.ensureForConfig({
			browser: {
				connectionMode: "extension",
				cdpUrl: "http://127.0.0.1:23336",
			},
			gateway: {
				auth: {
					mode: "none",
					token: "wizard-token",
				},
			},
		} as any);
		const connected = await controller.waitForConnection({
			timeoutMs: 100,
			pollIntervalMs: 5,
		});

		expect(connected).toBe(true);
		expect(mocks.ensureRelayServer).toHaveBeenCalledWith({
			cdpUrl: "http://127.0.0.1:23336",
			gatewayToken: "wizard-token",
		});
		expect(mocks.inspectRelay).toHaveBeenNthCalledWith(1, {
			baseUrl: "http://127.0.0.1:23336",
			timeoutMs: 500,
			gatewayToken: "wizard-token",
		});
		expect(mocks.inspectRelay).toHaveBeenNthCalledWith(2, {
			baseUrl: "http://127.0.0.1:23336",
			timeoutMs: 500,
			gatewayToken: "wizard-token",
		});
	});

	it("returns false when no browser tab is ever attached", async () => {
		mocks.inspectRelay.mockResolvedValue({
			reachable: true,
			recognized: true,
			extensionConnected: true,
			attachedTargets: [],
		});
		const controller = createBrowserExtensionRelayController();

		await controller.ensureForConfig({
			browser: {
				connectionMode: "extension",
				cdpUrl: "http://127.0.0.1:23336",
			},
			gateway: {
				auth: {
					mode: "none",
					token: "wizard-token",
				},
			},
		} as any);
		const connected = await controller.waitForConnection({
			timeoutMs: 20,
			pollIntervalMs: 5,
		});

		expect(connected).toBe(false);
	});
});
