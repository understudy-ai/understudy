#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function createSanitizedEnv() {
	const env = { ...process.env };
	delete env.npm_config_verify_deps_before_run;
	delete env.NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN;
	return env;
}

const child = spawn("npm", ["pack", "--dry-run"], {
	cwd: repoRoot,
	stdio: "inherit",
	env: createSanitizedEnv(),
});

child.on("exit", (code, signal) => {
	if (signal) {
		process.exit(1);
	}
	process.exit(code ?? 1);
});
