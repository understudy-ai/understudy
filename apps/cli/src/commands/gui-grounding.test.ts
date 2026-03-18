import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, type UnderstudyConfig } from "@understudy/types";
import { DEFAULT_OPENAI_GROUNDING_MODEL } from "@understudy/tools";
import {
	clearOAuthGroundingProbeCacheForTest,
	createOpenAIRuntimeGroundingProvider,
	primeGuiGroundingForConfig,
} from "./gui-grounding.js";

const ONE_BY_ONE_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6W2y0AAAAASUVORK5CYII=";

const tempDirs: string[] = [];

function createConfig(overrides: Partial<UnderstudyConfig> = {}): UnderstudyConfig {
	return {
		...DEFAULT_CONFIG,
		...overrides,
		agent: {
			...DEFAULT_CONFIG.agent,
			...overrides.agent,
		},
		channels: {
			...DEFAULT_CONFIG.channels,
			...overrides.channels,
		},
		tools: {
			...DEFAULT_CONFIG.tools,
			...overrides.tools,
		},
		memory: {
			...DEFAULT_CONFIG.memory,
			...overrides.memory,
		},
	};
}

function createPngBuffer(width = 1, height = 1): Buffer {
	const bytes = Buffer.from(ONE_BY_ONE_PNG_BASE64, "base64");
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return bytes;
}

async function createTestImage(width = 1, height = 1, filename = "tiny.png"): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "understudy-runtime-grounding-test-"));
	tempDirs.push(dir);
	const imagePath = join(dir, filename);
	await writeFile(imagePath, createPngBuffer(width, height));
	return imagePath;
}

function createRuntimeGroundingSessionMock(
	responses: string[],
	promptCalls: Array<{ text: string; options: any }>,
) {
	const session = {
		agent: {
			setSystemPrompt: vi.fn(),
			state: { messages: [] },
		},
		prompt: vi.fn(async (text: string, options?: unknown) => {
			promptCalls.push({ text, options });
		}),
		getLastAssistantText: vi.fn(() => responses.shift()),
		newSession: vi.fn(async () => true),
		dispose: vi.fn(async () => {}),
	};
	return {
		session,
		createAgentSessionImpl: vi.fn(async () => ({ session, extensionsResult: {} })) as any,
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
	clearOAuthGroundingProbeCacheForTest();
	delete process.env.UNDERSTUDY_GUI_GROUNDING_PROVIDER;
	delete process.env.UNDERSTUDY_GUI_GROUNDING_API_KEY;
	delete process.env.UNDERSTUDY_GUI_GROUNDING_MODEL;
	delete process.env.UNDERSTUDY_GUI_GROUNDING_BASE_URL;
	delete process.env.UNDERSTUDY_GUI_GROUNDING_THINKING_LEVEL;
	delete process.env.ARK_API_KEY;
	delete process.env.VOLCENGINE_ARK_API_KEY;
	delete process.env.SEED_API_KEY;
});

