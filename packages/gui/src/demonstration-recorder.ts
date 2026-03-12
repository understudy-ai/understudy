import { randomUUID } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { execFileAsync } from "./exec-utils.js";
import type {
	GuiDemonstrationRecorder,
	GuiDemonstrationRecorderOptions,
	GuiDemonstrationRecordingArtifact,
	GuiDemonstrationRecordingSession,
	GuiDemonstrationRecordingStatus,
} from "./types.js";

const DEFAULT_STARTUP_GRACE_MS = 100;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

const SWIFT_EVENT_RECORDER_SCRIPT = String.raw`
import Foundation
import AppKit
import CoreGraphics
import ApplicationServices

struct RecordedEvent: Codable {
	let type: String
	let timestampMs: Int
	let source: String
	let app: String?
	let windowTitle: String?
	let target: String?
	let detail: String?
	let x: Double?
	let y: Double?
	let keyCode: Int?
	let modifiers: [String]?
	let importance: String?
}

func env(_ key: String) -> String {
	ProcessInfo.processInfo.environment[key] ?? ""
}

let outputPath = env("UNDERSTUDY_GUI_DEMO_EVENTS_PATH")
if outputPath.isEmpty {
	fputs("UNDERSTUDY_GUI_DEMO_EVENTS_PATH is required\n", stderr)
	exit(1)
}

let fileManager = FileManager.default
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

var recordedEvents: [RecordedEvent] = []

func nowMs() -> Int {
	Int((Date().timeIntervalSince1970 * 1000.0).rounded())
}

func currentAppName() -> String? {
	NSWorkspace.shared.frontmostApplication?.localizedName
}

func modifierNames(_ flags: NSEvent.ModifierFlags) -> [String]? {
	var values: [String] = []
	if flags.contains(.command) { values.append("command") }
	if flags.contains(.option) { values.append("option") }
	if flags.contains(.control) { values.append("control") }
	if flags.contains(.shift) { values.append("shift") }
	if flags.contains(.capsLock) { values.append("caps_lock") }
	if flags.contains(.function) { values.append("function") }
	return values.isEmpty ? nil : values
}

func currentAccessibilityApp() -> AXUIElement? {
	guard let running = NSWorkspace.shared.frontmostApplication else {
		return nil
	}
	return AXUIElementCreateApplication(running.processIdentifier)
}

func axAttributeValue(_ element: AXUIElement, _ attribute: CFString) -> CFTypeRef? {
	var value: CFTypeRef?
	let result = AXUIElementCopyAttributeValue(element, attribute, &value)
	return result == .success ? value : nil
}

func axElementAttribute(_ element: AXUIElement, _ attribute: CFString) -> AXUIElement? {
	guard let value = axAttributeValue(element, attribute) else {
		return nil
	}
	guard CFGetTypeID(value) == AXUIElementGetTypeID() else {
		return nil
	}
	return unsafeBitCast(value, to: AXUIElement.self)
}

func axStringAttribute(_ element: AXUIElement, _ attribute: CFString) -> String? {
	if let value = axAttributeValue(element, attribute) as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
		return value.trimmingCharacters(in: .whitespacesAndNewlines)
	}
	if let value = axAttributeValue(element, attribute) as? NSAttributedString {
		let string = value.string.trimmingCharacters(in: .whitespacesAndNewlines)
		return string.isEmpty ? nil : string
	}
	return nil
}

func targetSummary(for element: AXUIElement?) -> String? {
	guard let element else {
		return nil
	}
	let candidates = [
		axStringAttribute(element, kAXTitleAttribute as CFString),
		axStringAttribute(element, kAXDescriptionAttribute as CFString),
		axStringAttribute(element, kAXIdentifierAttribute as CFString),
		axStringAttribute(element, kAXRoleDescriptionAttribute as CFString),
		axStringAttribute(element, kAXValueAttribute as CFString),
		axStringAttribute(element, kAXRoleAttribute as CFString),
	].compactMap { $0 }.filter { !$0.isEmpty }
	return candidates.isEmpty ? nil : candidates.prefix(2).joined(separator: " | ")
}

func windowTitle(for element: AXUIElement?) -> String? {
	guard let element else {
		return nil
	}
	if let direct = axStringAttribute(element, kAXTitleAttribute as CFString) {
		return direct
	}
	if let window = axElementAttribute(element, kAXWindowAttribute as CFString),
	   let title = axStringAttribute(window, kAXTitleAttribute as CFString) {
		return title
	}
	return nil
}

func focusedElement() -> AXUIElement? {
	guard let appElement = currentAccessibilityApp() else {
		return nil
	}
	return axElementAttribute(appElement, kAXFocusedUIElementAttribute as CFString)
}

func focusedWindowTitle() -> String? {
	guard let appElement = currentAccessibilityApp() else {
		return nil
	}
	if let window = axElementAttribute(appElement, kAXFocusedWindowAttribute as CFString),
	   let title = axStringAttribute(window, kAXTitleAttribute as CFString) {
		return title
	}
	return nil
}

func elementAtPoint(_ point: CGPoint) -> AXUIElement? {
	let systemWide = AXUIElementCreateSystemWide()
	var element: AXUIElement?
	let result = AXUIElementCopyElementAtPosition(systemWide, Float(point.x), Float(point.y), &element)
	return result == .success ? element : nil
}

func semanticContext(location: CGPoint? = nil) -> (app: String?, windowTitle: String?, target: String?) {
	let app = currentAppName()
	let element = location.flatMap { elementAtPoint($0) } ?? focusedElement()
	return (
		app: app,
		windowTitle: windowTitle(for: element) ?? focusedWindowTitle(),
		target: targetSummary(for: element)
	)
}

func inferImportance(for type: String) -> String {
	if type.contains("mouse_down") || type.contains("mouse_up") || type.contains("click") || type.contains("drag") || type.contains("key_down") || type.contains("app_activated") || type.contains("window") {
		return "high"
	}
	if type.contains("scroll") || type.contains("mouse_move") || type.contains("hover") || type.contains("flags_changed") {
		return "medium"
	}
	return "low"
}

var lastPointerSampleByType: [String: (timestampMs: Int, location: CGPoint)] = [:]
var activeDragKinds: Set<String> = []

func shortcutText(characters: String?, modifiers: [String]?) -> String? {
	let key = characters?.trimmingCharacters(in: .whitespacesAndNewlines)
	let normalizedModifiers = modifiers ?? []
	guard !normalizedModifiers.isEmpty, let key, !key.isEmpty else {
		return nil
	}
	return (normalizedModifiers + [key]).joined(separator: "+")
}

func shouldRecordPointerSample(type: String, location: CGPoint, minIntervalMs: Int, minDistance: Double) -> Bool {
	let now = nowMs()
	if let previous = lastPointerSampleByType[type] {
		let deltaT = now - previous.timestampMs
		let deltaX = location.x - previous.location.x
		let deltaY = location.y - previous.location.y
		let distance = sqrt((deltaX * deltaX) + (deltaY * deltaY))
		if deltaT < minIntervalMs && distance < minDistance {
			return false
		}
	}
	lastPointerSampleByType[type] = (timestampMs: now, location: location)
	return true
}

func appendEvent(
	_ type: String,
	source: String = "input",
	detail: String? = nil,
	location: CGPoint? = nil,
	keyCode: Int? = nil,
	modifiers: [String]? = nil,
	app: String? = nil,
	windowTitle: String? = nil,
	target: String? = nil,
	importance: String? = nil
) {
	let context = semanticContext(location: location)
	recordedEvents.append(
		RecordedEvent(
			type: type,
			timestampMs: nowMs(),
			source: source,
			app: app ?? context.app ?? currentAppName(),
			windowTitle: windowTitle ?? context.windowTitle,
			target: target ?? context.target,
			detail: detail,
			x: location.map { Double($0.x.rounded()) },
			y: location.map { Double($0.y.rounded()) },
			keyCode: keyCode,
			modifiers: modifiers,
			importance: importance ?? inferImportance(for: type)
		)
	)
}

func persistAndExit(_ code: Int32 = 0) {
	do {
		let parent = URL(fileURLWithPath: outputPath).deletingLastPathComponent()
		try fileManager.createDirectory(at: parent, withIntermediateDirectories: true)
		let data = try encoder.encode(recordedEvents)
		try data.write(to: URL(fileURLWithPath: outputPath), options: .atomic)
		exit(code)
	} catch {
		fputs("Failed to persist recorded events: \(error)\n", stderr)
		exit(1)
	}
}

signal(SIGINT, SIG_IGN)
signal(SIGTERM, SIG_IGN)

let sigintSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
sigintSource.setEventHandler {
	appendEvent("recording_stopped", source: "system", detail: "Received SIGINT")
	persistAndExit(0)
}
sigintSource.resume()

let sigtermSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
sigtermSource.setEventHandler {
	appendEvent("recording_stopped", source: "system", detail: "Received SIGTERM")
	persistAndExit(0)
}
sigtermSource.resume()

let eventMask: NSEvent.EventTypeMask = [
	.leftMouseDown,
	.leftMouseUp,
	.leftMouseDragged,
	.rightMouseDown,
	.rightMouseUp,
	.rightMouseDragged,
	.otherMouseDown,
	.otherMouseUp,
	.otherMouseDragged,
	.mouseMoved,
	.scrollWheel,
	.keyDown,
	.keyUp,
	.flagsChanged,
]

let monitor = NSEvent.addGlobalMonitorForEvents(matching: eventMask) { event in
	switch event.type {
	case .leftMouseDown:
		appendEvent("mouse_down", location: event.locationInWindow)
		if event.clickCount >= 2 {
			appendEvent("double_click", location: event.locationInWindow)
		}
	case .leftMouseUp:
		if activeDragKinds.contains("mouse_drag") {
			appendEvent("mouse_drag_end", location: event.locationInWindow)
			activeDragKinds.remove("mouse_drag")
		}
		appendEvent("mouse_up", location: event.locationInWindow)
	case .leftMouseDragged:
		if shouldRecordPointerSample(type: "mouse_drag", location: event.locationInWindow, minIntervalMs: 140, minDistance: 18) {
			if !activeDragKinds.contains("mouse_drag") {
				appendEvent("mouse_drag_start", location: event.locationInWindow)
				activeDragKinds.insert("mouse_drag")
			}
			appendEvent("mouse_drag", location: event.locationInWindow)
		}
	case .rightMouseDown:
		appendEvent("right_mouse_down", location: event.locationInWindow)
	case .rightMouseUp:
		if activeDragKinds.contains("right_mouse_drag") {
			appendEvent("mouse_drag_end", location: event.locationInWindow)
			activeDragKinds.remove("right_mouse_drag")
		}
		appendEvent("right_mouse_up", location: event.locationInWindow)
	case .rightMouseDragged:
		if shouldRecordPointerSample(type: "right_mouse_drag", location: event.locationInWindow, minIntervalMs: 140, minDistance: 18) {
			if !activeDragKinds.contains("right_mouse_drag") {
				appendEvent("mouse_drag_start", location: event.locationInWindow)
				activeDragKinds.insert("right_mouse_drag")
			}
			appendEvent("right_mouse_drag", location: event.locationInWindow)
		}
	case .otherMouseDown:
		appendEvent("other_mouse_down", location: event.locationInWindow)
	case .otherMouseUp:
		if activeDragKinds.contains("other_mouse_drag") {
			appendEvent("mouse_drag_end", location: event.locationInWindow)
			activeDragKinds.remove("other_mouse_drag")
		}
		appendEvent("other_mouse_up", location: event.locationInWindow)
	case .otherMouseDragged:
		if shouldRecordPointerSample(type: "other_mouse_drag", location: event.locationInWindow, minIntervalMs: 140, minDistance: 18) {
			if !activeDragKinds.contains("other_mouse_drag") {
				appendEvent("mouse_drag_start", location: event.locationInWindow)
				activeDragKinds.insert("other_mouse_drag")
			}
			appendEvent("other_mouse_drag", location: event.locationInWindow)
		}
	case .mouseMoved:
		if shouldRecordPointerSample(type: "mouse_move", location: event.locationInWindow, minIntervalMs: 250, minDistance: 28) {
			appendEvent("mouse_move", location: event.locationInWindow)
		}
	case .scrollWheel:
		appendEvent(
			"scroll",
			detail: "deltaX=\(event.scrollingDeltaX.rounded()) deltaY=\(event.scrollingDeltaY.rounded())",
			location: event.locationInWindow
		)
	case .keyDown:
		let modifiers = modifierNames(event.modifierFlags)
		appendEvent(
			"key_down",
			detail: event.charactersIgnoringModifiers,
			keyCode: Int(event.keyCode),
			modifiers: modifiers
		)
		if let shortcut = shortcutText(characters: event.charactersIgnoringModifiers, modifiers: modifiers) {
			appendEvent(
				"hotkey",
				detail: shortcut,
				keyCode: Int(event.keyCode),
				modifiers: modifiers
			)
		}
	case .keyUp:
		appendEvent(
			"key_up",
			detail: event.charactersIgnoringModifiers,
			keyCode: Int(event.keyCode),
			modifiers: modifierNames(event.modifierFlags)
		)
	case .flagsChanged:
		appendEvent(
			"flags_changed",
			keyCode: Int(event.keyCode),
			modifiers: modifierNames(event.modifierFlags)
		)
	default:
		break
	}
}

let workspaceCenter = NSWorkspace.shared.notificationCenter
let activationObserver = workspaceCenter.addObserver(
	forName: NSWorkspace.didActivateApplicationNotification,
	object: nil,
	queue: .main
) { notification in
	let app = (notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?.localizedName
	appendEvent(
		"app_activated",
		source: "workspace",
		app: app,
		windowTitle: focusedWindowTitle(),
		target: targetSummary(for: focusedElement())
	)
}

appendEvent("recording_started", source: "system", detail: "Global demonstration event capture started")
appendEvent(
	"window_focused",
	source: "workspace",
	detail: "Initial frontmost window at recording start",
	app: currentAppName(),
	windowTitle: focusedWindowTitle(),
	target: targetSummary(for: focusedElement())
)

RunLoop.main.run()

if let monitor {
	NSEvent.removeMonitor(monitor)
}
workspaceCenter.removeObserver(activationObserver)
persistAndExit(0)
`;

