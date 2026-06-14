import { macosGuiPlatformBackend } from "./platform-macos.js";
import { windowsGuiPlatformBackend } from "./platform-windows.js";
import { GUI_UNSUPPORTED_MESSAGE } from "./platform-common.js";
import { GUI_TOOL_NAMES, type GuiToolName } from "./tool-names.js";
import type {
	GuiEnvironmentReadinessCheck,
	GuiEnvironmentReadinessSnapshot,
	GuiReadinessDeps,
} from "./readiness.js";
import type { GuiKeyParams, GuiTypeParams, GuiWindowSelector } from "./types.js";

export interface GuiPlatformRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface GuiPlatformCaptureContext {
	windowBounds?: GuiPlatformRect;
	windowTitle?: string;
}

export interface GuiPlatformScriptWindowSelection {
	title?: string;
	titleContains?: string;
	index?: number;
	bounds?: GuiPlatformRect;
}

export interface GuiPlatformRunAppleScriptParams {
	script: string;
	env: Record<string, string | undefined>;
	args?: string[];
	timeoutMs?: number;
	signal?: AbortSignal;
}

export interface GuiPlatformRunNativeHelperParams {
	command: "capture-context" | "event" | "cleanup" | "redact-host-windows";
	env: Record<string, string | undefined>;
	timeoutMs?: number;
	failureMessage: string;
	timeoutHint: string;
	signal?: AbortSignal;
}

export interface GuiPlatformInputDependencies {
	signal?: AbortSignal;
	resolveCaptureContext(
		appName: string | undefined,
		options?: {
			activateApp?: boolean;
			windowSelector?: GuiWindowSelector;
			signal?: AbortSignal;
		},
	): Promise<GuiPlatformCaptureContext>;
	createRequestedWindowNotFoundError(
		appName: string | undefined,
		windowSelection: GuiWindowSelector | undefined,
	): Error;
	runAppleScript(params: GuiPlatformRunAppleScriptParams): Promise<string>;
	runNativeHelper(params: GuiPlatformRunNativeHelperParams): Promise<string>;
}

export interface GuiPlatformInputAdapter {
	performType(
		params: GuiTypeParams,
		text: string,
		deps: GuiPlatformInputDependencies,
	): Promise<{ actionKind: string }>;
	performNativeType(
		params: GuiTypeParams,
		text: string,
		deps: GuiPlatformInputDependencies,
	): Promise<{ actionKind: string }>;
	performSystemEventsType(
		params: GuiTypeParams,
		text: string,
		strategy: "system_events_paste" | "system_events_keystroke" | "system_events_keystroke_chars",
		deps: GuiPlatformInputDependencies,
	): Promise<{ actionKind: string }>;
	performHotkey(
		params: GuiKeyParams,
		repeat: number,
		deps: GuiPlatformInputDependencies,
	): Promise<{ actionKind: string }>;
}

export interface GuiPlatformToolSupport {
	supported: boolean;
	reason?: string;
	targetlessOnly?: boolean;
	targetlessOnlyReason?: string;
}

export interface GuiPlatformBackend {
	id: string;
	supported: boolean;
	unsupportedMessage: string;
	toolSupport: Record<GuiToolName, GuiPlatformToolSupport>;
	input?: GuiPlatformInputAdapter;
	inspectReadiness(
		platform?: NodeJS.Platform,
		deps?: GuiReadinessDeps,
	): Promise<GuiEnvironmentReadinessSnapshot>;
}

export { GUI_UNSUPPORTED_MESSAGE };

export function buildGuiPlatformToolSupport(
	resolveSupport:
		| GuiPlatformToolSupport
		| ((toolName: GuiToolName) => GuiPlatformToolSupport),
): Record<GuiToolName, GuiPlatformToolSupport> {
	return Object.fromEntries(
		GUI_TOOL_NAMES.map((toolName) => [
			toolName,
			typeof resolveSupport === "function"
				? resolveSupport(toolName)
				: resolveSupport,
		]),
	) as Record<GuiToolName, GuiPlatformToolSupport>;
}

function buildUnsupportedCheck(platform: NodeJS.Platform): GuiEnvironmentReadinessCheck {
	return {
		id: "platform",
		label: "Platform",
		status: "unsupported",
		summary: "GUI runtime checks are not implemented for this platform.",
		detail: `Current platform: ${platform}`,
	};
}

const unsupportedGuiPlatformBackend: GuiPlatformBackend = {
	id: "unsupported",
	supported: false,
	unsupportedMessage: GUI_UNSUPPORTED_MESSAGE,
	toolSupport: buildGuiPlatformToolSupport({
		supported: false,
		reason: GUI_UNSUPPORTED_MESSAGE,
	}),
	async inspectReadiness(platform = process.platform, deps = {}) {
		return {
			status: "unsupported",
			checkedAt: deps.now?.() ?? Date.now(),
			checks: [buildUnsupportedCheck(platform)],
		};
	},
};

export function resolveGuiPlatformBackend(
	platform: NodeJS.Platform = process.platform,
): GuiPlatformBackend {
	switch (platform) {
		case "darwin":
			return macosGuiPlatformBackend;
		case "win32":
			return windowsGuiPlatformBackend;
		default:
			return unsupportedGuiPlatformBackend;
	}
}

export function isGuiPlatformSupported(platform: NodeJS.Platform = process.platform): boolean {
	return resolveGuiPlatformBackend(platform).supported;
}
