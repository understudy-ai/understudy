---
name: app-review-pipeline
description: >-
  Hand-written Phase 1 playbook for selecting a current App Store app, installing
  it through iPhone Mirroring, exploring it from the home screen, composing a
  short review video, optionally publishing it, and restoring the device state.
metadata:
  understudy:
    emoji: "📱"
    artifactKind: "playbook"
    requires:
      bins: ["ffmpeg", "screencapture"]
    triggers:
      - "app review"
      - "iphone review"
      - "review an app"
      - "app review pipeline"
      - "iphone app review pipeline"
    childArtifacts:
      - name: "appstore-browser-package"
        artifactKind: "worker"
        required: true
      - name: "appstore-device-search-detail"
        artifactKind: "worker"
        required: true
      - name: "appstore-install-home"
        artifactKind: "worker"
        required: true
      - name: "app-explore"
        artifactKind: "skill"
        required: true
      - name: "capcut-edit"
        artifactKind: "skill"
        required: true
      - name: "youtube-upload"
        artifactKind: "skill"
        required: true
      - name: "app-review-cleanup"
        artifactKind: "skill"
        required: true
---

# app-review-pipeline

## Goal

Run one complete hand-authored iPhone app review episode on top of the generic
playbook runtime:

1. use the browser to find a current App Store recommendation or a forced target app
2. use iPhone Mirroring GUI control to install it and return to the iPhone home screen
3. open it from the home screen and collect review evidence
4. compose a vertical short from the collected text and screenshots
5. only when the cut and publish inputs are actually ready and `publishNow=true`, prepare the YouTube publish surface and optionally complete the publish
6. remove the app and leave the phone ready for the next run

Phase 1 should close the install -> explore -> edit -> publish -> cleanup loop
without depending on a separate review-model pass. The optional
`video-review-feedback` skill can still be run later as a future/manual Phase 4
quality gate, and `youtube-upload` should consume `review/video-feedback.json`
only when that file already exists. The Phase 1 implementation should keep
demo-specific behavior in these hand-written skills and natural-language
artifacts, not in special-cased core runtime logic.

## Inputs

- `artifactsRootDir`
- `selectionMode` — default to `today_editorial_free_app`
- `targetApp` — optional override for a fixed app name
- `appStoreRegion` — optional locale such as `us` or `hk`
- `allowAppleIdPasswordFromEnv` — default `false`; when explicitly enabled, Stage 1 may use secret env typing on a standard Apple ID password sheet
- `appleIdPasswordEnvVar` — optional env var name for the Apple ID password; default `UNDERSTUDY_APPLE_ID_PASSWORD`
- `publishNow` — `true` to complete the upload, otherwise stop after the reviewed final video plus publish preview package
- `publishVisibility` — default `unlisted`

## Output Contract

- `manifest.json`
- `topic/candidates.json`
- `topic/selection-notes.md`
- `topic/app-store-listing.json`
- `topic/screenshots/00-Browser-Today-Recommendation.png`
- `topic/screenshots/01-Browser-App-Detail.png`
- `topic/screenshots/02-iPhone-App-Store-Detail.png`
- `topic/screenshots/03-Home-Screen-With-App.png`
- `experience/notes.json`
- `experience/review-brief.md`
- `experience/story-beats.md`
- `experience/checkpoints.jsonl`
- `experience/clips/01-Core-Loop.mov` when a safe motion proof beat was captured
- `experience/screenshots/01-First-Screen.png`
- `experience/screenshots/02-Main-Screen.png`
- `experience/screenshots/03-Core-Task.png`
- `experience/screenshots/04-Outcome-Or-Friction.png`
- `post/video-plan.md`
- `post/capcut-shot-list.md`
- `post/capcut-import-manifest.json`
- `post/capcut-import-path.txt`
- `post/assets/narration.txt`
- `post/capcut-edit-note.md`
- `post/final-video.mp4`
- `publish/youtube.json`
- `publish/preview.md`
- `publish/result.json`
- `topic/screenshots/99-Clean-Home-Screen.png`

## Approval Gates

- Final publication is only allowed when `publishNow=true`.
- Even when `publishNow=true`, do not enter the real publish path if an optional `review/video-feedback.json` already exists and says the cut still needs revision or deeper evidence.

