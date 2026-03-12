import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	formatSkillsForPrompt,
	loadSkillsFromDir,
	type Skill,
} from "@mariozechner/pi-coding-agent";
import type { UnderstudyConfig } from "@understudy/types";
import { resolveUnderstudyHomeDir } from "../runtime-paths.js";
import { shouldIncludeSkill } from "./eligibility.js";
import {
	hydrateSkillFromFrontmatter,
	readSkillFrontmatterInfo,
	type UnderstudySkill,
} from "./frontmatter.js";

export interface SkillSnapshot {
	prompt: string;
	resolvedSkills: UnderstudySkill[];
	skills: Array<{
		name: string;
		skillKey?: string;
		primaryEnv?: string;
		requiredEnv?: string[];
		allowedToolNames?: string[];
		installCount?: number;
		disableModelInvocation?: boolean;
	}>;
	truncated: boolean;
}

interface SkillSource {
	dir: string;
	source: string;
}

function looksLikeSkillsDir(dir: string): boolean {
	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			if (entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, "SKILL.md"))) {
				return true;
			}
		}
	} catch {
		return false;
	}
	return false;
}

export function resolveBundledSkillsDir(): string | undefined {
	const override = process.env.UNDERSTUDY_BUNDLED_SKILLS_DIR?.trim();
	if (override) {
		return override;
	}

	try {
		let current = path.dirname(fileURLToPath(import.meta.url));
		for (let depth = 0; depth < 8; depth += 1) {
			const candidate = path.join(current, "skills");
			if (looksLikeSkillsDir(candidate)) {
				return candidate;
			}
			const next = path.dirname(current);
			if (next === current) {
				break;
			}
			current = next;
		}
	} catch {
		// ignore
	}

	return undefined;
}

interface SkillsLimits {
	maxSkillsLoadedPerSource: number;
	maxSkillsInPrompt: number;
	maxSkillsPromptChars: number;
	maxCandidatesPerRoot: number;
	maxSkillFileBytes: number;
}

const DEFAULT_LIMITS: SkillsLimits = {
	maxSkillsLoadedPerSource: 200,
	maxSkillsInPrompt: 150,
	maxSkillsPromptChars: 30_000,
	maxCandidatesPerRoot: 300,
	maxSkillFileBytes: 256_000,
};

function compactSkillPaths(skills: UnderstudySkill[]): UnderstudySkill[] {
	const home = os.homedir();
	if (!home) return skills;
	const prefix = home.endsWith(path.sep) ? home : `${home}${path.sep}`;
	return skills.map((skill) => ({
		...skill,
		filePath: skill.filePath.startsWith(prefix)
			? `~/${skill.filePath.slice(prefix.length)}`
			: skill.filePath,
	}));
}

function buildPromptSkillDescription(skill: UnderstudySkill): string {
	const base = skill.description.trim();
	const triggers = Array.from(
		new Set((skill.triggers ?? []).map((entry) => entry.trim()).filter(Boolean)),
	).slice(0, 4);
	if (triggers.length === 0) {
		return base;
	}
	const suffix = ` Trigger cues: ${triggers.join(" | ")}.`;
	if (!base) {
		return suffix.trim();
	}
	return `${base}${/[.!?]$/.test(base) ? "" : "."}${suffix}`;
}

function decorateSkillsForPrompt(skills: UnderstudySkill[]): UnderstudySkill[] {
	return skills.map((skill) => ({
		...skill,
		description: buildPromptSkillDescription(skill),
	}));
}

function resolveNestedSkillsRoot(
	rootDir: string,
	maxCandidates: number,
): string {
	const nested = path.join(rootDir, "skills");
	try {
		if (!fs.existsSync(nested) || !fs.statSync(nested).isDirectory()) {
			return rootDir;
		}
	} catch {
		return rootDir;
	}

	try {
		const entries = fs.readdirSync(nested, { withFileTypes: true })
			.filter((e) => !e.name.startsWith("."))
			.slice(0, Math.max(0, maxCandidates));
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const skillMd = path.join(nested, entry.name, "SKILL.md");
			if (fs.existsSync(skillMd)) {
				return nested;
			}
		}
	} catch {
		return rootDir;
	}

	return rootDir;
}

function loadSkillsFromSource(
	params: SkillSource,
	limits: SkillsLimits,
): Skill[] {
	const resolvedDir = resolveNestedSkillsRoot(
		path.resolve(params.dir),
		limits.maxCandidatesPerRoot,
	);
	if (!fs.existsSync(resolvedDir)) return [];

	const loaded = loadSkillsFromDir({
		dir: resolvedDir,
		source: params.source,
	});

	// Enforce oversized SKILL.md exclusion and source-level limit.
	const filtered = loaded.skills.filter((skill) => {
		try {
			const size = fs.statSync(skill.filePath).size;
			return size <= limits.maxSkillFileBytes;
		} catch {
			return false;
		}
	});

	return filtered.slice(0, limits.maxSkillsLoadedPerSource);
}

