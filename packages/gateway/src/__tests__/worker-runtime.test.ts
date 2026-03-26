import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlaybookRun, updatePlaybookRun } from "@understudy/core";
import { launchWorkerStage } from "../worker-runtime.js";

const tempDirs: string[] = [];
const originalBundledSkillsDir = process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR;

async function makeTempDir(prefix: string): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

async function writeWorkerArtifact(workspaceDir: string, name: string): Promise<void> {
	const skillDir = path.join(workspaceDir, "skills", name);
	await fs.mkdir(skillDir, { recursive: true });
	await fs.writeFile(
		path.join(skillDir, "SKILL.md"),
		[
			"---",
			`name: ${name}`,
			'description: "Goal-driven exploration worker."',
			"metadata:",
			"  understudy:",
			'    artifactKind: "worker"',
			"---",
			"",
			`# ${name}`,
			"",
			"## Goal",
			"",
			"Explore an unfamiliar target and return structured evidence.",
			"",
			"## Operating Contract",
			"",
			"- Scope: Capture enough evidence for a concise dossier.",
			"- Allowed routes: gui, browser",
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
			"- The assigned product surface",
			"",
			"## Stop Conditions",
			"",
			"- Enough evidence exists for highlights and limitations.",
			"",
			"## Decision Heuristics",
			"",
			"- Prefer evidence-producing actions over exhaustive traversal.",
			"",
			"## Failure Policy",
			"",
			"- A required account gate blocks progress.",
			"",
		].join("\n"),
		"utf8",
	);
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map(async (dir) => await fs.rm(dir, { recursive: true, force: true })));
	if (originalBundledSkillsDir === undefined) {
		delete process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR;
	} else {
		process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR = originalBundledSkillsDir;
	}
});

describe("launchWorkerStage", () => {
	it("builds a generic worker prompt, spawns a child session, and updates the playbook run", async () => {
		process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR = path.join(os.tmpdir(), "__understudy-no-bundled-skills__");
		const workspaceDir = await makeTempDir("understudy-worker-runtime-");
		await writeWorkerArtifact(workspaceDir, "explore-target");
		await createPlaybookRun({
			workspaceDir,
			playbookName: "review-playbook",
			runId: "run_worker",
			inputs: {
				targetName: "Arc Search",
			},
			now: Date.UTC(2026, 2, 19, 5, 0, 0),
		});
		await updatePlaybookRun({
			workspaceDir,
			runId: "run_worker",
			now: Date.UTC(2026, 2, 19, 5, 1, 0),
			patch: {
				status: "running",
				stages: [
					{ id: "collect-context", name: "Collect context", kind: "skill", status: "completed" },
					{ id: "explore-target", name: "Explore target", kind: "worker", status: "pending" },
					{ id: "approve-output", name: "Approve output", kind: "approval", status: "pending" },
				],
			},
		});
		const spawnSubagent = vi.fn(async () => ({
			childSessionId: "parent-1:subagent:worker",
			status: "in_flight",
			mode: "session",
			runtime: "subagent",
		}));

		const launched = await launchWorkerStage({
			workspaceDir,
			runId: "run_worker",
			workerName: "explore-target",
			parentSessionId: "parent-1",
			stageId: "explore-target",
			label: "explore-target",
			contextNotes: ["This worker belongs to a reusable review playbook."],
			spawnSubagent,
		});

		expect(launched.worker.artifactKind).toBe("worker");
		expect(launched.prompt).toContain("You are the Worker artifact `explore-target`.");
		expect(launched.prompt).toContain("targetName=Arc Search");
		expect(launched.prompt).toContain("playbookName=review-playbook");
		expect(launched.prompt).toContain("Operating contract:");
		expect(launched.prompt).toContain("- Scope: Capture enough evidence for a concise dossier.");
		expect(spawnSubagent).toHaveBeenCalledWith(
			expect.objectContaining({
				parentSessionId: "parent-1",
				runtime: "subagent",
				mode: "session",
				cleanup: "keep",
				thread: true,
				label: "explore-target",
			}),
		);
		expect(launched.run.status).toBe("running");
		expect(launched.run.childSessions).toContainEqual(
			expect.objectContaining({
				sessionId: "parent-1:subagent:worker",
				label: "explore-target",
				stageId: "explore-target",
				runtime: "subagent",
			}),
		);
		expect(launched.run.budgets?.worker).toMatchObject({
			maxMinutes: 12,
			maxActions: 60,
		});
		expect(launched.run.stages?.find((stage) => stage.id === "explore-target")?.status).toBe("running");
	});
});
