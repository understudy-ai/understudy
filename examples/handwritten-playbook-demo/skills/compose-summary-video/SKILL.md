---
name: compose-summary-video
description: "Compose the final draft summary video from the generated assets and brief."
metadata:
  understudy:
    artifactKind: "skill"
---

# compose-summary-video

## Overall Goal

Compose a draft summary video from the generated brief assets.

## Inputs

- cover.png
- summary-card.png
- brief.md
- screenshots/*

## Outputs

- draft.mp4

## Staged Workflow

1. Pick the screenshots that best support the brief.
2. Assemble a concise timeline.
3. Render `draft.mp4`.

## Tool Route Options

- shell plus ffmpeg for deterministic composition

## Detailed GUI Replay Hints

- None. This stage should not require GUI work.

## Failure Policy

- If video composition fails, keep the still assets and emit a fallback note.
