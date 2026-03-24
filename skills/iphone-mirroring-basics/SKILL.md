---
name: iphone-mirroring-basics
description: >-
  Reusable iPhone Mirroring operating contract for generic iPhone GUI work:
  recover the home screen, distinguish navigation chrome from editable fields,
  launch apps safely, and avoid brittle coordinate habits.
metadata:
  understudy:
    emoji: "📱"
---

# iphone-mirroring-basics

## Goal

Provide cross-device, cross-app rules for interacting with iPhone Mirroring in a
way that survives different iPhone models, icon layouts, and App Store/app UI
variants.

## Core Contract

- Prefer semantic recovery over remembered pixels. Do not rely on "tap the bottom middle" or any other fixed coordinate habit that depends on device size, zoom, Dynamic Island, or current app layout.
- `gui_key key:"1" modifiers:["command"]` is the primary home-screen recovery action. Prefer it over guessing swipe/home-bar gestures.
- After every mutating GUI action, immediately `gui_observe` before deciding the next step.
- Reuse the latest GUI-reported `capture_rect` as the iPhone window bounds for screenshots. Do not rediscover the window with flaky AppleScript when a fresh GUI result already exposed the bounds.
- Use visible semantic targets such as an app icon label, a result row title, or an editable text field. Avoid taps justified only by relative position like "top-left card" or "second icon on row two" unless the UI truly offers no better cue.

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

## Fallback Philosophy

- Prefer short bounded recovery ladders over free-form recovery.
- If a semantic recovery path fails twice on the same surface, stop and report the blocker instead of escalating into coordinate guessing.
- When the UI offers both a semantic path and a pixel-memory path, always choose the semantic one even if it feels slightly slower.
