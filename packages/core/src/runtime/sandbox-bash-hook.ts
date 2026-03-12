import { spawnSync } from "node:child_process";
import type { BashSpawnHook } from "@mariozechner/pi-coding-agent";
import type { UnderstudyConfig } from "@understudy/types";
import type { Logger } from "../logger.js";

type SandboxMode = "off" | "auto" | "strict";

interface ResolvedSandboxConfig {
	mode: SandboxMode;
	dockerImage: string;
	workspaceMountMode: "rw" | "ro";
	disableNetwork: boolean;
}

const CRITICAL_COMMAND_PATTERNS = [
	/\b(curl|wget)\b[^|;\n]*\|\s*(bash|sh)\b/i,
	/\brm\s+-[^\n;]*\b(rf|fr)\b/i,
	/\b(sudo)\b/i,
	/\b(dd|mkfs|fdisk)\b/i,
	/\bchmod\s+(-R\s+)?0?777\b/i,
	/\b:\(\)\s*\{\s*:\|:&\s*\};:/,
];

let dockerAvailabilityCache: boolean | undefined;

function quoteForShell(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function isCriticalCommand(command: string): boolean {
	return CRITICAL_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

function resolveSandboxConfig(config: UnderstudyConfig): ResolvedSandboxConfig {
	const sandbox = config.agent?.sandbox;
	const mode = sandbox?.mode ?? "auto";
	return {
		mode,
		dockerImage: sandbox?.dockerImage?.trim() || "alpine:3.20",
		workspaceMountMode: sandbox?.workspaceMountMode ?? "rw",
		disableNetwork: sandbox?.disableNetwork !== false,
	};
}

function dockerAvailable(): boolean {
	if (dockerAvailabilityCache !== undefined) {
		return dockerAvailabilityCache;
	}
	try {
		const result = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
			encoding: "utf-8",
			timeout: 1200,
		});
		dockerAvailabilityCache = result.status === 0;
	} catch {
		dockerAvailabilityCache = false;
	}
	return dockerAvailabilityCache;
}

function buildDockerSandboxCommand(command: string, cwd: string, config: ResolvedSandboxConfig): string {
	const volume = `${cwd}:/workspace:${config.workspaceMountMode}`;
	const networkArg = config.disableNetwork ? "--network none " : "";
	return [
		"docker run --rm -i",
		networkArg.trim(),
		`-v ${quoteForShell(volume)}`,
		"-w /workspace",
		quoteForShell(config.dockerImage),
		"/bin/sh -lc",
		quoteForShell(command),
	]
		.filter(Boolean)
		.join(" ");
}

export function createSandboxBashSpawnHook(
	config: UnderstudyConfig,
	logger?: Logger,
): BashSpawnHook | undefined {
	const sandbox = resolveSandboxConfig(config);
	if (sandbox.mode === "off") {
		return undefined;
	}
	let warnedHostFallback = false;
	let warnedStrictBlock = false;
	return (context) => {
		const command = context.command?.trim();
		if (!command) return context;
		if (/^\s*docker\s+run\b/i.test(command)) {
			return context;
		}
		if (!isCriticalCommand(command)) {
			return context;
		}
		if (dockerAvailable()) {
			return {
				...context,
				command: buildDockerSandboxCommand(command, context.cwd, sandbox),
			};
		}
		if (sandbox.mode === "strict") {
			if (!warnedStrictBlock) {
				logger?.warn(
					"Sandbox mode=strict blocked a critical shell command because Docker is unavailable.",
				);
				warnedStrictBlock = true;
			}
			return {
				...context,
				command:
					'printf "%s\\n" "[understudy] blocked critical command: sandbox mode is strict and Docker is unavailable." >&2; exit 1',
			};
		}
		if (!warnedHostFallback) {
			logger?.warn(
				"Sandbox mode=auto could not use Docker; critical shell commands will run on host with warning.",
			);
			warnedHostFallback = true;
		}
		return {
			...context,
			command: `printf "%s\\n" "[understudy] WARNING: running critical command on host because Docker sandbox is unavailable." >&2; ${command}`,
		};
	};
}

/** @internal test-only */
export function __resetSandboxDockerProbeCacheForTests(): void {
	dockerAvailabilityCache = undefined;
}