afterEach(async () => {
	await Promise.allSettled(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("primeGuiGroundingForConfig", () => {
	it("builds a main-model OpenAI grounding provider without mutating process env", async () => {
		const authManager = {
			findModel: vi.fn().mockReturnValue({ provider: "openai-codex", id: "gpt-5.4" }),
			getAvailableModels: vi.fn().mockReturnValue([{ provider: "openai-codex", id: "gpt-5.4" }]),
			getApiKey: vi.fn().mockResolvedValue("main-model-key"),
		};

		const resolved = await primeGuiGroundingForConfig(
			createConfig({
				defaultProvider: "openai-codex",
				defaultModel: "gpt-5.4",
			}),
			authManager as any,
			(() => ({ available: true, provider: "openai-codex", credentialType: "api_key", source: "env" })) as any,
		);

		expect(resolved.available).toBe(true);
		expect(resolved.label).toBe("main:openai-codex/gpt-5.4");
		expect(typeof resolved.groundingProvider?.ground).toBe("function");
		expect(process.env.UNDERSTUDY_GUI_GROUNDING_AVAILABLE).toBeUndefined();
		expect(process.env.UNDERSTUDY_GUI_GROUNDING_PROVIDER).toBeUndefined();
		expect(process.env.UNDERSTUDY_GUI_GROUNDING_API_KEY).toBeUndefined();
	});

	it("ignores legacy ARK env when the main-model OpenAI grounding path is available", async () => {
		process.env.ARK_API_KEY = "ark-key";
		const authManager = {
			findModel: vi.fn().mockReturnValue({ provider: "openai-codex", id: "gpt-5.4" }),
			getAvailableModels: vi.fn().mockReturnValue([{ provider: "openai-codex", id: "gpt-5.4" }]),
			getApiKey: vi.fn().mockResolvedValue("main-model-key"),
		};

		const resolved = await primeGuiGroundingForConfig(
			createConfig({
				defaultProvider: "openai-codex",
				defaultModel: "gpt-5.4",
			}),
			authManager as any,
			(() => ({ available: true, provider: "openai-codex", credentialType: "api_key", source: "env" })) as any,
		);

		expect(resolved.available).toBe(true);
		expect(resolved.label).toBe("main:openai-codex/gpt-5.4");
		expect(typeof resolved.groundingProvider?.ground).toBe("function");
		expect(authManager.getApiKey).toHaveBeenCalledTimes(1);
	});

	it("uses explicit OpenAI grounding env without consulting the main model", async () => {
		process.env.UNDERSTUDY_GUI_GROUNDING_API_KEY = "grounding-key";
		process.env.UNDERSTUDY_GUI_GROUNDING_MODEL = "gpt-4.1-mini";
		process.env.UNDERSTUDY_GUI_GROUNDING_PROVIDER = "dedicated-grounding";
		const authManager = {
			findModel: vi.fn(),
			getAvailableModels: vi.fn().mockReturnValue([]),
			getApiKey: vi.fn(),
		};

		const resolved = await primeGuiGroundingForConfig(
			createConfig(),
			authManager as any,
			(() => ({ available: true, provider: "openai-codex", credentialType: "api_key", source: "env" })) as any,
		);

		expect(resolved.available).toBe(true);
		expect(resolved.label).toBe("dedicated-grounding");
		expect(typeof resolved.groundingProvider?.ground).toBe("function");
		expect(authManager.findModel).not.toHaveBeenCalled();
	});

	it("uses the shared default OpenAI grounding model label when explicit env grounding omits a model", async () => {
		process.env.UNDERSTUDY_GUI_GROUNDING_API_KEY = "grounding-key";
		const authManager = {
			findModel: vi.fn(),
			getAvailableModels: vi.fn().mockReturnValue([]),
			getApiKey: vi.fn(),
		};

		const resolved = await primeGuiGroundingForConfig(
			createConfig(),
			authManager as any,
			(() => ({ available: true, provider: "openai-codex", credentialType: "api_key", source: "env" })) as any,
		);

		expect(resolved.available).toBe(true);
		expect(resolved.label).toBe(`openai:${DEFAULT_OPENAI_GROUNDING_MODEL}`);
		expect(typeof resolved.groundingProvider?.ground).toBe("function");
		expect(authManager.findModel).not.toHaveBeenCalled();
	});

	it("remains unavailable when the main-model grounding path is unavailable and no explicit OpenAI grounding config is present", async () => {
		process.env.ARK_API_KEY = "ark-key";
		const authManager = {
			findModel: vi.fn(),
			getAvailableModels: vi.fn().mockReturnValue([]),
			getApiKey: vi.fn(),
		};

		const resolved = await primeGuiGroundingForConfig(
			createConfig({
				defaultProvider: "anthropic",
				defaultModel: "claude-test",
			}),
			authManager as any,
			(() => ({ available: false, provider: "anthropic", credentialType: "api_key", source: "env" })) as any,
		);

		expect(resolved.available).toBe(false);
		expect(resolved.label).toBeUndefined();
		expect(resolved.groundingProvider).toBeUndefined();
		expect(authManager.findModel).not.toHaveBeenCalled();
	});

	it("prefers the explicit runtime model when selecting the main-model grounding provider", async () => {
		const explicitModel = { provider: "openai-codex", id: "gpt-5.4" };
		const authManager = {
			findModel: vi.fn(),
			getAvailableModels: vi.fn().mockReturnValue([explicitModel]),
			getApiKey: vi.fn().mockResolvedValue("explicit-model-key"),
		};

		const resolved = await primeGuiGroundingForConfig(
			createConfig({
				defaultProvider: "anthropic",
				defaultModel: "claude-test",
			}),
			authManager as any,
			((provider: string) => ({
				available: provider === "openai-codex",
				provider,
				credentialType: "api_key",
				source: "env",
			})) as any,
			{
				explicitModel: explicitModel as any,
			},
		);

		expect(resolved.available).toBe(true);
		expect(resolved.label).toBe("main:openai-codex/gpt-5.4");
		expect(authManager.getApiKey).toHaveBeenCalledWith(explicitModel);
	});

	it("can reuse an OpenAI fallback candidate from the resolved runtime model chain", async () => {
		const fallbackModel = { provider: "openai-codex", id: "gpt-5.4" };
		const authManager = {
			findModel: vi.fn(),
			getAvailableModels: vi.fn().mockReturnValue([fallbackModel]),
			getApiKey: vi.fn(async (model: { provider?: string }) =>
				model.provider === "openai-codex" ? "fallback-model-key" : undefined
			),
		};

		const resolved = await primeGuiGroundingForConfig(
			createConfig({
				defaultProvider: "anthropic",
				defaultModel: "claude-test",
			}),
			authManager as any,
			((provider: string) => ({
				available: provider === "openai-codex",
				provider,
				credentialType: "api_key",
				source: "env",
			})) as any,
			{
				modelCandidates: [
					{
						model: { provider: "anthropic", id: "claude-test" } as any,
						modelLabel: "anthropic/claude-test",
						provider: "anthropic",
						modelId: "claude-test",
						source: "default",
					},
					{
						model: fallbackModel as any,
						modelLabel: "openai-codex/gpt-5.4",
						provider: "openai-codex",
						modelId: "gpt-5.4",
						source: "fallback_chain",
					},
				],
			},
		);

		expect(resolved.available).toBe(true);
		expect(resolved.label).toBe("main:openai-codex/gpt-5.4");
	});

	it("falls back to runtime-backed grounding when oauth auth cannot access Responses API", async () => {
		const authManager = {
			findModel: vi.fn().mockReturnValue({ provider: "openai-codex", id: "gpt-5.4", input: ["text", "image"] }),
			getAvailableModels: vi.fn().mockReturnValue([{ provider: "openai-codex", id: "gpt-5.4", input: ["text", "image"] }]),
			getApiKey: vi.fn().mockResolvedValue("oauth-access-token-denied"),
		};
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
			ok: false,
			status: 403,
			json: async () => ({
				error: {
					message: "Missing scopes: api.responses.write",
				},
			}),
		}));

			const resolved = await primeGuiGroundingForConfig(
				createConfig({
					defaultProvider: "openai-codex",
					defaultModel: "gpt-5.4",
				}),
				authManager as any,
				(() => ({ available: true, provider: "openai-codex", credentialType: "oauth", source: "primary" })) as any,
			);

			expect(resolved.available).toBe(true);
		expect(resolved.label).toBe("main:openai-codex/gpt-5.4:runtime");
		expect(typeof resolved.groundingProvider?.ground).toBe("function");
		expect(authManager.findModel).toHaveBeenCalledTimes(1);
		expect(process.env.UNDERSTUDY_GUI_GROUNDING_API_KEY).toBeUndefined();
	});

	it("re-probes oauth Responses access after a denied attempt instead of caching the failure forever", async () => {
		const authManager = {
			findModel: vi.fn().mockReturnValue({ provider: "openai-codex", id: "gpt-5.4", input: ["text", "image"] }),
			getAvailableModels: vi.fn().mockReturnValue([{ provider: "openai-codex", id: "gpt-5.4", input: ["text", "image"] }]),
			getApiKey: vi.fn().mockResolvedValue("oauth-access-token-retry"),
		};
		const fetchMock = vi.fn()
			.mockResolvedValueOnce({
				ok: false,
				status: 403,
				json: async () => ({
					error: {
						message: "Missing scopes: api.responses.write",
					},
				}),
			})
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({ output_text: "ok" }),
			});
		vi.stubGlobal("fetch", fetchMock);

		const providerStatusResolver = (() => ({
			available: true,
			provider: "openai-codex",
			credentialType: "oauth",
			source: "primary",
		})) as any;

		const first = await primeGuiGroundingForConfig(
			createConfig({
				defaultProvider: "openai-codex",
				defaultModel: "gpt-5.4",
			}),
			authManager as any,
			providerStatusResolver,
		);
		const second = await primeGuiGroundingForConfig(
			createConfig({
				defaultProvider: "openai-codex",
				defaultModel: "gpt-5.4",
			}),
			authManager as any,
			providerStatusResolver,
		);

		expect(first.available).toBe(true);
		expect(first.label).toBe("main:openai-codex/gpt-5.4:runtime");
		expect(second.available).toBe(true);
		expect(second.label).toBe("main:openai-codex/gpt-5.4");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("remains unavailable when oauth auth cannot access Responses API and the model lacks image input", async () => {
		const authManager = {
			findModel: vi.fn().mockReturnValue({ provider: "openai-codex", id: "gpt-5.4", input: ["text"] }),
			getAvailableModels: vi.fn().mockReturnValue([{ provider: "openai-codex", id: "gpt-5.4", input: ["text"] }]),
			getApiKey: vi.fn().mockResolvedValue("oauth-access-token-denied"),
		};
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
			ok: false,
			status: 403,
			json: async () => ({
				error: {
					message: "Missing scopes: api.responses.write",
				},
			}),
		}));

		const resolved = await primeGuiGroundingForConfig(
			createConfig({
				defaultProvider: "openai-codex",
				defaultModel: "gpt-5.4",
			}),
			authManager as any,
			(() => ({ available: true, provider: "openai-codex", credentialType: "oauth", source: "primary" })) as any,
		);

		expect(resolved.available).toBe(false);
		expect(resolved.label).toBe("main:openai-codex/gpt-5.4");
		expect(resolved.unavailableReason).toContain("runtime fallback is unavailable");
		expect(resolved.groundingProvider).toBeUndefined();
	});

	it("enables main-model grounding when oauth auth passes the Responses API probe", async () => {
		const authManager = {
			findModel: vi.fn().mockReturnValue({ provider: "openai-codex", id: "gpt-5.4" }),
			getAvailableModels: vi.fn().mockReturnValue([{ provider: "openai-codex", id: "gpt-5.4" }]),
			getApiKey: vi.fn().mockResolvedValue("oauth-access-token-ok"),
		};
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ output_text: "ok" }),
		}));

		const resolved = await primeGuiGroundingForConfig(
			createConfig({
				defaultProvider: "openai-codex",
				defaultModel: "gpt-5.4",
			}),
			authManager as any,
			(() => ({ available: true, provider: "openai-codex", credentialType: "oauth", source: "primary" })) as any,
		);

		expect(resolved.available).toBe(true);
		expect(resolved.label).toBe("main:openai-codex/gpt-5.4");
		expect(typeof resolved.groundingProvider?.ground).toBe("function");
	});

	it("threads the configured grounding thinking level into direct OpenAI grounding requests", async () => {
		const imagePath = await createTestImage(400, 300, "direct-grounding-thinking.png");
		const authManager = {
			findModel: vi.fn().mockReturnValue({ provider: "openai-codex", id: "gpt-5.4" }),
			getAvailableModels: vi.fn().mockReturnValue([{ provider: "openai-codex", id: "gpt-5.4" }]),
			getApiKey: vi.fn().mockResolvedValue("main-model-key"),
		};
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
			output_text:
				'{"status":"resolved","confidence":0.82,"reason":"matched button","coordinate_space":"image_pixels","click_point":{"x":40,"y":24},"bbox":{"x1":20,"y1":10,"x2":60,"y2":38}}',
		}), {
			status: 200,
			headers: { "content-type": "application/json" },
		}));
		vi.stubGlobal("fetch", fetchMock);

		const resolved = await primeGuiGroundingForConfig(
			createConfig({
				defaultProvider: "openai-codex",
				defaultModel: "gpt-5.4",
			}),
			authManager as any,
			(() => ({ available: true, provider: "openai-codex", credentialType: "api_key", source: "env" })) as any,
		);

		await resolved.groundingProvider?.ground({
			imagePath,
			target: "Publish button",
		});

		const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
		expect(JSON.parse(String(request?.body))).toMatchObject({
			model: "gpt-5.4",
			reasoning: {
				effort: "medium",
				summary: "auto",
			},
		});
	});
});

