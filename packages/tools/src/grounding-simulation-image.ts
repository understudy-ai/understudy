import type { GuiGroundingActionIntent } from "@understudy/gui";
import { clamp, escapeSvgText } from "./svg-helpers.js";
import { convertSvgToPng } from "./svg-to-png.js";

type SimulationPoint = {
	x: number;
	y: number;
};

type SimulationBox = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export interface GroundingSimulationImageParams {
	sourceBytes: Buffer;
	sourceMimeType: string;
	width: number;
	height: number;
	action?: GuiGroundingActionIntent;
	point?: SimulationPoint;
	box?: SimulationBox;
	target?: string;
}

export interface GroundingSimulationImageArtifact {
	imagePath: string;
	cleanup: () => Promise<void>;
}

function actionBadgeLabel(action: GuiGroundingActionIntent | undefined): string {
	switch (action) {
		case "right_click":
			return "Simulated right click";
		case "double_click":
			return "Simulated double click";
		case "hover":
			return "Simulated hover";
		case "click_and_hold":
			return "Simulated hold";
		case "drag_source":
			return "Simulated drag start";
		case "drag_destination":
			return "Simulated drop";
		case "scroll":
			return "Simulated scroll";
		case "type":
			return "Simulated type";
		default:
			return "Simulated click";
	}
}

function actionColor(action: GuiGroundingActionIntent | undefined): string {
	switch (action) {
		case "type":
			return "#0f766e";
		case "scroll":
			return "#7c3aed";
		case "drag_source":
		case "drag_destination":
			return "#ea580c";
		case "hover":
			return "#2563eb";
		default:
			return "#059669";
	}
}

function actionGlyph(action: GuiGroundingActionIntent | undefined): string {
	switch (action) {
		case "right_click":
			return "RC";
		case "double_click":
			return "2x";
		case "hover":
			return "H";
		case "click_and_hold":
			return "Hold";
		case "drag_source":
			return "Drag";
		case "drag_destination":
			return "Drop";
		case "scroll":
			return "Scroll";
		case "type":
			return "Type";
		default:
			return "Click";
	}
}

function buildTypeSample(box: SimulationBox | undefined): string {
	if (!box) {
		return "";
	}
	const padding = clamp(Math.round(box.height * 0.28), 12, 24);
	const fontSize = clamp(Math.round(box.height * 0.42), 14, 26);
	const textY = Math.round(box.y + (box.height / 2) + (fontSize * 0.32));
	return `
		<text x="${Math.round(box.x + padding)}" y="${textY}" font-family="Helvetica Neue, Arial, sans-serif" font-size="${fontSize}" font-weight="600" fill="#0f766e" fill-opacity="0.90">hello</text>
	`;
}

function buildScrollArrow(
	point: SimulationPoint | undefined,
	color: string,
): string {
	if (!point) {
		return "";
	}
	const shaftTop = point.y - 48;
	const shaftBottom = point.y + 48;
	return `
		<line x1="${point.x}" y1="${shaftTop}" x2="${point.x}" y2="${shaftBottom}" stroke="${color}" stroke-width="6" stroke-linecap="round"/>
		<polygon points="${point.x - 16},${shaftTop + 18} ${point.x + 16},${shaftTop + 18} ${point.x},${shaftTop - 10}" fill="${color}"/>
		<polygon points="${point.x - 16},${shaftBottom - 18} ${point.x + 16},${shaftBottom - 18} ${point.x},${shaftBottom + 10}" fill="${color}"/>
	`;
}

