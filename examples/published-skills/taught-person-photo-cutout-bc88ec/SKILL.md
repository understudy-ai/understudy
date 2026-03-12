---
name: taught-person-photo-cutout-bc88ec
description: "Create a background-removed image for a requested person or image query and send it in Telegram. Primary surface: Google Chrome, Pixelmator Pro, Telegram. Inputs: Person or image search query, Telegram chat. Trigger cues: Google Chrome Edit | Google Chrome Person or image search query, Telegram chat | Create a background-removed image for a requested person or image query and send it in Telegram."
triggers:
  - "Google Chrome Edit"
  - "Google Chrome Person or image search query, Telegram chat"
  - "Create a background-removed image for a requested person or image query and send it in Telegram"
  - "Create a background-removed image for a requested person or image query, preserve transparency as-is, export the edit..."
  - "A Telegram image message containing the exported edited result, named with a suffix of \" without background\""
metadata:
  understudy:
    taught: true
    workspaceDir: "/Users/songliang/workspace/Understudy/understudy"
    draftId: "09519568afd5"
    runId: "video-c6e4cd2253bd"
    routeSignature: "gui -> gui -> gui -> gui -> gui -> gui -> gui -> gui"
---

# taught-person-photo-cutout-bc88ec

> Example published skill artifact. This file lives under `examples/` so it is not auto-loaded as a real workspace skill.

This workspace skill was taught from an explicit teach draft captured in `/Users/songliang/workspace/Understudy/understudy`.

## Overall Goal

Create a background-removed image for a requested person or image query, preserve transparency as-is, export the edited result with a filename ending in " without background", and send it to a specified Telegram chat.

## Staged Workflow

1. Search for the requested person or image query and open the first original image result.
   Notes: Use the original image/source view rather than only the search thumbnail preview.
2. Download the opened image locally and save it with an appropriate filename.
   Notes: Prefer a stable, descriptive filename that can later be extended with " without background" for the edited export.
3. Open the saved image in Pixelmator Pro and run Edit > Remove Background to isolate the subject.
   Notes: Verify visually that the background has been removed cleanly before exporting.
4. Export the edited file with a filename ending in " without background" while preserving transparency as-is.
   Notes: This naming rule avoids conflicts with the source file.
5. Open Telegram, go to the requested chat, attach the exported image, and send it.
   Notes: Verify completion by confirming the new image message appears in the target chat.

## GUI Reference Path

The GUI reference path below is for replay and grounding reference only.

1. Use Google Chrome on the desktop to focus the image search page, enter the requested query, submit it, and open the first original image result.
   reference: [observed] [gui/gui_click] | when: When following the demonstrated desktop route or when browser control is unavailable. | notes: Use gui_type and gui_keypress as needed.
2. Use the visible browser page or source image view to download the image and save it with an appropriate filename.
   reference: [observed] [gui/gui_click] | when: When following the observed replay path. | notes: The user clarified that the first original image should be opened, downloaded, and saved with an appropriate filename.
3. Open the downloaded image in Pixelmator Pro and use the top menu path Edit > Remove Background.
   reference: [preferred] [gui/gui_click] | when: When editing in the native desktop app. | notes: Use gui_read or gui_wait as needed to confirm the editor state and background-removal result. | target: menu item "Edit" in the macOS top menu bar, then menu item "Remove Background" | app: Pixelmator Pro | scope: macOS top menu bar and Pixelmator Pro editor window
4. Export the edited image with a filename ending in " without background" while preserving transparency as-is.
   reference: [preferred] [gui/gui_click] | when: When saving the final deliverable from Pixelmator Pro. | notes: Use a distinct filename to avoid conflicts with the downloaded source image. | target: visible export or save control, then the filename field showing the edited output name | app: Pixelmator Pro | scope: editor window and export/save dialog
5. Open Telegram, go to the requested chat, attach the exported image, and send it.
   reference: [preferred] [gui/gui_click] | when: When delivering through the native Telegram desktop app. | notes: Verify the send by confirming the newly sent image appears in the chat history. | target: chat matching "{{targetchat}}", attachment control, exported image file, and send button | app: Telegram | scope: chat list, file chooser, and media composer

## Tool Route Options

These route options are references only. Choose the best route at runtime based on the current surface, available capabilities, and the need to preserve the same externally visible result.

