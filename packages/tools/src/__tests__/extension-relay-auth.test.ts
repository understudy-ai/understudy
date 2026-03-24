import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	getUnderstudyChromeExtensionRelayAuthHeaders,
	resolveUnderstudyRelayAcceptedTokensForPort,
} from "../browser/extension-relay-auth.js";

describe("extension-relay-auth", () => {
	const originalEnv = { ...process.env };
	let tempHomeDir: string;

	beforeEach(() => {
		tempHomeDir = mkdtempSync(join(tmpdir(), "understudy-relay-auth-test-"));
		process.env = {
			...originalEnv,
			UNDERSTUDY_HOME: tempHomeDir,
		};
		delete process.env.UNDERSTUDY_GATEWAY_TOKEN;
		delete process.env.UNDERSTUDY_GATEWAY_AUTH_MODE;
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		rmSync(tempHomeDir, { recursive: true, force: true });
	});

	it("allows the browser extension relay without headers when gateway auth mode is none", async () => {
		process.env.UNDERSTUDY_GATEWAY_AUTH_MODE = "none";

		await expect(resolveUnderstudyRelayAcceptedTokensForPort(23336)).resolves.toEqual([]);
		await expect(getUnderstudyChromeExtensionRelayAuthHeaders("http://127.0.0.1:23336")).resolves.toEqual({});
	});

	it("still derives relay auth headers when a gateway token exists", async () => {
		process.env.UNDERSTUDY_GATEWAY_AUTH_MODE = "token";
		process.env.UNDERSTUDY_GATEWAY_TOKEN = "gateway-secret";

		const tokens = await resolveUnderstudyRelayAcceptedTokensForPort(23336);
		const headers = await getUnderstudyChromeExtensionRelayAuthHeaders("http://127.0.0.1:23336");

		expect(tokens.length).toBeGreaterThan(0);
		expect(headers["x-understudy-relay-token"]).toBe(tokens[0]);
	});
});
