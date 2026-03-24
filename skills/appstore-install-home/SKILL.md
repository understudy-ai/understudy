---
name: appstore-install-home
description: >-
  Dedicated worker for the final Stage 1 install boundary: from the on-device
  App Store detail page, install the selected app or fail truthfully, then end
  on the iPhone home screen with `03`.
metadata:
  understudy:
    emoji: "📥"
    artifactKind: "worker"
    requires:
      bins: ["screencapture"]
---

# appstore-install-home

## Goal

Starting from the already-validated App Store detail-page phase, finish the real
install attempt, handle one bounded password flow if authorized, pivot only
within the frozen shortlist when needed, and stop on the iPhone home screen with
either `topic/screenshots/03-Home-Screen-With-App.png` or the truthful blocked
artifact `topic/screenshots/03-Home-Screen-Blocked-No-App.png`.

## Operating Contract

- Read `skills/iphone-mirroring-basics/SKILL.md` before the first GUI action and use its home-screen / App Store semantics as the default recovery model.
- Read `manifest.json`, `topic/candidates.json`, `topic/selection-notes.md`, and `topic/device-action-plan.json` before the first install tap.
- Preconditions for the normal success path: `topic/screenshots/02-iPhone-App-Store-Detail.png` already exists and the current candidate in `manifest.json` matches the visible detail page.
- Start-state recovery rule: if Stage 3 begins and the visible surface is no longer clearly the selected app's detail page, do one bounded in-App-Store recovery using the current candidate's frozen `searchAction`, `searchSubmitAction`, and result-row hints. Re-enter the Search surface semantically, reopen the exact detail page once, observe, and only then continue with install.
- Fresh-install validity rule: only count `Open` as success if this run first observed and tapped `Get`, the cloud-download icon, or a follow-up `Install` confirmation for the same candidate.
- If the first observed state is already `Open` before any install action in this run, classify that candidate as `alreadyInstalled`, record it, and pivot to the next preserved candidate unless the app was explicitly forced.
- After tapping `Get`, the cloud-download icon, or an intermediate `Install` confirmation, immediately `gui_observe`. Do not assume install progress without a confirming observation.
- Standard Apple ID password sheets may use the frozen password policy exactly once per candidate. After the one submit click, the only allowed next step is one immediate observation. No repeated `Confirm`, no fallback `Enter`, and no shell-side password probing.
- Once the first live install attempt begins, the candidate pool is frozen to the entries already present in `topic/candidates.json`. Do not reopen the browser or invent new candidates.
- If the current candidate blocks and another preserved candidate still remains, dismiss the blocker, record it, keep the manifest non-terminal, and pivot within the same App Store session using that backup candidate's frozen `searchAction` / `searchSubmitAction`. Before replaying the backup query, re-focus the real editable App Store search field once, then run the targetless `searchAction`.
- If the only visible search control during a pivot still shows placeholder copy such as `Games, Apps and more` or `Games,...`, treat that click as Search-surface navigation only. Observe first, then reacquire the real editable field before replaying the backup `searchAction`.
- If the pivot search field is already populated with remembered non-placeholder text from an earlier search, do not rely on `replace:true` alone. If the visible text already matches the backup candidate strongly enough and the result row is recoverable, use the result path without retyping. Otherwise clear that stale field once before replaying the backup `searchAction`.
- If the backup query lands in a narrow field that only shows the trailing end of the text, treat that as potentially normal horizontal scrolling. When the visible tail still matches the frozen query ending and the matching result row is already present, continue instead of clearing the field immediately.
- If the post-type pivot observation still shows an active field with a clear `x`, a caret, or matching suggestions/results, presume the backup query landed unless the visible text was clearly replaced with unrelated content. Prefer result tap or one frozen submit before any clear/reset.
- During a backup pivot, if tapping a suggestion opens a results list instead of the detail page, continue within the same candidate: tap the visible app result row whose title best matches the backup candidate's frozen `resultRowTitleHints`, observe again, and only then classify the detail-path attempt as failed.
- When a backup becomes the new live target, rewrite `manifest.json` to that app and, when a cached backup listing exists under `topic/tmp/backup-*.json`, promote it into `topic/app-store-listing.json` so later stages review the app that truly survived.
- If no viable preserved backup remains, return to the home screen, capture `topic/screenshots/03-Home-Screen-Blocked-No-App.png`, update `manifest.json` to blocked, append a checkpoint, and stop truthfully.
- As soon as `Open` is observed after a valid install action in this run, the next GUI action must be `gui_key key:"1" modifiers:["command"]` to return home.
- Home-boundary rule: do not guess home-bar, dock, or bottom-center taps to leave App Store. `command+1` is the primary home recovery path.
- Update `manifest.json` to its final state before saving the final `03` screenshot, so the harness cannot advance with stale metadata.

