import { Type, type Static, type TSchema } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import {
	ComputerUseGuiRuntime,
	type GuiActionResult,
	type GuiEnvironmentReadinessSnapshot,
	type GuiGroundingProvider,
	type GuiRuntimeCapabilitySnapshot,
	type GuiToolName,
} from "@understudy/gui";
import { asString, asNumber, asBoolean } from "@understudy/core";
import { createOpenAIGroundingProvider } from "./openai-grounding-provider.js";
import { textResult } from "./bridge/bridge-rpc.js";

const GUI_SCOPE_DESCRIPTION =
	'Optional visible container hint such as a window title, panel name, dialog name, or region. ' +
	'Examples: "Save As dialog", "left sidebar", "Inspector panel", "macOS top menu bar", "Export Options sheet". ' +
	'When a modal dialog is open, use the dialog name as scope. ' +
	'Prefer concrete on-screen labels over abstract task phrasing (e.g. \'panel titled "Inspector"\' not "the area where I need to change the font"). ' +
	'Avoid invisible structural labels like "footer" or "card" unless that wording is itself visible.';
const GUI_CAPTURE_MODE_DESCRIPTION =
	'Optional capture surface hint. Use "window" for the active app window or dialog, and "display" for desktop-wide surfaces like the menu bar, Dock, desktop, Spotlight, notification banners, system permission prompts, or cross-window interactions (e.g. dragging a file from Finder to another app). When in doubt, prefer "window" for in-app work and "display" when the target is outside any single window.';
const GUI_WINDOW_TITLE_DESCRIPTION =
	"Optional exact visible window title to capture before grounding, for example \"Export\" or \"New Message\". Use this when the app has multiple open windows. For windows with dynamic titles that include document names (e.g. \"report.pdf - Preview\"), prefer using windowSelector.titleContains instead.";
const GUI_WINDOW_SELECTOR_DESCRIPTION =
	"Optional visible window selector for multi-window apps. Use exact title, titleContains, and/or a 1-based index when the visible window identity matters.";
const GUI_TARGET_DESCRIPTION_SUFFIX =
	'Describe visible evidence only — always ground on what the screenshot actually shows. ' +
	'When a control displays visible text or a label, QUOTE that text in the target, e.g. \'button labeled "Save"\', \'menu item "Export as PDF"\', \'tab titled "Settings"\'. ' +
	'When a control shows an icon instead of text, describe the icon shape, e.g. \'gear icon button\', \'magnifying glass icon in the toolbar\', \'red circular close button\'. ' +
	'For items in a list, table, tree, or sidebar, include the distinguishing row/cell text, e.g. \'the row containing "report.pdf"\', \'sidebar item "Downloads"\', \'cell showing "$150.00"\'. ' +
	'For text fields, reference placeholder text or existing content, e.g. \'search field with placeholder "Search..."\', \'the text field currently showing "hello world"\'. ' +
	'When a control has visual state, describe it: \'the selected "Network" tab\', \'disabled "Save" button\', \'checked "Auto-save" checkbox\', \'the active toggle next to "Dark mode"\'. ' +
	'For status indicators and badges, include the indicator: \'"Messages" icon with red badge showing "3"\', \'green dot next to "Online"\'. ' +
	'For empty-area or background targets (e.g. right-clicking blank space), describe the region: \'the empty desktop area\', \'blank area below the last file in the list\', \'the empty canvas\'. ' +
	'Include role (button, checkbox, toggle, slider, input field, link, menu item, etc.), nearby context, and coarse location when they help disambiguate. ' +
	'Name the actionable or editable surface itself, not surrounding whitespace, wallpaper, or generic container chrome — except when the blank/empty region IS the intended target. ' +
	'For click-like actions, prefer the clickable/selectable control itself (button, menu item, tab, icon button, row, checkbox, slider handle, editable field). ' +
	'For text entry, prefer the editable field/interior itself. ' +
	'Avoid hidden IDs, accessibility-only labels, or implementation terms the screenshot does not show.';
const GUI_LOCATION_HINT_DESCRIPTION =
	'Optional coarse location hint for the same target, such as "top-left menu bar", "right-side toolbar", or "bottom-right dialog area". Use this for rough screen region or spatial relation, not for the main visible label.';
const GUI_GROUNDING_MODE_DESCRIPTION =
	'Optional grounding strategy. Use "single" for straightforward targets and "complex" when the visible target is ambiguous, high-risk, or a prior attempt on the same visible target failed.';

const GuiWindowSelectorSchema = Type.Object({
	title: Type.Optional(Type.String({ description: "Optional exact visible window title." })),
	titleContains: Type.Optional(Type.String({ description: "Optional visible substring of the target window title." })),
	index: Type.Optional(Type.Number({ description: "Optional 1-based index among matching visible windows." })),
}, { description: GUI_WINDOW_SELECTOR_DESCRIPTION });

