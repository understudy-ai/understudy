import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const PRIMARY_PACKAGE_NAMES = new Set([
	"understudy",
	"@understudy-ai/understudy",
]);

const FALLBACK_PACKAGE_NAMES = new Set([
	"@understudy/cli",
]);

export function resolveUnderstudyPackageVersion(startDir?: string): string | undefined {
	try {
		let current = startDir ?? import.meta.dirname;
		if (!current) {
			return undefined;
		}
		let fallbackVersion: string | undefined;
		for (let depth = 0; depth < 8; depth += 1) {
			const packageJsonPath = join(current, "package.json");
			if (existsSync(packageJsonPath)) {
				const raw = readFileSync(packageJsonPath, "utf-8");
				const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown };
				const version = typeof parsed.version === "string" && parsed.version.trim().length > 0
					? parsed.version.trim()
					: undefined;
				if (version && PRIMARY_PACKAGE_NAMES.has(String(parsed.name))) {
					return version;
				}
				if (!fallbackVersion && version && FALLBACK_PACKAGE_NAMES.has(String(parsed.name))) {
					fallbackVersion = version;
				}
			}
			const next = dirname(current);
			if (next === current) {
				break;
			}
			current = next;
		}
		return fallbackVersion;
	} catch {
		return undefined;
	}
}

export const UNDERSTUDY_PACKAGE_VERSION = resolveUnderstudyPackageVersion() ?? "0.0.0";
