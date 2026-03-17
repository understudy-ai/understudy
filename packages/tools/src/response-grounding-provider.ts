import {
	normalizeGuiGroundingMode,
	type GuiGroundingActionIntent,
	type GuiGroundingCoordinateSpace,
	type GuiGroundingFailure,
	type GuiGroundingFailureKind,
	type GuiGroundingMode,
	type GuiGroundingProvider,
	type GuiGroundingRequest,
	type GuiGroundingResult,
} from "@understudy/gui";
import {
	createGroundingGuideImage,
	type GroundingGuideImageArtifact,
	type GroundingGuideImageParams,
} from "./grounding-guide-image.js";
import {
	createGroundingSimulationImage,
	type GroundingSimulationImageArtifact,
	type GroundingSimulationImageParams,
} from "./grounding-simulation-image.js";
import {
	prepareGroundingModelImage,
	type GroundingPreparedModelImage,
} from "./grounding-model-image.js";
import { loadImageSource } from "./image-shared.js";
import { loadPhoton } from "./photon.js";
import { buildDataUrl, extractJsonObject, extractResponseText } from "./response-extract-helpers.js";
import { asBoolean, asNumber, asRecord, asString } from "@understudy/core";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_GROUNDING_IMAGE_BYTES = 40 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_TOKENS = 300;
const MODEL_REQUEST_MAX_ATTEMPTS = 3;

function isNonRetryableModelRequestError(error: Error): boolean {
	return /\bHTTP (400|401|403|404|413|422)\b/.test(error.message);
}

interface GroundingPoint {
	x: number;
	y: number;
}

interface GroundingBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

type GroundingDecisionStatus = "resolved" | "not_found";

interface ParsedNotFoundGroundingDecision {
	status: "not_found";
	confidence: number;
	reason: string;
	raw: Record<string, unknown>;
}

interface ParsedResolvedGroundingDecision {
	status: "resolved";
	confidence: number;
	reason: string;
	coordinateSpace: GuiGroundingCoordinateSpace;
	point: GroundingPoint;
	box?: GroundingBox;
	raw: Record<string, unknown>;
}

type ParsedGroundingDecision = ParsedResolvedGroundingDecision | ParsedNotFoundGroundingDecision;

export interface ParsedGroundingResponse extends ParsedResolvedGroundingDecision {}

export interface ParsedGroundingValidationResponse {
	approved: boolean;
	confidence: number;
	reason: string;
	failureKind?: GuiGroundingFailureKind;
	retryHint?: string;
	raw: Record<string, unknown>;
}

type GuideImageImpl = (params: GroundingGuideImageParams) => Promise<GroundingGuideImageArtifact | undefined>;
type SimulationImageImpl = (params: GroundingSimulationImageParams) => Promise<GroundingSimulationImageArtifact | undefined>;
type GroundingModelStage = "predict" | "validate";
type GroundingModelImageInput = {
	bytes: Buffer;
	mimeType: string;
};
type GroundingModelRunner = (params: {
	stage: GroundingModelStage;
	prompt: string;
	images: GroundingModelImageInput[];
}) => Promise<string>;
type PrepareModelFrameImpl = (frame: GroundingFrame, request: GuiGroundingRequest) => Promise<PreparedGroundingModelFrame>;
type ResponsesApiReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ResponsesApiGroundingProviderOptions {
	apiKey?: string;
	baseUrl: string;
	model: string;
	timeoutMs?: number;
	maxOutputTokens?: number;
	fetchImpl?: typeof fetch;
	providerName: string;
	systemPrompt?: string;
	guideImageImpl?: GuideImageImpl;
	simulationImageImpl?: SimulationImageImpl;
	inputImageDetail?: "low" | "high" | "original" | "auto";
	reasoningEffort?: ResponsesApiReasoningEffort;
	prepareModelFrameImpl?: PrepareModelFrameImpl;
}

export interface SharedModelLoopGroundingProviderOptions {
	providerName: string;
	systemPrompt?: string;
	guideImageImpl?: GuideImageImpl;
	simulationImageImpl?: SimulationImageImpl;
	invokeModel: GroundingModelRunner;
	maxRounds?: number;
	prepareModelFrameImpl?: PrepareModelFrameImpl;
}

type GroundingFrame = {
	bytes: Buffer;
	mimeType: string;
	width?: number;
	height?: number;
	localPath?: string;
};

type PreparedGroundingModelFrame = {
	frame: GroundingFrame;
	modelToOriginalScaleX: number;
	modelToOriginalScaleY: number;
	wasResized: boolean;
	logicalNormalizationApplied: boolean;
	workingWidth?: number;
	workingHeight?: number;
	workingToOriginalScaleX: number;
	workingToOriginalScaleY: number;
	originalWidth?: number;
	originalHeight?: number;
	offsetX: number;
	offsetY: number;
};

type GroundingResolvedAttempt = GuiGroundingResult & {
	modelPoint: GroundingPoint;
	modelBox?: GroundingBox;
	round: number;
};

type GroundingRoundTiming = {
	round: number;
	guideImageMs?: number;
	predictModelMs?: number;
	refinementImageMs?: number;
	refinementModelMs?: number;
	simulationImageMs?: number;
	validateModelMs?: number;
	validationTriggered: boolean;
	validationSkippedReason?: string;
};

const GROUNDING_FAILURE_KINDS = new Set<GuiGroundingFailureKind>([
	"wrong_region",
	"scope_mismatch",
	"wrong_control",
	"wrong_point",
	"state_mismatch",
	"partial_visibility",
	"other",
]);

function normalizeScaleFactor(value: number | undefined): number {
	return Number.isFinite(value) && value && value > 0 ? value : 1;
}

async function defaultPrepareModelFrame(
	frame: GroundingFrame,
	request: GuiGroundingRequest,
): Promise<PreparedGroundingModelFrame> {
	const prepared: GroundingPreparedModelImage = await prepareGroundingModelImage({
		bytes: frame.bytes,
		mimeType: frame.mimeType,
		width: frame.width,
		height: frame.height,
		logicalWidth: request.logicalImageWidth,
		logicalHeight: request.logicalImageHeight,
		scaleX: request.imageScaleX,
		scaleY: request.imageScaleY,
	});
	return {
		frame: {
			...frame,
			bytes: prepared.bytes,
			mimeType: prepared.mimeType,
			width: prepared.width,
			height: prepared.height,
		},
		modelToOriginalScaleX: normalizeScaleFactor(prepared.modelToOriginalScaleX),
		modelToOriginalScaleY: normalizeScaleFactor(prepared.modelToOriginalScaleY),
		wasResized: prepared.wasResized,
		logicalNormalizationApplied: prepared.logicalNormalizationApplied,
		workingWidth: prepared.workingWidth ?? prepared.width,
		workingHeight: prepared.workingHeight ?? prepared.height,
		workingToOriginalScaleX: normalizeScaleFactor(prepared.workingToOriginalScaleX),
		workingToOriginalScaleY: normalizeScaleFactor(prepared.workingToOriginalScaleY),
		originalWidth: prepared.originalWidth ?? frame.width,
		originalHeight: prepared.originalHeight ?? frame.height,
		offsetX: 0,
		offsetY: 0,
	};
}

function scalePointToModelFrame(
	point: GroundingPoint | undefined,
	frame: PreparedGroundingModelFrame,
): GroundingPoint | undefined {
	if (!point) {
		return undefined;
	}
	return {
		x: Math.round((point.x - frame.offsetX) / frame.modelToOriginalScaleX),
		y: Math.round((point.y - frame.offsetY) / frame.modelToOriginalScaleY),
	};
}

function scalePointToOriginalFrame(
	point: GroundingPoint | undefined,
	frame: PreparedGroundingModelFrame,
): GroundingPoint | undefined {
	if (!point) {
		return undefined;
	}
	return {
		x: frame.offsetX + (point.x * frame.modelToOriginalScaleX),
		y: frame.offsetY + (point.y * frame.modelToOriginalScaleY),
	};
}

