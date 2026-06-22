---
name: iphone-mirroring-basics
description: >-
  Reusable iPhone Mirroring operating contract for generic iPhone GUI work:
  recover from disconnection, return to the home screen, capture cropped
  screenshots, discover window bounds, and avoid brittle coordinate habits.
metadata:
  understudy:
    emoji: "📱"
---

# iphone-mirroring-basics

## Goal

Provide cross-device, cross-app rules for interacting with iPhone Mirroring in a
way that survives different iPhone models, icon layouts, and App Store/app UI
variants. All iPhone Mirroring workers and skills should read this file before
their first GUI action and follow its rules as defaults.

## Prerequisites

- **macOS 15+ (Sequoia)** with iPhone Mirroring enabled
- **iPhone** paired via System Settings → General → AirDrop & Handoff
- **Accessibility** and **Screen Recording** permissions granted to Understudy
- **Python 3 + Pillow** (optional) — for screenshot cropping; falls back to raw copy without it

## Core Contract

- Prefer semantic recovery over remembered pixels. Do not rely on "tap the bottom middle" or any other fixed coordinate habit that depends on device size, zoom, Dynamic Island, or current app layout.
- `gui_key key:"1" modifiers:["command"]` is the primary home-screen recovery action. Prefer it over guessing swipe/home-bar gestures.
- After every mutating GUI action, immediately `gui_observe` before deciding the next step.
- Reuse the latest GUI-reported `capture_rect` as the iPhone window bounds for screenshots. Do not rediscover the window with flaky AppleScript when a fresh GUI result already exposed the bounds.
- Use visible semantic targets such as an app icon label, a result row title, or an editable text field. Avoid taps justified only by relative position like "top-left card" or "second icon on row two" unless the UI truly offers no better cue.

## Disconnection Recovery Ladder

If the first observation shows a paused/disconnected surface such as `连接暂停`,
`Connection Paused`, `未找到iPhone`, `找不到iPhone`, `Retry`, or another obvious
not-connected state, do one bounded recovery ladder before calling the stage
blocked:

1. Click the visible `Continue`, `继续`, `Retry`, or equivalent recovery button once when present.
2. Observe again and wait only long enough to tell whether a live phone surface returned.
3. If still visibly disconnected, relaunch `iPhone Mirroring` once, observe again, and retry that recovery button once more.
4. If that single relaunch still does not reach a live phone surface, stop with a truthful blocker instead of pretending normal work began.

Wrong-branch guard: if a grounding attempt returns `not_found` while the latest
observation still visibly contains paused/disconnected evidence, treat that as
proof the worker stayed on the wrong branch. Return to this recovery ladder
immediately; do not keep searching for targets on the paused frame.

## Home-Screen Semantics

- Treat the verified home screen as the clean stage boundary for launch, install completion, exploration stop, and cleanup.
- After `command+1`, verify the home screen with a follow-up observation before assuming success.
- If the home screen is visible and the target app icon is obvious, tap the icon directly.
- If the icon is not obvious, do not guess grid coordinates across device sizes. Use Spotlight or another visible system search affordance as the fallback launch path.
- Use Spotlight only after the home screen is confirmed. Do not treat an arbitrary in-app search bar or App Store search control as a substitute for app launch.

## App Store Semantics

- Bottom App Store `Search` chrome is navigation, not the editable search field.
- A placeholder control such as `Games, Apps and more` only proves you reached the Search surface. It does not prove the caret is in the real editable field.
- Only type after the editable search field is clearly focused.
- When a stage uses a frozen device plan, follow that plan exactly. Do not improvise a different query, input strategy, or submit behavior just because the UI looks familiar.

## Secure-Field Semantics

- For password or other secure fields, only use the exact frozen input strategy authorized by the active skill or device plan.
- Do not probe secrets from the shell, do not retry the same password submission loop repeatedly, and do not mix input strategies mid-attempt unless the skill explicitly allows it.
- After one authorized secure-field submit, observe immediately and classify the outcome before taking any other action.

