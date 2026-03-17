import { asBoolean, asNumber, asRecord, asString } from "@understudy/core";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileAsync } from "./exec-utils.js";
import { resolveNativeGuiHelperBinary } from "./native-helper.js";
import { normalizeGuiGroundingMode } from "./types.js";
import {
	resolveGuiRuntimeCapabilities,
	type GuiRuntimeCapabilitySnapshot,
} from "./capabilities.js";
import type { GuiEnvironmentReadinessSnapshot } from "./readiness.js";
import type {
	GuiActionResult,
	GuiCaptureMode,
	GuiClickParams,
	GuiClickAndHoldParams,
	GuiGroundingActionIntent,
	GuiGroundingCoordinateSpace,
	GuiGroundingMode,
	GuiDoubleClickParams,
	GuiDragParams,
	GuiGroundingProvider,
	GuiGroundingResult,
	GuiHoverParams,
	GuiHotkeyParams,
	GuiKeypressParams,
	GuiObservation,
	GuiReadParams,
	GuiResolution,
	GuiRightClickParams,
	GuiScreenshotParams,
	GuiScrollDistance,
	GuiScrollParams,
	GuiTypeParams,
	GuiWaitParams,
	GuiWindowSelector,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_WAIT_TIMEOUT_MS = 8_000;
const DEFAULT_WAIT_INTERVAL_MS = 350;
const DEFAULT_DRAG_DURATION_MS = 450;
const DEFAULT_DRAG_STEPS = 18;
const DEFAULT_HOVER_SETTLE_MS = 200;
const DEFAULT_POST_ACTION_CAPTURE_SETTLE_MS = 3_000;
const DEFAULT_CLICK_AND_HOLD_MS = 650;
const DEFAULT_SCROLL_AMOUNT = 5;
const DEFAULT_TARGETED_SCROLL_DISTANCE: GuiScrollDistance = "medium";
const DEFAULT_TARGETLESS_SCROLL_DISTANCE: GuiScrollDistance = "page";
const SCROLL_DISTANCE_AMOUNTS: Record<GuiScrollDistance, number> = {
	small: 3,
	medium: DEFAULT_SCROLL_AMOUNT,
	page: 12,
};
const SCROLL_DISTANCE_FRACTIONS: Record<GuiScrollDistance, number> = {
	small: 0.25,
	medium: 0.5,
	page: 0.75,
};
const WAIT_CONFIRMATION_COUNT = 2;
const COMMON_KEY_CODES: Record<string, number> = {
	enter: 36,
	return: 36,
	tab: 48,
	escape: 53,
	esc: 53,
	delete: 51,
	backspace: 51,
	up: 126,
	down: 125,
	left: 123,
	right: 124,
	space: 49,
};

interface GuiNativeActionResult {
	actionKind: string;
}

interface GuiPoint {
	x: number;
	y: number;
}

interface GuiRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface GuiDisplayDescriptor {
	index: number;
	bounds: GuiRect;
}

interface GuiCaptureContext {
	appName?: string;
	display: GuiDisplayDescriptor;
	cursor: GuiPoint;
	windowId?: number;
	windowTitle?: string;
	windowBounds?: GuiRect;
	windowCount?: number;
	windowCaptureStrategy?: "selected_window" | "main_window" | "app_union";
}

interface GuiScreenshotArtifact {
	bytes: Buffer;
	filePath: string;
	mimeType: string;
	filename: string;
	metadata: GuiCaptureMetadata;
	cleanup: () => Promise<void>;
}

interface GroundedGuiTarget {
	resolution: GuiResolution;
	point: GuiPoint;
	imagePoint?: GuiPoint;
	displayBox?: GuiRect;
	artifact: GuiCaptureMetadata;
	grounded: GuiGroundingResult;
}

interface GuiTargetProbe {
	matched: boolean;
	attempts: number;
	grounded?: GroundedGuiTarget;
	capture?: GuiCaptureMetadata;
	image?: GuiActionResult["image"];
}

type PointActionIntent =
	| "click"
	| "right_click"
	| "double_click"
	| "hover"
	| "click_and_hold";

interface GroundedPointActionRequest {
	appName?: string;
	target?: string;
	scope?: string;
	groundingMode?: GuiGroundingMode;
	locationHint?: string;
	captureMode?: GuiCaptureMode;
	windowTitle?: string;
	windowSelector?: GuiWindowSelector;
	action: PointActionIntent;
	targetFallback: string;
	notFoundText: (targetDescription: string) => string;
	successText: (params: {
		targetDescription: string;
		actionKind: string;
		appName?: string;
	}) => string;
	summary: string;
	execute: (point: GuiPoint) => Promise<GuiNativeActionResult>;
	extraDetails?: Record<string, unknown>;
}

type GuiScrollUnit = "line" | "pixel";
type GuiScrollViewportSource = "target_box" | "capture_rect" | "window" | "display";

interface ResolvedGuiScrollPlan {
	amount: number;
	distancePreset: GuiScrollDistance | "custom";
	unit: GuiScrollUnit;
	viewportDimension?: number;
	viewportSource?: GuiScrollViewportSource;
	travelFraction?: number;
}

interface GuiCaptureMetadata {
	mode: "display" | "window";
	captureRect: GuiRect;
	display: GuiDisplayDescriptor;
	imageWidth?: number;
	imageHeight?: number;
	scaleX: number;
	scaleY: number;
	appName?: string;
	windowTitle?: string;
	windowCount?: number;
	windowCaptureStrategy?: "selected_window" | "main_window" | "app_union";
	cursor: GuiPoint;
	cursorVisible: boolean;
}

export const GUI_UNSUPPORTED_MESSAGE = "GUI tools are currently supported on macOS only.";

export class GuiRuntimeError extends Error {
	override name = "GuiRuntimeError";
}

export function isGuiPlatformSupported(platform: NodeJS.Platform = process.platform): boolean {
	return platform === "darwin";
}

function unsupportedResult(reason: string): GuiActionResult {
	return buildGuiResult({
		text: reason,
		status: "unsupported",
		summary: reason,
	});
}

function buildGuiResult(params: {
	text: string;
	status: GuiActionResult["status"]["code"];
	summary: string;
	observation?: GuiObservation;
	resolution?: GuiResolution;
	details?: Record<string, unknown>;
	image?: GuiActionResult["image"];
}): GuiActionResult {
	const status = {
		code: params.status,
		summary: params.summary,
	};
	return {
		text: params.text,
		observation: params.observation,
		resolution: params.resolution,
		status,
		details: params.details
			? {
				...params.details,
				status,
			}
			: undefined,
		image: params.image,
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function normalizeOptionalString(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function resolvePostActionCaptureSettleMsEnv(): number | undefined {
	const raw = process.env.UNDERSTUDY_GUI_POST_ACTION_CAPTURE_SETTLE_MS?.trim();
	if (!raw) {
		return undefined;
	}
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) {
		return undefined;
	}
	return Math.round(parsed);
}

function normalizeWindowSelector(
	value: GuiWindowSelector | undefined,
): GuiWindowSelector | undefined {
	if (!value) {
		return undefined;
	}
	const title = normalizeOptionalString(value.title);
	const titleContains = normalizeOptionalString(value.titleContains);
	const index =
		typeof value.index === "number" && Number.isFinite(value.index) && value.index > 0
			? Math.floor(value.index)
			: undefined;
	if (!title && !titleContains && !index) {
		return undefined;
	}
	return {
		title,
		titleContains,
		index,
	};
}

function resolveWindowSelection(params: {
	windowTitle?: string;
	windowSelector?: GuiWindowSelector;
}): GuiWindowSelector | undefined {
	const selector = normalizeWindowSelector(params.windowSelector);
	const explicitTitle = normalizeOptionalString(params.windowTitle);
	if (!selector && !explicitTitle) {
		return undefined;
	}
	return {
		title: explicitTitle ?? selector?.title,
		titleContains: selector?.titleContains,
		index: selector?.index,
	};
}

function describeWindowSelection(windowSelector: GuiWindowSelector | undefined): string | undefined {
	if (!windowSelector) {
		return undefined;
	}
	const parts = [
		windowSelector.title ? `title "${windowSelector.title}"` : undefined,
		windowSelector.titleContains ? `title containing "${windowSelector.titleContains}"` : undefined,
		windowSelector.index ? `window #${windowSelector.index}` : undefined,
	].filter(Boolean);
	return parts.length > 0 ? parts.join(", ") : undefined;
}

function normalizeRect(rect: GuiRect): GuiRect {
	return {
		x: Math.round(rect.x),
		y: Math.round(rect.y),
		width: Math.max(1, Math.round(rect.width)),
		height: Math.max(1, Math.round(rect.height)),
	};
}

function rectContainsPoint(rect: GuiRect, point: GuiPoint, tolerance = 0): boolean {
	return point.x >= rect.x - tolerance &&
		point.x <= rect.x + rect.width + tolerance &&
		point.y >= rect.y - tolerance &&
		point.y <= rect.y + rect.height + tolerance;
}

function clampPointToRect(point: GuiPoint, rect: GuiRect): GuiPoint {
	return {
		x: clamp(point.x, rect.x, rect.x + rect.width),
		y: clamp(point.y, rect.y, rect.y + rect.height),
	};
}

function parsePngDimensions(bytes: Buffer): { width: number; height: number } | undefined {
	if (bytes.length < 24) {
		return undefined;
	}
	if (!bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
		return undefined;
	}
	return {
		width: bytes.readUInt32BE(16),
		height: bytes.readUInt32BE(20),
	};
}

function dimensionsMatchRect(
	imageSize: { width: number; height: number } | undefined,
	rect: { width: number; height: number },
	tolerance = 4,
): boolean {
	if (!imageSize) {
		return false;
	}
	return Math.abs(imageSize.width - rect.width) <= tolerance &&
		Math.abs(imageSize.height - rect.height) <= tolerance;
}

async function cropWindowCaptureCanvas(params: {
	sourcePath: string;
	tempDir: string;
	captureRect: GuiRect;
	displayBounds: GuiRect;
	imageSize: { width: number; height: number };
}): Promise<{ filePath: string; bytes: Buffer; imageSize: { width: number; height: number } } | undefined> {
	const displayScaleX = params.displayBounds.width > 0
		? params.imageSize.width / params.displayBounds.width
		: 1;
	const displayScaleY = params.displayBounds.height > 0
		? params.imageSize.height / params.displayBounds.height
		: 1;
	const rawLeft = (params.captureRect.x - params.displayBounds.x) * displayScaleX;
	const rawTop = (params.captureRect.y - params.displayBounds.y) * displayScaleY;
	const rawRight = (params.captureRect.x + params.captureRect.width - params.displayBounds.x) * displayScaleX;
	const rawBottom = (params.captureRect.y + params.captureRect.height - params.displayBounds.y) * displayScaleY;
	const captureLeft = Math.max(0, Math.floor(rawLeft));
	const captureTop = Math.max(0, Math.floor(rawTop));
	const captureRight = Math.min(
		params.imageSize.width,
		Math.max(captureLeft, Math.ceil(rawRight)),
	);
	const captureBottom = Math.min(
		params.imageSize.height,
		Math.max(captureTop, Math.ceil(rawBottom)),
	);
	const captureWidth = captureRight - captureLeft;
	const captureHeight = captureBottom - captureTop;
	if (captureWidth <= 0 || captureHeight <= 0) {
		return undefined;
	}
	const outputPath = join(params.tempDir, "gui-screenshot-cropped.png");
	try {
		await execFileAsync("sips", [
			"-c",
			String(captureHeight),
			String(captureWidth),
			"--cropOffset",
			String(captureTop),
			String(captureLeft),
			params.sourcePath,
			"--out",
			outputPath,
		], {
			timeout: DEFAULT_TIMEOUT_MS,
			maxBuffer: 8 * 1024 * 1024,
			encoding: "utf-8",
		});
		const bytes = Buffer.from(await readFile(outputPath));
		const imageSize = parsePngDimensions(bytes);
		if (!imageSize) {
			return undefined;
		}
		return {
			filePath: outputPath,
			bytes,
			imageSize,
		};
	} catch {
		return undefined;
	}
}

function parseCaptureContext(raw: string): GuiCaptureContext {
	const parsed = JSON.parse(raw) as Record<string, unknown>;
	const display = parsed.display as Record<string, unknown> | undefined;
	const displayBounds = display?.bounds as Record<string, unknown> | undefined;
	const cursor = parsed.cursor as Record<string, unknown> | undefined;
	const windowBounds = parsed.windowBounds as Record<string, unknown> | undefined;
	if (!display || !displayBounds || !cursor) {
		throw new GuiRuntimeError("Capture metadata helper returned incomplete display metadata.");
	}
	const toNumber = (value: unknown, label: string): number => {
		if (typeof value !== "number" || !Number.isFinite(value)) {
			throw new GuiRuntimeError(`Capture metadata helper returned invalid ${label}.`);
		}
		return value;
	};
	return {
		appName: typeof parsed.appName === "string" ? parsed.appName : undefined,
		display: {
			index: Math.max(1, Math.round(toNumber(display.index, "display index"))),
			bounds: normalizeRect({
				x: toNumber(displayBounds.x, "display bounds x"),
				y: toNumber(displayBounds.y, "display bounds y"),
				width: toNumber(displayBounds.width, "display bounds width"),
				height: toNumber(displayBounds.height, "display bounds height"),
			}),
		},
		cursor: {
			x: toNumber(cursor.x, "cursor x"),
			y: toNumber(cursor.y, "cursor y"),
		},
		windowId: typeof parsed.windowId === "number" ? Math.round(parsed.windowId) : undefined,
		windowTitle: typeof parsed.windowTitle === "string" ? parsed.windowTitle : undefined,
		windowBounds: windowBounds
			? normalizeRect({
				x: toNumber(windowBounds.x, "window bounds x"),
				y: toNumber(windowBounds.y, "window bounds y"),
				width: toNumber(windowBounds.width, "window bounds width"),
				height: toNumber(windowBounds.height, "window bounds height"),
			})
			: undefined,
		windowCount:
			typeof parsed.windowCount === "number" && Number.isFinite(parsed.windowCount)
				? Math.max(1, Math.round(parsed.windowCount))
				: undefined,
		windowCaptureStrategy:
			parsed.windowCaptureStrategy === "selected_window" ||
			parsed.windowCaptureStrategy === "main_window" ||
			parsed.windowCaptureStrategy === "app_union"
				? parsed.windowCaptureStrategy
				: undefined,
	};
}

function pointFallsWithinImage(point: GuiPoint, artifact: GuiCaptureMetadata, tolerance = 1): boolean {
	if (!artifact.imageWidth || !artifact.imageHeight) {
		return point.x >= 0 && point.y >= 0;
	}
	return point.x >= -tolerance &&
		point.y >= -tolerance &&
		point.x <= artifact.imageWidth + tolerance &&
		point.y <= artifact.imageHeight + tolerance;
}

function transformImagePointToDisplay(point: GuiPoint, artifact: GuiCaptureMetadata): GuiPoint | undefined {
	if (!pointFallsWithinImage(point, artifact)) {
		return undefined;
	}
	const resolved = {
		x: artifact.captureRect.x + (point.x / artifact.scaleX),
		y: artifact.captureRect.y + (point.y / artifact.scaleY),
	};
	if (!rectContainsPoint(artifact.captureRect, resolved, 0.5)) {
		return undefined;
	}
	return clampPointToRect(resolved, artifact.captureRect);
}

function normalizeDisplayPointInCapture(point: GuiPoint, artifact: GuiCaptureMetadata): GuiPoint | undefined {
	const resolved = {
		x: Math.round(point.x),
		y: Math.round(point.y),
	};
	if (!rectContainsPoint(artifact.captureRect, resolved, 0.5)) {
		return undefined;
	}
	return clampPointToRect(resolved, artifact.captureRect);
}

function transformImageRectToDisplay(rect: GuiRect, artifact: GuiCaptureMetadata): GuiRect | undefined {
	const imageBounds = artifact.imageWidth && artifact.imageHeight
		? {
			x: 0,
			y: 0,
			width: artifact.imageWidth,
			height: artifact.imageHeight,
		}
		: undefined;
	const clippedRect = imageBounds
		? {
			x: clamp(rect.x, imageBounds.x, imageBounds.x + imageBounds.width),
			y: clamp(rect.y, imageBounds.y, imageBounds.y + imageBounds.height),
			width: Math.max(
				0,
				clamp(rect.x + rect.width, imageBounds.x, imageBounds.x + imageBounds.width) -
					clamp(rect.x, imageBounds.x, imageBounds.x + imageBounds.width),
			),
			height: Math.max(
				0,
				clamp(rect.y + rect.height, imageBounds.y, imageBounds.y + imageBounds.height) -
					clamp(rect.y, imageBounds.y, imageBounds.y + imageBounds.height),
			),
		}
		: rect;
	if (clippedRect.width <= 0 || clippedRect.height <= 0) {
		return undefined;
	}
	const left = artifact.captureRect.x + (clippedRect.x / artifact.scaleX);
	const top = artifact.captureRect.y + (clippedRect.y / artifact.scaleY);
	const right = artifact.captureRect.x + ((clippedRect.x + clippedRect.width) / artifact.scaleX);
	const bottom = artifact.captureRect.y + ((clippedRect.y + clippedRect.height) / artifact.scaleY);
	if (right <= left || bottom <= top) {
		return undefined;
	}
	return normalizeRect({
		x: clamp(left, artifact.captureRect.x, artifact.captureRect.x + artifact.captureRect.width),
		y: clamp(top, artifact.captureRect.y, artifact.captureRect.y + artifact.captureRect.height),
		width: Math.max(1, clamp(right, artifact.captureRect.x, artifact.captureRect.x + artifact.captureRect.width) - clamp(left, artifact.captureRect.x, artifact.captureRect.x + artifact.captureRect.width)),
		height: Math.max(1, clamp(bottom, artifact.captureRect.y, artifact.captureRect.y + artifact.captureRect.height) - clamp(top, artifact.captureRect.y, artifact.captureRect.y + artifact.captureRect.height)),
	});
}

function normalizeDisplayRectInCapture(rect: GuiRect, artifact: GuiCaptureMetadata): GuiRect | undefined {
	const left = clamp(rect.x, artifact.captureRect.x, artifact.captureRect.x + artifact.captureRect.width);
	const top = clamp(rect.y, artifact.captureRect.y, artifact.captureRect.y + artifact.captureRect.height);
	const right = clamp(
		rect.x + rect.width,
		artifact.captureRect.x,
		artifact.captureRect.x + artifact.captureRect.width,
	);
	const bottom = clamp(
		rect.y + rect.height,
		artifact.captureRect.y,
		artifact.captureRect.y + artifact.captureRect.height,
	);
	if (right <= left || bottom <= top) {
		return undefined;
	}
	return normalizeRect({
		x: left,
		y: top,
		width: right - left,
		height: bottom - top,
	});
}

function buildCaptureDetails(metadata: GuiCaptureMetadata): Record<string, unknown> {
	return {
		capture_method: "screencapture",
		capture_mode: metadata.mode,
		capture_rect: metadata.captureRect,
		capture_display: metadata.display,
		capture_image_size: metadata.imageWidth && metadata.imageHeight
			? {
				width: metadata.imageWidth,
				height: metadata.imageHeight,
			}
			: undefined,
		capture_scale_x: metadata.scaleX,
		capture_scale_y: metadata.scaleY,
		cursor_position: metadata.cursor,
		capture_cursor_visible: metadata.cursorVisible,
		window_title: metadata.windowTitle,
		window_count: metadata.windowCount,
		window_capture_strategy: metadata.windowCaptureStrategy,
	};
}

function describeGuiTarget(params: {
	target?: string;
	fallback?: string;
}): string {
	const normalizedTarget = params.target?.trim();
	if (normalizedTarget) {
		return `"${normalizedTarget}"`;
	}
	return params.fallback ?? "the GUI target";
}

function createGroundingResolution(result: GuiGroundingResult): GuiResolution {
	return {
		method: "grounding",
		confidence: clamp(result.confidence, 0, 1),
		reason: result.reason,
	};
}

function extractTelemetryPoint(value: unknown): GuiPoint | undefined {
	const record = asRecord(value);
	const x = asNumber(record?.x);
	const y = asNumber(record?.y);
	if (x === undefined || y === undefined) {
		return undefined;
	}
	return { x, y };
}

function summarizeGroundingTelemetry(raw: unknown): {
	modeRequested?: string;
	modeEffective?: string;
	selectedAttempt?: string;
	validationTriggered?: boolean;
	validationStatus?: string;
	validationReason?: string;
	roundsAttempted?: number;
	totalMs?: number;
	modelMs?: number;
	overheadMs?: number;
	sessionCreateMs?: number;
	modelPoint?: GuiPoint;
	modelImage?: { width?: number; height?: number; mimeType?: string };
	workingImage?: { width?: number; height?: number; logicalNormalizationApplied?: boolean };
	originalImage?: { width?: number; height?: number; mimeType?: string };
	requestImage?: { logicalWidth?: number; logicalHeight?: number; scaleX?: number; scaleY?: number };
	modelToOriginalScale?: { x?: number; y?: number };
	workingToOriginalScale?: { x?: number; y?: number };
} {
	const record = asRecord(raw);
	if (!record) {
		return {};
	}
	const runtimeTrace = asRecord(record.runtime_grounding_trace);
	const timingTrace = asRecord(record.grounding_timing_trace);
	const validation = asRecord(record.validation);
	const stages = Array.isArray(runtimeTrace?.stages) ? runtimeTrace.stages : [];
	const modelMs = stages.reduce((sum, stage) => {
		const stageRecord = asRecord(stage);
		const attempts = Array.isArray(stageRecord?.attempts) ? stageRecord.attempts : [];
		return sum + attempts.reduce((innerSum, attempt) => {
			const attemptRecord = asRecord(attempt);
			return innerSum + (asNumber(attemptRecord?.promptMs) ?? 0);
		}, 0);
	}, 0);
	const totalMs =
		asNumber(runtimeTrace?.totalMs) ??
		asNumber(timingTrace?.totalMs);
	const selectedAttempt = asString(record.selected_attempt);
	const validationTriggered =
		asBoolean(record.grounding_validation_triggered) ??
		(selectedAttempt === "validated" ? true : validation ? asString(validation.status) !== "skipped" : undefined);
	return {
		modeRequested: asString(record.grounding_mode_requested),
		modeEffective: asString(record.grounding_mode_effective),
		selectedAttempt,
		validationTriggered,
		validationStatus: asString(validation?.status),
		validationReason: asString(validation?.reason),
		roundsAttempted: asNumber(record.grounding_rounds_attempted),
		totalMs,
		modelMs: modelMs > 0 ? modelMs : undefined,
		overheadMs: totalMs !== undefined && modelMs > 0
			? Math.max(0, totalMs - modelMs)
			: undefined,
		sessionCreateMs: asNumber(runtimeTrace?.sessionCreateMs),
		modelPoint: extractTelemetryPoint(record.click_point),
		modelImage: asRecord(record.grounding_model_image)
			? {
				width: asNumber(asRecord(record.grounding_model_image)?.width),
				height: asNumber(asRecord(record.grounding_model_image)?.height),
				mimeType: asString(asRecord(record.grounding_model_image)?.mimeType),
			}
			: undefined,
		workingImage: asRecord(record.grounding_working_image)
			? {
				width: asNumber(asRecord(record.grounding_working_image)?.width),
				height: asNumber(asRecord(record.grounding_working_image)?.height),
				logicalNormalizationApplied: asBoolean(asRecord(record.grounding_working_image)?.logicalNormalizationApplied),
			}
			: undefined,
		originalImage: asRecord(record.grounding_original_image)
			? {
				width: asNumber(asRecord(record.grounding_original_image)?.width),
				height: asNumber(asRecord(record.grounding_original_image)?.height),
				mimeType: asString(asRecord(record.grounding_original_image)?.mimeType),
			}
			: undefined,
		requestImage: asRecord(record.grounding_request_image)
			? {
				logicalWidth: asNumber(asRecord(record.grounding_request_image)?.logicalWidth),
				logicalHeight: asNumber(asRecord(record.grounding_request_image)?.logicalHeight),
				scaleX: asNumber(asRecord(record.grounding_request_image)?.scaleX),
				scaleY: asNumber(asRecord(record.grounding_request_image)?.scaleY),
			}
			: undefined,
		modelToOriginalScale: asRecord(record.grounding_model_to_original_scale)
			? {
				x: asNumber(asRecord(record.grounding_model_to_original_scale)?.x),
				y: asNumber(asRecord(record.grounding_model_to_original_scale)?.y),
			}
			: undefined,
		workingToOriginalScale: asRecord(record.grounding_working_to_original_scale)
			? {
				x: asNumber(asRecord(record.grounding_working_to_original_scale)?.x),
				y: asNumber(asRecord(record.grounding_working_to_original_scale)?.y),
			}
			: undefined,
	};
}

function createScreenshotObservation(appName?: string, windowTitle?: string): GuiObservation {
	return {
		platform: process.platform,
		method: "screenshot",
		appName,
		windowTitle,
		capturedAt: Date.now(),
	};
}

async function runAppleScript(
	script: string,
	env: Record<string, string | undefined>,
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
	try {
		const result = await execFileAsync("osascript", ["-l", "AppleScript", "-e", script], {
			env: {
				...process.env,
				...env,
			},
			timeout: timeoutMs,
			maxBuffer: 8 * 1024 * 1024,
			encoding: "utf-8",
		});
		return result.stdout.trim();
	} catch (error) {
		const record = error as {
			message?: string;
			stderr?: string;
			stdout?: string;
			signal?: string;
			killed?: boolean;
		};
		const details = [record.stderr, record.stdout]
			.map((value) => (typeof value === "string" ? value.trim() : ""))
			.filter(Boolean)
			.join(" ");
		const timeoutHint = record.killed || record.signal === "SIGTERM"
			? " The GUI script timed out while inspecting the current desktop state."
			: "";
		const message = [record.message ?? String(error), details].filter(Boolean).join(" ").trim();
		throw new GuiRuntimeError(
			`macOS GUI scripting failed. Ensure the required macOS GUI control permissions are granted.${timeoutHint} ${message}`.trim(),
		);
	}
}

async function runNativeHelper(params: {
	command: "capture-context" | "event";
	env: Record<string, string | undefined>;
	timeoutMs?: number;
	failureMessage: string;
	timeoutHint: string;
}): Promise<string> {
	try {
		const binaryPath = await resolveNativeGuiHelperBinary();
		const result = await execFileAsync(binaryPath, [params.command], {
			env: {
				...process.env,
				...params.env,
			},
			timeout: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			maxBuffer: 8 * 1024 * 1024,
			encoding: "utf-8",
		});
		return result.stdout.trim();
	} catch (error) {
		const record = error as {
			message?: string;
			stderr?: string;
			stdout?: string;
			signal?: string;
			killed?: boolean;
		};
		const details = [record.stderr, record.stdout]
			.map((value) => (typeof value === "string" ? value.trim() : ""))
			.filter(Boolean)
			.join(" ");
		const timeoutHint = record.killed || record.signal === "SIGTERM"
			? ` ${params.timeoutHint}`
			: "";
		const message = [record.message ?? String(error), details].filter(Boolean).join(" ").trim();
		throw new GuiRuntimeError(`${params.failureMessage}${timeoutHint} ${message}`.trim());
	}
}

const TYPE_SCRIPT = String.raw`
set requestedApp to system attribute "UNDERSTUDY_GUI_APP"
set inputText to system attribute "UNDERSTUDY_GUI_TEXT"
set replaceText to system attribute "UNDERSTUDY_GUI_REPLACE"
set submitText to system attribute "UNDERSTUDY_GUI_SUBMIT"

on pasteText(rawText)
	set previousClipboard to missing value
	set hadClipboard to false
	try
		set previousClipboard to the clipboard
		set hadClipboard to true
	end try

	set the clipboard to rawText
	delay 0.15
	tell application "System Events"
		keystroke "v" using command down
	end tell
	delay 0.25

	if hadClipboard then
		try
			set the clipboard to previousClipboard
		end try
	end if
end pasteText

tell application "System Events"
	if requestedApp is not "" then
		if not (exists application process requestedApp) then error "Application process not found: " & requestedApp
		set targetProc to application process requestedApp
		set frontmost of targetProc to true
		delay 0.1
	else
		set targetProc to first application process whose frontmost is true
	end if

	if replaceText is "1" then
		keystroke "a" using command down
	end if
	my pasteText(inputText)
	if submitText is "1" then key code 36
	return "paste"
end tell
`;

const HOTKEY_SCRIPT = String.raw`
on buildModifierList(rawText)
	set modifierList to {}
	if rawText contains "command" then copy command down to end of modifierList
	if rawText contains "shift" then copy shift down to end of modifierList
	if rawText contains "option" then copy option down to end of modifierList
	if rawText contains "control" then copy control down to end of modifierList
	return modifierList
end buildModifierList

set requestedApp to system attribute "UNDERSTUDY_GUI_APP"
set keyText to system attribute "UNDERSTUDY_GUI_KEY"
set keyCodeText to system attribute "UNDERSTUDY_GUI_KEY_CODE"
set modifiersText to system attribute "UNDERSTUDY_GUI_MODIFIERS"
set repeatText to system attribute "UNDERSTUDY_GUI_REPEAT"
set modifierList to my buildModifierList(modifiersText)
set repeatCount to 1
if repeatText is not "" then
	set repeatCandidate to repeatText as integer
	if repeatCandidate > 0 then set repeatCount to repeatCandidate
end if

tell application "System Events"
	if requestedApp is not "" then
		if not (exists application process requestedApp) then error "Application process not found: " & requestedApp
		set targetProc to application process requestedApp
		set frontmost of targetProc to true
		delay 0.1
	end if

	if keyCodeText is not "" then
		repeat repeatCount times
			if (count of modifierList) is 0 then
				key code (keyCodeText as integer)
			else
				key code (keyCodeText as integer) using modifierList
			end if
			delay 0.03
		end repeat
		return "key_code"
	end if

	repeat repeatCount times
		if (count of modifierList) is 0 then
			keystroke keyText
		else
			keystroke keyText using modifierList
		end if
		delay 0.03
	end repeat
	return "keystroke"
end tell
`;

async function resolveCaptureContext(
	appName: string | undefined,
	options: {
		activateApp?: boolean;
		windowTitle?: string;
		windowSelector?: GuiWindowSelector;
	} = {},
): Promise<GuiCaptureContext> {
	const windowSelection = resolveWindowSelection({
		windowTitle: options.windowTitle,
		windowSelector: options.windowSelector,
	});
	const raw = await runNativeHelper({
		command: "capture-context",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			UNDERSTUDY_GUI_WINDOW_TITLE: windowSelection?.title,
			UNDERSTUDY_GUI_WINDOW_TITLE_CONTAINS: windowSelection?.titleContains,
			UNDERSTUDY_GUI_WINDOW_INDEX: windowSelection?.index ? String(windowSelection.index) : undefined,
		},
		failureMessage:
			"macOS native GUI capture helper failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while inspecting the current desktop state.",
	});
	return parseCaptureContext(raw);
}

function resolveCaptureMode(params: {
	context: GuiCaptureContext;
	captureMode?: GuiCaptureMode;
	includeCursor?: boolean;
}): {
	mode: "display" | "window";
	source: "display" | "region";
	captureRect: GuiRect;
	screencaptureArgs: string[];
} {
	const cursorArgs = params.includeCursor ? ["-C"] : [];
	if (params.captureMode !== "display" && params.context.windowBounds) {
		const captureRect = normalizeRect(params.context.windowBounds);
		return {
			mode: "window",
			source: "region",
			captureRect,
			screencaptureArgs: [
				"-x",
				...cursorArgs,
				"-R",
				`${captureRect.x},${captureRect.y},${captureRect.width},${captureRect.height}`,
				"-t",
				"png",
			],
		};
	}
	return {
		mode: "display",
		source: "display",
		captureRect: params.context.display.bounds,
		screencaptureArgs: [
			"-x",
			...cursorArgs,
			`-D${params.context.display.index}`,
			"-t",
			"png",
		],
	};
}

async function performPointClick(
	appName: string | undefined,
	point: { x: number; y: number },
	options: { activateApp?: boolean } = {},
): Promise<GuiNativeActionResult> {
	const actionKind = await runNativeHelper({
		command: "event",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			UNDERSTUDY_GUI_EVENT_MODE: "click",
			UNDERSTUDY_GUI_X: String(point.x),
			UNDERSTUDY_GUI_Y: String(point.y),
		},
		failureMessage:
			"macOS native GUI event dispatch failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while sending native input events.",
	});
	return { actionKind };
}

async function performRightClick(
	appName: string | undefined,
	point: { x: number; y: number },
	options: { activateApp?: boolean } = {},
): Promise<GuiNativeActionResult> {
	const actionKind = await runNativeHelper({
		command: "event",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			UNDERSTUDY_GUI_EVENT_MODE: "right_click",
			UNDERSTUDY_GUI_X: String(point.x),
			UNDERSTUDY_GUI_Y: String(point.y),
		},
		failureMessage:
			"macOS native GUI event dispatch failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while sending native input events.",
	});
	return { actionKind };
}

