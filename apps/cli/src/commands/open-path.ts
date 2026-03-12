import { execFile } from "node:child_process";

export interface OpenPathResult {
	ok: boolean;
	command: string;
	args: string[];
	error?: string;
}

interface OpenPathCommand {
	command: string;
	args: string[];
}

const CHROMIUM_APP_NAMES = [
	"Google Chrome",
	"Google Chrome Canary",
	"Chromium",
	"Arc",
];

export function resolveOpenExternalPathAttempts(
	target: string,
	platform: NodeJS.Platform = process.platform,
): OpenPathCommand[] {
	if (platform === "darwin") {
		if (target.trim().toLowerCase().startsWith("chrome://")) {
			return [
				...CHROMIUM_APP_NAMES.map((appName) => ({
					command: "open",
					args: ["-a", appName, target],
				})),
				{ command: "open", args: [target] },
			];
		}
		return [{ command: "open", args: [target] }];
	}

	if (platform === "win32") {
		return [{ command: "cmd.exe", args: ["/c", "start", "", target] }];
	}

	return [{ command: "xdg-open", args: [target] }];
}

async function runOpenCommand(command: OpenPathCommand): Promise<OpenPathResult> {
	return await new Promise((resolve) => {
		execFile(command.command, command.args, (error) => {
			if (error) {
				resolve({
					ok: false,
					command: command.command,
					args: command.args,
					error: error.message,
				});
				return;
			}
			resolve({
				ok: true,
				command: command.command,
				args: command.args,
			});
		});
	});
}

export async function openExternalPath(target: string): Promise<OpenPathResult> {
	const attempts = resolveOpenExternalPathAttempts(target);
	let lastResult: OpenPathResult | undefined;
	for (const attempt of attempts) {
		const result = await runOpenCommand(attempt);
		if (result.ok) {
			return result;
		}
		lastResult = result;
	}
	return lastResult ?? {
		ok: false,
		command: "",
		args: [],
		error: "No open command could be resolved.",
	};
}
