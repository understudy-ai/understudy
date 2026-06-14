# @understudy/gui

Native GUI runtime for Understudy — screenshot-grounded desktop automation.

## What This Package Does

- **GUI action execution**: 8 tool-facing actions (`observe`, `click`, `drag`, `scroll`, `type`, `key`, `wait`, `move`) with click sub-modes for right-click, double-click, hover-only, and click-and-hold
- **Screenshot grounding**: LLM-based target resolution from screenshots via pluggable `GuiGroundingProvider`
- **Platform backends**: Swift-based macOS helper plus a PowerShell-backed Windows GUI runtime
- **Graceful degradation**: dynamically disables tools based on available permissions (Accessibility, Screen Recording)
- **Demonstration recorder**: screen + event capture for teach-by-demonstration workflows
- **Readiness checks**: platform detection, permission status, and native helper availability

## Platform Support

| Capability | macOS | Linux | Windows |
|-----------|:-----:|:-----:|:-------:|
| Screenshot capture | Yes | Planned | Yes |
| Native input events | Yes | Planned | Yes |
| Window-targeted capture | Yes | Planned | Partial |
| Demonstration recording | Yes | Planned | No |

The type-level abstractions (`GuiActionResult`, `GuiObservation`, `GuiGroundingProvider`) are platform-agnostic.

Windows currently supports `gui_observe`, `gui_wait`, `gui_key`, `gui_type`, `gui_click`, `gui_drag`, `gui_scroll`, and `gui_move` through PowerShell-backed capture/input helpers. The current Windows path supports app or window-title activation, full-display capture, and foreground-window capture, but not window-index selection or teach-by-demonstration recording yet.

## Key Files

| File | Purpose |
|------|---------|
| `runtime.ts` | `ComputerUseGuiRuntime` — main execution engine |
| `platform.ts` | Platform backend interface and backend resolution |
| `platform-macos.ts` / `platform-windows.ts` | Platform readiness and tool support matrices |
| `platform-macos-input.ts` / `platform-windows-input.ts` | Platform-specific text and hotkey input adapters |
| `types.ts` | Action types, observation types, grounding provider interface |
| `capabilities.ts` | Platform detection and feature flags |
| `readiness.ts` | Permission and dependency readiness checks |
| `native-helper.ts` | macOS Swift native helper compilation and invocation |
| `physical-resource-lock.ts` | Cross-session lock for physical GUI resources |
| `gui-action-session.ts` | Action session lifecycle, aborts, and cleanup |
| `demonstration-recorder.ts` | Screen recording + event capture for teach flows |

## Development

```bash
pnpm build      # tsc -p tsconfig.build.json
pnpm typecheck  # tsc --noEmit
pnpm test       # vitest
```
