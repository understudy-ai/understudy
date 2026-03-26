# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.2.0 — 2026-03-26

Reposition Understudy around three ideas that now define the product more clearly in both code and docs: a general-purpose local agent first, modern computer use with bring-your-own API key second, and teach/crystallization/route-aware learning on top. This release also hardens the teach analysis path and aligns release/version metadata across the runtime.

### Added

- Workspace artifact publishing now supports `skill`, `worker`, and `playbook` outputs through the shared teach/task-draft pipeline.
- Browser routing now supports both managed Playwright sessions and Chrome extension relay attach flows behind the same browser surface.

### Changed

- Refreshed the README, GitHub Pages overview, demo workspaces, and product-design docs to lead with "general agent → computer use → teach and learning", matching the current implementation and product story.
- Bumped all workspace package versions, CLI/runtime version reporting, and Chrome extension release metadata to `0.2.0`.
- Session-backed teach analysis now uses adaptive evidence-pack sizing by default instead of a hard `2 episodes / 6 keyframes` cap.
- Session-backed teach analysis no longer applies a default hard 120s timeout unless explicitly configured.
- Teach evidence-pack construction now filters `/teach start`, `/teach stop`, and other Understudy recording scaffolding noise before analysis.

### Fixed

- Corrected gateway-backed TUI ordering so tool activity renders before the final assistant reply instead of appearing out of order.
- Fixed a docs/demo mismatch where the general-agent demo summary still referred to saving output on Desktop instead of Downloads.

## 0.1.5 — 2026-03-18

Sync workspace/runtime version reporting to the published package version, make dual-registry releases rerun-safe, and align release metadata across the CLI, gateway, MCP client, and Chrome relay extension.

## 0.1.4 — 2026-03-18

Add the bundled `researcher` skill, publish releases to GitHub Packages alongside npm, tighten the macOS GUI runtime and grounding stack, remove stale GUI tool-count docs, and clean up release-facing telemetry and teach/tool metadata.

## 0.1.3 — 2026-03-13

Add MiniMax as a built-in model provider and clarify teach privacy / contributor documentation.

## 0.1.2 — 2026-03-13

Align GitHub Actions trusted publishing with npm's current Node.js and npm CLI requirements.

## 0.1.1 — 2026-03-13

Fix npm package runtime dependencies and CLI bootstrap so installed builds can start correctly.

## 0.1.0 — 2026-03-11

First public release of the Understudy runtime.

### Added

- **GUI Runtime**: Native GUI toolset (`gui_observe`, `gui_click`, `gui_drag`, `gui_scroll`, `gui_type`, `gui_key`, `gui_wait`, `gui_move`) with screenshot-grounded target resolution on macOS. Graceful degradation when grounding or permissions are unavailable.
- **Browser Automation**: Playwright managed mode and Chrome extension relay for logged-in tabs.
- **Teach-by-Demonstration**: `/teach start` → record → `/teach stop` → video-first evidence analysis → clarification dialogue → replay validation → publish as workspace skill.
- **Gateway Server**: HTTP + WebSocket + JSON-RPC gateway (default port 23333) with session runtime, policy pipeline, and handler registry.
- **WebChat & Dashboard**: Embedded web UIs for chat and gateway control, served directly from the gateway.
- **8 Channel Adapters**: Web, Telegram (grammy), Discord (discord.js), Slack (@slack/bolt), WhatsApp (Baileys), Signal (signal-cli), LINE (REST), iMessage (macOS).
- **47 Built-in Skills**: Apple Notes, Obsidian, GitHub, Slack, Spotify, 1Password, Trello, Bear Notes, Things, and more.
- **Skill System**: SKILL.md format with YAML frontmatter, multi-source loading (bundled, managed, workspace, project), eligibility filtering, and `skills install` / `skills uninstall` CLI commands.
- **Session Management**: Persistent sessions with history, branching, compaction, and run traces.
- **Memory Providers**: Semantic memory that persists across sessions.
- **Scheduling**: Cron-based scheduled jobs, one-shot timers, and run history.
- **Subagent Delegation**: Child sessions for parallel work.
- **CLI**: 30+ commands including `chat`, `wizard`, `agent`, `gateway`, `browser`, `channels`, `schedule`, `skills`, `doctor`, `health`, `status`, `logs`, `models`, `config`, `reset`, `security`, `completion`.
- **Setup Wizard**: Interactive guided setup for model auth, browser extension, GUI permissions, channels, and background service.
- **Plugin System**: Plugin registry and loader for extending tools and gateway RPC.
- **CI/CD**: GitHub Actions workflow (lint, typecheck, test, build).
- **OpenClaw Compatibility**: Tool aliases (`exec` → `bash`, `cron` → `schedule`, `message` → `message_send`) for portable skill migration.
- **Privacy**: Local-first design — screenshots, recordings, and traces stay on the user's machine. No telemetry.

### Notes

- Native GUI execution and teach-by-demonstration require macOS today.
- Core features (CLI, gateway, browser, channels) work cross-platform.
- Route optimization (Layer 4) and proactive autonomy (Layer 5) are architecturally planned but not yet active.
- This is the initial public release of Understudy.