async function performDoubleClick(
	appName: string | undefined,
	point: { x: number; y: number },
	options: { activateApp?: boolean } = {},
): Promise<GuiNativeActionResult> {
	const actionKind = await runNativeHelper({
		command: "event",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			UNDERSTUDY_GUI_EVENT_MODE: "double_click",
			UNDERSTUDY_GUI_X: String(point.x),
			UNDERSTUDY_GUI_Y: String(point.y),
		},
		failureMessage:
			"macOS native GUI event dispatch failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while sending native input events.",
	});
	return { actionKind };
}

async function performHover(
	appName: string | undefined,
	point: { x: number; y: number },
	settleMs: number,
	options: { activateApp?: boolean } = {},
): Promise<GuiNativeActionResult> {
	const actionKind = await runNativeHelper({
		command: "event",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			UNDERSTUDY_GUI_EVENT_MODE: "hover",
			UNDERSTUDY_GUI_X: String(point.x),
			UNDERSTUDY_GUI_Y: String(point.y),
			UNDERSTUDY_GUI_SETTLE_MS: String(settleMs),
		},
		failureMessage:
			"macOS native GUI event dispatch failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while sending native input events.",
	});
	return { actionKind };
}

async function performClickAndHold(
	appName: string | undefined,
	point: { x: number; y: number },
	holdDurationMs: number,
	options: { activateApp?: boolean } = {},
): Promise<GuiNativeActionResult> {
	const actionKind = await runNativeHelper({
		command: "event",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			UNDERSTUDY_GUI_EVENT_MODE: "click_and_hold",
			UNDERSTUDY_GUI_X: String(point.x),
			UNDERSTUDY_GUI_Y: String(point.y),
			UNDERSTUDY_GUI_HOLD_DURATION_MS: String(holdDurationMs),
		},
		failureMessage:
			"macOS native GUI event dispatch failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while sending native input events.",
	});
	return { actionKind };
}

