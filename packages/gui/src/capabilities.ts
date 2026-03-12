import type { GuiEnvironmentReadinessSnapshot } from "./readiness.js";
import { GUI_UNSUPPORTED_MESSAGE } from "./runtime.js";

export type GuiToolName =
	| "gui_read"
	| "gui_click"
	| "gui_right_click"
	| "gui_double_click"
	| "gui_hover"
	| "gui_click_and_hold"
	| "gui_drag"
	| "gui_scroll"
	| "gui_type"
	| "gui_keypress"
	| "gui_hotkey"
	| "gui_screenshot"
	| "gui_wait";

export interface GuiToolCapability {
	enabled: boolean;
	reason?: string;
	targetlessOnly?: boolean;
}

export interface GuiRuntimeCapabilitySnapshot {
	platformSupported: boolean;
	groundingAvailable: boolean;
	nativeHelperAvailable: boolean;
	screenCaptureAvailable: boolean;
	inputAvailable: boolean;
	enabledToolNames: GuiToolName[];
	disabledToolNames: GuiToolName[];
	toolAvailability: Record<GuiToolName, GuiToolCapability>;
}

const GUI_TOOL_NAMES: GuiToolName[] = [
	"gui_read",
	"gui_click",
	"gui_right_click",
	"gui_double_click",
	"gui_hover",
	"gui_click_and_hold",
	"gui_drag",
	"gui_scroll",
	"gui_type",
	"gui_keypress",
	"gui_hotkey",
	"gui_screenshot",
	"gui_wait",
];

const GUI_TOOLS_ALWAYS_AVAILABLE: GuiToolName[] = [
	"gui_keypress",
	"gui_hotkey",
];

const GUI_TOOLS_TARGETLESS_WITHOUT_GROUNDING: GuiToolName[] = [
	"gui_read",
	"gui_scroll",
	"gui_type",
	"gui_screenshot",
];

const GUI_TOOLS_REQUIRING_GROUNDING: GuiToolName[] = [
	"gui_click",
	"gui_right_click",
	"gui_double_click",
	"gui_hover",
	"gui_click_and_hold",
	"gui_drag",
	"gui_wait",
];

const GUI_TOOLS_REQUIRING_INPUT: GuiToolName[] = [
	"gui_click",
	"gui_right_click",
	"gui_double_click",
	"gui_hover",
	"gui_click_and_hold",
	"gui_drag",
	"gui_scroll",
	"gui_type",
	"gui_keypress",
	"gui_hotkey",
];

const GUI_TOOLS_REQUIRING_SCREEN_CAPTURE: GuiToolName[] = [
	"gui_read",
	"gui_click",
	"gui_right_click",
	"gui_double_click",
	"gui_hover",
	"gui_click_and_hold",
	"gui_drag",
	"gui_screenshot",
	"gui_wait",
];

const GUI_GROUNDING_REQUIRED_REASON =
	"Visual grounding is not configured, so grounding-based GUI actions (click, drag, hover, etc.) are unavailable. " +
	"Keyboard-only tools (gui_keypress, gui_hotkey) and targetless gui_type still work.";
const GUI_TARGETLESS_ONLY_REASON =
	"Visual grounding is not configured, so this tool only supports targetless usage (omit the `target` parameter). " +
	"It will operate on the current surface or focused control.";
const GUI_NATIVE_HELPER_REQUIRED_REASON =
	"Native GUI helper is unavailable, so GUI tools cannot run. Verify the helper binary is installed and accessible.";
const GUI_ACCESSIBILITY_REQUIRED_REASON =
	"Accessibility permission is not granted, so GUI input actions (click, type, scroll, drag, etc.) are unavailable. " +
	"GUI observation tools (gui_read, gui_screenshot) may still work. " +
	"Grant Accessibility permission in System Settings > Privacy & Security > Accessibility.";
const GUI_SCREEN_CAPTURE_REQUIRED_REASON =
	"Screen Recording permission is not granted, so screenshot-based GUI actions are unavailable. " +
	"Keyboard-only tools (gui_keypress, gui_hotkey) still work. " +
	"Grant Screen Recording permission in System Settings > Privacy & Security > Screen Recording.";
