import { loadPhoton } from "./photon.js";

const DEFAULT_MAX_MODEL_IMAGE_BYTES = 4.5 * 1024 * 1024;
const DEFAULT_MAX_MODEL_IMAGE_WIDTH = 2000;
const DEFAULT_MAX_MODEL_IMAGE_HEIGHT = 2000;
const DEFAULT_JPEG_QUALITY = 80;

export interface GroundingModelImageInput {
	bytes: Buffer;
	mimeType: string;
	width?: number;
	height?: number;
	logicalWidth?: number;
	logicalHeight?: number;
	scaleX?: number;
	scaleY?: number;
}

export interface GroundingPreparedModelImage extends GroundingModelImageInput {
	originalWidth?: number;
	originalHeight?: number;
	workingWidth?: number;
	workingHeight?: number;
	wasResized: boolean;
	logicalNormalizationApplied: boolean;
	workingToOriginalScaleX: number;
	workingToOriginalScaleY: number;
	modelToOriginalScaleX: number;
	modelToOriginalScaleY: number;
}

function pickSmaller(
	a: { buffer: Uint8Array; mimeType: string },
	b: { buffer: Uint8Array; mimeType: string },
): { buffer: Uint8Array; mimeType: string } {
	return a.buffer.length <= b.buffer.length ? a : b;
}

function pickGroundingImageVariant(
	png: { buffer: Uint8Array; mimeType: string },
	jpeg: { buffer: Uint8Array; mimeType: string },
): { buffer: Uint8Array; mimeType: string } {
	if (png.buffer.length <= DEFAULT_MAX_MODEL_IMAGE_BYTES) {
		return png;
	}
	if (jpeg.buffer.length <= DEFAULT_MAX_MODEL_IMAGE_BYTES) {
		return jpeg;
	}
	return pickSmaller(png, jpeg);
}

function createPassthroughImage(input: GroundingModelImageInput): GroundingPreparedModelImage {
	return {
		...input,
		originalWidth: input.width,
		originalHeight: input.height,
		workingWidth: input.width,
		workingHeight: input.height,
		wasResized: false,
		logicalNormalizationApplied: false,
		workingToOriginalScaleX: 1,
		workingToOriginalScaleY: 1,
		modelToOriginalScaleX: 1,
		modelToOriginalScaleY: 1,
	};
}

function normalizePreferredDimension(
	value: number | undefined,
	originalDimension: number,
	scaleHint: number | undefined,
): number | undefined {
	if (Number.isFinite(value) && value && value > 0) {
		return Math.max(1, Math.min(originalDimension, Math.round(value)));
	}
	if (Number.isFinite(scaleHint) && scaleHint && scaleHint > 1) {
		return Math.max(1, Math.min(originalDimension, Math.round(originalDimension / scaleHint)));
	}
	return undefined;
}

function resolveWorkingDimensions(input: {
	originalWidth: number;
	originalHeight: number;
	logicalWidth?: number;
	logicalHeight?: number;
	scaleX?: number;
	scaleY?: number;
}): {
	workingWidth: number;
	workingHeight: number;
	logicalNormalizationApplied: boolean;
} {
	const originalAspect = input.originalWidth / input.originalHeight;
	let preferredWidth = normalizePreferredDimension(input.logicalWidth, input.originalWidth, input.scaleX);
	let preferredHeight = normalizePreferredDimension(input.logicalHeight, input.originalHeight, input.scaleY);

	if (preferredWidth && !preferredHeight) {
		preferredHeight = Math.max(1, Math.min(
			input.originalHeight,
			Math.round(preferredWidth / originalAspect),
		));
	}
	if (preferredHeight && !preferredWidth) {
		preferredWidth = Math.max(1, Math.min(
			input.originalWidth,
			Math.round(preferredHeight * originalAspect),
		));
	}
	if (preferredWidth && preferredHeight) {
		const preferredAspect = preferredWidth / preferredHeight;
		if (Math.abs(preferredAspect - originalAspect) > 0.02) {
			if (Math.abs((preferredWidth / originalAspect) - preferredHeight) <= Math.abs((preferredHeight * originalAspect) - preferredWidth)) {
				preferredHeight = Math.max(1, Math.min(
					input.originalHeight,
					Math.round(preferredWidth / originalAspect),
				));
			} else {
				preferredWidth = Math.max(1, Math.min(
					input.originalWidth,
					Math.round(preferredHeight * originalAspect),
				));
			}
		}
	}

	const workingWidth = preferredWidth ?? input.originalWidth;
	const workingHeight = preferredHeight ?? input.originalHeight;
	const logicalNormalizationApplied = workingWidth !== input.originalWidth || workingHeight !== input.originalHeight;

	return {
		workingWidth,
		workingHeight,
		logicalNormalizationApplied,
	};
}

