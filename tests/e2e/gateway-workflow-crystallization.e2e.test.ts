import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GatewayServer } from "../../packages/gateway/src/server.js";
import {
	createGatewaySessionRuntime,
	type SessionEntry,
} from "../../packages/gateway/src/session-runtime.js";
import { loadPersistedWorkflowCrystallizationLedger } from "../../packages/core/src/workflow-crystallization.js";
import type {
	ChannelAdapter,
	ChannelMessagingAdapter,
	InboundMessage,
} from "../../packages/types/src/index.js";

function createEntry(id: string, overrides: Partial<SessionEntry> = {}): SessionEntry {
	const now = Date.now();
	return {
		id,
		createdAt: now,
		lastActiveAt: now,
		dayStamp: "2026-03-12",
		messageCount: 0,
		session: {},
		history: [],
		...overrides,
	};
}

function createMockChannel(id = "web"): ChannelAdapter & {
	sendMessageMock: ReturnType<typeof vi.fn>;
} {
	const sendMessageMock = vi.fn().mockResolvedValue("out_1");

	const messaging: ChannelMessagingAdapter = {
		sendMessage: sendMessageMock,
		onMessage: (_handler: (msg: InboundMessage) => void) => () => {},
	};

	return {
		id,
		name: `mock-${id}`,
		capabilities: {
			streaming: false,
			threads: true,
			reactions: false,
			attachments: true,
			groups: false,
		},
		messaging,
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		sendMessageMock,
	};
}

function gatewayPort(gateway: GatewayServer): number {
	const address = (gateway as any).server?.address();
	if (!address || typeof address === "string") {
		throw new Error("Gateway server is not listening on a TCP port");
	}
	return address.port;
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

async function rpcCall<T>(baseUrl: string, method: string, params: Record<string, unknown>): Promise<T> {
	const response = await fetch(`${baseUrl}/rpc`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			id: `${method}-${Math.random().toString(36).slice(2, 8)}`,
			method,
			params,
		}),
	});
	expect(response.status).toBe(200);
	const payload = await response.json() as { error?: { message?: string }; result?: T };
	if (payload.error) {
		throw new Error(payload.error.message ?? `RPC ${method} failed`);
	}
	return payload.result as T;
}

async function waitForAssertion(assertion: () => void | Promise<void>, timeoutMs = 4000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			await assertion();
			return;
		} catch (error) {
			if (Date.now() >= deadline) {
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
	}
}

