export type GuiGroundingActionIntent =
	| "observe"
	| "click"
	| "right_click"
	| "double_click"
	| "hover"
	| "click_and_hold"
	| "drag"
	| "drag_source"
	| "drag_destination"
	| "scroll"
	| "type"
	| "key"
	| "wait"
	| "move";

export type GuiCaptureMode = "window" | "display";

export interface GuiWindowSelector {
	title?: string;
	titleContains?: string;
	index?: number;
}

export interface GuiObservation {
	platform: NodeJS.Platform;
	method: "screenshot";
	appName?: string;
	windowTitle?: string;
	capturedAt: number;
}

export interface GuiResolution {
	method: "grounding";
	confidence: number;
	reason: string;
}

export type GuiActionStatusCode =
	| "observed"
	| "resolved"
	| "not_found"
	| "action_sent"
	| "condition_met"
	| "timeout"
	| "unsupported";

export interface GuiActionStatus {
	code: GuiActionStatusCode;
	summary: string;
}

export interface GuiImagePayload {
	data: string;
	mimeType: string;
	filename?: string;
}

export interface GuiGroundingBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export type GuiGroundingCoordinateSpace = "image_pixels" | "display_pixels";
export type GuiGroundingMode = "single" | "complex";
export type GuiScrollDistance = "small" | "medium" | "page";
export type GuiGroundingFailureKind =
	| "wrong_region"
	| "scope_mismatch"
	| "wrong_control"
	| "wrong_point"
	| "state_mismatch"
	| "partial_visibility"
	| "other";

export function normalizeGuiGroundingMode(mode?: GuiGroundingMode): GuiGroundingMode {
	return mode === "complex" ? "complex" : "single";
}

export interface GuiGroundingFailure {
	summary: string;
	failureKind?: GuiGroundingFailureKind;
	attemptedPoint?: {
		x: number;
		y: number;
	};
	attemptedBox?: GuiGroundingBox;
}

export interface GuiGroundingRequest {
	imagePath: string;
	logicalImageWidth?: number;
	logicalImageHeight?: number;
	imageScaleX?: number;
	imageScaleY?: number;
	target: string;
	scope?: string;
	app?: string;
	action?: GuiGroundingActionIntent;
	groundingMode?: GuiGroundingMode;
	locationHint?: string;
	captureMode?: GuiCaptureMode;
	windowTitle?: string;
	relatedTarget?: string;
	relatedScope?: string;
	relatedAction?: GuiGroundingActionIntent;
	relatedLocationHint?: string;
	relatedPoint?: {
		x: number;
		y: number;
	};
	relatedBox?: GuiGroundingBox;
	previousFailures?: GuiGroundingFailure[];
}

export interface GuiGroundingResult {
	method: "grounding";
	provider: string;
	confidence: number;
	reason: string;
	coordinateSpace: GuiGroundingCoordinateSpace;
	point: {
		x: number;
		y: number;
	};
	box?: GuiGroundingBox;
	raw?: unknown;
}

export interface GuiGroundingProvider {
	ground(params: GuiGroundingRequest): Promise<GuiGroundingResult | undefined>;
}

export interface GuiObserveParams {
	app?: string;
	target?: string;
	groundingMode?: GuiGroundingMode;
	locationHint?: string;
	scope?: string;
	captureMode?: GuiCaptureMode;
	windowTitle?: string;
	windowSelector?: GuiWindowSelector;
	returnImage?: boolean;
}

export interface GuiClickParams {
	app?: string;
	target?: string;
	groundingMode?: GuiGroundingMode;
	locationHint?: string;
	scope?: string;
	captureMode?: GuiCaptureMode;
	windowTitle?: string;
	windowSelector?: GuiWindowSelector;
	button?: "left" | "right" | "none";
	clicks?: number;
	holdMs?: number;
	settleMs?: number;
}

export interface GuiDragParams {
	app?: string;
	fromTarget?: string;
	toTarget?: string;
	groundingMode?: GuiGroundingMode;
	fromLocationHint?: string;
	toLocationHint?: string;
	fromScope?: string;
	toScope?: string;
	captureMode?: GuiCaptureMode;
	windowTitle?: string;
	windowSelector?: GuiWindowSelector;
	durationMs?: number;
}

export interface GuiScrollParams {
	app?: string;
	target?: string;
	groundingMode?: GuiGroundingMode;
	locationHint?: string;
	scope?: string;
	captureMode?: GuiCaptureMode;
	windowTitle?: string;
	windowSelector?: GuiWindowSelector;
	direction?: "up" | "down" | "left" | "right";
	distance?: GuiScrollDistance;
	amount?: number;
}

export interface GuiTypeParams {
	app?: string;
	target?: string;
	groundingMode?: GuiGroundingMode;
	locationHint?: string;
	scope?: string;
	captureMode?: GuiCaptureMode;
	windowTitle?: string;
	windowSelector?: GuiWindowSelector;
	value?: string;
	secretEnvVar?: string;
	secretCommandEnvVar?: string;
	typeStrategy?:
		| "physical_keys"
		| "clipboard_paste"
		| "system_events_paste"
		| "system_events_keystroke"
		| "system_events_keystroke_chars";
	replace?: boolean;
	submit?: boolean;
}

export interface GuiKeyParams {
	app?: string;
	key: string;
	modifiers?: string[];
	repeat?: number;
	captureMode?: GuiCaptureMode;
	windowTitle?: string;
	windowSelector?: GuiWindowSelector;
}

export interface GuiWaitParams {
	app?: string;
	target: string;
	groundingMode?: GuiGroundingMode;
	locationHint?: string;
	scope?: string;
	captureMode?: GuiCaptureMode;
	windowTitle?: string;
	windowSelector?: GuiWindowSelector;
	state?: "appear" | "disappear";
	timeoutMs?: number;
	intervalMs?: number;
}

export interface GuiMoveParams {
	x: number;
	y: number;
	app?: string;
}

export interface GuiActionResult {
	text: string;
	observation?: GuiObservation;
	resolution?: GuiResolution;
	status: GuiActionStatus;
	details?: Record<string, unknown>;
	image?: GuiImagePayload;
}

export interface GuiDemonstrationRecorderOptions {
	outputDir: string;
	filePrefix?: string;
	displayIndex?: number;
	showClicks?: boolean;
	captureAudio?: boolean;
	maxDurationSec?: number;
	app?: string;
}

export interface GuiDemonstrationRecordingStatus {
	id: string;
	state: "recording" | "stopped" | "failed";
	startedAt: number;
	videoPath: string;
	eventLogPath: string;
	displayIndex?: number;
	app?: string;
}

export interface GuiDemonstrationRecordingArtifact extends GuiDemonstrationRecordingStatus {
	state: "stopped";
	stoppedAt: number;
	durationMs: number;
	summary: string;
}

export interface GuiDemonstrationRecordingSession {
	id: string;
	status(): GuiDemonstrationRecordingStatus;
	stop(): Promise<GuiDemonstrationRecordingArtifact>;
}

export interface GuiDemonstrationRecorder {
	start(options: GuiDemonstrationRecorderOptions): Promise<GuiDemonstrationRecordingSession>;
}