async function performDrag(
	appName: string | undefined,
	from: { x: number; y: number },
	to: { x: number; y: number },
	durationMs: number,
	options: { activateApp?: boolean } = {},
): Promise<GuiNativeActionResult> {
	const actionKind = await runNativeHelper({
		command: "event",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			UNDERSTUDY_GUI_EVENT_MODE: "drag",
			UNDERSTUDY_GUI_FROM_X: String(from.x),
			UNDERSTUDY_GUI_FROM_Y: String(from.y),
			UNDERSTUDY_GUI_TO_X: String(to.x),
			UNDERSTUDY_GUI_TO_Y: String(to.y),
			UNDERSTUDY_GUI_DURATION_MS: String(durationMs),
			UNDERSTUDY_GUI_STEPS: String(DEFAULT_DRAG_STEPS),
		},
		failureMessage:
			"macOS native GUI event dispatch failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while sending native input events.",
	});
	return { actionKind };
}

function scrollDirectionUsesHorizontalAxis(direction: NonNullable<GuiScrollParams["direction"]>): boolean {
	return direction === "left" || direction === "right";
}

function scrollViewportDimensionForDirection(
	rect: GuiRect,
	direction: NonNullable<GuiScrollParams["direction"]>,
): number {
	return scrollDirectionUsesHorizontalAxis(direction) ? rect.width : rect.height;
}