describe("e2e: gateway workflow crystallization", () => {
	let gateway: GatewayServer | null = null;
	let tempHome: string | null = null;
	let workspaceDir: string | null = null;
	let originalUnderstudyHome: string | undefined;

	afterEach(async () => {
		vi.useRealTimers();
		if (gateway) {
			await gateway.stop();
			gateway = null;
		}
		if (originalUnderstudyHome === undefined) {
			delete process.env.UNDERSTUDY_HOME;
		} else {
			process.env.UNDERSTUDY_HOME = originalUnderstudyHome;
		}
		if (tempHome) {
			rmSync(tempHome, { recursive: true, force: true });
			tempHome = null;
		}
		workspaceDir = null;
	});

	it("drives repeated user work through a live gateway and crystallizes it into a reusable skill", async () => {
		originalUnderstudyHome = process.env.UNDERSTUDY_HOME;
		tempHome = mkdtempSync(join(tmpdir(), "understudy-gateway-crystallize-home-"));
		workspaceDir = mkdtempSync(join(tmpdir(), "understudy-gateway-crystallize-workspace-"));
		process.env.UNDERSTUDY_HOME = tempHome;
		const learningDir = join(tempHome, "learning");

		const sessionEntries = new Map<string, SessionEntry>();
		const inFlightSessionIds = new Set<string>();
		const webChannel = createMockChannel("web");
		const liveEntry = createEntry("gateway-crystallize", {
			channelId: "web",
			senderId: "workflow-user",
			threadId: "thread-1",
			workspaceDir,
			repoRoot: workspaceDir,
			session: {
				agent: {
					setSystemPrompt: vi.fn(),
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
		sessionEntries.set(liveEntry.id, liveEntry);

		const internalSessions = new Map<string, SessionEntry>();
		const appendHistory = vi.fn((target: SessionEntry, role: "user" | "assistant", text: string, timestamp?: number) => {
			target.history.push({
				role,
				text,
				timestamp: timestamp ?? Date.now(),
			});
		});
		const getOrCreateSession = vi.fn(async () => liveEntry);
		const createScopedSession = vi.fn(async (context: { sessionKey: string; workspaceDir?: string }) => {
			const scoped = createEntry(String(context.sessionKey), {
				workspaceDir: context.workspaceDir ?? workspaceDir!,
				repoRoot: workspaceDir!,
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
			});
			internalSessions.set(scoped.id, scoped);
			return scoped;
		});

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

		let naturalLanguageReuseCount = 0;
		const promptSession = vi.fn(async (entry: SessionEntry, text: string) => {
			if (text.includes('Schema: {"segments"')) {
				const turnCount = Array.from(text.matchAll(/^\d+\. \[/gm)).length;
				if (turnCount === 2) {
					return {
						response: JSON.stringify({
							segments: [{ startTurnIndex: 1, endTurnIndex: 2, completion: "complete" }],
						}),
						runId: "segment-2",
					};
				}
				if (turnCount === 5) {
					return {
						response: JSON.stringify({
							segments: [
								{ startTurnIndex: 1, endTurnIndex: 2, completion: "complete" },
								{ startTurnIndex: 3, endTurnIndex: 4, completion: "complete" },
								{ startTurnIndex: 5, endTurnIndex: 5, completion: "partial" },
							],
						}),
						runId: "segment-5",
					};
				}
				if (turnCount === 8) {
					return {
						response: JSON.stringify({
							segments: [
								{ startTurnIndex: 1, endTurnIndex: 2, completion: "complete" },
								{ startTurnIndex: 3, endTurnIndex: 4, completion: "complete" },
								{ startTurnIndex: 5, endTurnIndex: 6, completion: "complete" },
								{ startTurnIndex: 7, endTurnIndex: 8, completion: "complete" },
							],
						}),
						runId: "segment-8",
					};
				}
				throw new Error(`Unexpected segmentation turn count: ${turnCount}`);
			}

			if (text.includes('Schema: {"episodes"')) {
				const segmentIds = Array.from(text.matchAll(/segment_id=([a-f0-9]{12})/g)).map((match) => match[1]!);
				return {
					response: JSON.stringify({
						episodes: segmentIds.map((segmentId, index) => ({
							segmentId,
							title: "Send daily summary",
							objective: "Send the daily summary to ops",
							summary: `Refresh the dashboard state and send the daily summary to ops (run ${index + 1}).`,
							workflowFamilyHint: "refresh dashboard and send daily summary",
							parameterHints: ["target_channel"],
							successCriteria: ["Summary was sent to ops."],
							uncertainties: index === segmentIds.length - 1 && segmentIds.length === 3
								? ["The send step has not happened yet."]
								: [],
							keyTools: ["browser", "gui_click"],
							routeSignature: "browser -> gui",
							triggers: ["send daily summary"],
							completion: index === segmentIds.length - 1 && segmentIds.length === 3 ? "partial" : "complete",
						})),
					}),
					runId: `summary-${segmentIds.length}`,
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
					runId: `cluster-${episodeIds.length}`,
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
					runId: "synthesize",
				};
			}

			if (text.includes("Prepare today's daily summary for ops")) {
				return {
					response: "Prepared the summary for ops.",
					runId: `user-prepare-${Date.now()}`,
					meta: {
						toolTrace: workflowToolTrace,
					},
				};
			}

			if (text.includes("Send it to ops")) {
				return {
					response: "Posted the summary to ops.",
					runId: `user-send-${Date.now()}`,
					meta: {
						toolTrace: workflowToolTrace,
					},
				};
			}

			if (text.includes("Could you refresh the dashboard and post today's ops recap?")) {
				const prompt = extractSystemPromptText(entry);
				expect(prompt).toContain("## Skills (mandatory)");
				expect(prompt).toContain("crystallized-send-daily-summary");
				expect(prompt).toContain("Send the daily summary to ops");
				naturalLanguageReuseCount += 1;
				return {
					response: "Refreshed the dashboard and posted today's ops recap to ops.",
					runId: "user-natural-reuse",
					meta: {
						toolTrace: workflowToolTrace,
					},
				};
			}

			throw new Error(`Unexpected promptSession text: ${text}`);
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
			workflowCrystallization: {
				minClusterOccurrencesForPromotion: 2,
			},
			notifyUser: async ({ entry, text, title }: { entry: SessionEntry; text: string; title?: string }) => {
				if (!entry.channelId || !entry.senderId || !gateway) {
					return;
				}
				const channel = gateway.router.getChannel(entry.channelId);
				if (!channel) {
					return;
				}
				await channel.messaging.sendMessage({
					channelId: entry.channelId,
					recipientId: entry.senderId,
					threadId: entry.threadId,
					text: [title?.trim(), text.trim()].filter(Boolean).join("\n\n"),
				});
			},
		});

		gateway = new GatewayServer({ port: 0, host: "127.0.0.1" });
		gateway.addChannel(webChannel);
		gateway.setChatHandler(async (text, context) => await runtime.chatHandler(text, context));
		gateway.setSessionHandlers(runtime.sessionHandlers);
		await gateway.start();
		const baseUrl = `http://127.0.0.1:${gatewayPort(gateway)}`;

		const sendUserMessage = async (text: string) =>
			await rpcCall<{ response: string; sessionId?: string; status?: string }>(baseUrl, "chat.send", {
				text,
				channelId: "web",
				senderId: "workflow-user",
				threadId: "thread-1",
				cwd: workspaceDir,
				waitForCompletion: true,
			});

		const sentSessionIds: string[] = [];
		for (let cycle = 0; cycle < 4; cycle += 1) {
			const prepared = await sendUserMessage("Prepare today's daily summary for ops");
			expect(prepared).toMatchObject({
				response: "Prepared the summary for ops.",
				sessionId: liveEntry.id,
				status: "ok",
			});
			sentSessionIds.push(prepared.sessionId ?? "");

			const sent = await sendUserMessage("Send it to ops");
			expect(sent).toMatchObject({
				response: "Posted the summary to ops.",
				sessionId: liveEntry.id,
				status: "ok",
			});
			sentSessionIds.push(sent.sessionId ?? "");

			if (cycle === 0) {
				await waitForAssertion(async () => {
					const ledger = await loadPersistedWorkflowCrystallizationLedger({ workspaceDir: workspaceDir!, learningDir });
					expect((ledger?.days ?? []).reduce((count, day) => count + day.turns.length, 0)).toBe(2);
					expect((ledger?.days ?? []).reduce((count, day) => count + day.segments.length, 0)).toBe(1);
					expect((ledger?.days ?? []).reduce((count, day) => count + day.episodes.length, 0)).toBe(1);
					expect(ledger?.clusters).toHaveLength(0);
					expect(ledger?.skills).toHaveLength(0);
				});
			}

			if (cycle === 2) {
				await waitForAssertion(async () => {
					const ledger = await loadPersistedWorkflowCrystallizationLedger({ workspaceDir: workspaceDir!, learningDir });
					expect((ledger?.days ?? []).reduce((count, day) => count + day.turns.length, 0)).toBe(6);
					expect((ledger?.days ?? []).reduce((count, day) => count + day.segments.length, 0)).toBe(3);
					expect((ledger?.days ?? []).reduce((count, day) => count + day.episodes.length, 0)).toBe(3);
					expect(ledger?.clusters).toHaveLength(1);
					expect(ledger?.clusters[0]).toMatchObject({
						occurrenceCount: 3,
						completeCount: 2,
						partialCount: 1,
						failedCount: 0,
					});
					expect(ledger?.skills).toHaveLength(1);
				});
			}
		}

		expect(new Set(sentSessionIds)).toEqual(new Set([liveEntry.id]));

		await waitForAssertion(async () => {
			const ledger = await loadPersistedWorkflowCrystallizationLedger({ workspaceDir: workspaceDir!, learningDir });
			expect((ledger?.days ?? []).reduce((count, day) => count + day.turns.length, 0)).toBe(8);
			expect((ledger?.days ?? []).reduce((count, day) => count + day.segments.length, 0)).toBe(4);
			expect((ledger?.days ?? []).reduce((count, day) => count + day.episodes.length, 0)).toBe(4);
			expect(ledger?.clusters).toHaveLength(1);
			expect(ledger?.clusters[0]).toMatchObject({
				title: "Send daily summary",
				objective: "Send the daily summary to ops",
				occurrenceCount: 4,
				completeCount: 4,
				partialCount: 0,
				failedCount: 0,
			});
			expect(ledger?.skills).toHaveLength(1);
			expect(ledger?.skills[0]?.publishedSkill?.skillPath).toBeTruthy();
			expect(ledger?.skills[0]?.sourceEpisodeCount).toBe(4);
			expect(ledger?.skills[0]?.successfulEpisodeCount).toBe(4);
		});

		const finalLedger = await loadPersistedWorkflowCrystallizationLedger({ workspaceDir: workspaceDir!, learningDir });
		const skill = finalLedger?.skills[0];
		expect(skill).toBeTruthy();
		expect(skill?.sourceEpisodeCount).toBe(4);
		expect(skill?.successfulEpisodeCount).toBe(4);
		expect(skill?.observedStatusCounts).toEqual({
			completeCount: 4,
			partialCount: 0,
			failedCount: 0,
		});
		expect(skill?.stages).toHaveLength(2);
		expect(skill?.routeOptions).toEqual([
			expect.objectContaining({
				route: "browser",
				preference: "preferred",
				toolName: "browser",
			}),
		]);
		const skillMarkdown = readFileSync(skill!.publishedSkill!.skillPath, "utf8");
		expect(skillMarkdown).toContain("## Observed Run States");
		expect(skillMarkdown).toContain("Complete runs: 4");
		expect(skillMarkdown).toContain("## Staged Workflow");
		expect(skillMarkdown).toContain("Refresh the source state");
		expect(skillMarkdown).toContain("## Route Guidance");
		expect(skillMarkdown).toContain("target_channel");

		await waitForAssertion(() => {
			expect(webChannel.sendMessageMock.mock.calls.length).toBeGreaterThanOrEqual(1);
			expect(webChannel.sendMessageMock.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
				channelId: "web",
				recipientId: "workflow-user",
				threadId: "thread-1",
				text: expect.stringContaining("Crystallized workflow skill ready"),
			}));
		});

		const systemPrompt = extractSystemPromptText(liveEntry);
		expect(systemPrompt).toContain(skill!.publishedSkill!.name);
		expect(systemPrompt).toContain(skill!.publishedSkill!.skillPath);
		expect(systemPrompt).toContain("Send the daily summary to ops");

		const naturalReuse = await sendUserMessage("Could you refresh the dashboard and post today's ops recap?");
		expect(naturalReuse).toMatchObject({
			response: "Refreshed the dashboard and posted today's ops recap to ops.",
			sessionId: liveEntry.id,
			status: "ok",
		});
		expect(naturalLanguageReuseCount).toBe(1);
	});
});
