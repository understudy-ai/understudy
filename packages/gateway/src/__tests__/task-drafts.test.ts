import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VideoTeachAnalysis } from "@understudy/tools";

const toolMocks = vi.hoisted(() => ({
	createSessionVideoTeachAnalyzer: vi.fn(),
}));

vi.mock("@understudy/tools", async () => {
	const actual = await vi.importActual<any>("@understudy/tools");
	return {
		...actual,
		createSessionVideoTeachAnalyzer: toolMocks.createSessionVideoTeachAnalyzer,
	};
});

import { createGatewayTaskDraftHandlers } from "@understudy/gateway";
import type { SessionEntry } from "@understudy/gateway";

const cleanupPaths: string[] = [];
const originalUnderstudyHome = process.env.UNDERSTUDY_HOME;
const originalArkApiKey = process.env.ARK_API_KEY;

function createTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	cleanupPaths.push(dir);
	return dir;
}

function createEntry(id: string, workspaceDir: string, repoRoot: string): SessionEntry {
	return {
		id,
		createdAt: Date.now(),
		lastActiveAt: Date.now(),
		dayStamp: "2026-03-08",
		messageCount: 0,
		session: {},
		workspaceDir,
		repoRoot,
		history: [],
		recentRuns: [
			{
				runId: "run-1",
				recordedAt: Date.now(),
				userPromptPreview: 'Generate "Q1 dashboard" and publish it.',
				responsePreview: "Generated the dashboard.",
				toolTrace: [
					{
						type: "toolCall",
						id: "call-1",
						name: "gui_click",
						route: "gui",
						arguments: { target: "Publish button", app: "Browser" },
					},
					{
						type: "toolResult",
						id: "call-1",
						name: "gui_click",
						route: "gui",
						textPreview: "Clicked Publish button.",
							status: { code: "condition_met", summary: "Publish dialog appeared." },
					},
				],
				attempts: [],
				teachValidation: {
					contract: {
						requirements: [
							{ id: "req-1", summary: "Published dashboard should be visible to the user." },
						],
					},
				},
			},
		],
	};
}

function createVideoTeachAnalysisFixture(overrides: Partial<VideoTeachAnalysis> = {}): VideoTeachAnalysis {
	return {
		title: "Publish the reviewed dashboard",
		objective: "Publish the reviewed dashboard from the moderation queue.",
		taskKind: "fixed_demo",
		parameterSlots: [{ name: "dashboard_name", sampleValue: "Q1 dashboard" }],
		successCriteria: ["Published confirmation is visible."],
		openQuestions: [],
		taskCard: {
			goal: "Publish the reviewed dashboard from the moderation queue.",
			scope: "Single reviewed dashboard publish flow.",
			loopOver: "The current dashboard review item.",
			inputs: ["Dashboard name"],
			extract: ["Published confirmation state"],
			output: "The reviewed dashboard is published.",
		},
		procedure: [
			{
				id: "procedure-1",
				index: 1,
				instruction: "Click the Publish button in the moderation panel.",
				kind: "output",
			},
		],
		executionPolicy: {
			toolBinding: "adaptive",
			preferredRoutes: ["browser", "shell", "gui"],
			stepInterpretation: "fallback_replay",
			notes: [
				"Learn the workflow, not the exact tool sequence.",
			],
		},
		stepRouteOptions: [
			{
				id: "procedure-1-route-1",
				procedureStepId: "procedure-1",
				route: "gui",
				preference: "observed",
				instruction: "Click the Publish button in the moderation panel.",
				toolName: "gui_click",
			},
		],
		replayPreconditions: [],
		resetSignals: [],
		skillDependencies: [],
		steps: [
			{
				route: "gui",
				toolName: "gui_click",
				instruction: "Click the Publish button in the moderation panel.",
				target: "Publish button",
			},
		],
		provider: "ark:doubao-seed-2-0-lite-260215",
		model: "doubao-seed-2-0-lite-260215",
		sourceLabel: "demo.mp4",
		analysisMode: "event_guided_evidence_pack",
		episodeCount: 3,
		keyframeCount: 10,
		eventCount: 4,
		evidenceSummary: "Built event-guided evidence pack, 3 episodes, 10 keyframes, 4 imported events from demo.mp4.",
		durationMs: 15_000,
		keyframes: [],
		...overrides,
	};
}

