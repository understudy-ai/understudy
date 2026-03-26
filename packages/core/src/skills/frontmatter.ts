import fs from "node:fs";
import YAML from "yaml";
import type { Skill } from "@mariozechner/pi-coding-agent";
import { expandOpenClawCompatibleToolNames } from "../openclaw-compat.js";
import type { WorkspaceArtifactChildRef, WorkspaceArtifactKind } from "../workspace-artifact-types.js";

export type SkillRuntimeRequires = {
	bins?: string[];
	anyBins?: string[];
	env?: string[];
	config?: string[];
};

export type SkillInstallHint = {
	id?: string;
	kind?: string;
	label?: string;
	bins?: string[];
	[key: string]: unknown;
};

export type SkillRuntimeMetadata = {
	os?: string[];
	always?: boolean;
	requires?: SkillRuntimeRequires;
	install?: SkillInstallHint[];
	emoji?: string;
	homepage?: string;
	skillKey?: string;
	primaryEnv?: string;
	artifactKind?: WorkspaceArtifactKind;
	childArtifacts?: WorkspaceArtifactChildRef[];
};

export type UnderstudySkill = Skill & {
	allowedToolNames?: string[];
	skillKey?: string;
	primaryEnv?: string;
	requiredEnv?: string[];
	install?: SkillInstallHint[];
	emoji?: string;
	homepage?: string;
	triggers?: string[];
	artifactKind?: WorkspaceArtifactKind;
	childArtifacts?: WorkspaceArtifactChildRef[];
};

export interface SkillFrontmatterInfo {
	frontmatter: Record<string, unknown>;
	metadata?: SkillRuntimeMetadata;
	allowedToolNames: string[];
	triggers: string[];
}