const GuiWindowSelectionFields = {
	windowTitle: Type.Optional(Type.String({ description: GUI_WINDOW_TITLE_DESCRIPTION })),
	windowSelector: Type.Optional(GuiWindowSelectorSchema),
};

const GuiObserveSchema = Type.Object({
	app: Type.Optional(Type.String({ description: "Optional macOS application name to observe. Defaults to the frontmost app." })),
	target: Type.Optional(Type.String({ description: `Optional semantic target to resolve within the observed UI. Quote visible text when present, e.g. 'button labeled "Submit"', 'sidebar item "Inbox"', 'the row containing "2024-03-11"'. ${GUI_TARGET_DESCRIPTION_SUFFIX}` })),
	groundingMode: Type.Optional(Type.Union([
		Type.Literal("single"),
		Type.Literal("complex"),
	], { description: GUI_GROUNDING_MODE_DESCRIPTION })),
	locationHint: Type.Optional(Type.String({ description: GUI_LOCATION_HINT_DESCRIPTION })),
	scope: Type.Optional(Type.String({ description: GUI_SCOPE_DESCRIPTION })),
	captureMode: Type.Optional(Type.Union([
		Type.Literal("window"),
		Type.Literal("display"),
	], { description: GUI_CAPTURE_MODE_DESCRIPTION })),
	...GuiWindowSelectionFields,
	returnImage: Type.Optional(Type.Boolean({ description: "Whether to return the screenshot image. Default: true." })),
});

const GuiClickSchema = Type.Object({
	app: Type.Optional(Type.String({ description: "Optional macOS application name to act on. Defaults to the frontmost app." })),
	target: Type.Optional(Type.String({ description: `Semantic GUI target to click. Quote the visible text on the control, e.g. 'button labeled "Save"', 'menu item "Export as PDF"', 'tab titled "Settings"', 'link "Learn more"', 'checkbox labeled "Remember me"'. For icon-only controls describe the icon, e.g. 'gear icon button', 'red close button'. ${GUI_TARGET_DESCRIPTION_SUFFIX}` })),
	groundingMode: Type.Optional(Type.Union([
		Type.Literal("single"),
		Type.Literal("complex"),
	], { description: GUI_GROUNDING_MODE_DESCRIPTION })),
	locationHint: Type.Optional(Type.String({ description: GUI_LOCATION_HINT_DESCRIPTION })),
	scope: Type.Optional(Type.String({ description: GUI_SCOPE_DESCRIPTION })),
	captureMode: Type.Optional(Type.Union([
		Type.Literal("window"),
		Type.Literal("display"),
	], { description: GUI_CAPTURE_MODE_DESCRIPTION })),
	...GuiWindowSelectionFields,
	button: Type.Optional(Type.Union([
		Type.Literal("left"),
		Type.Literal("right"),
		Type.Literal("none"),
	], { description: 'Mouse button. "left" for normal click, "right" for context menu, "none" for hover only. Default: "left".' })),
	clicks: Type.Optional(Type.Number({ description: "Number of clicks. Use 2 for double-click. Default: 1." })),
	holdMs: Type.Optional(Type.Number({ description: "Press-and-hold duration in milliseconds before releasing. Use for long-press affordances." })),
	settleMs: Type.Optional(Type.Number({ description: "Hover settle time in milliseconds (only used when button is \"none\"). Default: 200." })),
});

const GuiDragSchema = Type.Object({
	app: Type.Optional(Type.String({ description: "Optional macOS application name to act on. Defaults to the frontmost app." })),
	fromTarget: Type.Optional(Type.String({ description: `Semantic drag source. Quote visible text, e.g. 'file "Budget.csv"', 'layer labeled "Layer 1"', 'the card titled "Todo"'. ${GUI_TARGET_DESCRIPTION_SUFFIX}` })),
	toTarget: Type.Optional(Type.String({ description: `Semantic drag destination. Quote visible text, e.g. 'folder labeled "Archive"', 'the "Done" column', 'Trash icon in the Dock'. For drop zones or blank areas: 'the empty area at the bottom of the file list', 'the drop zone between "Item A" and "Item B"'. For cross-window drags use captureMode: "display". ${GUI_TARGET_DESCRIPTION_SUFFIX}` })),
	groundingMode: Type.Optional(Type.Union([
		Type.Literal("single"),
		Type.Literal("complex"),
	], { description: GUI_GROUNDING_MODE_DESCRIPTION })),
	fromLocationHint: Type.Optional(Type.String({ description: GUI_LOCATION_HINT_DESCRIPTION })),
	toLocationHint: Type.Optional(Type.String({ description: GUI_LOCATION_HINT_DESCRIPTION })),
	fromScope: Type.Optional(Type.String({ description: GUI_SCOPE_DESCRIPTION })),
	toScope: Type.Optional(Type.String({ description: GUI_SCOPE_DESCRIPTION })),
	captureMode: Type.Optional(Type.Union([
		Type.Literal("window"),
		Type.Literal("display"),
	], { description: GUI_CAPTURE_MODE_DESCRIPTION })),
	...GuiWindowSelectionFields,
	durationMs: Type.Optional(Type.Number({ description: "Optional drag duration in milliseconds. Longer drags can help flaky UIs." })),
});

