/**
 * Daemon mode — start/stop/status for background agent.
 * Also supports service installation for launchd (macOS) and systemd-user (Linux).
 */

import {
	existsSync,
	readFileSync,
	writeFileSync,
	unlinkSync,
	mkdirSync,
	openSync,
	closeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { resolveUnderstudyHomeDir } from "@understudy/core";

const PID_DIR = resolveUnderstudyHomeDir();
const PID_FILE = join(PID_DIR, "daemon.pid");
const LOG_FILE = join(PID_DIR, "daemon.log");
const LAUNCHD_LABEL = "com.understudy.daemon";
const SYSTEMD_SERVICE_NAME = "understudy-daemon.service";

interface DaemonOptions {
	start?: boolean;
	stop?: boolean;
	status?: boolean;
	port?: number;
	installService?: boolean;
	uninstallService?: boolean;
	serviceStatus?: boolean;
}

type ServiceSpec = {
	manager: "launchd" | "systemd";
	filePath: string;
	content: string;
	enableCommands: Array<{ command: string; args: string[]; allowFailure?: boolean }>;
	disableCommands: Array<{ command: string; args: string[]; allowFailure?: boolean }>;
	statusCommand?: { command: string; args: string[] };
};

function gatewayEntryPath(): string {
	return join(import.meta.dirname ?? ".", "..", "index.js");
}

export function renderLaunchdPlist(params: {
	label: string;
	nodePath: string;
	entryPath: string;
	port: number;
	logPath: string;
	cwd: string;
}): string {
	const args = [
		params.nodePath,
		"--enable-source-maps",
		params.entryPath,
		"gateway",
		"--port",
		String(params.port),
	];
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${params.label}</string>
	<key>ProgramArguments</key>
	<array>
${args.map((arg) => `		<string>${escapeXml(arg)}</string>`).join("\n")}
	</array>
	<key>WorkingDirectory</key>
	<string>${escapeXml(params.cwd)}</string>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>${escapeXml(params.logPath)}</string>
	<key>StandardErrorPath</key>
	<string>${escapeXml(params.logPath)}</string>
</dict>
</plist>
`;
}

export function renderSystemdUserUnit(params: {
	nodePath: string;
	entryPath: string;
	port: number;
	logPath: string;
	cwd: string;
}): string {
	const execStart = `${params.nodePath} --enable-source-maps ${params.entryPath} gateway --port ${params.port}`;
	return `[Unit]
Description=Understudy Gateway Daemon
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${params.cwd}
ExecStart=${execStart}
Restart=on-failure
RestartSec=3
StandardOutput=append:${params.logPath}
StandardError=append:${params.logPath}
Environment=UNDERSTUDY_DAEMON=1

[Install]
WantedBy=default.target
`;
}

export function resolveServiceSpecForPlatform(
	platform: NodeJS.Platform,
	params: {
		port: number;
		cwd: string;
		nodePath: string;
		entryPath: string;
		homeDir: string;
		uid?: number;
		logPath: string;
	},
): ServiceSpec | null {
	if (platform === "darwin") {
		const uid = params.uid ?? process.getuid?.();
		if (typeof uid !== "number") {
			throw new Error("Cannot resolve current uid for launchd service installation.");
		}
		const filePath = join(params.homeDir, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
		return {
			manager: "launchd",
			filePath,
			content: renderLaunchdPlist({
				label: LAUNCHD_LABEL,
				nodePath: params.nodePath,
				entryPath: params.entryPath,
				port: params.port,
				logPath: params.logPath,
				cwd: params.cwd,
			}),
			enableCommands: [
				{
					command: "launchctl",
					args: ["bootout", `gui/${uid}`, filePath],
					allowFailure: true,
				},
				{
					command: "launchctl",
					args: ["bootstrap", `gui/${uid}`, filePath],
				},
				{
					command: "launchctl",
					args: ["enable", `gui/${uid}/${LAUNCHD_LABEL}`],
					allowFailure: true,
				},
				{
					command: "launchctl",
					args: ["kickstart", "-k", `gui/${uid}/${LAUNCHD_LABEL}`],
					allowFailure: true,
				},
			],
			disableCommands: [
				{
					command: "launchctl",
					args: ["bootout", `gui/${uid}`, filePath],
					allowFailure: true,
				},
				{
					command: "launchctl",
					args: ["disable", `gui/${uid}/${LAUNCHD_LABEL}`],
					allowFailure: true,
				},
			],
			statusCommand: {
				command: "launchctl",
				args: ["print", `gui/${uid}/${LAUNCHD_LABEL}`],
			},
		};
	}

	if (platform === "linux") {
		const filePath = join(params.homeDir, ".config", "systemd", "user", SYSTEMD_SERVICE_NAME);
		return {
			manager: "systemd",
			filePath,
			content: renderSystemdUserUnit({
				nodePath: params.nodePath,
				entryPath: params.entryPath,
				port: params.port,
				logPath: params.logPath,
				cwd: params.cwd,
			}),
			enableCommands: [
				{ command: "systemctl", args: ["--user", "daemon-reload"], allowFailure: true },
				{ command: "systemctl", args: ["--user", "enable", "--now", SYSTEMD_SERVICE_NAME] },
			],
			disableCommands: [
				{ command: "systemctl", args: ["--user", "disable", "--now", SYSTEMD_SERVICE_NAME], allowFailure: true },
				{ command: "systemctl", args: ["--user", "daemon-reload"], allowFailure: true },
			],
			statusCommand: {
				command: "systemctl",
				args: ["--user", "status", "--no-pager", SYSTEMD_SERVICE_NAME],
			},
		};
	}

	return null;
}

export async function runDaemonCommand(opts: DaemonOptions = {}): Promise<void> {
	const parsedPort = Number.parseInt(String(opts.port ?? 23333), 10);
	const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 23333;

	if (opts.installService) {
		return installService(port);
	}
	if (opts.uninstallService) {
		return uninstallService(port);
	}
	if (opts.serviceStatus) {
		return showServiceStatus(port);
	}

	if (opts.stop) {
		return stopDaemon();
	}

	if (opts.status || (!opts.start && !opts.stop)) {
		return showStatus();
	}

	if (opts.start) {
		return startDaemon(port);
	}
}

function showStatus(): void {
	const pid = readPid();
	if (!pid) {
		console.log("Understudy daemon: not running");
		return;
	}

	if (isProcessRunning(pid)) {
		console.log(`Understudy daemon: running (PID ${pid})`);
		console.log(`Log file: ${LOG_FILE}`);
	} else {
		console.log("Understudy daemon: not running (stale PID file)");
		cleanupPidFile();
	}
}

async function startDaemon(port: number): Promise<void> {
	const existingPid = readPid();
	if (existingPid && isProcessRunning(existingPid)) {
		console.log(`Understudy daemon already running (PID ${existingPid})`);
		return;
	}

	if (!existsSync(PID_DIR)) {
		mkdirSync(PID_DIR, { recursive: true });
	}
	const logFd = openSync(LOG_FILE, "a");

	const child = spawn(
		process.execPath,
		[
			"--enable-source-maps",
			gatewayEntryPath(),
			"gateway",
			"--port",
			String(port),
		],
		{
			detached: true,
			stdio: ["ignore", logFd, logFd],
			env: { ...process.env, UNDERSTUDY_DAEMON: "1" },
		},
	);
	closeSync(logFd);

	if (child.pid) {
		writePid(child.pid);
		child.unref();
		console.log(`Understudy daemon started (PID ${child.pid}, port ${port})`);
		console.log(`Log file: ${LOG_FILE}`);
	} else {
		console.error("Failed to start daemon");
	}
}

function stopDaemon(): void {
	const pid = readPid();
	if (!pid) {
		console.log("Understudy daemon is not running");
		return;
	}

	if (isProcessRunning(pid)) {
		try {
			process.kill(pid, "SIGTERM");
			console.log(`Stopped Understudy daemon (PID ${pid})`);
		} catch (error) {
			console.error(`Failed to stop daemon: ${error instanceof Error ? error.message : String(error)}`);
		}
	} else {
		console.log("Daemon was not running (stale PID file)");
	}

	cleanupPidFile();
}

function installService(port: number): void {
	const spec = resolveServiceSpecForPlatform(process.platform, {
		port,
		cwd: process.cwd(),
		nodePath: process.execPath,
		entryPath: gatewayEntryPath(),
		homeDir: homedir(),
		uid: process.getuid?.(),
		logPath: LOG_FILE,
	});
	if (!spec) {
		console.error(`Service install is not supported on platform: ${process.platform}`);
		return;
	}

	mkdirSync(dirname(spec.filePath), { recursive: true });
	if (!existsSync(PID_DIR)) {
		mkdirSync(PID_DIR, { recursive: true });
	}
	writeFileSync(spec.filePath, spec.content, "utf8");

	let failed = false;
	for (const cmd of spec.enableCommands) {
		const ok = runSystemCommand(cmd.command, cmd.args, cmd.allowFailure === true);
		if (!ok && cmd.allowFailure !== true) {
			failed = true;
		}
	}

	if (failed) {
		console.error(`Service file created but activation failed. File: ${spec.filePath}`);
		return;
	}
	console.log(`Understudy ${spec.manager} service installed and activated.`);
	console.log(`Service file: ${spec.filePath}`);
}

function uninstallService(port: number): void {
	const spec = resolveServiceSpecForPlatform(process.platform, {
		port,
		cwd: process.cwd(),
		nodePath: process.execPath,
		entryPath: gatewayEntryPath(),
		homeDir: homedir(),
		uid: process.getuid?.(),
		logPath: LOG_FILE,
	});
	if (!spec) {
		console.error(`Service uninstall is not supported on platform: ${process.platform}`);
		return;
	}

	for (const cmd of spec.disableCommands) {
		runSystemCommand(cmd.command, cmd.args, true);
	}

	if (existsSync(spec.filePath)) {
		unlinkSync(spec.filePath);
	}

	console.log(`Understudy ${spec.manager} service removed.`);
}

function showServiceStatus(port: number): void {
	const spec = resolveServiceSpecForPlatform(process.platform, {
		port,
		cwd: process.cwd(),
		nodePath: process.execPath,
		entryPath: gatewayEntryPath(),
		homeDir: homedir(),
		uid: process.getuid?.(),
		logPath: LOG_FILE,
	});
	if (!spec) {
		console.log(`Service status is not supported on platform: ${process.platform}`);
		return;
	}

	if (!existsSync(spec.filePath)) {
		console.log(`Understudy ${spec.manager} service: not installed`);
		return;
	}
	console.log(`Understudy ${spec.manager} service file: ${spec.filePath}`);

	if (spec.statusCommand) {
		runSystemCommand(spec.statusCommand.command, spec.statusCommand.args, true, true);
	}
}

function runSystemCommand(
	command: string,
	args: string[],
	allowFailure: boolean,
	echoOutput = false,
): boolean {
	try {
		const output = execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
		if (echoOutput && output.trim()) {
			console.log(output.trim());
		}
		return true;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!allowFailure) {
			console.error(`Command failed: ${command} ${args.join(" ")}\n${message}`);
		} else if (echoOutput) {
			console.log(`Command failed: ${command} ${args.join(" ")}\n${message}`);
		}
		return false;
	}
}

function readPid(): number | null {
	if (!existsSync(PID_FILE)) return null;
	try {
		const content = readFileSync(PID_FILE, "utf-8").trim();
		const pid = parseInt(content, 10);
		return Number.isNaN(pid) ? null : pid;
	} catch {
		return null;
	}
}

function writePid(pid: number): void {
	writeFileSync(PID_FILE, String(pid), "utf-8");
}

function cleanupPidFile(): void {
	try {
		if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
	} catch {
		// ignore
	}
}

function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
