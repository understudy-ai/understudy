/// <reference lib="dom" />

export type GuiGroundingBenchmarkCase = {
	id: string;
	elementId?: string;
	target: string;
	scope?: string;
	action: "click" | "type";
	locationHint?: string;
	difficulty: "basic" | "complex";
	promptClarity: "explicit" | "ambiguous";
	kind:
		| "text_item"
		| "text_button"
		| "duplicate_label_button"
		| "text_field"
		| "borderless_tab"
		| "icon_only"
		| "checkbox"
		| "tiny_button";
};

export type GuiGroundingBenchmarkTruth = GuiGroundingBenchmarkCase & {
	box: {
		x: number;
		y: number;
		width: number;
		height: number;
	};
	point: {
		x: number;
		y: number;
	};
};

export type GuiGroundingBenchmarkArtifacts = {
	truths: GuiGroundingBenchmarkTruth[];
};

export const GUI_GROUNDING_BENCHMARK_CASES: GuiGroundingBenchmarkCase[] = [
	{
		id: "sidebar-downloads",
		target: "Downloads item",
		scope: "left sidebar",
		action: "click",
		locationHint: "upper-left sidebar column",
		difficulty: "basic",
		promptClarity: "explicit",
		kind: "text_item",
	},
	{
		id: "hero-open",
		target: "Open button",
		scope: "Project Summary",
		action: "click",
		locationHint: "upper middle left card action row",
		difficulty: "complex",
		promptClarity: "explicit",
		kind: "duplicate_label_button",
	},
	{
		id: "hero-open-fuzzy",
		elementId: "hero-open",
		target: "main open action on the left summary card",
		action: "click",
		locationHint: "upper center-left card",
		difficulty: "complex",
		promptClarity: "ambiguous",
		kind: "duplicate_label_button",
	},
	{
		id: "activity-open",
		target: "Open button",
		scope: "Activity Feed",
		action: "click",
		locationHint: "upper middle right card action row",
		difficulty: "complex",
		promptClarity: "explicit",
		kind: "duplicate_label_button",
	},
	{
		id: "activity-open-fuzzy",
		elementId: "activity-open",
		target: "open action in the right status card",
		action: "click",
		locationHint: "upper center-right card",
		difficulty: "complex",
		promptClarity: "ambiguous",
		kind: "duplicate_label_button",
	},
	{
		id: "inspector-search",
		target: "Search field",
		scope: "Inspector panel",
		action: "type",
		locationHint: "top of the right-side inspector panel",
		difficulty: "basic",
		promptClarity: "explicit",
		kind: "text_field",
	},
	{
		id: "export-save",
		target: "Save button",
		scope: "Export dialog",
		action: "click",
		locationHint: "bottom-right footer of the export dialog",
		difficulty: "basic",
		promptClarity: "explicit",
		kind: "text_button",
	},
	{
		id: "march-open",
		target: "Open button in the March row",
		scope: "Audit Log",
		action: "click",
		locationHint: "middle column, lower row of the audit table",
		difficulty: "complex",
		promptClarity: "explicit",
		kind: "duplicate_label_button",
	},
	{
		id: "timeline-tab",
		target: "borderless Timeline tab between Overview and Compare",
		scope: "View tabs",
		action: "click",
		locationHint: "right-side inspector panel below the Search field",
		difficulty: "complex",
		promptClarity: "explicit",
		kind: "borderless_tab",
	},
	{
		id: "timeline-tab-fuzzy",
		elementId: "timeline-tab",
		target: "middle tab below the search box",
		scope: "right-side panel",
		action: "click",
		locationHint: "view strip in the inspector area",
		difficulty: "complex",
		promptClarity: "ambiguous",
		kind: "borderless_tab",
	},
	{
		id: "favorite-star",
		target: "star icon button below View tabs",
		scope: "Inspector panel",
		action: "click",
		locationHint: "right-side inspector panel, leftmost icon in the toolbar row below View tabs",
		difficulty: "complex",
		promptClarity: "explicit",
		kind: "icon_only",
	},
	{
		id: "favorite-star-fuzzy",
		elementId: "favorite-star",
		target: "favorite toggle in the small toolbar",
		scope: "right panel tools",
		action: "click",
		locationHint: "icon row below the tabs",
		difficulty: "complex",
		promptClarity: "ambiguous",
		kind: "icon_only",
	},
	{
		id: "toolbar-bell",
		target: "notification bell icon button",
		scope: "Inspector toolbar",
		action: "click",
		locationHint: "icon toolbar row below View tabs",
		difficulty: "complex",
		promptClarity: "explicit",
		kind: "icon_only",
	},
	{
		id: "toolbar-bell-fuzzy",
		elementId: "toolbar-bell",
		target: "the alert thing in the tool row",
		scope: "right panel tools",
		action: "click",
		locationHint: "left side of the small icon row",
		difficulty: "complex",
		promptClarity: "ambiguous",
		kind: "icon_only",
	},
	{
		id: "toolbar-filter",
		target: "filter icon button with three horizontal lines",
		scope: "Inspector toolbar",
		action: "click",
		locationHint: "icon toolbar row below View tabs",
		difficulty: "complex",
		promptClarity: "explicit",
		kind: "icon_only",
	},
	{
		id: "toolbar-filter-fuzzy",
		elementId: "toolbar-filter",
		target: "button for narrowing this down",
		scope: "right panel tools",
		action: "click",
		locationHint: "small icon row below the tabs",
		difficulty: "complex",
		promptClarity: "ambiguous",
		kind: "icon_only",
	},
	{
		id: "toolbar-paperclip",
		target: "paperclip icon button",
		scope: "Inspector toolbar",
		action: "click",
		locationHint: "toolbar row under the tabs, right side",
		difficulty: "complex",
		promptClarity: "explicit",
		kind: "icon_only",
	},
	{
		id: "toolbar-paperclip-fuzzy",
		elementId: "toolbar-paperclip",
		target: "the little clip in the toolbar",
		scope: "right panel tools",
		action: "click",
		locationHint: "small icon row below the tabs",
		difficulty: "complex",
		promptClarity: "ambiguous",
		kind: "icon_only",
	},
	{
		id: "toolbar-sparkles",
		target: "sparkles icon button",
		scope: "Inspector toolbar",
		action: "click",
		locationHint: "toolbar row under the tabs, right side",
		difficulty: "complex",
		promptClarity: "explicit",
		kind: "icon_only",
	},
	{
		id: "toolbar-sparkles-fuzzy",
		elementId: "toolbar-sparkles",
		target: "the magic-looking icon in the toolbar",
		scope: "right panel tools",
		action: "click",
		locationHint: "toolbar row under the tabs, right side",
		difficulty: "complex",
		promptClarity: "ambiguous",
		kind: "icon_only",
	},
	{
		id: "toolbar-pin",
		target: "pin icon button",
		scope: "Inspector toolbar",
		action: "click",
		locationHint: "toolbar row under the tabs, between the sparkles icon and the sliders icon",
		difficulty: "complex",
		promptClarity: "explicit",
		kind: "icon_only",
	},
	{
		id: "toolbar-pin-fuzzy",
		elementId: "toolbar-pin",
		target: "keep this pinned button in the tool row",
		scope: "right panel tools",
		action: "click",
		locationHint: "small icon row below the tabs",
		difficulty: "complex",
		promptClarity: "ambiguous",
		kind: "icon_only",
	},
	{
		id: "toolbar-sliders",
		target: "sliders icon button",
		scope: "Inspector toolbar",
		action: "click",
		locationHint: "toolbar row under the tabs, right side",
		difficulty: "complex",
		promptClarity: "explicit",
		kind: "icon_only",
	},
	{
		id: "toolbar-sliders-fuzzy",
		elementId: "toolbar-sliders",
		target: "adjustments control in the icon row",
		scope: "right panel tools",
		action: "click",
		locationHint: "far right of the small toolbar",
		difficulty: "complex",
		promptClarity: "ambiguous",
		kind: "icon_only",
	},
	{
		id: "preview-play",
		target: "play icon button centered in Preview card",
		scope: "Preview card",
		action: "click",
		locationHint: "center of the preview card in the right-side panel",
		difficulty: "basic",
		promptClarity: "explicit",
		kind: "icon_only",
	},
	{
		id: "preview-play-fuzzy",
		elementId: "preview-play",
		target: "play this preview",
		scope: "Preview card",
		action: "click",
		locationHint: "middle of the preview area",
		difficulty: "complex",
		promptClarity: "ambiguous",
		kind: "icon_only",
	},
	{
		id: "auto-approve-checkbox",
		target: "small checkbox square immediately left of Auto approve",
		scope: "Automation options",
		action: "click",
		locationHint: "lower-right panel, left edge of the Auto approve row",
		difficulty: "complex",
		promptClarity: "explicit",
		kind: "checkbox",
	},
	{
		id: "auto-approve-toggle-fuzzy",
		elementId: "auto-approve-checkbox",
		target: "toggle that turns on auto approve",
		scope: "Automation options",
		action: "click",
		locationHint: "left side of the auto approve row",
		difficulty: "complex",
		promptClarity: "ambiguous",
		kind: "checkbox",
	},
	{
		id: "quick-add",
		target: "small plus button next to Quick add rule",
		scope: "Automation options",
		action: "click",
		locationHint: "lower-right panel, quick controls row near the bottom",
		difficulty: "complex",
		promptClarity: "explicit",
		kind: "tiny_button",
	},
	{
		id: "quick-add-fuzzy",
		elementId: "quick-add",
		target: "small add control in the quick rule row",
		scope: "Automation options",
		action: "click",
		locationHint: "bottom quick controls row",
		difficulty: "complex",
		promptClarity: "ambiguous",
		kind: "tiny_button",
	},
];

