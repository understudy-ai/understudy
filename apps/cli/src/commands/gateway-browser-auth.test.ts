import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	loadConfig: vi.fn(),
}));

vi.mock("@understudy/core", () => ({
	ConfigManager: {
		load: mocks.loadConfig,
	},
}));

import { ensureGatewayBrowserTokenInConfig, resolveGatewayBrowserToken } from "./gateway-browser-auth.js";

const originalGatewayToken = process.env.UNDERSTUDY_GATEWAY_TOKEN;

describe("resolveGatewayBrowserToken", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		if (originalGatewayToken === undefined) {
			delete process.env.UNDERSTUDY_GATEWAY_TOKEN;
		} else {
			process.env.UNDERSTUDY_GATEWAY_TOKEN = originalGatewayToken;
		}
	});

	it("prefers UNDERSTUDY_GATEWAY_TOKEN from env", async () => {
		process.env.UNDERSTUDY_GATEWAY_TOKEN = "env-token";

		const token = await resolveGatewayBrowserToken("/tmp/understudy.json5");

		expect(token).toBe("env-token");
		expect(mocks.loadConfig).not.toHaveBeenCalled();
	});

	it("falls back to config gateway auth token", async () => {
		delete process.env.UNDERSTUDY_GATEWAY_TOKEN;
		mocks.loadConfig.mockResolvedValue({
			get: () => ({
				gateway: {
					auth: {
						token: "config-token",
					},
				},
			}),
		});

		const token = await resolveGatewayBrowserToken("/tmp/understudy.json5");

		expect(token).toBe("config-token");
		expect(mocks.loadConfig).toHaveBeenCalledWith("/tmp/understudy.json5");
	});

	it("returns undefined when config cannot be loaded", async () => {
		delete process.env.UNDERSTUDY_GATEWAY_TOKEN;
		mocks.loadConfig.mockRejectedValue(new Error("missing config"));

		const token = await resolveGatewayBrowserToken();

		expect(token).toBeUndefined();
	});
});

describe("ensureGatewayBrowserTokenInConfig", () => {
	afterEach(() => {
		if (originalGatewayToken === undefined) {
			delete process.env.UNDERSTUDY_GATEWAY_TOKEN;
		} else {
			process.env.UNDERSTUDY_GATEWAY_TOKEN = originalGatewayToken;
		}
	});

	it("prefers the env token without mutating config", () => {
		process.env.UNDERSTUDY_GATEWAY_TOKEN = "env-token";
		const config: any = {
			gateway: {
				auth: {
					mode: "none",
				},
			},
		};

		const result = ensureGatewayBrowserTokenInConfig(config);

		expect(result).toEqual({ token: "env-token", source: "env" });
		expect(config.gateway.auth.token).toBeUndefined();
	});

	it("returns the configured token when already present", () => {
		delete process.env.UNDERSTUDY_GATEWAY_TOKEN;
		const config: any = {
			gateway: {
				auth: {
					mode: "token",
					token: "config-token",
				},
			},
		};

		const result = ensureGatewayBrowserTokenInConfig(config);

		expect(result).toEqual({ token: "config-token", source: "config" });
		expect(config.gateway.auth.token).toBe("config-token");
	});

	it("generates and stores a relay token when missing", () => {
		delete process.env.UNDERSTUDY_GATEWAY_TOKEN;
		const config: any = {
			gateway: {
				port: 23333,
			},
		};

		const result = ensureGatewayBrowserTokenInConfig(config);

		expect(result.source).toBe("generated");
		expect(result.token.length).toBeGreaterThan(10);
		expect(config.gateway.auth.mode).toBe("none");
		expect(config.gateway.auth.token).toBe(result.token);
	});
});
