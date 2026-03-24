import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createGatewayTaskDraftHandlers } from "@understudy/gateway";
import type { SessionEntry } from "@understudy/gateway";

const cleanupPaths: string[] = [];
const originalUnderstudyHome = process.env.UNDERSTUDY_HOME;

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

afterEach(() => {
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

});
