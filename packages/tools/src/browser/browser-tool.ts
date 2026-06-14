/**
 * Browser automation tool using Playwright.
 * Provides a richer browser automation surface with:
 * snapshots with refs, ref-based actions, console/dialog hooks, screenshots, waits,
 * uploads, response capture, and PDF export.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DEFAULT_BROWSER_EXTENSION_CDP_URL } from "@understudy/types";
import { BrowserManager, type BrowserManagerOptions } from "./browser-manager.js";
import { inspectAuthenticatedUnderstudyRelay } from "./extension-relay-auth.js";
import { textResult } from "../bridge/bridge-rpc.js";

const BrowserFieldSchema = Type.Object({
	ref: Type.String({ description: "Snapshot ref identifier." }),
	value: Type.Optional(Type.Union([
		Type.String(),
		Type.Number(),
		Type.Boolean(),
	], { description: "Value to write into the referenced form field." })),
});

const BrowserSchema = Type.Object({
	action: Type.String({
		description:
			'Browser action: status, start, stop, tabs, open, focus, close, snapshot, screenshot, navigate, console, response_body, pdf, upload, dialog, click, type, press, hover, scroll, scrollIntoView, drag, select, fill, resize, wait, evaluate.',
	}),
	browserConnectionMode: Type.Optional(Type.Union([
		Type.Literal("managed"),
		Type.Literal("extension"),
		Type.Literal("auto"),
	], { description: 'Browser connection mode override: "managed" | "extension" | "auto".' })),
	browserCdpUrl: Type.Optional(Type.String({ description: "Explicit CDP URL for extension relay mode." })),
	url: Type.Optional(Type.String({ description: "Target URL for navigate/open/response_body actions." })),
	targetId: Type.Optional(Type.String({ description: "Tab identifier for actions targeting a specific page." })),
	selector: Type.Optional(Type.String({ description: "CSS selector used by direct element actions." })),
	element: Type.Optional(Type.String({ description: "CSS selector used for element screenshots." })),
	text: Type.Optional(Type.String({ description: "Input text for type/fill/wait actions." })),
	textGone: Type.Optional(Type.String({ description: "Text that should disappear for wait actions." })),
	ref: Type.Optional(Type.String({ description: "Snapshot ref identifier. Falls back to a CSS selector when no stored ref exists." })),
	key: Type.Optional(Type.String({ description: "Keyboard key for press/key actions." })),
	fromSelector: Type.Optional(Type.String({ description: "Source selector for drag actions." })),
	toSelector: Type.Optional(Type.String({ description: "Destination selector for drag actions." })),
	startRef: Type.Optional(Type.String({ description: "Snapshot ref for drag source." })),
	endRef: Type.Optional(Type.String({ description: "Snapshot ref for drag destination." })),
	values: Type.Optional(Type.Array(Type.String({ description: "Values for select actions." }))),
	fields: Type.Optional(Type.Array(BrowserFieldSchema, { description: "Field descriptors for form fill actions." })),
	width: Type.Optional(Type.Number({ description: "Viewport width for resize." })),
	height: Type.Optional(Type.Number({ description: "Viewport height for resize." })),
	deltaX: Type.Optional(Type.Number({ description: "Horizontal scroll delta for scroll actions." })),
	deltaY: Type.Optional(Type.Number({ description: "Vertical scroll delta for scroll actions." })),
	waitMs: Type.Optional(Type.Number({ description: "Wait duration in ms." })),
	timeoutMs: Type.Optional(Type.Number({ description: "Timeout for waits and network capture." })),
	fn: Type.Optional(Type.String({ description: "JavaScript expression/code or function source." })),
	path: Type.Optional(Type.String({ description: "Output path for screenshot or pdf action, or single upload path." })),
	paths: Type.Optional(Type.Array(Type.String({ description: "File paths for upload action." }))),
	limit: Type.Optional(Type.Number({ description: "Max entries/nodes to return." })),
	accept: Type.Optional(Type.Boolean({ description: "Whether to accept the next dialog." })),
	promptText: Type.Optional(Type.String({ description: "Optional text to submit when accepting prompt dialogs." })),
	fullPage: Type.Optional(Type.Boolean({ description: "Capture a full-page screenshot." })),
	type: Type.Optional(Type.Union([
		Type.Literal("png"),
		Type.Literal("jpeg"),
	], { description: 'Image output type for screenshots. Default: "png".' })),
	format: Type.Optional(Type.Union([
		Type.Literal("ai"),
		Type.Literal("aria"),
	], { description: 'Snapshot format. Default: "ai".' })),
	labels: Type.Optional(Type.Boolean({ description: "Include a labeled snapshot image for AI snapshots." })),
	interactive: Type.Optional(Type.Boolean({ description: "Limit ARIA snapshot to interesting nodes." })),
	compact: Type.Optional(Type.Boolean({ description: "Return compact snapshot text when true." })),
	depth: Type.Optional(Type.Number({ description: "Max ARIA snapshot depth." })),
	level: Type.Optional(Type.String({ description: "Console level filter, e.g. error/warn/info/log." })),
	maxChars: Type.Optional(Type.Number({ description: "Max characters to return from evaluate/response_body output." })),
	loadState: Type.Optional(Type.Union([
		Type.Literal("load"),
		Type.Literal("domcontentloaded"),
		Type.Literal("networkidle"),
	], { description: "Load state used by wait actions." })),
	submit: Type.Optional(Type.Boolean({ description: "Press Enter after typing." })),
	slowly: Type.Optional(Type.Boolean({ description: "Type with key-by-key events instead of fill()." })),
	button: Type.Optional(Type.Union([
		Type.Literal("left"),
		Type.Literal("right"),
		Type.Literal("middle"),
	], { description: "Mouse button used for click actions." })),
	modifiers: Type.Optional(Type.Array(Type.String({ description: "Optional keyboard modifiers such as Shift or Alt." }))),
	doubleClick: Type.Optional(Type.Boolean({ description: "Whether to double click instead of single click." })),
});

type BrowserParams = Static<typeof BrowserSchema>;
type BrowserField = Static<typeof BrowserFieldSchema>;

interface BrowserSnapshotRef {
	ref: string;
	role?: string;
	name?: string;
	value?: string;
	description?: string;
	selector: string;
	nth: number;
	box?: { x: number; y: number; width: number; height: number };
}

interface BrowserAiSnapshotPayload {
	nodes: BrowserSnapshotRef[];
	stats: {
		lines: number;
		chars: number;
		refs: number;
		interactive: number;
	};
	snapshot: string;
}

interface BrowserAriaNode {
	role: string;
	name?: string;
	value?: string;
	description?: string;
	depth: number;
}

interface BrowserConsoleEvent {
	level: string;
	text: string;
}

interface BrowserStyleLike {
	[key: string]: string | undefined;
}

interface BrowserDomRectLike {
	left: number;
	top: number;
	width: number;
	height: number;
}

interface BrowserDomElementLike {
	id?: string;
	tagName: string;
	textContent?: string | null;
	innerText?: string | null;
	value?: string | number | null;
	labels?: ArrayLike<{ textContent?: string | null }> | null;
	children: ArrayLike<BrowserDomElementLike>;
	parentElement?: BrowserDomElementLike | null;
	style: BrowserStyleLike;
	isContentEditable?: boolean;
	getAttribute(name: string): string | null;
	querySelectorAll(selector: string): ArrayLike<BrowserDomElementLike>;
	getBoundingClientRect(): BrowserDomRectLike;
	appendChild(child: BrowserDomElementLike): void;
	setAttribute(name: string, value: string): void;
	remove?(): void;
}

interface BrowserDocumentLike {
	body?: BrowserDomElementLike | null;
	documentElement?: BrowserDomElementLike | null;
	querySelector(selector: string): BrowserDomElementLike | null;
	querySelectorAll(selector: string): ArrayLike<BrowserDomElementLike>;
	createElement(tag: string): BrowserDomElementLike;
	getElementById(id: string): BrowserDomElementLike | null;
}

interface BrowserWindowLike {
	document?: BrowserDocumentLike;
	getComputedStyle?: (element: BrowserDomElementLike) => { visibility?: string; display?: string };
	CSS?: { escape?: (value: string) => string };
}

function isBrowserManagerLike(value: unknown): value is BrowserManager {
	return Boolean(value) &&
		typeof value === "object" &&
		typeof (value as BrowserManager).close === "function" &&
		(
			typeof (value as BrowserManager).getPage === "function" ||
			(
				typeof (value as BrowserManager).start === "function" &&
				typeof (value as BrowserManager).isRunning === "function"
			)
		);
}

export function createBrowserTool(
	managerOrOptions?: BrowserManager | BrowserManagerOptions | (() => BrowserManagerOptions),
): AgentTool<typeof BrowserSchema> {
	const externalManager = isBrowserManagerLike(managerOrOptions) ? managerOrOptions : undefined;
	const defaultManagerOptionsSource: BrowserManagerOptions | (() => BrowserManagerOptions) | undefined =
		externalManager
			? undefined
			: managerOrOptions as BrowserManagerOptions | (() => BrowserManagerOptions) | undefined;
	let browserManager: BrowserManager | null = externalManager ?? null;
	let managerSignature = externalManager ? "external" : "";
	let managerConfigSource: "default" | "explicit" | "external" = externalManager ? "external" : "default";
	const instrumentedPages = new WeakSet<object>();
	const consoleEvents = new WeakMap<object, BrowserConsoleEvent[]>();
	const dialogEvents = new WeakMap<object, string[]>();
	const snapshotRefs = new WeakMap<object, Map<string, BrowserSnapshotRef>>();

	const cap = (value: number | undefined, fallback: number, min: number, max: number): number =>
		Math.max(min, Math.min(max, Math.floor(value ?? fallback)));

	const normalizeScreenshotType = (value: BrowserParams["type"]): "png" | "jpeg" =>
		value === "jpeg" ? "jpeg" : "png";

	const mediaNameForType = (type: "png" | "jpeg"): string =>
		type === "jpeg" ? "browser-screenshot.jpeg" : "browser-screenshot.png";

	const mimeForType = (type: "png" | "jpeg"): string =>
		type === "jpeg" ? "image/jpeg" : "image/png";

	const pushCapped = <T>(list: T[], value: T, max = 200): void => {
		list.push(value);
		if (list.length > max) {
			list.splice(0, list.length - max);
		}
	};

	const trimToUndefined = (value: unknown): string | undefined => {
		if (typeof value !== "string") {
			return undefined;
		}
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	};

	const hasExplicitManagerConfig = (params: BrowserParams): boolean =>
		trimToUndefined(params.browserConnectionMode) !== undefined ||
		trimToUndefined(params.browserCdpUrl) !== undefined;

	const normalizeConnectionMode = (value: unknown): BrowserManagerOptions["browserConnectionMode"] | undefined => {
		const normalized = trimToUndefined(value)?.toLowerCase();
		if (normalized === "managed" || normalized === "extension" || normalized === "auto") {
			return normalized;
		}
		return undefined;
	};

	const resolveDefaultManagerOptions = (): BrowserManagerOptions | undefined =>
		typeof defaultManagerOptionsSource === "function"
			? defaultManagerOptionsSource()
			: defaultManagerOptionsSource;

	const resolveConfiguredManagerOptions = (): BrowserManagerOptions => {
		const resolvedDefaults = resolveDefaultManagerOptions();
		return {
			browserConnectionMode: normalizeConnectionMode(resolvedDefaults?.browserConnectionMode)
				?? normalizeConnectionMode(process.env.UNDERSTUDY_BROWSER_CONNECTION_MODE)
				?? "auto",
			browserCdpUrl: trimToUndefined(resolvedDefaults?.browserCdpUrl)
				?? trimToUndefined(process.env.UNDERSTUDY_BROWSER_CDP_URL)
				?? DEFAULT_BROWSER_EXTENSION_CDP_URL,
		};
	};

	const resolveRequestedManagerOptions = (params: BrowserParams): BrowserManagerOptions => {
		const configuredOptions = resolveConfiguredManagerOptions();
		const browserConnectionMode = normalizeConnectionMode(params.browserConnectionMode)
			?? configuredOptions.browserConnectionMode
			?? "auto";
		const browserCdpUrl = trimToUndefined(params.browserCdpUrl)
			?? trimToUndefined(configuredOptions.browserCdpUrl)
			?? DEFAULT_BROWSER_EXTENSION_CDP_URL;
		return {
			browserConnectionMode,
			browserCdpUrl,
		};
	};

	const managerSignatureFromOptions = (options: BrowserManagerOptions): string => JSON.stringify({
		browserConnectionMode: options.browserConnectionMode ?? "auto",
		browserCdpUrl: options.browserConnectionMode === "extension" || options.browserConnectionMode === "auto"
			? options.browserCdpUrl ?? DEFAULT_BROWSER_EXTENSION_CDP_URL
			: null,
	});

	const getCurrentConnectionMode = (params: BrowserParams): NonNullable<BrowserManagerOptions["browserConnectionMode"]> => {
		const resolvedMode = browserManager?.getResolvedConnectionMode?.();
		if (resolvedMode) {
			return resolvedMode;
		}
		const configuredMode = browserManager?.getConfiguredConnectionMode?.();
		if (configuredMode) {
			return configuredMode;
		}
		if (managerSignature && managerSignature !== "external") {
			try {
				const parsed = JSON.parse(managerSignature) as { browserConnectionMode?: unknown };
				const parsedMode = normalizeConnectionMode(parsed.browserConnectionMode);
				if (parsedMode) {
					return parsedMode;
				}
			} catch {
				// Ignore malformed signatures and fall back to requested params/env.
			}
		}
		return resolveRequestedManagerOptions(params).browserConnectionMode ?? "auto";
	};

	const blankManagedTabHint = (url: string, params: BrowserParams): string | undefined => {
		if (getCurrentConnectionMode(params) !== "managed") {
			return undefined;
		}
		const normalizedUrl = url.trim().toLowerCase();
		if (normalizedUrl !== "" && normalizedUrl !== "about:blank") {
			return undefined;
		}
		return [
			"Managed mode is currently looking at an empty Playwright tab (`about:blank`).",
			"If you meant to control your existing Chrome tab, switch to `browserConnectionMode: \"extension\"` and click the Understudy extension on that tab first.",
		].join(" ");
	};

	const isRecoverableExtensionRoutingError = (message: string): boolean => {
		const normalized = message.trim().toLowerCase();
		return normalized.includes("no attached tab for method target.createtarget")
			|| normalized.includes("no tab context is attached")
			|| (normalized.includes("connectovercdp") && normalized.includes("invalid url: undefined"))
			|| normalized.includes("retrieving websocket url");
	};

	const shouldRetryWithManagedFallback = (params: BrowserParams, message: string): boolean => {
		if (externalManager || hasExplicitManagerConfig(params)) {
			return false;
		}
		if ((params.action !== "start" && params.action !== "open") || !isRecoverableExtensionRoutingError(message)) {
			return false;
		}
		return resolveConfiguredManagerOptions().browserConnectionMode === "extension";
	};

	const switchToManagedFallback = async (): Promise<BrowserManager> => {
		if (browserManager?.isRunning()) {
			await browserManager.close().catch(() => {});
		}
		managerSignature = managerSignatureFromOptions({ browserConnectionMode: "managed" });
		managerConfigSource = "explicit";
		browserManager = new BrowserManager({ browserConnectionMode: "managed" });
		return browserManager;
	};

	const fallbackNotice = "Configured extension relay had no attached tab, so the browser tool retried in managed mode.";

	const ensureBrowserManager = async (params: BrowserParams): Promise<BrowserManager> => {
		if (externalManager) {
			return browserManager!;
		}
		if (!managerSignature) {
			const resolvedOptions = resolveRequestedManagerOptions(params);
			managerSignature = managerSignatureFromOptions(resolvedOptions);
			managerConfigSource = hasExplicitManagerConfig(params) ? "explicit" : "default";
			browserManager = new BrowserManager(resolvedOptions);
			return browserManager;
		}
		if (!hasExplicitManagerConfig(params)) {
			if (managerConfigSource !== "default") {
				return browserManager!;
			}
			const configuredOptions = resolveConfiguredManagerOptions();
			const configuredSignature = managerSignatureFromOptions(configuredOptions);
			if (configuredSignature !== managerSignature) {
				if (browserManager?.isRunning()) {
					await browserManager.close().catch(() => {});
				}
				managerSignature = configuredSignature;
				managerConfigSource = "default";
				browserManager = new BrowserManager(configuredOptions);
			}
			return browserManager!;
		}
		const requestedSignature = managerSignatureFromOptions(resolveRequestedManagerOptions(params));
		if (requestedSignature !== managerSignature) {
			if (browserManager?.isRunning()) {
				throw new Error("Browser runtime is already running with a different connection configuration. Stop it before switching mode.");
			}
			managerSignature = requestedSignature;
			managerConfigSource = "explicit";
			browserManager = new BrowserManager(resolveRequestedManagerOptions(params));
		}
		return browserManager!;
	};

	const describeConnectionMode = (activeBrowserManager: BrowserManager, params: BrowserParams): {
		configuredMode: NonNullable<BrowserManagerOptions["browserConnectionMode"]>;
		resolvedMode?: "managed" | "extension";
		label: string;
	} => {
		const configuredMode =
			activeBrowserManager.getConfiguredConnectionMode?.() ??
			resolveRequestedManagerOptions(params).browserConnectionMode ??
			"managed";
		const resolvedMode = activeBrowserManager.getResolvedConnectionMode?.() ??
			(configuredMode === "auto" ? undefined : configuredMode);
		return {
			configuredMode,
			resolvedMode,
			label: resolvedMode
				? configuredMode === "auto"
					? `${resolvedMode} (configured auto)`
					: resolvedMode
				: configuredMode,
			};
	};

	const describeDormantBrowserStatus = async (
		activeBrowserManager: BrowserManager,
		params: BrowserParams,
	): Promise<AgentToolResult<unknown>> => {
		const connection = describeConnectionMode(activeBrowserManager, params);
		const details: Record<string, unknown> = {
			running: false,
			connectionMode: connection.resolvedMode ?? connection.configuredMode,
			configuredConnectionMode: connection.configuredMode,
			resolvedConnectionMode: connection.resolvedMode,
		};

		if (connection.configuredMode !== "extension" && connection.configuredMode !== "auto") {
			return textResult(
				[
					"Browser status: stopped",
					`Configured route: ${connection.label}`,
					"Next browser action will use this route when the runtime starts.",
				].join("\n"),
				details,
			);
		}

		const relayUrl = resolveRequestedManagerOptions(params).browserCdpUrl ?? DEFAULT_BROWSER_EXTENSION_CDP_URL;
		const relayStatus = await inspectAuthenticatedUnderstudyRelay({
			baseUrl: relayUrl,
			timeoutMs: Math.max(500, Math.min(2_000, params.timeoutMs ?? 800)),
		}).catch((error) => ({
			reachable: false,
			recognized: false,
			extensionConnected: false,
			attachedTargets: [],
			error: error instanceof Error ? error.message : String(error),
		}));
		details.extensionRelay = relayStatus;

		if (!relayStatus.reachable) {
			return textResult(
				[
					"Browser status: stopped",
					`Configured route: ${connection.label}`,
					`Extension relay: unreachable${relayStatus.error ? ` (${relayStatus.error})` : ""}`,
					"Start or reconnect the Understudy browser relay, then click the extension on the tab you want to control.",
				].join("\n"),
				details,
			);
		}

		if (!relayStatus.recognized) {
			return textResult(
				[
					"Browser status: stopped",
					`Configured route: ${connection.label}`,
					"Extension relay: unexpected response",
					`Relay URL: ${relayUrl}`,
				].join("\n"),
				details,
			);
		}

		const attachedTab = relayStatus.attachedTargets[0];
		if (attachedTab) {
			return textResult(
				[
					"Browser status: ready (extension tab attached)",
					`Configured route: ${connection.label}`,
					"Extension relay: reachable",
					`Extension worker: ${relayStatus.extensionConnected ? "connected" : "waiting to reconnect"}`,
					`Attached tabs: ${relayStatus.attachedTargets.length}`,
					`Attached tab: ${attachedTab.title || attachedTab.url || attachedTab.id}`,
					"Next browser action should use this tab directly. A page refresh should not be necessary.",
				].join("\n"),
				details,
			);
		}

		return textResult(
			[
				"Browser status: waiting for extension tab handoff",
				`Configured route: ${connection.label}`,
				"Extension relay: reachable",
				`Extension worker: ${relayStatus.extensionConnected ? "connected" : "not connected"}`,
				"Attached tabs: 0",
				"Click the Understudy extension on the browser tab you want to control.",
			].join("\n"),
			details,
		);
	};

	const ensurePageInstrumentation = (page: any): void => {
		if (!page || typeof page !== "object") return;
		if (!consoleEvents.has(page as object)) {
			consoleEvents.set(page as object, []);
		}
		if (!dialogEvents.has(page as object)) {
			dialogEvents.set(page as object, []);
		}
		if (!snapshotRefs.has(page as object)) {
			snapshotRefs.set(page as object, new Map());
		}
		if (instrumentedPages.has(page as object)) return;

		instrumentedPages.add(page as object);
		page.on?.("console", (message: any) => {
			try {
				const event = {
					level: String(message.type?.() ?? "log").trim().toLowerCase(),
					text: String(message.text?.() ?? "").trim(),
				};
				if (!event.text) return;
				pushCapped(consoleEvents.get(page as object) ?? [], event);
			} catch {
				// Ignore non-critical browser event parsing errors.
			}
		});
		page.on?.("dialog", async (dialog: any) => {
			try {
				const line = `[${dialog.type?.() ?? "dialog"}] ${dialog.message?.() ?? ""}`.trim();
				if (line) {
					pushCapped(dialogEvents.get(page as object) ?? [], line);
				}
			} finally {
				await dialog.dismiss?.().catch(() => {});
			}
		});
	};

	const setSnapshotRefs = (page: any, refs: BrowserSnapshotRef[]): void => {
		const table = new Map<string, BrowserSnapshotRef>();
		for (const entry of refs) {
			table.set(entry.ref, entry);
		}
		snapshotRefs.set(page as object, table);
	};

	const getSnapshotRef = (page: any, ref: string | undefined): BrowserSnapshotRef | undefined =>
		ref?.trim() ? snapshotRefs.get(page as object)?.get(ref.trim()) : undefined;

	const resolveLocatorFromSelector = (page: any, selector: string): any => {
		const locator = page.locator?.(selector);
		return typeof locator?.first === "function" ? locator.first() : locator;
	};

	const resolveLocator = (page: any, params: {
		ref?: string;
		selector?: string;
		element?: string;
		required?: boolean;
		label?: string;
	}): { locator: any; description: string } | undefined => {
		const refValue = params.ref?.trim();
		if (refValue) {
			const snapRef = getSnapshotRef(page, refValue);
			if (snapRef) {
				return {
					locator: resolveLocatorFromSelector(page, snapRef.selector),
					description: `ref ${refValue}${snapRef.name ? ` (${snapRef.name})` : ""}`,
				};
			}
			throw new Error(`Unknown snapshot ref: ${refValue}. Take a new snapshot or pass selector explicitly.`);
		}

		const selector = params.selector?.trim() || params.element?.trim();
		if (selector) {
			return {
				locator: resolveLocatorFromSelector(page, selector),
				description: `selector ${selector}`,
			};
		}

		if (params.required) {
			throw new Error(`${params.label ?? "selector"} is required`);
		}
		return undefined;
	};

	const currentTabDetails = async (page: any): Promise<{ targetId: string; url: string; title?: string }> => ({
		targetId: browserManager!.getTabId(page),
		url: page.url?.() ?? "",
		title: await page.title?.(),
	});

	const truncateText = (value: string | undefined | null, maxChars: number | undefined): string => {
		const text = typeof value === "string"
			? value
			: value === null || value === undefined
				? ""
				: String(value);
		if (!Number.isFinite(maxChars) || !maxChars || text.length <= maxChars) {
			return text;
		}
		return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
	};

	const parseMaybeJson = (value: unknown): string => {
		if (value === undefined) {
			return "undefined";
		}
		if (typeof value === "string") {
			return value;
		}
		if (typeof value === "function") {
			return `[Function ${value.name || "anonymous"}]`;
		}
		try {
			const serialized = JSON.stringify(value, null, 2);
			if (typeof serialized === "string") {
				return serialized;
			}
			return String(value);
		} catch {
			return String(value);
		}
	};

	const flattenAriaSnapshot = (
		node: any,
		depthLimit: number,
		limit: number,
		depth = 0,
		lines: BrowserAriaNode[] = [],
	): BrowserAriaNode[] => {
		if (!node || lines.length >= limit || depth > depthLimit) {
			return lines;
		}
		lines.push({
			role: String(node.role ?? "unknown"),
			name: typeof node.name === "string" ? node.name : undefined,
			value: typeof node.value === "string" ? node.value : undefined,
			description: typeof node.description === "string" ? node.description : undefined,
			depth,
		});
		if (lines.length >= limit) {
			return lines;
		}
		for (const child of Array.isArray(node.children) ? node.children : []) {
			flattenAriaSnapshot(child, depthLimit, limit, depth + 1, lines);
			if (lines.length >= limit) {
				break;
			}
		}
		return lines;
	};

	const ariaSnapshotText = (nodes: BrowserAriaNode[], compact = false): string => {
		if (nodes.length === 0) {
			return "No ARIA nodes found.";
		}
		return nodes.map((node) => {
			const indent = compact ? "" : "  ".repeat(Math.min(12, node.depth));
			const name = node.name ? ` "${node.name}"` : "";
			const value = node.value ? ` = "${node.value}"` : "";
			return `${indent}- ${node.role}${name}${value}`;
		}).join("\n");
	};

	const aiSnapshotText = (nodes: BrowserSnapshotRef[], compact = false): string => {
		if (nodes.length === 0) {
			return "No interactive elements found in the current browser view.";
		}
		return nodes.map((node) => {
			const role = node.role ?? "element";
			const name = node.name ? ` "${node.name}"` : "";
			const value = node.value ? ` = "${truncateText(node.value, 80)}"` : "";
			const description = !compact && node.description ? ` (${truncateText(node.description, 80)})` : "";
			return `[${node.ref}] ${role}${name}${value}${description}`;
		}).join("\n");
	};

	const captureAiSnapshot = async (page: any, params: BrowserParams): Promise<BrowserAiSnapshotPayload> => {
		const limit = cap(params.limit, params.labels ? 60 : 120, 1, 500);
		const nodes = await page.evaluate(
			(input: { selector?: string | null; limit: number }) => {
				const browserWindow = globalThis as unknown as BrowserWindowLike;
				const browserDocument = browserWindow.document;
				const root = input.selector ? browserDocument?.querySelector(input.selector) : browserDocument?.body;
				if (!root) {
					return [];
				}

				const candidateSelector = [
					"button",
					"a[href]",
					"input",
					"textarea",
					"select",
					"option",
					"[role]",
					"[contenteditable='true']",
					"summary",
				].join(",");

				const visible = (element: BrowserDomElementLike): boolean => {
					const style = browserWindow.getComputedStyle?.(element) ?? {};
					if (style.visibility === "hidden" || style.display === "none") return false;
					const rect = element.getBoundingClientRect();
					return rect.width > 0 && rect.height > 0;
				};

				const textFromIds = (ids: string | null): string => {
					if (!ids) return "";
					return ids
						.split(/\s+/)
						.map((id) => browserDocument?.getElementById(id)?.textContent?.trim() ?? "")
						.filter(Boolean)
						.join(" ");
				};

				const deriveRole = (element: BrowserDomElementLike): string | undefined => {
					const explicitRole = element.getAttribute("role")?.trim().toLowerCase();
					if (explicitRole) return explicitRole;

					const tag = element.tagName.toLowerCase();
					if (tag === "button") return "button";
					if (tag === "a" && element.getAttribute("href")) return "link";
					if (tag === "textarea") return "textbox";
					if (tag === "select") return "combobox";
					if (tag === "option") return "option";
					if (tag === "summary") return "button";
					if (element.isContentEditable) return "textbox";
					if (tag === "input") {
						const type = (element.getAttribute("type") || "text").toLowerCase();
						if (["button", "submit", "reset"].includes(type)) return "button";
						if (type === "checkbox") return "checkbox";
						if (type === "radio") return "radio";
						if (type === "search") return "searchbox";
						if (type === "email" || type === "password" || type === "text" || type === "url" || type === "tel") {
							return "textbox";
						}
						return "textbox";
					}
					return undefined;
				};

				const deriveName = (element: BrowserDomElementLike): string => {
					const tag = element.tagName.toLowerCase();
					const labels = tag === "input"
						? Array.from(element.labels ?? []).map((label) => label.textContent?.trim() ?? "").filter(Boolean).join(" ")
						: "";
					const controlValue = typeof element.value === "string" || typeof element.value === "number"
						? String(element.value)
						: "";
					const labelled = textFromIds(element.getAttribute("aria-labelledby"));
					const text = (
						element.getAttribute("aria-label")
						|| labelled
						|| element.getAttribute("title")
						|| labels
						|| element.getAttribute("placeholder")
						|| controlValue
						|| element.textContent
						|| ""
					).replace(/\s+/g, " ").trim();
					return text;
				};

				const deriveDescription = (element: BrowserDomElementLike): string | undefined => {
					const description = (
						element.getAttribute("aria-description")
						|| textFromIds(element.getAttribute("aria-describedby"))
						|| ""
					).replace(/\s+/g, " ").trim();
					return description || undefined;
				};

				const cssPath = (element: BrowserDomElementLike): string => {
					const escapeCss = (value: string): string => {
						if (browserWindow.CSS?.escape) {
							return browserWindow.CSS.escape(value);
						}
						return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
					};
					if (element.id) {
						return `#${escapeCss(element.id)}`;
					}

					const parts: string[] = [];
					let current: BrowserDomElementLike | null | undefined = element;
					while (current && current !== browserDocument?.body) {
						const tag = current.tagName.toLowerCase();
						const parent: BrowserDomElementLike | null | undefined = current.parentElement;
						if (!parent) {
							parts.unshift(tag);
							break;
						}
						const siblings = Array.from(parent.children as ArrayLike<BrowserDomElementLike>)
							.filter((child) => child.tagName === current?.tagName);
						const index = siblings.indexOf(current) + 1;
						parts.unshift(`${tag}:nth-of-type(${Math.max(1, index)})`);
						current = parent;
					}
					return `body > ${parts.join(" > ")}`;
				};

				const dedup = new Set<BrowserDomElementLike>();
				const elements = Array.from(root.querySelectorAll(candidateSelector))
					.filter((element) => visible(element))
					.filter((element) => {
						if (dedup.has(element)) return false;
						dedup.add(element);
						return true;
					})
					.slice(0, input.limit);

				const nthByKey = new Map<string, number>();
				return elements.map((element, index) => {
					const role = deriveRole(element);
					const name = deriveName(element);
					const description = deriveDescription(element);
					const rect = element.getBoundingClientRect();
					const tag = element.tagName.toLowerCase();
					const value = ["input", "textarea", "select"].includes(tag)
						? String(element.value ?? "").trim()
						: undefined;
					const key = `${role ?? "element"}|${name}`;
					const nth = nthByKey.get(key) ?? 0;
					nthByKey.set(key, nth + 1);
					return {
						ref: String(index + 1),
						role: role ?? undefined,
						name: name || undefined,
						value: value || undefined,
						description,
						selector: cssPath(element),
						nth,
						box: {
							x: Math.max(0, Math.round(rect.left)),
							y: Math.max(0, Math.round(rect.top)),
							width: Math.max(1, Math.round(rect.width)),
							height: Math.max(1, Math.round(rect.height)),
						},
					};
				});
			},
			{
				selector: params.selector?.trim() || null,
				limit,
			},
		) as BrowserSnapshotRef[];

		setSnapshotRefs(page, nodes);
		const snapshot = aiSnapshotText(nodes, Boolean(params.compact));
		return {
			nodes,
			stats: {
				lines: nodes.length,
				chars: snapshot.length,
				refs: nodes.length,
				interactive: nodes.length,
			},
			snapshot,
		};
	};

	const clearLabelOverlay = async (page: any): Promise<void> => {
		await page.evaluate(() => {
			const browserDocument = (globalThis as unknown as BrowserWindowLike).document;
			Array.from(browserDocument?.querySelectorAll("[data-understudy-browser-labels]") ?? [])
				.forEach((node: BrowserDomElementLike) => node.remove?.());
		}).catch(() => {});
	};

	const captureLabeledSnapshot = async (
		page: any,
		nodes: BrowserSnapshotRef[],
		type: "png" | "jpeg",
		fullPage = false,
	): Promise<string> => {
		await page.evaluate((labels: Array<{ ref: string; x: number; y: number; width: number; height: number }>) => {
			const browserDocument = (globalThis as unknown as BrowserWindowLike).document;
			if (!browserDocument?.documentElement) {
				return;
			}
			Array.from(browserDocument.querySelectorAll("[data-understudy-browser-labels]"))
				.forEach((node: BrowserDomElementLike) => node.remove?.());
			const root = browserDocument.createElement("div");
			root.setAttribute("data-understudy-browser-labels", "1");
			root.style.position = "fixed";
			root.style.inset = "0";
			root.style.pointerEvents = "none";
			root.style.zIndex = "2147483647";
			for (const label of labels) {
				const outline = browserDocument.createElement("div");
				outline.setAttribute("data-understudy-browser-labels", "1");
				outline.style.position = "fixed";
				outline.style.left = `${label.x}px`;
				outline.style.top = `${label.y}px`;
				outline.style.width = `${label.width}px`;
				outline.style.height = `${label.height}px`;
				outline.style.outline = "2px solid #e11d48";
				outline.style.background = "rgba(225,29,72,0.10)";
				outline.style.borderRadius = "6px";

				const badge = browserDocument.createElement("div");
				badge.setAttribute("data-understudy-browser-labels", "1");
				badge.textContent = label.ref;
				badge.style.position = "fixed";
				badge.style.left = `${Math.max(0, label.x)}px`;
				badge.style.top = `${Math.max(0, label.y - 18)}px`;
				badge.style.padding = "1px 6px";
				badge.style.borderRadius = "999px";
				badge.style.background = "#e11d48";
				badge.style.color = "#fff";
				badge.style.font = "600 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace";
				badge.style.pointerEvents = "none";

				root.appendChild(outline);
				root.appendChild(badge);
			}
			browserDocument.documentElement.appendChild(root);
		}, nodes
			.filter((node) => node.box)
			.map((node) => ({
				ref: node.ref,
				x: node.box!.x,
				y: node.box!.y,
				width: node.box!.width,
				height: node.box!.height,
			})));
		try {
			const buffer = await page.screenshot({ type, fullPage });
			return buffer.toString("base64");
		} finally {
			await clearLabelOverlay(page);
		}
	};

	const waitForTextState = async (
		page: any,
		expected: string,
		disappear: boolean,
		timeoutMs: number,
	): Promise<void> => {
		await page.waitForFunction(
			(payload: { expected: string; disappear: boolean }) => {
				const browserDocument = (globalThis as unknown as BrowserWindowLike).document;
				const haystack = browserDocument?.body?.innerText ?? browserDocument?.body?.textContent ?? "";
				const found = haystack.includes(payload.expected);
				return payload.disappear ? !found : found;
			},
			{ expected, disappear },
			{ timeout: timeoutMs },
		);
	};

	const globToRegExp = (pattern: string): RegExp => {
		const escaped = pattern
			.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
			.replace(/\*\*/g, ":::DOUBLE_WILDCARD:::")
			.replace(/\*/g, "[^/]*")
			.replace(/:::DOUBLE_WILDCARD:::/g, ".*");
		return new RegExp(`^${escaped}$`);
	};

	const urlMatches = (pattern: string, candidate: string): boolean => {
		if (pattern.includes("*")) {
			return globToRegExp(pattern).test(candidate);
		}
		return candidate === pattern || candidate.includes(pattern);
	};

	const waitAction = async (page: any, params: BrowserParams): Promise<string> => {
		const timeoutMs = cap(params.timeoutMs, 20_000, 1, 120_000);
		const waitMs = params.waitMs;
		if (Number.isFinite(waitMs) && (waitMs ?? 0) > 0) {
			await page.waitForTimeout(Math.max(1, Math.floor(waitMs!)));
		}
		if (params.selector?.trim()) {
			await page.waitForSelector(params.selector.trim(), { timeout: timeoutMs });
		}
		if (params.text?.trim()) {
			await waitForTextState(page, params.text.trim(), false, timeoutMs);
		}
		if (params.textGone?.trim()) {
			await waitForTextState(page, params.textGone.trim(), true, timeoutMs);
		}
		if (params.url?.trim()) {
			await page.waitForURL((url: URL) => urlMatches(params.url!.trim(), url.toString()), { timeout: timeoutMs });
		}
		if (params.loadState) {
			await page.waitForLoadState(params.loadState, { timeout: timeoutMs });
		}
		if (params.fn?.trim()) {
			await page.waitForFunction(params.fn.trim(), undefined, { timeout: timeoutMs });
		}
		if (
			!Number.isFinite(waitMs) &&
			!params.selector?.trim() &&
			!params.text?.trim() &&
			!params.textGone?.trim() &&
			!params.url?.trim() &&
			!params.loadState &&
			!params.fn?.trim()
		) {
			await page.waitForTimeout(1_000);
		}
		return "Wait complete";
	};

	const clickLocator = async (locator: any, params: BrowserParams): Promise<string> => {
		const clickOptions = {
			button: params.button,
			modifiers: params.modifiers,
		};
		if (params.doubleClick) {
			if (typeof locator.dblclick === "function") {
				await locator.dblclick(clickOptions);
			} else {
				await locator.click?.({ ...clickOptions, clickCount: 2 });
			}
			return "double clicked";
		}
		await locator.click?.(clickOptions);
		return "clicked";
	};

	const typeIntoLocator = async (locator: any, params: BrowserParams): Promise<void> => {
		if (!params.text) {
			throw new Error("text is required");
		}
		if (params.slowly && typeof locator.pressSequentially === "function") {
			await locator.click?.();
			await locator.pressSequentially(params.text);
		} else {
			await locator.fill?.(params.text);
		}
		if (params.submit) {
			await locator.press?.("Enter");
		}
	};

	const evaluateOnPage = async (page: any, expression: string): Promise<unknown> => {
		return await page.evaluate(expression);
	};

	const evaluateOnLocator = async (locator: any, expression: string): Promise<unknown> => {
		return await locator.evaluate((element: unknown, source: string) => {
			const fn = (0, eval)(source);
			if (typeof fn === "function") {
				return fn(element);
			}
			return fn;
		}, expression);
	};

	return {
		name: "browser",
		label: "Browser",
		description:
			"Control a live browser tab with AI/ARIA snapshots, ref-based interactions, waits, screenshots, uploads, console capture, dialogs, and PDF export.",
		parameters: BrowserSchema,
		execute: async (_toolCallId, params: BrowserParams): Promise<AgentToolResult<unknown>> => {
			try {
				const activeBrowserManager = await ensureBrowserManager(params);
					switch (params.action) {
						case "status": {
							if (!activeBrowserManager.isRunning()) {
								return await describeDormantBrowserStatus(activeBrowserManager, params);
							}
							const connection = describeConnectionMode(activeBrowserManager, params);
							const tabs = await activeBrowserManager.listTabs();
							const active = tabs.find((tab) => tab.active);
							return textResult(
								[
									"Browser status: running",
								`Route: ${connection.label}`,
								`Tabs: ${tabs.length}`,
								active ? `Active tab: ${active.id} (${active.url || "about:blank"})` : "Active tab: none",
							].join("\n"),
							{
								running: true,
								tabs,
								activeTabId: active?.id,
								connectionMode: connection.resolvedMode ?? connection.configuredMode,
								configuredConnectionMode: connection.configuredMode,
								resolvedConnectionMode: connection.resolvedMode,
							},
						);
					}

					case "start": {
						await activeBrowserManager.start();
						const connection = describeConnectionMode(activeBrowserManager, params);
						return textResult(`Browser started (${connection.label})`, {
							connectionMode: connection.resolvedMode ?? connection.configuredMode,
							configuredConnectionMode: connection.configuredMode,
							resolvedConnectionMode: connection.resolvedMode,
						});
					}

					case "stop": {
						await activeBrowserManager.close();
						return textResult("Browser stopped");
					}

					case "tabs": {
						const tabs = await activeBrowserManager.listTabs();
						if (tabs.length === 0) {
							return textResult("No browser tabs", { tabs: [] });
						}
						return textResult(
							[
								"Tabs:",
								...tabs.map((tab) => `- ${tab.id}${tab.active ? " (active)" : ""}: ${tab.title ?? tab.url}`),
							].join("\n"),
							{ tabs },
						);
					}

					case "open": {
						const tab = await activeBrowserManager.createTab(params.url);
						return textResult(`Opened ${tab.id}: ${tab.url || "about:blank"}`, {
							targetId: tab.id,
							url: tab.url,
							title: tab.title,
						});
					}

					case "focus": {
						if (!params.targetId) {
							return textResult("Error: targetId is required for focus");
						}
						await activeBrowserManager.focusTab(params.targetId);
						return textResult(`Focused tab: ${params.targetId}`);
					}

					case "navigate": {
						if (!params.url) {
							return textResult("Error: url is required for navigate");
						}
						const page = await activeBrowserManager.getPage(params.targetId);
						ensurePageInstrumentation(page);
						await page.goto(params.url, { waitUntil: "domcontentloaded" });
						const details = await currentTabDetails(page);
						return textResult(`Navigated to: ${params.url}\nTitle: ${details.title ?? ""}`.trim(), details);
					}

					case "console": {
						const page = await activeBrowserManager.getPage(params.targetId);
						ensurePageInstrumentation(page);
						const limit = cap(params.limit, 20, 1, 200);
						const level = params.level?.trim().toLowerCase();
						const lines = (consoleEvents.get(page as object) ?? [])
							.filter((event) => !level || event.level === level)
							.slice(-limit)
							.map((event) => `[${event.level}] ${event.text}`);
						if (lines.length === 0) {
							return textResult("No console events captured yet.", { messages: [] });
						}
						return textResult(`Console events (last ${lines.length}):\n${lines.join("\n")}`, {
							messages: lines,
							level,
						});
					}

					case "response_body": {
						if (!params.url) {
							return textResult("Error: url is required for response_body");
						}
						const page = await activeBrowserManager.getPage(params.targetId);
						ensurePageInstrumentation(page);
						const timeoutMs = cap(params.timeoutMs, 20_000, 1, 120_000);
						const response = await page.waitForResponse(
							(responseLike: any) => urlMatches(params.url!.trim(), String(responseLike.url?.() ?? "")),
							{ timeout: timeoutMs },
						);
						const body = truncateText(await response.text(), params.maxChars);
						return textResult(body, {
							url: response.url?.(),
							status: response.status?.(),
						});
					}

					case "dialog": {
						const page = await activeBrowserManager.getPage(params.targetId);
						ensurePageInstrumentation(page);
						if (typeof params.accept === "boolean") {
							page.once?.("dialog", async (dialog: any) => {
								if (params.accept) {
									await dialog.accept?.(params.promptText);
									return;
								}
								await dialog.dismiss?.();
							});
							return textResult(
								params.accept
									? "Dialog handler armed: will accept next dialog."
									: "Dialog handler armed: will dismiss next dialog.",
							);
						}
						const limit = cap(params.limit, 20, 1, 200);
						const lines = (dialogEvents.get(page as object) ?? []).slice(-limit);
						if (lines.length === 0) {
							return textResult("No dialog events captured yet.", { dialogs: [] });
						}
						return textResult(`Dialog events (last ${lines.length}):\n${lines.join("\n")}`, {
							dialogs: lines,
						});
					}

					case "snapshot": {
						const page = await activeBrowserManager.getPage(params.targetId);
						ensurePageInstrumentation(page);
						const pageUrl = page.url?.() ?? "";
						const format = params.format === "aria" ? "aria" : "ai";
						if (format === "aria") {
							const rootHandle = params.selector?.trim()
								? await resolveLocatorFromSelector(page, params.selector.trim())?.elementHandle?.()
								: undefined;
							const tree = await page.accessibility.snapshot({
								interestingOnly: params.interactive !== false,
								root: rootHandle,
							});
							const nodes = flattenAriaSnapshot(
								tree,
								cap(params.depth, 6, 0, 20),
								cap(params.limit, 200, 1, 800),
							);
							return textResult(`ARIA snapshot:\n${ariaSnapshotText(nodes, Boolean(params.compact))}`, {
								format,
								targetId: activeBrowserManager.getTabId(page),
								url: page.url?.() ?? "",
								nodes,
							});
						}

						const snapshot = await captureAiSnapshot(page, params);
						const hint = snapshot.nodes.length === 0
							? blankManagedTabHint(pageUrl, params)
							: undefined;
						const content: Array<Record<string, unknown>> = [
							{
								type: "text",
								text: hint ? `${snapshot.snapshot}\n\nHint: ${hint}` : snapshot.snapshot,
							},
						];
						const details: Record<string, unknown> = {
							format,
							targetId: activeBrowserManager.getTabId(page),
							url: pageUrl,
							snapshot: snapshot.snapshot,
							refs: Object.fromEntries(snapshot.nodes.map((node) => [
								node.ref,
								{
									role: node.role,
									name: node.name,
									nth: node.nth,
									selector: node.selector,
								},
							])),
							stats: snapshot.stats,
						};
						if (hint) {
							details.hint = hint;
							details.likelyCause = "managed_blank_tab";
						}
						if (params.labels) {
							const type = normalizeScreenshotType(params.type);
							const imageData = await captureLabeledSnapshot(page, snapshot.nodes, type, Boolean(params.fullPage));
							content.push({ type: "image", data: imageData, mimeType: mimeForType(type) } as any);
							details.labels = true;
						}
						return {
							content: content as any,
							details,
						};
					}

					case "screenshot": {
						const page = await activeBrowserManager.getPage(params.targetId);
						ensurePageInstrumentation(page);
						const type = normalizeScreenshotType(params.type);
						const locatorInfo = resolveLocator(page, {
							ref: params.ref,
							selector: params.element,
						});
						const buffer = locatorInfo?.locator
							? await locatorInfo.locator.screenshot({ type })
							: await page.screenshot({
								type,
								fullPage: Boolean(params.fullPage),
							});
						const outputPath = trimToUndefined(params.path);
						const details: Record<string, unknown> = {
							action: "screenshot",
							targetId: activeBrowserManager.getTabId(page),
							...(locatorInfo ? { target: locatorInfo.description } : {}),
						};
						if (outputPath) {
							const resolvedPath = resolve(outputPath);
							await mkdir(dirname(resolvedPath), { recursive: true });
							await writeFile(resolvedPath, buffer);
							details.path = resolvedPath;
						}
						return mediaResult(buffer.toString("base64"), mediaNameForType(type), mimeForType(type), details);
					}

					case "click": {
						const page = await activeBrowserManager.getPage(params.targetId);
						ensurePageInstrumentation(page);
						const locatorInfo = resolveLocator(page, {
							ref: params.ref,
							selector: params.selector,
							required: true,
							label: "selector or ref",
						});
						const verb = await clickLocator(locatorInfo!.locator, params);
						return textResult(`${capitalize(verb)}: ${locatorInfo!.description}`);
					}

					case "type": {
						const page = await activeBrowserManager.getPage(params.targetId);
						ensurePageInstrumentation(page);
						const locatorInfo = resolveLocator(page, {
							ref: params.ref,
							selector: params.selector,
							required: true,
							label: "selector or ref",
						});
						await typeIntoLocator(locatorInfo!.locator, params);
						return textResult(`Typed into ${locatorInfo!.description}`);
					}

					case "press": {
						if (!params.key) {
							return textResult("Error: key is required for press");
						}
						const page = await activeBrowserManager.getPage(params.targetId);
						ensurePageInstrumentation(page);
						await page.keyboard?.press(
							params.modifiers?.length ? [...params.modifiers, params.key].join("+") : params.key,
						);
						return textResult(`Pressed: ${params.modifiers?.length ? `${params.modifiers.join("+")}+` : ""}${params.key}`);
					}

					case "hover": {
						const page = await activeBrowserManager.getPage(params.targetId);
						ensurePageInstrumentation(page);
						const locatorInfo = resolveLocator(page, {
							ref: params.ref,
							selector: params.selector,
							required: true,
							label: "selector or ref",
						});
						await locatorInfo!.locator.hover?.();
						return textResult(`Hovered: ${locatorInfo!.description}`);
					}

					case "scroll": {
						const page = await activeBrowserManager.getPage(params.targetId);
						ensurePageInstrumentation(page);
						await page.evaluate(
							(coords: { x: number; y: number }) => {
								(globalThis as any).scrollBy?.(coords.x, coords.y);
							},
							{ x: params.deltaX ?? 0, y: params.deltaY ?? 400 },
						);
						return textResult(`Scrolled: x=${params.deltaX ?? 0}, y=${params.deltaY ?? 400}`);
					}

					case "scrollIntoView": {
						const page = await activeBrowserManager.getPage(params.targetId);
						ensurePageInstrumentation(page);
						const locatorInfo = resolveLocator(page, {
							ref: params.ref,
							selector: params.selector,
							required: true,
							label: "selector or ref",
						});
						await locatorInfo!.locator.scrollIntoViewIfNeeded?.({ timeout: cap(params.timeoutMs, 20_000, 1, 120_000) });
						return textResult(`Scrolled into view: ${locatorInfo!.description}`);
					}

					case "drag": {
						const page = await activeBrowserManager.getPage(params.targetId);
						ensurePageInstrumentation(page);
						const sourceInfo = resolveLocator(page, {
							ref: params.startRef,
							selector: params.fromSelector,
							required: true,
							label: "startRef or fromSelector",
						});
						const destinationInfo = resolveLocator(page, {
							ref: params.endRef,
							selector: params.toSelector,
							required: true,
							label: "endRef or toSelector",
						});
						await sourceInfo!.locator.dragTo?.(destinationInfo!.locator);
						return textResult(`Dragged: ${sourceInfo!.description} -> ${destinationInfo!.description}`);
					}

					case "select": {
						if (!params.values?.length) {
							return textResult("Error: values are required for select");
						}
						const page = await activeBrowserManager.getPage(params.targetId);
						ensurePageInstrumentation(page);
						const locatorInfo = resolveLocator(page, {
							ref: params.ref,
							selector: params.selector,
							required: true,
							label: "selector or ref",
						});
						await locatorInfo!.locator.selectOption?.(params.values);
						return textResult(`Selected: ${locatorInfo!.description}`);
					}

					case "fill": {
						const page = await activeBrowserManager.getPage(params.targetId);
						ensurePageInstrumentation(page);
						const fields = params.fields ?? [];
						if (fields.length === 0) {
							if (!params.text) {
								return textResult("Error: fields or text are required for fill");
							}
							const locatorInfo = resolveLocator(page, {
								ref: params.ref,
								selector: params.selector,
								required: true,
								label: "selector or ref",
							});
							await locatorInfo!.locator.fill?.(params.text);
							return textResult(`Filled: ${locatorInfo!.description}`);
						}
						for (const field of fields as BrowserField[]) {
							const locatorInfo = resolveLocator(page, {
								ref: field.ref,
								required: true,
								label: "field ref",
							});
							await locatorInfo!.locator.fill?.(String(field.value ?? ""));
						}
						return textResult(`Filled: ${fields.length} field(s)`);
					}

					case "resize": {
						const page = await activeBrowserManager.getPage(params.targetId);
						ensurePageInstrumentation(page);
						const width = cap(params.width, 1280, 320, 7680);
						const height = cap(params.height, 720, 240, 4320);
						await page.setViewportSize?.({ width, height });
						return textResult(`Resized: ${width}x${height}`);
					}

					case "wait": {
						const page = await activeBrowserManager.getPage(params.targetId);
						ensurePageInstrumentation(page);
						const summary = await waitAction(page, params);
						return textResult(summary);
					}

					case "evaluate": {
						const expression = params.fn;
						if (!expression) {
							return textResult("Error: fn is required for evaluate");
						}
						const page = await activeBrowserManager.getPage(params.targetId);
						ensurePageInstrumentation(page);
						const locatorInfo = resolveLocator(page, {
							ref: params.ref,
							selector: params.selector,
						});
						const result = locatorInfo
							? await evaluateOnLocator(locatorInfo.locator, expression)
							: await evaluateOnPage(page, expression);
						return textResult(truncateText(parseMaybeJson(result), params.maxChars), {
							result,
							...(locatorInfo ? { target: locatorInfo.description } : {}),
						});
					}

					case "close": {
						if (params.targetId) {
							await activeBrowserManager.closeTab(params.targetId);
							return textResult(`Closed tab: ${params.targetId}`);
						}
						await activeBrowserManager.close();
						return textResult("Browser closed");
					}

					case "pdf": {
						const filePath = await activeBrowserManager.savePdf(params.path);
						return {
							content: [{ type: "text", text: `FILE:${filePath}` }],
							details: { action: "pdf", path: filePath },
						};
					}

					case "upload": {
						const page = await activeBrowserManager.getPage(params.targetId);
						ensurePageInstrumentation(page);
						const locatorInfo = resolveLocator(page, {
							ref: params.ref,
							selector: params.selector,
							required: true,
							label: "selector or ref",
						});
						const files = params.paths && params.paths.length > 0
							? params.paths
							: params.path
								? [params.path]
								: [];
						if (files.length === 0) {
							return textResult("Error: path or paths are required for upload");
						}
						await locatorInfo!.locator.setInputFiles?.(files);
						return textResult(`Uploaded ${files.length} file(s) to ${locatorInfo!.description}`);
					}

					default:
						return textResult(`Unknown action: ${params.action}`);
				}
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				if (shouldRetryWithManagedFallback(params, msg)) {
					try {
						const retryParams = {
							...params,
							browserConnectionMode: "managed" as const,
						};
						const fallbackBrowserManager = await switchToManagedFallback();
						if (params.action === "start") {
							await fallbackBrowserManager.start();
							const connection = describeConnectionMode(fallbackBrowserManager, retryParams);
							return textResult(
								[`Browser started (${connection.label})`, `[fallback] ${fallbackNotice}`].join("\n"),
								{
									connectionMode: connection.resolvedMode ?? connection.configuredMode,
									configuredConnectionMode: connection.configuredMode,
									resolvedConnectionMode: connection.resolvedMode,
									connectionFallback: {
										from: "extension",
										to: "managed",
										reason: msg,
									},
								},
							);
						}
						if (params.action === "open") {
							const tab = await fallbackBrowserManager.createTab(params.url);
							return textResult(
								[`Opened ${tab.id}: ${tab.url || "about:blank"}`, `[fallback] ${fallbackNotice}`].join("\n"),
								{
									targetId: tab.id,
									url: tab.url,
									title: tab.title,
									connectionFallback: {
										from: "extension",
										to: "managed",
										reason: msg,
									},
								},
							);
						}
					} catch (retryError) {
						const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
						return textResult(`Browser error: ${retryMsg}`, {
							error: retryMsg,
							connectionFallback: {
								from: "extension",
								to: "managed",
								reason: msg,
							},
						});
					}
				}
				return textResult(`Browser error: ${msg}`, { error: msg });
			}
		},
	};
}

function mediaResult(
	data: string,
	filename: string,
	mimeType: string,
	details: Record<string, unknown> = {},
): AgentToolResult<unknown> {
	return {
		content: [
			{ type: "text", text: `Captured ${filename}.` },
			{ type: "image", data, mimeType } as any,
		],
		details: {
			...details,
			mimeType,
		},
	};
}

function capitalize(value: string): string {
	return value.length > 0 ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}
