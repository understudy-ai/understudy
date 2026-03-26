---
name: taught-create-a-background-removed-portrait-for-a-requested-person-and-send-it-in-telegram-cd861a
description: "Produce a background-removed portrait image for a requested person and send it through Telegram. Primary surface: Google Chrome, Pixelmator Pro, Telegram. Inputs: Person or image search query, Telegram recipient/chat, Optional existing image file.... Trigger cues: Google Chrome Search | Google Chrome Person or image search query, Telegram recipient/chat, Optional existing image... | Produce a background-removed portrait image for a requested person and send it through Telegram."
triggers:
  - "Google Chrome Search"
  - "Google Chrome Person or image search query, Telegram recipient/chat, Optional existing image..."
  - "Produce a background-removed portrait image for a requested person and send it through Telegram"
  - "Produce and send a clean transparent cutout image for a requested person via Telegram"
  - "A transparent-background image sent to the specified Telegram chat, with no caption by default"
metadata:
  understudy:
    artifactKind: "skill"
    taught: true
    workspaceDir: "/Users/songliang/workspace/Understudy/understudy"
    draftId: "f2109223f596"
    runId: "video-092f5f12aa73"
    routeSignature: "gui -> gui -> gui -> gui"
---

# taught-create-a-background-removed-portrait-for-a-requested-person-and-send-it-in-telegram-cd861a

This workspace skill was taught from an explicit teach draft captured in `/Users/songliang/workspace/Understudy/understudy`.

## Overall Goal

Produce and send a clean transparent cutout image for a requested person via Telegram.

## Staged Workflow

1. Obtain a suitable portrait image for the requested person, using a provided local file or direct image URL when available, otherwise finding a clear single-subject portrait from an acceptable source.
   Notes: Prefer a source image with minimal occlusion and enough separation from the background for reliable cutout.
2. Open the chosen image in an editor that can remove backgrounds and produce a transparent PNG.
   Notes: The demo used Pixelmator Pro for the background-removal step.
3. Remove the background and verify that the subject is isolated cleanly on transparency before delivery.
   Notes: Do not send obvious cutout failures; visually confirm the result first.
4. Open the target Telegram chat, attach the processed transparent image, and send it with no caption by default.
   Notes: Captionless delivery is the confirmed default behavior.

## GUI Reference Path

The GUI reference path below is for replay and grounding reference only.

1. Open a suitable portrait result from the image grid.
   target: image result tile showing the requested person in the Google Images results grid | app: Google Chrome | scope: Google Images results page
2. Open the source image in Pixelmator Pro or another installed editor with visible background-removal capability.
   reference: [preferred] [gui/gui_click] | when: When performing the native desktop editing flow shown in the demo. | notes: The demonstrated editing path was desktop-native rather than browser-native. | target: menu item "Remove Background" in the image editor | app: Pixelmator Pro | scope: editor menu or command surface
3. Run the editor's background-removal action and verify that a transparent result is shown.
   reference: [preferred] [gui/gui_click] | when: When using Pixelmator Pro or a similar native editor UI. | notes: This is the core transformation step demonstrated in the recording. | target: menu item "Remove Background" in the image editor | app: Pixelmator Pro | scope: editor menu or command surface
4. Open Telegram, choose the target chat, attach the processed transparent image, and send it without a caption by default.
   reference: [preferred] [gui/gui_click] | when: When using Telegram desktop for delivery. | notes: Observed delivery route in the demo, with confirmed default caption behavior. | target: paperclip icon button next to the message input in Telegram | app: Telegram | scope: chat composer

## Tool Route Options

These route options are references only. Choose the best route at runtime based on the current surface, available capabilities, and the need to preserve the same externally visible result.

1. Obtain a suitable portrait image for the requested person, using a provided local file or direct image URL when available, otherwise finding a clear single-subject portrait from an acceptable source.
   - [preferred] [skill/taught-person-photo-cutout-bc88ec] Use the existing end-to-end workspace skill when the request matches this workflow closely.
     When: When the task is simply to create a person cutout and send it in Telegram.
     Notes: Best-fit reusable route in the current capability snapshot.
   - [fallback] [browser/browser] Use browser-based image discovery to find a promising portrait result when no direct image source is provided.
     When: When not delegating to the full skill and a source image still needs to be found.
     Notes: Usually more reliable than raw GUI interaction for web discovery.
   - [fallback] [shell/exec] Use a direct local file path or image URL as the source image when one is already available.
     When: When the operator already has the image locally or can fetch it directly without interactive browsing.
     Notes: Avoid unnecessary image search when a usable source is already supplied.
2. Open the chosen image in an editor that can remove backgrounds and produce a transparent PNG.
   - [preferred] [gui/gui_click] Open the source image in Pixelmator Pro or another installed editor with visible background-removal capability.
     When: When performing the native desktop editing flow shown in the demo.
     Notes: The demonstrated editing path was desktop-native rather than browser-native.
3. Remove the background and verify that the subject is isolated cleanly on transparency before delivery.
   - [preferred] [gui/gui_click] Run the editor's background-removal action and verify that a transparent result is shown.
     When: When using Pixelmator Pro or a similar native editor UI.
     Notes: This is the core transformation step demonstrated in the recording.