const GuiScrollSchema = Type.Object({
	app: Type.Optional(Type.String({ description: "Optional macOS application name to act on. Defaults to the frontmost app." })),
	target: Type.Optional(Type.String({ description: `Optional semantic scroll target — name the scrollable CONTAINER or content area, not just a heading within it. E.g. 'the message list below "Inbox"', 'the scrollable panel containing the file list', 'the code editor area showing "main.ts"', 'the document body'. Omit this for the common case where you just want to keep scrolling the current surface. ${GUI_TARGET_DESCRIPTION_SUFFIX}` })),
	groundingMode: Type.Optional(Type.Union([
		Type.Literal("single"),
		Type.Literal("complex"),
	], { description: GUI_GROUNDING_MODE_DESCRIPTION })),
	locationHint: Type.Optional(Type.String({ description: GUI_LOCATION_HINT_DESCRIPTION })),
	scope: Type.Optional(Type.String({ description: GUI_SCOPE_DESCRIPTION })),
	captureMode: Type.Optional(Type.Union([
		Type.Literal("window"),
		Type.Literal("display"),
	], { description: GUI_CAPTURE_MODE_DESCRIPTION })),
	...GuiWindowSelectionFields,
	direction: Type.Optional(Type.Union([
		Type.Literal("up"),
		Type.Literal("down"),
		Type.Literal("left"),
		Type.Literal("right"),
	], { description: 'Scroll direction. Default: "down".' })),
	distance: Type.Optional(Type.Union([
		Type.Literal("small"),
		Type.Literal("medium"),
		Type.Literal("page"),
	], { description: 'Semantic scroll distance. Default: "page" for targetless scrolls and "medium" for grounded container scrolls. `page` aims to preserve some on-screen overlap instead of jumping a full viewport.' })),
	amount: Type.Optional(Type.Number({ description: "Advanced low-level override for scroll notches or lines. When provided, this overrides `distance` and uses legacy line-based scrolling." })),
});

const GuiTypeSchema = Type.Object({
	app: Type.Optional(Type.String({ description: "Optional macOS application name to act on. Defaults to the frontmost app." })),
	target: Type.Optional(Type.String({ description: `Semantic input target. Name the editable field with visible evidence, e.g. 'input field with placeholder "Search..."', 'the "Subject" text field', 'text area currently showing "Dear team,"', 'empty "Email" field'. If omitted, type into the currently focused control. ${GUI_TARGET_DESCRIPTION_SUFFIX}` })),
	groundingMode: Type.Optional(Type.Union([
		Type.Literal("single"),
		Type.Literal("complex"),
	], { description: GUI_GROUNDING_MODE_DESCRIPTION })),
	locationHint: Type.Optional(Type.String({ description: GUI_LOCATION_HINT_DESCRIPTION })),
	scope: Type.Optional(Type.String({ description: GUI_SCOPE_DESCRIPTION })),
	captureMode: Type.Optional(Type.Union([
		Type.Literal("window"),
		Type.Literal("display"),
	], { description: GUI_CAPTURE_MODE_DESCRIPTION })),
	...GuiWindowSelectionFields,
	value: Type.String({ description: "Text to type into the target GUI control." }),
	replace: Type.Optional(Type.Boolean({ description: "Whether to replace the existing field value before typing. Default: true." })),
	submit: Type.Optional(Type.Boolean({ description: "Whether to press Return after typing." })),
});

const GuiKeySchema = Type.Object({
	app: Type.Optional(Type.String({ description: "Optional macOS application name to activate before pressing the key." })),
	key: Type.String({ description: 'Key to press. Examples: "Enter", "Tab", "Escape", "Space", "Backspace", "Delete", "ArrowDown", "s" (for Cmd+S when combined with modifiers).' }),
	modifiers: Type.Optional(Type.Array(Type.String({ description: 'Modifier names such as "command", "shift", "option", or "control".' }))),
	repeat: Type.Optional(Type.Number({ description: "How many times to press the key. Default: 1." })),
	captureMode: Type.Optional(Type.Union([
		Type.Literal("window"),
		Type.Literal("display"),
	], { description: GUI_CAPTURE_MODE_DESCRIPTION })),
	...GuiWindowSelectionFields,
});

const GuiMoveSchema = Type.Object({
	x: Type.Number({ description: "Absolute display X coordinate to move the cursor to." }),
	y: Type.Number({ description: "Absolute display Y coordinate to move the cursor to." }),
	app: Type.Optional(Type.String({ description: "Optional macOS application name to activate before moving." })),
});

