import { access, constants } from "node:fs/promises";
import { execFileAsync } from "./exec-utils.js";
import { resolveNativeGuiHelperBinary } from "./native-helper.js";

const DEFAULT_TIMEOUT_MS = 5_000;

interface GuiReadinessDeps {
	now?: () => number;
	runSwiftBooleanCheck?: (script: string) => Promise<boolean>;
	resolveNativeHelperBinary?: () => Promise<string>;
	accessPath?: (path: string) => Promise<void>;
}

export interface GuiEnvironmentReadinessCheck {
	id: string;
	label: string;
	status: "ok" | "warn" | "error" | "unsupported";
	summary: string;
	detail?: string;
}

export interface GuiEnvironmentReadinessSnapshot {
	status: "ready" | "degraded" | "blocked" | "unsupported";
	checkedAt: number;
	checks: GuiEnvironmentReadinessCheck[];
}

function resolveSnapshotStatus(
	checks: GuiEnvironmentReadinessCheck[],
): GuiEnvironmentReadinessSnapshot["status"] {
	if (checks.every((check) => check.status === "unsupported")) {
		return "unsupported";
	}
	if (checks.some((check) => check.status === "error")) {
		return "blocked";
	}
	if (checks.some((check) => check.status === "warn")) {
		return "degraded";
	}
	return "ready";
}

function normalizeBooleanOutput(stdout: string): boolean | undefined {
	const normalized = stdout.trim().toLowerCase();
	if (normalized === "1" || normalized === "true" || normalized === "yes") {
		return true;
	}
	if (normalized === "0" || normalized === "false" || normalized === "no") {
		return false;
	}
	return undefined;
}

function formatExecError(error: unknown): string {
	if (!(error instanceof Error)) {
		return String(error);
	}
	const record = error as Error & {
		stderr?: string;
		stdout?: string;
	};
	return [record.message, record.stderr?.trim(), record.stdout?.trim()]
		.filter(Boolean)
		.join(" ")
		.trim();
}

async function runSwiftBooleanCheck(script: string): Promise<boolean> {
	const result = await execFileAsync("swift", ["-e", script], {
		timeout: DEFAULT_TIMEOUT_MS,
		maxBuffer: 2 * 1024 * 1024,
		encoding: "utf-8",
	});
	const parsed = normalizeBooleanOutput(result.stdout);
	if (parsed === undefined) {
		throw new Error(`Unexpected readiness helper output: ${result.stdout.trim() || "(empty)"}`);
	}
	return parsed;
}

async function accessExecutable(path: string): Promise<void> {
	await access(path, constants.X_OK);
}

export async function inspectGuiEnvironmentReadiness(
	platform: NodeJS.Platform = process.platform,
	deps: GuiReadinessDeps = {},
): Promise<GuiEnvironmentReadinessSnapshot> {
	const checkedAt = deps.now?.() ?? Date.now();
	const runBooleanCheck = deps.runSwiftBooleanCheck ?? runSwiftBooleanCheck;
	const resolveHelperBinary = deps.resolveNativeHelperBinary ?? resolveNativeGuiHelperBinary;
	const accessPath = deps.accessPath ?? accessExecutable;
	if (platform !== "darwin") {
		return {
			status: "unsupported",
			checkedAt,
			checks: [
				{
					id: "platform",
					label: "Platform",
					status: "unsupported",
					summary: "GUI runtime checks are currently implemented for macOS only.",
					detail: `Current platform: ${platform}`,
				},
			],
		};
	}

	const checks: GuiEnvironmentReadinessCheck[] = [
		{
			id: "platform",
			label: "Platform",
			status: "ok",
			summary: "macOS GUI runtime is available on this host.",
		},
	];

	try {
		const trusted = await runBooleanCheck(String.raw`
import ApplicationServices
print(AXIsProcessTrusted() ? "1" : "0")
`);
		checks.push({
			id: "accessibility",
			label: "Accessibility",
			status: trusted ? "ok" : "error",
			summary: trusted
				? "Accessibility permission is granted for native GUI input."
				: "Accessibility permission is not granted for native GUI input.",
		});
	} catch (error) {
		checks.push({
			id: "accessibility",
			label: "Accessibility",
			status: "warn",
			summary: "Could not confirm Accessibility permission state.",
			detail: formatExecError(error),
		});
	}

	try {
		const allowed = await runBooleanCheck(String.raw`
import CoreGraphics
print(CGPreflightScreenCaptureAccess() ? "1" : "0")
`);
		checks.push({
			id: "screen_recording",
			label: "Screen Recording",
			status: allowed ? "ok" : "error",
			summary: allowed
				? "Screen Recording permission is granted for GUI screenshots."
				: "Screen Recording permission is not granted for GUI screenshots.",
		});
	} catch (error) {
		checks.push({
			id: "screen_recording",
			label: "Screen Recording",
			status: "warn",
			summary: "Could not confirm Screen Recording permission state.",
			detail: formatExecError(error),
		});
	}

	try {
		const helperPath = await resolveHelperBinary();
		await accessPath(helperPath);
		checks.push({
			id: "native_helper",
			label: "Native GUI Helper",
			status: "ok",
			summary: "Native GUI helper is ready for capture and input execution.",
			detail: helperPath,
		});
	} catch (error) {
		checks.push({
			id: "native_helper",
			label: "Native GUI Helper",
			status: "error",
			summary: "Native GUI helper is unavailable.",
			detail: formatExecError(error),
		});
	}

	return {
		status: resolveSnapshotStatus(checks),
		checkedAt,
		checks,
	};
}
