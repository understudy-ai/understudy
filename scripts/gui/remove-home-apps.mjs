#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ComputerUseGuiRuntime } from "../../packages/gui/dist/index.js";

const execFileAsync = promisify(execFileCallback);

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const app = "iPhone Mirroring";

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

function statusCode(result) {
	return result?.status?.code ?? "";
}

function actionSucceeded(result) {
	return statusCode(result) === "action_sent";
}

function conditionMet(result) {
	return statusCode(result) === "condition_met";
}

function targetResolved(result) {
	return statusCode(result) === "resolved";
}

function uniqueNonEmpty(values) {
	const seen = new Set();
	const result = [];
	for (const raw of values) {
		const value = String(raw || "").trim();
		if (!value) {
			continue;
		}
		const key = value.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(value);
	}
	return result;
}

async function readJsonIfExists(path) {
	if (!existsSync(path)) {
		return undefined;
	}
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch {
		return undefined;
	}
}

async function recentManifestAppNames(limit = 4) {
	const runsDir = resolve(repoRoot, ".understudy", "playbook-runs");
	if (!existsSync(runsDir)) {
		return [];
	}
	const manifests = await readdir(runsDir, { withFileTypes: true }).catch(() => []);
	const candidates = [];
	for (const entry of manifests) {
		if (!entry.isDirectory() || !entry.name.startsWith("run_")) {
			continue;
		}
		const manifestPath = join(runsDir, entry.name, "artifacts", "manifest.json");
		const manifestStat = await stat(manifestPath).catch(() => undefined);
		if (!manifestStat) {
			continue;
		}
		candidates.push({ manifestPath, mtimeMs: manifestStat.mtimeMs });
	}
	candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
	const names = [];
	for (const candidate of candidates) {
		const data = await readJsonIfExists(candidate.manifestPath);
		const name = data?.selectedApp?.name;
		if (name) {
			names.push(name);
		}
		if (names.length >= limit) {
			break;
		}
	}
	return uniqueNonEmpty(names);
}

async function activateMirroringHome() {
	await execFileAsync("osascript", [
		"-e",
		'tell application "iPhone Mirroring" to activate',
		"-e",
		"delay 0.2",
		"-e",
		'tell application "System Events" to keystroke "1" using command down',
	]);
}

async function clickFirst(runtime, targets, extra = {}) {
	let lastResult;
	for (const target of targets) {
		const result = await runtime.click({
			app,
			target,
			captureMode: "window",
			...extra,
		});
		lastResult = { target, result };
		if (actionSucceeded(result)) {
			return { ok: true, target, result };
		}
	}
	return { ok: false, ...lastResult };
}

async function rightClickFirst(runtime, targets, extra = {}) {
	let lastResult;
	for (const target of targets) {
		const result = await runtime.click({
			app,
			target,
			button: "right",
			captureMode: "window",
			...extra,
		});
		lastResult = { target, result };
		if (actionSucceeded(result)) {
			return { ok: true, target, result };
		}
	}
	return { ok: false, ...lastResult };
}

async function resolveFirst(runtime, targets) {
	let lastResult;
	for (const target of targets) {
		const result = await observeTarget(runtime, target);
		lastResult = { target, result };
		if (targetResolved(result)) {
			return { ok: true, target, result };
		}
	}
	return { ok: false, ...lastResult };
}

