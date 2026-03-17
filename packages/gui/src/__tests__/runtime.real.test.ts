/// <reference lib="dom" />

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { ComputerUseGuiRuntime } from "../runtime.js";
import type { GuiGroundingProvider } from "../types.js";

const shouldRunRealGuiTests =
	process.platform === "darwin" &&
	process.env.UNDERSTUDY_RUN_REAL_GUI_TESTS === "1";
const shouldRunRealGuiBenchmarks =
	shouldRunRealGuiTests &&
	process.env.UNDERSTUDY_RUN_REAL_GUI_BENCHMARKS === "1";
const shouldRunRealGuiGroundingE2E =
	shouldRunRealGuiTests &&
	process.env.UNDERSTUDY_RUN_REAL_GUI_GROUNDING_E2E === "1";
const DEFAULT_REAL_GUI_BENCHMARK_ITERATIONS = 2;
const REAL_GUI_SETUP_TIMEOUT_MS = 120_000;
const REAL_GUI_TEST_TIMEOUT_MS = 60_000;
const REAL_GUI_BENCHMARK_TIMEOUT_MS = 180_000;
const REAL_GUI_GROUNDING_E2E_TIMEOUT_MS = 180_000;
const execFileAsync = promisify(execFile);

async function importLocalModule<TModule extends object>(
	candidate: string,
): Promise<TModule> {
	return await import(new URL(candidate, import.meta.url).href) as TModule;
}

async function createRealOpenAIGroundedRuntime(): Promise<ComputerUseGuiRuntime> {
	const [
		guiGroundingModule,
		configModule,
	] = await Promise.all([
		importLocalModule<{
			primeGuiGroundingForConfig: (config: Record<string, unknown>) => Promise<{
				available: boolean;
				label?: string;
				unavailableReason?: string;
				groundingProvider?: GuiGroundingProvider;
			}>;
		}>(
			"../../../../apps/cli/src/commands/gui-grounding.js",
		),
		importLocalModule<{
			DEFAULT_CONFIG: Record<string, any>;
		}>(
			"../../../types/src/config.js",
		),
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
			"Real GUI grounding e2e could not resolve an OpenAI-capable grounding provider from the local auth state.",
		);
	}
	return new ComputerUseGuiRuntime({
		groundingProvider: resolved.groundingProvider,
	});
}

const MOUSE_MOVE_SCRIPT = String.raw`
import Cocoa
import CoreGraphics

enum MoveError: Error {
	case invalidPoint
	case eventCreationFailed
}

func env(_ key: String) -> String {
	ProcessInfo.processInfo.environment[key] ?? ""
}

guard
	let x = Double(env("UNDERSTUDY_GUI_X")),
	let y = Double(env("UNDERSTUDY_GUI_Y"))
else {
	throw MoveError.invalidPoint
}

let point = CGPoint(x: x, y: y)
guard let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) else {
	throw MoveError.eventCreationFailed
}
event.post(tap: .cghidEventTap)
usleep(40_000)
print("moved")
`;

const MOUSE_LOCATION_SCRIPT = String.raw`
import CoreGraphics

let point = CGEvent(source: nil)?.location ?? .zero
print("\(Int(round(point.x))),\(Int(round(point.y)))")
`;

type ViewportOrigin = {
	x: number;
	y: number;
};

type BrowserGuiSurface = {
	page: any;
	viewportOrigin: ViewportOrigin;
};

type RealGuiBenchmarkMeasurement = {
	scenarioId: string;
	family: "point_action" | "dual_point" | "region_observation" | "hybrid" | "keyboard_only";
	iteration: number;
	success: boolean;
	elapsedMs: number;
	error?: string;
};

async function moveMouseToScreenPoint(point: { x: number; y: number }): Promise<void> {
	await execFileAsync("swift", ["-e", MOUSE_MOVE_SCRIPT], {
		env: {
			...process.env,
			UNDERSTUDY_GUI_X: String(point.x),
			UNDERSTUDY_GUI_Y: String(point.y),
		},
	});
}

async function readMouseScreenPoint(): Promise<{ x: number; y: number }> {
	const result = await execFileAsync("swift", ["-e", MOUSE_LOCATION_SCRIPT], {
		env: process.env,
	});
	const [rawX, rawY] = result.stdout.trim().split(",", 2);
	const x = Number.parseInt(rawX ?? "", 10);
	const y = Number.parseInt(rawY ?? "", 10);
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		throw new Error(`Failed to parse the real mouse location from "${result.stdout.trim()}".`);
	}
	return { x, y };
}

async function calibrateViewportOrigin(page: any): Promise<ViewportOrigin> {
	const probeOrigin = await page.evaluate(() => ({
		screenX: window.screenX,
		screenY: window.screenY,
	}));
	const probePoint = {
		x: Math.round(probeOrigin.screenX + 220),
		y: Math.round(probeOrigin.screenY + 240),
	};

	await page.evaluate(() => {
		(window as unknown as { __understudyLastMouse: { clientX: number; clientY: number } | null }).__understudyLastMouse = null;
	});
	await moveMouseToScreenPoint(probePoint);

	let lastMouse: { clientX: number; clientY: number } | null = null;
	for (let attempt = 0; attempt < 25; attempt += 1) {
		lastMouse = await page.evaluate(() =>
			(window as unknown as { __understudyLastMouse: { clientX: number; clientY: number } | null }).__understudyLastMouse,
		);
		if (
			lastMouse &&
			typeof lastMouse.clientX === "number" &&
			typeof lastMouse.clientY === "number"
		) {
			break;
		}
		await page.waitForTimeout(80);
	}

	if (!lastMouse) {
		throw new Error("Failed to observe a real mousemove inside the browser viewport during GUI calibration.");
	}

	return {
		x: Math.round(probePoint.x - lastMouse.clientX),
		y: Math.round(probePoint.y - lastMouse.clientY),
	};
}

async function waitForObservedPopupDrop(
	popupPage: any,
	popupSurface: BrowserGuiSurface,
	options: {
		timeoutMs?: number;
		pollMs?: number;
	} = {},
): Promise<void> {
	const timeoutMs = Math.max(500, options.timeoutMs ?? 4_000);
	const pollMs = Math.max(20, options.pollMs ?? 50);
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		const result = await popupPage.evaluate(() => {
			const popupWindow = window as unknown as {
				__understudyMarkPopupDropped?: (reason?: string) => void;
			};
			const dropZone = document.getElementById("popup-drop-zone");
			const popupStatus = document.getElementById("popup-status");
			if (popupStatus?.textContent === "popup:dropped") {
				return { state: "dropped" as const };
			}
			if (!dropZone) {
				return { state: "missing" as const };
			}
			const rect = dropZone.getBoundingClientRect();
			return {
				state: "pending" as const,
				rect: {
					left: rect.left,
					top: rect.top,
					right: rect.right,
					bottom: rect.bottom,
				},
				canMark: typeof popupWindow.__understudyMarkPopupDropped === "function",
			};
		});
		if (result.state === "dropped") {
			return;
		}
		if (result.state === "pending") {
			const mouse = await readMouseScreenPoint();
			const rect = {
				left: Math.round(popupSurface.viewportOrigin.x + result.rect.left),
				top: Math.round(popupSurface.viewportOrigin.y + result.rect.top),
				right: Math.round(popupSurface.viewportOrigin.x + result.rect.right),
				bottom: Math.round(popupSurface.viewportOrigin.y + result.rect.bottom),
			};
			const inside =
				mouse.x >= rect.left &&
				mouse.x <= rect.right &&
				mouse.y >= rect.top &&
				mouse.y <= rect.bottom;
			if (inside && result.canMark) {
				await popupPage.evaluate(() => {
					(window as unknown as { __understudyMarkPopupDropped?: (reason?: string) => void }).__understudyMarkPopupDropped?.("cursor_observed");
				});
				return;
			}
		}
		await popupPage.waitForTimeout(pollMs);
	}
	throw new Error("Timed out waiting for the real cursor to enter the popup drop zone.");
}

async function prepareBrowserPageForGui(page: any): Promise<void> {
	await page.bringToFront();
	await page.evaluate(() => window.focus());
	await page.waitForTimeout(150);
}

async function prepareBrowserPagesForGui(...pages: Array<any | undefined>): Promise<void> {
	for (const page of pages) {
		if (!page) {
			continue;
		}
		await prepareBrowserPageForGui(page);
	}
}

async function moveBrowserWindow(page: any, params: {
	left: number;
	top: number;
	width: number;
	height: number;
}): Promise<void> {
	await page.evaluate((next: { left: number; top: number; width: number; height: number }) => {
		window.moveTo(next.left, next.top);
		window.resizeTo(next.width, next.height);
	}, params);
	await page.waitForTimeout(200);
}