const GuiWaitSchema = Type.Object({
	app: Type.Optional(Type.String({ description: "Optional macOS application name to observe. Defaults to the frontmost app." })),
	target: Type.String({ description: `Semantic target to wait for. Quote visible text, e.g. 'progress bar labeled "Uploading..."', 'button labeled "Done"', 'spinner next to "Loading"', 'dialog titled "Export Complete"'. ${GUI_TARGET_DESCRIPTION_SUFFIX}` }),
	groundingMode: Type.Optional(Type.Union([
		Type.Literal("single"),
		Type.Literal("complex"),
	], { description: GUI_GROUNDING_MODE_DESCRIPTION })),
	locationHint: Type.Optional(Type.String({ description: GUI_LOCATION_HINT_DESCRIPTION })),
	scope: Type.Optional(Type.String({ description: GUI_SCOPE_DESCRIPTION })),
	captureMode: Type.Optional(Type.Union([
		Type.Literal("window"),
		Type.Literal("display"),
	], { description: GUI_CAPTURE_MODE_DESCRIPTION })),
	...GuiWindowSelectionFields,
	state: Type.Optional(Type.Union([
		Type.Literal("appear"),
		Type.Literal("disappear"),
	], { description: 'Wait condition: "appear" or "disappear". Default: "appear".' })),
	timeoutMs: Type.Optional(Type.Number({ description: "Maximum wait time in milliseconds." })),
	intervalMs: Type.Optional(Type.Number({ description: "Polling interval in milliseconds." })),
});

type GuiObserveParams = Static<typeof GuiObserveSchema>;
type GuiClickParams = Static<typeof GuiClickSchema>;
type GuiDragParams = Static<typeof GuiDragSchema>;
type GuiScrollParams = Static<typeof GuiScrollSchema>;
type GuiTypeParams = Static<typeof GuiTypeSchema>;
type GuiKeyParams = Static<typeof GuiKeySchema>;
type GuiWaitParams = Static<typeof GuiWaitSchema>;
type GuiMoveParams = Static<typeof GuiMoveSchema>;

function withGuiDetails(result: GuiActionResult): Record<string, unknown> {
	return {
		observation: result.observation,
		resolution: result.resolution,
		status: result.status,
		...result.details,
	};
}

function toolMetadataLines(details: Record<string, unknown>): string[] {
	if (details.grounding_method !== "grounding") {
		return [];
	}
	const parts: string[] = [];
	const mode =
		asString(details.grounding_mode_effective) ??
		asString(details.grounding_mode_requested);
	if (mode) {
		parts.push(`mode=${mode}`);
	}
	const attempt = asString(details.grounding_selected_attempt);
	if (attempt) {
		parts.push(`attempt=${attempt}`);
	}
	const validationTriggered = asBoolean(details.grounding_validation_triggered);
	if (validationTriggered !== undefined) {
		parts.push(`validate=${validationTriggered ? "on" : "off"}`);
	}
	const rounds = asNumber(details.grounding_rounds_attempted);
	if (rounds !== undefined) {
		parts.push(`rounds=${rounds}`);
	}
	const totalMs = asNumber(details.grounding_total_ms);
	if (totalMs !== undefined) {
		parts.push(`total=${Math.round(totalMs)}ms`);
	}
	const modelMs = asNumber(details.grounding_model_ms);
	if (modelMs !== undefined) {
		parts.push(`model=${Math.round(modelMs)}ms`);
	}
	const overheadMs = asNumber(details.grounding_overhead_ms);
	if (overheadMs !== undefined) {
		parts.push(`overhead=${Math.round(overheadMs)}ms`);
	}
	if (parts.length === 0) {
		return [];
	}
	const reason =
		asString(details.grounding_validation_reason) ??
		asString(details.grounding_resolution_error);
	return [
		`[grounding] ${parts.join(" ")}`,
		...(reason ? [`[grounding] reason=${reason}`] : []),
	];
}

function toToolResult(result: GuiActionResult): AgentToolResult<unknown> {
	const details = withGuiDetails(result);
	const metadataLines = toolMetadataLines(details);
	if (result.image) {
		return toScreenshotToolResult(result, details, metadataLines);
	}
	return {
		content: [
			{ type: "text", text: result.text },
			...metadataLines.map((text) => ({ type: "text" as const, text })),
		],
		details,
	};
}

function toScreenshotToolResult(
	result: GuiActionResult,
	precomputedDetails?: Record<string, unknown>,
	precomputedMetadataLines?: string[],
): AgentToolResult<unknown> {
	if (!result.image) {
		return toToolResult(result);
	}
	const details = precomputedDetails ?? withGuiDetails(result);
	const metadataLines = precomputedMetadataLines ?? toolMetadataLines(details);
	return {
		content: [
			{ type: "text", text: result.text },
			...metadataLines.map((text) => ({ type: "text" as const, text })),
			{ type: "image", data: result.image.data, mimeType: result.image.mimeType } as any,
		],
		details,
	};
}

