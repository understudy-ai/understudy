---
name: appstore-search-install
description: >-
  Stage 1: Use the browser to choose a current App Store candidate, capture the
  listing context, install the app through iPhone Mirroring, and stop on the
  iPhone home screen.
metadata:
  understudy:
    emoji: "🛒"
    requires:
      bins: ["screencapture"]
---

# appstore-search-install

## Rules

1. Browser discovery happens first. Do not start by blindly searching the mirrored App Store.
2. The stop state is the iPhone home screen with the selected app installed.
3. Verify every GUI action with a follow-up observation. Retry once before changing tactics.
4. Hard device-search contract: every device-side App Store query replacement must follow the locked candidate's frozen `searchAction` from `topic/device-action-plan.json`, including its exact `typeStrategy`, `replace`, and `submit` values. A combined `gui_type ... submit:true` search entry is forbidden unless the frozen plan explicitly says so.
5. Hard password contract: after one authorized secret-env password submit, the next step must be a single immediate observation. Repeated `Confirm` clicks, fallback `Enter` presses, or shell-side env probing on that candidate are forbidden.
6. Keep all run outputs under the active root directory. Prefer `artifactsRootDir`; use `EPISODE_DIR` only when that is the only explicit root.
7. Do **not** use `web_search` for this stage. The source of truth must stay on the App Store browser pages and the mirrored App Store app.
8. Do **not** call `itunes.apple.com/search`, ad hoc App Store APIs, or shell-side HTTP lookups to discover candidates, rankings, or search queries. The only allowed shell-side listing fetch is `fetch_app_store_listing.py` after the exact winner detail URL is already locked from the browser page.
9. After the exact winner detail URL is locked, do **not** make any extra shell-side network request about any other app for comparison, validation, fallback ranking, or "sanity checks". That prohibition includes ad hoc `python3 - <<'PY'` snippets, `curl`, `urllib`, `requests`, and named benchmark lookups such as Notion, Evernote, TimeTree, or any other famous alternate.
10. The playbook harness may auto-advance as soon as the expected output files exist. Update `manifest.json` and `topic/candidates.json` *before* creating the last output that would satisfy the stage.
11. Seeing `Open` on the App Store page does **not** finish the stage. The stage only finishes after the iPhone is back on the home screen, the final manifest update has been written, and `topic/screenshots/03-Home-Screen-With-App.png` exists.
12. `topic/screenshots/03-Home-Screen-Blocked-No-App.png` is a failure artifact, not a success artifact. If every preserved candidate still ends install-blocked, write the blocked artifacts truthfully and let Stage 1 fail instead of advancing to Stage 2.
13. The browser sub-step is incomplete until all of these exist on disk: `topic/app-store-listing.json`, `topic/candidates.json`, `topic/selection-notes.md`, `topic/device-action-plan.json`, `topic/device-action-plan.md`, `topic/screenshots/00-Browser-Today-Recommendation.png`, and `topic/screenshots/01-Browser-App-Detail.png`.
14. `target_override` is still a real Stage 1 run, not a shortcut. It must produce the same browser-side artifacts as the editorial path, even if the chosen app is forced.
15. Before the first browser tool call, bootstrap the artifact tree and `manifest.json`. Do not postpone manifest creation until after screenshots already exist.
16. Once the exact winner detail URL is known and both browser screenshots exist, do **not** open old run artifacts just to learn formatting. Use the templates and field lists in this skill, finish the browser package immediately, and then switch to iPhone Mirroring.
17. After the exact `appStoreUrl` is known, the only allowed browser-side closeout steps are: fetch listing -> write `topic/app-store-listing.json` -> run `package_browser_selection.py` so it writes `topic/candidates.json`, `topic/selection-notes.md`, `topic/device-action-plan.json`, and `topic/device-action-plan.md` -> update `manifest.json` -> verify files. Do not spend another round on `runtime_status`, extra ranking examples, format-hunting, shell-side candidate discovery, or shell-side competitor comparison.
18. Do not read helper script source just to understand its output. If this skill already names the helper and the required artifact contract, execute the helper directly and only inspect source when the helper actually fails.
19. Favor winners whose first truthful video can stay mostly local, readable, and iPhone-led. Collaboration-first, sync-first, or account-first apps should lose to a simpler local-first planner, utility, or reference app unless the collaboration-free first loop still looks clearly usable.
20. If iPhone Mirroring opens into a disconnected or retry state, do one bounded recovery ladder before blocking the stage. Do not confuse the disconnected illustration with a live phone surface.
21. In normal editorial selection mode, a browser detail state of `Open` is a ranking warning, not a success signal. Treat already-installed, recently reviewed, or clearly stale apps as presumptive rejects unless every visible alternative is materially worse and you record that exception explicitly.
22. When two candidates are close, prefer the one whose honest first review can be told entirely from iPhone-captured evidence. A note/planner/utility with a clean create-save-revisit loop should beat a flashier AI/search or creator app whose story would lean on browser explanation or one fragile remote payoff.
23. Treat slow-GUI fit as a hard constraint, not a soft preference. If the likely first-use story depends on rapid reflexes, dense dragging, long multi-asset import chains, or real-time combat, reject the candidate before the final shortlist.
24. Games are opt-in exceptions, not normal winners. Only let a game survive ranking when it is clearly pause-friendly and menu-led, such as turn-based tactics, card/deck, board, strategy, merge, or another slow deliberate loop.
25. Hard game rejection rule: fast action, rhythm, shooter, racer, platformer, realtime sports, realtime battle, or precision-drawing games should not win this demo in open-ended editorial mode.
24. Backup collection must stay cheap. Once one clear winner exists, do **not** open extra detail pages just to make the fallback list look richer; use only already-seen alternatives unless the winner is still unconvincing.
25. The moment `fetch_app_store_listing.py` starts, browser research is over. If `topic/candidates.json` still needs backups after that, use the winner plus 1-2 already-seen alternatives from the current visible surfaces rather than opening new pages.
26. After `fetch_app_store_listing.py` starts, the only acceptable shell activity is: run `package_browser_selection.py`, local JSON/file edits, and direct file verification. Any additional network fetch for another app is a contract violation, even if it is only "to compare" or "to confirm the winner".
27. In open-ended editorial mode, a zero-backup shortlist is exceptional, not normal. If the chosen winner is still a fresh `Get` install and at least one other calm visible app already survived the slow-GUI filter, preserve at least one backup before leaving the browser.
28. Same-day repeat veto: if local run history or `reviewed-apps.json` shows the same app was already explored, published, rejected as already installed, or blocked on App Store auth earlier today, treat it as a presumptive reject in open-ended editorial mode unless no calmer current alternative survives.
29. Device-side auth blocker guard: once the first live install attempt on iPhone has started, the candidate pool is frozen. From that point on, the only legal pivot targets are the entries already written in `topic/candidates.json`. Do **not** add new candidates through browser reopening, `web_search`, `itunes.apple.com/search`, shell-side HTTP lookups, ad hoc Python, or memory-based benchmark guessing.
30. No-backup terminal rule: if a device-side auth/install blocker appears and `topic/candidates.json` does not already contain another untried candidate with a real `deviceSearchQuery`, stop pivoting immediately, write the blocked artifacts truthfully, and end Stage 1. Do **not** invent a new shortlist after the blocker appears.

## Inputs

- `artifactsRootDir` or `EPISODE_DIR`
- `selectionMode` — default `today_editorial_free_app`
- `targetApp` — optional fixed app name override
- `appStoreRegion` — optional locale such as `us` or `hk`
- `allowAppleIdPasswordFromEnv` — default `false`; only when explicitly enabled may a standard Apple ID password sheet be completed with secret env typing instead of being treated as an automatic blocker
- `appleIdPasswordEnvVar` — optional env var name; default `UNDERSTUDY_APPLE_ID_PASSWORD`

## Fast Path

Read this section before you do anything else. The rest of the skill adds detail,
but this is the default successful flow.

1. Resolve `ROOT_DIR`, create the artifact folders, and run `bootstrap_stage.py`.
2. Use the browser first:
   - start on the regional `Today` surface
   - if the surface is too game-heavy or the only obvious app card is a spammy cleaner / booster / storage utility, do one calmer hop such as `App`, `Productivity`, `Reference`, or `Utilities`
   - when the storefront already shows the left category sidebar, prefer a single visible hop to `生產力` / `Productivity` before inventing other calmer routes
   - choose one winner plus 1-2 backups
   - default winner shape: planner, to-do, calendar, notes, utility, reference, calm organizer
   - default rejection shape: fast game, action game, rhythm, shooter, racer, platformer, dense creator tool, import-your-own-media flow, camera/document-required flow, spammy cleaner / booster / storage optimizer utility, one-answer-wall AI app with no backup proof surface, or a same-day repeat / same-day auth-blocked app from recent local history
   - games are only allowed when they are clearly card / deck / board / turn-based / strategy-first
3. Capture `00-Browser-Today-Recommendation.png` immediately on a recommendation / editorial / category surface before the winner detail page is opened.
4. Open the exact winner detail page and capture `01-Browser-App-Detail.png`. If the page already shows rating, age, developer, category, and screenshot carousel chrome, that capture is `01`, not `00`.
5. The moment `01` exists, stop browsing and immediately finish the browser package:
   - recover the exact App Store detail URL
   - run `fetch_app_store_listing.py`
   - preserve 1-2 already-seen calm backups whenever the winner is still a fresh `Get` install and the browser surface already exposed plausible alternatives
   - in editorial mode, leaving the browser with only the winner requires an explicit short zero-backup justification in `topic/selection-notes.md`; otherwise keep one already-seen backup
   - prefer `package_browser_selection.py` to write `topic/candidates.json`, `topic/selection-notes.md`, `topic/device-action-plan.json`, `topic/device-action-plan.md`, and the locked winner fields in `manifest.json` in one step
   - do **not** run any extra networked shell comparison for other apps after this point; use only the winner plus already-seen visible backups
   - verify those seven browser-side files exist
6. Only after those browser-side files exist may you switch to iPhone Mirroring.
7. Before any device-side App Store search or `02` capture, read and follow the dedicated helper artifact at `skills/appstore-device-search-detail/SKILL.md`.
8. In iPhone Mirroring, use that helper to search the locked winner, open the exact detail page, and capture `02-iPhone-App-Store-Detail.png`; only then continue with install and the later return to the home screen with `03-Home-Screen-With-App.png` when a candidate was truly installed.
9. If every preserved candidate still ends install-blocked, capture `03-Home-Screen-Blocked-No-App.png`, write the blocker truthfully, and stop there so Stage 1 fails instead of pretending the pipeline can continue.
10. If the live install attempt hits an Apple ID password sheet and `allowAppleIdPasswordFromEnv=true`, do one bounded secret-env password attempt on the current candidate before classifying it as install-blocked.
11. If the password attempt is not authorized, the env var is missing, or the auth gate persists after one bounded secret-env attempt, dismiss it and keep consuming the preserved backups in `topic/candidates.json` until one candidate reaches the home screen or every viable backup has been tried.

If you already have `00` and `01` but `topic/app-store-listing.json`,
`topic/candidates.json`, `topic/selection-notes.md`, `topic/device-action-plan.json`,
or `topic/device-action-plan.md` is still missing, the next action is **not**
more browsing or more iPhone work. The next action is to finish that browser
package immediately.

## Install Pivot Guardrail

Use this when the chosen app hits an App Store password or auth blocker.

