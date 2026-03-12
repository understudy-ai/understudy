import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => {
	const setRuntimeApiKey = vi.fn();
	const set = vi.fn();
	const has = vi.fn();
	const get = vi.fn();
	const list = vi.fn();
	const getAvailable = vi.fn();
	const find = vi.fn();
	const getApiKey = vi.fn();

	class MockModelRegistry {
		public authStorage: any;
		public modelsPath: string | undefined;

		constructor(authStorage: any, modelsPath?: string) {
			this.authStorage = authStorage;
			this.modelsPath = modelsPath;
		}

		getAvailable = getAvailable;
		find = find;
		getApiKey = getApiKey;
	}

	function createAuthStorageMock() {
		const stored = new Map<string, unknown>();
		return {
			setRuntimeApiKey: (provider: string, apiKey: string) => {
				setRuntimeApiKey(provider, apiKey);
				stored.set(provider, { type: "api_key", key: apiKey });
			},
			set: (provider: string, credential: unknown) => {
				set(provider, credential);
				stored.set(provider, credential);
			},
			has: (provider: string) => {
				const overridden = has(provider);
				return overridden === true || stored.has(provider);
			},
			get: (provider: string) => {
				const overridden = get(provider);
				return overridden ?? stored.get(provider);
			},
			list: () => {
				const overridden = list();
				if (Array.isArray(overridden) && overridden.length > 0) {
					return overridden;
				}
				return [...stored.keys()];
			},
		};
	}

	const authCreate = vi.fn(() => createAuthStorageMock());
	const authInMemory = vi.fn(() => createAuthStorageMock());

	return {
		setRuntimeApiKey,
		set,
		has,
		get,
		list,
		getAvailable,
		find,
		getApiKey,
		MockModelRegistry,
		authCreate,
		authInMemory,
	};
});

vi.mock("@mariozechner/pi-coding-agent", () => ({
	AuthStorage: {
		create: mocks.authCreate,
		inMemory: mocks.authInMemory,
	},
	ModelRegistry: mocks.MockModelRegistry,
}));

import {
	AuthManager,
	inspectProviderAuthStatus,
	inspectProviderAuthStatuses,
	prepareRuntimeAuthContext,
} from "../auth.js";

function writeAuthJson(agentDir: string, value: unknown): void {
	writeFileSync(join(agentDir, "auth.json"), JSON.stringify(value), "utf-8");
}

