#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const WATCH_DIRS = ["apps", "packages"];
const WATCH_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".js", ".mjs", ".json"]);
const DIST_ENTRY = path.join("apps", "cli", "dist", "index.js");

function statMtime(filePath) {
	try {
		return statSync(filePath).mtimeMs;
	} catch {
		return null;
	}
}

function findLatestSourceMtime(rootPath) {
	const stack = [rootPath];
	let latest = null;

	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) continue;
		let entries = [];
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "dist" || entry.name === "node_modules" || entry.name === ".git") {
					continue;
				}
				stack.push(fullPath);
				continue;
			}
			if (!entry.isFile()) continue;
			if (!WATCH_EXTENSIONS.has(path.extname(entry.name))) continue;
			const mtime = statMtime(fullPath);
			if (mtime == null) continue;
			if (latest == null || mtime > latest) {
				latest = mtime;
			}
		}
	}

	return latest;
}

function shouldBuild(cwd) {
	if (process.env.UNDERSTUDY_FORCE_BUILD === "1") {
		return true;
	}
	const distEntryPath = path.join(cwd, DIST_ENTRY);
	const distMtime = statMtime(distEntryPath);
	if (distMtime == null) {
		return true;
	}

	const packageJsonMtime = statMtime(path.join(cwd, "package.json"));
	if (packageJsonMtime != null && packageJsonMtime > distMtime) {
		return true;
	}

	for (const dir of WATCH_DIRS) {
		const latestSource = findLatestSourceMtime(path.join(cwd, dir));
		if (latestSource != null && latestSource > distMtime) {
			return true;
		}
	}

	return false;
}

function spawnAndWait(command, args, options = {}) {
	const child = spawn(command, args, {
		stdio: "inherit",
		...options,
	});
	return new Promise((resolve) => {
		child.on("exit", (code, signal) => resolve({ code, signal }));
	});
}

function normalizeForwardedArgs(args) {
	if (args[0] === "--") {
		return args.slice(1);
	}
	return args;
}

export async function runNodeMain(params = {}) {
	const cwd = params.cwd ?? process.cwd();
	const args = normalizeForwardedArgs(params.args ?? process.argv.slice(2));
	const env = params.env ? { ...params.env } : { ...process.env };
	const execPath = params.execPath ?? process.execPath;
	const platform = params.platform ?? process.platform;

	if (shouldBuild(cwd)) {
		process.stderr.write("[understudy] Building TypeScript (dist is stale).\n");
		const buildCommand = platform === "win32" ? "cmd.exe" : "pnpm";
		const buildArgs = platform === "win32" ? ["/d", "/s", "/c", "pnpm", "build"] : ["build"];
		const buildResult = await spawnAndWait(buildCommand, buildArgs, { cwd, env });
		if (buildResult.signal) return 1;
		if (buildResult.code !== 0 && buildResult.code !== null) return buildResult.code;
	}

	const runResult = await spawnAndWait(execPath, ["understudy.mjs", ...args], { cwd, env });
	if (runResult.signal) return 1;
	return runResult.code ?? 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	void runNodeMain()
		.then((code) => process.exit(code))
		.catch((error) => {
			console.error(error);
			process.exit(1);
		});
}