1. If secret password entry is explicitly enabled for this run and the visible sheet is a standard Apple ID password prompt, do the one bounded secret-env password attempt first.
2. If that auth gate is still a blocker because password entry was not allowed, not available, or already failed, dismiss the sheet and back out to search immediately.
3. Use the next backup query from `topic/candidates.json`, but break ties in favor of the calmest, most searchable planner / utility style backup with the shortest reliable ASCII alias.
4. Do **not** reread long notes, reopen the browser, or re-rank the shortlist unless every preserved backup has already failed.
5. Update the artifact files only after the new backup becomes the real live target or after the fallback list is exhausted.
6. If that backup also hits auth or install friction before `03-Home-Screen-With-App.png` exists, repeat the same short pivot on the next preserved backup. Do **not** stop after the first failed fallback when another viable backup still remains.
7. Terminal `blocked` is only allowed after every preserved backup with a real `deviceSearchQuery` has been tried or ruled out.
8. The fallback universe is closed. Only use the entries that were already present in `topic/candidates.json` before the first device-side install tap. Do **not** reopen browser research, call `web_search`, hit `itunes.apple.com/search`, run ad hoc `python3 - <<'PY'` network snippets, or invent famous alternates from memory.
9. If no preserved backup exists at the moment the auth blocker is confirmed, skip the pivot entirely: return to the home screen, capture the truthful blocked artifact, update `manifest.json`, and stop.

The pivot should feel like one short recovery sequence, not a fresh planning session.

## Authorized Secret Password Entry

Use this only when all of the following are true:

1. `allowAppleIdPasswordFromEnv=true`
2. the visible modal is a standard Apple ID password sheet for the App Store transaction
3. the configured env var exists and is non-empty

Execution rules:

- Resolve the secret env var name from `appleIdPasswordEnvVar`; if it is absent, use `UNDERSTUDY_APPLE_ID_PASSWORD`.
- Never print, echo, inspect, or serialize the password. Do **not** read it with shell commands or write it into artifacts, notes, traces, or summaries.
- Do **not** use shell, Python, or any other side-channel to check whether the env var is present, inspect its length, trim it, or otherwise probe it. Pass the env-var name directly to `gui_type secretEnvVar` and let the authorized password attempt itself be the only check.
- Use `gui_type` with `secretEnvVar`, not `value`.
- The password-entry call must use the frozen `passwordAction` from `topic/device-action-plan.json` exactly as written. In this demo contract that means one `system_events_keystroke_chars` action with `replace:false` and `submit:false`; do not improvise a different method at runtime.
- The password-attempt sequence is fixed:
  1. `gui_type` into the visible password field with `secretEnvVar`, the frozen `typeStrategy`, `replace:false`, and `submit:false`
  2. click the sheet's visible primary action, such as `Sign In`, `Continue`, `Install`, or `Confirm`
  3. immediately `gui_observe` the same sheet/window once and branch on what is actually visible
- Post-submit branching rule:
  - if the password field is gone and the app page now shows download progress, `Open`, or another obvious install-in-progress state, continue the normal success path
  - if the password field is gone but a new App Store confirmation sheet is visible with account info and a blue `Install` button, treat that as a successful password handoff, click that `Install`, and continue the install flow
  - if the password field is still visible, the same blue `Confirm` / `Sign In` action is still present, or an explicit password/auth error is shown, treat the attempt as failed for this candidate
- Do **not** decide success or failure from a broad `gui_wait state:\"disappear\"` on a generic `App Store password sheet` target. The sheet title can stay `App Store` while the body changes to a non-password confirmation surface.
- After the one submit click, do **not** click `Confirm` again, do **not** press `Enter`, and do **not** improvise more keyboard submission on the same password sheet. The only allowed next step is the one immediate `gui_observe`, followed by branch classification.
- Limit this to one secret-env password attempt per candidate. If the env var is missing, the password field remains, the entry is rejected, or another auth/payment wall appears after the post-submit observation, stop trying to authenticate on that candidate, dismiss the sheet, record the blocker, and pivot or terminate truthfully.
- Do **not** override the frozen password-entry strategy, do **not** use autofill, and do **not** run repeated blind submit loops on the password sheet.

## Winner Filter In One Glance

Use this short ranking ladder unless the user forced a target app.

Preferred winners:

- local-first organizer / to-do / planner / calendar / reminder / notes app
- calm utility / reference / reading / writing / journaling app
- calm education / tracker app with one bounded first-use loop
- AI / search / assistant app only when the listing already shows a backup proof surface such as history, sources, saved threads, or another visible trust UI
- creator / media app only when the first honest story still works without importing personal media or doing dense timeline work
- game only when it is clearly slow, menu-readable, and pause-friendly

Reject by default:

- fast action, shooter, rhythm, racing, platform, sports, reflex puzzle, realtime battle
- apps that mainly need importing personal media, scanning a real document, or granting broad permissions before the first payoff
- spammy cleaner / booster / storage optimizer / battery-saver style utilities whose main promise is junk cleanup, phone boosting, or storage rescue
- apps whose likely video would collapse into one empty canvas, one launch tour, or one remote answer wall
- apps that are likely already installed, recently reviewed, or only searchable on device through a long fragile non-Latin query
- apps that already hit App Store auth / password friction earlier the same day in local run history, unless no stronger current alternative survives

Installability / editability tie-break:

- when two candidates are close, prefer the one with the shorter ASCII device search query, the calmer local-first loop, and the smaller chance of broad permissions or account setup
- rank down apps whose honest first useful video would still require personal-media import, dense timeline work, freehand drawing precision, camera/doc capture, or long non-Latin search input on device

## Browser Package Contract

The browser portion is only complete when all of these are true on disk:

- `topic/screenshots/00-Browser-Today-Recommendation.png`
- `topic/screenshots/01-Browser-App-Detail.png`
- `topic/app-store-listing.json`
- `topic/candidates.json`
- `topic/selection-notes.md`
- `topic/device-action-plan.json`
- `topic/device-action-plan.md`

Browser screenshot boundary rules:

- `00-Browser-Today-Recommendation.png` must show a recommendation / editorial / category / browse surface, not an app detail page.
- If the visible page already shows detail-page chrome such as rating, age, developer, category, price/get state, and a screenshot carousel, you are already on the app detail page. That capture belongs to `01-Browser-App-Detail.png`, not `00`.
- If `00` was accidentally captured on a detail page, overwrite it with a truthful recommendation-surface capture before continuing.
- Capture `00` before the winner detail click, then capture `01` on the winner detail page. Do not reverse that order.

Right after the winner detail page is open, use this exact closeout order:

1. recover the exact App Store detail URL
2. run `fetch_app_store_listing.py`
3. run `package_browser_selection.py`
4. run `test -f` checks for the seven browser-side artifacts above

Do not open iPhone Mirroring before that closeout order is finished.

Safe detail-URL and listing extraction pattern:

```bash
APP_URL="<exact apps.apple.com detail URL>"
python3 skills/appstore-search-install/scripts/fetch_app_store_listing.py "$APP_URL" \
  --region "$APP_STORE_REGION" \
  --selection-source "$SELECTION_SOURCE" \
  --selected-date "$SELECTED_DATE" \
  --copy-language en \
  --out "$ROOT_DIR/topic/app-store-listing.json"
```

If the browser tool already exposes the active detail URL through `browser.status`,
prefer that. Otherwise copy the address bar from the active browser tab and read it
with `pbpaste`. Do not guess the detail URL from search results or category pages.

Preferred browser-package helper:

```bash
python3 skills/appstore-search-install/scripts/package_browser_selection.py "$ROOT_DIR" \
  --device-search-query "Sofa" \
  --expected-core-task "Create one downtime list item, save it, and reopen the list." \
  --why-win "Local-first organizer flow with a clear save-and-revisit story and readable UI." \
  --risk "The first run may still prompt for notification or account preferences." \
  --beats-backups "It looks calmer and easier to prove on iPhone than the flashier alternatives from the same surface." \
  --chosen-surface "Productivity category editorial page" \
  --selection-source "$SELECTION_SOURCE"
```

If `allowAppleIdPasswordFromEnv=true` for this run, extend that command with:

```text
--allow-apple-id-password-from-env \
--apple-id-password-env-var "${APPLE_ID_PASSWORD_ENV_VAR:-UNDERSTUDY_APPLE_ID_PASSWORD}"
```

That helper also freezes `topic/device-action-plan.json` and
`topic/device-action-plan.md`. Treat those files as the exact device-side
search and password-entry contract for the later iPhone steps.

Use 1-2 `--backup` flags only when you already have believable alternatives from
the visible browser surfaces. The backup format is:

```text
--backup "Name||Developer||Category||https://apps.apple.com/...||Free||Query||Why it still fits slow GUI||Main risk"
```

If you do not have a credible backup yet, write the winner first and keep moving.
Do not stall the stage just to make the fallback list prettier.

Backup floor in editorial mode:

- if the chosen winner is a fresh install from a visible `Get` state and the current browser surfaces already showed at least one other believable calm app, do not leave `topic/candidates.json` with only the winner
- preserve at least one backup with:
  - a real detail URL
  - a short reliable device search query
  - a local-first or low-friction first-use story
  - a lower or comparable slow-GUI risk
- only accept a zero-backup shortlist when:
  - the user forced a specific target app
  - every already-seen alternative is clearly worse for installability or proof depth
  - or the surface truly exposed no believable calm fallback at all

Minimal `topic/candidates.json` contract:

- keep 2-3 entries total, not an essay
- include the chosen winner first
- each entry should preserve at least:
  - `name`
  - `developer`
  - `category`
  - `appStoreUrl`
  - `priceText`
  - `free`
  - `selectionSource`
  - `deviceSearchQuery`
  - `expectedCoreTask`
  - `majorRisk`
  - `whyItFitsSlowGui`
  - `rank`

Minimal `topic/selection-notes.md` contract:

1. `# Stage 1 selection notes`
2. `## Chosen app`
3. `## Why this app won`
4. `## Locked device search query`
5. `## Risks seen on the listing page`
6. `## Why it beats the backups`

Keep the notes short and specific. The goal is to unblock install and later review,
not to write a long strategy memo.

Use only the already-seen visible App Store surfaces plus the locked winner listing.
Do **not** pad `topic/selection-notes.md` with shell-fetched competitor comparisons or
named benchmark apps that were never actually seen in the browser during this run.

## Step 1: Resolve the active root and bootstrap files

Determine `ROOT_DIR` before doing anything else:

- if the playbook input `artifactsRootDir` is present, use it
- otherwise use the explicit `EPISODE_DIR`
- expand `~` to a full path before using it

Create the required tree:

```bash
ROOT_DIR="<resolved root dir>"
mkdir -p "$ROOT_DIR"/{topic/screenshots,experience/screenshots,post/assets,publish}
touch "$ROOT_DIR/experience/checkpoints.jsonl"
mkdir -p "$HOME/understudy-episodes"
```

Mandatory bootstrap step before any browser navigation:

```bash
python3 skills/appstore-search-install/scripts/bootstrap_stage.py "$ROOT_DIR" \
  --selection-mode "${SELECTION_MODE:-today_editorial_free_app}"
test -f "$ROOT_DIR/manifest.json"
```

If that helper is unavailable, immediately run the manual bootstrap block above
and write `manifest.json` before you call any browser tool.

History inputs for repeat / install-risk scoring:

- Read `$HOME/understudy-episodes/reviewed-apps.json` when it exists.
- Also inspect recent local run artifacts under `.understudy/playbook-runs/*/artifacts/` when they exist in the workspace.
- If a recent local run already selected or explored the same app, treat that as a serious repeat signal and a likely `already installed` risk even if the cleanup ledger was not updated yet.
- Prefer to merge both sources mentally before ranking candidates, rather than trusting only one ledger.

Write `manifest.json` immediately. Include at least:

- `episodeId`
- `status: "discovering"`
- `phase: "discovering"`
- `selectionMode`
- `selectedApp: null`
- `timestamps.created`
- `artifacts.topicScreenshots`

Optionally mirror the active run into `$HOME/understudy-episodes/active-episode.json`,
but the canonical artifact root is `ROOT_DIR`.

## Step 2: Use the browser to choose the app first

Use the browser route before iPhone Mirroring.

Primary browser route:

- On the first browser call in this stage, explicitly request `browserConnectionMode: "auto"`.
- If the browser reports that the Understudy extension relay is already attached to the intended tab, continue with `browserConnectionMode: "extension"` for the rest of browser research in this stage.
- If `auto` falls back to a healthy managed tab, keep going. Do **not** spend the whole stage re-attaching the browser once `apps.apple.com` is already working.
- If the browser tool reports a managed blank tab hint, do one clean recovery only: either open the target App Store URL directly in the managed tab or attach the extension to an existing Chrome tab. After that, continue the research flow instead of bouncing between blank tabs.
- Start the managed browser directly on the regional Today URL in one step when possible. Prefer `browser.start` with the Today URL already supplied, rather than a bare `browser.start` followed by a separate open.
- Open the regional Today page directly in the browser first, for example `https://apps.apple.com/hk/today` when `appStoreRegion=hk`.
- Prefer direct browser navigation on `apps.apple.com` over external web search.
- If the Today page cannot be opened or does not expose enough current editorial context, stay inside the browser and navigate to another current App Store editorial or chart page on `apps.apple.com`. Do not call `web_search`.
- Category/grouping 404 rule: if the browser lands on an `apps.apple.com/.../grouping/...` or similar category URL that shows `The page you're looking for can't be found` / `找不到你所尋找的頁面`, treat that route as dead for this run.
- After a category/grouping 404, do **not** keep probing nearby grouping URLs, hand-constructing new regional grouping paths, or looping on back/forward experiments. Return immediately to a working visible surface such as `Today`, `App`, or another non-404 editorial page and choose from cards you can actually see.
- Prefer clicking visible App Store navigation and visible recommendation cards over manually inventing grouping/category URLs. The web storefront can send region-mismatched grouping paths that waste the whole stage.

Managed-browser recovery rule:

- If the browser tool reports errors such as `Target page, context or browser has been closed`, treat the current managed browser context as dead.
- In that case, call `browser.start` again with the Today URL, then retry the navigation/open step once.
- Do **not** loop on `browser.open` against a known-dead context.

Selection policy:

- If `targetApp` is provided, research that exact app and treat it as the selection.
- Even when `targetApp` is provided, still begin from the regional browser App Store surface and capture `topic/screenshots/00-Browser-Today-Recommendation.png` before drilling into the exact app detail page.
- For `target_override`, `topic/candidates.json` may contain a single exact target candidate plus explicit notes that the app was forced by input rather than chosen from ranking. The file must still exist and explain the forced-selection context.
- Otherwise, inspect the current App Store Today/editorial surface for the current date in the chosen region.
- Prefer a free app that looks visually interesting and does not obviously require login, subscription, or payment.
- Prefer `App` recommendations over `Game` recommendations unless the game is clearly slow-paced and reviewable through deliberate GUI control.
- Treat non-game apps as the default winners. A game should only win if it is clearly slow-paced, menu-driven, and the non-game alternatives on the current surface are materially worse for this demo.
- If a game remains in contention, explicitly ask whether its first honest loop still works with slow deliberate taps, visible board/card state, and one meaningful before -> action -> changed-state moment. If not, drop it.
- If the visible Today surface is dominated by flashy or twitchy games, do not force a bad game pick just because it is prominent there. Stay inside `apps.apple.com` and pivot to a calmer editorial or category surface such as `App`, `Productivity`, `Education`, `Reference`, or another current non-game collection before locking the winner.
- If the current visible recommendation is a spammy cleaner / booster / storage-rescue utility, treat that as a low-trust candidate and do one calmer hop before locking a winner.
- When the left storefront sidebar is already visible, default that calmer hop to one visible click on `生產力` / `Productivity` before you start probing other categories or detail pages.
- Browser-research budget rule: after the initial Today surface, inspect only as many additional App Store surfaces as needed to produce one believable winner plus 2-3 ranked backups. In practice that usually means Today plus at most one calmer editorial/category surface and one detail-page drill-down for the chosen winner.
- Hard winner-lock rule: after you have seen one current recommendation surface, one calmer fallback surface if needed, and one detail page for the likely winner, stop researching and lock the winner plus at most 2 backups. Do **not** keep browsing once a calm candidate already passes the installability and proof-ladder checks.
- Hard browser-loop rule: after a valid `00-Browser-Today-Recommendation.png` exists, do not chain repeated category/detail clicks. From that point, allow at most one calmer hop and one winner detail drill-down before you must either lock the winner or explain the blocker truthfully.
- Once the winner detail URL is fetched successfully, do **not** open another category/chart page for ranking cleanup. Package the current winner immediately and let backups come from already-observed candidates only.
- Fresh-install hard-reject rule: if the browser detail page already shows `Open`, or recent local evidence makes the app very likely already installed, reject that candidate in open-ended editorial mode unless every other visible candidate is clearly worse for this demo.
- Chart-fallback caution: if the only surviving winner comes from `chart_fallback` and is also already installed, repeat-heavy, or a network-first AI/search candidate, do one more calmer non-chart App Store hop before locking it.
- Strongly prefer categories whose first useful loop is likely to be slow, permission-light, and text- or menu-driven: productivity, reference, planning, organizers, utilities, calm education, reading, writing, journaling, mindfulness, scanners, and lightweight lifestyle tools.
- Treat AI / search / assistant as second-tier candidates rather than default-safe categories. They can still work, but only when calmer local-first alternatives on the current surfaces are visibly weaker.
- Treat creator, photo/video, camera, music, or heavy customization apps as medium-risk rather than default favorites. Only pick them when the listing strongly suggests you can reach a meaningful blank canvas / editor / demo surface without mandatory broad permissions, account creation, or importing personal media before the first payoff.
- In open-ended editorial mode, the default category ladder should be:
  1. local-first organizer / planner / calendar / notes / utility / reference
  2. calm reading / writing / journaling / tracker / lightweight lifestyle tool
  3. AI / search / assistant with multiple visible backup proof surfaces
  4. creator / photo / video / camera tools with a believable sample-friendly first workflow
  5. scanner / OCR / document / homework tools whose free value still works with one bounded permission
  6. games that survive the slow-GUI filter
- Proof-ladder precheck: before locking any winner, be able to name one believable Stage 2 ladder from the browser evidence:
  - first useful screen
  - main action
  - visible result or saved consequence
  - one revisit / trust / limit / persistence beat
- If you cannot name that ladder from the listing and screenshots, downgrade the candidate even if the visuals look attractive.
- Treat planner / calendar / to-do / journaling / habit / reference / utility apps as the default winners for this demo because they usually support a cleaner local-first proof loop: create one fake object, show the saved state, then revisit it once.
- In the note / planner / organizer family, prefer candidates whose listing strongly suggests a readable typed loop such as create note -> list view -> reopen/search/tag/folder proof. Those loops usually produce the most human-like Stage 2 and Stage 3 results.
- Within planner / calendar / organizer candidates, prefer personal local-first flows over collaboration-first or sync-first positioning. If the listing sells invites, sharing, or account sync more than one-person use, score it below a calmer personal organizer unless the local first loop still looks obviously usable without an account.
- Shared-calendar downgrade rule: a calendar or planner that looks visually strong but probably needs sign-in, partner invites, or account sync before the first honest object appears should not beat a simpler reminder / note / utility / reference candidate.
- Within the broad note-taking family, prefer structured list / planner / reminder / calendar / document-style flows over blank-canvas handwriting / sketch / free-ink notebooks. If the listing mostly sells drawing, annotation, or Apple Pencil fidelity rather than a simple typed create-save-revisit loop, score it below a calmer structured organizer candidate.
- Treat blank-canvas handwriting / sketch notebooks as medium-risk even when they look premium. If the likely honest video would just show one empty canvas, one scribble, and one toolbar, reject that app in favor of a more structured organizer / reference / planner candidate.
- Treat gamified study, flashcard, language-learning, tutoring, or streak-driven education apps as medium-risk rather than safe defaults. They often look slow enough for GUI control but still depend on account state, subscriptions, remote scoring, or lesson progression before one honest proof beat lands.
- If you are browsing education surfaces, prefer calmer reference / organizer / note-adjacent tools over lesson / streak / quiz flows unless the lesson app clearly exposes a bounded first-use loop with no account wall and at least one follow-up proof surface.
- Treat scanner / OCR / homework-solver / handwriting-removal / camera-first products as medium-risk rather than safe defaults. They should only beat a calmer planner / note / organizer candidate when the listing strongly suggests one bounded free workflow, one secondary proof surface, and no obvious premium wall before the first payoff.
- Scanner / OCR hard downgrade: do **not** let a scanner / OCR / homework-solver / camera-first app beat a calm planner / organizer / reference / utility candidate when its first honest payoff still depends on finding a real document, granting camera/photo access, or importing outside material.
- Scanner / OCR default-reject rule: if the listing does not already imply one bounded sample-friendly workflow with a visible result and a second proof beat, reject it in open-ended editorial mode instead of hoping Stage 2 will improvise the missing document or permission story.
- Treat apps whose value depends on importing personal media, scanning a real document, or giving broad photo access as lower-ranked than apps that can prove value with one synthetic local object or one built-in sample-friendly flow.
- Do not let creator or media-editing polish win by default. If the app probably needs importing personal media, granting multiple permissions, or navigating a dense editor before one visible payoff, rank it below a calmer local-first app unless the calmer options are clearly much weaker.
- Treat passive ambience / lofi / wallpaper / widget / sticker / decorative companion / virtual-pet / idle-growth apps as high-risk unless the listing clearly proves one deliberate editable loop plus one saved or revisit beat. A pretty passive surface is not enough.
- Reject apps whose first useful experience obviously depends on high-speed or precision interactions, long tutorials, or repeated rapid taps/swipes.
- Avoid choices that are likely to derail the demo, including gacha / MMO / live-service competitive games / social casino / shooter / runner / rhythm / sports / fighting / racing / platformer / action-heavy puzzle flows, or anything that obviously depends on account creation before the first useful screen.
- If you do choose a game, only choose a clearly slow-paced one such as card, board, turn-based, deck-building, or menu-driven strategy. Treat fast real-time gameplay as disqualifying for this demo.
- Treat the game allowance as a hard whitelist, not a vibe check. In open-ended editorial selection mode, only card, board, deck-building, turn-based strategy, or other obviously menu-readable strategy games may survive. Everything else in `Games` should start from `reject`.
- Treat the acceptable-game window as intentionally narrow. A game should normally be rejected unless a viewer could understand the first useful loop from deliberate taps, pauses, and visible state changes rather than reflexes.
- Fast-feeling puzzle categories are not automatically safe. Reject match-3, drag-drawing, reaction-speed, timing-chain, or combo-heavy puzzle flows unless the game is visibly turn-based and menu-readable.
- In practice, the game categories that are most likely to survive ranking are card, board, turn-based strategy, deck-building, or other inspectable menu-driven systems. Everything faster should start from a default `no`.
- Prefer apps whose first meaningful task can likely be reached within roughly 15-20 deliberate GUI actions.
- Prefer apps with a short ASCII-friendly search alias or Latin brand token that can be typed reliably in iPhone Mirroring.
- Prefer candidates whose first-use surfaces and likely proof beats can still cut cleanly for an English-speaking viewer. A stable Latin alias plus readable English-first UI is a positive signal; dense localized copy with no clean alias is a ranking penalty.
- Treat installability through iPhone Mirroring as a hard quality gate, not a soft preference. If you cannot name one short device-side search query that should reliably reach the exact winner, do not choose that app in open-ended editorial mode.
- Penalize candidates whose only obvious device-search query is long CJK text with no stable Latin alias.
- Fresh-install rule: in normal editorial selection mode, Stage 1 should demonstrate a real install flow, not merely rediscover an already-installed app. Treat a recently reviewed app as likely-stale or already-installed unless there is strong contrary evidence.
- Prefer apps that can support a believable review video after one bounded exploration pass: there should be a visible product promise, a clear first-run loop, and at least one concrete feature worth showing.
- Hard first-video gate: in open-ended editorial mode, reject any candidate whose likely honest short would still depend on one of these brittle shapes: one remote answer wall, one import-your-own-media wall, one real-document scan requirement, or one empty canvas with no saved-state follow-up.
- Prefer winners whose first honest story could show `hook -> first useful screen -> task in progress -> changed state or revisit beat` using mostly iPhone captures rather than browser explanation.
- Prefer apps whose strongest first-run payoff is easy to verify inside one bounded session. If the whole review would depend on one remote response, one long upload, or one brittle account-backed surface succeeding perfectly, score that risk down hard.
- When choosing between a flashier high-variance candidate and a steadier app whose first payoff is easier to prove, choose the steadier app. Demo reliability matters more than theoretical excitement.
- If a safe planner, organizer, journal, utility, or reference app is close in score to a network-heavy AI/search candidate, prefer the safer app unless the AI/search listing clearly shows multiple backup proof surfaces you can still review when the first answer underperforms.
- Treat text-entry-heavy AI / search / assistant apps whose first honest proof depends on both fragile typing and one remote answer as high-variance candidates, not default winners.
- In open-ended editorial selection mode, an AI / search / assistant app should not beat a calm local-first planner / notes / organizer / reference / utility candidate unless the AI app clearly offers at least one tap-driven first proof path plus one secondary trust surface visible from the listing.
- Let an AI / search app win only when the listing already shows at least one tap-friendly first proof path or one strong secondary proof surface such as sources, history, library, saved threads, model picker, or visible answer cards that still matter even if the first answer underperforms.
- If a calm local-first planner, note, organizer, reference, or utility app is even roughly competitive with a network-heavy AI / search app, the calmer local-first app should usually win.
- Hard calm-first rule: in open-ended editorial mode, do **not** lock an AI/search/chat app as the winner while a calmer local-first organizer / planner / reference / utility candidate with a believable create-save-revisit loop is still visible on the current surface or one obvious calmer App Store hop away.
- Pivot-before-risk rule: if the current visible surface only offers scanner/OCR, AI/search, or creator/media-editing candidates, do one calmer App Store hop such as `App`, `Productivity`, `Reference`, or `Utilities` before locking a winner. Do not settle for a brittle candidate while a calmer one is one obvious storefront step away.
- Video-story rule: reject any candidate whose likely honest short would collapse into one static answer wall, one empty canvas, or one launch-tour montage. The winner should plausibly yield a hook, a first useful screen, a task-in-progress beat, and one changed-state or revisit beat.
- Final-video fit rule: the winner should plausibly support a `25-35s` English-first, iPhone-led short. If the likely story would lean on browser pages, dense localized store text, or one remote answer wall with no backup proof beat, rank that candidate down.
- English-facing copy rule: prefer candidates whose first useful loop and visible UI can still cut cleanly into an English-first review. A stable Latin alias is a positive signal because mirrored search/install is more reliable and the final short targets an English-speaking viewer.
- Prefer apps where the first meaningful task can be completed with on-screen text entry, a small configuration flow, or one reversible local action. When choosing between a flashy but risky candidate and a slightly plainer utility/reference app that is more likely to yield a clean narrative, choose the safer utility/reference app.
- Prefer apps whose value proposition can be shown with 3-4 visually distinct screenshots instead of one repeated text wall. A good candidate should likely yield a clear promise surface, a first useful screen, one task-in-progress screen, and one result / history / settings / payoff surface.
- Prefer anonymous or low-friction first-run loops. If the listing strongly hints that the first useful screen will be blocked by login, mandatory account linking, or broad media import before any visible value appears, score it down hard even when the brand is strong.
- Proof-ladder rule: before you let any candidate win, you should be able to name a believable three-beat review ladder from the listing alone:
  1. first useful screen
  2. one deliberate primary action
  3. one distinct saved / result / history / settings / limit / revisit proof surface
