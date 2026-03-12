import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runRuntimePreflight } from "@understudy/core";
import {
	inspectGuiEnvironmentReadiness,
	resolveGuiRuntimeCapabilities,
	type GuiEnvironmentReadinessSnapshot,
} from "@understudy/gui";
import type { UnderstudyConfig } from "@understudy/types";
import type { UnderstudyChromeExtensionRelayServer } from "../browser/extension-relay.js";
import {
	resolveConfiguredBrowserCdpUrl,
	resolveConfiguredBrowserConnectionMode,
} from "./browser-extension.js";
import { primeGuiGroundingForConfig } from "./gui-grounding.js";

const execFileAsync = promisify(execFile);
const READINESS_EXEC_TIMEOUT_MS = 5_000;

export interface RuntimeReadinessCheck {
	id: string;
	label: string;
	status: "ok" | "warn" | "error";
	summary: string;
	detail?: string;
}

export interface RuntimeReadinessSnapshot {
	status: "ok" | "warn" | "error";
	generatedAt: number;
	checks: RuntimeReadinessCheck[];
}

interface RuntimeReadinessDeps {
	now?: () => number;
	platform?: NodeJS.Platform;
	runBrowserPreflight?: typeof runRuntimePreflight;
	resolveGuiGrounding?: typeof primeGuiGroundingForConfig;
	inspectGuiReadiness?: () => Promise<GuiEnvironmentReadinessSnapshot>;
	inspectVideoTeachReadiness?: (config: UnderstudyConfig) => Promise<RuntimeReadinessCheck[]>;
	resolveBrowserConnectionMode?: () => "managed" | "extension" | "auto";
	resolveBrowserCdpUrl?: () => string;
}

function summarizeStatus(checks: RuntimeReadinessCheck[]): RuntimeReadinessSnapshot["status"] {
	if (checks.some((check) => check.status === "error")) {
		return "error";
	}
	if (checks.some((check) => check.status === "warn")) {
		return "warn";
	}
	return "ok";
}

function mapGuiCheckStatus(
	status: GuiEnvironmentReadinessSnapshot["checks"][number]["status"],
): RuntimeReadinessCheck["status"] {
	if (status === "ok") {
		return "ok";
	}
	if (status === "error") {
		return "error";
	}
	return "warn";
}

function formatExecError(error: unknown): string {
	if (!(error instanceof Error)) {
		return String(error);
	}
	const record = error as Error & { stderr?: string; stdout?: string };
	return [record.message, record.stderr?.trim(), record.stdout?.trim()]
		.filter(Boolean)
		.join(" ")
		.trim();
}

async function probeBinaryVersion(binary: string): Promise<{ ok: true; detail?: string } | { ok: false; detail: string }> {
	try {
		const result = await execFileAsync(binary, ["-version"], {
			timeout: READINESS_EXEC_TIMEOUT_MS,
			maxBuffer: 1024 * 1024,
			encoding: "utf8",
		});
		const line = result.stdout.trim().split(/\r?\n/)[0]?.trim();
		return { ok: true, detail: line || `${binary} available` };
	} catch (error) {
		return {
			ok: false,
			detail: formatExecError(error),
		};
	}
}

async function probeCommand(
	binary: string,
	args: string[],
): Promise<{ ok: true; detail?: string } | { ok: false; detail: string }> {
	try {
		const result = await execFileAsync(binary, args, {
			timeout: READINESS_EXEC_TIMEOUT_MS,
			maxBuffer: 1024 * 1024,
			encoding: "utf8",
		});
		const line = `${result.stdout}\n${result.stderr}`.trim().split(/\r?\n/)[0]?.trim();
		return { ok: true, detail: line || `${binary} available` };
	} catch (error) {
		return {
			ok: false,
			detail: formatExecError(error),
		};
	}
}

export async function collectVideoTeachReadinessChecks(
	config: UnderstudyConfig,
): Promise<RuntimeReadinessCheck[]> {
	const provider = config.defaultProvider?.trim() || "configured-provider";
	const model = config.defaultModel?.trim() || "configured-model";
	const [ffmpeg, ffprobe] = await Promise.all([
		probeBinaryVersion("ffmpeg"),
		probeBinaryVersion("ffprobe"),
	]);
	const demoRecorderSupported = process.platform === "darwin";
	const [screenRecorder, swift] = demoRecorderSupported
		? await Promise.all([
			probeCommand("xcrun", ["--find", "screencapture"]),
			probeCommand("swift", ["--version"]),
		])
		: [
			{ ok: false as const, detail: "Demo recording currently targets macOS hosts." },
			{ ok: false as const, detail: "Swift event capture is only used on macOS demo-record hosts." },
		];
	return [
		{
			id: "video-teach-model",
			label: "Demo Teach Analyzer",
			status: "ok",
			summary: `Uses main model (${provider}/${model})`,
			detail: "Demo-video teach analysis follows the main model; there is no separate teach-model configuration.",
		},
		{
			id: "video-teach-ffmpeg",
			label: "Evidence Builder",
			status: ffmpeg.ok ? "ok" : "warn",
			summary: ffmpeg.ok ? "ffmpeg available" : "ffmpeg missing",
			detail: ffmpeg.detail,
		},
		{
			id: "video-teach-ffprobe",
			label: "Video Probe",
			status: ffprobe.ok ? "ok" : "warn",
			summary: ffprobe.ok ? "ffprobe available" : "ffprobe missing",
			detail: ffprobe.detail,
		},
		{
			id: "video-teach-recording",
			label: "Demo Recording",
			status: demoRecorderSupported
				? screenRecorder.ok
					? "ok"
					: "warn"
				: "warn",
			summary: demoRecorderSupported
				? screenRecorder.ok
					? "screencapture available"
					: "screencapture missing"
				: "Direct demo recording requires macOS",
			detail: screenRecorder.detail,
		},
		{
			id: "video-teach-events",
			label: "Event Timeline Capture",
			status: demoRecorderSupported
				? swift.ok
					? "ok"
					: "warn"
				: "warn",
			summary: demoRecorderSupported
				? swift.ok
					? "Swift event capture available"
					: "Swift event capture missing"
				: "Swift event capture only runs on macOS",
			detail: swift.detail,
		},
	];
}

