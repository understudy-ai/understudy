# @understudy/gui

Native GUI runtime for Understudy — screenshot-grounded desktop automation.

## What This Package Does

- **GUI action execution**: 8 tool-facing actions (`observe`, `click`, `drag`, `scroll`, `type`, `key`, `wait`, `move`) with click sub-modes for right-click, double-click, hover-only, and click-and-hold
- **Screenshot grounding**: LLM-based target resolution from screenshots via pluggable `GuiGroundingProvider`
- **Native helper**: Swift-based macOS binary for window enumeration, accessibility queries, and input events
- **Graceful degradation**: dynamically disables tools based on available permissions (Accessibility, Screen Recording)
- **Demonstration recorder**: screen + event capture for teach-by-demonstration workflows
- **Readiness checks**: platform detection, permission status, and native helper availability

## Platform Support

| Capability | macOS | Linux | Windows |
|-----------|:-----:|:-----:|:-------:|
| Screenshot capture | Yes | Planned | Planned |
| Native input events | Yes | Planned | Planned |
| Window enumeration | Yes | Planned | Planned |
| Demonstration recording | Yes | Planned | Planned |

The type-level abstractions (`GuiActionResult`, `GuiObservation`, `GuiGroundingProvider`) are platform-agnostic. Only the native execution backend is macOS-specific today.

## Key Files

| File | Purpose |
|------|---------|
| `runtime.ts` | `ComputerUseGuiRuntime` — main execution engine |
| `types.ts` | Action types, observation types, grounding provider interface |
| `capabilities.ts` | Platform detection and feature flags |
| `readiness.ts` | Permission and dependency readiness checks |
| `native-helper.ts` | macOS Swift native helper compilation and invocation |
| `demonstration-recorder.ts` | Screen recording + event capture for teach flows |

## Development

```bash
pnpm build      # tsc -p tsconfig.build.json
pnpm typecheck  # tsc --noEmit
pnpm test       # vitest
```
