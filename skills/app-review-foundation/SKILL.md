---
name: app-review-foundation
description: >-
  Foundation playbook for a believable iPhone app review run: find a current
  App Store app, install it through iPhone Mirroring, explore it deeply enough
  to support a real review, and stop with screenshots plus written copy.
metadata:
  understudy:
    emoji: "📱"
    artifactKind: "playbook"
    requires:
      bins: ["ffmpeg", "screencapture"]
    triggers:
      - "app review foundation"
      - "iphone app review foundation"
      - "app install and explore"
      - "foundation app review pipeline"
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
---

# app-review-foundation

## Goal

Run the stable foundation loop for an iPhone app review episode:

1. use the browser to find a current App Store recommendation or a forced target app
2. use iPhone Mirroring to reach the exact App Store detail page and complete a truthful install
3. return to the home screen with the installed app
4. launch the app from the home screen, explore it deeply enough to feel genuinely tested, and write screenshots plus review copy

This playbook intentionally stops before video editing, model review, upload, or
cleanup. Demo-specific behavior should stay in these hand-written skills and
artifacts, while any runtime or GUI improvements remain generic.

## Inputs

- `artifactsRootDir`
- `selectionMode` — default to `today_editorial_free_app`
- `targetApp` — optional override for a fixed app name
- `appStoreRegion` — optional locale such as `us` or `hk`
- `allowAppleIdPasswordFromEnv` — default `false`; when explicitly enabled, Stage 1 may use secret env typing on a standard Apple ID password sheet
- `appleIdPasswordEnvVar` — optional env var name for the Apple ID password; default `UNDERSTUDY_APPLE_ID_PASSWORD`

## Output Contract

- `manifest.json`
- `topic/candidates.json`
- `topic/selection-notes.md`
- `topic/app-store-listing.json`
- `topic/device-action-plan.json`
- `topic/device-action-plan.md`
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

## Stage Plan

1. [worker] appstore-browser-package -> Use the browser to lock today's App Store candidate, preserve already-seen backups, and write the frozen device package before any iPhone Mirroring work | inputs: artifactsRootDir,selectionMode,targetApp,appStoreRegion,allowAppleIdPasswordFromEnv,appleIdPasswordEnvVar | outputs: manifest.json,topic/candidates.json,topic/selection-notes.md,topic/app-store-listing.json,topic/device-action-plan.json,topic/device-action-plan.md,topic/screenshots/00-Browser-Today-Recommendation.png,topic/screenshots/01-Browser-App-Detail.png | retry: retry_once
2. [worker] appstore-device-search-detail -> Use the frozen device plan to reach the exact App Store detail page on the mirrored iPhone and capture `02` before any install tap | inputs: artifactsRootDir,selectionMode,targetApp,appStoreRegion,allowAppleIdPasswordFromEnv,appleIdPasswordEnvVar | outputs: topic/screenshots/02-iPhone-App-Store-Detail.png,manifest.json,experience/checkpoints.jsonl | retry: retry_once
3. [worker] appstore-install-home -> Starting from the validated device detail page, complete the install or fail truthfully, then stop on the iPhone home screen with a real installed-app `03` success boundary | inputs: artifactsRootDir,selectionMode,targetApp,appStoreRegion,allowAppleIdPasswordFromEnv,appleIdPasswordEnvVar | outputs: manifest.json,topic/candidates.json,topic/selection-notes.md,topic/app-store-listing.json,experience/checkpoints.jsonl,topic/screenshots/03-Home-Screen-With-App.png | retry: retry_once
4. [skill] app-explore -> Launch the installed app from the home screen, capture deep review evidence, prefer one short live iPhone proof clip when safe, and return to the home screen with written review copy | inputs: artifactsRootDir,targetApp | outputs: experience/notes.json,experience/review-brief.md,experience/story-beats.md,experience/checkpoints.jsonl,experience/screenshots/01-First-Screen.png,experience/screenshots/02-Main-Screen.png,experience/screenshots/03-Core-Task.png,experience/screenshots/04-Outcome-Or-Friction.png | retry: pause_for_human

## Failure Policy

- Preserve partial artifacts between retries.
- Treat the iPhone home screen as the stable stage boundary between install and exploration.
- If Stage 2 cannot reach `topic/screenshots/02-iPhone-App-Store-Detail.png`, stop there and fail truthfully instead of drifting into install or exploration.
- If Stage 3 cannot reach `topic/screenshots/03-Home-Screen-With-App.png`, stop there and fail truthfully instead of drifting into exploration with an uninstalled app.
- If Stage 4 cannot produce a meaningful primary loop, mark the review package `partial` or `shallow` rather than fabricating depth.
- If a GUI action misses twice on the same semantic target, stop and report the blocker instead of escalating into coordinate guesses.
