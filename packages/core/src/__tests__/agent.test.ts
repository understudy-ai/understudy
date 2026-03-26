import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildTaughtTaskDraftFromRun,
	persistTaughtTaskDraft,
} from "../task-drafts.js";
import { publishWorkflowCrystallizedSkill } from "../workflow-crystallization.js";

const mocks = vi.hoisted(() => ({
	setSystemPrompt: vi.fn(),
	createAgentSession: vi.fn(),
	getModel: vi.fn(),
	authCreate: vi.fn(),
	authSet: vi.fn(),
	authHas: vi.fn(),
	authGet: vi.fn(),
	authList: vi.fn(),
	modelRegistryFind: vi.fn(),
}));

vi.mock("@mariozechner/pi-coding-agent", async () => {
	const actual = await vi.importActual<any>("@mariozechner/pi-coding-agent");
	class MockModelRegistry {
		constructor(
			public authStorage: unknown,
			public modelsPath?: string,
		) {}

		find = mocks.modelRegistryFind;
	}

	return {
		...actual,
		createAgentSession: mocks.createAgentSession,
		AuthStorage: {
			create: mocks.authCreate.mockImplementation(() => ({
				setRuntimeApiKey: vi.fn(),
				set: mocks.authSet,
				has: mocks.authHas,
				get: mocks.authGet,
				list: mocks.authList,
			})),
		},
		ModelRegistry: MockModelRegistry,
	};
});

vi.mock("@mariozechner/pi-ai", async () => {
	const actual = await vi.importActual<any>("@mariozechner/pi-ai");
	return {
		...actual,
		getModel: mocks.getModel,
	};
});

import { createUnderstudySession, resolveRuntimeBackendForSession } from "../agent.js";

const ONE_BY_ONE_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6W2y0AAAAASUVORK5CYII=";

function makeSessionResult() {
	return {
		session: {
			agent: {
				setSystemPrompt: mocks.setSystemPrompt,
				state: { messages: [] },
			},
			prompt: vi.fn().mockResolvedValue(undefined),
		},
		extensionsResult: {},
	} as any;
}

async function createTestImage(name = "test.png"): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "understudy-agent-image-"));
	const imagePath = join(dir, name);
	await writeFile(imagePath, Buffer.from(ONE_BY_ONE_PNG_BASE64, "base64"));
	return imagePath;
}

