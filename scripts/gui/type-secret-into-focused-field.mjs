#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ComputerUseGuiRuntime } from "../../packages/gui/dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

function readFlag(name, fallback = "") {
	const prefix = `--${name}=`;
	const arg = process.argv.slice(2).find((entry) => entry.startsWith(prefix));
	if (!arg) {
		return process.env[`UNDERSTUDY_${name.replace(/-/g, "_").toUpperCase()}`]?.trim() || fallback;
	}
	return arg.slice(prefix.length).trim() || fallback;
}

function readBooleanFlag(name, fallback) {
	const raw = readFlag(name, fallback ? "1" : "0").toLowerCase();
	return !(raw === "0" || raw === "false" || raw === "no");
}

function timestampSlug() {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

function defaultEnvCandidates() {
	return [
		resolve(repoRoot, ".env"),
		resolve(repoRoot, "..", ".env"),
		resolve(repoRoot, "..", "understudy", ".env"),
	];
}

async function hydrateSecretEnvVar(secretEnvVar, explicitEnvFile) {
	if (process.env[secretEnvVar]?.trim()) {
		return;
	}
	const candidates = explicitEnvFile
		? [resolve(explicitEnvFile)]
		: defaultEnvCandidates();
	const pattern = new RegExp(`^${secretEnvVar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=(.*)$`, "m");
	for (const candidate of candidates) {
		if (!existsSync(candidate)) {
			continue;
		}
		const match = pattern.exec(await readFile(candidate, "utf8"));
		if (!match) {
			continue;
		}
		process.env[secretEnvVar] = match[1];
		return;
	}
}

const app = readFlag("app", "iPhone Mirroring");
const literalValue = readFlag("value", "");
const secretEnvVar = readFlag("secret-env-var", "UNDERSTUDY_APPLE_ID_PASSWORD");
const envFile = readFlag("env-file", "");
const typeStrategy = readFlag("type-strategy", "system_events_keystroke_chars");
const replace = readBooleanFlag("replace", false);
const submit = readBooleanFlag("submit", false);
const outputDir = resolve(
	readFlag("output-dir", join(repoRoot, ".understudy", "manual-gui", `secret-type-${timestampSlug()}`)),
);

if (!literalValue) {
	await hydrateSecretEnvVar(secretEnvVar, envFile);
}
await mkdir(outputDir, { recursive: true });

const runtime = new ComputerUseGuiRuntime();
const typeParams = literalValue
	? {
		app,
		value: literalValue,
		typeStrategy,
		replace,
		submit,
		captureMode: "window",
	}
	: {
		app,
		secretEnvVar,
		typeStrategy,
		replace,
		submit,
		captureMode: "window",
	};
const result = await runtime.type({
	app,
	...typeParams,
});

const imagePath = result.image?.data
	? join(outputDir, result.image.filename || "typed-after.png")
	: undefined;
if (imagePath && result.image) {
	await writeFile(imagePath, Buffer.from(result.image.data, "base64"));
}

const summaryPath = join(outputDir, "result.json");
const summary = {
	capturedAt: new Date().toISOString(),
	app,
	inputSource: literalValue ? "literal_value" : "secret_env",
	valueLength: literalValue ? literalValue.length : undefined,
	secretEnvVar: literalValue ? undefined : secretEnvVar,
	typeStrategy,
	replace,
	submit,
	status: result.status,
	text: result.text,
	details: result.details,
	imagePath,
};
await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
