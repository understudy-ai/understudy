import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	loadConfig: vi.fn(),
	createUnderstudySession: vi.fn(),
	resolveUnderstudyHomeDir: vi.fn(),
	prepareCliPromptInput: vi.fn(),
	mergeCliPromptText: vi.fn(),
	resolveMemoryDbPath: vi.fn(),
	applyUnderstudyBranding: vi.fn(),
	resolveConfiguredBrowserOptions: vi.fn(),
	createBrowserExtensionRelayController: vi.fn(),
	installInteractiveBrowserExtensionSupport: vi.fn(),
	installInteractiveChatMediaSupport: vi.fn(),
	installInteractiveTeachSupport: vi.fn(),
	createGatewayBackedInteractiveSession: vi.fn(),
	createConfiguredRuntimeToolset: vi.fn(),
	gatewayRpcClientCtor: vi.fn(),
	loadUnderstudyPlugins: vi.fn(),
	createMemoryProvider: vi.fn(),
	scheduleServiceCtor: vi.fn(),
	scheduleServiceStart: vi.fn(),
	scheduleServiceStop: vi.fn(),
	scheduleServiceInstances: [] as Array<{ config: { onJobTrigger: (job: any) => Promise<void> }; stop: () => void }>,
	configReloaderStart: vi.fn(),
	configReloaderStop: vi.fn(),
	inMemorySessionManager: vi.fn(),
	interactiveRun: vi.fn(),
	interactiveCtor: vi.fn(),
}));
const modelSupportMocks = vi.hoisted(() => ({
	resolveCliModel: vi.fn(),
}));

vi.mock("@understudy/core", async () => {
	const actual = await vi.importActual<typeof import("@understudy/core")>("@understudy/core");
	return {
		...actual,
		ConfigManager: {
			load: mocks.loadConfig,
		},
		createUnderstudySession: mocks.createUnderstudySession,
		normalizeAssistantDisplayText: (text: string) => ({ text: text.replace(/\[\[[^\]]+\]\]\s*/g, "").trim() }),
		resolveUnderstudyHomeDir: mocks.resolveUnderstudyHomeDir,
		resolveUnderstudyPackageVersion: actual.resolveUnderstudyPackageVersion,
	};
});

vi.mock("@understudy/gateway", () => ({
	ConfigReloader: class {
		start() {
			mocks.configReloaderStart();
		}
		stop() {
			mocks.configReloaderStop();
		}
	},
	normalizeAssistantRenderableText: (text: string) => text,
}));

vi.mock("@understudy/plugins", () => ({
	loadUnderstudyPlugins: mocks.loadUnderstudyPlugins,
}));

vi.mock("@understudy/tools", () => ({
	createMemoryProvider: mocks.createMemoryProvider,
	ScheduleService: class {
		readonly config: { onJobTrigger: (job: any) => Promise<void> };
		constructor(config: { onJobTrigger: (job: any) => Promise<void> }) {
			this.config = config;
			mocks.scheduleServiceCtor(config);
			mocks.scheduleServiceInstances.push(this as unknown as { config: { onJobTrigger: (job: any) => Promise<void> }; stop: () => void });
		}
		async start() {
			mocks.scheduleServiceStart(this.config);
		}
		stop() {
			mocks.scheduleServiceStop(this.config);
		}
	},
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
	InteractiveMode: class {
		constructor(session: unknown, options: unknown) {
			mocks.interactiveCtor(session, options);
		}
		async run() {
			await mocks.interactiveRun();
		}
	},
	SessionManager: {
		inMemory: mocks.inMemorySessionManager,
	},
}));

vi.mock("./cli-prompt-input.js", () => ({
	prepareCliPromptInput: mocks.prepareCliPromptInput,
	mergeCliPromptText: mocks.mergeCliPromptText,
}));

vi.mock("./gateway-support.js", () => ({
	resolveMemoryDbPath: mocks.resolveMemoryDbPath,
}));

vi.mock("./chat-branding.js", () => ({
	applyUnderstudyBranding: mocks.applyUnderstudyBranding,
}));

vi.mock("./browser-extension.js", () => ({
	resolveConfiguredBrowserOptions: mocks.resolveConfiguredBrowserOptions,
}));

vi.mock("./browser-extension-relay-controller.js", () => ({
	createBrowserExtensionRelayController: mocks.createBrowserExtensionRelayController,
}));