afterEach(() => {
	vi.clearAllMocks();
	while (cleanupPaths.length > 0) {
		const target = cleanupPaths.pop();
		if (!target) {
			continue;
		}
		rmSync(target, { recursive: true, force: true });
	}
	if (originalUnderstudyHome === undefined) {
		delete process.env.UNDERSTUDY_HOME;
	} else {
		process.env.UNDERSTUDY_HOME = originalUnderstudyHome;
	}
	if (originalArkApiKey === undefined) {
		delete process.env.ARK_API_KEY;
	} else {
		process.env.ARK_API_KEY = originalArkApiKey;
	}
});

describe("createGatewayTaskDraftHandlers", () => {
	it("creates, lists, updates, and publishes teach drafts from session traces", async () => {
		process.env.UNDERSTUDY_HOME = createTempDir("understudy-gateway-task-drafts-home-");
		const repoRoot = createTempDir("understudy-gateway-task-drafts-repo-");
		const workspaceDir = join(repoRoot, "app");
		cleanupPaths.push(workspaceDir);
		const entry = createEntry("session-1", workspaceDir, repoRoot);
		const sessionEntries = new Map([[entry.id, entry]]);
		const handlers = createGatewayTaskDraftHandlers({ sessionEntries });

		const created = await handlers.create({ sessionId: entry.id });
		expect(created.created).toBe(true);
		expect(created.draft.sessionId).toBe(entry.id);
		expect(created.draft.parameterSlots).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ sampleValue: "Q1 dashboard" }),
			]),
		);

		const listed = await handlers.list({ sessionId: entry.id });
		expect(listed.workspaceDir).toBe(workspaceDir);
		expect(listed.drafts).toHaveLength(1);

		const updated = await handlers.update({
			sessionId: entry.id,
			draftId: created.draft.id,
			patch: {
				title: "Publish the generated dashboard",
				taskKind: "batch_workflow",
				successCriteria: ["Published dashboard should be visible to the user.", "Publish dialog appeared."],
				taskCard: {
					goal: "Publish each reviewed dashboard from the moderation queue.",
					scope: "Batch publish reviewed dashboards.",
					loopOver: "Reviewed dashboard rows",
					inputs: ["Dashboard name"],
					extract: ["Publish confirmation state"],
					output: "All reviewed dashboards are published.",
				},
				procedure: [
					{
						instruction: "Open the moderation queue.",
						kind: "setup",
					},
				],
				executionPolicy: {
					toolBinding: "adaptive",
					preferredRoutes: ["skill", "gui"],
					stepInterpretation: "fallback_replay",
					notes: ["Prefer the reviewer login skill before replaying GUI steps."],
				},
				stepRouteOptions: [
					{
						procedureStepId: "procedure-1",
						route: "skill",
						preference: "preferred",
						instruction: "Use the reviewer-login skill to open the moderation queue when it is available.",
						skillName: "login-reviewer",
					},
				],
				replayPreconditions: ["Reviewer session is already signed in."],
				resetSignals: ["Queue list is visible again after publish."],
				skillDependencies: [
					{
						name: "login-reviewer",
						reason: "Reviewer session must be authenticated first.",
						required: true,
					},
				],
			},
		});
		expect(updated.title).toBe("Publish the generated dashboard");
		expect(updated.taskKind).toBe("batch_workflow");
		expect(updated.taskCard).toMatchObject({
			loopOver: "Reviewed dashboard rows",
		});
		expect(updated.procedure).toContainEqual(
			expect.objectContaining({ instruction: "Open the moderation queue.", kind: "setup" }),
		);
		expect(updated.executionPolicy).toMatchObject({
			preferredRoutes: ["skill", "gui"],
			notes: ["Prefer the reviewer login skill before replaying GUI steps."],
		});
		expect(updated.stepRouteOptions).toContainEqual(
			expect.objectContaining({
				procedureStepId: "procedure-1",
				route: "skill",
				skillName: "login-reviewer",
			}),
		);
		expect(updated.replayPreconditions).toEqual(["Reviewer session is already signed in."]);
		expect(updated.resetSignals).toEqual(["Queue list is visible again after publish."]);
		expect(updated.skillDependencies).toContainEqual(
			expect.objectContaining({ name: "login-reviewer", required: true }),
		);

		const published = await handlers.publish({
			sessionId: entry.id,
			draftId: created.draft.id,
			name: "publish-dashboard",
		});
		expect(published.draft.status).toBe("published");
		expect(published.skill.name).toMatch(/^taught-publish-dashboard-[a-f0-9]{6}$/);

		const loaded = await handlers.get({
			sessionId: entry.id,
			draftId: created.draft.id,
		});
		expect(loaded?.publishedSkill?.skillPath).toBe(join(workspaceDir, "skills", published.skill.name, "SKILL.md"));
	});

	it("creates teach drafts from analyzed demo videos", async () => {
		toolMocks.createSessionVideoTeachAnalyzer.mockReturnValue(undefined);
		process.env.UNDERSTUDY_HOME = createTempDir("understudy-gateway-task-drafts-video-home-");
		const repoRoot = createTempDir("understudy-gateway-task-drafts-video-repo-");
		const workspaceDir = join(repoRoot, "app");
		cleanupPaths.push(workspaceDir);
		const entry = createEntry("session-video", workspaceDir, repoRoot);
		const sessionEntries = new Map([[entry.id, entry]]);
		const handlers = createGatewayTaskDraftHandlers({
			sessionEntries,
			videoTeachAnalyzer: {
				analyze: async () => createVideoTeachAnalysisFixture({
					openQuestions: ["Confirm whether the assignee should be notified."],
					keyframes: [
						{
							path: "/tmp/evidence/demo/episode-01-kf-01.png",
							mimeType: "image/png",
							timestampMs: 2_000,
							label: "Before clicking Publish",
							kind: "before_action",
							episodeId: "episode-01",
						},
					],
				}),
			},
		});

		const created = await handlers.createFromVideo({
			sessionId: entry.id,
			videoPath: "/tmp/demo.mp4",
			objective: "Teach the publish flow",
		});
		expect(created.created).toBe(true);
		expect(created.draft).toMatchObject({
			sessionId: entry.id,
			sourceKind: "video",
			sourceLabel: "demo.mp4",
			title: "Publish the reviewed dashboard",
		});
		expect(created.draft.steps).toContainEqual(
			expect.objectContaining({ toolName: "gui_click", target: "Publish button" }),
		);
		expect(created.draft.taskCard).toMatchObject({
			goal: "Publish the reviewed dashboard from the moderation queue.",
		});
		expect(created.draft.procedure).toContainEqual(
			expect.objectContaining({ instruction: "Click the Publish button in the moderation panel." }),
		);
		expect(created.draft.executionPolicy).toMatchObject({
			toolBinding: "adaptive",
			preferredRoutes: ["browser", "shell", "gui"],
			stepInterpretation: "fallback_replay",
		});
		expect(created.draft.stepRouteOptions).toContainEqual(
			expect.objectContaining({
				procedureStepId: "procedure-1",
				route: "gui",
				preference: "observed",
				toolName: "gui_click",
			}),
		);
		expect(created.draft.skillDependencies).toEqual([]);
		expect(created.draft.validation?.mode).toBe("replay");
		expect((created.draft.sourceDetails as Record<string, unknown>)?.keyframes).toEqual([
			expect.objectContaining({
				path: "/tmp/evidence/demo/episode-01-kf-01.png",
				label: "Before clicking Publish",
			}),
		]);

		const createdViaGenericCreate = await handlers.create({
			sessionId: entry.id,
			sourceKind: "video",
			videoPath: "/tmp/demo.mp4",
			objective: "Teach the publish flow",
		});
		expect(createdViaGenericCreate.created).toBe(true);
		expect(createdViaGenericCreate.draft.sourceKind).toBe("video");
	});

	it("allows publishing video drafts without replay validation", async () => {
		toolMocks.createSessionVideoTeachAnalyzer.mockReturnValue(undefined);
		process.env.UNDERSTUDY_HOME = createTempDir("understudy-gateway-task-drafts-video-publish-home-");
		const repoRoot = createTempDir("understudy-gateway-task-drafts-video-publish-repo-");
		const workspaceDir = join(repoRoot, "app");
		cleanupPaths.push(workspaceDir);
		const entry = createEntry("session-video-publish", workspaceDir, repoRoot);
		const sessionEntries = new Map([[entry.id, entry]]);
		const handlers = createGatewayTaskDraftHandlers({
			sessionEntries,
			videoTeachAnalyzer: {
				analyze: async () => createVideoTeachAnalysisFixture(),
			},
		});

		const created = await handlers.createFromVideo({
			sessionId: entry.id,
			videoPath: "/tmp/demo.mp4",
			objective: "Teach the publish flow",
		});
		expect(created.draft.validation?.state).toBe("unvalidated");

		const published = await handlers.publish({
			sessionId: entry.id,
			draftId: created.draft.id,
		});
		expect(published.draft.status).toBe("published");
		expect(published.draft.validation?.state).toBe("unvalidated");
	});

	it("defaults teach analysis to the configured session-backed main model", async () => {
		process.env.UNDERSTUDY_HOME = createTempDir("understudy-gateway-task-drafts-configured-video-home-");
		process.env.ARK_API_KEY = "ark-key";
		const repoRoot = createTempDir("understudy-gateway-task-drafts-configured-video-repo-");
		const workspaceDir = join(repoRoot, "app");
		cleanupPaths.push(workspaceDir);
		const entry = createEntry("session-video-configured", workspaceDir, repoRoot);
		const sessionEntries = new Map([[entry.id, entry]]);
		const sessionAnalyze = vi.fn(async () => ({
			...createVideoTeachAnalysisFixture({
				title: "Stop teach recording",
				objective: "Stop the active teach recording from the terminal session.",
				parameterSlots: [],
				successCriteria: ["Recording stops successfully."],
				taskCard: {
					goal: "Stop the active teach recording from the terminal session.",
					scope: "Single terminal recording control action.",
					loopOver: "The current active recording.",
					inputs: [],
					extract: [],
					output: "Recording stops successfully.",
				},
				procedure: [
					{
						id: "procedure-1",
						index: 1,
						instruction: "Press Ctrl+C to stop the recording.",
						kind: "output",
					},
				],
				steps: [
					{
						route: "gui",
						toolName: "gui_key",
						instruction: "Press Ctrl+C to stop the recording.",
						target: "active Understudy terminal session",
					},
				],
				provider: "openai-codex:gpt-5.4",
				model: "gpt-5.4",
				episodeCount: 1,
				keyframeCount: 2,
				eventCount: 1,
				evidenceSummary: "Built event-guided evidence pack, 1 episode, 2 keyframes, 1 imported event from demo.mp4.",
				durationMs: 3_000,
			}),
		}));
		toolMocks.createSessionVideoTeachAnalyzer.mockReturnValue({
			analyze: sessionAnalyze,
		});

		const handlers = createGatewayTaskDraftHandlers({
			sessionEntries,
			config: {
				defaultProvider: "openai-codex",
				defaultModel: "gpt-5.4",
				defaultThinkingLevel: "off",
			} as any,
		});

		const created = await handlers.createFromVideo({
			sessionId: entry.id,
			videoPath: "/tmp/demo.mp4",
		});

		expect(toolMocks.createSessionVideoTeachAnalyzer).toHaveBeenCalledWith(expect.objectContaining({
			config: expect.objectContaining({
				defaultProvider: "openai-codex",
				defaultModel: "gpt-5.4",
			}),
			cwd: undefined,
		}));
		expect(sessionAnalyze).toHaveBeenCalledTimes(1);
		expect(sessionAnalyze).toHaveBeenCalledWith(expect.objectContaining({
			capabilitySnapshot: expect.objectContaining({
				tools: expect.arrayContaining([
					expect.objectContaining({ name: "browser" }),
					expect.objectContaining({ name: "gui_click" }),
				]),
				skills: expect.any(Array),
			}),
		}));
		expect(created.draft.sourceDetails).toEqual(expect.objectContaining({
			analyzerProvider: "openai-codex:gpt-5.4",
			analyzerModel: "gpt-5.4",
		}));
	});

});
