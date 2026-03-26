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
	completePlaybookStage,
	resumePlaybookRun,
	runPlaybookNextStage,
	startPlaybookRun,
} from "../playbook-runtime.js";

const tempDirs: string[] = [];
const originalBundledSkillsDir = process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR;
const handwrittenFixturesDir = path.resolve(process.cwd(), "examples/handwritten-playbook-demo/skills");

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

async function copyHandwrittenFixtures(workspaceDir: string): Promise<void> {
	await fs.cp(handwrittenFixturesDir, path.join(workspaceDir, "skills"), { recursive: true });
}

async function writeRunOutputs(rootDir: string, relativePaths: string[]): Promise<void> {
	for (const relativePath of relativePaths) {
		const filePath = path.join(rootDir, relativePath);
		await fs.mkdir(path.dirname(filePath), { recursive: true });
		await fs.writeFile(filePath, `fixture:${relativePath}\n`, "utf8");
	}
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map(async (dir) => await fs.rm(dir, { recursive: true, force: true })));
	if (originalBundledSkillsDir === undefined) {
		delete process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR;
	} else {
		process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR = originalBundledSkillsDir;
	}
});

describe("playbook runtime", () => {
	it("starts, resumes, advances stages, and persists stage summaries for generic playbook runs", async () => {
		process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR = path.join(os.tmpdir(), "__understudy-no-bundled-skills__");
		const workspaceDir = await makeTempDir("understudy-playbook-runtime-");
		await writeArtifact(
			workspaceDir,
			"review-playbook",
			[
				"---",
				"name: review-playbook",
				'description: "Top-level reusable review production line."',
				"metadata:",
				"  understudy:",
				'    artifactKind: "playbook"',
				"    childArtifacts:",
				'      - name: "collect-context"',
				'        artifactKind: "skill"',
				"        required: true",
				'      - name: "explore-target"',
				'        artifactKind: "worker"',
				"        required: true",
				"---",
				"",
				"# review-playbook",
				"",
				"## Goal",
				"",
				"Create a reusable review dossier for an unfamiliar target.",
				"",
				"## Inputs",
				"",
				"- targetName",
				"",
				"## Stage Plan",
				"",
				"1. [skill] collect-context -> Collect baseline context | outputs: context.md | retry: retry_once",
					"2. [worker] explore-target -> Explore the unfamiliar target | inputs: targetName, artifactsRootDir | outputs: findings.md, highlights.json | retry: pause_for_human",
					"3. [inline] synthesize-brief -> Turn findings into a concise brief | inputs: findings.md, highlights.json, artifactsRootDir | outputs: brief.md | retry: retry_once",
					"4. [approval] approve-output -> Wait for human approval | outputs: approval.state | approval: publish_preview",
				"",
				"## Output Contract",
				"",
					"- brief.md",
					"- final.md",
				"",
				"## Approval Gates",
				"",
				"- Human review before publish",
				"",
				"## Failure Policy",
				"",
				"- Pause for human review on blocking UI",
				"",
			].join("\n"),
		);
		await writeArtifact(
			workspaceDir,
			"collect-context",
			[
				"---",
				"name: collect-context",
				'description: "Collect baseline context for a target."',
				"metadata:",
				"  understudy:",
				'    artifactKind: "skill"',
				"---",
				"",
				"# collect-context",
				"",
				"## Overall Goal",
				"",
				"Collect baseline context and write it into the run artifacts root.",
				"",
				"## Staged Workflow",
				"",
				"1. Inspect the run inputs.",
				"2. Write context.md into the artifacts root.",
				"",
				"## Tool Route Options",
				"",
				"- shell",
				"",
				"## Detailed GUI Replay Hints",
				"",
				"- None required.",
				"",
				"## Failure Policy",
				"",
				"- Pause if required inputs are missing.",
				"",
			].join("\n"),
		);
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
				"Explore the target deeply enough to produce a review dossier.",
				"",
				"## Inputs",
				"",
				"- targetName",
				"- artifactsRootDir",
				"",
				"## Outputs",
				"",
				"- findings.md",
				"- highlights.json",
				"",
				"## Budget",
				"",
				"- maxMinutes=12",
				"- maxActions=60",
				"",
				"## Allowed Surfaces",
				"",
				"- Only the assigned target surface",
				"",
				"## Stop Conditions",
				"",
				"- Enough evidence exists for highlights and limitations.",
				"",
				"## Decision Heuristics",
				"",
				"- Prefer user-visible features.",
				"",
				"## Failure Policy",
				"",
				"- Escalate on blocking gates.",
				"",
			].join("\n"),
		);

		const started = await startPlaybookRun({
			workspaceDir,
			playbookName: "review-playbook",
			runId: "run_runtime",
			inputs: {
				targetName: "Arc Search",
			},
			now: Date.UTC(2026, 2, 19, 6, 0, 0),
		});
		expect(started.run.playbookName).toBe("review-playbook");
		expect(started.nextStage?.refName).toBe("collect-context");

		const spawnSubagent = vi.fn(async () => ({
			childSessionId: "parent-1:subagent:stage",
			status: "in_flight",
			mode: "session",
			runtime: "subagent",
		}));
		const skillRun = await runPlaybookNextStage({
			workspaceDir,
			runId: "run_runtime",
			parentSessionId: "parent-1",
			contextNotes: ["Use the published workspace artifact contract rather than task-specific runtime logic."],
			spawnSubagent,
		});
		expect(skillRun.mode).toBe("skill");
		expect(skillRun.skillLaunch?.skill.name).toBe("collect-context");
		expect(skillRun.skillLaunch?.prompt).toContain("Execute the workspace skill artifact `collect-context`.");
		expect(skillRun.skillLaunch?.prompt).toContain("targetName=Arc Search");
		expect(skillRun.run.stages?.find((stage) => stage.id === skillRun.stage.id)?.status).toBe("running");
		await writeRunOutputs(skillRun.run.artifacts.rootDir, ["context.md"]);
		const completedSkill = await completePlaybookStage({
			workspaceDir,
			runId: "run_runtime",
			stageId: skillRun.stage.id,
			status: "completed",
			summary: "Collected baseline context and wrote context.md.",
			artifactPaths: ["context.md"],
			now: Date.UTC(2026, 2, 19, 6, 5, 0),
		});
		const summaryPath = path.join(skillRun.run.artifacts.stageSummaryDir, `${skillRun.stage.id}.md`);
		await expect(fs.readFile(summaryPath, "utf8")).resolves.toContain("Collected baseline context");
		expect(completedSkill.stages?.find((stage) => stage.id === skillRun.stage.id)?.status).toBe("completed");
		expect(completedSkill.childSessions).toContainEqual(
			expect.objectContaining({
				stageId: skillRun.stage.id,
				status: "completed",
			}),
		);

		const resumed = await resumePlaybookRun({
			workspaceDir,
			runId: "run_runtime",
		});
		expect(resumed.nextStage?.refName).toBe("explore-target");

		const spawnWorkerSubagent = vi.fn(async () => ({
			childSessionId: "parent-1:subagent:worker",
			status: "in_flight",
			mode: "session",
			runtime: "subagent",
		}));
		const workerRun = await runPlaybookNextStage({
			workspaceDir,
			runId: "run_runtime",
			parentSessionId: "parent-1",
			contextNotes: ["This is a reusable playbook run, not a task-specific runner."],
			spawnSubagent: spawnWorkerSubagent,
		});
		expect(workerRun.mode).toBe("worker");
		expect(workerRun.workerLaunch?.run.childSessions).toContainEqual(
			expect.objectContaining({
				sessionId: "parent-1:subagent:worker",
			}),
		);
		await writeRunOutputs(workerRun.run.artifacts.rootDir, ["findings.md", "highlights.json"]);

			const completedWorker = await completePlaybookStage({
				workspaceDir,
				runId: "run_runtime",
				stageId: workerRun.stage.id,
				status: "completed",
				summary: "Worker captured highlights and limitations into the artifacts root.",
				artifactPaths: ["findings.md", "highlights.json"],
				now: Date.UTC(2026, 2, 19, 6, 30, 0),
			});
			expect(completedWorker.stages?.find((stage) => stage.id === workerRun.stage.id)?.status).toBe("completed");
			expect(completedWorker.status).toBe("running");
			expect(completedWorker.childSessions).toContainEqual(
				expect.objectContaining({
					stageId: workerRun.stage.id,
					status: "completed",
				}),
			);

			const inlineStage = await runPlaybookNextStage({
				workspaceDir,
				runId: "run_runtime",
				parentSessionId: "parent-1",
				contextNotes: ["Inline stages should run through the same reusable playbook contract."],
				spawnSubagent,
			});
			expect(inlineStage.mode).toBe("inline");
			expect(inlineStage.inlineLaunch?.prompt).toContain("Execute the inline playbook stage `Synthesize Brief`.");
			expect(inlineStage.inlineLaunch?.prompt).toContain("artifactsRootDir=");
			expect(inlineStage.inlineLaunch?.prompt).toContain("findings.md=findings.md");
			expect(inlineStage.inlineLaunch?.prompt).toContain("highlights.json=highlights.json");
			await writeRunOutputs(inlineStage.run.artifacts.rootDir, ["brief.md"]);
			const completedInline = await completePlaybookStage({
				workspaceDir,
				runId: "run_runtime",
				stageId: inlineStage.stage.id,
				status: "completed",
				summary: "Inline stage produced a concise brief.",
				artifactPaths: ["brief.md"],
				now: Date.UTC(2026, 2, 19, 6, 40, 0),
			});
			expect(completedInline.status).toBe("waiting_for_approval");

			const approvalStage = await runPlaybookNextStage({
				workspaceDir,
				runId: "run_runtime",
				parentSessionId: "parent-1",
				spawnSubagent,
			});
			expect(approvalStage.mode).toBe("approval");
			const approvedRun = await completePlaybookStage({
				workspaceDir,
				runId: "run_runtime",
				stageId: approvalStage.stage.id,
				status: "completed",
				approvalState: "approved",
				approvalNote: "Reviewed and approved for final handoff.",
				summary: "Approval granted for the final brief.",
				artifactPaths: ["brief.md", "final.md"],
				now: Date.UTC(2026, 2, 19, 6, 45, 0),
			});
			expect(approvedRun.status).toBe("completed");
			expect(approvedRun.approval.state).toBe("approved");
		});

	it("runs end-to-end from handwritten generic workspace artifacts on disk", async () => {
		process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR = path.join(os.tmpdir(), "__understudy-no-bundled-skills__");
		const workspaceDir = await makeTempDir("understudy-playbook-runtime-fixture-");
		await copyHandwrittenFixtures(workspaceDir);

		const started = await startPlaybookRun({
			workspaceDir,
			playbookName: "target-brief-studio",
			runId: "run_handwritten_fixture",
			inputs: {
				targetName: "Northwind Portal",
				analysisFocus: "First-pass productivity",
			},
			now: Date.UTC(2026, 2, 19, 6, 50, 0),
		});
		expect(started.nextStage?.refName).toBe("collect-target-context");

		const spawnSubagent = vi.fn(async () => ({
			childSessionId: `fixture-child-${spawnSubagent.mock.calls.length + 1}`,
			status: "in_flight",
			mode: "session",
			runtime: "subagent",
		}));

		const contextStage = await runPlaybookNextStage({
			workspaceDir,
			runId: started.run.id,
			parentSessionId: "parent-fixture",
			spawnSubagent,
		});
		expect(contextStage.mode).toBe("skill");
		expect(contextStage.skillLaunch?.skill.name).toBe("collect-target-context");
		await writeRunOutputs(contextStage.run.artifacts.rootDir, ["target.json", "context.md"]);
		await completePlaybookStage({
			workspaceDir,
			runId: started.run.id,
			stageId: contextStage.stage.id,
			status: "completed",
			summary: "Collected baseline context for the selected target.",
			artifactPaths: ["target.json", "context.md"],
			now: Date.UTC(2026, 2, 19, 6, 55, 0),
		});

		const workerStage = await runPlaybookNextStage({
			workspaceDir,
			runId: started.run.id,
			parentSessionId: "parent-fixture",
			spawnSubagent,
		});
		expect(workerStage.mode).toBe("worker");
		expect(workerStage.workerLaunch?.worker.name).toBe("explore-unfamiliar-target");
		await writeRunOutputs(workerStage.run.artifacts.rootDir, ["findings.md", "highlights.json", "limitations.json", "worker-summary.json"]);
		await completePlaybookStage({
			workspaceDir,
			runId: started.run.id,
			stageId: workerStage.stage.id,
			status: "completed",
			summary: "Captured findings, highlights, and limitations for the target.",
			artifactPaths: ["findings.md", "highlights.json", "limitations.json", "worker-summary.json"],
			now: Date.UTC(2026, 2, 19, 7, 5, 0),
		});

		const briefStage = await runPlaybookNextStage({
			workspaceDir,
			runId: started.run.id,
			parentSessionId: "parent-fixture",
			spawnSubagent,
		});
		expect(briefStage.mode).toBe("skill");
		expect(briefStage.skillLaunch?.skill.name).toBe("synthesize-brief");
		await writeRunOutputs(briefStage.run.artifacts.rootDir, ["summary.json", "brief.md"]);
		await completePlaybookStage({
			workspaceDir,
			runId: started.run.id,
			stageId: briefStage.stage.id,
			status: "completed",
			summary: "Synthesized the brief and summary packet.",
			artifactPaths: ["summary.json", "brief.md"],
			now: Date.UTC(2026, 2, 19, 7, 10, 0),
		});

		const assetStage = await runPlaybookNextStage({
			workspaceDir,
			runId: started.run.id,
			parentSessionId: "parent-fixture",
			spawnSubagent,
		});
		expect(assetStage.mode).toBe("skill");
		expect(assetStage.skillLaunch?.skill.name).toBe("render-brief-assets");
		await writeRunOutputs(assetStage.run.artifacts.rootDir, ["cover.png", "summary-card.png"]);
		await completePlaybookStage({
			workspaceDir,
			runId: started.run.id,
			stageId: assetStage.stage.id,
			status: "completed",
			summary: "Rendered the cover and summary-card assets.",
			artifactPaths: ["cover.png", "summary-card.png"],
			now: Date.UTC(2026, 2, 19, 7, 15, 0),
		});

		const videoStage = await runPlaybookNextStage({
			workspaceDir,
			runId: started.run.id,
			parentSessionId: "parent-fixture",
			spawnSubagent,
		});
		expect(videoStage.mode).toBe("skill");
		expect(videoStage.skillLaunch?.skill.name).toBe("compose-summary-video");
		await writeRunOutputs(videoStage.run.artifacts.rootDir, ["draft.mp4"]);
		await completePlaybookStage({
			workspaceDir,
			runId: started.run.id,
			stageId: videoStage.stage.id,
			status: "completed",
			summary: "Rendered the draft summary video.",
			artifactPaths: ["draft.mp4"],
			now: Date.UTC(2026, 2, 19, 7, 20, 0),
		});

		const previewStage = await runPlaybookNextStage({
			workspaceDir,
			runId: started.run.id,
			parentSessionId: "parent-fixture",
			spawnSubagent,
		});
		expect(previewStage.mode).toBe("skill");
		expect(previewStage.skillLaunch?.skill.name).toBe("prepare-delivery-preview");
		await writeRunOutputs(previewStage.run.artifacts.rootDir, ["delivery/preview.json"]);
		await completePlaybookStage({
			workspaceDir,
			runId: started.run.id,
			stageId: previewStage.stage.id,
			status: "completed",
			summary: "Prepared the delivery preview payload.",
			artifactPaths: ["delivery/preview.json"],
			now: Date.UTC(2026, 2, 19, 7, 25, 0),
		});

		const approvalStage = await runPlaybookNextStage({
			workspaceDir,
			runId: started.run.id,
			parentSessionId: "parent-fixture",
			spawnSubagent,
		});
		expect(approvalStage.mode).toBe("approval");
		const approvedRun = await completePlaybookStage({
			workspaceDir,
			runId: started.run.id,
			stageId: approvalStage.stage.id,
			status: "completed",
			approvalState: "approved",
			approvalNote: "Handwritten fixture run approved for delivery.",
			summary: "Human approval granted for the full handwritten fixture run.",
			artifactPaths: ["draft.mp4", "delivery/preview.json", "summary.json", "brief.md"],
			now: Date.UTC(2026, 2, 19, 7, 30, 0),
		});
		expect(approvedRun.status).toBe("completed");
		expect(approvedRun.approval.state).toBe("approved");
		expect(spawnSubagent).toHaveBeenCalledTimes(6);
	});

	it("fails a completed stage when the declared outputs were not actually written", async () => {
		process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR = path.join(os.tmpdir(), "__understudy-no-bundled-skills__");
		const workspaceDir = await makeTempDir("understudy-playbook-runtime-missing-output-");
		await writeArtifact(
			workspaceDir,
			"mini-playbook",
			[
				"---",
				"name: mini-playbook",
				'description: "Minimal playbook for output validation."',
				"metadata:",
				"  understudy:",
				'    artifactKind: "playbook"',
				"    childArtifacts:",
				'      - name: "collect-context"',
				'        artifactKind: "skill"',
				"        required: true",
				"---",
				"",
				"# mini-playbook",
				"",
				"## Stage Plan",
				"",
				"1. [skill] collect-context -> Collect baseline context | outputs: context.md | retry: retry_once",
				"",
			].join("\n"),
		);
		await writeArtifact(
			workspaceDir,
			"collect-context",
			[
				"---",
				"name: collect-context",
				'description: "Collect baseline context for a target."',
				"metadata:",
				"  understudy:",
				'    artifactKind: "skill"',
				"---",
				"",
				"# collect-context",
			].join("\n"),
		);

		const started = await startPlaybookRun({
			workspaceDir,
			playbookName: "mini-playbook",
			runId: "run_missing_output",
		});
		const spawnSubagent = vi.fn(async () => ({
			childSessionId: "parent-1:subagent:missing-output",
			status: "in_flight",
			mode: "session",
			runtime: "subagent",
		}));
		const skillRun = await runPlaybookNextStage({
			workspaceDir,
			runId: started.run.id,
			parentSessionId: "parent-1",
			spawnSubagent,
		});

		const completed = await completePlaybookStage({
			workspaceDir,
			runId: started.run.id,
			stageId: skillRun.stage.id,
			status: "completed",
			summary: "Claimed completion without writing the declared output.",
			artifactPaths: ["context.md"],
		});

		expect(completed.status).toBe("failed");
		expect(completed.stages?.find((stage) => stage.id === skillRun.stage.id)?.status).toBe("failed");
		expect(completed.notesSummary).toContain("Playbook output validation failed");
		expect(completed.notesSummary).toContain("context.md");
	});

	it("uses the playbook contract captured at run start for later output validation", async () => {
		process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR = path.join(os.tmpdir(), "__understudy-no-bundled-skills__");
		const workspaceDir = await makeTempDir("understudy-playbook-runtime-snapshot-");
		await writeArtifact(
			workspaceDir,
			"snapshot-playbook",
			[
				"---",
				"name: snapshot-playbook",
				'description: "Playbook snapshot validation fixture."',
				"metadata:",
				"  understudy:",
				'    artifactKind: "playbook"',
				"    childArtifacts:",
				'      - name: "collect-context"',
				'        artifactKind: "skill"',
				"        required: true",
				"---",
				"",
				"# snapshot-playbook",
				"",
				"## Stage Plan",
				"",
				"1. [skill] collect-context -> Gather context | outputs: context.md | retry: retry_once",
				"",
			].join("\n"),
		);
		await writeArtifact(
			workspaceDir,
			"collect-context",
			[
				"---",
				"name: collect-context",
				'description: "Collect context into the run artifacts root."',
				"metadata:",
				"  understudy:",
				'    artifactKind: "skill"',
				"---",
				"",
				"# collect-context",
			].join("\n"),
		);

		const started = await startPlaybookRun({
			workspaceDir,
			playbookName: "snapshot-playbook",
			runId: "run_snapshot_contract",
			now: Date.UTC(2026, 2, 20, 8, 0, 0),
		});
		expect(started.run.stages?.[0]?.outputs).toEqual(["context.md"]);

		const launched = await runPlaybookNextStage({
			workspaceDir,
			runId: "run_snapshot_contract",
			parentSessionId: "parent-snapshot",
			spawnSubagent: vi.fn(async () => ({
				childSessionId: "parent-snapshot:subagent:skill",
				status: "in_flight",
				mode: "session",
				runtime: "subagent",
			})),
		});
		await writeArtifact(
			workspaceDir,
			"snapshot-playbook",
			[
				"---",
				"name: snapshot-playbook",
				'description: "Playbook snapshot validation fixture."',
				"metadata:",
				"  understudy:",
				'    artifactKind: "playbook"',
				"    childArtifacts:",
				'      - name: "collect-context"',
				'        artifactKind: "skill"',
				"        required: true",
				"---",
				"",
				"# snapshot-playbook",
				"",
				"## Stage Plan",
				"",
				"1. [skill] collect-context -> Gather context | outputs: renamed.md | retry: retry_once",
				"",
			].join("\n"),
		);
		await writeRunOutputs(launched.run.artifacts.rootDir, ["context.md"]);

		const completed = await completePlaybookStage({
			workspaceDir,
			runId: "run_snapshot_contract",
			stageId: launched.stage.id,
			status: "completed",
			summary: "Collected context according to the original run contract.",
			artifactPaths: ["context.md"],
			now: Date.UTC(2026, 2, 20, 8, 5, 0),
		});
		expect(completed.status).toBe("completed");
		expect(completed.notesSummary).not.toContain("Playbook output validation failed");
	});

	it("accepts alternative output paths when one declared artifact exists", async () => {
		const workspaceDir = await makeTempDir("understudy-playbook-runtime-alt-output-");
		await writeArtifact(
			workspaceDir,
			"mini-playbook",
			[
				"---",
				"name: mini-playbook",
				'description: "Tiny playbook with an alternative output."',
				"metadata:",
				"  understudy:",
				'    artifactKind: "playbook"',
				"---",
				"",
				"# mini-playbook",
				"",
				"## Stage Plan",
				"",
				"1. [skill] collect-context -> Collect baseline context | outputs: context.md ?? context.txt | retry: retry_once",
				"",
			].join("\n"),
		);
		await writeArtifact(
			workspaceDir,
			"collect-context",
			[
				"---",
				"name: collect-context",
				'description: "Collect baseline context for a target."',
				"metadata:",
				"  understudy:",
				'    artifactKind: "skill"',
				"---",
				"",
				"# collect-context",
			].join("\n"),
		);

		const started = await startPlaybookRun({
			workspaceDir,
			playbookName: "mini-playbook",
			runId: "run_alt_output",
		});
		const spawnSubagent = vi.fn(async () => ({
			childSessionId: "parent-1:subagent:alt-output",
			status: "in_flight",
			mode: "session",
			runtime: "subagent",
		}));
		const skillRun = await runPlaybookNextStage({
			workspaceDir,
			runId: started.run.id,
			parentSessionId: "parent-1",
			spawnSubagent,
		});

		await fs.writeFile(path.join(started.run.artifacts.rootDir, "context.txt"), "ok\n", "utf8");

		const completed = await completePlaybookStage({
			workspaceDir,
			runId: started.run.id,
			stageId: skillRun.stage.id,
			status: "completed",
			summary: "Completed using the blocked-friendly alternative output path.",
			artifactPaths: ["context.txt"],
		});

		expect(completed.status).toBe("completed");
		expect(completed.stages?.find((stage) => stage.id === skillRun.stage.id)?.status).toBe("completed");
		expect(completed.notesSummary).not.toContain("Playbook output validation failed");
	});

	it("runs end-to-end with a hand-authored teach draft published as a skill artifact", async () => {
		process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR = path.join(os.tmpdir(), "__understudy-no-bundled-skills__");
		const workspaceDir = await makeTempDir("understudy-playbook-runtime-draft-");
		const learningDir = path.join(workspaceDir, ".learning");
		const baseDraft = buildTaughtTaskDraftFromRun({
			workspaceDir,
			runId: "run-collect",
			promptPreview: "Collect baseline context for an unfamiliar target.",
			title: "Collect Target Context",
			objective: "Collect baseline context for an unfamiliar target.",
			toolTrace: [
				{ type: "toolCall", id: "t1", name: "bash", arguments: { target_name: "Arc Search" } },
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
			taskCard: {
				goal: "Collect baseline context for an unfamiliar target.",
				scope: "Single reusable context collection stage.",
				inputs: ["Target name"],
				output: "context.md is written into the run artifacts root.",
				extract: ["Baseline context"],
			},
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
				"Explore an unfamiliar target deeply enough to produce findings.",
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
				"- Enough evidence exists for a concise finding list.",
				"",
				"## Decision Heuristics",
				"",
				"- Prefer user-visible actions.",
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
				"## Child Artifacts",
				"",
				`- ${published.skill.name}`,
				"- explore-target",
				"",
				"## Stage Plan",
				"",
				`1. [skill] ${published.skill.name} -> Collect baseline context | inputs: targetName, artifactsRootDir | outputs: context.md`,
					"2. [worker] explore-target -> Explore the target and capture findings | inputs: targetName, artifactsRootDir | outputs: findings.md",
					"3. [inline] synthesize-brief -> Turn findings into a concise brief | inputs: findings.md, artifactsRootDir | outputs: brief.md",
					"4. [approval] approve-output -> Wait for human approval | outputs: approval.state | approval: publish_preview",
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

		const started = await startPlaybookRun({
			workspaceDir,
			playbookName: "generic-review-playbook",
			runId: "run_draft_e2e",
			inputs: {
				targetName: "Arc Search",
			},
			now: Date.UTC(2026, 2, 19, 7, 0, 0),
		});

		const spawnSubagent = vi.fn(async () => ({
			childSessionId: `child-${spawnSubagent.mock.calls.length + 1}`,
			status: "in_flight",
			mode: "session",
			runtime: "subagent",
		}));
		const skillStage = await runPlaybookNextStage({
			workspaceDir,
			runId: started.run.id,
			parentSessionId: "parent-e2e",
			spawnSubagent,
		});
		expect(skillStage.mode).toBe("skill");
		expect(skillStage.skillLaunch?.skill.name).toBe(published.skill.name);
		expect(skillStage.skillLaunch?.prompt).toContain(`skillPath=${published.skill.skillPath}`);
			await completePlaybookStage({
				workspaceDir,
				runId: started.run.id,
			stageId: skillStage.stage.id,
			status: "completed",
			summary: "Context stage completed.",
			artifactPaths: ["context.md"],
			now: Date.UTC(2026, 2, 19, 7, 5, 0),
		});

		const workerStage = await runPlaybookNextStage({
			workspaceDir,
			runId: started.run.id,
			parentSessionId: "parent-e2e",
			spawnSubagent,
		});
			expect(workerStage.mode).toBe("worker");
			expect(workerStage.workerLaunch?.prompt).toContain("artifactsRootDir=");
			await completePlaybookStage({
			workspaceDir,
			runId: started.run.id,
			stageId: workerStage.stage.id,
			status: "completed",
			summary: "Worker stage completed.",
				artifactPaths: ["findings.md"],
				now: Date.UTC(2026, 2, 19, 7, 10, 0),
			});

			const inlineStage = await runPlaybookNextStage({
				workspaceDir,
				runId: started.run.id,
				parentSessionId: "parent-e2e",
				spawnSubagent,
			});
			expect(inlineStage.mode).toBe("inline");
			expect(inlineStage.inlineLaunch?.prompt).toContain("Execute the inline playbook stage `Synthesize Brief`.");
			await completePlaybookStage({
				workspaceDir,
				runId: started.run.id,
				stageId: inlineStage.stage.id,
				status: "completed",
				summary: "Inline synthesis stage completed.",
				artifactPaths: ["brief.md"],
				now: Date.UTC(2026, 2, 19, 7, 12, 0),
			});

			const approvalStage = await runPlaybookNextStage({
				workspaceDir,
			runId: started.run.id,
			parentSessionId: "parent-e2e",
			spawnSubagent,
			});
			expect(approvalStage.mode).toBe("approval");
			expect(approvalStage.run.status).toBe("waiting_for_approval");
			const completedApproval = await completePlaybookStage({
				workspaceDir,
				runId: started.run.id,
				stageId: approvalStage.stage.id,
				status: "completed",
				approvalState: "approved",
				summary: "Approval granted for the draft-based playbook run.",
				artifactPaths: ["context.md", "findings.md", "brief.md"],
				now: Date.UTC(2026, 2, 19, 7, 15, 0),
			});
			expect(completedApproval.status).toBe("completed");
			expect(completedApproval.approval.state).toBe("approved");
			expect(spawnSubagent).toHaveBeenCalledTimes(3);
		});

		it("validates approval completions and rejects unknown stage ids", async () => {
			process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR = path.join(os.tmpdir(), "__understudy-no-bundled-skills__");
			const workspaceDir = await makeTempDir("understudy-playbook-runtime-validation-");
			await writeArtifact(
				workspaceDir,
				"approval-only-playbook",
				[
					"---",
					"name: approval-only-playbook",
					'description: "Minimal approval validation playbook."',
					"metadata:",
					"  understudy:",
					'    artifactKind: "playbook"',
					"---",
					"",
					"# approval-only-playbook",
					"",
					"## Goal",
					"",
					"Validate approval-stage completion behavior.",
					"",
					"## Stage Plan",
					"",
					"1. [approval] approve-output -> Wait for approval | outputs: approval.state | approval: publish_preview",
					"",
					"## Output Contract",
					"",
					"- final.md",
					"",
				].join("\n"),
			);

			const started = await startPlaybookRun({
				workspaceDir,
				playbookName: "approval-only-playbook",
				runId: "run_validation",
				now: Date.UTC(2026, 2, 19, 8, 0, 0),
			});
			const approvalStageId = started.nextStage?.id;
			if (!approvalStageId) {
				throw new Error("Expected approval stage id");
			}

			await expect(completePlaybookStage({
				workspaceDir,
				runId: "run_validation",
				stageId: "missing-stage",
				status: "completed",
				summary: "Should not work.",
			})).rejects.toThrow("Playbook stage not found");

			await expect(completePlaybookStage({
				workspaceDir,
				runId: "run_validation",
				stageId: approvalStageId,
				status: "completed",
				summary: "Approval attempted without a decision.",
			})).rejects.toThrow("approvalState is required");
		});
	});
