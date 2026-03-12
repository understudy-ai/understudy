import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildTaughtTaskDraftFromRun,
	buildTaughtTaskDraftPromptContent,
	createTaughtTaskDraftFromVideo,
	loadPersistedTaughtTaskDraftLedger,
	persistTaughtTaskDraft,
	publishTaughtTaskDraft,
	updatePersistedTaughtTaskDraft,
} from "../task-drafts.js";
import { buildWorkspaceSkillSnapshot } from "../skills/workspace.js";

const cleanupPaths: string[] = [];

function createTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	cleanupPaths.push(dir);
	return dir;
}

afterEach(() => {
	while (cleanupPaths.length > 0) {
		const target = cleanupPaths.pop();
		if (!target) {
			continue;
		}
		rmSync(target, { recursive: true, force: true });
	}
});

describe("teach drafts", () => {
	it("builds a teach draft from a traced run and surfaces prompt-ready content", () => {
		const draft = buildTaughtTaskDraftFromRun({
			workspaceDir: "/repo/app",
			repoRoot: "/repo",
			sessionId: "session-1",
			traceId: "trace-1",
			runId: "run-1",
			promptPreview: "[Sun 2026-03-08 09:00 HKT] Send the weekly deployment report",
			responsePreview: "Done",
			toolTrace: [
				{
					type: "toolCall",
					id: "tool-1",
					name: "browser",
					arguments: { target: "deployments page" },
				},
				{
					type: "toolResult",
					id: "tool-1",
					name: "browser",
					route: "browser",
					textPreview: "Opened deployments page",
						status: { code: "resolved", summary: "Deployments page loaded." },
				},
					{
						type: "toolCall",
						id: "tool-2",
						name: "gui_type",
						arguments: {
							target: "Subject field",
							value: "Weekly deployment report",
						},
					},
				{
					type: "toolResult",
					id: "tool-2",
					name: "gui_type",
					route: "gui",
					textPreview: "Typed subject line",
						status: { code: "condition_met", summary: "Weekly deployment report is visible." },
				},
					{
						type: "toolCall",
						id: "tool-3",
						name: "gui_click",
						arguments: {
							target: "Send button",
						},
					},
				{
					type: "toolResult",
					id: "tool-3",
					name: "gui_click",
					route: "gui",
					textPreview: "Clicked Send",
						status: { code: "action_sent", summary: "Send button pressed." },
				},
			],
			teachValidation: {
				checks: [
					{ ok: true, summary: "Deployment report draft exists." },
					{ ok: false, summary: "Recipient still needs confirmation." },
				],
			},
		});

		expect(draft.intent).toBe("Send the weekly deployment report");
		expect(draft.routeSignature).toBe("browser -> gui -> gui");
		expect(draft.parameterSlots).toContainEqual(
			expect.objectContaining({
				name: "value",
				sampleValue: "Weekly deployment report",
			}),
		);
		expect(draft.successCriteria).toContain("Deployment report draft exists.");
		expect(draft.uncertainties).toContain("Recipient still needs confirmation.");
		expect(draft.taskCard).toMatchObject({
			goal: "Send the weekly deployment report",
			scope: "Reusable workflow derived from the demonstration.",
			inputs: ["Value"],
			output: "Deployment report draft exists.",
		});
		expect(draft.taskCard?.loopOver).toBeUndefined();
		expect(draft.taskCard?.extract).toEqual([]);
		expect(draft.procedure).toContainEqual(
			expect.objectContaining({
				instruction: 'Type "Weekly deployment report" into Subject field.',
			}),
		);
		expect(draft.executionPolicy).toMatchObject({
			toolBinding: "adaptive",
			preferredRoutes: ["browser", "shell", "gui"],
			stepInterpretation: "fallback_replay",
		});
		expect(draft.stepRouteOptions).toContainEqual(
			expect.objectContaining({
				procedureStepId: "procedure-2",
				route: "gui",
				preference: "observed",
				toolName: "gui_type",
			}),
		);
		expect(draft.skillDependencies).toEqual([]);
		expect(draft.validation?.mode).toBe("inspection");
		expect(draft.steps).toContainEqual(
			expect.objectContaining({
				toolName: "gui_type",
				instruction: 'Type "Weekly deployment report" into Subject field.',
			}),
		);

		const prompt = buildTaughtTaskDraftPromptContent({
			updatedAt: Date.now(),
			workspaceDir: "/repo/app",
			drafts: [draft],
		});
		expect(prompt).toContain("Teach drafts captured from explicit teach/correct events");
		expect(prompt).toContain("Prefer semantically equivalent browser, bash, or linked-skill routes");
		expect(prompt).toContain("Send the weekly deployment report");
		expect(prompt).toContain("[gui/gui_type]");
	});

	it("persists and updates teach drafts in a workspace ledger", async () => {
		const learningDir = createTempDir("understudy-task-draft-learning-");
		const repoRoot = createTempDir("understudy-task-draft-repo-");
		const workspaceDir = join(repoRoot, "app");
		const draft = buildTaughtTaskDraftFromRun({
			workspaceDir,
			repoRoot,
			runId: "run-1",
			promptPreview: "Create the release note draft",
			toolTrace: [
				{
					type: "toolCall",
					id: "tool-1",
					name: "bash",
					arguments: { command: "pnpm build" },
				},
				{
					type: "toolResult",
					id: "tool-1",
					name: "bash",
					route: "shell",
					textPreview: "Ran pnpm build successfully.",
						status: { code: "resolved", summary: "Build succeeded." },
				},
			],
		});

		await persistTaughtTaskDraft(draft, { learningDir });
		const loaded = await loadPersistedTaughtTaskDraftLedger({
			workspaceDir: join(workspaceDir, "subdir"),
			learningDir,
		});
		expect(loaded?.drafts).toHaveLength(1);
		expect(loaded?.drafts[0]?.title).toBe("Create the release note draft");

		const updated = await updatePersistedTaughtTaskDraft({
			workspaceDir,
			draftId: draft.id,
			learningDir,
			patch: {
				title: "Create release notes",
				intent: "Create and verify the release note draft",
				parameterSlots: ["release_version: 1.2.3"],
				successCriteria: ["Release note draft saved."],
				uncertainties: ["Verify the changelog scope."],
				taskCard: {
					goal: "Create and verify the release note draft",
					scope: "Single release-note drafting workflow.",
					loopOver: "The current release.",
					inputs: ["Release version"],
					extract: ["Build output"],
					output: "Release note draft saved.",
				},
				procedure: [
					{
						instruction: "Run `pnpm build` before drafting release notes.",
						kind: "check",
					},
				],
				skillDependencies: [{ name: "release-notes", reason: "Use the existing release-notes skill when available.", required: false }],
				steps: ["Run `pnpm build` before drafting release notes."],
			},
			note: "Corrected success criteria",
		});

		expect(updated.title).toBe("Create release notes");
		expect(updated.parameterSlots).toContainEqual(
			expect.objectContaining({ name: "release_version", sampleValue: "1.2.3" }),
		);
		expect(updated.successCriteria).toEqual(["Release note draft saved."]);
		expect(updated.steps).toContainEqual(
			expect.objectContaining({
				instruction: "Run `pnpm build` before drafting release notes.",
			}),
		);
		expect(updated.taskCard).toMatchObject({
			goal: "Create and verify the release note draft",
			output: "Release note draft saved.",
		});
		expect(updated.procedure).toContainEqual(
			expect.objectContaining({
				instruction: "Run `pnpm build` before drafting release notes.",
				kind: "check",
			}),
		);
		expect(updated.skillDependencies).toContainEqual(
			expect.objectContaining({
				name: "release-notes",
				required: false,
			}),
		);
		expect(updated.revisions).toHaveLength(2);
		expect(updated.revisions[1]).toMatchObject({
			action: "corrected",
			actor: "operator",
			summary: "Corrected title, objective, parameter slots, success criteria, uncertainties, task card, procedure, skill dependencies, steps.",
			changes: ["title", "objective", "parameter slots", "success criteria", "uncertainties", "task card", "procedure", "skill dependencies", "steps"],
			note: "Corrected success criteria",
		});

		const published = await publishTaughtTaskDraft({
			workspaceDir,
			draftId: draft.id,
			learningDir,
			name: "release-notes",
		});
		const snapshot = buildWorkspaceSkillSnapshot({
			workspaceDir,
			config: {
				agent: {
					skillDirs: [],
				},
			} as any,
		});
		expect(published.draft.revisions.at(-1)).toMatchObject({
			action: "published",
			actor: "operator",
			summary: expect.stringContaining("workspace skill"),
			changes: ["status", "published skill"],
		});
		const skillMarkdown = published.skill.skillPath
			? readFileSync(published.skill.skillPath, "utf8")
			: "";
		expect(skillMarkdown).toContain('description: "Create and verify the release note draft');
		expect(skillMarkdown).toContain("triggers:");
		expect(skillMarkdown).toContain("## Overall Goal");
		expect(skillMarkdown).toContain("## Staged Workflow");
		expect(skillMarkdown).toContain("## GUI Reference Path");
		expect(skillMarkdown).toContain("## Tool Route Options");
		expect(skillMarkdown).toContain("These route options are references only.");
		expect(snapshot.resolvedSkills.some((skill) => skill.name === published.skill.name)).toBe(true);
	});

	it("builds a teach draft from video analysis output", () => {
		const draft = createTaughtTaskDraftFromVideo({
			workspaceDir: "/repo/app",
			sourceLabel: "demo.mp4",
			title: "Publish the reviewed dashboard",
			objective: "Publish the reviewed dashboard from the moderation queue.",
			parameterSlots: [
				{ name: "dashboard_name", label: "Dashboard Name", sampleValue: "Q1 dashboard", required: true },
			],
			successCriteria: ["Published confirmation is visible."],
			openQuestions: ["Confirm whether the owner should be notified."],
			taskCard: {
				goal: "Publish the reviewed dashboard from the moderation queue.",
				scope: "Single reviewed dashboard publish flow.",
				loopOver: "The current dashboard review item.",
				inputs: ["Dashboard Name"],
				extract: ["Published confirmation state"],
				output: "The reviewed dashboard is published.",
			},
			procedure: [
				{
					instruction: "Click the Publish button in the moderation panel.",
					kind: "output",
				},
			],
			skillDependencies: [
				{ name: "publish-dashboard", reason: "Prefer the existing publish workflow skill when available.", required: false },
			],
			steps: [
				{
					route: "gui",
					toolName: "gui_click",
					instruction: "Click the Publish button in the moderation panel.",
					target: "Publish button",
				},
			],
			sourceDetails: {
				analyzerProvider: "ark:doubao-seed-2-0-lite-260215",
				analysisMode: "event_guided_evidence_pack",
				keyframeCount: 8,
			},
		});

		expect(draft).toMatchObject({
			sourceKind: "video",
			sourceLabel: "demo.mp4",
			objective: "Publish the reviewed dashboard from the moderation queue.",
		});
		expect(draft.runId.startsWith("video-")).toBe(true);
		expect(draft.validation).toMatchObject({
			state: "unvalidated",
			mode: "replay",
		});
		expect(draft.revisions[0]).toMatchObject({
			action: "created",
			actor: "system",
			summary: "Created teach draft from demo video demo.mp4.",
		});
		expect(draft.parameterSlots).toContainEqual(
			expect.objectContaining({ name: "dashboard_name", sampleValue: "Q1 dashboard" }),
		);
		expect(draft.steps).toContainEqual(
			expect.objectContaining({ toolName: "gui_click", target: "Publish button" }),
		);
		expect(draft.taskCard).toMatchObject({
			goal: "Publish the reviewed dashboard from the moderation queue.",
		});
		expect(draft.procedure).toContainEqual(
			expect.objectContaining({ instruction: "Click the Publish button in the moderation panel." }),
		);
		expect(draft.executionPolicy).toMatchObject({
			toolBinding: "adaptive",
			preferredRoutes: ["skill", "browser", "shell", "gui"],
			stepInterpretation: "fallback_replay",
		});
		expect(draft.stepRouteOptions).toContainEqual(
			expect.objectContaining({
				procedureStepId: "procedure-1",
				route: "gui",
				preference: "observed",
				toolName: "gui_click",
			}),
		);
		expect(draft.skillDependencies).toContainEqual(
			expect.objectContaining({ name: "publish-dashboard", required: false }),
		);
	});

	it("keeps GUI reference paths concise while preserving detailed replay hints", async () => {
		const learningDir = createTempDir("understudy-task-draft-publish-tighten-");
		const repoRoot = createTempDir("understudy-task-draft-publish-tighten-repo-");
		const workspaceDir = join(repoRoot, "app");
		const draft = createTaughtTaskDraftFromVideo({
			workspaceDir,
			repoRoot,
			sourceLabel: "tencent.mov",
			title: "Tencent Meeting verification-code login",
			objective: "Open Tencent Meeting to the verification-code login screen with a provided phone number entered.",
			parameterSlots: [
				{ name: "phoneNumber", label: "Phone Number", sampleValue: "13800138000", required: true },
			],
			taskCard: {
				goal: "Open Tencent Meeting and stop at the verification-code login screen with the correct phone number already entered.",
				scope: "macOS desktop app navigation inside the Tencent Meeting login UI.",
				inputs: ["phoneNumber"],
				extract: [],
				output: "Tencent Meeting positioned at the visible verification-code login screen with the provided phone number filled in.",
			},
			procedure: [
				{ instruction: "Launch Tencent Meeting directly when possible.", kind: "navigate" },
				{ instruction: "Click the link labeled \"验证码登录\" on the phone login page.", kind: "output" },
			],
			executionPolicy: {
				toolBinding: "adaptive",
				preferredRoutes: ["shell", "gui"],
				stepInterpretation: "fallback_replay",
				notes: ["Prefer direct launch but keep GUI as a fallback reference."],
			},
			stepRouteOptions: [
				{
					procedureStepId: "procedure-1",
					route: "shell",
					preference: "preferred",
					instruction: "Launch Tencent Meeting directly from macOS by opening the installed app bundle.",
					toolName: "exec",
				},
				{
					procedureStepId: "procedure-1",
					route: "gui",
					preference: "observed",
					instruction: "Open a macOS launcher/search surface, search for \"腾讯会议\", and open the Tencent Meeting app result.",
					toolName: "gui_type",
					when: "Replaying the demonstrated launcher path.",
				},
				{
					procedureStepId: "procedure-2",
					route: "gui",
					preference: "preferred",
					instruction: "Click the link labeled \"验证码登录\" on the phone login page.",
					toolName: "gui_click",
				},
			],
			steps: [
				{
					route: "shell",
					toolName: "exec",
					instruction: "Launch Tencent Meeting directly when possible.",
					locationHint: "bottom Dock",
					inputs: { command: 'open -a "腾讯会议"' },
				},
				{
					route: "gui",
					toolName: "gui_click",
					instruction: "Click the link labeled \"验证码登录\" on the phone login page.",
					target: "the link labeled \"验证码登录\"",
					app: "腾讯会议",
					scope: "phone login page",
					locationHint: "lower portion of the login window",
					windowTitle: "腾讯会议",
				},
			],
		});

		await persistTaughtTaskDraft(draft, { learningDir });
		const published = await publishTaughtTaskDraft({
			workspaceDir,
			draftId: draft.id,
			learningDir,
			name: "tencent-login",
		});
		const skillMarkdown = published.skill.skillPath
			? readFileSync(published.skill.skillPath, "utf8")
			: "";
		const guiReferenceSection = skillMarkdown.split("## Tool Route Options")[0] ?? "";
		const observedGuiLine = guiReferenceSection
			.split("\n")
			.find((line) => line.includes("reference: [observed] [gui/gui_type]")) ?? "";

		expect(skillMarkdown).toContain('description: "Open Tencent Meeting and stop at the verification-code login screen');
		expect(skillMarkdown).toContain("- \"腾讯会议 验证码登录\"");
		expect(skillMarkdown).toContain("The GUI reference path below is for replay and grounding reference only.");
		expect(skillMarkdown).toContain("1. Open a macOS launcher/search surface, search for \"腾讯会议\", and open the Tencent Meeting app result.");
		expect(observedGuiLine).not.toContain("| target:");
		expect(guiReferenceSection).not.toContain("locationHint:");
		expect(guiReferenceSection).not.toContain("windowTitle:");
		expect(skillMarkdown).toContain("## Detailed GUI Replay Hints");
		expect(skillMarkdown).toContain("locationHint: lower portion of the login window");
	});

	it("clears stale validation run metadata when a new validation result omits it", async () => {
		const learningDir = createTempDir("understudy-task-draft-validation-");
		const repoRoot = createTempDir("understudy-task-draft-validation-repo-");
		const workspaceDir = join(repoRoot, "app");
		const draft = buildTaughtTaskDraftFromRun({
			workspaceDir,
			repoRoot,
			runId: "run-1",
			promptPreview: "Review the dashboard submission",
			toolTrace: [
				{
					type: "toolCall",
					id: "tool-1",
					name: "gui_click",
					arguments: { target: "Approve button" },
				},
				{
					type: "toolResult",
					id: "tool-1",
					name: "gui_click",
					route: "gui",
					textPreview: "Clicked Approve",
				},
			],
			teachValidation: {
				final: {
					ok: true,
					checks: [{ ok: true, summary: "Dashboard approval completed." }],
				},
			},
			responsePreview: "Approved the dashboard.",
		});

		await persistTaughtTaskDraft(draft, { learningDir });
		const updated = await updatePersistedTaughtTaskDraft({
			workspaceDir,
			draftId: draft.id,
			learningDir,
			patch: {
				validation: {
					state: "failed",
					updatedAt: Date.now(),
					summary: "Teach validation failed: timed out",
					runId: undefined,
					responsePreview: undefined,
					checks: [
						{
							id: "teach-validation:timeout",
							ok: false,
							summary: "Teach validation failed: timed out",
							source: "replay",
						},
					],
					mode: "replay",
					usedMutatingTools: false,
					toolNames: [],
					mutatingToolNames: [],
				},
			},
			action: "validated",
			note: "Teach validation failed: timed out",
		});

		expect(updated.validation).toMatchObject({
			state: "failed",
			summary: "Teach validation failed: timed out",
			mode: "replay",
			usedMutatingTools: false,
			toolNames: [],
			mutatingToolNames: [],
		});
		expect(updated.validation?.runId).toBeUndefined();
		expect(updated.validation?.responsePreview).toBeUndefined();
	});
});