function createPlaywrightDomGroundingProvider(getSurfaces: () => BrowserGuiSurface[]) {
	return {
		ground: async ({
			target,
			scope,
			locationHint,
			action,
		}: {
			target: string;
			scope?: string;
			locationHint?: string;
			action?: string;
		}) => {
			for (const surface of getSurfaces()) {
				const grounded = await surface.page.evaluate((params: {
					label: string;
					scope?: string;
					locationHint?: string;
					action?: string;
					viewportOrigin: ViewportOrigin;
				}) => {
					function intersectionRect(
						left: { left: number; top: number; right: number; bottom: number },
						right: { left: number; top: number; right: number; bottom: number },
				) {
					const next = {
						left: Math.max(left.left, right.left),
						top: Math.max(left.top, right.top),
						right: Math.min(left.right, right.right),
						bottom: Math.min(left.bottom, right.bottom),
					};
					return next.right > next.left && next.bottom > next.top ? next : null;
				}

				function visibleRectFor(element: HTMLElement) {
					const rect = element.getBoundingClientRect();
					const style = window.getComputedStyle(element);
					if (
						element.hidden ||
						style.display === "none" ||
						style.visibility === "hidden" ||
						rect.width <= 0 ||
						rect.height <= 0
					) {
						return null;
					}
					let visibleRect = {
						left: rect.left,
						top: rect.top,
						right: rect.right,
						bottom: rect.bottom,
					};
					let current: HTMLElement | null = element.parentElement;
					while (current) {
						const currentStyle = window.getComputedStyle(current);
						const clips =
							currentStyle.overflow !== "visible" ||
							currentStyle.overflowX !== "visible" ||
							currentStyle.overflowY !== "visible";
						if (clips) {
							const currentRect = current.getBoundingClientRect();
							const clipped = intersectionRect(visibleRect, {
								left: currentRect.left,
								top: currentRect.top,
								right: currentRect.right,
								bottom: currentRect.bottom,
							});
							if (!clipped) {
								return null;
							}
							visibleRect = clipped;
						}
						current = current.parentElement;
					}
					return intersectionRect(visibleRect, {
						left: 0,
						top: 0,
						right: window.innerWidth,
						bottom: window.innerHeight,
					});
				}

				function clamp(value: number, min: number, max: number) {
					return Math.min(max, Math.max(min, value));
				}

				function normalizedCenterScore(
					value: number,
					start: number,
					span: number,
					direction: "start" | "end" | "center",
				) {
					const normalized = clamp((value - start) / Math.max(1, span), 0, 1);
					if (direction === "start") {
						return (1 - normalized) * 100;
					}
					if (direction === "end") {
						return normalized * 100;
					}
					return (1 - Math.abs(normalized - 0.5) * 2) * 100;
				}

				function locationHintScore(
					locationHint: string | undefined,
					visibleRect: { left: number; top: number; right: number; bottom: number },
					referenceRect: { left: number; top: number; right: number; bottom: number },
				) {
					const hint = locationHint?.trim().toLowerCase();
					if (!hint) {
						return 0;
					}
					const centerX = (visibleRect.left + visibleRect.right) / 2;
					const centerY = (visibleRect.top + visibleRect.bottom) / 2;
					const width = referenceRect.right - referenceRect.left;
					const height = referenceRect.bottom - referenceRect.top;
					let score = 0;
					if (hint.includes("left")) {
						score += normalizedCenterScore(centerX, referenceRect.left, width, "start");
					}
					if (hint.includes("right")) {
						score += normalizedCenterScore(centerX, referenceRect.left, width, "end");
					}
					if (
						hint.includes("top") ||
						hint.includes("upper") ||
						hint.includes("header")
					) {
						score += normalizedCenterScore(centerY, referenceRect.top, height, "start");
					}
					if (
						hint.includes("bottom") ||
						hint.includes("lower") ||
						hint.includes("footer")
					) {
						score += normalizedCenterScore(centerY, referenceRect.top, height, "end");
					}
					if (hint.includes("center") || hint.includes("middle")) {
						score += normalizedCenterScore(centerX, referenceRect.left, width, "center") * 0.5;
						score += normalizedCenterScore(centerY, referenceRect.top, height, "center") * 0.5;
					}
					return score;
				}

				function actionAffinityScore(element: HTMLElement, action: string | undefined) {
					const normalizedAction = action?.trim().toLowerCase();
					const tagName = element.tagName.toLowerCase();
					const role = (element.getAttribute("role") ?? "").toLowerCase();
					const isEditable =
						tagName === "input" ||
						tagName === "textarea" ||
						element.isContentEditable;
					const isInteractive =
						tagName === "button" ||
						tagName === "a" ||
						tagName === "label" ||
						role === "button" ||
						role === "link" ||
						element.hasAttribute("onclick");
					const isScrollable =
						element.scrollHeight > element.clientHeight + 2 ||
						element.scrollWidth > element.clientWidth + 2;
					if (!normalizedAction) {
						return 0;
					}
					if (normalizedAction === "type") {
						return isEditable ? 80 : 0;
					}
					if (normalizedAction === "scroll") {
						return isScrollable ? 70 : 0;
					}
					if (
						normalizedAction === "click" ||
						normalizedAction === "right_click" ||
						normalizedAction === "double_click" ||
						normalizedAction === "hover" ||
						normalizedAction === "click_and_hold"
					) {
						return isInteractive ? 50 : 0;
					}
					return 0;
				}

				const label = params.label;
				const root = params.scope
					? document.querySelector(`[data-gui-scope="${params.scope}"]`) as HTMLElement | null
					: null;
				const searchRoot = root ?? document;
				const referenceRect = root
					? root.getBoundingClientRect()
					: {
						left: 0,
						top: 0,
						right: window.innerWidth,
						bottom: window.innerHeight,
					};
				const candidates = Array.from(
					searchRoot.querySelectorAll(`[data-gui-target="${label}"]`),
				) as HTMLElement[];
				const rankedCandidates = [] as Array<{
					element: HTMLElement;
					rect: DOMRect;
					visibleRect: { left: number; top: number; right: number; bottom: number };
					score: number;
					domIndex: number;
				}>;
				for (const [domIndex, element] of candidates.entries()) {
					const rect = element.getBoundingClientRect();
					const visibleRect = visibleRectFor(element);
					if (!visibleRect) {
						continue;
					}
					rankedCandidates.push({
						element,
						rect,
						visibleRect,
						score:
							locationHintScore(params.locationHint, visibleRect, referenceRect) +
							actionAffinityScore(element, params.action),
						domIndex,
					});
				}
				rankedCandidates.sort((left, right) => {
					if (right.score !== left.score) {
						return right.score - left.score;
					}
					const leftArea =
						(left.visibleRect.right - left.visibleRect.left) *
						(left.visibleRect.bottom - left.visibleRect.top);
					const rightArea =
						(right.visibleRect.right - right.visibleRect.left) *
						(right.visibleRect.bottom - right.visibleRect.top);
					if (rightArea !== leftArea) {
						return rightArea - leftArea;
					}
					return left.domIndex - right.domIndex;
				});
				const selected = rankedCandidates[0];
				if (!selected) {
					return undefined;
				}
				{
					const { rect, visibleRect, score } = selected;
					const centerX = Math.round((visibleRect.left + visibleRect.right) / 2);
					const centerY = Math.round((visibleRect.top + visibleRect.bottom) / 2);
						return {
							method: "grounding",
							provider: "playwright-dom",
							confidence: 1,
							reason: `Matched ${label}${params.locationHint ? ` via ${params.locationHint}` : ""}`,
							coordinateSpace: "display_pixels",
							point: {
								x: Math.round(params.viewportOrigin.x + centerX),
								y: Math.round(params.viewportOrigin.y + centerY),
						},
						box: {
							x: Math.round(params.viewportOrigin.x + visibleRect.left),
							y: Math.round(params.viewportOrigin.y + visibleRect.top),
							width: Math.round(visibleRect.right - visibleRect.left),
							height: Math.round(visibleRect.bottom - visibleRect.top),
						},
						raw: {
							score,
							rect: {
								left: Math.round(rect.left),
								top: Math.round(rect.top),
								right: Math.round(rect.right),
								bottom: Math.round(rect.bottom),
							},
						},
					};
				}
				}, {
					label: target,
					scope,
					locationHint,
					action,
					viewportOrigin: surface.viewportOrigin,
				});
				if (grounded) {
					return grounded;
				}
			}
			return undefined;
			},
		};
}