## Stage Plan

1. [worker] appstore-browser-package -> Use the browser to lock today's App Store candidate, preserve already-seen backups, and write the frozen browser package before any iPhone Mirroring work | inputs: artifactsRootDir,selectionMode,targetApp,appStoreRegion,allowAppleIdPasswordFromEnv,appleIdPasswordEnvVar | outputs: manifest.json,topic/candidates.json,topic/selection-notes.md,topic/app-store-listing.json,topic/device-action-plan.json,topic/device-action-plan.md,topic/screenshots/00-Browser-Today-Recommendation.png,topic/screenshots/01-Browser-App-Detail.png | retry: retry_once
2. [worker] appstore-device-search-detail -> Use the frozen device plan to reach the exact App Store detail page on the mirrored iPhone and capture `02` before any install tap | inputs: artifactsRootDir,selectionMode,targetApp,appStoreRegion,allowAppleIdPasswordFromEnv,appleIdPasswordEnvVar | outputs: topic/screenshots/02-iPhone-App-Store-Detail.png,manifest.json,experience/checkpoints.jsonl | retry: retry_once
3. [worker] appstore-install-home -> Starting from the validated device detail page, complete the install or fail truthfully, then stop on the iPhone home screen with a real installed-app `03` success boundary | inputs: artifactsRootDir,selectionMode,targetApp,appStoreRegion,allowAppleIdPasswordFromEnv,appleIdPasswordEnvVar | outputs: manifest.json,topic/candidates.json,topic/selection-notes.md,topic/app-store-listing.json,experience/checkpoints.jsonl,topic/screenshots/03-Home-Screen-With-App.png | retry: retry_once
4. [skill] app-explore -> Launch the installed app from the home screen, capture review evidence, prefer one short live iPhone proof clip when safe, and return to the home screen | inputs: artifactsRootDir,targetApp | outputs: experience/notes.json,experience/review-brief.md,experience/story-beats.md,experience/checkpoints.jsonl,experience/screenshots/01-First-Screen.png,experience/screenshots/02-Main-Screen.png,experience/screenshots/03-Core-Task.png,experience/screenshots/04-Outcome-Or-Friction.png | retry: pause_for_human
5. [skill] capcut-edit -> Compose the short review video from Stage 1 and Stage 2 artifacts | inputs: artifactsRootDir | outputs: post/video-plan.md,post/capcut-shot-list.md,post/capcut-import-manifest.json,post/capcut-import-path.txt,post/assets/narration.txt,post/capcut-edit-note.md,post/final-video.mp4 | retry: retry_once
6. [skill] youtube-upload -> Prepare YouTube metadata and optionally complete the upload using publishNow and publishVisibility. If optional review feedback already exists and is not ready, stop at preview or blocked-with-note instead of publishing. | inputs: artifactsRootDir,publishNow,publishVisibility | outputs: publish/youtube.json,publish/preview.md,publish/result.json | retry: pause_for_human
7. [skill] app-review-cleanup -> Delete the reviewed app, capture a clean home screen, and finalize the run state | inputs: artifactsRootDir | outputs: topic/screenshots/99-Clean-Home-Screen.png,manifest.json | retry: retry_once

## Failure Policy

- Preserve partial artifacts between retries.
- Treat the iPhone home screen as the stage boundary between install, explore, and cleanup.
- If Stage 2 cannot reach `topic/screenshots/02-iPhone-App-Store-Detail.png`, stop there and fail the playbook instead of drifting into install or exploration without a truthful device detail boundary.
- If Stage 3 cannot reach `topic/screenshots/03-Home-Screen-With-App.png`, stop there and fail the playbook instead of drifting into Stage 4 with an uninstalled app.
- If Stage 2 blocks before the App Store detail page is reachable on device, preserve the truthful blocker artifact such as `topic/screenshots/02-iPhone-Mirroring-Disconnected.png` instead of fabricating success-path screenshots.
- If a GUI action misses twice on the same target, stop and report the blocker instead of guessing.
- If optional `review/video-feedback.json` exists and still says the cut needs revision, stop after preview and cleanup instead of forcing a publish-shaped ending.
- If publication is blocked by login, permissions, or policy review, keep the preview package and report the blocker honestly.
