#!/usr/bin/env node

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const requiredEntries = [
	"package/understudy.mjs",
	"package/README.md",
	"package/LICENSE",
	"package/dist/index.js",
	"package/skills/coding-agent/SKILL.md",
];

const forbiddenEntries = [
	"package/.env",
];

const forbiddenPrefixes = [
	"package/tests/",
	"package/packages/",
	"package/apps/cli/",
	"package/coverage/",
	"package/node_modules/",
	"package/tmp/",
	"package/AGENTS.md",
	"package/REUSE_",
];

const forbiddenBundleImports = [
	"@understudy/types",
	"@understudy/core",
	"@understudy/channels",
	"@understudy/gateway",
	"@understudy/gui",
	"@understudy/plugins",
	"@understudy/tools",
];

const forbiddenEntryPatterns = [
	/^package\/skills\/.+\/scripts\/test_[^/]+$/i,
	/^package\/skills\/.+\/__pycache__\//i,
];

function createSanitizedEnv() {
	const env = { ...process.env };
	delete env.npm_config_verify_deps_before_run;
	delete env.NPM_CONFIG_VERIFY_DEPS_BEFORE_RUN;
	return env;
}

async function main() {
	const packDir = await mkdtemp(path.join(os.tmpdir(), "understudy-pack-"));
	try {
		const { stdout } = await execFile(
			"npm",
			["pack", "--json", "--pack-destination", packDir],
			{ cwd: repoRoot, env: createSanitizedEnv(), maxBuffer: 20 * 1024 * 1024 },
		);
		const jsonMatch = stdout.match(/(\[\s*\{[\s\S]*\}\s*\])\s*$/);
		if (!jsonMatch) {
			throw new Error("npm pack did not emit JSON output");
		}
		const packInfo = JSON.parse(jsonMatch[1]);
		const tarballName = packInfo[0]?.filename;
		if (typeof tarballName !== "string" || tarballName.length === 0) {
			throw new Error("npm pack did not return a tarball filename");
		}
		const tarballPath = path.join(packDir, tarballName);
		const { stdout: tarStdout } = await execFile("tar", ["-tf", tarballPath], {
			cwd: repoRoot,
			maxBuffer: 20 * 1024 * 1024,
		});
		const entries = tarStdout.split("\n").map((line) => line.trim()).filter(Boolean);
		const { stdout: bundledEntry } = await execFile("tar", ["-xOf", tarballPath, "package/dist/index.js"], {
			cwd: repoRoot,
			maxBuffer: 20 * 1024 * 1024,
		});

		for (const entry of requiredEntries) {
			if (!entries.includes(entry)) {
				throw new Error(`Missing required packed entry: ${entry}`);
			}
		}

		for (const entry of forbiddenEntries) {
			if (entries.includes(entry)) {
				throw new Error(`Forbidden packed entry present: ${entry}`);
			}
		}

		for (const prefix of forbiddenPrefixes) {
			const hit = entries.find((entry) => entry === prefix || entry.startsWith(prefix));
			if (hit) {
				throw new Error(`Forbidden packed entry present: ${hit}`);
			}
		}

		for (const pattern of forbiddenEntryPatterns) {
			const hit = entries.find((entry) => pattern.test(entry));
			if (hit) {
				throw new Error(`Forbidden packed entry present: ${hit}`);
			}
		}

		for (const specifier of forbiddenBundleImports) {
			if (bundledEntry.includes(`"${specifier}"`) || bundledEntry.includes(`'${specifier}'`)) {
				throw new Error(`Packed dist/index.js still references internal workspace import: ${specifier}`);
			}
		}

		console.log(`Pack OK: ${tarballName}`);
		console.log(`Entries checked: ${entries.length}`);
	} finally {
		await rm(packDir, { recursive: true, force: true });
	}
}

await main();