function scaleBoxEdges(
	box: GroundingBox | undefined,
	scaleX: number,
	scaleY: number,
	operator: "multiply" | "divide",
): GroundingBox | undefined {
	if (!box) {
		return undefined;
	}
	const applyScale = (value: number, scale: number): number =>
		operator === "multiply"
			? Math.round(value * scale)
			: Math.round(value / scale);
	const x1 = applyScale(box.x, scaleX);
	const y1 = applyScale(box.y, scaleY);
	const x2 = applyScale(box.x + box.width, scaleX);
	const y2 = applyScale(box.y + box.height, scaleY);
	return {
		x: Math.min(x1, x2),
		y: Math.min(y1, y2),
		width: Math.max(1, Math.abs(x2 - x1)),
		height: Math.max(1, Math.abs(y2 - y1)),
	};
}

function scaleBoxToModelFrame(
	box: GroundingBox | undefined,
	frame: PreparedGroundingModelFrame,
): GroundingBox | undefined {
	if (!box) {
		return undefined;
	}
	return scaleBoxEdges({
		x: box.x - frame.offsetX,
		y: box.y - frame.offsetY,
		width: box.width,
		height: box.height,
	}, frame.modelToOriginalScaleX, frame.modelToOriginalScaleY, "divide");
}

function scaleBoxToOriginalFrame(
	box: GroundingBox | undefined,
	frame: PreparedGroundingModelFrame,
): GroundingBox | undefined {
	if (!box) {
		return undefined;
	}
	const x1 = frame.offsetX + (box.x * frame.modelToOriginalScaleX);
	const y1 = frame.offsetY + (box.y * frame.modelToOriginalScaleY);
	const x2 = frame.offsetX + ((box.x + box.width) * frame.modelToOriginalScaleX);
	const y2 = frame.offsetY + ((box.y + box.height) * frame.modelToOriginalScaleY);
	return {
		x: Math.min(x1, x2),
		y: Math.min(y1, y2),
		width: Math.max(1, Math.abs(x2 - x1)),
		height: Math.max(1, Math.abs(y2 - y1)),
	};
}

function scaleFailureToModelFrame(
	failure: GuiGroundingFailure,
	frame: PreparedGroundingModelFrame,
): GuiGroundingFailure {
	return {
		...failure,
		attemptedPoint: scalePointToModelFrame(failure.attemptedPoint, frame),
		attemptedBox: scaleBoxToModelFrame(failure.attemptedBox, frame),
	};
}

function normalizeFrameDimension(value: number | undefined): number | undefined {
	return Number.isFinite(value) && value && value > 0 ? value : undefined;
}

function resolveRequestImageScale(params: {
	originalWidth?: number;
	originalHeight?: number;
	logicalWidth?: number;
	logicalHeight?: number;
	scaleX?: number;
	scaleY?: number;
}): { x: number; y: number } {
	const originalWidth = normalizeFrameDimension(params.originalWidth);
	const originalHeight = normalizeFrameDimension(params.originalHeight);
	const logicalWidth = normalizeFrameDimension(params.logicalWidth);
	const logicalHeight = normalizeFrameDimension(params.logicalHeight);
	return {
		x: normalizeScaleFactor(
			params.scaleX ??
				(
					originalWidth && logicalWidth
						? originalWidth / logicalWidth
						: 1
				),
		),
		y: normalizeScaleFactor(
			params.scaleY ??
				(
					originalHeight && logicalHeight
						? originalHeight / logicalHeight
						: 1
				),
		),
	};
}

function shouldUseHighResolutionRefinement(params: {
	request: GuiGroundingRequest;
	resolved: GroundingResolvedAttempt;
	frame: PreparedGroundingModelFrame;
}): boolean {
	const originalWidth = normalizeFrameDimension(params.frame.originalWidth);
	const originalHeight = normalizeFrameDimension(params.frame.originalHeight);
	const box = params.resolved.box;
	const boxArea = box ? box.width * box.height : 0;
	const originalArea = originalWidth && originalHeight ? originalWidth * originalHeight : 0;
	const tinyOrDenseTarget =
		box !== undefined &&
		(
			Math.max(box.width, box.height) <= 160 ||
			(originalArea > 0 && (boxArea / originalArea) <= 0.02)
	);
	return params.frame.wasResized || params.frame.logicalNormalizationApplied || tinyOrDenseTarget;
}

function shouldGenerateGuideForFailure(failure: GuiGroundingFailure | undefined): boolean {
	if (!failure || (!failure.attemptedPoint && !failure.attemptedBox)) {
		return false;
	}
	return failure.failureKind !== "wrong_region" && failure.failureKind !== "scope_mismatch";
}

function formatGroundingFailureKind(kind: GuiGroundingFailureKind | undefined): string | undefined {
	return kind?.replace(/_/g, " ");
}

function buildGroundingRefinementPrompt(params: {
	target: string;
	scope?: string;
	app?: string;
	width?: number;
	height?: number;
	action?: GuiGroundingActionIntent;
	locationHint?: string;
	windowTitle?: string;
	captureMode?: "display" | "window";
	priorPoint?: GroundingPoint;
	priorBox?: GroundingBox;
}): string {
	return [
		"You are refining a GUI grounding candidate inside a zoomed crop from the original screenshot.",
		"This crop was selected around a previous candidate. Refine the point and box to the exact actionable/editable surface inside this crop.",
			...buildGroundingPrompt({
				target: params.target,
				scope: params.scope,
				app: params.app,
				width: params.width,
				height: params.height,
				action: params.action,
				locationHint: params.locationHint,
				windowTitle: params.windowTitle,
				captureMode: params.captureMode,
				groundingMode: "single",
				retryNotes: [
					"The provided screenshot is a zoomed crop around a previous candidate from the original image.",
					...(params.priorPoint
						? [`Previous crop-relative point: (${Math.round(params.priorPoint.x)}, ${Math.round(params.priorPoint.y)}).`]
					: []),
				...(params.priorBox
					? [`Previous crop-relative box: x=${Math.round(params.priorBox.x)}, y=${Math.round(params.priorBox.y)}, width=${Math.round(params.priorBox.width)}, height=${Math.round(params.priorBox.height)}.`]
					: []),
				"Refine the target inside this crop; if the crop does not actually contain the target, return not_found.",
			],
		}).split("\n"),
	].join("\n");
}

