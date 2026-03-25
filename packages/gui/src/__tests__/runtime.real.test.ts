/// <reference lib="dom" />

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
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
const PIXELMATOR_APP_BUNDLE_PATH = "/Applications/Pixelmator Pro Creator Studio.app";
const PIXELMATOR_APP_NAME = "Pixelmator Pro";
const shouldRunRealPixelmatorTaskE2E =
	shouldRunRealGuiGroundingE2E &&
	existsSync(PIXELMATOR_APP_BUNDLE_PATH);
const DEFAULT_REAL_GUI_BENCHMARK_ITERATIONS = 2;
const REAL_GUI_SETUP_TIMEOUT_MS = 120_000;
const REAL_GUI_TEST_TIMEOUT_MS = 60_000;
const REAL_GUI_BENCHMARK_TIMEOUT_MS = 180_000;
const REAL_GUI_GROUNDING_E2E_TIMEOUT_MS = 180_000;
const REAL_GUI_NATIVE_TASK_TIMEOUT_MS = 360_000;
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
	const provider =
		process.env.UNDERSTUDY_REAL_GUI_GROUNDING_PROVIDER?.trim() ||
		"openai-codex";
	const resolved = await guiGroundingModule.primeGuiGroundingForConfig({
		...configModule.DEFAULT_CONFIG,
		defaultProvider: provider,
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

const MOUSE_CLICK_SCRIPT = String.raw`
import Foundation
import CoreGraphics

enum ClickError: Error {
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
	throw ClickError.invalidPoint
}

let point = CGPoint(x: x, y: y)
guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left) else {
	throw ClickError.eventCreationFailed
}
guard let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left) else {
	throw ClickError.eventCreationFailed
}
down.post(tap: .cghidEventTap)
usleep(30_000)
up.post(tap: .cghidEventTap)
print("clicked")
`;

const MOUSE_LOCATION_SCRIPT = String.raw`
import CoreGraphics

let point = CGEvent(source: nil)?.location ?? .zero
print("\(Int(round(point.x))),\(Int(round(point.y)))")
`;

const PIXELMATOR_WINDOW_TITLES_SCRIPT = String.raw`
tell application "System Events"
	tell process "Pixelmator Pro"
		set windowNames to name of windows
	end tell
end tell
set AppleScript's text item delimiters to linefeed
return windowNames as text
`;

const PIXELMATOR_FIXTURE_IMAGE_SCRIPT = String.raw`
import AppKit

let outputPath = ProcessInfo.processInfo.environment["UNDERSTUDY_PIXELMATOR_OUTPUT"] ?? ""
guard !outputPath.isEmpty else {
	fatalError("UNDERSTUDY_PIXELMATOR_OUTPUT is required")
}

let size = NSSize(width: 900, height: 600)
let image = NSImage(size: size)
image.lockFocus()

NSColor(calibratedRed: 0.11, green: 0.14, blue: 0.21, alpha: 1).setFill()
NSBezierPath(rect: NSRect(origin: .zero, size: size)).fill()

NSColor(calibratedRed: 0.98, green: 0.83, blue: 0.29, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 70, y: 360, width: 280, height: 170), xRadius: 28, yRadius: 28).fill()

NSColor(calibratedRed: 0.23, green: 0.61, blue: 0.96, alpha: 1).setFill()
NSBezierPath(ovalIn: NSRect(x: 420, y: 120, width: 210, height: 210)).fill()

NSColor(calibratedRed: 0.91, green: 0.34, blue: 0.43, alpha: 1).setFill()
let triangle = NSBezierPath()
triangle.move(to: NSPoint(x: 690, y: 110))
triangle.line(to: NSPoint(x: 840, y: 490))
triangle.line(to: NSPoint(x: 560, y: 470))
triangle.close()
triangle.fill()

let caption = "Understudy Pixelmator"
let attributes: [NSAttributedString.Key: Any] = [
	.font: NSFont.boldSystemFont(ofSize: 54),
	.foregroundColor: NSColor.white,
]
caption.draw(at: NSPoint(x: 72, y: 84), withAttributes: attributes)

image.unlockFocus()

guard
	let tiffRepresentation = image.tiffRepresentation,
	let bitmap = NSBitmapImageRep(data: tiffRepresentation),
	let pngData = bitmap.representation(using: .png, properties: [:])
else {
	fatalError("Failed to encode fixture image")
}

try pngData.write(to: URL(fileURLWithPath: outputPath))
print(outputPath)
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

async function clickMouseAtScreenPoint(point: { x: number; y: number }): Promise<void> {
	await execFileAsync("swift", ["-e", MOUSE_CLICK_SCRIPT], {
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

function readGroundingDisplayPoint(details: Record<string, unknown> | undefined): { x: number; y: number } {
	const point = details?.grounding_display_point as { x?: number; y?: number } | undefined;
	if (!point || typeof point.x !== "number" || typeof point.y !== "number") {
		throw new Error("Expected grounding_display_point in GUI result details.");
	}
	return {
		x: point.x,
		y: point.y,
	};
}

async function createPixelmatorFixtureImage(imagePath: string): Promise<void> {
	await execFileAsync("swift", ["-e", PIXELMATOR_FIXTURE_IMAGE_SCRIPT], {
		env: {
			...process.env,
			UNDERSTUDY_PIXELMATOR_OUTPUT: imagePath,
		},
	});
}

async function readPixelmatorWindowTitles(): Promise<string[]> {
	try {
		const result = await execFileAsync("osascript", ["-e", PIXELMATOR_WINDOW_TITLES_SCRIPT], {
			env: process.env,
		});
		return result.stdout
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

async function openPixelmatorFixture(imagePath: string): Promise<void> {
	await execFileAsync("open", ["-a", PIXELMATOR_APP_BUNDLE_PATH, imagePath], {
		env: process.env,
	});
	await execFileAsync("osascript", ["-e", 'tell application "Pixelmator Pro Creator Studio" to activate'], {
		env: process.env,
	});
}

async function closePixelmatorFrontDocumentWithoutSaving(): Promise<void> {
	await runAppleScript(String.raw`
tell application "System Events"
	if exists process "Pixelmator Pro" then
		tell process "Pixelmator Pro"
			keystroke "w" using command down
			delay 0.3
			if exists sheet 1 of front window then
				if exists button "Don't Save" of sheet 1 of front window then
					click button "Don't Save" of sheet 1 of front window
				else if exists button "不保存" of sheet 1 of front window then
					click button "不保存" of sheet 1 of front window
				end if
			end if
		end tell
	end if
end tell
`).catch(() => {});
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

					function elementsWithExactGuiValue(
						root: ParentNode,
						attributeName: string,
						value: string,
					): HTMLElement[] {
						return Array.from(root.querySelectorAll(`[${attributeName}]`))
							.filter((element) => element.getAttribute(attributeName) === value) as HTMLElement[];
					}

					const label = params.label;
					const root = params.scope
						? elementsWithExactGuiValue(document, "data-gui-scope", params.scope)[0] ?? null
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
					const candidates = elementsWithExactGuiValue(searchRoot, "data-gui-target", label);
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
		.slider-puzzle-shell {
			margin-top: 220px;
			max-width: 380px;
			padding: 14px;
			border-radius: 18px;
			border: 1px solid rgba(19, 34, 53, 0.1);
			background: linear-gradient(180deg, #f9fbff 0%, #eef4fb 100%);
		}
		.slider-puzzle-stage {
			position: relative;
			width: 360px;
			height: 128px;
			overflow: hidden;
			border-radius: 18px;
			border: 1px solid rgba(19, 34, 53, 0.12);
			background:
				radial-gradient(circle at 25% 28%, rgba(255, 255, 255, 0.58) 0 16%, transparent 17%),
				radial-gradient(circle at 70% 36%, rgba(255, 214, 138, 0.42) 0 14%, transparent 15%),
				linear-gradient(135deg, #d7e8ff 0%, #c6def9 38%, #f8efe1 100%);
		}
		.slider-puzzle-stage::before {
			content: "";
			position: absolute;
			inset: 0;
			background:
				linear-gradient(90deg, rgba(255, 255, 255, 0.22) 0 12%, transparent 12% 20%, rgba(255, 255, 255, 0.16) 20% 28%, transparent 28% 100%),
				repeating-linear-gradient(90deg, rgba(19, 34, 53, 0.04) 0 24px, transparent 24px 48px);
			pointer-events: none;
		}
		#slider-puzzle-gap,
		#slider-puzzle-piece {
			position: absolute;
			top: 28px;
			width: 58px;
			height: 58px;
			border-radius: 16px;
		}
		#slider-puzzle-gap {
			left: 244px;
			border: 2px dashed rgba(78, 117, 173, 0.72);
			background: rgba(255, 255, 255, 0.2);
			box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28);
		}
		#slider-puzzle-piece {
			left: 18px;
			border: 1px solid rgba(78, 117, 173, 0.54);
			background:
				radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.7) 0 18%, transparent 19%),
				linear-gradient(135deg, #fff7e8 0%, #ffd9a4 38%, #d0e4ff 100%);
			box-shadow: 0 12px 20px rgba(19, 34, 53, 0.16);
			pointer-events: none;
		}
		.slider-track-caption {
			margin-top: 12px;
			font-size: 12px;
			color: #51697f;
		}
		#slider-track {
			position: relative;
			margin-top: 10px;
			width: 360px;
			height: 52px;
			border-radius: 999px;
			border: 1px solid rgba(19, 34, 53, 0.12);
			background: rgba(255, 255, 255, 0.82);
			box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65);
		}
		#slider-track::before {
			content: "Slide to complete";
			position: absolute;
			inset: 0;
			display: grid;
			place-items: center;
			font-size: 13px;
			color: #6c8195;
			letter-spacing: 0.01em;
			pointer-events: none;
		}
		#slider-target-marker {
			position: absolute;
			left: 256px;
			top: 11px;
			width: 48px;
			height: 30px;
			border-radius: 999px;
			border: 1px dashed rgba(90, 141, 216, 0.72);
			background: rgba(90, 141, 216, 0.16);
			box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28);
		}
		#slider-thumb {
			position: absolute;
			left: 12px;
			top: 8px;
			width: 48px;
			height: 36px;
			border-radius: 999px;
			border: 1px solid rgba(90, 141, 216, 0.84);
			background: linear-gradient(180deg, #ffffff 0%, #dbe8fb 100%);
			display: grid;
			place-items: center;
			font-size: 18px;
			font-weight: 700;
			color: #3d628d;
			box-shadow: 0 8px 16px rgba(61, 98, 141, 0.2);
			user-select: none;
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
				margin-top: 28px;
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
			.delayed-badge {
				display: inline-flex;
				align-items: center;
				padding: 10px 14px;
				border-radius: 999px;
				border: 1px solid rgba(34, 107, 68, 0.28);
				background: linear-gradient(135deg, #ecfff2 0%, #d4f7de 100%);
				color: #1f5b37;
				font-size: 15px;
				font-weight: 600;
				box-shadow: 0 8px 22px rgba(31, 91, 55, 0.12);
			}
			.delayed-panel {
				display: grid;
				gap: 4px;
				padding: 14px 16px;
				border-radius: 16px;
				border: 1px solid rgba(29, 101, 61, 0.2);
				background: linear-gradient(135deg, #f5fff7 0%, #dff8e8 100%);
				color: #15482c;
				box-shadow: 0 14px 32px rgba(21, 72, 44, 0.12);
				max-width: 320px;
			}
			.delayed-panel strong {
				font-size: 17px;
				font-weight: 700;
			}
			.delayed-panel span {
				font-size: 14px;
				color: #2e6a46;
			}
			#delayed-badge[hidden] {
				display: none;
			}
			#delayed-panel[hidden] {
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
					<div id="slider-status">slider:idle</div>
					<div id="slider-confirmation" data-gui-target="Slider puzzle confirmation" hidden>Slider puzzle solved</div>
				</div>
				<div id="drag-source" data-gui-target="Draggable card">Drag me</div>
				<div id="drop-zone" data-gui-target="Drop zone">Drop zone</div>
				<div id="cross-window-source" data-gui-target="Cross-window card" style="position:absolute; left:48px; top:318px; width:140px; height:52px; border-radius:14px; display:grid; place-items:center; background:#f4e6ff; border:1px solid #b08adc; user-select:none;">Cross-window card</div>
					<div class="slider-puzzle-shell">
						<div class="slider-puzzle-stage" aria-label="Slider puzzle stage">
							<div id="slider-puzzle-gap" data-gui-target="Puzzle gap"></div>
						<div id="slider-puzzle-piece"></div>
					</div>
					<div class="slider-track-caption">Move the slider until the floating tile fills the gap.</div>
						<div id="slider-track">
							<div id="slider-target-marker" data-gui-target="Puzzle completion marker"></div>
							<div id="slider-thumb" data-gui-target="Puzzle slider thumb">›</div>
						</div>
					</div>
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
					<div class="delayed-badge" id="delayed-badge" data-gui-target="Delayed badge" hidden>Ready to continue</div>
				</div>
				<div style="margin-top:12px">
					<div class="delayed-panel" id="delayed-panel" data-gui-target="Processing complete panel" hidden>
						<strong>Processing complete</strong>
						<span>Ready to continue with the next step.</span>
					</div>
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
			const delayedPanel = document.getElementById("delayed-panel");
			const scrollArea = document.getElementById("scroll-area");
			const nestedScrollArea = document.getElementById("nested-scroll-area");
			const crossWindowSource = document.getElementById("cross-window-source");
			const reorderList = document.getElementById("reorder-list");
			const reorderDraft = document.getElementById("reorder-draft");
			const reorderReview = document.getElementById("reorder-review");
			const reorderReleased = document.getElementById("reorder-released");
			const sliderTrack = document.getElementById("slider-track");
			const sliderThumb = document.getElementById("slider-thumb");
			const sliderPuzzlePiece = document.getElementById("slider-puzzle-piece");
			const sliderStatusEl = document.getElementById("slider-status");
			const sliderConfirmation = document.getElementById("slider-confirmation");
			window.__understudyLastMouse = null;
			window.__understudyCrossWindowDrag = "idle";
			window.__understudyCrossWindowDrop = "pending";
			let holdTimer = null;
			let holdTriggered = false;
			let reorderDraggingItem = null;
			let sliderDragging = false;
			const sliderThumbMinX = 12;
			const sliderThumbSolvedX = 256;
			const sliderThumbMaxX = 300;
			const sliderPieceStartX = 18;
			const sliderPieceSolvedX = 244;

		function clamp(value, min, max) {
			return Math.min(max, Math.max(min, value));
		}

		function setSliderPuzzlePosition(nextThumbX) {
			const thumbX = clamp(nextThumbX, sliderThumbMinX, sliderThumbMaxX);
			sliderThumb.style.left = thumbX + "px";
			const progress = clamp(
				(thumbX - sliderThumbMinX) / Math.max(1, sliderThumbSolvedX - sliderThumbMinX),
				0,
				1,
			);
			const pieceX = sliderPieceStartX + ((sliderPieceSolvedX - sliderPieceStartX) * progress);
			sliderPuzzlePiece.style.left = Math.round(pieceX) + "px";
			return thumbX;
		}

		function updateSliderPuzzleFromClientX(clientX) {
			const trackRect = sliderTrack.getBoundingClientRect();
			const thumbRect = sliderThumb.getBoundingClientRect();
			const nextThumbX = clientX - trackRect.left - (thumbRect.width / 2);
			const thumbX = setSliderPuzzlePosition(nextThumbX);
			return Math.abs(thumbX - sliderThumbSolvedX) <= 12;
		}

		function pointWithinRect(clientX, clientY, rect, tolerance = 0) {
			return (
				clientX >= rect.left - tolerance &&
				clientX <= rect.right + tolerance &&
				clientY >= rect.top - tolerance &&
				clientY <= rect.bottom + tolerance
			);
		}

		function shouldStartSliderDrag(clientX, clientY) {
			const thumbRect = sliderThumb.getBoundingClientRect();
			const trackRect = sliderTrack.getBoundingClientRect();
			return (
				pointWithinRect(clientX, clientY, thumbRect, 18) ||
				(
					pointWithinRect(clientX, clientY, trackRect, 10) &&
					clientX <= thumbRect.right + 24
				)
			);
		}

		function beginSliderDrag(clientX) {
			if (sliderDragging) {
				return;
			}
			sliderDragging = true;
			sliderStatusEl.textContent = "slider:dragging";
			updateSliderPuzzleFromClientX(clientX);
		}

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
		sliderThumb.addEventListener("mousedown", (event) => {
			event.preventDefault();
			beginSliderDrag(event.clientX);
		});
		sliderTrack.addEventListener("mousedown", (event) => {
			if (!shouldStartSliderDrag(event.clientX, event.clientY)) {
				return;
			}
			event.preventDefault();
			beginSliderDrag(event.clientX);
		});
		document.addEventListener("mousedown", (event) => {
			if (sliderDragging || !shouldStartSliderDrag(event.clientX, event.clientY)) {
				return;
			}
			beginSliderDrag(event.clientX);
		});
		document.addEventListener("mousemove", (event) => {
			window.__understudyLastMouse = {
				clientX: event.clientX,
				clientY: event.clientY,
			};
			if (dragging) {
				dragSource.style.left = (event.clientX - 60) + "px";
				dragSource.style.top = (event.clientY - 26) + "px";
			}
			if (
				!sliderDragging &&
				(event.buttons & 1) === 1 &&
				shouldStartSliderDrag(event.clientX, event.clientY)
			) {
				beginSliderDrag(event.clientX);
			}
			if (sliderDragging) {
				updateSliderPuzzleFromClientX(event.clientX);
			}
		});
			document.addEventListener("mouseup", (event) => {
				if (dragging) {
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
				}
				if (sliderDragging) {
					sliderDragging = false;
					const solved = updateSliderPuzzleFromClientX(event.clientX);
					if (solved) {
						setSliderPuzzlePosition(sliderThumbSolvedX);
						statusEl.textContent = "slider-solved";
						sliderStatusEl.textContent = "slider:solved";
						sliderConfirmation.hidden = false;
					} else {
						sliderStatusEl.textContent = "slider:ready";
					}
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
				delayedPanel.hidden = false;
			}, 250);
		};
		window.hideDelayedBadge = () => {
			setTimeout(() => {
				delayedBadge.hidden = true;
				delayedPanel.hidden = true;
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
			sliderStatusEl.textContent = "slider:idle";
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
			sliderConfirmation.hidden = true;
			document.getElementById("click-confirmation").hidden = true;
			delayedBadge.hidden = true;
			delayedPanel.hidden = true;
			window.scrollTo(0, 0);
			window.__understudyLastMouse = null;
			window.__understudyCrossWindowDrag = "idle";
			window.__understudyCrossWindowDrop = "pending";
			sliderDragging = false;
			dragSource.style.left = "48px";
				dragSource.style.top = "180px";
				setSliderPuzzlePosition(sliderThumbMinX);
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

	it("drives all 8 GUI operations through a grounded browser end-to-end scenario", async () => {
		await prepareBrowserPagesForGui(popupPage, page);
		await resetSmokePage(page, popupPage);
		const runtime = browserRuntime;

			const readResult = await runtime.observe({
				app: browserAppName,
				target: "Click button",
				scope: "Workspace panel",
			});
			expect(readResult.status.code).toBe("resolved");
			const clickButtonPoint = readGroundingDisplayPoint(readResult.details);

			const hoverProbe = await runtime.observe({
				app: browserAppName,
				target: "Hover chip",
				scope: "Workspace panel",
			});
			expect(hoverProbe.status.code).toBe("resolved");
			const hoverChipPoint = readGroundingDisplayPoint(hoverProbe.details);

			const moveToHoverChip = await runtime.move({
				app: browserAppName,
				x: hoverChipPoint.x,
				y: hoverChipPoint.y,
			});
			expect(moveToHoverChip.status.code).toBe("action_sent");
			await expect.poll(async () => page.textContent("#hover-status")).toBe("hover:done");

			const moveAwayFromHoverChip = await runtime.move({
				app: browserAppName,
				x: clickButtonPoint.x,
				y: clickButtonPoint.y,
			});
			expect(moveAwayFromHoverChip.status.code).toBe("action_sent");
			await expect.poll(async () => page.textContent("#hover-status")).toBe("hover:none");

			const clickResult = await runtime.click({
				app: browserAppName,
				target: "Click button",
				scope: "Workspace panel",
			});
			expect(clickResult.status.code).toBe("action_sent");
			await expect.poll(async () => page.textContent("#status")).toBe("clicked");

			const rightClickResult = await runtime.click({
				app: browserAppName,
				target: "Context button",
				scope: "Workspace panel",
				button: "right",
			});
			expect(rightClickResult.status.code).toBe("action_sent");
			await expect.poll(async () => page.textContent("#right-click-status")).toBe("right-click:done");

		const doubleClickResult = await runtime.click({
			app: browserAppName,
			target: "Double button",
			scope: "Workspace panel",
			clicks: 2,
		});
		expect(doubleClickResult.status.code).toBe("action_sent");
		await expect.poll(async () => page.textContent("#status")).toBe("double-clicked");

			const hoverResult = await runtime.click({
				app: browserAppName,
				target: "Hover chip",
				scope: "Workspace panel",
				button: "none",
				settleMs: 250,
			});
			expect(hoverResult.status.code).toBe("action_sent");
			await expect.poll(async () => page.textContent("#hover-status")).toBe("hover:done");

			const holdResult = await runtime.click({
				app: browserAppName,
				target: "Hold button",
				scope: "Workspace panel",
				holdMs: 700,
			});
			expect(holdResult.status.code).toBe("action_sent");
			await expect.poll(async () => page.textContent("#hold-status")).toBe("hold:done");

			const dragResult = await runtime.drag({
				app: browserAppName,
				fromTarget: "Puzzle slider thumb",
				toTarget: "Puzzle completion marker",
				fromScope: "Workspace panel",
				toScope: "Workspace panel",
				groundingMode: "complex",
				fromLocationHint: "left end of the slider track",
				toLocationHint: "center of the dashed blue completion marker on the right side of the slider track",
				captureMode: "display",
				durationMs: 900,
			});
			expect(dragResult.status.code).toBe("action_sent");
			await expect.poll(async () => page.textContent("#slider-status")).toBe("slider:solved");
			await expect.poll(async () => page.textContent("#status")).toBe("slider-solved");

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

		const keypressResult = await runtime.key({
			app: browserAppName,
			key: "Enter",
		});
		expect(keypressResult.status.code).toBe("action_sent");
		await expect.poll(async () => page.textContent("#keypress-status")).toBe("keypress:enter");

		const hotkeyResult = await runtime.key({
			app: browserAppName,
			key: "k",
			modifiers: ["shift"],
		});
		expect(hotkeyResult.status.code).toBe("action_sent");
		await expect.poll(async () => page.textContent("#hotkey-status")).toBe("hotkey:shift+k");

		const screenshotResult = await runtime.observe({ app: browserAppName });
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
		await page.$eval("#reorder-draft", (node: Element) =>
			node.scrollIntoView({ block: "center", inline: "center" }),
		);
		await page.waitForTimeout(150);

		const result = await browserRuntime.drag({
			app: browserAppName,
			fromTarget: "Draft card",
			toTarget: "Released card",
			fromScope: "Workspace panel",
			toScope: "Workspace panel",
			captureMode: "display",
			durationMs: 450,
		});
		expect(result.status.code).toBe("action_sent");
		await expect.poll(async () => page.textContent("#reorder-status")).toBe(
			"reorder:Review card | Released card | Draft card",
		);
	}, REAL_GUI_TEST_TIMEOUT_MS);

	it("solves a slider-style drag puzzle in a real browser window", async () => {
		await prepareBrowserPagesForGui(popupPage, page);
		await resetSmokePage(page, popupPage);

		const result = await browserRuntime.drag({
			app: browserAppName,
			fromTarget: "Puzzle slider thumb",
			toTarget: "Puzzle completion marker",
			fromScope: "Workspace panel",
			toScope: "Workspace panel",
			fromLocationHint: "left side of the slider track",
			toLocationHint: "right side of the slider track",
			captureMode: "display",
			durationMs: 700,
		});
		expect(result.status.code).toBe("action_sent");
		await expect.poll(async () => page.textContent("#slider-status")).toBe("slider:solved");
		await expect.poll(async () => page.textContent("#status")).toBe("slider-solved");
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
		"drives grounded type and drag actions through real OpenAI grounding end to end",
		async () => {
			await prepareBrowserPagesForGui(popupPage, page);
			await resetSmokePage(page, popupPage);
			const runtime = await getRealOpenAIGroundedRuntime();

			const typeResult = await runtime.type({
				app: browserAppName,
				target: 'input field with placeholder "Type here"',
				scope: 'the row with the input field and Hover chip',
				groundingMode: "complex",
				locationHint: "left side of the row",
				value: "real grounding flow",
			});
			expect(typeResult.status.code).toBe("action_sent");
			expect(typeResult.details?.grounding_provider).toEqual(expect.stringContaining("openai"));
			await expect.poll(async () => page.inputValue("#input-field")).toBe("real grounding flow");

			const dragResult = await runtime.drag({
				app: browserAppName,
				fromTarget: "Puzzle slider thumb",
				toTarget: "Puzzle completion marker",
				fromScope: "Workspace panel",
				toScope: "Workspace panel",
				fromLocationHint: "left side of the slider track",
				toLocationHint: "right side of the slider track",
				captureMode: "display",
				durationMs: 700,
			});
			expect(dragResult.status.code).toBe("action_sent");
			expect(dragResult.details?.grounding_provider).toEqual(expect.stringContaining("openai"));
			await expect.poll(async () => page.textContent("#slider-status")).toBe("slider:solved");
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
					const result = await runtime.observe({
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
					const result = await runtime.click({
						app: browserAppName,
						target: "Context button",
						scope: "Workspace panel",
						button: "right",
					});
					expect(result.status.code).toBe("action_sent");
					await expect.poll(async () => page.textContent("#right-click-status")).toBe("right-click:done");
				},
			},
			{
				id: "double_click",
				family: "point_action",
				run: async () => {
					const result = await runtime.click({
						app: browserAppName,
						target: "Double button",
						scope: "Workspace panel",
						clicks: 2,
					});
					expect(result.status.code).toBe("action_sent");
					await expect.poll(async () => page.textContent("#status")).toBe("double-clicked");
				},
			},
			{
				id: "hover",
				family: "point_action",
				run: async () => {
					const result = await runtime.click({
						app: browserAppName,
						target: "Hover chip",
						scope: "Workspace panel",
						button: "none",
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
					const result = await runtime.click({
						app: browserAppName,
						target: "Hold button",
						scope: "Workspace panel",
						holdMs: 700,
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
						await page.$eval("#reorder-draft", (node: Element) =>
							node.scrollIntoView({ block: "center", inline: "center" }),
						);
						await page.waitForTimeout(150);
						const result = await runtime.drag({
							app: browserAppName,
							fromTarget: "Draft card",
							toTarget: "Released card",
							fromScope: "Workspace panel",
							toScope: "Workspace panel",
							captureMode: "display",
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
					const result = await runtime.key({
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
					const result = await runtime.key({
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
					const result = await runtime.observe({ app: browserAppName });
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
			const openResult = await runtime.key({
				app: "Finder",
				key: "down",
				modifiers: ["command"],
			});
			expect(openResult.status.code).toBe("action_sent");
			await expect.poll(async () => normalizeFinderPath(await readFinderWindowTargetPath())).toBe(
				normalizeFinderPath(nestedDir),
			);

			const screenshotResult = await runtime.observe({
				app: "Finder",
			});
			expect(screenshotResult.status.code).toBe("observed");
			expect(screenshotResult.image?.mimeType).toBe("image/png");

			const backResult = await runtime.key({
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
				const newDoc = await runtime.key({
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

			const enterResult = await runtime.key({
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

			const screenshotResult = await runtime.observe({
				app: "TextEdit",
			});
			expect(screenshotResult.status.code).toBe("observed");
			expect(screenshotResult.image?.mimeType).toBe("image/png");
			} finally {
				await closeTextEditWithoutSaving();
			}
		}, REAL_GUI_TEST_TIMEOUT_MS);

	it.runIf(shouldRunRealPixelmatorTaskE2E)(
		"drives a real Pixelmator Pro retouching task with grounded move, click, scroll, drag, key, and type operations",
		async () => {
			const fixtureDir = await mkdtemp(join(tmpdir(), "understudy-pixelmator-task-"));
			const imagePath = join(fixtureDir, "understudy-pixelmator-task.png");
			const windowTitleFragment = basename(imagePath, ".png");
			const windowSelector = {
				titleContains: windowTitleFragment,
			} as const;
			try {
				await createPixelmatorFixtureImage(imagePath);
				await openPixelmatorFixture(imagePath);
				await expect
					.poll(async () =>
						(await readPixelmatorWindowTitles()).some((title) => title.includes(windowTitleFragment)),
					)
					.toBe(true);

				const runtime = await getRealOpenAIGroundedRuntime();

				const autoEnhanceReady = await runtime.observe({
					app: PIXELMATOR_APP_NAME,
					target: 'yellow button labeled "自动增强"',
					scope: "the right color adjustments panel",
					groundingMode: "complex",
					captureMode: "display",
					windowSelector,
					returnImage: false,
				});
				expect(autoEnhanceReady.status.code).toBe("resolved");
				expect(autoEnhanceReady.details?.grounding_provider).toEqual(expect.stringContaining("openai"));
				const autoEnhancePoint = readGroundingDisplayPoint(autoEnhanceReady.details);

				const moveResult = await runtime.move({
					app: PIXELMATOR_APP_NAME,
					x: autoEnhancePoint.x,
					y: autoEnhancePoint.y,
				});
				expect(moveResult.status.code).toBe("action_sent");
				await expect
					.poll(async () => {
						const point = await readMouseScreenPoint();
						return (
							Math.abs(point.x - autoEnhancePoint.x) <= 6 &&
							Math.abs(point.y - autoEnhancePoint.y) <= 6
						);
					})
					.toBe(true);

				await runAppleScript('tell application "Pixelmator Pro Creator Studio" to activate');
				// Reuse the already grounded display point so we do not spend another grounding call on the same control.
				await clickMouseAtScreenPoint(autoEnhancePoint);
				await runAppleScript("delay 0.5");
				const autoEnhanceApplied = await runtime.observe({
					app: PIXELMATOR_APP_NAME,
					target: 'greyed-out button labeled "自动增强"',
					scope: "the right color adjustments panel",
					groundingMode: "complex",
					captureMode: "display",
					windowSelector,
					returnImage: false,
				});
				expect(autoEnhanceApplied.status.code).toBe("resolved");

				const undoAutoEnhance = await runtime.key({
					app: PIXELMATOR_APP_NAME,
					key: "z",
					modifiers: ["command"],
					captureMode: "display",
					windowSelector,
				});
				expect(undoAutoEnhance.status.code).toBe("action_sent");
				await runAppleScript("delay 0.5");
				const autoEnhanceUndone = await runtime.observe({
					app: PIXELMATOR_APP_NAME,
					target: 'yellow button labeled "自动增强"',
					scope: "the right color adjustments panel",
					groundingMode: "complex",
					captureMode: "display",
					windowSelector,
					returnImage: false,
				});
				expect(autoEnhanceUndone.status.code).toBe("resolved");

				const scrollInspector = await runtime.scroll({
					app: PIXELMATOR_APP_NAME,
					target: "the right color adjustments panel",
					scope: "the inspector panel on the right side",
					direction: "down",
					distance: "page",
					groundingMode: "complex",
					captureMode: "display",
					windowSelector,
				});
				expect(scrollInspector.status.code).toBe("action_sent");
				const contrastBefore = await runtime.observe({
					app: PIXELMATOR_APP_NAME,
					target: 'slider handle on the 对比度 row',
					scope: "the right color adjustments panel",
					groundingMode: "complex",
					locationHint: "middle of the right inspector panel",
					captureMode: "display",
					windowSelector,
					returnImage: false,
				});
				expect(contrastBefore.status.code).toBe("resolved");
				const contrastBeforePoint = readGroundingDisplayPoint(contrastBefore.details);

				const dragContrast = await runtime.drag({
					app: PIXELMATOR_APP_NAME,
					fromTarget: 'slider handle on the 对比度 row',
					toTarget: 'right side of the 对比度 slider track',
					fromScope: "the right color adjustments panel",
					toScope: "the right color adjustments panel",
					fromLocationHint: "center of the 对比度 slider handle",
					toLocationHint: "right half of the 对比度 slider track",
					groundingMode: "complex",
					captureMode: "display",
					durationMs: 900,
					windowSelector,
				});
				expect(dragContrast.status.code).toBe("action_sent");
				await runAppleScript("delay 0.5");
				const contrastAfter = await runtime.observe({
					app: PIXELMATOR_APP_NAME,
					target: 'slider handle on the 对比度 row',
					scope: "the right color adjustments panel",
					groundingMode: "complex",
					locationHint: "right half of the right inspector panel",
					captureMode: "display",
					windowSelector,
					returnImage: false,
				});
				expect(contrastAfter.status.code).toBe("resolved");
				expect(readGroundingDisplayPoint(contrastAfter.details).x).toBeGreaterThan(contrastBeforePoint.x + 12);

				const typeSearch = await runtime.type({
					app: PIXELMATOR_APP_NAME,
					target: 'search field with placeholder "搜索"',
					scope: "the left layers panel",
					groundingMode: "complex",
					locationHint: "top of the left panel",
					captureMode: "display",
					windowSelector,
					value: "test",
				});
				expect(typeSearch.status.code).toBe("action_sent");
				await runAppleScript("delay 0.3");
				const searchVerified = await runtime.observe({
					app: PIXELMATOR_APP_NAME,
					target: 'search field showing "test"',
					scope: "the left layers panel",
					groundingMode: "complex",
					locationHint: "top of the left panel",
					captureMode: "display",
					windowSelector,
					returnImage: false,
				});
				expect(searchVerified.status.code).toBe("resolved");
			} finally {
				await closePixelmatorFrontDocumentWithoutSaving();
				await rm(fixtureDir, { recursive: true, force: true });
			}
		},
		REAL_GUI_NATIVE_TASK_TIMEOUT_MS,
	);
	});
