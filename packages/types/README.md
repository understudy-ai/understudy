# @understudy/types

Shared type definitions for the Understudy monorepo.

## What This Package Does

Provides the TypeScript interfaces and constants used across all Understudy packages. No runtime logic — just types, enums, and default values.

### Channel types (`channel.ts`)

Interfaces for multi-platform messaging adapters:

- `ChannelAdapter`, `ChannelIdentity`, `ChannelCapabilities`
- `InboundMessage`, `OutboundMessage`, `Attachment`
- `ChannelAuthAdapter`, `ChannelMessagingAdapter`, `ChannelStreamingAdapter`, `ChannelGroupAdapter`
- `ChannelRuntimeStatus`, `ChannelRuntimeState`

### Tool schema types (`tool-schema.ts`)

Trust-gated tool metadata:

- `ToolRiskLevel` — `"read" | "write" | "execute" | "network" | "dangerous"`
- `ToolCategory` — `"filesystem" | "shell" | "search" | "web" | "messaging" | ...`
- `ToolEntry`, `ToolPolicy`

### Configuration types (`config.ts`)

Full configuration surface for `~/.understudy/config.json5`:

- `UnderstudyConfig` (top-level) and nested interfaces for agent, channels, tools, memory, skills, browser, gateway, plugins, and runtime policies
- `DEFAULT_CONFIG` — built-in default values

## Usage

This package is internal to the Understudy monorepo and not published separately.

```typescript
import type { UnderstudyConfig, ChannelAdapter, ToolEntry } from "@understudy/types";
import { DEFAULT_CONFIG } from "@understudy/types";
```

## Development

```bash
pnpm build      # tsc -p tsconfig.build.json
pnpm typecheck  # tsc --noEmit
```

## License

MIT
