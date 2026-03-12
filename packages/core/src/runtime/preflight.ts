import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import type { RuntimeProfile } from "./identity-policy.js";

export interface RuntimeDependencyStatus {
	name: string;
	available: boolean;
	error?: string;
}

export interface ToolAvailability {
	enabled: boolean;
	reason?: string;
}

export interface RuntimeCapabilityManifest {
	profile: RuntimeProfile;
	dependencies: Record<string, RuntimeDependencyStatus>;
	toolAvailability: Record<string, ToolAvailability>;
	enabledToolNames: string[];
	warnings: string[];
	blockedInstallPackages: string[];
}

interface RuntimePreflightOptions {
	profile: RuntimeProfile;
	toolNames: string[];
}

const TOOL_DEPENDENCIES: Record<string, string[]> = {
	browser: ["playwright"],
	schedule: ["croner"],
};

function collectRequireCandidates(cwd: string): Array<ReturnType<typeof createRequire>> {
	const candidates: Array<ReturnType<typeof createRequire>> = [createRequire(import.meta.url)];
	const seen = new Set<string>();
	let currentDir = resolvePath(cwd);

	while (true) {
		const packageJson = resolvePath(currentDir, "package.json");
		const toolsPackageJson = resolvePath(currentDir, "packages", "tools", "package.json");
		for (const candidatePath of [packageJson, toolsPackageJson]) {
			if (!existsSync(candidatePath) || seen.has(candidatePath)) continue;
			seen.add(candidatePath);
			candidates.push(createRequire(candidatePath));
		}

		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) break;
		currentDir = parentDir;
	}

	return candidates;
}

function checkDependency(depName: string): RuntimeDependencyStatus {
	const requireCandidates = collectRequireCandidates(process.cwd());

	const errors: string[] = [];
	for (const req of requireCandidates) {
		try {
			req.resolve(depName);
			return { name: depName, available: true };
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
	}

	return {
		name: depName,
		available: false,
		error: errors.join(" | "),
	};
}

export function runRuntimePreflight(options: RuntimePreflightOptions): RuntimeCapabilityManifest {
	const dependencies = Array.from(new Set(
		options.toolNames.flatMap((toolName) => TOOL_DEPENDENCIES[toolName] ?? []),
	));

	const dependencyStatus: Record<string, RuntimeDependencyStatus> = {};
	for (const dep of dependencies) {
		dependencyStatus[dep] = checkDependency(dep);
	}

	const toolAvailability: Record<string, ToolAvailability> = {};
	const warnings: string[] = [];
	for (const toolName of options.toolNames) {
		const deps = TOOL_DEPENDENCIES[toolName] ?? [];
		const missing = deps.filter((dep) => !dependencyStatus[dep]?.available);
		if (missing.length === 0) {
			toolAvailability[toolName] = { enabled: true };
			continue;
		}

		toolAvailability[toolName] = {
			enabled: false,
			reason: `missing dependency: ${missing.join(", ")}`,
		};

		warnings.push(
			`Tool ${toolName} disabled by preflight (${missing.join(", ")} unavailable).`,
		);
	}

	const enabledToolNames = options.toolNames.filter(
		(name) => toolAvailability[name]?.enabled ?? true,
	);

	const blockedInstallPackages =
		options.profile === "assistant"
			? dependencies.filter((dep) => !dependencyStatus[dep]?.available)
			: [];

	return {
		profile: options.profile,
		dependencies: dependencyStatus,
		toolAvailability,
		enabledToolNames,
		warnings,
		blockedInstallPackages,
	};
}

export function buildPreflightPromptContent(manifest: RuntimeCapabilityManifest): string {
	if (manifest.warnings.length === 0) {
		return "All runtime preflight checks passed.";
	}
	const warningLines = manifest.warnings.map((warning) => `- ${warning}`);
	const installLine =
		manifest.blockedInstallPackages.length > 0
			? `- Assistant profile policy: do not attempt package installs for missing deps (${manifest.blockedInstallPackages.join(", ")}).`
			: undefined;

	return [
		"Runtime preflight warnings:",
		...warningLines,
		...(installLine ? [installLine] : []),
	].join("\n");
}
