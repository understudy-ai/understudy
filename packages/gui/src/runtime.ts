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
	GuiGroundingActionIntent,
	GuiGroundingCoordinateSpace,
	GuiGroundingMode,
	GuiDragParams,
	GuiGroundingProvider,
	GuiGroundingResult,
	GuiKeyParams,
	GuiMoveParams,
	GuiObservation,
	GuiObserveParams,
	GuiResolution,
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
const DEFAULT_DRAG_STEPS = 24;
const DEFAULT_HOVER_SETTLE_MS = 200;
const DEFAULT_POST_ACTION_CAPTURE_SETTLE_MS = 3_000;
const DEFAULT_CLICK_AND_HOLD_MS = 650;
const DEFAULT_TYPE_FOCUS_SETTLE_MS = 180;
const DEFAULT_SCROLL_AMOUNT = 5;
const DEFAULT_NATIVE_TYPE_CLEAR_REPEAT = 48;
const DEFAULT_SYSTEM_EVENTS_PASTE_PRE_DELAY_MS = 220;
const DEFAULT_SYSTEM_EVENTS_PASTE_POST_DELAY_MS = 650;
const DEFAULT_SYSTEM_EVENTS_KEYSTROKE_CHAR_DELAY_MS = 55;
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
	home: 115,
	pageup: 116,
	pagedown: 121,
	end: 119,
	up: 126,
	arrowup: 126,
	down: 125,
	arrowdown: 125,
	left: 123,
	arrowleft: 123,
	right: 124,
	arrowright: 124,
	space: 49,
	spacebar: 49,
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

function resolveClickActionIntent(params: GuiClickParams): PointActionIntent {
	if (params.button === "right") return "right_click";
	if (params.clicks === 2) return "double_click";
	if (params.button === "none") return "hover";
	if (params.holdMs) return "click_and_hold";
	return "click";
}

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