describe("createOpenAIRuntimeGroundingProvider", () => {
	it("defaults runtime grounding sessions to medium thinking", async () => {
		const imagePath = await createTestImage(640, 480, "runtime-thinking-default.png");
		const promptCalls: Array<{ text: string; options: any }> = [];
		const { createAgentSessionImpl } = createRuntimeGroundingSessionMock([
			'{"status":"resolved","confidence":0.81,"reason":"matched target","coordinate_space":"image_pixels","click_point":{"x":40,"y":24},"bbox":{"x1":20,"y1":10,"x2":60,"y2":38}}',
		], promptCalls);
		const provider = createOpenAIRuntimeGroundingProvider({
			authManager: { authStorage: {}, modelRegistry: {} } as any,
			model: { provider: "openai-codex", id: "gpt-5.4", input: ["text", "image"] } as any,
			providerName: "main:openai-codex/gpt-5.4:runtime",
			createAgentSessionImpl,
		});

		await provider?.ground({
			imagePath,
			target: "Publish button",
		});

		expect(createAgentSessionImpl).toHaveBeenCalledWith(expect.objectContaining({
			thinkingLevel: "medium",
		}));
	});

	it("does not retry runtime grounding on unauthorized responses", async () => {
		const imagePath = await createTestImage(640, 480, "runtime-unauthorized.png");
		const promptCalls: Array<{ text: string; options: any }> = [];
		const { createAgentSessionImpl, session } = createRuntimeGroundingSessionMock([], promptCalls);
		session.prompt.mockRejectedValue(new Error("HTTP 401 unauthorized"));
		const provider = createOpenAIRuntimeGroundingProvider({
			authManager: { authStorage: {}, modelRegistry: {} } as any,
			model: { provider: "openai-codex", id: "gpt-5.4", input: ["text", "image"] } as any,
			providerName: "main:openai-codex/gpt-5.4:runtime",
			createAgentSessionImpl,
		});

		await expect(provider?.ground({
			imagePath,
			target: "Publish button",
		})).rejects.toThrow("HTTP 401 unauthorized");
		expect(createAgentSessionImpl).toHaveBeenCalledTimes(1);
		expect(session.prompt).toHaveBeenCalledTimes(1);
	});

	it("runs a separate validator round before accepting a grounded type target", async () => {
		const imagePath = await createTestImage(1600, 1000, "telegram-runtime.png");
		const promptCalls: Array<{ text: string; options: any }> = [];
		const responses = [
			'{"status":"resolved","confidence":0.91,"reason":"composer region","coordinate_space":"image_pixels","click_point":{"x":1100,"y":860},"bbox":{"x1":700,"y1":830,"x2":1500,"y2":900}}',
			'{"status":"pass","approved":true,"confidence":0.96,"reason":"editable composer confirmed"}',
		];
		const { createAgentSessionImpl, session } = createRuntimeGroundingSessionMock(responses, promptCalls);
		const guideImageImpl = vi.fn(async (params: { width: number; height: number }) => ({
			imagePath: await createTestImage(params.width, params.height, `guide-${params.width}x${params.height}.png`),
			cleanup: async () => {},
		}));
		const simulationImageImpl = vi.fn(async (params: { width: number; height: number }) => ({
			imagePath: await createTestImage(params.width, params.height, `simulation-${params.width}x${params.height}.png`),
			cleanup: async () => {},
		}));

		const provider = createOpenAIRuntimeGroundingProvider({
			authManager: { authStorage: {}, modelRegistry: {} } as any,
			model: { provider: "openai-codex", id: "gpt-5.4", input: ["text", "image"] } as any,
			providerName: "main:openai-codex/gpt-5.4:runtime",
			createAgentSessionImpl,
			guideImageImpl,
			simulationImageImpl,
		});

		const grounded = await provider?.ground({
			imagePath,
			target: "message composer input field with placeholder Write a message...",
			action: "type",
			groundingMode: "complex",
			locationHint: "bottom center of Telegram chat window",
		});

		expect(createAgentSessionImpl).toHaveBeenCalledTimes(1);
		expect(session.newSession).toHaveBeenCalledTimes(1);
		expect(guideImageImpl).not.toHaveBeenCalled();
		expect(promptCalls[1]?.text).toContain("You are a GUI grounding validator.");
		expect(promptCalls[1]?.text).toContain("Approve only if the simulated action lands on the exact requested target");
		expect(promptCalls[1]?.options?.images).toHaveLength(2);
		expect(grounded).toMatchObject({
			coordinateSpace: "image_pixels",
			point: { x: 740, y: 865 },
			raw: {
				selected_attempt: "validated",
				grounding_selected_round: 1,
			},
		});
	});

	it("retries a timed-out runtime stage in-place without recreating the session", async () => {
		const imagePath = await createTestImage(1280, 920, "runtime-timeout-retry.png");
		const promptCalls: Array<{ text: string; options: any }> = [];
		let promptCount = 0;
		const assistantTexts = [
			'{"status":"resolved","confidence":0.9,"reason":"matched downloads item","coordinate_space":"image_pixels","click_point":{"x":148,"y":160},"bbox":{"x1":44,"y1":138,"x2":252,"y2":182}}',
			'{"status":"pass","approved":true,"confidence":0.94,"reason":"downloads row confirmed"}',
		];
		const session = {
			agent: {
				setSystemPrompt: vi.fn(),
				state: { messages: [] },
			},
			prompt: vi.fn(async (text: string, options?: unknown) => {
				promptCalls.push({ text, options });
				promptCount += 1;
				if (promptCount === 1) {
					await new Promise((resolve) => setTimeout(resolve, 5_100));
					return;
				}
			}),
			getLastAssistantText: vi.fn(() => assistantTexts.shift()),
			newSession: vi.fn(async () => true),
			abort: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
		};
		const createAgentSessionImpl = vi.fn(async () => ({ session, extensionsResult: {} })) as any;
		const simulationImageImpl = vi.fn(async (params: { width: number; height: number }) => ({
			imagePath: await createTestImage(params.width, params.height, `simulation-timeout-${params.width}x${params.height}.png`),
			cleanup: async () => {},
		}));
		const provider = createOpenAIRuntimeGroundingProvider({
			authManager: { authStorage: {}, modelRegistry: {} } as any,
			model: { provider: "openai-codex", id: "gpt-5.4", input: ["text", "image"] } as any,
			providerName: "main:openai-codex/gpt-5.4:runtime",
			createAgentSessionImpl,
			timeoutMs: 5_000,
			simulationImageImpl,
		});

		const grounded = await provider?.ground({
			imagePath,
			target: "Downloads item",
			scope: "left sidebar",
			action: "click",
			groundingMode: "complex",
			locationHint: "upper-left sidebar column",
		});

		expect(createAgentSessionImpl).toHaveBeenCalledTimes(1);
		expect(session.abort).toHaveBeenCalledTimes(1);
		expect(session.newSession).toHaveBeenCalledTimes(2);
		expect(promptCalls).toHaveLength(3);
		expect(grounded).toMatchObject({
			point: { x: 148, y: 160 },
			raw: {
				selected_attempt: "validated",
				grounding_selected_round: 1,
			},
		});
	});

	it("retries a transient runtime server error in-place without recreating the session", async () => {
		const imagePath = await createTestImage(1280, 920, "runtime-server-error-retry.png");
		const promptCalls: Array<{ text: string; options: any }> = [];
		const assistantTexts = [
			undefined,
			'{"status":"resolved","confidence":0.9,"reason":"matched downloads item","coordinate_space":"image_pixels","click_point":{"x":148,"y":160},"bbox":{"x1":44,"y1":138,"x2":252,"y2":182}}',
			'{"status":"pass","approved":true,"confidence":0.94,"reason":"downloads row confirmed"}',
		];
		const session = {
			agent: {
				setSystemPrompt: vi.fn(),
				state: { messages: [] as Array<Record<string, unknown>> },
			},
			prompt: vi.fn(async (text: string, options?: unknown) => {
				promptCalls.push({ text, options });
				if (promptCalls.length === 1) {
					session.agent.state.messages = [{
						role: "assistant",
						stopReason: "error",
						errorMessage:
							'Codex error: {"type":"error","error":{"type":"server_error","code":"server_error","message":"temporary outage"}}',
						content: [],
						provider: "openai-codex",
						model: "gpt-5.4",
					}];
				}
			}),
			getLastAssistantText: vi.fn(() => assistantTexts.shift()),
			newSession: vi.fn(async () => true),
			abort: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
		};
		const createAgentSessionImpl = vi.fn(async () => ({ session, extensionsResult: {} })) as any;
		const simulationImageImpl = vi.fn(async (params: { width: number; height: number }) => ({
			imagePath: await createTestImage(params.width, params.height, `simulation-server-error-${params.width}x${params.height}.png`),
			cleanup: async () => {},
		}));
		const provider = createOpenAIRuntimeGroundingProvider({
			authManager: { authStorage: {}, modelRegistry: {} } as any,
			model: { provider: "openai-codex", id: "gpt-5.4", input: ["text", "image"] } as any,
			providerName: "main:openai-codex/gpt-5.4:runtime",
			createAgentSessionImpl,
			timeoutMs: 5_000,
			simulationImageImpl,
		});

		const grounded = await provider?.ground({
			imagePath,
			target: "Downloads item",
			scope: "left sidebar",
			action: "click",
			groundingMode: "complex",
			locationHint: "upper-left sidebar column",
		});

		expect(createAgentSessionImpl).toHaveBeenCalledTimes(1);
		expect(session.abort).toHaveBeenCalledTimes(1);
		expect(session.newSession).toHaveBeenCalledTimes(2);
		expect(promptCalls).toHaveLength(3);
		expect(grounded).toMatchObject({
			point: { x: 148, y: 160 },
			raw: {
				selected_attempt: "validated",
				grounding_selected_round: 1,
			},
		});
	});

	it("recreates the runtime session after repeated transient server errors", async () => {
		const imagePath = await createTestImage(1280, 920, "runtime-server-error-recreate.png");
		const firstPromptCalls: Array<{ text: string; options: any }> = [];
		const secondPromptCalls: Array<{ text: string; options: any }> = [];
		const firstSession = {
			agent: {
				setSystemPrompt: vi.fn(),
				state: { messages: [] as Array<Record<string, unknown>> },
			},
			prompt: vi.fn(async (text: string, options?: unknown) => {
				firstPromptCalls.push({ text, options });
				firstSession.agent.state.messages = [{
					role: "assistant",
					stopReason: "error",
					errorMessage:
						'Codex error: {"type":"error","error":{"type":"server_error","code":"server_error","message":"temporary outage"}}',
					content: [],
					provider: "openai-codex",
					model: "gpt-5.4",
				}];
			}),
			getLastAssistantText: vi.fn(() => undefined),
			newSession: vi.fn(async () => true),
			abort: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
		};
		const assistantTexts = [
			'{"status":"resolved","confidence":0.9,"reason":"matched downloads item","coordinate_space":"image_pixels","click_point":{"x":148,"y":160},"bbox":{"x1":44,"y1":138,"x2":252,"y2":182}}',
			'{"status":"pass","approved":true,"confidence":0.94,"reason":"downloads row confirmed"}',
		];
		const secondSession = {
			agent: {
				setSystemPrompt: vi.fn(),
				state: { messages: [] as Array<Record<string, unknown>> },
			},
			prompt: vi.fn(async (text: string, options?: unknown) => {
				secondPromptCalls.push({ text, options });
			}),
			getLastAssistantText: vi.fn(() => assistantTexts.shift()),
			newSession: vi.fn(async () => true),
			abort: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
		};
		const createAgentSessionImpl = vi
			.fn()
			.mockResolvedValueOnce({ session: firstSession, extensionsResult: {} })
			.mockResolvedValueOnce({ session: secondSession, extensionsResult: {} }) as any;
		const simulationImageImpl = vi.fn(async (params: { width: number; height: number }) => ({
			imagePath: await createTestImage(params.width, params.height, `simulation-recreate-${params.width}x${params.height}.png`),
			cleanup: async () => {},
		}));
		const provider = createOpenAIRuntimeGroundingProvider({
			authManager: { authStorage: {}, modelRegistry: {} } as any,
			model: { provider: "openai-codex", id: "gpt-5.4", input: ["text", "image"] } as any,
			providerName: "main:openai-codex/gpt-5.4:runtime",
			createAgentSessionImpl,
			timeoutMs: 5_000,
			simulationImageImpl,
		});

		const grounded = await provider?.ground({
			imagePath,
			target: "Downloads item",
			scope: "left sidebar",
			action: "click",
			groundingMode: "complex",
			locationHint: "upper-left sidebar column",
		});

		expect(createAgentSessionImpl).toHaveBeenCalledTimes(2);
		expect(firstSession.abort).toHaveBeenCalledTimes(2);
		expect(firstSession.newSession).toHaveBeenCalledTimes(2);
		expect(firstSession.dispose).toHaveBeenCalledTimes(1);
		expect(firstPromptCalls).toHaveLength(3);
		expect(secondSession.newSession).toHaveBeenCalledTimes(1);
		expect(secondPromptCalls).toHaveLength(2);
		expect(grounded).toMatchObject({
			point: { x: 148, y: 160 },
			raw: {
				selected_attempt: "validated",
				grounding_selected_round: 1,
			},
		});
	});

	it("retries with guide context after validator rejection", async () => {
		const imagePath = await createTestImage(1600, 1000, "telegram-runtime-zoom.png");
		const promptCalls: Array<{ text: string; options: any }> = [];
		const responses = [
			'{"status":"resolved","confidence":0.9,"reason":"composer region","coordinate_space":"image_pixels","click_point":{"x":1080,"y":852},"bbox":{"x1":690,"y1":822,"x2":1490,"y2":898}}',
			'{"status":"fail","approved":false,"confidence":0.28,"reason":"wrong field","retry_hint":"move lower into editor"}',
			'{"status":"resolved","confidence":0.95,"reason":"actual composer","coordinate_space":"image_pixels","click_point":{"x":320,"y":250},"bbox":{"x1":120,"y1":210,"x2":720,"y2":290}}',
			'{"status":"pass","approved":true,"confidence":0.97,"reason":"actual composer confirmed"}',
		];
		const { createAgentSessionImpl, session } = createRuntimeGroundingSessionMock(responses, promptCalls);
		const guideImageImpl = vi.fn(async (params: { width: number; height: number }) => ({
			imagePath: await createTestImage(params.width, params.height, `guide-fallback-${params.width}x${params.height}.png`),
			cleanup: async () => {},
		}));
		const simulationImageImpl = vi.fn(async (params: { width: number; height: number }) => ({
			imagePath: await createTestImage(params.width, params.height, `simulation-fallback-${params.width}x${params.height}.png`),
			cleanup: async () => {},
		}));

		const provider = createOpenAIRuntimeGroundingProvider({
			authManager: { authStorage: {}, modelRegistry: {} } as any,
			model: { provider: "openai-codex", id: "gpt-5.4", input: ["text", "image"] } as any,
			providerName: "main:openai-codex/gpt-5.4:runtime",
			createAgentSessionImpl,
			guideImageImpl,
			simulationImageImpl,
		});

		const grounded = await provider?.ground({
			imagePath,
			target: "message composer input field with placeholder Write a message...",
			action: "type",
			groundingMode: "complex",
			locationHint: "bottom center of Telegram chat window",
		});

		expect(createAgentSessionImpl).toHaveBeenCalledTimes(1);
		expect(session.newSession).toHaveBeenCalledTimes(3);
		expect(guideImageImpl).toHaveBeenCalledTimes(1);
		expect(promptCalls[1]?.text).toContain("You are a GUI grounding validator.");
		expect(promptCalls[2]?.text).toContain("Retry context:");
		expect(promptCalls[2]?.text).toContain("Failure kind: wrong point.");
		expect(promptCalls[2]?.text).toContain("validator rejected the simulated action");
		expect(promptCalls[2]?.options?.images).toHaveLength(2);
		expect(promptCalls[3]?.text).toContain("You are a GUI grounding validator.");
		expect(grounded).toMatchObject({
			point: {
				x: 320,
				y: 250,
			},
			raw: {
				selected_attempt: "validated",
				grounding_selected_round: 2,
			},
		});
	});

	it("returns undefined when complex grounding exhausts its retries", async () => {
		const imagePath = await createTestImage(1600, 1000, "telegram-runtime-fallback.png");
		const promptCalls: Array<{ text: string; options: any }> = [];
		const responses = [
			'{"status":"resolved","confidence":0.9,"reason":"composer region","coordinate_space":"image_pixels","click_point":{"x":1080,"y":852},"bbox":{"x1":690,"y1":822,"x2":1490,"y2":898}}',
			'{"status":"fail","approved":false,"confidence":0.22,"reason":"background only","retry_hint":"avoid the lower toolbar"}',
			'{"status":"not_found","found":false,"confidence":0.18,"reason":"wrong target"}',
		];
		const { createAgentSessionImpl, session } = createRuntimeGroundingSessionMock(responses, promptCalls);
		const guideImageImpl = vi.fn(async (params: { width: number; height: number }) => ({
			imagePath: await createTestImage(params.width, params.height, `guide-retry-${params.width}x${params.height}.png`),
			cleanup: async () => {},
		}));
		const simulationImageImpl = vi.fn(async (params: { width: number; height: number }) => ({
			imagePath: await createTestImage(params.width, params.height, `simulation-retry-${params.width}x${params.height}.png`),
			cleanup: async () => {},
		}));

		const provider = createOpenAIRuntimeGroundingProvider({
			authManager: { authStorage: {}, modelRegistry: {} } as any,
			model: { provider: "openai-codex", id: "gpt-5.4", input: ["text", "image"] } as any,
			providerName: "main:openai-codex/gpt-5.4:runtime",
			createAgentSessionImpl,
			guideImageImpl,
			simulationImageImpl,
		});

		await expect(provider?.ground({
			imagePath,
			target: "message composer input field with placeholder Write a message...",
			action: "type",
			groundingMode: "complex",
			locationHint: "bottom center of Telegram chat window",
		})).resolves.toBeUndefined();

		expect(createAgentSessionImpl).toHaveBeenCalledTimes(1);
		expect(session.newSession).toHaveBeenCalledTimes(2);
		expect(guideImageImpl).not.toHaveBeenCalled();
		expect(simulationImageImpl).toHaveBeenCalledTimes(1);
		expect(promptCalls[2]?.text).toContain("Retry context:");
		expect(promptCalls[2]?.text).toContain("Failure kind: wrong region.");
		expect(promptCalls[2]?.text).toContain("avoid the lower toolbar");
		expect(promptCalls[2]?.options?.images).toHaveLength(1);
	});
});