async function createPreparedCropFrame(params: {
	fullFrame: GroundingFrame;
	request: GuiGroundingRequest;
	candidate: GroundingResolvedAttempt;
	prepareModelFrameImpl: PrepareModelFrameImpl;
}): Promise<PreparedGroundingModelFrame | undefined> {
	const originalWidth = normalizeFrameDimension(params.fullFrame.width);
	const originalHeight = normalizeFrameDimension(params.fullFrame.height);
	if (!originalWidth || !originalHeight) {
		return undefined;
	}
	const requestScale = resolveRequestImageScale({
		originalWidth,
		originalHeight,
		logicalWidth: params.request.logicalImageWidth,
		logicalHeight: params.request.logicalImageHeight,
		scaleX: params.request.imageScaleX,
		scaleY: params.request.imageScaleY,
	});
	const photon = await loadPhoton();
	if (!photon) {
		return undefined;
	}

	const candidateBox = params.candidate.box ?? {
		x: params.candidate.point.x - 12,
		y: params.candidate.point.y - 12,
		width: 24,
		height: 24,
	};
	const candidateLogicalWidth = Math.max(1, Math.round(candidateBox.width / requestScale.x));
	const candidateLogicalHeight = Math.max(1, Math.round(candidateBox.height / requestScale.y));
	const minLogicalCropWidth = 360;
	const minLogicalCropHeight = 320;
	const targetLogicalCropWidth = Math.max(
		minLogicalCropWidth,
		Math.round(candidateLogicalWidth * 5),
		Math.round(candidateLogicalHeight * 6),
	);
	const targetLogicalCropHeight = Math.max(
		minLogicalCropHeight,
		Math.round(candidateLogicalHeight * 5),
		Math.round(candidateLogicalWidth * 4),
	);
	const cropWidth = Math.min(
		originalWidth,
		Math.max(1, Math.round(targetLogicalCropWidth * requestScale.x)),
	);
	const cropHeight = Math.min(
		originalHeight,
		Math.max(1, Math.round(targetLogicalCropHeight * requestScale.y)),
	);
	const centerX = params.candidate.point.x;
	const centerY = params.candidate.point.y;
	const left = Math.max(0, Math.min(originalWidth - cropWidth, Math.round(centerX - (cropWidth / 2))));
	const top = Math.max(0, Math.min(originalHeight - cropHeight, Math.round(centerY - (cropHeight / 2))));
	const right = Math.min(originalWidth, left + cropWidth);
	const bottom = Math.min(originalHeight, top + cropHeight);
	if (right <= left || bottom <= top) {
		return undefined;
	}

	let sourceImage: ReturnType<typeof photon.PhotonImage.new_from_byteslice> | undefined;
	let cropped: ReturnType<typeof photon.crop> | undefined;
	try {
		sourceImage = photon.PhotonImage.new_from_byteslice(new Uint8Array(params.fullFrame.bytes));
		cropped = photon.crop(sourceImage, left, top, right, bottom);
		const cropBytes = Buffer.from(cropped.get_bytes());
		const cropFrame: GroundingFrame = {
			bytes: cropBytes,
			mimeType: "image/png",
			width: right - left,
			height: bottom - top,
			localPath: params.fullFrame.localPath,
		};
		const prepared = await params.prepareModelFrameImpl(cropFrame, {
			...params.request,
			logicalImageWidth: undefined,
			logicalImageHeight: undefined,
			imageScaleX: undefined,
			imageScaleY: undefined,
		});
		return {
			...prepared,
			offsetX: left + prepared.offsetX,
			offsetY: top + prepared.offsetY,
		};
	} catch {
		return undefined;
	} finally {
		cropped?.free();
		sourceImage?.free();
	}
}

function extractJsonObjectGrounding(text: string): Record<string, unknown> {
	try {
		return extractJsonObject(text, "Grounding response");
	} catch (error) {
		const salvaged = salvageGroundingObject(text.trim());
		if (salvaged) {
			return salvaged;
		}
		throw error;
	}
}

function parseCoordinateSpace(value: string | undefined): GuiGroundingCoordinateSpace | undefined {
	if (value === undefined) {
		return "image_pixels";
	}
	if (value === "image_pixels") {
		return "image_pixels";
	}
	if (value === "display_pixels") {
		return value as GuiGroundingCoordinateSpace;
	}
	return undefined;
}

function parseGroundingBox(
	payload: Record<string, unknown>,
): GroundingBox | undefined {
	const rawBox = asRecord(payload.bbox) ?? asRecord(payload.box);
	if (!rawBox) return undefined;

	let x1 = asNumber(rawBox.x1) ?? asNumber(rawBox.left) ?? asNumber(rawBox.x);
	let y1 = asNumber(rawBox.y1) ?? asNumber(rawBox.top) ?? asNumber(rawBox.y);
	let x2 = asNumber(rawBox.x2) ?? asNumber(rawBox.right);
	let y2 = asNumber(rawBox.y2) ?? asNumber(rawBox.bottom);
	const width = asNumber(rawBox.width);
	const height = asNumber(rawBox.height);
	if (x2 === undefined && x1 !== undefined && width !== undefined) {
		x2 = x1 + width;
	}
	if (y2 === undefined && y1 !== undefined && height !== undefined) {
		y2 = y1 + height;
	}
	if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
		return undefined;
	}

	const normalizedX1 = Math.min(x1, x2);
	const normalizedY1 = Math.min(y1, y2);
	const normalizedX2 = Math.max(x1, x2);
	const normalizedY2 = Math.max(y1, y2);
	if (normalizedX2 <= normalizedX1 || normalizedY2 <= normalizedY1) {
		return undefined;
	}
	return {
		x: normalizedX1,
		y: normalizedY1,
		width: normalizedX2 - normalizedX1,
		height: normalizedY2 - normalizedY1,
	};
}

function parseGroundingPoint(
	payload: Record<string, unknown>,
): GroundingPoint | undefined {
	const rawPoint =
		asRecord(payload.click_point) ??
		asRecord(payload.target_point) ??
		asRecord(payload.point);
	if (!rawPoint) {
		return undefined;
	}

	let x = asNumber(rawPoint.x) ?? asNumber(rawPoint.cx);
	let y = asNumber(rawPoint.y) ?? asNumber(rawPoint.cy);
	if (x === undefined || y === undefined) {
		return undefined;
	}

	return { x, y };
}

export function buildGroundingPrompt(params: {
	target: string;
	scope?: string;
	app?: string;
	width?: number;
	height?: number;
	systemPrompt?: string;
	groundingMode?: GuiGroundingMode;
	action?: GuiGroundingActionIntent;
	locationHint?: string;
	captureMode?: "display" | "window";
	windowTitle?: string;
	relatedTarget?: string;
	relatedScope?: string;
	relatedAction?: GuiGroundingActionIntent;
	relatedLocationHint?: string;
	relatedPoint?: GroundingPoint;
	relatedBox?: GroundingBox;
	retryNotes?: string[];
	previousFailures?: GuiGroundingFailure[];
	hasGuideImage?: boolean;
}): string {
	const previousFailureLines = (params.previousFailures ?? [])
		.slice(0, 2)
		.map((failure, index) => describeGroundingFailure(failure, index + 1));
	const relatedContextLines = describeRelatedGroundingContext(params);
	const groundingMode = normalizeGuiGroundingMode(params.groundingMode);
	const requiresExplicitPoint = actionRequiresExplicitPoint(params.action);
	return [
		params.systemPrompt ?? "You are a GUI grounding model.",
		"Ground the single best UI target in this screenshot.",
		`Action intent: ${formatGroundingActionIntent(params.action)}.`,
		`Target description: ${params.target}`,
		...(params.locationHint ? [`Coarse location hint: ${params.locationHint}`] : []),
		...(params.scope ? [`Scope hint: ${params.scope}`] : []),
		...(params.app ? [`App hint: ${params.app}`] : []),
		...(params.windowTitle ? [`Window title hint: ${params.windowTitle}`] : []),
		...(params.captureMode ? [`Capture mode: ${params.captureMode}.`] : []),
		...(params.width && params.height ? [`Image size: ${params.width}x${params.height} pixels.`] : []),
		`Grounding mode requested by the caller: ${groundingMode}.`,
		...(relatedContextLines.length > 0
			? ["Related target context:", ...relatedContextLines]
			: []),
		...(previousFailureLines.length > 0
			? ["Recent failed attempts:", ...previousFailureLines]
			: []),
		...(params.retryNotes?.length
			? ["Retry context:", ...params.retryNotes.map((line) => `- ${line}`)]
			: []),
		...(previousFailureLines.length > 0
			? [
				"If a previous failure is classified as wrong_region or scope_mismatch, search a different visible area or panel instead of staying near that candidate.",
				"If a previous failure is classified as wrong_control, wrong_point, state_mismatch, or partial_visibility, use it only as local negative evidence and move to a different visible hit target or safer point.",
			]
			: []),
		...(params.hasGuideImage
			? [
				"An additional guide image is provided with the same screenshot plus a red overlay showing the previously rejected candidate.",
				"Do not repeat the red marked candidate unless the rejection reason is clearly contradicted by stronger visible evidence.",
			]
			: []),
		"You are grounding one target on the provided screenshot, not using a built-in computer-use grid.",
		"Use only visible screenshot evidence. Do not rely on hidden accessibility labels, DOM ids, or implementation names.",
		'Return screenshot-relative coordinates with coordinate_space set to "image_pixels".',
		"Choose the exact point a careful operator should use for this action intent.",
		"The bbox must tightly cover the actionable/editable surface itself, not a larger container.",
		"Disambiguate similar controls using scope, coarse location, nearby visible text, local grouping, and relative order.",
		"Match subtle or weakly labeled controls by the visible label, symbol, indicator, shape, and surrounding context together.",
		"Choose the smallest obvious actionable or editable surface, and keep the click_point on the visible hit target instead of whitespace, padding, decoration, or generic container background.",
		"When the request refers to text adjacent to a control, target the actual control or indicator rather than the descriptive text.",
		"If a control appears disabled or greyed-out and the target description does not explicitly say disabled, prefer an enabled matching control if one exists. If the only match is disabled, still resolve it but mention the disabled state in the reason.",
		"If the target has a visual state qualifier (selected, checked, active, highlighted, disabled), use that state to disambiguate among similar controls.",
		"If the target is only partially visible (clipped at a screenshot edge), resolve to a point inside the visible portion if confidently identifiable; otherwise return not_found.",
		...actionSpecificGroundingInstructions(params.action),
		"The click_point must be inside the bbox, and both must use the same coordinate system.",
		"Keep the reason terse, at most 8 words.",
		"Return strict JSON only with this schema:",
		'{"status":"resolved|not_found","found":true|false,"confidence":0.0,"reason":"short reason","coordinate_space":"image_pixels","click_point":{"x":0,"y":0},"bbox":{"x1":0,"y1":0,"x2":0,"y2":0}}',
		...(requiresExplicitPoint
			? [
				"If you cannot provide a safe explicit click_point inside the actionable surface, return status=\"not_found\" instead of returning a bbox-only guess.",
				"Do not omit click_point for interactive actions.",
			]
			: ["If the best click point is unclear, still return the best bbox and omit click_point."]),
		'Use status "resolved" when you have a best candidate and "not_found" when the target is missing or too ambiguous.',
		"If the target is missing, ambiguous, or not clearly visible/clickable, return status=\"not_found\" (and found=false if included) and omit bbox.",
	].join("\n");
}