type SpawnImpl = typeof spawn;
type RecorderChildProcess = ChildProcessByStdio<null, Readable, Readable>;

interface RecorderDeps {
	spawnImpl?: SpawnImpl;
	now?: () => number;
	startupGraceMs?: number;
	stopTimeoutMs?: number;
	platform?: NodeJS.Platform;
}

class RecorderError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RecorderError";
	}
}

function collectProcessOutput(child: RecorderChildProcess): {
	stdout: string[];
	stderr: string[];
} {
	const stdout: string[] = [];
	const stderr: string[] = [];
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => stdout.push(chunk));
	child.stderr.on("data", (chunk: string) => stderr.push(chunk));
	return { stdout, stderr };
}

function formatChildFailure(label: string, output: { stdout: string[]; stderr: string[] }, code?: number | null, signal?: NodeJS.Signals | null): string {
	const details = [...output.stderr, ...output.stdout].join("").trim();
	const suffix = [
		code !== undefined && code !== null ? `exit code ${code}` : "",
		signal ? `signal ${signal}` : "",
		details,
	].filter(Boolean).join(" ");
	return `${label} failed${suffix ? `: ${suffix}` : ""}`;
}

async function waitForHealthyStart(params: {
	child: RecorderChildProcess;
	label: string;
	output: { stdout: string[]; stderr: string[] };
	startupGraceMs: number;
}): Promise<void> {
	await new Promise<void>((resolvePromise, rejectPromise) => {
		let settled = false;
		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			params.child.off("error", onError);
			params.child.off("exit", onExit);
			callback();
		};
		const timer = setTimeout(() => finish(resolvePromise), params.startupGraceMs);
		const onError = (error: Error) => {
			clearTimeout(timer);
			finish(() => rejectPromise(new RecorderError(`${params.label} failed to start: ${error.message}`)));
		};
		const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
			clearTimeout(timer);
			finish(() => rejectPromise(new RecorderError(formatChildFailure(params.label, params.output, code, signal))));
		};
		params.child.once("error", onError);
		params.child.once("exit", onExit);
	});
}

