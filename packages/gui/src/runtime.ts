import { asBoolean, asNumber, asRecord, asString } from "@understudy/core";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileAsync } from "./exec-utils.js";
import { resolveNativeGuiHelperBinary } from "./native-helper.js";
import {
	resolveGuiPlatformBackend,
	type GuiPlatformInputDependencies,
} from "./platform.js";
import { normalizeGuiGroundingMode } from "./types.js";
import {
	FilePhysicalResourceLock,
	type PhysicalResourceLock,
	type PhysicalResourceLockHolder,
} from "./physical-resource-lock.js";
import {
	GuiActionSession,
	type GuiEmergencyStopHandle,
	type GuiEmergencyStopProvider,
} from "./gui-action-session.js";
import {
	resolveGuiRuntimeCapabilities,
	type GuiToolCapability,
	type GuiRuntimeCapabilitySnapshot,
} from "./capabilities.js";
import type { GuiToolName } from "./tool-names.js";
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
	hostSelfExcludeApplied?: boolean;
	hostFrontmostExcluded?: boolean;
	hostFrontmostAppName?: string;
	hostFrontmostBundleId?: string;
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

function typeTouchesClipboard(params: GuiTypeParams): boolean {
	return (
		!params.typeStrategy ||
		params.typeStrategy === "clipboard_paste" ||
		params.typeStrategy === "system_events_paste"
	);
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
	captureMethod?: string;
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
	hostSelfExcludeApplied?: boolean;
	hostFrontmostExcluded?: boolean;
	hostSelfExcludeAdjusted?: boolean;
	hostFrontmostAppName?: string;
	hostFrontmostBundleId?: string;
	hostSelfExcludeRedactionCount?: number;
}

interface GuiHostWindowExclusions {
	bundleIds: string[];
	ownerNames: string[];
}