1. Search for the requested person or image query and open the first original image result.
   - [preferred] [browser/browser] Use a controllable browser tab to search for the requested query and open the first original image result.
     When: When browser control is available.
     Notes: Best balance of speed and verification for discovery and source selection.
   - [observed] [gui/gui_click] Use Google Chrome on the desktop to focus the image search page, enter the requested query, submit it, and open the first original image result.
     When: When following the demonstrated desktop route or when browser control is unavailable.
     Notes: Use gui_type and gui_keypress as needed.
2. Download the opened image locally and save it with an appropriate filename.
   - [preferred] [browser/browser] Download the opened original image from the browser into Downloads and save it with an appropriate filename.
     When: When the browser session can save files directly.
     Notes: Prefer a stable reusable filename.
   - [fallback] [shell/exec] Download the image directly into Downloads once the exact trusted image URL has already been identified.
     When: When direct download is simpler than a browser save flow.
     Notes: Use only after source selection is complete.
   - [observed] [gui/gui_click] Use the visible browser page or source image view to download the image and save it with an appropriate filename.
     When: When following the observed replay path.
     Notes: The user clarified that the first original image should be opened, downloaded, and saved with an appropriate filename.
3. Open the saved image in Pixelmator Pro and run Edit > Remove Background to isolate the subject.
   - [preferred] [gui/gui_click] Open the downloaded image in Pixelmator Pro and use the top menu path Edit > Remove Background.
     When: When editing in the native desktop app.
     Notes: Use gui_read or gui_wait as needed to confirm the editor state and background-removal result.
4. Export the edited file with a filename ending in " without background" while preserving transparency as-is.
   - [preferred] [gui/gui_click] Export the edited image with a filename ending in " without background" while preserving transparency as-is.
     When: When saving the final deliverable from Pixelmator Pro.
     Notes: Use a distinct filename to avoid conflicts with the downloaded source image.
5. Open Telegram, go to the requested chat, attach the exported image, and send it.
   - [preferred] [gui/gui_click] Open Telegram, go to the requested chat, attach the exported image, and send it.
     When: When delivering through the native Telegram desktop app.
     Notes: Verify the send by confirming the newly sent image appears in the chat history.

## Task Kind

parameterized_workflow

## Parameter Slots

- searchquery: sam altman
- targetchat: Test

## Task Card

- Goal: Create a background-removed image for a requested person or image query and send it in Telegram.
- Scope: Image discovery, local download, background removal in Pixelmator Pro, export with a non-conflicting filename, and Telegram delivery.
- Inputs: Person or image search query; Telegram chat
- Extract: First original image result; Edited image ready to send
- Formula: None captured.
- Filter: Use the first original image result from the search results. Prefer an image that is clear enough for clean background removal.
- Output: A Telegram image message containing the exported edited result, named with a suffix of " without background".

## Compose With Skills

- No existing workspace skills were linked to this taught task.

## Replay Preconditions

- Google Chrome, Pixelmator Pro, and Telegram are installed and can be brought to the foreground.
- Telegram is already signed in and the target chat is reachable.
- Internet access is available for image search and download.
- Pixelmator Pro can open local image files from Downloads and export edited images.

## Reset Signals

- No blocking modal dialogs are open in Pixelmator Pro.
- Telegram has no pending unsent media composer open.
- Any temporary browser preview, file picker, save dialog, or context menu from a previous run is dismissed.

## Success Criteria

- The first original image result matching the requested query is opened and downloaded locally.
- The downloaded image is saved with an appropriate local filename.
- The image is edited in Pixelmator Pro using Edit > Remove Background so the subject is isolated from the background.
- The edited result is exported with a filename ending in " without background" to avoid filename conflicts.
- Transparency is preserved as-is in the exported file.
- The exported image is sent to the specified Telegram chat.
- The target Telegram chat visibly shows the newly sent image message.

## Validation Status

Teach draft derived from session-channel_sender-terminal-understudy-chat-ws_e0d24ce7bd98-1773306443594.mov; replay validation has not been run yet.
Validation mode: replay

## Execution Strategy

