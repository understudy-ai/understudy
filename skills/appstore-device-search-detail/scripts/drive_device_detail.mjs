#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { ComputerUseGuiRuntime } from "../../../packages/gui/dist/index.js";

const execFileAsync = promisify(execFileCallback);

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const app = "iPhone Mirroring";
const scope = "iPhone Mirroring window";

function readFlag(name, fallback = "") {
	const prefix = `--${name}=`;
	const arg = process.argv.slice(2).find((entry) => entry.startsWith(prefix));
	if (!arg) {
		return process.env[`UNDERSTUDY_${name.replace(/-/g, "_").toUpperCase()}`]?.trim() || fallback;
	}
	return arg.slice(prefix.length).trim() || fallback;
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

function statusCode(result) {
	return result?.status?.code ?? "";
}

function actionSucceeded(result) {
	return statusCode(result) === "action_sent";
}

function targetResolved(result) {
	return statusCode(result) === "resolved";
}

function createTitleFragments(name) {
	const raw = String(name || "").trim();
	const pieces = [
		raw,
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
	return uniqueNonEmpty(pieces);
}

function resultRowTargets(candidate) {
	const titleHints = uniqueNonEmpty([
		candidate.name,
		...(candidate.resultRowTitleHints || []),
	]);
	return uniqueNonEmpty(titleHints.flatMap((hint) => {
		const fragments = createTitleFragments(hint);
		return fragments.flatMap((fragment) => [
			`the search result row for ${fragment}`,
			`the app result row titled "${fragment}"`,
			`the row for ${fragment} in App Store search results`,
		]);
	}));
}

function detailTargets(candidate) {
	const titleFragments = createTitleFragments(candidate.name);
	const developer = String(candidate.developer || "").trim();
	const targets = titleFragments.flatMap((fragment) => [
		`the App Store detail page for ${fragment}`,
		`the top App Store title "${fragment}"`,
		`the app title ${fragment} near the top of the detail page`,
	]);
	if (developer) {
		targets.push(
			`the developer label "${developer}" on the App Store detail page`,
			`the developer text ${developer} under the app title`,
		);
	}
	return uniqueNonEmpty(targets);
}

function searchFieldTargets() {
	return [
		'the editable App Store search text field',
		'the active App Store search field',
		'the search text field near the top of the App Store Search page',
		'the App Store search text entry field',
	];
}

function placeholderSearchTargets() {
	return [
		'the search control labeled "Games, Apps and more"',
		'the search control labeled "Games,..."',
		'the bottom placeholder search control in the App Store Search tab',
		'the collapsed App Store search field on the Search surface',
	];
}

function searchTabTargets() {
	return [
		'the Search tab in the App Store bottom navigation bar',
		'the bottom App Store Search destination',
		'the tab labeled "Search" in the App Store bottom bar',
	];
}

function searchSurfaceTargets() {
	return uniqueNonEmpty([
		...searchFieldTargets(),
		...placeholderSearchTargets(),
		'the Search title near the top of the App Store page',
	]);
}

function appStoreIconTargets() {
	return [
		'app icon labeled "App Store"',
		'the home screen icon for App Store',
		'text "App Store" below the home screen icon',
		'the label "App Store" on the home screen',
		'the blue App Store icon on the top row of the iPhone home screen',
		'the App Store icon between Clock and Settings on the top row',
		'the App Store icon near the center of the top row on the home screen',
	];
}

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

async function importLocalModule(candidate) {
	return await import(new URL(candidate, import.meta.url).href);
}

async function createGroundedRuntime() {
	const [
		guiGroundingModule,
		configModule,
	] = await Promise.all([
		importLocalModule("../../../apps/cli/dist/commands/gui-grounding.js"),
		importLocalModule("../../../packages/types/dist/config.js"),
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

async function activateMirroring() {
	await execFileAsync("open", ["-a", app]);
	await execFileAsync("osascript", [
		"-e",
		`tell application "${app}" to activate`,
	]);
}

async function sendHome() {
	await execFileAsync("osascript", [
		"-e",
		'tell application "System Events" to keystroke "1" using command down',
	]);
}

async function observe(runtime, extra = {}) {
	return await runtime.observe({
		app,
		scope,
		captureMode: "window",
		...extra,
	});
}

async function saveImageFromResult(result, path) {
	if (!result?.image?.data) {
		return false;
	}
	await writeFile(path, Buffer.from(result.image.data, "base64"));
	return true;
}

async function clickFirst(runtime, targets, extra = {}) {
	let last;
	for (const target of targets) {
		const result = await runtime.click({
			app,
			scope,
			captureMode: "window",
			target,
			...extra,
		});
		last = { target, result };
		if (actionSucceeded(result)) {
			return { ok: true, target, result };
		}
	}
	return { ok: false, ...last };
}

async function resolveFirst(runtime, targets, extra = {}) {
	let last;
	for (const target of targets) {
		const result = await observe(runtime, {
			target,
			...extra,
		});
		last = { target, result };
		if (targetResolved(result)) {
			return { ok: true, target, result };
		}
	}
	return { ok: false, ...last };
}

async function waitResolveFirst(runtime, targets, timeoutMs = 5000, intervalMs = 500, extra = {}) {
	const deadline = Date.now() + timeoutMs;
	let last;
	while (Date.now() <= deadline) {
		const resolved = await resolveFirst(runtime, targets, extra);
		last = resolved;
		if (resolved.ok) {
			return resolved;
		}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs));
	}
	return last ?? { ok: false };
}

async function key(runtime, keyValue, modifiers = []) {
	return await runtime.key({
		app,
		captureMode: "window",
		key: keyValue,
		modifiers,
	});
}

async function typeQuery(runtime, action) {
	return await runtime.type({
		app,
		scope,
		captureMode: "window",
		value: action.value,
		typeStrategy: action.typeStrategy,
		replace: action.replace,
		submit: action.submit,
	});
}

async function cropWindowImage(sourcePath, finalPath) {
	await execFileAsync("python3", [
		"-c",
		`
from pathlib import Path
from PIL import Image
source = Path(${JSON.stringify(sourcePath)})
final = Path(${JSON.stringify(finalPath)})
with Image.open(source) as image:
    width, height = image.size
    left = round(width * 0.0253)
    top = round(height * 0.0532)
    right = width - round(width * 0.0190)
    bottom = height - round(height * 0.0129)
    image.crop((left, top, right, bottom)).save(final)
print(final)
`,
	]);
}

async function writeSuccessArtifacts(rootDir, candidate, screenshotRelativePath) {
	const manifestPath = join(rootDir, "manifest.json");
	const checkpointPath = join(rootDir, "experience", "checkpoints.jsonl");
	const manifest = await readJson(manifestPath);
	const timestamp = new Date().toISOString();
	const selected = manifest.selectedApp || {};
	selected.name = candidate.name;
	if (candidate.developer) {
		selected.developer = candidate.developer;
	}
	selected.deviceDetailVerifiedAt = timestamp;
	selected.installed = false;
	manifest.selectedApp = selected;
	manifest.artifacts = manifest.artifacts || {};
	manifest.artifacts.topicScreenshots = uniqueNonEmpty([
		...(manifest.artifacts.topicScreenshots || []),
		screenshotRelativePath,
	]);
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

	const checkpoint = {
		stage: "appstore-device-search-detail",
		timestamp,
		status: "detail_page_verified",
		appName: candidate.name,
		developer: candidate.developer || "",
		searchQuery: candidate.deviceSearchQuery,
		screenshot: screenshotRelativePath,
	};
	await writeFile(
		checkpointPath,
		`${JSON.stringify(checkpoint)}\n`,
		{ encoding: "utf8", flag: "a" },
	);
	return checkpoint;
}

async function main() {
	const rootDir = resolve(readFlag("artifacts-root-dir"));
	if (!rootDir || !existsSync(rootDir)) {
		throw new Error("Missing --artifacts-root-dir pointing at the active playbook artifacts root.");
	}
	const outputDir = resolve(
		readFlag("output-dir", join(rootDir, "_debug", "appstore-device-search-detail-helper")),
	);
	await mkdir(outputDir, { recursive: true });

	const manifest = await readJson(join(rootDir, "manifest.json"));
	const plan = await readJson(join(rootDir, "topic", "device-action-plan.json"));
	const selectedName = String(manifest?.selectedApp?.name || "").trim();
	const candidate = (plan.candidates || []).find((entry) =>
		String(entry?.name || "").trim().toLowerCase() === selectedName.toLowerCase(),
	) || plan.candidates?.[0];
	if (!candidate) {
		throw new Error("No candidate found in topic/device-action-plan.json.");
	}

	const runtime = await createGroundedRuntime();
	const summary = {
		capturedAt: new Date().toISOString(),
		app,
		rootDir,
		candidate: {
			name: candidate.name,
			developer: candidate.developer || "",
			deviceSearchQuery: candidate.deviceSearchQuery,
		},
		steps: [],
		status: "unknown",
	};
	const pushStep = (step, result) => {
		summary.steps.push({
			step,
			status: statusCode(result),
			text: result?.text,
			details: result?.details,
		});
	};

	const initial = await observe(runtime);
	pushStep("initial_observe", initial);
	await saveImageFromResult(initial, join(outputDir, "01-initial.png"));

	await activateMirroring();
	await sendHome();
	const home = await observe(runtime);
	pushStep("home_observe", home);
	await saveImageFromResult(home, join(outputDir, "02-home.png"));

	const appStoreProbe = await resolveFirst(runtime, appStoreIconTargets(), {
		locationHint: "top row of the iPhone home screen",
	});
	pushStep("resolve_app_store_icon", appStoreProbe.result);
	if (!appStoreProbe.ok) {
		throw new Error("Could not resolve the App Store icon on the home screen.");
	}
	const appStoreClick = await clickFirst(runtime, [appStoreProbe.target], {
		locationHint: "top row of the iPhone home screen",
	});
	pushStep("open_app_store", appStoreClick.result);
	if (!appStoreClick.ok) {
		throw new Error("Could not open App Store from the home screen.");
	}

	const appStoreObserved = await observe(runtime);
	pushStep("app_store_observe", appStoreObserved);
	await saveImageFromResult(appStoreObserved, join(outputDir, "03-app-store.png"));

	let searchSurface = appStoreObserved;
	const searchSurfaceProbe = await resolveFirst(runtime, searchSurfaceTargets(), {
		locationHint: "App Store Search surface",
	});
	pushStep("resolve_search_surface", searchSurfaceProbe.result);
	if (!searchSurfaceProbe.ok) {
		const searchTabClick = await clickFirst(runtime, searchTabTargets(), {
			locationHint: "bottom App Store tab bar",
		});
		pushStep("search_tab_click", searchTabClick.result);
		if (!searchTabClick.ok) {
			throw new Error("Could not open the App Store Search tab.");
		}

		searchSurface = await observe(runtime);
		pushStep("search_surface_observe", searchSurface);
	}
	await saveImageFromResult(searchSurface, join(outputDir, "04-search-surface.png"));

	let fieldProbe = await resolveFirst(runtime, searchFieldTargets(), {
		locationHint: "top search field on the App Store Search page",
	});
	let currentSearchState = searchSurface;
	if (!fieldProbe.ok) {
		const placeholderProbe = await resolveFirst(runtime, placeholderSearchTargets(), {
			locationHint: "placeholder search control on the App Store Search page",
		});
		pushStep("resolve_placeholder_search", placeholderProbe.result);
		if (!placeholderProbe.ok) {
			throw new Error("Could not enter the App Store search field from the Search surface.");
		}
		const placeholderClick = await clickFirst(runtime, [placeholderProbe.target], {
			locationHint: "placeholder search control on the App Store Search page",
		});
		pushStep("placeholder_click", placeholderClick.result);
		if (!placeholderClick.ok) {
			throw new Error("Could not enter the App Store search field from the Search surface.");
		}
		const afterPlaceholder = await observe(runtime);
		pushStep("after_placeholder_observe", afterPlaceholder);
		await saveImageFromResult(afterPlaceholder, join(outputDir, "05-after-placeholder.png"));
		currentSearchState = afterPlaceholder;
		fieldProbe = await resolveFirst(runtime, searchFieldTargets(), {
			locationHint: "top search field on the App Store Search page",
		});
	}
	if (fieldProbe.ok) {
		const fieldClick = await clickFirst(runtime, [fieldProbe.target], {
			locationHint: "editable App Store search field",
		});
		pushStep("focus_search_field", fieldClick.result);
		if (!fieldClick.ok) {
			throw new Error("Could not focus the editable App Store search field.");
		}
		const afterFocus = await observe(runtime);
		pushStep("after_focus_observe", afterFocus);
		await saveImageFromResult(afterFocus, join(outputDir, "06-after-focus.png"));
		currentSearchState = afterFocus;
	} else {
		summary.steps.push({
			step: "focus_search_field_skipped",
			status: "not_found",
			text: "No distinct editable App Store search field was resolved; proceeding with the active Search-surface control and the frozen targetless query input.",
		});
	}

	let resultRow = await resolveFirst(runtime, resultRowTargets(candidate), {
		locationHint: "App Store search results list",
	});
	if (!resultRow.ok) {
		const typeResult = await typeQuery(runtime, candidate.searchAction);
		pushStep("type_query", typeResult);
		if (!actionSucceeded(typeResult)) {
			throw new Error("The frozen searchAction did not send successfully.");
		}

		const afterType = await observe(runtime);
		pushStep("after_type_observe", afterType);
		await saveImageFromResult(afterType, join(outputDir, "07-after-type.png"));

		resultRow = await resolveFirst(runtime, resultRowTargets(candidate), {
			locationHint: "App Store search results list",
		});
	}
	if (!resultRow.ok) {
		const submitResult = await key(runtime, candidate.searchSubmitAction?.key || "Enter");
		pushStep("search_submit", submitResult);
		if (!actionSucceeded(submitResult)) {
			throw new Error("Could not send the frozen searchSubmitAction.");
		}
		const afterSubmit = await observe(runtime);
		pushStep("after_submit_observe", afterSubmit);
		await saveImageFromResult(afterSubmit, join(outputDir, "08-after-submit.png"));
		resultRow = await resolveFirst(runtime, resultRowTargets(candidate), {
			locationHint: "App Store search results list",
		});
	}
	if (!resultRow.ok) {
		throw new Error("Could not resolve the matching App Store search result row.");
	}

	const resultRowClick = await clickFirst(runtime, [resultRow.target], {
		locationHint: "row body, not the Get button",
	});
	pushStep("result_row_click", resultRowClick.result);
	if (!resultRowClick.ok) {
		throw new Error("Could not click the matching App Store result row.");
	}

	const afterRowTap = await observe(runtime);
	pushStep("after_row_tap_observe", afterRowTap);
	await saveImageFromResult(afterRowTap, join(outputDir, "09-after-row-tap.png"));

	const detail = await waitResolveFirst(runtime, detailTargets(candidate), 6000, 500, {
		locationHint: "top header area of the App Store detail page",
	});
	if (!detail.ok) {
		throw new Error("The matching App Store detail page was not verified.");
	}

	const finalObserve = await observe(runtime);
	pushStep("final_detail_observe", finalObserve);
	const rawPath = join(outputDir, "10-detail-raw.png");
	if (!await saveImageFromResult(finalObserve, rawPath)) {
		throw new Error("Could not save the final detail-page screenshot.");
	}

	const screenshotRelativePath = "topic/screenshots/02-iPhone-App-Store-Detail.png";
	const screenshotPath = join(rootDir, screenshotRelativePath);
	await mkdir(dirname(screenshotPath), { recursive: true });
	await cropWindowImage(rawPath, screenshotPath);
	const checkpoint = await writeSuccessArtifacts(rootDir, candidate, screenshotRelativePath);

	summary.status = "ok";
	summary.checkpoint = checkpoint;
	summary.output = screenshotRelativePath;
	await writeFile(join(outputDir, "result.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
	process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
	process.exit(0);
}

try {
	await main();
} catch (error) {
	const summary = {
		capturedAt: new Date().toISOString(),
		app,
		status: "blocked",
		error: error instanceof Error ? error.message : String(error),
	};
	process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
	process.exit(1);
}