function wrapGuiErrors(
	label: string,
	error: unknown,
	fallback: Record<string, unknown> = {},
): AgentToolResult<unknown> {
	const message = error instanceof Error ? error.message : String(error);
	return textResult(`${label} failed: ${message}`, {
		error: message,
		grounding_method: "grounding",
		...fallback,
	});
}

export function createGuiRuntime(options: {
	groundingProvider?: GuiGroundingProvider;
	environmentReadiness?: GuiEnvironmentReadinessSnapshot;
} = {}): ComputerUseGuiRuntime {
	return new ComputerUseGuiRuntime({
		groundingProvider: options.groundingProvider,
		environmentReadiness: options.environmentReadiness,
	});
}

let sharedDefaultGuiRuntime: ComputerUseGuiRuntime | undefined;

export function setDefaultGuiRuntime(runtime: ComputerUseGuiRuntime | undefined): void {
	sharedDefaultGuiRuntime = runtime;
}

export function createDefaultGuiRuntime(): ComputerUseGuiRuntime {
	if (sharedDefaultGuiRuntime) {
		return sharedDefaultGuiRuntime;
	}
	const autoApiKey = process.env.UNDERSTUDY_GUI_GROUNDING_API_KEY?.trim();
	const autoModel = process.env.UNDERSTUDY_GUI_GROUNDING_MODEL?.trim();
	const explicitOpenAI = autoApiKey
		? createOpenAIGroundingProvider({
			apiKey: autoApiKey,
			model: autoModel,
			baseUrl: process.env.UNDERSTUDY_GUI_GROUNDING_BASE_URL?.trim(),
			providerName: process.env.UNDERSTUDY_GUI_GROUNDING_PROVIDER?.trim() || undefined,
		})
		: undefined;
	return new ComputerUseGuiRuntime({
		groundingProvider: explicitOpenAI,
	});
}

type GuiRuntimeMethod =
	| "observe"
	| "click"
	| "drag"
	| "scroll"
	| "type"
	| "key"
	| "wait"
	| "move";

type GuiRuntimeWithCapabilities = ComputerUseGuiRuntime & {
	describeCapabilities?(platform?: NodeJS.Platform): GuiRuntimeCapabilitySnapshot;
};

interface GuiToolRuntimeMap {
	observe: (params: GuiObserveParams, signal?: AbortSignal) => Promise<GuiActionResult>;
	click: (params: GuiClickParams, signal?: AbortSignal) => Promise<GuiActionResult>;
	drag: (params: GuiDragParams, signal?: AbortSignal) => Promise<GuiActionResult>;
	scroll: (params: GuiScrollParams, signal?: AbortSignal) => Promise<GuiActionResult>;
	type: (params: GuiTypeParams, signal?: AbortSignal) => Promise<GuiActionResult>;
	key: (params: GuiKeyParams, signal?: AbortSignal) => Promise<GuiActionResult>;
	wait: (params: GuiWaitParams, signal?: AbortSignal) => Promise<GuiActionResult>;
	move: (params: GuiMoveParams, signal?: AbortSignal) => Promise<GuiActionResult>;
}

function buildGuiProgressResult(text: string, details: Record<string, unknown> = {}): AgentToolResult<unknown> {
	return textResult(text, {
		progress: true,
		...details,
	});
}

function createGuiHeartbeat<TParams extends { app?: string }>(params: {
	label: string;
	actionTarget?: string;
	args: TParams;
	onUpdate?: (partialResult: AgentToolResult<unknown>) => void;
}): () => void {
	const appName = params.args.app?.trim();
	const actionTarget = params.actionTarget?.trim();
	const base = [
		params.label,
		actionTarget ? `target "${actionTarget}"` : undefined,
		appName ? `app ${appName}` : undefined,
	].filter(Boolean).join(" on ");

	params.onUpdate?.(buildGuiProgressResult(
		`${base}. Resolving and executing the GUI action.`,
		{ stage: "start" },
	));

	const heartbeat = setInterval(() => {
		params.onUpdate?.(buildGuiProgressResult(`${base}. Still working.`, { stage: "heartbeat" }));
	}, 3_000);

	return () => clearInterval(heartbeat);
}