function resolveScrollPlan(params: GuiScrollParams, options: {
	grounded?: GroundedGuiTarget;
	context?: GuiCaptureContext;
}): ResolvedGuiScrollPlan {
	const direction = params.direction ?? "down";
	if (params.amount !== undefined) {
		return {
			amount: Math.max(1, Math.min(50, Math.round(params.amount))),
			distancePreset: "custom",
			unit: "line",
		};
	}
	const distancePreset = params.distance ??
		(params.target?.trim() ? DEFAULT_TARGETED_SCROLL_DISTANCE : DEFAULT_TARGETLESS_SCROLL_DISTANCE);
	const groundedRect = options.grounded?.displayBox;
	if (groundedRect) {
		const viewportDimension = Math.max(1, Math.round(scrollViewportDimensionForDirection(groundedRect, direction)));
		return {
			amount: Math.max(1, Math.min(4_000, Math.round(viewportDimension * SCROLL_DISTANCE_FRACTIONS[distancePreset]))),
			distancePreset,
			unit: "pixel",
			viewportDimension,
			viewportSource: "target_box",
			travelFraction: SCROLL_DISTANCE_FRACTIONS[distancePreset],
		};
	}
	const captureRect = options.grounded?.artifact.captureRect;
	if (captureRect) {
		const viewportDimension = Math.max(1, Math.round(scrollViewportDimensionForDirection(captureRect, direction)));
		return {
			amount: Math.max(1, Math.min(4_000, Math.round(viewportDimension * SCROLL_DISTANCE_FRACTIONS[distancePreset]))),
			distancePreset,
			unit: "pixel",
			viewportDimension,
			viewportSource: "capture_rect",
			travelFraction: SCROLL_DISTANCE_FRACTIONS[distancePreset],
		};
	}
	const contextRect = options.context
		? (params.captureMode === "display" || !options.context.windowBounds
			? options.context.display.bounds
			: options.context.windowBounds)
		: undefined;
	if (contextRect) {
		const viewportDimension = Math.max(1, Math.round(scrollViewportDimensionForDirection(contextRect, direction)));
		return {
			amount: Math.max(1, Math.min(4_000, Math.round(viewportDimension * SCROLL_DISTANCE_FRACTIONS[distancePreset]))),
			distancePreset,
			unit: "pixel",
			viewportDimension,
			viewportSource: params.captureMode === "display" || !options.context?.windowBounds ? "display" : "window",
			travelFraction: SCROLL_DISTANCE_FRACTIONS[distancePreset],
		};
	}
	return {
		amount: SCROLL_DISTANCE_AMOUNTS[distancePreset],
		distancePreset,
		unit: "line",
	};
}

async function performScroll(
	appName: string | undefined,
	point: { x: number; y: number } | undefined,
	params: {
		direction?: GuiScrollParams["direction"];
		plan: ResolvedGuiScrollPlan;
	},
	options: { activateApp?: boolean } = {},
): Promise<GuiNativeActionResult> {
	const direction = params.direction ?? "down";
	const amount = params.plan.amount;
	const deltaX =
		direction === "left" ? -amount :
			direction === "right" ? amount :
				0;
	const deltaY =
		direction === "up" ? amount :
			direction === "down" ? -amount :
				0;
	const actionKind = await runNativeHelper({
		command: "event",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			UNDERSTUDY_GUI_EVENT_MODE: "scroll",
			UNDERSTUDY_GUI_X: point ? String(point.x) : undefined,
			UNDERSTUDY_GUI_Y: point ? String(point.y) : undefined,
			UNDERSTUDY_GUI_SCROLL_UNIT: params.plan.unit,
			UNDERSTUDY_GUI_SCROLL_X: String(deltaX),
			UNDERSTUDY_GUI_SCROLL_Y: String(deltaY),
		},
		failureMessage:
			"macOS native GUI event dispatch failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while sending native input events.",
	});
	return { actionKind };
}

async function performType(params: GuiTypeParams): Promise<GuiNativeActionResult> {
	const actionKind = await runAppleScript(TYPE_SCRIPT, {
		UNDERSTUDY_GUI_APP: params.app?.trim(),
		UNDERSTUDY_GUI_TEXT: params.value,
		UNDERSTUDY_GUI_REPLACE: params.replace === false ? "0" : "1",
		UNDERSTUDY_GUI_SUBMIT: params.submit ? "1" : "0",
	});
	return { actionKind };
}

async function performHotkey(
	params: GuiHotkeyParams,
	repeat: number = 1,
): Promise<GuiNativeActionResult> {
	const normalizedKey = params.key.trim().toLowerCase();
	const keyCode = COMMON_KEY_CODES[normalizedKey];
	const actionKind = await runAppleScript(HOTKEY_SCRIPT, {
		UNDERSTUDY_GUI_APP: params.app?.trim(),
		UNDERSTUDY_GUI_KEY: keyCode ? "" : params.key,
		UNDERSTUDY_GUI_KEY_CODE: keyCode ? String(keyCode) : "",
		UNDERSTUDY_GUI_MODIFIERS: (params.modifiers ?? [])
			.map((modifier) => modifier.trim().toLowerCase())
			.filter(Boolean)
			.join(","),
		UNDERSTUDY_GUI_REPEAT: String(Math.max(1, repeat)),
	});
	return { actionKind };
}

