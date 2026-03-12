/**
 * Skills command: list, inspect, install, and uninstall skills.
 */

import { existsSync, readdirSync, readFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { buildWorkspaceSkillSnapshot, ConfigManager, resolveBundledSkillsDir, resolveUnderstudyHomeDir } from "@understudy/core";

interface SkillsOptions {
	list?: boolean;
	inspect?: string;
	dir?: string;
	config?: string;
	install?: string;
	uninstall?: string;
}

interface SkillInfo {
	name: string;
	path: string;
	description?: string;
	triggers?: string[];
	source?: string;
}

function findSkills(skillsDir: string, source?: string): SkillInfo[] {
	if (!existsSync(skillsDir)) return [];

	const results: SkillInfo[] = [];
	try {
		const entries = readdirSync(skillsDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const skillMd = join(skillsDir, entry.name, "SKILL.md");
			if (!existsSync(skillMd)) continue;

			const content = readFileSync(skillMd, "utf-8");
			const descMatch = content.match(/^#\s+(.+)/m);
			const triggerMatch = content.match(/trigger[s]?:\s*(.+)/i);

			results.push({
				name: entry.name,
				path: skillMd,
				description: descMatch?.[1]?.trim(),
				triggers: triggerMatch?.[1]?.split(",").map((t) => t.trim()),
				source,
			});
		}
	} catch { /* ignore scan errors */ }
	return results;
}

function resolveSkillsSources(opts: SkillsOptions): Array<{ dir: string; source: string }> {
	if (opts.dir) {
		return [{ dir: opts.dir, source: "custom" }];
	}
	const workspaceSkillsDir = join(process.cwd(), "skills");
	const managedDir = join(resolveUnderstudyHomeDir(), "skills");
	const bundledDir = resolveBundledSkillsDir();
	const sources: Array<{ dir: string; source: string }> = [];
	if (existsSync(workspaceSkillsDir)) sources.push({ dir: workspaceSkillsDir, source: "workspace" });
	if (existsSync(managedDir)) sources.push({ dir: managedDir, source: "managed" });
	if (bundledDir) sources.push({ dir: bundledDir, source: "bundled" });
	return sources;
}

function dedupeSkills(skills: SkillInfo[]): SkillInfo[] {
	const merged = new Map<string, SkillInfo>();
	for (const skill of skills) {
		if (!merged.has(skill.name)) {
			merged.set(skill.name, skill);
		}
	}
	return Array.from(merged.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeSkillSource(source?: string): string | undefined {
	switch (source) {
		case "understudy-workspace":
			return "workspace";
		case "understudy-managed":
			return "managed";
		case "understudy-bundled":
			return "bundled";
		case "understudy-extra":
			return "extra";
		case "agents-skills-project":
			return "agents-project";
		case "agents-skills-personal":
			return "agents-personal";
		default:
			return source;
	}
}

async function resolveRuntimeSkills(opts: SkillsOptions): Promise<SkillInfo[]> {
	if (opts.dir) {
		return dedupeSkills(
			resolveSkillsSources(opts).flatMap(({ dir, source }) => findSkills(dir, source)),
		);
	}

	const configManager = await ConfigManager.load(opts.config);
	const snapshot = buildWorkspaceSkillSnapshot({
		workspaceDir: process.cwd(),
		config: configManager.get(),
	});

	return snapshot.resolvedSkills
		.map((skill) => ({
			name: skill.name,
			path: skill.filePath,
			description: skill.description,
			triggers: skill.triggers,
			source: normalizeSkillSource(skill.source),
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
}

function resolveManagedSkillsDir(): string {
	return join(resolveUnderstudyHomeDir(), "skills");
}

async function extractSkillArchive(archivePath: string, targetDir: string): Promise<string> {
	const { execSync } = await import("node:child_process");
	const absArchive = resolve(archivePath);

	// .skill files are ZIP archives
	const tmpDir = join(targetDir, ".tmp-extract-" + Date.now());
	mkdirSync(tmpDir, { recursive: true });
	try {
		execSync(`unzip -o -q "${absArchive}" -d "${tmpDir}"`, { stdio: "pipe" });

		// Find the skill directory (should have a SKILL.md)
		const entries = readdirSync(tmpDir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isDirectory()) {
				const skillMd = join(tmpDir, entry.name, "SKILL.md");
				if (existsSync(skillMd)) {
					const dest = join(targetDir, entry.name);
					if (existsSync(dest)) rmSync(dest, { recursive: true });
					cpSync(join(tmpDir, entry.name), dest, { recursive: true });
					rmSync(tmpDir, { recursive: true });
					return entry.name;
				}
			}
		}

		// Fallback: SKILL.md at root level of archive
		const rootSkillMd = join(tmpDir, "SKILL.md");
		if (existsSync(rootSkillMd)) {
			const name = basename(archivePath, ".skill").replace(/\.zip$/i, "");
			const dest = join(targetDir, name);
			if (existsSync(dest)) rmSync(dest, { recursive: true });
			cpSync(tmpDir, dest, { recursive: true });
			rmSync(tmpDir, { recursive: true });
			return name;
		}

		rmSync(tmpDir, { recursive: true });
		throw new Error("Archive does not contain a valid skill (no SKILL.md found)");
	} catch (error) {
		if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
		throw error;
	}
}

async function installFromLocalDir(sourcePath: string, targetDir: string): Promise<string> {
	const absSource = resolve(sourcePath);
	const skillMd = join(absSource, "SKILL.md");
	if (!existsSync(skillMd)) {
		throw new Error(`Not a valid skill directory: ${sourcePath} (no SKILL.md found)`);
	}
	const name = basename(absSource);
	const dest = join(targetDir, name);
	if (existsSync(dest)) rmSync(dest, { recursive: true });
	cpSync(absSource, dest, { recursive: true });
	return name;
}

async function installFromUrl(url: string, targetDir: string): Promise<string> {
	const { execSync } = await import("node:child_process");
	const tmpFile = join(targetDir, ".tmp-download-" + Date.now() + ".skill");
	mkdirSync(targetDir, { recursive: true });
	try {
		execSync(`curl -fsSL -o "${tmpFile}" "${url}"`, { stdio: "pipe" });
		const name = await extractSkillArchive(tmpFile, targetDir);
		if (existsSync(tmpFile)) rmSync(tmpFile);
		return name;
	} catch (error) {
		if (existsSync(tmpFile)) rmSync(tmpFile);
		throw error;
	}
}

async function installFromGit(url: string, targetDir: string): Promise<string> {
	const { execSync } = await import("node:child_process");
	const tmpDir = join(targetDir, ".tmp-git-" + Date.now());
	mkdirSync(targetDir, { recursive: true });
	try {
		execSync(`git clone --depth 1 "${url}" "${tmpDir}"`, { stdio: "pipe" });

		// Check if the repo root is a skill
		if (existsSync(join(tmpDir, "SKILL.md"))) {
			const repoName = basename(url, ".git").replace(/\.git$/i, "");
			const dest = join(targetDir, repoName);
			if (existsSync(dest)) rmSync(dest, { recursive: true });

			// Remove .git directory before copying
			if (existsSync(join(tmpDir, ".git"))) rmSync(join(tmpDir, ".git"), { recursive: true });
			cpSync(tmpDir, dest, { recursive: true });
			rmSync(tmpDir, { recursive: true });
			return repoName;
		}

		// Check if the repo contains skills/ subdirectories
		const skillsDir = join(tmpDir, "skills");
		if (existsSync(skillsDir)) {
			const entries = readdirSync(skillsDir, { withFileTypes: true });
			const installed: string[] = [];
			for (const entry of entries) {
				if (entry.isDirectory() && existsSync(join(skillsDir, entry.name, "SKILL.md"))) {
					const dest = join(targetDir, entry.name);
					if (existsSync(dest)) rmSync(dest, { recursive: true });
					cpSync(join(skillsDir, entry.name), dest, { recursive: true });
					installed.push(entry.name);
				}
			}
			rmSync(tmpDir, { recursive: true });
			if (installed.length > 0) return installed.join(", ");
		}

		rmSync(tmpDir, { recursive: true });
		throw new Error("Git repository does not contain a valid skill (no SKILL.md found)");
	} catch (error) {
		if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
		throw error;
	}
}

async function runInstall(source: string): Promise<void> {
	const managedDir = resolveManagedSkillsDir();
	mkdirSync(managedDir, { recursive: true });

	console.log(`Installing skill from: ${source}`);

	let installedName: string;

	if (source.endsWith(".skill") || source.endsWith(".zip")) {
		if (existsSync(source)) {
			// Local .skill file
			installedName = await extractSkillArchive(source, managedDir);
		} else if (source.startsWith("http://") || source.startsWith("https://")) {
			// Remote .skill file
			installedName = await installFromUrl(source, managedDir);
		} else {
			throw new Error(`File not found: ${source}`);
		}
	} else if (source.startsWith("http://") || source.startsWith("https://") || source.endsWith(".git")) {
		// Git URL
		installedName = await installFromGit(source, managedDir);
	} else if (existsSync(source) && existsSync(join(resolve(source), "SKILL.md"))) {
		// Local directory with SKILL.md
		installedName = await installFromLocalDir(source, managedDir);
	} else {
		throw new Error(
			`Cannot resolve skill source: ${source}\n` +
			"Supported formats:\n" +
			"  - Local .skill file:  understudy skills install ./my-skill.skill\n" +
			"  - Local directory:    understudy skills install ./skills/my-skill\n" +
			"  - URL (.skill file):  understudy skills install https://example.com/my-skill.skill\n" +
			"  - Git repository:     understudy skills install https://github.com/user/repo.git",
		);
	}

	console.log(`Installed: ${installedName}`);
	console.log(`Location: ${managedDir}/${installedName}`);
}

async function runUninstall(name: string): Promise<void> {
	const managedDir = resolveManagedSkillsDir();
	const skillDir = join(managedDir, name);

	if (!existsSync(skillDir)) {
		console.error(`Skill not found in managed directory: ${name}`);
		console.error(`Managed skills directory: ${managedDir}`);
		process.exitCode = 1;
		return;
	}

	const skillMd = join(skillDir, "SKILL.md");
	if (!existsSync(skillMd)) {
		console.error(`Directory exists but is not a valid skill (no SKILL.md): ${skillDir}`);
		process.exitCode = 1;
		return;
	}

	rmSync(skillDir, { recursive: true });
	console.log(`Uninstalled: ${name}`);
}

export async function runSkillsCommand(opts: SkillsOptions = {}): Promise<void> {
	if (opts.install) {
		try {
			await runInstall(opts.install);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`Install failed: ${message}`);
			process.exitCode = 1;
		}
		return;
	}

	if (opts.uninstall) {
		await runUninstall(opts.uninstall);
		return;
	}

	const skills = await resolveRuntimeSkills(opts);

	if (opts.inspect) {
		const skill = skills.find((s) => s.name === opts.inspect);
		if (!skill) {
			console.error(`Skill not found: ${opts.inspect}`);
			process.exitCode = 1;
			return;
		}
		console.log(`Skill: ${skill.name}`);
		console.log(`Path:  ${skill.path}`);
		if (skill.source) console.log(`Source: ${skill.source}`);
		if (skill.description) console.log(`Desc:  ${skill.description}`);
		if (skill.triggers) console.log(`Triggers: ${skill.triggers.join(", ")}`);
		console.log("\nContent:");
		console.log(readFileSync(skill.path, "utf-8").slice(0, 2000));
		return;
	}

	// Default: list
	if (skills.length === 0) {
		console.log("No skills found.");
		return;
	}

	console.log(`Skills (${skills.length}):`);
	for (const skill of skills) {
		const desc = skill.description ? ` — ${skill.description}` : "";
		const src = skill.source ? ` [${skill.source}]` : "";
		console.log(`  ${skill.name}${desc}${src}`);
	}
}