## Inputs

- `artifactsRootDir`
- `manifest.json`
- `topic/candidates.json`
- `topic/selection-notes.md`
- `topic/device-action-plan.json`
- `topic/screenshots/02-iPhone-App-Store-Detail.png`

## Outputs

- `manifest.json`
- `topic/candidates.json`
- `topic/selection-notes.md`
- `topic/app-store-listing.json`
- `experience/checkpoints.jsonl`
- `topic/screenshots/03-Home-Screen-With-App.png ?? topic/screenshots/03-Home-Screen-Blocked-No-App.png`

## Budget

- `maxMinutes=12`
- `maxActions=55`
- `maxScreenshots=2`

## Allowed Surfaces

- The live `iPhone Mirroring` window
- Shell only for targeted artifact updates and direct file verification under the active artifacts root

## Stop Conditions

- Success: the app was truly installed in this run, the phone is back on the home screen, and `topic/screenshots/03-Home-Screen-With-App.png` exists.
- Blocked: every preserved candidate was exhausted or ruled out, the phone is back on the home screen, and `topic/screenshots/03-Home-Screen-Blocked-No-App.png` exists with a truthful blocker summary.

## Decision Heuristics

- Prefer the calmest, shortest-query preserved backup first when the initial winner hits an auth or already-installed blocker.
- Keep pivots short: dismiss blocker, update notes, re-focus the search field, retarget search, reopen the correct detail page, retry install.
- If Stage 3 started off-detail, spend the one bounded detail-page recovery before declaring the stage unrecoverable. Do not improvise a brand-new browse flow or reopen the desktop browser.
- During pivots, placeholder search controls are navigation only. Do not type into them before an observation confirms the real editable field.
- Honor the backup candidate's exact frozen `searchAction.typeStrategy`. If it says `clipboard_paste` or `system_events_keystroke_chars`, that is the intended primary route for that query.
- During pivots, normalize remembered stale query text before replaying the frozen search action. A prefilled field from an earlier search is not proof the backup query already failed.
- During pivots, do not overreact to a field that only shows the query tail. If the tail still matches and the right result row is already visible, use the result row.
- During pivots, a live field with a clear `x` immediately after the frozen search action is evidence of accepted input, not a reason to clear. Only reset after the query is proven unrelated and the result path is empty, or after one frozen submit path still leaves no usable result.
- If a backup search lands on a results list, prefer the exact result row whose visible title matches the frozen hint set and whose developer matches when visible rather than retyping the query again.
- Use the current App Store session for pivots. Do not restart Stage 1 browser research.
- If the home screen is already visible after `command+1`, capture `03` immediately instead of adding extra gestures.
- Use Spotlight only as a fallback verification tool when install succeeded but the app icon is not immediately obvious on the home screen. Do not guess icon-grid coordinates across device sizes.
- If a cached backup listing is missing during pivot, continue the install attempt but record that the listing promotion fallback was partial rather than silently pretending the listing was rewritten from full evidence.

## Failure Policy

- If the worker loses the live App Store/detail-page context before any valid install action, stop with a blocker rather than guessing the state.
- If the worker encounters the same auth blocker after the one authorized password attempt, treat the candidate as blocked and pivot or terminate truthfully.
- Never set the episode to terminal `blocked` while a still-viable preserved backup remains untried.
- Do not claim Stage 1 success without `03-Home-Screen-With-App.png`.