describe("createUnderstudySession", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env = { ...originalEnv };
		mocks.createAgentSession.mockResolvedValue(makeSessionResult());
		mocks.getModel.mockReturnValue({ provider: "anthropic", id: "claude-sonnet-4-6" } as any);
		mocks.authHas.mockReturnValue(false);
		mocks.authGet.mockReturnValue(undefined);
		mocks.authList.mockReturnValue([]);
		mocks.modelRegistryFind.mockReturnValue(undefined);
	});

	afterEach(() => {
		process.env = originalEnv;
		vi.useRealTimers();
	});

	it("builds session with trusted custom tools and system prompt", async () => {
		const extraTool: AgentTool<any> = {
			name: "demo_tool",
			label: "Demo",
			description: "Demo tool",
			parameters: Type.Object({ value: Type.String() }),
			execute: vi.fn(async () => ({
				content: [{ type: "text" as const, text: "ok" }],
				details: {},
			})),
		};

		const rawTool: AgentTool<any> = {
			name: "raw_tool",
			label: "Raw",
			description: "Raw tool def",
			parameters: Type.Object({}),
			execute: vi.fn(async () => ({ content: [{ type: "text" as const, text: "raw" }], details: {} })),
		};

		const sessionManager = { id: "sm1" } as any;

		const result = await createUnderstudySession({
			cwd: "/tmp/understudy",
			config: {
				defaultThinkingLevel: "off",
				agent: {
					identity: "Understudy",
					modelAliasLines: ["fast -> google/gemini-2.5-flash"],
				},
			},
			extraTools: [extraTool, rawTool],
			sessionManager,
		});

		expect(result.session).toBeDefined();
		expect(mocks.setSystemPrompt).toHaveBeenCalledTimes(1);
		expect(mocks.setSystemPrompt.mock.calls[0][0]).toContain("Understudy");
		expect(mocks.setSystemPrompt.mock.calls[0][0]).toContain("demo_tool");
		expect(mocks.setSystemPrompt.mock.calls[0][0]).toContain("## Model Aliases");
		expect(mocks.setSystemPrompt.mock.calls[0][0]).toContain("fast -> google/gemini-2.5-flash");
		expect(mocks.setSystemPrompt.mock.calls[0][0]).not.toContain("## Identity Policy");
		expect(result.sessionMeta.workspaceDir).toBe("/tmp/understudy");
		expect(result.sessionMeta.backend).toBe("embedded");
		expect(result.sessionMeta.promptReport.systemPrompt.chars).toBeGreaterThan(0);
		expect(result.sessionMeta.promptReport.tools.entries.some((entry) => entry.name === "demo_tool")).toBe(true);
		expect(result.sessionMeta.promptReport.tools.entries.some((entry) => entry.name === "raw_tool")).toBe(true);

		expect(mocks.createAgentSession).toHaveBeenCalledTimes(1);
		const args = mocks.createAgentSession.mock.calls[0][0] as any;
		expect(args.cwd).toBe("/tmp/understudy");
		expect(args.tools).toEqual([]);
		expect(args.thinkingLevel).toBeUndefined();
		expect(args.sessionManager).toBe(sessionManager);
		expect(args.authStorage).toBeDefined();
		expect(args.modelRegistry).toBeDefined();
		expect(args.customTools.map((t: any) => t.name)).toContain("demo_tool");
		expect(args.customTools.map((t: any) => t.name)).toContain("raw_tool");
		expect(args.customTools.map((t: any) => t.name)).toContain("read");
	});

	it("injects persisted teach drafts into the session prompt for the current workspace", async () => {
		const homeDir = await mkdtemp(join(tmpdir(), "understudy-agent-home-"));
		const workspaceDir = await mkdtemp(join(tmpdir(), "understudy-agent-workspace-"));
		process.env.UNDERSTUDY_HOME = homeDir;

		const draft = buildTaughtTaskDraftFromRun({
			workspaceDir,
			repoRoot: workspaceDir,
			sessionId: "s-teach",
			traceId: "trace-teach",
			runId: "run-teach",
			promptPreview: "Send the weekly deployment report",
			responsePreview: "Drafted the deployment report",
			toolTrace: [
				{ type: "toolCall", name: "browser", route: "browser" },
				{ type: "toolCall", name: "gui_click", route: "gui" },
			] as any,
			teachValidation: {
				state: "validated",
				summary: "Replay validation passed.",
				mode: "replay",
				checks: [{ id: "check-1", ok: true, summary: "Report draft exists." }],
			} as any,
			title: "Send weekly deployment report",
			objective: "Send the weekly deployment report",
		});
		await persistTaughtTaskDraft(draft);

		await createUnderstudySession({
			cwd: workspaceDir,
			config: {
				defaultThinkingLevel: "off",
				agent: {
					identity: "Understudy",
				},
			},
		});

		expect(mocks.setSystemPrompt).toHaveBeenCalledTimes(1);
		const prompt = mocks.setSystemPrompt.mock.calls[0][0] as string;
		expect(prompt).toContain("## Teach Drafts");
		expect(prompt).toContain("Send weekly deployment report");
		expect(prompt).toContain(`draft_id=${draft.id}`);
		expect(prompt).toContain("validation=validated");
	});

	it("loads published crystallized workflow skills through the normal workspace skills section", async () => {
		const homeDir = await mkdtemp(join(tmpdir(), "understudy-agent-home-"));
		const workspaceDir = await mkdtemp(join(tmpdir(), "understudy-agent-workspace-"));
		process.env.UNDERSTUDY_HOME = homeDir;

		await publishWorkflowCrystallizedSkill({
			workspaceDir,
			skill: {
				id: "skill-1",
				clusterId: "cluster-1",
				title: "Refresh the staging dashboard and post the summary",
				objective: "Refresh the staging dashboard and post the summary",
				summary: "Recurring workflow inferred from repeated dashboard update sessions.",
				triggers: ["refresh staging dashboard", "post staging summary"],
				parameterSlots: [
					{
						name: "target_channel",
						label: "Target Channel",
						required: true,
					},
				],
				stages: [
					{
						title: "Refresh the dashboard state",
						goal: "Get the current staging state before writing the summary.",
						instructions: [
							"Open the staging dashboard or equivalent data source.",
							"Refresh the relevant view and confirm the latest state is visible.",
						],
					},
					{
						title: "Prepare and send the summary",
						goal: "Turn the refreshed state into the requested outbound summary.",
						instructions: [
							"Summarize the updated state for the requested target channel.",
							"Post the summary to the destination and verify delivery.",
						],
					},
				],
				routeOptions: [
					{
						route: "browser",
						preference: "preferred",
						instruction: "Use browser automation to refresh the dashboard before posting the summary.",
						toolName: "browser",
					},
				],
				successCriteria: [
					"The dashboard shows refreshed data.",
					"The summary message is posted to the target destination.",
				],
				failurePolicy: [
					"If browser automation is unavailable, fall back to the observed GUI path.",
				],
				sourceEpisodeIds: ["ep-1", "ep-2", "ep-3"],
				sourceEpisodeCount: 3,
				successfulEpisodeCount: 3,
				observedStatusCounts: {
					completeCount: 3,
					partialCount: 0,
					failedCount: 0,
				},
				lastSynthesizedAt: Date.now(),
			},
			overwrite: true,
		});

		await createUnderstudySession({
			cwd: workspaceDir,
			config: {
				defaultThinkingLevel: "off",
				agent: {
					identity: "Understudy",
				},
			},
		});

		expect(mocks.setSystemPrompt).toHaveBeenCalledTimes(1);
		const prompt = mocks.setSystemPrompt.mock.calls[0][0] as string;
		expect(prompt).toContain("## Skills (mandatory)");
		expect(prompt).toContain("crystallized-refresh-the-staging-dashboard");
		expect(prompt).toContain("Recurring workflow inferred from repeated dashboard update sessions.");
		expect(prompt).not.toContain("## Crystallized Workflows");
	});

	it("filters exposed tools when allowedToolNames is provided", async () => {
		const extraTool: AgentTool<any> = {
			name: "demo_tool",
			label: "Demo",
			description: "Demo tool",
			parameters: Type.Object({ value: Type.String() }),
			execute: vi.fn(async () => ({
				content: [{ type: "text" as const, text: "ok" }],
				details: {},
			})),
		};

		await createUnderstudySession({
			cwd: "/tmp/understudy",
			config: {
				defaultThinkingLevel: "off",
				agent: {
					identity: "Understudy",
				},
			},
			extraTools: [extraTool],
			allowedToolNames: ["read", "demo_tool"],
		});

		expect(mocks.createAgentSession).toHaveBeenCalledTimes(1);
		const args = mocks.createAgentSession.mock.calls[0][0] as any;
		expect(args.customTools.map((t: any) => t.name).sort()).toEqual(["demo_tool", "read"]);
		const prompt = mocks.setSystemPrompt.mock.calls[0][0] as string;
		expect(prompt).toContain("demo_tool");
		expect(prompt).toContain("read");
		expect(prompt).not.toContain("- bash:");
		expect(prompt).not.toContain("- write:");
	});

	it("routes extra tools through trust and runtime policy wrappers", async () => {
		const rawToolExecute = vi.fn(async (_toolCallId, params: any) => ({
			content: [{ type: "text" as const, text: params.value }],
			details: { value: params.value },
		}));
		const rawTool: AgentTool<any> = {
			name: "raw_tool",
			label: "Raw",
			description: "Raw tool def",
			parameters: Type.Object({ value: Type.String() }),
			execute: rawToolExecute,
		};
		const runtimePolicy = {
			name: "rewrite-raw-tool",
			beforeTool: async (_context: any, input: any) => ({
				params: { ...input.params, value: "rewritten" },
				signal: input.signal,
				onUpdate: input.onUpdate,
			}),
		};

		await createUnderstudySession({
			cwd: "/tmp/understudy",
			config: {
				defaultThinkingLevel: "off",
				tools: {
					policies: [{ match: ["raw_tool"], action: "deny" }],
				},
			} as any,
			extraTools: [rawTool],
			runtimePolicies: [runtimePolicy as any],
		});

		let args = mocks.createAgentSession.mock.calls[0][0] as any;
		let result = await args.customTools
			.find((tool: any) => tool.name === "raw_tool")
			.execute("tool-1", { value: "original" }, new AbortController().signal);
		expect((result.details as any).denied).toBe(true);
		expect(rawToolExecute).not.toHaveBeenCalled();

		mocks.createAgentSession.mockClear();
		mocks.setSystemPrompt.mockClear();
		rawToolExecute.mockClear();
		mocks.createAgentSession.mockResolvedValue(makeSessionResult());

		await createUnderstudySession({
			cwd: "/tmp/understudy",
			config: {
				defaultThinkingLevel: "off",
			} as any,
			extraTools: [rawTool],
			runtimePolicies: [runtimePolicy as any],
		});

		args = mocks.createAgentSession.mock.calls[0][0] as any;
		result = await args.customTools
			.find((tool: any) => tool.name === "raw_tool")
			.execute("tool-2", { value: "original" }, new AbortController().signal);
		expect((result.details as any).value).toBe("rewritten");
		expect(rawToolExecute).toHaveBeenCalledTimes(1);
	});

	it("keeps only the exec compatibility fallback when canonical tools exist", async () => {
		const messageTool: AgentTool<any> = {
			name: "message_send",
			label: "Message",
			description: "Send messages",
			parameters: Type.Object({ text: Type.String() }),
			execute: vi.fn(async () => ({
				content: [{ type: "text" as const, text: "sent" }],
				details: {},
			})),
		};
		const scheduleTool: AgentTool<any> = {
			name: "schedule",
			label: "Schedule",
			description: "Manage scheduled jobs",
			parameters: Type.Object({ action: Type.String() }),
			execute: vi.fn(async () => ({
				content: [{ type: "text" as const, text: "scheduled" }],
				details: {},
			})),
		};

		await createUnderstudySession({
			cwd: "/tmp/understudy",
			config: {
				defaultThinkingLevel: "off",
				agent: {
					identity: "Understudy",
				},
			},
			extraTools: [messageTool, scheduleTool],
		});

		const args = mocks.createAgentSession.mock.calls[0][0] as any;
		const customToolNames = args.customTools.map((tool: any) => tool.name);
		expect(customToolNames).toContain("message_send");
		expect(customToolNames).toContain("schedule");
		expect(customToolNames).toContain("exec");
		expect(customToolNames).not.toContain("message");
		expect(customToolNames).not.toContain("cron");

		const prompt = mocks.setSystemPrompt.mock.calls[0][0] as string;
		expect(prompt).toContain("message_send");
		expect(prompt).toContain("schedule");
		expect(prompt).toContain("bash");
		expect(prompt).toContain("- exec:");
		expect(prompt).not.toContain("- message:");
		expect(prompt).not.toContain("- cron:");
	});

	it("passes prompt override options into the built system prompt", async () => {
		await createUnderstudySession({
			cwd: "/tmp/understudy",
			config: {
				defaultThinkingLevel: "off",
				agent: {
					identity: "Understudy",
				},
			},
			extraSystemPrompt: "You are handling a delegated child session.",
			reactionGuidance: { level: "minimal", channel: "telegram" },
			reasoningTagHint: true,
			reasoningLevel: "on",
			sandboxInfo: {
				enabled: true,
				workspaceDir: "/tmp/understudy",
				workspaceAccess: "rw",
			},
		});

		expect(mocks.setSystemPrompt).toHaveBeenCalledTimes(1);
		const prompt = mocks.setSystemPrompt.mock.calls[0][0];
		expect(prompt).toContain("## Group Chat Context");
		expect(prompt).toContain("delegated child session");
		expect(prompt).toContain("## Reactions");
		expect(prompt).toContain("telegram");
		expect(prompt).toContain("## Reasoning Format");
		expect(prompt).toContain("Reasoning: on");
		expect(prompt).toContain("## Sandbox");
		expect(prompt).toContain("Sandbox host mount source: /tmp/understudy");
	});

	it("passes explicit model/thinking level and tolerates getModel errors", async () => {
		mocks.getModel.mockImplementationOnce(() => {
			throw new Error("model lookup failed");
		});

		await createUnderstudySession({
			config: { defaultProvider: "anthropic", defaultModel: "unknown", defaultThinkingLevel: "off" },
			thinkingLevel: "low",
		});

		expect(mocks.createAgentSession).toHaveBeenCalledTimes(1);
		const args = mocks.createAgentSession.mock.calls[0][0] as any;
		expect(args.model).toBeUndefined();
		expect(args.thinkingLevel).toBe("low");
	});

	it("uses resolved model when available", async () => {
		await createUnderstudySession({
			config: {
				defaultProvider: "anthropic",
				defaultModel: "claude-sonnet-4-6",
				defaultThinkingLevel: "medium",
			},
		});

		const args = mocks.createAgentSession.mock.calls[0][0] as any;
		expect(mocks.getModel).toHaveBeenCalledWith("anthropic", "claude-sonnet-4-6");
		expect(args.model).toMatchObject({ provider: "anthropic", id: "claude-sonnet-4-6" });
		expect(args.thinkingLevel).toBe("medium");
	});

	it("uses fallback model when primary model resolution fails", async () => {
		mocks.getModel
			.mockImplementationOnce(() => {
				throw new Error("primary missing");
			})
			.mockImplementationOnce((_provider: string, _model: string) => ({
				provider: "google",
				id: "gemini-3-flash-preview",
			}));

		await createUnderstudySession({
			config: {
				defaultProvider: "anthropic",
				defaultModel: "not-found",
				defaultThinkingLevel: "off",
				agent: {
					modelFallbacks: ["google/gemini-3-flash-preview"],
				},
			} as any,
		});

		const args = mocks.createAgentSession.mock.calls[0][0] as any;
		expect(mocks.getModel).toHaveBeenCalledWith("anthropic", "not-found");
		expect(mocks.getModel).toHaveBeenCalledWith("google", "gemini-3-flash-preview");
		expect(args.model).toMatchObject({ provider: "google", id: "gemini-3-flash-preview" });
	});

	it("retries session creation with the next fallback model on auth/model errors", async () => {
		mocks.getModel.mockImplementation((provider: string, modelId: string) => ({
			provider,
			id: modelId,
		}) as any);
		mocks.createAgentSession
			.mockRejectedValueOnce(new Error("401 unauthorized: invalid api key"))
			.mockResolvedValueOnce(makeSessionResult());

		const result = await createUnderstudySession({
			config: {
				defaultProvider: "anthropic",
				defaultModel: "claude-sonnet-4-6",
				defaultThinkingLevel: "off",
				agent: {
					modelFallbacks: ["google/gemini-3-flash-preview"],
				},
			} as any,
		});

		expect(mocks.createAgentSession).toHaveBeenCalledTimes(2);
		expect(mocks.createAgentSession.mock.calls[0][0].model).toMatchObject({
			provider: "anthropic",
			id: "claude-sonnet-4-6",
		});
		expect(mocks.createAgentSession.mock.calls[1][0].model).toMatchObject({
			provider: "google",
			id: "gemini-3-flash-preview",
		});
		expect(result.sessionMeta.model).toBe("google/gemini-3-flash-preview");
		expect(mocks.setSystemPrompt.mock.calls[0][0]).toContain("model=google/gemini-3-flash-preview");
	});

	it("does not retry session creation on non-model/auth failures", async () => {
		mocks.getModel.mockImplementation((provider: string, modelId: string) => ({
			provider,
			id: modelId,
		}) as any);
		mocks.createAgentSession.mockRejectedValueOnce(new Error("workspace directory missing"));

		await expect(
			createUnderstudySession({
				config: {
					defaultProvider: "anthropic",
					defaultModel: "claude-sonnet-4-6",
					defaultThinkingLevel: "off",
					agent: {
						modelFallbacks: ["google/gemini-3-flash-preview"],
					},
				} as any,
			}),
		).rejects.toThrow("workspace directory missing");

		expect(mocks.createAgentSession).toHaveBeenCalledTimes(1);
	});

	it("retries prompt once after recovering from a context overflow", async () => {
		mocks.getModel.mockReturnValue({
			provider: "anthropic",
			id: "claude-sonnet-4-6",
			contextWindow: 300,
		} as any);

		const sessionResult = makeSessionResult();
		sessionResult.session.agent.state.messages = Array.from({ length: 18 }, (_, index) => ({
			role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
			content:
				index % 2 === 0
					? `user-${index}:${"U".repeat(260)}`
					: [{ type: "text" as const, text: `assistant-${index}:${"A".repeat(260)}` }],
			timestamp: Date.now() + index,
		}));
		const basePrompt = vi.fn()
			.mockRejectedValueOnce(new Error("maximum context length exceeded"))
			.mockResolvedValueOnce(undefined);
		sessionResult.session.prompt = basePrompt;
		mocks.createAgentSession.mockResolvedValueOnce(sessionResult);

		const result = await createUnderstudySession({
			config: {
				defaultProvider: "anthropic",
				defaultModel: "claude-sonnet-4-6",
				defaultThinkingLevel: "off",
			},
		});

		await result.session.prompt("hello");

		expect(basePrompt).toHaveBeenCalledTimes(2);
		expect(result.session.agent.state.messages.length).toBeLessThan(18);
		const latestMessage = result.session.agent.state.messages.at(-1) as any;
		const latestText =
			typeof latestMessage?.content === "string"
				? latestMessage.content
				: latestMessage?.content?.[0]?.text;
		expect(latestText).toContain("assistant-17");
	});

	it("retries transient prompt dispatch failures when no new turn state was recorded", async () => {
		mocks.getModel.mockReturnValue({
			provider: "openai-codex",
			id: "gpt-5.4",
			contextWindow: 128_000,
		} as any);

		const sessionResult = makeSessionResult();
		const basePrompt = vi.fn()
			.mockRejectedValueOnce(new Error('Codex error: {"type":"error","error":{"type":"server_error","code":"server_error","message":"temporary outage"}}'))
			.mockResolvedValueOnce(undefined);
		sessionResult.session.prompt = basePrompt;
		mocks.createAgentSession.mockResolvedValueOnce(sessionResult);

		const result = await createUnderstudySession({
			config: {
				defaultProvider: "openai-codex",
				defaultModel: "gpt-5.4",
				defaultThinkingLevel: "off",
			},
		});

		await result.session.prompt("hello");

		expect(basePrompt).toHaveBeenCalledTimes(2);
	});

	it("keeps interactive prompt text unchanged before dispatch", async () => {
		const sessionResult = makeSessionResult();
		const basePrompt = sessionResult.session.prompt;
		mocks.createAgentSession.mockResolvedValueOnce(sessionResult);

		const result = await createUnderstudySession({
			config: {
				defaultProvider: "anthropic",
				defaultModel: "claude-sonnet-4-6",
				defaultThinkingLevel: "off",
				agent: {
					userTimezone: "Asia/Hong_Kong",
				} as any,
			},
		});

		await result.session.prompt("hello");

		expect(basePrompt).toHaveBeenCalledWith("hello", undefined);
	});

	it("auto-loads prompt image paths for vision-capable models", async () => {
		const imagePath = await createTestImage("vision-native.png");
		mocks.getModel.mockReturnValue({
			provider: "openai",
			id: "gpt-5",
			input: ["text", "image"],
		} as any);

		const sessionResult = makeSessionResult();
		const basePrompt = sessionResult.session.prompt;
		mocks.createAgentSession.mockResolvedValueOnce(sessionResult);

		const result = await createUnderstudySession({
			config: {
				defaultProvider: "openai",
				defaultModel: "gpt-5",
				defaultThinkingLevel: "off",
			},
		});

		await result.session.prompt(`Please inspect ${imagePath}`);

		expect(basePrompt).toHaveBeenCalledTimes(1);
		expect(basePrompt.mock.calls[0]?.[0]).toEqual(expect.stringContaining(`Please inspect ${imagePath}`));
		expect(basePrompt.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
			images: [
				expect.objectContaining({
					type: "image",
					mimeType: "image/png",
				}),
			],
		}));
		expect(mocks.setSystemPrompt.mock.calls[0][0]).toContain("## Image Input Mode");
		expect(mocks.setSystemPrompt.mock.calls[0][0]).toContain("supports native image input");
	});

	it("suppresses direct prompt images for non-vision models and points the agent at vision_read", async () => {
		const imagePath = await createTestImage("vision-sidecar.png");
		mocks.getModel.mockReturnValue({
			provider: "anthropic",
			id: "claude-sonnet-4-6",
			input: ["text"],
		} as any);

		const sessionResult = makeSessionResult();
		const basePrompt = sessionResult.session.prompt;
		mocks.createAgentSession.mockResolvedValueOnce(sessionResult);

		const result = await createUnderstudySession({
			config: {
				defaultProvider: "anthropic",
				defaultModel: "claude-sonnet-4-6",
				defaultThinkingLevel: "off",
			},
		});

		await result.session.prompt(`Inspect ${imagePath}`, {
			images: [
				{
					type: "image",
					data: "ZmFrZQ==",
					mimeType: "image/png",
				},
			],
		});

		expect(basePrompt).toHaveBeenCalledTimes(1);
		expect(basePrompt.mock.calls[0]?.[0]).toEqual(expect.stringContaining("Use `vision_read` on referenced image paths or URLs"));
		expect(basePrompt.mock.calls[0]?.[1]).toBeUndefined();
		expect(mocks.setSystemPrompt.mock.calls[0][0]).toContain("does not support native image input");
	});

	it("resolves runtime backend with opts/env/config precedence", async () => {
		process.env.UNDERSTUDY_RUNTIME_BACKEND = "embedded";

		expect(
			await resolveRuntimeBackendForSession({
				runtimeBackend: "embedded",
				config: { agent: { runtimeBackend: "embedded" } as any } as any,
			}),
		).toBe("embedded");

		expect(
			await resolveRuntimeBackendForSession({
				config: { agent: { runtimeBackend: "embedded" } as any } as any,
			}),
		).toBe("embedded");

		delete process.env.UNDERSTUDY_RUNTIME_BACKEND;
		expect(
			await resolveRuntimeBackendForSession({
				config: { agent: { runtimeBackend: "acp" } as any } as any,
			}),
		).toBe("acp");
	});
});
