# @understudy/tools

Built-in tools for Understudy agents.

## What This Package Does

Provides the tool implementations that agents use during session execution:

| Tool | Description |
|------|-------------|
| `gui_*` | 8 composable GUI tools — screenshot-grounded desktop interaction |
| `browser` | Playwright managed browser + Chrome extension relay |
| `exec` | Shell command execution with timeout, streaming output, and resumable sessions |
| `process` | Inspect, list, and manage active `exec` sessions |
| `web_search` / `web_fetch` | Search and fetch live web content through the configured provider |
| `memory_*` | Semantic memory read/write across sessions |
| `message_send` | Send messages through channels |
| `schedule` | Cron jobs, one-shot timers, and run history |
| `platform_capabilities` | Report runtime and plugin-provided platform surfaces |
| `sessions_*` | Subagent session creation and messaging |
| `image` / `vision_read` / `pdf` | Media ingestion and document understanding helpers |
| `apply_patch` | Structured file patching for workspace edits |

Also includes:

- **Grounding providers**: OpenAI and response-based grounding for GUI target resolution
- **Video teach analyzer**: video-first demonstration analysis for teach drafts
- **Playbook/browser helpers**: staged workflow support, extension-relay auth helpers, and browser connection auto-routing
- **Secure GUI typing**: native text entry, System Events fallbacks, and secret-backed input sources
- **Runtime toolset**: dynamic tool assembly based on config, permissions, and policies
- **Exec session registry**: `exec` and `process` share the same session store for long-running shell tasks
- **Platform capability normalization**: merges core + plugin capability metadata into a single runtime surface

## Key Files

| File | Purpose |
|------|---------|
| `exec-tool.ts` | Interactive shell execution surface (`exec`) |
| `exec-sessions.ts` | Shared session registry used by `exec` and `process` |
| `process-tool.ts` | Process/session inspection and management |
| `gui-tools.ts` | GUI tool definitions and execution |
| `browser/` | Browser tool with managed, extension, and auto connection modes |
| `schedule/` | Schedule tool, service, and persistent store |
| `memory/` | Memory tool with pluggable providers |
| `platform-capabilities.ts` | Core + plugin platform capability normalization |
| `platform-capabilities-tool.ts` | Runtime-facing `platform_capabilities` tool |
| `runtime-toolset.ts` | Dynamic tool assembly and filtering |
| `video-teach-analyzer.ts` | Demonstration video analysis with `skill` / `worker` / `playbook` draft support |
| `openai-grounding-provider.ts` | OpenAI-based screenshot grounding |
| `response-grounding-provider.ts` | Model-loop grounding with validation |

## Development

```bash
pnpm build      # tsc -p tsconfig.build.json
pnpm typecheck  # tsc --noEmit
pnpm test       # vitest
```
