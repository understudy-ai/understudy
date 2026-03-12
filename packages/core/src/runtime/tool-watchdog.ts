import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Static, TSchema } from "@sinclair/typebox";
import type { RuntimeProfile } from "./identity-policy.js";
import type { RuntimeCapabilityManifest } from "./preflight.js";
import { withTimeout } from "../utils/with-timeout.js";

interface ToolTimeoutPolicy {
	noOutputTimeoutMs: number;
	hardTimeoutMs: number;
}

export interface ToolWatchdogOptions {
	runtimeProfile: RuntimeProfile;
	preflight: RuntimeCapabilityManifest;
}

const ASSISTANT_DEFAULT: ToolTimeoutPolicy = {
	noOutputTimeoutMs: 15_000,
	hardTimeoutMs: 45_000,
};

const ASSISTANT_BY_TOOL: Record<string, ToolTimeoutPolicy> = {
	bash: { noOutputTimeoutMs: 30_000, hardTimeoutMs: 90_000 },
	browser: { noOutputTimeoutMs: 15_000, hardTimeoutMs: 45_000 },
	web_search: { noOutputTimeoutMs: 12_000, hardTimeoutMs: 30_000 },
	web_fetch: { noOutputTimeoutMs: 15_000, hardTimeoutMs: 35_000 },
	process: { noOutputTimeoutMs: 10_000, hardTimeoutMs: 30_000 },
	sessions_spawn: { noOutputTimeoutMs: 45_000, hardTimeoutMs: 180_000 },
	subagents: { noOutputTimeoutMs: 30_000, hardTimeoutMs: 90_000 },
};

const HEADLESS_DEFAULT: ToolTimeoutPolicy = {
	noOutputTimeoutMs: 45_000,
	hardTimeoutMs: 180_000,
};

function timeoutPolicy(toolName: string, profile: RuntimeProfile): ToolTimeoutPolicy {
	if (profile === "headless") {
		return HEADLESS_DEFAULT;
	}
	if (toolName.startsWith("gui_")) {
		return {
			noOutputTimeoutMs: 30_000,
			hardTimeoutMs: 90_000,
		};
	}
	return ASSISTANT_BY_TOOL[toolName] ?? ASSISTANT_DEFAULT;
}

function mergeSignals(signalA?: AbortSignal, signalB?: AbortSignal): AbortSignal | undefined {
	if (signalA && signalB) {
		return AbortSignal.any([signalA, signalB]);
	}
	return signalA ?? signalB;
}

function textResult(text: string, details: Record<string, unknown>): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text }],
		details,
	};
}

function extractBashCommand(params: unknown): string {
	if (!params || typeof params !== "object") return "";
	const command = (params as { command?: unknown }).command;
	return typeof command === "string" ? command : "";
}

function isInstallCommand(command: string): boolean {
	return /\b(?:npm|pnpm|yarn|bun|pip|pip3|poetry|uv|brew|apt-get|apt|dnf|yum|apk)\s+(?:install|add)\b/i.test(
		command,
	);
}

function shouldBlockInstallLoop(
	toolName: string,
	params: unknown,
	options: ToolWatchdogOptions,
): { blocked: boolean; packageName?: string } {
	if (options.runtimeProfile !== "assistant") {
		return { blocked: false };
	}
	if (toolName !== "bash") {
		return { blocked: false };
	}
	const command = extractBashCommand(params);
	if (!command || !isInstallCommand(command)) {
		return { blocked: false };
	}
	const missing = options.preflight.blockedInstallPackages.find((pkg) =>
		new RegExp(`\\b${pkg}\\b`, "i").test(command),
	);
	if (!missing) {
		return { blocked: false };
	}
	return { blocked: true, packageName: missing };
}

function buildTimeoutResult(
	toolName: string,
	timeoutType: "no_output" | "hard",
	policy: ToolTimeoutPolicy,
): AgentToolResult<unknown> {
	const timeoutMs =
		timeoutType === "no_output" ? policy.noOutputTimeoutMs : policy.hardTimeoutMs;
	const hint =
		toolName === "bash"
			? "Bash timed out before producing output. Prefer narrower commands, explicit progress output, or a longer-running route when the task is expected to stay silent."
			: "Tool timed out. Try a narrower request or a different tool.";

	return textResult(
		`Tool timeout: ${toolName} (${timeoutType}, ${timeoutMs}ms). ${hint}`,
		{
			error: "timeout",
			timeoutType,
			timeoutMs,
			toolName,
			hint,
		},
	);
}

