# Handwritten Playbook Demo

This example workspace shows a fully hand-authored `playbook + worker + skills`
bundle that runs through Understudy's generic `playbook.run.*` APIs.

## Included Artifacts

- `target-brief-studio`
- `target-brief-baseline-stage`
- `collect-target-context`
- `explore-unfamiliar-target`
- `synthesize-brief`
- `render-brief-assets`
- `compose-summary-video`
- `prepare-delivery-preview`

## Intended Inputs

- `targetName`
- `analysisFocus`

## Run It Through Gateway

1. Start the gateway.
2. Create a workspace session that points at a copy of this example workspace.
3. Start a playbook run with `playbookName=target-brief-studio`.
4. Advance stages with `playbook.run.next`.
5. Complete stages with `playbook.run.stage.complete`.

The repository also includes a runnable harness:

- `pnpm test:e2e:playbook`

That script copies this example workspace into a temporary directory, starts the
gateway, creates a session, runs the playbook end to end through the generic RPC
surface, and writes a report.

## Notes

- The example is intentionally generic. It is not tied to iPhone review logic.
- The e2e harness supports `PLAYBOOK_E2E_SYNTHETIC=1` for deterministic runs in
  environments where child model execution is unavailable.
