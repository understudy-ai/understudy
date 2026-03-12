import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	loadConfig: vi.fn(),
	inspectProviderAuthStatuses: vi.fn(),
	rpcCall: vi.fn(),
	configUpdate: vi.fn(),
	configSave: vi.fn(),
	configGetPath: vi.fn(),
}));

vi.mock("@understudy/core", () => ({
	ConfigManager: {
		load: mocks.loadConfig,
	},
	AuthManager: {
		create: () => ({
			getAvailableModels: () => [],
		}),
	},
	inspectProviderAuthStatuses: mocks.inspectProviderAuthStatuses,
}));

vi.mock("../rpc-client.js", () => ({
	createRpcClient: () => ({
		call: mocks.rpcCall,
	}),
}));

import { runModelsCommand } from "./models.js";

describe("runModelsCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = 0;
		mocks.loadConfig.mockResolvedValue({
			get: () => ({
				defaultProvider: "openai-codex",
				defaultModel: "gpt-5.4",
			}),
			update: mocks.configUpdate,
			save: mocks.configSave,
			getPath: mocks.configGetPath.mockReturnValue("/tmp/understudy/config.json5"),
		});
		mocks.inspectProviderAuthStatuses.mockReturnValue(
			new Map([
				["openai-codex", { provider: "openai-codex", available: true, source: "env", credentialType: "api_key" }],
				["anthropic", { provider: "anthropic", available: true, source: "primary", credentialType: "oauth" }],
				["google", { provider: "google", available: true, source: "env", credentialType: "api_key" }],
			]),
		);
	});

	it("renders auth badges from gateway model discovery metadata", async () => {
		mocks.rpcCall.mockResolvedValue({
			models: [
				{
					provider: "openai-codex",
					id: "gpt-5.4",
					authAvailable: true,
					authSource: "env",
					authType: "api_key",
				},
				{
					provider: "anthropic",
					id: "claude-sonnet-4-6",
					authAvailable: true,
					authSource: "primary",
					authType: "oauth",
				},
				{
					provider: "anthropic",
					id: "claude-opus-4-20250514",
					authAvailable: true,
					authSource: "primary",
					authType: "oauth",
				},
			],
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runModelsCommand({});

		const output = log.mock.calls.flat().join("\n");
		expect(output).toContain("Available models:");
		expect(output).toContain("anthropic (oauth):");
		expect(output).toContain("openai-codex/gpt-5.4  [default]");
	});

	it("uses local auth inspection for scan output", async () => {
		mocks.rpcCall.mockRejectedValue(new Error("gateway unavailable"));
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runModelsCommand({ scan: true });

		const output = log.mock.calls.flat().join("\n");
		expect(output).toContain("Scanning provider auth...");
		expect(output).toContain("anthropic: oauth");
		expect(output).toContain("google: env api key");
	});

	it("updates the saved default model when --set is valid", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runModelsCommand({ set: "google/gemini-2.0-flash" });

		expect(mocks.configUpdate).toHaveBeenCalledWith({
			defaultProvider: "google",
			defaultModel: "gemini-2.0-flash",
		});
		expect(mocks.configSave).toHaveBeenCalledOnce();
		expect(log.mock.calls.flat().join("\n")).toContain("Default model set to: google/gemini-2.0-flash");
		expect(log.mock.calls.flat().join("\n")).toContain("/tmp/understudy/config.json5");
	});

	it("rejects invalid model refs for --set", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		await runModelsCommand({ set: "bad-format" });

		expect(mocks.configUpdate).not.toHaveBeenCalled();
		expect(error).toHaveBeenCalledWith("Model format: provider/model-id (e.g., openai-codex/gpt-5.4)");
		expect(process.exitCode).toBe(1);
	});

	it("falls back to local known models when gateway discovery is empty", async () => {
		mocks.rpcCall.mockResolvedValue({ models: [] });
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runModelsCommand({});

		const output = log.mock.calls.flat().join("\n");
		expect(output).toContain("Available models:");
		expect(output).toContain("anthropic (oauth):");
		expect(output).toContain("google (env api key):");
		expect(output).toContain("openai-codex (env api key):");
		expect(output).toContain("openai (no auth):");
		expect(output).toContain("openai-codex/gpt-5.4  [default]");
	});
});
