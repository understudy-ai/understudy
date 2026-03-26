# @understudy/core

Agent session runtime core for Understudy.

## What This Package Does

- **Config management**: loads and validates `~/.understudy/config.json5` with environment variable overrides
- **Auth**: provider credential resolution (API keys, OAuth) for Anthropic, OpenAI, Google
- **System prompt**: modular, mode-aware prompt builder with sections for tools, identity, skills, memory, messaging, and more
- **Skills**: SKILL.md parsing, multi-source skill loading, eligibility filtering, and workspace snapshot building
- **Policy pipeline**: `beforeTool` / `afterTool` hooks for safety, trust, logging, and rate limiting
- **Session orchestration**: agent turn execution, tool binding, trace recording
- **Task drafts**: teach draft data model, persistence, and publish flow for `skill`, `worker`, and `playbook` artifacts
- **Workspace artifacts**: parsing and loading reusable workspace `skill`, `worker`, and `playbook` definitions
- **Playbook runs**: persisted run records, stage state, artifact roots, approvals, and resume metadata
- **Runtime composition**: canonical Understudy tool registration, filtering, and prompt assembly

## Usage

This package is internal to the Understudy monorepo and not published separately.

```typescript
import { createAgentSession, loadConfig, buildSystemPrompt } from "@understudy/core";
```

## Development

```bash
pnpm build      # tsc -p tsconfig.build.json
pnpm typecheck  # tsc --noEmit
pnpm test       # vitest
```