function mergeSkillsWithPrecedence(sourcesInOrder: Skill[][]): Skill[] {
	const merged = new Map<string, Skill>();
	for (const sourceSkills of sourcesInOrder) {
		for (const skill of sourceSkills) {
			merged.set(skill.name, skill);
		}
	}
	return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function buildSkillsPrompt(
	skills: UnderstudySkill[],
	limits: SkillsLimits,
): { prompt: string; visibleSkills: UnderstudySkill[]; truncated: boolean } {
	const modelInvokable = skills.filter((s) => !s.disableModelInvocation);
	const cappedByCount = modelInvokable.slice(0, limits.maxSkillsInPrompt);
	let visibleSkills = cappedByCount;
	let truncated = modelInvokable.length > cappedByCount.length;
	let promptSkills = decorateSkillsForPrompt(visibleSkills);

	// Reduce by prompt character budget if needed.
	let block = formatSkillsForPrompt(compactSkillPaths(promptSkills));
	if (block.length > limits.maxSkillsPromptChars) {
		let low = 0;
		let high = visibleSkills.length;
		while (low < high) {
			const mid = Math.floor((low + high + 1) / 2);
			const candidate = visibleSkills.slice(0, mid);
			const candidateBlock = formatSkillsForPrompt(compactSkillPaths(decorateSkillsForPrompt(candidate)));
			if (candidateBlock.length <= limits.maxSkillsPromptChars) {
				low = mid;
			} else {
				high = mid - 1;
			}
		}
		visibleSkills = visibleSkills.slice(0, low);
		promptSkills = decorateSkillsForPrompt(visibleSkills);
		block = formatSkillsForPrompt(compactSkillPaths(promptSkills));
		truncated = true;
	}

	const truncationNote = truncated
		? `⚠️ Skills truncated: included ${visibleSkills.length} of ${modelInvokable.length}.`
		: "";

	return {
		prompt: [truncationNote, block].filter(Boolean).join("\n"),
		visibleSkills,
		truncated,
	};
}

function resolveSkillSources(
	workspaceDir: string,
	config?: UnderstudyConfig,
): SkillSource[] {
	const extraDirs = (config?.agent?.skillDirs ?? [])
		.map((d) => d.trim())
		.filter(Boolean)
		.map((d) => ({
			dir: path.isAbsolute(d) ? d : path.resolve(workspaceDir, d),
			source: "understudy-extra",
		}));

	const managedDir = path.join(resolveUnderstudyHomeDir(), "skills");
	const personalAgents = path.join(os.homedir(), ".agents", "skills");
	const projectAgents = path.resolve(workspaceDir, ".agents", "skills");
	const workspaceSkills = path.resolve(workspaceDir, "skills");
	const bundledDir = resolveBundledSkillsDir();

	return [
		...(bundledDir ? [{ dir: bundledDir, source: "understudy-bundled" }] : []),
		...extraDirs,
		{ dir: managedDir, source: "understudy-managed" },
		{ dir: personalAgents, source: "agents-skills-personal" },
		{ dir: projectAgents, source: "agents-skills-project" },
		{ dir: workspaceSkills, source: "understudy-workspace" },
	];
}

function resolveLimits(config?: UnderstudyConfig): SkillsLimits {
	const raw = config?.skills?.limits ?? {};
	const pick = (value: number | undefined, fallback: number): number =>
		typeof value === "number" && Number.isFinite(value) && value > 0
			? Math.floor(value)
			: fallback;
	return {
		maxSkillsLoadedPerSource: pick(
			raw.maxSkillsLoadedPerSource,
			DEFAULT_LIMITS.maxSkillsLoadedPerSource,
		),
		maxSkillsInPrompt: pick(raw.maxSkillsInPrompt, DEFAULT_LIMITS.maxSkillsInPrompt),
		maxSkillsPromptChars: pick(
			raw.maxSkillsPromptChars,
			DEFAULT_LIMITS.maxSkillsPromptChars,
		),
		maxCandidatesPerRoot: pick(
			raw.maxCandidatesPerRoot,
			DEFAULT_LIMITS.maxCandidatesPerRoot,
		),
		maxSkillFileBytes: pick(raw.maxSkillFileBytes, DEFAULT_LIMITS.maxSkillFileBytes),
	};
}

export function buildWorkspaceSkillSnapshot(params: {
	workspaceDir: string;
	config?: UnderstudyConfig;
}): SkillSnapshot {
	const limits = resolveLimits(params.config);
	const sources = resolveSkillSources(params.workspaceDir, params.config);
	const loadedBySource = sources.map((source) => loadSkillsFromSource(source, limits));
	const merged = mergeSkillsWithPrecedence(loadedBySource)
		.filter((skill) => shouldIncludeSkill(skill, params.config))
		.map((skill) => hydrateSkillFromFrontmatter(skill, readSkillFrontmatterInfo(skill.filePath)));
	const { prompt, truncated } = buildSkillsPrompt(merged, limits);

	return {
		prompt,
		resolvedSkills: merged,
		skills: merged.map((skill) => ({
			name: skill.name,
			...(skill.skillKey ? { skillKey: skill.skillKey } : {}),
			...(skill.primaryEnv ? { primaryEnv: skill.primaryEnv } : {}),
			...(skill.requiredEnv?.length ? { requiredEnv: skill.requiredEnv } : {}),
			...(skill.allowedToolNames?.length ? { allowedToolNames: skill.allowedToolNames } : {}),
			...(skill.install?.length ? { installCount: skill.install.length } : {}),
			...(skill.disableModelInvocation ? { disableModelInvocation: true } : {}),
		})),
		truncated,
	};
}
