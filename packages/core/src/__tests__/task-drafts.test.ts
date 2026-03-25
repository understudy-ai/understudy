import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildTaughtTaskDraftFromRun,
	buildTaughtTaskDraftPromptContent,
	loadPersistedTaughtTaskDraftLedger,
	persistTaughtTaskDraft,
	publishTaughtTaskDraft,
	updatePersistedTaughtTaskDraft,
	type TaughtTaskDraft,
} from "../task-drafts.js";
import { buildWorkspaceSkillSnapshot } from "../skills/workspace.js";
import { loadWorkspaceArtifactByName } from "../workspace-artifacts.js";

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

	it("preserves exact GUI replay parameters in traced draft steps", () => {
		const draft = buildTaughtTaskDraftFromRun({
			workspaceDir: "/repo/app",
			repoRoot: "/repo",
			runId: "run-gui-args",
			promptPreview: "Work through the demonstrated GUI flow",
			toolTrace: [
				{
					type: "toolCall",
					id: "tool-1",
					name: "gui_click",
					arguments: {
						target: "Context button",
						app: "Mail",
						scope: "Composer",
						button: "right",
						windowSelector: {
							titleContains: "Draft",
							index: 2,
						},
					},
				},
				{
					type: "toolResult",
					id: "tool-1",
					name: "gui_click",
					route: "gui",
					textPreview: "Opened context menu",
					status: { code: "action_sent", summary: "Context menu opened." },
				},
				{
					type: "toolCall",
					id: "tool-2",
					name: "gui_drag",
					arguments: {
						fromTarget: "Draft card",
						toTarget: "Released card",
						fromScope: "Workspace panel",
						toScope: "Workspace panel",
						durationMs: 450,
					},
				},
				{
					type: "toolResult",
					id: "tool-2",
					name: "gui_drag",
					route: "gui",
					textPreview: "Reordered the cards",
					status: { code: "action_sent", summary: "Cards reordered." },
				},
				{
					type: "toolCall",
					id: "tool-3",
					name: "gui_key",
					arguments: {
						app: "Mail",
						key: "Page Down",
						modifiers: ["shift"],
						repeat: 2,
					},
				},
				{
					type: "toolResult",
					id: "tool-3",
					name: "gui_key",
					route: "gui",
					textPreview: "Moved to the next page",
					status: { code: "action_sent", summary: "Moved to the next page." },
				},
				{
					type: "toolCall",
					id: "tool-4",
					name: "gui_wait",
					arguments: {
						target: "Sync banner",
						scope: "toolbar",
						state: "disappear",
						timeoutMs: 5_000,
						intervalMs: 250,
					},
				},
				{
					type: "toolResult",
					id: "tool-4",
					name: "gui_wait",
					route: "gui",
					textPreview: "Sync banner disappeared",
					status: { code: "condition_met", summary: "Sync banner disappeared." },
				},
			],
		});

		expect(draft.steps).toContainEqual(expect.objectContaining({
			toolName: "gui_click",
			instruction: "Right-click Context button in Mail / Composer.",
			toolArgs: {
				button: "right",
				windowSelector: {
					titleContains: "Draft",
					index: 2,
				},
			},
		}));
		expect(draft.steps).toContainEqual(expect.objectContaining({
			toolName: "gui_drag",
			instruction: "Drag Draft card to Released card in Workspace panel.",
			toolArgs: {
				fromTarget: "Draft card",
				toTarget: "Released card",
				fromScope: "Workspace panel",
				toScope: "Workspace panel",
				durationMs: 450,
			},
		}));
		expect(draft.steps).toContainEqual(expect.objectContaining({
			toolName: "gui_key",
			instruction: "Press shift+Page Down 2 times in Mail.",
			toolArgs: {
				key: "Page Down",
				modifiers: ["shift"],
				repeat: 2,
			},
		}));
		expect(draft.steps).toContainEqual(expect.objectContaining({
			toolName: "gui_wait",
			instruction: "Wait for Sync banner in toolbar to disappear.",
			toolArgs: {
				state: "disappear",
				timeoutMs: 5000,
				intervalMs: 250,
			},
		}));

		const prompt = buildTaughtTaskDraftPromptContent({
			updatedAt: Date.now(),
			workspaceDir: "/repo/app",
			drafts: [draft],
		});
		expect(prompt).toContain('toolArgs: button=right, windowSelector={"titleContains":"Draft","index":2}');
		expect(prompt).toContain("toolArgs: key=Page Down, modifiers=shift, repeat=2");
	});

	it("keeps GUI reference paths concise while preserving detailed replay hints", async () => {
		const learningDir = createTempDir("understudy-task-draft-publish-tighten-");
		const repoRoot = createTempDir("understudy-task-draft-publish-tighten-repo-");
		const workspaceDir = join(repoRoot, "app");
		const baseDraft = buildTaughtTaskDraftFromRun({
			workspaceDir,
			repoRoot,
			runId: "run-tencent",
			promptPreview: "Open Tencent Meeting to the verification-code login screen with a provided phone number entered.",
			title: "Tencent Meeting verification-code login",
			objective: "Open Tencent Meeting to the verification-code login screen with a provided phone number entered.",
			toolTrace: [
				{ type: "toolCall", id: "t1", name: "exec", arguments: { command: 'open -a "腾讯会议"' } },
				{ type: "toolResult", id: "t1", name: "exec", route: "shell", textPreview: "Launched" },
				{ type: "toolCall", id: "t2", name: "gui_click", arguments: { target: "the link labeled \"验证码登录\"" } },
				{ type: "toolResult", id: "t2", name: "gui_click", route: "gui", textPreview: "Clicked" },
			],
		});
		const draft = {
			...baseDraft,
			parameterSlots: [
				{ name: "phoneNumber", label: "Phone Number", sampleValue: "13800138000", required: true },
			],
			taskCard: {
				goal: "Open Tencent Meeting and stop at the verification-code login screen with the correct phone number already entered.",
				scope: "macOS desktop app navigation inside the Tencent Meeting login UI.",
				inputs: ["phoneNumber"],
				extract: [] as string[],
				output: "Tencent Meeting positioned at the visible verification-code login screen with the provided phone number filled in.",
			},
			procedure: [
				{ id: "procedure-1", index: 1, instruction: "Launch Tencent Meeting directly when possible.", kind: "navigate" as const },
				{ id: "procedure-2", index: 2, instruction: "Click the link labeled \"验证码登录\" on the phone login page.", kind: "output" as const },
			],
			executionPolicy: {
				toolBinding: "adaptive" as const,
				preferredRoutes: ["shell", "gui"] as const,
				stepInterpretation: "fallback_replay" as const,
				notes: ["Prefer direct launch but keep GUI as a fallback reference."],
			},
			stepRouteOptions: [
				{
					procedureStepId: "procedure-1",
					route: "shell",
					preference: "preferred" as const,
					instruction: "Launch Tencent Meeting directly from macOS by opening the installed app bundle.",
					toolName: "exec",
				},
				{
					procedureStepId: "procedure-1",
					route: "gui",
					preference: "observed" as const,
					instruction: "Open a macOS launcher/search surface, search for \"腾讯会议\", and open the Tencent Meeting app result.",
					toolName: "gui_type",
					when: "Replaying the demonstrated launcher path.",
				},
				{
					procedureStepId: "procedure-2",
					route: "gui",
					preference: "preferred" as const,
					instruction: "Click the link labeled \"验证码登录\" on the phone login page.",
					toolName: "gui_click",
				},
			],
			steps: [
				{
					id: "exec-1",
					index: 1,
					route: "shell",
					toolName: "exec",
					instruction: "Launch Tencent Meeting directly when possible.",
					locationHint: "bottom Dock",
					inputs: { command: 'open -a "腾讯会议"' },
				},
				{
					id: "gui_click-2",
					index: 2,
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
		} as unknown as TaughtTaskDraft;

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

		it("publishes playbook drafts as playbook artifacts", async () => {
			const learningDir = createTempDir("understudy-playbook-draft-learning-");
			const repoRoot = createTempDir("understudy-playbook-draft-repo-");
			const workspaceDir = join(repoRoot, "app");
			const baseDraft = buildTaughtTaskDraftFromRun({
				workspaceDir,
				repoRoot,
				sessionId: "session-playbook",
				runId: "run-playbook",
				promptPreview: "Produce a publishable first-pass research brief.",
				title: "Produce a research brief",
				objective: "Produce a publishable first-pass research brief.",
				toolTrace: [
					{ type: "toolCall", id: "t1", name: "gui_click", arguments: { target: 'row containing "Arc Search"' } },
					{ type: "toolResult", id: "t1", name: "gui_click", route: "gui", textPreview: "Clicked" },
				],
			});
			const draft = {
				...baseDraft,
				artifactKind: "playbook" as const,
				taskKind: "parameterized_workflow" as const,
				parameterSlots: [
					{ name: "target_name", label: "Target name", sampleValue: "Arc Search", required: true },
					{ name: "brief_angle", label: "Brief angle", sampleValue: "First-run productivity", required: true },
				],
				successCriteria: ["Draft video and publish preview are ready for human approval."],
				taskCard: {
					goal: "Produce a publishable first-pass research brief.",
					scope: "Single reusable research production flow.",
					inputs: ["Target name", "Brief angle"],
					extract: ["Highlights", "Limitations"],
					output: "A publish preview is ready for human approval.",
				},
				childArtifacts: [
					{
						id: "child-1",
						name: "collect-target-context",
						artifactKind: "skill" as const,
						objective: "Collect baseline target context into the artifacts root.",
						required: true,
					},
					{
						id: "child-2",
						name: "explore-target",
						artifactKind: "worker" as const,
						objective: "Explore the unfamiliar target and capture evidence.",
						required: true,
						reason: "This stage is open-ended and should stay agentic.",
					},
				],
				playbookStages: [
					{
						id: "stage-1",
						name: "Collect Baseline",
						kind: "skill" as const,
						refName: "collect-target-context",
						objective: "Collect baseline target context into the artifacts root.",
						inputs: ["target_name", "artifacts_root_dir"],
						outputs: ["context.md"],
						retryPolicy: "retry_once" as const,
					},
					{
						id: "stage-2",
						name: "Explore Target",
						kind: "worker" as const,
						refName: "explore-target",
						objective: "Explore the unfamiliar target and capture evidence.",
						inputs: ["target_name", "artifacts_root_dir", "brief_angle"],
						outputs: ["findings.md", "highlights.json", "limitations.json"],
						retryPolicy: "pause_for_human" as const,
					},
					{
						id: "stage-3",
						name: "Publish Preview",
						kind: "approval" as const,
						objective: "Wait for human approval before publishing.",
						outputs: ["approval.state"],
						approvalGate: "delivery_preview" as const,
					},
				],
			} as unknown as TaughtTaskDraft;

			await persistTaughtTaskDraft(draft, { learningDir });
			const published = await publishTaughtTaskDraft({
				workspaceDir,
				draftId: draft.id,
				learningDir,
				name: "research-playbook",
			});

		expect(published.skill.artifactKind).toBe("playbook");
		const skillMarkdown = published.skill.skillPath
			? readFileSync(published.skill.skillPath, "utf8")
			: "";
			expect(skillMarkdown).toContain('artifactKind: "playbook"');
			expect(skillMarkdown).toContain("## Child Artifacts");
			expect(skillMarkdown).toContain("## Stage Plan");
			expect(skillMarkdown).toContain("[worker] explore-target");
			expect(skillMarkdown).toContain("approval: delivery_preview");

		const loadedArtifact = await loadWorkspaceArtifactByName({
			workspaceDir,
			name: published.skill.name,
		});
		expect(loadedArtifact?.artifactKind).toBe("playbook");
		if (!loadedArtifact || loadedArtifact.artifactKind !== "playbook") {
			throw new Error("Expected published playbook artifact");
		}
			expect(loadedArtifact.childArtifacts).toContainEqual(
				expect.objectContaining({
					name: "explore-target",
					artifactKind: "worker",
				}),
			);
			expect(loadedArtifact.stages).toHaveLength(3);
			expect(loadedArtifact.stages[1]).toMatchObject({
				kind: "worker",
				refName: "explore-target",
				retryPolicy: "pause_for_human",
			});
		});

	it("publishes worker drafts as worker artifacts", async () => {
		const learningDir = createTempDir("understudy-worker-draft-learning-");
		const repoRoot = createTempDir("understudy-worker-draft-repo-");
		const workspaceDir = join(repoRoot, "app");
		const baseDraft = buildTaughtTaskDraftFromRun({
			workspaceDir,
			repoRoot,
			sessionId: "session-worker",
			runId: "run-worker",
			promptPreview: "Explore the unfamiliar target and capture a reusable evidence dossier.",
			title: "Explore an unfamiliar target",
			objective: "Explore the unfamiliar target and capture a reusable evidence dossier.",
			toolTrace: [
				{ type: "toolCall", id: "t1", name: "gui_click", arguments: { target: 'row containing "Arc Search"' } },
				{ type: "toolResult", id: "t1", name: "gui_click", route: "gui", textPreview: "Clicked" },
			],
		});
		const draft = {
			...baseDraft,
			artifactKind: "worker" as const,
			taskKind: "parameterized_workflow" as const,
			parameterSlots: [
				{ name: "target_name", label: "Target name", sampleValue: "Arc Search", required: true },
				{ name: "brief_angle", label: "Brief angle", sampleValue: "First-run productivity", required: true },
			],
			successCriteria: [
				"Enough evidence exists for 2-3 highlights and 1 limitation.",
				"Worker summary is written to the dossier.",
			],
			taskCard: {
				goal: "Explore the unfamiliar target and capture a reusable evidence dossier.",
				scope: "Open-ended target exploration worker.",
				inputs: ["Target name", "Brief angle"],
				extract: ["Highlights", "Limitations"],
				output: "Worker summary is written to the artifacts root.",
			},
			workerContract: {
				goal: "Explore the unfamiliar target currently assigned to the worker.",
				scope: "Capture enough evidence for a short research brief.",
				inputs: ["targetName", "artifactsRootDir", "briefAngle"],
				outputs: ["findings.md", "worker-summary.json", "evidence/*", "highlights.json", "limitations.json"],
				allowedRoutes: ["gui", "browser"] as const,
				allowedSurfaces: ["Only the assigned target surfaces", "Supporting desktop windows only when required"],
				budget: {
					maxMinutes: 12,
					maxActions: 60,
					maxScreenshots: 12,
				},
				escalationPolicy: ["Payment is required.", "Authentication is required."],
				stopConditions: ["Enough evidence for 2-3 highlights and 1 limitation.", "Budget exhausted."],
				decisionHeuristics: ["Prefer evidence-producing actions over exhaustive blind traversal."],
			},
		} as unknown as TaughtTaskDraft;

			await persistTaughtTaskDraft(draft, { learningDir });
			const published = await publishTaughtTaskDraft({
				workspaceDir,
				draftId: draft.id,
				learningDir,
				name: "explore-target",
			});

		expect(published.skill.artifactKind).toBe("worker");
		const markdown = readFileSync(published.skill.skillPath, "utf8");
		expect(markdown).toContain('artifactKind: "worker"');
		expect(markdown).toContain("## Operating Contract");
		expect(markdown).toContain("## Budget");
		expect(markdown).toContain("## Stop Conditions");
		expect(markdown).toContain("maxMinutes=12");

		const loadedArtifact = await loadWorkspaceArtifactByName({
			workspaceDir,
			name: published.skill.name,
		});
		expect(loadedArtifact?.artifactKind).toBe("worker");
		if (!loadedArtifact || loadedArtifact.artifactKind !== "worker") {
			throw new Error("Expected worker artifact");
		}
			expect(loadedArtifact.outputs).toContain("worker-summary.json");
			expect(loadedArtifact.budget).toContain("maxMinutes=12");
			expect(loadedArtifact.allowedSurfaces).toContain("Only the assigned target surfaces");
		});
});