async function captureScreenshotArtifact(params: {
	appName?: string;
	captureMode?: GuiCaptureMode;
	activateApp?: boolean;
	windowTitle?: string;
	windowSelector?: GuiWindowSelector;
	includeCursor?: boolean;
} = {}): Promise<GuiScreenshotArtifact> {
	const windowSelection = resolveWindowSelection({
		windowTitle: params.windowTitle,
		windowSelector: params.windowSelector,
	});
	const context = await resolveCaptureContext(params.appName, {
		activateApp: params.activateApp,
		windowTitle: windowSelection?.title,
		windowSelector: windowSelection,
	});
	if (windowSelection && params.captureMode !== "display" && !context.windowBounds) {
		const requestedWindow = describeWindowSelection(windowSelection) ?? "requested window";
		const appLabel = params.appName?.trim() ? ` for ${params.appName.trim()}` : "";
		throw new GuiRuntimeError(
			`Could not find ${requestedWindow}${appLabel}. Check the visible window title or use captureMode "display" if the target spans multiple windows.`,
		);
	}
	const capture = resolveCaptureMode({
		context,
		captureMode: params.captureMode,
		includeCursor: params.includeCursor,
	});
	const tempDir = await mkdtemp(join(tmpdir(), "understudy-gui-screenshot-"));
	const filePath = join(tempDir, "gui-screenshot.png");
	try {
		await execFileAsync("screencapture", [...capture.screencaptureArgs, filePath], {
			timeout: DEFAULT_TIMEOUT_MS,
			maxBuffer: 8 * 1024 * 1024,
		});
		let resolvedFilePath = filePath;
		let bytes: Buffer = Buffer.from(await readFile(filePath));
		let imageSize = parsePngDimensions(bytes);
		const captureRect = normalizeRect(capture.captureRect);
		const displayScaleX = imageSize && context.display.bounds.width > 0
			? imageSize.width / context.display.bounds.width
			: 1;
		const displayScaleY = imageSize && context.display.bounds.height > 0
			? imageSize.height / context.display.bounds.height
			: 1;
		const scaledCaptureRect = imageSize
			? {
				width: Math.round(captureRect.width * displayScaleX),
				height: Math.round(captureRect.height * displayScaleY),
			}
			: undefined;
		if (
			capture.mode === "window" &&
			capture.source === "display" &&
			imageSize &&
			Math.abs(displayScaleX - displayScaleY) <= 0.1 &&
			!dimensionsMatchRect(imageSize, scaledCaptureRect ?? captureRect)
		) {
			const cropped = await cropWindowCaptureCanvas({
				sourcePath: filePath,
				tempDir,
				captureRect,
				displayBounds: context.display.bounds,
				imageSize,
			});
			if (cropped) {
				resolvedFilePath = cropped.filePath;
				bytes = cropped.bytes;
				imageSize = cropped.imageSize;
			}
		}
		const scaleX = imageSize?.width && captureRect.width > 0
			? imageSize.width / captureRect.width
			: 1;
			const scaleY = imageSize?.height && captureRect.height > 0
				? imageSize.height / captureRect.height
				: 1;
			return {
				bytes,
				filePath: resolvedFilePath,
				mimeType: "image/png",
				filename: "gui-screenshot.png",
				metadata: {
					mode: capture.mode,
					captureRect,
					display: context.display,
					imageWidth: imageSize?.width,
					imageHeight: imageSize?.height,
					scaleX: Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1,
					scaleY: Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1,
					appName: params.appName,
					windowTitle: capture.mode === "window" ? context.windowTitle : undefined,
					windowCount: capture.mode === "window" ? context.windowCount : undefined,
					windowCaptureStrategy:
						capture.mode === "window" ? context.windowCaptureStrategy : undefined,
					cursor: context.cursor,
					cursorVisible: Boolean(params.includeCursor),
				},
				cleanup: async () => {
					await rm(tempDir, { recursive: true, force: true }).catch(() => {});
				},
			};
	} catch (error) {
		const record = error as {
			message?: string;
			stderr?: string;
			stdout?: string;
		};
		const details = [record.stderr, record.stdout]
			.map((value) => (typeof value === "string" ? value.trim() : ""))
			.filter(Boolean)
			.join(" ");
		const message = [record.message ?? String(error), details].filter(Boolean).join(" ").trim();
		throw new GuiRuntimeError(
			`macOS screenshot capture failed. Ensure Screen Recording permissions are granted. ${message}`.trim(),
		);
	}
}

function screenshotArtifactToImage(
	artifact: Pick<GuiScreenshotArtifact, "bytes" | "mimeType" | "filename">,
): { data: string; mimeType: string; filename: string } {
	return {
		data: artifact.bytes.toString("base64"),
		mimeType: artifact.mimeType,
		filename: artifact.filename,
	};
}

export interface ComputerUseGuiRuntimeOptions {
	groundingProvider?: GuiGroundingProvider;
	environmentReadiness?: GuiEnvironmentReadinessSnapshot;
}

export class ComputerUseGuiRuntime {
	private lastGroundingResolutionError: string | undefined;

	constructor(private readonly options: ComputerUseGuiRuntimeOptions = {}) {}

	hasGroundingProvider(): boolean {
		return Boolean(this.options.groundingProvider);
	}

	describeCapabilities(platform: NodeJS.Platform = process.platform): GuiRuntimeCapabilitySnapshot {
		return resolveGuiRuntimeCapabilities({
			platform,
			groundingAvailable: this.hasGroundingProvider(),
			environmentReadiness: this.options.environmentReadiness,
		});
	}

	private requireGroundingProvider(): GuiGroundingProvider {
		if (!this.options.groundingProvider) {
			throw new GuiRuntimeError(
				"Visual GUI grounding is unavailable. Configure a grounding provider before using gui_* target actions.",
			);
		}
		return this.options.groundingProvider;
	}

	private groundingDetails(result: GroundedGuiTarget): Record<string, unknown> {
		const coordinateSpace = result.grounded.coordinateSpace;
		const telemetry = summarizeGroundingTelemetry(result.grounded.raw);
		return {
			grounding_method: "grounding",
			grounding_provider: result.grounded.provider,
			grounding_coordinate_space: coordinateSpace,
			grounding_mode_requested: telemetry.modeRequested,
			grounding_mode_effective: telemetry.modeEffective,
			grounding_selected_attempt: telemetry.selectedAttempt,
			grounding_validation_triggered: telemetry.validationTriggered,
			grounding_validation_status: telemetry.validationStatus,
			grounding_validation_reason: telemetry.validationReason,
			grounding_rounds_attempted: telemetry.roundsAttempted,
			grounding_total_ms: telemetry.totalMs,
			grounding_model_ms: telemetry.modelMs,
			grounding_overhead_ms: telemetry.overheadMs,
			grounding_session_create_ms: telemetry.sessionCreateMs,
			grounding_display_box: result.displayBox ?? result.grounded.box,
			grounding_display_point: result.point,
			grounding_model_point: telemetry.modelPoint,
			grounding_model_image: telemetry.modelImage,
			grounding_working_image: telemetry.workingImage,
			grounding_original_image: telemetry.originalImage,
				grounding_request_image: telemetry.requestImage,
				grounding_model_to_original_scale: telemetry.modelToOriginalScale,
				grounding_working_to_original_scale: telemetry.workingToOriginalScale,
				grounding_image_box: coordinateSpace === "image_pixels"
					? result.grounded.box
					: undefined,
				grounding_image_point: result.imagePoint,
				confidence: result.grounded.confidence,
			raw_grounding: result.grounded.raw,
		};
	}

	private async resolveGuiTarget(params: {
		artifact: GuiScreenshotArtifact;
		target?: string;
		scope?: string;
		app?: string;
		action?: GuiGroundingActionIntent;
		groundingMode?: GuiGroundingMode;
		locationHint?: string;
		relatedTarget?: string;
		relatedScope?: string;
		relatedAction?: GuiGroundingActionIntent;
		relatedLocationHint?: string;
		relatedPoint?: GuiPoint;
		relatedBox?: GuiRect;
	}): Promise<GroundedGuiTarget | undefined> {
		this.lastGroundingResolutionError = undefined;
		const normalizedTarget = params.target?.trim();
		if (!normalizedTarget) {
			return undefined;
		}
			return await this.groundTarget({
				artifact: params.artifact,
				target: normalizedTarget,
				scope: params.scope,
				app: params.app,
				action: params.action,
				groundingMode: params.groundingMode,
				locationHint: params.locationHint,
				relatedTarget: params.relatedTarget,
				relatedScope: params.relatedScope,
				relatedAction: params.relatedAction,
				relatedLocationHint: params.relatedLocationHint,
				relatedPoint: params.relatedPoint,
				relatedBox: params.relatedBox,
			});
	}

	private targetResolutionDetails(result: GroundedGuiTarget | undefined): Record<string, unknown> {
		return result
			? this.groundingDetails(result)
			: this.lastGroundingResolutionError
				? {
					error: this.lastGroundingResolutionError,
					grounding_resolution_error: this.lastGroundingResolutionError,
				}
				: {};
	}

	private describeGroundingResolutionError(params: {
		target: string;
		point: GuiPoint;
		coordinateSpace: GuiGroundingCoordinateSpace;
		artifact: GuiCaptureMetadata;
	}): string {
		if (params.coordinateSpace === "display_pixels") {
			const rect = params.artifact.captureRect;
			return `Grounding resolved "${params.target}" to display-space point (${Math.round(params.point.x)}, ${Math.round(params.point.y)}), but that point falls outside capture rect (${rect.x}, ${rect.y}, ${rect.width}, ${rect.height}).`;
		}
		const imageSize = params.artifact.imageWidth && params.artifact.imageHeight
			? `${params.artifact.imageWidth}x${params.artifact.imageHeight}px`
			: "the captured screenshot";
		return `Grounding resolved "${params.target}" to image-space point (${Math.round(params.point.x)}, ${Math.round(params.point.y)}), but that point falls outside ${imageSize}.`;
	}

	private async groundTarget(params: {
		artifact: GuiScreenshotArtifact;
		target: string;
		scope?: string;
		app?: string;
		action?: GuiGroundingActionIntent;
		groundingMode?: GuiGroundingMode;
		locationHint?: string;
		relatedTarget?: string;
		relatedScope?: string;
		relatedAction?: GuiGroundingActionIntent;
		relatedLocationHint?: string;
		relatedPoint?: GuiPoint;
		relatedBox?: GuiRect;
	}): Promise<GroundedGuiTarget | undefined> {
		const provider = this.requireGroundingProvider();
		const groundingMode: GuiGroundingMode | undefined = params.groundingMode
			? normalizeGuiGroundingMode(params.groundingMode)
			: undefined;
		const grounded = await provider.ground({
			imagePath: params.artifact.filePath,
			logicalImageWidth: params.artifact.metadata.captureRect.width,
			logicalImageHeight: params.artifact.metadata.captureRect.height,
			imageScaleX: params.artifact.metadata.scaleX,
			imageScaleY: params.artifact.metadata.scaleY,
			target: params.target,
			scope: params.scope,
			app: params.app,
			action: params.action,
			groundingMode,
			locationHint: params.locationHint,
			captureMode: params.artifact.metadata.mode,
			windowTitle: params.artifact.metadata.windowTitle,
			relatedTarget: params.relatedTarget,
			relatedScope: params.relatedScope,
			relatedAction: params.relatedAction,
			relatedLocationHint: params.relatedLocationHint,
			relatedPoint: params.relatedPoint,
			relatedBox: params.relatedBox,
			previousFailures: [],
		});
		if (!grounded) {
			return undefined;
		}
		const groundedRaw = asRecord(grounded.raw) ?? {};
		const groundedWithMetadata: GuiGroundingResult = {
			...grounded,
			raw: {
				...groundedRaw,
				grounding_mode_requested: groundingMode ?? "single",
				grounding_mode_effective:
					asString(groundedRaw.grounding_mode_effective) ??
					groundingMode ??
					"single",
				grounding_previous_failures: 0,
			},
			};
			const coordinateSpace: GuiGroundingCoordinateSpace = grounded.coordinateSpace;
			if (coordinateSpace !== "image_pixels" && coordinateSpace !== "display_pixels") {
				this.lastGroundingResolutionError =
					`Grounding provider returned unsupported coordinate space "${String(coordinateSpace)}".`;
				return undefined;
			}
			const imagePoint = coordinateSpace === "image_pixels"
				? groundedWithMetadata.point
				: undefined;
			const point = coordinateSpace === "image_pixels"
				? transformImagePointToDisplay(groundedWithMetadata.point, params.artifact.metadata)
				: normalizeDisplayPointInCapture(groundedWithMetadata.point, params.artifact.metadata);
			if (!point) {
				this.lastGroundingResolutionError = this.describeGroundingResolutionError({
					target: params.target,
					point: groundedWithMetadata.point,
					coordinateSpace,
					artifact: params.artifact.metadata,
				});
				return undefined;
			}
			const displayBox = groundedWithMetadata.box
				? coordinateSpace === "image_pixels"
					? transformImageRectToDisplay(groundedWithMetadata.box, params.artifact.metadata)
					: normalizeDisplayRectInCapture(groundedWithMetadata.box, params.artifact.metadata)
				: undefined;
		const resolved = {
			resolution: createGroundingResolution(groundedWithMetadata),
			point,
			imagePoint,
			displayBox,
			artifact: params.artifact.metadata,
			grounded: groundedWithMetadata,
		};
		return resolved;
	}

