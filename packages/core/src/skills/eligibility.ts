import fs from "node:fs";
import path from "node:path";
import type { Skill } from "@mariozechner/pi-coding-agent";
import type { UnderstudyConfig, SkillEntryConfig } from "@understudy/types";
import {
	readSkillFrontmatterInfo,
	resolveSkillConfigKeys,
	type SkillRuntimeMetadata,
	type SkillRuntimeRequires,
	type UnderstudySkill,
} from "./frontmatter.js";

function isTruthy(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value !== 0;
	if (typeof value === "string") return value.trim().length > 0;
	return true;
}

function resolveConfigPath(config: unknown, pathStr: string): unknown {
	const parts = pathStr.split(".").filter(Boolean);
	let current: unknown = config;
	for (const part of parts) {
		if (!current || typeof current !== "object") {
			return undefined;
		}
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

let cachedPathEnv: string | undefined;
const hasBinaryCache = new Map<string, boolean>();

function hasBinary(bin: string): boolean {
	const pathEnv = process.env.PATH ?? "";
	if (cachedPathEnv !== pathEnv) {
		cachedPathEnv = pathEnv;
		hasBinaryCache.clear();
	}
	if (hasBinaryCache.has(bin)) {
		return hasBinaryCache.get(bin) ?? false;
	}
	const paths = pathEnv.split(path.delimiter).filter(Boolean);
	for (const part of paths) {
		const candidate = path.join(part, bin);
		try {
			fs.accessSync(candidate, fs.constants.X_OK);
			hasBinaryCache.set(bin, true);
			return true;
		} catch {
			continue;
		}
	}
	hasBinaryCache.set(bin, false);
	return false;
}

function resolveSkillConfig(config: UnderstudyConfig | undefined, skill: Pick<UnderstudySkill, "name" | "skillKey">): SkillEntryConfig | undefined {
	const entries = config?.skills?.entries;
	if (!entries || typeof entries !== "object") return undefined;
	for (const key of resolveSkillConfigKeys(skill)) {
		if (entries[key]) {
			return entries[key];
		}
	}
	return undefined;
}

function isBundledSkill(skill: Skill): boolean {
	return skill.source === "understudy-bundled" || skill.source === "bundled";
}

function isBundledAllowed(skill: Skill, config: UnderstudyConfig | undefined): boolean {
	const allowlist = config?.skills?.allowBundled?.map((item) => item.trim()).filter(Boolean);
	if (!allowlist || allowlist.length === 0) return true;
	if (!isBundledSkill(skill)) return true;
	return allowlist.includes(skill.name);
}

function evaluateRequires(
	requires: SkillRuntimeRequires | undefined,
	config: UnderstudyConfig | undefined,
	entryConfig: SkillEntryConfig | undefined,
	metadata?: SkillRuntimeMetadata,
): boolean {
	if (!requires) return true;

	for (const bin of requires.bins ?? []) {
		if (!hasBinary(bin)) return false;
	}
	const anyBins = requires.anyBins ?? [];
	if (anyBins.length > 0 && !anyBins.some((bin) => hasBinary(bin))) {
		return false;
	}
	for (const envName of requires.env ?? []) {
		const hasPrimaryEnvApiKey =
			metadata?.primaryEnv === envName &&
			typeof entryConfig?.apiKey === "string" &&
			entryConfig.apiKey.trim().length > 0;
		if (!process.env[envName] && !entryConfig?.env?.[envName] && !hasPrimaryEnvApiKey) {
			return false;
		}
	}
	for (const configPath of requires.config ?? []) {
		if (!isTruthy(resolveConfigPath(config, configPath))) {
			return false;
		}
	}
	return true;
}

function evaluateMetadata(
	metadata: SkillRuntimeMetadata | undefined,
	config: UnderstudyConfig | undefined,
	entryConfig: SkillEntryConfig | undefined,
): boolean {
	if (!metadata) return true;
	if (metadata.os && metadata.os.length > 0 && !metadata.os.includes(process.platform)) {
		return false;
	}
	if (metadata.always === true) {
		return true;
	}
	return evaluateRequires(metadata.requires, config, entryConfig, metadata);
}

export function shouldIncludeSkill(skill: Skill, config?: UnderstudyConfig): boolean {
	const frontmatterInfo = readSkillFrontmatterInfo(skill.filePath);
	const compatibleSkill = {
		...skill,
		...(frontmatterInfo?.metadata?.skillKey ? { skillKey: frontmatterInfo.metadata.skillKey } : {}),
	} as UnderstudySkill;
	const entryConfig = resolveSkillConfig(config, compatibleSkill);
	if (entryConfig?.enabled === false) {
		return false;
	}
	if (!isBundledAllowed(skill, config)) {
		return false;
	}
	return evaluateMetadata(frontmatterInfo?.metadata, config, entryConfig);
}
