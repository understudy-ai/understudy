import { homedir } from "node:os";
import path from "node:path";

export function expandHomePath(value: string): string {
	if (value === "~") return homedir();
	if (value.startsWith("~/")) {
		return path.join(homedir(), value.slice(2));
	}
	return value;
}

export function resolveBootstrapUnderstudyAgentDir(env: NodeJS.ProcessEnv = process.env): string {
	const explicitAgentDir = env.UNDERSTUDY_AGENT_DIR?.trim();
	if (explicitAgentDir) {
		return expandHomePath(explicitAgentDir);
	}

	const explicitHomeDir = env.UNDERSTUDY_HOME?.trim();
	const homeDir = explicitHomeDir
		? expandHomePath(explicitHomeDir)
		: path.join(homedir(), ".understudy");
	return path.join(homeDir, "agent");
}

/**
 * Set the runtime engine storage env var before importing modules that may
 * touch the embedded Pi engine. This prevents fallback writes to ~/.pi.
 */
export function ensureBootstrapRuntimeAgentDirEnv(env: NodeJS.ProcessEnv = process.env): string {
	const existing = env.PI_CODING_AGENT_DIR?.trim();
	const resolved = existing
		? expandHomePath(existing)
		: resolveBootstrapUnderstudyAgentDir(env);
	env.PI_CODING_AGENT_DIR = resolved;
	return resolved;
}
