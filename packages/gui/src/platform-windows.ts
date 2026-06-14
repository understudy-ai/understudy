import { execFileAsync } from "./exec-utils.js";
import type { GuiPlatformBackend } from "./platform.js";
import { GUI_UNSUPPORTED_MESSAGE, resolveSnapshotStatus } from "./platform-common.js";
import { windowsGuiPlatformInputAdapter } from "./platform-windows-input.js";
import type { GuiEnvironmentReadinessCheck } from "./readiness.js";
import { GUI_TOOL_NAMES } from "./tool-names.js";

async function checkPowerShellAvailable(command: string): Promise<string> {
	const result = await execFileAsync(
		command,
		[
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-Command",
			"$PSVersionTable.PSVersion.ToString()",
		],
		{
			timeout: 5_000,
			maxBuffer: 512 * 1024,
			encoding: "utf-8",
		},
	);
	return result.stdout.trim();
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

export const windowsGuiPlatformBackend: GuiPlatformBackend = {
	id: "windows",
	supported: true,
	unsupportedMessage: GUI_UNSUPPORTED_MESSAGE,
	toolSupport: Object.fromEntries(
		GUI_TOOL_NAMES.map((toolName) => {
			switch (toolName) {
				case "gui_observe":
				case "gui_wait":
				case "gui_key":
				case "gui_click":
				case "gui_drag":
				case "gui_scroll":
				case "gui_move":
				case "gui_type":
					return [toolName, { supported: true }];
				default:
					return [
						toolName,
						{
							supported: false,
							reason: GUI_UNSUPPORTED_MESSAGE,
						},
					];
			}
		}),
	) as GuiPlatformBackend["toolSupport"],
	input: windowsGuiPlatformInputAdapter,
	async inspectReadiness(_platform = process.platform, deps = {}) {
		const checkedAt = deps.now?.() ?? Date.now();
		const checks: GuiEnvironmentReadinessCheck[] = [
			{
				id: "platform",
				label: "Platform",
				status: "ok",
				summary: "Windows GUI runtime is available on this host.",
			},
			{
				id: "accessibility",
				label: "Accessibility",
				status: "ok",
				summary: "Windows GUI input does not require a separate accessibility permission check.",
			},
			{
				id: "screen_recording",
				label: "Screen Recording",
				status: "ok",
				summary: "Windows PowerShell screenshot capture is available.",
			},
		];

		const configuredCommand = process.env.UNDERSTUDY_GUI_WINDOWS_POWERSHELL?.trim() || "powershell.exe";
		try {
			const version = await checkPowerShellAvailable(configuredCommand);
			checks.push({
				id: "native_helper",
				label: "Native GUI Helper",
				status: "ok",
				summary: "Windows PowerShell GUI input adapter is ready.",
				detail: `${configuredCommand}${version ? ` (${version})` : ""}`,
			});
		} catch (error) {
			checks.push({
				id: "native_helper",
				label: "Native GUI Helper",
				status: "error",
				summary: "Windows PowerShell GUI input adapter is unavailable.",
				detail: formatExecError(error),
			});
		}

		return {
			status: resolveSnapshotStatus(checks),
			checkedAt,
			checks,
		};
	},
};
