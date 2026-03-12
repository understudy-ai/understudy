import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const coreMocks = vi.hoisted(() => ({
	createUnderstudySession: vi.fn(),
}));

vi.mock("@understudy/core", async () => {
	const actual = await vi.importActual<any>("@understudy/core");
	return {
		...actual,
		createUnderstudySession: coreMocks.createUnderstudySession,
	};
});

import {
	buildDemonstrationEvidencePack,
	createResponsesApiVideoTeachAnalyzer,
	createSessionVideoTeachAnalyzer,
} from "../video-teach-analyzer.js";

const cleanupDirs: string[] = [];
const TINY_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6r9xkAAAAASUVORK5CYII=";

async function createTempDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	cleanupDirs.push(dir);
	return dir;
}

afterEach(async () => {
	vi.clearAllMocks();
	while (cleanupDirs.length > 0) {
		const dir = cleanupDirs.pop();
		if (!dir) continue;
		await rm(dir, { recursive: true, force: true });
	}
});

describe("video teach analyzer", () => {
	it("builds an event-guided evidence pack from a demo video request", async () => {
		const pack = await buildDemonstrationEvidencePack({
			videoPath: "/tmp/demo.mp4",
			sourceLabel: "demo.mp4",
			events: [
				{ type: "mouse_up", timestampMs: 900, app: "Browser", target: "Publish button" },
				{ type: "focus_changed", timestampMs: 1_150, app: "Browser", detail: "Publish dialog" },
				{ type: "mouse_drag_start", timestampMs: 6_000, app: "Finder" },
				{ type: "mouse_drag_end", timestampMs: 7_200, app: "Finder", target: "Desktop" },
			],
			maxEpisodes: 4,
			maxKeyframes: 8,
		}, {
			durationProbe: async () => 12_000,
			sceneDetector: async () => [4_000, 9_500],
			frameExtractor: async ({ outputPath }) => {
				await writeFile(outputPath, Buffer.from(TINY_PNG, "base64"));
			},
		});
		if (pack.tempDir) {
			cleanupDirs.push(pack.tempDir);
		}

		expect(pack.analysisMode).toBe("event_guided_evidence_pack");
		expect(pack.episodes.length).toBeGreaterThan(0);
		expect(pack.keyframes.length).toBeGreaterThan(0);
		expect(pack.events).toHaveLength(4);
		expect(pack.episodes.some((episode) => episode.triggerTypes.includes("mouse_up"))).toBe(true);
		expect(pack.summary).toContain("event-guided evidence pack");
	});

	it("avoids scheduling keyframes at the exact end of the video", async () => {
		const observedTimestamps: number[] = [];
		const pack = await buildDemonstrationEvidencePack({
			videoPath: "/tmp/demo.mp4",
			sourceLabel: "demo.mp4",
			events: [
				{ type: "mouse_up", timestampMs: 980, app: "Browser", target: "Publish button" },
			],
			maxEpisodes: 1,
			maxKeyframes: 2,
		}, {
			durationProbe: async () => 1_000,
			sceneDetector: async () => [],
			frameExtractor: async ({ outputPath, timestampMs }) => {
				observedTimestamps.push(timestampMs);
				await writeFile(outputPath, Buffer.from(TINY_PNG, "base64"));
			},
		});
		if (pack.tempDir) {
			cleanupDirs.push(pack.tempDir);
		}

		expect(observedTimestamps.length).toBeGreaterThan(0);
		expect(Math.max(...observedTimestamps)).toBeLessThan(1_000);
	});

	it("persists keyframes to a requested output directory", async () => {
		const dir = await createTempDir("understudy-video-teach-persist-");
		const outputDir = join(dir, "keyframes");
		const pack = await buildDemonstrationEvidencePack({
			videoPath: "/tmp/demo.mp4",
			sourceLabel: "demo.mp4",
			events: [
				{ type: "mouse_up", timestampMs: 900, app: "Browser", target: "Publish button" },
			],
			maxEpisodes: 1,
			maxKeyframes: 2,
			keyframeOutputDir: outputDir,
		}, {
			durationProbe: async () => 12_000,
			sceneDetector: async () => [],
			frameExtractor: async ({ outputPath }) => {
				await writeFile(outputPath, Buffer.from(TINY_PNG, "base64"));
			},
		});

		expect(pack.tempDir).toBeUndefined();
		expect(pack.keyframes[0]?.path).toContain(outputDir);
		expect(await readFile(pack.keyframes[0]!.path)).toBeTruthy();
	});

	it("retries slightly earlier when ffmpeg exits without producing a frame", async () => {
		const dir = await createTempDir("understudy-video-teach-");
		const fixturePath = join(dir, "fixture.png");
		const callLogPath = join(dir, "ffmpeg-calls.log");
		const markerPath = join(dir, "skip-once.marker");
		const ffmpegPath = join(dir, "fake-ffmpeg.mjs");
		await writeFile(fixturePath, Buffer.from(TINY_PNG, "base64"));
		await writeFile(ffmpegPath, `#!/usr/bin/env node
import { appendFileSync, closeSync, copyFileSync, existsSync, openSync } from "node:fs";

const callLogPath = ${JSON.stringify(callLogPath)};
const markerPath = ${JSON.stringify(markerPath)};
const fixturePath = ${JSON.stringify(fixturePath)};
let timestampSeconds = "";
for (let index = 0; index < process.argv.length; index += 1) {
\tif (process.argv[index] === "-ss") {
\t\ttimestampSeconds = process.argv[index + 1] ?? "";
\t}
}
appendFileSync(callLogPath, \`\${timestampSeconds}\\n\`);
const outputPath = process.argv[process.argv.length - 1];
if (!existsSync(markerPath)) {
\tcloseSync(openSync(markerPath, "w"));
\tprocess.exit(0);
}
copyFileSync(fixturePath, outputPath);
`);
		await chmod(ffmpegPath, 0o755);

		const pack = await buildDemonstrationEvidencePack({
			videoPath: "/tmp/demo.mp4",
			sourceLabel: "demo.mp4",
			maxEpisodes: 1,
			maxKeyframes: 2,
		}, {
			durationProbe: async () => 20_000,
			sceneDetector: async () => [7_000],
			ffmpegPath,
		});
		if (pack.tempDir) {
			cleanupDirs.push(pack.tempDir);
		}

		const attempts = (await readFile(callLogPath, "utf8"))
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((value) => Number.parseFloat(value));
		expect(attempts.length).toBeGreaterThanOrEqual(2);
		expect(attempts[1]).toBeLessThan(attempts[0]);
		expect(pack.keyframes[0]?.path).toMatch(/episode-01-kf-01\.png$/);
	});

	it("turns an evidence pack into a structured teach draft analysis", async () => {
		const dir = await createTempDir("understudy-video-teach-");
		const frameA = join(dir, "frame-a.png");
		const frameB = join(dir, "frame-b.png");
		await writeFile(frameA, Buffer.from(TINY_PNG, "base64"));
		await writeFile(frameB, Buffer.from(TINY_PNG, "base64"));

		const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body ?? "{}"));
			expect(body.model).toBe("doubao-seed-2-0-lite-260215");
			expect(body.max_output_tokens).toBe(2400);
			if (fetchImpl.mock.calls.length === 1) {
				expect(body.input[0].content.filter((entry: { type?: string }) => entry.type === "input_image")).toHaveLength(2);
				expect(body.input[0].content[0].text).toContain("event-guided evidence pack");
				expect(body.input[0].content[0].text).toContain("Episode summary JSON");
				expect(body.input[0].content[0].text).toContain("executionPolicy");
				expect(body.input[0].content[0].text).toContain("stepRouteOptions");
				expect(body.input[0].content[0].text).toContain("Current teach-time capability snapshot");
				expect(body.input[0].content[0].text).toContain("web_fetch");
				expect(body.input[0].content[0].text).toContain("apple-notes");
				return new Response(JSON.stringify({
					output_text: JSON.stringify({
						title: "Publish the dashboard review",
						objective: "Open the pending dashboard review and publish it.",
						parameterSlots: [
							{ name: "dashboard_name", sampleValue: "Q1 dashboard", required: true },
						],
						successCriteria: [
							"Published confirmation is visible.",
						],
						openQuestions: [
							"Confirm whether the assignee should be notified.",
						],
						executionPolicy: {
							toolBinding: "adaptive",
							preferredRoutes: ["browser", "gui"],
							stepInterpretation: "fallback_replay",
							notes: [
								"Prefer browser automation when it reaches the same visible result.",
							],
						},
						stepRouteOptions: [
							{
								procedureStepId: "procedure-1",
								route: "gui",
								preference: "observed",
								instruction: "Click the Publish button in the review pane.",
								toolName: "gui_click",
							},
						],
						steps: [
							{
								route: "gui",
								toolName: "gui_click",
								instruction: "Click the Publish button in the review pane.",
								target: "Publish button",
								verificationSummary: "Published confirmation appears.",
							},
						],
					}),
				}), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			expect(body.input[0].content).toHaveLength(1);
			expect(body.input[0].content[0].text).toContain("refining route selection");
			expect(body.input[0].content[0].text).toContain("\"observedReferenceSteps\"");
			return new Response(JSON.stringify({
				output_text: JSON.stringify({
					executionPolicy: {
						toolBinding: "adaptive",
						preferredRoutes: ["skill", "browser", "gui"],
						stepInterpretation: "fallback_replay",
						notes: [
							"Use the observed GUI path as reference, but prefer an existing skill or browser route when it preserves the same result.",
						],
					},
					stepRouteOptions: [
						{
							procedureStepId: "procedure-1",
							route: "skill",
							preference: "preferred",
							instruction: "Delegate review publishing to the existing apple-notes skill.",
							skillName: "apple-notes",
						},
						{
							procedureStepId: "procedure-1",
							route: "browser",
							preference: "fallback",
							instruction: "Use browser automation to open the review item directly.",
							toolName: "web_fetch",
						},
						{
							procedureStepId: "procedure-1",
							route: "gui",
							preference: "observed",
							instruction: "Click the Publish button in the review pane.",
							toolName: "gui_click",
						},
					],
					skillDependencies: [
						{
							name: "apple-notes",
							reason: "Existing workspace skill covers the target output path.",
							required: false,
						},
					],
				}),
			}), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		});

		const analyzer = createResponsesApiVideoTeachAnalyzer({
			apiKey: "ark-key",
			baseUrl: "https://example.com/responses",
			model: "doubao-seed-2-0-lite-260215",
			providerName: "ark:doubao-seed-2-0-lite-260215",
			fetchImpl: fetchImpl as unknown as typeof fetch,
			evidenceBuilder: async () => ({
				videoPath: "/tmp/demo.mp4",
				sourceLabel: "demo.mp4",
				durationMs: 12_000,
				analysisMode: "event_guided_evidence_pack",
				events: [
					{ id: "event-1", type: "mouse_up", timestampMs: 1_000, app: "Browser", target: "Publish button" },
				],
				episodes: [
					{
						id: "episode-01",
						startMs: 600,
						endMs: 2_500,
						centerMs: 1_000,
						label: "Browser: Publish button",
						triggerTypes: ["mouse_up"],
						source: "event",
						app: "Browser",
						keyframes: [
							{ path: frameA, mimeType: "image/png", timestampMs: 800, kind: "before_action", label: "Before click", episodeId: "episode-01" },
							{ path: frameB, mimeType: "image/png", timestampMs: 1_600, kind: "settled", label: "After click", episodeId: "episode-01" },
						],
					},
				],
				keyframes: [
					{ path: frameA, mimeType: "image/png", timestampMs: 800, kind: "before_action", label: "Before click", episodeId: "episode-01" },
					{ path: frameB, mimeType: "image/png", timestampMs: 1_600, kind: "settled", label: "After click", episodeId: "episode-01" },
				],
				summary: "Built event-guided evidence pack, 1 episode, 2 keyframes, 1 imported event from demo.mp4.",
				tempDir: dir,
			}),
		});

		const analysis = await analyzer.analyze({
			videoPath: "/tmp/demo.mp4",
			sourceLabel: "demo.mp4",
			objectiveHint: "Teach Understudy how to publish the reviewed dashboard.",
			capabilitySnapshot: {
				tools: [
					{
						name: "web_fetch",
						label: "Web Fetch",
						description: "Fetch web content directly without replaying the GUI.",
						category: "web",
						surface: "runtime",
						executionRoute: "browser",
					},
					{
						name: "gui_click",
						label: "GUI Click",
						description: "Click a visually grounded GUI target.",
						category: "gui",
						surface: "runtime",
						executionRoute: "gui",
					},
				],
				skills: [
					{
						name: "apple-notes",
						description: "Write directly into Apple Notes.",
						allowedToolNames: ["bash"],
					},
				],
			},
		});

		expect(analysis).toMatchObject({
			title: "Publish the dashboard review",
			objective: "Open the pending dashboard review and publish it.",
			sourceLabel: "demo.mp4",
			provider: "ark:doubao-seed-2-0-lite-260215",
			model: "doubao-seed-2-0-lite-260215",
			analysisMode: "event_guided_evidence_pack",
			episodeCount: 1,
			keyframeCount: 2,
			eventCount: 1,
			durationMs: 12_000,
		});
		expect(analysis.parameterSlots).toContainEqual(
			expect.objectContaining({ name: "dashboard_name", sampleValue: "Q1 dashboard" }),
		);
		expect(analysis.steps).toContainEqual(
			expect.objectContaining({
				toolName: "gui_click",
				target: "Publish button",
			}),
		);
		expect(analysis.executionPolicy).toMatchObject({
			toolBinding: "adaptive",
			preferredRoutes: ["skill", "browser", "gui"],
			stepInterpretation: "fallback_replay",
		});
		expect(analysis.stepRouteOptions).toContainEqual(
			expect.objectContaining({
				procedureStepId: "procedure-1",
				route: "skill",
				preference: "preferred",
				skillName: "apple-notes",
			}),
		);
		expect(analysis.stepRouteOptions).toContainEqual(
			expect.objectContaining({
				procedureStepId: "procedure-1",
				route: "gui",
				preference: "observed",
				toolName: "gui_click",
			}),
		);
		expect(analysis.skillDependencies).toContainEqual(
			expect.objectContaining({
				name: "apple-notes",
				required: false,
			}),
		);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(analysis.keyframes).toBeUndefined();
	});

	it("retries once when the first analysis response is not valid JSON", async () => {
		const dir = await createTempDir("understudy-video-teach-retry-");
		const frameA = join(dir, "frame-a.png");
		await writeFile(frameA, Buffer.from(TINY_PNG, "base64"));

		const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body ?? "{}"));
			if (fetchImpl.mock.calls.length === 1) {
				expect(body.input[0].content[0].text).not.toContain("previous response was not valid strict JSON");
				return new Response(JSON.stringify({
					output_text: "{\"title\":\"Broken response\"",
				}), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}
			expect(body.input[0].content[0].text).toContain("previous response was not valid strict JSON");
			return new Response(JSON.stringify({
				output_text: JSON.stringify({
					title: "Publish the dashboard review",
					objective: "Open the pending dashboard review and publish it.",
					parameterSlots: [],
					successCriteria: ["Published confirmation is visible."],
					openQuestions: [],
					steps: [
						{
							route: "gui",
							toolName: "gui_click",
							instruction: "Click the Publish button in the review pane.",
							target: "Publish button",
						},
					],
				}),
			}), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		});

		const analyzer = createResponsesApiVideoTeachAnalyzer({
			apiKey: "ark-key",
			baseUrl: "https://example.com/responses",
			model: "doubao-seed-2-0-lite-260215",
			providerName: "ark:doubao-seed-2-0-lite-260215",
			fetchImpl: fetchImpl as unknown as typeof fetch,
			evidenceBuilder: async () => ({
				videoPath: "/tmp/demo.mp4",
				sourceLabel: "demo.mp4",
				durationMs: 12_000,
				analysisMode: "event_guided_evidence_pack",
				events: [],
				episodes: [
					{
						id: "episode-01",
						startMs: 600,
						endMs: 2_500,
						centerMs: 1_000,
						label: "Browser: Publish button",
						triggerTypes: ["mouse_up"],
						source: "event",
						app: "Browser",
						keyframes: [
							{ path: frameA, mimeType: "image/png", timestampMs: 800, kind: "before_action", label: "Before click", episodeId: "episode-01" },
						],
					},
				],
				keyframes: [
					{ path: frameA, mimeType: "image/png", timestampMs: 800, kind: "before_action", label: "Before click", episodeId: "episode-01" },
				],
				summary: "Built event-guided evidence pack, 1 episode, 1 keyframe from demo.mp4.",
				tempDir: dir,
			}),
		});

		const analysis = await analyzer.analyze({
			videoPath: "/tmp/demo.mp4",
			sourceLabel: "demo.mp4",
		});

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(analysis.title).toBe("Publish the dashboard review");
	});

	it("retries transient video teach request failures up to three attempts", async () => {
		const dir = await createTempDir("understudy-video-teach-http-retry-");
		const frameA = join(dir, "frame-a.png");
		await writeFile(frameA, Buffer.from(TINY_PNG, "base64"));

		let attempts = 0;
		const fetchImpl = vi.fn(async () => {
			attempts += 1;
			if (attempts < 3) {
				return new Response(JSON.stringify({
					error: {
						message: "temporary upstream failure",
					},
				}), {
					status: 500,
					headers: { "content-type": "application/json" },
				});
			}
			return new Response(JSON.stringify({
				output_text: JSON.stringify({
					title: "Publish the dashboard review",
					objective: "Open the pending dashboard review and publish it.",
					parameterSlots: [],
					successCriteria: ["Published confirmation is visible."],
					openQuestions: [],
					steps: [
						{
							route: "gui",
							toolName: "gui_click",
							instruction: "Click the Publish button in the review pane.",
							target: "Publish button",
						},
					],
				}),
			}), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		});

		const analyzer = createResponsesApiVideoTeachAnalyzer({
			apiKey: "ark-key",
			baseUrl: "https://example.com/responses",
			model: "doubao-seed-2-0-lite-260215",
			providerName: "ark:doubao-seed-2-0-lite-260215",
			fetchImpl: fetchImpl as unknown as typeof fetch,
			evidenceBuilder: async () => ({
				videoPath: "/tmp/demo.mp4",
				sourceLabel: "demo.mp4",
				durationMs: 12_000,
				analysisMode: "event_guided_evidence_pack",
				events: [],
				episodes: [
					{
						id: "episode-01",
						startMs: 600,
						endMs: 2_500,
						centerMs: 1_000,
						label: "Browser: Publish button",
						triggerTypes: ["mouse_up"],
						source: "event",
						app: "Browser",
						keyframes: [
							{ path: frameA, mimeType: "image/png", timestampMs: 800, kind: "before_action", label: "Before click", episodeId: "episode-01" },
						],
					},
				],
				keyframes: [
					{ path: frameA, mimeType: "image/png", timestampMs: 800, kind: "before_action", label: "Before click", episodeId: "episode-01" },
				],
				summary: "Built event-guided evidence pack, 1 episode, 1 keyframe from demo.mp4.",
				tempDir: dir,
			}),
		});

		const analysis = await analyzer.analyze({
			videoPath: "/tmp/demo.mp4",
			sourceLabel: "demo.mp4",
		});

		expect(fetchImpl).toHaveBeenCalledTimes(3);
		expect(attempts).toBe(3);
		expect(analysis.title).toBe("Publish the dashboard review");
	});

	it("can analyze demo videos through an Understudy session-backed model", async () => {
		const dir = await createTempDir("understudy-video-teach-session-");
		const frameA = join(dir, "frame-a.png");
		await writeFile(frameA, Buffer.from(TINY_PNG, "base64"));

		const prompt = vi.fn(async (_text: string, options?: Record<string, unknown>) => {
			expect(Array.isArray(options?.images)).toBe(true);
			expect((options?.images as unknown[] | undefined)?.length).toBe(1);
			session.agent.state.messages.push({
				role: "assistant",
				content: JSON.stringify({
					title: "Open the review and publish it",
					objective: "Open the review queue and publish the selected item.",
					parameterSlots: [{ name: "review_name", sampleValue: "Q1 dashboard", required: true }],
					successCriteria: ["Published confirmation is visible."],
					openQuestions: [],
					steps: [
						{
							route: "gui",
							toolName: "gui_click",
							instruction: "Click Publish in the review panel.",
							target: "Publish button",
						},
					],
				}),
			});
		});
		const session = {
			agent: {
				state: {
					messages: [] as Array<Record<string, unknown>>,
				},
			},
			prompt,
		};
		const close = vi.fn(async () => {});
		coreMocks.createUnderstudySession.mockResolvedValue({
			session,
			runtimeSession: { close },
		});

		const analyzer = createSessionVideoTeachAnalyzer({
			config: {
				defaultProvider: "openai-codex",
				defaultModel: "gpt-5.4",
				defaultThinkingLevel: "off",
			} as any,
			cwd: "/tmp/understudy",
			evidenceBuilder: async () => ({
				videoPath: "/tmp/demo.mp4",
				sourceLabel: "demo.mp4",
				durationMs: 12_000,
				analysisMode: "event_guided_evidence_pack",
				events: [],
				episodes: [
					{
						id: "episode-01",
						startMs: 600,
						endMs: 2_500,
						centerMs: 1_000,
						label: "Browser: Publish button",
						triggerTypes: ["mouse_up"],
						source: "event",
						app: "Browser",
						keyframes: [
							{ path: frameA, mimeType: "image/png", timestampMs: 800, kind: "before_action", label: "Before click", episodeId: "episode-01" },
						],
					},
				],
				keyframes: [
					{ path: frameA, mimeType: "image/png", timestampMs: 800, kind: "before_action", label: "Before click", episodeId: "episode-01" },
				],
				summary: "Built event-guided evidence pack, 1 episode, 1 keyframe from demo.mp4.",
				tempDir: dir,
			}),
		});

		const analysis = await analyzer.analyze({
			videoPath: "/tmp/demo.mp4",
			sourceLabel: "demo.mp4",
		});

		expect(coreMocks.createUnderstudySession).toHaveBeenCalledWith(expect.objectContaining({
			cwd: "/tmp/understudy",
			config: expect.objectContaining({
				defaultProvider: "openai-codex",
				defaultModel: "gpt-5.4",
				defaultThinkingLevel: "off",
			}),
		}));
		expect(prompt).toHaveBeenCalledTimes(1);
		expect(close).toHaveBeenCalledTimes(1);
		expect(analysis).toMatchObject({
			title: "Open the review and publish it",
			objective: "Open the review queue and publish the selected item.",
			provider: "openai-codex:gpt-5.4",
			model: "gpt-5.4",
			sourceLabel: "demo.mp4",
		});
	});
});
