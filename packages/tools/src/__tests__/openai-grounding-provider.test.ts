import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAIGroundingProvider } from "../openai-grounding-provider.js";
import {
	cleanupTempDirs,
	createPngBuffer,
	createSequentialFetch,
	createSimulationImageImpl,
	createTestImage,
	extractPromptText,
	requestInputContent,
} from "./grounding-test-helpers.js";

afterEach(async () => {
	await cleanupTempDirs();
});

describe("createOpenAIGroundingProvider", () => {
	it("threads complex grounding mode into a predictor plus validator round", async () => {
		const imagePath = await createTestImage();
		const fetchMock = createSequentialFetch([
			'{"status":"resolved","found":true,"confidence":0.92,"reason":"matched codex menu","coordinate_space":"image_pixels","click_point":{"x":28,"y":16},"bbox":{"x1":12,"y1":8,"x2":52,"y2":28}}',
			'{"status":"pass","approved":true,"confidence":0.95,"reason":"target confirmed"}',
		]);
		const simulationImageImpl = createSimulationImageImpl();
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
			simulationImageImpl,
		});

			const grounded = await provider.ground({
				imagePath,
				target: "top-left menu bar item labeled Codex",
				app: "Codex",
				action: "click",
				groundingMode: "complex",
			});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(simulationImageImpl).toHaveBeenCalledTimes(1);
		const predictionInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
		const predictionImages = requestInputContent(predictionInit?.body)
			.filter((item) => item.type === "input_image");
		expect(predictionImages).toHaveLength(1);
		expect(predictionImages[0]).toMatchObject({ detail: "high" });
		expect(extractPromptText(predictionInit?.body)).toContain("Grounding mode requested by the caller: complex.");
		expect(extractPromptText((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body)).toContain("You are a GUI grounding validator.");
		expect(grounded).toMatchObject({
			method: "grounding",
			provider: "openai:gpt-5.4",
			confidence: 0.92,
			coordinateSpace: "image_pixels",
			point: { x: 28, y: 16 },
			box: { x: 12, y: 8, width: 40, height: 20 },
			raw: {
				selected_attempt: "validated",
				grounding_selected_round: 1,
			},
		});
	});

	it("returns after one predictor round when the caller leaves grounding in single mode", async () => {
		const imagePath = await createTestImage(2000, 1000, "openai-pixels.png");
		const fetchMock = createSequentialFetch([
			'{"status":"resolved","found":true,"confidence":0.82,"reason":"pixel match","click_point":{"x":500,"y":250},"bbox":{"x1":420,"y1":220,"x2":580,"y2":280}}',
		]);
		const simulationImageImpl = createSimulationImageImpl();
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
			simulationImageImpl,
		});

		const grounded = await provider.ground({
			imagePath,
			target: "top-left menu bar item labeled Codex",
			app: "Codex",
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(simulationImageImpl).not.toHaveBeenCalled();
		const predictionInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
		const predictionImages = requestInputContent(predictionInit?.body)
			.filter((item) => item.type === "input_image");
		expect(predictionImages[0]).toMatchObject({ detail: "high" });
		expect(extractPromptText(predictionInit?.body)).toContain("Grounding mode requested by the caller: single.");
		expect(grounded).toMatchObject({
			coordinateSpace: "image_pixels",
			point: { x: 500, y: 250 },
			box: { x: 420, y: 220, width: 160, height: 60 },
			raw: {
				selected_attempt: "predicted",
				grounding_selected_round: 1,
			},
		});
	});

	it("auto-validates high-risk click targets even when grounding stays in single mode", async () => {
		const imagePath = await createTestImage(1600, 900, "openai-high-risk.png");
		const fetchMock = createSequentialFetch([
			'{"status":"resolved","found":true,"confidence":0.83,"reason":"matched delete button","click_point":{"x":420,"y":220},"bbox":{"x1":380,"y1":196,"x2":462,"y2":244}}',
			'{"status":"pass","approved":true,"confidence":0.94,"reason":"exact destructive target"}',
		]);
		const simulationImageImpl = createSimulationImageImpl();
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
			simulationImageImpl,
		});

		const grounded = await provider.ground({
			imagePath,
			target: "Delete conversation button",
			action: "click",
			scope: "confirmation dialog",
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(simulationImageImpl).toHaveBeenCalledTimes(1);
		expect(extractPromptText((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body))
			.toContain("This is a high-risk action target.");
		expect(extractPromptText((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body))
			.toContain("This candidate is for a high-risk action.");
		expect(grounded).toMatchObject({
			point: { x: 420, y: 220 },
			raw: {
				selected_attempt: "validated",
				grounding_selected_round: 1,
			},
		});
	});

	it("skips the validator round for observation-style wait grounding even in complex mode", async () => {
		const imagePath = await createTestImage(1200, 800, "openai-wait-complex.png");
		const fetchMock = createSequentialFetch([
			'{"status":"resolved","found":true,"confidence":0.89,"reason":"matched status panel","coordinate_space":"image_pixels","bbox":{"x1":360,"y1":240,"x2":780,"y2":420}}',
		]);
		const simulationImageImpl = createSimulationImageImpl();
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
			simulationImageImpl,
		});

		const grounded = await provider.ground({
			imagePath,
			target: "Processing complete panel",
			action: "wait",
			groundingMode: "complex",
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(simulationImageImpl).not.toHaveBeenCalled();
		expect(grounded).toMatchObject({
			coordinateSpace: "image_pixels",
			point: { x: 570, y: 330 },
			raw: {
				selected_attempt: "predicted",
				grounding_selected_round: 1,
				validation: {
					status: "skipped",
					reason: "observation grounding does not require simulated action validation",
				},
			},
		});
	});

	it("grounds in model-space and maps the result back to the original screenshot", async () => {
		const imagePath = await createTestImage(2000, 1000, "openai-large.png");
		const fetchMock = createSequentialFetch([
			'{"status":"resolved","found":true,"confidence":0.88,"reason":"resized match","click_point":{"x":500,"y":250},"bbox":{"x1":420,"y1":220,"x2":580,"y2":280}}',
		]);
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
			prepareModelFrameImpl: async (frame) => ({
				frame: {
					...frame,
					bytes: createPngBuffer(1000, 500),
					mimeType: "image/png",
					width: 1000,
					height: 500,
				},
				modelToOriginalScaleX: 2,
				modelToOriginalScaleY: 2,
				wasResized: true,
				logicalNormalizationApplied: false,
				workingWidth: 2000,
				workingHeight: 1000,
				workingToOriginalScaleX: 1,
				workingToOriginalScaleY: 1,
				originalWidth: 2000,
				originalHeight: 1000,
				offsetX: 0,
				offsetY: 0,
			}),
		});

		const grounded = await provider.ground({
			imagePath,
			target: "Clear Chat History menu item with circle X icon",
			app: "Telegram",
			locationHint: "lower part of the menu above Delete Chat",
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const predictionInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
		expect(extractPromptText(predictionInit?.body)).toContain("Image size: 1000x500 pixels.");
		expect(grounded).toMatchObject({
			coordinateSpace: "image_pixels",
			point: { x: 1000, y: 500 },
			box: { x: 840, y: 440, width: 320, height: 120 },
			raw: {
				selected_attempt: "predicted",
				grounding_selected_round: 1,
				grounding_model_image: {
					width: 1000,
					height: 500,
					mimeType: "image/png",
					wasResized: true,
				},
				grounding_original_image: {
					width: 2000,
					height: 1000,
				},
				grounding_model_to_original_scale: {
					x: 2,
					y: 2,
				},
				grounding_working_image: {
					width: 2000,
					height: 1000,
					logicalNormalizationApplied: false,
				},
			},
		});
	});

	it("normalizes Retina-sized inputs to logical pixels before model grounding", async () => {
		const imagePath = await createTestImage(2880, 1800, "openai-retina-logical.png");
		const fetchMock = createSequentialFetch([
			'{"status":"resolved","found":true,"confidence":0.9,"reason":"logical match","coordinate_space":"image_pixels","click_point":{"x":700,"y":290},"bbox":{"x1":620,"y1":246,"x2":776,"y2":332}}',
		]);
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
			prepareModelFrameImpl: async (frame, request) => ({
				frame: {
					...frame,
					bytes: createPngBuffer(request.logicalImageWidth ?? 1440, request.logicalImageHeight ?? 900),
					mimeType: "image/png",
					width: request.logicalImageWidth ?? 1440,
					height: request.logicalImageHeight ?? 900,
				},
				modelToOriginalScaleX: 2,
				modelToOriginalScaleY: 2,
				wasResized: true,
				logicalNormalizationApplied: true,
				workingWidth: request.logicalImageWidth ?? 1440,
				workingHeight: request.logicalImageHeight ?? 900,
				workingToOriginalScaleX: 2,
				workingToOriginalScaleY: 2,
				originalWidth: 2880,
				originalHeight: 1800,
				offsetX: 0,
				offsetY: 0,
			}),
		});

		const grounded = await provider.ground({
			imagePath,
			logicalImageWidth: 1440,
			logicalImageHeight: 900,
			imageScaleX: 2,
			imageScaleY: 2,
			target: "Primary Open button",
			action: "click",
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const predictionInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
		expect(extractPromptText(predictionInit?.body)).toContain("Image size: 1440x900 pixels.");
		expect(grounded).toMatchObject({
			coordinateSpace: "image_pixels",
			point: { x: 1400, y: 580 },
			raw: {
				grounding_model_image: {
					width: 1440,
					height: 900,
					wasResized: true,
				},
				grounding_working_image: {
					width: 1440,
					height: 900,
					logicalNormalizationApplied: true,
				},
				grounding_original_image: {
					width: 2880,
					height: 1800,
				},
				grounding_model_to_original_scale: {
					x: 2,
					y: 2,
				},
				grounding_working_to_original_scale: {
					x: 2,
					y: 2,
				},
				grounding_request_image: {
					logicalWidth: 1440,
					logicalHeight: 900,
					scaleX: 2,
					scaleY: 2,
				},
			},
		});
	});

	it("preserves subpixel precision when mapping model-space points back to the original screenshot", async () => {
		const imagePath = await createTestImage(1500, 900, "openai-subpixel.png");
		const fetchMock = createSequentialFetch([
			'{"status":"resolved","found":true,"confidence":0.88,"reason":"resized match","coordinate_space":"image_pixels","click_point":{"x":333,"y":211},"bbox":{"x1":300,"y1":180,"x2":366,"y2":240}}',
		]);
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
			prepareModelFrameImpl: async (frame) => ({
				frame: {
					...frame,
					bytes: createPngBuffer(1000, 600),
					mimeType: "image/png",
					width: 1000,
					height: 600,
				},
				modelToOriginalScaleX: 1.5,
				modelToOriginalScaleY: 1.5,
				wasResized: true,
				logicalNormalizationApplied: false,
				workingWidth: 1500,
				workingHeight: 900,
				workingToOriginalScaleX: 1,
				workingToOriginalScaleY: 1,
				originalWidth: 1500,
				originalHeight: 900,
				offsetX: 0,
				offsetY: 0,
			}),
		});

		const grounded = await provider.ground({
			imagePath,
			target: "Toolbar filter button",
			action: "click",
		});

		expect(grounded?.coordinateSpace).toBe("image_pixels");
		expect(grounded?.point.x).toBeCloseTo(499.5);
		expect(grounded?.point.y).toBeCloseTo(316.5);
	});

	it("does not synthesize a click point from the bbox center for interactive actions", async () => {
		const imagePath = await createTestImage(800, 600, "openai-bbox-only.png");
		const fetchMock = createSequentialFetch([
			'{"status":"resolved","found":true,"confidence":0.71,"reason":"broad match only","coordinate_space":"image_pixels","bbox":{"x1":420,"y1":220,"x2":580,"y2":280}}',
		]);
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
		});

		const grounded = await provider.ground({
			imagePath,
			target: "top-left menu bar item labeled Codex",
			action: "click",
		});

		expect(grounded).toBeUndefined();
	});

	it("stabilizes edge-biased click points back toward the bbox center for small controls", async () => {
		const imagePath = await createTestImage(800, 600, "openai-edge-biased-point.png");
		const fetchMock = createSequentialFetch([
			'{"status":"resolved","found":true,"confidence":0.83,"reason":"matched icon","coordinate_space":"image_pixels","click_point":{"x":438,"y":220},"bbox":{"x1":404,"y1":204,"x2":436,"y2":236}}',
		]);
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
		});

		const grounded = await provider.ground({
			imagePath,
			target: "sliders icon button",
			action: "click",
		});

		expect(grounded).toMatchObject({
			coordinateSpace: "image_pixels",
			point: { x: 420, y: 220 },
			raw: {
				grounding_point_stabilized: true,
				grounding_original_point: { x: 438, y: 220 },
				grounding_stabilized_point: { x: 420, y: 220 },
			},
		});
	});

	it("stabilizes edge-biased drag source points back toward the bbox center for small controls", async () => {
		const imagePath = await createTestImage(800, 600, "openai-drag-source-stabilized.png");
		const fetchMock = createSequentialFetch([
			'{"status":"resolved","found":true,"confidence":0.84,"reason":"matched drag handle","coordinate_space":"image_pixels","click_point":{"x":438,"y":220},"bbox":{"x1":404,"y1":204,"x2":436,"y2":236}}',
		]);
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
		});

		const grounded = await provider.ground({
			imagePath,
			target: "drag handle for Layer 1",
			action: "drag_source",
		});

		expect(grounded).toMatchObject({
			coordinateSpace: "image_pixels",
			point: { x: 420, y: 220 },
			raw: {
				grounding_point_stabilized: true,
				grounding_original_point: { x: 438, y: 220 },
				grounding_stabilized_point: { x: 420, y: 220 },
			},
		});
	});

	it("stabilizes typing points into the safe interior of the editable field", async () => {
		const imagePath = await createTestImage(900, 600, "openai-type-safe-interior.png");
		const fetchMock = createSequentialFetch([
			'{"status":"resolved","found":true,"confidence":0.87,"reason":"matched field","coordinate_space":"image_pixels","click_point":{"x":228,"y":320},"bbox":{"x1":220,"y1":300,"x2":620,"y2":340}}',
		]);
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
		});

		const grounded = await provider.ground({
			imagePath,
			target: "Search field",
			action: "type",
		});

		expect(grounded).toMatchObject({
			coordinateSpace: "image_pixels",
			point: { x: 260, y: 320 },
			raw: {
				grounding_point_stabilized: true,
				grounding_original_point: { x: 228, y: 320 },
				grounding_stabilized_point: { x: 260, y: 320 },
			},
		});
	});

	it("treats omitted coordinate_space as image_pixels for OpenAI grounding", async () => {
		const imagePath = await createTestImage(800, 600, "openai-implicit-pixels.png");
		const fetchMock = createSequentialFetch([
			'{"status":"resolved","found":true,"confidence":0.83,"reason":"tiny control","click_point":{"x":1,"y":1}}',
		]);
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
		});

		const grounded = await provider.ground({
			imagePath,
			target: "top-left 1px hotspot",
		});

		expect(grounded).toMatchObject({
			coordinateSpace: "image_pixels",
			point: { x: 1, y: 1 },
		});
	});

	it("rejects explicit non-image coordinate spaces in latest-only grounding", async () => {
		const imagePath = await createTestImage(800, 600, "openai-display-points.png");
		const fetchMock = createSequentialFetch([
			'{"status":"resolved","found":true,"confidence":0.83,"reason":"legacy coordinate space","coordinate_space":"display_points","click_point":{"x":1,"y":1}}',
		]);
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
		});

		const grounded = await provider.ground({
			imagePath,
			target: "top-left hotspot",
		});

		expect(grounded).toBeUndefined();
	});

	it("keeps the typing prompt focused on the editable field itself", async () => {
		const imagePath = await createTestImage(800, 600, "composer.png");
		const fetchMock = createSequentialFetch([
			'{"status":"resolved","found":true,"confidence":0.9,"reason":"matched composer","coordinate_space":"image_pixels","click_point":{"x":320,"y":520},"bbox":{"x1":220,"y1":500,"x2":620,"y2":560}}',
			'{"status":"pass","approved":true,"confidence":0.93,"reason":"inside editable field"}',
		]);
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
			simulationImageImpl: createSimulationImageImpl(),
		});

		await provider.ground({
			imagePath,
			target: "message composer input field with placeholder Write a message...",
			action: "type",
			groundingMode: "complex",
			locationHint: "bottom center of chat window",
		});

		const predictionPrompt = extractPromptText((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body);
		expect(predictionPrompt).toContain("The resolved box must overlap the visible editable field or composer surface itself.");
		expect(predictionPrompt).toContain("not the area above or below the field");
		expect(predictionPrompt).toContain("prefer a safe point inside the left side of the editable interior");
		expect(predictionPrompt).toContain("broad composer region but not the editable field itself");
	});

	it("keeps drag-source grounding focused on the actual press-and-hold surface", async () => {
		const imagePath = await createTestImage(800, 600, "drag-source-guidance.png");
		const fetchMock = createSequentialFetch([
			'{"status":"resolved","found":true,"confidence":0.86,"reason":"matched slider thumb","coordinate_space":"image_pixels","click_point":{"x":320,"y":420},"bbox":{"x1":296,"y1":404,"x2":344,"y2":436}}',
		]);
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
		});

		await provider.ground({
			imagePath,
			target: "Puzzle slider thumb",
			action: "drag_source",
		});

		const predictionPrompt = extractPromptText((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body);
		expect(predictionPrompt).toContain("Resolve the actual draggable surface itself");
		expect(predictionPrompt).toContain("pressed and held");
		expect(predictionPrompt).toContain("not on surrounding whitespace, the track");
	});

	it("keeps wait grounding focused on distinct visible indicators", async () => {
		const imagePath = await createTestImage(800, 600, "wait-guidance.png");
		const fetchMock = createSequentialFetch([
			'{"status":"resolved","found":true,"confidence":0.84,"reason":"matched delayed badge","coordinate_space":"image_pixels","bbox":{"x1":320,"y1":180,"x2":420,"y2":220}}',
		]);
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
		});

		await provider.ground({
			imagePath,
			target: "Delayed badge",
			action: "wait",
		});

		const predictionPrompt = extractPromptText((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body);
		expect(predictionPrompt).toContain("Choose the distinct visible indicator, badge, banner, row, panel, or content block");
		expect(predictionPrompt).toContain("not distinctly visible yet, return status=\"not_found\"");
	});

	it("keeps icon-only grounding guidance generic and context-driven", async () => {
		const imagePath = await createTestImage(800, 600, "toolbar-pin.png");
		const fetchMock = createSequentialFetch([
			'{"status":"resolved","found":true,"confidence":0.82,"reason":"matched icon","coordinate_space":"image_pixels","click_point":{"x":420,"y":220},"bbox":{"x1":404,"y1":204,"x2":436,"y2":236}}',
			'{"status":"pass","approved":true,"confidence":0.9,"reason":"glyph matches"}',
		]);
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
			simulationImageImpl: createSimulationImageImpl(),
		});

		await provider.ground({
			imagePath,
			target: "pin icon button",
			scope: "Inspector toolbar",
			action: "click",
			groundingMode: "complex",
		});

			const predictionPrompt = extractPromptText((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body);
			const validationPrompt = extractPromptText((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body);
			expect(predictionPrompt).toContain("Disambiguate similar controls using scope, coarse location, nearby visible text, local grouping, and relative order.");
			expect(predictionPrompt).toContain("Match subtle or weakly labeled controls by the visible label, symbol, indicator, shape, and surrounding context together.");
			expect(validationPrompt).toContain("For subtle, tightly packed, or low-contrast controls, approve only when the marked point sits on the visible hit target itself.");
	});

	it("uses scope and nearby visible text to disambiguate repeated labels", async () => {
		const imagePath = await createTestImage(800, 600, "duplicate-open.png");
		const fetchMock = createSequentialFetch([
			'{"status":"resolved","found":true,"confidence":0.9,"reason":"matched open button","coordinate_space":"image_pixels","click_point":{"x":420,"y":220},"bbox":{"x1":392,"y1":204,"x2":448,"y2":236}}',
			'{"status":"pass","approved":true,"confidence":0.92,"reason":"scope matched"}',
		]);
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
			simulationImageImpl: createSimulationImageImpl(),
		});

		await provider.ground({
			imagePath,
			target: "Open button",
			scope: "Activity Feed",
			action: "click",
			groundingMode: "complex",
		});

			const predictionPrompt = extractPromptText((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body);
			const validationPrompt = extractPromptText((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body);
			expect(predictionPrompt).toContain("Disambiguate similar controls using scope, coarse location, nearby visible text, local grouping, and relative order.");
			expect(validationPrompt).toContain("Reject if the simulated action lands on whitespace, padding, decoration, generic container background, or on a neighboring control whose visible evidence does not match the request.");
	});

	it("threads prior failures into a fresh predictor attempt", async () => {
		const imagePath = await createTestImage(1200, 900, "retry-full.png");
		const fetchMock = createSequentialFetch([
			'{"status":"resolved","found":true,"confidence":0.92,"reason":"refined target","coordinate_space":"image_pixels","click_point":{"x":644,"y":518},"bbox":{"x1":598,"y1":488,"x2":692,"y2":548}}',
			'{"status":"pass","approved":true,"confidence":0.91,"reason":"confirmed send"}',
		]);
		const simulationImageImpl = createSimulationImageImpl();
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
			simulationImageImpl,
		});

		const grounded = await provider.ground({
			imagePath,
			target: "Send button",
			action: "click",
				previousFailures: [
					{
						summary: "Previous click landed on sidebar chrome.",
						attemptedPoint: { x: 600, y: 520 },
					},
				],
		});

			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(simulationImageImpl).toHaveBeenCalledTimes(1);
			const predictionPrompt = extractPromptText((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body);
			expect(predictionPrompt).toContain("Recent failed attempts:");
			expect(predictionPrompt).toContain("Previous click landed on sidebar chrome.");
			expect(grounded).toMatchObject({
			confidence: 0.92,
			reason: "refined target",
			coordinateSpace: "image_pixels",
			point: { x: 644, y: 518 },
				box: { x: 598, y: 488, width: 94, height: 60 },
				raw: {
					selected_attempt: "validated",
					grounding_selected_round: 1,
				},
			});
	});

	it("retries transient grounding request failures up to three attempts", async () => {
		const imagePath = await createTestImage();
		let attempts = 0;
		const fetchMock = async () => {
			attempts += 1;
			if (attempts < 3) {
				return new Response(JSON.stringify({
					error: {
						message: "temporary upstream failure",
					},
				}), {
					status: 500,
					headers: { "content-type": "application/json" },
				});
			}
			return new Response(JSON.stringify({
				output_text:
					'{"status":"resolved","found":true,"confidence":0.81,"reason":"matched button","coordinate_space":"image_pixels","click_point":{"x":40,"y":24},"bbox":{"x1":20,"y1":10,"x2":60,"y2":38}}',
			}), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
		});

		const grounded = await provider.ground({
			imagePath,
			target: "Publish button",
		});

		expect(attempts).toBe(3);
		expect(grounded?.point).toEqual({ x: 40, y: 24 });
	});

	it("aborts an in-flight grounding request when the caller aborts", async () => {
		const imagePath = await createTestImage();
		let requestSignal: AbortSignal | undefined;
		let resolveFetchStarted: (() => void) | undefined;
		const fetchStarted = new Promise<void>((resolve) => {
			resolveFetchStarted = resolve;
		});
		const fetchMock = vi.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
			requestSignal = init?.signal ?? undefined;
			resolveFetchStarted?.();
			const abort = () => {
				reject(requestSignal?.reason ?? new DOMException("The operation was aborted.", "AbortError"));
			};
			if (!requestSignal) {
				reject(new Error("missing request signal"));
				return;
			}
			if (requestSignal.aborted) {
				abort();
				return;
			}
			requestSignal.addEventListener("abort", abort, { once: true });
		}));
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
		});
		const controller = new AbortController();

		const pending = provider.ground({
			imagePath,
			target: "Publish button",
			signal: controller.signal,
		});
		await fetchStarted;
		controller.abort(new DOMException("User aborted", "AbortError"));

		await expect(pending).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(requestSignal?.aborted).toBe(true);
	});

	it("suppresses guide overlays after wrong-region validation failures", async () => {
		const imagePath = await createTestImage(1600, 1000, "wrong-region-retry.png");
		const fetchMock = createSequentialFetch([
			'{"status":"resolved","found":true,"confidence":0.86,"reason":"broad toolbar region","coordinate_space":"image_pixels","click_point":{"x":1180,"y":96},"bbox":{"x1":1040,"y1":56,"x2":1320,"y2":136}}',
			'{"status":"fail","approved":false,"confidence":0.24,"reason":"background only","failure_kind":"wrong_region","retry_hint":"search the chat header instead"}',
			'{"status":"not_found","found":false,"confidence":0.18,"reason":"target not visible"}',
		]);
		const guideImageImpl = vi.fn(async (params: { width: number; height: number }) => ({
			imagePath: await createTestImage(params.width, params.height, `guide-${params.width}x${params.height}.png`),
			cleanup: async () => {},
		}));
		const simulationImageImpl = createSimulationImageImpl();
		const provider = createOpenAIGroundingProvider({
			apiKey: "test-key",
			model: "gpt-5.4",
			fetchImpl: fetchMock as unknown as typeof fetch,
			guideImageImpl,
			simulationImageImpl,
		});

		await expect(provider.ground({
			imagePath,
			target: "search icon",
			scope: "Telegram chat header",
			action: "click",
			groundingMode: "complex",
		})).resolves.toBeUndefined();

		expect(guideImageImpl).not.toHaveBeenCalled();
		const retryPredictBody = (fetchMock.mock.calls[2]?.[1] as RequestInit | undefined)?.body;
		expect(extractPromptText(retryPredictBody)).toContain("failure kind=wrong_region");
		expect(extractPromptText(retryPredictBody)).toContain("search a different visible area or panel");
		expect(requestInputContent(retryPredictBody).filter((item) => item.type === "input_image")).toHaveLength(1);
	});
});
