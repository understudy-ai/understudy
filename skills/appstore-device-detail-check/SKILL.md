---
name: appstore-device-detail-check
description: >-
  Minimal validation playbook for Stage 1 browser packaging plus the dedicated
  iPhone Mirroring App Store detail-page search helper.
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
---

# appstore-device-detail-check

## Goal

Validate the browser package plus dedicated device detail helper without running
the later install/explore/edit/publish stages.

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
- `experience/checkpoints.jsonl`

## Stage Plan

1. [worker] appstore-browser-package -> Build the full browser-side package and frozen device action plan, then stop before any iPhone Mirroring work | inputs: artifactsRootDir,selectionMode,targetApp,appStoreRegion,allowAppleIdPasswordFromEnv,appleIdPasswordEnvVar | outputs: manifest.json,topic/app-store-listing.json,topic/candidates.json,topic/selection-notes.md,topic/device-action-plan.json,topic/device-action-plan.md,topic/screenshots/00-Browser-Today-Recommendation.png,topic/screenshots/01-Browser-App-Detail.png | retry: retry_once
2. [worker] appstore-device-search-detail -> Use the frozen device plan to open the exact App Store detail page on the mirrored iPhone and capture `02` | inputs: artifactsRootDir,selectionMode,targetApp,appStoreRegion,allowAppleIdPasswordFromEnv,appleIdPasswordEnvVar | outputs: topic/screenshots/02-iPhone-App-Store-Detail.png,manifest.json,experience/checkpoints.jsonl | retry: retry_once

## Failure Policy

- Preserve partial artifacts between retries.
- If Stage 2 cannot reach the correct App Store detail page, stop there and fail truthfully.
- Do not claim install progress; this playbook ends at the detail page validation boundary.
