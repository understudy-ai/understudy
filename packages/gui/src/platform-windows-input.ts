import { execFileAsync } from "./exec-utils.js";
import type {
	GuiPlatformInputAdapter,
	GuiPlatformInputDependencies,
} from "./platform.js";
import type { GuiKeyParams, GuiTypeParams, GuiWindowSelector } from "./types.js";

const WINDOWS_SENDKEY_SPECIALS = /[+^%~()[\]{}]/g;
const WINDOWS_TYPE_SETTLE_MS = 120;
const WINDOWS_HOTKEY_SETTLE_MS = 40;

function resolvePowerShellCommand(): string {
	const configured = process.env.UNDERSTUDY_GUI_WINDOWS_POWERSHELL?.trim();
	return configured || "powershell.exe";
}

function normalizeOptionalString(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function resolveActivationTarget(params: {
	app?: string;
	windowTitle?: string;
	windowSelector?: GuiWindowSelector;
}): string | undefined {
	const selector = params.windowSelector;
	if (selector?.index !== undefined) {
		throw new Error(
			"Windows GUI input currently supports app or window-title activation only; window index selection is not implemented yet.",
		);
	}
	return normalizeOptionalString(
		params.windowTitle
		?? selector?.title
		?? selector?.titleContains
		?? params.app,
	);
}

function escapeWindowsSendKeys(text: string): string {
	return text
		.replace(/\r/g, "")
		.replace(/\n/g, "{ENTER}")
		.replace(WINDOWS_SENDKEY_SPECIALS, (value) => {
			switch (value) {
				case "{":
					return "{{}";
				case "}":
					return "{}}";
				default:
					return `{${value}}`;
			}
		});
}

function normalizeModifier(modifier: string): string {
	return modifier.trim().toLowerCase();
}

function buildWindowsHotkeySequence(params: GuiKeyParams): string {
	const modifierPrefix = (params.modifiers ?? [])
		.map(normalizeModifier)
		.map((modifier) => {
			switch (modifier) {
				case "ctrl":
				case "control":
					return "^";
				case "alt":
				case "option":
					return "%";
				case "shift":
					return "+";
				case "meta":
				case "cmd":
				case "command":
				case "win":
				case "windows":
					throw new Error(
						`Windows GUI key input does not support the ${modifier} modifier yet.`,
					);
				default:
					throw new Error(
						`Unsupported GUI key modifier "${modifier}" for Windows input.`,
					);
			}
		})
		.join("");

	const normalizedKey = params.key.trim().toLowerCase();
	const keyText = (() => {
		switch (normalizedKey) {
			case "enter":
			case "return":
				return "{ENTER}";
			case "tab":
				return "{TAB}";
			case "escape":
			case "esc":
				return "{ESC}";
			case "delete":
				return "{DEL}";
			case "backspace":
				return "{BACKSPACE}";
			case "home":
				return "{HOME}";
			case "end":
				return "{END}";
			case "pageup":
				return "{PGUP}";
			case "pagedown":
				return "{PGDN}";
			case "up":
			case "arrowup":
				return "{UP}";
			case "down":
			case "arrowdown":
				return "{DOWN}";
			case "left":
			case "arrowleft":
				return "{LEFT}";
			case "right":
			case "arrowright":
				return "{RIGHT}";
			case "space":
			case "spacebar":
				return " ";
			default:
				if (/^f([1-9]|1[0-6])$/.test(normalizedKey)) {
					return `{${normalizedKey.toUpperCase()}}`;
				}
				if (params.key.length === 1) {
					return escapeWindowsSendKeys(params.key);
				}
				throw new Error(
					`Unsupported GUI key "${params.key}" for Windows input.`,
				);
		}
	})();

	return `${modifierPrefix}${keyText}`;
}

async function runWindowsPowerShell(params: {
	script: string;
	env: Record<string, string | undefined>;
	failureMessage: string;
	signal?: AbortSignal;
}): Promise<string> {
	try {
		const result = await execFileAsync(
			resolvePowerShellCommand(),
			[
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-Command",
				params.script,
			],
				{
					env: {
						...process.env,
						...params.env,
					},
					timeout: 10_000,
					signal: params.signal,
					maxBuffer: 2 * 1024 * 1024,
					encoding: "utf-8",
				},
		);
		return result.stdout.trim() || "powershell_gui_input";
	} catch (error) {
		const record = error as {
			message?: string;
			stderr?: string;
			stdout?: string;
		};
		const details = [record.stderr, record.stdout]
			.map((value) => (typeof value === "string" ? value.trim() : ""))
			.filter(Boolean)
			.join(" ");
		throw new Error(
			[params.failureMessage, record.message ?? String(error), details]
				.filter(Boolean)
				.join(" ")
				.trim(),
		);
	}
}

const WINDOWS_TYPE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$activateTarget = $env:UNDERSTUDY_GUI_ACTIVATE_TARGET
$wshell = New-Object -ComObject WScript.Shell
if ($activateTarget) {
	if (-not $wshell.AppActivate($activateTarget)) {
		throw "Could not activate a window matching '$activateTarget'."
	}
	Start-Sleep -Milliseconds 120
}
if ($env:UNDERSTUDY_GUI_REPLACE -eq '1') {
	$wshell.SendKeys('^a')
	Start-Sleep -Milliseconds 40
}
if ($env:UNDERSTUDY_GUI_TYPE_MODE -eq 'clipboard') {
	Set-Clipboard -Value $env:UNDERSTUDY_GUI_TEXT
	Start-Sleep -Milliseconds 40
	$wshell.SendKeys('^v')
	$actionKind = 'powershell_clipboard_paste'
} else {
	$wshell.SendKeys($env:UNDERSTUDY_GUI_SENDKEYS_TEXT)
	$actionKind = 'powershell_sendkeys'
}
if ($env:UNDERSTUDY_GUI_SUBMIT -eq '1') {
	Start-Sleep -Milliseconds 40
	$wshell.SendKeys('{ENTER}')
	$actionKind = "$actionKind+submit"
}
Start-Sleep -Milliseconds 120
Write-Output $actionKind
`;

const WINDOWS_HOTKEY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$activateTarget = $env:UNDERSTUDY_GUI_ACTIVATE_TARGET
$wshell = New-Object -ComObject WScript.Shell
if ($activateTarget) {
	if (-not $wshell.AppActivate($activateTarget)) {
		throw "Could not activate a window matching '$activateTarget'."
	}
	Start-Sleep -Milliseconds 120
}
$repeat = [Math]::Max(1, [int]$env:UNDERSTUDY_GUI_REPEAT)
for ($i = 0; $i -lt $repeat; $i++) {
	$wshell.SendKeys($env:UNDERSTUDY_GUI_SENDKEYS_HOTKEY)
	Start-Sleep -Milliseconds 40
}
Write-Output 'powershell_hotkey'
`;

async function performWindowsType(
	params: GuiTypeParams,
	text: string,
	typeMode: "clipboard" | "sendkeys",
	signal?: AbortSignal,
): Promise<{ actionKind: string }> {
	const activationTarget = resolveActivationTarget(params);
	const actionKind = await runWindowsPowerShell({
		script: WINDOWS_TYPE_SCRIPT,
		env: {
			UNDERSTUDY_GUI_ACTIVATE_TARGET: activationTarget,
			UNDERSTUDY_GUI_REPLACE: params.replace === false ? "0" : "1",
			UNDERSTUDY_GUI_SUBMIT: params.submit ? "1" : "0",
			UNDERSTUDY_GUI_TYPE_MODE: typeMode,
			UNDERSTUDY_GUI_TEXT: text,
			UNDERSTUDY_GUI_SENDKEYS_TEXT: escapeWindowsSendKeys(text),
			UNDERSTUDY_GUI_SETTLE_MS: String(WINDOWS_TYPE_SETTLE_MS),
		},
		failureMessage:
			"Windows GUI text input failed. Ensure the target window is available and PowerShell input dispatch is allowed.",
		signal,
	});
	return { actionKind };
}

export const windowsGuiPlatformInputAdapter: GuiPlatformInputAdapter = {
	async performType(params, text, deps) {
		return await performWindowsType(params, text, "clipboard", deps.signal);
	},

	async performNativeType(params, text, deps) {
		const typeMode = params.typeStrategy === "physical_keys" ? "sendkeys" : "clipboard";
		return await performWindowsType(params, text, typeMode, deps.signal);
	},

	async performSystemEventsType(params, text, _strategy, deps) {
		return await performWindowsType(params, text, "sendkeys", deps.signal);
	},

	async performHotkey(params, repeat, deps: GuiPlatformInputDependencies) {
		const actionKind = await runWindowsPowerShell({
			script: WINDOWS_HOTKEY_SCRIPT,
			env: {
				UNDERSTUDY_GUI_ACTIVATE_TARGET: resolveActivationTarget(params),
				UNDERSTUDY_GUI_REPEAT: String(Math.max(1, repeat)),
				UNDERSTUDY_GUI_SENDKEYS_HOTKEY: buildWindowsHotkeySequence(params),
				UNDERSTUDY_GUI_SETTLE_MS: String(WINDOWS_HOTKEY_SETTLE_MS),
			},
			failureMessage:
				"Windows GUI key input failed. Ensure the target window is available and PowerShell input dispatch is allowed.",
			signal: deps.signal,
		});
		return { actionKind };
	},
};