- If you cannot describe that three-beat ladder, the candidate is usually too shallow or too risky for this demo.
- Passive-proof rule: if you cannot describe a visible `before -> action -> changed state` ladder without hand-waving, the candidate is probably too passive for this demo even if the artwork looks appealing.
- Prefer candidates whose install path is unlikely to turn into purchase/auth drama. Longstanding free planners, note tools, utilities, and reference apps usually beat trendier creator or account-centric apps when the review upside is otherwise close.
- For AI / search / assistant apps, prefer products whose listing or screenshots show visible answer cards, citations, source chips, history, library, voice, model/tool switches, or follow-up surfaces. Avoid generic blank-chat products that would likely produce a weak, low-variety review video.
- For AI / search / assistant apps, do not let "it might answer something cool" win by itself. Only rank them above a safer planner / organizer / utility candidate when they also show strong backup proof surfaces that remain reviewable even if the very first answer stalls or partially fails.
- AI / search hard downgrade: if the first honest payoff still depends on one fragile remote answer and the listing does not also imply a backup proof surface such as citations, history, model choice, saved threads, or another trust UI, rank it below a calmer local-first organizer / utility / reference candidate.
- In open-ended editorial mode, a calm local-first productivity / notes / calendar / organizer / reference app should beat an AI/search candidate by default. Let an AI/search app win only when the calmer options are clearly weaker and the AI app still has multiple believable proof surfaces beyond one fragile remote answer.
- Production-tool overlap rule: dense creator suites, heavy media editors, or apps whose core value overlaps too much with the later review-production workflow should normally lose in open-ended editorial mode unless they are still the clearest truthful recommendation on the current App Store surface and the first-use loop is obviously sample-friendly.
- Hard shortlist rule: before a candidate is allowed into the final shortlist, it should pass all of these checks unless the user explicitly forced the target app:
  - you can explain one deliberate first-use loop that fits within about 15-20 GUI actions
  - that loop does not depend on reflexes, repeated rapid gestures, or exact timing
  - you can name one short device-side search query or alias that should reliably locate the app in iPhone Mirroring
  - the listing suggests at least one secondary proof surface beyond the opening screen
  - the app still looks reviewable even if one permission, one remote request, or one premium upsell underperforms
- If a candidate fails one of those hard shortlist checks, drop it before ranking rather than trying to rescue it with hype or brand recognition.
- Shortlist diversity rule: do not keep 3 fallback candidates that all fail in the same way. Preserve some install-shape variety, for example one steady note/planner candidate, one utility/reference candidate, and one broader but still calm app with richer screenshots.
- Treat repeated picks as a serious quality problem. If `$HOME/understudy-episodes/reviewed-apps.json` or recent local playbook run artifacts show that the same app was already reviewed recently, especially earlier the same day, reject it by default and only reuse it when every other current candidate is clearly worse for the demo.
- The same app should almost never win twice in one day. A previously reviewed app with known permission friction or shallow depth should be treated as effectively disqualified unless this run is an explicit revisit.
- Treat broad first-run permission gates as a major negative signal. If the listing makes it obvious that the app will demand photo library, camera, microphone, location, or account linkage before any visible value is shown, penalize it heavily unless that permission is lightweight and clearly unavoidable for the core task.
- Reject Apple first-party storefront, commerce, account, or device-companion apps as review candidates for this demo, including obvious cases such as `Apple Store`, `App Store`, Wallet-like service shells, setup helpers, or anything that feels preinstalled / infrastructural rather than a fresh product experience.
- Reject candidates that are mainly system surfaces, account portals, or shopping/storefront wrappers even if they appear on the editorial page.
- If the current Today pick is paid, pre-order only, region-locked, or clearly unsuitable, fall back to another current free editorial or chart candidate and explain why in `selection-notes.md`.
- If `$HOME/understudy-episodes/reviewed-apps.json` exists, read it before final ranking and explicitly call out any duplicate-app penalty in `topic/candidates.json` or `selection-notes.md`.
- If recent local playbook run artifacts exist under `.understudy/playbook-runs`, inspect a small recent window of them and apply the same duplicate penalty when the same app already appeared there.
- Keep a short ranked fallback list, not just one idea. `topic/candidates.json` should normally preserve at least 3-4 current candidates with explicit demo-fit reasoning so the install step can pivot if the first choice hits auth or platform friction.
- In open-ended editorial discovery mode, stay on editorial and chart surfaces. Do **not** type ad hoc queries into the browser App Store search box unless you are resolving a `target_override` or intentionally reopening the exact already-chosen winner.
- Slow-GUI anti-pattern rule: if a candidate's best story depends on rapid combat, live matchmaking, precision drawing, dense timeline editing, fast multi-touch gestures, or a long asset-import chain, reject it even when the listing looks exciting.
- Game-genre whitelist rule: when a game does survive this filter, the honest reason should sound like `turn-based`, `card/deck`, `board`, `merge`, `strategy`, or another clearly slow menu-driven loop. If the only honest label sounds like `action`, `arcade`, `rhythm`, `shooter`, `racing`, `platform`, or `realtime`, reject it.
- Human-review cutoff: reject candidates whose honest first short would likely collapse into "title + App Store promise + one empty screen + verdict" because the first useful proof still looks too uncertain from the browser evidence.
- Current-editorial route rule: the browser selection should still feel like "today's App Store recommendation", not a totally unrelated search project. Prefer the regional Today page first, then a nearby current App collection or App-category editorial surface. Use charts only when the calmer editorial path is visibly too game-heavy or too weak.
- Game tie-break rule: if any non-game candidate and any game candidate are close, prefer the non-game candidate. Games should only survive when they are clearly card / board / turn-based / deck-building / strategy-first and the non-game options are materially worse.
- Game hard veto: reject action, runner, rhythm, shooter, live PvP, platformer, sports, reflex puzzle, and other speed-first games outright. In practice, only card / board / deck-building / turn-based / deliberate strategy games may survive the game filter at all.
- Creator-tool hard veto: reject apps whose honest first loop mainly depends on importing personal media, scrubbing a dense timeline, freehand precision drawing, or rapid multi-touch gestures. They are poor fits for slower GUI control and usually produce weak first-run review proof.
- Stop-browsing threshold: once you can already name one calm winner and 2-3 plausible backups from the current browser evidence, stop hunting for more "just in case" candidates. Extra browsing after that usually hurts reliability more than it helps ranking quality.

Selection scoring rubric:

- Do not choose the winner on vibes alone. Rank candidates with a short explicit rubric that favors demo reliability over visual flash.
- For each serious candidate, estimate:
  - `paceFit`: can the core loop be shown through deliberate, slower GUI control?
  - `permissionFit`: can the first useful task likely be reached without risky or broad permissions?
  - `interactionSpeedFit`: does the first useful loop still work well with slower, deliberate GUI control?
  - `depthFit`: is there enough real product depth for Stage 2 to capture more than a launch screen?
  - `narrativeFit`: would the result produce a clear review story instead of a vague tour?
  - `shortVideoFit`: would the honest final short likely feel iPhone-led, motion-capable, and visually distinct rather than static or card-dependent?
  - `visualEvidenceFit`: is the likely evidence visually varied and easy to understand in a short video?
  - `recordabilityFit`: can Stage 2 likely capture one short live iPhone clip or clearly dynamic proof beat without relying on frantic speed?
  - `proofReliabilityFit`: is the first payoff likely to be truthfully verifiable on a first run without depending on one fragile remote success?
  - `searchabilityFit`: is there a short, device-friendly query or alias that can reliably find this exact app in the mirrored App Store?
  - `freshInstallFit`: is this likely to produce a real `Get` / cloud-download install flow instead of another stale `Open` state from a previous run?
  - `installabilityFit`: if the first winner hits install/auth friction, does this still look like a fast honest pivot candidate rather than another fragile bet?
  - `repeatPenalty`: should this app be penalized because it was already reviewed recently?
- Prefer the candidate with the strongest combined fit after penalties.
- If a candidate looks glamorous but scores poorly on `permissionFit`, `interactionSpeedFit`, `depthFit`, `shortVideoFit`, `visualEvidenceFit`, `recordabilityFit`, `proofReliabilityFit`, `searchabilityFit`, or `freshInstallFit`, reject it in favor of a steadier option.
- Tie-break rule: if a calmer planner / organizer / utility candidate beats an AI/search candidate on `proofReliabilityFit`, do not let screenshot flash or theoretical feature depth override that advantage unless the AI/search app is clearly stronger on multiple other axes and still looks safe enough for a first-run proof.
- Installation tie-break rule: if two candidates look similarly good for the review, prefer the one with the more reliable iPhone search alias.
- Already-installed tie-break rule: if one candidate is more likely to still show `Get` and another is more likely to show `Open` from a previous run, prefer the fresh-install candidate unless the user explicitly forced the target app.
- Auth-risk tie-break rule: if two candidates are otherwise close, prefer the one whose story still works even if premium AI, sync, or collaboration layers stay locked. Avoid candidates whose entire pitch collapses when install or login friction appears.
- `topic/candidates.json` should preserve these fit notes so the install fallback step can make a grounded pivot instead of guessing.

Winner-freeze rule:

- Once you have a clear winning candidate, its exact `appStoreUrl`, and a believable reason it beats the fallback list, lock that choice.
- After the winner is locked, do **not** keep browsing other candidates, typing new browser search queries, or reopening ranking loops unless one of these is true:
  - the chosen app is later discovered to be paid, region-blocked, duplicate-disqualified, or clearly unsuitable before you finish the browser metadata package
  - the chosen app hits an install blocker later on the iPhone, which triggers the explicit install fallback rule
- Do not let an already-selected winner drift into a totally different app because of an extra browser search. Freeze first, write the browser package, then move to iPhone Mirroring.
- If you already have one winner plus enough ranked fallback entries to survive one install pivot, opening a second category chart or a second long browser detour is usually a mistake. Freeze and package instead.

Capture two browser evidence screenshots:

- `topic/screenshots/00-Browser-Today-Recommendation.png`
- `topic/screenshots/01-Browser-App-Detail.png`

Use whichever browser screenshot path is most reliable in the current environment:

- built-in browser screenshot/save action if available
- otherwise bring the browser frontmost and capture the window with `screencapture`
- after each capture, immediately verify the target file exists on disk; if the browser-reported screenshot did not actually write the file, use `screencapture` or another OS-level fallback and keep the same destination path

Browser screenshot fallback policy:

- If the browser screenshot tool returns an image but the requested file path does not exist, treat that as a failed save and switch immediately to an OS-level capture.
- Prefer a dedicated App Store browser window for fallback captures. Open or retarget a clean Safari window to the exact `apps.apple.com` page you need for `00` or `01`, then capture that Safari window instead of reusing an unrelated existing Chrome / YouTube / work window.
- Prefer `gui_observe ... captureMode:"window"` on the front browser window to obtain `capture_rect`, then reuse that rectangle for `screencapture -R"x,y,w,h"`.
- Once the managed browser screenshot fails a save check once, do **not** retry it again in this stage. Switch permanently to the OS-level capture path for both `00` and `01`.
- The only approved OS-level capture path for browser evidence in this stage is: ensure the front window is a real App Store page, bring that browser window frontmost, `gui_observe ... captureMode:"window"` to get `capture_rect`, then `screencapture -R...` to the final artifact path.
- Before capturing, verify that the visible front window title or URL clearly matches the intended App Store page. For `00`, it should be the regional Today/editorial page. For `01`, it should be the exact selected app detail page.
- Do **not** use an arbitrary Chrome app-union capture when Chrome is currently showing unrelated work such as YouTube Studio, Gmail, or another non-App-Store tab.
- If Chrome is already occupied by unrelated work, prefer Safari for the dedicated fallback capture. Only use Chrome fallback when you can prove the active front window is the exact `apps.apple.com` page you want.
- When using `screencapture` plus a crop step, do **not** write to hidden dotfile temp names such as `.tmp00.png` or `.tmp01.png`. In this environment those paths can fail unexpectedly. Use visible temp names such as `00-raw.png` / `01-raw.png`, verify they exist, then crop or rename into the final artifact path.
- If the GUI tool does not expose numeric bounds that you can directly reuse, use a deterministic CoreGraphics fallback via `swift` to read the front browser window bounds.
- Browser-owner match rule for the `swift` fallback: do not hardcode an English owner name. Match loosely on the front browser owner/title, for example names containing `Safari`, `Safari浏览器`, `Google Chrome`, or another visibly active browser owner in the window list, but still require the matched window title to look like an App Store page rather than an unrelated browser task.
- Do **not** try `import Quartz` from Python for this; use `swift` + `CoreGraphics` directly if a fallback is needed.
- Do **not** use Playwright, browser automation helper scripts, or temporary capture programs for browser screenshots in this stage.
- Do **not** create scratch files such as `_capture.mjs` under the artifact tree just to take screenshots.
- Avoid AppleScript window inspection unless the GUI tool cannot observe the browser window at all.
- If a one-time macOS automation permission prompt appears while bringing the browser frontmost, clear it and continue, but do not make AppleScript the primary screenshot path.

Listing extraction policy for `topic/app-store-listing.json`:

- Do **not** use `web_search` for metadata enrichment.
- Do **not** depend on `browser.evaluate` for critical metadata extraction; if it fails, continue with the fallback below instead of retrying repeatedly.
- Do **not** use third-party Python libraries such as `requests` or `bs4` for this stage. Use Python standard library only, especially `urllib.request`, `re`, `json`, and `html`.
- After opening the app detail page, capture the exact App Store detail URL. Prefer the browser tool first, especially `browser.status`, when it already exposes an `apps.apple.com/.../id...` detail URL.
- Only if the browser tool does not expose the detail URL, activate the front browser, press `command-l`, copy the address bar with `command-c`, and read the URL with `pbpaste`.
- If you later need an OS-level screenshot fallback for the detail page, reuse this exact `appStoreUrl` to retarget the dedicated Safari fallback window before capturing `01`.
- Once the exact `appStoreUrl` is known, prefer the workspace helper `python3 skills/appstore-search-install/scripts/fetch_app_store_listing.py "$APP_URL" ...` to extract structured fields such as title, subtitle, developer, category, rating, price text, description, and image URLs in one deterministic step.
- The first positional argument to that helper is mandatory and must be the exact App Store detail URL. Do not pass only flags.
- Safe invocation pattern:

```bash
APP_URL="<exact apps.apple.com detail URL>"
python3 skills/appstore-search-install/scripts/fetch_app_store_listing.py "$APP_URL" \
  --region "$APP_STORE_REGION" \
  --selection-source "$SELECTION_SOURCE" \
  --selected-date "$SELECTED_DATE" \
  --browser-evidence "$ROOT_DIR/topic/selection-notes.md" \
  --copy-language en \
  --out "$ROOT_DIR/topic/app-store-listing.json"
```

- If you do not yet know the exact `APP_URL`, stop and recover it first. Do not guess the helper invocation from a search page or from a missing positional arg.
- When available, prefer real App Store screenshot URLs from the detail page over the app icon alone. Stage 1 should hand later stages at least a few truthful store visuals, not just the logo.
- Only if that helper is missing or clearly broken, fall back to `curl` / `urllib` plus a short inline `python3` parser.
- Prefer the App Store page's embedded JSON-LD / schema block first, especially `<script name="schema:software-application">`, before falling back to looser regex parsing.
- When multiple JSON-LD blocks exist, select the one whose `@type` is `SoftwareApplication`, not generic `Organization` or site-level metadata.
- If JSON parsing fails on a candidate block, skip that block and continue scanning for another `SoftwareApplication` block instead of aborting the stage.
- Use visible browser text from `browser.snapshot` or the detail screenshot as the fallback source for any fields that the HTML parse does not yield.
- If the extracted `subtitle` looks like generic App Store chrome or storefront boilerplate rather than a product positioning line, treat it as invalid and replace it with a better verified short line or leave it empty. Examples of invalid subtitle-like boilerplate include strings such as `在 App Store 下載...`, `Download ... on the App Store`, or long storefront sentences about screenshots / ratings / reviews.
- Only use values you can actually verify from the App Store page or its direct HTML response. Do not guess missing fields.

Browser-package finalization order:

- Once `00-Browser-Today-Recommendation.png`, `01-Browser-App-Detail.png`, and the exact `appStoreUrl` exist, stop browsing and finish the browser package immediately.
- The required order is:
  1. extract or verify the exact `appStoreUrl`
  2. fetch and parse the App Store listing metadata
  3. write `topic/app-store-listing.json`
  4. run `package_browser_selection.py` so it writes `topic/candidates.json`, `topic/selection-notes.md`, `topic/device-action-plan.json`, and `topic/device-action-plan.md`
  5. update `manifest.json` with the locked winner
  6. run the `test -f` checks for all browser-side artifacts
- Do **not** open iPhone Mirroring, inspect more browser candidates, or revisit ranking loops after this point unless the locked winner is explicitly invalidated.
- Do **not** open another App Store category, chart, or detail page after step 2 above. If `topic/candidates.json` still needs fallback rows, write them from the already-seen shortlist and stop.
- Do **not** run any other networked shell lookup after step 2 above. No extra `itunes.apple.com/search`, no alternate-app benchmark script, and no shell fetch for competitors. Package the winner from the already-seen browser evidence and move on.
- If you have the browser screenshots but have not yet written `topic/candidates.json`, `topic/selection-notes.md`, `topic/device-action-plan.json`, `topic/device-action-plan.md`, and `topic/app-store-listing.json`, the browser step is still incomplete. Finish those files first.

Write `topic/app-store-listing.json` with at least:

```json
{
  "name": "string",
  "developer": "string",
  "category": "string",
  "rating": 4.8,
  "priceText": "Free",
  "free": true,
  "subtitle": "string",
  "description": "string",
  "appStoreUrl": "https://apps.apple.com/...",
  "iconUrl": "https://...",
  "imageUrls": ["https://real-store-screenshot-1", "https://real-store-screenshot-2"],
  "selectionSource": "today_editorial | target_override | chart_fallback",
  "selectedDate": "2026-03-22",
  "browserEvidence": [
    "topic/screenshots/00-Browser-Today-Recommendation.png",
    "topic/screenshots/01-Browser-App-Detail.png"
  ]
}
```

Write `topic/candidates.json`, `topic/selection-notes.md`, `topic/device-action-plan.json`, and `topic/device-action-plan.md`.
Write these files before switching to iPhone Mirroring. Do not defer them until the end of the stage.

Formatting shortcut:

- Do **not** inspect previous runs just to learn the schema.
- `topic/candidates.json` can be a plain JSON array with 3-4 objects using only the fields already listed in this skill.
- `topic/selection-notes.md` can stay concise. The preferred structure is:
  1. `# Stage 1 selection notes`
  2. `## Chosen app`
  3. `## Why this app won`
  4. `## Locked device search query`
  5. `## Risks seen on the listing page`
  6. `## Why it beats the rejected candidates`
  7. `## Duplicate and risk penalties that changed ranking`
  8. `## Explicit non-candidates rejected from the visible surfaces`
- Keep the notes specific and short. The goal is to unblock install fallback, not to write a second essay.
- The phrase `visible surfaces` is literal here: only mention candidates that were actually visible on the App Store pages you opened in this run. Do **not** invent or benchmark famous comparison apps that never appeared on-screen.

Before switching to iPhone Mirroring, also update `manifest.json` from the bootstrap
placeholder to the browser-locked selection package:

- keep `status: "discovering"` and `phase: "discovering"`
- set `selectedApp.name`
- set `selectedApp.developer`, `category`, `rating`, `priceText`, `free`, `appStoreUrl`, `subtitle`, and `description` when those fields are already known from the listing parse
- set `artifacts.topicScreenshots` to include `00-Browser-Today-Recommendation.png` and `01-Browser-App-Detail.png`

Also append one JSON line to `experience/checkpoints.jsonl` describing that the
browser package is ready and naming the locked winner. Keep it short and factual.

Artifact contract for `target_override`:

- `topic/candidates.json` must still be written.
- If the app was forced by input, include at least one candidate entry for that exact app with:
  - `selectionSource: "target_override"`
  - `forced: true`
  - the exact App Store detail URL
  - why the app is still a good or risky fit for the slow-GUI demo
- `topic/selection-notes.md` must explicitly say that the app was forced by input and therefore not ranked against current editorial alternatives in this run.
- Do not let `target_override` silently skip the browser metadata package.

`topic/candidates.json` should make install fallback possible. For each candidate,
capture enough fields to retry selection later, for example:

- app name
- App Store detail URL
- developer
- category
- price / free signal
- `selectionSource`
- `demoFitScore` or equivalent fit summary
- `paceFit`
- `permissionFit`
- `depthFit`
- `visualEvidenceFit`
- `proofReliabilityFit`
- `searchabilityFit`
- `freshInstallFit`
- `installabilityFit`
- `repeatPenalty`
- `expectedCoreTask`
- `deviceSearchQuery`
- `deviceSearchQueryType`
- why that device-side query should reach the exact app in iPhone Mirroring
- why it fits or does not fit the slow-GUI demo
- notable risk such as likely login, likely auth prompt, or likely poor first-run depth
- notable risk such as likely login, likely auth prompt, likely poor first-run depth, or likely unprovable first payoff
- if a backup candidate lacks both a real App Store detail URL and a usable `deviceSearchQuery`, it is too hollow to count as a real install fallback and should not stay in the ranked list
- notable risk such as a weak or non-ASCII-only device search query when install reliability matters
- a simple ranking or `demoFitScore`
- a one-line note explaining why this candidate would or would not be the fastest honest pivot if the current winner hits install/auth friction

Before you open iPhone Mirroring, explicitly verify the full browser-side
package exists on disk:

```bash
ROOT_DIR="<resolved root dir>"
test -f "$ROOT_DIR/topic/app-store-listing.json"
test -f "$ROOT_DIR/topic/candidates.json"
test -f "$ROOT_DIR/topic/selection-notes.md"
test -f "$ROOT_DIR/topic/device-action-plan.json"
test -f "$ROOT_DIR/topic/device-action-plan.md"
test -f "$ROOT_DIR/topic/screenshots/00-Browser-Today-Recommendation.png"
test -f "$ROOT_DIR/topic/screenshots/01-Browser-App-Detail.png"
```

Do not switch to iPhone Mirroring until those checks pass.

`selection-notes.md` should explicitly say:

- which app was chosen
- whether it came from the current Today/editorial surface or a fallback
- why it is a good review candidate
- any obvious risks seen on the listing page
- the locked `deviceSearchQuery` that Stage 3 should type on the phone, and why it is safe
- why it fits a slow-GUI demo better than the rejected candidates
- why it beat any flashier but riskier alternatives
- whether duplicate-app penalties or permission-risk penalties changed the ranking
- why obvious non-candidates such as storefront/system apps were rejected when they appeared in the editorial surface

## Step 3: Open iPhone Mirroring and install that exact app

Activate iPhone Mirroring, observe the window, and note the window bounds for all
device screenshots in this stage.

Dedicated helper artifact handoff:

- Before you perform any device-side App Store search typing or try to create `topic/screenshots/02-iPhone-App-Store-Detail.png`, read `skills/appstore-device-search-detail/SKILL.md`.
- Treat that helper as the authoritative protocol from home-screen/App Store entry through the successful `02` capture.
- Resume this Stage 1 skill only after the helper has either produced `02` or returned a truthful blocker.

```bash
open -a "iPhone Mirroring"
sleep 2
```

Mandatory pre-device freeze step:

```bash
sed -n '1,220p' "$ROOT_DIR/topic/device-action-plan.md"
test -f "$ROOT_DIR/topic/device-action-plan.json"
```

Device-execution freeze rule:

- Treat `topic/device-action-plan.json` as the authoritative payload source for device-side search and password entry.
- Before the first device-side `gui_type`, read the current candidate block from `topic/device-action-plan.md`.
- The first App Store search `gui_type` for a candidate must match that candidate's frozen `searchAction` payload exactly except for normal plain-text formatting of the tool call.
- After that frozen search `gui_type`, the only allowed next tool call is `gui_observe`.
- After that first frozen search `gui_type`, the immediate next action must be one `gui_observe`. A second `gui_type` before that observation is forbidden.
- The frozen search action may intentionally use `system_events_keystroke_chars` or `clipboard_paste`. Do not override that candidate-specific choice mid-run.
- Within the same search cycle, the focus click must hit the real editable search field, not the bottom Search destination or another bottom placeholder control.
- After the frozen search `gui_type`, re-clicking the same field before the post-type observation is also forbidden. The next move is observation, not refocusing the same field.
- If a target description still reads like placeholder copy such as `search field currently showing "Games, Apps and more"`, treat it as a broken or inactive field. Do not `gui_type` into that target; reacquire the real active field or reset Search first.
- If password entry is authorized, the only allowed password `gui_type` payload is the frozen `passwordAction` from `topic/device-action-plan.json`.
- If you pivot to a backup candidate, reopen the same plan files and use that backup candidate's frozen block instead of inventing new parameters.

Then:

```text
gui_observe app:"iPhone Mirroring" captureMode:"window"
```

Disconnect recovery rule:

- If the observation shows a disconnected illustration, `未找到iPhone`, `找不到iPhone`, `重试`, `Retry`, or another obvious not-connected state, do this bounded recovery ladder before calling the stage blocked:
  1. click the visible retry button once when present
  2. wait for the connecting state to either disappear into a live phone surface or clearly fall back to disconnected again
  3. if the window is still disconnected, relaunch `iPhone Mirroring` once, observe again, and retry the connection wait once more
- If that single relaunch still fails to reach a live phone surface, capture `topic/screenshots/02-iPhone-Mirroring-Disconnected.png`, record the blocker in `manifest.json` and `topic/selection-notes.md`, append one short checkpoint line, and stop as blocked instead of pretending the install branch ran.
- In that disconnected branch, do **not** invent `02-iPhone-App-Store-Detail.png` or `03-Home-Screen-With-App.png`. Those remain success-path artifacts only.
- Do not proceed to `command+1`, App Store search, or install steps while the mirrored device is visibly disconnected.

Immediate-next-action rule:

- After the first successful `gui_observe` on `iPhone Mirroring`, do not pause for a fresh strategy rewrite.
- If the observation does not clearly show a lock screen, disconnect state, or another explicit blocker, the next GUI action should be `gui_key key:"1" modifiers:["command"]` to force the home screen boundary.
- Do not burn extra iPhone observations before that first home-screen attempt unless the current screen is obviously not the phone at all.

Bounds rule for every later iPhone screenshot in this stage:

- Treat the latest GUI tool result `capture_rect` (or `pre_action_capture.capture_rect`) as the authoritative iPhone Mirroring window bounds.
- Persist that `{x,y,width,height}` tuple mentally and reuse it for every later `screencapture -R...` call in this stage.
- In this environment, after a successful `gui_observe` or `gui_click`, assume the GUI tool already knows the window rectangle. Do **not** run any `osascript` / AppleScript bounds lookup for iPhone Mirroring in this stage.
- If you ever lose the rectangle or are unsure whether it changed, call `gui_observe app:"iPhone Mirroring" captureMode:"window"` again and reuse that fresh `capture_rect`.
- If you still cannot recover numeric bounds from the GUI tool text, use a deterministic CoreGraphics fallback via `swift` to enumerate on-screen windows and extract the bounds for the `iPhone Mirroring` / `iPhone镜像` owner.
- Prefer a short inline `swift` script with `CGWindowListCopyWindowInfo` over any Python-specific macOS bindings.
- Do **not** try `import Quartz` from Python for this stage; that module is often unavailable here.
- Do **not** query `iPhone Mirroring` window bounds with AppleScript such as `tell application "iPhone Mirroring" to get bounds of front window`; that frequently fails with `-1728`.
- If a bounds refresh is needed and GUI observation alone is insufficient, the only approved shell fallback is the CoreGraphics `swift` lookup above.

Return the iPhone to the home screen:

```text
gui_key key:"1" modifiers:["command"]
```

Open App Store, go to Search, and search for the locked `deviceSearchQuery` chosen in Step 2.
After each GUI action, re-observe and verify the expected screen changed.

Recommended interaction pattern for the App Store search field:

- Search-entry verification ladder:
  1. tap the bottom `Search` tab / search destination once
  2. re-observe and confirm the App Store has actually switched into the dedicated Search screen
  3. only then target the real editable search field for text entry
  4. re-observe again and type only after the search field is visibly active
