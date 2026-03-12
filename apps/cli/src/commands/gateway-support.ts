import {
	asBoolean as asCanonicalBoolean,
	asNumber as asCanonicalNumber,
	asRecord as asCanonicalRecord,
	asString,
	expandHome,
	resolveUnderstudyHomeDir,
} from "@understudy/core";
import {
	buildSessionKey,
	buildWorkspaceScopeDiscriminator,
} from "@understudy/gateway";
import type { UnderstudyConfig } from "@understudy/types";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function buildNestedPatch(path: string, value: unknown): Record<string, unknown> {
	const keys = path
		.split(".")
		.map((key) => key.trim())
		.filter(Boolean);
	if (keys.length === 0) {
		return {};
	}
	const root: Record<string, unknown> = {};
	let cursor: Record<string, unknown> = root;
	for (let i = 0; i < keys.length - 1; i++) {
		const next: Record<string, unknown> = {};
		cursor[keys[i]!] = next;
		cursor = next;
	}
	cursor[keys[keys.length - 1]!] = value;
	return root;
}

function readPath(root: unknown, pathSegments: string[]): unknown {
	let cursor: unknown = root;
	for (const segment of pathSegments) {
		if (!cursor || typeof cursor !== "object") {
			return undefined;
		}
		cursor = (cursor as Record<string, unknown>)[segment];
	}
	return cursor;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> {
	return asCanonicalRecord(value) ?? {};
}

export function asNumber(value: unknown): number | undefined {
	const parsed = asCanonicalNumber(value);
	return parsed !== undefined ? Math.floor(parsed) : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
	const parsed = asCanonicalBoolean(value);
	if (parsed !== undefined) return parsed;
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (normalized === "true") return true;
		if (normalized === "false") return false;
	}
	return undefined;
}

export function normalizeMcpToolName(server: string, toolName: string): string {
	const serverSlug = server.replace(/[^a-zA-Z0-9_]+/g, "_");
	const toolSlug = toolName.replace(/[^a-zA-Z0-9_]+/g, "_");
	return `mcp_${serverSlug}_${toolSlug}`.replace(/_+/g, "_");
}

export function normalizeMcpResultContent(result: unknown): Array<{ type: "text"; text: string }> {
	const record = isPlainObject(result) ? result : {};
	const content = Array.isArray(record.content) ? record.content : undefined;
	if (content && content.length > 0) {
		const lines = content
			.map((entry) => {
				const chunk = isPlainObject(entry) ? entry : {};
				const kind = asString(chunk.type);
				if (kind === "text") {
					return asString(chunk.text) ?? "";
				}
				return JSON.stringify(chunk);
			})
			.filter((line) => line.length > 0);
		if (lines.length > 0) {
			return [{ type: "text", text: lines.join("\n") }];
		}
	}
	return [
		{
			type: "text",
			text: JSON.stringify(result, null, 2),
		},
	];
}

export function resolveSkillInstallSource(params: {
	name: string;
	installId: string;
}): string | undefined {
	const installAsPath = expandHome(params.installId);
	const candidates = [
		installAsPath,
		join(process.cwd(), "skills", params.installId),
		join(process.cwd(), "skills", params.name),
		join(resolveUnderstudyHomeDir(), "skills", params.installId),
		join(resolveUnderstudyHomeDir(), "..", "understudy", "skills", params.installId),
	];
	for (const candidate of candidates) {
		if (!candidate) continue;
		if (!existsSync(candidate)) continue;
		const skillMd = join(candidate, "SKILL.md");
		if (existsSync(skillMd)) {
			return candidate;
		}
	}
	return undefined;
}

const SECRET_CONFIG_PATHS: string[][] = [
	["channels", "telegram", "settings", "botToken"],
	["channels", "discord", "settings", "botToken"],
	["channels", "slack", "settings", "botToken"],
	["channels", "slack", "settings", "signingSecret"],
	["channels", "slack", "settings", "appToken"],
	["gateway", "auth", "token"],
	["gateway", "auth", "password"],
];

const SECRET_ENV_KEYS = [
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"OPENROUTER_API_KEY",
	"GOOGLE_API_KEY",
	"GEMINI_API_KEY",
	"XAI_API_KEY",
	"MOONSHOT_API_KEY",
	"MINIMAX_API_KEY",
	"ARK_API_KEY",
	"VOLCENGINE_ARK_API_KEY",
	"SEED_API_KEY",
] as const;

export function collectSecretAssignments(config: UnderstudyConfig): Array<{
	path: string;
	pathSegments: string[];
	value: unknown;
}> {
	const assignments: Array<{
		path: string;
		pathSegments: string[];
		value: unknown;
	}> = [];

	for (const pathSegments of SECRET_CONFIG_PATHS) {
		const value = readPath(config as unknown, pathSegments);
		if (typeof value === "string" && value.trim().length > 0) {
			assignments.push({
				path: pathSegments.join("."),
				pathSegments,
				value,
			});
		}
	}

	for (const envKey of SECRET_ENV_KEYS) {
		const value = process.env[envKey];
		if (!value || value.trim().length === 0) continue;
		assignments.push({
			path: `env.${envKey}`,
			pathSegments: ["env", envKey],
			value,
		});
	}

	return assignments;
}

export function normalizeBrowserRoute(pathValue: string): string {
	if (!pathValue) return "";
	return pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
}

export function dayStampFor(timestampMs: number): string {
	const date = new Date(timestampMs);
	return date.toISOString().slice(0, 10);
}

export { asString, buildSessionKey, buildWorkspaceScopeDiscriminator };

export function resolveMemoryDbPath(config: UnderstudyConfig): string {
	const configured = asString(config.memory.dbPath);
	if (configured) {
		return expandHome(configured);
	}
	return join(resolveUnderstudyHomeDir(), "memory.db");
}
