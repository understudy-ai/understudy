import type {
	GuiPlatformInputAdapter,
	GuiPlatformInputDependencies,
	GuiPlatformScriptWindowSelection,
} from "./platform.js";
import type { GuiWindowSelector } from "./types.js";

const DEFAULT_NATIVE_TYPE_CLEAR_REPEAT = 48;
const DEFAULT_SYSTEM_EVENTS_PASTE_PRE_DELAY_MS = 220;
const DEFAULT_SYSTEM_EVENTS_PASTE_POST_DELAY_MS = 650;
const DEFAULT_SYSTEM_EVENTS_KEYSTROKE_CHAR_DELAY_MS = 55;

const COMMON_KEY_CODES: Record<string, number> = {
	enter: 36,
	return: 36,
	tab: 48,
	escape: 53,
	esc: 53,
	delete: 51,
	backspace: 51,
	home: 115,
	pageup: 116,
	pagedown: 121,
	end: 119,
	up: 126,
	arrowup: 126,
	down: 125,
	arrowdown: 125,
	left: 123,
	arrowleft: 123,
	right: 124,
	arrowright: 124,
	space: 49,
	spacebar: 49,
};

function normalizeOptionalString(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function normalizeWindowSelector(
	value: GuiWindowSelector | undefined,
): GuiWindowSelector | undefined {
	if (!value) {
		return undefined;
	}
	const title = normalizeOptionalString(value.title);
	const titleContains = normalizeOptionalString(value.titleContains);
	const floored =
		typeof value.index === "number" && Number.isFinite(value.index)
			? Math.floor(value.index)
			: -1;
	const index = floored > 0 ? floored : undefined;
	if (!title && !titleContains && !index) {
		return undefined;
	}
	return {
		title,
		titleContains,
		index,
	};
}

function resolveWindowSelection(params: {
	windowTitle?: string;
	windowSelector?: GuiWindowSelector;
}): GuiWindowSelector | undefined {
	const selector = normalizeWindowSelector(params.windowSelector);
	const explicitTitle = normalizeOptionalString(params.windowTitle);
	if (!selector && !explicitTitle) {
		return undefined;
	}
	return {
		title: explicitTitle ?? selector?.title,
		titleContains: selector?.titleContains,
		index: selector?.index,
	};
}

function buildWindowSelectionEnv(
	windowSelection: Pick<GuiPlatformScriptWindowSelection, "title" | "titleContains" | "index"> | undefined,
): Record<string, string | undefined> {
	return {
		UNDERSTUDY_GUI_WINDOW_TITLE: windowSelection?.title,
		UNDERSTUDY_GUI_WINDOW_TITLE_CONTAINS: windowSelection?.titleContains,
		UNDERSTUDY_GUI_WINDOW_INDEX: windowSelection?.index ? String(windowSelection.index) : undefined,
	};
}

function buildWindowBoundsEnv(
	bounds: GuiPlatformScriptWindowSelection["bounds"] | undefined,
): Record<string, string | undefined> {
	return {
		UNDERSTUDY_GUI_WINDOW_BOUNDS_X: bounds ? String(bounds.x) : undefined,
		UNDERSTUDY_GUI_WINDOW_BOUNDS_Y: bounds ? String(bounds.y) : undefined,
		UNDERSTUDY_GUI_WINDOW_BOUNDS_WIDTH: bounds ? String(bounds.width) : undefined,
		UNDERSTUDY_GUI_WINDOW_BOUNDS_HEIGHT: bounds ? String(bounds.height) : undefined,
	};
}

function buildScriptWindowSelectionEnv(
	windowSelection: GuiPlatformScriptWindowSelection | undefined,
): Record<string, string | undefined> {
	return {
		...buildWindowSelectionEnv(windowSelection),
		...buildWindowBoundsEnv(windowSelection?.bounds),
	};
}

function normalizeHotkeyKeyName(key: string): string {
	return key.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

async function resolveScriptWindowSelection(
	params: {
		appName?: string;
		windowTitle?: string;
		windowSelector?: GuiWindowSelector;
	},
	deps: GuiPlatformInputDependencies,
): Promise<GuiPlatformScriptWindowSelection | undefined> {
	const windowSelection = resolveWindowSelection({
		windowTitle: params.windowTitle,
		windowSelector: params.windowSelector,
	});
	if (!windowSelection) {
		return undefined;
	}
	const context = await deps.resolveCaptureContext(params.appName, {
		activateApp: false,
		windowSelector: windowSelection,
	});
	if (!context.windowBounds) {
		throw deps.createRequestedWindowNotFoundError(params.appName, windowSelection);
	}
	const resolvedTitle = normalizeOptionalString(context.windowTitle);
	return {
		title: resolvedTitle ?? windowSelection.title,
		titleContains: resolvedTitle ? undefined : windowSelection.titleContains,
		bounds: context.windowBounds,
	};
}

const WINDOW_SELECTION_SCRIPT_HELPERS = String.raw`
on absoluteDifference(lhsValue, rhsValue)
	if lhsValue >= rhsValue then return lhsValue - rhsValue
	return rhsValue - lhsValue
end absoluteDifference

on textContains(haystack, needle)
	if needle is "" then return true
	ignoring case
			return (offset of needle in haystack) is not 0
	end ignoring
end textContains

on windowMatchesBounds(candidateWindow, boundsXText, boundsYText, boundsWidthText, boundsHeightText)
	if boundsXText is "" or boundsYText is "" or boundsWidthText is "" or boundsHeightText is "" then return true
	try
		set {windowX, windowY} to position of candidateWindow
		set {windowWidth, windowHeight} to size of candidateWindow
	on error
		return false
	end try
	set tolerance to 3
	return (my absoluteDifference(windowX as integer, boundsXText as integer) is less than or equal to tolerance) and (my absoluteDifference(windowY as integer, boundsYText as integer) is less than or equal to tolerance) and (my absoluteDifference(windowWidth as integer, boundsWidthText as integer) is less than or equal to tolerance) and (my absoluteDifference(windowHeight as integer, boundsHeightText as integer) is less than or equal to tolerance)
end windowMatchesBounds

on matchingWindows(targetProc, exactTitle, titleContains, boundsXText, boundsYText, boundsWidthText, boundsHeightText)
	set matches to {}
	repeat with candidateWindow in windows of targetProc
		set windowTitle to ""
		try
			set windowTitle to name of candidateWindow as text
		end try
		set exactMatch to true
		if exactTitle is not "" then
			ignoring case
				set exactMatch to windowTitle is exactTitle
			end ignoring
		end if
		set containsMatch to my textContains(windowTitle, titleContains)
		set boundsMatch to my windowMatchesBounds(candidateWindow, boundsXText, boundsYText, boundsWidthText, boundsHeightText)
		if exactMatch and containsMatch and boundsMatch then set end of matches to candidateWindow
	end repeat
	return matches
end matchingWindows

on focusRequestedWindow(targetProc, exactTitle, titleContains, windowIndexText, boundsXText, boundsYText, boundsWidthText, boundsHeightText)
	if exactTitle is "" and titleContains is "" and windowIndexText is "" and boundsXText is "" and boundsYText is "" and boundsWidthText is "" and boundsHeightText is "" then return
	set matches to my matchingWindows(targetProc, exactTitle, titleContains, boundsXText, boundsYText, boundsWidthText, boundsHeightText)
	if (count of matches) is 0 then error "Window not found for the requested selection."
	set targetWindow to item 1 of matches
	if windowIndexText is not "" then
		set requestedIndex to windowIndexText as integer
		if requestedIndex < 1 or requestedIndex > (count of matches) then error "Requested window index is out of range."
		set targetWindow to item requestedIndex of matches
	end if
	tell application "System Events"
		try
			tell targetWindow to perform action "AXRaise"
		end try
		try
			tell targetWindow to set value of attribute "AXMain" to true
		end try
		try
			tell targetWindow to set value of attribute "AXFocused" to true
		end try
	end tell
	delay 0.1
end focusRequestedWindow
`;

const TYPE_SCRIPT = String.raw`
${WINDOW_SELECTION_SCRIPT_HELPERS}

on normalizedDelaySeconds(delayMsText, fallbackSeconds)
	if delayMsText is "" then return fallbackSeconds
	try
		set candidateMs to delayMsText as integer
		if candidateMs < 0 then return fallbackSeconds
		return candidateMs / 1000
	on error
		return fallbackSeconds
	end try
end normalizedDelaySeconds

on normalizedRepeatCount(repeatText, fallbackCount)
	if repeatText is "" then return fallbackCount
	try
		set candidateCount to repeatText as integer
		if candidateCount < 0 then return fallbackCount
		return candidateCount
	on error
		return fallbackCount
	end try
end normalizedRepeatCount

on pasteText(rawText, preDelaySeconds, postDelaySeconds)
	set previousClipboard to missing value
	set hadClipboard to false
	try
		set previousClipboard to the clipboard
		set hadClipboard to true
	end try

	try
		set the clipboard to rawText
		delay preDelaySeconds
		tell application "System Events"
			keystroke "v" using command down
		end tell
		delay postDelaySeconds
	on error errMsg number errNum
		if hadClipboard then
			try
				set the clipboard to previousClipboard
			end try
		end if
		error errMsg number errNum
	end try

	if hadClipboard then
		try
			set the clipboard to previousClipboard
		end try
	end if
end pasteText

on clearWithBackspace(repeatCount)
	if repeatCount <= 0 then return
	tell application "System Events"
		repeat repeatCount times
			key code 51
			delay 0.02
		end repeat
	end tell
end clearWithBackspace

on enterText(rawText, entryStrategy, preDelaySeconds, postDelaySeconds)
	if entryStrategy is "keystroke" then
		tell application "System Events"
			keystroke rawText
		end tell
		delay postDelaySeconds
		return
	end if
	if entryStrategy is "keystroke_chars" then
		set keyDelayMsText to system attribute "UNDERSTUDY_GUI_KEYSTROKE_CHAR_DELAY_MS"
		set keyDelaySeconds to my normalizedDelaySeconds(keyDelayMsText, 0.055)
		tell application "System Events"
			repeat with currentCharacter in characters of rawText
				set typedCharacter to contents of currentCharacter
				if typedCharacter is return or typedCharacter is linefeed then
					key code 36
				else
					keystroke typedCharacter
				end if
				delay keyDelaySeconds
			end repeat
		end tell
		delay postDelaySeconds
		return
	end if
	my pasteText(rawText, preDelaySeconds, postDelaySeconds)
end enterText

on run argv
	set requestedApp to system attribute "UNDERSTUDY_GUI_APP"
	set requestedWindowTitle to system attribute "UNDERSTUDY_GUI_WINDOW_TITLE"
	set requestedWindowTitleContains to system attribute "UNDERSTUDY_GUI_WINDOW_TITLE_CONTAINS"
	set requestedWindowIndex to system attribute "UNDERSTUDY_GUI_WINDOW_INDEX"
	set requestedWindowBoundsX to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_X"
	set requestedWindowBoundsY to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_Y"
	set requestedWindowBoundsWidth to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_WIDTH"
	set requestedWindowBoundsHeight to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_HEIGHT"
	set replaceText to system attribute "UNDERSTUDY_GUI_REPLACE"
	set submitText to system attribute "UNDERSTUDY_GUI_SUBMIT"
	set inlineInputText to system attribute "UNDERSTUDY_GUI_TEXT"
	set systemEventsTypeStrategy to system attribute "UNDERSTUDY_GUI_SYSTEM_EVENTS_TYPE_STRATEGY"
	set clearRepeatText to system attribute "UNDERSTUDY_GUI_CLEAR_REPEAT"
	set pastePreDelayMsText to system attribute "UNDERSTUDY_GUI_PASTE_PRE_DELAY_MS"
	set pastePostDelayMsText to system attribute "UNDERSTUDY_GUI_PASTE_POST_DELAY_MS"
	set inputText to inlineInputText
	if inputText is "" and (count of argv) > 0 then set inputText to item 1 of argv
	set preDelaySeconds to my normalizedDelaySeconds(pastePreDelayMsText, 0.15)
	set postDelaySeconds to my normalizedDelaySeconds(pastePostDelayMsText, 0.25)
	set replaceRepeatCount to my normalizedRepeatCount(clearRepeatText, 48)
	tell application "System Events"
		if requestedApp is not "" then
			if not (exists application process requestedApp) then error "Application process not found: " & requestedApp
			set targetProc to application process requestedApp
			set frontmost of targetProc to true
			delay 0.1
		else
			set targetProc to first application process whose frontmost is true
		end if
		my focusRequestedWindow(targetProc, requestedWindowTitle, requestedWindowTitleContains, requestedWindowIndex, requestedWindowBoundsX, requestedWindowBoundsY, requestedWindowBoundsWidth, requestedWindowBoundsHeight)

		if replaceText is "1" then
			if systemEventsTypeStrategy is "keystroke" or clearRepeatText is not "" then
				my clearWithBackspace(replaceRepeatCount)
			else
				keystroke "a" using command down
			end if
		end if
		my enterText(inputText, systemEventsTypeStrategy, preDelaySeconds, postDelaySeconds)
		if submitText is "1" then key code 36
		return "typed"
	end tell
end run
`;

const HOTKEY_SCRIPT = String.raw`
${WINDOW_SELECTION_SCRIPT_HELPERS}

on buildModifierList(rawText)
	set modifierList to {}
	if rawText contains "command" then copy command down to end of modifierList
	if rawText contains "shift" then copy shift down to end of modifierList
	if rawText contains "option" then copy option down to end of modifierList
	if rawText contains "control" then copy control down to end of modifierList
	return modifierList
end buildModifierList

set requestedApp to system attribute "UNDERSTUDY_GUI_APP"
set requestedWindowTitle to system attribute "UNDERSTUDY_GUI_WINDOW_TITLE"
set requestedWindowTitleContains to system attribute "UNDERSTUDY_GUI_WINDOW_TITLE_CONTAINS"
set requestedWindowIndex to system attribute "UNDERSTUDY_GUI_WINDOW_INDEX"
set requestedWindowBoundsX to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_X"
set requestedWindowBoundsY to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_Y"
set requestedWindowBoundsWidth to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_WIDTH"
set requestedWindowBoundsHeight to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_HEIGHT"
set keyText to system attribute "UNDERSTUDY_GUI_KEY"
set keyCodeText to system attribute "UNDERSTUDY_GUI_KEY_CODE"
set modifiersText to system attribute "UNDERSTUDY_GUI_MODIFIERS"
set repeatText to system attribute "UNDERSTUDY_GUI_REPEAT"
set modifierList to my buildModifierList(modifiersText)
set repeatCount to 1
if repeatText is not "" then
	set repeatCandidate to repeatText as integer
	if repeatCandidate > 0 then set repeatCount to repeatCandidate
end if

tell application "System Events"
	if requestedApp is not "" then
		if not (exists application process requestedApp) then error "Application process not found: " & requestedApp
		set targetProc to application process requestedApp
		set frontmost of targetProc to true
		delay 0.1
	else
		set targetProc to first application process whose frontmost is true
	end if
	my focusRequestedWindow(targetProc, requestedWindowTitle, requestedWindowTitleContains, requestedWindowIndex, requestedWindowBoundsX, requestedWindowBoundsY, requestedWindowBoundsWidth, requestedWindowBoundsHeight)

	if keyCodeText is not "" then
		repeat repeatCount times
			if (count of modifierList) is 0 then
				key code (keyCodeText as integer)
			else
				key code (keyCodeText as integer) using modifierList
			end if
			delay 0.03
		end repeat
		return "key_code"
	end if

	repeat repeatCount times
		if (count of modifierList) is 0 then
			keystroke keyText
		else
			keystroke keyText using modifierList
		end if
		delay 0.03
	end repeat
	return "keystroke"
end tell
`;

export const macosGuiPlatformInputAdapter: GuiPlatformInputAdapter = {
	async performType(params, text, deps) {
		const windowSelection = await resolveScriptWindowSelection({
			appName: params.app,
			windowTitle: params.windowTitle,
			windowSelector: params.windowSelector,
		}, deps);
		const actionKind = await deps.runAppleScript({
			script: TYPE_SCRIPT,
			env: {
				UNDERSTUDY_GUI_APP: params.app?.trim(),
				...buildScriptWindowSelectionEnv(windowSelection),
				UNDERSTUDY_GUI_REPLACE: params.replace === false ? "0" : "1",
				UNDERSTUDY_GUI_SUBMIT: params.submit ? "1" : "0",
			},
			args: [text],
		});
		return { actionKind };
	},

	async performNativeType(params, text, deps) {
		const typeStrategy = params.typeStrategy;
		const needsClearRepeat = typeStrategy && params.replace !== false;
		const actionKind = await deps.runNativeHelper({
			command: "event",
			env: {
				UNDERSTUDY_GUI_APP: params.app?.trim(),
				UNDERSTUDY_GUI_EVENT_MODE: "type_text",
				UNDERSTUDY_GUI_TEXT: text,
				UNDERSTUDY_GUI_REPLACE: params.replace === false ? "0" : "1",
				UNDERSTUDY_GUI_SUBMIT: params.submit ? "1" : "0",
				UNDERSTUDY_GUI_TYPE_STRATEGY: typeStrategy,
				UNDERSTUDY_GUI_CLEAR_REPEAT: needsClearRepeat
					? String(DEFAULT_NATIVE_TYPE_CLEAR_REPEAT)
					: undefined,
			},
			failureMessage:
				"macOS native GUI event dispatch failed. Ensure the required macOS GUI control permissions are granted.",
			timeoutHint: "The GUI helper timed out while sending native input events.",
		});
		return { actionKind };
	},

	async performSystemEventsType(params, text, strategy, deps) {
		const windowSelection = await resolveScriptWindowSelection({
			appName: params.app,
			windowTitle: params.windowTitle,
			windowSelector: params.windowSelector,
		}, deps);
		const actionKind = await deps.runAppleScript({
			script: TYPE_SCRIPT,
			env: {
				UNDERSTUDY_GUI_APP: params.app?.trim(),
				...buildScriptWindowSelectionEnv(windowSelection),
				UNDERSTUDY_GUI_REPLACE: params.replace === false ? "0" : "1",
				UNDERSTUDY_GUI_SUBMIT: params.submit ? "1" : "0",
				UNDERSTUDY_GUI_TEXT: text,
				UNDERSTUDY_GUI_SYSTEM_EVENTS_TYPE_STRATEGY:
					strategy === "system_events_keystroke"
						? "keystroke"
						: strategy === "system_events_keystroke_chars"
							? "keystroke_chars"
							: "paste",
				UNDERSTUDY_GUI_CLEAR_REPEAT:
					params.replace === false ? undefined : String(DEFAULT_NATIVE_TYPE_CLEAR_REPEAT),
				UNDERSTUDY_GUI_PASTE_PRE_DELAY_MS: String(DEFAULT_SYSTEM_EVENTS_PASTE_PRE_DELAY_MS),
				UNDERSTUDY_GUI_PASTE_POST_DELAY_MS: String(DEFAULT_SYSTEM_EVENTS_PASTE_POST_DELAY_MS),
				UNDERSTUDY_GUI_KEYSTROKE_CHAR_DELAY_MS:
					strategy === "system_events_keystroke_chars"
						? String(DEFAULT_SYSTEM_EVENTS_KEYSTROKE_CHAR_DELAY_MS)
						: undefined,
			},
		});
		return { actionKind };
	},

	async performHotkey(params, repeat, deps) {
		const windowSelection = await resolveScriptWindowSelection({
			appName: params.app,
			windowTitle: params.windowTitle,
			windowSelector: params.windowSelector,
		}, deps);
		const normalizedKey = normalizeHotkeyKeyName(params.key);
		const keyCode = COMMON_KEY_CODES[normalizedKey];
		const actionKind = await deps.runAppleScript({
			script: HOTKEY_SCRIPT,
			env: {
				UNDERSTUDY_GUI_APP: params.app?.trim(),
				...buildScriptWindowSelectionEnv(windowSelection),
				UNDERSTUDY_GUI_KEY: keyCode ? "" : params.key,
				UNDERSTUDY_GUI_KEY_CODE: keyCode ? String(keyCode) : "",
				UNDERSTUDY_GUI_MODIFIERS: (params.modifiers ?? [])
					.map((modifier) => modifier.trim().toLowerCase())
					.filter(Boolean)
					.join(","),
				UNDERSTUDY_GUI_REPEAT: String(Math.max(1, repeat)),
			},
		});
		return { actionKind };
	},
};
