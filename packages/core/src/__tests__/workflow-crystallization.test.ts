import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	appendPersistedWorkflowCrystallizationTurnFromRun,
	loadPersistedWorkflowCrystallizationLedger,
	publishWorkflowCrystallizedSkill,
	replaceWorkflowCrystallizationClusters,
	replaceWorkflowCrystallizationDayEpisodes,
	replaceWorkflowCrystallizationDaySegments,
	replaceWorkflowCrystallizationSkills,
	updatePersistedWorkflowCrystallizationLedger,
} from "../workflow-crystallization.js";

describe("workflow crystallization", () => {
	it("persists compact turns, segments, summarized episodes, and published skills", async () => {
		const homeDir = await mkdtemp(join(tmpdir(), "understudy-workflow-home-"));
		const workspaceDir = await mkdtemp(join(tmpdir(), "understudy-workflow-workspace-"));
		const learningDir = join(homeDir, "learning");

		const appended = await appendPersistedWorkflowCrystallizationTurnFromRun({
			workspaceDir,
			repoRoot: workspaceDir,
			sessionId: "session-1",
			runId: "run-1",
			promptPreview: 'Send the daily summary to "ops"',
			responsePreview: "Posted the summary.",
			toolTrace: [
				{
					type: "toolCall",
					id: "tool-1",
					name: "browser",
				},
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
					arguments: {
						target: 'button labeled "Send"',
					},
				},
				{
					type: "toolResult",
					id: "tool-2",
					name: "gui_click",
					route: "gui",
					textPreview: "Clicked Send.",
					status: { code: "condition_met", summary: "Message was sent." },
				},
			] as any,
			timestamp: Date.parse("2026-03-12T10:00:00.000Z"),
			learningDir,
		});

		let ledger = await loadPersistedWorkflowCrystallizationLedger({
			workspaceDir,
			learningDir,
		});
		expect(ledger?.days).toHaveLength(1);
		expect(ledger?.days[0]?.turns).toHaveLength(1);
		expect(ledger?.days[0]?.turns[0]?.evidence.toolChain[0]).toMatchObject({
			toolName: "browser",
			route: "browser",
		});

		ledger = await updatePersistedWorkflowCrystallizationLedger({
			workspaceDir,
			learningDir,
			updater: (current) => replaceWorkflowCrystallizationDaySegments(current, {
				dayStamp: "2026-03-12",
				segments: [
					{
						id: "segment-1",
						dayStamp: "2026-03-12",
						startTurnIndex: 1,
						endTurnIndex: 1,
						turnIds: [appended.turn.id],
						startedAt: Date.parse("2026-03-12T10:00:00.000Z"),
						endedAt: Date.parse("2026-03-12T10:00:00.000Z"),
						completion: "complete",
					},
				],
				segmentedAt: Date.now(),
				segmentedTurnCount: 1,
			}),
		});

		ledger = await updatePersistedWorkflowCrystallizationLedger({
			workspaceDir,
			learningDir,
			updater: (current) => replaceWorkflowCrystallizationDayEpisodes(current, {
				dayStamp: "2026-03-12",
				episodes: [
					{
						id: "ep-1",
						segmentId: "segment-1",
						dayStamp: "2026-03-12",
						startTurnIndex: 1,
						endTurnIndex: 1,
						turnIds: [appended.turn.id],
						startedAt: Date.parse("2026-03-12T10:00:00.000Z"),
						endedAt: Date.parse("2026-03-12T10:00:00.000Z"),
						title: "Send the daily summary",
						objective: "Send the daily summary to the target destination",
						summary: "Open the dashboard, refresh it, and send the prepared summary.",
						workflowFamilyHint: "refresh dashboard and send daily summary",
						parameterHints: ["target_channel"],
						successSignals: ["Message was sent."],
						uncertainties: [],
						keyTools: ["browser", "gui_click"],
						routeSignature: "browser -> gui",
						triggers: ["send daily summary"],
						completion: "complete",
					},
				],
				summarizedAt: Date.now(),
			}),
		});

		ledger = await updatePersistedWorkflowCrystallizationLedger({
			workspaceDir,
			learningDir,
			updater: (current) => replaceWorkflowCrystallizationClusters(current, {
				clusters: [
					{
						id: "cluster-1",
						title: "Send the daily summary",
						objective: "Send the daily summary to the target destination",
						workflowFamilyHint: "refresh dashboard and send daily summary",
						parameterSchema: ["target_channel"],
						episodeIds: ["ep-1", "ep-2", "ep-3"],
						occurrenceCount: 3,
						completeCount: 3,
						partialCount: 0,
						failedCount: 0,
						firstSeenAt: Date.parse("2026-03-10T10:00:00.000Z"),
						lastSeenAt: Date.parse("2026-03-12T10:00:00.000Z"),
					},
				],
				clusteredAt: Date.now(),
				clusteredEpisodeCount: 3,
			}),
		});

		const publishedSkill = await publishWorkflowCrystallizedSkill({
			workspaceDir,
			skill: {
				id: "skill-1",
				clusterId: "cluster-1",
				title: "Send the daily summary",
				objective: "Send the daily summary to the target destination",
				summary: "Recurring workflow inferred from repeated summary-send sessions.",
				workflowFamilyHint: "refresh dashboard and send daily summary",
				triggers: ["send daily summary"],
				parameterSlots: [
					{
						name: "target_channel",
						label: "Target Channel",
						required: true,
					},
				],
				stages: [
					{
						title: "Refresh source state",
						goal: "Get the latest data before composing the outbound summary.",
						instructions: [
							"Open the source dashboard or equivalent data surface.",
							"Refresh the relevant state and confirm the latest information is visible.",
						],
					},
					{
						title: "Send the summary",
						goal: "Turn the refreshed state into the requested outbound message.",
						instructions: [
							"Compose the summary for the requested target.",
							"Send it to the destination and verify delivery.",
						],
					},
				],
				routeOptions: [
					{
						route: "browser",
						preference: "preferred",
						instruction: "Use browser automation to refresh and inspect the dashboard.",
						toolName: "browser",
					},
				],
				successCriteria: [
					"The summary reflects refreshed dashboard data.",
					"The message is posted to the requested target destination.",
				],
				failurePolicy: [
					"If browser automation is blocked, fall back to the observed GUI path.",
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

		ledger = await updatePersistedWorkflowCrystallizationLedger({
			workspaceDir,
			learningDir,
			updater: (current) => replaceWorkflowCrystallizationSkills(current, {
				skills: [
					{
						id: "skill-1",
						clusterId: "cluster-1",
						title: "Send the daily summary",
						objective: "Send the daily summary to the target destination",
						summary: "Recurring workflow inferred from repeated summary-send sessions.",
						workflowFamilyHint: "refresh dashboard and send daily summary",
						triggers: ["send daily summary"],
						parameterSlots: [
							{
								name: "target_channel",
								label: "Target Channel",
								required: true,
							},
						],
						stages: [
							{
								title: "Refresh source state",
								goal: "Get the latest data before composing the outbound summary.",
								instructions: [
									"Open the source dashboard or equivalent data surface.",
									"Refresh the relevant state and confirm the latest information is visible.",
								],
							},
						],
						routeOptions: [
							{
								route: "browser",
								preference: "preferred",
								instruction: "Use browser automation to refresh and inspect the dashboard.",
								toolName: "browser",
							},
						],
						successCriteria: [
							"The summary reflects refreshed dashboard data.",
						],
						failurePolicy: [
							"If browser automation is blocked, fall back to the observed GUI path.",
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
						publishedSkill,
					},
				],
				publishedAt: Date.now(),
				publishedClusterCount: 1,
			}),
		});

		expect(ledger.skills).toHaveLength(1);
		expect(ledger.skills[0]?.publishedSkill?.name).toContain("crystallized-send-the-daily-summary");

		const markdown = await readFile(publishedSkill.skillPath, "utf8");
		expect(markdown).toContain("## Observed Run States");
		expect(markdown).toContain("Complete runs: 3");
		expect(markdown).toContain("## Staged Workflow");
		expect(markdown).toContain("Refresh source state");
		expect(markdown).toContain("## Success Criteria");
	});
});
