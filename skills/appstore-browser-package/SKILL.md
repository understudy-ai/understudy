---
name: appstore-browser-package
description: >-
  Dedicated worker for the browser-only Stage 1 packaging pass: choose a
  current App Store candidate, capture the browser evidence, and write the
  frozen device package without touching iPhone Mirroring.
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
- Resolve the active artifacts root first, create the folder tree, and run `skills/appstore-search-install/scripts/bootstrap_stage.py` before browser exploration.
- Source of truth must stay on visible App Store browser pages plus one listing fetch after the exact winner detail URL is known.
- Do not use `web_search`, ad hoc App Store APIs, or shell-side HTTP comparison lookups.
- Capture `topic/screenshots/00-Browser-Today-Recommendation.png` on a recommendation, editorial, category, or browse surface before opening the winner detail page.
- Capture `topic/screenshots/01-Browser-App-Detail.png` on the exact winner detail page.
- As soon as `01` exists, browser discovery is over. The next work is package closeout only: recover exact detail URL, run `fetch_app_store_listing.py`, run `package_browser_selection.py`, verify files, then stop.
- Preserve 1-2 already-seen calm backups when credible, but do not keep browsing after `01` just to make the shortlist prettier.
- Use `package_browser_selection.py` as the authoritative writer for `topic/candidates.json`, `topic/selection-notes.md`, `topic/device-action-plan.json`, `topic/device-action-plan.md`, and the locked winner fields in `manifest.json`.
- When passing `--backup` into `package_browser_selection.py`, keep the full slot order exactly `name||developer||category||appStoreUrl||priceText||deviceSearchQuery||whyItFitsSlowGui||majorRisk`. If some middle fields are unknown, leave them empty with `||` rather than shifting later fields left.
- After `package_browser_selection.py` succeeds, run `skills/appstore-search-install/scripts/cache_backup_listings.py` once so already-preserved backups get cached under `topic/tmp/backup-*.json` for truthful later pivoting. Do not use it to discover new candidates.
- If password entry is intended for the later install step, pass `--allow-apple-id-password-from-env` and the configured env-var name into `package_browser_selection.py`.
- Before declaring success, verify every required output with direct file checks.

## Inputs

- `artifactsRootDir`
- `selectionMode`
- `targetApp`
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
- Shell only for bootstrap, listing fetch, package helper execution, and direct artifact verification under the active artifacts root

## Stop Conditions

- All required outputs exist and `manifest.json` now points at the locked selected app.
- Or the worker can state the truthful blocker boundary: before `00`, before `01`, or during package closeout after `01`.

## Decision Heuristics

- Default discovery route is the regional `Today` surface; if it is game-heavy or spammy, do one calm hop such as `Productivity`, `Reference`, or `Utilities`.
- Favor calm, local-first apps with a short reliable device search query and a believable first-use loop that will still look good on iPhone.
- When two candidates are close, prefer the one whose first truthful iPhone story can be completed locally as create/use -> saved/result -> revisit, rather than one whose best-looking promise depends on remote catalog search, sync, or cloud metadata.
- The frozen device query should be distinctive enough to reach the exact app row on iPhone, not merely a broad same-brand suggestion. When the listing slug exposes a short stronger alias such as `Goodnotes AI` or `Google Drive`, prefer that over a bare brand token.
- Prefer an ASCII-friendly device query when the story quality is close, but do not throw away a clearly better editorial winner solely because its visible title is non-ASCII. In that case, freeze the exact device plan so the later worker can use the right input strategy instead of improvising an alias.
- Reject fast action games and spammy cleaner / booster / storage-rescue utilities by default.
- When candidates are close, prefer the app whose honest review can be told from iPhone-visible evidence rather than browser explanation.
- Demote candidates whose strongest first-session proof depends on a network-backed search/import path when a nearby editorial backup offers a calmer local loop with clearer saved-state evidence.
- Use only already-seen alternatives for backups. Zero-backup is acceptable only for a forced target or when no visible calm backup really survived.
- If the browser can expose the exact detail URL from active-tab status, use that. Otherwise recover it from the address bar instead of guessing.
- Once `01` exists, do not keep wandering in tabs, sidebars, or more detail pages. Close the package immediately.

## Failure Policy

- If the worker cannot reach a truthful `00`, stop with a blocker rather than inventing a browse surface.
- If the worker cannot reach a truthful `01`, stop with a blocker rather than guessing the winner detail page.
- If the exact winner detail URL cannot be recovered after `01`, stop with a blocker rather than guessing a URL.
- Do not claim any iPhone-side progress and do not fabricate package files that were not actually written.
