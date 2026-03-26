import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildTaughtTaskDraftFromRun,
	persistTaughtTaskDraft,
	publishTaughtTaskDraft,
	type TaughtTaskDraft,
} from "@understudy/core";
import {
	createGatewaySessionRuntime,
	type SessionEntry,
} from "../session-runtime.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

async function writeArtifact(workspaceDir: string, name: string, content: string): Promise<void> {
	const artifactDir = path.join(workspaceDir, "skills", name);
	await fs.mkdir(artifactDir, { recursive: true });
	await fs.writeFile(path.join(artifactDir, "SKILL.md"), content, "utf8");
}

function createEntry(id: string, workspaceDir: string): SessionEntry {
	const now = Date.now();
	return {
		id,
		createdAt: now,
		lastActiveAt: now,
		dayStamp: "2026-03-19",
		messageCount: 0,
		session: {},
		workspaceDir,
		history: [],
	};
}

function createRuntimeForWorkspace(workspaceDir: string) {
	const sessionEntries = new Map<string, SessionEntry>([["s1", createEntry("s1", workspaceDir)]]);
	return createGatewaySessionRuntime({
		sessionEntries,
		inFlightSessionIds: new Set<string>(),
		config: {
			agent: {
				userTimezone: "Asia/Hong_Kong",
				cwd: workspaceDir,
			},
		} as any,
		usageTracker: { record: vi.fn() } as any,
		estimateTokens: (text) => text.length,
		appendHistory: (entry, role, text, timestamp, options) => {
			entry.history.push({
				role,
				text,
				timestamp: timestamp ?? Date.now(),
				...(options?.images ? { images: options.images } : {}),
				...(options?.attachments ? { attachments: options.attachments } : {}),
			});
		},
		getOrCreateSession: vi.fn(async () => createEntry("s1", workspaceDir)) as any,
		createScopedSession: vi.fn(async ({ sessionKey }: { sessionKey?: string }) => createEntry(sessionKey ?? "child", workspaceDir)) as any,
		promptSession: vi.fn(async () => ({ response: "ok", runId: "run_1", status: "ok" })) as any,
		abortSessionEntry: vi.fn(async () => true) as any,
	});
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map(async (dir) => await fs.rm(dir, { recursive: true, force: true })));
});