## Screenshot Capture

### Window Bounds

Prefer the latest GUI tool result `capture_rect` (or `pre_action_capture.capture_rect`).
Persist that `{x,y,width,height}` tuple and reuse it for screenshot capture.

If the GUI tool text does not expose numeric bounds, use the provided script:

```bash
BOUNDS_JSON="$(swift skills/iphone-mirroring-basics/scripts/get_mirroring_bounds.swift)"
export BOUNDS_JSON
```

This script discovers the iPhone Mirroring window via CoreGraphics window enumeration, handling both English ("iPhone Mirroring") and Chinese ("iPhone镜像") locales. It outputs JSON like `{"x": N, "y": N, "width": N, "height": N, "windowId": N}`.

Do **not** query window bounds with AppleScript such as `tell application "iPhone Mirroring" to get bounds of front window`; that path is flaky.

### Crop Insets

After capturing the raw window image, crop away the iPhone Mirroring chrome using the provided script:

```bash
python3 skills/iphone-mirroring-basics/scripts/crop_mirroring_screenshot.py <raw_path> <output_path>
```

The script removes the window chrome (title bar, borders) using proportional insets measured from macOS 15 iPhone Mirroring. These insets adapt to any window size. See the script source for exact ratios and rationale. Falls back to a raw copy if Pillow is unavailable.

### Preferred One-Step Capture Helper

When you only need the final cropped screenshot artifact, prefer the helper below instead of improvising `mktemp` names by hand:

```bash
python3 skills/iphone-mirroring-basics/scripts/capture_mirroring_screenshot.py <output_path>
```

- The helper resolves bounds from `BOUNDS_JSON` when available, otherwise falls back to `get_mirroring_bounds.swift`.
- It uses a unique temp file internally, prefers `screencapture -l <windowId>` to capture the real `iPhone Mirroring` window directly, falls back to `-R...` only when needed, crops the image, and cleans up the raw temporary file automatically.
- Prefer this helper for stage screenshots so concurrent or repeated runs do not collide on fragile `mktemp ... XXXX.png` naming.

### Preferred One-Step Clip Helper

When you need a short motion proof clip, prefer the helper below instead of recording the whole display:

```bash
python3 skills/iphone-mirroring-basics/scripts/capture_mirroring_clip.py <output_path> --duration 15
```

- The helper resolves bounds from `BOUNDS_JSON` when available, otherwise falls back to `get_mirroring_bounds.swift`.
- It prefers `screencapture -l <windowId> -V <duration>` so the recording is attached to the real `iPhone Mirroring` window instead of an entire display.
- After the raw recording finishes, it crops away the same proportional window chrome used by screenshot capture and writes a clean `.mov`.
- Fall back to display-wide recording only when this helper truly cannot be used.

## Fallback Philosophy

- Prefer short bounded recovery ladders over free-form recovery.
- If a semantic recovery path fails twice on the same surface, stop and report the blocker instead of escalating into coordinate guessing.
- When the UI offers both a semantic path and a pixel-memory path, always choose the semantic one even if it feels slightly slower.

## Chrome Extension Relay Bootstrap

When a skill needs the Understudy Chrome extension relay (for browser-based
stages like App Store browsing or YouTube upload):

1. On the first browser call, request `browserConnectionMode: "auto"`.
2. If the relay is unavailable, resolve the repo root with `git rev-parse --show-toplevel` and run `node "$REPO_ROOT/understudy.mjs" browser extension install managed`.
3. The install command seeds relay port and gateway token into the bundle.
4. If Chrome already had the extension loaded and relay shows `HTTP 401`, reload the unpacked extension once from `chrome://extensions`.
5. Only if the seeded config still fails after one reload may you open the extension options page and click `Save`.
6. Once the intended tab is attached, continue with `browserConnectionMode: "extension"`.
