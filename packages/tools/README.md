# @understudy/tools

Built-in tools for Understudy agents.

## What This Package Does

Provides the tool implementations that agents use during session execution:

| Tool | Description |
|------|-------------|
| `gui_*` | 13 GUI tools — screenshot-grounded desktop interaction |
| `browser` | Playwright managed browser + Chrome extension relay |
| `bash` | Shell command execution with timeout and output capture |
| `web-search` | Web search via configured provider |
| `web-fetch` | URL content fetching and extraction |
| `memory` | Semantic memory read/write across sessions |
| `message_send` | Send messages through channels |
| `schedule` | Cron jobs, one-shot timers, and run history |
| `process` | Process management utilities |
| `sessions_*` | Subagent session creation and messaging |

Also includes:

- **Grounding providers**: OpenAI and response-based grounding for GUI target resolution
- **Video teach analyzer**: video-first demonstration analysis for teach drafts
- **Runtime toolset**: dynamic tool assembly based on config, permissions, and policies
- **OpenClaw compatibility tools**: `exec`, `cron`, `message` aliases

## Key Files

| File | Purpose |
|------|---------|
| `gui-tools.ts` | GUI tool definitions and execution |
| `browser/` | Browser tool with managed and extension modes |
| `schedule/` | Schedule tool, service, and persistent store |
| `memory/` | Memory tool with pluggable providers |
| `runtime-toolset.ts` | Dynamic tool assembly and filtering |
| `video-teach-analyzer.ts` | Demonstration video analysis |
| `openai-grounding-provider.ts` | OpenAI-based screenshot grounding |
| `response-grounding-provider.ts` | Model-loop grounding with validation |

## Development

```bash
pnpm build      # tsc -p tsconfig.build.json
pnpm typecheck  # tsc --noEmit
pnpm test       # vitest
```