function buildDragMarker(
	point: SimulationPoint | undefined,
	action: GuiGroundingActionIntent | undefined,
	color: string,
): string {
	if (!point || (action !== "drag_source" && action !== "drag_destination")) {
		return "";
	}
	return action === "drag_source"
		? `
			<circle cx="${point.x}" cy="${point.y}" r="16" fill="${color}" fill-opacity="0.20" stroke="${color}" stroke-width="4"/>
			<path d="M ${point.x - 22} ${point.y + 18} Q ${point.x} ${point.y - 22} ${point.x + 22} ${point.y + 18}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/>
		`
		: `
			<rect x="${point.x - 22}" y="${point.y - 22}" width="44" height="44" rx="12" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="4"/>
			<path d="M ${point.x} ${point.y - 14} L ${point.x} ${point.y + 14} M ${point.x - 14} ${point.y} L ${point.x + 14} ${point.y}" stroke="${color}" stroke-width="4" stroke-linecap="round"/>
		`;
}

function buildSimulationSvg(params: GroundingSimulationImageParams): string {
	const sourceUrl = `data:${params.sourceMimeType};base64,${params.sourceBytes.toString("base64")}`;
	const color = actionColor(params.action);
	const glyph = actionGlyph(params.action);
	const title = actionBadgeLabel(params.action);
	const target = params.target?.trim() ? params.target.trim().slice(0, 72) : undefined;
	const point = params.point;
	const box = params.box;
	const typeSample = params.action === "type" ? buildTypeSample(box) : "";
	const scrollArrow = params.action === "scroll" ? buildScrollArrow(point, color) : "";
	const dragMarker = buildDragMarker(point, params.action, color);
	const badgeWidth = target ? Math.min(params.width - 24, 420) : 220;
	const badgeHeight = target ? 72 : 42;
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${params.width}" height="${params.height}" viewBox="0 0 ${params.width} ${params.height}">
	<defs>
		<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
			<feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.26"/>
		</filter>
	</defs>
	<image href="${sourceUrl}" x="0" y="0" width="${params.width}" height="${params.height}" preserveAspectRatio="none"/>
	<rect x="12" y="12" width="${badgeWidth}" height="${badgeHeight}" rx="14" fill="#0f172a" fill-opacity="0.82" filter="url(#shadow)"/>
	<rect x="24" y="24" width="78" height="26" rx="13" fill="${color}"/>
	<text x="63" y="41" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-size="13" font-weight="700" fill="#ffffff">${escapeSvgText(glyph)}</text>
	<text x="116" y="42" font-family="Helvetica Neue, Arial, sans-serif" font-size="15" font-weight="700" fill="#ffffff">${escapeSvgText(title)}</text>
	${target ? `<text x="24" y="62" font-family="Helvetica Neue, Arial, sans-serif" font-size="12" fill="#ffffff" fill-opacity="0.92">${escapeSvgText(target)}</text>` : ""}
	${box ? `
		<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="12" fill="${color}" fill-opacity="0.08" stroke="${color}" stroke-width="4" stroke-dasharray="10 7"/>
		<text x="${Math.round(box.x + 10)}" y="${Math.max(18, Math.round(box.y - 10))}" font-family="Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="700" fill="${color}">candidate bbox</text>
	` : ""}
	${point ? `
		<circle cx="${point.x}" cy="${point.y}" r="12" fill="${color}" fill-opacity="0.22" stroke="${color}" stroke-width="4"/>
		<line x1="${point.x - 18}" y1="${point.y}" x2="${point.x + 18}" y2="${point.y}" stroke="${color}" stroke-width="3"/>
		<line x1="${point.x}" y1="${point.y - 18}" x2="${point.x}" y2="${point.y + 18}" stroke="${color}" stroke-width="3"/>
		<text x="${point.x + 16}" y="${point.y - 16}" font-family="Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="700" fill="${color}">click point</text>
	` : ""}
	${typeSample}
	${scrollArrow}
	${dragMarker}
</svg>`;
}

export async function createGroundingSimulationImage(
	params: GroundingSimulationImageParams,
): Promise<GroundingSimulationImageArtifact | undefined> {
	if (!params.point && !params.box) {
		return undefined;
	}
	try {
		const result = await convertSvgToPng(buildSimulationSvg(params), "understudy-grounding-sim-");
		return {
			imagePath: result.pngPath,
			cleanup: result.cleanup,
		};
	} catch {
		return undefined;
	}
}