async function waitResolveFirst(runtime, targets, timeoutMs = 2000, intervalMs = 300) {
	const deadline = Date.now() + timeoutMs;
	let lastResult;
	while (Date.now() <= deadline) {
		const resolved = await resolveFirst(runtime, targets);
		lastResult = resolved;
		if (resolved.ok) {
			return resolved;
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	return lastResult ?? { ok: false };
}

async function waitFirst(runtime, targets, timeoutMs = 1600) {
	let lastResult;
	for (const target of targets) {
		const result = await runtime.wait({
			app,
			target,
			captureMode: "window",
			timeoutMs,
			intervalMs: 300,
		});
		lastResult = { target, result };
		if (conditionMet(result)) {
			return { ok: true, target, result };
		}
	}
	return { ok: false, ...lastResult };
}

async function observeTarget(runtime, target) {
	return await runtime.observe({
		app,
		target,
		captureMode: "window",
	});
}

async function snapshot(runtime, outputDir, name) {
	const result = await runtime.observe({ app, captureMode: "window" });
	if (result.image?.data) {
		await writeFile(join(outputDir, name), Buffer.from(result.image.data, "base64"));
	}
	return result;
}

function iconLabelCandidates(appName) {
	const raw = String(appName || "").trim();
	const pieces = [
		raw.split(":")[0],
		raw.split(" - ")[0],
		raw.split(" – ")[0],
	];
	const words = raw.split(/\s+/).filter(Boolean);
	if (words.length >= 2) {
		pieces.push(words.slice(0, 2).join(" "));
	}
	if (words.length >= 1) {
		pieces.push(words[0]);
	}
	pieces.push(raw);
	return uniqueNonEmpty(pieces);
}

async function removeOneApp(runtime, appName, outputDir) {
	const iconTargets = iconLabelCandidates(appName).flatMap((label) => [
		`app icon labeled "${label}"`,
		`the home screen icon for ${label}`,
	]);
	const jiggleTargets = [
		'button labeled "Done"',
		'text "Done"',
		'button labeled "Edit"',
		'text "Edit"',
		'the iPhone home screen in jiggle mode',
	];
	const iconBadgeTargets = iconLabelCandidates(appName).flatMap((label) => [
		`the minus badge on the "${label}" app icon`,
		`the remove badge on the "${label}" app icon`,
		`the delete badge on the "${label}" app icon`,
		`the small minus button attached to the "${label}" app icon`,
		`the top-left minus button on the "${label}" app icon`,
	]);
	const removeTargets = [
		'button labeled "Remove App"',
		'menu item "Remove App"',
		'option labeled "Remove App"',
		'action labeled "Remove App"',
		'text "Remove App"',
		'the red Remove App option',
	];
	const deleteAppTargets = [
		'button labeled "Delete App"',
		'menu item "Delete App"',
		'option labeled "Delete App"',
		'action labeled "Delete App"',
		'text "Delete App"',
	];
	const finalDeleteTargets = [
		'button labeled "Delete"',
		'menu item "Delete"',
		'option labeled "Delete"',
		'action labeled "Delete"',
		'text "Delete"',
	];
	const removeMenuTargets = [...removeTargets, ...deleteAppTargets];

	await activateMirroringHome();
	await snapshot(runtime, outputDir, `${safeFileStem(appName)}-home-before.png`);

	const iconProbe = await resolveFirst(runtime, iconTargets);
	if (!iconProbe.ok) {
		return {
			appName,
			status: "skipped_not_visible",
			message: "App icon was not confidently visible on the current home screen.",
			lastStatus: statusCode(iconProbe.result),
		};
	}

	let longPress = await clickFirst(runtime, [iconProbe.target], { holdMs: 1100 });
	await snapshot(runtime, outputDir, `${safeFileStem(appName)}-after-long-press-1.png`);
	if (!longPress.ok) {
		longPress = await clickFirst(runtime, [iconProbe.target], { holdMs: 1450 });
		await snapshot(runtime, outputDir, `${safeFileStem(appName)}-after-long-press-2.png`);
	}
	if (!longPress.ok) {
		longPress = await clickFirst(runtime, iconTargets, { holdMs: 1450 });
		await snapshot(runtime, outputDir, `${safeFileStem(appName)}-after-long-press-3.png`);
	}
	if (!longPress.ok) {
		return {
			appName,
			status: "failed_long_press",
			message: "Could not long-press the app icon.",
			lastStatus: statusCode(longPress.result),
		};
	}

	let removeStep = await waitResolveFirst(runtime, removeMenuTargets, 2400);
	if (!removeStep.ok) {
		const jiggleState = await resolveFirst(runtime, jiggleTargets);
		if (jiggleState.ok) {
			const badgeClick = await clickFirst(runtime, iconBadgeTargets);
			if (badgeClick.ok) {
				await snapshot(runtime, outputDir, `${safeFileStem(appName)}-after-icon-badge-click.png`);
				removeStep = await waitResolveFirst(runtime, removeMenuTargets, 2200);
				if (!removeStep.ok) {
					const deleteAfterBadge = await waitResolveFirst(runtime, deleteAppTargets, 2200);
					if (deleteAfterBadge.ok) {
						removeStep = deleteAfterBadge;
					}
				}
			}
		}
	}
	if (!removeStep.ok) {
		await snapshot(runtime, outputDir, `${safeFileStem(appName)}-remove-menu-missing-after-hold.png`);
		const rightClick = await rightClickFirst(runtime, [iconProbe.target]);
		if (rightClick.ok) {
			await snapshot(runtime, outputDir, `${safeFileStem(appName)}-after-right-click.png`);
			removeStep = await waitResolveFirst(runtime, removeMenuTargets, 2200);
		}
	}
	if (!removeStep.ok) {
		return {
			appName,
			status: "failed_remove_menu_missing",
			message: "The Remove/Delete app affordance did not appear after long press.",
			lastStatus: statusCode(removeStep.result),
		};
	}

	if (removeTargets.includes(removeStep.target)) {
		const removeClick = await clickFirst(runtime, [removeStep.target]);
		if (!removeClick.ok) {
			return {
				appName,
				status: "failed_remove_app_click",
				message: "Could not click Remove App.",
				lastStatus: statusCode(removeClick.result),
			};
		}
		await snapshot(runtime, outputDir, `${safeFileStem(appName)}-after-remove-app-click.png`);
	}

	const deleteAppWait = await waitResolveFirst(runtime, deleteAppTargets, 2200);
	if (!deleteAppWait.ok) {
		return {
			appName,
			status: "failed_delete_app_missing",
			message: "Delete App step did not appear.",
		};
	}
	const deleteAppClick = await clickFirst(runtime, [deleteAppWait.target]);
	if (!deleteAppClick.ok) {
		return {
			appName,
			status: "failed_delete_app_click",
			message: "Could not click Delete App.",
			lastStatus: statusCode(deleteAppClick.result),
		};
	}
	await snapshot(runtime, outputDir, `${safeFileStem(appName)}-after-delete-app-click.png`);

	const finalDeleteWait = await waitResolveFirst(runtime, finalDeleteTargets, 2200);
	if (!finalDeleteWait.ok) {
		return {
			appName,
			status: "failed_final_delete_missing",
			message: "Final Delete confirmation did not appear.",
		};
	}
	const finalDeleteClick = await clickFirst(runtime, [finalDeleteWait.target]);
	if (!finalDeleteClick.ok) {
		return {
			appName,
			status: "failed_final_delete_click",
			message: "Could not click the final Delete confirmation.",
			lastStatus: statusCode(finalDeleteClick.result),
		};
	}
	await snapshot(runtime, outputDir, `${safeFileStem(appName)}-after-final-delete-click.png`);

	await execFileAsync("osascript", [
		"-e",
		'tell application "System Events" to keystroke "1" using command down',
	]);
	await snapshot(runtime, outputDir, `${safeFileStem(appName)}-home-after.png`);

	const postCheckTargets = uniqueNonEmpty([
		iconProbe.target,
		...iconLabelCandidates(appName).map((label) => `app icon labeled "${label}"`),
	]);
	const postCheck = await waitResolveFirst(runtime, postCheckTargets, 1200, 250);
	if (!postCheck.ok) {
		return {
			appName,
			status: "deleted",
			message: "App icon is no longer visible on the home screen after deletion.",
		};
	}

	return {
		appName,
		status: "delete_unverified",
		message: "Deletion flow was sent, but the app icon still appeared on the home screen afterward.",
		postCheckStatus: statusCode(postCheck.result),
		postCheckTarget: postCheck.target,
	};
}

function safeFileStem(value) {
	return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "app";
}

async function importLocalModule(candidate) {
	return await import(new URL(candidate, import.meta.url).href);
}

async function createGroundedRuntime() {
	const [
		guiGroundingModule,
		configModule,
	] = await Promise.all([
		importLocalModule("../../apps/cli/dist/commands/gui-grounding.js"),
		importLocalModule("../../packages/types/dist/config.js"),
	]);
	const model =
		process.env.UNDERSTUDY_REAL_GUI_GROUNDING_MODEL?.trim() ||
		process.env.UNDERSTUDY_GUI_GROUNDING_MODEL?.trim() ||
		"gpt-5.4";
	const resolved = await guiGroundingModule.primeGuiGroundingForConfig({
		...configModule.DEFAULT_CONFIG,
		defaultProvider: "openai-codex",
		defaultModel: model,
		agent: {
			...configModule.DEFAULT_CONFIG.agent,
			guiGroundingThinkingLevel: "minimal",
		},
	});
	if (!resolved.available || !resolved.groundingProvider) {
		throw new Error(
			resolved.unavailableReason ||
			"Could not resolve a GUI grounding provider from the local auth state.",
		);
	}
	return new ComputerUseGuiRuntime({
		groundingProvider: resolved.groundingProvider,
	});
}

const outputDir = resolve(
	readFlag("output-dir", join(repoRoot, ".understudy", "manual-gui", `remove-home-apps-${timestampSlug()}`)),
);
const strict = readBooleanFlag("strict", true);
const explicitAppNames = process.argv
	.slice(2)
	.filter((entry) => entry.startsWith("--app-name="))
	.map((entry) => entry.slice("--app-name=".length).trim())
	.filter(Boolean);

await mkdir(outputDir, { recursive: true });

const appNames = explicitAppNames.length > 0 ? uniqueNonEmpty(explicitAppNames) : await recentManifestAppNames();
const summary = {
	capturedAt: new Date().toISOString(),
	app,
	appNames,
	results: [],
};

if (appNames.length === 0) {
	summary.status = "no_recent_apps";
	await writeFile(join(outputDir, "result.json"), JSON.stringify(summary, null, 2), "utf8");
	process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
	process.exit(0);
}

try {
	await activateMirroringHome();
} catch (error) {
	summary.status = "failed_activate_mirroring";
	summary.error = error instanceof Error ? error.message : String(error);
	await writeFile(join(outputDir, "result.json"), JSON.stringify(summary, null, 2), "utf8");
	process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
	process.exit(strict ? 1 : 0);
}

let runtime;
try {
	runtime = await createGroundedRuntime();
} catch (error) {
	summary.status = "grounding_unavailable";
	summary.error = error instanceof Error ? error.message : String(error);
	await writeFile(join(outputDir, "result.json"), JSON.stringify(summary, null, 2), "utf8");
	process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
	process.exit(strict ? 1 : 0);
}
for (const appName of appNames) {
	summary.results.push(await removeOneApp(runtime, appName, outputDir));
}

summary.status = summary.results.every((entry) => entry.status === "deleted" || entry.status === "skipped_not_visible")
	? "ok"
	: "partial_failure";

await writeFile(join(outputDir, "result.json"), JSON.stringify(summary, null, 2), "utf8");
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (strict && summary.results.some((entry) => entry.status !== "deleted" && entry.status !== "skipped_not_visible")) {
	process.exit(1);
}
