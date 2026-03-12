import { execSync } from "node:child_process";
import { statSync } from "node:fs";
import { relative, resolve } from "node:path";

export interface ResolveWorkspaceContextParams {
	requestedWorkspaceDir?: string;
	configuredWorkspaceDir?: string;
	fallbackWorkspaceDir?: string;
	configuredRepoRoot?: string;
}

export interface ResolvedWorkspaceContext {
	workspaceDir: string;
	repoRoot?: string;
	validationRoot: string;
}

export function normalizePath(value?: string): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? resolve(trimmed) : undefined;
}

function resolveExistingDirectory(value?: string): string | undefined {
	const normalized = normalizePath(value);
	if (!normalized) {
		return undefined;
	}
	try {
		return statSync(normalized).isDirectory() ? normalized : undefined;
	} catch {
		return undefined;
	}
}

export function containsPath(parent: string, child: string): boolean {
	const diff = relative(parent, child);
	return diff === "" || (!diff.startsWith("..") && diff !== ".");
}

export function findGitRoot(dir?: string): string | undefined {
	const normalized = normalizePath(dir);
	if (!normalized) {
		return undefined;
	}
	try {
		const result = execSync("git rev-parse --show-toplevel", {
			cwd: normalized,
			encoding: "utf-8",
			timeout: 3000,
			stdio: ["pipe", "pipe", "pipe"],
		});
		const root = result.trim();
		return root.length > 0 ? root : undefined;
	} catch {
		return undefined;
	}
}

export function resolveWorkspaceDir(params: ResolveWorkspaceContextParams): string {
	return (
		normalizePath(params.requestedWorkspaceDir) ??
		normalizePath(params.configuredWorkspaceDir) ??
		normalizePath(params.fallbackWorkspaceDir) ??
		resolve(process.cwd())
	);
}

export function resolveWorkspaceContext(params: ResolveWorkspaceContextParams): ResolvedWorkspaceContext {
	const workspaceDir = resolveWorkspaceDir(params);
	const configuredRepoRoot = resolveExistingDirectory(params.configuredRepoRoot);
	const repoRoot = configuredRepoRoot && containsPath(configuredRepoRoot, workspaceDir)
		? configuredRepoRoot
		: findGitRoot(workspaceDir);
	return {
		workspaceDir,
		repoRoot,
		validationRoot: repoRoot ?? workspaceDir,
	};
}
