import { understudyBrandIconDataUrl } from "./ui-brand.js";
import { buildSessionUiHelpersScript } from "./session-ui-helpers.js";

export function buildWebChatHtml(): string {
	const brandIconDataUrl = understudyBrandIconDataUrl();
	const sessionUiHelpersScript = buildSessionUiHelpersScript({ liveChannelId: "web" });
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Understudy WebChat</title>
	<link rel="icon" href="${brandIconDataUrl}">
	<style>
		:root {
			color-scheme: light;
			--bg: #f0f2f5;
			--panel: #ffffff;
			--panel-hover: #f8f9fa;
			--line: rgba(0,0,0,0.08);
			--text: #1a1a1a;
			--text-secondary: #65676b;
			--accent: #0084ff;
			--accent-hover: #0073e6;
			--accent-soft: #e7f3ff;
			--user-bubble: #0084ff;
			--assistant-bubble: #f0f0f0;
			--system-bg: #fff3cd;
			--error-bg: #fee;
			--error-text: #c0392b;
			--radius: 18px;
			--radius-sm: 12px;
			--shadow-sm: 0 1px 2px rgba(0,0,0,0.1);
			--shadow-md: 0 4px 12px rgba(0,0,0,0.08);
			--shadow-lg: 0 8px 30px rgba(0,0,0,0.12);
			--transition: 0.15s ease;
		}
		* { box-sizing: border-box; margin: 0; padding: 0; }
		body {
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
			background: var(--bg);
			color: var(--text);
			height: 100vh;
			overflow: hidden;
		}

		/* ── Layout ── */
		.app {
			height: 100vh;
			display: grid;
			grid-template-columns: 320px 1fr;
		}

		/* ── Sidebar ── */
		.sidebar {
			background: var(--panel);
			border-right: 1px solid var(--line);
			display: flex;
			flex-direction: column;
			overflow: hidden;
		}
		.sidebar-header {
			padding: 16px;
			border-bottom: 1px solid var(--line);
			display: flex;
			align-items: center;
			gap: 12px;
		}
		.sidebar-header .logo {
			width: 36px; height: 36px;
			border-radius: 10px;
			overflow: hidden;
			flex-shrink: 0;
		}
		.sidebar-header .logo img {
			width: 100%; height: 100%; object-fit: cover;
		}
		.sidebar-header .title {
			font-size: 16px; font-weight: 600;
		}
		.sidebar-header .subtitle {
			font-size: 11px; color: var(--text-secondary);
		}
		.sidebar-actions {
			padding: 12px 16px;
			display: flex; gap: 8px;
		}
		.sidebar-actions button {
			flex: 1;
			padding: 8px 12px;
			border: 1px solid var(--line);
			border-radius: var(--radius-sm);
			background: var(--panel);
			color: var(--text);
			font-size: 13px;
			cursor: pointer;
			transition: background var(--transition);
		}
		.sidebar-actions button:hover { background: var(--panel-hover); }
		.sidebar-actions button.primary {
			background: var(--accent);
			color: #fff;
			border-color: transparent;
		}
		.sidebar-actions button.primary:hover { background: var(--accent-hover); }

		/* Status bar */
		.status-bar {
			padding: 8px 16px;
			display: flex;
			align-items: center;
			gap: 8px;
			font-size: 12px;
			color: var(--text-secondary);
			border-bottom: 1px solid var(--line);
		}
		.status-dot {
			width: 8px; height: 8px;
			border-radius: 50%;
			flex-shrink: 0;
		}
		.status-dot.ok { background: #31a24c; }
		.status-dot.warn { background: #f0932b; }
		.status-dot.err { background: #e74c3c; }

		/* Session list */
		.session-section {
			flex: 1;
			overflow: hidden;
			display: flex;
			flex-direction: column;
		}
		.session-section-header {
			padding: 12px 16px 8px;
			font-size: 12px;
			font-weight: 600;
			color: var(--text-secondary);
			text-transform: uppercase;
			letter-spacing: 0.05em;
			display: flex; align-items: center; justify-content: space-between;
		}
		.session-filter {
			margin: 0 16px 8px;
			padding: 8px 12px;
			border: 1px solid var(--line);
			border-radius: var(--radius-sm);
			font-size: 13px;
			outline: none;
			background: var(--panel-hover);
			width: calc(100% - 32px);
		}
		.session-filter:focus {
			border-color: var(--accent);
			box-shadow: 0 0 0 3px rgba(0,132,255,0.1);
		}
		.session-list {
			flex: 1;
			overflow-y: auto;
			padding: 0 8px 8px;
		}
		.session-item {
			width: 100%;
			text-align: left;
			padding: 10px 12px;
			border: none;
			border-radius: var(--radius-sm);
			background: transparent;
			cursor: pointer;
			display: flex;
			flex-direction: column;
			gap: 2px;
			transition: background var(--transition);
			font: inherit;
		}
		.session-item:hover { background: var(--panel-hover); }
		.session-item.active { background: var(--accent-soft); }
		.session-item .session-name {
			font-size: 13px; font-weight: 500;
			overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		}
		.session-item .session-meta {
			font-size: 11px; color: var(--text-secondary);
			line-height: 1.4;
		}
		.session-item .session-chip-row {
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
			margin-top: 2px;
		}
		.session-chip {
			display: inline-flex;
			align-items: center;
			gap: 4px;
			padding: 3px 8px;
			border-radius: 999px;
			border: 1px solid var(--line);
			background: var(--panel);
			font-size: 10px;
			font-weight: 500;
			color: var(--text-secondary);
			max-width: 100%;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.session-chip.channel {
			background: #e7f3ff;
			color: #0f5dbd;
			border-color: rgba(0, 132, 255, 0.16);
		}
		.session-chip.conversation {
			background: #edf7ed;
			color: #22663b;
			border-color: rgba(34, 102, 59, 0.14);
		}
		.session-chip.sender {
			background: #fff4e5;
			color: #8a4b08;
			border-color: rgba(138, 75, 8, 0.12);
		}
		.session-chip.state {
			background: #fff1f0;
			color: #b42318;
			border-color: rgba(180, 35, 24, 0.14);
		}
		.session-chip.teach {
			background: #f4f0ff;
			color: #5b33b6;
			border-color: rgba(91, 51, 182, 0.16);
		}
		.session-item .session-actions {
			display: flex; gap: 4px; margin-top: 2px;
		}
		.session-item .session-del {
			background: none; border: none; cursor: pointer;
			font-size: 11px; color: var(--text-secondary);
			padding: 2px 6px; border-radius: 4px;
		}
		.session-item .session-del:hover {
			background: var(--error-bg); color: var(--error-text);
		}

		/* Sidebar info (collapsed) */
		.sidebar-info {
			padding: 12px 16px;
			border-top: 1px solid var(--line);
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
		}
		.info-chip {
			display: inline-flex; align-items: center; gap: 4px;
			padding: 4px 8px;
			border-radius: 999px;
			background: var(--panel-hover);
			font-size: 11px;
			color: var(--text-secondary);
		}

		/* ── Chat area ── */
		.chat {
			display: flex;
			flex-direction: column;
			overflow: hidden;
			background: var(--bg);
		}

		/* Chat header */
		.chat-header {
			padding: 12px 20px;
			background: var(--panel);
			border-bottom: 1px solid var(--line);
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
		}
		.chat-header-left {
			display: flex;
			align-items: center;
			gap: 12px;
			min-width: 0;
		}
		.chat-header h2 {
			font-size: 16px; font-weight: 600;
			overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		}
		.chat-header .header-meta {
			font-size: 12px;
			color: var(--text-secondary);
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 6px;
		}
		.chat-header .header-note {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.chat-header-actions {
			display: flex; gap: 8px; flex-shrink: 0;
		}
		.chat-header-actions button, .chat-header-actions a {
			padding: 6px 12px;
			border: 1px solid var(--line);
			border-radius: var(--radius-sm);
			background: var(--panel);
			color: var(--text);
			font-size: 12px;
			cursor: pointer;
			text-decoration: none;
			display: inline-flex; align-items: center; gap: 4px;
			transition: background var(--transition);
		}
		.chat-header-actions button:hover, .chat-header-actions a:hover {
			background: var(--panel-hover);
		}

		/* Messages */
		.messages {
			flex: 1;
			overflow-y: auto;
			padding: 20px;
			display: flex;
			flex-direction: column;
			gap: 4px;
		}
		.msg {
			max-width: 70%;
			padding: 10px 14px;
			border-radius: var(--radius);
			line-height: 1.45;
			word-break: break-word;
			font-size: 14px;
			position: relative;
		}
		.msg.user {
			align-self: flex-end;
			background: var(--user-bubble);
			color: #fff;
			border-bottom-right-radius: 4px;
		}
		.msg.user a { color: #fff; }
		.msg.assistant {
			align-self: flex-start;
			background: var(--assistant-bubble);
			color: var(--text);
			border-bottom-left-radius: 4px;
		}
		.msg.system {
			align-self: center;
			background: var(--system-bg);
			color: #856404;
			font-size: 13px;
			max-width: 80%;
			border-radius: var(--radius-sm);
		}
		.msg.error {
			align-self: center;
			background: var(--error-bg);
			color: var(--error-text);
			font-size: 13px;
			max-width: 80%;
			border-radius: var(--radius-sm);
		}
		.msg-time {
			font-size: 10px;
			opacity: 0.6;
			margin-top: 4px;
		}
		.msg.user .msg-time { text-align: right; }
		.msg-body p { margin: 0 0 8px; }
		.msg-body p:last-child { margin-bottom: 0; }
		.msg-body:empty { display: none; }
		.msg-body pre {
			margin: 8px 0;
			padding: 10px 12px;
			border-radius: var(--radius-sm);
			background: #1e1e1e;
			color: #d4d4d4;
			overflow-x: auto;
			font-family: "SF Mono", "Fira Code", "Consolas", monospace;
			font-size: 12px;
			line-height: 1.5;
		}
		.msg-body code {
			font-family: "SF Mono", "Fira Code", "Consolas", monospace;
			font-size: 0.9em;
		}
		.msg-body ul, .msg-body ol {
			margin: 4px 0; padding-left: 20px;
		}
		.msg-media {
			display: flex;
			flex-direction: column;
			gap: 8px;
			margin-top: 8px;
		}
		.msg-media:empty {
			display: none;
		}
		.msg-images {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
		}
		.msg-images:empty {
			display: none;
		}
		.msg-images img {
			display: block;
			max-width: min(280px, 100%);
			max-height: 240px;
			border-radius: 14px;
			border: 1px solid rgba(0, 0, 0, 0.1);
			background: rgba(255, 255, 255, 0.92);
			object-fit: contain;
			box-shadow: var(--shadow-sm);
		}
		.msg.user .msg-images img {
			border-color: rgba(255, 255, 255, 0.22);
		}
		.msg-attachments {
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
		}
		.msg-attachments:empty {
			display: none;
		}
		.msg-attachment {
			display: inline-flex;
			align-items: center;
			max-width: 100%;
			padding: 5px 10px;
			border-radius: 999px;
			font-size: 11px;
			line-height: 1.3;
			background: rgba(0, 0, 0, 0.06);
			color: inherit;
		}
		.msg.user .msg-attachment {
			background: rgba(255, 255, 255, 0.18);
		}
		.run-card {
			align-self: flex-start;
			width: min(760px, 88%);
			padding: 14px 16px;
			border-radius: 22px;
			background:
				linear-gradient(135deg, rgba(13, 58, 112, 0.08), rgba(30, 144, 255, 0.04)),
				var(--panel);
			border: 1px solid rgba(0, 132, 255, 0.14);
			box-shadow: var(--shadow-md);
			display: flex;
			flex-direction: column;
			gap: 12px;
		}
		.run-card.archived {
			background:
				linear-gradient(135deg, rgba(0, 0, 0, 0.03), rgba(0, 0, 0, 0.015)),
				var(--panel);
			border-color: rgba(0, 0, 0, 0.08);
			box-shadow: var(--shadow-sm);
		}
		.run-card-head {
			display: flex;
			align-items: center;
			gap: 10px;
			flex-wrap: wrap;
		}
		.run-badge {
			display: inline-flex;
			align-items: center;
			padding: 4px 10px;
			border-radius: 999px;
			font-size: 11px;
			font-weight: 700;
			letter-spacing: 0.04em;
			text-transform: uppercase;
			background: rgba(0, 132, 255, 0.12);
			color: #0d5aa7;
		}
		.run-badge.done {
			background: rgba(49, 162, 76, 0.12);
			color: #24723a;
		}
		.run-badge.error {
			background: rgba(231, 76, 60, 0.12);
			color: #c0392b;
		}
		.run-title {
			font-size: 13px;
			font-weight: 600;
			color: var(--text);
		}
		.run-meta {
			font-size: 11px;
			color: var(--text-secondary);
			margin-left: auto;
		}
		.run-summary {
			font-size: 14px;
			line-height: 1.5;
			color: var(--text);
		}
		.run-thinking {
			border: 1px solid var(--line);
			border-radius: 14px;
			background: rgba(255, 255, 255, 0.6);
			padding: 10px 12px;
		}
		.run-thinking[hidden] {
			display: none;
		}
		.run-thinking summary {
			cursor: pointer;
			font-size: 12px;
			font-weight: 600;
			color: var(--text-secondary);
			list-style: none;
		}
		.run-thinking summary::-webkit-details-marker {
			display: none;
		}
		.run-thinking-body {
			margin-top: 8px;
			font-size: 13px;
			line-height: 1.5;
			color: var(--text-secondary);
			white-space: pre-wrap;
		}
		.run-tools {
			display: flex;
			flex-direction: column;
			gap: 8px;
		}
		.run-tool {
			border: 1px solid var(--line);
			border-radius: 14px;
			padding: 10px 12px;
			background: rgba(255, 255, 255, 0.78);
		}
		.run-tool.running {
			border-color: rgba(0, 132, 255, 0.18);
			background: rgba(231, 243, 255, 0.58);
		}
		.run-tool.error {
			border-color: rgba(231, 76, 60, 0.2);
			background: rgba(254, 238, 238, 0.9);
		}
		.run-tool-head {
			display: flex;
			align-items: center;
			gap: 8px;
			flex-wrap: wrap;
		}
		.run-tool-route, .run-tool-state {
			display: inline-flex;
			align-items: center;
			padding: 2px 8px;
			border-radius: 999px;
			font-size: 10px;
			font-weight: 700;
			letter-spacing: 0.05em;
			text-transform: uppercase;
		}
		.run-tool-route {
			background: rgba(0, 0, 0, 0.06);
			color: var(--text-secondary);
		}
		.run-tool-state {
			background: rgba(0, 132, 255, 0.12);
			color: #0d5aa7;
		}
		.run-tool-state.done {
			background: rgba(49, 162, 76, 0.12);
			color: #24723a;
		}
		.run-tool-state.error {
			background: rgba(231, 76, 60, 0.12);
			color: #c0392b;
		}
		.run-tool-label {
			font-size: 13px;
			font-weight: 600;
			color: var(--text);
		}
		.run-tool-detail {
			margin-top: 6px;
			font-size: 12px;
			line-height: 1.45;
			color: var(--text-secondary);
			white-space: pre-wrap;
		}
		.run-tool-detail:empty {
			display: none;
		}
		.run-tool-media {
			margin-top: 8px;
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
		}
		.run-tool-media:empty {
			display: none;
		}
		.run-tool-media img {
			display: block;
			max-width: min(320px, 100%);
			max-height: 220px;
			border-radius: 12px;
			border: 1px solid rgba(0, 0, 0, 0.08);
			box-shadow: var(--shadow-sm);
			background: rgba(255, 255, 255, 0.95);
			object-fit: contain;
		}

		/* Welcome state */
		.welcome {
			flex: 1;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 16px;
			padding: 40px;
			text-align: center;
		}
		.welcome-icon {
			width: 64px; height: 64px;
			border-radius: 16px;
			overflow: hidden;
		}
		.welcome-icon img {
			width: 100%; height: 100%; object-fit: cover;
		}
		.welcome h3 { font-size: 20px; font-weight: 600; }
		.welcome p { font-size: 14px; color: var(--text-secondary); max-width: 400px; line-height: 1.5; }

		/* ── Composer ── */
		.composer {
			padding: 12px 20px 16px;
			background: var(--panel);
			border-top: 1px solid var(--line);
		}

		/* Slash command autocomplete */
		.slash-menu {
			display: none;
			position: absolute;
			bottom: 100%;
			left: 0; right: 0;
			background: var(--panel);
			border: 1px solid var(--line);
			border-radius: var(--radius-sm);
			box-shadow: var(--shadow-lg);
			max-height: 240px;
			overflow-y: auto;
			margin-bottom: 4px;
			z-index: 10;
		}
		.slash-menu.visible { display: block; }
		.slash-item {
			padding: 8px 14px;
			cursor: pointer;
			display: flex;
			flex-direction: column;
			gap: 1px;
			transition: background var(--transition);
		}
		.slash-item:hover, .slash-item.active {
			background: var(--accent-soft);
		}
		.slash-item .slash-cmd {
			font-size: 13px; font-weight: 500;
			font-family: "SF Mono", "Fira Code", monospace;
		}
		.slash-item .slash-desc {
			font-size: 11px; color: var(--text-secondary);
		}

		/* Media */
		.media-strip {
			display: flex; flex-wrap: wrap; gap: 6px;
			margin-bottom: 8px;
		}
		.media-strip:empty { display: none; }
		.media-tag {
			display: inline-flex; align-items: center; gap: 4px;
			padding: 4px 10px;
			border-radius: 999px;
			background: var(--panel-hover);
			border: 1px solid var(--line);
			font-size: 11px;
		}
		.media-tag button {
			background: none; border: none; cursor: pointer;
			color: var(--text-secondary); font-size: 14px; padding: 0 2px;
			line-height: 1;
		}
		.media-tag button:hover { color: var(--error-text); }

		/* Input row */
		.composer-input-wrap {
			position: relative;
			display: flex;
			align-items: flex-end;
			gap: 8px;
			background: var(--panel-hover);
			border: 1px solid var(--line);
			border-radius: var(--radius);
			padding: 4px 4px 4px 14px;
			transition: border-color var(--transition), box-shadow var(--transition);
		}
		.composer-input-wrap:focus-within {
			border-color: var(--accent);
			box-shadow: 0 0 0 3px rgba(0,132,255,0.1);
		}
		.composer-input-wrap textarea {
			flex: 1;
			border: none;
			background: transparent;
			resize: none;
			font: inherit;
			font-size: 14px;
			line-height: 1.4;
			padding: 8px 0;
			min-height: 24px;
			max-height: 160px;
			outline: none;
			color: var(--text);
		}
		.composer-input-wrap textarea::placeholder {
			color: var(--text-secondary);
		}
		.composer-btn-group {
			display: flex;
			gap: 2px;
			align-items: center;
			padding-bottom: 4px;
		}
		.composer-btn {
			width: 34px; height: 34px;
			border: none; border-radius: 50%;
			cursor: pointer;
			display: flex; align-items: center; justify-content: center;
			transition: background var(--transition);
			background: transparent;
			color: var(--text-secondary);
			font-size: 18px;
		}
		.composer-btn:hover { background: rgba(0,0,0,0.05); }
		.composer-btn.send-btn {
			background: var(--accent);
			color: #fff;
		}
		.composer-btn.send-btn:hover { background: var(--accent-hover); }
		.composer-btn.send-btn:disabled {
			background: #ccc;
			cursor: default;
		}

		.composer-hint {
			font-size: 11px;
			color: var(--text-secondary);
			margin-top: 6px;
			text-align: center;
		}
		.hidden-input {
			position: absolute; opacity: 0; pointer-events: none;
			width: 1px; height: 1px;
		}

		/* Model selector modal */
		.modal-overlay {
			display: none;
			position: fixed; inset: 0;
			background: rgba(0,0,0,0.4);
			z-index: 100;
			align-items: center; justify-content: center;
		}
		.modal-overlay.visible { display: flex; }
		.modal {
			background: var(--panel);
			border-radius: var(--radius);
			box-shadow: var(--shadow-lg);
			width: 400px;
			max-width: 90vw;
			max-height: 80vh;
			overflow: auto;
		}
		.modal-header {
			padding: 16px 20px;
			border-bottom: 1px solid var(--line);
			display: flex; align-items: center; justify-content: space-between;
		}
		.modal-header h3 { font-size: 16px; font-weight: 600; }
		.modal-close {
			background: none; border: none;
			font-size: 20px; cursor: pointer;
			color: var(--text-secondary); padding: 4px;
		}
		.modal-body { padding: 16px 20px; }
		.modal-body select {
			width: 100%;
			padding: 10px 12px;
			border: 1px solid var(--line);
			border-radius: var(--radius-sm);
			font-size: 14px;
			background: var(--panel);
			margin-bottom: 12px;
		}
		.modal-footer {
			padding: 12px 20px;
			border-top: 1px solid var(--line);
			display: flex; justify-content: flex-end; gap: 8px;
		}
		.modal-footer button {
			padding: 8px 16px;
			border: 1px solid var(--line);
			border-radius: var(--radius-sm);
			font-size: 13px;
			cursor: pointer;
			background: var(--panel);
			transition: background var(--transition);
		}
		.modal-footer button:hover { background: var(--panel-hover); }
		.modal-footer button.primary {
			background: var(--accent); color: #fff; border-color: transparent;
		}
		.modal-footer button.primary:hover { background: var(--accent-hover); }

		/* ── Responsive ── */
		@media (max-width: 768px) {
			.app { grid-template-columns: 1fr; }
			.sidebar { display: none; }
			.sidebar.mobile-open {
				display: flex;
				position: fixed; inset: 0;
				z-index: 50;
				width: 100%;
			}
			.mobile-menu-btn { display: flex !important; }
			.msg { max-width: 85%; }
		}
		.mobile-menu-btn { display: none; }
	</style>
</head>
<body>
<div class="app">
	<aside class="sidebar" id="sidebar">
		<div class="sidebar-header">
			<div class="logo"><img src="${brandIconDataUrl}" alt="Understudy"></div>
			<div>
				<div class="title">Understudy</div>
				<div class="subtitle">WebChat</div>
			</div>
		</div>
		<div class="sidebar-actions">
			<button class="primary" id="new-session-btn" type="button">+ New Chat</button>
			<button id="overview-btn" type="button">Overview</button>
		</div>
		<div class="status-bar" id="status-bar">
			<span class="status-dot warn" id="status-dot"></span>
			<span id="status-text">Connecting...</span>
			<button id="status-model" type="button" title="Click to change model" style="margin-left:auto;background:none;border:none;cursor:pointer;font:inherit;color:var(--text-secondary)">Model: --</button>
		</div>
		<div class="session-section">
			<div class="session-section-header">
				<span>Sessions</span>
				<div style="display:flex;align-items:center;gap:8px">
					<button id="session-scope-btn" style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--text-secondary)">Mine</button>
					<button id="refresh-sessions-btn" style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--text-secondary)">Refresh</button>
				</div>
			</div>
			<input class="session-filter" id="session-filter" type="search" placeholder="Search sessions...">
			<div class="session-list" id="session-list"></div>
		</div>
		<div class="sidebar-info" id="sidebar-info">
			<span class="info-chip" id="chip-conn">WS: --</span>
			<span class="info-chip" id="chip-auth">Auth: --</span>
			<span class="info-chip" id="chip-tools">Tools: --</span>
			<span class="info-chip" id="chip-channels">Channels: --</span>
		</div>
	</aside>

	<main class="chat" id="chat-main">
		<div class="chat-header">
			<div class="chat-header-left">
				<button class="mobile-menu-btn" id="mobile-menu-btn" style="background:none;border:none;font-size:20px;cursor:pointer" type="button">&#9776;</button>
				<div>
					<h2 id="chat-title">Overview Chat</h2>
					<div class="header-meta" id="chat-meta">Send a message to start a fresh request or pick a saved session</div>
				</div>
			</div>
			<div class="chat-header-actions">
				<a id="dashboard-link" href="/ui">Open Dashboard</a>
				<button id="clear-btn" type="button">Clear</button>
			</div>
		</div>

		<div id="messages" class="messages">
			<div class="welcome" id="welcome-view">
				<div class="welcome-icon"><img src="${brandIconDataUrl}" alt="Understudy"></div>
				<h3>Understudy WebChat</h3>
				<p>Send a message to start a conversation. Type <strong>/</strong> for available commands. Pick a saved session on the left or click the model badge above to switch models.</p>
			</div>
		</div>
		<div class="composer">
			<div class="media-strip" id="media-strip"></div>
			<div class="composer-input-wrap" id="composer-wrap">
				<div class="slash-menu" id="slash-menu"></div>
				<textarea id="msg-input" rows="1" placeholder="Message Understudy... (/ for commands)"></textarea>
				<input id="media-file-input" class="hidden-input" type="file" multiple>
				<div class="composer-btn-group">
					<button class="composer-btn" id="attach-btn" type="button" title="Attach file">+</button>
					<button class="composer-btn send-btn" id="send-btn" type="button" title="Send" disabled>&#10148;</button>
				</div>
			</div>
			<div class="composer-hint" id="composer-hint">Enter to send, Shift+Enter for new line, / for commands, click Model to switch</div>
		</div>
	</main>
</div>

<!-- Model picker modal -->
<div class="modal-overlay" id="model-modal">
	<div class="modal">
		<div class="modal-header">
			<h3>Change Model</h3>
			<button class="modal-close" id="model-modal-close" type="button">&times;</button>
		</div>
		<div class="modal-body">
			<p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">
				Select a model or type provider/model-id.
			</p>
			<select id="model-select"><option value="">Loading...</option></select>
		</div>
		<div class="modal-footer">
			<button id="model-cancel-btn" type="button">Cancel</button>
			<button class="primary" id="model-apply-btn" type="button">Apply</button>
		</div>
	</div>
</div>

<script>
(function() {
"use strict";

${sessionUiHelpersScript}

/* ── Constants ── */
const BASE = location.origin;
const LIVE_CHANNEL = "web";
const CLIENT_KEY = "understudy.webchat.clientId";
const SESSION_SCOPE_KEY = "understudy.webchat.sessionScope";
const WS_RECONNECT_BASE = 1000;
const WS_RECONNECT_MAX = 30000;
const HEALTH_INTERVAL = 15000;

/* ── Auth ── */
const token = new URLSearchParams(location.search).get("token") || "";
const rpcHeaders = { "Content-Type": "application/json" };
if (token) rpcHeaders["Authorization"] = "Bearer " + token;

/* ── DOM refs ── */
const $id = (id) => document.getElementById(id);
const sidebar = $id("sidebar");
const statusDot = $id("status-dot");
const statusText = $id("status-text");
const statusModel = $id("status-model");
const sessionList = $id("session-list");
const sessionFilter = $id("session-filter");
const sessionScopeBtn = $id("session-scope-btn");
const chipConn = $id("chip-conn");
const chipAuth = $id("chip-auth");
const chipTools = $id("chip-tools");
const chipChannels = $id("chip-channels");
const dashboardLink = $id("dashboard-link");
const chatTitle = $id("chat-title");
const chatMeta = $id("chat-meta");
const messagesEl = $id("messages");
const welcomeView = $id("welcome-view");
const msgInput = $id("msg-input");
const sendBtn = $id("send-btn");
const attachBtn = $id("attach-btn");
const fileInput = $id("media-file-input");
const mediaStrip = $id("media-strip");
const slashMenu = $id("slash-menu");
const composerHint = $id("composer-hint");
const modelModal = $id("model-modal");
const modelSelect = $id("model-select");

/* ── State ── */
let clientId = resolveClientId();
let showAllSessions = resolveSessionScope();
let wsConnected = false;
let wsReconnectDelay = WS_RECONNECT_BASE;
let ws = null;
let activeSessionId = "";
let currentConfig = null;
let modelsCache = [];
let sessionsCache = [];
let toolsCache = [];
let skillsStatusCache = null;
let gatewayHealth = null;
let gatewayCapabilities = null;
let sendPending = false;
let pendingMedia = [];
let sessionViewRequestVersion = 0;
const activeLiveRunIds = new Set();
let liveAssistantBubble = null;
let liveAssistantText = "";
let liveRunStatusText = "";
const liveRunViews = new Map();

/* Slash commands: built-in + dynamically discovered */
const builtinCommands = [
	{ cmd: "/new", desc: "Create a new chat session", local: true },
	{ cmd: "/resume", desc: "Open the latest saved session or a matching session id/name", local: true },
	{ cmd: "/reset", desc: "Reset the current session", local: true },
	{ cmd: "/name", desc: "Show or set the current session display name", local: true },
	{ cmd: "/session", desc: "Show details for the selected session", local: true },
	{ cmd: "/fork", desc: "Branch the current session", local: true },
	{ cmd: "/compact", desc: "Compact the current session history", local: true },
	{ cmd: "/copy", desc: "Copy the latest assistant reply to the clipboard", local: true },
	{ cmd: "/model", desc: "Show or change the active model (e.g. /model openai-codex/gpt-5.4)", local: true },
	{ cmd: "/settings", desc: "Show WebChat settings help and open the model picker", local: true },
	{ cmd: "/reload", desc: "Reload WebChat discovery data, sessions, and health", local: true },
	{ cmd: "/hotkeys", desc: "Show WebChat keyboard shortcuts", local: true },
	{ cmd: "/attach", desc: "Open the browser file picker for the next message", local: true },
	{ cmd: "/tree", desc: "Explain session tree support in WebChat", local: true },
	{ cmd: "/export", desc: "Explain export support in WebChat", local: true },
	{ cmd: "/quit", desc: "Close WebChat guidance", local: true },
	{ cmd: "/exit", desc: "Close WebChat guidance", local: true },
	{ cmd: "/live", desc: "Return to the overview chat surface", local: true },
	{ cmd: "/clear", desc: "Clear the chat view", local: true },
	{ cmd: "/help", desc: "Show available commands", local: true },
	{ cmd: "/teach", desc: "Record a demo, shape the learned task, then confirm or validate it (e.g. /teach start, /teach stop, /teach confirm)" },
	{ cmd: "/skills", desc: "Show loaded skills and their status", local: true },
	{ cmd: "/tools", desc: "List available tools", local: true },
	{ cmd: "/channels", desc: "List built-in channel runtime states, capabilities, and pairing/auth hints", local: true },
	{ cmd: "/config", desc: "Show current configuration", local: true },
	{ cmd: "/usage", desc: "Show usage summary and costs", local: true },
	{ cmd: "/session delete", desc: "Delete the current session", local: true },
	{ cmd: "/session compact", desc: "Compact the current session history", local: true },
	{ cmd: "/session branch", desc: "Branch the current session", local: true },
	{ cmd: "/attachments", desc: "Show pending attachments for the next message", local: true },
	{ cmd: "/detach", desc: "Clear pending attachments for the next message", local: true },
	{ cmd: "/schedule", desc: "Show scheduling status", local: true },
	{ cmd: "/health", desc: "Show gateway health status", local: true },
];
let discoveredCommands = [];
let slashIndex = -1;
let slashVisible = false;

/* ── Utilities ── */
function esc(v) {
	return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function formatChannelCapabilityList(caps) {
	if (!caps || typeof caps !== "object") return "none";
	var enabled = Object.entries(caps).filter(function(entry) { return !!entry[1]; }).map(function(entry) { return entry[0]; });
	return enabled.length ? enabled.join(", ") : "none";
}

function formatChannelsSummaryText(payload) {
	var items = Array.isArray(payload && payload.channels) ? payload.channels : [];
	if (!items.length) return "No channels configured.";
	return ["Configured channels:"].concat(items.map(function(ch) {
		var runtime = ch && ch.runtime && typeof ch.runtime === "object" ? ch.runtime : {};
		var state = runtime.state || "unknown";
		var summary = runtime.summary ? " - " + runtime.summary : "";
		var caps = formatChannelCapabilityList(ch && ch.capabilities);
		var nextStep = "";
		if (state === "awaiting_pairing") nextStep = " Next: approve pairing or complete QR login.";
		else if (state === "error" && runtime.lastError) nextStep = " Last error: " + runtime.lastError;
		return "- " + (ch.name || ch.id || "channel") + " (" + (ch.id || "unknown") + "): " + state + summary + ". Capabilities: " + caps + "." + nextStep;
	})).join("\\n");
}

function resolveClientId() {
	try {
		const saved = localStorage.getItem(CLIENT_KEY);
		if (saved) return saved;
		const id = "webchat_" + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
		localStorage.setItem(CLIENT_KEY, id);
		return id;
	} catch { return "webchat_" + Math.random().toString(36).slice(2); }
}

function resolveSessionScope() {
	try {
		const scope = new URLSearchParams(location.search).get("scope");
		if (scope === "all") return true;
		if (scope === "mine") return false;
		return localStorage.getItem(SESSION_SCOPE_KEY) === "all";
	} catch {
		return false;
	}
}

function persistSessionScope() {
	try {
		localStorage.setItem(SESSION_SCOPE_KEY, showAllSessions ? "all" : "mine");
		const url = new URL(location.href);
		if (showAllSessions) {
			url.searchParams.set("scope", "all");
		} else {
			url.searchParams.delete("scope");
		}
		history.replaceState(null, "", url.toString());
	} catch {}
}

function refreshSessionScopeButton() {
	if (!sessionScopeBtn) return;
	sessionScopeBtn.textContent = showAllSessions ? "All" : "Mine";
	sessionScopeBtn.title = showAllSessions
		? "Showing all saved sessions. Click to limit the list to this browser."
		: "Showing only this browser WebChat scope. Click to include all saved sessions.";
}

function fmtTime(ts) {
	return new Date(ts || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtRelative(ts) {
	if (!ts) return "just now";
	const s = Math.floor(Math.max(0, Date.now() - ts) / 1000);
	if (s < 45) return "just now";
	const m = Math.floor(s / 60);
	if (m < 60) return m + "m ago";
	const h = Math.floor(m / 60);
	if (h < 24) return h + "h ago";
	return Math.floor(h / 24) + "d ago";
}
function fmtBytes(b) {
	const v = Number(b || 0);
	if (!Number.isFinite(v) || v <= 0) return "0 B";
	const u = ["B","KB","MB","GB"];
	let s = v, i = 0;
	for (; i < u.length - 1 && s >= 1024; i++) s /= 1024;
	return s.toFixed(s >= 100 || i === 0 ? 0 : 1) + " " + u[i];
}
function fmtUptime(ms) {
	const t = Math.max(0, Math.floor((ms||0)/1000));
	const h = Math.floor(t/3600), m = Math.floor((t%3600)/60);
	return h > 0 ? h+"h "+m+"m" : m+"m";
}

function clampText(value, max) {
	const text = String(value || "").trim();
	if (!text) return "";
	return text.length > max ? text.slice(0, Math.max(0, max - 3)) + "..." : text;
}

function fmtDateTime(ts) {
	if (!ts) return "--";
	return new Date(ts).toLocaleString();
}

function sessionDisplayName(session) {
	return sessionUiDisplayName(session);
}

function sessionSenderLabel(session) {
	return sessionUiSenderLabel(session);
}

function sessionConversationLabel(session) {
	return sessionUiConversationLabel(session);
}

function sessionChannelContextLabel(session) {
	return sessionUiContextLabel(session);
}

function sessionBadgeItems(session, options) {
	const opts = options && typeof options === "object" ? options : {};
	return sessionUiChipItems(session, {
		includeChannel: opts.includeChannel,
		forceChannel: opts.forceChannel,
		includeConversation: opts.includeConversation,
		includeSender: opts.includeSender,
		includeReadOnly: opts.includeReadOnly,
		readOnly: !isSessionWritable(session),
	});
}

function renderSessionBadgeRow(session, options) {
	const items = sessionBadgeItems(session, options);
	if (!items.length) return "";
	return '<div class="session-chip-row">' + items.map(function(item) {
		return '<span class="session-chip ' + esc(item.kind) + '">' + esc(item.text) + "</span>";
	}).join("") + "</div>";
}

function renderSessionHeaderMeta(meta, session) {
	const note = meta
		? '<span class="header-note">' + esc(meta) + "</span>"
		: "";
	if (!session || typeof session !== "object") {
		return note;
	}
	const writable = isSessionWritable(session);
	const badgeRow = renderSessionBadgeRow(session, {
		forceChannel: String(session.channelId || "").trim() !== LIVE_CHANNEL || !writable,
		includeSender: !writable,
		includeReadOnly: !writable,
	});
	return note + badgeRow;
}

function isSessionWritable(session) {
	return Boolean(
		session &&
		typeof session === "object" &&
		session.channelId === LIVE_CHANNEL &&
		session.senderId === clientId,
	);
}

function sessionTitle(session) {
	if (!session) return "";
	if (typeof session === "string") {
		const summary = findSessionSummary(session);
		return summary ? sessionTitle(summary) : session;
	}
	return sessionDisplayName(session) || sessionChannelContextLabel(session) || String(session.id || "").trim();
}

function sessionSubtitle(session, sessionId) {
	const summary = session && typeof session === "object" ? session : findSessionSummary(sessionId);
	const writable = isSessionWritable(summary);
	const senderLabel = sessionSenderLabel(summary);
	return writable
		? (sessionDisplayName(summary)
			? "Viewing and continuing this saved session • " + sessionId
			: "Viewing and continuing this saved session")
		: [
			sessionDisplayName(summary)
				? "Viewing this saved session (read-only) • " + sessionId
				: "Viewing this saved session (read-only)",
			sessionChannelContextLabel(summary) ? "Context: " + sessionChannelContextLabel(summary) : "",
			senderLabel ? "Sender: " + senderLabel : "",
		].filter(Boolean).join(" • ");
}

function sessionSearchText(session) {
	if (!session || typeof session !== "object") return "";
	return [
		sessionDisplayName(session),
		session.id,
		session.model,
		session.workspaceDir,
		session.channelId,
		session.conversationName,
		sessionConversationLabel(session),
		session.senderName,
		sessionSenderLabel(session),
		session.parentId,
		session?.teachClarification?.draftId,
		session?.teachClarification?.status,
		session?.teachClarification?.summary,
	].filter(Boolean).join(" ").toLowerCase();
}

function findSessionSummary(sessionId) {
	const wanted = String(sessionId || "").trim();
	if (!wanted) return null;
	return sessionsCache.find(function(session) {
		return session && session.id === wanted;
	}) || null;
}

function currentSessionSummary() {
	return findSessionSummary(activeSessionId);
}

function findSessionByQuery(query) {
	const needle = String(query || "").trim().toLowerCase();
	if (!needle) return sessionsCache[0] || null;
	if (needle === "latest" || needle === "last" || needle === "recent") {
		return sessionsCache[0] || null;
	}
	const exact = sessionsCache.find(function(session) {
		return String(session.id || "").toLowerCase() === needle
			|| sessionDisplayName(session).toLowerCase() === needle
			|| sessionTitle(session).toLowerCase() === needle;
	});
	if (exact) return exact;
	return sessionsCache.find(function(session) {
		return sessionSearchText(session).includes(needle);
	}) || null;
}

function listSessionMatches(query, limit) {
	const needle = String(query || "").trim().toLowerCase();
	const max = Math.max(1, Number(limit || 8));
	const items = needle
		? sessionsCache.filter(function(session) { return sessionSearchText(session).includes(needle); })
		: sessionsCache.slice();
	return items.slice(0, max);
}

async function copyTextToClipboard(text) {
	const value = String(text || "");
	if (!value.trim()) {
		throw new Error("Nothing to copy.");
	}
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(value);
		return;
	}
	const textarea = document.createElement("textarea");
	textarea.value = value;
	document.body.appendChild(textarea);
	textarea.select();
	document.execCommand("copy");
	textarea.remove();
}

function downloadTextFile(name, text) {
	const blob = new Blob([String(text || "")], { type: "text/plain;charset=utf-8" });
	const href = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = href;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(function() { URL.revokeObjectURL(href); }, 1000);
}

function sanitizeFilename(value) {
	const cleaned = String(value || "").trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return cleaned || "session";
}

function lastAssistantText() {
	const messages = Array.from(messagesEl.querySelectorAll(".msg.assistant"));
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const text = messages[index]?.dataset?.rawText || "";
		if (String(text).trim()) {
			return text;
		}
	}
	return "";
}

function listNames(value, limit) {
	const items = Array.isArray(value) ? value.filter(Boolean).map(String) : [];
	if (!items.length) return "";
	const max = Math.max(1, Number(limit || 6));
	return items.length > max
		? items.slice(0, max).join(", ") + " +" + (items.length - max)
		: items.join(", ");
}

function formatSessionSummaryText(session) {
	if (!session || typeof session !== "object") return "Session not found.";
	const lines = [
		"Session: " + (sessionTitle(session) || String(session.id || "")),
		"Id: " + String(session.id || "--"),
		"Messages: " + String(session.messageCount || 0),
		"Created: " + fmtDateTime(session.createdAt),
		"Last active: " + fmtDateTime(session.lastActiveAt),
	];
	if (session.parentId) {
		lines.push("Parent: " + session.parentId + (session.forkPoint != null ? " @ " + session.forkPoint : ""));
	}
	if (session.channelId) lines.push("Channel: " + session.channelId);
	if (sessionConversationLabel(session)) lines.push("Conversation: " + sessionConversationLabel(session));
	if (sessionSenderLabel(session)) lines.push("Sender: " + sessionSenderLabel(session));
	if (session.workspaceDir) lines.push("Workspace: " + session.workspaceDir);
	if (session.model) lines.push("Model: " + session.model);
	if (session.runtimeProfile) lines.push("Runtime: " + session.runtimeProfile);
	if (session.teachClarification && typeof session.teachClarification === "object") {
		const teach = session.teachClarification;
		lines.push("Teach draft: " + String(teach.draftId || "--"));
		lines.push("Teach status: " + (teach.status === "ready" ? "ready to confirm" : "clarification in progress"));
		if (teach.summary) lines.push("Teach summary: " + teach.summary);
		if (teach.nextQuestion) lines.push("Teach next question: " + teach.nextQuestion);
	}
	if (session.lastRunAt) lines.push("Last run: " + fmtDateTime(session.lastRunAt));
	if (session.lastToolName) {
		lines.push("Last tool: " + session.lastToolName + (session.lastToolRoute ? " (" + humanizeRoute(session.lastToolRoute) + ")" : ""));
	}
	return lines.join("\\n");
}

function channelCapabilityLabels(capabilities) {
	if (!capabilities || typeof capabilities !== "object") return [];
	return Object.entries(capabilities)
		.filter(function(entry) { return entry[1] === true; })
		.map(function(entry) { return entry[0]; })
		.sort();
}

function formatChannelRuntimeHint(channel) {
	const runtime = channel && typeof channel === "object" && channel.runtime && typeof channel.runtime === "object"
		? channel.runtime
		: {};
	const state = String(runtime.state || "").trim().toLowerCase();
	const summary = String(runtime.summary || "").trim();
	const lastError = String(runtime.lastError || "").trim();
	if (state === "awaiting_pairing") {
		return "Action: complete channel pairing or login, then retry.";
	}
	if (state === "reconnecting") {
		return "Action: wait for the adapter to reconnect or inspect the latest transport logs.";
	}
	if (state === "error") {
		if (/token|credential|secret|auth/i.test(summary + " " + lastError)) {
			return "Action: check the channel credentials in config or env, then restart the gateway.";
		}
		return "Action: inspect the adapter error and restart the gateway after fixing it.";
	}
	if (state === "running") {
		return "Ready.";
	}
	return "";
}

function formatChannelsStatusText(rawChannels) {
	const channels = Array.isArray(rawChannels) ? rawChannels : [];
	if (!channels.length) {
		return "No gateway channels are registered.";
	}
	const lines = ["Channels:"];
	channels.forEach(function(channel) {
		const runtime = channel && typeof channel === "object" && channel.runtime && typeof channel.runtime === "object"
			? channel.runtime
			: {};
		const state = String(runtime.state || "unknown");
		const caps = channelCapabilityLabels(channel && channel.capabilities);
		const summary = String(runtime.summary || runtime.lastError || "").trim();
		lines.push("- " + String(channel.id || "channel") + " (" + state + ")" + (caps.length ? " [" + caps.join(", ") + "]" : ""));
		if (summary) {
			lines.push("  " + summary);
		}
		const hint = formatChannelRuntimeHint(channel);
		if (hint) {
			lines.push("  " + hint);
		}
	});
	return lines.join("\\n");
}

function formatSkillsStatusText(status) {
	const value = status && typeof status === "object" ? status : {};
	const names = Array.isArray(value.skills) ? value.skills : [];
	const lines = [
		"Skills loaded: " + String(value.loaded ?? 0) + " / " + String(value.available ?? names.length),
	];
	if (value.workspaceDir) lines.push("Workspace: " + value.workspaceDir);
	if (names.length) lines.push("Skills: " + listNames(names, 10));
	if (value.truncated === true) lines.push("Skill list truncated.");
	return lines.join("\\n");
}

function formatToolsCatalogText(catalog) {
	const value = catalog && typeof catalog === "object" ? catalog : {};
	const tools = Array.isArray(value.tools) ? value.tools : [];
	const summary = value.summary && typeof value.summary === "object" ? value.summary : {};
	const lines = [
		"Tools available: " + tools.length,
	];
	if (summary.total != null) lines.push("Catalog total: " + String(summary.total));
	if (summary.byCategory && typeof summary.byCategory === "object") {
		lines.push("By category: " + Object.entries(summary.byCategory).map(function(entry) {
			return entry[0] + " " + entry[1];
		}).join(", "));
	}
	if (summary.bySurface && typeof summary.bySurface === "object") {
		lines.push("By surface: " + Object.entries(summary.bySurface).map(function(entry) {
			return entry[0] + " " + entry[1];
		}).join(", "));
	}
	if (tools.length) {
		lines.push("Tool names: " + listNames(tools.map(function(tool) {
			return tool && typeof tool === "object"
				? (tool.label || tool.name || tool.id || tool.toolName)
				: "";
		}), 12));
	}
	return lines.join("\\n");
}

function formatConfigSummaryText(config) {
	const value = config && typeof config === "object" ? config : {};
	const lines = [
		"Default model: " + ([value.defaultProvider, value.defaultModel].filter(Boolean).join("/") || "unset"),
	];
	if (value.defaultThinkingLevel) lines.push("Thinking: " + value.defaultThinkingLevel);
	if (value.agent && typeof value.agent === "object") {
		if (value.agent.repoRoot) lines.push("Repo root: " + value.agent.repoRoot);
		if (value.agent.userTimezone) lines.push("Timezone: " + value.agent.userTimezone);
	}
	if (value.gateway && typeof value.gateway === "object") {
		if (value.gateway.host) lines.push("Gateway host: " + value.gateway.host);
		if (value.gateway.port) lines.push("Gateway port: " + value.gateway.port);
	}
	return lines.join("\\n");
}

function formatUsageSummaryText(summary, status, cost) {
	const usage = summary && typeof summary === "object" ? summary : {};
	const usageStatus = status && typeof status === "object" ? status : {};
	const usageCost = cost && typeof cost === "object" ? cost : {};
	const lines = [
		"Usage tracking: " + (usageStatus.tracking ? "enabled" : "disabled"),
		"Records: " + String(usage.recordCount ?? usageStatus.recordCount ?? 0),
		"Tokens: " + String(usage.totalTokens ?? 0),
	];
	if (usage.totalInputTokens != null) lines.push("Input tokens: " + String(usage.totalInputTokens));
	if (usage.totalOutputTokens != null) lines.push("Output tokens: " + String(usage.totalOutputTokens));
	if (usageCost.estimatedCost != null) {
		lines.push("Estimated cost: " + String(usageCost.estimatedCost) + " " + String(usageCost.currency || "USD"));
	}
	return lines.join("\\n");
}

function formatScheduleStatusText(status) {
	const value = status && typeof status === "object" ? status : {};
	const lines = [
		"Schedule: " + ((value.enabled || value.running) ? "active" : "idle"),
	];
	if (value.runCount != null) lines.push("Runs: " + String(value.runCount));
	if (value.storePath) lines.push("Store: " + value.storePath);
	if (value.lastRunAt) lines.push("Last run: " + fmtDateTime(value.lastRunAt));
	if (value.nextRunAt) lines.push("Next run: " + fmtDateTime(value.nextRunAt));
	return lines.join("\\n");
}

function formatPendingAttachmentsText() {
	if (!pendingMedia.length) {
		return "No pending attachments.";
	}
	return [
		"Pending attachments: " + pendingMedia.length,
	].concat(pendingMedia.map(function(item, index) {
		return String(index + 1) + ". " + item.name + " (" + item.mode + ", " + fmtBytes(item.size) + ")";
	})).join("\\n");
}

function buildSessionTreeText(sessionId) {
	const session = findSessionSummary(sessionId);
	if (!session) {
		return "Session tree is only available for sessions loaded in the sidebar.";
	}
	const lineage = [];
	let cursor = session;
	while (cursor) {
		lineage.unshift(cursor);
		cursor = cursor.parentId ? findSessionSummary(cursor.parentId) : null;
	}
	const children = sessionsCache.filter(function(item) { return item.parentId === session.id; });
	const lines = ["Session tree:"];
	lineage.forEach(function(item, index) {
		const prefix = index === lineage.length - 1 ? "> " : "- ";
		lines.push(prefix + sessionTitle(item) + " [" + item.id + "]");
	});
	if (children.length) {
		lines.push("Branches:");
		children.forEach(function(item) {
			lines.push("- " + sessionTitle(item) + " [" + item.id + "]");
		});
	} else {
		lines.push("Branches: none loaded in WebChat.");
	}
	return lines.join("\\n");
}

function humanizeRoute(route) {
	const normalized = String(route || "").trim().toLowerCase();
	if (!normalized) return "Tool";
	if (normalized === "gui") return "GUI";
	if (normalized === "browser") return "Browser";
	if (normalized === "shell") return "Shell";
	return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function toolStateLabel(status) {
	if (status === "ok") return "Done";
	if (status === "error") return "Error";
	return "Running";
}

function runBadgeLabel(status) {
	if (status === "done") return "Done";
	if (status === "error") return "Error";
	return "Working";
}

function shouldRenderRunForCurrentView(data) {
	if (!data || typeof data !== "object") return false;
	if (activeSessionId) return data.sessionId === activeSessionId;
	return isMyLiveRun(data);
}

function ensureRunView(runId, sessionId) {
	const key = String(runId || "");
	if (!key) return null;
	if (liveRunViews.has(key)) return liveRunViews.get(key);
	clearWelcome();
	const root = document.createElement("div");
	root.className = "run-card";
	root.dataset.runId = key;
	root.innerHTML =
		'<div class="run-card-head">' +
			'<span class="run-badge">Working</span>' +
			'<span class="run-title">Understudy is working through this request</span>' +
			'<span class="run-meta">' + esc(fmtTime(Date.now())) + '</span>' +
		'</div>' +
		'<div class="run-summary">Thinking through the task.</div>' +
		'<details class="run-thinking" hidden>' +
			'<summary>Thinking</summary>' +
			'<div class="run-thinking-body"></div>' +
		'</details>' +
		'<div class="run-tools"></div>';
	messagesEl.appendChild(root);
	const view = {
		runId: key,
		sessionId: sessionId || "",
		root: root,
		summaryEl: root.querySelector(".run-summary"),
		badgeEl: root.querySelector(".run-badge"),
		thinkingEl: root.querySelector(".run-thinking"),
		thinkingBodyEl: root.querySelector(".run-thinking-body"),
		toolsEl: root.querySelector(".run-tools"),
		toolCards: new Map(),
		thoughtText: "",
		assistantBubble: null,
		assistantText: "",
	};
	liveRunViews.set(key, view);
	scrollToBottom();
	return view;
}

function updateRunViewSummary(view, summary, status) {
	if (!view) return;
	view.summaryEl.textContent = String(summary || "").trim() || "Thinking through the task.";
	view.badgeEl.textContent = runBadgeLabel(status);
	view.badgeEl.className = "run-badge" + (status === "done" ? " done" : status === "error" ? " error" : "");
}

function appendRunThought(view, delta) {
	if (!view || !delta) return;
	view.thoughtText += delta;
	view.thinkingEl.hidden = false;
	view.thinkingEl.open = true;
	view.thinkingBodyEl.textContent = view.thoughtText;
	scrollToBottom();
}

function ensureRunToolCard(view, data) {
	if (!view) return null;
	const key = String(data.toolCallId || data.toolName || Math.random().toString(36).slice(2));
	if (view.toolCards.has(key)) return view.toolCards.get(key);
	const card = document.createElement("div");
	card.className = "run-tool running";
	card.dataset.toolCallId = key;
	card.innerHTML =
		'<div class="run-tool-head">' +
			'<span class="run-tool-route"></span>' +
			'<span class="run-tool-state">Running</span>' +
			'<span class="run-tool-label"></span>' +
		'</div>' +
		'<div class="run-tool-detail"></div>' +
		'<div class="run-tool-media"></div>';
	view.toolsEl.appendChild(card);
	const toolView = {
		root: card,
		routeEl: card.querySelector(".run-tool-route"),
		stateEl: card.querySelector(".run-tool-state"),
		labelEl: card.querySelector(".run-tool-label"),
		detailEl: card.querySelector(".run-tool-detail"),
		mediaEl: card.querySelector(".run-tool-media"),
	};
	view.toolCards.set(key, toolView);
	return toolView;
}

function normalizeToolImage(raw) {
	if (!raw || typeof raw !== "object") return null;
	if (raw.type && String(raw.type).toLowerCase() !== "image") return null;
	const mimeType = String(raw.mimeType || "").trim();
	const data = String(raw.imageData || raw.data || "").trim();
	if (!mimeType || mimeType.indexOf("image/") !== 0 || !data) return null;
	return { mimeType: mimeType, data: data };
}

function collectToolImages(data) {
	if (!data || typeof data !== "object") return [];
	const candidates = [];
	if (Array.isArray(data.images)) candidates.push.apply(candidates, data.images);
	const result = data.result && typeof data.result === "object" ? data.result : null;
	if (result) {
		if (Array.isArray(result.images)) candidates.push.apply(candidates, result.images);
		if (result.image && typeof result.image === "object") candidates.push(result.image);
		if (Array.isArray(result.content)) candidates.push.apply(candidates, result.content);
	}
	const images = [];
	const seen = new Set();
	candidates.forEach(function(candidate) {
		const image = normalizeToolImage(candidate);
		if (!image) return;
		const key = image.mimeType + ":" + image.data.length + ":" + image.data.slice(0, 32);
		if (seen.has(key)) return;
		seen.add(key);
		images.push(image);
	});
	return images.slice(0, 3);
}

function renderToolImages(toolView, data) {
	if (!toolView || !toolView.mediaEl) return;
	const images = collectToolImages(data);
	toolView.mediaEl.innerHTML = "";
	images.forEach(function(image, index) {
		const img = document.createElement("img");
		img.loading = "lazy";
		img.alt = String(data.toolName || "Tool result") + " image " + (index + 1);
		img.src = "data:" + image.mimeType + ";base64," + image.data;
		toolView.mediaEl.appendChild(img);
	});
}

function toolDetailText(data) {
	if (!data || typeof data !== "object") return "";
	if (data.status === "error") return clampText(data.error, 240);
	const result = data.result && typeof data.result === "object" ? data.result : {};
	const preview = clampText(result.textPreview, 240);
	if (preview) return preview;
	if (collectToolImages(data).length > 0) return data.status === "ok" ? "Captured image." : "";
	return data.status === "ok" ? "Completed." : "";
}

function summarizeStoredToolTrace(toolTrace) {
	const events = Array.isArray(toolTrace) ? toolTrace : [];
	const completed = [];
	const fallback = [];
	for (const raw of events) {
		const event = raw && typeof raw === "object" ? raw : {};
		const toolName = String(event.name || event.toolName || "").trim();
		if (!toolName) continue;
		const route = String(event.route || "").trim();
		const eventType = String(event.type || "").toLowerCase();
			const statusInfo = event.status && typeof event.status === "object"
				? event.status
				: null;
			const detail = clampText(
				event.textPreview ||
				(statusInfo && statusInfo.summary) ||
				event.error,
				240,
			);
		const images = collectToolImages(event);
		const step = {
			toolCallId: String(event.toolCallId || toolName + ":" + completed.length + ":" + fallback.length),
			toolName: toolName,
			route: route,
				summary: clampText(event.summary || toolName, 220) || toolName,
				status:
					event.isError === true || (typeof event.status === "string" && String(event.status || "").toLowerCase() === "error")
						? "error"
						: "ok",
			...(detail
				? {
					result: { textPreview: detail },
						...((typeof event.status === "string" && String(event.status || "").toLowerCase() === "error") || event.isError === true
							? { error: detail }
							: {}),
				}
				: {}),
			...(images.length > 0
				? {
					images: images.map(function(image) {
						return {
							imageData: image.data,
							mimeType: image.mimeType,
						};
					}),
				}
				: {}),
		};
		const isCompleted =
			eventType.includes("result") ||
			eventType.includes("end") ||
			typeof event.textPreview === "string" ||
			typeof event.error === "string" ||
				Boolean(statusInfo);
		if (isCompleted) {
			completed.push(step);
		} else {
			fallback.push(step);
		}
	}
	return completed.length > 0 ? completed : fallback;
}

function buildStoredRunSummary(run, steps) {
	const parts = [];
	if (typeof run.durationMs === "number" && Number.isFinite(run.durationMs)) {
		parts.push(run.durationMs + " ms");
	}
	if (steps.length > 0) {
		parts.push(steps.length + " tool step" + (steps.length === 1 ? "" : "s"));
	}
	const promptPreview = clampText(run.userPromptPreview, 120);
	if (promptPreview) {
		parts.push("Prompt: " + promptPreview);
	}
	return parts.join(" • ") || "Previously recorded run.";
}

function renderStoredRun(run, sessionId) {
	if (!run || typeof run !== "object") return null;
	const runKey = "stored:" + String(run.runId || Date.now());
	const view = ensureRunView(runKey, sessionId);
	if (!view) return null;
	view.root.classList.add("archived");
	const titleEl = view.root.querySelector(".run-title");
	const metaEl = view.root.querySelector(".run-meta");
	if (titleEl) titleEl.textContent = "Latest recorded run";
	if (metaEl) metaEl.textContent = fmtTime(run.recordedAt || Date.now());
	view.thoughtText = String(run.thoughtText || "");
	view.thinkingEl.hidden = !view.thoughtText;
	view.thinkingEl.open = Boolean(view.thoughtText);
	view.thinkingBodyEl.textContent = view.thoughtText;
	view.toolsEl.innerHTML = "";
	view.toolCards = new Map();
	view.assistantText = "";
	view.assistantBubble = null;
	const steps = summarizeStoredToolTrace(run.toolTrace);
	const hasError = steps.some(function(step) { return step.status === "error"; });
	updateRunViewSummary(view, buildStoredRunSummary(run, steps), hasError ? "error" : "done");
	steps.forEach(function(step) {
		updateRunTool(view, step, step.status);
	});
	if (typeof run.assistantText === "string" && run.assistantText.trim()) {
		appendRunAssistantText(view, run.assistantText);
	}
	return view;
}

function progressStepStatus(step) {
	const state = String(step?.state || "").toLowerCase();
	if (state === "done" || state === "ok" || state === "completed") return "ok";
	if (state === "error" || state === "failed") return "error";
	return "running";
}

function renderActiveRunSnapshot(activeRun, sessionId) {
	if (!activeRun || typeof activeRun !== "object" || String(activeRun.status || "").toLowerCase() !== "in_flight") return null;
	const runKey = String(activeRun.runId || ("active:" + String(sessionId || Date.now())));
	const view = ensureRunView(runKey, sessionId);
	if (!view) return null;
	const titleEl = view.root.querySelector(".run-title");
	const metaEl = view.root.querySelector(".run-meta");
	if (titleEl) titleEl.textContent = "Active run";
	if (metaEl) metaEl.textContent = fmtTime(activeRun.updatedAt || activeRun.startedAt || Date.now());
	view.root.classList.remove("archived");
	view.thoughtText = String(activeRun.thoughtText || "");
	view.thinkingEl.hidden = !view.thoughtText;
	view.thinkingEl.open = Boolean(view.thoughtText);
	view.thinkingBodyEl.textContent = view.thoughtText;
	view.toolsEl.innerHTML = "";
	view.toolCards = new Map();
	const steps = Array.isArray(activeRun.steps) ? activeRun.steps : [];
	steps.forEach(function(step, index) {
		if (String(step?.kind || "").toLowerCase() !== "tool" && !step?.toolName) {
			return;
		}
		updateRunTool(view, {
			toolCallId: String(step.id || step.toolName || "step-" + index),
			toolName: String(step.toolName || step.label || "Tool"),
			route: step.route,
			summary: String(step.label || step.toolName || "Tool"),
			...(progressStepStatus(step) === "error"
				? { error: String(step.label || step.toolName || "Tool failed") }
				: {}),
		}, progressStepStatus(step));
	});
	if (typeof activeRun.assistantText === "string" && activeRun.assistantText.length > 0) {
		appendRunAssistantText(view, activeRun.assistantText);
	}
	updateRunViewSummary(
		view,
		String(activeRun.summary || "").trim() || (view.assistantText ? "Reply in progress." : "Thinking through the task."),
		activeRun.status === "error" ? "error" : activeRun.status === "ok" ? "done" : "working",
	);
	return view;
}

function renderHistoryTimeline(timeline, sessionId) {
	const items = Array.isArray(timeline) ? timeline : [];
	items.forEach(function(item) {
		if (!item || typeof item !== "object") return;
		if (item.kind === "run") {
			renderStoredRun(item, sessionId);
			return;
		}
		addMsg(item.role === "user" ? "user" : "assistant", item.text || "", item.timestamp, item);
	});
}

function updateRunTool(view, data, status) {
	const toolView = ensureRunToolCard(view, data);
	if (!toolView) return;
	const summary = clampText(data.summary, 220) || clampText(data.toolName, 80) || "Running tool";
	toolView.routeEl.textContent = humanizeRoute(data.route);
	toolView.labelEl.textContent = summary;
	toolView.stateEl.textContent = toolStateLabel(status);
	toolView.stateEl.className = "run-tool-state" + (status === "ok" ? " done" : status === "error" ? " error" : "");
	toolView.root.className = "run-tool" + (status === "ok" ? "" : status === "error" ? " error" : " running");
	toolView.detailEl.textContent = toolDetailText(Object.assign({}, data, { status: status }));
	renderToolImages(toolView, Object.assign({}, data, { status: status }));
	scrollToBottom();
}

function appendRunAssistantText(view, delta) {
	if (!view || !delta) return;
	if (!view.assistantBubble) {
		view.assistantBubble = addMsg("assistant", "");
	}
	view.assistantText += delta;
	view.assistantBubble.dataset.rawText = view.assistantText;
	const body = view.assistantBubble.querySelector(".msg-body");
	if (body) body.innerHTML = renderMarkdown(view.assistantText);
	scrollToBottom();
}

function finalizeRunView(view, status, errorText) {
	if (!view) return;
	updateRunViewSummary(
		view,
		status === "error" ? (errorText || "The run failed.") : view.assistantText.trim() ? "Response ready." : "Completed.",
		status === "error" ? "error" : "done",
	);
}

/* ── Markdown rendering ── */
function renderMarkdown(text) {
	const src = String(text ?? "");
	if (!src) return "";
	/* code fences */
	const parts = [];
	let cursor = 0;
	const fenceRe = /\`\`\`([a-zA-Z0-9_+\\-]*)\\n?([\\s\\S]*?)\`\`\`/g;
	let m;
	while ((m = fenceRe.exec(src)) !== null) {
		if (m.index > cursor) parts.push({ type: "text", value: src.slice(cursor, m.index) });
		parts.push({ type: "code", lang: m[1], value: m[2].replace(/\\n$/, "") });
		cursor = m.index + m[0].length;
	}
	if (cursor < src.length) parts.push({ type: "text", value: src.slice(cursor) });

	return parts.map(function(p) {
		if (p.type === "code") {
			return '<pre><code>' + esc(p.value) + '</code></pre>';
		}
		/* inline formatting */
		let h = esc(p.value);
		/* inline code */
		h = h.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
		/* bold */
		h = h.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
		/* italic */
		h = h.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
		/* line breaks */
		h = h.replace(/\\n/g, '<br>');
		return '<p>' + h + '</p>';
	}).join("");
}

/* ── RPC ── */
async function rpc(method, params) {
	const res = await fetch(BASE + "/rpc", {
		method: "POST",
		headers: rpcHeaders,
		body: JSON.stringify({ id: Date.now().toString(36), method: method, params: params || {} }),
	});
	const payload = await res.json().catch(function() { return {}; });
	if (!res.ok || payload.error) {
		throw new Error(payload && payload.error && payload.error.message ? payload.error.message : "RPC failed");
	}
	return payload.result;
}

/* ── WebSocket with reconnect ── */
function connectWs() {
	const proto = location.protocol === "https:" ? "wss:" : "ws:";
	const url = new URL(BASE);
	url.protocol = proto;
	if (token) url.searchParams.set("token", token);
	if (clientId) url.searchParams.set("clientId", clientId);

	ws = new WebSocket(url.toString());

	ws.onopen = function() {
		wsConnected = true;
		wsReconnectDelay = WS_RECONNECT_BASE;
		setStatus("ok", "Connected");
		syncComposer();
		loadAll();
	};

	ws.onclose = function() {
		wsConnected = false;
		setStatus("err", "Disconnected");
		syncComposer();
		scheduleReconnect();
	};

	ws.onerror = function() {
		wsConnected = false;
		setStatus("err", "Connection error");
		syncComposer();
	};

	ws.onmessage = function(evt) {
		try {
			const msg = JSON.parse(evt.data);
			if (msg && typeof msg.id === "string" && !msg.type) return; /* RPC response */
			handleWsEvent(msg);
		} catch(e) { /* ignore parse errors */ }
	};
}

function scheduleReconnect() {
	setTimeout(function() {
		if (!wsConnected) {
			wsReconnectDelay = Math.min(wsReconnectDelay * 1.5, WS_RECONNECT_MAX);
			connectWs();
		}
	}, wsReconnectDelay);
}

function handleWsEvent(msg) {
	const type = msg && msg.type || "";
	const data = msg && msg.data && typeof msg.data === "object" ? msg.data : {};

	if (type === "stream_start") {
		if (!shouldRenderRunForCurrentView(data)) return;
		if (data.runId) activeLiveRunIds.add(data.runId);
		ensureRunView(data.runId, data.sessionId);
		updateLiveRunStatus("Thinking through the task.");
		showTyping(false);
		liveAssistantBubble = null;
		liveAssistantText = "";
	} else if (type === "tool_start" || type === "tool_end") {
		if (!shouldRenderRunForCurrentView(data)) return;
		const view = ensureRunView(data.runId, data.sessionId);
		updateRunViewSummary(view, typeof data.summary === "string" ? data.summary : "Working through the task.", "working");
		updateRunTool(view, data, type === "tool_end" ? data.status : "running");
		updateLiveRunStatus(typeof data.summary === "string" ? data.summary : "");
	} else if (type === "status_change") {
		if (!shouldRenderRunForCurrentView(data)) return;
		const view = ensureRunView(data.runId, data.sessionId);
		updateRunViewSummary(view, typeof data.text === "string" ? data.text : "Thinking through the task.", "working");
		updateLiveRunStatus(typeof data.text === "string" ? data.text : "");
	} else if (type === "stream_chunk") {
		if (!shouldRenderRunForCurrentView(data)) return;
		const view = ensureRunView(data.runId, data.sessionId);
		if (data.stream === "thought") {
			appendRunThought(view, data.text || "");
			return;
		}
		showTyping(false);
		appendRunAssistantText(view, data.text || "");
	} else if (type === "stream_end") {
		if (!shouldRenderRunForCurrentView(data)) return;
		const view = ensureRunView(data.runId, data.sessionId);
		if (data.status === "ok" && data.text && !view.assistantText) {
			appendRunAssistantText(view, data.text);
		}
		if (data.runId) activeLiveRunIds.delete(data.runId);
		finalizeRunView(view, data.status, data.error);
		updateLiveRunStatus("");
		showTyping(false);
		liveAssistantBubble = null;
		liveAssistantText = "";
		sendPending = activeLiveRunIds.size > 0;
		syncComposer();
		if (data.status === "error" && data.error) addMsg("error", data.error);
		if (activeSessionId) {
			refreshSessions().then(function() { return selectSession(activeSessionId); }).catch(function() {});
		} else {
			refreshSessions();
		}
	} else if (type === "exec.approval.requested") {
		if (!shouldRenderRunForCurrentView(data)) return;
		if (data.runId) activeLiveRunIds.delete(data.runId);
		sendPending = activeLiveRunIds.size > 0;
		updateLiveRunStatus(typeof data.text === "string" ? data.text : "Approval required.");
		addMsg("system", typeof data.text === "string" ? data.text : "Approval required.", msg.timestamp, data);
		syncComposer();
	} else if (type === "exec.approval.resolved") {
		if (!shouldRenderRunForCurrentView(data)) return;
		const decision = typeof data.decision === "string" ? data.decision : "";
		if (data.runId && (decision === "allow-once" || decision === "allow-always")) {
			activeLiveRunIds.add(data.runId);
		}
		sendPending = activeLiveRunIds.size > 0;
		updateLiveRunStatus(typeof data.text === "string" ? data.text : "");
		addMsg("system", typeof data.text === "string" ? data.text : "Approval updated.", msg.timestamp, data);
		syncComposer();
	} else if (type === "message") {
		if (shouldRenderRunForCurrentView(data) && !activeSessionId) {
			updateLiveRunStatus("");
			showTyping(false);
			addMsg("assistant", data.text || "", msg.timestamp, data);
			refreshSessions();
		}
	} else if (type === "error") {
		if (shouldRenderRunForCurrentView(data)) {
			const view = ensureRunView(data.runId, data.sessionId);
			finalizeRunView(view, "error", data.error || "Unknown error");
			updateLiveRunStatus("");
			showTyping(false);
			sendPending = false;
			addMsg("error", data.error || "Unknown error");
			syncComposer();
		}
	}
}

function isMyLiveRun(data) {
	if (!data) return false;
	if (typeof data.runId === "string" && activeLiveRunIds.has(data.runId)) return true;
	return data.channelId === LIVE_CHANNEL && data.senderId === clientId;
}

/* ── Status display ── */
function setStatus(kind, label) {
	statusDot.className = "status-dot " + kind;
	statusText.textContent = label;
	chipConn.textContent = "WS: " + label;
}

/* ── Messages ── */
function clearWelcome() {
	if (welcomeView && welcomeView.parentNode) welcomeView.remove();
}

function normalizeMessageImage(raw) {
	if (!raw || typeof raw !== "object") return null;
	if (raw.type && String(raw.type).toLowerCase() !== "image") return null;
	const mimeType = String(raw.mimeType || "").trim();
	const data = String(raw.data || raw.imageData || "").trim();
	if (!mimeType || mimeType.indexOf("image/") !== 0 || !data) return null;
	return { mimeType: mimeType, data: data };
}

function collectMessageImages(data) {
	if (!data || typeof data !== "object") return [];
	const images = [];
	const seen = new Set();
	const directImages = Array.isArray(data.images) ? data.images : [];
	const attachmentImages = Array.isArray(data.attachments)
		? data.attachments
			.filter(function(attachment) {
				return attachment && typeof attachment === "object" && String(attachment.type || "").toLowerCase() === "image";
			})
		: [];
	directImages.concat(attachmentImages).forEach(function(candidate) {
		const image = normalizeMessageImage(candidate);
		if (!image) return;
		const key = image.mimeType + ":" + image.data.length + ":" + image.data.slice(0, 32);
		if (seen.has(key)) return;
		seen.add(key);
		images.push(image);
	});
	return images.slice(0, 6);
}

function collectMessageAttachments(data) {
	if (!data || typeof data !== "object" || !Array.isArray(data.attachments)) return [];
	return data.attachments
		.filter(function(candidate) {
			return candidate && typeof candidate === "object" && typeof candidate.url === "string" && typeof candidate.type === "string";
		})
		.map(function(candidate) {
			return {
				type: String(candidate.type || "file"),
				url: String(candidate.url || ""),
				name: String(candidate.name || "") || String(candidate.url || ""),
				mimeType: String(candidate.mimeType || ""),
			};
		})
		.filter(function(candidate) { return candidate.url; })
		.slice(0, 8);
}

function assistantResultText(result) {
	const text = String(result?.response || "");
	return text || (collectMessageImages(result).length > 0 || collectMessageAttachments(result).length > 0
		? ""
		: "(no response)");
}

function renderMessageMedia(container, data) {
	if (!container) return;
	container.innerHTML = "";
	const images = collectMessageImages(data);
	const attachments = collectMessageAttachments(data).filter(function(attachment) {
		return attachment.type !== "image" || images.length === 0;
	});
	if (images.length > 0) {
		const imagesEl = document.createElement("div");
		imagesEl.className = "msg-images";
		images.forEach(function(image, index) {
			const img = document.createElement("img");
			img.loading = "lazy";
			img.alt = "Message image " + (index + 1);
			img.src = "data:" + image.mimeType + ";base64," + image.data;
			imagesEl.appendChild(img);
		});
		container.appendChild(imagesEl);
	}
	if (attachments.length > 0) {
		const attachmentsEl = document.createElement("div");
		attachmentsEl.className = "msg-attachments";
		attachments.forEach(function(attachment) {
			const chip = document.createElement("span");
			chip.className = "msg-attachment";
			chip.textContent = attachment.name || attachment.url || attachment.type;
			attachmentsEl.appendChild(chip);
		});
		container.appendChild(attachmentsEl);
	}
}

function addMsg(role, text, timestamp, options) {
	clearWelcome();
	const el = document.createElement("div");
	el.className = "msg " + role;
	el.dataset.rawText = String(text ?? "");
	const timeStr = fmtTime(timestamp);
	el.innerHTML =
		'<div class="msg-body"></div>' +
		'<div class="msg-media"></div>' +
		'<div class="msg-time">' + esc(timeStr) + '</div>';
	const body = el.querySelector(".msg-body");
	if (body) {
		body.innerHTML = String(text || "").trim() ? renderMarkdown(text) : "";
	}
	renderMessageMedia(el.querySelector(".msg-media"), options);
	messagesEl.appendChild(el);
	scrollToBottom();
	return el;
}

function scrollToBottom() {
	messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showTyping(show) {
	if (show) scrollToBottom();
}

function clearChat() {
	messagesEl.innerHTML = "";
	liveAssistantBubble = null;
	liveAssistantText = "";
	liveRunViews.clear();
}

/* ── Header ── */
function setChatHeader(title, meta, session) {
	chatTitle.textContent = title;
	if (session && typeof session === "object") {
		chatMeta.innerHTML = renderSessionHeaderMeta(meta, session);
		return;
	}
	chatMeta.textContent = meta;
}

function updateLiveRunStatus(text) {
	liveRunStatusText = typeof text === "string" ? text.trim() : "";
	if (!activeSessionId) {
		chatMeta.textContent = liveRunStatusText || "Send a message to start a fresh request or pick a saved session";
	}
}

/* ── Composer ── */
function syncComposer() {
	const currentSession = currentSessionSummary();
	const readOnlySession = Boolean(activeSessionId && currentSession && !isSessionWritable(currentSession));
	const canSend = activeSessionId
		? Boolean(currentSession && isSessionWritable(currentSession))
		: Boolean(wsConnected && clientId);
	sendBtn.disabled = sendPending || !canSend;
	composerHint.textContent = sendPending
		? "Waiting for Understudy to finish the current run..."
		: readOnlySession
			? "Read-only session view. Use Overview or one of your WebChat sessions to continue."
		: currentSession?.teachClarification?.status === "ready"
			? "Teach draft " + String(currentSession.teachClarification.draftId || "").trim() + " is ready. Run /teach confirm when it looks right, then /teach publish <draftId>. Optional: /teach confirm --validate or /teach validate <draftId> first."
		: currentSession?.teachClarification
			? "Teach draft " + String(currentSession.teachClarification.draftId || "").trim() + " is waiting for clarification. Reply in plain language or run /teach confirm when it looks right."
		: activeSessionId
			? "Sending to session " + (sessionTitle(currentSession || activeSessionId) || activeSessionId)
			: "Enter to send, Shift+Enter for new line";
}

function autoResize() {
	msgInput.style.height = "auto";
	msgInput.style.height = Math.min(msgInput.scrollHeight, 160) + "px";
}

/* ── Slash command menu ── */
function allCommands() {
	return builtinCommands.concat(discoveredCommands);
}

function showSlashMenu(filter) {
	const q = filter.toLowerCase();
	const matches = allCommands().filter(function(c) {
		return c.cmd.toLowerCase().includes(q) || (c.desc && c.desc.toLowerCase().includes(q));
	});
	if (matches.length === 0) {
		hideSlashMenu();
		return;
	}
	slashIndex = 0;
	slashMenu.innerHTML = matches.map(function(c, i) {
		return '<div class="slash-item' + (i === 0 ? ' active' : '') + '" data-cmd="' + esc(c.cmd) + '">' +
			'<span class="slash-cmd">' + esc(c.cmd) + '</span>' +
			(c.desc ? '<span class="slash-desc">' + esc(c.desc) + '</span>' : '') +
			'</div>';
	}).join("");
	slashMenu.classList.add("visible");
	slashVisible = true;
}

function hideSlashMenu() {
	slashMenu.classList.remove("visible");
	slashVisible = false;
	slashIndex = -1;
}

function selectSlashItem(cmd) {
	msgInput.value = cmd + " ";
	hideSlashMenu();
	msgInput.focus();
	autoResize();
}

function navigateSlash(dir) {
	const items = slashMenu.querySelectorAll(".slash-item");
	if (!items.length) return;
	items[slashIndex]?.classList.remove("active");
	slashIndex = (slashIndex + dir + items.length) % items.length;
	items[slashIndex]?.classList.add("active");
	items[slashIndex]?.scrollIntoView({ block: "nearest" });
}

/* ── Media handling ── */
const textExts = new Set(["txt","md","json","yaml","yml","xml","html","css","js","ts","tsx","py","rb","go","rs","java","sh","sql","csv","toml","log","conf"]);

function classifyFile(f) {
	const t = (f.type || "").toLowerCase();
	if (t.startsWith("image/")) return "image";
	if (t.startsWith("audio/")) return "audio";
	if (t.startsWith("video/")) return "video";
	return "file";
}

function isTextFile(f) {
	const t = (f.type || "").toLowerCase();
	if (t.startsWith("text/") || t === "application/json" || t === "application/xml" || t === "application/javascript") return true;
	const ext = (f.name || "").split(".").pop()?.toLowerCase() || "";
	return textExts.has(ext);
}

function readAsDataUrl(f) {
	return new Promise(function(resolve, reject) {
		const r = new FileReader();
		r.onerror = function() { reject(new Error("Failed to read file")); };
		r.onload = function() { resolve(r.result); };
		r.readAsDataURL(f);
	});
}

async function processFile(f) {
	const kind = classifyFile(f);
	const id = Date.now() + "_" + Math.random().toString(36).slice(2);
	const base = { id: id, name: f.name || "file", size: f.size || 0, mimeType: f.type || "application/octet-stream", kind: kind };

	if (kind === "image") {
		const url = await readAsDataUrl(f);
		const parts = url.split(",", 2);
		return Object.assign(base, {
			mode: "image",
			promptText: '<file name="' + base.name + '"></file>\\n',
			image: { type: "image", data: parts[1] || "", mimeType: base.mimeType }
		});
	}
	if (isTextFile(f)) {
		const txt = await f.text();
		const clamped = txt.length > 200000 ? txt.slice(0, 200000) : txt;
		return Object.assign(base, {
			mode: "inline_text",
			promptText: '<file name="' + base.name + '">\\n' + clamped + '\\n</file>\\n'
		});
	}
	return Object.assign(base, {
		mode: "attachment",
		attachment: { type: kind, url: "upload://" + encodeURIComponent(base.name), name: base.name, mimeType: base.mimeType, size: base.size }
	});
}

function renderMediaStrip() {
	if (!pendingMedia.length) {
		mediaStrip.innerHTML = "";
		return;
	}
	mediaStrip.innerHTML = pendingMedia.map(function(m) {
		return '<span class="media-tag" data-mid="' + esc(m.id) + '">' +
			esc(m.name) + ' (' + fmtBytes(m.size) + ')' +
			'<button data-remove="' + esc(m.id) + '" type="button">&times;</button>' +
			'</span>';
	}).join("");
}

function buildMediaPayload(text) {
	const segs = pendingMedia.map(function(m) { return m.promptText || ""; }).filter(Boolean);
	return {
		text: segs.join("") + (text || ""),
		images: pendingMedia.map(function(m) { return m.image; }).filter(Boolean),
		attachments: pendingMedia.map(function(m) { return m.attachment; }).filter(Boolean)
	};
}

function buildOutgoingMessagePreviewText(text, payload) {
	const trimmed = String(text || "").trim();
	if (trimmed) return text;
	if (Array.isArray(payload?.attachments) && payload.attachments.length > 0) {
		return "Attached " + payload.attachments.length + " file" + (payload.attachments.length === 1 ? "" : "s");
	}
	return "";
}

function clearMedia() {
	pendingMedia = [];
	fileInput.value = "";
	renderMediaStrip();
}

/* ── Data loading ── */
async function loadAll() {
	try {
		await Promise.all([refreshHealth(), loadDiscovery(), refreshSessions()]);
		discoverSlashCommands();
	} catch(e) {
		setStatus("err", "Load error");
	}
}

async function refreshHealth() {
	try {
		const h = await fetch(BASE + "/health", { headers: rpcHeaders }).then(function(r) { return r.json(); });
		gatewayHealth = h;
		chipAuth.textContent = "Auth: " + (h.auth?.mode || "none");
		chipChannels.textContent = "Channels: " + (Array.isArray(h.channels) ? h.channels.length : 0);
		statusModel.textContent = "Model: " + (
			currentConfig
				? [currentConfig.defaultProvider, currentConfig.defaultModel].filter(Boolean).join("/")
				: "--"
		);
	} catch(e) {
		chipAuth.textContent = "Auth: --";
	}
}

async function loadDiscovery() {
	const results = await Promise.allSettled([
		rpc("config.get"),
		rpc("models.list"),
		rpc("capabilities.get"),
		rpc("tools.catalog"),
		rpc("skills.status"),
	]);

	currentConfig = results[0].status === "fulfilled" ? (results[0].value || {}) : {};
	const modelResult = results[1].status === "fulfilled" ? results[1].value : null;
	modelsCache = Array.isArray(modelResult?.models) ? modelResult.models : [];
	gatewayCapabilities = results[2].status === "fulfilled" ? (results[2].value || null) : null;
	const toolsResult = results[3].status === "fulfilled" ? (results[3].value || {}) : {};
	const toolCatalog = Array.isArray(toolsResult?.tools) ? toolsResult.tools : [];
	const skillsResult = results[4].status === "fulfilled" ? (results[4].value || {}) : {};
	toolsCache = toolCatalog;
	skillsStatusCache = skillsResult;

	chipTools.textContent = "Tools: " + toolCatalog.length;
	statusModel.textContent = "Model: " + ([currentConfig.defaultProvider, currentConfig.defaultModel].filter(Boolean).join("/") || "--");

	/* Update model selector */
	modelSelect.innerHTML = modelsCache.map(function(m) {
		const v = [m.provider, m.id].filter(Boolean).join("/");
		return '<option value="' + esc(v) + '">' + esc(v) + '</option>';
	}).join("") || '<option value="">No models</option>';

	const currentLabel = [currentConfig.defaultProvider, currentConfig.defaultModel].filter(Boolean).join("/");
	if (currentLabel) modelSelect.value = currentLabel;
}

function discoverSlashCommands() {
	discoveredCommands = [];
}

async function refreshSessions() {
	if (!clientId) return;
	try {
		const params = showAllSessions
			? { includePersisted: true }
			: { channelId: LIVE_CHANNEL, senderId: clientId, includePersisted: true };
		const result = await rpc("session.list", params);
		sessionsCache = Array.isArray(result)
			? result.sort(function(a, b) { return (b.lastActiveAt || 0) - (a.lastActiveAt || 0); })
			: [];
	} catch(e) {
		sessionsCache = [];
	}
	refreshSessionScopeButton();
	renderSessionList();
}

async function toggleSessionScope() {
	showAllSessions = !showAllSessions;
	persistSessionScope();
	refreshSessionScopeButton();
	await refreshSessions();
	if (activeSessionId) {
		if (findSessionSummary(activeSessionId)) {
			await selectSession(activeSessionId);
		} else {
			await enterLiveMode();
			addMsg("system", "The previously selected session is outside the current scope.");
		}
		return;
	}
	syncComposer();
}

function renderSessionList() {
	const q = (sessionFilter.value || "").trim().toLowerCase();
	let items = sessionsCache;
	if (q) {
		items = items.filter(function(s) {
			return sessionSearchText(s).includes(q);
		});
	}
	if (!items.length) {
		sessionList.innerHTML = '<div style="padding:20px;text-align:center;font-size:13px;color:var(--text-secondary)">' +
			(sessionsCache.length ? "No matching sessions" : "No sessions yet") + '</div>';
		return;
	}
	sessionList.innerHTML = items.map(function(s) {
		const active = s.id === activeSessionId ? " active" : "";
		const title = sessionTitle(s) || s.id;
		const writable = isSessionWritable(s);
		const badgeRow = renderSessionBadgeRow(s, {
			forceChannel: showAllSessions || !writable,
			includeSender: showAllSessions || !writable,
			includeReadOnly: !writable,
		});
		const metaBits = [];
		if (sessionDisplayName(s)) metaBits.push(s.id);
		if (s.model) metaBits.push(s.model);
		metaBits.push((s.messageCount || 0) + " msgs");
		metaBits.push(fmtRelative(s.lastActiveAt));
		return '<div class="session-item' + active + '" data-sid="' + esc(s.id) + '">' +
			'<span class="session-name">' + esc(title) + '</span>' +
			badgeRow +
			'<span class="session-meta">' + esc(metaBits.join(" • ")) + '</span>' +
			(writable
				? '<span class="session-actions">' +
					'<button class="session-del" data-del-sid="' + esc(s.id) + '" type="button" title="Delete session">Delete</button>' +
				'</span>'
				: '') +
			'</div>';
	}).join("");
}

/* ── Session actions ── */
async function enterLiveMode() {
	sessionViewRequestVersion += 1;
	activeSessionId = "";
	liveRunStatusText = "";
	setChatHeader("Overview Chat", "Send a fresh message or pick a saved session on the left");
	clearChat();
	renderSessionList();
	syncComposer();
}

async function selectSession(sid) {
	const requestVersion = ++sessionViewRequestVersion;
	activeSessionId = sid;
	liveRunStatusText = "";
	const summary = findSessionSummary(sid);
	const title = sessionTitle(summary || sid);
	setChatHeader(
		"Session " + title,
		sessionSubtitle(summary, sid),
		summary,
	);
	clearChat();
	renderSessionList();
	syncComposer();
	try {
		const [historyResult, traceResult] = await Promise.all([
			rpc("session.history", { sessionId: sid, limit: 100 }),
			rpc("session.trace", { sessionId: sid, limit: 8 }),
		]);
		if (requestVersion !== sessionViewRequestVersion || activeSessionId !== sid) {
			return;
		}
		const msgs = Array.isArray(historyResult?.messages) ? historyResult.messages : [];
		const timeline = Array.isArray(historyResult?.timeline) ? historyResult.timeline : [];
		const runs = Array.isArray(traceResult?.runs) ? traceResult.runs : [];
		const activeRun =
			traceResult?.activeRun &&
			typeof traceResult.activeRun === "object" &&
			String(traceResult.activeRun.status || "").toLowerCase() === "in_flight"
				? traceResult.activeRun
				: null;
		if (timeline.length > 0) {
			renderHistoryTimeline(timeline, sid);
		} else if (activeRun) {
			if (runs.length > 0) {
				renderStoredRun(runs[0], sid);
			}
		} else if (runs.length > 0) {
			renderStoredRun(runs[0], sid);
		}
		if (activeRun) {
			renderActiveRunSnapshot(activeRun, sid);
		}
		if (!msgs.length && !timeline.length) {
			if (!runs.length && !activeRun) {
				addMsg("system", "This session has no messages yet.");
			}
			return;
		}
		if (!timeline.length) {
			msgs.forEach(function(m) {
				addMsg(m.role === "user" ? "user" : "assistant", m.text || "", m.timestamp, m);
			});
		}
	} catch(e) {
		if (requestVersion !== sessionViewRequestVersion || activeSessionId !== sid) {
			return;
		}
		addMsg("error", "Failed to load history: " + (e.message || e));
	}
}

async function deleteSession(sid) {
	const summary = findSessionSummary(sid);
	if (summary && !isSessionWritable(summary)) {
		addMsg("error", "This session is read-only in WebChat and cannot be deleted here.");
		return;
	}
	try {
		const result = await rpc("session.delete", { sessionId: sid });
		if (result?.deleted !== true) {
			addMsg("error", "Session " + sid + " could not be deleted.");
			return;
		}
		addMsg("system", "Session " + sid + " deleted.");
		if (activeSessionId === sid) {
			await enterLiveMode();
		}
		await refreshSessions();
	} catch(e) {
		addMsg("error", "Delete failed: " + (e.message || e));
	}
}

async function createNewSession() {
	if (!clientId) { addMsg("error", "Client not ready"); return; }
	try {
		const created = await rpc("session.create", {
			channelId: LIVE_CHANNEL,
			senderId: clientId,
			forceNew: true,
			executionScopeKey: "webchat:" + clientId + ":" + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)),
		});
		if (created?.id) {
			await refreshSessions();
			await selectSession(created.id);
		}
	} catch(e) {
		addMsg("error", "Failed to create session: " + (e.message || e));
	}
}

async function reloadWebChatData() {
	await Promise.all([refreshHealth(), loadDiscovery(), refreshSessions()]);
	discoverSlashCommands();
	if (activeSessionId) {
		await selectSession(activeSessionId);
	} else {
		syncComposer();
	}
}

async function exportActiveSession() {
	if (!activeSessionId) {
		throw new Error("No session selected.");
	}
	const sessionId = activeSessionId;
	const results = await Promise.all([
		rpc("session.get", { sessionId: sessionId }),
		rpc("session.history", { sessionId: sessionId, limit: 200 }),
		rpc("session.trace", { sessionId: sessionId, limit: 8 }),
	]);
	const session = results[0] || { id: sessionId };
	const historyResult = results[1] || {};
	const traceResult = results[2] || {};
	const messages = Array.isArray(historyResult.messages) ? historyResult.messages : [];
	const runs = Array.isArray(traceResult.runs) ? traceResult.runs : [];
	const lines = [
		"# " + (sessionTitle(session) || sessionId),
		"",
		"Session ID: " + sessionId,
		"Exported: " + fmtDateTime(Date.now()),
		"Messages: " + messages.length,
		"",
	];
	if (runs.length > 0) {
		const steps = summarizeStoredToolTrace(runs[0].toolTrace);
		lines.push("Latest recorded run: " + buildStoredRunSummary(runs[0], steps));
		if (steps.length > 0) {
			lines.push("");
			lines.push("Tool steps:");
			steps.forEach(function(step, index) {
				lines.push(String(index + 1) + ". " + (step.summary || step.toolName || "Tool") + " [" + toolStateLabel(step.status) + "]");
			});
		}
		lines.push("");
	}
	messages.forEach(function(message, index) {
		lines.push((message.role === "user" ? "User" : "Assistant") + " " + String(index + 1));
		lines.push(String(message.text || ""));
		lines.push("");
	});
	const filename = sanitizeFilename(sessionTitle(session) || sessionId) + ".md";
	downloadTextFile(filename, lines.join("\\n"));
	return filename;
}

/* ── Slash command execution ── */
async function handleSlash(text) {
	const t = text.trim();
	const lower = t.toLowerCase();
	const currentSessionId = activeSessionId;

	if (t === "/new" || t.startsWith("/new ")) {
		await createNewSession();
		const followUp = t.slice(4).trim();
		if (followUp) await sendText(followUp);
		return true;
	}

	if (t === "/resume" || t.startsWith("/resume ")) {
		if (!sessionsCache.length) {
			await refreshSessions();
		}
		const query = t.slice(7).trim();
		if (query === "list") {
			const matches = listSessionMatches("", 10);
			if (!matches.length) {
				addMsg("system", "No saved sessions are available yet.");
				return true;
			}
			addMsg("system", [
				"Recent sessions:",
			].concat(matches.map(function(session, index) {
				return String(index + 1) + ". " + sessionTitle(session) + " [" + session.id + "]";
			})).join("\\n"));
			return true;
		}
		const target = findSessionByQuery(query || "latest");
		if (!target) {
			addMsg("error", query
				? 'No session matched "' + query + '".'
				: "No saved sessions are available yet.");
			return true;
		}
		await selectSession(target.id);
		return true;
	}

	if (t === "/live") { await enterLiveMode(); return true; }
	if (t === "/clear") { clearChat(); return true; }
	if (t === "/help") {
		const cmds = allCommands();
		const helpText = cmds.map(function(c) { return c.cmd + " - " + (c.desc || ""); }).join("\\n");
		addMsg("system", "Available commands:\\n" + helpText);
		return true;
	}
	if (t === "/channels") {
		try {
			var channels = await fetch(BASE + "/channels", { headers: rpcHeaders }).then(function(r) { return r.json(); });
			addMsg("system", formatChannelsSummaryText(channels));
		} catch(e) { addMsg("error", e.message || String(e)); }
		return true;
	}
	if (t === "/health") {
		try {
			const h = await fetch(BASE + "/health", { headers: rpcHeaders }).then(function(r) { return r.json(); });
			const info = [
				"Status: " + (h.status || "unknown"),
				"Uptime: " + fmtUptime(h.uptime || 0),
				"Auth: " + (h.auth?.mode || "none"),
				"Channels: " + (Array.isArray(h.channels) ? h.channels.join(", ") : "none"),
				"Heap: " + fmtBytes(h.memory?.heapUsed) + " / " + fmtBytes(h.memory?.heapTotal),
			].join("\\n");
			addMsg("system", info);
		} catch(e) { addMsg("error", e.message || String(e)); }
		return true;
	}

	if (t === "/attach" || t.startsWith("/attach ")) {
		const rest = t.slice(7).trim();
		if (rest) {
			addMsg("system", "WebChat cannot attach files by path. Use /attach with no arguments or click the paperclip button.");
			return true;
		}
		fileInput.click();
		addMsg("system", "Choose files in the browser picker to attach them to the next message.");
		return true;
	}

	if (t === "/attachments") {
		addMsg("system", formatPendingAttachmentsText());
		return true;
	}

	if (t === "/detach" || t.startsWith("/detach ")) {
		const rest = t.slice(7).trim().toLowerCase();
		if (!pendingMedia.length) {
			addMsg("system", "No pending attachments.");
			return true;
		}
		if (!rest) {
			const count = pendingMedia.length;
			clearMedia();
			syncComposer();
			addMsg("system", "Cleared " + count + " pending attachment" + (count === 1 ? "" : "s") + ".");
			return true;
		}
		const before = pendingMedia.length;
		pendingMedia = pendingMedia.filter(function(item) {
			return !String(item.id || "").toLowerCase().includes(rest)
				&& !String(item.name || "").toLowerCase().includes(rest);
		});
		renderMediaStrip();
		syncComposer();
		const removed = before - pendingMedia.length;
		addMsg("system", removed > 0
			? "Detached " + removed + " attachment" + (removed === 1 ? "" : "s") + "."
			: 'No pending attachment matched "' + rest + '".');
		return true;
	}

	/* Session management */
	if (t === "/session delete" || t.startsWith("/session delete ")) {
		const sid = t.slice("/session delete".length).trim() || activeSessionId;
		if (!sid) { addMsg("error", "No session selected. Use /session delete <id> or select a session first."); return true; }
		await deleteSession(sid);
		return true;
	}
	if (t === "/session compact" || t.startsWith("/session compact ") || t === "/compact" || t.startsWith("/compact ")) {
		if (!activeSessionId) { addMsg("error", "No session selected."); return true; }
		const compactRest = t.startsWith("/session compact")
			? t.slice("/session compact".length).trim()
			: t.slice(8).trim();
		try {
			await rpc("session.compact", { sessionId: activeSessionId });
			addMsg("system", "Session " + sessionTitle(currentSessionSummary() || activeSessionId) + " compacted." + (compactRest ? " WebChat ignores custom compact instructions for now." : ""));
			await selectSession(activeSessionId);
		} catch(e) { addMsg("error", e.message || String(e)); }
		return true;
	}
	if (t === "/session branch" || t.startsWith("/session branch ") || t === "/fork" || t.startsWith("/fork ")) {
		if (!activeSessionId) { addMsg("error", "No session selected."); return true; }
		const requestedBranchId = t.startsWith("/session branch")
			? t.slice("/session branch".length).trim()
			: t.slice(5).trim();
		try {
			const result = await rpc("session.branch", Object.assign(
				{ sessionId: activeSessionId },
				requestedBranchId ? { branchId: requestedBranchId } : {},
			));
			const newId = result?.id || result?.sessionId;
			if (newId) {
				addMsg("system", "Branched to new session: " + newId);
				await refreshSessions();
				await selectSession(newId);
			} else {
				addMsg("system", "Branch created.");
				await refreshSessions();
			}
		} catch(e) { addMsg("error", e.message || String(e)); }
		return true;
	}
	if (t === "/session" || t.startsWith("/session ")) {
		const rest = t.slice(8).trim();
		const requested = rest || activeSessionId;
		if (!requested) {
			addMsg("error", "No session selected.");
			return true;
		}
		const summary = findSessionByQuery(requested);
		try {
			const detail = await rpc("session.get", { sessionId: summary?.id || requested });
			if (!detail) {
				addMsg("error", "Session not found.");
				return true;
			}
			addMsg("system", formatSessionSummaryText(detail));
		} catch(e) {
			addMsg("error", e.message || String(e));
		}
		return true;
	}
	if (t === "/name" || t.startsWith("/name ")) {
		if (!activeSessionId) {
			addMsg("error", "No session selected.");
			return true;
		}
		const rest = t.slice(5).trim();
		if (!rest) {
			const summary = currentSessionSummary();
			addMsg("system", "Current session name: " + (sessionDisplayName(summary) || "(unset)") + "\\nId: " + activeSessionId);
			return true;
		}
		const clearName = lower === "/name clear" || lower === "/name unset" || t === "/name -";
		try {
			const updated = await rpc("session.patch", {
				sessionId: activeSessionId,
				sessionName: clearName ? "" : rest,
			});
			await refreshSessions();
			const summary = findSessionSummary(activeSessionId) || updated || { id: activeSessionId };
			setChatHeader(
				"Session " + (sessionTitle(summary) || activeSessionId),
				sessionSubtitle(summary, activeSessionId),
			);
			syncComposer();
			addMsg("system", clearName
				? "Cleared the session display name."
				: 'Session renamed to "' + (sessionTitle(summary) || rest) + '".');
		} catch(e) {
			addMsg("error", e.message || String(e));
		}
		return true;
	}
	if (t === "/reset" || t.startsWith("/reset ")) {
		const payload = buildMediaPayload(t);
		const targetSessionId = activeSessionId;
		const params = targetSessionId
			? { sessionId: targetSessionId, message: payload.text }
			: { channelId: LIVE_CHANNEL, senderId: clientId, message: payload.text };
		if (payload.images.length) params.images = payload.images;
		if (payload.attachments.length) params.attachments = payload.attachments;
		try {
			const result = await rpc("session.send", params);
			if (!targetSessionId || activeSessionId === targetSessionId) {
				addMsg("assistant", assistantResultText(result), undefined, result);
			}
			clearMedia();
			if (result?.sessionId && result.sessionId !== targetSessionId) {
				await selectSession(result.sessionId);
			} else if (targetSessionId && activeSessionId === targetSessionId) {
				await selectSession(targetSessionId);
			}
			await refreshSessions();
		} catch(e) {
			if (!targetSessionId || activeSessionId === targetSessionId) {
				addMsg("error", e.message || String(e));
			}
		}
		return true;
	}
	if (t === "/copy") {
		try {
			await copyTextToClipboard(lastAssistantText());
			addMsg("system", "Copied the latest assistant reply.");
		} catch(e) {
			addMsg("error", e.message || String(e));
		}
		return true;
	}
	if (t.startsWith("/model")) {
		const rest = t.slice(6).trim();
		if (!rest || rest === "status") {
			const label = currentConfig
				? [currentConfig.defaultProvider, currentConfig.defaultModel].filter(Boolean).join("/") || "unset"
				: "unknown";
			addMsg("system", "Current model: " + label);
		} else {
			try { await setModel(rest); } catch(e) { addMsg("error", e.message || String(e)); }
		}
		return true;
	}

	if (t === "/settings") {
		modelModal.classList.add("visible");
		addMsg("system", "WebChat settings currently expose model selection. You can also click the Model badge in the status bar to switch models quickly.");
		return true;
	}

	if (t === "/reload") {
		try {
			await reloadWebChatData();
			addMsg("system", "Reloaded WebChat health, discovery, and session state.");
		} catch(e) {
			addMsg("error", e.message || String(e));
		}
		return true;
	}

	if (t === "/hotkeys") {
		addMsg("system", [
			"WebChat shortcuts:",
			"Enter sends the current message.",
			"Shift+Enter inserts a new line.",
			"Ctrl/Cmd+K focuses the session filter.",
			"Ctrl/Cmd+, opens the model picker.",
			"Type / at the start of the composer to open slash command suggestions.",
			"Esc closes the slash command menu.",
			"Click the Model badge in the status bar to open the model picker.",
			"Use the session list on the left to jump between saved runs; the Mine/All toggle changes scope.",
			"Teach flow: /teach start -> /teach stop -> refine in chat -> /teach confirm.",
		].join("\\n"));
		return true;
	}

	if (t === "/skills") {
		try {
			const status = await rpc("skills.status");
			skillsStatusCache = status || {};
			addMsg("system", formatSkillsStatusText(skillsStatusCache));
		} catch(e) {
			addMsg("error", e.message || String(e));
		}
		return true;
	}

	if (t === "/tools") {
		try {
			const catalog = await rpc("tools.catalog");
			toolsCache = Array.isArray(catalog?.tools) ? catalog.tools : [];
			addMsg("system", formatToolsCatalogText(catalog));
		} catch(e) {
			addMsg("error", e.message || String(e));
		}
		return true;
	}

	if (t === "/channels" || t.startsWith("/channels ")) {
		const requested = t.slice("/channels".length).trim();
		try {
			if (requested) {
				addMsg("system", formatChannelsStatusText([await rpc("channel.status", { channelId: requested })]));
			} else {
				addMsg("system", formatChannelsStatusText(await rpc("channel.list")));
			}
		} catch(e) {
			addMsg("error", e.message || String(e));
		}
		return true;
	}

	if (t === "/config") {
		try {
			currentConfig = await rpc("config.get");
			addMsg("system", formatConfigSummaryText(currentConfig));
		} catch(e) {
			addMsg("error", e.message || String(e));
		}
		return true;
	}

	if (t === "/usage") {
		try {
			const results = await Promise.all([
				rpc("usage.summary"),
				rpc("usage.status"),
				rpc("usage.cost"),
			]);
			addMsg("system", formatUsageSummaryText(results[0], results[1], results[2]));
		} catch(e) {
			addMsg("error", e.message || String(e));
		}
		return true;
	}

	if (t === "/schedule") {
		try {
			addMsg("system", formatScheduleStatusText(await rpc("schedule.status")));
		} catch(e) {
			addMsg("error", e.message || String(e));
		}
		return true;
	}

	if (t === "/tree") {
		if (!currentSessionId) {
			addMsg("error", "No session selected.");
			return true;
		}
		addMsg("system", buildSessionTreeText(currentSessionId));
		return true;
	}

	if (t === "/export") {
		try {
			const filename = await exportActiveSession();
			addMsg("system", "Exported the current session to " + filename + ".");
		} catch(e) {
			addMsg("error", e.message || String(e));
		}
		return true;
	}

	if (t === "/login") {
		addMsg("system", "WebChat auth is decided before the page loads. If the gateway uses tokens, open this page with ?token=... or the authenticated dashboard link.");
		return true;
	}

	if (t === "/logout") {
		addMsg("system", "WebChat does not expose an in-chat logout flow yet. Remove the auth token from the URL or reload through an unauthenticated entrypoint.");
		return true;
	}

	if (t === "/share") {
		addMsg("system", "Session sharing is not implemented in WebChat yet. For now use /export or copy the session id manually.");
		return true;
	}

	if (t === "/scoped-models") {
		addMsg("system", "Scoped model overrides are not exposed in WebChat yet. WebChat currently follows the gateway default model set through /model.");
		return true;
	}

	if (t === "/browser-extension") {
		addMsg("system", "Browser extension controls are not exposed in WebChat yet. Use the TUI for browser-extension setup and diagnostics.");
		return true;
	}

	if (t === "/changelog") {
		addMsg("system", "The changelog view is not exposed in WebChat yet.");
		return true;
	}

	if (t === "/quit" || t === "/exit") {
		msgInput.value = "";
		autoResize();
		hideSlashMenu();
		addMsg("system", "WebChat stays open in the browser. Use /clear to clear the transcript, switch sessions, or close the tab.");
		return true;
	}

	if (t === "/teach" || t.startsWith("/teach ")) {
		return false;
	}

	if (t.startsWith("/")) {
		addMsg("error", 'Unknown slash command: "' + t + '".');
		return true;
	}
	return false;
}

async function setModel(raw) {
	const slash = raw.indexOf("/");
	if (slash <= 0 || slash === raw.length - 1) throw new Error("Format: provider/model-id");
	await rpc("config.apply", { defaultProvider: raw.slice(0, slash), defaultModel: raw.slice(slash + 1) });
	await loadDiscovery();
	addMsg("system", "Model set to " + raw);
}

/* ── Send ── */
async function sendText(text) {
	const currentSession = currentSessionSummary();
	if (activeSessionId && !isSessionWritable(currentSession)) {
		addMsg("error", "This session is read-only in WebChat. Use Overview or one of your WebChat sessions to continue.");
		sendPending = false;
		syncComposer();
		return;
	}
	const payload = buildMediaPayload(text);
	addMsg("user", buildOutgoingMessagePreviewText(text, payload), undefined, payload);
	sendPending = true;
	syncComposer();

	if (activeSessionId) {
		const targetSessionId = activeSessionId;
		try {
			const result = await rpc("session.send", {
				sessionId: targetSessionId,
				message: payload.text,
				waitForCompletion: false,
				...(payload.images.length ? { images: payload.images } : {}),
				...(payload.attachments.length ? { attachments: payload.attachments } : {}),
			});
			clearMedia();
			if (result?.runId) {
				activeLiveRunIds.add(result.runId);
				if (activeSessionId === targetSessionId) {
					ensureRunView(result.runId, targetSessionId);
					updateLiveRunStatus("Thinking through the task.");
				}
				return;
			}
			await refreshSessions();
			if (activeSessionId === targetSessionId) {
				addMsg("assistant", assistantResultText(result), undefined, result);
				sendPending = false;
				await selectSession(targetSessionId);
			}
		} catch(e) {
			if (activeSessionId === targetSessionId) {
				addMsg("error", e.message || String(e));
				sendPending = false;
			}
		}
		syncComposer();
		return;
	}

	/* Live mode — try streaming first, fall back to sync */
	try {
		liveAssistantBubble = null;
		liveAssistantText = "";
		var streamResult = await rpc("chat.stream", {
			text: payload.text,
			channelId: LIVE_CHANNEL,
			senderId: clientId,
			waitForCompletion: false,
			...(payload.images.length ? { images: payload.images } : {}),
			...(payload.attachments.length ? { attachments: payload.attachments } : {}),
		});
		if (streamResult?.runId) {
			activeLiveRunIds.add(streamResult.runId);
			ensureRunView(streamResult.runId, streamResult.sessionId);
			clearMedia();
			return; /* Stream events will handle the response */
		}
		/* Synchronous response */
		addMsg("assistant", assistantResultText(streamResult), undefined, streamResult);
		clearMedia();
		sendPending = false;
		await refreshSessions();
	} catch(streamErr) {
		/* If streaming fails (e.g. "already processing"), fall back to chat.send */
		var errMsg = streamErr?.message || String(streamErr);
		if (errMsg.includes("already processing") || errMsg.includes("streaming")) {
			try {
				var sendResult = await rpc("chat.send", {
					text: payload.text,
					channelId: LIVE_CHANNEL,
					senderId: clientId,
					waitForCompletion: true,
					...(payload.images.length ? { images: payload.images } : {}),
					...(payload.attachments.length ? { attachments: payload.attachments } : {}),
				});
				addMsg("assistant", assistantResultText(sendResult), undefined, sendResult);
				clearMedia();
				sendPending = false;
				await refreshSessions();
			} catch(sendErr) {
				addMsg("error", sendErr?.message || String(sendErr));
				sendPending = false;
			}
		} else {
			addMsg("error", errMsg);
			sendPending = false;
		}
	}
	syncComposer();
}

async function doSend() {
	const raw = msgInput.value;
	const text = raw.trim();
	if (!text && !pendingMedia.length) return;
	if (activeSessionId && !isSessionWritable(currentSessionSummary())) {
		addMsg("error", "This session is read-only in WebChat. Use Overview or one of your WebChat sessions to continue.");
		syncComposer();
		return;
	}
	msgInput.value = "";
	autoResize();
	hideSlashMenu();
	sendPending = true;
	syncComposer();

	try {
		if (text.startsWith("/") && await handleSlash(text)) {
			sendPending = false;
			syncComposer();
			return;
		}
		await sendText(text);
	} catch(e) {
		addMsg("error", e.message || String(e));
		sendPending = false;
		syncComposer();
	}
}

/* ── Event listeners ── */
sendBtn.addEventListener("click", doSend);

msgInput.addEventListener("keydown", function(e) {
	if (slashVisible) {
		if (e.key === "ArrowUp") { e.preventDefault(); navigateSlash(-1); return; }
		if (e.key === "ArrowDown") { e.preventDefault(); navigateSlash(1); return; }
		if ((e.key === "Enter" || e.key === "Tab") && !e.isComposing) {
			e.preventDefault();
			const items = slashMenu.querySelectorAll(".slash-item");
			if (items[slashIndex]) selectSlashItem(items[slashIndex].dataset.cmd);
			return;
		}
		if (e.key === "Escape") { hideSlashMenu(); return; }
	}
	if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
		e.preventDefault();
		doSend();
	}
});

msgInput.addEventListener("input", function() {
	autoResize();
	const v = msgInput.value;
	/* Slash autocomplete: trigger when input starts with / and cursor is after it */
	if (v.startsWith("/") && !v.includes(" ")) {
		showSlashMenu(v);
	} else {
		hideSlashMenu();
	}
	/* Enable/disable send */
	sendBtn.disabled = sendPending || (!v.trim() && !pendingMedia.length);
});

document.addEventListener("keydown", function(e) {
	if ((e.metaKey || e.ctrlKey) && !e.shiftKey && String(e.key || "").toLowerCase() === "k") {
		e.preventDefault();
		sessionFilter.focus();
		sessionFilter.select?.();
		return;
	}
	if ((e.metaKey || e.ctrlKey) && String(e.key || "") === ",") {
		e.preventDefault();
		modelModal.classList.add("visible");
		return;
	}
});

slashMenu.addEventListener("click", function(e) {
	const item = e.target.closest(".slash-item");
	if (item?.dataset.cmd) selectSlashItem(item.dataset.cmd);
});

attachBtn.addEventListener("click", function() { fileInput.click(); });

fileInput.addEventListener("change", async function() {
	const files = Array.from(fileInput.files || []);
	for (const f of files) {
		try { pendingMedia.push(await processFile(f)); } catch(e) { addMsg("error", "File error: " + e.message); }
	}
	fileInput.value = "";
	renderMediaStrip();
	syncComposer();
});

mediaStrip.addEventListener("click", function(e) {
	const btn = e.target.closest("[data-remove]");
	if (!btn) return;
	pendingMedia = pendingMedia.filter(function(m) { return m.id !== btn.dataset.remove; });
	renderMediaStrip();
});

sessionList.addEventListener("click", function(e) {
	/* Delete button */
	const delBtn = e.target.closest("[data-del-sid]");
	if (delBtn?.dataset.delSid) {
		e.stopPropagation();
		deleteSession(delBtn.dataset.delSid);
		return;
	}
	/* Select session */
	const btn = e.target.closest("[data-sid]");
	if (btn?.dataset.sid) selectSession(btn.dataset.sid);
});

sessionFilter.addEventListener("input", renderSessionList);

$id("new-session-btn").addEventListener("click", createNewSession);
$id("overview-btn").addEventListener("click", enterLiveMode);
sessionScopeBtn.addEventListener("click", function() { void toggleSessionScope(); });
$id("refresh-sessions-btn").addEventListener("click", refreshSessions);
$id("clear-btn").addEventListener("click", function() { clearChat(); });
$id("status-model").addEventListener("click", function() { modelModal.classList.add("visible"); });
$id("model-modal-close").addEventListener("click", function() { modelModal.classList.remove("visible"); });
$id("model-cancel-btn").addEventListener("click", function() { modelModal.classList.remove("visible"); });
$id("model-apply-btn").addEventListener("click", async function() {
	const v = modelSelect.value;
	if (!v) return;
	try {
		await setModel(v);
		modelModal.classList.remove("visible");
	} catch(e) { addMsg("error", e.message || String(e)); }
});
modelModal.addEventListener("click", function(e) {
	if (e.target === modelModal) modelModal.classList.remove("visible");
});

$id("mobile-menu-btn").addEventListener("click", function() {
	sidebar.classList.toggle("mobile-open");
});

/* Dashboard link with token */
dashboardLink.href = token ? "/ui?token=" + encodeURIComponent(token) : "/ui";
refreshSessionScopeButton();

/* ── Init ── */
connectWs();

/* Health polling */
setInterval(function() {
	refreshHealth().catch(function() {});
	if (clientId) refreshSessions().catch(function() {});
}, HEALTH_INTERVAL);

})();
</script>
</body>
</html>`;
}
