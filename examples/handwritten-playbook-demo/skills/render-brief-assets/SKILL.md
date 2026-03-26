---
name: render-brief-assets
description: "Render polished cover and summary-card image assets for the brief package."
metadata:
  understudy:
    artifactKind: "skill"
---

# render-brief-assets

## Overall Goal

Render the final visual assets for the brief package from the target context and summary.

## Inputs

- target.json
- summary.json
- brief.md
- highlights.json

## Outputs

- cover.png
- summary-card.png

## Staged Workflow

1. Read the target metadata and summary.
2. Render the cover with the target title and verdict.
3. Render the summary-card image with ratings and highlights.

## Tool Route Options

- shell plus ffmpeg for deterministic rendering

## Detailed GUI Replay Hints

- None. This stage should not depend on GUI state.

## Failure Policy

- If one asset fails, keep the successful asset and surface a recovery note.
