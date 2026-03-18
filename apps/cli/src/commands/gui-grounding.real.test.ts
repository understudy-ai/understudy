/// <reference lib="dom" />

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asBoolean, asRecord, ConfigManager } from "@understudy/core";
import { DEFAULT_CONFIG } from "@understudy/types";
import {
	type GuiGroundingProvider,
} from "@understudy/tools";
import {
	GUI_GROUNDING_BENCHMARK_CASES,
	prepareGuiGroundingBenchmarkPage,
	type GuiGroundingBenchmarkTruth,
} from "./__tests__/gui-benchmark-fixture.js";
import {
	clearOAuthGroundingProbeCacheForTest,
	resolveMainModelGuiGroundingProvider,
} from "./gui-grounding.js";

const shouldRunRealGroundingTests = process.env.UNDERSTUDY_RUN_REAL_GROUNDING_TESTS === "1";
const shouldRunResizeGroundingTests = process.env.UNDERSTUDY_RUN_REAL_GROUNDING_RESIZE_TESTS === "1";
const MIN_TOTAL_INSIDE_HIT_RATE = 0.78;
const MIN_EXPLICIT_INSIDE_HIT_RATE = 0.90;
const MIN_AMBIGUOUS_INSIDE_HIT_RATE = 0.60;
const MIN_COMPLEX_EXPLICIT_INSIDE_HIT_RATE = 0.85;
const BENCHMARK_TIMEOUT_MS = 1_200_000;
const DEFAULT_BENCHMARK_CONCURRENCY = 1;
const MIN_ALLOWED_POINT_DISTANCE_PX = 24;
const MAX_ALLOWED_POINT_DISTANCE_PX = 160;

afterEach(() => {
	clearOAuthGroundingProbeCacheForTest();
});
const RESIZE_STABILITY_CASE_IDS = [
	"sidebar-downloads",
	"hero-open-fuzzy",
	"export-save",
	"inspector-search",
	"timeline-tab-fuzzy",
	"toolbar-filter-fuzzy",
	"preview-play-fuzzy",
	"auto-approve-toggle-fuzzy",
	"quick-add",
	"quick-add-fuzzy",
] as const;
const RESIZE_STABILITY_CONFIGS = [
	{
		id: "standard",
		viewport: { width: 1280, height: 920 },
		deviceScaleFactor: 1,
		expectedModelResize: false,
	},
	{
		id: "compact",
		viewport: { width: 1024, height: 820 },
		deviceScaleFactor: 1,
		expectedModelResize: false,
	},
	{
		id: "wide-short",
		viewport: { width: 1560, height: 780 },
		deviceScaleFactor: 1,
		expectedModelResize: false,
	},
	{
		id: "fractional-zoom",
		viewport: { width: 1280, height: 920 },
		deviceScaleFactor: 1.5,
		expectedModelResize: true,
	},
	{
		id: "retina-large",
		viewport: { width: 1440, height: 980 },
		deviceScaleFactor: 2,
		expectedModelResize: true,
	},
] as const;

type ResolvedBenchmarkProvider = {
	category: "openai";
	label: string;
	provider: GuiGroundingProvider;
};

type BenchmarkSurface =
	| "sidebar"
	| "card"
	| "table"
	| "inspector"
	| "toolbar"
	| "dialog"
	| "preview"
	| "settings";

type BenchmarkAmbiguitySource =
	| "clear_label"
	| "duplicate_label"
	| "weak_language"
	| "low_chrome"
	| "icon_semantics"
	| "indicator_control"
	| "tiny_target";

type BenchmarkMeasurement = {
	caseId: string;
	action: "click" | "type";
	kind: string;
	surface: BenchmarkSurface;
	ambiguitySource: BenchmarkAmbiguitySource;
	difficulty: "basic" | "complex";
	promptClarity: "explicit" | "ambiguous";
	groundingMode: "single" | "complex";
	target: string;
	scope?: string;
	coordinateSpace: "image_pixels" | "missing";
	found: boolean;
	inside: boolean;
	distancePx: number;
	dx: number;
	dy: number;
	elapsedMs: number;
	error?: string;
};

type ResizeBenchmarkMeasurement = BenchmarkMeasurement & {
	viewportId: string;
	wasResized?: boolean;
	expectedModelResize: boolean;
};

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

function pointInsideBox(
	point: { x: number; y: number },
	box: GuiGroundingBenchmarkTruth["box"],
	padding = 4,
): boolean {
	return point.x >= box.x - padding &&
		point.x <= box.x + box.width + padding &&
		point.y >= box.y - padding &&
		point.y <= box.y + box.height + padding;
}

function allowedPointDistancePx(truth: GuiGroundingBenchmarkTruth): number {
	return Math.min(
		MAX_ALLOWED_POINT_DISTANCE_PX,
		Math.max(
			MIN_ALLOWED_POINT_DISTANCE_PX,
			Math.max(truth.box.width, truth.box.height) * 0.45,
		),
	);
}