vi.mock("./chat-interactive-browser-extension.js", () => ({
	installInteractiveBrowserExtensionSupport: mocks.installInteractiveBrowserExtensionSupport,
}));

vi.mock("./chat-interactive-media.js", () => ({
	installInteractiveChatMediaSupport: mocks.installInteractiveChatMediaSupport,
}));

vi.mock("./chat-interactive-teach.js", () => ({
	installInteractiveTeachSupport: mocks.installInteractiveTeachSupport,
}));

vi.mock("./chat-gateway-session.js", () => ({
	createGatewayBackedInteractiveSession: mocks.createGatewayBackedInteractiveSession,
}));

vi.mock("../rpc-client.js", () => ({
	GatewayRpcClient: class {
		readonly url: string;
		constructor(options: { baseUrl?: string; host?: string; port?: number }) {
			this.url = options.baseUrl?.trim()
				? options.baseUrl.trim().replace(/\/+$/, "")
				: `http://${options.host ?? "127.0.0.1"}:${options.port ?? 23333}`;
			mocks.gatewayRpcClientCtor(options);
		}
	},
}));

vi.mock("./runtime-tooling.js", () => ({
	createConfiguredRuntimeToolset: mocks.createConfiguredRuntimeToolset,
}));

vi.mock("./model-support.js", async () => {
	const actual = await vi.importActual<typeof import("./model-support.js")>("./model-support.js");
	return {
		...actual,
		resolveCliModel: modelSupportMocks.resolveCliModel,
	};
});

import {
	applyManagedTuiToolDownloadPolicy,
	resolveCliVersion,
	runChatCommand,
	shouldDisableManagedTuiToolDownloads,
} from "./chat.js";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	delete process.env.UNDERSTUDY_GATEWAY_TOKEN;
	delete process.env.UNDERSTUDY_GATEWAY_URL;
	process.exitCode = 0;
});

beforeEach(() => {
	vi.clearAllMocks();
	const defaultFetch = vi.fn(async () => ({
		ok: true,
		json: async () => ({}),
	}));
	vi.stubGlobal("fetch", defaultFetch as unknown as typeof fetch);
	mocks.scheduleServiceInstances.length = 0;
	process.exitCode = 0;
	mocks.resolveUnderstudyHomeDir.mockReturnValue("/tmp/understudy-home");
	mocks.resolveMemoryDbPath.mockReturnValue("/tmp/understudy-memory.db");
	mocks.createConfiguredRuntimeToolset.mockResolvedValue([{ name: "mock-tool" }]);
	mocks.loadUnderstudyPlugins.mockResolvedValue({
		getToolFactories: () => [],
		getPlatformCapabilities: () => [],
	});
	mocks.createMemoryProvider.mockResolvedValue({
		close: vi.fn(async () => {}),
	});
	modelSupportMocks.resolveCliModel.mockImplementation((modelSpec?: string) =>
		modelSpec
			? { provider: "resolved-provider", id: "resolved-model" }
			: undefined
	);
	mocks.createBrowserExtensionRelayController.mockReturnValue({
		ensureForConfig: vi.fn(async () => {}),
		stop: vi.fn(async () => {}),
	});
		mocks.loadConfig.mockResolvedValue({
			get: () => ({
				defaultProvider: "anthropic",
				defaultModel: "claude-sonnet-4-6",
				browser: { connectionMode: "managed" },
				memory: { enabled: true },
			}),
		getPath: () => "/tmp/understudy/config.json5",
		update: vi.fn(),
	});
	mocks.prepareCliPromptInput.mockResolvedValue({
		text: "Attached file context",
		images: [{ type: "input_image", image_url: "file:///tmp/screenshot.png" }],
	});
	mocks.mergeCliPromptText.mockReturnValue("hello\n\nAttached file context");
	mocks.createUnderstudySession.mockResolvedValue({
		session: { id: "session-1" },
		runtimeSession: { close: vi.fn(async () => {}) },
	});
	mocks.createGatewayBackedInteractiveSession.mockImplementation(async ({ baseSession }: { baseSession: { id?: string } }) => ({
		...baseSession,
		id: "gateway-session-1",
		close: vi.fn(async () => {}),
		getGatewaySessionId: () => "gateway-session-1",
	}));
	mocks.inMemorySessionManager.mockReturnValue({
		type: "in-memory-session-manager",
	});
});

