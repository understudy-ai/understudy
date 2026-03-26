import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	appendPersistedWorkflowCrystallizationTurnFromRun,
	loadPersistedWorkflowCrystallizationLedger,
} from "@understudy/core";
import {
	buildSessionSummary,
	createGatewaySessionRuntime,
	seedRuntimeMessagesFromHistory,
	type SessionEntry,
} from "../session-runtime.js";

function createEntry(id: string, overrides: Partial<SessionEntry> = {}): SessionEntry {
	const now = Date.now();
	return {
		id,
		createdAt: now,
		lastActiveAt: now,
		dayStamp: "2026-03-05",
		messageCount: 0,
		session: {},
		history: [],
		...overrides,
	};
}

async function flushMicrotasks(turns = 8): Promise<void> {
	for (let index = 0; index < turns; index += 1) {
		await Promise.resolve();
	}
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function extractSystemPromptText(entry: SessionEntry): string {
	const messages = ((entry.session as {
		agent?: { state?: { messages?: Array<{ role?: unknown; content?: unknown }> } };
	})?.agent?.state?.messages ?? []);
	const systemMessage = messages.find((message) => message?.role === "system");
	if (!systemMessage) {
		return "";
	}
	if (typeof systemMessage.content === "string") {
		return systemMessage.content;
	}
	if (!Array.isArray(systemMessage.content)) {
		return "";
	}
	return systemMessage.content
		.map((chunk) =>
			chunk && typeof chunk === "object" && (chunk as { type?: unknown }).type === "text"
				? String((chunk as { text?: unknown }).text ?? "")
				: "")
		.join("\n");
}

it("crystallizes repeated multi-turn workflows into a published workspace skill and notifies the user", async () => {
	const tempHome = mkdtempSync(join(tmpdir(), "understudy-workflow-home-"));
	const workspaceDir = mkdtempSync(join(tmpdir(), "understudy-workflow-workspace-"));
	const learningDir = join(tempHome, "learning");
	const originalUnderstudyHome = process.env.UNDERSTUDY_HOME;
	process.env.UNDERSTUDY_HOME = tempHome;
	const withMockedNow = async <T>(timestamp: number, task: () => Promise<T>): Promise<T> => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(timestamp);
		try {
			return await task();
		} finally {
			nowSpy.mockRestore();
		}
	};
	try {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const setSystemPrompt = vi.fn();
		const notifyUser = vi.fn(async () => {});
		const entry = createEntry("workflow-main", {
			channelId: "web",
			senderId: "workflow-user",
			threadId: "thread-1",
			workspaceDir,
			repoRoot: workspaceDir,
			session: {
				agent: {
					setSystemPrompt,
					state: {
						messages: [
							{
								role: "system",
								content: [{ type: "text", text: `## Workspace\ncwd=${workspaceDir}` }],
							},
						],
					},
				},
			},
		});
		sessionEntries.set(entry.id, entry);
		const appendHistory = vi.fn((target: SessionEntry, role: "user" | "assistant", text: string, timestamp?: number) => {
			target.history.push({
				role,
				text,
				timestamp: timestamp ?? Date.now(),
			});
		});
		const getOrCreateSession = vi.fn(async () => entry);
		const createScopedSession = vi.fn(async (context: { sessionKey: string; workspaceDir?: string }) =>
			createEntry(String(context.sessionKey), {
				workspaceDir: context.workspaceDir ?? workspaceDir,
				repoRoot: workspaceDir,
				session: {
					agent: {
						setSystemPrompt: vi.fn(),
						state: {
							messages: [
								{
									role: "system",
									content: [{ type: "text", text: "internal" }],
								},
							],
						},
					},
				},
			}));
		let livePromptCount = 0;
		let naturalLanguageSkillReuseCount = 0;
		const workflowToolTrace = [
			{ type: "toolCall", id: "tool-1", name: "browser" },
			{
				type: "toolResult",
				id: "tool-1",
				name: "browser",
				route: "browser",
				textPreview: "Opened the dashboard.",
				status: { code: "resolved", summary: "Dashboard is open." },
			},
			{
				type: "toolCall",
				id: "tool-2",
				name: "gui_click",
				arguments: { target: 'button labeled "Send"' },
			},
			{
				type: "toolResult",
				id: "tool-2",
				name: "gui_click",
				route: "gui",
				textPreview: "Clicked Send.",
				status: { code: "condition_met", summary: "Summary was sent." },
			},
		] as any;
		const promptSession = vi.fn(async (targetEntry: SessionEntry, text: string) => {
			if (text.includes('Schema: {"segments"')) {
				return {
					response: JSON.stringify({
						segments: [{ startTurnIndex: 1, endTurnIndex: 2, completion: "complete" }],
					}),
					runId: `segment-${Date.now()}`,
				};
			}
			if (text.includes('Schema: {"episodes"')) {
				const segmentId = text.match(/segment_id=([a-f0-9]{12})/)?.[1] ?? "seg-1";
				return {
					response: JSON.stringify({
						episodes: [
							{
								segmentId,
								title: "Send daily summary",
								objective: "Send the daily summary to ops",
								summary: "Refresh the dashboard state and send the daily summary to ops.",
								workflowFamilyHint: "refresh dashboard and send daily summary",
								parameterHints: ["target_channel"],
								successCriteria: ["Summary was sent to ops."],
								uncertainties: [],
								keyTools: ["browser", "gui_click"],
								routeSignature: "browser -> gui",
								triggers: ["send daily summary"],
								completion: "complete",
							},
						],
					}),
					runId: `summary-${Date.now()}`,
				};
			}
			if (text.includes('Schema: {"clusters"')) {
				const episodeIds = Array.from(text.matchAll(/^- ([a-f0-9]{12})$/gm)).map((match) => match[1]);
				return {
					response: JSON.stringify({
						clusters: [
							{
								episodeIds,
								title: "Send daily summary",
								objective: "Send the daily summary to ops",
								summary: "Repeated workflow for refreshing current dashboard state and sending the daily summary to ops.",
								workflowFamilyHint: "refresh dashboard and send daily summary",
								parameterSchema: ["target_channel"],
							},
						],
					}),
					runId: `cluster-${Date.now()}`,
				};
			}
			if (text.includes('Schema: {"title":"...","objective":"...","summary":"...","triggers"')) {
				return {
					response: JSON.stringify({
						title: "Send daily summary",
						objective: "Send the daily summary to ops",
						summary: "Repeated workflow for refreshing current dashboard state and sending the daily summary to ops.",
						triggers: ["send daily summary"],
						parameterSlots: [
							{
								name: "target_channel",
								label: "Target Channel",
								sampleValue: "ops",
								required: true,
							},
						],
						stages: [
							{
								title: "Refresh the source state",
								goal: "Get the latest dashboard state before composing the summary.",
								instructions: [
									"Open the dashboard or equivalent source view.",
									"Refresh the relevant state and confirm the newest data is visible.",
								],
							},
							{
								title: "Compose and deliver the summary",
								goal: "Turn the refreshed state into the outbound summary and send it.",
								instructions: [
									"Prepare the daily summary for the requested target channel.",
									"Send the summary and verify that it appears in the destination.",
								],
							},
						],
						routeOptions: [
							{
								route: "browser",
								preference: "preferred",
								instruction: "Use browser automation to refresh and inspect the dashboard before sending the summary.",
								toolName: "browser",
							},
						],
						successCriteria: [
							"The latest dashboard state was refreshed before composing the summary.",
							"The summary message appears in the target destination.",
						],
						failurePolicy: [
							"If browser automation is blocked, use the available GUI path and re-verify delivery.",
						],
					}),
					runId: `synthesize-${Date.now()}`,
				};
			}
			if (text.includes("Anything new available in this workspace?")) {
				livePromptCount += 1;
				return {
					response: "I checked the workspace state.",
					runId: "user-trigger-analysis",
				};
			}
			if (text.includes("Could you refresh the dashboard and post today's ops recap?")) {
				const prompt = extractSystemPromptText(targetEntry);
				expect(prompt).toContain("## Skills (mandatory)");
				expect(prompt).toContain("crystallized-send-daily-summary");
				expect(prompt).toContain("Repeated workflow for refreshing current dashboard state and sending the daily summary to ops.");
				livePromptCount += 1;
				naturalLanguageSkillReuseCount += 1;
				return {
					response: "Refreshed the dashboard and posted today's ops recap to ops.",
					runId: "user-natural-reuse",
					meta: {
						toolTrace: workflowToolTrace,
					},
				};
			}
			throw new Error(`Unexpected promptSession call in crystallization test: ${text}`);
		});
		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "gpt-5.4",
				defaultProvider: "openai-codex",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: { record: vi.fn() } as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: getOrCreateSession as any,
			createScopedSession: createScopedSession as any,
			promptSession: promptSession as any,
			abortSessionEntry: vi.fn(async () => false),
			notifyUser: notifyUser as any,
		});
		const waitForWorkflowLedger = async (
			predicate: (candidate: NonNullable<Awaited<ReturnType<typeof loadPersistedWorkflowCrystallizationLedger>>>) => boolean,
		) => {
			let latest = await loadPersistedWorkflowCrystallizationLedger({ workspaceDir, learningDir });
			for (let attempt = 0; attempt < 60; attempt += 1) {
				if (latest && predicate(latest)) {
					return latest;
				}
				await flushMicrotasks(10);
				await sleep(25);
				latest = await loadPersistedWorkflowCrystallizationLedger({ workspaceDir, learningDir });
			}
			return latest;
		};

		const seededWorkflowRuns = [
			{ timestamp: Date.parse("2026-03-10T09:00:00.000Z"), prompt: "Prepare today's daily summary for ops", response: "Prepared the summary for ops." },
			{ timestamp: Date.parse("2026-03-10T09:05:00.000Z"), prompt: "Send it to ops", response: "Posted the summary to ops." },
			{ timestamp: Date.parse("2026-03-11T09:00:00.000Z"), prompt: "Prepare today's daily summary for ops", response: "Prepared the summary for ops." },
			{ timestamp: Date.parse("2026-03-11T09:05:00.000Z"), prompt: "Send it to ops", response: "Posted the summary to ops." },
			{ timestamp: Date.parse("2026-03-12T09:00:00.000Z"), prompt: "Prepare today's daily summary for ops", response: "Prepared the summary for ops." },
			{ timestamp: Date.parse("2026-03-12T09:05:00.000Z"), prompt: "Send it to ops", response: "Posted the summary to ops." },
		];
		for (const [index, run] of seededWorkflowRuns.entries()) {
			await appendPersistedWorkflowCrystallizationTurnFromRun({
				workspaceDir,
				repoRoot: workspaceDir,
				learningDir,
				sessionId: entry.id,
				runId: `seed-${index + 1}`,
				promptPreview: run.prompt,
				responsePreview: run.response,
				toolTrace: workflowToolTrace,
				timestamp: run.timestamp,
			});
		}
		const seededLedger = await loadPersistedWorkflowCrystallizationLedger({ workspaceDir, learningDir });
		expect((seededLedger?.days ?? []).reduce((count, day) => count + day.turns.length, 0)).toBe(6);
		expect(seededLedger?.clusters).toHaveLength(0);
		expect(seededLedger?.skills).toHaveLength(0);

		await withMockedNow(new Date("2026-03-13T09:00:00.000Z").valueOf(), async () => {
			await runtime.chatHandler("Anything new available in this workspace?", {
				channelId: "web",
				senderId: "workflow-user",
				threadId: "thread-1",
				cwd: workspaceDir,
			});
		});
		expect(livePromptCount).toBe(1);

		const ledger = await waitForWorkflowLedger((candidate) =>
			candidate.days.reduce((count, day) => count + day.turns.length, 0) === 7
			&& candidate.days.reduce((count, day) => count + day.segments.length, 0) === 3
			&& candidate.days.reduce((count, day) => count + day.episodes.length, 0) === 3
			&& candidate.clusters.length === 1
			&& candidate.skills.length === 1);
		expect(ledger).toBeTruthy();
		expect((ledger?.days ?? []).reduce((count, day) => count + day.turns.length, 0)).toBe(7);
		expect((ledger?.days ?? []).reduce((count, day) => count + day.segments.length, 0)).toBe(3);
		expect((ledger?.days ?? []).reduce((count, day) => count + day.episodes.length, 0)).toBe(3);
		expect((ledger?.days ?? []).map((day) => ({ day: day.dayStamp, turns: day.turns.length }))).toEqual([
			{ day: "2026-03-10", turns: 2 },
			{ day: "2026-03-11", turns: 2 },
			{ day: "2026-03-12", turns: 2 },
			{ day: "2026-03-13", turns: 1 },
		]);
		expect(ledger?.clusters).toHaveLength(1);
		expect(ledger?.skills).toHaveLength(1);
		expect((ledger?.days ?? []).flatMap((day) => day.segments).every((segment) =>
			segment.startTurnIndex === 1 && segment.endTurnIndex === 2 && segment.completion === "complete")).toBe(true);
		expect((ledger?.days ?? []).flatMap((day) => day.episodes).every((episode) =>
			episode.title === "Send daily summary"
			&& episode.workflowFamilyHint === "refresh dashboard and send daily summary"
			&& episode.routeSignature === "browser -> gui"
			&& episode.triggers.includes("send daily summary"))).toBe(true);
		expect(ledger?.clusters[0]).toMatchObject({
			title: "Send daily summary",
			objective: "Send the daily summary to ops",
			occurrenceCount: 3,
			completeCount: 3,
			partialCount: 0,
			failedCount: 0,
			parameterSchema: ["target_channel"],
		});
		const skill = ledger!.skills[0]!;
		expect(skill.sourceEpisodeCount).toBe(3);
		expect(skill.successfulEpisodeCount).toBe(3);
		expect(skill.observedStatusCounts).toEqual({
			completeCount: 3,
			partialCount: 0,
			failedCount: 0,
		});
		expect(skill.stages).toHaveLength(2);
		expect(skill.routeOptions).toEqual([
			expect.objectContaining({
				route: "browser",
				preference: "preferred",
				toolName: "browser",
			}),
		]);
		expect(skill.publishedSkill?.skillPath).toBeTruthy();
		const skillMarkdown = readFileSync(skill.publishedSkill!.skillPath, "utf8");
		expect(skillMarkdown).toContain("## Observed Run States");
		expect(skillMarkdown).toContain("Complete runs: 3");
		expect(skillMarkdown).toContain("## Staged Workflow");
		expect(skillMarkdown).toContain("Refresh the source state");
		expect(skillMarkdown).toContain("## Route Guidance");
		expect(skillMarkdown).toContain("target_channel");
		expect(notifyUser).toHaveBeenCalledTimes(1);
		expect(notifyUser).toHaveBeenCalledWith(expect.objectContaining({
			source: "workflow_crystallization",
			title: "Crystallized workflow skill ready",
			text: expect.stringContaining("hot-loaded into this workspace"),
			details: {
				skills: [
					expect.objectContaining({
						id: skill.id,
						title: skill.title,
						skillName: skill.publishedSkill?.name,
						skillPath: skill.publishedSkill?.skillPath,
						sourceEpisodeCount: 3,
						successfulEpisodeCount: 3,
						updated: false,
					}),
				],
			},
		}));
		expect(setSystemPrompt).toHaveBeenCalled();
		const refreshedPrompt = setSystemPrompt.mock.calls.at(-1)?.[0] as string;
		expect(refreshedPrompt).toContain(skill.publishedSkill!.name);
		expect(refreshedPrompt).toContain(skill.publishedSkill!.skillPath);
		expect(refreshedPrompt).toContain("Repeated workflow for refreshing current dashboard state and sending the daily summary to ops.");
		expect(extractSystemPromptText(entry)).toContain(skill.publishedSkill!.name);

		const naturalReuse = await withMockedNow(new Date("2026-03-13T09:05:00.000Z").valueOf(), async () =>
			await runtime.chatHandler("Could you refresh the dashboard and post today's ops recap?", {
				channelId: "web",
				senderId: "workflow-user",
				threadId: "thread-1",
				cwd: workspaceDir,
			}));
		expect(naturalReuse).toMatchObject({
			response: "Refreshed the dashboard and posted today's ops recap to ops.",
			sessionId: entry.id,
			status: "ok",
		});
		expect(naturalLanguageSkillReuseCount).toBe(1);
	} finally {
		if (originalUnderstudyHome === undefined) {
			delete process.env.UNDERSTUDY_HOME;
		} else {
			process.env.UNDERSTUDY_HOME = originalUnderstudyHome;
		}
		rmSync(tempHome, { recursive: true, force: true });
		rmSync(workspaceDir, { recursive: true, force: true });
	}
});

