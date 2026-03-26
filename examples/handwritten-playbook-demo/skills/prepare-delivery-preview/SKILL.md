---
name: prepare-delivery-preview
description: "Prepare the delivery preview payload from the generated assets."
metadata:
  understudy:
    artifactKind: "skill"
---

# prepare-delivery-preview

## Overall Goal

Prepare the delivery preview payload and metadata for human approval.

## Inputs

- target.json
- brief.md
- draft.mp4
- cover.png

## Outputs

- delivery/preview.json

## Staged Workflow

1. Draft the title, summary, and metadata.
2. Point the preview payload at the cover and draft video.
3. Write `delivery/preview.json`.

## Tool Route Options

- shell for deterministic JSON output

## Detailed GUI Replay Hints

- None. Delivery should only happen after preview approval.

## Failure Policy

- Keep the last valid preview payload if a new one cannot be generated safely.