describe("resolveCliVersion", () => {
	it("finds the root Understudy package version by walking upward", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "understudy-cli-version-"));
		tempDirs.push(rootDir);
		const nestedDir = join(rootDir, "apps", "cli", "dist", "commands");
		await mkdir(nestedDir, { recursive: true });
		await writeFile(
			join(rootDir, "package.json"),
			JSON.stringify({ name: "@understudy-ai/understudy", version: "1.2.3" }),
			"utf8",
		);

		expect(resolveCliVersion(nestedDir)).toBe("1.2.3");
	});

	it("prefers the root published package version over the private CLI workspace package", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "understudy-cli-version-"));
		tempDirs.push(rootDir);
		const cliDir = join(rootDir, "apps", "cli");
		const nestedDir = join(cliDir, "dist", "commands");
		await mkdir(nestedDir, { recursive: true });
		await writeFile(
			join(rootDir, "package.json"),
			JSON.stringify({ name: "@understudy-ai/understudy", version: "1.2.3" }),
			"utf8",
		);
		await writeFile(
			join(cliDir, "package.json"),
			JSON.stringify({ name: "@understudy/cli", version: "1.2.4" }),
			"utf8",
		);

		expect(resolveCliVersion(nestedDir)).toBe("1.2.3");
	});

	it("falls back to the private CLI workspace package when no root package is present", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "understudy-cli-version-"));
		tempDirs.push(rootDir);
		const cliDir = join(rootDir, "apps", "cli");
		const nestedDir = join(cliDir, "dist", "commands");
		await mkdir(nestedDir, { recursive: true });
		await writeFile(
			join(cliDir, "package.json"),
			JSON.stringify({ name: "@understudy/cli", version: "1.2.4" }),
			"utf8",
		);

		expect(resolveCliVersion(nestedDir)).toBe("1.2.4");
	});
});