it("includes teach clarification state in session summaries", () => {
	const summary = buildSessionSummary(createEntry("teach-summary", {
		sessionMeta: {
			teachClarification: {
				draftId: "draft-123",
				status: "clarifying",
				summary: "Need to pin down the publish target",
				nextQuestion: "Which dashboard should be published?",
				updatedAt: 1234,
			},
		},
	}));

		expect(summary.teachClarification).toEqual({
			draftId: "draft-123",
			status: "clarifying",
			summary: "Need to pin down the publish target",
			nextQuestion: "Which dashboard should be published?",
			pendingQuestions: [],
			updatedAt: 1234,
		});
});

describe("createGatewaySessionRuntime reset behavior", () => {
	it("seeds runtime message state from archived history while preserving system prompts", () => {
		const entry = createEntry("seeded", {
			session: {
				agent: {
					state: {
						messages: [
							{
								role: "system",
								content: [{ type: "text", text: "system prompt" }],
							},
							{
								role: "assistant",
								content: [{ type: "text", text: "stale reply" }],
							},
						],
					},
				},
			},
		});

		seedRuntimeMessagesFromHistory(entry, [
			{ role: "user", text: "hello", timestamp: 1 },
			{ role: "assistant", text: "hi", timestamp: 2 },
		]);

		expect((entry.session as any).agent.state.messages).toEqual([
			{
				role: "system",
				content: [{ type: "text", text: "system prompt" }],
			},
			{
				role: "user",
				content: [{ type: "text", text: "hello" }],
				timestamp: 1,
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "hi" }],
				api: "openai-codex-responses",
				provider: "understudy-gateway",
				model: "gateway-history",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						total: 0,
					},
				},
				stopReason: "stop",
				timestamp: 2,
			},
		]);
	});

	it("treats bare /new as session reset + startup prompt in chat handler", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const oldEntry = createEntry("scope-1");
		const newEntry = createEntry("scope-1");
		const usageTracker = { record: vi.fn() };
		const appendHistory = vi.fn();
		const getOrCreateSession = vi.fn(async (context: { forceNew?: boolean }) =>
			context.forceNew ? newEntry : oldEntry,
		);
		const createScopedSession = vi.fn();
		const promptSession = vi.fn(async (_entry: SessionEntry, text: string) => ({
			response: `assistant:${text}`,
			runId: "run-1",
		}));
		const abortSessionEntry = vi.fn(async () => false);

		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: usageTracker as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: getOrCreateSession as any,
			createScopedSession: createScopedSession as any,
			promptSession: promptSession as any,
			abortSessionEntry: abortSessionEntry as any,
		});

		const result = await runtime.chatHandler("/new", {
			channelId: "web",
			senderId: "user-1",
		});

		expect(getOrCreateSession).toHaveBeenCalledTimes(2);
		expect(getOrCreateSession).toHaveBeenLastCalledWith({
			channelId: "web",
			senderId: "user-1",
			conversationType: undefined,
			threadId: undefined,
			forceNew: true,
			workspaceDir: undefined,
			explicitWorkspace: false,
		});
		expect(promptSession).toHaveBeenCalledWith(
			newEntry,
			expect.stringContaining("A new session was started via /new or /reset"),
			expect.any(String),
			undefined,
		);
		const startupPrompt = promptSession.mock.calls[0]?.[1] as string;
		expect(startupPrompt.startsWith("[")).toBe(false);
		expect(result).toMatchObject({ sessionId: "scope-1" });
	});

	it("treats bare /reset as an in-place session recreation in chat handler", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const oldEntry = createEntry("scope-reset", {
			channelId: "web",
			senderId: "user-1",
			parentId: "parent-1",
			forkPoint: 2,
			executionScopeKey: "scope-alpha",
		});
		const resetEntry = createEntry("scope-reset", {
			channelId: "web",
			senderId: "user-1",
			parentId: "parent-1",
			forkPoint: 2,
			executionScopeKey: "scope-alpha",
		});
		const usageTracker = { record: vi.fn() };
		const appendHistory = vi.fn();
		const getOrCreateSession = vi.fn(async () => oldEntry);
		const createScopedSession = vi.fn(async () => resetEntry);
		const deletePersistedSession = vi.fn(async () => undefined);
		const promptSession = vi.fn(async (_entry: SessionEntry, text: string) => ({
			response: `assistant:${text}`,
			runId: "run-reset",
		}));
		const abortSessionEntry = vi.fn(async () => false);

		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: usageTracker as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: getOrCreateSession as any,
			createScopedSession: createScopedSession as any,
			promptSession: promptSession as any,
			abortSessionEntry: abortSessionEntry as any,
			deletePersistedSession,
		});

		const result = await runtime.chatHandler("/reset", {
			channelId: "web",
			senderId: "user-1",
		});

		expect(getOrCreateSession).toHaveBeenCalledTimes(1);
		expect(deletePersistedSession).toHaveBeenCalledWith({ sessionId: "scope-reset" });
		expect(createScopedSession).toHaveBeenCalledWith({
			sessionKey: "scope-reset",
			parentId: "parent-1",
			forkPoint: 2,
			channelId: "web",
			senderId: "user-1",
			senderName: oldEntry.senderName,
			conversationName: oldEntry.conversationName,
			conversationType: oldEntry.conversationType,
			threadId: oldEntry.threadId,
			workspaceDir: oldEntry.workspaceDir,
			configOverride: oldEntry.configOverride,
			sandboxInfo: oldEntry.sandboxInfo,
			executionScopeKey: "scope-alpha",
		});
		expect(promptSession).toHaveBeenCalledWith(
			resetEntry,
			expect.stringContaining("A new session was started via /new or /reset"),
			expect.any(String),
			undefined,
		);
		expect(result).toMatchObject({ sessionId: "scope-reset" });
	});

	it("recovers once when a prompt run ends with an empty visible reply", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const entry = createEntry("scope-empty-reply");
		const usageTracker = { record: vi.fn() };
		const appendHistory = vi.fn((target: SessionEntry, role: "user" | "assistant", text: string) => {
			target.history.push({
				role,
				text,
				timestamp: target.history.length + 1,
			});
		});
		const getOrCreateSession = vi.fn(async () => entry);
		const createScopedSession = vi.fn();
		const promptSession = vi.fn(async (_entry: SessionEntry, text: string, runId?: string) => {
			if (text.includes("empty <final>")) {
				return {
					response: "Completed the Telegram send.",
					runId: runId ?? "run-empty-reply",
				};
			}
			return {
				response: "",
				runId: runId ?? "run-empty-reply",
			};
		});
		const abortSessionEntry = vi.fn(async () => false);

		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: usageTracker as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: getOrCreateSession as any,
			createScopedSession: createScopedSession as any,
			promptSession: promptSession as any,
			abortSessionEntry: abortSessionEntry as any,
		});

		const result = await runtime.chatHandler("Send a test message in Telegram.", {
			channelId: "web",
			senderId: "user-empty-reply",
		});

		expect(promptSession).toHaveBeenCalledTimes(2);
		expect(promptSession.mock.calls[1]?.[1]).toContain("empty <final>");
		expect(result).toMatchObject({
			status: "ok",
			response: "Completed the Telegram send.",
		});
		expect(entry.history).toEqual([
			expect.objectContaining({ role: "user", text: "Send a test message in Telegram." }),
			expect.objectContaining({ role: "assistant", text: "Completed the Telegram send." }),
		]);
	});

	it("serializes same-session prompt execution instead of starting concurrent runs", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const entry = createEntry("scope-serialized");
		const usageTracker = { record: vi.fn() };
		const appendHistory = vi.fn((target: SessionEntry, role: "user" | "assistant", text: string) => {
			target.history.push({
				role,
				text,
				timestamp: target.history.length + 1,
			});
		});
		const getOrCreateSession = vi.fn(async () => entry);
		const createScopedSession = vi.fn();
		let releaseFirst: (() => void) | undefined;
		const promptSession = vi.fn(async (_entry: SessionEntry, text: string) => {
			if (text.includes("first")) {
				await new Promise<void>((resolve) => {
					releaseFirst = resolve;
				});
				return {
					response: "assistant:first",
					runId: "run-first",
				};
			}
			return {
				response: "assistant:second",
				runId: "run-second",
			};
		});
		const abortSessionEntry = vi.fn(async () => false);

		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: usageTracker as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: getOrCreateSession as any,
			createScopedSession: createScopedSession as any,
			promptSession: promptSession as any,
			abortSessionEntry: abortSessionEntry as any,
		});

		await runtime.chatHandler("first", {
			channelId: "web",
			senderId: "user-serialized",
			waitForCompletion: false,
		});
		await runtime.chatHandler("second", {
			channelId: "web",
			senderId: "user-serialized",
			waitForCompletion: false,
		});

		expect(promptSession).toHaveBeenCalledTimes(1);
		expect(promptSession).toHaveBeenNthCalledWith(
			1,
			entry,
			expect.stringContaining("first"),
			expect.any(String),
			undefined,
		);
		expect(entry.history.map((message) => message.text)).toEqual(["first"]);

		releaseFirst?.();
		await flushMicrotasks(20);

		expect(promptSession).toHaveBeenCalledTimes(2);
		expect(promptSession).toHaveBeenNthCalledWith(
			2,
			entry,
			expect.stringContaining("second"),
			expect.any(String),
			undefined,
		);
		expect(entry.history.map((message) => message.text)).toEqual([
			"first",
			"assistant:first",
			"second",
			"assistant:second",
		]);
	});

	it("preserves assistant screenshots when the model returns the non-renderable fallback text", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const entry = createEntry("scope-images");
		const usageTracker = { record: vi.fn() };
		const appendHistory = vi.fn((
			target: SessionEntry,
			role: "user" | "assistant",
			text: string,
			timestamp?: number,
			options?: { images?: Array<Record<string, unknown>> },
		) => {
			target.history.push({
				role,
				text,
				timestamp: timestamp ?? Date.now(),
				...(options?.images ? { images: options.images as any } : {}),
			});
		});
		const getOrCreateSession = vi.fn(async () => entry);
		const createScopedSession = vi.fn();
		const promptSession = vi.fn(async () => ({
			response: "Assistant produced no renderable output.",
			runId: "run-images",
			images: [
				{
					type: "image",
					data: "c2NyZWVuc2hvdA==",
					mimeType: "image/png",
				},
			],
			meta: {
				toolTrace: [
					{
						type: "toolResult",
						name: "gui_observe",
						images: [
							{
								imageData: "c2NyZWVuc2hvdA==",
								mimeType: "image/png",
							},
						],
					},
				],
			},
		}));
		const abortSessionEntry = vi.fn(async () => false);

		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "gpt-5.4",
				defaultProvider: "openai-codex",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: usageTracker as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: getOrCreateSession as any,
			createScopedSession: createScopedSession as any,
			promptSession: promptSession as any,
			abortSessionEntry: abortSessionEntry as any,
		});

		const result = await runtime.chatHandler("截图发给我", {
			channelId: "web",
			senderId: "user-images",
		}) as Record<string, any>;

		expect(result.response).toBe("");
		expect(result.images).toEqual([
			{
				type: "image",
				data: "c2NyZWVuc2hvdA==",
				mimeType: "image/png",
			},
		]);
		expect(entry.history.at(-1)).toMatchObject({
			role: "assistant",
			text: "",
			images: [
				{
					type: "image",
					data: "c2NyZWVuc2hvdA==",
					mimeType: "image/png",
				},
			],
		});
	});

	it("supports /reset <message> through sessions.send(sessionId)", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const oldEntry = createEntry("s1", {
			channelId: "telegram",
			senderId: "u1",
			threadId: "t1",
			parentId: "p0",
			forkPoint: 3,
		});
		const newEntry = createEntry("s1", {
			channelId: "telegram",
			senderId: "u1",
			threadId: "t1",
			parentId: "p0",
			forkPoint: 3,
		});
		sessionEntries.set("s1", oldEntry);
		const usageTracker = { record: vi.fn() };
		const appendHistory = vi.fn();
		const getOrCreateSession = vi.fn();
		const createScopedSession = vi.fn(async () => newEntry);
		const deletePersistedSession = vi.fn(async () => undefined);
		const promptSession = vi.fn(async (_entry: SessionEntry, text: string) => ({
			response: `assistant:${text}`,
			runId: "run-2",
		}));
		const abortSessionEntry = vi.fn(async () => false);

		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: usageTracker as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: getOrCreateSession as any,
			createScopedSession: createScopedSession as any,
			promptSession: promptSession as any,
			abortSessionEntry: abortSessionEntry as any,
			deletePersistedSession,
		});

		const send = runtime.sessionHandlers.send;
		if (!send) {
			throw new Error("sessions.send handler not configured");
		}
		const result = await send({
			sessionId: "s1",
			message: "/reset 你好",
		});

		expect(createScopedSession).toHaveBeenCalledWith({
			sessionKey: "s1",
			parentId: "p0",
			forkPoint: 3,
			channelId: "telegram",
			senderId: "u1",
			conversationType: oldEntry.conversationType,
			threadId: "t1",
		});
		const injected = promptSession.mock.calls[0]?.[1] as string;
		expect(injected).toContain("你好");
		expect(injected).toMatch(/^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
		expect(sessionEntries.get("s1")).toBe(newEntry);
		expect(deletePersistedSession).toHaveBeenCalledWith({ sessionId: "s1" });
		expect(result).toMatchObject({
			sessionId: "s1",
			response: `assistant:${injected}`,
			runId: "run-2",
		});
	});

	it("injects timestamp for regular chat messages", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const entry = createEntry("scope-2");
		const usageTracker = { record: vi.fn() };
		const appendHistory = vi.fn();
		const getOrCreateSession = vi.fn(async () => entry);
		const createScopedSession = vi.fn();
		const promptSession = vi.fn(async (_entry: SessionEntry, text: string) => ({
			response: `assistant:${text}`,
			runId: "run-3",
		}));
		const abortSessionEntry = vi.fn(async () => false);

		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: usageTracker as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: getOrCreateSession as any,
			createScopedSession: createScopedSession as any,
			promptSession: promptSession as any,
			abortSessionEntry: abortSessionEntry as any,
		});

		await runtime.chatHandler("hello world", {
			channelId: "web",
			senderId: "user-2",
		});

		const injected = promptSession.mock.calls[0]?.[1] as string;
		expect(injected).toContain("hello world");
		expect(injected).toMatch(/^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
	});

	it("forwards explicit workspace context through session creation", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const entry = createEntry("scope-create", {
			senderName: "Alice",
			conversationName: "Team Ops",
			workspaceDir: "/tmp/session-workspace",
		});
		const usageTracker = { record: vi.fn() };
		const appendHistory = vi.fn();
		const getOrCreateSession = vi.fn(async () => entry);
		const createScopedSession = vi.fn();
		const promptSession = vi.fn();
		const abortSessionEntry = vi.fn(async () => false);

		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: usageTracker as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: getOrCreateSession as any,
			createScopedSession: createScopedSession as any,
			promptSession: promptSession as any,
			abortSessionEntry: abortSessionEntry as any,
		});

		const create = runtime.sessionHandlers.create;
		if (!create) {
			throw new Error("sessions.create handler not configured");
		}

		const result = await create({
			channelId: "web",
			senderId: "user-create",
			senderName: "Alice",
			conversationName: "Team Ops",
			workspaceDir: "/tmp/session-workspace",
		});

		expect(getOrCreateSession).toHaveBeenCalledWith({
			channelId: "web",
			senderId: "user-create",
			senderName: "Alice",
			conversationName: "Team Ops",
			conversationType: undefined,
			threadId: undefined,
			forceNew: false,
			workspaceDir: "/tmp/session-workspace",
			explicitWorkspace: true,
			configOverride: undefined,
			sandboxInfo: undefined,
			executionScopeKey: undefined,
		});
		expect(result).toMatchObject({
			id: "scope-create",
			senderName: "Alice",
			conversationName: "Team Ops",
			workspaceDir: "/tmp/session-workspace",
		});
	});

	it("updates session metadata and live runtime config through session.patch", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const setModel = vi.fn(async () => {});
		const setThinkingLevel = vi.fn();
		const entry = createEntry("scope-patch", {
			session: {
				setModel,
				setThinkingLevel,
			},
			sessionMeta: {
				model: "anthropic/claude-sonnet-4-6",
				thinkingLevel: "medium",
			},
		});
		sessionEntries.set(entry.id, entry);
		const usageTracker = { record: vi.fn() };
		const appendHistory = vi.fn();
		const getOrCreateSession = vi.fn(async () => entry);
		const createScopedSession = vi.fn();
		const promptSession = vi.fn();
		const abortSessionEntry = vi.fn(async () => false);

		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: usageTracker as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: getOrCreateSession as any,
			createScopedSession: createScopedSession as any,
			promptSession: promptSession as any,
			abortSessionEntry: abortSessionEntry as any,
		});

		const result = await runtime.sessionHandlers.patch?.({
			sessionId: "scope-patch",
			sessionName: "Gateway Session",
			model: "openai/gpt-4o",
			thinkingLevel: "high",
		}) as Record<string, unknown>;

		expect(setModel).toHaveBeenCalledOnce();
		expect(setThinkingLevel).toHaveBeenCalledWith("high");
		expect(entry.configOverride).toMatchObject({
			defaultProvider: "openai",
			defaultModel: "gpt-4o",
			defaultThinkingLevel: "high",
		});
		expect(result).toMatchObject({
			id: "scope-patch",
			sessionName: "Gateway Session",
			model: "openai/gpt-4o",
			thinkingLevel: "high",
		});
	});

	it("passes promptSession meta through chat handler responses", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const entry = createEntry("scope-meta");
		const usageTracker = { record: vi.fn() };
		const appendHistory = vi.fn();
		const getOrCreateSession = vi.fn(async () => entry);
		const createScopedSession = vi.fn();
		const promptSession = vi.fn(async () => ({
			response: "assistant:ok",
			runId: "run-meta",
			meta: {
				durationMs: 12,
				toolTrace: [{ type: "toolCall", name: "bash" }],
			},
		}));
		const abortSessionEntry = vi.fn(async () => false);

		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: usageTracker as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: getOrCreateSession as any,
			createScopedSession: createScopedSession as any,
			promptSession: promptSession as any,
			abortSessionEntry: abortSessionEntry as any,
		});

		const result = await runtime.chatHandler("hello", {
			channelId: "web",
			senderId: "user-meta",
		});

		expect(result).toMatchObject({
			sessionId: "scope-meta",
			runId: "run-meta",
			status: "ok",
			meta: {
				durationMs: 12,
			},
		});
	});

	it("serializes prompt turns per session instead of prompting the same session concurrently", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const entry = createEntry("scope-serialized");
		const usageTracker = { record: vi.fn() };
		const appendHistory = vi.fn();
		const getOrCreateSession = vi.fn(async () => entry);
		const createScopedSession = vi.fn();
		const promptResolvers: Array<() => void> = [];
		const promptSession = vi.fn(async (_entry: SessionEntry, text: string) => {
			await new Promise<void>((resolve) => {
				promptResolvers.push(resolve);
			});
			const label = text.includes("first") ? "first" : "second";
			return {
				response: `assistant:${label}`,
				runId: `run:${label}`,
			};
		});
		const abortSessionEntry = vi.fn(async () => false);

		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: usageTracker as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: getOrCreateSession as any,
			createScopedSession: createScopedSession as any,
			promptSession: promptSession as any,
			abortSessionEntry: abortSessionEntry as any,
		});

		const firstTurn = runtime.chatHandler("first", {
			channelId: "web",
			senderId: "user-serialized",
		});
		await flushMicrotasks();

		const secondTurn = runtime.chatHandler("second", {
			channelId: "web",
			senderId: "user-serialized",
		});
		await Promise.resolve();

		expect(promptSession).toHaveBeenCalledTimes(1);
		expect(promptSession.mock.calls[0]?.[1]).toEqual(expect.stringContaining("first"));

		promptResolvers.shift()?.();
		await expect(firstTurn).resolves.toMatchObject({
			sessionId: "scope-serialized",
			runId: "run:first",
			status: "ok",
		});
		await flushMicrotasks();

		expect(promptSession).toHaveBeenCalledTimes(2);
		expect(promptSession.mock.calls[1]?.[1]).toEqual(expect.stringContaining("second"));

		promptResolvers.shift()?.();
		await expect(secondTurn).resolves.toMatchObject({
			sessionId: "scope-serialized",
			runId: "run:second",
			status: "ok",
		});
		expect(appendHistory.mock.calls.map((call) => [call[1], call[2]])).toEqual([
			["user", "first"],
			["assistant", "assistant:first"],
			["user", "second"],
			["assistant", "assistant:second"],
		]);
	});

	it("stores user image inputs in history and rehydrates them into runtime message content", async () => {
		const image = {
			type: "image" as const,
			data: "aGVsbG8=",
			mimeType: "image/png",
		};
		const entry = createEntry("scope-history-media", {
			session: {
				agent: {
					state: {
						messages: [
							{
								role: "system",
								content: [{ type: "text", text: "system prompt" }],
							},
						],
					},
				},
			},
		});
		const appendHistory = vi.fn((target: SessionEntry, role: "user" | "assistant", text: string, timestamp?: number, options?: any) => {
			target.history.push({
				role,
				text,
				timestamp: timestamp ?? target.history.length + 1,
				...(options?.images ? { images: options.images } : {}),
				...(options?.attachments ? { attachments: options.attachments } : {}),
			});
		});
		const runtime = createGatewaySessionRuntime({
			sessionEntries: new Map<string, SessionEntry>([[entry.id, entry]]),
			inFlightSessionIds: new Set<string>(),
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: { record: vi.fn() } as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: vi.fn(async () => entry) as any,
			createScopedSession: vi.fn(async () => entry) as any,
			promptSession: vi.fn(async () => ({ response: "captioned", runId: "run-history-media" })) as any,
			abortSessionEntry: vi.fn(async () => false) as any,
		});

		await runtime.chatHandler("caption this", {
			channelId: "web",
			senderId: "user-history-media",
			images: [image],
		});

		expect(entry.history[0]).toMatchObject({
			role: "user",
			text: "caption this",
			images: [image],
		});

		const history = await runtime.sessionHandlers.history?.({ sessionId: entry.id, limit: 10 }) as Record<string, unknown>;
		expect(history).toMatchObject({
			sessionId: entry.id,
		});
		expect(history.messages).toEqual(expect.arrayContaining([
			expect.objectContaining({
				role: "user",
				text: "caption this",
				images: [image],
			}),
		]));
		expect(history.timeline).toEqual(expect.arrayContaining([
			expect.objectContaining({
				kind: "message",
				role: "user",
				text: "caption this",
				images: [image],
			}),
		]));

		seedRuntimeMessagesFromHistory(entry, entry.history);
		expect((entry.session as any).agent.state.messages[1]).toMatchObject({
			role: "user",
			content: [
				{ type: "text", text: "caption this" },
				image,
			],
		});
	});

	it("stores recent run traces and exposes them through session.trace", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const entry = createEntry("scope-trace");
		sessionEntries.set(entry.id, entry);
		const usageTracker = { record: vi.fn() };
		const appendHistory = vi.fn();
		const getOrCreateSession = vi.fn(async () => entry);
		const createScopedSession = vi.fn();
		const promptSession = vi.fn(async () => ({
			response: "assistant:trace-ready",
			runId: "run-trace",
			meta: {
				durationMs: 21,
				thoughtText: "Inspect the draft list first.",
				progressSteps: [
					{ kind: "status", label: "Thinking through the task.", state: "done", updatedAt: 10 },
					{ kind: "tool", label: "Click Save button", toolName: "gui_click", route: "gui", state: "done", updatedAt: 11 },
				],
				toolTrace: [
					{ type: "toolCall", name: "gui_click", route: "gui", arguments: { target: "Save button" } },
					{
						type: "toolResult",
						name: "gui_click",
						route: "gui",
						textPreview: "Clicked Save button",
						status: { code: "condition_met", summary: "Save confirmation appeared" },
					},
				],
				attempts: [
					{
						attempt: 1,
						toolTrace: [{ type: "toolResult", name: "gui_click", route: "gui", textPreview: "Clicked Save button" }],
					},
				],
			},
		}));
		const abortSessionEntry = vi.fn(async () => false);

		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: usageTracker as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: getOrCreateSession as any,
			createScopedSession: createScopedSession as any,
			promptSession: promptSession as any,
			abortSessionEntry: abortSessionEntry as any,
		});

		await runtime.chatHandler("save the draft", {
			channelId: "web",
			senderId: "user-trace",
		});

		const summary = await runtime.sessionHandlers.get({ sessionId: "scope-trace" }) as Record<string, unknown>;
		expect(summary).toMatchObject({
			id: "scope-trace",
			lastRunId: "run-trace",
			lastToolName: "gui_click",
			lastToolRoute: "gui",
			lastToolStatus: "ok",
		});

		const trace = await runtime.sessionHandlers.trace?.({ sessionId: "scope-trace", limit: 4 }) as Record<string, unknown>;
		expect(trace).toMatchObject({
			sessionId: "scope-trace",
		});
		expect(Array.isArray(trace.runs)).toBe(true);
		expect((trace.runs as Array<Record<string, unknown>>)[0]).toMatchObject({
			runId: "run-trace",
			responsePreview: "assistant:trace-ready",
			thoughtText: "Inspect the draft list first.",
			progressSteps: [
				expect.objectContaining({ kind: "status", state: "done" }),
				expect.objectContaining({ kind: "tool", toolName: "gui_click", route: "gui", state: "done" }),
			],
		});
		expect((trace.runs as Array<Record<string, unknown>>)[0]?.toolTrace).toMatchObject([
			{ type: "toolCall", name: "gui_click", route: "gui" },
			{ type: "toolResult", name: "gui_click", route: "gui" },
		]);
	});

	it("preserves embedded tool-result image payloads in session trace and history timeline", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const entry = createEntry("scope-trace-image");
		sessionEntries.set(entry.id, entry);
		const usageTracker = { record: vi.fn() };
		const appendHistory = vi.fn((target: SessionEntry, role: "user" | "assistant", text: string) => {
			target.history.push({
				role,
				text,
				timestamp: target.history.length + 1,
			});
		});
		const imageData = "a".repeat(512);
		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: usageTracker as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: vi.fn(async () => entry) as any,
			createScopedSession: vi.fn(async () => entry) as any,
			promptSession: vi.fn(async () => ({
				response: "assistant:captured",
				runId: "run-trace-image",
				meta: {
					toolTrace: [
						{
							type: "toolResult",
							name: "gui_observe",
							route: "gui",
							textPreview: "Captured a GUI screenshot.",
							images: [
								{
									imageData,
									mimeType: "image/png",
								},
							],
						},
					],
					progressSteps: [
						{ kind: "tool", label: "Capture screenshot", toolName: "gui_observe", route: "gui", state: "done", updatedAt: 10 },
					],
				},
			})) as any,
			abortSessionEntry: vi.fn(async () => false) as any,
		});

		await runtime.chatHandler("take a screenshot", {
			channelId: "web",
			senderId: "user-trace-image",
		});

		const trace = await runtime.sessionHandlers.trace?.({ sessionId: entry.id, limit: 4 }) as Record<string, unknown>;
		expect((trace.runs as Array<Record<string, unknown>>)[0]?.toolTrace).toMatchObject([
			{
				type: "toolResult",
				name: "gui_observe",
				route: "gui",
				images: [
					{
						imageData,
						mimeType: "image/png",
					},
				],
			},
		]);

		const history = await runtime.sessionHandlers.history?.({ sessionId: entry.id, limit: 10 }) as Record<string, unknown>;
		expect(history).toMatchObject({
			sessionId: entry.id,
			timeline: [
				{ kind: "message", role: "user", text: "take a screenshot" },
				{
					kind: "run",
					runId: "run-trace-image",
					toolTrace: [
						{
							type: "toolResult",
							name: "gui_observe",
							route: "gui",
							images: [
								{
									imageData,
									mimeType: "image/png",
								},
							],
						},
					],
				},
			],
		});
	});

	it("builds history timeline entries that pair assistant replies with their run channels", async () => {
		const entry = createEntry("scope-history-timeline", {
			history: [
				{ role: "user", text: "open settings", timestamp: 1 },
				{ role: "assistant", text: "Opened settings and checked the config.", timestamp: 2 },
			],
			recentRuns: [
				{
					runId: "run-history-1",
					recordedAt: 2,
					userPromptPreview: "open settings",
					responsePreview: "Opened settings and checked the config.",
					thoughtText: "Need to inspect the settings screen first.",
					progressSteps: [
						{ kind: "status", label: "Thinking through the task.", state: "done", updatedAt: 1 },
						{ kind: "tool", label: "Open settings", toolName: "gui_click", route: "gui", state: "done", updatedAt: 2 },
					],
					toolTrace: [
						{ type: "toolCall", name: "gui_click", route: "gui" },
						{ type: "toolResult", name: "gui_click", route: "gui", textPreview: "Opened settings" },
					],
					attempts: [],
				},
			],
		});
		const runtime = createGatewaySessionRuntime({
			sessionEntries: new Map<string, SessionEntry>([[entry.id, entry]]),
			inFlightSessionIds: new Set<string>(),
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: { record: vi.fn() } as any,
			estimateTokens: (text) => text.length,
			appendHistory: vi.fn() as any,
			getOrCreateSession: vi.fn(async () => entry) as any,
			createScopedSession: vi.fn(async () => entry) as any,
			promptSession: vi.fn(async () => ({ response: "ok", runId: "run" })) as any,
			abortSessionEntry: vi.fn(async () => false) as any,
		});

		const history = await runtime.sessionHandlers.history?.({ sessionId: entry.id, limit: 10 }) as Record<string, unknown>;

		expect(history).toMatchObject({
			sessionId: entry.id,
			timeline: [
				{ kind: "message", role: "user", text: "open settings", timestamp: 1 },
				{
					kind: "run",
					role: "assistant",
					runId: "run-history-1",
					assistantText: "Opened settings and checked the config.",
					thoughtText: "Need to inspect the settings screen first.",
					progressSteps: [
						expect.objectContaining({ kind: "status", state: "done" }),
						expect.objectContaining({ kind: "tool", toolName: "gui_click", route: "gui", state: "done" }),
					],
				},
			],
		});
	});

	it("includes the active run snapshot in session.trace while a run is still in flight", async () => {
		const entry = createEntry("scope-active-run");
		const sessionEntries = new Map<string, SessionEntry>([[entry.id, entry]]);
		const inFlightSessionIds = new Set<string>([entry.id]);
		const waitForRun = vi.fn(async () => ({
			runId: "run-active-1",
			status: "timeout",
			startedAt: 100,
			sessionId: entry.id,
			progress: {
				summary: "Running a shell command.",
				stage: "tool",
				updatedAt: 120,
				thoughtText: "Need to inspect the repo before editing.",
				assistantText: "Partial reply",
				steps: [
					{ kind: "status", label: "Thinking through the task.", state: "done", updatedAt: 101 },
					{ kind: "tool", label: "Run bash", toolName: "bash", route: "shell", state: "running", updatedAt: 120 },
				],
			},
		}));
		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: { record: vi.fn() } as any,
			estimateTokens: (text) => text.length,
			appendHistory: vi.fn() as any,
			getOrCreateSession: vi.fn(async () => entry) as any,
			createScopedSession: vi.fn(async () => entry) as any,
			promptSession: vi.fn(async () => ({ response: "done", runId: "run-active-1" })) as any,
			abortSessionEntry: vi.fn(async () => false) as any,
			waitForRun,
		});

		const trace = await runtime.sessionHandlers.trace?.({ sessionId: entry.id, limit: 4 }) as Record<string, unknown>;

		expect(trace).toMatchObject({
			sessionId: entry.id,
			activeRun: {
				runId: "run-active-1",
				status: "in_flight",
				summary: "Running a shell command.",
				thoughtText: "Need to inspect the repo before editing.",
				assistantText: "Partial reply",
				steps: [
					expect.objectContaining({ kind: "status", state: "done" }),
					expect.objectContaining({ kind: "tool", toolName: "bash", route: "shell", state: "running" }),
				],
			},
		});
	});

	it("does not expose completed snapshots as activeRun in session.trace", async () => {
		const entry = createEntry("scope-active-run-finished");
		const runtime = createGatewaySessionRuntime({
			sessionEntries: new Map<string, SessionEntry>([[entry.id, entry]]),
			inFlightSessionIds: new Set<string>(),
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: { record: vi.fn() } as any,
			estimateTokens: (text) => text.length,
			appendHistory: vi.fn() as any,
			getOrCreateSession: vi.fn(async () => entry) as any,
			createScopedSession: vi.fn(async () => entry) as any,
			promptSession: vi.fn(async () => ({ response: "done", runId: "run-active-finished" })) as any,
			abortSessionEntry: vi.fn(async () => false) as any,
			waitForRun: vi.fn(async () => ({
				runId: "run-active-finished",
				status: "ok",
				startedAt: 100,
				endedAt: 140,
				sessionId: entry.id,
				progress: {
					summary: "Thinking through the task.",
					stage: "reply",
					updatedAt: 140,
					thoughtText: "Stale thought text",
				},
			})) as any,
		});

		const trace = await runtime.sessionHandlers.trace?.({ sessionId: entry.id, limit: 4 }) as Record<string, unknown>;

		expect(trace).toMatchObject({
			sessionId: entry.id,
		});
		expect("activeRun" in trace).toBe(false);
	});

	it("loads attachment images into prompt options for media-only chat input", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "understudy-gateway-media-"));
		try {
			const imagePath = join(tempDir, "demo.png");
			writeFileSync(
				imagePath,
				Buffer.from(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6r9xkAAAAASUVORK5CYII=",
					"base64",
				),
			);

			const sessionEntries = new Map<string, SessionEntry>();
			const inFlightSessionIds = new Set<string>();
			const entry = createEntry("scope-media");
			const usageTracker = { record: vi.fn() };
			const appendHistory = vi.fn();
			const getOrCreateSession = vi.fn(async () => entry);
			const createScopedSession = vi.fn();
			const promptSession = vi.fn(async () => ({
				response: "assistant:image seen",
				runId: "run-media",
			}));
			const abortSessionEntry = vi.fn(async () => false);

			const runtime = createGatewaySessionRuntime({
				sessionEntries,
				inFlightSessionIds,
				config: {
					defaultModel: "claude-sonnet-4-6",
					defaultProvider: "anthropic",
					agent: { userTimezone: "Asia/Hong_Kong" },
				} as any,
				usageTracker: usageTracker as any,
				estimateTokens: (text) => text.length,
				appendHistory: appendHistory as any,
				getOrCreateSession: getOrCreateSession as any,
				createScopedSession: createScopedSession as any,
				promptSession: promptSession as any,
				abortSessionEntry: abortSessionEntry as any,
			});

			const result = await runtime.chatHandler("", {
				channelId: "telegram",
				senderId: "user-media",
				attachments: [
					{
						type: "image",
						url: imagePath,
						name: "demo.png",
						mimeType: "image/png",
					},
				],
			} as any);

			expect(promptSession).toHaveBeenCalledTimes(1);
			const firstCall = promptSession.mock.calls[0] as unknown as [
				SessionEntry,
				string,
				string,
				{ images?: Array<{ data: string; mimeType: string }> } | undefined,
			];
			const promptText = firstCall[1];
			const promptOptions = firstCall[3];
			const promptImages = promptOptions?.images ?? [];
			expect(promptText).toContain("Please inspect the attached image");
			expect(promptText).toContain(`<file name="demo.png" source="${imagePath}"></file>`);
			expect(promptImages).toHaveLength(1);
			expect(promptImages[0]).toMatchObject({
				mimeType: "image/png",
			});
			expect(promptImages[0]?.data.length).toBeGreaterThan(0);
			expect(result).toMatchObject({
				sessionId: "scope-media",
				runId: "run-media",
				response: "assistant:image seen",
			});
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("strips inline directive tags from assistant responses before returning and storing them", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const entry = createEntry("scope-strip");
		const usageTracker = { record: vi.fn() };
		const appendHistory = vi.fn();
		const getOrCreateSession = vi.fn(async () => entry);
		const createScopedSession = vi.fn();
		const promptSession = vi.fn(async () => ({
			response: "[[reply_to_current]] hi there [[audio_as_voice]]",
			runId: "run-strip",
		}));
		const abortSessionEntry = vi.fn(async () => false);

		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: usageTracker as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: getOrCreateSession as any,
			createScopedSession: createScopedSession as any,
			promptSession: promptSession as any,
			abortSessionEntry: abortSessionEntry as any,
		});

		const result = await runtime.chatHandler("hello", {
			channelId: "web",
			senderId: "user-strip",
		});

		expect(result).toMatchObject({
			sessionId: "scope-strip",
			runId: "run-strip",
			response: "hi there",
		});
		expect(appendHistory).toHaveBeenCalledWith(entry, "assistant", "hi there", undefined, undefined);
		expect(usageTracker.record).toHaveBeenCalledWith(
			expect.objectContaining({
				outputTokens: "hi there".length,
			}),
		);
	});

	it("suppresses bare silent tokens from assistant responses", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const entry = createEntry("scope-silent");
		const usageTracker = { record: vi.fn() };
		const appendHistory = vi.fn();
		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: usageTracker as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: vi.fn(async () => entry) as any,
			createScopedSession: vi.fn() as any,
			promptSession: vi.fn(async () => ({
				response: "[[SILENT]]",
				runId: "run-silent",
			})) as any,
			abortSessionEntry: vi.fn(async () => false) as any,
		});

		const result = await runtime.chatHandler("handle this via message_send", {
			channelId: "web",
			senderId: "user-silent",
		});

		expect(result).toMatchObject({
			sessionId: "scope-silent",
			runId: "run-silent",
			response: "",
		});
		expect(appendHistory).toHaveBeenCalledWith(
			entry,
			"user",
			expect.stringContaining("handle this via message_send"),
			undefined,
			undefined,
		);
		expect(appendHistory.mock.calls.filter((call) => call[1] === "assistant")).toHaveLength(0);
		expect(usageTracker.record).toHaveBeenCalledWith(
			expect.objectContaining({
				outputTokens: 0,
			}),
		);
		expect(entry.messageCount).toBe(0);
	});

	it("strips inline directive tags from assistant messages returned by session history", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const entry = createEntry("scope-history", {
			history: [
				{ role: "user", text: "[[reply_to_current]] keep me", timestamp: 1 },
				{ role: "assistant", text: "[[reply_to_current]] hello", timestamp: 2 },
			],
		});
		sessionEntries.set(entry.id, entry);
		const usageTracker = { record: vi.fn() };
		const appendHistory = vi.fn();
		const getOrCreateSession = vi.fn(async () => entry);
		const createScopedSession = vi.fn();
		const promptSession = vi.fn();
		const abortSessionEntry = vi.fn(async () => false);

		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: usageTracker as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: getOrCreateSession as any,
			createScopedSession: createScopedSession as any,
			promptSession: promptSession as any,
			abortSessionEntry: abortSessionEntry as any,
		});

		const history = await runtime.sessionHandlers.history?.({ sessionId: entry.id });

		expect(history).toMatchObject({
			sessionId: "scope-history",
			messages: [
				{ role: "user", text: "[[reply_to_current]] keep me", timestamp: 1 },
				{ role: "assistant", text: "hello", timestamp: 2 },
			],
		});
	});

	it("supports background execution and forwards explicit workspace context", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const entry = createEntry("scope-async");
		const usageTracker = { record: vi.fn() };
		const appendHistory = vi.fn();
		const getOrCreateSession = vi.fn(async () => entry);
		const createScopedSession = vi.fn();
		let resolvePrompt:
			| ((value: { response: string; runId: string; meta?: Record<string, unknown> }) => void)
			| undefined;
		const promptSession = vi.fn(
			async (_entry: SessionEntry, text: string, runId?: string) =>
				await new Promise<{ response: string; runId: string; meta?: Record<string, unknown> }>((resolve) => {
					resolvePrompt = resolve;
					void text;
					void runId;
				}),
		);
		const abortSessionEntry = vi.fn(async () => false);

		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: usageTracker as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: getOrCreateSession as any,
			createScopedSession: createScopedSession as any,
			promptSession: promptSession as any,
			abortSessionEntry: abortSessionEntry as any,
		});

		const result = await runtime.chatHandler("repair the repo", {
			channelId: "web",
			senderId: "user-async",
			cwd: "/tmp/demo-repo",
			waitForCompletion: false,
		});

		expect(getOrCreateSession).toHaveBeenCalledWith({
			channelId: "web",
			senderId: "user-async",
			conversationType: undefined,
			threadId: undefined,
			workspaceDir: "/tmp/demo-repo",
			explicitWorkspace: true,
		});
		expect(result).toMatchObject({
			sessionId: "scope-async",
			status: "in_flight",
		});
		expect(typeof (result as { runId?: unknown }).runId).toBe("string");
		expect(appendHistory).toHaveBeenCalledWith(
			entry,
			"user",
			expect.stringContaining("repair the repo"),
			undefined,
			undefined,
		);

		resolvePrompt?.({
			response: "assistant:done",
			runId: (result as { runId: string }).runId,
			meta: { durationMs: 42 },
		});
		await Promise.resolve();
		await Promise.resolve();

		expect(appendHistory).toHaveBeenCalledWith(entry, "assistant", "assistant:done", undefined, undefined);
		expect(usageTracker.record).toHaveBeenCalledTimes(1);
		expect(entry.messageCount).toBe(1);
	});

	it("does not surface background prompt failures as unhandled rejections", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const entry = createEntry("scope-async-error");
		const usageTracker = { record: vi.fn() };
		const appendHistory = vi.fn((target: SessionEntry, role: "user" | "assistant", text: string) => {
			target.history.push({
				role,
				text,
				timestamp: target.history.length + 1,
			});
		});
		const getOrCreateSession = vi.fn(async () => entry);
		const createScopedSession = vi.fn();
		const promptSession = vi.fn(async () => {
			throw new Error("No API key found for anthropic.");
		});
		const abortSessionEntry = vi.fn(async () => false);
		const unhandledRejection = vi.fn();
		process.on("unhandledRejection", unhandledRejection);

		try {
			const runtime = createGatewaySessionRuntime({
				sessionEntries,
				inFlightSessionIds,
				config: {
					defaultModel: "claude-sonnet-4-6",
					defaultProvider: "anthropic",
					agent: { userTimezone: "Asia/Hong_Kong" },
				} as any,
				usageTracker: usageTracker as any,
				estimateTokens: (text) => text.length,
				appendHistory: appendHistory as any,
				getOrCreateSession: getOrCreateSession as any,
				createScopedSession: createScopedSession as any,
				promptSession: promptSession as any,
				abortSessionEntry: abortSessionEntry as any,
			});

			const result = await runtime.chatHandler("summarize the repo", {
				channelId: "web",
				senderId: "user-async-error",
				waitForCompletion: false,
			});

			expect(result).toMatchObject({
				sessionId: "scope-async-error",
				status: "in_flight",
			});

			await flushMicrotasks(12);

			expect(unhandledRejection).not.toHaveBeenCalled();
			expect(appendHistory).toHaveBeenCalledWith(
				entry,
				"user",
				expect.stringContaining("summarize the repo"),
				undefined,
				undefined,
			);
			expect(appendHistory.mock.calls.some(([_, role]) => role === "assistant")).toBe(false);
			expect(usageTracker.record).not.toHaveBeenCalled();
			expect(entry.messageCount).toBe(0);
		} finally {
			process.off("unhandledRejection", unhandledRejection);
		}
	});

	it("forwards session config overrides and sandbox info into scoped session lookup/reset", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const entry = createEntry("scope-policy", {
			configOverride: {
				agent: {
					sandbox: {
						mode: "strict",
					},
				},
			} as any,
			sandboxInfo: {
				enabled: true,
				workspaceDir: "/srv/ops",
				workspaceAccess: "ro",
			},
			executionScopeKey: "cp:ops:strict",
		});
		sessionEntries.set(entry.id, entry);
		const usageTracker = { record: vi.fn() };
		const appendHistory = vi.fn();
		const getOrCreateSession = vi.fn(async () => entry);
		const createScopedSession = vi.fn(async () => entry);
		const deletePersistedSession = vi.fn(async () => undefined);
		const promptSession = vi.fn(async () => ({
			response: "assistant:ok",
			runId: "run-policy",
		}));
		const abortSessionEntry = vi.fn(async () => false);

		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: usageTracker as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: getOrCreateSession as any,
			createScopedSession: createScopedSession as any,
			promptSession: promptSession as any,
			abortSessionEntry: abortSessionEntry as any,
			deletePersistedSession,
		});

		await runtime.chatHandler("check isolation", {
			channelId: "ops-runtime",
			senderId: "ops",
			cwd: "/srv/ops",
			configOverride: entry.configOverride,
			sandboxInfo: entry.sandboxInfo,
			executionScopeKey: entry.executionScopeKey,
		} as any);

		expect(getOrCreateSession).toHaveBeenCalledWith({
			channelId: "ops-runtime",
			senderId: "ops",
			conversationType: undefined,
			threadId: undefined,
			workspaceDir: "/srv/ops",
			explicitWorkspace: true,
			configOverride: entry.configOverride,
			sandboxInfo: entry.sandboxInfo,
			executionScopeKey: "cp:ops:strict",
		});

		await runtime.sessionHandlers.reset?.({ sessionId: entry.id });
		expect(deletePersistedSession).toHaveBeenCalledWith({ sessionId: entry.id });
		expect(createScopedSession).toHaveBeenCalledWith({
			sessionKey: entry.id,
			parentId: entry.parentId,
			forkPoint: entry.forkPoint,
			channelId: entry.channelId,
			senderId: entry.senderId,
			conversationType: entry.conversationType,
			threadId: entry.threadId,
			workspaceDir: entry.workspaceDir,
			configOverride: entry.configOverride,
			sandboxInfo: entry.sandboxInfo,
			executionScopeKey: entry.executionScopeKey,
		});
	});

	it("spawns native subagents and waits on their latest run", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const parent = createEntry("parent-1", {
			history: [
				{ role: "user", text: "plan", timestamp: 1 },
				{ role: "assistant", text: "working", timestamp: 2 },
			],
			session: {
				agent: {
					state: {
						messages: [
							{ role: "system", content: [{ type: "text", text: "system prompt" }] },
							{ role: "user", content: [{ type: "text", text: "plan" }] },
							{ role: "assistant", content: [{ type: "text", text: "working" }] },
						],
					},
				},
			},
		});
		sessionEntries.set(parent.id, parent);
		const usageTracker = { record: vi.fn() };
		const appendHistory = vi.fn();
		const createScopedSession = vi.fn(async (context: { sessionKey: string; parentId?: string; forkPoint?: number }) =>
			createEntry(context.sessionKey, {
				parentId: context.parentId,
				forkPoint: context.forkPoint,
				session: {
					agent: {
						state: {
							messages: [{ role: "system", content: [{ type: "text", text: "child prompt" }] }],
						},
					},
				},
			}),
		);
		const promptSession = vi.fn(async (_entry: SessionEntry, _text: string, runId?: string) => ({
			response: "child complete",
			runId: runId ?? "child-run",
		}));
		const waitForRun = vi.fn(async (params: { sessionId?: string; runId?: string }) => ({
			status: "ok",
			sessionId: params.sessionId,
			runId: params.runId,
			response: "child complete",
		}));

		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: usageTracker as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: vi.fn(async () => parent) as any,
			createScopedSession: createScopedSession as any,
			promptSession: promptSession as any,
			abortSessionEntry: vi.fn(async () => false) as any,
			waitForRun: waitForRun as any,
		});

		const spawn = await runtime.sessionHandlers.spawnSubagent?.({
			parentSessionId: parent.id,
			task: "delegate this",
			mode: "session",
			thread: true,
			label: "research",
		});

		expect(spawn).toMatchObject({
			status: "in_flight",
			parentSessionId: parent.id,
			mode: "session",
			runtime: "subagent",
		});
		const childSessionId = (spawn as Record<string, unknown>).childSessionId as string;
		const child = sessionEntries.get(childSessionId);
		expect(child?.subagentMeta).toMatchObject({
			parentSessionId: parent.id,
			label: "research",
			mode: "session",
			thread: true,
		});
		expect(child?.history).toHaveLength(2);
		expect(createScopedSession).toHaveBeenCalledWith(
			expect.objectContaining({
				parentId: parent.id,
				forkPoint: 2,
			}),
		);

		const listed = await runtime.sessionHandlers.subagents?.({
			action: "list",
			parentSessionId: parent.id,
		});
		expect(listed).toMatchObject({
			parentSessionId: parent.id,
			subagents: [expect.objectContaining({ sessionId: childSessionId, label: "research" })],
		});

		const waited = await runtime.sessionHandlers.subagents?.({
			action: "wait",
			parentSessionId: parent.id,
			target: childSessionId,
			timeoutMs: 500,
		});
		expect(waitForRun).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: childSessionId,
				timeoutMs: 500,
			}),
		);
		expect(waited).toMatchObject({
			status: "ok",
			childSessionId,
			response: "child complete",
		});
	});

	it("passes spawn attachments into the child session's initial prompt", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "understudy-subagent-media-"));
		try {
			const imagePath = join(tempDir, "diagram.png");
			writeFileSync(
				imagePath,
				Buffer.from(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6r9xkAAAAASUVORK5CYII=",
					"base64",
				),
			);

			const sessionEntries = new Map<string, SessionEntry>();
			const inFlightSessionIds = new Set<string>();
			const parent = createEntry("parent-with-attachments");
			sessionEntries.set(parent.id, parent);
			const createScopedSession = vi.fn(async (context: { sessionKey: string; parentId?: string }) =>
				createEntry(context.sessionKey, {
					parentId: context.parentId,
					session: {
						agent: {
							state: {
								messages: [{ role: "system", content: [{ type: "text", text: "child prompt" }] }],
							},
						},
					},
				}),
			);
			const promptSession = vi.fn(async (_entry: SessionEntry, _text: string, runId?: string) => ({
				response: "child started",
				runId: runId ?? "child-run",
			}));

			const runtime = createGatewaySessionRuntime({
				sessionEntries,
				inFlightSessionIds,
				config: {
					defaultModel: "claude-sonnet-4-6",
					defaultProvider: "anthropic",
					agent: { userTimezone: "Asia/Hong_Kong" },
				} as any,
				usageTracker: { record: vi.fn() } as any,
				estimateTokens: (text) => text.length,
				appendHistory: vi.fn() as any,
				getOrCreateSession: vi.fn(async () => parent) as any,
				createScopedSession: createScopedSession as any,
				promptSession: promptSession as any,
				abortSessionEntry: vi.fn(async () => false) as any,
			});

			await runtime.sessionHandlers.spawnSubagent?.({
				parentSessionId: parent.id,
				task: "Review this screenshot",
				attachments: [
					{
						type: "image",
						url: imagePath,
						name: "diagram.png",
						mimeType: "image/png",
					},
				],
			});

			expect(promptSession).toHaveBeenCalledTimes(1);
			const firstCall = promptSession.mock.calls[0] as unknown as [
				SessionEntry,
				string,
				string,
				{ images?: Array<{ data: string; mimeType: string }> } | undefined,
			];
			expect(firstCall[1]).toContain("Review this screenshot");
			expect(firstCall[1]).toContain(`<file name="diagram.png" source="${imagePath}"></file>`);
			expect(firstCall[3]?.images).toHaveLength(1);
			expect(firstCall[3]?.images?.[0]).toMatchObject({
				mimeType: "image/png",
			});
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("kills cleanup-delete subagents and removes their child session entry", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const parent = createEntry("parent-2");
		const child = createEntry("parent-2:subagent:test", {
			parentId: parent.id,
			subagentMeta: {
				parentSessionId: parent.id,
				runtime: "subagent",
				mode: "run",
				cleanup: "delete",
				thread: false,
				createdAt: 1,
				updatedAt: 2,
				latestRunId: "run-child-1",
				latestRunStatus: "in_flight",
				runCount: 1,
			},
		});
		sessionEntries.set(parent.id, parent);
		sessionEntries.set(child.id, child);
		const abortSessionEntry = vi.fn(async () => true);

		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: { record: vi.fn() } as any,
			estimateTokens: (text) => text.length,
			appendHistory: vi.fn() as any,
			getOrCreateSession: vi.fn(async () => parent) as any,
			createScopedSession: vi.fn(async () => child) as any,
			promptSession: vi.fn(async () => ({ response: "ok", runId: "run" })) as any,
			abortSessionEntry: abortSessionEntry as any,
		});

		const result = await runtime.sessionHandlers.subagents?.({
			action: "kill",
			parentSessionId: parent.id,
			target: child.id,
		});

		expect(abortSessionEntry).toHaveBeenCalledWith(child);
		expect(result).toMatchObject({
			aborted: true,
			childSessionId: child.id,
			cleanedUp: true,
		});
		expect(sessionEntries.has(child.id)).toBe(false);
	});

	it("routes runtime=acp child sessions through an acp config override", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const parent = createEntry("parent-acp", {
			history: [{ role: "user", text: "bootstrap", timestamp: 1 }],
		});
		sessionEntries.set(parent.id, parent);
		const usageTracker = { record: vi.fn() };
		const appendHistory = vi.fn();
		const createScopedSession = vi.fn(async (params: Record<string, unknown>) =>
			createEntry((params.sessionKey as string) ?? "child-acp", {
				parentId: parent.id,
				configOverride: params.configOverride as any,
			}),
		);
		const promptSession = vi.fn(async (_entry: SessionEntry, text: string, runId?: string) => ({
			response: `assistant:${text}`,
			runId: runId ?? "acp-run-1",
		}));

		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: usageTracker as any,
			estimateTokens: (text) => text.length,
			appendHistory: appendHistory as any,
			getOrCreateSession: vi.fn(async () => parent) as any,
			createScopedSession: createScopedSession as any,
			promptSession: promptSession as any,
			abortSessionEntry: vi.fn(async () => true) as any,
		});

		const spawn = await runtime.sessionHandlers.spawnSubagent?.({
			parentSessionId: parent.id,
			task: "fix this in codex",
			runtime: "acp",
			mode: "session",
		});

		expect(createScopedSession).toHaveBeenCalledWith(
			expect.objectContaining({
				configOverride: expect.objectContaining({
					agent: expect.objectContaining({
						runtimeBackend: "acp",
					}),
				}),
			}),
		);
		expect(spawn).toMatchObject({
			runtime: "acp",
			mode: "session",
			status: "in_flight",
		});
		const childSessionId = (spawn as Record<string, unknown>).childSessionId as string;
		expect(sessionEntries.get(childSessionId)?.subagentMeta).toMatchObject({
			parentSessionId: parent.id,
			runtime: "acp",
			mode: "session",
		});
	});

	it("applies agent profile defaults to spawned subagent sessions", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const parent = createEntry("parent-agent-profile");
		sessionEntries.set(parent.id, parent);
		const createScopedSession = vi.fn(async (params: Record<string, unknown>) =>
			createEntry((params.sessionKey as string) ?? "child-agent-profile", {
				parentId: parent.id,
				workspaceDir: params.workspaceDir as string | undefined,
				configOverride: params.configOverride as any,
			}),
		);
		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds,
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: { record: vi.fn() } as any,
			estimateTokens: (text) => text.length,
			appendHistory: vi.fn() as any,
			getOrCreateSession: vi.fn(async () => parent) as any,
			createScopedSession: createScopedSession as any,
			promptSession: vi.fn(async () => ({ response: "ok", runId: "run" })) as any,
			abortSessionEntry: vi.fn(async () => true) as any,
			resolveAgentTarget: (agentId: string) =>
				agentId === "ops"
					? {
						agentId: "ops",
						workspaceDir: "/tmp/ops-workspace",
						model: "openai/gpt-5-codex",
					}
					: null,
		});

		const result = await runtime.sessionHandlers.spawnSubagent?.({
			parentSessionId: parent.id,
			task: "investigate the failing test",
			agentId: "ops",
			runtime: "subagent",
		});

		expect(createScopedSession).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceDir: "/tmp/ops-workspace",
				explicitWorkspace: true,
				configOverride: expect.objectContaining({
					defaultProvider: "openai",
					defaultModel: "gpt-5-codex",
				}),
			}),
		);
		expect(result).toMatchObject({
			status: "in_flight",
			notes: ['Using agent profile "ops" for child workspace/model defaults.'],
		});
	});

	it("rejects unsupported ACP thread and sandbox overrides when spawning child sessions", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const parent = createEntry("parent-acp-invalid");
		sessionEntries.set(parent.id, parent);
		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds: new Set<string>(),
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: { record: vi.fn() } as any,
			estimateTokens: (text) => text.length,
			appendHistory: vi.fn() as any,
			getOrCreateSession: vi.fn(async () => parent) as any,
			createScopedSession: vi.fn(async () => parent) as any,
			promptSession: vi.fn(async () => ({ response: "ok", runId: "run" })) as any,
			abortSessionEntry: vi.fn(async () => true) as any,
		});

		await expect(runtime.sessionHandlers.spawnSubagent?.({
			parentSessionId: parent.id,
			task: "delegate to acp",
			runtime: "acp",
			thread: true,
		})).rejects.toThrow('runtime="acp" does not support `thread=true` yet');

		await expect(runtime.sessionHandlers.spawnSubagent?.({
			parentSessionId: parent.id,
			task: "delegate to acp",
			runtime: "acp",
			sandbox: "require",
		})).rejects.toThrow('runtime="acp" does not support `sandbox="require"`');
	});

	it("rejects invalid child runtime, mode, and cleanup values", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const parent = createEntry("parent-invalid-child-shape");
		sessionEntries.set(parent.id, parent);
		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds: new Set<string>(),
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: { record: vi.fn() } as any,
			estimateTokens: (text) => text.length,
			appendHistory: vi.fn() as any,
			getOrCreateSession: vi.fn(async () => parent) as any,
			createScopedSession: vi.fn(async () => parent) as any,
			promptSession: vi.fn(async () => ({ response: "ok", runId: "run" })) as any,
			abortSessionEntry: vi.fn(async () => true) as any,
		});

		await expect(runtime.sessionHandlers.spawnSubagent?.({
			parentSessionId: parent.id,
			task: "delegate",
			runtime: "remote",
		})).rejects.toThrow('runtime must be "subagent" or "acp"');

		await expect(runtime.sessionHandlers.spawnSubagent?.({
			parentSessionId: parent.id,
			task: "delegate",
			mode: "thread",
		})).rejects.toThrow('mode must be "run" or "session"');

		await expect(runtime.sessionHandlers.spawnSubagent?.({
			parentSessionId: parent.id,
			task: "delegate",
			cleanup: "archive",
		})).rejects.toThrow('cleanup must be "keep" or "delete"');
	});

	it("preserves inherited sandbox settings when child sessions require strict sandboxing", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const parent = createEntry("parent-sandbox-inherit", {
			configOverride: {
				agent: {
					sandbox: {
						dockerImage: "understudy-sandbox:latest",
						workspaceMountMode: "ro",
						disableNetwork: true,
					},
				},
			} as any,
		});
		sessionEntries.set(parent.id, parent);
		const createScopedSession = vi.fn(async (params: Record<string, unknown>) =>
			createEntry((params.sessionKey as string) ?? "child-sandbox", {
				parentId: parent.id,
				configOverride: params.configOverride as any,
			}),
		);
		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds: new Set<string>(),
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: { record: vi.fn() } as any,
			estimateTokens: (text) => text.length,
			appendHistory: vi.fn() as any,
			getOrCreateSession: vi.fn(async () => parent) as any,
			createScopedSession: createScopedSession as any,
			promptSession: vi.fn(async () => ({ response: "ok", runId: "run" })) as any,
			abortSessionEntry: vi.fn(async () => true) as any,
		});

		await runtime.sessionHandlers.spawnSubagent?.({
			parentSessionId: parent.id,
			task: "delegate with strict sandbox",
			sandbox: "require",
		});

		expect(createScopedSession).toHaveBeenCalledWith(expect.objectContaining({
			configOverride: expect.objectContaining({
				agent: expect.objectContaining({
					sandbox: expect.objectContaining({
						mode: "strict",
						dockerImage: "understudy-sandbox:latest",
						workspaceMountMode: "ro",
						disableNetwork: true,
					}),
				}),
			}),
		}));
	});

	it("rejects reuse-time child overrides that cannot be applied safely", async () => {
		const sessionEntries = new Map<string, SessionEntry>();
		const parent = createEntry("parent-reuse-child");
		const child = createEntry("parent-reuse-child:subagent:existing", {
			parentId: parent.id,
			workspaceDir: "/tmp/original-workspace",
			configOverride: {
				defaultProvider: "anthropic",
				defaultModel: "claude-sonnet-4-6",
			},
			subagentMeta: {
				parentSessionId: parent.id,
				runtime: "subagent",
				mode: "session",
				cleanup: "keep",
				thread: true,
				createdAt: 1,
				updatedAt: 2,
				runCount: 1,
				latestRunStatus: "idle",
			},
		});
		sessionEntries.set(parent.id, parent);
		sessionEntries.set(child.id, child);
		const runtime = createGatewaySessionRuntime({
			sessionEntries,
			inFlightSessionIds: new Set<string>(),
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: { record: vi.fn() } as any,
			estimateTokens: (text) => text.length,
			appendHistory: vi.fn() as any,
			getOrCreateSession: vi.fn(async () => parent) as any,
			createScopedSession: vi.fn(async () => child) as any,
			promptSession: vi.fn(async () => ({ response: "ok", runId: "run" })) as any,
			abortSessionEntry: vi.fn(async () => true) as any,
			resolveAgentTarget: (agentId: string) =>
				agentId === "ops"
					? {
						agentId: "ops",
						workspaceDir: "/tmp/ops-workspace",
						model: "openai/gpt-5-codex",
					}
					: null,
		});

		await expect(runtime.sessionHandlers.spawnSubagent?.({
			parentSessionId: parent.id,
			childSessionId: child.id,
			task: "reuse with overrides",
			agentId: "ops",
		})).rejects.toThrow("Reusing an existing child session does not support runtime, workspace, profile, or sandbox overrides.");
	});

	it("falls back to transcript history when the session is not loaded", async () => {
		const runtime = createGatewaySessionRuntime({
			sessionEntries: new Map<string, SessionEntry>(),
			inFlightSessionIds: new Set<string>(),
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: { record: vi.fn() } as any,
			estimateTokens: (text) => text.length,
			appendHistory: vi.fn() as any,
			getOrCreateSession: vi.fn(async () => {
				throw new Error("not expected");
			}) as any,
			createScopedSession: vi.fn(async () => {
				throw new Error("not expected");
			}) as any,
			promptSession: vi.fn(async () => ({ response: "ok", runId: "run" })) as any,
			abortSessionEntry: vi.fn(async () => false) as any,
			readTranscriptHistory: vi.fn(async () => [
				{ role: "user" as const, text: "hello", timestamp: 1 },
				{ role: "assistant" as const, text: "[[reply_to_current]] hi", timestamp: 2 },
			]),
		});

		const result = await runtime.sessionHandlers.history?.({
			sessionId: "archived-1",
			limit: 10,
		});

		expect(result).toMatchObject({
			sessionId: "archived-1",
			source: "transcript",
			messages: [
				{ role: "user", text: "hello", timestamp: 1 },
				{ role: "assistant", text: "hi", timestamp: 2 },
			],
			timeline: [
				{ kind: "message", role: "user", text: "hello", timestamp: 1 },
				{ kind: "message", role: "assistant", text: "hi", timestamp: 2 },
			],
		});
	});

	it("prefers transcript history when persisted messages exceed the in-memory buffer", async () => {
		const entry = createEntry("buffered-1", {
			history: [{ role: "assistant", text: "recent", timestamp: 3 }],
		});
		const readTranscriptHistory = vi.fn(async () => [
			{ role: "user" as const, text: "older", timestamp: 1 },
			{ role: "assistant" as const, text: "middle", timestamp: 2 },
			{ role: "assistant" as const, text: "recent", timestamp: 3 },
		]);
		const runtime = createGatewaySessionRuntime({
			sessionEntries: new Map<string, SessionEntry>([[entry.id, entry]]),
			inFlightSessionIds: new Set<string>(),
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: { record: vi.fn() } as any,
			estimateTokens: (text) => text.length,
			appendHistory: vi.fn() as any,
			getOrCreateSession: vi.fn(async () => entry) as any,
			createScopedSession: vi.fn(async () => entry) as any,
			promptSession: vi.fn(async () => ({ response: "ok", runId: "run" })) as any,
			abortSessionEntry: vi.fn(async () => false) as any,
			readTranscriptHistory,
		});

		const result = await runtime.sessionHandlers.history?.({
			sessionId: entry.id,
			limit: 10,
		});

		expect(readTranscriptHistory).toHaveBeenCalledWith({
			sessionId: entry.id,
			limit: 10,
		});
		expect(result).toMatchObject({
			sessionId: entry.id,
			source: "transcript",
			messages: [
				{ role: "user", text: "older", timestamp: 1 },
				{ role: "assistant", text: "middle", timestamp: 2 },
				{ role: "assistant", text: "recent", timestamp: 3 },
			],
			timeline: [
				{ kind: "message", role: "user", text: "older", timestamp: 1 },
				{ kind: "message", role: "assistant", text: "middle", timestamp: 2 },
				{ kind: "message", role: "assistant", text: "recent", timestamp: 3 },
			],
		});
	});

	it("falls back to persisted session metadata when the live session is unavailable", async () => {
		const runtime = createGatewaySessionRuntime({
			sessionEntries: new Map<string, SessionEntry>(),
			inFlightSessionIds: new Set<string>(),
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: { record: vi.fn() } as any,
			estimateTokens: (text) => text.length,
			appendHistory: vi.fn() as any,
			getOrCreateSession: vi.fn(async () => {
				throw new Error("not expected");
			}) as any,
			createScopedSession: vi.fn(async () => {
				throw new Error("not expected");
			}) as any,
			promptSession: vi.fn(async () => ({ response: "ok", runId: "run" })) as any,
			abortSessionEntry: vi.fn(async () => false) as any,
			readPersistedSession: vi.fn(async () => ({
				id: "archived-2",
				createdAt: 1,
				lastActiveAt: 2,
				messageCount: 3,
				workspaceDir: "/tmp/archived-2",
			})),
		});

		const result = await runtime.sessionHandlers.get?.({
			sessionId: "archived-2",
		});

		expect(result).toEqual({
			id: "archived-2",
			createdAt: 1,
			lastActiveAt: 2,
			messageCount: 3,
			workspaceDir: "/tmp/archived-2",
			source: "persisted",
		});
	});

	it("falls back to persisted run traces when live traces are unavailable", async () => {
		const readPersistedTrace = vi.fn(async () => [
			{
				runId: "run-archived-1",
				recordedAt: 10,
				userPromptPreview: "fix bug",
				responsePreview: "done",
				toolTrace: [],
				attempts: [],
				teachValidation: {
					state: "validated",
					summary: "validation payload",
				},
			},
		]);
		const runtime = createGatewaySessionRuntime({
			sessionEntries: new Map<string, SessionEntry>(),
			inFlightSessionIds: new Set<string>(),
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: { record: vi.fn() } as any,
			estimateTokens: (text) => text.length,
			appendHistory: vi.fn() as any,
			getOrCreateSession: vi.fn(async () => {
				throw new Error("not expected");
			}) as any,
			createScopedSession: vi.fn(async () => {
				throw new Error("not expected");
			}) as any,
			promptSession: vi.fn(async () => ({ response: "ok", runId: "run" })) as any,
			abortSessionEntry: vi.fn(async () => false) as any,
			readPersistedTrace,
		});

		const result = await runtime.sessionHandlers.trace?.({
			sessionId: "archived-trace-1",
			limit: 5,
		});

		expect(readPersistedTrace).toHaveBeenCalledWith({
			sessionId: "archived-trace-1",
			limit: 5,
		});
		expect(result).toEqual({
			sessionId: "archived-trace-1",
			source: "persisted",
			runs: [
				{
					runId: "run-archived-1",
					recordedAt: 10,
					userPromptPreview: "fix bug",
					responsePreview: "done",
					toolTrace: [],
					attempts: [],
					teachValidation: {
						state: "validated",
						summary: "validation payload",
					},
				},
			],
		});
	});

	it("merges persisted session summaries into session.list when requested", async () => {
		const live = createEntry("live-1", {
			channelId: "web",
			senderId: "user-live",
		});
		const runtime = createGatewaySessionRuntime({
			sessionEntries: new Map<string, SessionEntry>([[live.id, live]]),
			inFlightSessionIds: new Set<string>(),
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: { record: vi.fn() } as any,
			estimateTokens: (text) => text.length,
			appendHistory: vi.fn() as any,
			getOrCreateSession: vi.fn(async () => live) as any,
			createScopedSession: vi.fn(async () => live) as any,
			promptSession: vi.fn(async () => ({ response: "ok", runId: "run" })) as any,
			abortSessionEntry: vi.fn(async () => false) as any,
			listPersistedSessions: vi.fn(async () => [
				{
					id: "live-1",
					createdAt: live.createdAt,
					lastActiveAt: live.lastActiveAt,
					messageCount: live.messageCount,
				},
				{
					id: "archived-3",
					createdAt: 3,
					lastActiveAt: 4,
					messageCount: 1,
				},
			]),
		});

		const result = await runtime.sessionHandlers.list({
			includePersisted: true,
		});

		expect(result).toEqual([
			expect.objectContaining({ id: "live-1" }),
			expect.objectContaining({ id: "archived-3", messageCount: 1 }),
		]);
	});

	it("persists compact run traces after a prompt turn completes", async () => {
		const entry = createEntry("persist-run-1");
		const persistSessionRunTrace = vi.fn(async () => undefined);
		const runtime = createGatewaySessionRuntime({
			sessionEntries: new Map<string, SessionEntry>(),
			inFlightSessionIds: new Set<string>(),
			config: {
				defaultModel: "claude-sonnet-4-6",
				defaultProvider: "anthropic",
				agent: { userTimezone: "Asia/Hong_Kong" },
			} as any,
			usageTracker: { record: vi.fn() } as any,
			estimateTokens: (text) => text.length,
			appendHistory: vi.fn() as any,
			getOrCreateSession: vi.fn(async () => entry) as any,
			createScopedSession: vi.fn(async () => entry) as any,
			promptSession: vi.fn(async () => ({
				response: "assistant:done",
				runId: "run-persist-1",
				meta: {
					toolTrace: [{ type: "toolCall", name: "process" }],
					attempts: [{ attempt: 1 }],
				},
			})) as any,
			abortSessionEntry: vi.fn(async () => false) as any,
			persistSessionRunTrace,
		});

		await runtime.chatHandler("persist this", {
			channelId: "web",
			senderId: "user-1",
		});

		expect(persistSessionRunTrace).toHaveBeenCalledWith({
			sessionId: "persist-run-1",
			trace: expect.objectContaining({
				runId: "run-persist-1",
				userPromptPreview: expect.stringContaining("persist this"),
				responsePreview: "assistant:done",
			}),
		});
	});
});
