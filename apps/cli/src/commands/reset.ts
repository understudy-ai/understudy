/**
 * Reset command: delete config, credentials, sessions, or full state.
 */

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ConfigManager, resolveUnderstudyHomeDir } from "@understudy/core";
import { resolveMemoryDbPath } from "./gateway-support.js";

interface ResetOptions {
	scope?: string;
	dryRun?: boolean;
	force?: boolean;
}

export async function runResetCommand(opts: ResetOptions = {}): Promise<void> {
	const homeDir = resolveUnderstudyHomeDir();
	const scope = opts.scope ?? "sessions";
	let memoryDbPath = join(homeDir, "memory.db");
	try {
		memoryDbPath = resolveMemoryDbPath((await ConfigManager.load()).get());
	} catch {
		// Fall back to the default latest path when config is unreadable.
	}

	const targets: Array<{ label: string; path: string }> = [];

	switch (scope) {
		case "config":
			targets.push({ label: "Configuration", path: join(homeDir, "config.json5") });
			break;
		case "sessions":
			targets.push({ label: "Sessions", path: join(homeDir, "sessions") });
			break;
		case "memory":
			targets.push({ label: "Memory DB", path: memoryDbPath });
			break;
		case "credentials":
			targets.push({ label: "Credentials", path: join(homeDir, ".env") });
			break;
		case "all":
		case "full":
			targets.push(
				{ label: "Configuration", path: join(homeDir, "config.json5") },
				{ label: "Sessions", path: join(homeDir, "sessions") },
				{ label: "Memory DB", path: memoryDbPath },
				{ label: "Lock file", path: join(homeDir, "gateway.lock") },
				{ label: "Daemon log", path: join(homeDir, "daemon.log") },
			);
			break;
		default:
			console.error(`Unknown scope: ${scope}. Use: config, sessions, memory, credentials, all`);
			process.exitCode = 1;
			return;
	}

	const existing = targets.filter((t) => existsSync(t.path));
	if (existing.length === 0) {
		console.log("Nothing to reset.");
		return;
	}

	console.log(`Will delete (scope: ${scope}):`);
	for (const t of existing) {
		console.log(`  ${t.label}: ${t.path}`);
	}

	if (opts.dryRun) {
		console.log("\n(dry run — no changes made)");
		return;
	}

	if (!opts.force) {
		console.log("\nUse --force to confirm deletion.");
		return;
	}

	for (const t of existing) {
		try {
			rmSync(t.path, { recursive: true, force: true });
			console.log(`  Deleted: ${t.label}`);
		} catch (error) {
			console.error(`  Error deleting ${t.label}:`, error instanceof Error ? error.message : String(error));
		}
	}
	console.log("Reset complete.");
}
