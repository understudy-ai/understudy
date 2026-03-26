# GUI Action Matrix

This document describes the intended execution path for each built-in GUI tool, with `gui_click` as the reference path.

## Design Goals

- Reuse the same runtime path whenever two actions differ only in the native event that gets sent.
- Keep high-level tool semantics agent-friendly by providing good defaults, especially for targetless flows.
- Distinguish between point-execution grounding and region-observation grounding instead of forcing every tool into the `gui_click` model.

## Execution Families

### 1. Point Actions

`gui_click` handles all point-action variants through parameterization:

1. Capture the relevant GUI surface.
2. Visually ground the semantic target.
3. Require an explicit actionable point.
4. Send a native pointer event.
5. Capture post-action evidence.

The `button`, `clicks`, `holdMs`, and `settleMs` parameters control which native event is sent:

- `button: "left"` (default): left click
- `button: "right"`: right click (context menu)
- `clicks: 2`: double click
- `button: "none"`: hover with optional `settleMs`
- `holdMs`: press-and-hold with configurable duration

Internally, `resolveClickActionIntent()` maps these parameters to fine-grained grounding intents (`click`, `right_click`, `double_click`, `hover`, `click_and_hold`) so grounding providers can apply per-action prompts and stabilization.

### 2. Dual-Point Actions

`gui_drag` is a dual-point action:

1. Capture the relevant GUI surface.
2. Ground the drag source.
3. Ground the drag destination with source context attached.
4. Send the drag gesture.
5. Capture post-action evidence.

### 3. Region / Observation Actions

`gui_observe`, `gui_scroll`, and `gui_wait` are primarily region-based actions:

- They may ground to a visible element or container.
- They do not always require an explicit point.
- They should be able to work well in targetless mode when the current surface is enough.

`gui_wait` is special because it performs repeated region grounding over time instead of a single grounding pass.

### 4. Hybrid Input Actions

`gui_type` is a hybrid action:

1. If a `target` is provided, ground the editable interior.
2. Focus that editable surface.
3. Send text input.
4. Capture post-action evidence.

If no `target` is provided, it types into the currently focused control.

### 5. Keyboard-Only Actions

`gui_key` does not require visual grounding. It sends a single key or modifier+key combo.

### 6. Absolute Coordinate Actions

`gui_move` moves the cursor to absolute display coordinates without grounding. Use when the exact pixel position is already known.

## Matrix

| Tool | Family | Grounding | Grounding passes | Explicit point required | Default target behavior |
| --- | --- | --- | ---: | --- | --- |
| `gui_observe` | region / observation | optional | 0 or 1 | no | capture current surface when `target` is omitted |
| `gui_click` | point action | required | 1 | yes | requires semantic target |
| `gui_drag` | dual-point action | required | 2 | yes | requires `fromTarget` and `toTarget` |
| `gui_scroll` | region / observation | optional | 0 or 1 | no | targetless scroll is the common case |
| `gui_type` | hybrid input | optional | 0 or 1 | yes when targeted | type into focused control when `target` is omitted |
| `gui_key` | keyboard only | none | 0 | no | always targetless |
| `gui_wait` | region / observation | required | repeated | no | requires semantic target |
| `gui_move` | absolute coordinate | none | 0 | no | requires absolute `x`, `y` |

## Scroll Defaults

`gui_scroll` should optimize for the common agent flow of "keep going" rather than assuming the model already knows the exact scroll container and line count.

Current defaults:

- If `target` is omitted, use a targetless scroll on the current surface.
- If `distance` is omitted, default to:
  - `page` for targetless scrolls
  - `medium` for grounded container scrolls
- If `amount` is provided, it overrides `distance` and falls back to the legacy line-based path.

Semantic `distance` values should use viewport-aware scrolling whenever runtime context is available:

- `small`: about 25% of the visible span
- `medium`: about 50% of the visible span
- `page`: about 75% of the visible span, leaving some overlap

When the runtime cannot determine a reliable viewport size, it can still fall back to the legacy line-based approximation.

## Benchmark Coverage

The real GUI benchmark exercises a stable set of scenarios per execution family:

- `region_observation`: `observe_target`, `scroll_page_semantic`, `scroll_nested_targeted`, `observe_screenshot`, `wait_appear`, `wait_disappear`
- `point_action`: `click`, `click_location_hint_right`, `click_popup_display`, `click_right`, `click_double`, `click_hover`, `click_and_hold`
- `dual_point`: `drag_drop_zone`, `drag_reorder_list`
- `hybrid`: `type_targeted`
- `keyboard_only`: `key_enter`, `key_shift_k`

The benchmark lives in [runtime.real.test.ts](../packages/gui/src/__tests__/runtime.real.test.ts) and is opt-in so regular CI and local unit runs stay fast.

There is also a separate opt-in end-to-end validation path that uses the real OpenAI grounding provider instead of the in-test Playwright DOM fixture. That flow is meant for capability checks, not for the repeated benchmark loop.

### Running It

- `pnpm test:gui:real`
- `pnpm test:gui:real:grounding`
- `pnpm bench:gui:real`
- To increase repetitions: `UNDERSTUDY_REAL_GUI_BENCHMARK_ITERATIONS=3 pnpm bench:gui:real`

The grounding e2e path first tries the existing Understudy/Codex auth state, and only needs an explicit `OPENAI_API_KEY` or `UNDERSTUDY_GUI_GROUNDING_API_KEY` when no reusable local login is available.
