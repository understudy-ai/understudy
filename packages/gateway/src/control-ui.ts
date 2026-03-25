/**
 * Control UI: embedded admin SPA for Understudy.
 * Provides the browser operator surface for gateway health, runtime status,
 * session inspection, and quick interventions.
 */

import { existsSync } from "node:fs";
import type { Express } from "express";
import express from "express";
import { buildSessionUiHelpersScript } from "./session-ui-helpers.js";
import { understudyBrandIconDataUrl } from "./ui-brand.js";

export interface ControlUiOptions {
	/** Base URL path (default: "/ui") */
	basePath?: string;
	/** Path to custom static assets (overrides embedded UI) */
	assetRoot?: string;
	/** Assistant name shown in UI */
	assistantName?: string;
	/** Assistant avatar URL */
	assistantAvatarUrl?: string;
	/** Allowed CORS origins */
	allowedOrigins?: string[];
}

/**
 * Mount the control UI on an Express app.
 */
export function mountControlUi(app: Express, options: ControlUiOptions = {}): void {
	const basePath = (options.basePath ?? "/ui").replace(/\/+$/, "");

	// CORS handling for allowedOrigins (must be before static assets)
	if (options.allowedOrigins && options.allowedOrigins.length > 0) {
		const origins = new Set(options.allowedOrigins);
		app.use(basePath, (_req, res, next) => {
			const origin = _req.headers.origin;
			if (origin && origins.has(origin)) {
				res.setHeader("Access-Control-Allow-Origin", origin);
				res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
				res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
			}
			next();
		});
	}

	// If custom asset root exists, serve it
	if (options.assetRoot && existsSync(options.assetRoot)) {
		app.use(basePath, express.static(options.assetRoot));
	}

	// Bootstrap config endpoint
	app.get(`${basePath}/config.json`, (_req, res) => {
		res.json({
			assistantName: options.assistantName ?? "Understudy",
			assistantAvatarUrl: options.assistantAvatarUrl ?? null,
			basePath,
		});
	});

	// Embedded SPA (inline HTML)
	const indexHtml = buildAdminHtml(options);
	app.get(basePath, (_req, res) => {
		res.setHeader("Content-Type", "text/html; charset=utf-8");
		res.send(indexHtml);
	});

	// SPA fallback — use a middleware to catch remaining routes under basePath
	app.use(basePath, (_req, res, next) => {
		// Only catch GET requests that haven't been handled
		if (_req.method === "GET" && !res.headersSent) {
			res.setHeader("Content-Type", "text/html; charset=utf-8");
			res.send(indexHtml);
		} else {
			next();
		}
	});
}

function escapeHtml(str: string): string {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function buildAdminHtml(options: ControlUiOptions): string {
	const name = escapeHtml(options.assistantName ?? "Understudy");
	const brandIconDataUrl = understudyBrandIconDataUrl();
	const avatarUrl = escapeHtml(options.assistantAvatarUrl ?? brandIconDataUrl);
	const sessionUiHelpersScript = buildSessionUiHelpersScript({ liveChannelId: "web" });
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} Dashboard</title>
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
  --ok: #31a24c;
  --warn: #f0932b;
  --err: #e74c3c;
  --radius: 18px;
  --radius-sm: 12px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.1);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
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

