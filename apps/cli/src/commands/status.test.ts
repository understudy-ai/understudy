import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createRpcClient: vi.fn(),
	loadConfig: vi.fn(),
	resolveUnderstudyHomeDir: vi.fn(),
	gatewayLockRead: vi.fn(),
	existsSync: vi.fn(),
}));

vi.mock("../rpc-client.js", () => ({
	createRpcClient: mocks.createRpcClient,
}));

vi.mock("@understudy/core", () => ({
	ConfigManager: {
		load: mocks.loadConfig,
	},
	resolveUnderstudyHomeDir: mocks.resolveUnderstudyHomeDir,
	resolveUnderstudyPackageVersion: () => "0.2.0",
}));

vi.mock("@understudy/gateway", () => ({
	GatewayLock: {
		read: mocks.gatewayLockRead,
	},
}));

vi.mock("node:fs", () => ({
	existsSync: mocks.existsSync,
}));

import { runStatusCommand } from "./status.js";

describe("runStatusCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.resolveUnderstudyHomeDir.mockReturnValue("/tmp/understudy-home");
		mocks.existsSync.mockReturnValue(true);
		mocks.loadConfig.mockResolvedValue({
			get: () => ({
				gateway: {
					host: "127.0.0.1",
					port: 23333,
				},
			}),
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("reports a reachable gateway even when the lock file is missing", async () => {
		mocks.gatewayLockRead.mockReturnValue(undefined);
		mocks.createRpcClient.mockReturnValue({
			health: vi.fn(async () => ({ status: "ok", version: "0.1.0" })),
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runStatusCommand({ json: true, all: true });

		expect(mocks.createRpcClient).toHaveBeenCalledWith({
			host: "127.0.0.1",
			port: 23333,
			timeout: 1500,
		});
		const payload = JSON.parse(String(log.mock.calls[0]?.[0]));
		expect(payload.version).toBe("0.2.0");
		expect(payload.gateway).toEqual({
			running: true,
			pid: undefined,
			host: "127.0.0.1",
			port: 23333,
			startedAt: undefined,
			detectedBy: "probe",
		});
		expect(payload.health).toEqual({ status: "ok", version: "0.1.0" });
	});

	it("marks a lock file as stale when the gateway cannot be reached", async () => {
		mocks.gatewayLockRead.mockReturnValue({
			pid: 4242,
			port: 24444,
			startedAt: "2026-03-11T10:00:00.000Z",
		});
		mocks.createRpcClient.mockReturnValue({
			health: vi.fn(async () => {
				throw new Error("unreachable");
			}),
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runStatusCommand({ json: true });

		expect(mocks.createRpcClient).toHaveBeenCalledTimes(2);
		const payload = JSON.parse(String(log.mock.calls[0]?.[0]));
		expect(payload.version).toBe("0.2.0");
		expect(payload.gateway).toEqual({
			running: false,
			staleLock: {
				pid: 4242,
				port: 24444,
				startedAt: "2026-03-11T10:00:00.000Z",
			},
		});
	});
});