	private async probeForTarget(params: {
		appName?: string;
		target: string;
		groundingMode?: GuiGroundingMode;
		locationHint?: string;
		scope?: string;
		captureMode?: GuiCaptureMode;
		windowTitle?: string;
		windowSelector?: GuiWindowSelector;
		state: "appear" | "disappear";
		timeoutMs: number;
		intervalMs?: number;
		activateApp?: boolean;
	}): Promise<GuiTargetProbe> {
		const deadline = Date.now() + params.timeoutMs;
		const intervalMs = params.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS;
		let attempts = 0;
		let consecutiveSatisfied = 0;
		let lastGrounded: GroundedGuiTarget | undefined;
		let lastCapture: GuiCaptureMetadata | undefined;
		let lastImage: GuiActionResult["image"] | undefined;

		while (Date.now() <= deadline) {
			attempts += 1;
				const artifact = await captureScreenshotArtifact({
					appName: params.appName,
					captureMode: params.captureMode,
					activateApp: params.activateApp,
					windowTitle: params.windowTitle,
					windowSelector: params.windowSelector,
				});
			try {
				lastCapture = artifact.metadata;
				lastImage = screenshotArtifactToImage(artifact);
				lastGrounded = await this.groundTarget({
					artifact,
					target: params.target,
					groundingMode: params.groundingMode,
					locationHint: params.locationHint,
					scope: params.scope,
					app: params.appName,
					action: "wait",
				});
			} finally {
				await artifact.cleanup();
			}

				const exists = Boolean(lastGrounded);
				const satisfied = (params.state === "appear" && exists) || (params.state === "disappear" && !exists);
				// Require a fresh repeat observation before declaring success so one-off grounding glitches
				// do not immediately turn into false positives.
				consecutiveSatisfied = satisfied ? consecutiveSatisfied + 1 : 0;
				if (consecutiveSatisfied >= WAIT_CONFIRMATION_COUNT) {
					return {
						matched: true,
						attempts,
						grounded: lastGrounded,
						capture: lastCapture,
						image: lastImage,
					};
				}

			await new Promise((resolve) => setTimeout(resolve, intervalMs));
		}

			return {
				matched: false,
				attempts,
				grounded: lastGrounded,
				capture: lastCapture,
				image: lastImage,
			};
	}