- Tool binding: adaptive
- Preferred routes: browser -> shell -> gui
- Detailed steps: fallback_replay
- Prefer browser control for image discovery because it is faster and easier to verify than replaying the desktop browser UI.
- Use shell only as a helper when a final trusted image URL is already known or when a direct download/export helper is simpler.
- Use GUI for Pixelmator Pro editing and Telegram delivery because those are native-app interactions in the demonstrated workflow.
- Treat the observed GUI sequence as evidence, not as a strict execution ceiling.
## Detailed GUI Replay Hints

Use these structured step details as fallback replay hints when a higher-level route is unavailable or would change the task semantics.

1. [gui/gui_click] Focus the image-search page in Google Chrome.
   target: page showing image search results or tab containing the image search | app: Google Chrome | scope: browser window | captureMode: window | groundingMode: single | locationHint: top tab strip or main page | windowTitle: Google Chrome
   verify: The image-search UI is visible and ready for input.
2. [gui/gui_type] Enter the requested image query and submit it.
   target: search field with the visible image-search input area | app: Google Chrome | scope: browser content area | captureMode: window | groundingMode: single | locationHint: top or center of page | windowTitle: Google Chrome
   inputs: value="{{searchquery}}"
   verify: Search results for the requested query are displayed.
3. [gui/gui_click] Open the first original image result from the search results.
   target: the first image result matching the query, then the visible original image or source-image view | app: Google Chrome | scope: search results page or opened source page | captureMode: window | groundingMode: complex | locationHint: main results area or preview pane | windowTitle: Google Chrome
   verify: The original image is opened, not just the results-grid thumbnail.
4. [gui/gui_click] Download the opened image and save it locally with an appropriate filename.
   target: visible download or save control for the opened image, then the filename field in the save dialog | app: Google Chrome | scope: browser window and save dialog | captureMode: window | groundingMode: complex | locationHint: image toolbar, context menu, or save dialog center area | windowTitle: Google Chrome
   verify: The image is saved locally in Downloads with an appropriate filename.
5. [gui/gui_click] Open the saved image in Pixelmator Pro.
   target: button labeled "Browse images on Mac" or equivalent open-image control, then the downloaded image file in Downloads | app: Pixelmator Pro | scope: welcome window or open dialog | captureMode: window | groundingMode: complex | locationHint: center welcome panel and file list | windowTitle: Pixelmator Pro
   verify: The chosen image is visible on the Pixelmator Pro canvas.
6. [gui/gui_click] Use Pixelmator Pro's top menu path Edit > Remove Background.
   target: menu item "Edit" in the macOS top menu bar, then menu item "Remove Background" | app: Pixelmator Pro | scope: macOS top menu bar and Pixelmator Pro editor window | captureMode: display | groundingMode: complex | locationHint: top-left menu bar | windowTitle: Pixelmator Pro
   verify: The subject appears isolated and the background is visibly removed.
7. [gui/gui_click] Export the edited image with a filename ending in " without background".
   target: visible export or save control, then the filename field showing the edited output name | app: Pixelmator Pro | scope: editor window and export/save dialog | captureMode: window | groundingMode: complex | locationHint: top menu bar or centered export dialog | windowTitle: Pixelmator Pro
   inputs: filenameSuffix="without background"
   verify: The edited file is exported successfully with transparency preserved as-is and a filename ending in " without background".
8. [gui/gui_click] Open Telegram, go to the requested chat, attach the exported image, and send it.
   target: chat matching "{{targetchat}}", attachment control, exported image file, and send button | app: Telegram | scope: chat list, file chooser, and media composer | captureMode: window | groundingMode: complex | locationHint: left sidebar then bottom composer area | windowTitle: Telegram
   verify: The target chat shows the newly sent image message.

## Failure Policy

- Use `gui_read` before each `gui_click`/`gui_type` to confirm the target is visible on the current surface.
- Use `groundingMode: "complex"` after any grounding failure or when the UI is dense/ambiguous.
- Use `captureMode: "display"` for menu bar, Dock, or cross-window operations; `captureMode: "window"` for in-app work.
- Describe targets using visible text labels from the current screenshot, not memorized positions from the teach recording.
- Re-observe the UI after each significant state change.
- Prefer reusing linked workspace skills for matching substeps before falling back to raw UI replay.
- If the route diverges or verification weakens, replan instead of blindly replaying the taught steps.
- Ask the user for missing parameters when the current request does not fully match the taught draft.
