import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let runSkillsCommand: typeof import("./skills.js").runSkillsCommand;

const cleanupPaths: string[] = [];
const originalCwd = process.cwd();
const originalHome = process.env.HOME;
const originalUnderstudyHome = process.env.UNDERSTUDY_HOME;
const originalBundledSkillsDir = process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR;

function createTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	cleanupPaths.push(dir);
	return dir;
}

function writeSkill(skillsDir: string, name: string, body: string): string {
	const skillDir = join(skillsDir, name);
	mkdirSync(skillDir, { recursive: true });
	const skillPath = join(skillDir, "SKILL.md");
	const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? name;
	writeFileSync(
		skillPath,
		[
			"---",
			`name: ${name}`,
			`description: "${title}"`,
			"---",
			"",
			body,
		].join("\n"),
		"utf8",
	);
	return skillPath;
}

beforeAll(async () => {
	({ runSkillsCommand } = await import("./skills.js"));
});

afterEach(() => {
	process.chdir(originalCwd);
	if (originalHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = originalHome;
	}
	if (originalUnderstudyHome === undefined) {
		delete process.env.UNDERSTUDY_HOME;
	} else {
		process.env.UNDERSTUDY_HOME = originalUnderstudyHome;
	}
	if (originalBundledSkillsDir === undefined) {
		delete process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR;
	} else {
		process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR = originalBundledSkillsDir;
	}
	while (cleanupPaths.length > 0) {
		const target = cleanupPaths.pop();
		if (!target) {
			continue;
		}
		rmSync(target, { recursive: true, force: true });
	}
	process.exitCode = 0;
});

describe("runSkillsCommand", () => {
	it("lists skills from an explicit directory", async () => {
		const skillsDir = createTempDir("understudy-cli-skills-dir-");
		writeSkill(
			skillsDir,
			"demo-skill",
			"# Demo Skill\n\ntrigger: demo\n",
		);

		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		await runSkillsCommand({ dir: skillsDir });
		const output = log.mock.calls.flat().join("\n");
		log.mockRestore();

		expect(output).toContain("demo-skill");
		expect(output).toContain("Demo Skill");
	});

	it("inspects a specific skill", async () => {
		const skillsDir = createTempDir("understudy-cli-skills-dir-");
		const skillPath = writeSkill(
			skillsDir,
			"publish-dashboard",
			"# Publish Dashboard\n\ntrigger: publish, dashboard\n",
		);

		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		await runSkillsCommand({ dir: skillsDir, inspect: "publish-dashboard" });
		const output = log.mock.calls.flat().join("\n");
		log.mockRestore();

		expect(output).toContain("Skill: publish-dashboard");
		expect(output).toContain(`Path:  ${skillPath}`);
		expect(output).toContain("Triggers: publish, dashboard");
	});

	it("uses runtime skill precedence and configured extra skill directories", async () => {
		const workspaceDir = createTempDir("understudy-cli-workspace-");
		const homeDir = createTempDir("understudy-cli-home-");
		const extraDir = createTempDir("understudy-cli-extra-");
		const configPath = join(workspaceDir, "understudy.config.json5");

		process.chdir(workspaceDir);
		process.env.HOME = homeDir;
		process.env.UNDERSTUDY_HOME = join(homeDir, ".understudy");
		process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR = join(homeDir, "__no_bundled_skills__");

		writeSkill(
			join(workspaceDir, "skills"),
			"shared-skill",
			"# Workspace Skill\n\ntrigger: local\n",
		);
		writeSkill(
			extraDir,
			"shared-skill",
			"# Extra Skill\n\ntrigger: external\n",
		);
		writeSkill(
			extraDir,
			"extra-only",
			"# Extra Only\n\ntrigger: external-only\n",
		);
		writeFileSync(
			configPath,
			JSON.stringify({
				defaultProvider: "anthropic",
				defaultModel: "claude-sonnet-4-6",
				defaultThinkingLevel: "off",
				agent: {
					skillDirs: [extraDir],
				},
				channels: {},
				tools: {
					policies: [],
					autoApproveReadOnly: true,
				},
				memory: {
					enabled: false,
				},
			}),
			"utf8",
		);

		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		await runSkillsCommand({ config: configPath });
		const output = log.mock.calls.flat().join("\n");
		log.mockRestore();

		expect(output).toContain("shared-skill");
		expect(output).toContain("extra-only");
		expect(output).toContain("[workspace]");
		expect(output).toContain("[extra]");
		expect(output).toContain("Workspace Skill");
		expect(output).not.toContain("Extra Skill [workspace]");
	});
});