function classifyBenchmarkSurface(truth: GuiGroundingBenchmarkTruth): BenchmarkSurface {
	const scope = truth.scope?.trim().toLowerCase() ?? "";
	if (scope.includes("sidebar")) {
		return "sidebar";
	}
	if (scope.includes("toolbar")) {
		return "toolbar";
	}
	if (scope.includes("dialog")) {
		return "dialog";
	}
	if (scope.includes("audit")) {
		return "table";
	}
	if (scope.includes("preview")) {
		return "preview";
	}
	if (scope.includes("automation")) {
		return "settings";
	}
	if (scope.includes("inspector") || scope.includes("panel") || scope.includes("view tabs")) {
		return "inspector";
	}
	return "card";
}

function classifyBenchmarkAmbiguitySource(truth: GuiGroundingBenchmarkTruth): BenchmarkAmbiguitySource {
	switch (truth.kind) {
		case "duplicate_label_button":
			return "duplicate_label";
		case "borderless_tab":
			return "low_chrome";
		case "checkbox":
			return "indicator_control";
		case "tiny_button":
			return "tiny_target";
		case "icon_only":
			return truth.promptClarity === "ambiguous" ? "weak_language" : "icon_semantics";
		default:
			return truth.promptClarity === "ambiguous" ? "weak_language" : "clear_label";
	}
}

function parseRequestedProviderCategories(): Set<ResolvedBenchmarkProvider["category"]> | undefined {
	const raw = process.env.UNDERSTUDY_REAL_GROUNDING_PROVIDERS?.trim();
	if (!raw) {
		return undefined;
	}
	const categories = new Set<ResolvedBenchmarkProvider["category"]>();
	for (const token of raw.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean)) {
		if (token === "openai" || token === "gpt" || token === "gpt-5.4") {
			categories.add("openai");
		}
	}
	return categories.size > 0 ? categories : undefined;
}

function parseRequestedCaseIds(): Set<string> | undefined {
	const raw = process.env.UNDERSTUDY_REAL_GROUNDING_CASE_IDS?.trim();
	if (!raw) {
		return undefined;
	}
	const ids = new Set(raw.split(",").map((value) => value.trim()).filter(Boolean));
	return ids.size > 0 ? ids : undefined;
}

function parseRequestedResizeCaseIds(): Set<string> | undefined {
	const raw = process.env.UNDERSTUDY_REAL_GROUNDING_RESIZE_CASE_IDS?.trim();
	if (!raw) {
		return undefined;
	}
	const ids = new Set(raw.split(",").map((value) => value.trim()).filter(Boolean));
	return ids.size > 0 ? ids : undefined;
}

function parseRequestedResizeViewportIds(): Set<string> | undefined {
	const raw = process.env.UNDERSTUDY_REAL_GROUNDING_RESIZE_VIEWPORT_IDS?.trim();
	if (!raw) {
		return undefined;
	}
	const ids = new Set(raw.split(",").map((value) => value.trim()).filter(Boolean));
	return ids.size > 0 ? ids : undefined;
}

function insideRate(measurements: BenchmarkMeasurement[]): number {
	return measurements.length === 0
		? 1
		: measurements.filter((measurement) => measurement.inside).length / measurements.length;
}

function resolveBenchmarkConcurrency(): number {
	const raw = Number.parseInt(process.env.UNDERSTUDY_REAL_GROUNDING_CONCURRENCY ?? "", 10);
	if (Number.isFinite(raw) && raw > 0) {
		return raw;
	}
	return DEFAULT_BENCHMARK_CONCURRENCY;
}

function summarizeLatency(measurements: BenchmarkMeasurement[]): {
	avgLatencyMs: number | null;
	p95LatencyMs: number | null;
} {
	if (measurements.length === 0) {
		return { avgLatencyMs: null, p95LatencyMs: null };
	}
	const latencies = measurements
		.map((measurement) => measurement.elapsedMs)
		.filter((value) => Number.isFinite(value))
		.sort((left, right) => left - right);
	if (latencies.length === 0) {
		return { avgLatencyMs: null, p95LatencyMs: null };
	}
	const avgLatencyMs = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
	const p95Index = Math.min(latencies.length - 1, Math.max(0, Math.ceil(latencies.length * 0.95) - 1));
	return {
		avgLatencyMs,
		p95LatencyMs: latencies[p95Index] ?? null,
	};
}

function summarizeMeasurementsByField<TField extends keyof Pick<
	BenchmarkMeasurement,
	"action" | "kind" | "surface" | "ambiguitySource" | "difficulty" | "promptClarity" | "groundingMode"