export async function prepareGroundingModelImage(
	input: GroundingModelImageInput,
): Promise<GroundingPreparedModelImage> {
	const sourceWidth = input.width;
	const sourceHeight = input.height;
	if (!sourceWidth || !sourceHeight) {
		return createPassthroughImage(input);
	}

	const photon = await loadPhoton();
	if (!photon) {
		return createPassthroughImage(input);
	}

	let image: ReturnType<typeof photon.PhotonImage.new_from_byteslice> | undefined;
	try {
		image = photon.PhotonImage.new_from_byteslice(new Uint8Array(input.bytes));
		const originalWidth = image.get_width();
		const originalHeight = image.get_height();
		const originalSize = input.bytes.length;
		const working = resolveWorkingDimensions({
			originalWidth,
			originalHeight,
			logicalWidth: input.logicalWidth,
			logicalHeight: input.logicalHeight,
			scaleX: input.scaleX,
			scaleY: input.scaleY,
		});
		const workingToOriginalScaleX = working.workingWidth > 0 ? originalWidth / working.workingWidth : 1;
		const workingToOriginalScaleY = working.workingHeight > 0 ? originalHeight / working.workingHeight : 1;
		if (
			!working.logicalNormalizationApplied &&
			originalWidth <= DEFAULT_MAX_MODEL_IMAGE_WIDTH &&
			originalHeight <= DEFAULT_MAX_MODEL_IMAGE_HEIGHT &&
			originalSize <= DEFAULT_MAX_MODEL_IMAGE_BYTES
		) {
			return {
				...input,
				originalWidth,
				originalHeight,
				workingWidth: originalWidth,
				workingHeight: originalHeight,
				width: originalWidth,
				height: originalHeight,
				wasResized: false,
				logicalNormalizationApplied: false,
				workingToOriginalScaleX: 1,
				workingToOriginalScaleY: 1,
				modelToOriginalScaleX: 1,
				modelToOriginalScaleY: 1,
			};
		}

		let targetWidth = working.workingWidth;
		let targetHeight = working.workingHeight;
		if (targetWidth > DEFAULT_MAX_MODEL_IMAGE_WIDTH) {
			targetHeight = Math.round((targetHeight * DEFAULT_MAX_MODEL_IMAGE_WIDTH) / targetWidth);
			targetWidth = DEFAULT_MAX_MODEL_IMAGE_WIDTH;
		}
		if (targetHeight > DEFAULT_MAX_MODEL_IMAGE_HEIGHT) {
			targetWidth = Math.round((targetWidth * DEFAULT_MAX_MODEL_IMAGE_HEIGHT) / targetHeight);
			targetHeight = DEFAULT_MAX_MODEL_IMAGE_HEIGHT;
		}

		const tryBothFormats = (
			width: number,
			height: number,
			jpegQuality: number,
		): { buffer: Uint8Array; mimeType: string } => {
			const resized = photon.resize(image!, width, height, photon.SamplingFilter.Lanczos3);
			try {
				const pngBuffer = resized.get_bytes();
				const jpegBuffer = resized.get_bytes_jpeg(jpegQuality);
				return pickGroundingImageVariant(
					{ buffer: pngBuffer, mimeType: "image/png" },
					{ buffer: jpegBuffer, mimeType: "image/jpeg" },
				);
			} finally {
				resized.free();
			}
		};

		const qualitySteps = [85, 70, 55, 40];
		const scaleSteps = [1.0, 0.75, 0.5, 0.35, 0.25];

		let best = tryBothFormats(targetWidth, targetHeight, DEFAULT_JPEG_QUALITY);
		let finalWidth = targetWidth;
		let finalHeight = targetHeight;
		if (best.buffer.length > DEFAULT_MAX_MODEL_IMAGE_BYTES) {
			let foundWithinLimit = false;
			for (const quality of qualitySteps) {
				best = tryBothFormats(targetWidth, targetHeight, quality);
				if (best.buffer.length <= DEFAULT_MAX_MODEL_IMAGE_BYTES) {
					foundWithinLimit = true;
					break;
				}
			}
			if (!foundWithinLimit) {
				for (const scale of scaleSteps) {
					finalWidth = Math.round(targetWidth * scale);
					finalHeight = Math.round(targetHeight * scale);
					if (finalWidth < 100 || finalHeight < 100) {
						break;
					}
					for (const quality of qualitySteps) {
						best = tryBothFormats(finalWidth, finalHeight, quality);
						if (best.buffer.length <= DEFAULT_MAX_MODEL_IMAGE_BYTES) {
							foundWithinLimit = true;
							break;
						}
					}
					if (foundWithinLimit) {
						break;
					}
				}
			}
		}

		return {
			bytes: Buffer.from(best.buffer),
			mimeType: best.mimeType,
			originalWidth,
			originalHeight,
			workingWidth: working.workingWidth,
			workingHeight: working.workingHeight,
			width: finalWidth,
			height: finalHeight,
			wasResized:
				finalWidth !== originalWidth ||
				finalHeight !== originalHeight ||
				best.mimeType !== input.mimeType ||
				working.logicalNormalizationApplied,
			logicalNormalizationApplied: working.logicalNormalizationApplied,
			workingToOriginalScaleX,
			workingToOriginalScaleY,
			modelToOriginalScaleX: finalWidth > 0 ? originalWidth / finalWidth : 1,
			modelToOriginalScaleY: finalHeight > 0 ? originalHeight / finalHeight : 1,
		};
	} catch {
		return createPassthroughImage(input);
	} finally {
		image?.free();
	}
}