export function buildGroundingValidationPrompt(params: {
	target: string;
	action?: GuiGroundingActionIntent;
	scope?: string;
	app?: string;
	width?: number;
	height?: number;
	locationHint?: string;
	windowTitle?: string;
	captureMode?: "display" | "window";
	round?: number;
}): string {
	const action = formatGroundingActionIntent(params.action);
	return [
		"You are a GUI grounding validator.",
		"You receive the original screenshot and a second image showing the simulated action overlay for the candidate returned by a separate grounding model.",
		`Action intent: ${action}.`,
		`Target description: ${params.target}`,
		...(params.locationHint ? [`Coarse location hint: ${params.locationHint}`] : []),
		...(params.scope ? [`Scope hint: ${params.scope}`] : []),
		...(params.app ? [`App hint: ${params.app}`] : []),
		...(params.windowTitle ? [`Window title hint: ${params.windowTitle}`] : []),
		...(params.captureMode ? [`Capture mode: ${params.captureMode}.`] : []),
		...(params.width && params.height ? [`Image size: ${params.width}x${params.height} pixels.`] : []),
		...(params.round ? [`Validation round: ${params.round}.`] : []),
		"The simulated image marks the candidate bbox and click point very explicitly. Judge that exact marked candidate.",
		"Rely on visible pixels in the screenshot and simulation overlay, not on any prior rationale.",
		"Approve only if the simulated action lands on the exact requested target or on a safe actionable/editable surface that unambiguously corresponds to it.",
		"Reject if the simulated action lands on whitespace, padding, decoration, generic container background, or on a neighboring control whose visible evidence does not match the request.",
		"If a scope or location hint was provided, the candidate must be inside that scope/region. Two controls with identical labels in different panels should be distinguished by scope.",
		"For subtle, tightly packed, or low-contrast controls, approve only when the marked point sits on the visible hit target itself. Minor positional offset within the control's visible hit area is acceptable as long as the click clearly lands on the correct control.",
		"If you reject, explain the mistake in concrete visual terms so the next grounding round can avoid it.",
		"If you reject, also classify the primary failure_kind as one of: wrong_region, scope_mismatch, wrong_control, wrong_point, state_mismatch, partial_visibility, or other.",
		"Use wrong_region when the candidate is in the wrong broad area; scope_mismatch for the wrong panel/list/row/dialog; wrong_control for the wrong nearby control; wrong_point when the control is right but the click lands badly; state_mismatch for the wrong selected/checked/enabled state; partial_visibility when the target is too clipped for a safe action.",
		"Keep the reason terse, at most 10 words. Keep retry_hint terse, at most 18 words.",
		"Return strict JSON only with this schema:",
		'{"status":"pass|fail","approved":true|false,"confidence":0.0,"reason":"short reason","failure_kind":"wrong_region|scope_mismatch|wrong_control|wrong_point|state_mismatch|partial_visibility|other","retry_hint":"short correction for next round"}',
	].join("\n");
}

function formatGroundingActionIntent(action: GuiGroundingActionIntent | undefined): string {
	return action ? action.replace(/_/g, " ") : "locate";
}

function describeGroundingFailure(failure: GuiGroundingFailure, index: number): string {
	const parts = [`- Attempt ${index}: ${failure.summary.trim()}`];
	if (failure.failureKind) {
		parts.push(`failure kind=${failure.failureKind}`);
	}
	if (failure.attemptedPoint) {
		parts.push(
			`previous point=(${Math.round(failure.attemptedPoint.x)}, ${Math.round(failure.attemptedPoint.y)})`,
		);
	}
	if (failure.attemptedBox) {
		parts.push(
			`previous box x=${Math.round(failure.attemptedBox.x)}, y=${Math.round(failure.attemptedBox.y)}, width=${Math.round(failure.attemptedBox.width)}, height=${Math.round(failure.attemptedBox.height)}`,
		);
	}
	return parts.join("; ");
}

function describeRelatedGroundingContext(params: {
	relatedTarget?: string;
	relatedScope?: string;
	relatedAction?: GuiGroundingActionIntent;
	relatedLocationHint?: string;
	relatedPoint?: GroundingPoint;
	relatedBox?: GroundingBox;
}): string[] {
	const lines: string[] = [];
	const action = params.relatedAction ? formatGroundingActionIntent(params.relatedAction) : "related target";
	const targetParts = [
		params.relatedTarget ? `target "${params.relatedTarget}"` : undefined,
		params.relatedLocationHint ? `location "${params.relatedLocationHint}"` : undefined,
		params.relatedScope ? `scope "${params.relatedScope}"` : undefined,
	].filter(Boolean);
	if (targetParts.length > 0) {
		lines.push(`- The ${action} is ${targetParts.join(", ")}.`);
	}
	if (params.relatedPoint) {
		lines.push(
			`- Related point: (${Math.round(params.relatedPoint.x)}, ${Math.round(params.relatedPoint.y)}).`,
		);
	}
	if (params.relatedBox) {
		lines.push(
			`- Related box: x=${Math.round(params.relatedBox.x)}, y=${Math.round(params.relatedBox.y)}, width=${Math.round(params.relatedBox.width)}, height=${Math.round(params.relatedBox.height)}.`,
		);
	}
	return lines;
}