- Bottom-tab naming rule: when you target the bottom navigation control, use a short target phrase such as `bottom Search tab` or `Search tab in bottom navigation`. Do not decorate that target with the placeholder copy that may be visible nearby.
- Placeholder-copy rule: if the surface shows copy like `Games, Apps and more`, treat that text as environmental evidence only. Do **not** include that quoted phrase inside the click target description unless there is no other way to identify the control.
- Already-on-Search rule: if your first observation after opening App Store already shows the dedicated Search screen with a real editable search field, skip the extra bottom-tab tap and go straight to that active field.
- Search-field placement rule: the real App Store query field is not always visually anchored near the top. A low-on-screen field is valid only when it is clearly editable, separate from bottom navigation chrome, and accompanied by signs such as a caret, a clear `x`, suggestions, or results above it.
- When you target the bottom navigation control, describe it as the bottom `Search` tab, destination, icon, or label, never as a `search field`. If your intended target description still contains the word `field`, rewrite the target before clicking.
- Treat the bottom Search tab / destination pill as navigation only, not as the text field itself.
- Valid-active-field signs: a blinking cursor, a visible clear `x`, recent/suggested searches, app result suggestions, or a dedicated search-results surface above the field. When those signs are present, the field is real even if it sits low on the screen.
- Invalid-navigation signs: only the bottom navigation row is visible, there is no editable cursor or clear button, and no search suggestions/results surface has appeared yet. In that state, the control is still navigation only.
- If the visible target still looks like an inactive bottom Search destination with placeholder copy such as `Games, Apps and more` and there is no active search UI above it, you are still on navigation, not a ready input field. Do not type there.
- Forbidden pattern: do **not** issue `gui_type` against a target that is clearly still just the bottom navigation tab.
- Forbidden pattern: after tapping the bottom Search destination, the next allowed actions are `gui_observe`, a click into the active search field, or a clean reset back into Search. The next action must **not** be blind typing into a still-inactive nav pill.
- Hard reset rule: if you ever realize you typed into the bottom control or launched a combined paste/submit path from the wrong surface, do not keep salvaging that state. Clear it, back out, and restart the Search flow from the top-field ladder.
- If search-field grounding fails twice, that is a Search-screen state problem. Reset the Search screen once, re-observe, and reacquire the real editable field instead of improvising.
- Single-reset rule: if one bottom-tab click still leaves you unable to confirm the dedicated Search screen, do one clean reset immediately. Re-observe the bottom navigation row, tap the short-form `bottom Search tab` target again if needed, and only continue once the top search field is actually visible.
- Relaunch rule: if the App Store surface still feels stale after that one clean Search reset, relaunch the App Store once with the existing shortcut path, re-observe, and reacquire the Search screen from scratch. Do not spend multiple turns hammering the same ambiguous bottom control.
- Before the first typing attempt, the screen should visibly resemble App Store Search rather than Today / Apps / Games. Useful signs include search suggestions, result groups, recent searches, or a dedicated Search surface plus one clearly editable search field.
- If an old query is already present, tap the clear `x` inside the field and re-observe until the field is visibly empty.
- Default rule for device-side App Store search in this stage: use the current candidate's frozen `searchAction` exactly, including its `typeStrategy` and `submit:false` behavior. Do not rewrite a frozen `clipboard_paste` action into `system_events_keystroke_chars`, and do not rewrite a frozen `system_events_keystroke_chars` action into paste.
- Re-observe immediately after typing. If search results already appear, do not wait for the keyboard Search key; tap the matching result row directly.
- Single-type rule: after one correct `gui_type` into `active App Store search field`, the next action is `gui_observe`, not another `gui_type`. Only type again after that observation proves the previous attempt did not land cleanly and you have reset or reacquired the field.
- Only-next-tool rule: after one correct `gui_type` into `active App Store search field`, the only allowed next tool call is `gui_observe`. Do **not** substitute `gui_key`, `gui_click`, `gui_scroll`, or a targetless `gui_type` before that observation.
- Canonical-target rule: within one search cycle, treat the typing step as the frozen targetless `searchAction` after a valid focus click. Do not invent a fresh typing target like `the bottom active search field with a blinking cursor` to justify another typing pass.
- Same-field refocus rule: after one correct `gui_type`, do **not** click back into that same field before the required observation. If you think the prior type did not land, prove it with `gui_observe` first and only then decide on one bounded clear/reset.
- If the results list does not update after typing, submit with a separate explicit action such as the keyboard Search key or a dedicated Enter key press.
- Do not use a single combined `gui_type ... submit:true` call as the first attempt in iPhone Mirroring. That path is too brittle for short search aliases and can leave the field in a bad partial state.
- For short aliases such as `Poe`, treat weird field states like `Aa`, `Aaa`, or other obviously wrong repeated placeholder text as a failed input. Clear the field immediately and retry with deliberate physical-key typing.
- If the first post-tap observation says the target is still a bottom search control instead of a top input, do one clean reset now: tap the Search destination again or back out and re-enter Search, then re-observe. Do not keep typing into the wrong control hoping it will switch later.

Search fallback policy:

- Before typing, know the exact locked `deviceSearchQuery`. Use that exact locked query first on device. Do not improvise a brand-new query, prepend the developer name, or switch to a longer variant on the phone unless the locked query clearly fails and you can justify the fallback.
- If the title contains a Latin alias in parentheses or after a separator, prefer that ASCII-friendly alias in the iPhone search field. Example: search `Top Heroes` instead of trying to paste `王國之歌（Top Heroes）` first.
- If the frozen plan already chose `clipboard_paste` for a non-ASCII query, treat that as the intended primary route rather than improvising an ASCII alias.
- If the browser winner does not have a short Latin alias and the only plausible query is long CJK text, either freeze a truthful `clipboard_paste` searchAction in the browser package or treat it as an install-risk signal and rank down the candidate before device work begins.
- If a paste attempt only enters one character, garbage text, or an obviously truncated query, clear the field, observe again, and then either replay the same frozen searchAction once or pivot truthfully. Do not invent a new off-plan alias mid-device-run.
- If the field still drifts into placeholder-like junk such as `Aa` / `Aaa` after the first attempt, clear it completely before trying again. Do not keep typing on top of the broken state.
- If the field mutates into `Aa`, `Aaa`, or another placeholder-like mini-field after submit, assume focus has collapsed into the wrong control. Back out to the dedicated Search screen, reacquire the top field, and only then retry.

Mandatory device-side query execution contract:

1. click the active editable search field itself, not just the bottom Search destination
2. issue `gui_type` against that explicit field target, not a targetless focused element
3. include the exact frozen `typeStrategy`, plus `replace:true` and `submit:false`
4. use the locked `deviceSearchQuery` exactly on the first pass
5. re-observe once before deciding whether a separate Search/Enter submit is needed

Use the query-entry call shape below as the default pattern for every search-field replacement on device:

```text
gui_type
  app:"iPhone Mirroring"
  target:"active App Store search field"
  scope:"iPhone Mirroring window"
  value:"<locked deviceSearchQuery>"
  typeStrategy:"system_events_keystroke_chars"
  replace:true
  submit:false
```

Hard search-entry prohibitions:

- Do **not** use a targetless `gui_type` with only `value:"<query>"` as the first device-side search attempt.
- Do **not** use `gui_type ... submit:true` as the primary way to replace an App Store query on device, even on retries or when the field already shows an older query. Type first, then re-observe, then decide whether a separate submit is needed.
- Do **not** issue a targetless `gui_type` after a correct frozen search call. If the first typed query did not seem to land, you still owe a `gui_observe` before any recovery.
- Do **not** press the keyboard Search key, Enter, Return, or any other `gui_key` submit before the required post-type `gui_observe`.
- Do **not** scroll the App Store surface before the required post-type `gui_observe`. Scrolling is only allowed later if that observation proves the correct result is already on-screen but off the initial viewport.
- Do **not** omit the frozen `typeStrategy` on any device-side App Store query replacement.
- Do **not** replace a stale query with a different value unless the new value is the locked `deviceSearchQuery` or a clearly justified fallback after that locked query has already failed.
- Do **not** alternate between targetless typing and targeted typing on the same field state. If the first state looks wrong, reset once and then go straight back to the explicit targeted pattern above.
- Do **not** rename the typing target away from the exact frozen phrase `active App Store search field` within the same search cycle. A renamed target still counts as the same field and does not justify another typing attempt.
- Do **not** click the same search field again immediately after a correct `gui_type`. If no post-type observation has happened yet, you are still obligated to observe, not to refocus.
- Do **not** keep pressing Backspace in long loops while the field still looks ambiguous. Use at most one bounded clear/reset cycle, then reacquire the real active field and type deliberately once.
- If a failed observation or click leaves you in the exact state where only the bottom `Games, Apps and more` control is obvious, treat that as a broken search-focus state. Re-enter the Search screen and reacquire the top field before typing anything.
- Do **not** issue `gui_type` against any target phrase containing `search field currently showing` or the placeholder copy `Games, Apps and more`. Those descriptions are navigation/placeholder evidence, not an approved typing target.
- Short-target recovery rule: in that broken search-focus state, keep target descriptions minimal. Prefer `bottom Search tab` over any longer phrase that repeats the placeholder text or combines navigation and field language.
- If the exact name is still unreliable, search by the strongest short alias plus the developer name and verify the product page title visually before proceeding.
- If you have already spent two search retries without reaching the correct detail page, reset the App Store search flow once from scratch: return to the Search tab, re-confirm the dedicated Search screen, clear the query, type the locked winner alias again in the top field, and continue. Do not keep grinding on a stale text field indefinitely.
- If you still cannot reach the correct detail page after that one clean reset, pivot to the next ranked candidate or fail truthfully with the blocker.

Open the matching search result or detail page and verify that the title matches
the browser-selected app. Then capture:

- `topic/screenshots/02-iPhone-App-Store-Detail.png`

Result-row tap rule:

- If the search result row shows an action button such as `Open` or `Get`, tap the app title / subtitle / left side of the row to enter the detail page.
- Do **not** target the `Open` or `Get` button when the goal is to capture the App Store detail page.
- If a tap launches the app instead of opening the detail page, return to the App Store results, re-observe, and retry on the non-button part of the row.
- After tapping the matching suggestion or app result row, the immediate next action must be `gui_observe` to confirm that the App Store detail page is now visible.
- Between that result-row tap and the confirming `gui_observe`, do **not** detour into shell commands, file reads, manifest rewrites, or plan rereads.
- Once the detail page is confirmed, move straight into the `02-iPhone-App-Store-Detail.png` capture path. Do not pause for unrelated shell/read work until the detail-page evidence exists.
- Do not claim the stage is progressing correctly if the browser-side metadata package is still missing. Browser discovery must be complete first.

Use a window-bounded `screencapture -x -R"x,y,w,h"` capture based on the most
recent GUI tool `capture_rect`, then crop away the window chrome before saving
the final PNG.

After `02-iPhone-App-Store-Detail.png` is saved and verified, append a short JSON
line to `experience/checkpoints.jsonl` recording that the App Store detail page
was captured on device.

Practical capture rule:

- If the latest successful `gui_observe`, `gui_click`, or `gui_type` result already includes `capture_rect`, reuse it directly.
- Do not stop to rediscover bounds after opening the app page if the GUI result already exposed them.
- If you need a newer rectangle before capturing `02` or `03`, do one more `gui_observe` and then capture immediately. Do **not** insert any AppleScript helper step between the GUI observation and the screenshot command.

## Step 4: Install or confirm the installed state

Branch on the visible store button.

Fresh-install validity rule:

- Track whether you personally initiated a fresh install in this run by tapping `Get` or the cloud-download icon.
- Only treat a later `Open` as a valid Stage 1 success if it follows that observed install action in this same run.
- If the first observed button state for the chosen candidate is already `Open` before any install action, treat that candidate as already installed and therefore invalid for the normal editorial demo path. Record the reason, back out cleanly, and pivot to the next ranked candidate unless the user explicitly forced a revisit.

Visible-button branches:

- If it shows `Open` before you started any install action in this run, mark that candidate as `alreadyInstalled`, update `topic/candidates.json` / `selection-notes.md`, and pivot to the next ranked candidate. Do not let a stale-installed app satisfy Stage 1.
- If it shows `Get`, tap it and continue until the state changes to installing or `Open`.
- If it shows the cloud-download icon, treat it like a reinstall path: tap it and wait until the state changes to downloading or `Open`.
- If an Apple ID password, Face ID confirmation, payment prompt, or subscription wall appears, treat it as an auth gate for the current candidate. By default it is an install blocker; the only exception is one authorized secret-env password attempt on a standard Apple ID password sheet.
- Post-`Get` / post-cloud rule: after tapping `Get`, the cloud-download icon, or an intermediate `Install` confirmation, immediately re-observe the screen. Do not sit on the same surface assuming install is progressing if a password / auth sheet may already be visible.
- Password-sheet recognition rule: if a modal App Store sheet asks for the Apple ID password to authorize the transaction, that is a confirmed auth gate for the current candidate, not a temporary loading step. Either perform the one authorized secret-env password attempt or treat it as an install blocker and pivot.
- Post-password continuation rule: after an authorized password attempt, re-observe and branch on the visible controls instead of waiting on the generic sheet title alone. If the password field is gone and the new sheet now shows account info plus a blue `Install` button, that is a follow-up confirmation surface, not a still-open password blocker. Click that `Install` and continue the install flow.
- Password-failure rule: classify the password attempt as failed as soon as the post-submit observation still shows the password field, the same blue `Confirm` / `Sign In` action, an explicit auth error, or another true auth/payment blocker. Do **not** close a non-password App Store confirmation sheet just because the top title still says `App Store`.

