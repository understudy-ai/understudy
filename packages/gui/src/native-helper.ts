import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileAsync } from "./exec-utils.js";

const HELPER_BINARY_NAME = "understudy-gui-native-helper";
const HELPER_COMPILE_TIMEOUT_MS = 120_000;

const NATIVE_GUI_HELPER_SOURCE = String.raw`
import Foundation
import AppKit
import ApplicationServices
import CoreGraphics

enum HelperError: Error, CustomStringConvertible {
	case invalidCommand(String)
	case invalidEnv(String)
	case missingEnv(String)
	case applicationNotFound(String)
	case activationFailed(String)
	case eventCreationFailed(String)

	var description: String {
		switch self {
		case .invalidCommand(let value):
			return "invalidCommand(\(value))"
		case .invalidEnv(let key):
			return "invalidEnv(\(key))"
		case .missingEnv(let key):
			return "missingEnv(\(key))"
		case .applicationNotFound(let name):
			return "applicationNotFound(\(name))"
		case .activationFailed(let name):
			return "activationFailed(\(name))"
		case .eventCreationFailed(let detail):
			return "eventCreationFailed(\(detail))"
		}
	}
}

struct Rect: Codable {
	let x: Double
	let y: Double
	let width: Double
	let height: Double
}

struct Point: Codable {
	let x: Double
	let y: Double
}

struct DisplayDescriptor: Codable {
	let index: Int
	let bounds: Rect
}

struct CaptureContext: Codable {
	let appName: String?
	let display: DisplayDescriptor
	let cursor: Point
	let windowId: Int?
	let windowTitle: String?
	let windowBounds: Rect?
	let windowCount: Int?
	let windowCaptureStrategy: String?
}

struct WindowMatch {
	let id: Int
	let title: String?
	let bounds: CGRect
	let layer: Int
}

struct WindowSelection {
	let primary: WindowMatch
	let captureBounds: CGRect
	let windowCount: Int
	let captureStrategy: String
}

func env(_ key: String) -> String {
	ProcessInfo.processInfo.environment[key] ?? ""
}

func trimmedEnv(_ key: String) -> String? {
	let value = env(key).trimmingCharacters(in: .whitespacesAndNewlines)
	return value.isEmpty ? nil : value
}

func normalizedText(_ value: String?) -> String? {
	guard let value else { return nil }
	let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
	return normalized.isEmpty ? nil : normalized
}

func requiredDouble(_ key: String) throws -> Double {
	let raw = env(key)
	guard let value = Double(raw) else { throw HelperError.invalidEnv(key) }
	return value
}

func requiredInt32(_ key: String) throws -> Int32 {
	let raw = env(key)
	guard let value = Int32(raw) else { throw HelperError.invalidEnv(key) }
	return value
}

func requiredInt(_ key: String) throws -> Int {
	let raw = env(key)
	guard let value = Int(raw) else { throw HelperError.invalidEnv(key) }
	return value
}

func optionalInt(_ key: String) -> Int? {
	let raw = env(key)
	guard !raw.isEmpty else { return nil }
	return Int(raw)
}

func optionalDouble(_ key: String) -> Double? {
	Double(env(key))
}

func shouldActivateApp() -> Bool {
	env("UNDERSTUDY_GUI_ACTIVATE_APP") != "0"
}

func matchesAppName(_ app: NSRunningApplication, requestedName: String) -> Bool {
	let normalized = requestedName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
	if normalized.isEmpty {
		return false
	}
	if app.localizedName?.lowercased() == normalized {
		return true
	}
	if app.bundleIdentifier?.lowercased() == normalized {
		return true
	}
	if app.bundleURL?.deletingPathExtension().lastPathComponent.lowercased() == normalized {
		return true
	}
	return false
}

func findRunningApplication(named name: String) -> NSRunningApplication? {
	let candidates = NSWorkspace.shared.runningApplications.filter { app in
		matchesAppName(app, requestedName: name) && !app.isTerminated
	}
	if let active = candidates.first(where: { $0.isActive }) {
		return active
	}
	return candidates.first
}

func resolveRequestedApplication(named name: String?) -> NSRunningApplication? {
	guard let name else {
		return NSWorkspace.shared.frontmostApplication
	}
	return findRunningApplication(named: name) ?? NSWorkspace.shared.frontmostApplication
}

func activateApplication(named name: String?) throws {
	guard let name else {
		return
	}
	if let frontmost = NSWorkspace.shared.frontmostApplication, matchesAppName(frontmost, requestedName: name) {
		return
	}
	guard let app = findRunningApplication(named: name) else {
		throw HelperError.applicationNotFound(name)
	}
	if !app.activate(options: [.activateIgnoringOtherApps]) {
		throw HelperError.activationFailed(name)
	}
	usleep(100_000)
}

func rect(_ value: CGRect) -> Rect {
	Rect(
		x: value.origin.x.rounded(),
		y: value.origin.y.rounded(),
		width: value.size.width.rounded(),
		height: value.size.height.rounded()
	)
}

func point(_ value: CGPoint) -> Point {
	Point(x: value.x.rounded(), y: value.y.rounded())
}

func activeDisplays() -> [(index: Int, bounds: CGRect)] {
	var count: UInt32 = 0
	CGGetActiveDisplayList(0, nil, &count)
	var displayIDs = Array(repeating: CGDirectDisplayID(0), count: Int(count))
	CGGetActiveDisplayList(count, &displayIDs, &count)
	return Array(displayIDs.prefix(Int(count))).enumerated().map { item in
		(index: item.offset + 1, bounds: CGDisplayBounds(item.element))
	}
}

func displayForPoint(_ point: CGPoint, displays: [(index: Int, bounds: CGRect)]) -> (index: Int, bounds: CGRect) {
	for display in displays where display.bounds.contains(point) {
		return display
	}
	return displays.first ?? (index: 1, bounds: CGDisplayBounds(CGMainDisplayID()))
}

func matchingWindows(
	ownerName: String?,
	exactTitle: String?,
	titleContains: String?,
) -> [WindowMatch] {
	guard let windowInfo = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
		return []
	}
	let normalizedExactTitle = normalizedText(exactTitle)
	let normalizedContainsTitle = normalizedText(titleContains)
	var matches: [WindowMatch] = []
	for info in windowInfo {
		let alpha = info[kCGWindowAlpha as String] as? Double ?? 1
		let layer = info[kCGWindowLayer as String] as? Int ?? 0
		let owner = info[kCGWindowOwnerName as String] as? String ?? ""
		if alpha <= 0.01 {
			continue
		}
		if let ownerName, owner != ownerName {
			continue
		}
		guard let rawBounds = info[kCGWindowBounds as String] else {
			continue
		}
		let boundsDict = rawBounds as! CFDictionary
		guard
			let bounds = CGRect(dictionaryRepresentation: boundsDict),
			bounds.width >= 80,
			bounds.height >= 80
		else {
			continue
		}
		let windowId = (info[kCGWindowNumber as String] as? NSNumber)?.intValue
		let title = info[kCGWindowName as String] as? String
		let normalizedTitle = normalizedText(title) ?? ""
		if let normalizedExactTitle, normalizedTitle != normalizedExactTitle {
			continue
		}
		if let normalizedContainsTitle, !normalizedTitle.contains(normalizedContainsTitle) {
			continue
		}
		matches.append(WindowMatch(
			id: windowId ?? 0,
			title: title,
			bounds: bounds.integral,
			layer: layer
		))
	}
	return matches
}

func rankWindows(_ matches: [WindowMatch]) -> [WindowMatch] {
	return matches.sorted { lhs, rhs in
		let lhsPrimaryLayer = lhs.layer == 0 ? 0 : 1
		let rhsPrimaryLayer = rhs.layer == 0 ? 0 : 1
		if lhsPrimaryLayer != rhsPrimaryLayer {
			return lhsPrimaryLayer < rhsPrimaryLayer
		}
		if lhs.layer != rhs.layer {
			return lhs.layer < rhs.layer
		}
		let lhsArea = lhs.bounds.width * lhs.bounds.height
		let rhsArea = rhs.bounds.width * rhs.bounds.height
		if lhsArea != rhsArea {
			return lhsArea > rhsArea
		}
		let lhsHasTitle = normalizedText(lhs.title) != nil
		let rhsHasTitle = normalizedText(rhs.title) != nil
		if lhsHasTitle != rhsHasTitle {
			return lhsHasTitle && !rhsHasTitle
		}
		return lhs.id < rhs.id
	}
}

func unionBounds(for matches: [WindowMatch]) -> CGRect? {
	guard let first = matches.first else {
		return nil
	}
	return matches.dropFirst().reduce(first.bounds) { partial, match in
		partial.union(match.bounds)
	}.integral
}

func selectedWindow(
	ownerName: String?,
	exactTitle: String?,
	titleContains: String?,
	index: Int?
) -> WindowSelection? {
	let matches = matchingWindows(
		ownerName: ownerName,
		exactTitle: exactTitle,
		titleContains: titleContains
	)
	guard !matches.isEmpty else {
		return nil
	}
	let hasExplicitSelection = normalizedText(exactTitle) != nil || normalizedText(titleContains) != nil || index != nil
	if let index, index > 0, index <= matches.count {
		let window = matches[index - 1]
		return WindowSelection(
			primary: window,
			captureBounds: window.bounds.integral,
			windowCount: 1,
			captureStrategy: "selected_window"
		)
	}
	let ranked = rankWindows(matches)
	guard let primary = ranked.first else {
		return nil
	}
	if hasExplicitSelection {
		return WindowSelection(
			primary: primary,
			captureBounds: primary.bounds.integral,
			windowCount: 1,
			captureStrategy: "selected_window"
		)
	}
	if matches.count == 1 {
		return WindowSelection(
			primary: primary,
			captureBounds: primary.bounds.integral,
			windowCount: 1,
			captureStrategy: "main_window"
		)
	}
	guard let combinedBounds = unionBounds(for: matches) else {
		return nil
	}
	return WindowSelection(
		primary: primary,
		captureBounds: combinedBounds,
		windowCount: matches.count,
		captureStrategy: "app_union"
	)
}

func handleCaptureContext() throws {
	let requestedApp = trimmedEnv("UNDERSTUDY_GUI_APP")
	let requestedWindowTitle = trimmedEnv("UNDERSTUDY_GUI_WINDOW_TITLE")
	let requestedWindowTitleContains = trimmedEnv("UNDERSTUDY_GUI_WINDOW_TITLE_CONTAINS")
	let requestedWindowIndex = optionalInt("UNDERSTUDY_GUI_WINDOW_INDEX")
	if shouldActivateApp() {
		try activateApplication(named: requestedApp)
	}
	let resolvedApp = resolveRequestedApplication(named: requestedApp)
	let targetApp = resolvedApp?.localizedName ?? requestedApp ?? NSWorkspace.shared.frontmostApplication?.localizedName
	let cursorLocation = CGEvent(source: nil)?.location ?? .zero
	let displays = activeDisplays()
	let window = selectedWindow(
		ownerName: targetApp,
		exactTitle: requestedWindowTitle,
		titleContains: requestedWindowTitleContains,
		index: requestedWindowIndex
	)
	let anchorPoint = window.map { CGPoint(x: $0.primary.bounds.midX, y: $0.primary.bounds.midY) } ?? cursorLocation
	let display = displayForPoint(anchorPoint, displays: displays)

	let payload = CaptureContext(
		appName: targetApp,
		display: DisplayDescriptor(index: display.index, bounds: rect(display.bounds)),
		cursor: point(cursorLocation),
		windowId: window?.primary.id,
		windowTitle: window?.primary.title,
		windowBounds: window.map { rect($0.captureBounds) },
		windowCount: window?.windowCount,
		windowCaptureStrategy: window?.captureStrategy
	)

	let encoder = JSONEncoder()
	encoder.outputFormatting = [.sortedKeys]
	let data = try encoder.encode(payload)
	FileHandle.standardOutput.write(data)
}

func makeMouseEvent(_ type: CGEventType, point: CGPoint, button: CGMouseButton = .left) throws -> CGEvent {
	guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button) else {
		throw HelperError.eventCreationFailed("mouse_\(type.rawValue)")
	}
	return event
}

func post(_ event: CGEvent) {
	event.post(tap: .cghidEventTap)
}

func moveCursor(to point: CGPoint) throws {
	post(try makeMouseEvent(.mouseMoved, point: point))
	usleep(30_000)
}

func leftDown(at point: CGPoint, clickState: Int64 = 1) throws {
	let event = try makeMouseEvent(.leftMouseDown, point: point)
	event.setIntegerValueField(.mouseEventClickState, value: clickState)
	post(event)
}

func leftUp(at point: CGPoint, clickState: Int64 = 1) throws {
	let event = try makeMouseEvent(.leftMouseUp, point: point)
	event.setIntegerValueField(.mouseEventClickState, value: clickState)
	post(event)
}

func rightDown(at point: CGPoint, clickState: Int64 = 1) throws {
	let event = try makeMouseEvent(.rightMouseDown, point: point, button: .right)
	event.setIntegerValueField(.mouseEventClickState, value: clickState)
	post(event)
}

func rightUp(at point: CGPoint, clickState: Int64 = 1) throws {
	let event = try makeMouseEvent(.rightMouseUp, point: point, button: .right)
	event.setIntegerValueField(.mouseEventClickState, value: clickState)
	post(event)
}

func drag(from start: CGPoint, to end: CGPoint, steps: Int, durationMs: Int) throws {
	let stepCount = max(1, steps)
	let sleepMicros = useconds_t(max(10_000, (durationMs * 1_000) / stepCount))
	try moveCursor(to: start)
	try leftDown(at: start)
	usleep(50_000)
	for index in 1...stepCount {
		let progress = Double(index) / Double(stepCount)
		let point = CGPoint(
			x: start.x + ((end.x - start.x) * progress),
			y: start.y + ((end.y - start.y) * progress)
		)
		post(try makeMouseEvent(.leftMouseDragged, point: point))
		usleep(sleepMicros)
	}
	try leftUp(at: end)
}

func handleEvent() throws {
	let requestedApp = trimmedEnv("UNDERSTUDY_GUI_APP")
	if shouldActivateApp() {
		try activateApplication(named: requestedApp)
	}
	switch env("UNDERSTUDY_GUI_EVENT_MODE") {
	case "click":
		let point = CGPoint(x: try requiredDouble("UNDERSTUDY_GUI_X"), y: try requiredDouble("UNDERSTUDY_GUI_Y"))
		try moveCursor(to: point)
		try leftDown(at: point)
		usleep(30_000)
		try leftUp(at: point)
		print("cg_click")
	case "right_click":
		let point = CGPoint(x: try requiredDouble("UNDERSTUDY_GUI_X"), y: try requiredDouble("UNDERSTUDY_GUI_Y"))
		try moveCursor(to: point)
		try rightDown(at: point)
		usleep(30_000)
		try rightUp(at: point)
		print("cg_right_click")
	case "double_click":
		let point = CGPoint(x: try requiredDouble("UNDERSTUDY_GUI_X"), y: try requiredDouble("UNDERSTUDY_GUI_Y"))
		try moveCursor(to: point)
		for state in [Int64(1), Int64(2)] {
			try leftDown(at: point, clickState: state)
			usleep(30_000)
			try leftUp(at: point, clickState: state)
			usleep(80_000)
		}
		print("cg_double_click")
	case "hover":
		let point = CGPoint(x: try requiredDouble("UNDERSTUDY_GUI_X"), y: try requiredDouble("UNDERSTUDY_GUI_Y"))
		let settleMs = max(0, optionalInt("UNDERSTUDY_GUI_SETTLE_MS") ?? 200)
		try moveCursor(to: point)
		if settleMs > 0 {
			usleep(useconds_t(settleMs * 1_000))
		}
		print("cg_hover")
	case "click_and_hold":
		let point = CGPoint(x: try requiredDouble("UNDERSTUDY_GUI_X"), y: try requiredDouble("UNDERSTUDY_GUI_Y"))
		let holdDurationMs = max(100, optionalInt("UNDERSTUDY_GUI_HOLD_DURATION_MS") ?? 650)
		try moveCursor(to: point)
		try leftDown(at: point)
		usleep(useconds_t(holdDurationMs * 1_000))
		try leftUp(at: point)
		print("cg_click_and_hold")
	case "drag":
		let start = CGPoint(x: try requiredDouble("UNDERSTUDY_GUI_FROM_X"), y: try requiredDouble("UNDERSTUDY_GUI_FROM_Y"))
		let end = CGPoint(x: try requiredDouble("UNDERSTUDY_GUI_TO_X"), y: try requiredDouble("UNDERSTUDY_GUI_TO_Y"))
		let durationMs = try requiredInt("UNDERSTUDY_GUI_DURATION_MS")
		let steps = try requiredInt("UNDERSTUDY_GUI_STEPS")
		try drag(from: start, to: end, steps: steps, durationMs: durationMs)
		print("cg_drag")
	case "scroll":
		if let x = optionalDouble("UNDERSTUDY_GUI_X"), let y = optionalDouble("UNDERSTUDY_GUI_Y") {
			try moveCursor(to: CGPoint(x: x, y: y))
		}
		let vertical = try requiredInt32("UNDERSTUDY_GUI_SCROLL_Y")
		let horizontal = try requiredInt32("UNDERSTUDY_GUI_SCROLL_X")
		let scrollUnit = trimmedEnv("UNDERSTUDY_GUI_SCROLL_UNIT")
		let units: CGScrollEventUnit = scrollUnit == "pixel" ? .pixel : .line
		guard let event = CGEvent(
			scrollWheelEvent2Source: nil,
			units: units,
			wheelCount: 2,
			wheel1: vertical,
			wheel2: horizontal,
			wheel3: 0
		) else {
			throw HelperError.eventCreationFailed("scroll")
		}
		post(event)
		print("cg_scroll")
	default:
		throw HelperError.missingEnv("UNDERSTUDY_GUI_EVENT_MODE")
	}
}

do {
	let command = CommandLine.arguments.dropFirst().first ?? ""
	switch command {
	case "activate":
		try activateApplication(named: trimmedEnv("UNDERSTUDY_GUI_APP"))
		print("activated")
	case "capture-context":
		try handleCaptureContext()
	case "event":
		try handleEvent()
	default:
		throw HelperError.invalidCommand(command)
	}
} catch {
	fputs("Understudy native GUI helper failed: \(error)\n", stderr)
	exit(1)
}
`;

