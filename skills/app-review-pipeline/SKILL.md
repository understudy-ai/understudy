---
name: app-review-pipeline
description: >-
  Hand-written Phase 1 playbook for locking a fixed App Store app, collecting
  browser-side listing metadata, installing it through iPhone Mirroring,
  exploring it deeply enough for a tutorial-style review, composing a local
  voiceover video with the built-in local compositor, publishing it by default,
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
      - name: "local-video-edit"
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

1. use Chrome to lock a fixed App Store target and collect its intro, review, and screenshot package
2. use iPhone Mirroring to search, verify, install the app, and return to the home screen
3. use iPhone Mirroring to explore the app deeply enough for a tutorial-style story
4. compose an evidence-shaped vertical review video, usually `60-120 seconds` and only longer when the proof set genuinely supports it
5. use Chrome to complete the YouTube publish flow by default
6. clean up: delete the app and restore the device for the next run

Phase 1 should close the install -> explore -> edit -> publish -> cleanup loop
from one TUI request. The preferred happy path is: render once, self-review the
cut, do one bounded proof-first repair pass when the remaining issue is clearly
editing rather than missing evidence, then publish or stop truthfully. Keep
that behavior in these hand-written skills and natural-language artifacts, not
in special-cased core runtime logic.

## Prerequisites

- **macOS 15+** with Accessibility and Screen Recording permissions granted to Understudy
- **iPhone** connected via iPhone Mirroring (System Settings → General → AirDrop & Handoff)
- **Google Chrome** with the Understudy browser extension installed (or installable via `understudy browser extension install managed`)
- **ffmpeg + ffprobe** — `brew install ffmpeg`
- **edge-tts** (optional) — `pip install edge-tts` for neural voiceover; falls back to macOS `say` if unavailable
- **YouTube account** authenticated in Chrome — for Stage 5 upload
- **Python 3** — for helper scripts in `skills/*/scripts/`

## Environment Variables (optional)

- `UNDERSTUDY_EPISODES_DIR` — override the default episodes root (`~/understudy-episodes`)
- `UNDERSTUDY_APPLE_ID_PASSWORD` — Apple ID password for App Store installs (only used when `allowAppleIdPasswordFromEnv` is enabled)

## Inputs

- `artifactsRootDir`
- `selectionMode` — optional selection strategy such as `fixed_target_app_metadata` or a future discovery mode; the demo harness may prefill this
- `targetApp` — optional exact target app name when running in fixed-target mode
- `targetAppStoreUrl` — optional exact App Store detail URL for the fixed target
- `appStoreRegion` — optional locale such as `us` or `hk`
- `allowAppleIdPasswordFromEnv` — default `false`; when explicitly enabled, Stage 1 may use secret env typing on a standard Apple ID password sheet
- `appleIdPasswordEnvVar` — optional env var name for the Apple ID password; default `UNDERSTUDY_APPLE_ID_PASSWORD`
- `publishNow` — default `true`; complete the upload unless the caller explicitly wants preview-only
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
- `experience/evidence-catalog.json`
- `experience/checkpoints.jsonl`
- `experience/clips/01-Core-Loop.mov` when a safe motion proof beat was captured
- `experience/screenshots/01-First-Screen.png`
- `experience/screenshots/02-Main-Screen.png`
- `experience/screenshots/03-Core-Task.png`
- `experience/screenshots/04-Outcome-Or-Friction.png`
- `post/video-plan.md`
- `post/video-shot-list.md`
- `post/video-edit-manifest.json`
- `post/assets/narration.txt`
- `post/assets/voiceover-script.txt`
- `post/assets/voiceover.aiff`
- `post/assets/voiceover-meta.json`
- `post/assets/subtitles.srt`
- `post/video-edit-note.md`
- `post/final-video.mp4`
- `publish/youtube.json`
- `publish/preview.md`
- `publish/result.json`
- `topic/screenshots/99-Clean-Home-Screen.png`