Install fallback rule:

- If the currently selected candidate hits an Apple ID password prompt, payment/auth confirmation wall, an already-installed `Open` state, or another install blocker before the app becomes usable, do **not** fail the whole stage immediately.
- Back out cleanly to the search/results state, mark that candidate as install-blocked in `topic/candidates.json` or `selection-notes.md`, and continue with the next-best ranked candidate from the existing browser research.
- If `allowAppleIdPasswordFromEnv=true` and the blocker is specifically a standard Apple ID password sheet, you may spend exactly one attempt on secret-env password entry before taking the fallback path.
- If ranked backups still exist, the very next move after confirming the blocker should be dismiss -> record blocker -> pivot. Do **not** write `manifest.status = "blocked"` yet.
- Backup-availability rule: if `topic/candidates.json` still contains at least one untried backup with a non-empty `deviceSearchQuery`, treat Stage 1 as still salvageable. In that situation, writing `manifest.status = "blocked"` is forbidden until the backup attempt has actually been tried.
- Candidate-pool freeze rule: after the first live device install attempt begins, the shortlist may shrink but it may not expand. Do **not** create new fallback candidates through browser pages, `web_search`, `itunes.apple.com/search`, shell-side HTTP, or ad hoc Python lookups.
- Empty-shortlist rule: if the confirmed blocker leaves no untried preserved backup with a usable `deviceSearchQuery`, skip all further discovery and go directly to the blocked-terminal rule.
- Manifest-state rule during pivot: while a backup candidate is still available, keep the manifest in a non-terminal state such as `discovering` or `installing`. Record the current candidate's blocker, but do **not** switch the whole episode into terminal `blocked` status yet.
- Prefer a fallback candidate that is still current, free, and likely to be immediately installable through a cloud-download path or another lower-friction install action.
- When ranking or preserving fallback candidates, do not make them all the same failure shape. Try to keep some variety, for example one steady planner/utility, one richer productivity app, and one lower-auth-risk alternative when the surface allows it.
- Password-prompt recovery sequence:
  1. if one authorized secret-env password attempt is allowed and has not been used on this candidate, try it once; otherwise close or dismiss the password / auth sheet
  2. record the blocker against the current candidate
  3. back out to the search/results state or the App Store search entry point
  4. pick the next ranked candidate already preserved in `topic/candidates.json`
  5. type that backup candidate's locked `deviceSearchQuery`
  6. retry the install flow and keep iterating through preserved backups until one candidate reaches the home screen or every viable backup has failed
- Password-sheet dismiss detail: if the auth sheet shows a visible close control such as a top-right `x`, prefer tapping that explicit close button. If no close control is visible, use the safest obvious cancel / back route instead of typing or waiting on the password form.
- Auth-state observation rule: after the one authorized password attempt, prefer one immediate `gui_observe` plus control-based branching over a long passive wait. Passive waiting is only acceptable after you have already confirmed that the password field is gone and the flow is genuinely in download/install progress.
- Password-loop prohibition: once the one authorized secret-env password attempt has been submitted, the agent may not perform a second `Confirm` click, a fallback `Enter` keypress, or any shell-side password-env probing on that same candidate. The next move must be either success-path continuation from the observed non-password surface or the fallback/blocker path.
- Unless `allowAppleIdPasswordFromEnv=true` for this run, never type into the Apple ID password field, trigger autofill, or press `Confirm` on the password sheet.
- When password entry is authorized, only use the frozen `passwordAction` with `secretEnvVar:"UNDERSTUDY_APPLE_ID_PASSWORD"` or the `appleIdPasswordEnvVar` override, `typeStrategy:"system_events_keystroke_chars"`, `replace:false`, and `submit:false`; never paste the literal password or expose it in shell output.
- Pivot execution rule: the backup install attempt should normally continue from the same device-side App Store session. Do **not** reopen the browser or restart Stage 1 research. If every preserved backup turns out unusable, terminate truthfully instead of researching new apps.
- Evidence continuity rule: the initial browser screenshots `00` and `01` may stay tied to the original editorial winner even if the device install pivots to a backup. The important requirement is that `manifest.json`, `topic/app-store-listing.json`, and the final installed app state must truthfully reflect the candidate that actually survived and got installed.
- Backup metadata rewrite rule: once a backup candidate becomes the new live install target, rewrite `manifest.selectedApp`, `topic/app-store-listing.json`, and any relevant winner markers so later stages review the app that truly got installed rather than the first blocked pick.
- Last-safe-home rule: only after every viable preserved backup has failed or been ruled out may you return to the home screen and write the terminal blocked state.
- Only fail the stage after the ranked fallback list is exhausted or every remaining candidate is clearly unsuitable.
- Do **not** silently keep grinding on the same blocked candidate after the password / auth sheet has already been identified. One clean dismiss path is enough; after that you must either pivot or terminate truthfully.
- Do **not** silently keep retrying password submission on the same candidate. One authorized secret-env attempt is the maximum before you pivot or terminate truthfully.
- If the first candidate hit an Apple ID password wall, bias the next backup attempt toward the fallback with the calmest install shape, not necessarily the one with the second-highest overall story score.
- If the next backup candidate triggers the same kind of Apple ID / payment blocker before installation begins, continue only while another preserved backup still remains. Stop as `blocked` only after the remaining viable backup list is empty.
- Blocked-state write guard: never set `manifest.status = "blocked"` or `timestamps.blockedAt` while at least one still-viable ranked backup remains untried.
- Blocked-terminal rule after exhausted fallbacks:
  - return the iPhone to the home screen
  - capture `topic/screenshots/03-Home-Screen-Blocked-No-App.png`
  - update `manifest.json` to `status: "blocked"` and keep `selectedApp.installBlocked: true`
  - append one short checkpoint line explaining which candidate failed and why
  - write a short blocker section into `topic/selection-notes.md`
  - immediately return a plain-text final summary; do **not** stay in the session hoping for another idea
  - do **not** claim Stage 1 completed or wait for Stage 2; the blocked branch should terminate this stage as failed

Blocked summary contract:

- If Stage 1 ends blocked, the final reply must still be plain text with:
  - `status: blocked`
  - `producedArtifacts`
  - `verification`
  - `blockers`
- If the blocker happened before the App Store detail page was ever opened on device, the expected blocked screenshot is `topic/screenshots/02-iPhone-Mirroring-Disconnected.png`.
- If the blocker happened only after install attempts were exhausted and the phone was returned home without a successful install, the expected blocked screenshot is `topic/screenshots/03-Home-Screen-Blocked-No-App.png`.
- Do **not** return an image-only or empty reply in the blocked branch.
- Do **not** keep thinking after the blocked artifacts and summary are already written.

Install-complete handoff rule:

- As soon as the page shows `Open` or `OPEN` after a `Get` / cloud-download action that happened in this run, do **not** spend another round on shell-only metadata edits, interpretation, or waiting.
- The very next GUI action must be `gui_key key:"1" modifiers:["command"]` to return to the home screen.
- If the session is resumed after an interruption and `Open` was the last confirmed state, resume from Step 5 immediately before touching `manifest.json` again.

Update `manifest.json` and `topic/candidates.json` with the actual observed state:

- `selectedApp.name`
- `selectedApp.developer`
- `selectedApp.category`
- `selectedApp.rating`
- `selectedApp.priceText`
- `selectedApp.free`
- `selectedApp.appStoreUrl`
- `selectedApp.subtitle`
- `selectedApp.description`
- `selectedApp.installed`
- `status: "installing"` while in progress
- Because `02-iPhone-App-Store-Detail.png` is one of the stage-completion outputs, write the above manifest/candidate updates *before* saving the final `02` file.
- Do **not** set `status: "installed"` or `selectedApp.installed: true` yet unless `03-Home-Screen-With-App.png` already exists.

## Step 5: Return to the home screen and end there

Return to the iPhone home screen:

```text
gui_key key:"1" modifiers:["command"]
```

Verify that the selected app is present on the home screen. If it is not visible
immediately, use Spotlight as a fallback to confirm it is installed, then return
to the home screen again.

Home-return rule:

- Use `command+1` as the primary way to return to the iPhone home screen in iPhone Mirroring.
- After pressing `command+1`, re-observe before doing anything else.
- If the home screen is already visible, capture `03-Home-Screen-With-App.png` immediately and stop. Do **not** add a swipe / drag gesture after the home screen is already visible.
- Only use touch-style drag or swipe gestures as a last resort if `command+1` clearly failed and a follow-up observation still shows the wrong surface.
- Do **not** use `command+shift+h` in this stage. The only preferred home shortcut is `command+1`.
- If the home screen is not visible but the app is confirmed installed, use Spotlight only as a fallback verification tool, then return to the home screen again before capturing `03`.
- If `Open` was the most recent confirmed App Store state, prioritize getting back to the home screen and capturing `03` before any further shell updates.

Finalize immediately rule:

- Once `Open` has been observed, execute the final sequence without detouring:
  1. `gui_key key:"1" modifiers:["command"]`
  2. `gui_observe app:"iPhone Mirroring" captureMode:"window"`
  3. verify the home screen or use Spotlight once as fallback
  4. update `manifest.json` to the final installed state
  5. capture `topic/screenshots/03-Home-Screen-With-App.png`
  6. run the stop checklist and finish
- Do **not** stop after `Open` appears.
- Do **not** return the final summary while `03-Home-Screen-With-App.png` is still missing.

Capture:

- `topic/screenshots/03-Home-Screen-With-App.png`

Reuse the same stage `capture_rect` for this screenshot unless a later GUI tool
result explicitly reports a newer one.

Update `manifest.json` one final time:

- `status: "installed"`
- `phase: "installed"`
- `timestamps.installDone`
- `artifacts.topicScreenshots`
- Write this final manifest update *before* saving `03-Home-Screen-With-App.png`, so the harness cannot advance with a stale manifest.

After `03-Home-Screen-With-App.png` exists, append one more short JSON line to
`experience/checkpoints.jsonl` recording that Stage 1 ended on the home screen
with the app installed.

## Stop Checklist

Do not stop until all of these are true:

```bash
ROOT_DIR="<resolved root dir>"
test -f "$ROOT_DIR/manifest.json"
test -f "$ROOT_DIR/topic/candidates.json"
test -f "$ROOT_DIR/topic/selection-notes.md"
test -f "$ROOT_DIR/topic/app-store-listing.json"
test -f "$ROOT_DIR/topic/screenshots/00-Browser-Today-Recommendation.png"
test -f "$ROOT_DIR/topic/screenshots/01-Browser-App-Detail.png"
test -f "$ROOT_DIR/topic/screenshots/02-iPhone-App-Store-Detail.png"
python3 -c "import json, pathlib; root=pathlib.Path('$ROOT_DIR'); d=json.loads((root/'manifest.json').read_text()); assert d.get('selectedApp',{}).get('name'); status=d.get('status'); assert status == 'installed'; ok=(root/'topic/screenshots/03-Home-Screen-With-App.png').exists(); assert ok; print('ok')"
```

Print a short summary naming the installed app, the App Store source used, and
the files produced. Stop on the home screen.

If the stage ended blocked instead, print the same style of short plain-text
summary naming the blocked app, the blocker, the fallback decision already
taken, and the files produced. Stop on the home screen and let the stage fail.