async function executeWithWatchdog<TDetails>(
	toolName: string,
	params: unknown,
	signal: AbortSignal | undefined,
	onUpdate: ((partialResult: AgentToolResult<TDetails | unknown>) => void) | undefined,
	options: ToolWatchdogOptions,
	invoke: (
		signal: AbortSignal | undefined,
		onUpdate?: (partialResult: AgentToolResult<TDetails | unknown>) => void,
	) => Promise<AgentToolResult<TDetails | unknown>>,
): Promise<AgentToolResult<TDetails | unknown>> {
	const availability = options.preflight.toolAvailability[toolName];
	const toolPolicy = timeoutPolicy(toolName, options.runtimeProfile);

	if (availability && !availability.enabled) {
		return textResult(
			`Tool unavailable: ${toolName} (${availability.reason ?? "runtime preflight failed"}).`,
			{
				error: "preflight_unavailable",
				toolName,
				reason: availability.reason,
			},
		);
	}

	const installGuard = shouldBlockInstallLoop(toolName, params, options);
	if (installGuard.blocked) {
		return textResult(
			`Assistant runtime policy blocked install command for "${installGuard.packageName}". ` +
				"Dependency setup must be done by the operator outside the agent turn.",
			{
				error: "install_blocked",
				toolName,
				packageName: installGuard.packageName,
			},
		);
	}

	let timeoutType: "no_output" | "hard" | null = null;
	let lastUpdateAt = Date.now();
	const watchdogController = new AbortController();
	const mergedSignal = mergeSignals(signal, watchdogController.signal);

	const hardTimer = setTimeout(() => {
		timeoutType = "hard";
		watchdogController.abort();
	}, toolPolicy.hardTimeoutMs);
	const noOutputTimer = setInterval(() => {
		if (Date.now() - lastUpdateAt > toolPolicy.noOutputTimeoutMs) {
			timeoutType = "no_output";
			watchdogController.abort();
		}
	}, 1000);

	try {
		const guardedResult = await withTimeout(
			invoke(mergedSignal, (partial) => {
				lastUpdateAt = Date.now();
				onUpdate?.(partial);
			}),
			toolPolicy.hardTimeoutMs + 1_000,
		);
		if (timeoutType) {
			return buildTimeoutResult(toolName, timeoutType, toolPolicy);
		}
		return guardedResult;
	} catch (error) {
		if (timeoutType) {
			return buildTimeoutResult(toolName, timeoutType, toolPolicy);
		}
		if (watchdogController.signal.aborted) {
			return buildTimeoutResult(toolName, "hard", toolPolicy);
		}
		throw error;
	} finally {
		clearTimeout(hardTimer);
		clearInterval(noOutputTimer);
	}
}

function wrapTool<TParameters extends TSchema, TDetails>(
	tool: AgentTool<TParameters, TDetails>,
	options: ToolWatchdogOptions,
): AgentTool<TParameters, TDetails | unknown> {
	return {
		...tool,
		execute: async (
			toolCallId: string,
			params: Static<TParameters>,
			signal?: AbortSignal,
			onUpdate?: (partialResult: AgentToolResult<TDetails | unknown>) => void,
		): Promise<AgentToolResult<TDetails | unknown>> =>
			executeWithWatchdog(tool.name, params, signal, onUpdate, options, (nextSignal, nextOnUpdate) =>
				tool.execute(
					toolCallId,
					params,
					nextSignal,
					nextOnUpdate as ((partialResult: AgentToolResult<TDetails>) => void) | undefined,
				) as Promise<AgentToolResult<TDetails | unknown>>,
			),
	};
}

export function wrapToolsWithWatchdog(
	tools: AgentTool<TSchema>[],
	options: ToolWatchdogOptions,
): AgentTool<TSchema>[] {
	return tools.map((tool) => wrapTool(tool as AgentTool<TSchema, unknown>, options));
}