function trimToUndefined(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function createGuiAbortError(signal?: AbortSignal): Error {
	if (signal?.reason instanceof Error) {
		return signal.reason;
	}
	if (typeof DOMException !== "undefined") {
		return new DOMException("The operation was aborted.", "AbortError");
	}
	const error = new Error("The operation was aborted.");
	error.name = "AbortError";
	return error;
}

async function raceGuiRuntimeWithSignal<T>(
	runtimePromise: Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	if (!signal) {
		return runtimePromise;
	}
	if (signal.aborted) {
		void runtimePromise.catch(() => {});
		throw createGuiAbortError(signal);
	}

	let onAbort: (() => void) | undefined;
	const abortPromise = new Promise<never>((_, reject) => {
		onAbort = () => {
			void runtimePromise.catch(() => {});
			reject(createGuiAbortError(signal));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});

	try {
		return await Promise.race([runtimePromise, abortPromise]);
	} finally {
		if (onAbort) {
			signal.removeEventListener("abort", onAbort);
		}
	}
}

function throwIfGuiSignalAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw createGuiAbortError(signal);
	}
}

function resolveGuiCapabilities(
	runtime: GuiRuntimeWithCapabilities,
): GuiRuntimeCapabilitySnapshot | undefined {
	return typeof runtime.describeCapabilities === "function"
		? runtime.describeCapabilities()
		: undefined;
}

function buildUnavailableGuiToolResult(
	label: string,
	reason: string,
	details: Record<string, unknown> = {},
): AgentToolResult<unknown> {
	return textResult(`${label} unavailable: ${reason}`, {
		status: {
			code: "unsupported",
			summary: reason,
		},
		grounding_method: "grounding",
		unavailable: true,
		...details,
	});
}

function buildTargetlessOnlyReason(toolName: GuiToolName): string {
	switch (toolName) {
		case "gui_observe":
			return "Configure GUI grounding to resolve a visual target, or omit `target` and capture the current surface.";
		case "gui_scroll":
			return "Configure GUI grounding to scroll a named visual target, or omit `target` and scroll the current surface.";
		case "gui_type":
			return "Configure GUI grounding to resolve an input target, or omit `target` and type into the currently focused control.";
		default:
			return "Configure GUI grounding before using this GUI tool with a visual target.";
	}
}

type CapabilityGuard<TParams> = (params: TParams, capability: GuiRuntimeCapabilitySnapshot["toolAvailability"][GuiToolName]) => string | undefined;

function resolveTargetlessOnlyGuard(toolName: GuiToolName): CapabilityGuard<Record<string, unknown>> {
	return (params, capability) => {
		if (!capability?.targetlessOnly) {
			return undefined;
		}
		return trimToUndefined(params.target)
			? capability.reason ?? buildTargetlessOnlyReason(toolName)
			: undefined;
	};
}

function resolveGuiCapabilityError<TParams>(
	params: TParams,
	capabilities: GuiRuntimeCapabilitySnapshot | undefined,
	capability: GuiRuntimeCapabilitySnapshot["toolAvailability"][GuiToolName] | undefined,
	guard?: CapabilityGuard<TParams>,
): string | undefined {
	if (!capability) {
		return undefined;
	}
	if (!capability.enabled) {
		return capability.reason ?? "The current GUI runtime does not support this tool.";
	}
	return guard?.(params, capability);
}

interface CreateGuiToolOptions<TSchemaType extends TSchema> {
	name: GuiToolName;
	label: string;
	description: string;
	parameters: TSchemaType;
	method: GuiRuntimeMethod;
	progressLabel: string;
	errorLabel: string;
	actionTarget?: (params: Static<TSchemaType>) => string | undefined;
	argsForHeartbeat?: (params: Static<TSchemaType>) => { app?: string };
	guard?: CapabilityGuard<Static<TSchemaType>>;
	fallbackErrorDetails?: Record<string, unknown>;
	toResult?: (result: GuiActionResult) => AgentToolResult<unknown>;
	allowMidflightAbort?: boolean;
}

function createGuiTool<TSchemaType extends TSchema>(
	runtime: GuiRuntimeWithCapabilities,
	options: CreateGuiToolOptions<TSchemaType>,
): AgentTool<TSchemaType> {
	const runner = runtime as unknown as GuiRuntimeWithCapabilities & GuiToolRuntimeMap;
	return {
		name: options.name,
		label: options.label,
		description: options.description,
		parameters: options.parameters,
		execute: async (_toolCallId, params: Static<TSchemaType>, signal, onUpdate) => {
			const capabilities = resolveGuiCapabilities(runtime);
			const capability = capabilities?.toolAvailability[options.name];
			const capabilityError = resolveGuiCapabilityError(params, capabilities, capability, options.guard);
			if (capabilityError) {
				return buildUnavailableGuiToolResult(options.label, capabilityError, {
					tool: options.name,
					...(capability?.targetlessOnly ? { targetlessOnly: true } : {}),
				});
			}
			const stopHeartbeat = createGuiHeartbeat({
				label: options.progressLabel,
				actionTarget: options.actionTarget?.(params),
				args: options.argsForHeartbeat ? options.argsForHeartbeat(params) : (params as any),
				onUpdate,
			});
			try {
				throwIfGuiSignalAborted(signal);
				const invokeRuntime = runner[options.method] as (
					this: GuiRuntimeWithCapabilities & GuiToolRuntimeMap,
					args: Static<TSchemaType>,
					signal?: AbortSignal,
				) => Promise<GuiActionResult>;
				const runtimePromise = invokeRuntime.call(runner, params, signal);
				const result = options.allowMidflightAbort
					? await raceGuiRuntimeWithSignal(runtimePromise, signal)
					: await runtimePromise;
				return (options.toResult ?? toToolResult)(result);
			} catch (error) {
				if (error instanceof Error && error.name === "AbortError") {
					throw error;
				}
				return wrapGuiErrors(options.errorLabel, error, options.fallbackErrorDetails);
			} finally {
				stopHeartbeat();
			}
		},
	};
}