/* ── Layout: sidebar + main like webchat ── */
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
  background: linear-gradient(135deg, #0f2742, #1f6feb);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}
.sidebar-header .logo img {
  width: 100%; height: 100%; object-fit: cover;
}
.sidebar-header .title { font-size: 16px; font-weight: 600; }
.sidebar-header .subtitle { font-size: 11px; color: var(--text-secondary); }
.sidebar-actions {
  padding: 12px 16px;
  display: flex; gap: 8px;
}
.sidebar-actions button, .sidebar-actions a {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  text-decoration: none;
  text-align: center;
  transition: background var(--transition);
}
.sidebar-actions button:hover, .sidebar-actions a:hover { background: var(--panel-hover); }
.sidebar-actions .primary {
  background: var(--accent);
  color: #fff;
  border-color: transparent;
}
.sidebar-actions .primary:hover { background: var(--accent-hover); }

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
.dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot.ok { background: var(--ok); }
.dot.warn { background: var(--warn); }
.dot.err { background: var(--err); }

/* Nav tabs in sidebar */
.sidebar-nav {
  padding: 8px 16px;
  display: flex; gap: 4px;
  border-bottom: 1px solid var(--line);
}
.nav-tab {
  padding: 6px 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}
.nav-tab:hover { background: var(--panel-hover); }
.nav-tab.active { background: var(--accent-soft); color: var(--accent); }

/* Sidebar section */
.sidebar-section {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
}
.section-label {
  padding: 12px 8px 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.sidebar-item {
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
.sidebar-item:hover { background: var(--panel-hover); }
.sidebar-item.active { background: var(--accent-soft); }
.sidebar-item .item-name {
  font-size: 13px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sidebar-item .item-meta {
  font-size: 11px; color: var(--text-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sidebar-item .item-actions { display: flex; gap: 4px; margin-top: 2px; }
.item-del {
  background: none; border: none; cursor: pointer;
  font-size: 11px; color: var(--text-secondary);
  padding: 2px 6px; border-radius: 4px;
}
.item-del:hover { background: #fee; color: var(--err); }

/* Sidebar info chips */
.sidebar-info {
  padding: 12px 16px;
  border-top: 1px solid var(--line);
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--panel-hover);
  font-size: 11px;
  color: var(--text-secondary);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip.channel {
  background: #e7f3ff;
  color: #0f5dbd;
  border: 1px solid rgba(0,132,255,0.16);
}
.chip.conversation {
  background: #edf7ed;
  color: #22663b;
  border: 1px solid rgba(34,102,59,0.14);
}
.chip.sender {
  background: #fff4e5;
  color: #8a4b08;
  border: 1px solid rgba(138,75,8,0.12);
}
.chip.state {
  background: #fff1f0;
  color: #b42318;
  border: 1px solid rgba(180,35,24,0.14);
}
.chip.teach {
  background: #f4f0ff;
  color: #5b33b6;
  border: 1px solid rgba(91,51,182,0.16);
}

/* ── Main area ── */
.main {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}

/* Main header */
.main-header {
  padding: 12px 20px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.main-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.main-header h2 {
  font-size: 16px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.main-header .header-meta {
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.main-header-actions {
  display: flex; gap: 8px; flex-shrink: 0;
}
.main-header-actions button, .main-header-actions a {
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
.main-header-actions button:hover, .main-header-actions a:hover {
  background: var(--panel-hover);
}

/* Main content scrollable area */
.main-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

/* Card grid */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.stat-card {
  background: var(--panel);
  border-radius: var(--radius-sm);
  padding: 16px;
  box-shadow: var(--shadow-sm);
}
.stat-card .stat-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
}
.stat-card .stat-value {
  font-size: 22px;
  font-weight: 700;
  margin-top: 6px;
  line-height: 1.2;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.stat-card .stat-note {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 6px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

/* Detail panel (right side content) */
.detail-panel {
  background: var(--panel);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-sm);
  margin-bottom: 16px;
  overflow: hidden;
}
.detail-panel-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.detail-panel-header h3 {
  font-size: 14px;
  font-weight: 600;
}
.detail-panel-header .panel-badge {
  font-size: 11px;
  color: var(--text-secondary);
  padding: 3px 8px;
  background: var(--panel-hover);
  border-radius: 999px;
}
.detail-panel-body {
  padding: 12px 16px;
}
.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.action-btn {
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel-hover);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
  transition: background var(--transition), border-color var(--transition);
}
.action-btn:hover {
  background: var(--accent-soft);
  border-color: rgba(0,132,255,0.18);
}
.detail-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}
.detail-row:last-child { border-bottom: none; }
.detail-label {
  color: var(--text-secondary);
  font-size: 12px;
  flex-shrink: 0;
}
.detail-value {
  text-align: right;
  min-width: 0;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.empty {
  padding: 20px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
}

/* History list */
.history-item {
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
}
.history-item:last-child { border-bottom: none; }
.history-role {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.history-body {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Trace items */
.trace-item {
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
}
.trace-item:last-child { border-bottom: none; }
.trace-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.trace-title {
  font-size: 13px; font-weight: 600;
}
.trace-meta {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}
.trace-body {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
}
.trace-subitem {
  margin-top: 6px;
  padding: 8px 10px;
  background: var(--panel-hover);
  border-radius: 8px;
}
.trace-subtitle {
  font-size: 12px;
  font-weight: 600;
}

/* Channel items */
.channel-item {
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
}
.channel-item:last-child { border-bottom: none; }
.channel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.channel-title { font-size: 13px; font-weight: 600; }
.channel-meta { font-size: 11px; color: var(--text-secondary); margin-top: 2px; }
.chip-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }

/* Status notice */
.notice {
  margin-bottom: 16px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line);
  background: var(--panel);
  font-size: 13px;
  line-height: 1.5;
}
.notice.info {
  border-color: rgba(0,132,255,0.16);
  background: var(--accent-soft);
}
.notice.error {
  border-color: rgba(231,76,60,0.18);
  background: #fff1f0;
  color: var(--err);
}

/* Readiness checks */
.readiness-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}
.readiness-row:last-child { border-bottom: none; }
.readiness-label { flex: 1; }
.readiness-detail { font-size: 11px; color: var(--text-secondary); }
.readiness-badge {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--panel-hover);
}

.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.hidden { display: none !important; }

@media (max-width: 900px) {
  .app { grid-template-columns: 1fr; }
  .sidebar { display: none; }
  .card-grid { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 600px) {
  .card-grid { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<div class="app">
<!-- ── Sidebar ── -->
<aside class="sidebar">
  <div class="sidebar-header">
    <div class="logo"><img src="${avatarUrl}" alt="${name}"></div>
    <div>
      <div class="title">${name}</div>
      <div class="subtitle">Dashboard</div>
    </div>
  </div>
  <div class="sidebar-actions">
    <a id="webchat-link" href="/webchat" class="primary">WebChat</a>
    <button id="refresh-btn" type="button">Refresh</button>
  </div>
  <div id="status-bar" class="status-bar">
    <span class="dot warn"></span>
    <span>Connecting...</span>
  </div>
  <div class="sidebar-nav">
    <button class="nav-tab active" data-tab="sessions" type="button">Sessions</button>
    <button class="nav-tab" data-tab="runs" type="button">Runs</button>
    <button class="nav-tab" data-tab="channels" type="button">Channels</button>
  </div>
  <div class="sidebar-section" id="sidebar-content">
    <div class="empty">Loading...</div>
  </div>
  <div class="sidebar-info" id="sidebar-info">
    <span class="chip">Loading...</span>
  </div>
</aside>

<!-- ── Main ── -->
<div class="main">
  <div class="main-header">
    <div class="main-header-left">
      <h2 id="main-title">Overview</h2>
      <span class="header-meta" id="main-subtitle"></span>
    </div>
    <div class="main-header-actions">
      <a id="main-webchat-link" href="/webchat">Open WebChat</a>
      <a href="/health" target="_blank" rel="noreferrer">Health JSON</a>
      <a href="/channels" target="_blank" rel="noreferrer">Channels JSON</a>
    </div>
  </div>
  <div class="main-body" id="main-body">
    <div id="status-notice" class="notice hidden"></div>
    <!-- Overview cards -->
    <div class="card-grid" id="summary-cards"></div>

    <!-- Detail panels rendered dynamically -->
    <div id="detail-area"></div>
  </div>
</div>
</div>

<script>
${sessionUiHelpersScript}
var BASE = location.origin;
var headers = { 'Content-Type': 'application/json' };
var token = new URLSearchParams(location.search).get('token') || '';
if (token) headers.Authorization = 'Bearer ' + token;

var state = {
  health: null,
  channels: [],
  config: null,
  models: [],
  capabilities: null,
  tools: [],
  toolSummary: null,
  skills: null,
  playbookRuns: null,
  playbookWorkspaceDir: '',
  schedule: null,
  readiness: null,
  sessions: [],
  selectedSessionId: '',
  selectedSession: null,
  selectedHistory: [],
  selectedTrace: null,
  selectedRunId: '',
  selectedRun: null,
  activeTab: 'sessions',
  lastRefreshAt: 0,
};

/* ── DOM refs ── */
var statusBarEl = document.getElementById('status-bar');
var sidebarContentEl = document.getElementById('sidebar-content');
var sidebarInfoEl = document.getElementById('sidebar-info');
var mainTitleEl = document.getElementById('main-title');
var mainSubtitleEl = document.getElementById('main-subtitle');
var summaryCardsEl = document.getElementById('summary-cards');
var detailAreaEl = document.getElementById('detail-area');
var statusNoticeEl = document.getElementById('status-notice');
var refreshBtnEl = document.getElementById('refresh-btn');

/* ── Helpers ── */
function esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function rpc(method, params) {
  return fetch(BASE+'/rpc',{method:'POST',headers:headers,body:JSON.stringify({id:Date.now().toString(),method:method,params:params||{}})})
    .then(function(r){return r.json()}).then(function(r){if(r.error)throw new Error(r.error.message);return r.result});
}
function fmtRel(ts) {
  if (!ts) return 'n/a';
  var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 45) return 'just now';
  var m = Math.floor(s/60);
  if (m < 60) return m + 'm ago';
  var h = Math.floor(m/60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h/24) + 'd ago';
}
function fmtTime(ts) {
  if (!ts) return 'n/a';
  return new Date(ts).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
}
function senderLabel(session) {
  return sessionUiSenderLabel(session);
}
function conversationLabel(session) {
  return sessionUiConversationLabel(session);
}
function sessionListLabel(session) {
  return sessionUiPrimaryLabel(session);
}
function sessionChipItems(session, options) {
  var opts = options && typeof options === 'object' ? options : {};
  return sessionUiChipItems(session, {
    includeChannel: opts.includeChannel,
    includeConversation: opts.includeConversation,
    includeSender: opts.includeSender !== false,
    includeReadOnly: opts.includeReadOnly,
    readOnly: opts.includeReadOnly === true,
  });
}
function sessionChipRowHtml(session, options) {
  var items = sessionChipItems(session, options);
  if (!items.length) return '';
  return '<div class="chip-row">' + items.map(function(item) {
    return '<span class="chip '+esc(item.kind)+'">'+esc(item.text)+'</span>';
  }).join('') + '</div>';
}
function fmtBytes(b) {
  var v = Number(b||0);
  if (v <= 0) return '0 B';
  var u = ['B','KB','MB','GB'];
  for (var i = 0; i < u.length; i++) {
    if (v < 1024 || i === u.length-1) return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i];
    v /= 1024;
  }
  return v + ' B';
}
function fmtUptime(ms) {
  var s = Math.max(0, Math.floor((ms||0)/1000));
  var d = Math.floor(s/86400), h = Math.floor((s%86400)/3600), m = Math.floor((s%3600)/60);
  if (d > 0) return d+'d '+h+'h';
  if (h > 0) return h+'h '+m+'m';
  return m+'m';
}
function tone(v) {
  var t = String(v||'').toLowerCase();
  if (t.includes('run')||t.includes('ok')||t.includes('connect')||t.includes('ready')) return 'ok';
  if (t.includes('error')||t.includes('fail')||t.includes('down')||t.includes('stop')||t.includes('offline')) return 'err';
  return 'warn';
}
function playbookRunStageLabel(run) {
  var stage = run && run.currentStage && typeof run.currentStage === 'object' ? run.currentStage : null;
  if (!stage) return 'No pending stage';
  return [stage.name || stage.id || 'Stage', stage.status || 'pending'].filter(Boolean).join(' · ');
}
function playbookRunChildLabel(run) {
  var child = run && run.childSession && typeof run.childSession === 'object' ? run.childSession : null;
  if (!child) return 'No child session';
  return [child.label || 'child', child.status || 'unknown'].filter(Boolean).join(' · ');
}
function playbookRunStatusTone(run) {
  if (!run) return 'warn';
  return tone(run.status || '');
}
function playbookRunLabel(run) {
  return run && run.playbookName ? run.playbookName : 'Playbook run';
}
function channelCapabilitySummary(caps) {
  if (!caps || typeof caps !== 'object') return 'Capabilities: none';
  var enabled = Object.keys(caps).filter(function(key) { return !!caps[key]; });
  return 'Capabilities: ' + (enabled.length ? enabled.join(', ') : 'none');
}
function channelActionHint(ch) {
  var runtime = ch && ch.runtime && typeof ch.runtime === 'object' ? ch.runtime : {};
  if (runtime.state === 'awaiting_pairing') return 'Next: complete pairing or QR login.';
  if (runtime.state === 'error' && runtime.lastError) return 'Fix: ' + runtime.lastError;
  if (runtime.summary) return runtime.summary;
  return 'Ready for inbound and outbound messaging checks.';
}

/* ── Apply token to webchat link ── */
(function(){
  var href = token ? '/webchat?token='+encodeURIComponent(token) : '/webchat';
  document.getElementById('webchat-link').setAttribute('href', href);
  document.getElementById('main-webchat-link').setAttribute('href', href);
})();

function showNotice(text, kind) {
  if (!statusNoticeEl) return;
  statusNoticeEl.textContent = String(text || '');
  statusNoticeEl.className = 'notice ' + (kind === 'error' ? 'error' : 'info');
}

function clearNotice() {
  if (!statusNoticeEl) return;
  statusNoticeEl.textContent = '';
  statusNoticeEl.className = 'notice hidden';
}

/* ── Tab switching ── */
document.querySelector('.sidebar-nav').addEventListener('click', function(e) {
  var tab = e.target.getAttribute('data-tab');
  if (!tab) return;
  state.activeTab = tab;
  document.querySelectorAll('.nav-tab').forEach(function(t) {
    t.classList.toggle('active', t.getAttribute('data-tab') === tab);
  });
  renderSidebar();
});

/* ── Render: Status bar ── */
function renderStatusBar() {
  if (!state.health) {
    statusBarEl.innerHTML = '<span class="dot warn"></span><span>Connecting...</span>';
    return;
  }
  var s = state.health.status || 'unknown';
  var t = tone(s);
  var uptime = state.health.uptime ? fmtUptime(state.health.uptime) : '';
  statusBarEl.innerHTML = '<span class="dot '+t+'"></span><span>'+esc(s)+
    (uptime ? ' &middot; '+esc(uptime) : '')+
    (state.lastRefreshAt ? ' &middot; '+esc(fmtRel(state.lastRefreshAt)) : '')+
    '</span>';
}

/* ── Render: Summary cards ── */
function renderSummaryCards() {
  var defaultModel = state.config
    ? [state.config.defaultProvider, state.config.defaultModel].filter(Boolean).join('/')
    : 'unset';
  var toolCount = Array.isArray(state.tools) ? state.tools.length : 0;
  var skillsLoaded = state.skills && typeof state.skills.loaded === 'number' ? state.skills.loaded : 0;
  var skillsAvailable = state.skills && typeof state.skills.available === 'number' ? state.skills.available : 0;
  var authMode = state.health && state.health.auth ? state.health.auth.mode || 'none' : 'none';
  var heap = state.health && state.health.memory ? fmtBytes(state.health.memory.heapUsed) : '--';
  var heapTotal = state.health && state.health.memory ? fmtBytes(state.health.memory.heapTotal) : '';
  var sessionCount = Array.isArray(state.sessions) ? state.sessions.length : 0;
  var channelCount = Array.isArray(state.channels) ? state.channels.length : 0;
  var playbookRunCount = state.playbookRuns && Array.isArray(state.playbookRuns.runs) ? state.playbookRuns.runs.length : 0;
  var methodCount = 0;
  if (state.capabilities) {
    var inv = state.capabilities.inventory;
    if (inv && Array.isArray(inv.methods)) methodCount = inv.methods.length;
  }

  var cards = [
    { label: 'Sessions', value: String(sessionCount), note: sessionCount > 0 ? 'Latest: '+fmtRel((state.sessions[0]||{}).lastActiveAt) : 'No sessions' },
    { label: 'Model', value: defaultModel || 'unset', note: (Array.isArray(state.models) ? state.models.length : 0)+' models available' },
    { label: 'Tools', value: String(toolCount), note: skillsLoaded+'/'+skillsAvailable+' skills &middot; '+methodCount+' RPC methods' },
    { label: 'Channels', value: String(channelCount), note: 'Auth: '+authMode },
    { label: 'Runs', value: String(playbookRunCount), note: playbookRunCount > 0 ? 'Tracked playbook runs' : 'No playbook runs' },
    { label: 'Memory', value: heap, note: heapTotal ? 'of '+heapTotal : '' },
    { label: 'Scheduling', value: state.schedule ? (state.schedule.enabled || state.schedule.running ? 'Active' : 'Off') : '--', note: state.schedule && state.schedule.runCount != null ? state.schedule.runCount+' runs' : 'Schedule jobs' },
  ];
  summaryCardsEl.innerHTML = cards.map(function(c) {
    return '<div class="stat-card"><div class="stat-label">'+esc(c.label)+'</div><div class="stat-value">'+esc(c.value)+'</div><div class="stat-note">'+c.note+'</div></div>';
  }).join('');
}

/* ── Render: Sidebar content ── */
function renderSidebar() {
  if (state.activeTab === 'sessions') {
    renderSessionList();
  } else if (state.activeTab === 'runs') {
    renderPlaybookRunList();
  } else {
    renderChannelList();
  }
  renderSidebarInfo();
}

function renderSessionList() {
  var items = Array.isArray(state.sessions) ? state.sessions : [];
  if (!items.length) {
    sidebarContentEl.innerHTML = '<div class="empty">No sessions</div>';
    return;
  }
  sidebarContentEl.innerHTML = '<div class="section-label">Recent Sessions</div>' +
    items.map(function(s) {
      var active = s.id === state.selectedSessionId ? ' active' : '';
      var label = sessionListLabel(s);
      var model = s.model || 'default';
      var msgs = s.messageCount || 0;
      var chips = sessionChipRowHtml(s);
      return '<button class="sidebar-item'+active+'" data-sid="'+esc(s.id)+'" type="button">'+
        '<div class="item-name">'+esc(label)+'</div>'+
        chips +
        '<div class="item-meta">'+esc([String(label) !== String(s.id || '') ? s.id : null, model, msgs+' msgs', fmtRel(s.lastActiveAt)].filter(Boolean).join(' · '))+'</div>'+
        '<div class="item-actions">'+
          '<span class="item-del" data-del-sid="'+esc(s.id)+'" title="Delete session">Delete</span>'+
        '</div>'+
      '</button>';
    }).join('');
}

function renderChannelList() {
  var items = Array.isArray(state.channels) ? state.channels : [];
  if (!items.length) {
    sidebarContentEl.innerHTML = '<div class="empty">No channels</div>';
    return;
  }
  sidebarContentEl.innerHTML = '<div class="section-label">Channels</div>' +
    items.map(function(ch) {
      var rt = ch.runtime || {};
      var rtState = rt.state || 'unknown';
      var t = tone(rtState);
      return '<div class="sidebar-item" style="cursor:default">'+
        '<div class="item-name"><span class="dot '+t+'" style="display:inline-block;margin-right:6px"></span>'+esc(ch.name || ch.id || 'channel')+'</div>'+
        '<div class="item-meta mono">'+esc(ch.id || '')+'</div>'+
        '<div class="item-meta">'+esc(rtState)+'</div>'+
        '<div class="item-meta">'+esc(channelCapabilitySummary(ch.capabilities))+'</div>'+
        '<div class="item-meta">'+esc(channelActionHint(ch))+'</div>'+
      '</div>';
    }).join('');
}

function renderPlaybookRunList() {
  var payload = state.playbookRuns || {};
  var items = Array.isArray(payload.runs) ? payload.runs : [];
  if (!items.length) {
    sidebarContentEl.innerHTML = '<div class="section-label">Playbook Runs</div><div class="empty">No playbook runs yet</div>';
    return;
  }
  sidebarContentEl.innerHTML = '<div class="section-label">Playbook Runs</div>' +
    items.map(function(run) {
      var active = run.id === state.selectedRunId ? ' active' : '';
      var toneClass = playbookRunStatusTone(run);
      var badges = [];
      if (run.approval && run.approval.state) badges.push('approval '+run.approval.state);
      if (run.childSession && run.childSession.status) badges.push(run.childSession.status);
      return '<button class="sidebar-item'+active+'" data-rid="'+esc(run.id)+'" type="button">'+
        '<div class="item-name"><span class="dot '+toneClass+'" style="display:inline-block;margin-right:6px"></span>'+esc(playbookRunLabel(run))+'</div>'+
        '<div class="item-meta">'+esc([run.id, fmtRel(run.updatedAt)].filter(Boolean).join(' · '))+'</div>'+
        '<div class="item-meta">'+esc(playbookRunStageLabel(run))+'</div>'+
        '<div class="item-meta">'+esc(playbookRunChildLabel(run))+'</div>'+
        (badges.length ? '<div class="chip-row">' + badges.map(function(label) { return '<span class="chip">'+esc(label)+'</span>'; }).join('') + '</div>' : '')+
      '</button>';
    }).join('');
}

function renderSidebarInfo() {
  var parts = [];
  var namespaces = [];
  if (state.capabilities && state.capabilities.inventory && Array.isArray(state.capabilities.inventory.namespaces)) {
    namespaces = state.capabilities.inventory.namespaces;
  }
  namespaces.slice(0, 6).forEach(function(ns) {
    var label = ns.id || ns.name || 'core';
    var count = ns.count || ns.methodCount || (Array.isArray(ns.methods) ? ns.methods.length : 0);
    parts.push('<span class="chip">'+esc(label)+' '+count+'</span>');
  });
  if (state.skills && Array.isArray(state.skills.skills)) {
    state.skills.skills.slice(0, 3).forEach(function(name) {
      parts.push('<span class="chip">'+esc(name)+'</span>');
    });
  }
  sidebarInfoEl.innerHTML = parts.join('') || '<span class="chip">No discovery data</span>';
}

/* ── Render: Detail area (main) ── */
function renderDetailArea() {
  if (state.activeTab === 'runs') {
    if (!state.selectedRunId || !state.selectedRun) {
      renderPlaybookRunOverviewDetail();
      return;
    }
    renderPlaybookRunDetail();
    return;
  }
  if (!state.selectedSessionId || !state.selectedSession) {
    renderOverviewDetail();
    return;
  }
  renderSessionDetail();
}

function renderPlaybookRunOverviewDetail() {
  var payload = state.playbookRuns || {};
  var runs = Array.isArray(payload.runs) ? payload.runs : [];
  mainTitleEl.textContent = 'Playbook Runs';
  mainSubtitleEl.textContent = payload.workspaceDir || 'Waiting for playbook run data';
  var rows = [
    ['Workspace', payload.workspaceDir || 'n/a'],
    ['Runs', String(runs.length)],
    ['Latest update', runs.length ? fmtRel((runs[0] || {}).updatedAt) : 'n/a'],
  ];
  var html = panelHtml('Run Actions', null,
    '<div class="detail-actions">'+
      '<button type="button" class="action-btn" data-run-action="start-run">Start Run</button>'+
      '<button type="button" class="action-btn" data-run-action="refresh-runs">Refresh Runs</button>'+
    '</div>'+
    '<div style="margin-top:10px;font-size:12px;color:var(--text-secondary)">These actions use the generic playbook.run RPC entrypoints directly from the dashboard.</div>'
  );
  html += panelHtml('Run Overview', '<span class="panel-badge">Playbooks</span>', rows.map(function(r) {
    return '<div class="detail-row"><span class="detail-label">'+esc(r[0])+'</span><span class="detail-value">'+esc(r[1])+'</span></div>';
  }).join(''));
  html += panelHtml('Recent Runs', runs.length ? runs.length+' tracked' : null, runs.length
    ? runs.map(function(run) {
      return '<div class="detail-row"><span class="detail-label">'+esc(playbookRunLabel(run))+'</span><span class="detail-value">'+esc([run.id, run.status, playbookRunStageLabel(run)].join(' · '))+'</span></div>';
    }).join('')
    : '<div class="empty">No playbook runs yet</div>');
  detailAreaEl.innerHTML = html;
}

function renderOverviewDetail() {
  mainTitleEl.textContent = 'Overview';
  mainSubtitleEl.textContent = state.lastRefreshAt ? 'Last refreshed '+fmtRel(state.lastRefreshAt) : '';
  var html = '';

  /* Config panel */
  if (state.config) {
    var cfg = state.config;
    var rows = [
      ['Default model', [cfg.defaultProvider, cfg.defaultModel].filter(Boolean).join('/') || 'unset'],
      ['Thinking', cfg.defaultThinkingLevel || 'default'],
      ['Profile', cfg.agent && cfg.agent.runtimeProfile ? cfg.agent.runtimeProfile : 'assistant'],
      ['Workspace', (cfg.agent && cfg.agent.cwd) || 'current'],
    ];
    html += panelHtml('Configuration', null, rows.map(function(r) {
      return '<div class="detail-row"><span class="detail-label">'+esc(r[0])+'</span><span class="detail-value">'+esc(r[1])+'</span></div>';
    }).join(''));
  }

  /* Readiness panel */
  if (state.readiness && Array.isArray(state.readiness.checks) && state.readiness.checks.length) {
    html += panelHtml('Runtime Readiness', null, state.readiness.checks.map(function(c) {
      var t = tone(c.status);
      return '<div class="readiness-row">'+
        '<span class="dot '+t+'"></span>'+
        '<span class="readiness-label">'+esc(c.label || c.id || 'check')+'</span>'+
        '<span class="readiness-detail">'+esc(c.detail || '')+'</span>'+
        '<span class="readiness-badge">'+esc(c.summary || c.status || 'unknown')+'</span>'+
      '</div>';
    }).join(''));
  }

  if (Array.isArray(state.channels) && state.channels.length) {
    html += panelHtml('Channel Operations', state.channels.length + ' configured', state.channels.map(function(ch) {
      return '<div class="detail-row" style="display:block">'+
        '<div class="detail-label" style="margin-bottom:4px">'+esc(ch.name || ch.id || 'channel')+' <span class="mono">'+esc(ch.id || '')+'</span></div>'+
        '<div class="detail-value">'+esc(channelCapabilitySummary(ch.capabilities))+'</div>'+
        '<div class="detail-value" style="font-size:12px;color:var(--text-secondary)">'+esc(channelActionHint(ch))+'</div>'+
      '</div>';
    }).join(''));
  }

  /* Teach info */
  html += panelHtml('Teach by Demonstration', null,
    '<div style="padding:4px 0;font-size:13px;color:var(--text-secondary)">Use <span class="mono">/teach start</span> to record a demo, then <span class="mono">/teach stop</span> to open a task-shaping dialogue. Use <span class="mono">/teach confirm</span> when the task card is ready. Add <span class="mono">--validate</span> or run <span class="mono">/teach validate &lt;draftId&gt;</span> whenever you want replay validation; publishing does not require it.</div>'
  );

  detailAreaEl.innerHTML = html;
}

function renderPlaybookRunDetail() {
  var payload = state.selectedRun || {};
  var run = payload.run || null;
  var summary = payload.summary || run || {};
  if (!run) {
    renderPlaybookRunOverviewDetail();
    return;
  }
  mainTitleEl.textContent = playbookRunLabel(summary);
  mainSubtitleEl.textContent = [summary.id || run.id, summary.status || run.status, summary.playbookName || run.playbookName].filter(Boolean).join(' · ');

  var routeRows = [
    ['Run', run.id || 'unknown'],
    ['Playbook', run.playbookName || 'unknown'],
    ['Status', run.status || 'unknown'],
    ['Current stage', playbookRunStageLabel(summary)],
    ['Child session', playbookRunChildLabel(summary)],
    ['Approval', run.approval && run.approval.state ? run.approval.state : 'n/a'],
    ['Artifacts root', run.artifacts && run.artifacts.rootDir ? run.artifacts.rootDir : 'n/a'],
    ['Updated', fmtTime(run.updatedAt)],
  ];
  var badge = '<a class="panel-badge" href="'+esc(playbookRunViewHref(run.id, payload.workspaceDir || ''))+'" target="_blank" rel="noreferrer">JSON</a>';
  var html = panelHtml('Run Actions', null,
    '<div class="detail-actions">'+
      '<button type="button" class="action-btn" data-run-action="resume-run">Resume State</button>'+
      '<button type="button" class="action-btn" data-run-action="next-stage">Run Next Stage</button>'+
      '<button type="button" class="action-btn" data-run-action="refresh-runs">Refresh Runs</button>'+
    '</div>'
  );
  html += panelHtml('Run Status', badge, routeRows.map(function(r) {
    return '<div class="detail-row"><span class="detail-label">'+esc(r[0])+'</span><span class="detail-value">'+esc(r[1])+'</span></div>';
  }).join(''));

  var stages = Array.isArray(run.stages) ? run.stages : [];
  html += panelHtml('Stage Progress', stages.length ? stages.length+' stages' : null, stages.length
    ? stages.map(function(stage) {
      return '<div class="detail-row"><span class="detail-label">'+esc(stage.name || stage.id || 'stage')+'</span><span class="detail-value">'+esc([stage.kind || 'stage', stage.status || 'pending'].join(' · '))+'</span></div>';
    }).join('')
    : '<div class="empty">No stage data</div>');

  var workerBudget = run.budgets && run.budgets.worker ? run.budgets.worker : null;
  html += panelHtml('Worker Budget', workerBudget ? 'Worker budget' : null, workerBudget
    ? [
      ['Minutes', workerBudget.maxMinutes != null ? String(workerBudget.maxMinutes) : 'n/a'],
      ['Actions', workerBudget.maxActions != null ? String(workerBudget.maxActions) : 'n/a'],
      ['Screenshots', workerBudget.maxScreenshots != null ? String(workerBudget.maxScreenshots) : 'n/a'],
    ].map(function(r) {
      return '<div class="detail-row"><span class="detail-label">'+esc(r[0])+'</span><span class="detail-value">'+esc(r[1])+'</span></div>';
    }).join('')
    : '<div class="empty">No worker budget recorded</div>');

  var children = Array.isArray(run.childSessions) ? run.childSessions : [];
  html += panelHtml('Child Sessions', children.length ? children.length+' sessions' : null, children.length
    ? children.map(function(child) {
      return '<div class="detail-row"><span class="detail-label">'+esc(child.label || child.sessionId || 'child')+'</span><span class="detail-value">'+esc([child.sessionId || '', child.status || '', fmtTime(child.updatedAt)].filter(Boolean).join(' · '))+'</span></div>';
    }).join('')
    : '<div class="empty">No child sessions recorded</div>');

  detailAreaEl.innerHTML = html;
}

function renderSessionDetail() {
  var s = state.selectedSession;
  mainTitleEl.textContent = sessionListLabel(s) || 'Session';
  mainSubtitleEl.innerHTML = sessionChipRowHtml(s) || esc(s.id || '');

  var html = '';

  /* Route details */
  var rows = [
    ['Session', s.id || 'unknown'],
    ['Model', s.model || 'unset'],
    ['Profile', s.runtimeProfile || 'assistant'],
    ['Channel', s.channelId || 'local'],
    ['Conversation', conversationLabel(s) || '—'],
    ['Sender', senderLabel(s) || 'gateway'],
    ['Workspace', s.workspaceDir || 'default'],
    ['Created', fmtTime(s.createdAt)],
    ['Last active', fmtTime(s.lastActiveAt)],
    ['Messages', String(s.messageCount || 0)],
  ];
  var badge = '<a class="panel-badge" href="'+esc(sessionViewHref(s.id))+'" target="_blank" rel="noreferrer">JSON</a>';
  html += panelHtml('Route', badge, rows.map(function(r) {
    return '<div class="detail-row"><span class="detail-label">'+esc(r[0])+'</span><span class="detail-value">'+esc(r[1])+'</span></div>';
  }).join(''));

  var teach = s && s.teachClarification && typeof s.teachClarification === 'object' ? s.teachClarification : null;
  if (teach) {
    var teachRows = [
      ['Draft', teach.draftId || 'unknown'],
      ['Status', teach.status || 'clarifying'],
      ['Updated', teach.updatedAt ? fmtTime(teach.updatedAt) : 'n/a'],
    ];
    if (teach.summary) teachRows.push(['Summary', teach.summary]);
    if (teach.nextQuestion) teachRows.push(['Next question', teach.nextQuestion]);
    html += panelHtml('Teach Status', '<span class="panel-badge">Live</span>', teachRows.map(function(r) {
      return '<div class="detail-row"><span class="detail-label">'+esc(r[0])+'</span><span class="detail-value">'+esc(r[1])+'</span></div>';
    }).join('') + '<div class="detail-row"><span class="detail-label">Next</span><span class="detail-value">' + esc(
      teach.status === 'ready'
        ? 'Run /teach confirm, then /teach publish ' + (teach.draftId || '<draftId>') + ' [skill-name]. Optional: /teach confirm --validate or /teach validate ' + (teach.draftId || '<draftId>')
        : 'Reply in plain language to continue clarification.'
    ) + '</span></div>');
  }

  /* History */
  var history = Array.isArray(state.selectedHistory) ? state.selectedHistory : [];
  if (history.length) {
    html += panelHtml('Recent History', history.length+' messages', history.map(function(e) {
      return '<div class="history-item">'+
        '<div class="history-role"><span>'+esc(e.role || 'message')+'</span><span>'+esc(fmtTime(e.timestamp))+'</span></div>'+
        '<div class="history-body">'+esc(e.text || '')+'</div>'+
      '</div>';
    }).join(''));
  } else {
    html += panelHtml('Recent History', null, '<div class="empty">No stored history</div>');
  }

  /* Trace */
  var tracePayload = state.selectedTrace || {};
  var traceRuns = Array.isArray(tracePayload.runs) ? tracePayload.runs : [];
  var traceEvents = Array.isArray(tracePayload.events) ? tracePayload.events : [];
  if (traceRuns.length) {
    html += panelHtml('Execution Trace', traceRuns.length+' runs', traceRuns.map(function(run) {
      var meta = [
        run.durationMs != null ? run.durationMs+'ms' : '',
        run.recordedAt ? fmtTime(run.recordedAt) : '',
      ].filter(Boolean).join(' &middot; ');
      var body = [
        run.userPromptPreview ? 'Prompt: '+run.userPromptPreview : '',
        run.responsePreview ? 'Reply: '+run.responsePreview : '',
      ].filter(Boolean).join('\\n');
      var toolTrace = Array.isArray(run.toolTrace) ? run.toolTrace : [];
      var subItems = toolTrace.map(function(ev) {
        var evMeta = [ev.route || 'system', ev.type || 'event'].filter(Boolean).join(' &middot; ');
        return '<div class="trace-subitem"><div class="trace-subtitle">'+esc(ev.name || ev.type || 'step')+'</div><div class="trace-meta">'+esc(evMeta)+'</div></div>';
      }).join('');
      return '<div class="trace-item">'+
        '<div class="trace-head"><div><div class="trace-title">Run '+esc(run.runId || '?')+'</div><div class="trace-meta">'+meta+'</div></div></div>'+
        (body ? '<div class="trace-body">'+esc(body)+'</div>' : '')+
        subItems+
      '</div>';
    }).join(''));
  } else if (traceEvents.length) {
    html += panelHtml('Execution Trace', traceEvents.length+' events', traceEvents.map(function(ev) {
      var meta = [
        ev.route || 'system',
        ev.durationMs != null ? ev.durationMs+'ms' : '',
        ev.timestamp ? fmtTime(ev.timestamp) : '',
      ].filter(Boolean).join(' &middot; ');
      var preview = (ev.result && ev.result.textPreview) || ev.error || '';
      return '<div class="trace-item">'+
        '<div class="trace-head"><div><div class="trace-title">'+esc(ev.toolName || 'tool')+'</div><div class="trace-meta">'+meta+'</div></div></div>'+
        (preview ? '<div class="trace-body">'+esc(preview)+'</div>' : '')+
      '</div>';
    }).join(''));
  } else {
    html += panelHtml('Execution Trace', null, '<div class="empty">No trace data</div>');
  }

  detailAreaEl.innerHTML = html;
}

function panelHtml(title, badge, body) {
  return '<div class="detail-panel">'+
    '<div class="detail-panel-header"><h3>'+esc(title)+'</h3>'+(badge ? '<span class="panel-badge">'+badge+'</span>' : '')+'</div>'+
    '<div class="detail-panel-body">'+body+'</div>'+
  '</div>';
}

function sessionViewHref(sid) {
  var q = 'method=session.get&sessionId='+encodeURIComponent(sid);
  return '/rpc-view?'+q+(token ? '&token='+encodeURIComponent(token) : '');
}

function playbookRunViewHref(runId, workspaceDir) {
  var q = 'method=playbook.run.get&runId='+encodeURIComponent(runId || '');
  if (workspaceDir) q += '&workspaceDir='+encodeURIComponent(workspaceDir);
  return '/rpc-view?'+q+(token ? '&token='+encodeURIComponent(token) : '');
}

/* ── Session selection ── */
async function loadSessionDetail(sid) {
  state.selectedSessionId = sid;
  state.selectedSession = null;
  state.selectedHistory = [];
  state.selectedTrace = null;
  clearNotice();
  renderSidebar();
  renderDetailArea();
  try {
    var results = await Promise.all([
      rpc('session.get', { sessionId: sid }),
      rpc('session.history', { sessionId: sid, limit: 8 }),
      rpc('session.trace', { sessionId: sid, limit: 12 }),
    ]);
    state.selectedSession = results[0] || null;
    var hp = results[1] || {};
    state.selectedHistory = Array.isArray(hp.messages) ? hp.messages : [];
    state.selectedTrace = results[2] || null;
  } catch (err) {
    state.selectedSession = null;
    showNotice('Session inspect failed: '+(err && err.message ? err.message : String(err)), 'error');
  }
  renderSidebar();
  renderDetailArea();
}

async function loadPlaybookRunDetail(runId) {
  state.selectedRunId = runId;
  state.selectedRun = null;
  clearNotice();
  renderSidebar();
  renderDetailArea();
  try {
    state.selectedRun = await rpc('playbook.run.get', {
      runId: runId,
      workspaceDir: state.playbookRuns && state.playbookRuns.workspaceDir ? state.playbookRuns.workspaceDir : undefined,
    });
  } catch (err) {
    state.selectedRun = null;
    showNotice('Run inspect failed: '+(err && err.message ? err.message : String(err)), 'error');
  }
  renderSidebar();
  renderDetailArea();
}

async function deleteSession(sid) {
  if (!sid) return;
  try {
    await rpc('session.delete', { sessionId: sid });
    showNotice('Session '+sid+' deleted.', 'info');
    if (state.selectedSessionId === sid) {
      state.selectedSessionId = '';
      state.selectedSession = null;
      state.selectedHistory = [];
      state.selectedTrace = null;
    }
    await refreshSessions();
    renderDetailArea();
  } catch (err) {
    showNotice('Delete failed: '+(err && err.message ? err.message : String(err)), 'error');
  }
}

function deselectSession() {
  state.selectedSessionId = '';
  state.selectedSession = null;
  state.selectedHistory = [];
  state.selectedTrace = null;
  clearNotice();
  renderSidebar();
  renderDetailArea();
}

function deselectPlaybookRun() {
  state.selectedRunId = '';
  state.selectedRun = null;
  clearNotice();
  renderSidebar();
  renderDetailArea();
}

async function startPlaybookRunFromUi() {
  var playbookName = prompt('Playbook name?', '');
  if (!playbookName) return;
  var rawInputs = prompt('Inputs JSON? (optional)', '{}');
  if (rawInputs === null) return;
  var parsedInputs = {};
  try {
    parsedInputs = rawInputs ? JSON.parse(rawInputs) : {};
  } catch (err) {
    showNotice('Inputs must be valid JSON.', 'error');
    return;
  }
  try {
    var started = await rpc('playbook.run.start', {
      workspaceDir: state.playbookWorkspaceDir || undefined,
      playbookName: playbookName,
      inputs: parsedInputs,
    });
    state.activeTab = 'runs';
    document.querySelectorAll('.nav-tab').forEach(function(t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === 'runs');
    });
    showNotice('Started run '+(started && started.run && started.run.id ? started.run.id : 'new run')+'.', 'info');
    await refreshOverview();
    if (started && started.run && started.run.id) {
      await loadPlaybookRunDetail(started.run.id);
    } else {
      renderSidebar();
      renderDetailArea();
    }
  } catch (err) {
    showNotice('Start run failed: '+(err && err.message ? err.message : String(err)), 'error');
  }
}

async function resumePlaybookRunFromUi() {
  if (!state.selectedRunId) {
    showNotice('Select a run first.', 'error');
    return;
  }
  try {
    var resumed = await rpc('playbook.run.resume', {
      workspaceDir: state.playbookRuns && state.playbookRuns.workspaceDir ? state.playbookRuns.workspaceDir : undefined,
      runId: state.selectedRunId,
    });
    showNotice('Resumed '+state.selectedRunId+' at '+(resumed && resumed.nextStage ? resumed.nextStage.name : 'the current stage')+'.', 'info');
    await refreshOverview();
    await loadPlaybookRunDetail(state.selectedRunId);
  } catch (err) {
    showNotice('Resume failed: '+(err && err.message ? err.message : String(err)), 'error');
  }
}

async function advancePlaybookRunFromUi() {
  if (!state.selectedRunId) {
    showNotice('Select a run first.', 'error');
    return;
  }
  var parentSessionId = prompt('Parent session id?', state.selectedSessionId || '');
  if (!parentSessionId) {
    showNotice('A parent session id is required to run the next stage.', 'error');
    return;
  }
  try {
    var result = await rpc('playbook.run.next', {
      workspaceDir: state.playbookRuns && state.playbookRuns.workspaceDir ? state.playbookRuns.workspaceDir : undefined,
      runId: state.selectedRunId,
      parentSessionId: parentSessionId,
    });
    showNotice('Advanced '+state.selectedRunId+' with '+(result && result.mode ? result.mode : 'the next stage')+'.', 'info');
    await refreshOverview();
    await loadPlaybookRunDetail(state.selectedRunId);
  } catch (err) {
    showNotice('Next stage failed: '+(err && err.message ? err.message : String(err)), 'error');
  }
}


/* ── Data fetching ── */
function pickSkills(src) {
  if (!src || typeof src !== 'object') return null;
  if (src.discovery && src.discovery.skills) return src.discovery.skills;
  if (src.skills && typeof src.skills === 'object' && !Array.isArray(src.skills)) return src.skills;
  return null;
}

async function refreshOverview() {
  var tasks = await Promise.allSettled([
    fetch(BASE+'/health',{headers:headers}).then(function(r){return r.json()}),
    fetch(BASE+'/channels',{headers:headers}).then(function(r){return r.json()}),
    rpc('health'),
    rpc('config.get'),
    rpc('models.list'),
    rpc('capabilities.get'),
    rpc('tools.catalog'),
    rpc('skills.status'),
    rpc('schedule.status'),
    rpc('runtime.readiness'),
    rpc('playbook.run.list', {
      limit: 20,
      workspaceDir: state.playbookWorkspaceDir || undefined,
    }),
  ]);
  var httpH = tasks[0].status === 'fulfilled' ? tasks[0].value : null;
  var chP = tasks[1].status === 'fulfilled' ? tasks[1].value : null;
  var rpcH = tasks[2].status === 'fulfilled' ? tasks[2].value : null;
  state.health = Object.assign({}, httpH || {}, rpcH || {});
  state.channels = chP && Array.isArray(chP.channels) ? chP.channels : (state.health.channelStatuses || []);
  state.config = tasks[3].status === 'fulfilled' ? tasks[3].value : null;
  if (tasks[4].status === 'fulfilled') {
    var mp = tasks[4].value || {};
    state.models = Array.isArray(mp.models) ? mp.models : [];
  }
  state.capabilities = tasks[5].status === 'fulfilled' ? tasks[5].value : null;
  if (tasks[6].status === 'fulfilled') {
    var tp = tasks[6].value || {};
    state.tools = Array.isArray(tp.tools) ? tp.tools : [];
    state.toolSummary = tp.summary || null;
  } else {
    state.tools = [];
  }
  state.skills = pickSkills(state.capabilities);
  if (!state.skills && tasks[7].status === 'fulfilled') state.skills = tasks[7].value || null;
  state.schedule = tasks[8].status === 'fulfilled' ? tasks[8].value : null;
  state.readiness = tasks[9].status === 'fulfilled' ? tasks[9].value : (state.health.readiness || null);
  state.playbookRuns = tasks[10].status === 'fulfilled' ? tasks[10].value : null;
  state.lastRefreshAt = Date.now();
  renderStatusBar();
  renderSummaryCards();
  renderSidebar();
  renderDetailArea();
}

async function refreshSessions() {
  try {
    var result = await rpc('session.list', {});
    state.sessions = Array.isArray(result)
      ? result.slice().sort(function(a,b){return (b.lastActiveAt||0)-(a.lastActiveAt||0)})
      : [];
  } catch(e) {
    state.sessions = [];
  }
  var stillPresent = state.selectedSessionId && state.sessions.some(function(s){return s.id === state.selectedSessionId});
  if (!stillPresent && state.selectedSessionId) deselectSession();
  renderSidebar();
  renderSummaryCards();
}

async function refreshAll() {
  refreshBtnEl.disabled = true;
  try {
    await Promise.all([refreshOverview(), refreshSessions()]);
    if (state.selectedSessionId) await loadSessionDetail(state.selectedSessionId);
    if (state.selectedRunId) await loadPlaybookRunDetail(state.selectedRunId);
  } finally {
    refreshBtnEl.disabled = false;
  }
}

/* ── Event listeners ── */
refreshBtnEl.addEventListener('click', function(){ void refreshAll(); });

sidebarContentEl.addEventListener('click', function(e) {
  var target = e.target;
  /* Delete button */
  var delBtn = target instanceof Element ? target.closest('[data-del-sid]') : null;
  if (delBtn) {
    e.stopPropagation();
    var sid = delBtn.getAttribute('data-del-sid') || '';
    if (sid && confirm('Delete session '+sid+'?')) void deleteSession(sid);
    return;
  }
  /* Session select */
  var item = target instanceof Element ? target.closest('[data-sid]') : null;
  if (item) {
    var sessionId = item.getAttribute('data-sid') || '';
    if (sessionId === state.selectedSessionId) {
      deselectSession();
    } else if (sessionId) {
      void loadSessionDetail(sessionId);
    }
    return;
  }
  var runItem = target instanceof Element ? target.closest('[data-rid]') : null;
  if (!runItem) return;
  var runId = runItem.getAttribute('data-rid') || '';
  if (runId === state.selectedRunId) {
    deselectPlaybookRun();
  } else if (runId) {
    void loadPlaybookRunDetail(runId);
  }
});

detailAreaEl.addEventListener('click', function(e) {
  var target = e.target instanceof Element ? e.target.closest('[data-run-action]') : null;
  if (!target) return;
  var action = target.getAttribute('data-run-action') || '';
  if (action === 'start-run') {
    void startPlaybookRunFromUi();
    return;
  }
  if (action === 'resume-run') {
    void resumePlaybookRunFromUi();
    return;
  }
  if (action === 'next-stage') {
    void advancePlaybookRunFromUi();
    return;
  }
  if (action === 'refresh-runs') {
    void refreshAll();
    return;
  }
});

/* ── Init ── */
void refreshAll();
setInterval(function() {
  void refreshOverview().catch(function(){});
  void refreshSessions().catch(function(){});
  if (state.selectedSessionId) void loadSessionDetail(state.selectedSessionId).catch(function(){});
}, 15000);
</script>
</body>
</html>`;
}
