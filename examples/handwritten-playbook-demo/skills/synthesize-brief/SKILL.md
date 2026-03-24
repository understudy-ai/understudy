---
name: synthesize-brief
description: "Turn context findings into a summary packet and short brief."
metadata:
  understudy:
    artifactKind: "skill"
---

# synthesize-brief

## Overall Goal

Convert the exploration context into a concise verdict, summary packet, and short brief.

## Inputs

- findings.md
- highlights.json
- limitations.json
- context.md

## Outputs

- summary.json
- brief.md

## Staged Workflow

1. Merge the baseline and exploration findings into a concise summary.
2. Score usefulness, polish, and first-run clarity.
3. Write `summary.json` and `brief.md`.

## Tool Route Options

- shell for deterministic file generation
- memory for reusing prior scoring language

## Detailed GUI Replay Hints

- None. This stage should stay artifact-first and deterministic.

## Failure Policy

- If findings are incomplete, produce a conservative summary with explicit uncertainty notes.