## Stage Map

- `Stage 1: appstore-browser-package` — Chrome + extension relay. Lock the fixed App Store target and collect browser-side listing metadata.
- `Stage 2: appstore-device-install` — iPhone Mirroring. Search → detail → install → home screen (produces `02` and `03`).
- `Stage 3: app-explore` — iPhone Mirroring. Deep walkthrough: screenshots, clips, structured notes.
- `Stage 4: local-video-edit` — Video composition. Use the local ffmpeg-based compositor for a proof-first review video with voiceover and subtitles.
- `Stage 5: youtube-upload` — Chrome + extension relay. YouTube metadata and upload.
- `Postflight: app-review-cleanup` — Delete the app, restore the device.

## Approval Gates

- Final publication is only allowed when `publishNow=true`.
- Even when `publishNow=true`, do not enter the real publish path if an optional `review/video-feedback.json` already exists and says the cut still needs revision or deeper evidence.
- Before Stage 5, prefer one bounded self-review + re-edit pass when the remaining issue is browser contamination, packaging weight, pacing, or proof framing rather than missing exploration evidence.

## Stage Plan

1. [worker] appstore-browser-package -> Lock the fixed target app in Chrome and collect browser-side intro/review/screenshot evidence | inputs: artifactsRootDir,selectionMode,targetApp,targetAppStoreUrl,appStoreRegion,allowAppleIdPasswordFromEnv,appleIdPasswordEnvVar | outputs: manifest.json,topic/candidates.json,topic/selection-notes.md,topic/app-store-listing.json,topic/device-action-plan.json,topic/device-action-plan.md,topic/screenshots/00-Browser-Today-Recommendation.png,topic/screenshots/01-Browser-App-Detail.png | retry: retry_once
2. [worker] appstore-device-install -> Search, verify, install the app on iPhone Mirroring, return to home screen | inputs: artifactsRootDir,selectionMode,targetApp,appStoreRegion,allowAppleIdPasswordFromEnv,appleIdPasswordEnvVar | outputs: topic/screenshots/02-iPhone-App-Store-Detail.png,topic/screenshots/03-Home-Screen-With-App.png,manifest.json,experience/checkpoints.jsonl | retry: retry_once
3. [skill] app-explore -> Deep walkthrough: screenshots, clips, structured review notes | inputs: artifactsRootDir,targetApp | outputs: experience/notes.json,experience/review-brief.md,experience/story-beats.md,experience/evidence-catalog.json,experience/checkpoints.jsonl,experience/screenshots/01-First-Screen.png,experience/screenshots/02-Main-Screen.png,experience/screenshots/03-Core-Task.png,experience/screenshots/04-Outcome-Or-Friction.png | retry: pause_for_human
4. [skill] local-video-edit -> Compose a proof-first review video with voiceover and subtitles | inputs: artifactsRootDir | outputs: post/video-plan.md,post/video-shot-list.md,post/video-edit-manifest.json,post/assets/narration.txt,post/assets/voiceover-script.txt,post/assets/voiceover.aiff,post/assets/voiceover-meta.json,post/assets/subtitles.srt,post/video-edit-note.md,post/final-video.mp4 | retry: retry_once
5. [skill] youtube-upload -> Upload to YouTube with engaging title and description | inputs: artifactsRootDir,publishNow,publishVisibility | outputs: publish/youtube.json,publish/preview.md,publish/result.json | retry: pause_for_human
6. [skill] app-review-cleanup -> Delete the app and restore the device | inputs: artifactsRootDir | outputs: topic/screenshots/99-Clean-Home-Screen.png,manifest.json | retry: retry_once

## Execution

This pipeline is triggered by natural language (e.g., "review an iPhone app",
"find and review a free app"). One message starts the entire pipeline.