const GUI_SCREEN_CAPTURE_TARGETLESS_ONLY_REASON =
	"Screen Recording permission is not granted, so this tool only supports targetless usage (omit the `target` parameter). " +
	"Keyboard-only tools (gui_keypress, gui_hotkey) still work.";

function resolveReadinessCheckStatus(
	snapshot: GuiEnvironmentReadinessSnapshot | undefined,
	checkId: string,
): GuiEnvironmentReadinessSnapshot["checks"][number]["status"] | undefined {
	return snapshot?.checks.find((check) => check.id === checkId)?.status;
}

export function resolveGuiRuntimeCapabilities(params: {
	platform?: NodeJS.Platform;
	groundingAvailable?: boolean;
	environmentReadiness?: GuiEnvironmentReadinessSnapshot;
} = {}): GuiRuntimeCapabilitySnapshot {
	const platformSupported = (params.platform ?? process.platform) === "darwin";
	const groundingAvailable = params.groundingAvailable === true;
	const nativeHelperAvailable = platformSupported
		&& resolveReadinessCheckStatus(params.environmentReadiness, "native_helper") !== "error";
	const inputAvailable = nativeHelperAvailable
		&& resolveReadinessCheckStatus(params.environmentReadiness, "accessibility") !== "error";
	const screenCaptureAvailable = nativeHelperAvailable
		&& resolveReadinessCheckStatus(params.environmentReadiness, "screen_recording") !== "error";
	const toolAvailability = Object.fromEntries(
		GUI_TOOL_NAMES.map((toolName) => {
			if (!platformSupported) {
				return [toolName, { enabled: false, reason: GUI_UNSUPPORTED_MESSAGE }];
			}
			if (!nativeHelperAvailable) {
				return [toolName, { enabled: false, reason: GUI_NATIVE_HELPER_REQUIRED_REASON }];
			}
			if (GUI_TOOLS_REQUIRING_INPUT.includes(toolName) && !inputAvailable) {
				return [toolName, { enabled: false, reason: GUI_ACCESSIBILITY_REQUIRED_REASON }];
			}
			if (GUI_TOOLS_REQUIRING_SCREEN_CAPTURE.includes(toolName) && !screenCaptureAvailable) {
				return [toolName, { enabled: false, reason: GUI_SCREEN_CAPTURE_REQUIRED_REASON }];
			}
			if (!screenCaptureAvailable && GUI_TOOLS_TARGETLESS_WITHOUT_GROUNDING.includes(toolName)) {
				return [
					toolName,
					{
						enabled: true,
						targetlessOnly: true,
						reason: GUI_SCREEN_CAPTURE_TARGETLESS_ONLY_REASON,
					},
				];
			}
			if (GUI_TOOLS_ALWAYS_AVAILABLE.includes(toolName)) {
				return [toolName, { enabled: true }];
			}
			if (groundingAvailable) {
				return [toolName, { enabled: true }];
			}
			if (GUI_TOOLS_TARGETLESS_WITHOUT_GROUNDING.includes(toolName)) {
				return [
					toolName,
					{
						enabled: true,
						targetlessOnly: true,
						reason: GUI_TARGETLESS_ONLY_REASON,
					},
				];
			}
			if (GUI_TOOLS_REQUIRING_GROUNDING.includes(toolName)) {
				return [toolName, { enabled: false, reason: GUI_GROUNDING_REQUIRED_REASON }];
			}
			return [toolName, { enabled: true }];
		}),
	) as Record<GuiToolName, GuiToolCapability>;

	const enabledToolNames = GUI_TOOL_NAMES.filter((toolName) => toolAvailability[toolName].enabled);
	const disabledToolNames = GUI_TOOL_NAMES.filter((toolName) => !toolAvailability[toolName].enabled);
	return {
		platformSupported,
		groundingAvailable,
		nativeHelperAvailable,
		screenCaptureAvailable,
		inputAvailable,
		enabledToolNames,
		disabledToolNames,
		toolAvailability,
	};
}