	private async captureEvidenceImage(params: {
		appName?: string;
		captureMode?: GuiCaptureMode;
		windowTitle?: string;
		windowSelector?: GuiWindowSelector;
		settleMs?: number;
	}): Promise<{ image?: GuiActionResult["image"]; details?: Record<string, unknown> }> {
		try {
			const settleMs = Math.max(
				0,
				Math.round(
					params.settleMs ??
						resolvePostActionCaptureSettleMsEnv() ??
						DEFAULT_POST_ACTION_CAPTURE_SETTLE_MS,
				),
			);
			if (settleMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, settleMs));
			}
			const artifact = await captureScreenshotArtifact({
				appName: params.appName,
				captureMode: params.captureMode,
				activateApp: false,
				windowTitle: params.windowTitle,
				windowSelector: params.windowSelector,
			});
			try {
				return {
					image: screenshotArtifactToImage(artifact),
					details: {
						...buildCaptureDetails(artifact.metadata),
						post_action_capture_settle_ms: settleMs,
					},
				};
			} finally {
				await artifact.cleanup();
			}
		} catch {
			return {};
		}
	}

	private async executeGroundedPointAction(
		params: GroundedPointActionRequest,
	): Promise<GuiActionResult> {
		const windowSelection = resolveWindowSelection({
			windowTitle: params.windowTitle,
			windowSelector: params.windowSelector,
		});
		const artifact = await captureScreenshotArtifact({
			appName: params.appName,
			captureMode: params.captureMode,
			windowTitle: windowSelection?.title,
			windowSelector: windowSelection,
		});
		try {
			const targetDescription = describeGuiTarget({
				target: params.target,
				fallback: params.targetFallback,
			});
			const grounded = await this.resolveGuiTarget({
				artifact,
				target: params.target,
				groundingMode: params.groundingMode,
				locationHint: params.locationHint,
				scope: params.scope,
				app: params.appName,
				action: params.action,
			});
			if (!grounded) {
				return buildGuiResult({
					text: params.notFoundText(targetDescription),
					status: "not_found",
					summary: "No confident visual GUI target was found.",
					details: {
						error: "No confident visual GUI target was found.",
						...buildCaptureDetails(artifact.metadata),
						...this.targetResolutionDetails(undefined),
						confidence: 0,
						app: params.appName,
					},
					image: screenshotArtifactToImage(artifact),
				});
			}

			const action = await params.execute(grounded.point);
			const evidence = await this.captureEvidenceImage({
				appName: params.appName,
				captureMode: params.captureMode,
				windowTitle: windowSelection?.title,
				windowSelector: windowSelection,
			});
			return buildGuiResult({
				text: params.successText({
					targetDescription,
					actionKind: action.actionKind,
					appName: params.appName,
				}),
				resolution: grounded.resolution,
				status: "action_sent",
				summary: params.summary,
				details: {
					action_kind: action.actionKind,
					...params.extraDetails,
					...this.targetResolutionDetails(grounded),
					...evidence.details,
					app: params.appName,
					executed_point: grounded.point,
					pre_action_capture: buildCaptureDetails(grounded.artifact),
				},
				image: evidence.image,
			});
		} finally {
			await artifact.cleanup();
		}
	}

	async read(params: GuiReadParams = {}): Promise<GuiActionResult> {
		if (!isGuiPlatformSupported()) {
			return unsupportedResult(GUI_UNSUPPORTED_MESSAGE);
		}

		const appName = normalizeOptionalString(params.app);
		const windowSelection = resolveWindowSelection({
			windowTitle: params.windowTitle,
			windowSelector: params.windowSelector,
		});
		const captureMode = params.captureMode ?? (!appName && !params.target?.trim() ? "display" : undefined);
		const artifact = await captureScreenshotArtifact({
			appName,
			captureMode,
			windowTitle: windowSelection?.title,
			windowSelector: windowSelection,
			includeCursor: !params.target?.trim(),
		});
		try {
			const image = screenshotArtifactToImage(artifact);
			const observation = createScreenshotObservation(appName, artifact.metadata.windowTitle);
			if (!params.target?.trim()) {
				return buildGuiResult({
					text: [
						appName
							? `Captured a visual GUI snapshot for ${appName}.`
							: "Captured the current desktop state for visual GUI inspection.",
						"Use the attached screenshot to inspect the scene or call vision_read for OCR-heavy questions.",
					].join("\n"),
					observation,
					status: "observed",
					summary: "Visual GUI snapshot captured.",
					details: {
						...buildCaptureDetails(artifact.metadata),
						grounding_method: "screenshot",
						confidence: 1,
						app: appName,
					},
					image,
				});
			}

				const grounded = await this.groundTarget({
					artifact,
					target: params.target,
					groundingMode: params.groundingMode,
					locationHint: params.locationHint,
					scope: params.scope,
					app: appName,
					action: "read",
				});
			if (!grounded) {
				return buildGuiResult({
					text: `Could not visually ground "${params.target}" in the current screenshot.`,
					observation,
					status: "not_found",
					summary: "No confident visual GUI target was found.",
					details: {
						error: "No confident visual GUI target was found.",
						...buildCaptureDetails(artifact.metadata),
						grounding_method: "grounding",
						confidence: 0,
						app: appName,
					},
					image,
				});
			}

			return buildGuiResult({
				text: [
					`Resolved "${params.target}" visually${appName ? ` in ${appName}` : ""}.`,
					`Confidence: ${grounded.grounded.confidence.toFixed(2)}`,
					`Reason: ${grounded.grounded.reason}`,
				].join("\n"),
				observation,
				resolution: grounded.resolution,
				status: "resolved",
				summary: "Resolved a GUI target from the screenshot grounding route.",
				details: {
					...buildCaptureDetails(artifact.metadata),
					...this.groundingDetails(grounded),
					app: appName,
				},
				image,
			});
		} finally {
			await artifact.cleanup();
		}
	}

	async click(params: GuiClickParams): Promise<GuiActionResult> {
		if (!isGuiPlatformSupported()) {
			return unsupportedResult(GUI_UNSUPPORTED_MESSAGE);
		}

		const appName = normalizeOptionalString(params.app);
		return await this.executeGroundedPointAction({
			appName,
			target: params.target,
			scope: params.scope,
			groundingMode: params.groundingMode,
			locationHint: params.locationHint,
			captureMode: params.captureMode,
			windowTitle: params.windowTitle,
			windowSelector: params.windowSelector,
			action: "click",
			targetFallback: "the requested GUI target",
			notFoundText: (targetDescription) =>
				`Could not visually resolve a clickable GUI target matching ${targetDescription}.`,
			successText: ({ targetDescription, actionKind, appName: resolvedAppName }) =>
				`Clicked ${targetDescription} via ${actionKind}${resolvedAppName ? ` in ${resolvedAppName}` : ""}.`,
			summary: "GUI click was sent.",
			execute: async (point) => await performPointClick(appName, point, {
				activateApp: false,
			}),
		});
	}

	async rightClick(params: GuiRightClickParams): Promise<GuiActionResult> {
		if (!isGuiPlatformSupported()) {
			return unsupportedResult(GUI_UNSUPPORTED_MESSAGE);
		}

		const appName = normalizeOptionalString(params.app);
		return await this.executeGroundedPointAction({
			appName,
			target: params.target,
			scope: params.scope,
			groundingMode: params.groundingMode,
			locationHint: params.locationHint,
			captureMode: params.captureMode,
			windowTitle: params.windowTitle,
			windowSelector: params.windowSelector,
			action: "right_click",
			targetFallback: "the requested GUI target",
			notFoundText: (targetDescription) =>
				`Could not visually resolve a GUI target to right click matching ${targetDescription}.`,
			successText: ({ targetDescription, actionKind, appName: resolvedAppName }) =>
				`Right-clicked ${targetDescription} via ${actionKind}${resolvedAppName ? ` in ${resolvedAppName}` : ""}.`,
			summary: "GUI right click was sent.",
			execute: async (point) => await performRightClick(appName, point, {
				activateApp: false,
			}),
		});
	}

	async doubleClick(params: GuiDoubleClickParams): Promise<GuiActionResult> {
		if (!isGuiPlatformSupported()) {
			return unsupportedResult(GUI_UNSUPPORTED_MESSAGE);
		}

		const appName = normalizeOptionalString(params.app);
		return await this.executeGroundedPointAction({
			appName,
			target: params.target,
			scope: params.scope,
			groundingMode: params.groundingMode,
			locationHint: params.locationHint,
			captureMode: params.captureMode,
			windowTitle: params.windowTitle,
			windowSelector: params.windowSelector,
			action: "double_click",
			targetFallback: "the requested GUI target",
			notFoundText: (targetDescription) =>
				`Could not visually resolve a GUI target to double click matching ${targetDescription}.`,
			successText: ({ targetDescription, actionKind, appName: resolvedAppName }) =>
				`Double-clicked ${targetDescription} via ${actionKind}${resolvedAppName ? ` in ${resolvedAppName}` : ""}.`,
			summary: "GUI double click was sent.",
			execute: async (point) => await performDoubleClick(appName, point, {
				activateApp: false,
			}),
		});
	}

	async hover(params: GuiHoverParams): Promise<GuiActionResult> {
		if (!isGuiPlatformSupported()) {
			return unsupportedResult(GUI_UNSUPPORTED_MESSAGE);
		}

		const appName = normalizeOptionalString(params.app);
		const settleMs = Math.max(0, Math.round(params.settleMs ?? DEFAULT_HOVER_SETTLE_MS));
		return await this.executeGroundedPointAction({
			appName,
			target: params.target,
			scope: params.scope,
			groundingMode: params.groundingMode,
			locationHint: params.locationHint,
			captureMode: params.captureMode,
			windowTitle: params.windowTitle,
			windowSelector: params.windowSelector,
			action: "hover",
			targetFallback: "the requested GUI target",
			notFoundText: (targetDescription) =>
				`Could not visually resolve a GUI target to hover matching ${targetDescription}.`,
			successText: ({ targetDescription, actionKind, appName: resolvedAppName }) =>
				`Hovered ${targetDescription} via ${actionKind}${resolvedAppName ? ` in ${resolvedAppName}` : ""}.`,
			summary: "GUI hover was sent.",
			execute: async (point) => await performHover(appName, point, settleMs, {
				activateApp: false,
			}),
			extraDetails: {
				settle_ms: settleMs,
			},
		});
	}

	async clickAndHold(params: GuiClickAndHoldParams): Promise<GuiActionResult> {
		if (!isGuiPlatformSupported()) {
			return unsupportedResult(GUI_UNSUPPORTED_MESSAGE);
		}

		const appName = normalizeOptionalString(params.app);
		const holdDurationMs = Math.max(100, Math.round(params.holdDurationMs ?? DEFAULT_CLICK_AND_HOLD_MS));
		return await this.executeGroundedPointAction({
			appName,
			target: params.target,
			scope: params.scope,
			groundingMode: params.groundingMode,
			locationHint: params.locationHint,
			captureMode: params.captureMode,
			windowTitle: params.windowTitle,
			windowSelector: params.windowSelector,
			action: "click_and_hold",
			targetFallback: "the requested GUI target",
			notFoundText: (targetDescription) =>
				`Could not visually resolve a GUI target to click and hold matching ${targetDescription}.`,
			successText: ({ targetDescription, actionKind, appName: resolvedAppName }) =>
				`Clicked and held ${targetDescription} via ${actionKind}${resolvedAppName ? ` in ${resolvedAppName}` : ""}.`,
			summary: "GUI click and hold was sent.",
			execute: async (point) => await performClickAndHold(appName, point, holdDurationMs, {
				activateApp: false,
			}),
			extraDetails: {
				hold_duration_ms: holdDurationMs,
			},
		});
	}

	async drag(params: GuiDragParams): Promise<GuiActionResult> {
		if (!isGuiPlatformSupported()) {
			return unsupportedResult(GUI_UNSUPPORTED_MESSAGE);
		}

		const appName = normalizeOptionalString(params.app);
		const fromScope = params.fromScope;
		const toScope = params.toScope;
		const windowSelection = resolveWindowSelection({
			windowTitle: params.windowTitle,
			windowSelector: params.windowSelector,
		});
		const artifact = await captureScreenshotArtifact({
			appName,
			captureMode: params.captureMode,
			windowTitle: windowSelection?.title,
			windowSelector: windowSelection,
		});
		try {
			const sourceDescription = describeGuiTarget({
				target: params.fromTarget,
				fallback: "the drag source",
			});
			const destinationDescription = describeGuiTarget({
				target: params.toTarget,
				fallback: "the drag destination",
			});
				const source = await this.resolveGuiTarget({
					artifact,
					target: params.fromTarget,
					groundingMode: params.groundingMode,
					locationHint: params.fromLocationHint,
					scope: fromScope,
					app: appName,
					action: "drag_source",
					relatedTarget: params.toTarget,
					relatedScope: toScope,
					relatedAction: "drag_destination",
				relatedLocationHint: params.toLocationHint,
			});
			if (!source) {
				return buildGuiResult({
					text: `Could not visually resolve a drag source matching ${sourceDescription}.`,
					status: "not_found",
					summary: "No confident visual drag source was found.",
					details: {
						error: "No confident visual drag source was found.",
						...buildCaptureDetails(artifact.metadata),
						...this.targetResolutionDetails(undefined),
						confidence: 0,
						app: appName,
					},
					image: screenshotArtifactToImage(artifact),
				});
			}

				const destination = await this.resolveGuiTarget({
					artifact,
					target: params.toTarget,
					groundingMode: params.groundingMode,
					locationHint: params.toLocationHint,
					scope: toScope,
					app: appName,
					action: "drag_destination",
					relatedTarget: params.fromTarget,
				relatedScope: fromScope,
				relatedAction: "drag_source",
				relatedLocationHint: params.fromLocationHint,
				relatedPoint: source.point,
				relatedBox: source.displayBox,
			});
			if (!destination) {
				return buildGuiResult({
					text: `Could not visually resolve a drag destination matching ${destinationDescription}.`,
					status: "not_found",
					summary: "No confident visual drag destination was found.",
					details: {
						error: "No confident visual drag destination was found.",
						...buildCaptureDetails(artifact.metadata),
						...this.targetResolutionDetails(undefined),
						confidence: 0,
						app: appName,
					},
					image: screenshotArtifactToImage(artifact),
				});
			}

				const action = await performDrag(
					appName,
					source.point,
					destination.point,
					Math.max(100, params.durationMs ?? DEFAULT_DRAG_DURATION_MS),
					{ activateApp: false },
				);
				const evidence = await this.captureEvidenceImage({
					appName,
					captureMode: params.captureMode,
				windowTitle: windowSelection?.title,
				windowSelector: windowSelection,
			});
				return buildGuiResult({
					text: `Dragged from ${sourceDescription} to ${destinationDescription} via ${action.actionKind}.`,
					resolution: source.resolution,
					status: "action_sent",
					summary: "GUI drag was sent.",
					details: {
						action_kind: action.actionKind,
						...this.targetResolutionDetails(source),
					destination_target_resolution: {
						...this.targetResolutionDetails(destination),
						reason: destination.grounded.reason,
					},
						...evidence.details,
						confidence: Math.min(source.grounded.confidence, destination.grounded.confidence),
						app: appName,
						executed_from_point: source.point,
						executed_to_point: destination.point,
						pre_action_capture: buildCaptureDetails(source.artifact),
				},
				image: evidence.image,
			});
		} finally {
			await artifact.cleanup();
		}
	}

	async scroll(params: GuiScrollParams = {}): Promise<GuiActionResult> {
		if (!isGuiPlatformSupported()) {
			return unsupportedResult(GUI_UNSUPPORTED_MESSAGE);
		}

		const appName = normalizeOptionalString(params.app);
		const scope = params.scope;
		const windowSelection = resolveWindowSelection({
			windowTitle: params.windowTitle,
			windowSelector: params.windowSelector,
		});
		const targetDescription = describeGuiTarget({
			target: params.target,
			fallback: "the current surface",
		});
		let context: GuiCaptureContext | undefined;
		let grounded: GroundedGuiTarget | undefined;
		if (params.target?.trim()) {
				const artifact = await captureScreenshotArtifact({
					appName,
					captureMode: params.captureMode,
					windowTitle: windowSelection?.title,
					windowSelector: windowSelection,
			});
			try {
						grounded = await this.resolveGuiTarget({
							artifact,
							target: params.target,
							groundingMode: params.groundingMode,
							locationHint: params.locationHint,
							scope,
							app: appName,
							action: "scroll",
						});
				if (!grounded) {
					return buildGuiResult({
						text: `Could not visually resolve a GUI target to scroll matching ${targetDescription}.`,
						status: "not_found",
						summary: "No confident visual GUI target was found.",
						details: {
							error: "No confident visual GUI target was found.",
							...buildCaptureDetails(artifact.metadata),
							...this.targetResolutionDetails(undefined),
							confidence: 0,
							app: appName,
						},
						image: screenshotArtifactToImage(artifact),
					});
				}
			} finally {
				await artifact.cleanup();
			}
		} else {
			context = await resolveCaptureContext(appName, {
				windowTitle: windowSelection?.title,
				windowSelector: windowSelection,
			});
		}

			const scrollPlan = resolveScrollPlan(params, {
				grounded,
				context,
			});
			const action = await performScroll(appName, grounded?.point, {
				direction: params.direction,
				plan: scrollPlan,
			}, {
				activateApp: !grounded && !context,
			});
			const direction = params.direction ?? "down";
			const evidence = await this.captureEvidenceImage({
				appName,
				captureMode: params.captureMode,
				windowTitle: windowSelection?.title,
				windowSelector: windowSelection,
			});
			return buildGuiResult({
				text: grounded
					? `Scrolled ${direction} on ${targetDescription} via ${action.actionKind}.`
					: `Scrolled ${direction}${appName ? ` in ${appName}` : ""} via ${action.actionKind}.`,
				resolution: grounded?.resolution,
				status: "action_sent",
				summary: "GUI scroll was sent.",
				details: {
					action_kind: action.actionKind,
					...(grounded ? this.targetResolutionDetails(grounded) : { grounding_method: "visual" }),
					...evidence.details,
					direction,
					amount: scrollPlan.amount,
					scroll_distance: scrollPlan.distancePreset,
					scroll_unit: scrollPlan.unit,
					scroll_viewport_dimension: scrollPlan.viewportDimension,
					scroll_viewport_source: scrollPlan.viewportSource,
					scroll_travel_fraction: scrollPlan.travelFraction,
					app: appName,
					executed_point: grounded?.point,
					...(grounded ? { pre_action_capture: buildCaptureDetails(grounded.artifact) } : {}),
				},
				image: evidence.image,
			});
	}

	async type(params: GuiTypeParams): Promise<GuiActionResult> {
		if (!isGuiPlatformSupported()) {
			return unsupportedResult(GUI_UNSUPPORTED_MESSAGE);
		}

		const appName = normalizeOptionalString(params.app);
		const scope = params.scope;
		const windowSelection = resolveWindowSelection({
			windowTitle: params.windowTitle,
			windowSelector: params.windowSelector,
		});
		const targetDescription = describeGuiTarget({
			target: params.target,
			fallback: "the input target",
		});
		let grounded: GroundedGuiTarget | undefined;
		if (params.target?.trim()) {
				const artifact = await captureScreenshotArtifact({
					appName,
					captureMode: params.captureMode,
					windowTitle: windowSelection?.title,
					windowSelector: windowSelection,
			});
			try {
						grounded = await this.resolveGuiTarget({
							artifact,
							target: params.target,
							groundingMode: params.groundingMode,
							locationHint: params.locationHint,
							scope,
							app: appName,
							action: "type",
						});
				if (!grounded) {
					return buildGuiResult({
						text: `Could not visually resolve an input target matching ${targetDescription}.`,
						status: "not_found",
						summary: "No confident visual input target was found.",
						details: {
							error: "No confident visual input target was found.",
							...buildCaptureDetails(artifact.metadata),
							...this.targetResolutionDetails(undefined),
							confidence: 0,
							app: appName,
						},
						image: screenshotArtifactToImage(artifact),
					});
				}
			} finally {
				await artifact.cleanup();
			}
			await performPointClick(appName, grounded.point, {
				activateApp: false,
			});
			await new Promise((resolve) => setTimeout(resolve, 120));
		}

			const action = await performType({ ...params, app: appName });
			const evidence = await this.captureEvidenceImage({
				appName,
				captureMode: params.captureMode,
				windowTitle: windowSelection?.title,
				windowSelector: windowSelection,
			});
			return buildGuiResult({
				text: grounded
					? `Typed into ${targetDescription} via ${action.actionKind}.`
					: `Typed into the currently focused GUI element via ${action.actionKind}.`,
				resolution: grounded?.resolution,
				status: "action_sent",
				summary: "GUI text input was sent.",
				details: {
					action_kind: action.actionKind,
					...(grounded ? this.targetResolutionDetails(grounded) : { grounding_method: "visual" }),
					...evidence.details,
					app: appName,
					executed_point: grounded?.point,
					...(grounded ? { pre_action_capture: buildCaptureDetails(grounded.artifact) } : {}),
				},
				image: evidence.image,
			});
	}

	async hotkey(params: GuiHotkeyParams): Promise<GuiActionResult> {
		if (!isGuiPlatformSupported()) {
			return unsupportedResult(GUI_UNSUPPORTED_MESSAGE);
		}

		const repeat = Math.max(1, Math.min(50, Math.round(params.repeat ?? 1)));
		const appName = normalizeOptionalString(params.app);
		const windowSelection = resolveWindowSelection({
			windowTitle: params.windowTitle,
			windowSelector: params.windowSelector,
		});
			const action = await performHotkey({ ...params, app: appName }, repeat);
			const shortcut = [...(params.modifiers ?? []), params.key].join("+");
			const evidence = await this.captureEvidenceImage({
				appName,
				captureMode: params.captureMode,
				windowTitle: windowSelection?.title,
				windowSelector: windowSelection,
			});
			return buildGuiResult({
				text: `Sent hotkey ${shortcut}${repeat > 1 ? ` x${repeat}` : ""} via ${action.actionKind}.`,
				status: "action_sent",
				summary: "GUI hotkey was sent.",
				details: {
					action_kind: action.actionKind,
					...evidence.details,
					repeat,
					grounding_method: "visual",
					confidence: 1,
					app: appName,
				},
				image: evidence.image,
			});
	}

	async keypress(params: GuiKeypressParams): Promise<GuiActionResult> {
		if (!isGuiPlatformSupported()) {
			return unsupportedResult(GUI_UNSUPPORTED_MESSAGE);
		}

		const repeat = Math.max(1, Math.min(50, Math.round(params.repeat ?? 1)));
		const appName = normalizeOptionalString(params.app);
		const windowSelection = resolveWindowSelection({
			windowTitle: params.windowTitle,
			windowSelector: params.windowSelector,
		});
			const action = await performHotkey({
				app: appName,
				key: params.key,
				modifiers: params.modifiers,
			}, repeat);
			const keySequence = [...(params.modifiers ?? []), params.key].join("+");
			const evidence = await this.captureEvidenceImage({
				appName,
				captureMode: params.captureMode,
				windowTitle: windowSelection?.title,
				windowSelector: windowSelection,
			});
			return buildGuiResult({
				text: repeat === 1
					? `Pressed key ${keySequence} via ${action.actionKind}.`
					: `Pressed key ${keySequence} ${repeat} times via ${action.actionKind}.`,
				status: "action_sent",
				summary: "GUI keypress was sent.",
				details: {
					action_kind: action.actionKind,
					...evidence.details,
					repeat,
					grounding_method: "visual",
					confidence: 1,
					app: appName,
				},
			image: evidence.image,
		});
	}

	async screenshot(params: GuiScreenshotParams = {}): Promise<GuiActionResult> {
		if (!isGuiPlatformSupported()) {
			return unsupportedResult(GUI_UNSUPPORTED_MESSAGE);
		}

		const appName = normalizeOptionalString(params.app);
		const windowSelection = resolveWindowSelection({
			windowTitle: params.windowTitle,
			windowSelector: params.windowSelector,
		});
		const captureMode = params.captureMode ?? (!appName && !params.target?.trim() ? "display" : undefined);
		const artifact = await captureScreenshotArtifact({
			appName,
			captureMode,
			windowTitle: windowSelection?.title,
			windowSelector: windowSelection,
			includeCursor: !params.target?.trim(),
		});
		try {
			const image = screenshotArtifactToImage(artifact);
			let grounded: GroundedGuiTarget | undefined;
			if (params.target?.trim()) {
					grounded = await this.groundTarget({
						artifact,
						target: params.target,
						groundingMode: params.groundingMode,
						locationHint: params.locationHint,
						scope: params.scope,
						app: appName,
						action: "screenshot",
					});
				if (!grounded) {
					return buildGuiResult({
						text: `Could not visually ground a screenshot focus target matching "${params.target}".`,
						status: "not_found",
						summary: "No confident visual GUI target was found.",
						details: {
							error: "No confident visual GUI target was found.",
							...buildCaptureDetails(artifact.metadata),
							grounding_method: "grounding",
							confidence: 0,
							app: appName,
						},
						image,
					});
				}
			}
			return buildGuiResult({
				text: params.target?.trim()
					? `Captured a GUI screenshot while visually grounding "${params.target}".`
					: appName
						? `Captured a GUI screenshot for ${appName}.`
						: "Captured a GUI screenshot of the current desktop state.",
				resolution: grounded?.resolution,
				status: "observed",
				summary: "GUI screenshot captured.",
				details: {
					...buildCaptureDetails(artifact.metadata),
					...(grounded ? this.groundingDetails(grounded) : { grounding_method: "screenshot", confidence: 1 }),
					app: appName,
					mimeType: image.mimeType,
					filename: image.filename,
				},
				image,
			});
		} finally {
			await artifact.cleanup();
		}
	}

	async wait(params: GuiWaitParams): Promise<GuiActionResult> {
		if (!isGuiPlatformSupported()) {
			return unsupportedResult(GUI_UNSUPPORTED_MESSAGE);
		}

		const state = params.state ?? "appear";
		const timeoutMs = params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
		const appName = normalizeOptionalString(params.app);
		const windowSelection = resolveWindowSelection({
			windowTitle: params.windowTitle,
			windowSelector: params.windowSelector,
		});
		const probe = await this.probeForTarget({
			appName,
			target: params.target,
			groundingMode: params.groundingMode,
			locationHint: params.locationHint,
			scope: params.scope,
			captureMode: params.captureMode,
			windowTitle: windowSelection?.title,
			windowSelector: windowSelection,
			state,
			timeoutMs,
			intervalMs: params.intervalMs,
		});
		if (probe.matched) {
				return buildGuiResult({
					text: state === "appear"
						? `GUI target "${params.target}" appeared after ${probe.attempts} visual checks.`
						: `GUI target "${params.target}" disappeared after ${probe.attempts} visual checks.`,
					resolution: probe.grounded?.resolution,
					status: "condition_met",
					summary: state === "appear" ? "Target appeared." : "Target disappeared.",
						details: {
							attempts: probe.attempts,
							wait_confirmations_required: WAIT_CONFIRMATION_COUNT,
							...(probe.capture ? buildCaptureDetails(probe.capture) : {}),
							...(probe.grounded ? this.groundingDetails(probe.grounded) : { grounding_method: "grounding", confidence: 0 }),
							app: appName,
					},
					image: probe.image,
				});
		}
		return buildGuiResult({
			text: `Timed out waiting for "${params.target}" to ${state === "appear" ? "appear" : "disappear"}.`,
			resolution: probe.grounded?.resolution,
			status: "timeout",
			summary: "GUI wait timed out.",
				details: {
					attempts: probe.attempts,
						wait_confirmations_required: WAIT_CONFIRMATION_COUNT,
					...(probe.capture ? buildCaptureDetails(probe.capture) : {}),
					...(probe.grounded ? this.groundingDetails(probe.grounded) : { grounding_method: "grounding", confidence: 0 }),
					app: appName,
			},
			image: probe.image,
		});
	}
}