async function waitForChildExit(
	child: RecorderChildProcess,
	label: string,
	output: { stdout: string[]; stderr: string[] },
	timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
	return await new Promise((resolvePromise, rejectPromise) => {
		let settled = false;
		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			child.off("error", onError);
			child.off("exit", onExit);
			callback();
		};
		const timer = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				// Ignore kill errors during forced teardown.
			}
			finish(() => rejectPromise(new RecorderError(`${label} did not stop within ${timeoutMs} ms.`)));
		}, timeoutMs);
		const onError = (error: Error) => {
			clearTimeout(timer);
			finish(() => rejectPromise(new RecorderError(`${label} failed while stopping: ${error.message}`)));
		};
		const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
			clearTimeout(timer);
			finish(() => resolvePromise({ code, signal }));
		};
		child.once("error", onError);
		child.once("exit", onExit);
	});
}

async function stopChild(
	child: RecorderChildProcess,
	label: string,
	output: { stdout: string[]; stderr: string[] },
	timeoutMs: number,
): Promise<void> {
	if (child.exitCode !== null) {
		if (child.exitCode !== 0) {
			throw new RecorderError(formatChildFailure(label, output, child.exitCode, null));
		}
		return;
	}
	const didSignal = child.kill("SIGINT");
	if (!didSignal) {
		throw new RecorderError(`${label} could not be interrupted.`);
	}
	const result = await waitForChildExit(child, label, output, timeoutMs);
	const acceptableSignal = result.signal === "SIGINT" || result.signal === "SIGTERM";
	const acceptableCode = result.code === 0 || result.code === null;
	if (!acceptableSignal && !acceptableCode) {
		throw new RecorderError(formatChildFailure(label, output, result.code, result.signal));
	}
}

