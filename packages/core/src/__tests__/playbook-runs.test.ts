import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createPlaybookRun,
	listPlaybookRuns,
	loadPlaybookRun,
	resolvePlaybookRunPath,
	updatePlaybookRun,
} from "../playbook-runs.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map(async (dir) => await fs.rm(dir, { recursive: true, force: true })));
});

describe("playbook runs", () => {
	it("creates, updates, reloads, and lists generic playbook runs", async () => {
		const workspaceDir = await makeTempDir("understudy-playbook-runs-");
		const created = await createPlaybookRun({
			workspaceDir,
			playbookName: "demo-playbook",
			runId: "run_demo",
			inputs: {
				appName: "Arc Search",
				reviewAngle: "First-run productivity",
			},
			now: Date.UTC(2026, 2, 19, 8, 0, 0),
		});
		expect(created.status).toBe("queued");
		expect(created.inputs).toMatchObject({
			appName: "Arc Search",
		});
		await expect(fs.stat(resolvePlaybookRunPath(workspaceDir, "run_demo"))).resolves.toBeDefined();

		const updated = await updatePlaybookRun({
			workspaceDir,
			runId: "run_demo",
			now: Date.UTC(2026, 2, 19, 8, 5, 0),
			patch: {
				status: "running",
				notesSummary: "Running the taught playbook against a fresh target.",
				stages: [
					{ id: "collect", name: "Collect", kind: "skill", status: "completed" },
					{ id: "explore", name: "Explore", kind: "worker", status: "running" },
				],
				childSessions: [
					{ label: "explorer", sessionId: "child-1", status: "in_flight", stageId: "explore", runtime: "subagent" },
				],
				budgets: {
					worker: {
						maxMinutes: 15,
						maxActions: 80,
					},
				},
			},
		});
		expect(updated.status).toBe("running");
		expect(updated.stages?.map((stage) => stage.kind)).toEqual(["skill", "worker"]);
		expect(updated.childSessions[0]?.sessionId).toBe("child-1");
		expect(updated.budgets?.worker?.maxMinutes).toBe(15);

		const reloaded = await loadPlaybookRun(workspaceDir, "run_demo");
		expect(reloaded?.notesSummary).toContain("fresh target");

		const listed = await listPlaybookRuns(workspaceDir);
		expect(listed).toHaveLength(1);
		expect(listed[0]?.id).toBe("run_demo");
	});
});
