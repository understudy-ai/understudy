#!/usr/bin/env node

import { accessSync, constants } from "node:fs";
import { spawn } from "node:child_process";
import { delimiter, isAbsolute, join } from "node:path";

const separatorIndex = process.argv.indexOf("--");
const assignmentArgs = separatorIndex >= 0 ? process.argv.slice(2, separatorIndex) : process.argv.slice(2);
const commandArgs = separatorIndex >= 0 ? process.argv.slice(separatorIndex + 1) : [];

if (commandArgs.length === 0) {
	console.error("Usage: node scripts/run-with-env.mjs KEY=value [KEY2=value ...] -- <command> [args...]");
	process.exit(1);
}

const env = { ...process.env };
for (const assignment of assignmentArgs) {
	const delimiterIndex = assignment.indexOf("=");
	if (delimiterIndex <= 0) {
		console.error(`Invalid environment assignment: ${assignment}`);
		process.exit(1);
	}
	const key = assignment.slice(0, delimiterIndex);
	const value = assignment.slice(delimiterIndex + 1);
	env[key] = value;
}

function isExecutable(path) {
	try {
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function candidateExecutableNames(command) {
	if (process.platform !== "win32") {
		return [command];
	}
	const pathExt = (env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
		.split(";")
		.map((entry) => entry.trim())
		.filter(Boolean);
	const lowerCommand = command.toLowerCase();
	const hasKnownExtension = pathExt.some((ext) => lowerCommand.endsWith(ext.toLowerCase()));
	return hasKnownExtension ? [command] : [command, ...pathExt.map((ext) => `${command}${ext.toLowerCase()}`)];
}

function resolveCommand(command) {
	if (!command) {
		return command;
	}
	const hasPathSeparator = command.includes("/") || command.includes("\\");
	if (hasPathSeparator || isAbsolute(command)) {
		return command;
	}
	const pathEntries = (env.PATH || "")
		.split(delimiter)
		.map((entry) => entry.trim())
		.filter(Boolean);
	for (const pathEntry of pathEntries) {
		for (const candidateName of candidateExecutableNames(command)) {
			const candidatePath = join(pathEntry, candidateName);
			if (isExecutable(candidatePath)) {
				return candidatePath;
			}
		}
	}
	return command;
}

const resolvedCommand = resolveCommand(commandArgs[0]);
const child = spawn(resolvedCommand, commandArgs.slice(1), {
	cwd: process.cwd(),
	env,
	stdio: "inherit",
});

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 0);
});

child.on("error", (error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