describe("runChatCommand", () => {
	it("boots the interactive chat runtime and threads initial message/images through", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runChatCommand({
			cwd: "/tmp/project",
			message: "hello",
			file: ["notes.md"],
			image: ["screenshot.png"],
			config: "/tmp/understudy/config.json5",
			continue: true,
			thinking: "high",
		});

		expect(mocks.prepareCliPromptInput).toHaveBeenCalledWith({
			cwd: "/tmp/project",
			files: ["notes.md"],
			images: ["screenshot.png"],
		});
		expect(mocks.mergeCliPromptText).toHaveBeenCalledWith("hello", {
			text: "Attached file context",
			images: [{ type: "input_image", image_url: "file:///tmp/screenshot.png" }],
		});
		expect(log.mock.calls.flat().join("\n")).toContain("Using gateway session: gateway-session-1");
		expect(mocks.createUnderstudySession).toHaveBeenCalledWith(expect.objectContaining({
			configPath: "/tmp/understudy/config.json5",
			cwd: "/tmp/project",
			channel: "tui",
			thinkingLevel: "high",
			extraTools: [{ name: "mock-tool" }],
			sessionManager: expect.any(Object),
		}));
		expect(mocks.createGatewayBackedInteractiveSession).toHaveBeenCalledWith(expect.objectContaining({
			gatewayUrl: "http://127.0.0.1:23333",
			cwd: "/tmp/project",
			forceNew: false,
			configOverride: {
				defaultThinkingLevel: "high",
			},
		}));
		expect(mocks.createConfiguredRuntimeToolset).toHaveBeenCalledWith(expect.objectContaining({
			scheduleService: expect.any(Object),
		}));
		expect(mocks.interactiveCtor).toHaveBeenCalledWith(
			expect.objectContaining({ id: "gateway-session-1" }),
			expect.objectContaining({
				initialMessage: "hello\n\nAttached file context",
				initialImages: [{ type: "input_image", image_url: "file:///tmp/screenshot.png" }],
			}),
		);
		expect(mocks.applyUnderstudyBranding).toHaveBeenCalledOnce();
		expect(mocks.installInteractiveChatMediaSupport).toHaveBeenCalledOnce();
		expect(mocks.installInteractiveBrowserExtensionSupport).toHaveBeenCalledOnce();
		expect(mocks.installInteractiveTeachSupport).toHaveBeenCalledOnce();
		expect(mocks.interactiveRun).toHaveBeenCalledOnce();
		expect(mocks.scheduleServiceStart).toHaveBeenCalledOnce();
		expect(mocks.scheduleServiceStop).toHaveBeenCalledOnce();
		expect(mocks.configReloaderStop).toHaveBeenCalledOnce();
	});

	it("routes TUI schedule triggers back through the active gateway-backed session", async () => {
		const sendCustomMessage = vi.fn(async () => {});
		const backgroundPrompt = vi.fn(async (_text: string) => {
			const scheduledCall = mocks.createUnderstudySession.mock.calls[1]?.[0] as {
				lifecycleHooks?: {
					onAssistantReply?: (event: { message: { content: Array<{ type: string; text: string }> } }) => Promise<void>;
				};
			};
			await scheduledCall.lifecycleHooks?.onAssistantReply?.({
				message: {
					content: [{ type: "text", text: "[[reply_to_current]] 提醒你：已经过了 1 分钟。" }],
				},
			});
		});
		mocks.createUnderstudySession
			.mockResolvedValueOnce({
				session: {
					id: "session-1",
					sendCustomMessage,
					messages: [],
				},
			})
			.mockResolvedValueOnce({
				session: {
					id: "scheduled-turn",
					prompt: backgroundPrompt,
					agent: {
						replaceMessages: vi.fn(),
					},
				},
				runtimeSession: {
					close: vi.fn(async () => {}),
				},
			});
		mocks.interactiveRun.mockImplementation(async () => {
			const instance = mocks.scheduleServiceInstances[0];
			await instance?.config.onJobTrigger({
				id: "job-1",
				name: "reminder",
				schedule: "0 9 * * *",
				command: "[[reply_to_current]] 提醒你：已经过了 1 分钟。",
				enabled: true,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				runCount: 0,
				failCount: 0,
			});
		});

		await runChatCommand({
			cwd: "/tmp/project",
			message: "hello",
		});

		expect(backgroundPrompt).toHaveBeenCalledWith(expect.stringContaining("Scheduled instruction:"));
		expect(backgroundPrompt).toHaveBeenCalledWith(expect.stringContaining("[[reply_to_current]] 提醒你：已经过了 1 分钟。"));
		expect(sendCustomMessage).toHaveBeenCalledWith({
			customType: "understudy-schedule",
			content: "提醒你：已经过了 1 分钟。",
			display: true,
			details: {
				source: "schedule",
				command: "[[reply_to_current]] 提醒你：已经过了 1 分钟。",
			},
		}, { triggerTurn: false });
	});

	it("prints input preparation failures and exits with code 1", async () => {
		mocks.prepareCliPromptInput.mockRejectedValue(new Error("missing file"));
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new Error(`exit:${code}`);
		}) as any);

		await expect(runChatCommand({
			file: ["missing.md"],
		})).rejects.toThrow("exit:1");

		expect(error).toHaveBeenCalledWith("Error:", "missing file");
		expect(mocks.createUnderstudySession).not.toHaveBeenCalled();
		expect(exit).toHaveBeenCalledWith(1);
	});

	it("skips memory provider setup when memory is disabled", async () => {
		mocks.loadConfig.mockResolvedValue({
			get: () => ({
				defaultProvider: "anthropic",
				defaultModel: "claude-sonnet-4-6",
				browser: { connectionMode: "managed" },
				memory: { enabled: false },
			}),
			getPath: () => "/tmp/understudy/config.json5",
			update: vi.fn(),
		});

		await runChatCommand({
			cwd: "/tmp/project",
			message: "hello",
		});

		expect(mocks.createMemoryProvider).not.toHaveBeenCalled();
		expect(mocks.createConfiguredRuntimeToolset).toHaveBeenCalledWith(expect.objectContaining({
			memoryProvider: undefined,
		}));
	});

	it("threads an explicit CLI model into runtime tool setup", async () => {
		modelSupportMocks.resolveCliModel.mockReturnValue({
			provider: "openai",
			id: "gpt-4o",
		});
		await runChatCommand({
			cwd: "/tmp/project",
			message: "hello",
			model: "openai/gpt-4o",
		});

		expect(mocks.createConfiguredRuntimeToolset).toHaveBeenCalledWith(expect.objectContaining({
			explicitModel: expect.objectContaining({
				provider: "openai",
				id: "gpt-4o",
			}),
		}));
	});

	it("preserves an explicit https gateway URL when constructing the RPC client", async () => {
		process.env.UNDERSTUDY_GATEWAY_URL = "https://gateway.example.com/api/";

		try {
			await runChatCommand({
				cwd: "/tmp/project",
				message: "hello",
			});
		} finally {
			delete process.env.UNDERSTUDY_GATEWAY_URL;
		}

		expect(mocks.gatewayRpcClientCtor).toHaveBeenCalledWith(expect.objectContaining({
			baseUrl: "https://gateway.example.com/api",
		}));
	});

	it("does not publish a config-backed gateway token into process.env", async () => {
		delete process.env.UNDERSTUDY_GATEWAY_TOKEN;
		mocks.loadConfig.mockResolvedValue({
			get: () => ({
				defaultProvider: "anthropic",
				defaultModel: "claude-sonnet-4-6",
				browser: { connectionMode: "managed" },
				memory: { enabled: true },
				gateway: {
					auth: {
						mode: "token",
						token: "config-gateway-token",
					},
				},
			}),
			getPath: () => "/tmp/understudy/config.json5",
			update: vi.fn(),
		});

		await runChatCommand({
			cwd: "/tmp/project",
			message: "hello",
		});

		expect(process.env.UNDERSTUDY_GATEWAY_TOKEN).toBeUndefined();
		expect(mocks.createGatewayBackedInteractiveSession).toHaveBeenCalledWith(expect.objectContaining({
			gatewayToken: "config-gateway-token",
		}));
	});

	it("applies offline download policy before InteractiveMode construction", async () => {
		const originalPath = process.env.PATH;
		const originalOffline = process.env.PI_OFFLINE;
		const ctorStates: Array<string | undefined> = [];
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		mocks.interactiveCtor.mockImplementation(() => {
			ctorStates.push(process.env.PI_OFFLINE);
		});

		process.env.PATH = "";
		delete process.env.PI_OFFLINE;

		try {
			await runChatCommand({
				cwd: "/tmp/project",
				message: "hello",
			});
		} finally {
			process.env.PATH = originalPath;
			if (originalOffline === undefined) {
				delete process.env.PI_OFFLINE;
			} else {
				process.env.PI_OFFLINE = originalOffline;
			}
		}

		expect(ctorStates).toEqual(["1"]);
		expect(log.mock.calls.flat().join("\n")).toContain("fd is not installed locally");
		expect(process.env.PI_OFFLINE).toBe(originalOffline);
	});

	it("exits cleanly when the gateway is unavailable", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => {
			throw new Error("gateway offline");
		}) as unknown as typeof fetch);
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
			throw new Error(`exit:${code}`);
		}) as any);

		await expect(runChatCommand({
			cwd: "/tmp/project",
			message: "hello",
		})).rejects.toThrow("exit:1");

		expect(mocks.createUnderstudySession).not.toHaveBeenCalled();
		expect(mocks.createGatewayBackedInteractiveSession).not.toHaveBeenCalled();
		expect(error).toHaveBeenCalledWith(
			"Error:",
			expect.stringContaining("Gateway-backed interactive chat requires a running Understudy gateway"),
		);
		expect(exit).toHaveBeenCalledWith(1);
	});

	it("retries gateway health once before failing interactive startup", async () => {
		const fetchMock = vi.fn()
			.mockRejectedValueOnce(new Error("cold start"))
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({}),
			});
		vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

		await runChatCommand({
			cwd: "/tmp/project",
			message: "hello",
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(mocks.createGatewayBackedInteractiveSession).toHaveBeenCalledTimes(1);
	});
});

describe("managed TUI tool download policy", () => {
	it("disables managed downloads by default when fd is unavailable", () => {
		const env = {
			PATH: "",
		} as NodeJS.ProcessEnv;

		expect(shouldDisableManagedTuiToolDownloads(env)).toBe(true);
	});

	it("keeps downloads enabled when explicitly opted in", () => {
		const env = {
			UNDERSTUDY_TUI_ALLOW_TOOL_DOWNLOADS: "1",
		} as NodeJS.ProcessEnv;

		expect(shouldDisableManagedTuiToolDownloads(env)).toBe(false);
	});

	it("temporarily sets PI_OFFLINE while interactive mode is running", () => {
		const env = {} as NodeJS.ProcessEnv;
		const log = vi.fn();

		const restore = applyManagedTuiToolDownloadPolicy(env, log);

		expect(env.PI_OFFLINE).toBe("1");
		expect(log).toHaveBeenCalledWith(expect.stringContaining("fd is not installed locally"));

		restore();

		expect(env.PI_OFFLINE).toBeUndefined();
	});
});
