---
name: appstore-device-install
description: >-
  Device worker: from the mirrored iPhone home screen, search the App Store for
  the locked candidate, verify the detail page, install the app, and return to
  the home screen with screenshots 02 and 03.
metadata:
  understudy:
    emoji: "📲"
    artifactKind: "worker"
    requires:
      bins: ["screencapture"]
---

# appstore-device-install

## Goal

Starting from the iPhone home screen (or any recoverable state), use the frozen
device action plan to search the App Store, verify the detail page, install the
app, and return to the home screen. Produces both `02-iPhone-App-Store-Detail.png`
and `03-Home-Screen-With-App.png` in one continuous pass.

## Operating Contract

- Read `skills/iphone-mirroring-basics/SKILL.md` before the first GUI action.
- Read `manifest.json`, `topic/device-action-plan.json`, `topic/app-store-listing.json`, and `topic/candidates.json`.
- Use only Understudy GUI tools (`gui_observe`, `gui_click`, `gui_type`, `gui_key`) on the iPhone Mirroring window. No external scripts, coordinate macros, or shell-driven UI automation.
- If the first observation shows a paused/disconnected surface, follow the **Disconnection Recovery Ladder** in `iphone-mirroring-basics`. If recovery fails, stop with a blocker.
- Treat `topic/device-action-plan.json` as the authority for `searchAction`, `searchSubmitAction`, and `resultRowTitleHints`.
- Treat the selected candidate as exclusive. Do not branch to another app unless install is blocked and a backup candidate exists in `topic/candidates.json`.

## Inputs

- `artifactsRootDir`
- `manifest.json`
- `topic/device-action-plan.json`
- `topic/candidates.json`
- `topic/selection-notes.md`
- `topic/app-store-listing.json`

## Outputs

- `topic/screenshots/02-iPhone-App-Store-Detail.png`
- `topic/screenshots/03-Home-Screen-With-App.png` or `topic/screenshots/03-Home-Screen-Blocked-No-App.png`
- `manifest.json` (updated with `deviceVerified: true` and install status)
- `experience/checkpoints.jsonl`

## Budget

- `maxMinutes=15`
- `maxActions=70`
- `maxScreenshots=4`

## Allowed Surfaces

- The live `iPhone Mirroring` window
- Shell only for artifact reads, `test -f` checks, and bounded artifact writes

## Phase 1: Search and verify detail page

1. Classify the current mirrored surface: disconnected/paused, wrong app, home screen, or App Store.
2. If not on home screen, send `command+1` to return home, then observe.
3. Open App Store by tapping the icon.
4. Navigate to the Search surface. Do not type until the real editable search field is focused (not just the placeholder).
5. Replay the frozen `searchAction` exactly. The only allowed next call is `gui_observe`.
6. Tap the matching result row (title matches `resultRowTitleHints`). Do not tap `Get`/`Install` yet.
7. Verify the detail page: title and developer match the locked candidate.
8. Capture `topic/screenshots/02-iPhone-App-Store-Detail.png` using the crop formula from `iphone-mirroring-basics`.
9. Update `manifest.json` with `deviceVerified: true`. Append a checkpoint.

Key rules:
- One clean reset is allowed if the first search fails. If the detail page still cannot be reached after one reset, stop with a blocker.
- Do not tap a result row for a different app.
- Horizontal-scroll and prefilled-field normalization: if the field shows the tail of the correct query with matching results, use the results.

## Phase 2: Install and return home

10. From the verified detail page, tap `Get` or the cloud-download icon.
11. If an Apple ID password sheet appears, follow the frozen password policy from the device plan (one attempt only). If password fails, pivot to backup candidate or stop.
12. Wait for install to complete (`Open` button appears). Observe after each mutation.
13. If the first state was already `Open` before any install action in this run, classify as `alreadyInstalled` and pivot to backup.
14. Once `Open` is confirmed after a valid install, send `command+1` to return home.
15. Capture `topic/screenshots/03-Home-Screen-With-App.png`.
16. Update `manifest.json` with installed status. Append a checkpoint.

Backup pivot rules:
- If install is blocked (auth, payment, already-installed), and backup candidates exist in `candidates.json`, dismiss the blocker, re-enter Search, replay the backup candidate's frozen search, and retry.
- When a backup becomes the new target, promote its cached listing into `topic/app-store-listing.json` if available under `topic/tmp/backup-*.json`.
- If no viable backup remains, return home, capture `03-Home-Screen-Blocked-No-App.png`, and stop.

## Stop Conditions

- Success: `02-iPhone-App-Store-Detail.png` AND `03-Home-Screen-With-App.png` both exist.
- Blocked: every candidate exhausted, phone is on home screen, `03-Home-Screen-Blocked-No-App.png` exists.

## Decision Heuristics

- Always classify the current surface before acting.
- Prefer `command+1` to return home over guessing gestures.
- Prefer semantic targets (icon labels, text fields) over coordinates.
- On the Search surface: focus the real editable field before typing.
- Do not retype a query that is already visible and correct.
- Prefer the matching suggestion/result row before scrolling.
- After install success, go home immediately — do not browse the detail page further.

## Failure Policy

- If iPhone Mirroring is disconnected after one recovery ladder, stop with a blocker.
- If the detail page cannot be reached after one clean reset, stop.
- If install fails and no backup remains, stop with a truthful blocked artifact.
- Do not fabricate screenshots or claim progress that did not happen.
