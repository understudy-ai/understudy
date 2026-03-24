---
name: target-brief-studio
description: "Hand-written end-to-end playbook for a reusable target brief workflow."
metadata:
  understudy:
    artifactKind: "playbook"
    childArtifacts:
      - name: "collect-target-context"
        artifactKind: "skill"
        required: true
      - name: "explore-unfamiliar-target"
        artifactKind: "worker"
        required: true
      - name: "synthesize-brief"
        artifactKind: "skill"
        required: true
      - name: "render-brief-assets"
        artifactKind: "skill"
        required: true
      - name: "compose-summary-video"
        artifactKind: "skill"
        required: true
      - name: "prepare-delivery-preview"
        artifactKind: "skill"
        required: true
---

# target-brief-studio

## Goal

Produce a delivery-preview-ready first-pass target brief package.

## Inputs

- targetName
- analysisFocus

## Child Artifacts

- collect-target-context
- explore-unfamiliar-target
- synthesize-brief
- render-brief-assets
- compose-summary-video
- prepare-delivery-preview

## Stage Plan

1. [skill] collect-target-context -> Collect baseline context | inputs: targetName, artifactsRootDir | outputs: target.json, context.md | retry: retry_once
2. [worker] explore-unfamiliar-target -> Explore the unfamiliar target | inputs: targetName, artifactsRootDir, analysisFocus | outputs: findings.md, highlights.json, limitations.json, worker-summary.json | retry: pause_for_human | budget: maxMinutes=12
3. [skill] synthesize-brief -> Convert findings into a summary packet | inputs: findings.md, highlights.json, limitations.json, context.md | outputs: summary.json, brief.md | retry: retry_once
4. [skill] render-brief-assets -> Render the cover and summary-card images | inputs: target.json, summary.json, brief.md | outputs: cover.png, summary-card.png | retry: retry_once
5. [skill] compose-summary-video -> Render the draft summary video | inputs: cover.png, summary-card.png, screenshots/*, brief.md | outputs: draft.mp4 | retry: retry_once
6. [skill] prepare-delivery-preview -> Assemble the delivery preview payload | inputs: target.json, brief.md, draft.mp4, cover.png | outputs: delivery/preview.json | retry: retry_once
7. [approval] delivery-preview -> Wait for human approval before delivery | outputs: approval.state | approval: delivery_preview

## Output Contract

- draft.mp4
- delivery/preview.json
- summary.json
- brief.md

## Approval Gates

- Human review before delivery

## Failure Policy

- Preserve generated artifacts between retries
- Pause for human review if the exploration worker hits a hard UI block
