---
name: appstore-browser-package
description: >-
  Dedicated worker for the browser-only Stage 1 packaging pass: lock a fixed
  or discovered App Store candidate, capture the browser evidence, and write
  the frozen device package without touching iPhone Mirroring.
metadata:
  understudy:
    emoji: "🧭"
    artifactKind: "worker"
---

# appstore-browser-package

## Goal

Build the full browser-side Stage 1 package and stop before any iPhone
Mirroring work begins.

## Operating Contract

- Browser discovery happens first and is the only GUI surface in this worker. Do not open iPhone Mirroring.
- Use the browser tool as the primary execution route for Stage 1, not `web_search` and not ad hoc shell fetches.
- If `selectionMode` is `fixed_target_app_metadata` or `targetApp` is present, skip editorial wandering. Use Stage 1 to lock that exact app, capture one truthful browser surface that shows how you reached it, then capture the exact app detail page and package its browser-visible metadata.
- If `requestedTargetAppStoreUrl` is present in `manifest.json` for a fixed target, treat that as the authoritative exact detail URL. After you capture a truthful `00` surface, open that URL directly instead of discovering the detail page again through `browser tabs`.
- In fixed-target mode, inspect the currently attached App Store tabs early. If one tab already exposes the exact target detail page, prefer focusing that exact tab over re-searching from scratch.
- In fixed-target mode, do not synthesize App Store search URLs like `/search?term=...` as the main route. On the current App Store web surface those URLs may 404. Prefer the visible App Store search box or another visible in-site navigation route, then open the exact result from there.
- On the first browser call, explicitly request `browserConnectionMode: "auto"`.
- After the first `browserConnectionMode: "auto"` status check confirms the extension-backed route is attached, keep using `browserConnectionMode: "auto"` for the rest of the worker. Do not switch individual calls over to `"extension"` mid-run.
- Treat the extension route as a hard requirement for the real discovery pass. Before opening any App Store browse/detail URL, confirm whether `auto` is resolving to `extension` or to `managed`.
- If the browser runtime is already running in `managed`, stop it before doing any real App Store browsing. Do not keep the main Stage 1 discovery inside a managed tab just because it opened successfully once.
- The preferred happy path is the Understudy Chrome extension relay. If the relay is unavailable because the extension assets are not installed yet, install them before continuing:
  - resolve the repo root with `git rev-parse --show-toplevel`
  - run `node "$REPO_ROOT/understudy.mjs" browser extension install managed`
  - the install command now seeds relay port and gateway token into the installed extension bundle; prefer that happy path over manually typing secrets
  - if Chrome still does not have the extension loaded, use one bounded GUI bootstrap pass on `chrome://extensions` to enable Developer Mode, choose `Load unpacked`, and load the printed install directory
- if Chrome already had the Understudy extension loaded before the install step and relay status still shows `HTTP 401` or a stale disconnected state, reload that unpacked extension once from `chrome://extensions` so the newly seeded local config takes effect, then reopen the intended App Store tab and click the toolbar button again
  - only if the seeded config still does not authenticate after one reload pass may you open the extension options page, confirm the seeded relay port/token are present, and click `Save`