function normalizeStringArray(input: unknown): string[] {
	if (!Array.isArray(input)) return [];
	return input.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeRequires(input: unknown): SkillRuntimeRequires | undefined {
	if (!input || typeof input !== "object") return undefined;
	const record = input as Record<string, unknown>;
	const bins = normalizeStringArray(record.bins);
	const anyBins = normalizeStringArray(record.anyBins);
	const env = normalizeStringArray(record.env);
	const config = normalizeStringArray(record.config);
	if (bins.length === 0 && anyBins.length === 0 && env.length === 0 && config.length === 0) {
		return undefined;
	}
	return {
		...(bins.length > 0 ? { bins } : {}),
		...(anyBins.length > 0 ? { anyBins } : {}),
		...(env.length > 0 ? { env } : {}),
		...(config.length > 0 ? { config } : {}),
	};
}

function normalizeInstallHints(input: unknown): SkillInstallHint[] | undefined {
	if (!Array.isArray(input)) return undefined;
	const normalized = input
		.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
		.map((entry) => ({
			...entry,
			...(Array.isArray(entry.bins) ? { bins: normalizeStringArray(entry.bins) } : {}),
			...(typeof entry.id === "string" ? { id: entry.id.trim() } : {}),
			...(typeof entry.kind === "string" ? { kind: entry.kind.trim() } : {}),
			...(typeof entry.label === "string" ? { label: entry.label.trim() } : {}),
		}));
	return normalized.length > 0 ? normalized : undefined;
}

function normalizeArtifactKind(input: unknown): WorkspaceArtifactKind | undefined {
	if (typeof input !== "string") {
		return undefined;
	}
	switch (input.trim().toLowerCase()) {
		case "worker":
			return "worker";
		case "playbook":
			return "playbook";
		case "skill":
			return "skill";
		default:
			return undefined;
	}
}

function normalizeChildArtifacts(input: unknown): WorkspaceArtifactChildRef[] | undefined {
	if (!Array.isArray(input)) {
		return undefined;
	}
	const normalized = input
		.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
		.map((entry) => {
			const name = typeof entry.name === "string" ? entry.name.trim() : "";
			const artifactKind = normalizeArtifactKind(entry.artifactKind);
			if (!name || !artifactKind || artifactKind === "playbook") {
				return undefined;
			}
			return {
				name,
				artifactKind,
				required: entry.required !== false,
				...(typeof entry.reason === "string" && entry.reason.trim().length > 0
					? { reason: entry.reason.trim() }
					: {}),
			} satisfies WorkspaceArtifactChildRef;
		})
		.filter((entry): entry is WorkspaceArtifactChildRef => Boolean(entry));
	return normalized.length > 0 ? normalized : undefined;
}

function normalizeMetadata(input: unknown): SkillRuntimeMetadata | undefined {
	if (!input || typeof input !== "object") return undefined;
	const record = input as Record<string, unknown>;
	const os = normalizeStringArray(record.os);
	const requires = normalizeRequires(record.requires);
	const install = normalizeInstallHints(record.install);
	const artifactKind = normalizeArtifactKind(record.artifactKind);
	const childArtifacts = normalizeChildArtifacts(record.childArtifacts);
	return {
		...(os.length > 0 ? { os } : {}),
		...(record.always === true ? { always: true } : {}),
		...(requires ? { requires } : {}),
		...(install ? { install } : {}),
		...(typeof record.emoji === "string" && record.emoji.trim().length > 0
			? { emoji: record.emoji.trim() }
			: {}),
		...(typeof record.homepage === "string" && record.homepage.trim().length > 0
			? { homepage: record.homepage.trim() }
			: {}),
		...(typeof record.skillKey === "string" && record.skillKey.trim().length > 0
			? { skillKey: record.skillKey.trim() }
			: {}),
		...(typeof record.primaryEnv === "string" && record.primaryEnv.trim().length > 0
			? { primaryEnv: record.primaryEnv.trim() }
			: {}),
		...(artifactKind ? { artifactKind } : {}),
		...(childArtifacts ? { childArtifacts } : {}),
	};
}

function mergeRequires(
	base: SkillRuntimeRequires | undefined,
	next: SkillRuntimeRequires | undefined,
): SkillRuntimeRequires | undefined {
	if (!base) return next;
	if (!next) return base;
	return {
		...(base.bins || next.bins ? { bins: next.bins ?? base.bins } : {}),
		...(base.anyBins || next.anyBins ? { anyBins: next.anyBins ?? base.anyBins } : {}),
		...(base.env || next.env ? { env: next.env ?? base.env } : {}),
		...(base.config || next.config ? { config: next.config ?? base.config } : {}),
	};
}

function mergeMetadata(
	base: SkillRuntimeMetadata | undefined,
	next: SkillRuntimeMetadata | undefined,
): SkillRuntimeMetadata | undefined {
	if (!base) return next;
	if (!next) return base;
	return {
		...(base.os || next.os ? { os: next.os ?? base.os } : {}),
		...(base.always === true || next.always === true
			? { always: next.always ?? base.always }
			: {}),
		...(base.requires || next.requires
			? { requires: mergeRequires(base.requires, next.requires) }
			: {}),
		...(base.install || next.install ? { install: next.install ?? base.install } : {}),
		...(base.emoji || next.emoji ? { emoji: next.emoji ?? base.emoji } : {}),
		...(base.homepage || next.homepage ? { homepage: next.homepage ?? base.homepage } : {}),
		...(base.skillKey || next.skillKey ? { skillKey: next.skillKey ?? base.skillKey } : {}),
		...(base.primaryEnv || next.primaryEnv
			? { primaryEnv: next.primaryEnv ?? base.primaryEnv }
			: {}),
		...(base.artifactKind || next.artifactKind
			? { artifactKind: next.artifactKind ?? base.artifactKind }
			: {}),
		...(base.childArtifacts || next.childArtifacts
			? { childArtifacts: next.childArtifacts ?? base.childArtifacts }
			: {}),
	};
}

function extractMetadata(frontmatter: Record<string, unknown>): SkillRuntimeMetadata | undefined {
	const meta = frontmatter.metadata;
	const metadataRecord = meta && typeof meta === "object" ? meta as Record<string, unknown> : undefined;
	const candidates = [
		normalizeMetadata(frontmatter),
		normalizeMetadata(metadataRecord),
		normalizeMetadata(metadataRecord?.understudy),
	];
	return candidates.reduce<SkillRuntimeMetadata | undefined>(
		(current, next) => mergeMetadata(current, next),
		undefined,
	);
}

function extractAllowedToolNames(frontmatter: Record<string, unknown>): string[] {
	const value = frontmatter["allowed-tools"];
	const raw = Array.isArray(value)
		? value.map((entry) => String(entry).trim()).filter(Boolean)
		: typeof value === "string"
			? value.split(",").map((entry) => entry.trim()).filter(Boolean)
			: [];
	return expandOpenClawCompatibleToolNames(raw);
}

function extractTriggers(frontmatter: Record<string, unknown>): string[] {
	const metadata = frontmatter.metadata;
	const metadataRecord = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : undefined;
	const understudyMetadata = metadataRecord?.understudy;
	const understudyRecord = understudyMetadata && typeof understudyMetadata === "object"
		? understudyMetadata as Record<string, unknown>
		: undefined;
	return Array.from(new Set([
		...normalizeStringArray(frontmatter.triggers),
		...normalizeStringArray(frontmatter.aliases),
		...normalizeStringArray(understudyRecord?.triggers),
	].map((entry) => entry.trim()).filter(Boolean)));
}

export function parseSkillFrontmatter(filePath: string): Record<string, unknown> | undefined {
	try {
		const raw = fs.readFileSync(filePath, "utf-8");
		if (!raw.startsWith("---")) return undefined;
		const endMarker = raw.indexOf("\n---", 3);
		if (endMarker === -1) return undefined;
		const frontmatter = raw.slice(3, endMarker).trim();
		if (!frontmatter) return undefined;
		const parsed = YAML.parse(frontmatter);
		return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
	} catch {
		return undefined;
	}
}

export function readSkillFrontmatterInfo(filePath: string): SkillFrontmatterInfo | undefined {
	const frontmatter = parseSkillFrontmatter(filePath);
	if (!frontmatter) return undefined;
	return {
		frontmatter,
		metadata: extractMetadata(frontmatter),
		allowedToolNames: extractAllowedToolNames(frontmatter),
		triggers: extractTriggers(frontmatter),
	};
}

export function hydrateSkillFromFrontmatter(
	skill: Skill,
	info?: SkillFrontmatterInfo,
): UnderstudySkill {
	const metadata = info?.metadata;
	return {
		...skill,
		...(info?.allowedToolNames.length ? { allowedToolNames: info.allowedToolNames } : {}),
		...(metadata?.skillKey ? { skillKey: metadata.skillKey } : {}),
		...(metadata?.primaryEnv ? { primaryEnv: metadata.primaryEnv } : {}),
		...(metadata?.requires?.env?.length ? { requiredEnv: metadata.requires.env.slice() } : {}),
		...(metadata?.install?.length ? { install: metadata.install } : {}),
		...(metadata?.emoji ? { emoji: metadata.emoji } : {}),
		...(metadata?.homepage ? { homepage: metadata.homepage } : {}),
		...(info?.triggers.length ? { triggers: info.triggers.slice() } : {}),
		...(metadata?.artifactKind ? { artifactKind: metadata.artifactKind } : {}),
		...(metadata?.childArtifacts?.length ? { childArtifacts: metadata.childArtifacts } : {}),
	};
}

export function resolveSkillConfigKeys(skill: Pick<UnderstudySkill, "name" | "skillKey">): string[] {
	return Array.from(
		new Set([skill.name, skill.skillKey].map((value) => value?.trim()).filter(Boolean) as string[]),
	);
}