describe("generic playbook session handlers", () => {
	it("drives a handwritten draft -> skill -> playbook run through generic session handlers", async () => {
		const workspaceDir = await makeTempDir("understudy-playbook-session-");
		const learningDir = path.join(workspaceDir, ".learning");
		const baseDraft = buildTaughtTaskDraftFromRun({
			workspaceDir,
			runId: "run-collect",
			promptPreview: "Collect baseline context for a target.",
			title: "Collect Target Context",
			objective: "Collect baseline context for a target.",
			toolTrace: [
				{ type: "toolCall", id: "t1", name: "bash", arguments: {} },
				{ type: "toolResult", id: "t1", name: "bash", route: "shell", textPreview: "Done" },
			],
		});
		const draft = {
			...baseDraft,
			taskKind: "parameterized_workflow" as const,
			parameterSlots: [
				{ name: "target_name", label: "Target name", sampleValue: "Arc Search", required: true },
			],
			successCriteria: ["context.md is written into the run artifacts root."],
		} as unknown as TaughtTaskDraft;
		await persistTaughtTaskDraft(draft, { learningDir });
		const published = await publishTaughtTaskDraft({
			workspaceDir,
			draftId: draft.id,
			learningDir,
			name: "collect-target-context",
		});
		await writeArtifact(
			workspaceDir,
			"explore-target",
			[
				"---",
				"name: explore-target",
				'description: "Goal-driven exploration worker."',
				"metadata:",
				"  understudy:",
				'    artifactKind: "worker"',
				"---",
				"",
				"# explore-target",
				"",
				"## Goal",
				"",
				"Explore the target enough to capture concise findings.",
				"",
				"## Inputs",
				"",
				"- targetName",
				"- artifactsRootDir",
				"",
				"## Outputs",
				"",
				"- findings.md",
				"",
				"## Budget",
				"",
				"- maxMinutes=10",
				"- maxActions=40",
				"",
				"## Allowed Surfaces",
				"",
				"- The assigned target surface",
				"",
				"## Stop Conditions",
				"",
				"- Enough evidence exists for findings.",
				"",
				"## Decision Heuristics",
				"",
				"- Prefer visible actions.",
				"",
				"## Failure Policy",
				"",
				"- Escalate when blocked.",
				"",
			].join("\n"),
		);
		await writeArtifact(
			workspaceDir,
			"generic-review-playbook",
			[
				"---",
				"name: generic-review-playbook",
				'description: "Generic review playbook."',
				"metadata:",
				"  understudy:",
				'    artifactKind: "playbook"',
				"    childArtifacts:",
				`      - name: "${published.skill.name}"`,
				'        artifactKind: "skill"',
				"        required: true",
				'      - name: "explore-target"',
				'        artifactKind: "worker"',
				"        required: true",
				"---",
				"",
				"# generic-review-playbook",
				"",
				"## Goal",
				"",
				"Produce a concise review packet for an unfamiliar target.",
				"",
				"## Inputs",
				"",
				"- targetName",
				"",
				"## Stage Plan",
				"",
				`1. [skill] ${published.skill.name} -> Collect baseline context | inputs: targetName, artifactsRootDir | outputs: context.md`,
					"2. [worker] explore-target -> Explore the target | inputs: targetName, artifactsRootDir | outputs: findings.md",
					"3. [inline] synthesize-brief -> Turn findings into a concise brief | inputs: findings.md, artifactsRootDir | outputs: brief.md",
					"4. [approval] approve-output -> Wait for approval | outputs: approval.state | approval: publish_preview",
				"",
				"## Output Contract",
				"",
				"- context.md",
					"- findings.md",
					"- brief.md",
				"",
				"## Approval Gates",
				"",
				"- Human review before final publish",
				"",
				"## Failure Policy",
				"",
				"- Pause on blocking uncertainty",
				"",
			].join("\n"),
		);

		const runtime = createRuntimeForWorkspace(workspaceDir);

		const started = await runtime.sessionHandlers.playbookRunStart?.({
			workspaceDir,
			playbookName: "generic-review-playbook",
			runId: "run_generic_session",
			inputs: {
				targetName: "Arc Search",
			},
			now: Date.UTC(2026, 2, 19, 8, 0, 0),
		}) as any;
		expect(started.run.id).toBe("run_generic_session");
		expect(started.nextStage.refName).toBe(published.skill.name);

		const listed = await runtime.sessionHandlers.playbookRunList?.({
			workspaceDir,
			limit: 5,
		}) as any;
		expect(listed.runs).toHaveLength(1);
		expect(listed.runs[0]).toMatchObject({
			id: "run_generic_session",
			playbookName: "generic-review-playbook",
			inputs: { targetName: "Arc Search" },
		});

		const skillStage = await runtime.sessionHandlers.playbookRunNext?.({
			workspaceDir,
			runId: "run_generic_session",
			parentSessionId: "s1",
		}) as any;
		expect(skillStage.mode).toBe("skill");
		expect(skillStage.skillLaunch.prompt).toContain(`skillPath=${published.skill.skillPath}`);

		await runtime.sessionHandlers.playbookRunStageComplete?.({
			workspaceDir,
			runId: "run_generic_session",
			stageId: skillStage.stage.id,
			status: "completed",
			summary: "Skill stage completed.",
			artifactPaths: ["context.md"],
			now: Date.UTC(2026, 2, 19, 8, 5, 0),
		});

		const workerStage = await runtime.sessionHandlers.playbookRunNext?.({
			workspaceDir,
			runId: "run_generic_session",
			parentSessionId: "s1",
		}) as any;
		expect(workerStage.mode).toBe("worker");
		expect(workerStage.workerLaunch.prompt).toContain("artifactsRootDir=");

			await runtime.sessionHandlers.playbookRunStageComplete?.({
				workspaceDir,
				runId: "run_generic_session",
				stageId: workerStage.stage.id,
				status: "completed",
				summary: "Worker stage completed.",
				artifactPaths: ["findings.md"],
				now: Date.UTC(2026, 2, 19, 8, 10, 0),
			});

			const inlineStage = await runtime.sessionHandlers.playbookRunNext?.({
				workspaceDir,
				runId: "run_generic_session",
				parentSessionId: "s1",
			}) as any;
			expect(inlineStage.mode).toBe("inline");
			expect(inlineStage.inlineLaunch.prompt).toContain("Execute the inline playbook stage `Synthesize Brief`.");

			await runtime.sessionHandlers.playbookRunStageComplete?.({
				workspaceDir,
				runId: "run_generic_session",
				stageId: inlineStage.stage.id,
				status: "completed",
				summary: "Inline stage completed.",
				artifactPaths: ["brief.md"],
				now: Date.UTC(2026, 2, 19, 8, 12, 0),
			});

			const approvalStage = await runtime.sessionHandlers.playbookRunNext?.({
				workspaceDir,
			runId: "run_generic_session",
			parentSessionId: "s1",
			}) as any;
			expect(approvalStage.mode).toBe("approval");

			const completedApproval = await runtime.sessionHandlers.playbookRunStageComplete?.({
				workspaceDir,
				runId: "run_generic_session",
				stageId: approvalStage.stage.id,
				status: "completed",
				approvalState: "approved",
				summary: "Human approval granted.",
				artifactPaths: ["context.md", "findings.md", "brief.md"],
				now: Date.UTC(2026, 2, 19, 8, 15, 0),
			}) as any;
			expect(completedApproval.status).toBe("completed");
			expect(completedApproval.approval.state).toBe("approved");

			const fetched = await runtime.sessionHandlers.playbookRunGet?.({
				workspaceDir,
				runId: "run_generic_session",
			}) as any;
			expect(fetched.summary.status).toBe("completed");
			expect(fetched.summary.approval.state).toBe("approved");
			expect(fetched.summary.currentStage).toBeNull();
		});
	});