- once the intended App Store tab is attached, continue the rest of Stage 1 through the already-confirmed `browserConnectionMode: "auto"` route so the worker does not accidentally restart the runtime with a conflicting mode
- Do not silently spend the main Stage 1 discovery pass inside a clean managed browser when the extension relay route is available or installable.
- If extension attachment is not ready yet, use GUI only to get Chrome to the right tab and click the Understudy toolbar button. Then re-check with `browserConnectionMode: "extension"` before opening the real discovery page.
- If an unrelated Chrome extension popup, wallet sheet, password-manager bubble, or any other non-App-Store overlay is covering the tab or toolbar, dismiss it with one bounded click outside or one obvious close action before attempting the Understudy handoff again.
- When multiple toolbar icons are present, prefer the actual Understudy icon and do not treat another extension's popup state as proof that the relay button was clicked correctly.
- The first truthful App Store browse/detail page that counts toward Stage 1 must be opened only after the extension route is active. A temporary managed tab opened before attachment is not a valid `00` surface and must not be used for screenshots or candidate selection.
- Resolve the active artifacts root first, create the folder tree, and run `skills/appstore-browser-package/scripts/bootstrap_stage.py` before browser exploration.
- Canonical bootstrap invocation uses the current flag names: `python3 skills/appstore-browser-package/scripts/bootstrap_stage.py --artifacts-root "$ARTIFACTS_ROOT" --selection-mode "$SELECTION_MODE" --target-app "$TARGET_APP" --target-app-store-url "$TARGET_APP_STORE_URL" --app-store-region "$APP_STORE_REGION"`. Do not invent older aliases when the current names are available.
- Source of truth must stay on visible App Store browser pages plus one listing fetch after the exact winner detail URL is known.
- Do not use `web_search`, ad hoc App Store APIs, or shell-side HTTP comparison lookups.
- Capture `topic/screenshots/00-Browser-Today-Recommendation.png` on the truthful pre-detail browser surface that led to the winner. For fixed-target runs this may be a search-result page, a browse surface, or another App Store page that visibly anchors the exact target before the detail page.
- Capture `topic/screenshots/01-Browser-App-Detail.png` on the exact winner detail page.
- As soon as `01` exists, browser discovery is over. The next work is package closeout only: recover exact detail URL, run `fetch_app_store_listing.py`, run `package_browser_selection.py`, verify files, then stop.
- Preserve 1-2 already-seen calm backups when credible, but do not keep browsing after `01` just to make the shortlist prettier.
- Use `package_browser_selection.py` as the authoritative writer for `topic/candidates.json`, `topic/selection-notes.md`, `topic/device-action-plan.json`, `topic/device-action-plan.md`, and the locked winner fields in `manifest.json`.
- When passing `--backup` into `package_browser_selection.py`, keep the full slot order exactly `name||developer||category||appStoreUrl||priceText||deviceSearchQuery||whyItFitsSlowGui||majorRisk`. If some middle fields are unknown, leave them empty with `||` rather than shifting later fields left.
- After `package_browser_selection.py` succeeds, run `skills/appstore-browser-package/scripts/cache_backup_listings.py` once so already-preserved backups get cached under `topic/tmp/backup-*.json` for truthful later pivoting. Do not use it to discover new candidates.
- If password entry is intended for the later install step, pass `--allow-apple-id-password-from-env` and the configured env-var name into `package_browser_selection.py`.
- Before declaring success, verify every required output with direct file checks.
- For testing, validation, or demo-hardening runs, prefer globally recognizable apps that viewers in both China and overseas are more likely to know, but only when they still preserve a truthful first-session local loop. Global familiarity is a tie-breaker, not permission to pick a login-gated or cloud-dependent app.

## Inputs

- `artifactsRootDir`
- `selectionMode` — either a discovery mode such as `today_editorial_free_app` or a fixed-target mode such as `fixed_target_app_metadata`
- `targetApp` — exact target app name when Stage 1 is operating in fixed-target mode
- `targetAppStoreUrl` — optional exact App Store detail URL for the fixed target
- `appStoreRegion`
- `allowAppleIdPasswordFromEnv`
- `appleIdPasswordEnvVar`

## Outputs

- `manifest.json`
- `topic/app-store-listing.json`
- `topic/candidates.json`
- `topic/selection-notes.md`
- `topic/device-action-plan.json`
- `topic/device-action-plan.md`
- `topic/screenshots/00-Browser-Today-Recommendation.png`
- `topic/screenshots/01-Browser-App-Detail.png`

## Budget

- `maxMinutes=10`
- `maxActions=45`
- `maxScreenshots=2`

## Allowed Surfaces

- A browser window on App Store web pages
- One short Chrome extension bootstrap pass is allowed only to install / load the Understudy relay when it is missing; after that, the real browsing work should happen through the browser tool
- Shell only for bootstrap, listing fetch, package helper execution, and direct artifact verification under the active artifacts root

## Stop Conditions

- All required outputs exist and `manifest.json` now points at the locked selected app.
- Or the worker can state the truthful blocker boundary: before `00`, before `01`, or during package closeout after `01`.

## Decision Heuristics