async function resetSmokePage(...pages: Array<any | undefined>): Promise<void> {
	for (const page of pages) {
		if (!page) {
			continue;
		}
		await page.evaluate(() => {
			(window as unknown as { resetSmokeState?: () => void }).resetSmokeState?.();
		});
	}
	for (const page of pages) {
		if (!page) {
			continue;
		}
		await page.waitForTimeout(60);
	}
}

function resolveRealGuiBenchmarkIterations(): number {
	const raw = Number.parseInt(process.env.UNDERSTUDY_REAL_GUI_BENCHMARK_ITERATIONS ?? "", 10);
	if (Number.isFinite(raw) && raw > 0) {
		return raw;
	}
	return DEFAULT_REAL_GUI_BENCHMARK_ITERATIONS;
}

async function runAppleScript(
	script: string,
	env?: NodeJS.ProcessEnv,
): Promise<string> {
	const result = await execFileAsync("osascript", ["-l", "AppleScript", "-e", script], {
		maxBuffer: 4 * 1024 * 1024,
		env: env ? { ...process.env, ...env } : process.env,
	});
	return result.stdout.trim();
}

async function closeTextEditWithoutSaving(): Promise<void> {
	await runAppleScript(String.raw`
tell application "TextEdit"
	if it is running then
		repeat with docRef in documents
			close docRef saving no
		end repeat
		activate
	end if
end tell
`).catch(() => {});
}

async function readTextEditDocumentText(): Promise<string> {
	return await runAppleScript(String.raw`
tell application "TextEdit"
	if (count of documents) is 0 then return ""
	return text of document 1
end tell
`);
}

async function closeFinderWindows(): Promise<void> {
	await runAppleScript(String.raw`
tell application "Finder"
	if it is running then
		close every Finder window
	end if
end tell
`).catch(() => {});
}

async function revealFinderPath(path: string): Promise<void> {
	await runAppleScript(String.raw`
set targetPath to POSIX file (system attribute "UNDERSTUDY_GUI_FINDER_PATH") as alias
set parentFolder to POSIX file (system attribute "UNDERSTUDY_GUI_FINDER_PARENT") as alias
tell application "Finder"
	activate
	open parentFolder
	delay 0.25
	set target of front Finder window to parentFolder
	select targetPath
end tell
`, {
		UNDERSTUDY_GUI_FINDER_PATH: path,
		UNDERSTUDY_GUI_FINDER_PARENT: dirname(path),
	});
}

async function readFinderWindowTargetPath(): Promise<string> {
	return await runAppleScript(String.raw`
tell application "Finder"
	if (count of Finder windows) is 0 then return ""
	try
		return POSIX path of (target of front Finder window as alias)
	on error
		return ""
	end try
end tell
`);
}

async function countFinderWindows(): Promise<number> {
	const raw = await runAppleScript(String.raw`
tell application "Finder"
	return count of Finder windows
end tell
`);
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) ? parsed : 0;
}

async function readFinderFrontWindowCloseButtonRect(): Promise<{
	x: number;
	y: number;
	width: number;
	height: number;
}> {
	const raw = await runAppleScript(String.raw`
tell application "System Events"
	tell process "Finder"
		tell front window
			set buttonPosition to position of first button
			set buttonSize to size of first button
			return ((item 1 of buttonPosition) as string) & "," & ((item 2 of buttonPosition) as string) & "," & ((item 1 of buttonSize) as string) & "," & ((item 2 of buttonSize) as string)
		end tell
	end tell
end tell
`);
	const [rawX, rawY, rawWidth, rawHeight] = raw.split(",", 4).map((part) => Number.parseInt(part.trim(), 10));
	if (![rawX, rawY, rawWidth, rawHeight].every((value) => Number.isFinite(value))) {
		throw new Error(`Failed to parse Finder close button rect from "${raw}".`);
	}
	return {
		x: rawX,
		y: rawY,
		width: rawWidth,
		height: rawHeight,
	};
}

function normalizeFinderPath(value: string): string {
	const normalized = value.startsWith("/private/var/")
		? value.slice("/private".length)
		: value;
	return normalized.endsWith("/") && normalized.length > 1
		? normalized.slice(0, -1)
		: normalized;
}

async function launchTextEdit(): Promise<void> {
	await execFileAsync("open", ["-a", "TextEdit"]);
	await runAppleScript("delay 0.4");
	await runAppleScript('tell application "TextEdit" to activate');
}

const CROSS_WINDOW_POPUP_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<title>Understudy GUI popup</title>
	<style>
		body {
			margin: 0;
			font-family: -apple-system, BlinkMacSystemFont, sans-serif;
			background: #eef4ff;
			color: #10233a;
			padding: 20px;
		}
		.panel {
			border-radius: 18px;
			border: 1px solid rgba(16, 35, 58, 0.12);
			background: #fff;
			padding: 18px;
			box-shadow: 0 16px 30px rgba(16, 35, 58, 0.08);
		}
		.popup-actions {
			display: flex;
			justify-content: flex-end;
			margin-bottom: 12px;
		}
		.popup-actions button {
			font: inherit;
			padding: 10px 12px;
			border-radius: 12px;
			border: 1px solid rgba(16, 35, 58, 0.16);
			background: #fff;
		}
		#popup-drop-zone {
			margin-top: 12px;
			height: 220px;
			border-radius: 18px;
			border: 2px dashed #5a8dd8;
			background: rgba(90, 141, 216, 0.12);
			display: grid;
			place-items: center;
			font-weight: 600;
		}
		.status {
			margin-top: 14px;
			font-size: 13px;
			color: #4a6077;
		}
		#popup-drop-confirmation[hidden] {
			display: none;
		}
	</style>
</head>
<body>
	<div class="panel" data-gui-scope="Popup panel">
		<div class="popup-actions">
			<button id="popup-action-button" data-gui-target="Popup action button">Popup action</button>
		</div>
		<div>Cross-window drop target</div>
		<div id="popup-drop-zone" data-gui-target="Popup drop zone">Release here</div>
		<div class="status">
			<div id="popup-action-status">popup-action:idle</div>
			<div id="popup-status">popup:waiting</div>
			<div id="popup-drop-confirmation" data-gui-target="Popup drop confirmation" hidden>Popup drop complete</div>
		</div>
	</div>
	<script>
		const dropZone = document.getElementById("popup-drop-zone");
		const popupActionButton = document.getElementById("popup-action-button");
		const popupActionStatusEl = document.getElementById("popup-action-status");
		const popupStatusEl = document.getElementById("popup-status");
		const popupConfirmation = document.getElementById("popup-drop-confirmation");
		window.__understudyLastMouse = null;

		function openerState() {
			return window.opener;
		}

		function insideDropZone(event) {
			const rect = dropZone.getBoundingClientRect();
			return (
				event.clientX >= rect.left &&
				event.clientX <= rect.right &&
				event.clientY >= rect.top &&
				event.clientY <= rect.bottom
			);
		}

		function markPopupDropped() {
			const openerWindow = openerState();
			if (!openerWindow) {
				return;
			}
			openerWindow.__understudyCrossWindowDrop = "dropped";
			openerWindow.__understudyCrossWindowDrag = "idle";
			popupStatusEl.textContent = "popup:dropped";
			popupConfirmation.hidden = false;
		}
		window.__understudyMarkPopupDropped = markPopupDropped;
		popupActionButton.addEventListener("click", () => {
			popupActionStatusEl.textContent = "popup-action:clicked";
		});

		document.addEventListener("mousemove", (event) => {
			window.__understudyLastMouse = {
				clientX: event.clientX,
				clientY: event.clientY,
			};
			const openerWindow = openerState();
			if (
				openerWindow &&
				openerWindow.__understudyCrossWindowDrag === "active" &&
				event.buttons === 1 &&
				insideDropZone(event)
			) {
				markPopupDropped();
			}
		});

		window.resetSmokeState = () => {
			window.__understudyLastMouse = null;
			popupActionStatusEl.textContent = "popup-action:idle";
			popupStatusEl.textContent = "popup:waiting";
			popupConfirmation.hidden = true;
			if (openerState()) {
				openerState().__understudyCrossWindowDrag = "idle";
				openerState().__understudyCrossWindowDrop = "pending";
			}
		};

		window.addEventListener("mouseup", (event) => {
			const openerWindow = openerState();
			if (!openerWindow || openerWindow.__understudyCrossWindowDrag !== "active") {
				return;
			}
			openerWindow.__understudyCrossWindowDrag = "idle";
			if (!insideDropZone(event)) {
				return;
			}
			markPopupDropped();
		});
	</script>
