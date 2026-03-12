/**
 * Doctor command: diagnostic checks for Understudy installation health.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { ConfigManager, resolveUnderstudyHomeDir } from "@understudy/core";
import { createRpcClient } from "../rpc-client.js";
import { resolveMemoryDbPath } from "./gateway-support.js";
import { collectSetupChecklist, formatSetupChecklist, type SetupChecklistItem } from "./setup-checklist.js";

interface DoctorOptions {
	repair?: boolean;
	force?: boolean;
	deep?: boolean;
}

interface CheckResult {
	name: string;
	status: "ok" | "warn" | "error";
	message: string;
}

function summarizeChecklist(items: SetupChecklistItem[]): CheckResult {
	const errors = items.filter((item) => item.status === "error").length;
	const warnings = items.filter((item) => item.status === "warn").length;
	const oks = items.length - errors - warnings;
	return {
		name: "Setup checklist",
		status: errors > 0 ? "error" : warnings > 0 ? "warn" : "ok",
		message: `${oks} ok, ${warnings} warnings, ${errors} errors`,
	};
}

function summarizeReadiness(checks: Array<{ status?: unknown }>): CheckResult["status"] {
	if (checks.some((check) => check.status === "error")) {
		return "error";
	}
	if (checks.some((check) => check.status === "warn")) {
		return "warn";
	}
	return "ok";
}

export async function runDoctorCommand(opts: DoctorOptions = {}): Promise<void> {
	console.log("Understudy Doctor — running diagnostics...\n");
	const results: CheckResult[] = [];

	const nodeVersion = process.versions.node;
	const major = parseInt(nodeVersion.split(".")[0], 10);
	results.push({
		name: "Node.js version",
		status: major >= 20 ? "ok" : "error",
		message: major >= 20 ? `v${nodeVersion}` : `v${nodeVersion} (requires >= 20)`,
	});

	const homeDir = resolveUnderstudyHomeDir();
	const configPath = join(homeDir, "config.json5");
	const configExists = existsSync(configPath);
	results.push({
		name: "Config file",
		status: configExists ? "ok" : "warn",
		message: configExists ? configPath : `Not found at ${configPath}. Run 'understudy wizard' to create it.`,
	});

	let configManager: ConfigManager | null = null;
	if (configExists || opts.repair) {
		try {
			configManager = await ConfigManager.load(configPath);
			if (!configExists && opts.repair) {
				configManager.save();
				results.push({
					name: "Config repair",
					status: "ok",
					message: `Created default config at ${configPath}`,
				});
			} else {
				results.push({
					name: "Config validity",
					status: "ok",
					message: "Valid",
				});
			}
		} catch (error) {
			results.push({
				name: "Config validity",
				status: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	results.push({
		name: "Home directory",
		status: existsSync(homeDir) ? "ok" : "warn",
		message: existsSync(homeDir) ? homeDir : `Not found: ${homeDir}`,
	});

	let setupChecklist: SetupChecklistItem[] = [];
	if (configManager) {
		setupChecklist = await collectSetupChecklist(configManager.get());
		results.push(summarizeChecklist(setupChecklist));
		if (opts.deep) {
			const memoryDbPath = resolveMemoryDbPath(configManager.get());
			results.push({
				name: "Memory database",
				status: existsSync(memoryDbPath) ? "ok" : "warn",
				message: existsSync(memoryDbPath) ? memoryDbPath : `${memoryDbPath} (will be created on first use)`,
			});
		}
	}

	try {
		const client = createRpcClient();
		const health = await client.health();
		results.push({
			name: "Gateway",
			status: "ok",
			message: `Running (${health.status})`,
		});
		if (opts.deep) {
			try {
				const readiness = await client.call<{
					status?: string;
					checks?: Array<{ label?: string; summary?: string; status?: string }>;
				}>("runtime.readiness", {});
				const checks = Array.isArray(readiness.checks) ? readiness.checks : [];
				results.push({
					name: "Gateway readiness",
					status: checks.length > 0
						? summarizeReadiness(checks)
						: readiness.status === "error"
							? "error"
							: readiness.status === "warn"
								? "warn"
								: "ok",
					message: checks.length > 0
						? `${checks.length} runtime checks`
						: `status=${readiness.status ?? "unknown"}`,
				});
				if (checks.length > 0) {
					console.log("Gateway readiness:");
					for (const check of checks) {
						const prefix = check.status === "error"
							? "[ERR]"
							: check.status === "warn"
								? "[WARN]"
								: "[OK]";
						console.log(`  ${prefix} ${check.label ?? "check"}: ${check.summary ?? ""}`.trimEnd());
					}
					console.log("");
				}
			} catch (error) {
				results.push({
					name: "Gateway readiness",
					status: "warn",
					message: error instanceof Error ? error.message : String(error),
				});
			}
		}
	} catch {
		results.push({
			name: "Gateway",
			status: "warn",
			message: "Not reachable (may not be running)",
		});
	}

	for (const result of results) {
		const icon = result.status === "ok" ? "[OK]" : result.status === "warn" ? "[WARN]" : "[ERR]";
		console.log(`  ${icon} ${result.name}: ${result.message}`);
	}

	if (opts.deep && setupChecklist.length > 0) {
		console.log("\nLocal setup checklist:");
		console.log(formatSetupChecklist(setupChecklist));
	}

	const errors = results.filter((result) => result.status === "error");
	const warnings = results.filter((result) => result.status === "warn");
	console.log(`\n${results.length} checks: ${results.length - errors.length - warnings.length} ok, ${warnings.length} warnings, ${errors.length} errors`);

	if (errors.length > 0) {
		process.exitCode = 1;
	}
}