4. Open the target Telegram chat, attach the processed transparent image, and send it with no caption by default.
   - [preferred] [gui/gui_click] Open Telegram, choose the target chat, attach the processed transparent image, and send it without a caption by default.
     When: When using Telegram desktop for delivery.
     Notes: Observed delivery route in the demo, with confirmed default caption behavior.

## Task Kind

parameterized_workflow

## Parameter Slots

- personquery: Sam Altman
- telegramrecipient: Alex
- imagesource: https://example.com/portrait.png

## Task Card

- Goal: Produce a background-removed portrait image for a requested person and send it through Telegram.
- Scope: Source-image acquisition or direct-source intake, background removal, and Telegram delivery.
- Inputs: personQuery; telegramRecipient; optional imageSource
- Extract: a suitable portrait image; the processed transparent PNG
- Formula: None captured.
- Filter: Prefer a clear single-person portrait with minimal occlusion and enough separation from the background for reliable cutout.
- Output: A transparent-background image sent to the specified Telegram chat, with no caption by default.

## Compose With Skills

- taught-person-photo-cutout-bc88ec: Existing workspace skill already matches the demonstrated end-to-end task closely and should be preferred when appropriate.

## Replay Preconditions

- A browser is available if a source image must be found on the web.
- An image editor capable of background removal is installed and usable.
- Telegram desktop is signed in and the target chat is accessible.
- The agent can save, open, and attach local image files.

## Reset Signals

- The source image has been obtained locally and is ready for editing.
- The editor shows a completed transparent-background result.
- Telegram shows either the media preview ready to send or the sent image in the target chat.

## Success Criteria

- A suitable portrait image for the requested person is obtained from search or a provided source.
- The image background is removed and the subject is isolated on transparency.
- The final transparent image is sent to the specified Telegram chat.
- The delivered result matches the requested person closely enough to be useful.
- The Telegram delivery defaults to no caption unless the operator explicitly adds one.

## Validation Status

Teach draft derived from session-channel_sender-terminal-understudy-chat-7a2188da-753c-4e1f-a42d-26b64169c6cf-ws_e0d24ce7bd98-1774542166309.mov; replay validation has not been run yet.
Validation mode: replay

## Execution Strategy

- Tool binding: adaptive
- Preferred routes: skill -> browser -> shell -> gui
- Detailed steps: fallback_replay
- Prefer the existing workspace skill when it preserves the same externally visible outcome.
- Prefer browser for web image discovery over raw GUI replay when not delegating to the full skill.
- Use GUI for native desktop app steps such as Pixelmator Pro and Telegram when direct higher-level routes are not available.
- Treat the recorded GUI sequence as evidence and fallback replay, not as a strict requirement.
## Detailed GUI Replay Hints

Use these structured step details as fallback replay hints when a higher-level route is unavailable or would change the task semantics.

1. [gui/gui_click] Activate the image-search input in Google Images.
   target: search field with placeholder "Search" on the Google Images page | app: Google Chrome | scope: Google Images page | captureMode: window | groundingMode: single | locationHint: top-center page area | windowTitle: Google Images - Google Chrome
   toolArgs: button=left
   verify: The search field is focused and ready for typing.
2. [gui/gui_click] Open a suitable portrait result from the image grid.
   target: image result tile showing the requested person in the Google Images results grid | app: Google Chrome | scope: Google Images results page | captureMode: window | groundingMode: complex | locationHint: main results grid | windowTitle: Google Search - Google Chrome
   toolArgs: button=left
   verify: A larger preview or source view opens for the selected image.
3. [gui/gui_click] Run the visible background-removal command in the image editor.
   target: menu item "Remove Background" in the image editor | app: Pixelmator Pro | scope: editor menu or command surface | captureMode: display | groundingMode: single | locationHint: top menu area | windowTitle: Pixelmator Pro
   toolArgs: button=left
   verify: The editor starts or completes background removal for the opened image.
4. [gui/gui_click] Attach the processed image in Telegram and send it.
   target: paperclip icon button next to the message input in Telegram | app: Telegram | scope: chat composer | captureMode: window | groundingMode: single | locationHint: bottom compose area | windowTitle: Telegram
   toolArgs: button=left
   verify: Telegram opens an attachment flow and the image is subsequently sent to the selected chat.

## Failure Policy

- Use `gui_observe` before each `gui_click`/`gui_type` to confirm the target is visible on the current surface.
- Use `groundingMode: "single"` for clearly labeled one-match controls such as a top-menu item, dialog action, tab, or row. Escalate to `groundingMode: "complex"` after any grounding failure or when the UI is dense/ambiguous.
- Use `captureMode: "display"` for menu bar, Dock, or cross-window operations; `captureMode: "window"` for in-app work.
- Describe targets using visible text labels from the current screenshot, not memorized positions from the teach recording.
- Re-observe the UI after each significant state change.
- Prefer reusing linked workspace skills for matching substeps before falling back to raw UI replay.
- If the route diverges or verification weakens, replan instead of blindly replaying the taught steps.
- Ask the user for missing parameters when the current request does not fully match the taught draft.