describe("AuthManager", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.ANTHROPIC_API_KEY;
		delete process.env.OPENAI_API_KEY;
		delete process.env.GOOGLE_API_KEY;
		delete process.env.GEMINI_API_KEY;
		mocks.list.mockReturnValue([]);
		mocks.has.mockReturnValue(false);
		mocks.get.mockReturnValue(undefined);
		mocks.getAvailable.mockReturnValue([{ provider: "anthropic", id: "sonnet" }]);
		mocks.find.mockImplementation((provider: string, modelId: string) =>
			provider === "anthropic" && modelId === "sonnet" ? { provider, id: modelId } : undefined,
		);
		mocks.getApiKey.mockResolvedValue("sk-test");
	});

	it("creates file-backed auth manager with provided config dir", () => {
		const mgr = AuthManager.create("/tmp/understudy");
		expect(mocks.authCreate).toHaveBeenCalledWith("/tmp/understudy/auth.json");
		expect((mgr.modelRegistry as any).modelsPath).toBe("/tmp/understudy/models.json");
	});

	it("creates file-backed auth manager under the default agent dir when no explicit dir is provided", async () => {
		process.env.UNDERSTUDY_AGENT_DIR = "/tmp/default-understudy-agent";
		AuthManager.create();
		expect(mocks.authCreate).toHaveBeenCalledWith("/tmp/default-understudy-agent/auth.json");
	});

	it("creates in-memory auth manager", () => {
		const mgr = AuthManager.inMemory();
		expect(mocks.authInMemory).toHaveBeenCalledTimes(1);
		expect(mgr.authStorage).toBeDefined();
		expect(mgr.modelRegistry).toBeDefined();
	});

	it("delegates model lookup and key management", async () => {
		const mgr = AuthManager.inMemory();
		expect(mgr.getAvailableModels()).toHaveLength(1);
		expect(mgr.findModel("anthropic", "sonnet")).toMatchObject({ id: "sonnet" });

		const key = await mgr.getApiKey({ provider: "anthropic", id: "sonnet" } as any);
		expect(key).toBe("sk-test");

		mgr.setApiKey("anthropic", "sk-override");
		expect(mocks.setRuntimeApiKey).toHaveBeenCalledWith("anthropic", "sk-override");
	});

	it("hydrates runtime auth from the primary auth store", () => {
		const baseDir = mkdtempSync(join(tmpdir(), "understudy-auth-"));
		const profileAgentDir = join(baseDir, "profile-agent");
		mkdirSync(profileAgentDir, { recursive: true });
		writeAuthJson(profileAgentDir, {
			anthropic: {
				type: "oauth",
				access: "access-token",
				refresh: "refresh-token",
				expires: 123,
			},
		});
		try {
			const result = prepareRuntimeAuthContext({ agentDir: profileAgentDir });

			expect(mocks.authCreate).toHaveBeenNthCalledWith(1, join(profileAgentDir, "auth.json"));
			expect(mocks.set).toHaveBeenCalledWith("anthropic", {
				type: "oauth",
				access: "access-token",
				refresh: "refresh-token",
				expires: 123,
			});
			expect(result.report.primaryProviders).toEqual(["anthropic"]);
			expect(result.report.envProviders).toEqual([]);
		} finally {
			rmSync(baseDir, { recursive: true, force: true });
		}
	});

	it("ignores incomplete legacy oauth entries in auth.json", () => {
		const baseDir = mkdtempSync(join(tmpdir(), "understudy-auth-invalid-"));
		const profileAgentDir = join(baseDir, "profile-agent");
		mkdirSync(profileAgentDir, { recursive: true });
		writeAuthJson(profileAgentDir, {
			anthropic: {
				type: "oauth",
				access: "access-token",
				refresh: "refresh-token",
				expires: "2026-03-09T15:23:00.000Z",
			},
		});
		try {
			const result = prepareRuntimeAuthContext({ agentDir: profileAgentDir });
			expect(mocks.set).not.toHaveBeenCalled();
			expect(result.report.primaryProviders).toEqual([]);
		} finally {
			rmSync(baseDir, { recursive: true, force: true });
		}
	});

	it("ignores legacy auth-profiles data when auth.json is empty", () => {
		const baseDir = mkdtempSync(join(tmpdir(), "understudy-auth-legacy-"));
		const profileAgentDir = join(baseDir, "profile-agent");
		mkdirSync(profileAgentDir, { recursive: true });
		writeAuthJson(profileAgentDir, {});
		writeFileSync(join(profileAgentDir, "auth-profiles.json"), JSON.stringify({
			profiles: {
				"anthropic:default": {
					type: "oauth",
					provider: "anthropic",
					access: "legacy-access-token",
					refresh: "legacy-refresh-token",
					expires: 456,
				},
			},
		}), "utf-8");
		try {
			const result = prepareRuntimeAuthContext({ agentDir: profileAgentDir });

			expect(mocks.set).not.toHaveBeenCalled();
			expect(result.report.primaryProviders).toEqual([]);
		} finally {
			rmSync(baseDir, { recursive: true, force: true });
		}
	});

	it("imports environment API keys into runtime auth without requiring persisted credentials", () => {
		process.env.ANTHROPIC_API_KEY = "env-anthropic-key";
		process.env.OPENAI_API_KEY = "env-openai-key";
		process.env.GEMINI_API_KEY = "env-gemini-key";
		const result = prepareRuntimeAuthContext({
			agentDir: "/tmp/profile-agent",
		});
		expect(mocks.setRuntimeApiKey).toHaveBeenCalledWith("anthropic", "env-anthropic-key");
		expect(mocks.setRuntimeApiKey).toHaveBeenCalledWith("openai", "env-openai-key");
		expect(mocks.setRuntimeApiKey).toHaveBeenCalledWith("openai-codex", "env-openai-key");
		expect(mocks.setRuntimeApiKey).toHaveBeenCalledWith("google", "env-gemini-key");
		expect(mocks.setRuntimeApiKey).toHaveBeenCalledWith("gemini", "env-gemini-key");
		expect(result.report.envProviders).toEqual(["anthropic", "openai", "openai-codex", "google", "gemini"]);
	});

	it("inspects auth status across providers", () => {
		process.env.OPENAI_API_KEY = "openai-key";
		process.env.GEMINI_API_KEY = "gem-key";
		const statuses = inspectProviderAuthStatuses(["anthropic", "google", "openai-codex"], {
			agentDir: "/tmp/profile-agent",
		});
		expect(statuses.get("anthropic")).toMatchObject({ source: "missing", available: false });
		expect(statuses.get("google")).toMatchObject({ source: "env", available: true, credentialType: "api_key" });
		expect(statuses.get("openai-codex")).toMatchObject({ source: "env", available: true, credentialType: "api_key" });
	});

	it("inspects auth status from the primary auth store", () => {
		const baseDir = mkdtempSync(join(tmpdir(), "understudy-auth-status-"));
		const profileAgentDir = join(baseDir, "profile-agent");
		mkdirSync(profileAgentDir, { recursive: true });
		writeAuthJson(profileAgentDir, {
			anthropic: {
				type: "oauth",
				access: "access-token",
				refresh: "refresh-token",
				expires: 123,
			},
		});
		try {
			const statuses = inspectProviderAuthStatuses(["anthropic", "openai"], { agentDir: profileAgentDir });
			expect(statuses.get("anthropic")).toMatchObject({
				source: "primary",
				available: true,
				credentialType: "oauth",
			});
			expect(statuses.get("openai")).toMatchObject({ source: "missing", available: false });
		} finally {
			rmSync(baseDir, { recursive: true, force: true });
		}
	});

	it("reports missing auth when no provider credentials are configured", () => {
		const status = inspectProviderAuthStatus("openai", { agentDir: "/tmp/profile-agent" });
		expect(status).toMatchObject({ source: "missing", available: false });
	});
});