1. Create the artifacts root: `${UNDERSTUDY_EPISODES_DIR:-~/understudy-episodes}/ep-YYYY-MM-DD-NNN`.
2. Write an initial `manifest.json` with the resolved inputs.
3. For each stage, use `sessions_spawn` to create a **child session** that
   reads the stage's SKILL.md and executes it. This keeps each stage in its
   own context and lets auto-compaction work between stages.
4. Wait for each child session to complete, then verify outputs exist.
5. If a stage fails with `retry: retry_once`, spawn it again once.
6. If a stage fails with `retry: pause_for_human`, stop and ask the user.
7. For the exploration stage (app-explore), spawn **3 separate child sessions**
   — one per round (Round 1: primary task, Round 2: secondary feature,
   Round 3: limits). Each round reads and updates the shared notes.json.
   Auto-compaction triggers between rounds, keeping context fresh.
8. The pipeline is complete when all 6 stages finish or a stage fails.

## Episode Manifest Bookkeeping

For the natural-language orchestration path, `manifest.json` is the operator
truth for whether the run is still active. Treat it like a contract, not a
loose note.

1. Before spawning a child for a stage, update:
   - `currentStage`
   - `phase`
   - `stages.<stage>.status = "running"`
2. After the child returns and the required outputs are verified on disk, update:
   - `stages.<stage>.status = "completed"` for normal worker / skill success
   - `stages.<stage>.completedAt`
   - one short note if the stage took a meaningful shortcut or hit a truthful constraint
3. Do not leave an earlier stage as `pending` once its required artifacts already exist.
4. `Stage 5` preview-only is not a failure and it is not a reason to skip cleanup:
   - if `publishNow=false`, set `stages.stage5.status = "awaiting_confirm"`
   - prepare the publish package
   - continue into cleanup if the user asked for the device to be restored
5. Cleanup is the final state-normalization stage. After cleanup succeeds:
   - `stages.cleanup.status = "completed"`
   - `currentStage = null`
   - if Stage 5 is preview-only, keep top-level `status = "awaiting_confirm"` but leave the device cleaned
   - if the video was really published, keep top-level `status = "published"`
   - if publication was blocked, keep top-level `status = "blocked"`
6. The final cleaned preview state should look like this:
   - `status = "awaiting_confirm"`
   - `phase = "cleaned"`
   - `currentStage = null`
   - `stages.stage1-4.status = "completed"`
   - `stages.stage5.status = "awaiting_confirm"`
   - `stages.cleanup.status = "completed"`
   - optional `pendingHumanAction = "confirm_youtube_upload"`
7. Once the final stage has been normalized and the final summary has been returned, stop.
   Do not leave a follow-up subagent, GUI retry loop, or speculative browser pass alive.

## Failure Policy

- Preserve partial artifacts between retries.
- Treat the iPhone home screen as the stage boundary between install, explore, and cleanup.
- If Stage 2 cannot reach `topic/screenshots/02-iPhone-App-Store-Detail.png`, stop there and fail the playbook instead of drifting into install or exploration without a truthful device detail boundary.
- If Stage 3 cannot reach `topic/screenshots/03-Home-Screen-With-App.png`, stop there and fail the playbook instead of drifting into Stage 4 with an uninstalled app.
- If Stage 2 blocks before the App Store detail page is reachable on device, preserve the truthful blocker artifact such as `topic/screenshots/02-iPhone-Mirroring-Disconnected.png` instead of fabricating success-path screenshots.
- If a GUI action misses twice on the same target, stop and report the blocker instead of guessing.
- If optional `review/video-feedback.json` exists and still says the cut needs revision, stop after preview and cleanup instead of forcing a publish-shaped ending.
- If publication is blocked by login, permissions, or policy review, keep the preview package and report the blocker honestly.
- If every required child session has already returned and the final cleanup screenshot plus publish result already exist, do not keep touching Chrome or iPhone Mirroring. Normalize the manifest and stop.