interface GuiScriptWindowSelection {
	title?: string;
	titleContains?: string;
	index?: number;
	bounds?: GuiRect;
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

type GuiTypeInputSource = "value" | "secret_env" | "secret_command_env";

function stripSingleTrailingNewline(value: string): string {
	return value.replace(/\r?\n$/, "");
}

async function resolveGuiTypeInput(params: GuiTypeParams): Promise<{
	text: string;
	source: GuiTypeInputSource;
}> {
	const hasLiteralValue = typeof params.value === "string";
	const secretEnvVar = normalizeOptionalString(params.secretEnvVar);
	const secretCommandEnvVar = normalizeOptionalString(params.secretCommandEnvVar);
	const configuredSourceCount = [
		hasLiteralValue,
		Boolean(secretEnvVar),
		Boolean(secretCommandEnvVar),
	].filter(Boolean).length;
	if (configuredSourceCount !== 1) {
		throw new GuiRuntimeError(
			"GUI type requires exactly one input source: `value`, `secretEnvVar`, or `secretCommandEnvVar`.",
		);
	}
	if (hasLiteralValue) {
		return {
			text: params.value ?? "",
			source: "value",
		};
	}
	if (secretEnvVar) {
		const text = process.env[secretEnvVar];
		if (typeof text !== "string" || text.length === 0) {
			throw new GuiRuntimeError(
				`GUI secret env var "${secretEnvVar}" is missing or empty.`,
			);
		}
		return {
			text,
			source: "secret_env",
		};
	}
	if (!secretCommandEnvVar) {
		throw new GuiRuntimeError("GUI type input source could not be resolved.");
	}
	const command = process.env[secretCommandEnvVar];
	if (!command?.trim()) {
		throw new GuiRuntimeError(
			`GUI secret command env var "${secretCommandEnvVar}" is missing or empty.`,
		);
	}
	try {
		const { stdout } = await execFileAsync("zsh", ["-lc", command], {
			env: process.env,
			timeout: DEFAULT_TIMEOUT_MS,
			maxBuffer: 8 * 1024 * 1024,
			encoding: "utf-8",
		});
		const text = stripSingleTrailingNewline(stdout);
		if (!text.length) {
			throw new GuiRuntimeError(
				`GUI secret command env var "${secretCommandEnvVar}" produced empty output.`,
			);
		}
		return {
			text,
			source: "secret_command_env",
		};
	} catch (error) {
		if (error instanceof GuiRuntimeError) {
			throw error;
		}
		throw new GuiRuntimeError(
			`Failed to resolve GUI text from secret command env var "${secretCommandEnvVar}": ${error instanceof Error ? error.message : String(error)}`,
		);
	}
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
	const floored =
		typeof value.index === "number" && Number.isFinite(value.index)
			? Math.floor(value.index)
			: -1;
	const index = floored > 0 ? floored : undefined;
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

function buildWindowSelectionEnv(
	windowSelection: Pick<GuiScriptWindowSelection, "title" | "titleContains" | "index"> | undefined,
): Record<string, string | undefined> {
	return {
		UNDERSTUDY_GUI_WINDOW_TITLE: windowSelection?.title,
		UNDERSTUDY_GUI_WINDOW_TITLE_CONTAINS: windowSelection?.titleContains,
		UNDERSTUDY_GUI_WINDOW_INDEX: windowSelection?.index ? String(windowSelection.index) : undefined,
	};
}

function buildWindowBoundsEnv(bounds: GuiRect | undefined): Record<string, string | undefined> {
	return {
		UNDERSTUDY_GUI_WINDOW_BOUNDS_X: bounds ? String(bounds.x) : undefined,
		UNDERSTUDY_GUI_WINDOW_BOUNDS_Y: bounds ? String(bounds.y) : undefined,
		UNDERSTUDY_GUI_WINDOW_BOUNDS_WIDTH: bounds ? String(bounds.width) : undefined,
		UNDERSTUDY_GUI_WINDOW_BOUNDS_HEIGHT: bounds ? String(bounds.height) : undefined,
	};
}

function buildScriptWindowSelectionEnv(windowSelection: GuiScriptWindowSelection | undefined): Record<string, string | undefined> {
	return {
		...buildWindowSelectionEnv(windowSelection),
		...buildWindowBoundsEnv(windowSelection?.bounds),
	};
}

function normalizeHotkeyKeyName(key: string): string {
	return key.trim().toLowerCase().replace(/[\s_-]+/g, "");
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

function defaultGroundingModeForAction(
	action: GuiGroundingActionIntent | undefined,
): GuiGroundingMode | undefined {
	switch (action) {
		case "type":
		case "drag_source":
		case "drag_destination":
			return "complex";
		// "wait" intentionally omitted — its validation round is always suppressed
		// in the provider, so requesting "complex" mode would be misleading.
		default:
			return undefined;
	}
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
	args: string[] = [],
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
	try {
		const result = await execFileAsync("osascript", [
			"-l",
			"AppleScript",
			"-e",
			script,
			...(args.length > 0 ? ["--", ...args] : []),
		], {
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

const WINDOW_SELECTION_SCRIPT_HELPERS = String.raw`
on absoluteDifference(lhsValue, rhsValue)
	if lhsValue >= rhsValue then return lhsValue - rhsValue
	return rhsValue - lhsValue
end absoluteDifference

on textContains(haystack, needle)
	if needle is "" then return true
	ignoring case
			return (offset of needle in haystack) is not 0
	end ignoring
end textContains

on windowMatchesBounds(candidateWindow, boundsXText, boundsYText, boundsWidthText, boundsHeightText)
	if boundsXText is "" or boundsYText is "" or boundsWidthText is "" or boundsHeightText is "" then return true
	try
		set {windowX, windowY} to position of candidateWindow
		set {windowWidth, windowHeight} to size of candidateWindow
	on error
		return false
	end try
	set tolerance to 3
	return (my absoluteDifference(windowX as integer, boundsXText as integer) is less than or equal to tolerance) and (my absoluteDifference(windowY as integer, boundsYText as integer) is less than or equal to tolerance) and (my absoluteDifference(windowWidth as integer, boundsWidthText as integer) is less than or equal to tolerance) and (my absoluteDifference(windowHeight as integer, boundsHeightText as integer) is less than or equal to tolerance)
end windowMatchesBounds

on matchingWindows(targetProc, exactTitle, titleContains, boundsXText, boundsYText, boundsWidthText, boundsHeightText)
	set matches to {}
	repeat with candidateWindow in windows of targetProc
		set windowTitle to ""
		try
			set windowTitle to name of candidateWindow as text
		end try
		set exactMatch to true
		if exactTitle is not "" then
			ignoring case
				set exactMatch to windowTitle is exactTitle
			end ignoring
		end if
		set containsMatch to my textContains(windowTitle, titleContains)
		set boundsMatch to my windowMatchesBounds(candidateWindow, boundsXText, boundsYText, boundsWidthText, boundsHeightText)
		if exactMatch and containsMatch and boundsMatch then set end of matches to candidateWindow
	end repeat
	return matches
end matchingWindows

on focusRequestedWindow(targetProc, exactTitle, titleContains, windowIndexText, boundsXText, boundsYText, boundsWidthText, boundsHeightText)
	if exactTitle is "" and titleContains is "" and windowIndexText is "" and boundsXText is "" and boundsYText is "" and boundsWidthText is "" and boundsHeightText is "" then return
	set matches to my matchingWindows(targetProc, exactTitle, titleContains, boundsXText, boundsYText, boundsWidthText, boundsHeightText)
	if (count of matches) is 0 then error "Window not found for the requested selection."
	set targetWindow to item 1 of matches
	if windowIndexText is not "" then
		set requestedIndex to windowIndexText as integer
		if requestedIndex < 1 or requestedIndex > (count of matches) then error "Requested window index is out of range."
		set targetWindow to item requestedIndex of matches
	end if
	tell application "System Events"
		try
			tell targetWindow to perform action "AXRaise"
		end try
		try
			tell targetWindow to set value of attribute "AXMain" to true
		end try
		try
			tell targetWindow to set value of attribute "AXFocused" to true
		end try
	end tell
	delay 0.1
end focusRequestedWindow
`;

const TYPE_SCRIPT = String.raw`
${WINDOW_SELECTION_SCRIPT_HELPERS}

on normalizedDelaySeconds(delayMsText, fallbackSeconds)
	if delayMsText is "" then return fallbackSeconds
	try
		set candidateMs to delayMsText as integer
		if candidateMs < 0 then return fallbackSeconds
		return candidateMs / 1000
	on error
		return fallbackSeconds
	end try
end normalizedDelaySeconds

on normalizedRepeatCount(repeatText, fallbackCount)
	if repeatText is "" then return fallbackCount
	try
		set candidateCount to repeatText as integer
		if candidateCount < 0 then return fallbackCount
		return candidateCount
	on error
		return fallbackCount
	end try
end normalizedRepeatCount

on pasteText(rawText, preDelaySeconds, postDelaySeconds)
	set previousClipboard to missing value
	set hadClipboard to false
	try
		set previousClipboard to the clipboard
		set hadClipboard to true
	end try

	set the clipboard to rawText
	delay preDelaySeconds
	tell application "System Events"
		keystroke "v" using command down
	end tell
	delay postDelaySeconds

	if hadClipboard then
		try
			set the clipboard to previousClipboard
		end try
	end if
end pasteText

on clearWithBackspace(repeatCount)
	if repeatCount <= 0 then return
	tell application "System Events"
		repeat repeatCount times
			key code 51
			delay 0.02
		end repeat
	end tell
end clearWithBackspace

on enterText(rawText, entryStrategy, preDelaySeconds, postDelaySeconds)
	if entryStrategy is "keystroke" then
		tell application "System Events"
			keystroke rawText
		end tell
		delay postDelaySeconds
		return
	end if
	if entryStrategy is "keystroke_chars" then
		set keyDelayMsText to system attribute "UNDERSTUDY_GUI_KEYSTROKE_CHAR_DELAY_MS"
		set keyDelaySeconds to my normalizedDelaySeconds(keyDelayMsText, 0.055)
		tell application "System Events"
			repeat with currentCharacter in characters of rawText
				set typedCharacter to contents of currentCharacter
				if typedCharacter is return or typedCharacter is linefeed then
					key code 36
				else
					keystroke typedCharacter
				end if
				delay keyDelaySeconds
			end repeat
		end tell
		delay postDelaySeconds
		return
	end if
	my pasteText(rawText, preDelaySeconds, postDelaySeconds)
end enterText

on run argv
	set requestedApp to system attribute "UNDERSTUDY_GUI_APP"
	set requestedWindowTitle to system attribute "UNDERSTUDY_GUI_WINDOW_TITLE"
	set requestedWindowTitleContains to system attribute "UNDERSTUDY_GUI_WINDOW_TITLE_CONTAINS"
	set requestedWindowIndex to system attribute "UNDERSTUDY_GUI_WINDOW_INDEX"
	set requestedWindowBoundsX to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_X"
	set requestedWindowBoundsY to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_Y"
	set requestedWindowBoundsWidth to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_WIDTH"
	set requestedWindowBoundsHeight to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_HEIGHT"
	set replaceText to system attribute "UNDERSTUDY_GUI_REPLACE"
	set submitText to system attribute "UNDERSTUDY_GUI_SUBMIT"
	set inlineInputText to system attribute "UNDERSTUDY_GUI_TEXT"
	set systemEventsTypeStrategy to system attribute "UNDERSTUDY_GUI_SYSTEM_EVENTS_TYPE_STRATEGY"
	set clearRepeatText to system attribute "UNDERSTUDY_GUI_CLEAR_REPEAT"
	set pastePreDelayMsText to system attribute "UNDERSTUDY_GUI_PASTE_PRE_DELAY_MS"
	set pastePostDelayMsText to system attribute "UNDERSTUDY_GUI_PASTE_POST_DELAY_MS"
	set inputText to inlineInputText
	if inputText is "" and (count of argv) > 0 then set inputText to item 1 of argv
	set preDelaySeconds to my normalizedDelaySeconds(pastePreDelayMsText, 0.15)
	set postDelaySeconds to my normalizedDelaySeconds(pastePostDelayMsText, 0.25)
	set replaceRepeatCount to my normalizedRepeatCount(clearRepeatText, 48)
	tell application "System Events"
		if requestedApp is not "" then
			if not (exists application process requestedApp) then error "Application process not found: " & requestedApp
		set targetProc to application process requestedApp
		set frontmost of targetProc to true
		delay 0.1
	else
		set targetProc to first application process whose frontmost is true
	end if
	my focusRequestedWindow(targetProc, requestedWindowTitle, requestedWindowTitleContains, requestedWindowIndex, requestedWindowBoundsX, requestedWindowBoundsY, requestedWindowBoundsWidth, requestedWindowBoundsHeight)

	if replaceText is "1" then
		if systemEventsTypeStrategy is "keystroke" or clearRepeatText is not "" then
			my clearWithBackspace(replaceRepeatCount)
		else
			keystroke "a" using command down
		end if
	end if
		my enterText(inputText, systemEventsTypeStrategy, preDelaySeconds, postDelaySeconds)
		if submitText is "1" then key code 36
		return "typed"
	end tell
end run
`;

const HOTKEY_SCRIPT = String.raw`
${WINDOW_SELECTION_SCRIPT_HELPERS}

on buildModifierList(rawText)
	set modifierList to {}
	if rawText contains "command" then copy command down to end of modifierList
	if rawText contains "shift" then copy shift down to end of modifierList
	if rawText contains "option" then copy option down to end of modifierList
	if rawText contains "control" then copy control down to end of modifierList
	return modifierList
end buildModifierList

set requestedApp to system attribute "UNDERSTUDY_GUI_APP"
set requestedWindowTitle to system attribute "UNDERSTUDY_GUI_WINDOW_TITLE"
set requestedWindowTitleContains to system attribute "UNDERSTUDY_GUI_WINDOW_TITLE_CONTAINS"
set requestedWindowIndex to system attribute "UNDERSTUDY_GUI_WINDOW_INDEX"
set requestedWindowBoundsX to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_X"
set requestedWindowBoundsY to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_Y"
set requestedWindowBoundsWidth to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_WIDTH"
set requestedWindowBoundsHeight to system attribute "UNDERSTUDY_GUI_WINDOW_BOUNDS_HEIGHT"
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
	else
		set targetProc to first application process whose frontmost is true
	end if
	my focusRequestedWindow(targetProc, requestedWindowTitle, requestedWindowTitleContains, requestedWindowIndex, requestedWindowBoundsX, requestedWindowBoundsY, requestedWindowBoundsWidth, requestedWindowBoundsHeight)

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
		windowSelector?: GuiWindowSelector;
	} = {},
): Promise<GuiCaptureContext> {
	const windowSelection = resolveWindowSelection({
		windowSelector: options.windowSelector,
	});
	const raw = await runNativeHelper({
		command: "capture-context",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			...buildWindowSelectionEnv(windowSelection),
		},
		failureMessage:
			"macOS native GUI capture helper failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while inspecting the current desktop state.",
	});
	return parseCaptureContext(raw);
}

function createRequestedWindowNotFoundError(
	appName: string | undefined,
	windowSelection: GuiWindowSelector | undefined,
): GuiRuntimeError {
	const requestedWindow = describeWindowSelection(windowSelection) ?? "requested window";
	const appLabel = appName?.trim() ? ` for ${appName.trim()}` : "";
	return new GuiRuntimeError(
		`Could not find ${requestedWindow}${appLabel}. Check the visible window title or use captureMode "display" if the target spans multiple windows.`,
	);
}

async function resolveScriptWindowSelection(params: {
	appName?: string;
	windowTitle?: string;
	windowSelector?: GuiWindowSelector;
}): Promise<GuiScriptWindowSelection | undefined> {
	const windowSelection = resolveWindowSelection({
		windowTitle: params.windowTitle,
		windowSelector: params.windowSelector,
	});
	if (!windowSelection) {
		return undefined;
	}
	const context = await resolveCaptureContext(params.appName, {
		activateApp: false,
		windowSelector: windowSelection,
	});
	if (!context.windowBounds) {
		throw createRequestedWindowNotFoundError(params.appName, windowSelection);
	}
	const resolvedTitle = normalizeOptionalString(context.windowTitle);
	return {
		title: resolvedTitle ?? windowSelection.title,
		titleContains: resolvedTitle ? undefined : windowSelection.titleContains,
		bounds: context.windowBounds,
	};
}

function resolveCaptureMode(params: {
	context: GuiCaptureContext;
	captureMode?: GuiCaptureMode;
	includeCursor?: boolean;
}): {
	mode: "display" | "window";
	captureRect: GuiRect;
	screencaptureArgs: string[];
} {
	const cursorArgs = params.includeCursor ? ["-C"] : [];
	if (params.captureMode !== "display" && params.context.windowBounds) {
		const captureRect = normalizeRect(params.context.windowBounds);
		return {
			mode: "window",
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

async function performType(params: GuiTypeParams, text: string): Promise<GuiNativeActionResult> {
	const windowSelection = await resolveScriptWindowSelection({
		appName: params.app,
		windowTitle: params.windowTitle,
		windowSelector: params.windowSelector,
	});
	const actionKind = await runAppleScript(TYPE_SCRIPT, {
		UNDERSTUDY_GUI_APP: params.app?.trim(),
		...buildScriptWindowSelectionEnv(windowSelection),
		UNDERSTUDY_GUI_REPLACE: params.replace === false ? "0" : "1",
		UNDERSTUDY_GUI_SUBMIT: params.submit ? "1" : "0",
	}, [text]);
	return { actionKind };
}

async function performNativeType(params: GuiTypeParams, text: string): Promise<GuiNativeActionResult> {
	const typeStrategy = params.typeStrategy;
	const needsClearRepeat = typeStrategy && params.replace !== false;
	const actionKind = await runNativeHelper({
		command: "event",
		env: {
			UNDERSTUDY_GUI_APP: params.app?.trim(),
			UNDERSTUDY_GUI_EVENT_MODE: "type_text",
			UNDERSTUDY_GUI_TEXT: text,
			UNDERSTUDY_GUI_REPLACE: params.replace === false ? "0" : "1",
			UNDERSTUDY_GUI_SUBMIT: params.submit ? "1" : "0",
			UNDERSTUDY_GUI_TYPE_STRATEGY: typeStrategy,
			UNDERSTUDY_GUI_CLEAR_REPEAT: needsClearRepeat
				? String(DEFAULT_NATIVE_TYPE_CLEAR_REPEAT)
				: undefined,
		},
		failureMessage:
			"macOS native GUI event dispatch failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while sending native input events.",
	});
	return { actionKind };
}

async function performSystemEventsType(
	params: GuiTypeParams,
	text: string,
	strategy: "system_events_paste" | "system_events_keystroke" | "system_events_keystroke_chars",
): Promise<GuiNativeActionResult> {
	const windowSelection = await resolveScriptWindowSelection({
		appName: params.app,
		windowTitle: params.windowTitle,
		windowSelector: params.windowSelector,
	});
	const actionKind = await runAppleScript(TYPE_SCRIPT, {
		UNDERSTUDY_GUI_APP: params.app?.trim(),
		...buildScriptWindowSelectionEnv(windowSelection),
		UNDERSTUDY_GUI_REPLACE: params.replace === false ? "0" : "1",
		UNDERSTUDY_GUI_SUBMIT: params.submit ? "1" : "0",
		UNDERSTUDY_GUI_TEXT: text,
		UNDERSTUDY_GUI_SYSTEM_EVENTS_TYPE_STRATEGY:
			strategy === "system_events_keystroke"
				? "keystroke"
				: strategy === "system_events_keystroke_chars"
					? "keystroke_chars"
					: "paste",
		UNDERSTUDY_GUI_CLEAR_REPEAT:
			params.replace === false ? undefined : String(DEFAULT_NATIVE_TYPE_CLEAR_REPEAT),
		UNDERSTUDY_GUI_PASTE_PRE_DELAY_MS: String(DEFAULT_SYSTEM_EVENTS_PASTE_PRE_DELAY_MS),
		UNDERSTUDY_GUI_PASTE_POST_DELAY_MS: String(DEFAULT_SYSTEM_EVENTS_PASTE_POST_DELAY_MS),
		UNDERSTUDY_GUI_KEYSTROKE_CHAR_DELAY_MS:
			strategy === "system_events_keystroke_chars"
				? String(DEFAULT_SYSTEM_EVENTS_KEYSTROKE_CHAR_DELAY_MS)
				: undefined,
	});
	return { actionKind };
}

async function performHotkey(
	params: GuiKeyParams,
	repeat: number = 1,
): Promise<GuiNativeActionResult> {
	const windowSelection = await resolveScriptWindowSelection({
		appName: params.app,
		windowTitle: params.windowTitle,
		windowSelector: params.windowSelector,
	});
	const normalizedKey = normalizeHotkeyKeyName(params.key);
	const keyCode = COMMON_KEY_CODES[normalizedKey];
	const actionKind = await runAppleScript(HOTKEY_SCRIPT, {
		UNDERSTUDY_GUI_APP: params.app?.trim(),
		...buildScriptWindowSelectionEnv(windowSelection),
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
		windowSelector: windowSelection,
	});
	if (windowSelection && params.captureMode !== "display" && !context.windowBounds) {
		throw createRequestedWindowNotFoundError(params.appName, windowSelection);
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
		let bytes: Buffer = Buffer.from(await readFile(filePath));
		let imageSize = parsePngDimensions(bytes);
		const captureRect = normalizeRect(capture.captureRect);
		const scaleX = imageSize?.width && captureRect.width > 0
			? imageSize.width / captureRect.width
			: 1;
		const scaleY = imageSize?.height && captureRect.height > 0
			? imageSize.height / captureRect.height
			: 1;
		return {
			bytes,
			filePath,
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
		await rm(tempDir, { recursive: true, force: true }).catch(() => {});
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
			grounding_display_box: result.displayBox,
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
			: defaultGroundingModeForAction(params.action);
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

		while (attempts === 0 || Date.now() < deadline) {
			attempts += 1;
			// When no explicit captureMode is specified, retry with display capture after the first
			// miss. This helps detect targets that appear outside the original window bounds (e.g.
			// popups or sheets). When the caller pinned a specific captureMode, respect it.
			const attemptCaptureMode =
				params.captureMode ??
				(attempts > 1 && params.appName ? "display" : undefined);
			const artifact = await captureScreenshotArtifact({
				appName: params.appName,
				captureMode: attemptCaptureMode,
				activateApp: params.activateApp,
				windowSelector: params.windowSelector,
			});
			try {
				lastCapture = artifact.metadata;
				lastImage = screenshotArtifactToImage(artifact);
				if (Date.now() >= deadline) {
					lastGrounded = undefined;
					break;
				}
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

			const remainingIntervalMs = deadline - Date.now();
			if (remainingIntervalMs <= 0) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remainingIntervalMs)));
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

	async observe(params: GuiObserveParams = {}): Promise<GuiActionResult> {
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
			windowSelector: windowSelection,
			includeCursor: !params.target?.trim(),
		});
		try {
			const image = params.returnImage === false ? undefined : screenshotArtifactToImage(artifact);
			const observation = createScreenshotObservation(appName, artifact.metadata.windowTitle);
			if (!params.target?.trim()) {
				return buildGuiResult({
					text: [
							appName
								? `Captured a visual GUI snapshot for ${appName}.`
								: "Captured the current desktop state for visual GUI inspection.",
							"Use the attached screenshot to inspect the scene or call vision_read for a second focused read.",
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

			const grounded = await this.resolveGuiTarget({
				artifact,
				target: params.target,
				groundingMode: params.groundingMode,
				locationHint: params.locationHint,
				scope: params.scope,
				app: appName,
				action: "observe",
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
		const intent = resolveClickActionIntent(params);

		const actionLabels: Record<PointActionIntent, {
			notFound: (desc: string) => string;
			success: (params: { targetDescription: string; actionKind: string; appName?: string }) => string;
			summary: string;
		}> = {
			click: {
				notFound: (desc) => `Could not visually resolve a clickable GUI target matching ${desc}.`,
				success: ({ targetDescription, actionKind, appName: a }) =>
					`Clicked ${targetDescription} via ${actionKind}${a ? ` in ${a}` : ""}.`,
				summary: "GUI click was sent.",
			},
			right_click: {
				notFound: (desc) => `Could not visually resolve a GUI target to right click matching ${desc}.`,
				success: ({ targetDescription, actionKind, appName: a }) =>
					`Right-clicked ${targetDescription} via ${actionKind}${a ? ` in ${a}` : ""}.`,
				summary: "GUI right click was sent.",
			},
			double_click: {
				notFound: (desc) => `Could not visually resolve a GUI target to double click matching ${desc}.`,
				success: ({ targetDescription, actionKind, appName: a }) =>
					`Double-clicked ${targetDescription} via ${actionKind}${a ? ` in ${a}` : ""}.`,
				summary: "GUI double click was sent.",
			},
			hover: {
				notFound: (desc) => `Could not visually resolve a GUI target to hover matching ${desc}.`,
				success: ({ targetDescription, actionKind, appName: a }) =>
					`Hovered ${targetDescription} via ${actionKind}${a ? ` in ${a}` : ""}.`,
				summary: "GUI hover was sent.",
			},
			click_and_hold: {
				notFound: (desc) => `Could not visually resolve a GUI target to click and hold matching ${desc}.`,
				success: ({ targetDescription, actionKind, appName: a }) =>
					`Clicked and held ${targetDescription} via ${actionKind}${a ? ` in ${a}` : ""}.`,
				summary: "GUI click and hold was sent.",
			},
		};

		const labels = actionLabels[intent];
		const settleMs = Math.max(0, Math.round(params.settleMs ?? DEFAULT_HOVER_SETTLE_MS));
		const holdMs = Math.max(100, Math.round(params.holdMs ?? DEFAULT_CLICK_AND_HOLD_MS));

		const executeForIntent = async (point: GuiPoint): Promise<GuiNativeActionResult> => {
			switch (intent) {
				case "right_click":
					return performRightClick(appName, point, { activateApp: false });
				case "double_click":
					return performDoubleClick(appName, point, { activateApp: false });
				case "hover":
					return performHover(appName, point, settleMs, { activateApp: false });
				case "click_and_hold":
					return performClickAndHold(appName, point, holdMs, { activateApp: false });
				default:
					return performPointClick(appName, point, { activateApp: false });
			}
		};

		const extraDetails: Record<string, unknown> = {};
		if (intent === "hover") extraDetails.settle_ms = settleMs;
		if (intent === "click_and_hold") extraDetails.hold_duration_ms = holdMs;

		return await this.executeGroundedPointAction({
			appName,
			target: params.target,
			scope: params.scope,
			groundingMode: params.groundingMode,
			locationHint: params.locationHint,
			captureMode: params.captureMode,
			windowTitle: params.windowTitle,
			windowSelector: params.windowSelector,
			action: intent,
			targetFallback: "the requested GUI target",
			notFoundText: labels.notFound,
			successText: labels.success,
			summary: labels.summary,
			execute: executeForIntent,
			extraDetails: Object.keys(extraDetails).length > 0 ? extraDetails : undefined,
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
				{ activateApp: true },
			);
			const evidence = await this.captureEvidenceImage({
				appName,
				captureMode: params.captureMode,
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
				activateApp: !grounded,
			});
			const direction = params.direction ?? "down";
			const evidence = await this.captureEvidenceImage({
				appName,
				captureMode: params.captureMode,
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
					...(grounded ? this.targetResolutionDetails(grounded) : { grounding_method: "targetless" }),
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
		const input = await resolveGuiTypeInput(params);
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
				activateApp: true,
			});
			await new Promise((resolve) => setTimeout(resolve, DEFAULT_TYPE_FOCUS_SETTLE_MS));
		}

		let action: GuiNativeActionResult;
		if (
			params.typeStrategy === "system_events_paste" ||
			params.typeStrategy === "system_events_keystroke" ||
			params.typeStrategy === "system_events_keystroke_chars"
		) {
			action = await performSystemEventsType(
				{ ...params, app: appName },
				input.text,
				params.typeStrategy,
			);
		} else if (params.typeStrategy) {
			action = await performNativeType({ ...params, app: appName }, input.text);
		} else {
			try {
				action = await performType({ ...params, app: appName }, input.text);
			} catch (error) {
				const canFallbackToNativeType = !!grounded ||
					(!params.windowTitle && !params.windowSelector);
				if (!(error instanceof GuiRuntimeError) || !canFallbackToNativeType) {
					throw error;
				}
				action = await performNativeType({ ...params, app: appName }, input.text);
			}
		}
			const evidence = await this.captureEvidenceImage({
				appName,
				captureMode: params.captureMode,
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
					...(grounded ? this.targetResolutionDetails(grounded) : { grounding_method: "targetless" }),
					...evidence.details,
					app: appName,
					input_source: input.source,
					executed_point: grounded?.point,
					...(grounded ? { pre_action_capture: buildCaptureDetails(grounded.artifact) } : {}),
				},
				image: evidence.image,
			});
	}

	async key(params: GuiKeyParams): Promise<GuiActionResult> {
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
		const keySequence = [...(params.modifiers ?? []), params.key].join("+");
		const evidence = await this.captureEvidenceImage({
			appName,
			captureMode: params.captureMode,
			windowSelector: windowSelection,
		});
		return buildGuiResult({
			text: repeat === 1
				? `Pressed key ${keySequence} via ${action.actionKind}.`
				: `Pressed key ${keySequence} ${repeat} times via ${action.actionKind}.`,
			status: "action_sent",
			summary: "GUI key was sent.",
			details: {
				action_kind: action.actionKind,
				...evidence.details,
				repeat,
				grounding_method: "targetless",
				confidence: 1,
				app: appName,
			},
			image: evidence.image,
		});
	}

	async move(params: GuiMoveParams): Promise<GuiActionResult> {
		if (!isGuiPlatformSupported()) {
			return unsupportedResult(GUI_UNSUPPORTED_MESSAGE);
		}

		const appName = normalizeOptionalString(params.app);
		const point = { x: Math.round(params.x), y: Math.round(params.y) };
		await performHover(appName, point, 0, { activateApp: Boolean(appName) });
		const reportedActionKind = "cg_move";
		return buildGuiResult({
			text: `Moved cursor to (${point.x}, ${point.y}) via ${reportedActionKind}.`,
			status: "action_sent",
			summary: "GUI cursor move was sent.",
			details: {
				action_kind: reportedActionKind,
				grounding_method: "absolute_coordinates",
				confidence: 1,
				app: appName,
				executed_point: point,
			},
		});
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