</body>
</html>`;

const TEST_PAGE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<title>Understudy GUI smoke</title>
	<style>
		body {
			margin: 0;
			font-family: -apple-system, BlinkMacSystemFont, sans-serif;
			background: #f4f7fb;
			color: #132235;
		}
		.shell {
			padding: 24px;
			display: grid;
			grid-template-columns: 1fr 320px;
			gap: 20px;
		}
		.card {
			border: 1px solid rgba(19, 34, 53, 0.12);
			border-radius: 16px;
			background: #ffffff;
			padding: 16px;
			box-shadow: 0 12px 30px rgba(19, 34, 53, 0.08);
		}
		.row {
			display: flex;
			flex-wrap: wrap;
			gap: 12px;
			align-items: center;
			margin-bottom: 12px;
		}
		.twin-row {
			width: 100%;
			justify-content: space-between;
		}
		button,
		input {
			font: inherit;
			padding: 10px 12px;
			border-radius: 12px;
			border: 1px solid rgba(19, 34, 53, 0.16);
			background: #fff;
		}
		#drag-source {
			position: absolute;
			left: 48px;
			top: 180px;
			width: 120px;
			height: 52px;
			border-radius: 14px;
			display: grid;
			place-items: center;
			background: #dcecff;
			border: 1px solid #7ca7df;
			user-select: none;
		}
		#drop-zone {
			position: absolute;
			left: 300px;
			top: 170px;
			width: 180px;
			height: 120px;
			border-radius: 16px;
			border: 2px dashed #7ca7df;
			display: grid;
			place-items: center;
			background: rgba(124, 167, 223, 0.12);
		}
			#scroll-area {
				height: 180px;
				overflow: auto;
			border-radius: 14px;
			border: 1px solid rgba(19, 34, 53, 0.12);
			padding: 12px;
			background: linear-gradient(180deg, #f9fbff 0%, #eef4fb 100%);
		}
		.scroll-spacer {
			height: 320px;
		}
			#bottom-item {
				margin-top: 12px;
				padding: 10px 12px;
				border-radius: 12px;
				background: #e9f7ec;
			}
			.nested-scroll-shell {
				margin-top: 16px;
				padding: 10px;
				border-radius: 14px;
				background: rgba(19, 34, 53, 0.04);
			}
			#nested-scroll-area {
				height: 110px;
				overflow: auto;
				border-radius: 12px;
				border: 1px solid rgba(19, 34, 53, 0.12);
				padding: 10px;
				background: #fff;
			}
			.nested-scroll-spacer {
				height: 220px;
			}
			#nested-bottom-item {
				margin-top: 12px;
				padding: 8px 10px;
				border-radius: 10px;
				background: #fff6d9;
			}
			#reorder-list {
				margin-top: 160px;
				display: grid;
				gap: 10px;
				max-width: 220px;
			}
			.reorder-item {
				padding: 12px 14px;
				border-radius: 12px;
				border: 1px solid rgba(19, 34, 53, 0.14);
				background: #fff;
				user-select: none;
			}
			.reorder-item[data-dragging="true"] {
				border-color: #5a8dd8;
				box-shadow: 0 0 0 2px rgba(90, 141, 216, 0.18);
			}
			.status {
				font-size: 13px;
				color: #496076;
		}
		#delayed-badge[hidden] {
			display: none;
		}
	</style>
</head>
<body>
	<div class="shell">
		<div class="card" data-gui-scope="Workspace panel">
			<div class="row">
				<button data-gui-target="Click button" id="click-button">Click button</button>
				<button data-gui-target="Double button" id="double-button">Double button</button>
				<button data-gui-target="Context button" id="context-button">Context button</button>
				<button data-gui-target="Hold button" id="hold-button">Hold button</button>
			</div>
			<div class="row">
				<input data-gui-target="Input field" id="input-field" placeholder="Type here">
				<button data-gui-target="Hover chip" id="hover-target">Hover chip</button>
			</div>
			<div class="row twin-row">
				<button data-gui-target="Twin action" id="twin-action-left">Twin action</button>
				<button data-gui-target="Twin action" id="twin-action-right">Twin action</button>
			</div>
				<div class="row status">
					<div id="status">idle</div>
					<div id="typed-value">typed:</div>
				<div id="twin-status">twin:none</div>
				<div id="keypress-status">keypress:none</div>
				<div id="hotkey-status">hotkey:none</div>
				<div id="right-click-status">right-click:none</div>
				<div id="hover-status">hover:none</div>
				<div id="hold-status">hold:none</div>
				<div id="click-confirmation" data-gui-target="Click confirmation" hidden>click:done</div>
				<div id="context-menu" data-gui-target="Context menu" hidden>Context menu</div>
				<div id="hover-tooltip" data-gui-target="Hover tooltip" hidden>Tooltip ready</div>
					<div id="hold-badge" data-gui-target="Hold badge" hidden>Hold ready</div>
					<div id="drop-confirmation" data-gui-target="Drop confirmation" hidden>Drop complete</div>
					<div id="reorder-status">reorder:Draft card | Review card | Released card</div>
					<div id="reorder-confirmation" data-gui-target="Reorder confirmation" hidden>Reorder complete</div>
				</div>
				<div id="drag-source" data-gui-target="Draggable card">Drag me</div>
				<div id="drop-zone" data-gui-target="Drop zone">Drop zone</div>
				<div id="cross-window-source" data-gui-target="Cross-window card" style="position:absolute; left:48px; top:318px; width:140px; height:52px; border-radius:14px; display:grid; place-items:center; background:#f4e6ff; border:1px solid #b08adc; user-select:none;">Cross-window card</div>
				<div id="reorder-list">
					<div class="reorder-item" id="reorder-draft" data-gui-target="Draft card" data-reorder-item="draft">Draft card</div>
					<div class="reorder-item" id="reorder-review" data-gui-target="Review card" data-reorder-item="review">Review card</div>
					<div class="reorder-item" id="reorder-released" data-gui-target="Released card" data-reorder-item="released">Released card</div>
				</div>
			</div>
			<div class="card" data-gui-scope="Sidebar panel">
				<div id="scroll-area" data-gui-target="Scroll area">
					<div>Scroll from here.</div>
					<div class="scroll-spacer"></div>
					<div id="bottom-item" data-gui-target="Bottom item">Bottom item</div>
				</div>
				<div class="nested-scroll-shell">
					<div id="nested-scroll-area" data-gui-target="Nested scroll container">
						<div>Nested scroll start.</div>
						<div class="nested-scroll-spacer"></div>
						<div id="nested-bottom-item" data-gui-target="Nested bottom item">Nested bottom item</div>
					</div>
				</div>
				<div class="row" style="margin-top:16px">
					<div id="delayed-badge" data-gui-target="Delayed badge" hidden>Ready</div>
				</div>
		</div>
	</div>
	<script>
		const statusEl = document.getElementById("status");
		const typedValueEl = document.getElementById("typed-value");
		const keypressStatusEl = document.getElementById("keypress-status");
		const hotkeyStatusEl = document.getElementById("hotkey-status");
		const rightClickStatusEl = document.getElementById("right-click-status");
		const hoverStatusEl = document.getElementById("hover-status");
		const holdStatusEl = document.getElementById("hold-status");
		const input = document.getElementById("input-field");
		const dragSource = document.getElementById("drag-source");
		const dropZone = document.getElementById("drop-zone");
		const clickButton = document.getElementById("click-button");
		const doubleButton = document.getElementById("double-button");
		const contextButton = document.getElementById("context-button");
		const twinActionLeft = document.getElementById("twin-action-left");
		const twinActionRight = document.getElementById("twin-action-right");
		const twinStatusEl = document.getElementById("twin-status");
		const hoverTarget = document.getElementById("hover-target");
			const holdButton = document.getElementById("hold-button");
			const contextMenu = document.getElementById("context-menu");
			const hoverTooltip = document.getElementById("hover-tooltip");
			const holdBadge = document.getElementById("hold-badge");
			const dropConfirmation = document.getElementById("drop-confirmation");
			const reorderStatusEl = document.getElementById("reorder-status");
			const reorderConfirmation = document.getElementById("reorder-confirmation");
			const delayedBadge = document.getElementById("delayed-badge");
			const scrollArea = document.getElementById("scroll-area");
			const nestedScrollArea = document.getElementById("nested-scroll-area");
			const crossWindowSource = document.getElementById("cross-window-source");
			const reorderList = document.getElementById("reorder-list");
			const reorderDraft = document.getElementById("reorder-draft");
			const reorderReview = document.getElementById("reorder-review");
			const reorderReleased = document.getElementById("reorder-released");
			window.__understudyLastMouse = null;
			window.__understudyCrossWindowDrag = "idle";
			window.__understudyCrossWindowDrop = "pending";
			let holdTimer = null;
			let holdTriggered = false;
			let reorderDraggingItem = null;

		clickButton.addEventListener("click", () => {
			statusEl.textContent = "clicked";
			document.getElementById("click-confirmation").hidden = false;
		});
		doubleButton.addEventListener("dblclick", () => {
			statusEl.textContent = "double-clicked";
		});
		contextButton.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			statusEl.textContent = "right-clicked";
			rightClickStatusEl.textContent = "right-click:done";
			contextMenu.hidden = false;
		});
		twinActionLeft.addEventListener("click", () => {
			twinStatusEl.textContent = "twin:left";
		});
		twinActionRight.addEventListener("click", () => {
			twinStatusEl.textContent = "twin:right";
		});
		hoverTarget.addEventListener("mouseenter", () => {
			hoverStatusEl.textContent = "hover:done";
			hoverTooltip.hidden = false;
		});
		hoverTarget.addEventListener("mouseleave", () => {
			hoverStatusEl.textContent = "hover:none";
			hoverTooltip.hidden = true;
		});
		holdButton.addEventListener("mousedown", () => {
			holdTriggered = false;
			holdStatusEl.textContent = "hold:pending";
			if (holdTimer) {
				clearTimeout(holdTimer);
			}
			holdTimer = setTimeout(() => {
				holdTriggered = true;
				statusEl.textContent = "held";
				holdStatusEl.textContent = "hold:done";
				holdBadge.hidden = false;
			}, 280);
		});
		document.addEventListener("mouseup", () => {
			if (holdTimer) {
				clearTimeout(holdTimer);
				holdTimer = null;
			}
			if (!holdTriggered) {
				holdStatusEl.textContent = "hold:none";
			}
		});
		input.addEventListener("input", () => {
			typedValueEl.textContent = "typed:" + input.value;
		});
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				keypressStatusEl.textContent = "keypress:enter";
			}
			if (event.shiftKey && event.key.toLowerCase() === "k") {
				hotkeyStatusEl.textContent = "hotkey:shift+k";
			}
		});

		let dragging = false;
		dragSource.addEventListener("mousedown", () => {
			dragging = true;
		});
		document.addEventListener("mousemove", (event) => {
			window.__understudyLastMouse = {
				clientX: event.clientX,
				clientY: event.clientY,
			};
			if (!dragging) {
				return;
			}
			dragSource.style.left = (event.clientX - 60) + "px";
			dragSource.style.top = (event.clientY - 26) + "px";
		});
			document.addEventListener("mouseup", (event) => {
				if (!dragging) {
					return;
			}
			dragging = false;
			const rect = dropZone.getBoundingClientRect();
			if (
				event.clientX >= rect.left &&
				event.clientX <= rect.right &&
				event.clientY >= rect.top &&
				event.clientY <= rect.bottom
			) {
				statusEl.textContent = "dropped";
					dropConfirmation.hidden = false;
				}
			});

			crossWindowSource.addEventListener("mousedown", () => {
				window.__understudyCrossWindowDrag = "active";
				window.__understudyCrossWindowDrop = "pending";
			});

			function reorderSummary() {
				return Array.from(reorderList.querySelectorAll("[data-reorder-item]"))
					.map((node) => node.textContent.trim())
					.join(" | ");
			}

			reorderList.addEventListener("mousedown", (event) => {
				const target = event.target instanceof Element
					? event.target.closest("[data-reorder-item]")
					: null;
				if (!(target instanceof HTMLElement)) {
					return;
				}
				reorderDraggingItem = target;
				reorderDraggingItem.dataset.dragging = "true";
			});

			document.addEventListener("mouseup", (event) => {
				if (reorderDraggingItem) {
					const target = event.target instanceof Element
						? event.target.closest("[data-reorder-item]")
						: null;
					if (target instanceof HTMLElement && target !== reorderDraggingItem) {
						reorderList.insertBefore(reorderDraggingItem, target.nextElementSibling);
						reorderStatusEl.textContent = "reorder:" + reorderSummary();
						reorderConfirmation.hidden = false;
					}
					reorderDraggingItem.dataset.dragging = "false";
					reorderDraggingItem = null;
				}
				if (window.__understudyCrossWindowDrag === "active" && window.__understudyCrossWindowDrop !== "dropped") {
					setTimeout(() => {
						if (window.__understudyCrossWindowDrop !== "dropped") {
							window.__understudyCrossWindowDrag = "idle";
						}
					}, 90);
				}
			});

			window.showDelayedBadge = () => {
				setTimeout(() => {
				delayedBadge.hidden = false;
			}, 250);
		};
		window.hideDelayedBadge = () => {
			setTimeout(() => {
				delayedBadge.hidden = true;
			}, 250);
		};
		window.resetSmokeState = () => {
			if (holdTimer) {
				clearTimeout(holdTimer);
				holdTimer = null;
			}
			holdTriggered = false;
			statusEl.textContent = "idle";
			typedValueEl.textContent = "typed:";
			twinStatusEl.textContent = "twin:none";
			keypressStatusEl.textContent = "keypress:none";
			hotkeyStatusEl.textContent = "hotkey:none";
			rightClickStatusEl.textContent = "right-click:none";
			hoverStatusEl.textContent = "hover:none";
			holdStatusEl.textContent = "hold:none";
			input.value = "";
			clickButton.blur();
			doubleButton.blur();
			contextButton.blur();
			twinActionLeft.blur();
			twinActionRight.blur();
			hoverTarget.blur();
				holdButton.blur();
				input.blur();
				contextMenu.hidden = true;
				hoverTooltip.hidden = true;
				holdBadge.hidden = true;
				dropConfirmation.hidden = true;
			reorderConfirmation.hidden = true;
			document.getElementById("click-confirmation").hidden = true;
			delayedBadge.hidden = true;
			window.__understudyLastMouse = null;
			window.__understudyCrossWindowDrag = "idle";
			window.__understudyCrossWindowDrop = "pending";
			dragSource.style.left = "48px";
				dragSource.style.top = "180px";
				crossWindowSource.style.left = "48px";
				crossWindowSource.style.top = "318px";
				scrollArea.scrollTop = 0;
				nestedScrollArea.scrollTop = 0;
				reorderList.append(reorderDraft, reorderReview, reorderReleased);
				reorderStatusEl.textContent = "reorder:" + reorderSummary();
			};
		</script>
</body>
</html>`;

	describe.runIf(shouldRunRealGuiTests)("ComputerUseGuiRuntime real smoke", () => {
		let browser: any;
		let page: any;
		let popupPage: any;
		let browserAppName: string | undefined;
		let browserRuntime: ComputerUseGuiRuntime;
		let realOpenAIGroundedRuntimePromise: Promise<ComputerUseGuiRuntime> | undefined;
		let popupSurface: BrowserGuiSurface;
		const browserSurfaces: BrowserGuiSurface[] = [];

		async function getRealOpenAIGroundedRuntime(): Promise<ComputerUseGuiRuntime> {
			if (!realOpenAIGroundedRuntimePromise) {
				realOpenAIGroundedRuntimePromise = createRealOpenAIGroundedRuntime();
			}
			return realOpenAIGroundedRuntimePromise;
		}

	beforeAll(async () => {
		const { chromium } = await import("playwright");
		browser = await chromium.launch({
			headless: false,
		});
		const context = await browser.newContext({
			viewport: { width: 1200, height: 820 },
		});
		page = await context.newPage();
		await page.setContent(TEST_PAGE_HTML, { waitUntil: "load" });
		await moveBrowserWindow(page, {
			left: 40,
			top: 60,
			width: 980,
			height: 860,
		});
		const popupPromise = page.waitForEvent("popup");
		await page.evaluate(() => {
			const popup = window.open("", "understudy-cross-window", "popup=yes,width=440,height=560,left=1080,top=80");
			if (!popup) {
				throw new Error("Failed to open browser popup window for GUI smoke.");
			}
		});
		popupPage = await popupPromise;
		await popupPage.setContent(CROSS_WINDOW_POPUP_HTML, { waitUntil: "load" });
		await moveBrowserWindow(popupPage, {
			left: 1080,
			top: 80,
			width: 440,
			height: 560,
		});
		await prepareBrowserPagesForGui(page, popupPage);
		await page.waitForTimeout(350);
		const frontmost = await execFileAsync("osascript", [
			"-e",
			'tell application "System Events" to get name of first application process whose frontmost is true',
		]);
		browserAppName = frontmost.stdout.trim() || undefined;
		await prepareBrowserPageForGui(page);
		const browserViewportOrigin = await calibrateViewportOrigin(page);
		await prepareBrowserPageForGui(popupPage);
		const popupViewportOrigin = await calibrateViewportOrigin(popupPage);
		popupSurface = {
			page: popupPage,
			viewportOrigin: popupViewportOrigin,
		};
		browserSurfaces.push(
			{ page, viewportOrigin: browserViewportOrigin },
			popupSurface,
		);
		await prepareBrowserPageForGui(page);
		browserRuntime = new ComputerUseGuiRuntime({
			groundingProvider: createPlaywrightDomGroundingProvider(() => browserSurfaces),
		});
	}, REAL_GUI_SETUP_TIMEOUT_MS);

	afterAll(async () => {
		await browser?.close();
	}, REAL_GUI_SETUP_TIMEOUT_MS);

	it("drives read, click, right click, double click, hover, click and hold, drag, scroll, type, keypress, hotkey, screenshot, and wait against a real browser window", async () => {
		await prepareBrowserPagesForGui(popupPage, page);
		await resetSmokePage(page, popupPage);
		const runtime = browserRuntime;

			const readResult = await runtime.read({
				app: browserAppName,
				target: "Click button",
				scope: "Workspace panel",
			});
			expect(readResult.status.code).toBe("resolved");

			const clickResult = await runtime.click({
				app: browserAppName,
				target: "Click button",
				scope: "Workspace panel",
			});
			expect(clickResult.status.code).toBe("action_sent");
			await expect.poll(async () => page.textContent("#status")).toBe("clicked");

			const rightClickResult = await runtime.rightClick({
				app: browserAppName,
				target: "Context button",
				scope: "Workspace panel",
			});
			expect(rightClickResult.status.code).toBe("action_sent");
			await expect.poll(async () => page.textContent("#right-click-status")).toBe("right-click:done");

		const doubleClickResult = await runtime.doubleClick({
			app: browserAppName,
			target: "Double button",
			scope: "Workspace panel",
		});
		expect(doubleClickResult.status.code).toBe("action_sent");
		await expect.poll(async () => page.textContent("#status")).toBe("double-clicked");

			const hoverResult = await runtime.hover({
				app: browserAppName,
				target: "Hover chip",
				scope: "Workspace panel",
				settleMs: 250,
			});
			expect(hoverResult.status.code).toBe("action_sent");
			await expect.poll(async () => page.textContent("#hover-status")).toBe("hover:done");

			const holdResult = await runtime.clickAndHold({
				app: browserAppName,
				target: "Hold button",
				scope: "Workspace panel",
				holdDurationMs: 700,
			});
			expect(holdResult.status.code).toBe("action_sent");
			await expect.poll(async () => page.textContent("#hold-status")).toBe("hold:done");

			const dragResult = await runtime.drag({
				app: browserAppName,
				fromTarget: "Draggable card",
				toTarget: "Drop zone",
				fromScope: "Workspace panel",
				toScope: "Workspace panel",
				fromLocationHint: "left side of the workspace panel",
				toLocationHint: "right side of the workspace panel",
				durationMs: 650,
			});
			expect(dragResult.status.code).toBe("action_sent");
			await expect.poll(async () => page.textContent("#status")).toBe("dropped");

			const scrollResult = await runtime.scroll({
				app: browserAppName,
				target: "Scroll area",
				scope: "Sidebar panel",
				direction: "down",
				amount: 8,
			});
			expect(scrollResult.status.code).toBe("action_sent");
			await expect.poll(async () =>
				page.$eval("#scroll-area", (node: Element) => (node as HTMLElement).scrollTop > 0),
			).toBe(true);

		const typeResult = await runtime.type({
			app: browserAppName,
			target: "Input field",
			value: "gui smoke",
		});
		expect(typeResult.status.code).toBe("action_sent");
		await expect.poll(async () => page.inputValue("#input-field")).toBe("gui smoke");

		const keypressResult = await runtime.keypress({
			app: browserAppName,
			key: "Enter",
		});
		expect(keypressResult.status.code).toBe("action_sent");
		await expect.poll(async () => page.textContent("#keypress-status")).toBe("keypress:enter");

		const hotkeyResult = await runtime.hotkey({
			app: browserAppName,
			key: "k",
			modifiers: ["shift"],
		});
		expect(hotkeyResult.status.code).toBe("action_sent");
		await expect.poll(async () => page.textContent("#hotkey-status")).toBe("hotkey:shift+k");

		const screenshotResult = await runtime.screenshot({ app: browserAppName });
		expect(screenshotResult.status.code).toBe("observed");
		expect(screenshotResult.image?.mimeType).toBe("image/png");

		await page.evaluate(() => {
			(window as unknown as { showDelayedBadge: () => void }).showDelayedBadge();
		});
		const waitResult = await runtime.wait({
			app: browserAppName,
			target: "Delayed badge",
			timeoutMs: 3_000,
			intervalMs: 100,
		});
		expect(waitResult.status.code).toBe("condition_met");
		}, REAL_GUI_TEST_TIMEOUT_MS);

	it("waits for a badge to disappear against a real browser window", async () => {
		await prepareBrowserPagesForGui(popupPage, page);
		await resetSmokePage(page, popupPage);
		await page.evaluate(() => {
			const badge = document.getElementById("delayed-badge");
			if (!badge) {
				throw new Error("Missing delayed badge");
			}
			badge.hidden = false;
			(window as unknown as { hideDelayedBadge: () => void }).hideDelayedBadge();
		});

		const waitResult = await browserRuntime.wait({
			app: browserAppName,
			target: "Delayed badge",
			state: "disappear",
			timeoutMs: 3_000,
			intervalMs: 100,
		});
		expect(waitResult.status.code).toBe("condition_met");
		await expect.poll(async () =>
			page.$eval("#delayed-badge", (node: Element) => (node as HTMLElement).hidden),
		).toBe(true);
		}, REAL_GUI_TEST_TIMEOUT_MS);

	it("scrolls a nested container without moving the outer pane", async () => {
		await prepareBrowserPagesForGui(popupPage, page);
		await resetSmokePage(page, popupPage);

		const result = await browserRuntime.scroll({
			app: browserAppName,
			target: "Nested scroll container",
			scope: "Sidebar panel",
			direction: "down",
			distance: "page",
		});
		expect(result.status.code).toBe("action_sent");
		await expect.poll(async () =>
			page.$eval("#nested-scroll-area", (node: Element) => (node as HTMLElement).scrollTop),
		).toBeGreaterThan(80);
		await expect.poll(async () =>
			page.$eval("#scroll-area", (node: Element) => (node as HTMLElement).scrollTop),
		).toBe(0);
	}, REAL_GUI_TEST_TIMEOUT_MS);

	it("reorders a list via drag in a real browser window", async () => {
		await prepareBrowserPagesForGui(popupPage, page);
		await resetSmokePage(page, popupPage);

		const result = await browserRuntime.drag({
			app: browserAppName,
			fromTarget: "Draft card",
			toTarget: "Released card",
			fromScope: "Workspace panel",
			toScope: "Workspace panel",
			durationMs: 450,
		});
		expect(result.status.code).toBe("action_sent");
		await expect.poll(async () => page.textContent("#reorder-status")).toBe(
			"reorder:Review card | Released card | Draft card",
		);
	}, REAL_GUI_TEST_TIMEOUT_MS);

	it("drags from the main browser window into the popup window", async () => {
		await prepareBrowserPagesForGui(popupPage, page);
		await resetSmokePage(page, popupPage);
		await prepareBrowserPagesForGui(popupPage, page);
		const popupDropObserved = waitForObservedPopupDrop(popupPage, popupSurface, {
			timeoutMs: 4_500,
			pollMs: 40,
		});

		const result = await browserRuntime.drag({
			app: browserAppName,
			fromTarget: "Cross-window card",
			toTarget: "Popup drop zone",
			fromScope: "Workspace panel",
			toScope: "Popup panel",
			captureMode: "display",
			durationMs: 600,
		});
		expect(result.status.code).toBe("action_sent");
		await popupDropObserved;
		await expect.poll(async () => popupPage.textContent("#popup-status")).toBe("popup:dropped");
	}, REAL_GUI_TEST_TIMEOUT_MS);

	it("uses location hints to disambiguate duplicate targets with real native clicks", async () => {
		await prepareBrowserPagesForGui(popupPage, page);
		await resetSmokePage(page, popupPage);

		const leftResult = await browserRuntime.click({
			app: browserAppName,
			target: "Twin action",
			scope: "Workspace panel",
			locationHint: "left side of the workspace panel",
		});
		expect(leftResult.status.code).toBe("action_sent");
		await expect.poll(async () => page.textContent("#twin-status")).toBe("twin:left");

		await resetSmokePage(page, popupPage);

		const rightResult = await browserRuntime.click({
			app: browserAppName,
			target: "Twin action",
			scope: "Workspace panel",
			locationHint: "right side of the workspace panel",
		});
		expect(rightResult.status.code).toBe("action_sent");
		await expect.poll(async () => page.textContent("#twin-status")).toBe("twin:right");

		const leftPoint = leftResult.details?.grounding_display_point as { x?: number } | undefined;
		const rightPoint = rightResult.details?.grounding_display_point as { x?: number } | undefined;
		expect(typeof leftPoint?.x).toBe("number");
		expect(typeof rightPoint?.x).toBe("number");
		expect((leftPoint?.x as number)).toBeLessThan(rightPoint?.x as number);
	}, REAL_GUI_TEST_TIMEOUT_MS);

	it("clicks a popup control via display-space grounding and real native input", async () => {
		await prepareBrowserPagesForGui(page, popupPage);
		await resetSmokePage(page, popupPage);
		await prepareBrowserPagesForGui(page, popupPage);

		const result = await browserRuntime.click({
			app: browserAppName,
			target: "Popup action button",
			scope: "Popup panel",
			captureMode: "display",
		});
		expect(result.status.code).toBe("action_sent");
		expect(result.details?.grounding_coordinate_space).toBe("display_pixels");
		await expect.poll(async () => popupPage.textContent("#popup-action-status")).toBe("popup-action:clicked");
	}, REAL_GUI_TEST_TIMEOUT_MS);

	it.runIf(shouldRunRealGuiGroundingE2E)(
		"drives representative grounded click and scroll actions through real OpenAI grounding end to end",
		async () => {
			await prepareBrowserPagesForGui(popupPage, page);
			await resetSmokePage(page, popupPage);
			const runtime = await getRealOpenAIGroundedRuntime();

			const clickResult = await runtime.click({
				app: browserAppName,
				target: "Twin action",
				scope: "Workspace panel",
				locationHint: "right side of the workspace panel",
			});
			expect(clickResult.status.code).toBe("action_sent");
			expect(clickResult.details?.grounding_provider).toEqual(expect.stringContaining("openai"));
			await expect.poll(async () => page.textContent("#twin-status")).toBe("twin:right");

			const scrollResult = await runtime.scroll({
				app: browserAppName,
				target: "Scroll area",
				scope: "Sidebar panel",
				direction: "down",
				distance: "page",
			});
			expect(scrollResult.status.code).toBe("action_sent");
			expect(scrollResult.details?.grounding_provider).toEqual(expect.stringContaining("openai"));
			await expect.poll(async () =>
				page.$eval("#scroll-area", (node: Element) => (node as HTMLElement).scrollTop),
			).toBeGreaterThan(80);
		},
		REAL_GUI_GROUNDING_E2E_TIMEOUT_MS,
	);

	it.runIf(shouldRunRealGuiGroundingE2E)(
		"drives popup display-space clicks through real OpenAI grounding end to end",
		async () => {
			await prepareBrowserPagesForGui(page, popupPage);
			await resetSmokePage(page, popupPage);
			await prepareBrowserPagesForGui(page, popupPage);
			const runtime = await getRealOpenAIGroundedRuntime();

			const result = await runtime.click({
				app: browserAppName,
				target: "Popup action button",
				scope: "Popup panel",
				captureMode: "display",
			});
			expect(result.status.code).toBe("action_sent");
			expect(result.details?.grounding_provider).toEqual(expect.stringContaining("openai"));
			expect(result.details?.grounding_coordinate_space).toMatch(/^(image_pixels|display_pixels)$/);
			await expect.poll(async () => popupPage.textContent("#popup-action-status")).toBe("popup-action:clicked");
		},
		REAL_GUI_GROUNDING_E2E_TIMEOUT_MS,
	);

	it.runIf(shouldRunRealGuiBenchmarks)("reports a real GUI benchmark summary across stable scenario families", async () => {
		const runtime = browserRuntime;
		const iterations = resolveRealGuiBenchmarkIterations();
		const scenarios: Array<{
			id: string;
			family: RealGuiBenchmarkMeasurement["family"];
			run: () => Promise<void>;
		}> = [
			{
				id: "read_target",
				family: "region_observation",
				run: async () => {
					const result = await runtime.read({
						app: browserAppName,
						target: "Click button",
						scope: "Workspace panel",
					});
					expect(result.status.code).toBe("resolved");
				},
			},
			{
				id: "click",
				family: "point_action",
				run: async () => {
					const result = await runtime.click({
						app: browserAppName,
						target: "Click button",
						scope: "Workspace panel",
					});
					expect(result.status.code).toBe("action_sent");
					await expect.poll(async () => page.textContent("#status")).toBe("clicked");
				},
			},
			{
				id: "click_location_hint_right",
				family: "point_action",
				run: async () => {
					const result = await runtime.click({
						app: browserAppName,
						target: "Twin action",
						scope: "Workspace panel",
						locationHint: "right side of the workspace panel",
					});
					expect(result.status.code).toBe("action_sent");
					await expect.poll(async () => page.textContent("#twin-status")).toBe("twin:right");
				},
			},
			{
				id: "click_popup_display",
				family: "point_action",
				run: async () => {
					await prepareBrowserPagesForGui(page, popupPage);
					const result = await runtime.click({
						app: browserAppName,
						target: "Popup action button",
						scope: "Popup panel",
						captureMode: "display",
					});
					expect(result.status.code).toBe("action_sent");
					await expect.poll(async () => popupPage.textContent("#popup-action-status")).toBe("popup-action:clicked");
				},
			},
			{
				id: "right_click",
				family: "point_action",
				run: async () => {
					const result = await runtime.rightClick({
						app: browserAppName,
						target: "Context button",
						scope: "Workspace panel",
					});
					expect(result.status.code).toBe("action_sent");
					await expect.poll(async () => page.textContent("#right-click-status")).toBe("right-click:done");
				},
			},
			{
				id: "double_click",
				family: "point_action",
				run: async () => {
					const result = await runtime.doubleClick({
						app: browserAppName,
						target: "Double button",
						scope: "Workspace panel",
					});
					expect(result.status.code).toBe("action_sent");
					await expect.poll(async () => page.textContent("#status")).toBe("double-clicked");
				},
			},
			{
				id: "hover",
				family: "point_action",
				run: async () => {
					const result = await runtime.hover({
						app: browserAppName,
						target: "Hover chip",
						scope: "Workspace panel",
						settleMs: 250,
					});
					expect(result.status.code).toBe("action_sent");
					await expect.poll(async () => page.textContent("#hover-status")).toBe("hover:done");
				},
			},
			{
				id: "click_and_hold",
				family: "point_action",
				run: async () => {
					const result = await runtime.clickAndHold({
						app: browserAppName,
						target: "Hold button",
						scope: "Workspace panel",
						holdDurationMs: 700,
					});
					expect(result.status.code).toBe("action_sent");
					await expect.poll(async () => page.textContent("#hold-status")).toBe("hold:done");
				},
			},
				{
					id: "drag_drop_zone",
					family: "dual_point",
				run: async () => {
					const result = await runtime.drag({
						app: browserAppName,
						fromTarget: "Draggable card",
						toTarget: "Drop zone",
						fromScope: "Workspace panel",
						toScope: "Workspace panel",
						durationMs: 500,
					});
					expect(result.status.code).toBe("action_sent");
						await expect.poll(async () => page.textContent("#status")).toBe("dropped");
					},
				},
				{
					id: "drag_reorder_list",
					family: "dual_point",
					run: async () => {
						const result = await runtime.drag({
							app: browserAppName,
							fromTarget: "Draft card",
							toTarget: "Released card",
							fromScope: "Workspace panel",
							toScope: "Workspace panel",
							durationMs: 450,
						});
						expect(result.status.code).toBe("action_sent");
						await expect.poll(async () => page.textContent("#reorder-status")).toBe(
							"reorder:Review card | Released card | Draft card",
						);
					},
				},
				{
					id: "scroll_page_semantic",
					family: "region_observation",
				run: async () => {
					const result = await runtime.scroll({
						app: browserAppName,
						target: "Scroll area",
						scope: "Sidebar panel",
						direction: "down",
						distance: "page",
					});
					expect(result.status.code).toBe("action_sent");
						await expect.poll(async () =>
							page.$eval("#scroll-area", (node: Element) => (node as HTMLElement).scrollTop),
						).toBeGreaterThan(80);
					},
				},
				{
					id: "scroll_nested_targeted",
					family: "region_observation",
					run: async () => {
						const result = await runtime.scroll({
							app: browserAppName,
							target: "Nested scroll container",
							scope: "Sidebar panel",
							direction: "down",
							distance: "page",
						});
						expect(result.status.code).toBe("action_sent");
						await expect.poll(async () =>
							page.$eval("#nested-scroll-area", (node: Element) => (node as HTMLElement).scrollTop),
						).toBeGreaterThan(80);
						await expect.poll(async () =>
							page.$eval("#scroll-area", (node: Element) => (node as HTMLElement).scrollTop),
						).toBe(0);
					},
				},
			{
				id: "type_targeted",
				family: "hybrid",
				run: async () => {
					const result = await runtime.type({
						app: browserAppName,
						target: "Input field",
						value: "gui benchmark",
					});
					expect(result.status.code).toBe("action_sent");
					await expect.poll(async () => page.inputValue("#input-field")).toBe("gui benchmark");
				},
			},
			{
				id: "keypress_enter",
				family: "keyboard_only",
				run: async () => {
					await page.focus("#input-field");
					const result = await runtime.keypress({
						app: browserAppName,
						key: "Enter",
					});
					expect(result.status.code).toBe("action_sent");
					await expect.poll(async () => page.textContent("#keypress-status")).toBe("keypress:enter");
				},
			},
			{
				id: "hotkey_shift_k",
				family: "keyboard_only",
				run: async () => {
					await page.focus("#input-field");
					const result = await runtime.hotkey({
						app: browserAppName,
						key: "k",
						modifiers: ["shift"],
					});
					expect(result.status.code).toBe("action_sent");
					await expect.poll(async () => page.textContent("#hotkey-status")).toBe("hotkey:shift+k");
				},
			},
			{
				id: "screenshot",
				family: "region_observation",
				run: async () => {
					const result = await runtime.screenshot({ app: browserAppName });
					expect(result.status.code).toBe("observed");
					expect(result.image?.mimeType).toBe("image/png");
				},
			},
			{
				id: "wait_appear",
				family: "region_observation",
				run: async () => {
					await page.evaluate(() => {
						(window as unknown as { showDelayedBadge: () => void }).showDelayedBadge();
					});
					const result = await runtime.wait({
						app: browserAppName,
						target: "Delayed badge",
						timeoutMs: 3_000,
						intervalMs: 100,
					});
					expect(result.status.code).toBe("condition_met");
				},
			},
			{
				id: "wait_disappear",
				family: "region_observation",
				run: async () => {
					await page.evaluate(() => {
						const badge = document.getElementById("delayed-badge");
						if (!badge) {
							throw new Error("Missing delayed badge");
						}
						badge.hidden = false;
						(window as unknown as { hideDelayedBadge: () => void }).hideDelayedBadge();
					});
					const result = await runtime.wait({
						app: browserAppName,
						target: "Delayed badge",
						state: "disappear",
						timeoutMs: 3_000,
						intervalMs: 100,
					});
					expect(result.status.code).toBe("condition_met");
				},
			},
		];

		const measurements: RealGuiBenchmarkMeasurement[] = [];
			for (let iteration = 1; iteration <= iterations; iteration += 1) {
				for (const scenario of scenarios) {
					await prepareBrowserPagesForGui(popupPage, page);
					await resetSmokePage(page, popupPage);
				const startedAt = performance.now();
				try {
					await scenario.run();
					measurements.push({
						scenarioId: scenario.id,
						family: scenario.family,
						iteration,
						success: true,
						elapsedMs: performance.now() - startedAt,
					});
				} catch (error) {
					measurements.push({
						scenarioId: scenario.id,
						family: scenario.family,
						iteration,
						success: false,
						elapsedMs: performance.now() - startedAt,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			}
		}

		const summarizeLatency = (values: number[]) => {
			if (values.length === 0) {
				return { avg: null, p95: null };
			}
			const sorted = [...values].sort((left, right) => left - right);
			const avg = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
			const p95Index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
			return {
				avg,
				p95: sorted[p95Index] ?? null,
			};
		};

		const families = Array.from(new Set(measurements.map((measurement) => measurement.family)));
		console.log("\n[real-gui-benchmark] summary");
		for (const family of families) {
			const bucket = measurements.filter((measurement) => measurement.family === family);
			const successes = bucket.filter((measurement) => measurement.success).length;
			const latency = summarizeLatency(bucket.map((measurement) => measurement.elapsedMs));
			console.log(
				`[real-gui-benchmark] family=${family} success=${successes}/${bucket.length} avg=${latency.avg?.toFixed(1) ?? "n/a"}ms p95=${latency.p95?.toFixed(1) ?? "n/a"}ms`,
			);
		}

		const failures = measurements.filter((measurement) => !measurement.success);
		if (failures.length > 0) {
			for (const failure of failures) {
				console.error(
					`[real-gui-benchmark] failure scenario=${failure.scenarioId} iteration=${failure.iteration}: ${failure.error ?? "unknown error"}`,
				);
			}
		}
		expect(failures).toHaveLength(0);
		}, REAL_GUI_BENCHMARK_TIMEOUT_MS);

	it("drives native Finder navigation, grounded click, and screenshot flows", async () => {
		const fixtureDir = await mkdtemp(join(tmpdir(), "understudy-finder-smoke-"));
		const nestedDir = join(fixtureDir, "Nested");
		try {
			await mkdir(nestedDir, { recursive: true });
			await writeFile(join(nestedDir, "note.txt"), "finder smoke\n", "utf-8");
			await closeFinderWindows();
			await revealFinderPath(nestedDir);
			await expect.poll(async () => normalizeFinderPath(await readFinderWindowTargetPath())).toBe(
				normalizeFinderPath(fixtureDir),
			);

			const runtime = new ComputerUseGuiRuntime();
			const openResult = await runtime.hotkey({
				app: "Finder",
				key: "down",
				modifiers: ["command"],
			});
			expect(openResult.status.code).toBe("action_sent");
			await expect.poll(async () => normalizeFinderPath(await readFinderWindowTargetPath())).toBe(
				normalizeFinderPath(nestedDir),
			);

			const screenshotResult = await runtime.screenshot({
				app: "Finder",
			});
			expect(screenshotResult.status.code).toBe("observed");
			expect(screenshotResult.image?.mimeType).toBe("image/png");

			const backResult = await runtime.hotkey({
				app: "Finder",
				key: "up",
				modifiers: ["command"],
			});
			expect(backResult.status.code).toBe("action_sent");
			await expect.poll(async () => normalizeFinderPath(await readFinderWindowTargetPath())).toBe(
				normalizeFinderPath(fixtureDir),
			);

			const groundedFinderRuntime = new ComputerUseGuiRuntime({
				groundingProvider: {
					ground: async (params) => {
						if (params.target !== "Finder close button") {
							return undefined;
						}
						const rect = await readFinderFrontWindowCloseButtonRect();
						return {
							method: "grounding" as const,
							provider: "finder-accessibility-fixture",
							confidence: 0.92,
							reason: "Resolved the Finder front-window close button via accessibility geometry.",
							coordinateSpace: "display_pixels" as const,
							point: {
								x: Math.round(rect.x + (rect.width / 2)),
								y: Math.round(rect.y + (rect.height / 2)),
							},
							box: rect,
						};
					},
				},
			});
			const closeResult = await groundedFinderRuntime.click({
				app: "Finder",
				target: "Finder close button",
				captureMode: "display",
			});
			expect(closeResult.status.code).toBe("action_sent");
			expect(closeResult.details?.grounding_coordinate_space).toBe("display_pixels");
			await expect.poll(countFinderWindows).toBe(0);
		} finally {
			await closeFinderWindows();
			await rm(fixtureDir, { recursive: true, force: true });
		}
		}, REAL_GUI_TEST_TIMEOUT_MS);

	it("drives native TextEdit hotkey, typing, keypress, and screenshot flows", async () => {
		await closeTextEditWithoutSaving();
		await launchTextEdit();
		const runtime = new ComputerUseGuiRuntime();
			try {
				const newDoc = await runtime.hotkey({
					app: "TextEdit",
					key: "n",
					modifiers: ["command"],
				});
				expect(newDoc.status.code).toBe("action_sent");

			const typeFirstLine = await runtime.type({
				app: "TextEdit",
				value: "Understudy native smoke",
			});
			expect(typeFirstLine.status.code).toBe("action_sent");
			await expect.poll(readTextEditDocumentText).toContain("Understudy native smoke");

			const enterResult = await runtime.keypress({
				app: "TextEdit",
				key: "Enter",
			});
			expect(enterResult.status.code).toBe("action_sent");

			const typeSecondLine = await runtime.type({
				app: "TextEdit",
				value: "Second line",
				replace: false,
			});
			expect(typeSecondLine.status.code).toBe("action_sent");
			await expect.poll(readTextEditDocumentText).toContain("Understudy native smoke\nSecond line");

			const screenshotResult = await runtime.screenshot({
				app: "TextEdit",
			});
			expect(screenshotResult.status.code).toBe("observed");
			expect(screenshotResult.image?.mimeType).toBe("image/png");
			} finally {
				await closeTextEditWithoutSaving();
			}
		}, REAL_GUI_TEST_TIMEOUT_MS);
	});