let helperBinaryPath: string | undefined;
let helperBinaryPromise: Promise<string> | undefined;

function formatExecFailure(error: unknown): string {
	const record = error as {
		message?: string;
		stderr?: string;
		stdout?: string;
	};
	const details = [record.stderr, record.stdout]
		.map((value) => (typeof value === "string" ? value.trim() : ""))
		.filter(Boolean)
		.join(" ");
	return [record.message ?? String(error), details].filter(Boolean).join(" ").trim();
}

export async function resolveNativeGuiHelperBinary(): Promise<string> {
	const overridePath = process.env.UNDERSTUDY_GUI_NATIVE_HELPER_PATH?.trim();
	if (overridePath) {
		return overridePath;
	}
	if (helperBinaryPath) {
		return helperBinaryPath;
	}
	if (helperBinaryPromise) {
		return await helperBinaryPromise;
	}

	helperBinaryPromise = (async () => {
		const sourceHash = createHash("sha256")
			.update(NATIVE_GUI_HELPER_SOURCE)
			.digest("hex")
			.slice(0, 16);
		const helperDir = join(tmpdir(), "understudy-gui-native-helper", sourceHash);
		const sourcePath = join(helperDir, `${HELPER_BINARY_NAME}.swift`);
		const binaryPath = join(helperDir, HELPER_BINARY_NAME);

		try {
			await access(binaryPath);
			helperBinaryPath = binaryPath;
			return binaryPath;
		} catch {
			// Fall through to compile a fresh helper binary.
		}

		await mkdir(helperDir, { recursive: true });
		await writeFile(sourcePath, NATIVE_GUI_HELPER_SOURCE, "utf-8");
		try {
			await execFileAsync("swiftc", [sourcePath, "-o", binaryPath], {
				timeout: HELPER_COMPILE_TIMEOUT_MS,
				maxBuffer: 16 * 1024 * 1024,
				encoding: "utf-8",
			});
		} catch (error) {
			const message = formatExecFailure(error);
			throw new Error(
				`Failed to compile the Understudy macOS GUI helper. Ensure Xcode Command Line Tools are installed and "swiftc" is available. ${message}`.trim(),
			);
		}

		helperBinaryPath = binaryPath;
		return binaryPath;
	})();

	try {
		return await helperBinaryPromise;
	} finally {
		helperBinaryPromise = undefined;
	}
}