export class GuiRuntimeError extends Error {
	override name = "GuiRuntimeError";
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
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

function normalizeIdentity(value: string | undefined): string | undefined {
	return normalizeOptionalString(value)?.toLowerCase();
}

function parseDelimitedValues(value: string | undefined): string[] {
	return (value ?? "")
		.split(/[,\n]/u)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function dedupeCaseInsensitive(values: string[]): string[] {
	const seen = new Set<string>();
	const deduped: string[] = [];
	for (const value of values) {
		const normalized = normalizeIdentity(value);
		if (!normalized || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		deduped.push(value);
	}
	return deduped;
}

function titleCaseToken(value: string): string {
	if (!value) {
		return value;
	}
	return value[0]!.toUpperCase() + value.slice(1);
}

function deriveOwnerNameHintsFromBundleId(bundleId: string | undefined): string[] {
	if (!bundleId) {
		return [];
	}
	const tail = bundleId.split(".").pop()?.replace(/\.app$/iu, "");
	if (!tail) {
		return [];
	}
	const normalized = tail
		.replace(/[-_.]+/gu, " ")
		.replace(/\s+/gu, " ")
		.trim();
	if (!normalized) {
		return [];
	}
	return dedupeCaseInsensitive([
		normalized,
		normalized
			.split(" ")
			.map((part) => titleCaseToken(part))
			.join(" "),
	]);
}

const KNOWN_HOST_OWNER_NAME_HINTS: Record<string, string[]> = {
	"com.apple.Terminal": ["Terminal"],
	"com.googlecode.iterm2": ["iTerm2"],
	"com.openai.codex": ["Codex", "Codex Desktop"],
	"dev.warp.Warp-Stable": ["Warp"],
};

function detectHostWindowExclusions(
	platform: NodeJS.Platform = process.platform,
): GuiHostWindowExclusions {
	if (platform !== "darwin" || process.env.UNDERSTUDY_GUI_DISABLE_HOST_SELF_EXCLUDE === "1") {
		return { bundleIds: [], ownerNames: [] };
	}
	const hostBundleId = normalizeOptionalString(process.env.__CFBundleIdentifier);
	const configuredBundleIds = parseDelimitedValues(process.env.UNDERSTUDY_GUI_EXCLUDED_BUNDLE_IDS);
	const configuredOwnerNames = parseDelimitedValues(process.env.UNDERSTUDY_GUI_EXCLUDED_OWNER_NAMES);
	const ownerNameHints = dedupeCaseInsensitive([
		...configuredOwnerNames,
		...(hostBundleId ? (KNOWN_HOST_OWNER_NAME_HINTS[hostBundleId] ?? []) : []),
		...deriveOwnerNameHintsFromBundleId(hostBundleId),
		...parseDelimitedValues(process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE),
		...parseDelimitedValues(process.env.TERM_PROGRAM),
	]);
	const bundleIds = dedupeCaseInsensitive([
		...configuredBundleIds,
		...(hostBundleId ? [hostBundleId] : []),
	]);
	return {
		bundleIds,
		ownerNames: ownerNameHints,
	};
}

function requestedAppTargetsHost(appName: string | undefined, exclusions: GuiHostWindowExclusions): boolean {
	const normalizedApp = normalizeIdentity(appName);
	if (!normalizedApp) {
		return false;
	}
	return (
		exclusions.bundleIds.some((candidate) => normalizeIdentity(candidate) === normalizedApp) ||
		exclusions.ownerNames.some((candidate) => normalizeIdentity(candidate) === normalizedApp)
	);
}

function buildHostWindowExclusionEnv(params: {
	appName?: string;
	platform?: NodeJS.Platform;
}): Record<string, string | undefined> {
	const exclusions = detectHostWindowExclusions(params.platform);
	if (
		(exclusions.bundleIds.length === 0 && exclusions.ownerNames.length === 0) ||
		requestedAppTargetsHost(params.appName, exclusions)
	) {
		return {};
	}
	return {
		UNDERSTUDY_GUI_AUTO_EXCLUDED_BUNDLE_IDS:
			exclusions.bundleIds.length > 0 ? exclusions.bundleIds.join(",") : undefined,
		UNDERSTUDY_GUI_AUTO_EXCLUDED_OWNER_NAMES:
			exclusions.ownerNames.length > 0 ? exclusions.ownerNames.join(",") : undefined,
	};
}

async function resolveHostExcludedImplicitAppName(params: {
	appName?: string;
	windowSelector?: GuiWindowSelector;
	platform?: NodeJS.Platform;
	signal?: AbortSignal;
}): Promise<string | undefined> {
	const explicitAppName = normalizeOptionalString(params.appName);
	if (explicitAppName || params.platform === "win32") {
		return explicitAppName;
	}
	const context = await resolveCaptureContext(undefined, {
		activateApp: false,
		windowSelector: params.windowSelector,
		platform: params.platform,
		signal: params.signal,
	});
	return context.hostSelfExcludeApplied && context.hostFrontmostExcluded
		? normalizeOptionalString(context.appName)
		: explicitAppName;
}

type GuiTypeInputSource = "value" | "secret_env" | "secret_command_env";

function stripSingleTrailingNewline(value: string): string {
	return value.replace(/\r?\n$/, "");
}

function resolveGuiSecretCommandShell(
	platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
	if (platform === "win32") {
		return {
			command: process.env.ComSpec?.trim() || "cmd.exe",
			args: ["/d", "/s", "/c"],
		};
	}
	return {
		command: process.env.SHELL?.trim() || "zsh",
		args: ["-lc"],
	};
}

async function resolveGuiTypeInput(params: GuiTypeParams, signal?: AbortSignal): Promise<{
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
		const shell = resolveGuiSecretCommandShell();
		const { stdout } = await execFileAsync(shell.command, [...shell.args, command], {
			env: process.env,
			timeout: DEFAULT_TIMEOUT_MS,
			signal,
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
		if (isAbortError(error)) {
			throw error;
		}
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
	windowSelection: Pick<GuiWindowSelector, "title" | "titleContains" | "index"> | undefined,
): Record<string, string | undefined> {
	return {
		UNDERSTUDY_GUI_WINDOW_TITLE: windowSelection?.title,
		UNDERSTUDY_GUI_WINDOW_TITLE_CONTAINS: windowSelection?.titleContains,
		UNDERSTUDY_GUI_WINDOW_INDEX: windowSelection?.index ? String(windowSelection.index) : undefined,
	};
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

function rectCenterPoint(rect: GuiRect): GuiPoint {
	return {
		x: Math.round(rect.x + (rect.width / 2)),
		y: Math.round(rect.y + (rect.height / 2)),
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
		hostSelfExcludeApplied: parsed.hostSelfExcludeApplied === true,
		hostFrontmostExcluded: parsed.hostFrontmostExcluded === true,
		hostFrontmostAppName:
			typeof parsed.hostFrontmostAppName === "string" ? parsed.hostFrontmostAppName : undefined,
		hostFrontmostBundleId:
			typeof parsed.hostFrontmostBundleId === "string" ? parsed.hostFrontmostBundleId : undefined,
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
		capture_method: metadata.captureMethod ?? "screencapture",
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
			capture_host_self_exclude_applied: metadata.hostSelfExcludeApplied,
			capture_host_frontmost_excluded: metadata.hostFrontmostExcluded,
			capture_host_self_exclude_adjusted: metadata.hostSelfExcludeAdjusted,
			capture_host_frontmost_app: metadata.hostFrontmostAppName,
			capture_host_frontmost_bundle_id: metadata.hostFrontmostBundleId,
			capture_host_self_exclude_redaction_count: metadata.hostSelfExcludeRedactionCount,
		};
}

function shouldAdjustImplicitDisplayCaptureForHostSelfExclude(params: {
	context: GuiCaptureContext;
	preferDisplayCapture?: boolean;
	explicitCaptureMode?: GuiCaptureMode;
}): boolean {
	return (
		params.preferDisplayCapture === true &&
		params.explicitCaptureMode === undefined &&
		params.context.hostSelfExcludeApplied === true &&
		params.context.hostFrontmostExcluded === true &&
		Boolean(params.context.windowBounds)
	);
}

async function redactHostWindowsFromDisplayCapture(params: {
	appName?: string;
	filePath: string;
	captureRect: GuiRect;
	platform?: NodeJS.Platform;
	signal?: AbortSignal;
}): Promise<number> {
	if (params.platform !== undefined && params.platform !== "darwin") {
		return 0;
	}
	const raw = await runNativeHelper({
		command: "redact-host-windows",
		env: {
			UNDERSTUDY_GUI_IMAGE_PATH: params.filePath,
			UNDERSTUDY_GUI_CAPTURE_X: String(params.captureRect.x),
			UNDERSTUDY_GUI_CAPTURE_Y: String(params.captureRect.y),
			UNDERSTUDY_GUI_CAPTURE_WIDTH: String(params.captureRect.width),
			UNDERSTUDY_GUI_CAPTURE_HEIGHT: String(params.captureRect.height),
			...buildHostWindowExclusionEnv({
				appName: params.appName,
				platform: params.platform,
			}),
		},
		signal: params.signal,
		timeoutMs: 5_000,
		failureMessage:
			"macOS native GUI redaction failed while masking host windows from the captured screenshot.",
		timeoutHint: "The GUI helper timed out while redacting excluded host windows from the screenshot.",
	});
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		if (typeof parsed.redactionCount === "number" && Number.isFinite(parsed.redactionCount)) {
			return Math.max(0, Math.round(parsed.redactionCount));
		}
	} catch {
		// Fall through to best-effort parsing below.
	}
	const numeric = Number(raw.trim());
	return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
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

function hasUnsupportedWindowsWindowSelection(
	windowSelection: GuiWindowSelector | undefined,
): boolean {
	return windowSelection?.index !== undefined;
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

function createScreenshotObservation(
	appName?: string,
	windowTitle?: string,
	platform: NodeJS.Platform = process.platform,
): GuiObservation {
	return {
		platform,
		method: "screenshot",
		appName,
		windowTitle,
		capturedAt: Date.now(),
	};
}

function createNativeEmergencyStopProvider(): GuiEmergencyStopProvider {
	return {
		async start(params): Promise<GuiEmergencyStopHandle | undefined> {
			const binaryPath = await resolveNativeGuiHelperBinary();
			const child = spawn(binaryPath, ["monitor-escape"], {
				env: process.env,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stopped = false;
			let stdoutBuffer = "";
			const onStdout = (chunk: Buffer | string) => {
				stdoutBuffer += chunk.toString();
				if (!stdoutBuffer.includes("escape")) {
					return;
				}
				stdoutBuffer = "";
				params.onEmergencyStop();
			};
			const onAbort = () => {
				void stop();
			};
			const stop = async () => {
				if (stopped) {
					return;
				}
				stopped = true;
				params.signal.removeEventListener("abort", onAbort);
				child.stdout?.off("data", onStdout);
				if (!child.killed) {
					child.kill("SIGTERM");
				}
				await new Promise<void>((resolve) => {
					const timer = setTimeout(() => {
						if (!child.killed) {
							child.kill("SIGKILL");
						}
						resolve();
					}, 500);
					child.once("exit", () => {
						clearTimeout(timer);
						resolve();
					});
				}).catch(() => {});
			};
			child.stdout?.on("data", onStdout);
			params.signal.addEventListener("abort", onAbort, { once: true });
			return { stop };
		},
	};
}

async function runAppleScript(
	script: string,
	env: Record<string, string | undefined>,
	args: string[] = [],
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
	signal?: AbortSignal,
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
			signal,
			maxBuffer: 8 * 1024 * 1024,
			encoding: "utf-8",
		});
		return result.stdout.trim();
	} catch (error) {
		if (isAbortError(error)) {
			throw error;
		}
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
	command: "capture-context" | "event" | "cleanup" | "redact-host-windows";
	env: Record<string, string | undefined>;
	timeoutMs?: number;
	failureMessage: string;
	timeoutHint: string;
	signal?: AbortSignal;
}): Promise<string> {
	try {
		const binaryPath = await resolveNativeGuiHelperBinary();
		const result = await execFileAsync(binaryPath, [params.command], {
			env: {
				...process.env,
				...params.env,
			},
			timeout: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			signal: params.signal,
			maxBuffer: 8 * 1024 * 1024,
			encoding: "utf-8",
		});
		return result.stdout.trim();
	} catch (error) {
		if (isAbortError(error)) {
			throw error;
		}
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

const CLIPBOARD_READ_SCRIPT = String.raw`
try
	return the clipboard as text
on error
	return ""
end try
`;

const CLIPBOARD_WRITE_SCRIPT = String.raw`
on run argv
	set restoredText to ""
	if (count of argv) > 0 then set restoredText to item 1 of argv
	set the clipboard to restoredText
	return "clipboard_restored"
end run
`;

async function readClipboardText(
	platform: NodeJS.Platform = process.platform,
	signal?: AbortSignal,
): Promise<string | undefined> {
	if (platform !== "darwin") {
		return undefined;
	}
	try {
		return await runAppleScript(CLIPBOARD_READ_SCRIPT, {}, [], 2_000, signal);
	} catch {
		return undefined;
	}
}

async function restoreClipboardText(
	text: string,
	platform: NodeJS.Platform = process.platform,
): Promise<void> {
	if (platform !== "darwin") {
		return;
	}
	await runAppleScript(CLIPBOARD_WRITE_SCRIPT, {}, [text], 2_000).catch(() => {});
}

async function performBestEffortInputCleanup(
	platform: NodeJS.Platform = process.platform,
): Promise<void> {
	if (platform === "win32") {
		await runWindowsPowerShell({
			script: WINDOWS_POINTER_EVENT_SCRIPT,
			env: {
				UNDERSTUDY_GUI_EVENT_MODE: "cleanup",
				UNDERSTUDY_GUI_ACTIVATE_APP: "0",
			},
			timeoutMs: 1_000,
			failureMessage:
				"Windows GUI cleanup failed. Ensure PowerShell input dispatch is available.",
		}).catch(() => {});
		return;
	}
	if (platform !== "darwin") {
		return;
	}
	await runNativeHelper({
		command: "cleanup",
		env: {
			UNDERSTUDY_GUI_RELEASE_MOUSE: "1",
			UNDERSTUDY_GUI_RELEASE_MODIFIERS: "1",
		},
		timeoutMs: 1_000,
		failureMessage:
			"macOS native GUI cleanup failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while restoring GUI input state.",
	}).catch(() => {});
}

async function resolveCaptureContext(
	appName: string | undefined,
	options: {
		activateApp?: boolean;
		windowSelector?: GuiWindowSelector;
		platform?: NodeJS.Platform;
		signal?: AbortSignal;
	} = {},
): Promise<GuiCaptureContext> {
	if (options.platform === "win32") {
		return await resolveWindowsCaptureContext({
			appName,
			activateApp: options.activateApp,
			windowSelector: options.windowSelector,
			signal: options.signal,
			captureWindow: Boolean(appName?.trim() || options.windowSelector),
		});
	}
	const windowSelection = resolveWindowSelection({
		windowSelector: options.windowSelector,
	});
	const raw = await runNativeHelper({
		command: "capture-context",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			...buildHostWindowExclusionEnv({
				appName,
			}),
			...buildWindowSelectionEnv(windowSelection),
		},
		signal: options.signal,
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

function resolveWindowsPowerShellCommand(): string {
	return process.env.UNDERSTUDY_GUI_WINDOWS_POWERSHELL?.trim() || "powershell.exe";
}

async function runWindowsPowerShell(params: {
	script: string;
	env: Record<string, string | undefined>;
	failureMessage: string;
	signal?: AbortSignal;
	timeoutMs?: number;
}): Promise<string> {
	try {
		const result = await execFileAsync(
			resolveWindowsPowerShellCommand(),
			[
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-Command",
				params.script,
			],
			{
				env: {
					...process.env,
					...params.env,
				},
				timeout: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
				signal: params.signal,
				maxBuffer: 8 * 1024 * 1024,
				encoding: "utf-8",
			},
		);
		return result.stdout.trim();
	} catch (error) {
		if (isAbortError(error)) {
			throw error;
		}
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
		throw new GuiRuntimeError(`${params.failureMessage} ${message}`.trim());
	}
}

async function performPointClick(
	appName: string | undefined,
	point: { x: number; y: number },
	options: { activateApp?: boolean; signal?: AbortSignal; platform?: NodeJS.Platform } = {},
): Promise<GuiNativeActionResult> {
	if (options.platform === "win32") {
		const actionKind = await runWindowsPowerShell({
			script: WINDOWS_POINTER_EVENT_SCRIPT,
			env: {
				UNDERSTUDY_GUI_APP: appName?.trim(),
				UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
				UNDERSTUDY_GUI_ACTIVATE_TARGET: appName?.trim(),
				UNDERSTUDY_GUI_EVENT_MODE: "click",
				UNDERSTUDY_GUI_X: String(point.x),
				UNDERSTUDY_GUI_Y: String(point.y),
			},
			signal: options.signal,
			failureMessage:
				"Windows GUI event dispatch failed. Ensure PowerShell input dispatch is available.",
		});
		return { actionKind };
	}
	const actionKind = await runNativeHelper({
		command: "event",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			UNDERSTUDY_GUI_EVENT_MODE: "click",
			UNDERSTUDY_GUI_X: String(point.x),
			UNDERSTUDY_GUI_Y: String(point.y),
		},
		signal: options.signal,
		failureMessage:
			"macOS native GUI event dispatch failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while sending native input events.",
	});
	return { actionKind };
}

async function performRightClick(
	appName: string | undefined,
	point: { x: number; y: number },
	options: { activateApp?: boolean; signal?: AbortSignal; platform?: NodeJS.Platform } = {},
): Promise<GuiNativeActionResult> {
	if (options.platform === "win32") {
		const actionKind = await runWindowsPowerShell({
			script: WINDOWS_POINTER_EVENT_SCRIPT,
			env: {
				UNDERSTUDY_GUI_APP: appName?.trim(),
				UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
				UNDERSTUDY_GUI_ACTIVATE_TARGET: appName?.trim(),
				UNDERSTUDY_GUI_EVENT_MODE: "right_click",
				UNDERSTUDY_GUI_X: String(point.x),
				UNDERSTUDY_GUI_Y: String(point.y),
			},
			signal: options.signal,
			failureMessage:
				"Windows GUI event dispatch failed. Ensure PowerShell input dispatch is available.",
		});
		return { actionKind };
	}
	const actionKind = await runNativeHelper({
		command: "event",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			UNDERSTUDY_GUI_EVENT_MODE: "right_click",
			UNDERSTUDY_GUI_X: String(point.x),
			UNDERSTUDY_GUI_Y: String(point.y),
		},
		signal: options.signal,
		failureMessage:
			"macOS native GUI event dispatch failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while sending native input events.",
	});
	return { actionKind };
}

async function performDoubleClick(
	appName: string | undefined,
	point: { x: number; y: number },
	options: { activateApp?: boolean; signal?: AbortSignal; platform?: NodeJS.Platform } = {},
): Promise<GuiNativeActionResult> {
	if (options.platform === "win32") {
		const actionKind = await runWindowsPowerShell({
			script: WINDOWS_POINTER_EVENT_SCRIPT,
			env: {
				UNDERSTUDY_GUI_APP: appName?.trim(),
				UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
				UNDERSTUDY_GUI_ACTIVATE_TARGET: appName?.trim(),
				UNDERSTUDY_GUI_EVENT_MODE: "double_click",
				UNDERSTUDY_GUI_X: String(point.x),
				UNDERSTUDY_GUI_Y: String(point.y),
			},
			signal: options.signal,
			failureMessage:
				"Windows GUI event dispatch failed. Ensure PowerShell input dispatch is available.",
		});
		return { actionKind };
	}
	const actionKind = await runNativeHelper({
		command: "event",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			UNDERSTUDY_GUI_EVENT_MODE: "double_click",
			UNDERSTUDY_GUI_X: String(point.x),
			UNDERSTUDY_GUI_Y: String(point.y),
		},
		signal: options.signal,
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
	options: { activateApp?: boolean; signal?: AbortSignal; platform?: NodeJS.Platform } = {},
): Promise<GuiNativeActionResult> {
	if (options.platform === "win32") {
		const actionKind = await runWindowsPowerShell({
			script: WINDOWS_POINTER_EVENT_SCRIPT,
			env: {
				UNDERSTUDY_GUI_APP: appName?.trim(),
				UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
				UNDERSTUDY_GUI_ACTIVATE_TARGET: appName?.trim(),
				UNDERSTUDY_GUI_EVENT_MODE: "hover",
				UNDERSTUDY_GUI_X: String(point.x),
				UNDERSTUDY_GUI_Y: String(point.y),
				UNDERSTUDY_GUI_SETTLE_MS: String(settleMs),
			},
			signal: options.signal,
			failureMessage:
				"Windows GUI event dispatch failed. Ensure PowerShell input dispatch is available.",
		});
		return { actionKind };
	}
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
		signal: options.signal,
		failureMessage:
			"macOS native GUI event dispatch failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while sending native input events.",
	});
	return { actionKind };
}

async function performMoveCursor(
	appName: string | undefined,
	point: { x: number; y: number },
	options: { activateApp?: boolean; signal?: AbortSignal; platform?: NodeJS.Platform } = {},
): Promise<GuiNativeActionResult> {
	if (options.platform === "win32") {
		const actionKind = await runWindowsPowerShell({
			script: WINDOWS_POINTER_EVENT_SCRIPT,
			env: {
				UNDERSTUDY_GUI_APP: appName?.trim(),
				UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
				UNDERSTUDY_GUI_ACTIVATE_TARGET: appName?.trim(),
				UNDERSTUDY_GUI_EVENT_MODE: "move",
				UNDERSTUDY_GUI_X: String(point.x),
				UNDERSTUDY_GUI_Y: String(point.y),
			},
			signal: options.signal,
			failureMessage:
				"Windows GUI event dispatch failed. Ensure PowerShell input dispatch is available.",
		});
		return { actionKind };
	}
	const actionKind = await runNativeHelper({
		command: "event",
		env: {
			UNDERSTUDY_GUI_APP: appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
			UNDERSTUDY_GUI_EVENT_MODE: "move",
			UNDERSTUDY_GUI_X: String(point.x),
			UNDERSTUDY_GUI_Y: String(point.y),
		},
		signal: options.signal,
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
	options: { activateApp?: boolean; signal?: AbortSignal; platform?: NodeJS.Platform } = {},
): Promise<GuiNativeActionResult> {
	if (options.platform === "win32") {
		const actionKind = await runWindowsPowerShell({
			script: WINDOWS_POINTER_EVENT_SCRIPT,
			env: {
				UNDERSTUDY_GUI_APP: appName?.trim(),
				UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
				UNDERSTUDY_GUI_ACTIVATE_TARGET: appName?.trim(),
				UNDERSTUDY_GUI_EVENT_MODE: "click_and_hold",
				UNDERSTUDY_GUI_X: String(point.x),
				UNDERSTUDY_GUI_Y: String(point.y),
				UNDERSTUDY_GUI_HOLD_DURATION_MS: String(holdDurationMs),
			},
			signal: options.signal,
			failureMessage:
				"Windows GUI event dispatch failed. Ensure PowerShell input dispatch is available.",
		});
		return { actionKind };
	}
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
		signal: options.signal,
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
	options: { activateApp?: boolean; signal?: AbortSignal; platform?: NodeJS.Platform } = {},
): Promise<GuiNativeActionResult> {
	if (options.platform === "win32") {
		const actionKind = await runWindowsPowerShell({
			script: WINDOWS_POINTER_EVENT_SCRIPT,
			env: {
				UNDERSTUDY_GUI_APP: appName?.trim(),
				UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
				UNDERSTUDY_GUI_ACTIVATE_TARGET: appName?.trim(),
				UNDERSTUDY_GUI_EVENT_MODE: "drag",
				UNDERSTUDY_GUI_FROM_X: String(from.x),
				UNDERSTUDY_GUI_FROM_Y: String(from.y),
				UNDERSTUDY_GUI_TO_X: String(to.x),
				UNDERSTUDY_GUI_TO_Y: String(to.y),
				UNDERSTUDY_GUI_DURATION_MS: String(durationMs),
				UNDERSTUDY_GUI_STEPS: String(DEFAULT_DRAG_STEPS),
			},
			signal: options.signal,
			failureMessage:
				"Windows GUI event dispatch failed. Ensure PowerShell input dispatch is available.",
		});
		return { actionKind };
	}
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
		signal: options.signal,
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
	options: { activateApp?: boolean; signal?: AbortSignal; platform?: NodeJS.Platform } = {},
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
	if (options.platform === "win32") {
		const actionKind = await runWindowsPowerShell({
			script: WINDOWS_POINTER_EVENT_SCRIPT,
			env: {
				UNDERSTUDY_GUI_APP: appName?.trim(),
				UNDERSTUDY_GUI_ACTIVATE_APP: options.activateApp === false ? "0" : "1",
				UNDERSTUDY_GUI_ACTIVATE_TARGET: appName?.trim(),
				UNDERSTUDY_GUI_EVENT_MODE: "scroll",
				UNDERSTUDY_GUI_X: point ? String(point.x) : undefined,
				UNDERSTUDY_GUI_Y: point ? String(point.y) : undefined,
				UNDERSTUDY_GUI_SCROLL_UNIT: params.plan.unit,
				UNDERSTUDY_GUI_SCROLL_X: String(deltaX),
				UNDERSTUDY_GUI_SCROLL_Y: String(deltaY),
			},
			signal: options.signal,
			failureMessage:
				"Windows GUI event dispatch failed. Ensure PowerShell input dispatch is available.",
		});
		return { actionKind };
	}
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
		signal: options.signal,
		failureMessage:
			"macOS native GUI event dispatch failed. Ensure the required macOS GUI control permissions are granted.",
		timeoutHint: "The GUI helper timed out while sending native input events.",
	});
	return { actionKind };
}

async function captureScreenshotArtifact(params: {
	appName?: string;
	captureMode?: GuiCaptureMode;
	preferDisplayCapture?: boolean;
	activateApp?: boolean;
	windowTitle?: string;
	windowSelector?: GuiWindowSelector;
	includeCursor?: boolean;
	platform?: NodeJS.Platform;
	signal?: AbortSignal;
} = {}): Promise<GuiScreenshotArtifact> {
	if (params.platform === "win32") {
		return await captureWindowsScreenshotArtifact(params);
	}
	const windowSelection = resolveWindowSelection({
		windowTitle: params.windowTitle,
		windowSelector: params.windowSelector,
	});
	const context = await resolveCaptureContext(params.appName, {
		activateApp: params.activateApp,
		windowSelector: windowSelection,
		platform: params.platform,
		signal: params.signal,
	});
	if (windowSelection && params.captureMode !== "display" && !context.windowBounds) {
		throw createRequestedWindowNotFoundError(params.appName, windowSelection);
	}
	const hostSelfExcludeAdjusted = shouldAdjustImplicitDisplayCaptureForHostSelfExclude({
		context,
		preferDisplayCapture: params.preferDisplayCapture,
		explicitCaptureMode: params.captureMode,
	});
	const effectiveCaptureMode = hostSelfExcludeAdjusted
		? undefined
		: (params.captureMode ?? (params.preferDisplayCapture ? "display" : undefined));
	const capture = resolveCaptureMode({
		context,
		captureMode: effectiveCaptureMode,
		includeCursor: params.includeCursor,
	});
	const captureRect = normalizeRect(capture.captureRect);
	const tempDir = await mkdtemp(join(tmpdir(), "understudy-gui-screenshot-"));
	const filePath = join(tempDir, "gui-screenshot.png");
	try {
			await execFileAsync("screencapture", [...capture.screencaptureArgs, filePath], {
				timeout: DEFAULT_TIMEOUT_MS,
				signal: params.signal,
				maxBuffer: 8 * 1024 * 1024,
			});
			const hostSelfExcludeRedactionCount =
				capture.mode === "display" && context.hostSelfExcludeApplied && context.hostFrontmostExcluded
					? await redactHostWindowsFromDisplayCapture({
						appName: params.appName,
						filePath,
						captureRect,
						platform: params.platform,
						signal: params.signal,
					})
					: 0;
			let bytes: Buffer = Buffer.from(await readFile(filePath));
			let imageSize = parsePngDimensions(bytes);
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
				captureMethod: "screencapture",
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
					hostSelfExcludeApplied: context.hostSelfExcludeApplied,
					hostFrontmostExcluded: context.hostFrontmostExcluded,
					hostSelfExcludeAdjusted,
					hostFrontmostAppName: context.hostFrontmostAppName,
					hostFrontmostBundleId: context.hostFrontmostBundleId,
					hostSelfExcludeRedactionCount,
				},
			cleanup: async () => {
				await rm(tempDir, { recursive: true, force: true }).catch(() => {});
			},
		};
	} catch (error) {
		if (isAbortError(error)) {
			throw error;
		}
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

function resolveWindowsCaptureActivationTarget(params: {
	appName?: string;
	windowTitle?: string;
	windowSelector?: GuiWindowSelector;
}): string | undefined {
	const selector = params.windowSelector;
	return normalizeOptionalString(
		params.windowTitle
		?? selector?.title
		?? selector?.titleContains
		?? params.appName,
	);
}

const WINDOWS_CAPTURE_CONTEXT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class UnderstudyWindowsApi {
	[StructLayout(LayoutKind.Sequential)]
	public struct RECT {
		public int Left;
		public int Top;
		public int Right;
		public int Bottom;
	}

	[DllImport("user32.dll")]
	public static extern IntPtr GetForegroundWindow();

	[DllImport("user32.dll", CharSet = CharSet.Unicode)]
	public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

	[DllImport("user32.dll")]
	public static extern int GetWindowTextLength(IntPtr hWnd);

	[DllImport("user32.dll")]
	public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
"@
$activateTarget = $env:UNDERSTUDY_GUI_ACTIVATE_TARGET
if ($activateTarget -and $env:UNDERSTUDY_GUI_ACTIVATE_APP -ne '0') {
	$wshell = New-Object -ComObject WScript.Shell
	try {
		$null = $wshell.AppActivate($activateTarget)
		Start-Sleep -Milliseconds 150
	} catch {}
}
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$cursor = [System.Windows.Forms.Cursor]::Position
$result = @{
	appName = $env:UNDERSTUDY_GUI_APP
	display = @{
		index = 1
		bounds = @{
			x = [int]$bounds.Left
			y = [int]$bounds.Top
			width = [int]$bounds.Width
			height = [int]$bounds.Height
		}
	}
	cursor = @{
		x = [int]$cursor.X
		y = [int]$cursor.Y
	}
}
if ($env:UNDERSTUDY_GUI_CAPTURE_WINDOW -eq '1') {
	$handle = [UnderstudyWindowsApi]::GetForegroundWindow()
	if ($handle -eq [IntPtr]::Zero) {
		throw "Could not resolve a foreground window for capture."
	}
	$titleLength = [UnderstudyWindowsApi]::GetWindowTextLength($handle)
	$titleBuilder = New-Object System.Text.StringBuilder ([Math]::Max($titleLength + 1, 256))
	$null = [UnderstudyWindowsApi]::GetWindowText($handle, $titleBuilder, $titleBuilder.Capacity)
	$title = $titleBuilder.ToString()
	$rect = New-Object 'UnderstudyWindowsApi+RECT'
	if (-not [UnderstudyWindowsApi]::GetWindowRect($handle, [ref]$rect)) {
		throw "Could not resolve foreground window bounds."
	}
	$width = [Math]::Max(0, $rect.Right - $rect.Left)
	$height = [Math]::Max(0, $rect.Bottom - $rect.Top)
	if ($width -le 0 -or $height -le 0) {
		throw "Foreground window bounds were empty."
	}
	$requestedTitle = $env:UNDERSTUDY_GUI_WINDOW_TITLE
	if ($requestedTitle -and -not $title.Equals($requestedTitle, [System.StringComparison]::OrdinalIgnoreCase)) {
		throw "Foreground window title did not match the requested title."
	}
	$requestedTitleContains = $env:UNDERSTUDY_GUI_WINDOW_TITLE_CONTAINS
	if ($requestedTitleContains -and $title.IndexOf($requestedTitleContains, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
		throw "Foreground window title did not contain the requested text."
	}
	$result.windowTitle = $title
	$result.windowBounds = @{
		x = [int]$rect.Left
		y = [int]$rect.Top
		width = [int]$width
		height = [int]$height
	}
	$result.windowCount = 1
	$result.windowCaptureStrategy = 'main_window'
}
$result | ConvertTo-Json -Compress
`;

const WINDOWS_SCREENSHOT_SAVE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$left = [int]$env:UNDERSTUDY_GUI_CAPTURE_LEFT
$top = [int]$env:UNDERSTUDY_GUI_CAPTURE_TOP
$width = [int]$env:UNDERSTUDY_GUI_CAPTURE_WIDTH
$height = [int]$env:UNDERSTUDY_GUI_CAPTURE_HEIGHT
if ($width -le 0 -or $height -le 0) {
	throw "Capture bounds were empty."
}
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
	$graphics.CopyFromScreen($left, $top, 0, 0, $bitmap.Size)
	$bitmap.Save($env:UNDERSTUDY_GUI_OUTPUT_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
	$graphics.Dispose()
	$bitmap.Dispose()
}
Write-Output "powershell_copyfromscreen"
`;

const WINDOWS_POINTER_EVENT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class UnderstudyWindowsMouse {
	[DllImport("user32.dll")]
	public static extern bool SetCursorPos(int x, int y);

	[DllImport("user32.dll")]
	public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@

$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004
$MOUSEEVENTF_RIGHTDOWN = 0x0008
$MOUSEEVENTF_RIGHTUP = 0x0010
$MOUSEEVENTF_WHEEL = 0x0800
$MOUSEEVENTF_HWHEEL = 0x01000

function Move-Cursor([int]$x, [int]$y) {
	$null = [UnderstudyWindowsMouse]::SetCursorPos($x, $y)
}

function Left-Click {
	[UnderstudyWindowsMouse]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
	Start-Sleep -Milliseconds 25
	[UnderstudyWindowsMouse]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
}

function Right-Click {
	[UnderstudyWindowsMouse]::mouse_event($MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, [UIntPtr]::Zero)
	Start-Sleep -Milliseconds 25
	[UnderstudyWindowsMouse]::mouse_event($MOUSEEVENTF_RIGHTUP, 0, 0, 0, [UIntPtr]::Zero)
}

function Activate-TargetIfNeeded {
	$activateTarget = $env:UNDERSTUDY_GUI_ACTIVATE_TARGET
	if (-not $activateTarget -or $env:UNDERSTUDY_GUI_ACTIVATE_APP -eq '0') {
		return
	}
	$wshell = New-Object -ComObject WScript.Shell
	if (-not $wshell.AppActivate($activateTarget)) {
		throw "Could not activate a window matching '$activateTarget'."
	}
	Start-Sleep -Milliseconds 120
}

Activate-TargetIfNeeded
$mode = $env:UNDERSTUDY_GUI_EVENT_MODE
switch ($mode) {
	'move' {
		Move-Cursor([int]$env:UNDERSTUDY_GUI_X, [int]$env:UNDERSTUDY_GUI_Y)
		Write-Output 'powershell_move'
	}
	'hover' {
		Move-Cursor([int]$env:UNDERSTUDY_GUI_X, [int]$env:UNDERSTUDY_GUI_Y)
		$settleMs = [Math]::Max(0, [int]$env:UNDERSTUDY_GUI_SETTLE_MS)
		if ($settleMs -gt 0) {
			Start-Sleep -Milliseconds $settleMs
		}
		Write-Output 'powershell_hover'
	}
	'click' {
		Move-Cursor([int]$env:UNDERSTUDY_GUI_X, [int]$env:UNDERSTUDY_GUI_Y)
		Left-Click
		Write-Output 'powershell_click'
	}
	'double_click' {
		Move-Cursor([int]$env:UNDERSTUDY_GUI_X, [int]$env:UNDERSTUDY_GUI_Y)
		Left-Click
		Start-Sleep -Milliseconds 40
		Left-Click
		Write-Output 'powershell_double_click'
	}
	'right_click' {
		Move-Cursor([int]$env:UNDERSTUDY_GUI_X, [int]$env:UNDERSTUDY_GUI_Y)
		Right-Click
		Write-Output 'powershell_right_click'
	}
	'click_and_hold' {
		Move-Cursor([int]$env:UNDERSTUDY_GUI_X, [int]$env:UNDERSTUDY_GUI_Y)
		[UnderstudyWindowsMouse]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
		$holdMs = [Math]::Max(0, [int]$env:UNDERSTUDY_GUI_HOLD_DURATION_MS)
		if ($holdMs -gt 0) {
			Start-Sleep -Milliseconds $holdMs
		}
		[UnderstudyWindowsMouse]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
		Write-Output 'powershell_click_and_hold'
	}
	'drag' {
		$fromX = [int]$env:UNDERSTUDY_GUI_FROM_X
		$fromY = [int]$env:UNDERSTUDY_GUI_FROM_Y
		$toX = [int]$env:UNDERSTUDY_GUI_TO_X
		$toY = [int]$env:UNDERSTUDY_GUI_TO_Y
		$steps = [Math]::Max(1, [int]$env:UNDERSTUDY_GUI_STEPS)
		$durationMs = [Math]::Max(0, [int]$env:UNDERSTUDY_GUI_DURATION_MS)
		$stepDelayMs = if ($steps -gt 0) { [Math]::Max(0, [Math]::Round($durationMs / $steps)) } else { 0 }
		Move-Cursor($fromX, $fromY)
		Start-Sleep -Milliseconds 30
		[UnderstudyWindowsMouse]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
		for ($step = 1; $step -le $steps; $step++) {
			$currentX = [Math]::Round($fromX + (($toX - $fromX) * $step / $steps))
			$currentY = [Math]::Round($fromY + (($toY - $fromY) * $step / $steps))
			Move-Cursor([int]$currentX, [int]$currentY)
			if ($stepDelayMs -gt 0) {
				Start-Sleep -Milliseconds $stepDelayMs
			}
		}
		[UnderstudyWindowsMouse]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
		Write-Output 'powershell_drag'
	}
	'scroll' {
		if ($env:UNDERSTUDY_GUI_X -and $env:UNDERSTUDY_GUI_Y) {
			Move-Cursor([int]$env:UNDERSTUDY_GUI_X, [int]$env:UNDERSTUDY_GUI_Y)
			Start-Sleep -Milliseconds 30
		}
		$scrollX = [int]$env:UNDERSTUDY_GUI_SCROLL_X
		$scrollY = [int]$env:UNDERSTUDY_GUI_SCROLL_Y
		$wheelStep = 120
		$verticalSteps = [Math]::Max(1, [Math]::Round([Math]::Abs($scrollY) / $wheelStep))
		$horizontalSteps = [Math]::Max(1, [Math]::Round([Math]::Abs($scrollX) / $wheelStep))
		if ($scrollY -ne 0) {
			$verticalDelta = [int]([Math]::Sign($scrollY) * $wheelStep)
			for ($step = 0; $step -lt $verticalSteps; $step++) {
				[UnderstudyWindowsMouse]::mouse_event($MOUSEEVENTF_WHEEL, 0, 0, [uint32]$verticalDelta, [UIntPtr]::Zero)
				Start-Sleep -Milliseconds 20
			}
		}
		if ($scrollX -ne 0) {
			$horizontalDelta = [int]([Math]::Sign($scrollX) * $wheelStep)
			for ($step = 0; $step -lt $horizontalSteps; $step++) {
				[UnderstudyWindowsMouse]::mouse_event($MOUSEEVENTF_HWHEEL, 0, 0, [uint32]$horizontalDelta, [UIntPtr]::Zero)
				Start-Sleep -Milliseconds 20
			}
		}
		Write-Output 'powershell_scroll'
	}
	'cleanup' {
		[UnderstudyWindowsMouse]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
		[UnderstudyWindowsMouse]::mouse_event($MOUSEEVENTF_RIGHTUP, 0, 0, 0, [UIntPtr]::Zero)
		Write-Output 'powershell_cleanup'
	}
	default {
		throw "Unsupported Windows GUI event mode '$mode'."
	}
}
`;

async function resolveWindowsCaptureContext(params: {
	appName?: string;
	activateApp?: boolean;
	windowSelector?: GuiWindowSelector;
	signal?: AbortSignal;
	captureWindow?: boolean;
}): Promise<GuiCaptureContext> {
	const windowSelection = resolveWindowSelection({
		windowSelector: params.windowSelector,
	});
	if (windowSelection?.index !== undefined) {
		throw new GuiRuntimeError(
			"Windows GUI window index selection is not implemented yet.",
		);
	}
	const raw = await runWindowsPowerShell({
		script: WINDOWS_CAPTURE_CONTEXT_SCRIPT,
		env: {
			UNDERSTUDY_GUI_APP: params.appName?.trim(),
			UNDERSTUDY_GUI_ACTIVATE_APP: params.activateApp === false ? "0" : "1",
			UNDERSTUDY_GUI_ACTIVATE_TARGET: resolveWindowsCaptureActivationTarget({
				appName: params.appName,
				windowSelector: windowSelection,
			}),
			UNDERSTUDY_GUI_CAPTURE_WINDOW: params.captureWindow ? "1" : "0",
			...buildWindowSelectionEnv(windowSelection),
		},
		signal: params.signal,
		failureMessage:
			"Windows GUI capture helper failed. Ensure PowerShell desktop capture is available.",
	});
	return parseCaptureContext(raw);
}

async function captureWindowsScreenshotArtifact(params: {
	appName?: string;
	captureMode?: GuiCaptureMode;
	preferDisplayCapture?: boolean;
	activateApp?: boolean;
	windowTitle?: string;
	windowSelector?: GuiWindowSelector;
	includeCursor?: boolean;
	signal?: AbortSignal;
}): Promise<GuiScreenshotArtifact> {
	const tempDir = await mkdtemp(join(tmpdir(), "understudy-gui-screenshot-"));
	const filePath = join(tempDir, "gui-screenshot.png");
	try {
		const windowSelection = resolveWindowSelection({
			windowTitle: params.windowTitle,
			windowSelector: params.windowSelector,
		});
		const captureWindow =
			params.captureMode === "window" ||
			(params.captureMode !== "display" &&
				(params.appName?.trim() || windowSelection));
		const context = await resolveWindowsCaptureContext({
			appName: params.appName,
			activateApp: params.activateApp,
			windowSelector: windowSelection,
			signal: params.signal,
			captureWindow: Boolean(captureWindow),
		});
		const captureRect = captureWindow && context.windowBounds
			? normalizeRect(context.windowBounds)
			: normalizeRect(context.display.bounds);
		await runWindowsPowerShell({
			script: WINDOWS_SCREENSHOT_SAVE_SCRIPT,
			env: {
				UNDERSTUDY_GUI_OUTPUT_PATH: filePath,
				UNDERSTUDY_GUI_CAPTURE_LEFT: String(captureRect.x),
				UNDERSTUDY_GUI_CAPTURE_TOP: String(captureRect.y),
				UNDERSTUDY_GUI_CAPTURE_WIDTH: String(captureRect.width),
				UNDERSTUDY_GUI_CAPTURE_HEIGHT: String(captureRect.height),
			},
			signal: params.signal,
			failureMessage:
				"Windows screenshot capture failed. Ensure PowerShell desktop capture is available.",
		});
		let bytes: Buffer = Buffer.from(await readFile(filePath));
		const imageSize = parsePngDimensions(bytes);
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
				captureMethod: "powershell_copyfromscreen",
				mode: captureWindow && context.windowBounds ? "window" : "display",
				captureRect,
				display: context.display,
				imageWidth: imageSize?.width,
				imageHeight: imageSize?.height,
				scaleX: Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1,
				scaleY: Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1,
				appName: params.appName,
				windowTitle: captureWindow ? context.windowTitle : undefined,
				windowCount: captureWindow ? context.windowCount : undefined,
				windowCaptureStrategy: captureWindow ? context.windowCaptureStrategy : undefined,
				cursor: context.cursor,
				cursorVisible: false,
			},
			cleanup: async () => {
				await rm(tempDir, { recursive: true, force: true }).catch(() => {});
			},
		};
	} catch (error) {
		if (isAbortError(error)) {
			throw error;
		}
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
			`Windows screenshot capture failed. Ensure PowerShell desktop capture is available. ${message}`.trim(),
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
	platform?: NodeJS.Platform;
	physicalResourceLock?: PhysicalResourceLock | null;
	sessionId?: string;
	emergencyStopProvider?: GuiEmergencyStopProvider | null;
}

export class ComputerUseGuiRuntime {
	private lastGroundingResolutionError: string | undefined;
	private readonly runtimeSessionId: string;
	private readonly defaultPhysicalResourceLock: PhysicalResourceLock | null;
	private readonly defaultEmergencyStopProvider: GuiEmergencyStopProvider | null;

	constructor(private readonly options: ComputerUseGuiRuntimeOptions = {}) {
		this.runtimeSessionId = options.sessionId?.trim() || randomUUID();
		this.defaultPhysicalResourceLock = options.physicalResourceLock === undefined
			? (process.env.UNDERSTUDY_GUI_DISABLE_PHYSICAL_RESOURCE_LOCK === "1"
				? null
				: new FilePhysicalResourceLock())
			: options.physicalResourceLock;
		this.defaultEmergencyStopProvider = options.emergencyStopProvider === undefined
			? (process.env.UNDERSTUDY_GUI_DISABLE_EMERGENCY_STOP === "1" ||
				(this.options.platform ?? process.platform) !== "darwin"
				? null
				: createNativeEmergencyStopProvider())
			: options.emergencyStopProvider;
	}

	private runtimePlatform(): NodeJS.Platform {
		return this.options.platform ?? process.platform;
	}

	private runtimeBackend() {
		return resolveGuiPlatformBackend(this.runtimePlatform());
	}

	private runtimePhysicalResourceLock(): PhysicalResourceLock | null {
		return this.defaultPhysicalResourceLock;
	}

	private runtimeEmergencyStopProvider(): GuiEmergencyStopProvider | null {
		return this.defaultEmergencyStopProvider;
	}

	private formatPhysicalResourceLockHolder(holder: PhysicalResourceLockHolder | undefined): string {
		if (!holder) {
			return "another GUI session";
		}
		const parts = [
			holder.toolName ? `tool ${holder.toolName}` : undefined,
			holder.pid ? `pid ${holder.pid}` : undefined,
			holder.acquiredAt
				? `acquired ${new Date(holder.acquiredAt).toISOString()}`
				: undefined,
		].filter(Boolean);
		return parts.length > 0 ? `${parts.join(", ")}` : "another GUI session";
	}

	private async withGuiActionSession(
		toolName: GuiToolName,
		options: {
			signal?: AbortSignal;
			acquireLock?: boolean;
		},
		run: (session: GuiActionSession) => Promise<GuiActionResult>,
	): Promise<GuiActionResult> {
		const session = new GuiActionSession(toolName, options.signal);
		try {
				if (options.acquireLock !== false) {
					const lock = this.runtimePhysicalResourceLock();
					if (lock) {
					const acquisition = await lock.acquire({
						sessionId: this.runtimeSessionId,
						pid: process.pid,
						acquiredAt: Date.now(),
						toolName,
					});
					if (acquisition.state === "blocked") {
						return unsupportedResult(
							`GUI physical resources are currently locked by ${this.formatPhysicalResourceLockHolder(acquisition.holder)}.`,
						);
					}
						session.registerCleanup("physical_resource_lock", async () => {
							await lock.release({
								sessionId: this.runtimeSessionId,
								pid: process.pid,
							}).catch(() => {});
						});
					}
					session.registerCleanup("input_state_cleanup", async () => {
						await performBestEffortInputCleanup(this.runtimePlatform());
					}, 1_000);
				}
			const emergencyStopProvider = this.runtimeEmergencyStopProvider();
			if (emergencyStopProvider) {
				const handle = await emergencyStopProvider.start({
					toolName,
					signal: session.signal,
					onEmergencyStop: () => {
						session.handleEmergencyStop();
					},
				});
				if (handle) {
					session.registerCleanup("emergency_stop_monitor", async () => {
						await handle.stop();
					}, 1_000);
				}
			}
			session.throwIfAborted();
			return await run(session);
		} finally {
			await session.cleanup();
		}
	}

	private runtimeInputDependencies(signal?: AbortSignal): GuiPlatformInputDependencies {
		return {
			signal,
			resolveCaptureContext: async (appName, options = {}) =>
				await resolveCaptureContext(appName, {
					...options,
					platform: this.runtimePlatform(),
					signal: options.signal ?? signal,
				}),
			createRequestedWindowNotFoundError,
			runAppleScript: async (params) =>
				await runAppleScript(
					params.script,
					params.env,
					params.args,
					params.timeoutMs,
					params.signal ?? signal,
				),
			runNativeHelper: async (params) =>
				await runNativeHelper({
					...params,
					signal: params.signal ?? signal,
				}),
		};
	}

	hasGroundingProvider(): boolean {
		return Boolean(this.options.groundingProvider);
	}

	describeCapabilities(platform?: NodeJS.Platform): GuiRuntimeCapabilitySnapshot {
		return resolveGuiRuntimeCapabilities({
			platform: platform ?? this.runtimePlatform(),
			groundingAvailable: this.hasGroundingProvider(),
			environmentReadiness: this.options.environmentReadiness,
		});
	}

	private toolCapability(toolName: GuiToolName): GuiToolCapability {
		return this.describeCapabilities().toolAvailability[toolName];
	}

	private unsupportedToolResult(
		toolName: GuiToolName,
		options: {
			target?: string;
		} = {},
	): GuiActionResult | undefined {
		const capability = this.toolCapability(toolName);
		if (!capability.enabled) {
			return unsupportedResult(capability.reason ?? this.runtimeBackend().unsupportedMessage);
		}
		if (capability.targetlessOnly && options.target?.trim()) {
			return unsupportedResult(capability.reason ?? this.runtimeBackend().unsupportedMessage);
		}
		return undefined;
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
		session?: GuiActionSession;
	}): Promise<GroundedGuiTarget | undefined> {
		this.lastGroundingResolutionError = undefined;
		params.session?.throwIfAborted();
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
			session: params.session,
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
		session?: GuiActionSession;
	}): Promise<GroundedGuiTarget | undefined> {
		params.session?.throwIfAborted();
		const provider = this.requireGroundingProvider();
		const groundingMode: GuiGroundingMode | undefined = params.groundingMode
			? normalizeGuiGroundingMode(params.groundingMode)
			: defaultGroundingModeForAction(params.action);
		const grounded = await provider.ground({
			imagePath: params.artifact.filePath,
			signal: params.session?.signal,
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
		params.session?.throwIfAborted();
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
		session: GuiActionSession;
	}): Promise<GuiTargetProbe> {
		const deadline = Date.now() + params.timeoutMs;
		const intervalMs = params.intervalMs ?? DEFAULT_WAIT_INTERVAL_MS;
		let attempts = 0;
		let consecutiveSatisfied = 0;
		let lastGrounded: GroundedGuiTarget | undefined;
		let lastCapture: GuiCaptureMetadata | undefined;
		let lastImage: GuiActionResult["image"] | undefined;

		while (attempts === 0 || Date.now() < deadline) {
			params.session.throwIfAborted();
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
				platform: this.runtimePlatform(),
				signal: params.session.signal,
			});
			try {
				lastCapture = artifact.metadata;
				lastImage = screenshotArtifactToImage(artifact);
				params.session.throwIfAborted();
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
					session: params.session,
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
			await params.session.sleep(Math.min(intervalMs, remainingIntervalMs));
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
		session?: GuiActionSession;
	}): Promise<{ image?: GuiActionResult["image"]; details?: Record<string, unknown> }> {
		try {
			params.session?.throwIfAborted();
			const settleMs = Math.max(
				0,
				Math.round(
					params.settleMs ??
						resolvePostActionCaptureSettleMsEnv() ??
						DEFAULT_POST_ACTION_CAPTURE_SETTLE_MS,
				),
			);
			if (settleMs > 0) {
				if (params.session) {
					await params.session.sleep(settleMs);
				} else {
					await new Promise((resolve) => setTimeout(resolve, settleMs));
				}
			}
			const artifact = await captureScreenshotArtifact({
				appName: params.appName,
				captureMode: params.captureMode,
				activateApp: false,
				windowSelector: params.windowSelector,
				platform: this.runtimePlatform(),
				signal: params.session?.signal,
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
			if (params.session?.signal.aborted) {
				params.session.throwIfAborted();
			}
			return {};
		}
	}

	private async executeGroundedPointAction(
		session: GuiActionSession,
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
			platform: this.runtimePlatform(),
			signal: session.signal,
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
				session,
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

			session.throwIfAborted();
			const action = await params.execute(grounded.point);
			const evidence = await this.captureEvidenceImage({
				appName: params.appName,
				captureMode: params.captureMode,
				windowSelector: windowSelection,
				session,
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

		async observe(params: GuiObserveParams = {}, signal?: AbortSignal): Promise<GuiActionResult> {
			const unsupported = this.unsupportedToolResult("gui_observe", {
				target: params.target,
			});
		if (unsupported) {
			return unsupported;
		}

			return await this.withGuiActionSession("gui_observe", { signal, acquireLock: false }, async (session) => {
				const appName = normalizeOptionalString(params.app);
				const windowSelection = resolveWindowSelection({
					windowTitle: params.windowTitle,
					windowSelector: params.windowSelector,
				});
				if (
					this.runtimePlatform() === "win32" &&
					hasUnsupportedWindowsWindowSelection(windowSelection)
				) {
					return unsupportedResult(
						"Windows GUI observation does not support window index selection yet. Omit `windowSelector.index`.",
					);
				}
				const artifact = await captureScreenshotArtifact({
					appName,
					captureMode: params.captureMode,
				preferDisplayCapture: !params.captureMode && !appName && !params.target?.trim(),
				windowSelector: windowSelection,
				includeCursor: !params.target?.trim(),
				platform: this.runtimePlatform(),
				signal: session.signal,
			});
			try {
				const image = params.returnImage === false ? undefined : screenshotArtifactToImage(artifact);
				const observation = createScreenshotObservation(
					appName,
					artifact.metadata.windowTitle,
					this.runtimePlatform(),
				);
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
					session,
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
		});
	}

	async click(params: GuiClickParams, signal?: AbortSignal): Promise<GuiActionResult> {
		const unsupported = this.unsupportedToolResult("gui_click", {
			target: params.target,
		});
		if (unsupported) {
			return unsupported;
		}

		return await this.withGuiActionSession("gui_click", { signal }, async (session) => {
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
						return performRightClick(appName, point, {
							activateApp: false,
							platform: this.runtimePlatform(),
							signal: session.signal,
						});
					case "double_click":
						return performDoubleClick(appName, point, {
							activateApp: false,
							platform: this.runtimePlatform(),
							signal: session.signal,
						});
					case "hover":
						return performHover(appName, point, settleMs, {
							activateApp: false,
							platform: this.runtimePlatform(),
							signal: session.signal,
						});
					case "click_and_hold":
						return performClickAndHold(appName, point, holdMs, {
							activateApp: false,
							platform: this.runtimePlatform(),
							signal: session.signal,
						});
					default:
						return performPointClick(appName, point, {
							activateApp: false,
							platform: this.runtimePlatform(),
							signal: session.signal,
						});
				}
			};

			const extraDetails: Record<string, unknown> = {};
			if (intent === "hover") extraDetails.settle_ms = settleMs;
			if (intent === "click_and_hold") extraDetails.hold_duration_ms = holdMs;

			return await this.executeGroundedPointAction(session, {
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
		});
	}

	async drag(params: GuiDragParams, signal?: AbortSignal): Promise<GuiActionResult> {
		const unsupported = this.unsupportedToolResult("gui_drag", {
			target: `${params.fromTarget ?? ""}${params.toTarget ?? ""}`.trim() || "drag",
		});
		if (unsupported) {
			return unsupported;
		}

		return await this.withGuiActionSession("gui_drag", { signal }, async (session) => {
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
				platform: this.runtimePlatform(),
				signal: session.signal,
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
					session,
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
					session,
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
					{
						activateApp: true,
						platform: this.runtimePlatform(),
						signal: session.signal,
					},
				);
				const evidence = await this.captureEvidenceImage({
					appName,
					captureMode: params.captureMode,
					windowSelector: windowSelection,
					session,
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
		});
	}

	async scroll(params: GuiScrollParams = {}, signal?: AbortSignal): Promise<GuiActionResult> {
		const unsupported = this.unsupportedToolResult("gui_scroll", {
			target: params.target,
		});
		if (unsupported) {
			return unsupported;
		}

		return await this.withGuiActionSession("gui_scroll", { signal }, async (session) => {
			let appName = normalizeOptionalString(params.app);
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
					platform: this.runtimePlatform(),
					signal: session.signal,
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
						session,
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
					platform: this.runtimePlatform(),
					signal: session.signal,
				});
				if (!appName && context.hostSelfExcludeApplied && context.hostFrontmostExcluded) {
					appName = normalizeOptionalString(context.appName);
				}
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
				platform: this.runtimePlatform(),
				signal: session.signal,
			});
			const direction = params.direction ?? "down";
			const evidence = await this.captureEvidenceImage({
				appName,
				captureMode: params.captureMode,
				windowSelector: windowSelection,
				session,
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
		});
	}

	async type(params: GuiTypeParams, signal?: AbortSignal): Promise<GuiActionResult> {
		const unsupported = this.unsupportedToolResult("gui_type", {
			target: params.target,
		});
		if (unsupported) {
			return unsupported;
		}

		const inputAdapter = this.runtimeBackend().input;
		if (!inputAdapter) {
			return unsupportedResult(this.runtimeBackend().unsupportedMessage);
		}

		return await this.withGuiActionSession("gui_type", { signal }, async (session) => {
			let appName = normalizeOptionalString(params.app);
			const input = await resolveGuiTypeInput(params, session.signal);
			if (typeTouchesClipboard(params)) {
				const clipboardText = await readClipboardText(this.runtimePlatform(), session.signal);
				if (clipboardText !== undefined) {
					session.registerCleanup("clipboard_restore", async () => {
						await restoreClipboardText(clipboardText, this.runtimePlatform());
					}, 2_000);
				}
			}
			const scope = params.scope;
			const windowSelection = resolveWindowSelection({
				windowTitle: params.windowTitle,
				windowSelector: params.windowSelector,
			});
			if (!params.target?.trim()) {
				appName = await resolveHostExcludedImplicitAppName({
					appName,
					windowSelector: windowSelection,
					platform: this.runtimePlatform(),
					signal: session.signal,
				});
			}
			const targetDescription = describeGuiTarget({
				target: params.target,
				fallback: "the input target",
			});
			let grounded: GroundedGuiTarget | undefined;
			let executedPoint: GuiPoint | undefined;
			if (params.target?.trim()) {
				const artifact = await captureScreenshotArtifact({
					appName,
					captureMode: params.captureMode,
					windowSelector: windowSelection,
					platform: this.runtimePlatform(),
					signal: session.signal,
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
						session,
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
				executedPoint = grounded.displayBox
					? rectCenterPoint(grounded.displayBox)
					: grounded.point;
				await performPointClick(appName, executedPoint, {
					activateApp: true,
					platform: this.runtimePlatform(),
					signal: session.signal,
				});
				await session.sleep(DEFAULT_TYPE_FOCUS_SETTLE_MS);
			}

			let action: GuiNativeActionResult;
			if (
				params.typeStrategy === "system_events_paste" ||
				params.typeStrategy === "system_events_keystroke" ||
				params.typeStrategy === "system_events_keystroke_chars"
			) {
				action = await inputAdapter.performSystemEventsType(
					{ ...params, app: appName },
					input.text,
					params.typeStrategy,
					this.runtimeInputDependencies(session.signal),
				);
			} else if (params.typeStrategy) {
				action = await inputAdapter.performNativeType(
					{ ...params, app: appName },
					input.text,
					this.runtimeInputDependencies(session.signal),
				);
			} else {
				try {
					action = await inputAdapter.performType(
						{ ...params, app: appName },
						input.text,
						this.runtimeInputDependencies(session.signal),
					);
				} catch (error) {
					if (!(error instanceof GuiRuntimeError)) {
						throw error;
					}
					action = await inputAdapter.performNativeType(
						{ ...params, app: appName },
						input.text,
						this.runtimeInputDependencies(session.signal),
					);
				}
			}
			const evidence = await this.captureEvidenceImage({
				appName,
				captureMode: params.captureMode,
				windowSelector: windowSelection,
				settleMs: 500,
				session,
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
					executed_point: executedPoint,
					...(grounded ? { pre_action_capture: buildCaptureDetails(grounded.artifact) } : {}),
				},
				image: evidence.image,
			});
		});
	}

	async key(params: GuiKeyParams, signal?: AbortSignal): Promise<GuiActionResult> {
		const unsupported = this.unsupportedToolResult("gui_key");
		if (unsupported) {
			return unsupported;
		}

		const inputAdapter = this.runtimeBackend().input;
		if (!inputAdapter) {
			return unsupportedResult(this.runtimeBackend().unsupportedMessage);
		}

		return await this.withGuiActionSession("gui_key", { signal }, async (session) => {
			const repeat = Math.max(1, Math.min(50, Math.round(params.repeat ?? 1)));
			let appName = normalizeOptionalString(params.app);
			const windowSelection = resolveWindowSelection({
				windowTitle: params.windowTitle,
				windowSelector: params.windowSelector,
			});
			appName = await resolveHostExcludedImplicitAppName({
				appName,
				windowSelector: windowSelection,
				platform: this.runtimePlatform(),
				signal: session.signal,
			});
			if (params.key.trim().toLowerCase() === "escape" || params.key.trim().toLowerCase() === "esc") {
				session.notifyExpectedEscape();
			}
			const action = await inputAdapter.performHotkey(
				{ ...params, app: appName },
				repeat,
				this.runtimeInputDependencies(session.signal),
			);
			const keySequence = [...(params.modifiers ?? []), params.key].join("+");
			const evidence = await this.captureEvidenceImage({
				appName,
				captureMode: params.captureMode,
				windowSelector: windowSelection,
				settleMs: 500,
				session,
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
		});
	}

	async move(params: GuiMoveParams, signal?: AbortSignal): Promise<GuiActionResult> {
		const unsupported = this.unsupportedToolResult("gui_move");
		if (unsupported) {
			return unsupported;
		}

		return await this.withGuiActionSession("gui_move", { signal }, async (session) => {
			const appName = normalizeOptionalString(params.app);
			const point = { x: Math.round(params.x), y: Math.round(params.y) };
			const action = await performMoveCursor(appName, point, {
				activateApp: Boolean(appName),
				platform: this.runtimePlatform(),
				signal: session.signal,
			});
			return buildGuiResult({
				text: `Moved cursor to (${point.x}, ${point.y}) via ${action.actionKind}.`,
				status: "action_sent",
				summary: "GUI cursor move was sent.",
				details: {
					action_kind: action.actionKind,
					grounding_method: "absolute_coordinates",
					confidence: 1,
					app: appName,
					executed_point: point,
				},
			});
		});
	}

	async wait(params: GuiWaitParams, signal?: AbortSignal): Promise<GuiActionResult> {
		const unsupported = this.unsupportedToolResult("gui_wait", {
			target: params.target,
		});
		if (unsupported) {
			return unsupported;
		}

			return await this.withGuiActionSession("gui_wait", { signal, acquireLock: false }, async (session) => {
				const state = params.state ?? "appear";
				const timeoutMs = params.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
				const appName = normalizeOptionalString(params.app);
				const windowSelection = resolveWindowSelection({
					windowTitle: params.windowTitle,
					windowSelector: params.windowSelector,
				});
				if (
					this.runtimePlatform() === "win32" &&
					hasUnsupportedWindowsWindowSelection(windowSelection)
				) {
					return unsupportedResult(
						"Windows GUI wait does not support window index selection yet. Omit `windowSelector.index`.",
					);
				}
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
				session,
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
		});
	}
}
