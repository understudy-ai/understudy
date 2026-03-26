import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWorkspaceSkillSnapshot } from "../skills/workspace.js";

async function writeSkill(
	rootDir: string,
	folder: string,
	name: string,
	description: string,
	extraFrontmatterLines: string[] = [],
) {
	const skillDir = path.join(rootDir, folder);
	await fs.mkdir(skillDir, { recursive: true });
	const content = [
		"---",
		`name: ${name}`,
		`description: "${description}"`,
		...extraFrontmatterLines,
		"---",
		"",
		`# ${name}`,
		"",
		"skill body",
		"",
	].join("\n");
	await fs.writeFile(path.join(skillDir, "SKILL.md"), content, "utf-8");
}

function baseConfig() {
	return {
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-6",
		defaultThinkingLevel: "off" as const,
		agent: {},
		channels: {},
		tools: {
			policies: [],
			autoApproveReadOnly: true,
		},
		memory: {
			enabled: false,
		},
	};
}

const tempDirs: string[] = [];
const originalBundledSkillsDir = process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR;

async function makeTempDir(prefix: string): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
	if (originalBundledSkillsDir === undefined) {
		delete process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR;
	} else {
		process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR = originalBundledSkillsDir;
	}
});

describe("buildWorkspaceSkillSnapshot", () => {
	it("applies source precedence with workspace skills winning", async () => {
		process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR = path.join(os.tmpdir(), "__understudy-no-bundled-skills__");
		const workspace = await makeTempDir("understudy-skills-workspace-");
		const extra = await makeTempDir("understudy-skills-extra-");
		const managed = await makeTempDir("understudy-skills-managed-");
		const personal = await makeTempDir("understudy-skills-personal-");
		const projectAgents = path.join(workspace, ".agents", "skills");
		const workspaceSkills = path.join(workspace, "skills");

		await writeSkill(extra, "shared", "shared", "extra version");
		await writeSkill(managed, "shared", "shared", "managed version");
		await writeSkill(personal, "shared", "shared", "personal version");
		await writeSkill(projectAgents, "shared", "shared", "project agents version");
		await writeSkill(workspaceSkills, "shared", "shared", "workspace version");
		await writeSkill(workspaceSkills, "local-only", "local-only", "workspace only skill");

		const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(path.dirname(managed));
		// Prepare expected homedir-backed roots:
		// managed: <home>/.understudy/skills
		// personal: <home>/.agents/skills
		await fs.mkdir(path.join(path.dirname(managed), ".understudy"), { recursive: true });
		await fs.rm(path.join(path.dirname(managed), ".understudy", "skills"), { recursive: true, force: true });
		await fs.cp(managed, path.join(path.dirname(managed), ".understudy", "skills"), { recursive: true });
		await fs.rm(path.join(path.dirname(managed), ".agents", "skills"), { recursive: true, force: true });
		await fs.mkdir(path.join(path.dirname(managed), ".agents"), { recursive: true });
		await fs.cp(personal, path.join(path.dirname(managed), ".agents", "skills"), { recursive: true });

		const snapshot = buildWorkspaceSkillSnapshot({
			workspaceDir: workspace,
			config: {
				...baseConfig(),
				agent: {
					skillDirs: [extra],
				},
			},
		});

		homedirSpy.mockRestore();

		const shared = snapshot.resolvedSkills.find((s) => s.name === "shared");
		expect(shared).toBeDefined();
		expect(shared?.description).toBe("workspace version");
		expect(snapshot.resolvedSkills.some((s) => s.name === "local-only")).toBe(true);
		expect(snapshot.prompt).toContain("<available_skills>");
		expect(snapshot.truncated).toBe(false);
	});

	it("truncates prompt by maxSkillsInPrompt limit", async () => {
		process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR = path.join(os.tmpdir(), "__understudy-no-bundled-skills__");
		const workspace = await makeTempDir("understudy-skills-limit-");
		const workspaceSkills = path.join(workspace, "skills");
		await writeSkill(workspaceSkills, "skill-a", "skill-a", "A");
		await writeSkill(workspaceSkills, "skill-b", "skill-b", "B");

		const snapshot = buildWorkspaceSkillSnapshot({
			workspaceDir: workspace,
			config: {
				...baseConfig(),
				skills: {
					limits: {
						maxSkillsInPrompt: 1,
					},
				} as any,
			} as any,
		});

		expect(snapshot.resolvedSkills.length).toBeGreaterThanOrEqual(2);
		expect(snapshot.prompt).toContain("⚠️ Skills truncated");
		expect(snapshot.truncated).toBe(true);
	});

	it("filters skills by entries.enabled and runtime metadata requires/env", async () => {
		process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR = path.join(os.tmpdir(), "__understudy-no-bundled-skills__");
		const workspace = await makeTempDir("understudy-skills-gating-");
		const workspaceSkills = path.join(workspace, "skills");

		await writeSkill(workspaceSkills, "enabled-skill", "enabled-skill", "kept");
		await writeSkill(workspaceSkills, "disabled-skill", "disabled-skill", "blocked by config");
		await writeSkill(
			workspaceSkills,
			"env-required-understudy",
			"env-required-understudy",
			"requires env via understudy metadata",
			['metadata: { "understudy": { "requires": { "env": ["UNDERSTUDY_TEST_SKILL_ENV"] } } }'],
		);
		await writeSkill(
			workspaceSkills,
			"missing-bin",
			"missing-bin",
			"requires missing bin",
			['metadata: { "understudy": { "requires": { "bins": ["__definitely_missing_bin__"] } } }'],
		);

		delete process.env.UNDERSTUDY_TEST_SKILL_ENV;
		let snapshot = buildWorkspaceSkillSnapshot({
			workspaceDir: workspace,
			config: {
				...baseConfig(),
				skills: {
					entries: {
						"disabled-skill": { enabled: false },
					},
				},
			} as any,
		});

		expect(snapshot.resolvedSkills.some((skill) => skill.name === "enabled-skill")).toBe(true);
		expect(snapshot.resolvedSkills.some((skill) => skill.name === "disabled-skill")).toBe(false);
		expect(snapshot.resolvedSkills.some((skill) => skill.name === "env-required-understudy")).toBe(false);
		expect(snapshot.resolvedSkills.some((skill) => skill.name === "missing-bin")).toBe(false);

		process.env.UNDERSTUDY_TEST_SKILL_ENV = "ok";
		snapshot = buildWorkspaceSkillSnapshot({
			workspaceDir: workspace,
			config: {
				...baseConfig(),
				skills: {
					entries: {
						"disabled-skill": { enabled: false },
					},
				},
			} as any,
		});

		expect(snapshot.resolvedSkills.some((skill) => skill.name === "env-required-understudy")).toBe(true);
	});

	it("reads canonical Understudy skill metadata and allowed tool names", async () => {
		process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR = path.join(os.tmpdir(), "__understudy-no-bundled-skills__");
		const workspace = await makeTempDir("understudy-skills-understudy-metadata-");
		const workspaceSkills = path.join(workspace, "skills");

		await writeSkill(
			workspaceSkills,
			"understudy-native",
			"understudy-native",
			"native skill",
			[
				'metadata: { "understudy": { "skillKey": "native-key", "primaryEnv": "UNDERSTUDY_TEST_NATIVE_SKILL_ENV", "requires": { "env": ["UNDERSTUDY_TEST_NATIVE_SKILL_ENV"] }, "install": [{ "id": "python-brew", "kind": "brew", "bins": ["python3"] }] } }',
				'allowed-tools: ["message_send", "schedule"]',
			],
		);

		delete process.env.UNDERSTUDY_TEST_NATIVE_SKILL_ENV;
		let snapshot = buildWorkspaceSkillSnapshot({
			workspaceDir: workspace,
			config: {
				...baseConfig(),
			} as any,
		});
		expect(snapshot.resolvedSkills.some((skill) => skill.name === "understudy-native")).toBe(false);

		snapshot = buildWorkspaceSkillSnapshot({
			workspaceDir: workspace,
			config: {
				...baseConfig(),
				skills: {
					entries: {
						"native-key": {
							apiKey: "test-api-key",
						},
					},
				},
			} as any,
		});
		const skill = snapshot.resolvedSkills.find((entry) => entry.name === "understudy-native");
		const summary = snapshot.skills.find((entry) => entry.name === "understudy-native");

		expect(skill).toBeDefined();
		expect(skill?.skillKey).toBe("native-key");
		expect(skill?.primaryEnv).toBe("UNDERSTUDY_TEST_NATIVE_SKILL_ENV");
		expect(skill?.allowedToolNames).toEqual(
			expect.arrayContaining(["message_send", "schedule"]),
		);
		expect(summary).toMatchObject({
			name: "understudy-native",
			skillKey: "native-key",
			primaryEnv: "UNDERSTUDY_TEST_NATIVE_SKILL_ENV",
			requiredEnv: ["UNDERSTUDY_TEST_NATIVE_SKILL_ENV"],
			installCount: 1,
		});
		expect(summary?.allowedToolNames).toEqual(
			expect.arrayContaining(["message_send", "schedule"]),
		);
	});

	it("surfaces trigger cues in the prompt for skills that declare them", async () => {
		process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR = path.join(os.tmpdir(), "__understudy-no-bundled-skills__");
		const workspace = await makeTempDir("understudy-skills-triggers-");
		const workspaceSkills = path.join(workspace, "skills");

		await writeSkill(
			workspaceSkills,
			"tencent-login",
			"tencent-login",
			"Tencent Meeting verification-code login with a supplied phone number",
			[
				"triggers:",
				'  - "腾讯会议 验证码登录"',
				'  - "做腾讯会议那个skill"',
			],
		);

		const snapshot = buildWorkspaceSkillSnapshot({
			workspaceDir: workspace,
			config: {
				...baseConfig(),
			} as any,
		});
		const skill = snapshot.resolvedSkills.find((entry) => entry.name === "tencent-login");

		expect(skill?.triggers).toEqual([
			"腾讯会议 验证码登录",
			"做腾讯会议那个skill",
		]);
		expect(snapshot.prompt).toContain("Trigger cues: 腾讯会议 验证码登录 | 做腾讯会议那个skill.");
	});

});
