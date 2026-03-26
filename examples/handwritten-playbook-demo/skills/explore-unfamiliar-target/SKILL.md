---
name: explore-unfamiliar-target
description: "Goal-driven worker for exploring an unfamiliar target."
metadata:
  understudy:
    artifactKind: "worker"
---

# explore-unfamiliar-target

## Goal

Explore the unfamiliar target currently assigned to the run.

## Operating Contract

- Work from the visible app state rather than assuming a fixed flow.
- Capture enough evidence for highlights, limitations, and a short brief.
- Prefer user-visible value over exhaustive settings exploration.

## Inputs

- targetName
- artifactsRootDir
- analysisFocus

## Outputs

- findings.md
- highlights.json
- limitations.json
- worker-summary.json
- screenshots/*

## Budget

- maxMinutes=12
- maxActions=60
- maxScreenshots=12

## Allowed Surfaces

- Only the surfaces assigned to the run
- Supporting workspace windows only when required

## Stop Conditions

- Enough evidence exists for 2-3 highlights and 1 limitation.
- The budget is exhausted.
- A hard block such as authentication or missing permissions prevents further exploration.

## Decision Heuristics

- Prefer first-run onboarding and core feature paths.
- Capture screenshots only when they materially improve the brief.

## Failure Policy

- Escalate if payment is required.
- Escalate if personal account creation is required.
- Escalate if the app crashes repeatedly.