- If `selectionMode` is `fixed_target_app_metadata`, the fixed target wins by definition. Do not compare it against editorial alternatives unless the exact target cannot be reached truthfully.
- In fixed-target mode, Stage 1 should collect four browser truths as compactly as possible: what the app calls itself, how the store describes it, what recent reviewers are saying, and what the listing imagery looks like.
- If the manifest already exposes `requestedTargetAppStoreUrl`, prefer that direct-open route after `00` and do not spend the run enumerating existing tabs unless the direct-open path fails.
- In fixed-target mode, zero backups is acceptable when the exact target is globally recognizable, login-light, and device-installable. Preserve a backup only if you already saw one while reaching the target and it would help recover from a later install block.
- In fixed-target mode, start from a stable App Store page that already exposes the site search box, enter the target app there, and capture `00` on the resulting in-site search/browse surface before opening the detail page.
- In fixed-target mode, when the target app name has close lookalikes or prefix collisions, require an exact match on the visible app name before treating a row or detail page as the winner. Near-matches are rejects, not “good enough”.
- Treat developer mismatch as a hard reject for fixed targets. Near-name matches from a different developer are false positives, not "good enough".
- If an attached tab already has the exact target detail URL or exact App Store title, you may capture `00` on a truthful App Store surface that visibly shows the typed target query, then jump directly to that exact detail tab for `01`.
- If `browser tabs` already shows one or more exact target detail tabs, record one of those tab ids immediately and treat it as the canonical winner tab. Do not ignore it and wander through generic App Store tabs unless you still need a truthful `00` surface first.
- Once an exact target detail tab has been identified, do not focus unrelated App Store tabs to “double-check” the winner. Reuse the canonical exact-detail tab and finish the package.
- For creator-style fixed targets, bias the browser package toward a richer first-session feature map: template entry points, photo/video editing hooks, AI entry points, export/share cues, and any visible pricing or Pro boundaries.
- If a browser-extension popup steals focus during handoff, treat that as browser clutter, not as product evidence. Clear it first, then retry the Understudy attach once.
- Default discovery route is the regional `Today` surface; if it is game-heavy or spammy, do one calm hop such as `Productivity`, `Reference`, or `Utilities`.
- Favor calm, local-first apps with a short reliable device search query and a believable first-use loop that will still look good on iPhone.
- For testing-oriented runs, bias toward mainstream globally recognizable app brands before niche editorial picks when the first-run story quality is still comparable. The best candidate is one that a broad viewer can immediately recognize and that still supports a local honest walkthrough.
- When two candidates are close, prefer the one whose first truthful iPhone story can be completed locally as create/use -> saved/result -> revisit, rather than one whose best-looking promise depends on remote catalog search, sync, or cloud metadata.
- When two candidates are still close after workflow quality, prefer the one whose name, icon, and category are more internationally legible to a broad audience rather than an obscure regional app with similar product depth.
- The frozen device query should be distinctive enough to reach the exact app row on iPhone, not merely a broad same-brand suggestion. When the listing slug exposes a short stronger alias such as `Goodnotes AI` or `Google Drive`, prefer that over a bare brand token.
- Prefer an ASCII-friendly device query when the story quality is close, but do not throw away a clearly better editorial winner solely because its visible title is non-ASCII. In that case, freeze the exact device plan so the later worker can use the right input strategy instead of improvising an alias.
- Reject fast action games and spammy cleaner / booster / storage-rescue utilities by default.
- Demote globally famous apps too when their truthful first-session story still depends on login, social graph, or risky posting. Recognizability only helps when the exploration can still be completed safely and locally.
- When candidates are close, prefer the app whose honest review can be told from iPhone-visible evidence rather than browser explanation.
- Demote candidates whose strongest first-session proof depends on a network-backed search/import path when a nearby editorial backup offers a calmer local loop with clearer saved-state evidence.
- Use only already-seen alternatives for backups. Zero-backup is acceptable for a fixed target or when no visible calm backup really survived.
- If the browser can expose the exact detail URL from active-tab status, use that. Otherwise recover it from the address bar instead of guessing.
- Once `01` exists, do not keep wandering in tabs, sidebars, or more detail pages. Close the package immediately.

## Failure Policy

- If the worker cannot reach a truthful `00`, stop with a blocker rather than inventing a browse surface.
- If a synthesized fixed-target search URL lands on “The page you're looking for can't be found.”, treat that as a bad route, not as proof the target app is missing. Recover by using the visible App Store search UI instead of retrying the same URL pattern.
- If a fixed-target search lands on a near-match app with a similar prefix, spelling, or pronunciation, treat that as a false positive and recover. Do not keep drilling into the wrong app just because it looks close.
- If the worker cannot reach a truthful `01`, stop with a blocker rather than guessing the winner detail page.
- If the exact winner detail URL cannot be recovered after `01`, stop with a blocker rather than guessing a URL.
- Do not claim any iPhone-side progress and do not fabricate package files that were not actually written.