export const GUI_GROUNDING_BENCHMARK_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<title>Understudy GUI benchmark</title>
	<style>
		:root {
			color-scheme: light;
			font-family: "SF Pro Text", "Helvetica Neue", sans-serif;
		}
		* {
			box-sizing: border-box;
		}
		body {
			margin: 0;
			background:
				radial-gradient(circle at top left, rgba(255, 222, 173, 0.4), transparent 28%),
				linear-gradient(180deg, #f7f3ea 0%, #ecf0f5 100%);
			color: #1c2836;
		}
		.shell {
			min-height: 100vh;
			display: grid;
			grid-template-columns: 240px minmax(0, 1fr) 340px;
			gap: 22px;
			padding: 28px;
		}
		.sidebar,
		.panel,
		.dialog {
			border-radius: 24px;
			border: 1px solid rgba(28, 40, 54, 0.10);
			background: rgba(255, 255, 255, 0.92);
			box-shadow: 0 18px 48px rgba(28, 40, 54, 0.10);
		}
		.sidebar {
			padding: 18px 16px;
			display: flex;
			flex-direction: column;
			gap: 12px;
		}
		.sidebar h1 {
			margin: 0 0 8px;
			font-size: 16px;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			color: #5d6c7d;
		}
		.sidebar-item {
			display: flex;
			align-items: center;
			padding: 12px 14px;
			border-radius: 16px;
			font-size: 15px;
			background: transparent;
		}
		.sidebar-item.active {
			background: #d8e6ff;
			color: #133b72;
			font-weight: 600;
		}
		.main {
			display: grid;
			grid-template-rows: auto auto;
			gap: 20px;
		}
		.hero-grid {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			gap: 18px;
		}
		.panel {
			padding: 22px;
		}
		.panel h2,
		.dialog h2 {
			margin: 0 0 8px;
			font-size: 20px;
		}
		.panel p,
		.dialog p,
		.table-note {
			margin: 0;
			color: #607083;
			font-size: 14px;
			line-height: 1.5;
		}
		.actions {
			display: flex;
			gap: 12px;
			margin-top: 18px;
		}
		button,
		input {
			font: inherit;
		}
		button {
			border: 1px solid rgba(28, 40, 54, 0.16);
			border-radius: 14px;
			padding: 11px 16px;
			background: #fff;
			color: #1c2836;
			cursor: pointer;
		}
		.button-primary {
			background: linear-gradient(135deg, #d4632a 0%, #bf4a11 100%);
			color: #fff;
			border-color: rgba(191, 74, 17, 0.8);
			font-weight: 600;
		}
		.button-secondary {
			background: #f5f8fc;
		}
		.badge-row {
			display: flex;
			gap: 10px;
			flex-wrap: wrap;
			margin-top: 16px;
			min-height: 32px;
		}
		.badge {
			display: inline-flex;
			align-items: center;
			padding: 7px 10px;
			border-radius: 999px;
			background: #e7f6e8;
			color: #215a2d;
			font-size: 13px;
			font-weight: 600;
		}
		.badge[hidden] {
			display: none;
		}
		.table {
			margin-top: 18px;
			border-radius: 18px;
			border: 1px solid rgba(28, 40, 54, 0.10);
			overflow: hidden;
		}
		.row {
			display: grid;
			grid-template-columns: 120px 1fr auto;
			align-items: center;
			padding: 12px 16px;
			background: #fff;
			border-top: 1px solid rgba(28, 40, 54, 0.08);
		}
		.row:first-child {
			border-top: none;
		}
		.row-label {
			font-weight: 600;
		}
		.dialog {
			padding: 22px;
			display: grid;
			gap: 18px;
			align-content: start;
		}
		.dialog .field {
			display: grid;
			gap: 8px;
		}
		.dialog label {
			font-size: 13px;
			font-weight: 600;
			color: #4d6175;
		}
		.dialog input {
			width: 100%;
			padding: 12px 14px;
			border: 1px solid rgba(28, 40, 54, 0.16);
			border-radius: 14px;
			background: #f9fbff;
		}
		.dialog-footer {
			display: flex;
			justify-content: flex-end;
			gap: 10px;
		}
		.subpanel {
			display: grid;
			gap: 14px;
			padding: 16px;
			border-radius: 18px;
			border: 1px solid rgba(28, 40, 54, 0.10);
			background: linear-gradient(180deg, rgba(248, 251, 255, 0.98), rgba(241, 246, 252, 0.95));
		}
		.subpanel-title {
			margin: 0;
			font-size: 13px;
			font-weight: 700;
			letter-spacing: 0.08em;
			text-transform: uppercase;
			color: #5d6c7d;
		}
		.tab-strip {
			display: flex;
			gap: 18px;
			align-items: center;
			border-bottom: 1px solid rgba(28, 40, 54, 0.10);
			padding-bottom: 10px;
		}
		.tab-button {
			border: none;
			border-radius: 0;
			padding: 0 0 10px;
			background: transparent;
			color: #5f7081;
			font-size: 14px;
			font-weight: 600;
			box-shadow: none;
		}
		.tab-button.active {
			color: #193b69;
			box-shadow: inset 0 -2px 0 #193b69;
		}
		.icon-toolbar {
			display: flex;
			gap: 14px;
			align-items: center;
		}
		.icon-button {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 30px;
			height: 30px;
			padding: 0;
			border: none;
			border-radius: 10px;
			background: transparent;
			box-shadow: none;
		}
		.icon-button svg {
			width: 18px;
			height: 18px;
			stroke: #36506f;
			fill: none;
			stroke-width: 1.8;
			stroke-linecap: round;
			stroke-linejoin: round;
		}
		.icon-button[data-active="true"] svg {
			fill: #cf7f20;
			stroke: #cf7f20;
		}
		.preview-card {
			position: relative;
			height: 132px;
			border-radius: 18px;
			overflow: hidden;
			background:
				linear-gradient(135deg, rgba(20, 48, 82, 0.90), rgba(67, 110, 160, 0.78)),
				radial-gradient(circle at 25% 25%, rgba(255, 255, 255, 0.18), transparent 36%);
		}
		.preview-grid {
			position: absolute;
			inset: 0;
			background:
				linear-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px),
				linear-gradient(90deg, rgba(255, 255, 255, 0.08) 1px, transparent 1px);
			background-size: 28px 28px;
			opacity: 0.55;
		}
		.preview-caption {
			position: absolute;
			left: 18px;
			bottom: 16px;
			color: rgba(255, 255, 255, 0.88);
			font-size: 13px;
			font-weight: 600;
		}
		.preview-play {
			position: absolute;
			top: 50%;
			left: 50%;
			transform: translate(-50%, -50%);
			width: 42px;
			height: 42px;
			padding: 0;
			border: none;
			border-radius: 999px;
			background: rgba(255, 255, 255, 0.18);
			backdrop-filter: blur(10px);
			box-shadow: none;
		}
		.preview-play svg {
			width: 18px;
			height: 18px;
			fill: #ffffff;
			margin-left: 2px;
		}
		.option-row {
			display: grid;
			grid-template-columns: auto 1fr;
			gap: 12px;
			align-items: center;
		}
		.checkbox-button {
			width: 18px;
			height: 18px;
			padding: 0;
			border-radius: 6px;
			border: 1.5px solid rgba(28, 40, 54, 0.34);
			background: #fff;
			box-shadow: none;
		}
		.checkbox-button[data-checked="true"] {
			background: linear-gradient(135deg, #d4632a 0%, #bf4a11 100%);
			border-color: rgba(191, 74, 17, 0.92);
		}
		.checkbox-button[data-checked="true"]::after {
			content: "";
			display: block;
			width: 5px;
			height: 9px;
			margin: 2px auto 0;
			border: solid #fff;
			border-width: 0 2px 2px 0;
			transform: rotate(45deg);
		}
		.option-title {
			font-size: 14px;
			font-weight: 600;
			color: #203245;
		}
		.option-copy {
			font-size: 12px;
			color: #68798b;
		}
		.quick-controls {
			display: flex;
			align-items: center;
			gap: 10px;
		}
		.tiny-button {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 22px;
			height: 22px;
			padding: 0;
			border-radius: 8px;
			background: #ffffff;
			font-size: 15px;
			font-weight: 700;
			line-height: 1;
			box-shadow: none;
		}
		.quick-label {
			font-size: 13px;
			color: #5d6c7d;
			font-weight: 600;
		}
	</style>
</head>
<body>
	<div class="shell">
		<aside class="sidebar" aria-label="left sidebar">
			<h1>Workspace</h1>
			<div class="sidebar-item">Desktop</div>
			<div class="sidebar-item active" data-benchmark-id="sidebar-downloads">Downloads</div>
			<div class="sidebar-item">Documents</div>
			<div class="sidebar-item">Archive</div>
		</aside>
		<main class="main">
			<section class="hero-grid">
				<div class="panel">
					<h2>Project Summary</h2>
					<p>Primary summary card with the main launch action.</p>
					<div class="actions">
						<button class="button-primary" data-benchmark-id="hero-open" id="hero-open">Open</button>
						<button class="button-secondary">Share</button>
					</div>
					<div class="badge-row">
						<div class="badge" id="hero-opened" hidden>hero:opened</div>
					</div>
				</div>
				<div class="panel">
					<h2>Activity Feed</h2>
					<p>Secondary card with a similarly named action.</p>
					<div class="actions">
						<button data-benchmark-id="activity-open" id="activity-open">Open</button>
						<button class="button-secondary">Inspect</button>
					</div>
					<div class="badge-row">
						<div class="badge" id="activity-opened" hidden>activity:opened</div>
					</div>
				</div>
			</section>
			<section class="panel">
				<h2>Audit Log</h2>
				<p class="table-note">Each row repeats the same action label.</p>
				<div class="table" role="table" aria-label="Audit Log table">
					<div class="row" role="row">
						<div class="row-label">January</div>
						<div>Initial sync completed</div>
						<button>Open</button>
					</div>
					<div class="row" role="row">
						<div class="row-label">February</div>
						<div>Review exported draft</div>
						<button>Open</button>
					</div>
					<div class="row" role="row">
						<div class="row-label">March</div>
						<div>Release candidate approved</div>
						<button data-benchmark-id="march-open" id="march-open">Open</button>
					</div>
				</div>
				<div class="badge-row">
					<div class="badge" id="march-opened" hidden>march:opened</div>
				</div>
			</section>
		</main>
		<aside class="dialog" aria-label="Inspector panel">
			<div>
				<h2>Inspector panel</h2>
				<p>Right-side configuration drawer for the benchmark.</p>
			</div>
			<div class="field">
				<label for="search-field">Search field</label>
				<input data-benchmark-id="inspector-search" id="search-field" placeholder="Search notes">
			</div>
			<section class="subpanel">
				<p class="subpanel-title">View tabs</p>
				<div class="tab-strip" aria-label="View tabs">
					<button class="tab-button active">Overview</button>
					<button class="tab-button" data-benchmark-id="timeline-tab" id="timeline-tab">Timeline</button>
					<button class="tab-button">Compare</button>
				</div>
				<div class="icon-toolbar" aria-label="Inspector toolbar">
					<button class="icon-button" data-benchmark-id="favorite-star" id="favorite-star" aria-label="Favorite star button">
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 17l-5.2 2.6 1-5.8-4.2-4.1 5.8-.8z"></path>
						</svg>
					</button>
					<button class="icon-button" data-benchmark-id="toolbar-bell" id="toolbar-bell" aria-label="Bell icon button">
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M9 18h6"></path>
							<path d="M10 21h4"></path>
							<path d="M6 17h12c-1.2-1.3-2-3.7-2-6a4 4 0 10-8 0c0 2.3-.8 4.7-2 6z"></path>
						</svg>
					</button>
					<button class="icon-button" data-benchmark-id="toolbar-filter" id="toolbar-filter" aria-label="Filter icon button">
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M4 6h16"></path>
							<path d="M7 12h10"></path>
							<path d="M10 18h4"></path>
						</svg>
					</button>
					<button class="icon-button" data-benchmark-id="toolbar-paperclip" id="toolbar-paperclip" aria-label="Paperclip icon button">
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M9 12.5l5.7-5.7a3 3 0 114.2 4.2L10.8 19a5 5 0 11-7.1-7.1l8.3-8.3"></path>
						</svg>
					</button>
					<button class="icon-button" data-benchmark-id="toolbar-sparkles" id="toolbar-sparkles" aria-label="Sparkles icon button">
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M12 4l1.2 4.2L17 9.5l-3.8 1.2L12 15l-1.2-4.3L7 9.5l3.8-1.3z"></path>
							<path d="M18.5 3.5l.5 1.7 1.7.5-1.7.5-.5 1.8-.5-1.8-1.8-.5 1.8-.5z"></path>
						</svg>
					</button>
					<button class="icon-button" data-benchmark-id="toolbar-pin" id="toolbar-pin" aria-label="Pin icon button">
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M9 4h6"></path>
							<path d="M10 4l1 6-3 3h8l-3-3 1-6"></path>
							<path d="M12 13v7"></path>
						</svg>
					</button>
					<button class="icon-button" data-benchmark-id="toolbar-sliders" id="toolbar-sliders" aria-label="Sliders icon button">
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M4 6h8"></path>
							<path d="M16 6h4"></path>
							<path d="M4 12h4"></path>
							<path d="M12 12h8"></path>
							<path d="M4 18h10"></path>
							<path d="M18 18h2"></path>
							<circle cx="14" cy="6" r="2"></circle>
							<circle cx="10" cy="12" r="2"></circle>
							<circle cx="16" cy="18" r="2"></circle>
						</svg>
					</button>
				</div>
				<div class="badge-row">
					<div class="badge" id="timeline-active" hidden>timeline:active</div>
					<div class="badge" id="favorite-starred" hidden>favorite:starred</div>
					<div class="badge" id="toolbar-bell-opened" hidden>bell:opened</div>
					<div class="badge" id="toolbar-filter-opened" hidden>filter:opened</div>
					<div class="badge" id="toolbar-paperclip-opened" hidden>paperclip:opened</div>
					<div class="badge" id="toolbar-sparkles-opened" hidden>sparkles:opened</div>
					<div class="badge" id="toolbar-pin-opened" hidden>pin:opened</div>
					<div class="badge" id="toolbar-sliders-opened" hidden>sliders:opened</div>
				</div>
			</section>
			<section class="subpanel">
				<p class="subpanel-title">Preview card</p>
				<div class="preview-card">
					<div class="preview-grid"></div>
					<button class="preview-play" data-benchmark-id="preview-play" id="preview-play" aria-label="Play preview">
						<svg viewBox="0 0 20 20" aria-hidden="true">
							<path d="M5 3.8l10.8 6.2L5 16.2z"></path>
						</svg>
					</button>
					<div class="preview-caption">Session preview</div>
				</div>
				<div class="badge-row">
					<div class="badge" id="preview-played" hidden>preview:played</div>
				</div>
			</section>
			<section class="subpanel" aria-label="Automation options">
				<p class="subpanel-title">Automation options</p>
				<div class="option-row">
					<button class="checkbox-button" data-benchmark-id="auto-approve-checkbox" id="auto-approve-checkbox" aria-label="Auto approve checkbox"></button>
					<div>
						<div class="option-title">Auto approve</div>
						<div class="option-copy">Apply changes without extra confirmation.</div>
					</div>
				</div>
				<div class="quick-controls" aria-label="Quick controls row">
					<button class="tiny-button" data-benchmark-id="quick-add" id="quick-add" aria-label="Add quick rule">+</button>
					<div class="quick-label">Quick add rule</div>
				</div>
				<div class="badge-row">
					<div class="badge" id="auto-approve-on" hidden>auto-approve:on</div>
					<div class="badge" id="quick-added" hidden>rule:added</div>
				</div>
			</section>
			<div>
				<h2>Export dialog</h2>
				<p>Footer actions sit below the export options.</p>
			</div>
			<div class="field">
				<label for="export-name">Export name</label>
				<input id="export-name" value="Release notes">
			</div>
			<div class="dialog-footer" aria-label="Export dialog footer">
				<button>Cancel</button>
				<button class="button-primary" data-benchmark-id="export-save" id="export-save">Save</button>
			</div>
			<div class="badge-row">
				<div class="badge" id="export-saved" hidden>dialog:saved</div>
			</div>
		</aside>
	</div>
	<script>
		const reveal = (id) => {
			document.getElementById(id).hidden = false;
		};
		document.getElementById("hero-open").addEventListener("click", () => reveal("hero-opened"));
		document.getElementById("activity-open").addEventListener("click", () => reveal("activity-opened"));
		document.getElementById("march-open").addEventListener("click", () => reveal("march-opened"));
		document.getElementById("export-save").addEventListener("click", () => reveal("export-saved"));
		document.getElementById("timeline-tab").addEventListener("click", (event) => {
			document.querySelectorAll(".tab-button").forEach((node) => node.classList.remove("active"));
			event.currentTarget.classList.add("active");
			reveal("timeline-active");
		});
		document.getElementById("favorite-star").addEventListener("click", (event) => {
			event.currentTarget.dataset.active = "true";
			reveal("favorite-starred");
		});
		document.getElementById("toolbar-bell").addEventListener("click", () => reveal("toolbar-bell-opened"));
		document.getElementById("toolbar-filter").addEventListener("click", () => reveal("toolbar-filter-opened"));
		document.getElementById("toolbar-paperclip").addEventListener("click", () => reveal("toolbar-paperclip-opened"));
		document.getElementById("toolbar-sparkles").addEventListener("click", () => reveal("toolbar-sparkles-opened"));
		document.getElementById("toolbar-pin").addEventListener("click", () => reveal("toolbar-pin-opened"));
		document.getElementById("toolbar-sliders").addEventListener("click", () => reveal("toolbar-sliders-opened"));
		document.getElementById("preview-play").addEventListener("click", () => reveal("preview-played"));
		document.getElementById("auto-approve-checkbox").addEventListener("click", (event) => {
			event.currentTarget.dataset.checked = "true";
			reveal("auto-approve-on");
		});
		document.getElementById("quick-add").addEventListener("click", () => reveal("quick-added"));
	</script>
</body>
</html>`;

export async function prepareGuiGroundingBenchmarkPage(page: {
	setContent(html: string, options?: { waitUntil?: "load" | "domcontentloaded" }): Promise<void>;
	waitForTimeout(ms: number): Promise<void>;
	evaluate<T>(pageFunction: (cases: GuiGroundingBenchmarkCase[]) => T | Promise<T>, arg: GuiGroundingBenchmarkCase[]): Promise<T>;
}): Promise<GuiGroundingBenchmarkArtifacts> {
	await page.setContent(GUI_GROUNDING_BENCHMARK_HTML, { waitUntil: "load" });
	await page.waitForTimeout(100);
	return await page.evaluate(
		(cases) => {
			const truths = cases.map((testCase) => {
				const benchmarkId = testCase.elementId ?? testCase.id;
				const node = document.querySelector(`[data-benchmark-id="${benchmarkId}"]`) as HTMLElement | null;
				if (!node) {
					throw new Error(`Missing benchmark node for ${benchmarkId}`);
				}
				const rect = node.getBoundingClientRect();
				return {
					...testCase,
					box: {
						x: Math.round(rect.left),
						y: Math.round(rect.top),
						width: Math.round(rect.width),
						height: Math.round(rect.height),
					},
					point: {
						x: Math.round(rect.left + (rect.width / 2)),
						y: Math.round(rect.top + (rect.height / 2)),
					},
				};
			});
			return {
				truths,
			};
		},
		GUI_GROUNDING_BENCHMARK_CASES,
	);
}
