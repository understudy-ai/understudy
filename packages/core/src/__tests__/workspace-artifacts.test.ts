import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildWorkspaceSkillSnapshot,
	createPlaybookRunFromPlaybook,
	loadWorkspaceArtifactByName,
	resolveWorkspaceArtifactPath,
} from "../index.js";

const tempDirs: string[] = [];
const originalBundledSkillsDir = process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR;

async function makeTempDir(prefix: string): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

async function writeArtifact(
	workspaceDir: string,
	name: string,
	content: string,
): Promise<void> {
	const skillDir = path.join(workspaceDir, "skills", name);
	await fs.mkdir(skillDir, { recursive: true });
	await fs.writeFile(path.join(skillDir, "SKILL.md"), content, "utf8");
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map(async (dir) => await fs.rm(dir, { recursive: true, force: true })));
	if (originalBundledSkillsDir === undefined) {
		delete process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR;
	} else {
		process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR = originalBundledSkillsDir;
	}
});

describe("workspace artifacts", () => {
		it("loads a hand-authored playbook and exposes artifact kind metadata in the workspace snapshot", async () => {
			process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR = path.join(os.tmpdir(), "__understudy-no-bundled-skills__");
			const workspaceDir = await makeTempDir("understudy-playbook-workspace-");
			await writeArtifact(
				workspaceDir,
				"research-playbook",
				[
					"---",
					"name: research-playbook",
					'description: "Top-level reusable research production line."',
					"metadata:",
					"  understudy:",
					'    artifactKind: "playbook"',
					"    childArtifacts:",
					'      - name: "collect-target-context"',
					'        artifactKind: "skill"',
					"        required: true",
					'      - name: "explore-target"',
					'        artifactKind: "worker"',
					"        required: true",
					"---",
					"",
					"# research-playbook",
					"",
					"## Goal",
					"",
					"Create a publishable first-pass research dossier.",
					"",
					"## Inputs",
					"",
					"- targetName",
					"- researchAngle",
					"",
					"## Child Artifacts",
					"",
					"- collect-target-context",
					"- explore-target",
					"",
					"## Stage Plan",
					"",
					"1. [skill] collect-target-context -> Collect baseline context | inputs: targetName, artifactsRootDir | outputs: context.md | retry: retry_once",
					"2. [worker] explore-target -> Explore the target and capture findings | inputs: targetName, artifactsRootDir, researchAngle | outputs: findings.md, highlights.json, limitations.json | retry: pause_for_human",
					"3. [inline] synthesize-brief -> Turn findings into a concise brief | inputs: findings.md, highlights.json, limitations.json | outputs: scorecard.json, brief.md",
					"4. [approval] publish-preview -> Wait for human approval before publishing | outputs: approval.state | approval: legal_review",
					"",
					"## Output Contract",
					"",
					"- artifacts/final.md",
					"- artifacts/summary.json",
					"",
					"## Approval Gates",
					"",
					"- Human review before publish",
					"",
					"## Failure Policy",
					"",
					"- Pause for human review if a blocking dependency appears.",
					"",
				].join("\n"),
			);
			await writeArtifact(
				workspaceDir,
				"explore-target",
				[
					"---",
					"name: explore-target",
					'description: "Goal-driven exploration worker for unfamiliar targets."',
					"metadata:",
					"  understudy:",
					'    artifactKind: "worker"',
					"---",
					"",
					"# explore-target",
					"",
					"## Goal",
					"",
					"Explore the assigned target deeply enough to produce defensible findings.",
					"",
					"## Inputs",
					"",
					"- targetName",
					"- artifactsRootDir",
					"- researchAngle",
					"",
					"## Outputs",
					"",
				"- findings.md",
				"- highlights.json",
				"- limitations.json",
				"",
				"## Budget",
				"",
				"- maxMinutes=12",
				"- maxActions=60",
				"",
					"## Stop Conditions",
					"",
					"- Enough evidence for 2-3 highlights and 1 limitation.",
				"",
					"## Decision Heuristics",
					"",
					"- Prefer evidence-producing actions over exhaustive blind traversal.",
					"",
					"## Failure Policy",
					"",
					"- Escalate on blocking access or missing permissions.",
					"",
				].join("\n"),
			);

		const snapshot = buildWorkspaceSkillSnapshot({
			workspaceDir,
			config: {
				agent: {
					skillDirs: [],
				},
			} as any,
		});
			const playbookSkill = snapshot.resolvedSkills.find((skill) => skill.name === "research-playbook");
			const workerSkill = snapshot.resolvedSkills.find((skill) => skill.name === "explore-target");
			expect(playbookSkill?.artifactKind).toBe("playbook");
			expect(playbookSkill?.childArtifacts).toEqual([
				{ name: "collect-target-context", artifactKind: "skill", required: true },
				{ name: "explore-target", artifactKind: "worker", required: true },
			]);
			expect(workerSkill?.artifactKind).toBe("worker");
			expect(snapshot.prompt).toContain("Playbook. Top-level reusable research production line.");
			expect(snapshot.prompt).toContain("Worker. Goal-driven exploration worker for unfamiliar targets.");
			expect(snapshot.skills).toContainEqual(
				expect.objectContaining({
					name: "research-playbook",
					artifactKind: "playbook",
				}),
			);

			const playbook = await loadWorkspaceArtifactByName({
				workspaceDir,
				name: "research-playbook",
			});
		expect(playbook?.artifactKind).toBe("playbook");
		if (!playbook || playbook.artifactKind !== "playbook") {
			throw new Error("Expected playbook artifact");
		}
			expect(playbook.stages).toHaveLength(4);
			expect(playbook.stages[0]).toMatchObject({
				kind: "skill",
				refName: "collect-target-context",
				inputs: ["targetName", "artifactsRootDir"],
				outputs: ["context.md"],
				retryPolicy: "retry_once",
			});
			expect(playbook.stages[1]).toMatchObject({
				kind: "worker",
				refName: "explore-target",
				retryPolicy: "pause_for_human",
			});
			expect(playbook.stages[3]).toMatchObject({
				kind: "approval",
				approvalGate: "legal_review",
			});
		});

	it("creates a generic playbook run skeleton from a hand-authored playbook", async () => {
		process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR = path.join(os.tmpdir(), "__understudy-no-bundled-skills__");
		const workspaceDir = await makeTempDir("understudy-playbook-run-");
		await writeArtifact(
			workspaceDir,
			"review-playbook",
			[
				"---",
				"name: review-playbook",
				'description: "Generic staged review playbook."',
				"metadata:",
				"  understudy:",
				'    artifactKind: "playbook"',
				"---",
				"",
				"# review-playbook",
				"",
				"## Goal",
				"",
				"Review an unfamiliar product using a reusable staged pipeline.",
				"",
				"## Stage Plan",
				"",
				"1. [skill] collect-context -> Collect baseline context | inputs: targetName | outputs: context.md",
				"2. [worker] explore-target -> Explore the target deeply | inputs: targetName, artifactsRootDir | outputs: findings.md, highlights.json",
				"3. [approval] approve-output -> Wait for approval | outputs: approval.state | approval: publish_preview",
				"",
				"## Output Contract",
				"",
				"- artifacts/final.md",
				"",
				"## Approval Gates",
				"",
				"- Human review before final output",
				"",
				"## Failure Policy",
				"",
				"- Pause on blocking uncertainty",
				"",
			].join("\n"),
		);

		const result = await createPlaybookRunFromPlaybook({
			workspaceDir,
			playbookName: "review-playbook",
			runId: "run_playbook",
			now: Date.UTC(2026, 2, 19, 4, 30, 0),
			inputs: {
				targetName: "Arc Search",
			},
		});

		expect(result.playbook.filePath).toBe(resolveWorkspaceArtifactPath(workspaceDir, "review-playbook"));
		expect(result.run).toMatchObject({
			id: "run_playbook",
			playbookName: "review-playbook",
			status: "running",
			inputs: {
				targetName: "Arc Search",
			},
			approval: {
				required: true,
				state: "pending",
			},
		});
		expect(result.run.stages).toHaveLength(3);
		expect(result.run.stages?.map((stage) => stage.kind)).toEqual(["skill", "worker", "approval"]);
		expect(result.run.stages?.every((stage) => stage.status === "pending")).toBe(true);
		expect(result.run.notesSummary).toBe("Review an unfamiliar product using a reusable staged pipeline.");
	});
});
