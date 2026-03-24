---
name: collect-target-context
description: "Collect the baseline context bundle for the selected target."
metadata:
  understudy:
    artifactKind: "skill"
---

# collect-target-context

## Overall Goal

Collect the baseline target metadata and first-pass context notes for the selected target.

## Inputs

- targetName
- artifactsRootDir

## Outputs

- target.json
- context.md

## Staged Workflow

1. Normalize the target name and artifacts root path.
2. Gather stable baseline facts for the target bundle.
3. Write `target.json` and `context.md`.

## Tool Route Options

- shell for writing deterministic output files
- gui when baseline facts must be grounded from the visible target surface

## Detailed GUI Replay Hints

- Prefer surface-local capture whenever the target is visible in a bounded window.
- Quote visible labels if the operator needs to re-run the capture manually.

## Failure Policy

- Stop if no target name is available.
- Preserve partial context output rather than overwriting it with empty data.
