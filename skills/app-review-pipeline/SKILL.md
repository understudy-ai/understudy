---
name: app-review-pipeline
description: >-
  Hand-written Phase 1 playbook for selecting a current App Store app, installing
  it through iPhone Mirroring, exploring it deeply enough for a tutorial-style
  review, composing a local CapCut voiceover video, optionally publishing it,
  and restoring the device state.
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
      - name: "appstore-device-install"
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

Run one complete iPhone app review episode:

1. use Chrome to find and lock a current App Store candidate
2. use iPhone Mirroring to search, verify, install the app, and return to the home screen
3. use iPhone Mirroring to explore the app deeply enough for a tutorial-style story
4. compose a roughly `3 minute` video from the collected evidence
5. use Chrome to prepare or complete the YouTube publish flow
6. clean up: delete the app and restore the device for the next run

Phase 1 should close the install -> explore -> edit -> publish -> cleanup loop
from one TUI request without depending on a separate review-model pass. The optional
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
- `post/assets/voiceover-script.txt`
- `post/assets/voiceover.aiff`
- `post/assets/voiceover-meta.json`
- `post/assets/subtitles.srt`
- `post/capcut-edit-note.md`
- `post/final-video.mp4`
- `publish/youtube.json`
- `publish/preview.md`
- `publish/result.json`
- `topic/screenshots/99-Clean-Home-Screen.png`

## Stage Map

- `Stage 1: appstore-browser-package` — Chrome + extension relay. Find and lock the App Store candidate.
- `Stage 2: appstore-device-install` — iPhone Mirroring. Search → detail → install → home screen (produces `02` and `03`).
- `Stage 3: app-explore` — iPhone Mirroring. Deep walkthrough: screenshots, clips, structured notes.
- `Stage 4: capcut-edit` — Video composition. ~3 minute review video with voiceover and subtitles.
- `Stage 5: youtube-upload` — Chrome + extension relay. YouTube metadata and upload.
- `Postflight: app-review-cleanup` — Delete the app, restore the device.

## Approval Gates

- Final publication is only allowed when `publishNow=true`.
- Even when `publishNow=true`, do not enter the real publish path if an optional `review/video-feedback.json` already exists and says the cut still needs revision or deeper evidence.

## Stage Plan

1. [worker] appstore-browser-package -> Find and lock today's App Store candidate using Chrome | inputs: artifactsRootDir,selectionMode,targetApp,appStoreRegion,allowAppleIdPasswordFromEnv,appleIdPasswordEnvVar | outputs: manifest.json,topic/candidates.json,topic/selection-notes.md,topic/app-store-listing.json,topic/device-action-plan.json,topic/device-action-plan.md,topic/screenshots/00-Browser-Today-Recommendation.png,topic/screenshots/01-Browser-App-Detail.png | retry: retry_once
2. [worker] appstore-device-install -> Search, verify, install the app on iPhone Mirroring, return to home screen | inputs: artifactsRootDir,selectionMode,targetApp,appStoreRegion,allowAppleIdPasswordFromEnv,appleIdPasswordEnvVar | outputs: topic/screenshots/02-iPhone-App-Store-Detail.png,topic/screenshots/03-Home-Screen-With-App.png,manifest.json,experience/checkpoints.jsonl | retry: retry_once
3. [skill] app-explore -> Deep walkthrough: screenshots, clips, structured review notes | inputs: artifactsRootDir,targetApp | outputs: experience/notes.json,experience/review-brief.md,experience/story-beats.md,experience/checkpoints.jsonl,experience/screenshots/01-First-Screen.png,experience/screenshots/02-Main-Screen.png,experience/screenshots/03-Core-Task.png,experience/screenshots/04-Outcome-Or-Friction.png | retry: pause_for_human
4. [skill] capcut-edit -> Compose a ~3 minute review video with voiceover and subtitles | inputs: artifactsRootDir | outputs: post/video-plan.md,post/capcut-shot-list.md,post/capcut-import-manifest.json,post/assets/narration.txt,post/assets/voiceover.aiff,post/assets/voiceover-meta.json,post/assets/subtitles.srt,post/final-video.mp4 | retry: retry_once
5. [skill] youtube-upload -> Upload to YouTube with engaging title and description | inputs: artifactsRootDir,publishNow,publishVisibility | outputs: publish/youtube.json,publish/preview.md,publish/result.json | retry: pause_for_human
6. [skill] app-review-cleanup -> Delete the app and restore the device | inputs: artifactsRootDir | outputs: topic/screenshots/99-Clean-Home-Screen.png,manifest.json | retry: retry_once

## Execution

This pipeline is a compound skill triggered by natural language (e.g., "review
an iPhone app", "帮我评测一个 app"). It works like any other workspace skill — the
agent reads this file, understands the stages, and executes them in order.

1. Create the artifacts root: `~/understudy-episodes/ep-YYYY-MM-DD-NNN`.
2. Write an initial `manifest.json` with the resolved inputs.
3. For each stage in the Stage Plan above, read the referenced skill file
   (e.g., `skills/appstore-browser-package/SKILL.md`) and follow its
   instructions directly.
4. After each stage, verify the declared outputs exist before proceeding.
5. If a stage fails with `retry: retry_once`, retry it once.
6. If a stage fails with `retry: pause_for_human`, stop and ask the user.
7. The pipeline is complete when all 6 stages finish or a stage fails terminally.

## Failure Policy

- Preserve partial artifacts between retries.
- Treat the iPhone home screen as the stage boundary between install, explore, and cleanup.
- If Stage 2 cannot reach `topic/screenshots/02-iPhone-App-Store-Detail.png`, stop there and fail the playbook instead of drifting into install or exploration without a truthful device detail boundary.
- If Stage 3 cannot reach `topic/screenshots/03-Home-Screen-With-App.png`, stop there and fail the playbook instead of drifting into Stage 4 with an uninstalled app.
- If Stage 2 blocks before the App Store detail page is reachable on device, preserve the truthful blocker artifact such as `topic/screenshots/02-iPhone-Mirroring-Disconnected.png` instead of fabricating success-path screenshots.
- If a GUI action misses twice on the same target, stop and report the blocker instead of guessing.
- If optional `review/video-feedback.json` exists and still says the cut needs revision, stop after preview and cleanup instead of forcing a publish-shaped ending.
- If publication is blocked by login, permissions, or policy review, keep the preview package and report the blocker honestly.