export async function collectGatewayRuntimeReadiness(params: {
	config: UnderstudyConfig;
	browserExtensionRelay?: UnderstudyChromeExtensionRelayServer | null;
	deps?: RuntimeReadinessDeps;
}): Promise<RuntimeReadinessSnapshot> {
	const deps = params.deps ?? {};
	const now = deps.now ?? Date.now;
	const runBrowserPreflight = deps.runBrowserPreflight ?? runRuntimePreflight;
	const resolveGuiGrounding = deps.resolveGuiGrounding ?? primeGuiGroundingForConfig;
	const inspectGuiReadiness = deps.inspectGuiReadiness ?? inspectGuiEnvironmentReadiness;
	const inspectVideoTeachReadiness = deps.inspectVideoTeachReadiness ?? collectVideoTeachReadinessChecks;
	const browserConnectionMode = deps.resolveBrowserConnectionMode?.() ?? resolveConfiguredBrowserConnectionMode(params.config);
	const browserCdpUrl = deps.resolveBrowserCdpUrl?.() ?? resolveConfiguredBrowserCdpUrl(params.config);

	const browserManifest = runBrowserPreflight({
		profile: "assistant",
		toolNames: ["browser"],
	});
	const browserEnabled = browserManifest.toolAvailability.browser?.enabled !== false;
	const guiGrounding = await resolveGuiGrounding(params.config);
	const guiReadiness = await inspectGuiReadiness();
	const guiCapabilities = resolveGuiRuntimeCapabilities({
		platform: deps.platform,
		groundingAvailable: guiGrounding.available,
		environmentReadiness: guiReadiness,
	});
	const videoTeachChecks = await inspectVideoTeachReadiness(params.config);

	const checks: RuntimeReadinessCheck[] = [
		{
			id: "browser",
			label: "Browser Route",
			status: browserEnabled ? "ok" : "error",
				summary: browserEnabled
					? `Playwright available (${browserConnectionMode} mode)`
					: "Playwright missing",
				detail: browserEnabled
					? browserConnectionMode === "extension"
						? `Default browser mode uses extension relay via ${browserCdpUrl}.`
						: browserConnectionMode === "auto"
							? `Default browser mode prefers extension relay via ${browserCdpUrl} and falls back to managed Playwright.`
							: "Default browser mode uses managed Playwright."
					: browserManifest.toolAvailability.browser?.reason,
			},
		{
			id: "grounding",
			label: "GUI Grounding",
			status: guiCapabilities.platformSupported
				? guiGrounding.available
					? "ok"
					: "warn"
				: "warn",
			summary: guiGrounding.available
				? `Ready (${guiGrounding.label ?? "configured"})`
				: guiCapabilities.platformSupported
					? "No grounding provider configured"
					: "GUI route disabled on this platform",
			detail: !guiCapabilities.platformSupported
				? "Understudy hides macOS GUI tools on unsupported platforms instead of exposing unusable actions."
				: guiGrounding.available
					? "Full screenshot-grounded GUI actions are enabled."
					: guiCapabilities.enabledToolNames.length > 0
						? `Available GUI tools: ${guiCapabilities.enabledToolNames.join(", ")}. Grounded target actions stay hidden until grounding is configured.`
						: "GUI tools stay hidden until native helper and macOS permission blockers are resolved.",
		},
		...guiReadiness.checks.map((check) => ({
			id: check.id,
			label: check.label,
			status: mapGuiCheckStatus(check.status),
			summary: check.summary,
			detail: check.detail,
		})),
		...videoTeachChecks,
	];

	const relay = params.browserExtensionRelay;
	if (relay) {
		const connected = relay.extensionConnected();
		checks.push({
			id: "extension-relay",
			label: "Extension Relay",
			status: connected
				? "ok"
				: browserConnectionMode === "extension"
					? "error"
					: "warn",
			summary: connected
				? "Attached to a browser tab"
				: browserConnectionMode === "extension"
					? "Extension mode selected, but no browser tab is attached"
					: browserConnectionMode === "auto"
						? "Ready, waiting for browser tab (managed fallback stays available)"
						: "Ready, waiting for browser tab",
			detail: relay.baseUrl,
		});
	} else {
		checks.push({
			id: "extension-relay",
			label: "Extension Relay",
			status: browserConnectionMode === "extension" ? "error" : "warn",
			summary: browserConnectionMode === "extension"
				? "Extension relay not running"
				: browserConnectionMode === "auto"
					? "Extension relay not running; browser will fall back to managed"
					: "Relay not running",
			detail: browserConnectionMode === "extension"
				? `Browser extension mode is the default route, but the relay is unavailable at ${browserCdpUrl}.`
				: browserConnectionMode === "auto"
					? `Extension-first browser routing prefers ${browserCdpUrl}, but the relay is unavailable so managed Playwright will be used.`
					: "Browser extension mode will be unavailable until the local relay starts.",
		});
	}

	return {
		status: summarizeStatus(checks),
		generatedAt: now(),
		checks,
	};
}