function actionSpecificGroundingInstructions(action: GuiGroundingActionIntent | undefined): string[] {
	switch (action) {
		case "read":
			return [
				"Resolve the visible element or content region that should be inspected.",
				"The bbox should cover the observable target itself, not surrounding whitespace, wallpaper, or generic container chrome.",
				"If the requested target is only implied by nearby labels but the visual element itself is not visible, return status=\"not_found\".",
			];
		case "screenshot":
			return [
				"Resolve the visual focus target or region that the screenshot should emphasize.",
				"The bbox should cover the visible element or content area itself, not surrounding whitespace or decorative chrome.",
				"If you cannot identify a meaningful visual focus target, return status=\"not_found\" instead of guessing a broad region.",
			];
		case "click":
		case "right_click":
		case "double_click":
		case "hover":
		case "click_and_hold":
			return [
				"Resolve the actionable surface that visibly supports the requested action.",
				"Choose the control itself, such as a button, tab, menu item, list row, checkbox, icon button, or editable field, not surrounding whitespace, wallpaper, or generic container background.",
				"If you can identify only a broad region or container but not the actionable control itself, return status=\"not_found\" instead of guessing a background point.",
				"For clicks, target the clickable surface near the control center unless the visible affordance suggests another safer point.",
				"Return an explicit click_point for the exact actionable surface; do not rely on bbox-only answers.",
			];
		case "drag_source":
		case "drag_destination":
			return [
				"Resolve the draggable or droppable surface itself, not surrounding whitespace or generic container background.",
				"If you can identify only a broad region or container but not the actual drag source/destination surface, return status=\"not_found\".",
			];
		case "type":
			return [
				"The resolved box must overlap the visible editable field or composer surface itself.",
				"For text entry, target the editable interior where the caret should appear, not the area above or below the field and not surrounding toolbar, wallpaper, or container background.",
				"For large text areas or code editors, target the text content area where typing should occur.",
				"If you can identify only the broad composer region but not the editable field itself, return status=\"not_found\" instead of guessing.",
				"Return an explicit click_point inside the editable interior.",
			];
		case "scroll":
			return [
				"Resolve the scrollable container or viewport region itself, not a heading or static label within it.",
				"The bbox should cover the area that will receive the scroll gesture — typically the content pane, not a title bar or sidebar header.",
				"If you can only see a heading but not a scrollable region, return status=\"not_found\".",
			];
		case "wait":
			return [
				"Resolve the visual element whose presence or absence is being monitored.",
				"The bbox should cover the observable indicator or content area.",
			];
	default:
			return [];
	}
}

function actionRequiresExplicitPoint(action: GuiGroundingActionIntent | undefined): boolean {
	switch (action) {
		case "click":
		case "right_click":
		case "double_click":
		case "hover":
		case "click_and_hold":
		case "drag_source":
		case "drag_destination":
		case "type":
			return true;
		default:
			return false;
	}
}

function extractBooleanField(text: string, field: string): boolean | undefined {
	const match = text.match(new RegExp(`"${field}"\\s*:\\s*(true|false)`, "i"));
	if (!match) {
		return undefined;
	}
	return match[1]?.toLowerCase() === "true";
}

function extractNumberField(text: string, field: string): number | undefined {
	const match = text.match(new RegExp(`"${field}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i"));
	if (!match?.[1]) {
		return undefined;
	}
	const value = Number(match[1]);
	return Number.isFinite(value) ? value : undefined;
}

function extractStringField(text: string, field: string): string | undefined {
	const match = text.match(new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`, "i"));
	return match?.[1];
}

function extractDecisionStatusField(text: string): GroundingDecisionStatus | undefined {
	const value = extractStringField(text, "status")?.toLowerCase();
	if (value === "resolved" || value === "not_found") {
		return value;
	}
	return undefined;
}

