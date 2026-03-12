import { homedir } from "node:os";
import { join } from "node:path";

const UNDERSTUDY_HOME_DIR = ".understudy";
const UNDERSTUDY_AGENT_DIR = "agent";

export function expandHome(pathValue: string): string {
	if (pathValue === "~") return homedir();
	if (pathValue.startsWith("~/")) return join(homedir(), pathValue.slice(2));
	return pathValue;
}

export function getDefaultUnderstudyHomeDir(): string {
	return join(homedir(), UNDERSTUDY_HOME_DIR);
}

export function resolveUnderstudyHomeDir(override?: string): string {
	const candidate = override?.trim() || process.env.UNDERSTUDY_HOME?.trim() || getDefaultUnderstudyHomeDir();
	return expandHome(candidate);
}

export function getDefaultUnderstudyAgentDir(): string {
	return join(getDefaultUnderstudyHomeDir(), UNDERSTUDY_AGENT_DIR);
}

export function resolveUnderstudyAgentDir(override?: string): string {
	const candidate =
		override?.trim() ||
		process.env.UNDERSTUDY_AGENT_DIR?.trim() ||
		join(resolveUnderstudyHomeDir(), UNDERSTUDY_AGENT_DIR);
	return expandHome(candidate);
}

/**
 * Bridge Understudy runtime storage path into the underlying engine env var.
 * The env var name is engine-defined; Understudy keeps ownership of path resolution.
 */
export function ensureRuntimeEngineAgentDirEnv(agentDir: string): string {
	const resolved = expandHome(agentDir);
	process.env.PI_CODING_AGENT_DIR = resolved;
	return resolved;
}

export function encodeSessionScope(cwd: string): string {
	const normalized = cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-");
	return `--${normalized}--`;
}

export function getUnderstudySessionDir(cwd: string, agentDir?: string): string {
	const resolvedAgentDir = agentDir ? expandHome(agentDir) : resolveUnderstudyAgentDir();
	return join(resolvedAgentDir, "sessions", encodeSessionScope(cwd));
}
