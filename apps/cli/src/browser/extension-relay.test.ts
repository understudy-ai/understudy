import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:net";
import {
	getUnderstudyChromeExtensionRelayAuthHeaders,
	UNDERSTUDY_EXTENSION_RELAY_BROWSER,
} from "@understudy/tools";
import {
	ensureUnderstudyChromeExtensionRelayServer,
	getUnderstudyChromeExtensionRelayRuntimeHeaders,
	stopUnderstudyChromeExtensionRelayServer,
} from "./extension-relay.js";

const originalGatewayToken = process.env.UNDERSTUDY_GATEWAY_TOKEN;

async function allocatePort(): Promise<number> {
	return await new Promise<number>((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close(() => reject(new Error("Failed to allocate test port")));
				return;
			}
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(address.port);
			});
		});
	});
}

describe("Understudy extension relay server", () => {
	beforeEach(() => {
		process.env.UNDERSTUDY_GATEWAY_TOKEN = "test-gateway-token";
	});

	afterEach(async () => {
		if (originalGatewayToken === undefined) {
			delete process.env.UNDERSTUDY_GATEWAY_TOKEN;
		} else {
			process.env.UNDERSTUDY_GATEWAY_TOKEN = originalGatewayToken;
		}
	});

	it("starts on loopback and protects /json/version with relay auth", async () => {
		const port = await allocatePort();
		const cdpUrl = `http://127.0.0.1:${port}`;
		const relay = await ensureUnderstudyChromeExtensionRelayServer({ cdpUrl });

		const unauthorized = await fetch(`${relay.baseUrl}/json/version`);
		expect(unauthorized.status).toBe(401);

		const headers = await getUnderstudyChromeExtensionRelayAuthHeaders(relay.baseUrl);
		const authorized = await fetch(`${relay.baseUrl}/json/version`, { headers });
		expect(authorized.status).toBe(200);
		const body = await authorized.json() as { Browser?: string };
		expect(body.Browser).toBe(UNDERSTUDY_EXTENSION_RELAY_BROWSER);

		await stopUnderstudyChromeExtensionRelayServer({ cdpUrl });
	});

	it("can start with an explicit gateway token before config is saved", async () => {
		delete process.env.UNDERSTUDY_GATEWAY_TOKEN;
		const port = await allocatePort();
		const cdpUrl = `http://127.0.0.1:${port}`;
		const relay = await ensureUnderstudyChromeExtensionRelayServer({
			cdpUrl,
			gatewayToken: "wizard-generated-token",
		});

		const unauthorized = await fetch(`${relay.baseUrl}/json/version`);
		expect(unauthorized.status).toBe(401);

		const authorized = await fetch(`${relay.baseUrl}/json/version`, {
			headers: getUnderstudyChromeExtensionRelayRuntimeHeaders(relay.baseUrl),
		});
		expect(authorized.status).toBe(200);

		await stopUnderstudyChromeExtensionRelayServer({ cdpUrl });
	});
});