type GuiToolFactory = (runtime: GuiRuntimeWithCapabilities) => AgentTool<any>;
interface GuiToolFactoryEntry {
	name: GuiToolName;
	label: string;
	description: string;
	create: GuiToolFactory;
}

function defineGuiToolFactory<TSchemaType extends TSchema>(
	options: CreateGuiToolOptions<TSchemaType>,
): GuiToolFactoryEntry {
	return {
		name: options.name,
		label: options.label,
		description: options.description,
		create: (runtime) => createGuiTool(runtime, options),
	};
}

const GUI_TOOL_FACTORIES: GuiToolFactoryEntry[] = [
	defineGuiToolFactory({
		name: "gui_observe",
		label: "GUI Observe",
		description:
			"Capture the current GUI state as a visual snapshot. Optionally ground a target. " +
			"Use when you need to see what is on screen.",
		parameters: GuiObserveSchema,
		method: "observe",
		progressLabel: "GUI observe",
		errorLabel: "GUI observe",
		actionTarget: (params: GuiObserveParams) => params.target,
		guard: resolveTargetlessOnlyGuard("gui_observe") as CapabilityGuard<GuiObserveParams>,
		toResult: toScreenshotToolResult,
		allowMidflightAbort: true,
	}),
	defineGuiToolFactory({
		name: "gui_click",
		label: "GUI Click",
		description:
			"Click a visually grounded GUI target. " +
			"Use `button` to choose left/right/none(hover), `clicks: 2` for double-click, `holdMs` for press-and-hold. " +
			"Default is a single left click.",
		parameters: GuiClickSchema,
		method: "click",
		progressLabel: "GUI click",
		errorLabel: "GUI click",
		actionTarget: (params: GuiClickParams) => params.target,
	}),
	defineGuiToolFactory({
		name: "gui_drag",
		label: "GUI Drag",
		description:
			"Drag between two visually grounded GUI targets, for example moving a file, reordering a list item, or dropping onto Trash. " +
			"Use `groundingMode: \"complex\"` when either endpoint is ambiguous or a prior attempt failed.",
		parameters: GuiDragSchema,
		method: "drag",
		progressLabel: "GUI drag",
		errorLabel: "GUI drag",
		actionTarget: (params: GuiDragParams) => `${params.fromTarget ?? "source"} -> ${params.toTarget ?? "destination"}`,
	}),
	defineGuiToolFactory({
		name: "gui_scroll",
		label: "GUI Scroll",
		description:
			"Scroll the active surface or a visually grounded GUI region in a cardinal direction. " +
			"Omitting `target` is the common case when you just need to reveal more content.",
		parameters: GuiScrollSchema,
		method: "scroll",
		progressLabel: "GUI scroll",
		errorLabel: "GUI scroll",
		actionTarget: (params: GuiScrollParams) => params.target ?? `${params.direction ?? "down"} scroll`,
		guard: resolveTargetlessOnlyGuard("gui_scroll") as CapabilityGuard<GuiScrollParams>,
	}),
	defineGuiToolFactory({
		name: "gui_type",
		label: "GUI Type",
		description:
			"Type text into a visually grounded editable GUI field such as an input field or search box. " +
			"Name the editable field itself in `target`. " +
			"Use `replace=false` only when appending is intentional.",
		parameters: GuiTypeSchema,
		method: "type",
		progressLabel: "GUI type",
		errorLabel: "GUI type",
		actionTarget: (params: GuiTypeParams) => params.target ?? "focused control",
		guard: resolveTargetlessOnlyGuard("gui_type") as CapabilityGuard<GuiTypeParams>,
	}),
	defineGuiToolFactory({
		name: "gui_key",
		label: "GUI Key",
		description:
			"Send a keyboard shortcut or single key press. " +
			"Examples: gui_key(key:'s', modifiers:['command']) for Cmd+S, gui_key(key:'Enter') for Enter. " +
			"Does not require visual grounding.",
		parameters: GuiKeySchema,
		method: "key",
		progressLabel: "GUI key",
		errorLabel: "GUI key",
		actionTarget: (params: GuiKeyParams) =>
			[...(params.modifiers ?? []), params.key].filter(Boolean).join("+"),
	}),
	defineGuiToolFactory({
		name: "gui_wait",
		label: "GUI Wait",
		description:
			"Wait for a visually grounded GUI target to appear or disappear. " +
			"Use this after triggering UI work that completes asynchronously.",
		parameters: GuiWaitSchema,
		method: "wait",
		progressLabel: "GUI wait",
		errorLabel: "GUI wait",
		actionTarget: (params: GuiWaitParams) => params.target,
		argsForHeartbeat: (params: GuiWaitParams) => ({ app: params.app }),
		allowMidflightAbort: true,
	}),
	defineGuiToolFactory({
		name: "gui_move",
		label: "GUI Move",
		description:
			"Move the cursor to absolute display coordinates without clicking. " +
			"Use when you already know the exact pixel position.",
		parameters: GuiMoveSchema,
		method: "move",
		progressLabel: "GUI move",
		errorLabel: "GUI move",
		actionTarget: (params: GuiMoveParams) => `(${params.x}, ${params.y})`,
		argsForHeartbeat: (params: GuiMoveParams) => ({ app: params.app }),
	}),
];

