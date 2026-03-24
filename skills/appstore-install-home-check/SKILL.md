---
name: appstore-install-home-check
description: >-
  Minimal validation playbook for Stage 1 through the install/home boundary:
  browser packaging, device detail-page search, real install, and return to the
  iPhone home screen.
metadata:
  understudy:
    emoji: "🧪"
    artifactKind: "playbook"
    requires:
      bins: ["screencapture"]
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
---

# appstore-install-home-check

## Goal

Validate the full Stage 1 install boundary with real browser and iPhone
Mirroring behavior before moving on to exploration, editing, and publishing.

## Inputs

- `artifactsRootDir`
- `selectionMode` default `today_editorial_free_app`
- `targetApp` optional
- `appStoreRegion` optional
- `allowAppleIdPasswordFromEnv` optional
- `appleIdPasswordEnvVar` optional

## Output Contract

- `manifest.json`
- `topic/app-store-listing.json`
- `topic/candidates.json`
- `topic/selection-notes.md`
- `topic/device-action-plan.json`
- `topic/device-action-plan.md`
- `topic/screenshots/00-Browser-Today-Recommendation.png`
- `topic/screenshots/01-Browser-App-Detail.png`
- `topic/screenshots/02-iPhone-App-Store-Detail.png`
- `topic/screenshots/03-Home-Screen-With-App.png ?? topic/screenshots/03-Home-Screen-Blocked-No-App.png`
- `experience/checkpoints.jsonl`

## Stage Plan

1. [worker] appstore-browser-package -> Build the full browser-side package and frozen device action plan, then stop before any iPhone Mirroring work | inputs: artifactsRootDir,selectionMode,targetApp,appStoreRegion,allowAppleIdPasswordFromEnv,appleIdPasswordEnvVar | outputs: manifest.json,topic/app-store-listing.json,topic/candidates.json,topic/selection-notes.md,topic/device-action-plan.json,topic/device-action-plan.md,topic/screenshots/00-Browser-Today-Recommendation.png,topic/screenshots/01-Browser-App-Detail.png | retry: retry_once
2. [worker] appstore-device-search-detail -> Use the frozen device plan to open the exact App Store detail page on the mirrored iPhone and capture `02` | inputs: artifactsRootDir,selectionMode,targetApp,appStoreRegion,allowAppleIdPasswordFromEnv,appleIdPasswordEnvVar | outputs: topic/screenshots/02-iPhone-App-Store-Detail.png,manifest.json,experience/checkpoints.jsonl | retry: retry_once
3. [worker] appstore-install-home -> Starting from the validated device detail page, complete the install or fail truthfully, then stop on the iPhone home screen with `03` | inputs: artifactsRootDir,selectionMode,targetApp,appStoreRegion,allowAppleIdPasswordFromEnv,appleIdPasswordEnvVar | outputs: manifest.json,topic/candidates.json,topic/selection-notes.md,topic/app-store-listing.json,experience/checkpoints.jsonl,topic/screenshots/03-Home-Screen-With-App.png ?? topic/screenshots/03-Home-Screen-Blocked-No-App.png | retry: retry_once

## Failure Policy

- Preserve partial artifacts between retries.
- If Stage 2 cannot reach the correct App Store detail page, stop there and fail truthfully.
- If Stage 3 cannot reach the home-screen boundary, stop there and fail truthfully.
- Do not drift into exploration or editing; this playbook ends at the Stage 1 install boundary.