async function waitForArtifact(path: string, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + Math.max(500, timeoutMs);
	while (Date.now() < deadline) {
		try {
			await stat(path);
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	await stat(path);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function readFrontmostAppName(): Promise<string | undefined> {
	try {
		const result = await execFileAsync("osascript", [
			"-e",
			'tell application "System Events" to get name of first application process whose frontmost is true',
		], {
			timeout: DEFAULT_STOP_TIMEOUT_MS,
			maxBuffer: 1024 * 1024,
		});
		const name = result.stdout.trim();
		return name.length > 0 ? name : undefined;
	} catch {
		return undefined;
	}
}

async function writeFallbackEventLog(params: {
	eventLogPath: string;
	startedAt: number;
	stoppedAt: number;
	startedApp?: string;
	stoppedApp?: string;
}): Promise<void> {
	const events: Array<Record<string, unknown>> = [
		{
			type: "recording_started",
			timestampMs: params.startedAt,
			source: "fallback",
			app: params.startedApp,
			detail: "Fallback event timeline initialized.",
		},
	];
	if (params.startedApp) {
		events.push({
			type: "app_activated",
			timestampMs: params.startedAt,
			source: "fallback",
			app: params.startedApp,
		});
	}
	if (params.stoppedApp && params.stoppedApp !== params.startedApp) {
		events.push({
			type: "app_activated",
			timestampMs: Math.max(params.startedAt + 1, params.stoppedAt - 1),
			source: "fallback",
			app: params.stoppedApp,
		});
	}
	events.push({
		type: "recording_stopped",
		timestampMs: params.stoppedAt,
		source: "fallback",
		app: params.stoppedApp ?? params.startedApp,
		detail: "Primary event recorder did not persist output; wrote fallback timeline.",
	});
	await writeFile(params.eventLogPath, JSON.stringify(events, null, 2), "utf8");
}

async function synthesizeFallbackVideo(params: {
	videoPath: string;
	displayIndex: number;
}): Promise<void> {
	const framePath = `${params.videoPath}.fallback.png`;
	try {
		await execFileAsync("screencapture", [
			"-x",
			`-D${params.displayIndex}`,
			framePath,
		], {
			timeout: DEFAULT_STOP_TIMEOUT_MS,
			maxBuffer: 8 * 1024 * 1024,
		});
		await execFileAsync("ffmpeg", [
			"-y",
			"-loop",
			"1",
			"-framerate",
			"1",
			"-t",
			"1",
			"-i",
			framePath,
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			params.videoPath,
		], {
			timeout: 30_000,
			maxBuffer: 8 * 1024 * 1024,
		});
	} finally {
		await rm(framePath, { force: true }).catch(() => {});
	}
}

export function createMacosDemonstrationRecorder(deps: RecorderDeps = {}): GuiDemonstrationRecorder {
	const spawnImpl = deps.spawnImpl ?? spawn;
	const now = deps.now ?? Date.now;
	const startupGraceMs = Math.max(0, deps.startupGraceMs ?? DEFAULT_STARTUP_GRACE_MS);
	const stopTimeoutMs = Math.max(500, deps.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS);
	const platform = deps.platform ?? process.platform;

	return {
		async start(options: GuiDemonstrationRecorderOptions): Promise<GuiDemonstrationRecordingSession> {
			if (platform !== "darwin") {
				throw new RecorderError("GUI demonstration recording is currently only supported on macOS.");
			}
			const outputDir = resolve(options.outputDir);
			await mkdir(outputDir, { recursive: true });

			const id = randomUUID();
			const startedAt = now();
			const prefix = (options.filePrefix?.trim() || `demo-${startedAt}`).replace(/[^a-zA-Z0-9._-]+/g, "-");
			const videoPath = join(outputDir, `${prefix}.mov`);
			const eventLogPath = join(outputDir, `${prefix}.events.json`);
			const displayIndex = options.displayIndex ?? 1;
			const statusBase = {
				id,
				startedAt,
				videoPath,
				eventLogPath,
				displayIndex,
				app: options.app?.trim() || undefined,
			};
			const fallbackStartedApp = await readFrontmostAppName();

			const videoArgs = [
				"-x",
				"-v",
				`-D${displayIndex}`,
				...(options.showClicks === false ? [] : ["-k"]),
				...(options.captureAudio === true ? ["-g"] : []),
				...(typeof options.maxDurationSec === "number" && Number.isFinite(options.maxDurationSec) && options.maxDurationSec > 0
					? [`-V${Math.floor(options.maxDurationSec)}`]
					: []),
				videoPath,
			];
			const videoChild = spawnImpl("screencapture", videoArgs, {
				stdio: ["ignore", "pipe", "pipe"],
			});
			const videoOutput = collectProcessOutput(videoChild);

			const eventChild = spawnImpl("swift", ["-e", SWIFT_EVENT_RECORDER_SCRIPT], {
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					UNDERSTUDY_GUI_DEMO_EVENTS_PATH: eventLogPath,
					UNDERSTUDY_GUI_DEMO_APP: options.app?.trim() || "",
				},
			});
			const eventOutput = collectProcessOutput(eventChild);

			try {
				await Promise.all([
					waitForHealthyStart({
						child: videoChild,
						label: "screencapture recorder",
						output: videoOutput,
						startupGraceMs,
					}),
					waitForHealthyStart({
						child: eventChild,
						label: "event recorder",
						output: eventOutput,
						startupGraceMs,
					}),
				]);
			} catch (error) {
				if (videoChild.exitCode === null) {
					videoChild.kill("SIGKILL");
				}
				if (eventChild.exitCode === null) {
					eventChild.kill("SIGKILL");
				}
				throw error;
			}

			let state: GuiDemonstrationRecordingStatus["state"] = "recording";
			let stopping: Promise<GuiDemonstrationRecordingArtifact> | undefined;

			return {
				id,
				status(): GuiDemonstrationRecordingStatus {
					return {
						...statusBase,
						state,
					};
				},
				async stop(): Promise<GuiDemonstrationRecordingArtifact> {
					if (stopping) {
						return await stopping;
					}
					stopping = (async () => {
						try {
							await Promise.all([
								stopChild(eventChild, "event recorder", eventOutput, stopTimeoutMs),
								stopChild(videoChild, "screencapture recorder", videoOutput, stopTimeoutMs),
							]);
							const stoppedAt = now();
							const videoReady = await pathExists(videoPath);
							const eventLogReady = await pathExists(eventLogPath);
							if (!eventLogReady) {
								await writeFallbackEventLog({
									eventLogPath,
									startedAt,
									stoppedAt,
									startedApp: fallbackStartedApp,
									stoppedApp: await readFrontmostAppName(),
								});
							}
							if (!videoReady) {
								await synthesizeFallbackVideo({
									videoPath,
									displayIndex,
								});
							}
							await Promise.all([
								waitForArtifact(videoPath, stopTimeoutMs),
								waitForArtifact(eventLogPath, stopTimeoutMs),
							]);
							state = "stopped";
							return {
								...statusBase,
								state: "stopped",
								stoppedAt,
								durationMs: Math.max(0, stoppedAt - startedAt),
								summary: `Recorded demo video and event timeline to ${outputDir}.`,
							};
						} catch (error) {
							state = "failed";
							throw error;
						}
					})();
					return await stopping;
				},
			};
		},
	};
}