>>(measurements: BenchmarkMeasurement[], field: TField): Array<{
	bucket: BenchmarkMeasurement[TField];
	total: number;
	found: number;
	inside: number;
	errors: number;
	maxDistancePx: number | null;
	avgLatencyMs: number | null;
	p95LatencyMs: number | null;
}> {
	return Array.from(new Set(measurements.map((measurement) => measurement[field])))
		.sort()
		.map((bucket) => {
			const bucketMeasurements = measurements.filter((measurement) => measurement[field] === bucket);
			const finiteDistances = bucketMeasurements
				.map((measurement) => measurement.distancePx)
				.filter((value) => Number.isFinite(value));
			const latency = summarizeLatency(bucketMeasurements);
			return {
				bucket,
				total: bucketMeasurements.length,
				found: bucketMeasurements.filter((measurement) => measurement.found).length,
				inside: bucketMeasurements.filter((measurement) => measurement.inside).length,
				errors: bucketMeasurements.filter((measurement) => Boolean(measurement.error)).length,
				maxDistancePx: finiteDistances.length > 0 ? Math.max(...finiteDistances) : null,
				avgLatencyMs: latency.avgLatencyMs,
				p95LatencyMs: latency.p95LatencyMs,
			};
		});
}

function scaleTruth(
	truth: GuiGroundingBenchmarkTruth,
	scale: number,
): GuiGroundingBenchmarkTruth {
	if (scale === 1) {
		return truth;
	}
	return {
		...truth,
		box: {
			x: Math.round(truth.box.x * scale),
			y: Math.round(truth.box.y * scale),
			width: Math.round(truth.box.width * scale),
			height: Math.round(truth.box.height * scale),
		},
		point: {
			x: Math.round(truth.point.x * scale),
			y: Math.round(truth.point.y * scale),
		},
	};
}

async function createBenchmarkCapture(params: {
	browser: any;
	viewport: { width: number; height: number };
	deviceScaleFactor: number;
}): Promise<{
	screenshotPath: string;
	truths: GuiGroundingBenchmarkTruth[];
	logicalSize: { width: number; height: number };
	imageScale: { x: number; y: number };
	cleanup: () => Promise<void>;
}> {
	const context = await params.browser.newContext({
		viewport: params.viewport,
		deviceScaleFactor: params.deviceScaleFactor,
	});
	const page = await context.newPage();
	const prepared = await prepareGuiGroundingBenchmarkPage(page);
	const tempDir = await mkdtemp(join(tmpdir(), "understudy-real-grounding-variant-"));
	const screenshotPath = join(tempDir, `gui-grounding-${params.viewport.width}x${params.viewport.height}@${params.deviceScaleFactor}x.png`);
	await page.screenshot({
		path: screenshotPath,
		animations: "disabled",
		fullPage: true,
	});
	const screenshotSize = parsePngDimensions(Buffer.from(await readFile(screenshotPath)));
	if (!screenshotSize) {
		throw new Error(`Failed to parse benchmark screenshot dimensions for ${screenshotPath}`);
	}
	const logicalSize = {
		width: Math.max(1, Math.round(screenshotSize.width / params.deviceScaleFactor)),
		height: Math.max(1, Math.round(screenshotSize.height / params.deviceScaleFactor)),
	};
	return {
		screenshotPath,
		truths: prepared.truths.map((truth) => scaleTruth(truth, params.deviceScaleFactor)),
		logicalSize,
		imageScale: {
			x: screenshotSize.width / logicalSize.width,
			y: screenshotSize.height / logicalSize.height,
		},
		cleanup: async () => {
			await context.close().catch(() => {});
			await rm(tempDir, { recursive: true, force: true }).catch(() => {});
		},
	};
}

async function resolveBenchmarkProviders(): Promise<ResolvedBenchmarkProvider[]> {
	const resolved: ResolvedBenchmarkProvider[] = [];
	const requestedCategories = parseRequestedProviderCategories();

	const openai = await resolveMainModelGuiGroundingProvider({
		...DEFAULT_CONFIG,
		defaultProvider: "openai-codex",
		defaultModel: "gpt-5.4",
		defaultThinkingLevel: "minimal",
	});
	if (
		openai?.available &&
		openai.groundingProvider &&
		openai.label?.includes("openai") &&
		(!requestedCategories || requestedCategories.has("openai"))
	) {
		resolved.push({
			category: "openai",
			label: openai.label,
			provider: openai.groundingProvider,
		});
	}

	return resolved;
}

async function mapWithConcurrency<T, TResult>(
	items: readonly T[],
	concurrency: number,
	worker: (item: T, index: number) => Promise<TResult>,
): Promise<TResult[]> {
	const results: TResult[] = [];
	let nextIndex = 0;

	async function runWorker(): Promise<void> {
		while (true) {
			const currentIndex = nextIndex;
			nextIndex += 1;
			if (currentIndex >= items.length) {
				return;
			}
			results[currentIndex] = await worker(items[currentIndex]!, currentIndex);
		}
	}

	await Promise.all(
		Array.from(
			{ length: Math.max(1, Math.min(concurrency, items.length)) },
			() => runWorker(),
		),
	);
	return results;
}