export interface GuiToolCatalogEntry {
	name: GuiToolName;
	label: string;
	description: string;
}

export function listGuiToolCatalog(): GuiToolCatalogEntry[] {
	return GUI_TOOL_FACTORIES.map(({ name, label, description }) => ({
		name,
		label,
		description,
	}));
}

export function createGuiToolset(runtime: ComputerUseGuiRuntime = createDefaultGuiRuntime()): AgentTool<any>[] {
	const capabilities = resolveGuiCapabilities(runtime as GuiRuntimeWithCapabilities);
	return GUI_TOOL_FACTORIES
		.filter((entry) => {
			if (!capabilities) {
				return true;
			}
			return capabilities.toolAvailability[entry.name]?.enabled === true;
		})
		.map((entry) => entry.create(runtime as GuiRuntimeWithCapabilities));
}

export function createGuiObserveTool(runtime: ComputerUseGuiRuntime = createDefaultGuiRuntime()): AgentTool<typeof GuiObserveSchema> {
	return GUI_TOOL_FACTORIES.find((entry) => entry.name === "gui_observe")!.create(runtime as GuiRuntimeWithCapabilities) as AgentTool<typeof GuiObserveSchema>;
}

export function createGuiClickTool(runtime: ComputerUseGuiRuntime = createDefaultGuiRuntime()): AgentTool<typeof GuiClickSchema> {
	return GUI_TOOL_FACTORIES.find((entry) => entry.name === "gui_click")!.create(runtime as GuiRuntimeWithCapabilities) as AgentTool<typeof GuiClickSchema>;
}

export function createGuiDragTool(runtime: ComputerUseGuiRuntime = createDefaultGuiRuntime()): AgentTool<typeof GuiDragSchema> {
	return GUI_TOOL_FACTORIES.find((entry) => entry.name === "gui_drag")!.create(runtime as GuiRuntimeWithCapabilities) as AgentTool<typeof GuiDragSchema>;
}

export function createGuiScrollTool(runtime: ComputerUseGuiRuntime = createDefaultGuiRuntime()): AgentTool<typeof GuiScrollSchema> {
	return GUI_TOOL_FACTORIES.find((entry) => entry.name === "gui_scroll")!.create(runtime as GuiRuntimeWithCapabilities) as AgentTool<typeof GuiScrollSchema>;
}

export function createGuiTypeTool(runtime: ComputerUseGuiRuntime = createDefaultGuiRuntime()): AgentTool<typeof GuiTypeSchema> {
	return GUI_TOOL_FACTORIES.find((entry) => entry.name === "gui_type")!.create(runtime as GuiRuntimeWithCapabilities) as AgentTool<typeof GuiTypeSchema>;
}

export function createGuiKeyTool(runtime: ComputerUseGuiRuntime = createDefaultGuiRuntime()): AgentTool<typeof GuiKeySchema> {
	return GUI_TOOL_FACTORIES.find((entry) => entry.name === "gui_key")!.create(runtime as GuiRuntimeWithCapabilities) as AgentTool<typeof GuiKeySchema>;
}

export function createGuiWaitTool(runtime: ComputerUseGuiRuntime = createDefaultGuiRuntime()): AgentTool<typeof GuiWaitSchema> {
	return GUI_TOOL_FACTORIES.find((entry) => entry.name === "gui_wait")!.create(runtime as GuiRuntimeWithCapabilities) as AgentTool<typeof GuiWaitSchema>;
}

export function createGuiMoveTool(runtime: ComputerUseGuiRuntime = createDefaultGuiRuntime()): AgentTool<typeof GuiMoveSchema> {
	return GUI_TOOL_FACTORIES.find((entry) => entry.name === "gui_move")!.create(runtime as GuiRuntimeWithCapabilities) as AgentTool<typeof GuiMoveSchema>;
}
