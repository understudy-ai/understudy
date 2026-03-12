/// <reference lib="dom" />

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { ComputerUseGuiRuntime } from "../runtime.js";

const shouldRunRealGuiTests =
	process.platform === "darwin" &&
	process.env.UNDERSTUDY_RUN_REAL_GUI_TESTS === "1";
const execFileAsync = promisify(execFile);

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

type ViewportOrigin = {
	x: number;
	y: number;
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
			<div class="row status">
				<div id="status">idle</div>
				<div id="typed-value">typed:</div>
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
			</div>
			<div id="drag-source" data-gui-target="Draggable card">Drag me</div>
			<div id="drop-zone" data-gui-target="Drop zone">Drop zone</div>
		</div>
		<div class="card" data-gui-scope="Sidebar panel">
			<div id="scroll-area" data-gui-target="Scroll area">
				<div>Scroll from here.</div>
				<div class="scroll-spacer"></div>
				<div id="bottom-item" data-gui-target="Bottom item">Bottom item</div>
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
		const hoverTarget = document.getElementById("hover-target");
		const holdButton = document.getElementById("hold-button");
		const contextMenu = document.getElementById("context-menu");
		const hoverTooltip = document.getElementById("hover-tooltip");
		const holdBadge = document.getElementById("hold-badge");
		const dropConfirmation = document.getElementById("drop-confirmation");
		window.__understudyLastMouse = null;
		let holdTimer = null;
		let holdTriggered = false;

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

		window.showDelayedBadge = () => {
			setTimeout(() => {
				document.getElementById("delayed-badge").hidden = false;
			}, 250);
		};
	</script>
</body>
</html>`;

describe.runIf(shouldRunRealGuiTests)("ComputerUseGuiRuntime real smoke", () => {
	let browser: any;
	let page: any;
	let browserAppName: string | undefined;

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
		await page.bringToFront();
		await page.evaluate(() => window.focus());
		await page.waitForTimeout(500);
		const frontmost = await execFileAsync("osascript", [
			"-e",
			'tell application "System Events" to get name of first application process whose frontmost is true',
		]);
		browserAppName = frontmost.stdout.trim() || undefined;
	});

	afterAll(async () => {
		await browser?.close();
	});

	it("drives click, right click, double click, hover, click and hold, drag, scroll, type, keypress, hotkey, screenshot, and wait against a real browser window", async () => {
		await page.bringToFront();
		await page.evaluate(() => window.focus());
		await page.waitForTimeout(150);
		const viewportOrigin = await calibrateViewportOrigin(page);

		const runtime = new ComputerUseGuiRuntime({
			groundingProvider: {
				ground: async ({ target, scope }) => {
					return page.evaluate((params: { label: string; scope?: string; viewportOrigin: ViewportOrigin }) => {
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

						const label = params.label;
						const root = params.scope
							? document.querySelector(`[data-gui-scope="${params.scope}"]`) as HTMLElement | null
							: null;
						const searchRoot = root ?? document;
						const candidates = Array.from(
							searchRoot.querySelectorAll(`[data-gui-target="${label}"]`),
						) as HTMLElement[];
						for (const element of candidates) {
							const rect = element.getBoundingClientRect();
							const visibleRect = visibleRectFor(element);
							if (!visibleRect) {
								continue;
							}
							const centerX = Math.round((visibleRect.left + visibleRect.right) / 2);
							const centerY = Math.round((visibleRect.top + visibleRect.bottom) / 2);
								return {
									method: "grounding",
									provider: "playwright-dom",
									confidence: 1,
									reason: `Matched ${label}`,
									coordinateSpace: "image_pixels",
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
									rect: {
										left: Math.round(rect.left),
										top: Math.round(rect.top),
										right: Math.round(rect.right),
										bottom: Math.round(rect.bottom),
									},
								},
							};
						}
						return undefined;
					}, { label: target, scope, viewportOrigin });
				},
			},
		});

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
				durationMs: 500,
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
	});

	it("drives native Finder navigation hotkey and screenshot flows", async () => {
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
		} finally {
			await closeFinderWindows();
			await rm(fixtureDir, { recursive: true, force: true });
		}
	});

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
	});
});