describe.runIf(shouldRunRealGroundingTests)("GUI grounding benchmark", () => {
	let browser: any;
	let page: any;
	let tempDir: string;
	let screenshotPath: string;
	let truths: GuiGroundingBenchmarkTruth[] = [];
	let providers: ResolvedBenchmarkProvider[] = [];
	let screenshotLogicalSize: { width: number; height: number } | undefined;
	let screenshotImageScale: { x: number; y: number } | undefined;
	const requestedCaseIds = parseRequestedCaseIds();
	const requestedResizeCaseIds = parseRequestedResizeCaseIds();
	const requestedResizeViewportIds = parseRequestedResizeViewportIds();

	beforeAll(async () => {
		await ConfigManager.load().catch(() => undefined);
		const { chromium } = await import("playwright");
		browser = await chromium.launch({ headless: true });
		const context = await browser.newContext({
			viewport: { width: 1280, height: 920 },
			deviceScaleFactor: 1,
		});
		page = await context.newPage();
		truths = (await prepareGuiGroundingBenchmarkPage(page)).truths
			.filter((truth) => !requestedCaseIds || requestedCaseIds.has(truth.id));
		if (requestedCaseIds) {
			expect(truths.map((truth) => truth.id).sort()).toEqual([...requestedCaseIds].sort());
		} else {
			expect(truths).toHaveLength(GUI_GROUNDING_BENCHMARK_CASES.length);
		}
		tempDir = await mkdtemp(join(tmpdir(), "understudy-real-grounding-"));
		screenshotPath = join(tempDir, "gui-grounding-benchmark.png");
		await page.screenshot({
			path: screenshotPath,
			animations: "disabled",
			fullPage: true,
		});
		const screenshotSize = parsePngDimensions(Buffer.from(await readFile(screenshotPath)));
		if (!screenshotSize) {
			throw new Error(`Failed to parse benchmark screenshot dimensions for ${screenshotPath}`);
		}
		screenshotLogicalSize = { width: screenshotSize.width, height: screenshotSize.height };
		screenshotImageScale = { x: 1, y: 1 };
		providers = await resolveBenchmarkProviders();
	});

	afterAll(async () => {
		await browser?.close().catch(() => {});
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true }).catch(() => {});
		}
	});

	it("grounds known benchmark targets with configured real providers", async () => {
		if (providers.length === 0) {
			console.warn("No real grounding provider is configured; skipping benchmark run.");
			return;
		}

		const concurrency = resolveBenchmarkConcurrency();

		for (const candidate of providers) {
			const failures: string[] = [];
			const measurements: BenchmarkMeasurement[] = await mapWithConcurrency(truths, concurrency, async (truth, index) => {
				if (process.env.UNDERSTUDY_REAL_GROUNDING_VERBOSE === "1") {
					console.log(
						`[grounding-benchmark] ${candidate.label} case ${index + 1}/${truths.length}: ${truth.id}`,
					);
				}
				let grounded;
				let errorMessage: string | undefined;
				const groundingMode: BenchmarkMeasurement["groundingMode"] =
					truth.difficulty === "complex" ? "complex" : "single";
				const surface = classifyBenchmarkSurface(truth);
				const ambiguitySource = classifyBenchmarkAmbiguitySource(truth);
				const startedAt = performance.now();
				try {
					grounded = await candidate.provider.ground({
						imagePath: screenshotPath,
						logicalImageWidth: screenshotLogicalSize?.width,
						logicalImageHeight: screenshotLogicalSize?.height,
						imageScaleX: screenshotImageScale?.x,
						imageScaleY: screenshotImageScale?.y,
						target: truth.target,
						locationHint: truth.locationHint,
						scope: truth.scope,
						action: truth.action,
						groundingMode,
						captureMode: "window",
						app: "Understudy GUI benchmark",
					});
				} catch (error) {
					errorMessage = error instanceof Error ? error.message : String(error);
				}
				const elapsedMs = Math.round(performance.now() - startedAt);

				if (!grounded) {
					return {
						caseId: truth.id,
						action: truth.action,
						kind: truth.kind,
						surface,
						ambiguitySource,
						difficulty: truth.difficulty,
						promptClarity: truth.promptClarity,
						groundingMode,
						target: truth.target,
						scope: truth.scope,
						coordinateSpace: "missing",
						found: false,
						inside: false,
						distancePx: Number.POSITIVE_INFINITY,
						dx: Number.POSITIVE_INFINITY,
						dy: Number.POSITIVE_INFINITY,
						elapsedMs,
						error: errorMessage,
					} satisfies BenchmarkMeasurement;
				}

				const dx = grounded.point.x - truth.point.x;
				const dy = grounded.point.y - truth.point.y;
				const distancePx = Math.hypot(dx, dy);
				return {
					caseId: truth.id,
					action: truth.action,
					kind: truth.kind,
					surface,
					ambiguitySource,
					difficulty: truth.difficulty,
					promptClarity: truth.promptClarity,
					groundingMode,
					target: truth.target,
					scope: truth.scope,
					coordinateSpace: grounded.coordinateSpace === "image_pixels" ? "image_pixels" : "missing",
					found: true,
					inside: pointInsideBox(grounded.point, truth.box),
					distancePx,
					dx,
					dy,
					elapsedMs,
					error: errorMessage,
				} satisfies BenchmarkMeasurement;
			});

			console.log(`\n[grounding-benchmark] ${candidate.label}`);
			console.log(`[grounding-benchmark] concurrency=${concurrency}, cases=${measurements.length}`);
			console.table(measurements.map((measurement) => ({
				caseId: measurement.caseId,
				action: measurement.action,
				archetype: measurement.kind,
				surface: measurement.surface,
				ambiguitySource: measurement.ambiguitySource,
				difficulty: measurement.difficulty,
				promptClarity: measurement.promptClarity,
				groundingMode: measurement.groundingMode,
				coordinateSpace: measurement.coordinateSpace,
				found: measurement.found,
				inside: measurement.inside,
				elapsedMs: measurement.elapsedMs,
				distancePx: Number.isFinite(measurement.distancePx) ? Number(measurement.distancePx.toFixed(1)) : "missing",
				dx: Number.isFinite(measurement.dx) ? Number(measurement.dx.toFixed(1)) : "missing",
				dy: Number.isFinite(measurement.dy) ? Number(measurement.dy.toFixed(1)) : "missing",
				error: measurement.error ?? "",
			})));
			console.table(summarizeMeasurementsByField(measurements, "kind").map((summary) => ({
				archetype: summary.bucket,
				total: summary.total,
				found: summary.found,
				inside: summary.inside,
				errors: summary.errors,
				maxDistancePx: summary.maxDistancePx === null ? "missing" : Number(summary.maxDistancePx.toFixed(1)),
				avgLatencyMs: summary.avgLatencyMs === null ? "missing" : Number(summary.avgLatencyMs.toFixed(0)),
				p95LatencyMs: summary.p95LatencyMs === null ? "missing" : Number(summary.p95LatencyMs.toFixed(0)),
			})));
			console.table(summarizeMeasurementsByField(measurements, "action").map((summary) => ({
				action: summary.bucket,
				total: summary.total,
				found: summary.found,
				inside: summary.inside,
				errors: summary.errors,
				maxDistancePx: summary.maxDistancePx === null ? "missing" : Number(summary.maxDistancePx.toFixed(1)),
				avgLatencyMs: summary.avgLatencyMs === null ? "missing" : Number(summary.avgLatencyMs.toFixed(0)),
				p95LatencyMs: summary.p95LatencyMs === null ? "missing" : Number(summary.p95LatencyMs.toFixed(0)),
			})));
			console.table(summarizeMeasurementsByField(measurements, "surface").map((summary) => ({
				surface: summary.bucket,
				total: summary.total,
				found: summary.found,
				inside: summary.inside,
				errors: summary.errors,
				maxDistancePx: summary.maxDistancePx === null ? "missing" : Number(summary.maxDistancePx.toFixed(1)),
				avgLatencyMs: summary.avgLatencyMs === null ? "missing" : Number(summary.avgLatencyMs.toFixed(0)),
				p95LatencyMs: summary.p95LatencyMs === null ? "missing" : Number(summary.p95LatencyMs.toFixed(0)),
			})));
			console.table(summarizeMeasurementsByField(measurements, "ambiguitySource").map((summary) => ({
				ambiguitySource: summary.bucket,
				total: summary.total,
				found: summary.found,
				inside: summary.inside,
				errors: summary.errors,
				maxDistancePx: summary.maxDistancePx === null ? "missing" : Number(summary.maxDistancePx.toFixed(1)),
				avgLatencyMs: summary.avgLatencyMs === null ? "missing" : Number(summary.avgLatencyMs.toFixed(0)),
				p95LatencyMs: summary.p95LatencyMs === null ? "missing" : Number(summary.p95LatencyMs.toFixed(0)),
			})));
			console.table(summarizeMeasurementsByField(measurements, "groundingMode").map((summary) => ({
				groundingMode: summary.bucket,
				total: summary.total,
				found: summary.found,
				inside: summary.inside,
				errors: summary.errors,
				maxDistancePx: summary.maxDistancePx === null ? "missing" : Number(summary.maxDistancePx.toFixed(1)),
				avgLatencyMs: summary.avgLatencyMs === null ? "missing" : Number(summary.avgLatencyMs.toFixed(0)),
				p95LatencyMs: summary.p95LatencyMs === null ? "missing" : Number(summary.p95LatencyMs.toFixed(0)),
			})));
			console.table(summarizeMeasurementsByField(measurements, "promptClarity").map((summary) => ({
				promptClarity: summary.bucket,
				total: summary.total,
				found: summary.found,
				inside: summary.inside,
				errors: summary.errors,
				maxDistancePx: summary.maxDistancePx === null ? "missing" : Number(summary.maxDistancePx.toFixed(1)),
				avgLatencyMs: summary.avgLatencyMs === null ? "missing" : Number(summary.avgLatencyMs.toFixed(0)),
				p95LatencyMs: summary.p95LatencyMs === null ? "missing" : Number(summary.p95LatencyMs.toFixed(0)),
			})));
			console.table(summarizeMeasurementsByField(measurements, "difficulty").map((summary) => ({
				difficulty: summary.bucket,
				total: summary.total,
				found: summary.found,
				inside: summary.inside,
				errors: summary.errors,
				maxDistancePx: summary.maxDistancePx === null ? "missing" : Number(summary.maxDistancePx.toFixed(1)),
				avgLatencyMs: summary.avgLatencyMs === null ? "missing" : Number(summary.avgLatencyMs.toFixed(0)),
				p95LatencyMs: summary.p95LatencyMs === null ? "missing" : Number(summary.p95LatencyMs.toFixed(0)),
			})));

			const foundMeasurements = measurements.filter((measurement) => measurement.found);
			const explicitMeasurements = measurements.filter((measurement) => measurement.promptClarity === "explicit");
			const ambiguousMeasurements = measurements.filter((measurement) => measurement.promptClarity === "ambiguous");
			const complexMeasurements = measurements.filter((measurement) => measurement.difficulty === "complex");
			const complexExplicitMeasurements = complexMeasurements.filter(
				(measurement) => measurement.promptClarity === "explicit",
			);
			const providerErrors = measurements.filter((measurement) => measurement.error);
			const pointDistanceOutliers = foundMeasurements.filter((measurement) => {
				const truth = truths.find((candidateTruth) => candidateTruth.id === measurement.caseId);
				return truth ? measurement.distancePx > allowedPointDistancePx(truth) : false;
			});
			const totalHitRate = insideRate(measurements);
			const explicitHitRate = insideRate(explicitMeasurements);
			const ambiguousHitRate = insideRate(ambiguousMeasurements);
			const complexExplicitHitRate = insideRate(complexExplicitMeasurements);
			const missingKinds = summarizeMeasurementsByField(measurements, "kind")
				.filter((summary) => summary.inside === 0)
				.map((summary) => String(summary.bucket));
			const explicitMissingCases = explicitMeasurements
				.filter((measurement) => !measurement.found)
				.map((measurement) => measurement.caseId);

			if (explicitMissingCases.length > 0) {
				failures.push(
					`${candidate.label} should ground every explicit benchmark case (missing ${explicitMissingCases.join(", ")})`,
				);
			}
			if (totalHitRate < MIN_TOTAL_INSIDE_HIT_RATE) {
				failures.push(
					`${candidate.label} total inside hit rate ${totalHitRate.toFixed(2)} is below ${MIN_TOTAL_INSIDE_HIT_RATE.toFixed(2)}`,
				);
			}
			if (explicitHitRate < MIN_EXPLICIT_INSIDE_HIT_RATE) {
				failures.push(
					`${candidate.label} explicit inside hit rate ${explicitHitRate.toFixed(2)} is below ${MIN_EXPLICIT_INSIDE_HIT_RATE.toFixed(2)}`,
				);
			}
			if (ambiguousHitRate < MIN_AMBIGUOUS_INSIDE_HIT_RATE) {
				failures.push(
					`${candidate.label} ambiguous inside hit rate ${ambiguousHitRate.toFixed(2)} is below ${MIN_AMBIGUOUS_INSIDE_HIT_RATE.toFixed(2)}`,
				);
			}
			if (pointDistanceOutliers.length > 0) {
				failures.push(
					`${candidate.label} point distance exceeded control-aware thresholds for ${pointDistanceOutliers.map((measurement) => measurement.caseId).join(", ")}`,
				);
			}
			if (providerErrors.length > 0) {
				failures.push(
					`${candidate.label} returned provider errors for ${providerErrors.length} cases (${providerErrors.map((measurement) => measurement.caseId).join(", ")})`,
				);
			}
			if (complexExplicitHitRate < MIN_COMPLEX_EXPLICIT_INSIDE_HIT_RATE) {
				failures.push(
					`${candidate.label} complex explicit hit rate ${complexExplicitHitRate.toFixed(2)} is below ${MIN_COMPLEX_EXPLICIT_INSIDE_HIT_RATE.toFixed(2)}`,
				);
			}
			if (missingKinds.length > 0) {
				failures.push(
					`${candidate.label} missed every case for control kinds: ${missingKinds.join(", ")}`,
				);
			}
			expect(failures).toEqual([]);
		}
	}, BENCHMARK_TIMEOUT_MS);

	it.runIf(shouldRunResizeGroundingTests)("keeps grounding stable across window sizes and retina captures", async () => {
		const openai = providers.find((provider) => provider.category === "openai");
		if (!openai) {
			console.warn("OpenAI grounding provider unavailable; skipping resize stability benchmark.");
			return;
		}

		const concurrency = resolveBenchmarkConcurrency();

		const resizeConfigs = requestedResizeViewportIds
			? RESIZE_STABILITY_CONFIGS.filter((config) => requestedResizeViewportIds.has(config.id))
			: RESIZE_STABILITY_CONFIGS;
		const selectedCaseIds = requestedResizeCaseIds ?? new Set<string>(RESIZE_STABILITY_CASE_IDS);

		for (const config of resizeConfigs) {
			const capture = await createBenchmarkCapture({
				browser,
				viewport: config.viewport,
				deviceScaleFactor: config.deviceScaleFactor,
			});
			try {
				const selectedTruths = capture.truths.filter((truth) => selectedCaseIds.has(truth.id));
				expect(selectedTruths).toHaveLength(selectedCaseIds.size);
				const measurements: ResizeBenchmarkMeasurement[] = await mapWithConcurrency(selectedTruths, concurrency, async (truth) => {
					let grounded;
					let errorMessage: string | undefined;
					const groundingMode: BenchmarkMeasurement["groundingMode"] =
						truth.difficulty === "complex" ? "complex" : "single";
					const surface = classifyBenchmarkSurface(truth);
					const ambiguitySource = classifyBenchmarkAmbiguitySource(truth);
					const startedAt = performance.now();
					try {
						grounded = await openai.provider.ground({
							imagePath: capture.screenshotPath,
							logicalImageWidth: capture.logicalSize.width,
							logicalImageHeight: capture.logicalSize.height,
							imageScaleX: capture.imageScale.x,
							imageScaleY: capture.imageScale.y,
							target: truth.target,
							locationHint: truth.locationHint,
							scope: truth.scope,
							action: truth.action,
							groundingMode,
							captureMode: "window",
							app: "Understudy GUI benchmark",
						});
					} catch (error) {
						errorMessage = error instanceof Error ? error.message : String(error);
					}
					const elapsedMs = Math.round(performance.now() - startedAt);

					if (!grounded) {
						return {
							caseId: truth.id,
							action: truth.action,
							kind: truth.kind,
							surface,
							ambiguitySource,
							difficulty: truth.difficulty,
							promptClarity: truth.promptClarity,
							groundingMode,
							target: truth.target,
							scope: truth.scope,
							coordinateSpace: "missing",
							found: false,
							inside: false,
							distancePx: Number.POSITIVE_INFINITY,
							dx: Number.POSITIVE_INFINITY,
							dy: Number.POSITIVE_INFINITY,
							elapsedMs,
							error: errorMessage,
							viewportId: config.id,
							wasResized: undefined,
							expectedModelResize: config.expectedModelResize,
						} satisfies ResizeBenchmarkMeasurement;
					}

					const raw = asRecord(grounded.raw) ?? {};
					const modelImage = asRecord(raw.grounding_model_image);
					const wasResized = asBoolean(modelImage?.wasResized);
					const dx = grounded.point.x - truth.point.x;
					const dy = grounded.point.y - truth.point.y;
					const distancePx = Math.hypot(dx, dy);
					return {
						caseId: truth.id,
						action: truth.action,
						kind: truth.kind,
						surface,
						ambiguitySource,
						difficulty: truth.difficulty,
						promptClarity: truth.promptClarity,
						groundingMode,
						target: truth.target,
						scope: truth.scope,
						coordinateSpace: grounded.coordinateSpace === "image_pixels" ? "image_pixels" : "missing",
						found: true,
						inside: pointInsideBox(grounded.point, truth.box),
						distancePx,
						dx,
						dy,
						elapsedMs,
						error: errorMessage,
						viewportId: config.id,
						wasResized,
						expectedModelResize: config.expectedModelResize,
					} satisfies ResizeBenchmarkMeasurement;
				});

				console.log(`\n[grounding-resize] ${openai.label} viewport=${config.id} ${config.viewport.width}x${config.viewport.height} @${config.deviceScaleFactor}x`);
				console.table(measurements.map((measurement) => ({
					caseId: measurement.caseId,
					action: measurement.action,
					archetype: measurement.kind,
					surface: measurement.surface,
					ambiguitySource: measurement.ambiguitySource,
					promptClarity: measurement.promptClarity,
					found: measurement.found,
					inside: measurement.inside,
					wasResized: measurement.wasResized ?? "missing",
					expectedModelResize: measurement.expectedModelResize,
					distancePx: Number.isFinite(measurement.distancePx) ? Number(measurement.distancePx.toFixed(1)) : "missing",
					elapsedMs: measurement.elapsedMs,
					error: measurement.error ?? "",
				})));
				console.table(summarizeMeasurementsByField(measurements, "action").map((summary) => ({
					action: summary.bucket,
					total: summary.total,
					found: summary.found,
					inside: summary.inside,
					errors: summary.errors,
					maxDistancePx: summary.maxDistancePx === null ? "missing" : Number(summary.maxDistancePx.toFixed(1)),
					avgLatencyMs: summary.avgLatencyMs === null ? "missing" : Number(summary.avgLatencyMs.toFixed(0)),
					p95LatencyMs: summary.p95LatencyMs === null ? "missing" : Number(summary.p95LatencyMs.toFixed(0)),
				})));
				console.table(summarizeMeasurementsByField(measurements, "surface").map((summary) => ({
					surface: summary.bucket,
					total: summary.total,
					found: summary.found,
					inside: summary.inside,
					errors: summary.errors,
					maxDistancePx: summary.maxDistancePx === null ? "missing" : Number(summary.maxDistancePx.toFixed(1)),
					avgLatencyMs: summary.avgLatencyMs === null ? "missing" : Number(summary.avgLatencyMs.toFixed(0)),
					p95LatencyMs: summary.p95LatencyMs === null ? "missing" : Number(summary.p95LatencyMs.toFixed(0)),
				})));
				console.table(summarizeMeasurementsByField(measurements, "ambiguitySource").map((summary) => ({
					ambiguitySource: summary.bucket,
					total: summary.total,
					found: summary.found,
					inside: summary.inside,
					errors: summary.errors,
					maxDistancePx: summary.maxDistancePx === null ? "missing" : Number(summary.maxDistancePx.toFixed(1)),
					avgLatencyMs: summary.avgLatencyMs === null ? "missing" : Number(summary.avgLatencyMs.toFixed(0)),
					p95LatencyMs: summary.p95LatencyMs === null ? "missing" : Number(summary.p95LatencyMs.toFixed(0)),
				})));

				const failures: string[] = [];
				const explicitMeasurements = measurements.filter((measurement) => measurement.promptClarity === "explicit");
				const providerErrors = measurements.filter((measurement) => measurement.error);
				const foundMeasurements = measurements.filter((measurement) => measurement.found);
				const insideHitRate = insideRate(measurements);
				const explicitHitRate = insideRate(explicitMeasurements);
				const resizeMismatch = foundMeasurements.filter(
					(measurement) => measurement.wasResized !== measurement.expectedModelResize,
				);

				if (providerErrors.length > 0) {
					failures.push(
						`${config.id}: provider returned errors for ${providerErrors.map((measurement) => measurement.caseId).join(", ")}`,
					);
				}
				if (explicitHitRate < 1) {
					failures.push(`${config.id}: explicit resize benchmark hit rate dropped below 1.00`);
				}
				if (insideHitRate < 0.85) {
					failures.push(`${config.id}: resize benchmark inside hit rate ${insideHitRate.toFixed(2)} is below 0.85`);
				}
				if (resizeMismatch.length > 0) {
					failures.push(
						`${config.id}: resize expectation mismatch for ${resizeMismatch.map((measurement) => measurement.caseId).join(", ")}`,
					);
				}

				expect(failures).toEqual([]);
			} finally {
				await capture.cleanup();
			}
		}
	}, 1_200_000);

	it("keeps duplicate-label disambiguation stable for the two Open buttons", async () => {
		const openai = providers.find((provider) => provider.category === "openai");
		if (!openai) {
			console.warn("OpenAI grounding provider unavailable; skipping duplicate-label disambiguation check.");
			return;
		}

		const hero = truths.find((truth) => truth.id === "hero-open");
		const activity = truths.find((truth) => truth.id === "activity-open");
		expect(hero).toBeDefined();
		expect(activity).toBeDefined();

		const heroGrounded = await openai.provider.ground({
			imagePath: screenshotPath,
			logicalImageWidth: screenshotLogicalSize?.width,
			logicalImageHeight: screenshotLogicalSize?.height,
			imageScaleX: screenshotImageScale?.x,
			imageScaleY: screenshotImageScale?.y,
			target: hero!.target,
			locationHint: hero!.locationHint,
			scope: hero!.scope,
			action: hero!.action,
			groundingMode: "complex",
			captureMode: "window",
			app: "Understudy GUI benchmark",
		});
		const activityGrounded = await openai.provider.ground({
			imagePath: screenshotPath,
			logicalImageWidth: screenshotLogicalSize?.width,
			logicalImageHeight: screenshotLogicalSize?.height,
			imageScaleX: screenshotImageScale?.x,
			imageScaleY: screenshotImageScale?.y,
			target: activity!.target,
			locationHint: activity!.locationHint,
			scope: activity!.scope,
			action: activity!.action,
			groundingMode: "complex",
			captureMode: "window",
			app: "Understudy GUI benchmark",
		});

		expect(heroGrounded?.coordinateSpace).toBe("image_pixels");
		expect(activityGrounded?.coordinateSpace).toBe("image_pixels");
		expect(heroGrounded && pointInsideBox(heroGrounded.point, hero!.box)).toBe(true);
		expect(activityGrounded && pointInsideBox(activityGrounded.point, activity!.box)).toBe(true);
		expect(activityGrounded && pointInsideBox(activityGrounded.point, hero!.box)).toBe(false);
		expect(heroGrounded && pointInsideBox(heroGrounded.point, activity!.box)).toBe(false);
	}, 120_000);
});
