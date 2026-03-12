import { escapeSvgText } from "./svg-helpers.js";
import { convertSvgToPng } from "./svg-to-png.js";

type GuidePoint = {
	x: number;
	y: number;
};

type GuideBox = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export interface GroundingGuideImageParams {
	sourceBytes: Buffer;
	sourceMimeType: string;
	width: number;
	height: number;
	title?: string;
	priorPoint?: GuidePoint;
	priorBox?: GuideBox;
	rejectionReason?: string;
}

export interface GroundingGuideImageArtifact {
	imagePath: string;
	cleanup: () => Promise<void>;
}

function buildGuideSvg(params: GroundingGuideImageParams): string {
	const sourceUrl = `data:${params.sourceMimeType};base64,${params.sourceBytes.toString("base64")}`;
	const title = params.title?.trim() || "Grounding guide";
	const priorPoint = params.priorPoint;
	const priorBox = params.priorBox;
	const rejectionReason = params.rejectionReason?.trim();
	const hasLegend = Boolean(priorPoint || priorBox);
	const hasRejection = Boolean(rejectionReason);
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${params.width}" height="${params.height}" viewBox="0 0 ${params.width} ${params.height}">
	<defs>
		<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
			<feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.24"/>
		</filter>
	</defs>
	<image href="${sourceUrl}" x="0" y="0" width="${params.width}" height="${params.height}" preserveAspectRatio="none"/>
	<rect x="12" y="12" width="${Math.min(params.width - 24, 280)}" height="${hasLegend ? 54 : 30}" rx="12" fill="#0f172a" fill-opacity="0.78" filter="url(#shadow)"/>
	<text x="24" y="32" font-family="Helvetica Neue, Arial, sans-serif" font-size="15" font-weight="700" fill="#ffffff">${escapeSvgText(title)}</text>
	${hasLegend ? `<text x="24" y="50" font-family="Helvetica Neue, Arial, sans-serif" font-size="11" fill="#ffffff" fill-opacity="0.88">${hasRejection ? "Red=previous rejected candidate" : ""}</text>` : ""}
	${priorBox ? `<rect x="${priorBox.x}" y="${priorBox.y}" width="${priorBox.width}" height="${priorBox.height}" rx="10" fill="#dc2626" fill-opacity="0.08" stroke="#dc2626" stroke-width="3" stroke-dasharray="8 6"/>` : ""}
	${priorPoint ? `
		<circle cx="${priorPoint.x}" cy="${priorPoint.y}" r="10" fill="#dc2626" fill-opacity="0.18" stroke="#dc2626" stroke-width="3"/>
		<line x1="${priorPoint.x - 16}" y1="${priorPoint.y}" x2="${priorPoint.x + 16}" y2="${priorPoint.y}" stroke="#dc2626" stroke-width="2"/>
		<line x1="${priorPoint.x}" y1="${priorPoint.y - 16}" x2="${priorPoint.x}" y2="${priorPoint.y + 16}" stroke="#dc2626" stroke-width="2"/>
		<text x="${priorPoint.x + 14}" y="${priorPoint.y - 12}" font-family="Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="700" fill="#dc2626">rejected</text>
	` : ""}
	${rejectionReason && priorBox ? `<text x="${priorBox.x + 8}" y="${Math.max(18, priorBox.y - 8)}" font-family="Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="700" fill="#dc2626">${escapeSvgText(rejectionReason.slice(0, 56))}</text>` : ""}
</svg>`;
}

export async function createGroundingGuideImage(
	params: GroundingGuideImageParams,
): Promise<GroundingGuideImageArtifact | undefined> {
	if (
		!params.priorPoint &&
		!params.priorBox
	) {
		return undefined;
	}
	try {
		const result = await convertSvgToPng(buildGuideSvg(params), "understudy-grounding-guide-");
		return {
			imagePath: result.pngPath,
			cleanup: result.cleanup,
		};
	} catch {
		return undefined;
	}
}