function extractPointField(text: string, field: string): GroundingPoint | undefined {
	const match = text.match(
		new RegExp(`"${field}"\\s*:\\s*\\{[^{}]*?"x"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)[^{}]*?"y"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i"),
	);
	if (!match?.[1] || !match[2]) {
		return undefined;
	}
	const x = Number(match[1]);
	const y = Number(match[2]);
	return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

function extractBoxField(text: string, field: string): Record<string, number> | undefined {
	const x1y1x2y2 = text.match(
		new RegExp(`"${field}"\\s*:\\s*\\{[^{}]*?"x1"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)[^{}]*?"y1"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)[^{}]*?"x2"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)[^{}]*?"y2"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i"),
	);
	if (x1y1x2y2?.[1] && x1y1x2y2[2] && x1y1x2y2[3] && x1y1x2y2[4]) {
		return {
			x1: Number(x1y1x2y2[1]),
			y1: Number(x1y1x2y2[2]),
			x2: Number(x1y1x2y2[3]),
			y2: Number(x1y1x2y2[4]),
		};
	}
	const xywh = text.match(
		new RegExp(`"${field}"\\s*:\\s*\\{[^{}]*?"x"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)[^{}]*?"y"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)[^{}]*?"width"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)[^{}]*?"height"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i"),
	);
	if (xywh?.[1] && xywh[2] && xywh[3] && xywh[4]) {
		return {
			x: Number(xywh[1]),
			y: Number(xywh[2]),
			width: Number(xywh[3]),
			height: Number(xywh[4]),
		};
	}
	return undefined;
}

function salvageGroundingObject(text: string): Record<string, unknown> | undefined {
	const found = extractBooleanField(text, "found");
	const status = extractDecisionStatusField(text);
	if (found === undefined && !status) {
		return undefined;
	}
	const payload: Record<string, unknown> = found !== undefined ? { found } : {};
	if (status) {
		payload.status = status;
	}
	const confidence = extractNumberField(text, "confidence");
	if (confidence !== undefined) {
		payload.confidence = confidence;
	}
	const reason = extractStringField(text, "reason");
	if (reason) {
		payload.reason = reason;
	}
	const coordinateSpace = extractStringField(text, "coordinate_space");
	if (coordinateSpace) {
		payload.coordinate_space = coordinateSpace;
	}
	const point =
		extractPointField(text, "click_point") ??
		extractPointField(text, "target_point") ??
		extractPointField(text, "point");
	if (point) {
		payload.click_point = point;
	}
	const box = extractBoxField(text, "bbox") ?? extractBoxField(text, "box");
	if (box) {
		payload.bbox = box;
	}
	return payload;
}

function inferDecisionStatus(payload: Record<string, unknown>): GroundingDecisionStatus {
	const explicitStatus = asString(payload.status)?.toLowerCase();
	if (explicitStatus === "resolved" || explicitStatus === "not_found") {
		return explicitStatus;
	}
	if (asBoolean(payload.found) === false) {
		return "not_found";
	}
	return "resolved";
}

function centerPointFromBox(box: GroundingBox | undefined): GroundingPoint | undefined {
	return box
		? {
			x: box.x + (box.width / 2),
			y: box.y + (box.height / 2),
		}
		: undefined;
}

function stabilizeGroundingPoint(params: {
	point: GroundingPoint;
	box?: GroundingBox;
	action?: GuiGroundingActionIntent;
}): { point: GroundingPoint; stabilized: boolean } {
	if (!params.box) {
		return { point: params.point, stabilized: false };
	}
	const center = centerPointFromBox(params.box);
	if (!center) {
		return { point: params.point, stabilized: false };
	}
	switch (params.action) {
		case "click":
		case "right_click":
		case "double_click":
		case "hover":
		case "click_and_hold":
		case "drag_source":
		case "drag_destination":
			break;
		case "type": {
			const safeInsetX = Math.max(8, Math.min(32, params.box.width * 0.18));
			const safeInsetY = Math.max(6, Math.min(18, params.box.height * 0.2));
			const insideSafeInterior =
				params.point.x >= params.box.x + safeInsetX &&
				params.point.x <= params.box.x + params.box.width - safeInsetX &&
				params.point.y >= params.box.y + safeInsetY &&
				params.point.y <= params.box.y + params.box.height - safeInsetY;
			return insideSafeInterior ? { point: params.point, stabilized: false } : { point: center, stabilized: true };
		}
			default:
			return { point: params.point, stabilized: false };
	}
	const smallControl =
		(params.box.width <= 80 && params.box.height <= 80) ||
		(params.box.height <= 48 && params.box.width <= 220);
	if (!smallControl) {
		return { point: params.point, stabilized: false };
	}
	const dx = Math.abs(params.point.x - center.x);
	const dy = Math.abs(params.point.y - center.y);
	const edgeBiased =
		dx > Math.max(6, params.box.width * 0.22) ||
		dy > Math.max(6, params.box.height * 0.22);
	if (!edgeBiased) {
		return { point: params.point, stabilized: false };
	}
	return { point: center, stabilized: true };
}

function parseGroundingDecision(params: {
	payload: Record<string, unknown>;
	providerName: string;
	action?: GuiGroundingActionIntent;
}): ParsedGroundingDecision | undefined {
	const status = inferDecisionStatus(params.payload);
	if (status === "not_found") {
		return {
			status,
			confidence: asNumber(params.payload.confidence) ?? 0,
			reason: asString(params.payload.reason) ?? `${params.providerName} grounding did not find the requested target.`,
			raw: params.payload,
		};
	}
	const coordinateSpace = parseCoordinateSpace(asString(params.payload.coordinate_space));
	if (!coordinateSpace) {
		return undefined;
	}
	const box = parseGroundingBox(params.payload);
	const parsedPoint = parseGroundingPoint(params.payload);
	const point = parsedPoint ??
		(actionRequiresExplicitPoint(params.action) ? undefined : centerPointFromBox(box));
	if (!point) {
		return undefined;
	}
	return {
		status,
		confidence: asNumber(params.payload.confidence) ?? 0.75,
		reason: asString(params.payload.reason) ?? `${params.providerName} grounding matched the requested target.`,
		coordinateSpace,
		point,
		box,
		raw: params.payload,
	};
}

function parseGroundingPayload(params: {
	payload: Record<string, unknown>;
	providerName: string;
	action?: GuiGroundingActionIntent;
}): ParsedGroundingResponse | undefined {
	const decision = parseGroundingDecision(params);
	if (!decision || decision.status !== "resolved") {
		return undefined;
	}
	return decision;
}

export function parseGroundingResponseText(params: {
	text: string;
	providerName: string;
	action?: GuiGroundingActionIntent;
}): ParsedGroundingResponse | undefined {
	return parseGroundingPayload({
		payload: extractJsonObjectGrounding(params.text),
		providerName: params.providerName,
		action: params.action,
	});
}

function normalizeGroundingFailureKind(value: string | undefined): GuiGroundingFailureKind | undefined {
	const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_");
	if (!normalized || !GROUNDING_FAILURE_KINDS.has(normalized as GuiGroundingFailureKind)) {
		return undefined;
	}
	return normalized as GuiGroundingFailureKind;
}

function inferGroundingFailureKind(params: {
	reason?: string;
	retryHint?: string;
}): GuiGroundingFailureKind | undefined {
	const text = `${params.reason ?? ""} ${params.retryHint ?? ""}`.trim().toLowerCase();
	if (!text) {
		return undefined;
	}
	if (/\b(clipped|clip|partial|partially visible|cut off|edge of screenshot|edge of image|offscreen)\b/.test(text)) {
		return "partial_visibility";
	}
	if (/\b(disabled|greyed out|grayed out|selected state|wrong state|unchecked|checked|active state|inactive state)\b/.test(text)) {
		return "state_mismatch";
	}
	if (/\b(wrong panel|wrong sidebar|wrong dialog|wrong tab|wrong section|wrong column|wrong row|different panel|different dialog|different tab|scope mismatch|outside scope)\b/.test(text)) {
		return "scope_mismatch";
	}
	if (/\b(move lower|move higher|move left|move right|inside editor|inside field|inside the field|inside the editor|inside the button|inside the control|hit target|click point|point lands|point misses|point outside)\b/.test(text)) {
		return "wrong_point";
	}
	if (/\b(wrong field|wrong button|wrong control|neighboring control|adjacent control|other icon|other button|other field|other dropdown|other row|other menu item)\b/.test(text)) {
		return "wrong_control";
	}
	if (/\b(background|whitespace|padding|decoration|generic container|container background|sidebar chrome|chrome|wallpaper|broad region|wrong region|wrong area|empty area|blank area|lower toolbar|upper toolbar)\b/.test(text)) {
		return "wrong_region";
	}
	return "other";
}

function salvageValidationObject(text: string): Record<string, unknown> | undefined {
	const approved = extractBooleanField(text, "approved");
	const status = extractStringField(text, "status")?.toLowerCase();
	if (approved === undefined && status !== "pass" && status !== "fail") {
		return undefined;
	}
	const payload: Record<string, unknown> = {};
	if (approved !== undefined) {
		payload.approved = approved;
	}
	if (status === "pass" || status === "fail") {
		payload.status = status;
	}
	const confidence = extractNumberField(text, "confidence");
	if (confidence !== undefined) {
		payload.confidence = confidence;
	}
	const reason = extractStringField(text, "reason");
	if (reason) {
		payload.reason = reason;
	}
	const retryHint = extractStringField(text, "retry_hint");
	if (retryHint) {
		payload.retry_hint = retryHint;
	}
	const failureKind = extractStringField(text, "failure_kind");
	if (failureKind) {
		payload.failure_kind = failureKind;
	}
	return payload;
}

function extractJsonObjectWithValidationFallback(text: string): Record<string, unknown> {
	try {
		return extractJsonObject(text);
	} catch (error) {
		const salvaged = salvageValidationObject(text.trim());
		if (salvaged) {
			return salvaged;
		}
		throw error;
	}
}

export function parseGroundingValidationResponseText(text: string): ParsedGroundingValidationResponse | undefined {
	const payload = extractJsonObjectWithValidationFallback(text);
	const explicitStatus = asString(payload.status)?.toLowerCase();
	const approved = explicitStatus === "pass"
		? true
		: explicitStatus === "fail"
			? false
			: asBoolean(payload.approved);
	if (approved === undefined) {
		return undefined;
	}
	const reason = asString(payload.reason) ?? (approved ? "validator approved" : "validator rejected");
	const retryHint = asString(payload.retry_hint);
	const failureKind = normalizeGroundingFailureKind(asString(payload.failure_kind))
		?? (!approved ? inferGroundingFailureKind({ reason, retryHint }) : undefined);
	return {
		approved,
		confidence: asNumber(payload.confidence) ?? 0.75,
		reason,
		failureKind,
		retryHint,
		raw: payload,
	};
}

function buildRetryNotesFromDecision(params: {
	round: number;
	reason: string;
}): string[] {
	return [`Round ${params.round} predictor rationale: ${params.reason}`];
}

function buildRetryNotesFromValidation(params: {
	round: number;
	reason: string;
	failureKind?: GuiGroundingFailureKind;
	retryHint?: string;
	action?: GuiGroundingActionIntent;
}): string[] {
	return [
		`Round ${params.round} validator rejected the simulated action: ${params.reason}.`,
		...(params.failureKind ? [`Failure kind: ${formatGroundingFailureKind(params.failureKind)}.`] : []),
		...(params.retryHint ? [`Correction hint: ${params.retryHint}.`] : []),
		...(params.action === "type"
			? ["For typing, the simulated text must clearly land inside the editable field itself."]
			: []),
	];
}

function normalizeResolvedAttempt(params: {
	decision: ParsedGroundingDecision;
	frame: PreparedGroundingModelFrame;
	providerName: string;
	round: number;
	action?: GuiGroundingActionIntent;
}): GroundingResolvedAttempt | undefined {
	if (
		params.decision.status !== "resolved" ||
		params.decision.coordinateSpace !== "image_pixels" ||
		!params.decision.point
	) {
		return undefined;
	}
	const point = scalePointToOriginalFrame(params.decision.point, params.frame);
	if (!point) {
		return undefined;
	}
	const box = scaleBoxToOriginalFrame(params.decision.box, params.frame);
	const stabilized = stabilizeGroundingPoint({
		point,
		box,
		action: params.action,
	});
	const raw = asRecord(params.decision.raw) ?? {};
	return {
		method: "grounding",
		provider: params.providerName,
		confidence: params.decision.confidence,
		reason: params.decision.reason,
		coordinateSpace: params.decision.coordinateSpace,
		point: stabilized.point,
		box,
		raw: stabilized.stabilized
			? {
				...raw,
				grounding_point_stabilized: true,
				grounding_original_point: point,
				grounding_stabilized_point: stabilized.point,
			}
			: params.decision.raw,
		modelPoint: params.decision.point,
		modelBox: params.decision.box,
		round: params.round,
	};
}

function withResolvedAttemptMetadata(
	result: GroundingResolvedAttempt,
	metadata: Record<string, unknown>,
): GroundingResolvedAttempt {
	const raw = asRecord(result.raw) ?? {};
	return {
		...result,
		raw: {
			...raw,
			...metadata,
		},
	};
}

function toPublicGroundingResult(result: GroundingResolvedAttempt, validation: ParsedGroundingValidationResponse): GuiGroundingResult {
	const raw = asRecord(result.raw) ?? {};
	return {
		method: "grounding",
		provider: result.provider,
		confidence: result.confidence,
		reason: result.reason,
		coordinateSpace: result.coordinateSpace,
		point: result.point,
		box: result.box,
		raw: {
			...raw,
			selected_attempt: "validated",
			grounding_selected_round: result.round,
			validation: validation.raw,
		},
	};
}

function toPublicPredictedGroundingResult(result: GroundingResolvedAttempt, skipReason: string): GuiGroundingResult {
	const raw = asRecord(result.raw) ?? {};
	return {
		method: "grounding",
		provider: result.provider,
		confidence: result.confidence,
		reason: result.reason,
		coordinateSpace: result.coordinateSpace,
		point: result.point,
		box: result.box,
		raw: {
			...raw,
			selected_attempt: "predicted",
			grounding_selected_round: result.round,
			validation: {
				status: "skipped",
				reason: skipReason,
			},
		},
	};
}

function shouldValidateResolvedCandidate(params: {
	request: GuiGroundingRequest;
}): { required: boolean; reason: string } {
	if (params.request.groundingMode === "complex") {
		return { required: true, reason: "complex grounding was explicitly requested" };
	}
	return {
		required: false,
		reason: "single-round grounding requested by caller",
	};
}

export function createModelLoopGroundingProvider(
	options: SharedModelLoopGroundingProviderOptions,
): GuiGroundingProvider {
	const guideImageImpl = options.guideImageImpl ?? createGroundingGuideImage;
	const simulationImageImpl = options.simulationImageImpl ?? createGroundingSimulationImage;
	const prepareModelFrameImpl = options.prepareModelFrameImpl ?? defaultPrepareModelFrame;
	const maxRounds = Math.max(1, Math.min(3, Math.floor(options.maxRounds ?? 2)));

	return {
		async ground(params: GuiGroundingRequest): Promise<GuiGroundingResult | undefined> {
			const totalStart = performance.now();
			const loadStart = performance.now();
			const loaded = await loadImageSource(params.imagePath, DEFAULT_MAX_GROUNDING_IMAGE_BYTES);
			const timingTrace: {
				loadImageMs: number;
				totalMs?: number;
				rounds: GroundingRoundTiming[];
			} = {
				loadImageMs: Math.round(performance.now() - loadStart),
				rounds: [],
			};
			const fullFrame: GroundingFrame = {
				bytes: loaded.bytes,
				mimeType: loaded.probe.mimeType,
				width: loaded.probe.width,
				height: loaded.probe.height,
				localPath: loaded.localPath,
			};
			const modelFrame = await prepareModelFrameImpl(fullFrame, params);
			const cleanupFns: Array<() => Promise<void>> = [];
			let retryNotes = (params.previousFailures ?? [])
				.slice(0, 2)
				.map((failure, index) => describeGroundingFailure(scaleFailureToModelFrame(failure, modelFrame), index + 1));
			const retryFailures = [...(params.previousFailures ?? [])];
			const finalize = (result: GuiGroundingResult | undefined): GuiGroundingResult | undefined => {
				timingTrace.totalMs = Math.round(performance.now() - totalStart);
				if (!result) {
					return result;
				}
				const raw = asRecord(result.raw) ?? {};
				return {
					...result,
					raw: {
						...raw,
						grounding_mode_effective: normalizeGuiGroundingMode(params.groundingMode),
						grounding_validation_triggered: timingTrace.rounds.some((round) => round.validationTriggered),
						grounding_rounds_attempted: timingTrace.rounds.length,
						grounding_model_image: {
							width: modelFrame.frame.width,
							height: modelFrame.frame.height,
							mimeType: modelFrame.frame.mimeType,
							wasResized: modelFrame.wasResized,
						},
						grounding_working_image: {
							width: modelFrame.workingWidth ?? modelFrame.frame.width,
							height: modelFrame.workingHeight ?? modelFrame.frame.height,
							logicalNormalizationApplied: modelFrame.logicalNormalizationApplied,
						},
						grounding_original_image: {
							width: modelFrame.originalWidth ?? fullFrame.width,
							height: modelFrame.originalHeight ?? fullFrame.height,
							mimeType: fullFrame.mimeType,
						},
						grounding_request_image: {
							logicalWidth: params.logicalImageWidth,
							logicalHeight: params.logicalImageHeight,
							scaleX: params.imageScaleX,
							scaleY: params.imageScaleY,
						},
						grounding_model_to_original_scale: {
							x: modelFrame.modelToOriginalScaleX,
							y: modelFrame.modelToOriginalScaleY,
						},
						grounding_working_to_original_scale: {
							x: modelFrame.workingToOriginalScaleX,
							y: modelFrame.workingToOriginalScaleY,
						},
						grounding_timing_trace: timingTrace,
					},
				};
			};
			try {
				for (let round = 1; round <= maxRounds; round += 1) {
					const roundTiming: GroundingRoundTiming = {
						round,
						validationTriggered: false,
					};
					timingTrace.rounds.push(roundTiming);
					const latestFailure = retryFailures[retryFailures.length - 1];
					const latestFailureForModel = latestFailure
						? scaleFailureToModelFrame(latestFailure, modelFrame)
						: undefined;
					const retryFailuresForModel = retryFailures
						.slice(0, 2)
						.map((failure) => scaleFailureToModelFrame(failure, modelFrame));
					const shouldGenerateGuide = shouldGenerateGuideForFailure(latestFailure);
					const guideStart = performance.now();
					const guideImage =
						shouldGenerateGuide
							? await guideImageImpl({
								sourceBytes: modelFrame.frame.bytes,
								sourceMimeType: modelFrame.frame.mimeType,
								width: modelFrame.frame.width!,
								height: modelFrame.frame.height!,
								title: round === 1 ? "Grounding retry context" : `Grounding retry ${round}`,
								priorPoint: latestFailureForModel?.attemptedPoint,
								priorBox: latestFailureForModel?.attemptedBox,
								rejectionReason: latestFailureForModel?.summary,
							})
							: undefined;
					if (shouldGenerateGuide) {
						roundTiming.guideImageMs = Math.round(performance.now() - guideStart);
					}
					if (guideImage) {
						cleanupFns.push(guideImage.cleanup);
					}
					const guideLoaded = guideImage
						? await loadImageSource(guideImage.imagePath, DEFAULT_MAX_GROUNDING_IMAGE_BYTES)
						: undefined;
					const predictStart = performance.now();
					const predictionText = await options.invokeModel({
						stage: "predict",
						prompt: buildGroundingPrompt({
							target: params.target,
							scope: params.scope,
							app: params.app,
								width: modelFrame.frame.width,
								height: modelFrame.frame.height,
								systemPrompt: options.systemPrompt,
								groundingMode: params.groundingMode,
								action: params.action,
								locationHint: params.locationHint,
								captureMode: params.captureMode,
							windowTitle: params.windowTitle,
							relatedTarget: params.relatedTarget,
							relatedScope: params.relatedScope,
							relatedAction: params.relatedAction,
							relatedLocationHint: params.relatedLocationHint,
							relatedPoint: scalePointToModelFrame(params.relatedPoint, modelFrame),
							relatedBox: scaleBoxToModelFrame(params.relatedBox, modelFrame),
							retryNotes,
							previousFailures: retryFailuresForModel,
							hasGuideImage: Boolean(guideLoaded),
						}),
						images: [
							{ bytes: modelFrame.frame.bytes, mimeType: modelFrame.frame.mimeType },
							...(guideLoaded
								? [{ bytes: guideLoaded.bytes, mimeType: guideLoaded.probe.mimeType }]
								: []),
						],
					});
					roundTiming.predictModelMs = Math.round(performance.now() - predictStart);
						const decision = parseGroundingDecision({
							payload: extractJsonObjectGrounding(predictionText),
							providerName: options.providerName,
							action: params.action,
						});
					if (!decision || decision.status === "not_found") {
						return finalize(undefined);
					}
					const resolved = normalizeResolvedAttempt({
						decision,
						frame: modelFrame,
						providerName: options.providerName,
						round,
						action: params.action,
					});
					if (!resolved) {
						return finalize(undefined);
					}
					let candidateForValidation = resolved;
					if (shouldUseHighResolutionRefinement({
						request: params,
						resolved,
						frame: modelFrame,
					})) {
						const refinementImageStart = performance.now();
						const refinementFrame = await createPreparedCropFrame({
							fullFrame,
							request: params,
							candidate: resolved,
							prepareModelFrameImpl,
						});
						roundTiming.refinementImageMs = Math.round(performance.now() - refinementImageStart);
						if (refinementFrame) {
							const priorRefinementPoint = scalePointToModelFrame(resolved.point, refinementFrame);
							const priorRefinementBox = scaleBoxToModelFrame(resolved.box, refinementFrame);
							const refinementModelStart = performance.now();
							const refinementText = await options.invokeModel({
								stage: "predict",
								prompt: buildGroundingRefinementPrompt({
									target: params.target,
									scope: params.scope,
										app: params.app,
										width: refinementFrame.frame.width,
										height: refinementFrame.frame.height,
										action: params.action,
										locationHint: params.locationHint,
									windowTitle: params.windowTitle,
									captureMode: params.captureMode,
									priorPoint: priorRefinementPoint,
									priorBox: priorRefinementBox,
								}),
								images: [{ bytes: refinementFrame.frame.bytes, mimeType: refinementFrame.frame.mimeType }],
							});
							roundTiming.refinementModelMs = Math.round(performance.now() - refinementModelStart);
							const refinementDecision = parseGroundingDecision({
								payload: extractJsonObjectGrounding(refinementText),
								providerName: options.providerName,
								action: params.action,
							});
							if (refinementDecision?.status === "resolved") {
								const refined = normalizeResolvedAttempt({
									decision: refinementDecision,
									frame: refinementFrame,
									providerName: options.providerName,
									round,
									action: params.action,
								});
								if (refined) {
									candidateForValidation = withResolvedAttemptMetadata(refined, {
										grounding_refinement_applied: true,
										grounding_refinement_crop: {
											x: refinementFrame.offsetX,
											y: refinementFrame.offsetY,
											width: refinementFrame.originalWidth ?? refinementFrame.frame.width,
											height: refinementFrame.originalHeight ?? refinementFrame.frame.height,
										},
										grounding_refinement_model_image: {
											width: refinementFrame.frame.width,
											height: refinementFrame.frame.height,
											mimeType: refinementFrame.frame.mimeType,
											wasResized: refinementFrame.wasResized,
										},
									});
								}
							}
						}
					}
					const validationPlan = shouldValidateResolvedCandidate({ request: params });
					if (!validationPlan.required) {
						roundTiming.validationSkippedReason = validationPlan.reason;
						return finalize(toPublicPredictedGroundingResult(candidateForValidation, validationPlan.reason));
					}
					roundTiming.validationTriggered = true;
					const simulationStart = performance.now();
					const simulationImage =
						modelFrame.frame.width && modelFrame.frame.height
							? await simulationImageImpl({
								sourceBytes: modelFrame.frame.bytes,
								sourceMimeType: modelFrame.frame.mimeType,
								width: modelFrame.frame.width,
								height: modelFrame.frame.height,
								action: params.action,
								point: scalePointToModelFrame(candidateForValidation.point, modelFrame),
								box: scaleBoxToModelFrame(candidateForValidation.box, modelFrame),
								target: params.target,
							})
							: undefined;
					roundTiming.simulationImageMs = Math.round(performance.now() - simulationStart);
					if (!simulationImage) {
						return finalize(undefined);
					}
					cleanupFns.push(simulationImage.cleanup);
					const simulationLoaded = await loadImageSource(
						simulationImage.imagePath,
						DEFAULT_MAX_GROUNDING_IMAGE_BYTES,
					);
					const validateStart = performance.now();
					const validationText = await options.invokeModel({
						stage: "validate",
						prompt: buildGroundingValidationPrompt({
							target: params.target,
							action: params.action,
							scope: params.scope,
							app: params.app,
							width: modelFrame.frame.width,
								height: modelFrame.frame.height,
								locationHint: params.locationHint,
								windowTitle: params.windowTitle,
								captureMode: params.captureMode,
								round,
							}),
						images: [
							{ bytes: modelFrame.frame.bytes, mimeType: modelFrame.frame.mimeType },
							{ bytes: simulationLoaded.bytes, mimeType: simulationLoaded.probe.mimeType },
						],
					});
					roundTiming.validateModelMs = Math.round(performance.now() - validateStart);
					const validation = parseGroundingValidationResponseText(validationText);
					if (validation?.approved) {
						return finalize(toPublicGroundingResult(candidateForValidation, validation));
					}
					const failureKind = validation?.failureKind
						?? inferGroundingFailureKind({
							reason: validation?.reason,
							retryHint: validation?.retryHint,
						});

					retryNotes = [
						...retryNotes,
						...buildRetryNotesFromDecision({
							round,
							reason: candidateForValidation.reason,
						}),
							...buildRetryNotesFromValidation({
								round,
								reason: validation?.reason ?? "validator rejected the simulated action",
								failureKind,
								retryHint: validation?.retryHint,
								action: params.action,
							}),
						];
						retryFailures.push({
							summary: validation?.retryHint?.trim() || validation?.reason || "validator rejected the simulated action",
							failureKind,
							attemptedPoint: candidateForValidation.point,
							attemptedBox: candidateForValidation.box,
						});
				}
				return finalize(undefined);
			} finally {
				await Promise.allSettled(cleanupFns.splice(0).map((cleanup) => cleanup()));
			}
		},
	};
}

export function createResponsesApiGroundingProvider(
	options: ResponsesApiGroundingProviderOptions,
): GuiGroundingProvider {
	const apiKey = options.apiKey?.trim();
	if (!apiKey) {
		throw new Error(`${options.providerName} grounding provider requires an API key.`);
	}
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = Math.max(1_000, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
	const maxOutputTokens = Math.max(64, Math.floor(options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS));

	const invokeModel: GroundingModelRunner = async (params) => {
		let lastError: Error | undefined;
		for (let attempt = 1; attempt <= MODEL_REQUEST_MAX_ATTEMPTS; attempt += 1) {
			const controller = new AbortController();
			const requestTimeout = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const response = await fetchImpl(options.baseUrl, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model: options.model,
						max_output_tokens: maxOutputTokens,
						...(options.reasoningEffort
							? {
								reasoning: {
									effort: options.reasoningEffort,
									summary: "auto",
								},
							}
							: {}),
						input: [
							{
								role: "user",
								content: [
									...params.images.map((image) => ({
										type: "input_image",
										image_url: buildDataUrl(image.mimeType, image.bytes),
										...(options.inputImageDetail
											? { detail: options.inputImageDetail }
											: {}),
									})),
									{
										type: "input_text",
										text: params.prompt,
									},
								],
							},
						],
					}),
					signal: controller.signal,
				});
				const payload = await response.json().catch(() => ({}));
				if (!response.ok) {
					const message =
						asString(asRecord(asRecord(payload)?.error)?.message) ||
						extractResponseText(payload) ||
						`HTTP ${response.status}`;
					throw new Error(`${options.providerName} grounding request failed: ${message}`);
				}
				const responseText = extractResponseText(payload);
				if (!responseText.trim()) {
					throw new Error(`${options.providerName} grounding response was empty`);
				}
				return responseText;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				if (attempt >= MODEL_REQUEST_MAX_ATTEMPTS || isNonRetryableModelRequestError(lastError)) {
					throw lastError;
				}
				await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
			} finally {
				clearTimeout(requestTimeout);
			}
		}
		throw lastError ?? new Error(`${options.providerName} grounding request failed: empty response`);
	};

	return createModelLoopGroundingProvider({
		providerName: options.providerName,
		systemPrompt: options.systemPrompt,
		guideImageImpl: options.guideImageImpl,
		simulationImageImpl: options.simulationImageImpl,
		prepareModelFrameImpl: options.prepareModelFrameImpl,
		invokeModel,
	});
}
