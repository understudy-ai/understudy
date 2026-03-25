---
name: youtube-upload
description: >-
  Publish stage: Prepare YouTube metadata from the rendered video and either stop at a
  preview gate or complete the real upload when `publishNow=true`.
metadata:
  understudy:
    emoji: "📺"
---

# youtube-upload

## Rules

1. Use the active run root: prefer `artifactsRootDir`, otherwise `EPISODE_DIR`.
2. Always write `publish/youtube.json`, `publish/preview.md`, and `publish/result.json`.
3. Only complete the external publish when `publishNow=true` and no optional review gate says the current cut is still not ready.
4. The playbook harness may auto-advance as soon as the expected output files exist. For `publishNow=true`, treat `publish/result.json` as the final handoff artifact and write it only after the publish has either succeeded or been explicitly marked `blocked`, and after `manifest.json` has already been updated to the same final state.
5. If this stage is resumed and `publish/youtube.json` plus `publish/preview.md` already exist but `publish/result.json` is still missing, do not stop or re-explain the plan. Resume directly from the real publish / fallback / blocker-resolution path, then finish by writing `publish/result.json`.
6. Never read `post/final-video.mp4` as text or binary content. Verify it with `test -f` and use the file path only.
7. This demo lane should publish through the browser tool, not through a GUI-only upload path. GUI is only allowed for signing in Chrome, loading the Understudy extension, or attaching the intended tab so the browser route can continue.

## Inputs

- `artifactsRootDir` or `EPISODE_DIR`
- `publishNow` — boolean, default `false`
- `publishVisibility` — default `unlisted`
- `post/final-video.mp4`
- `experience/notes.json`
- optional `experience/review-brief.md`
- `topic/app-store-listing.json`
- optional `post/video-plan.md`
- optional `review/video-feedback.json`

## Step 1: Resolve the root and load the final context

Resolve `ROOT_DIR`.

Read:

- `experience/notes.json`
- `experience/review-brief.md` if it exists
- `topic/app-store-listing.json`
- `manifest.json`
- `post/video-plan.md` if it exists
- `review/video-feedback.json` if it already exists
- verify `post/final-video.mp4` exists with a file check; do not open the MP4 itself

Use the optional review feedback only as a refinement input. Do not invent it if
the file is absent.

If `review/video-feedback.json` exists:

- use it to make the title/description more honest and more precise
- prefer reducing hype or overclaiming over adding extra marketing language
- if the feedback says the video still has unresolved clarity or legibility problems, mention that truthfully in `publish/preview.md` rather than pretending the video was fully fixed
- if `publishReadiness` is `needs_revision` or `blocked`, treat that file as a real gate for `publishNow=true`: prepare the preview package, record the blocker honestly, and do **not** attempt a real YouTube publish in this run
- if `revisionMode` is `edit` or `explore`, treat that as not-ready for real publish even when the metadata itself looks fine

## Step 2: Generate the publish package first

Create `publish/` if it does not exist.

Write `publish/youtube.json` with at least:

```json
{
  "title": "string",
  "description": "string",
  "tags": ["iphone", "app review"],
  "videoFile": "post/final-video.mp4",
  "thumbnailFile": "topic/screenshots/01-Browser-App-Detail.png",
  "visibility": "unlisted",
  "publishNow": false
}
```

Write `publish/preview.md` with:

- title
- description
- tags
- thumbnail path
- video path
- whether this run will only prepare a preview or actually publish

Title and description guidelines:

- **Title**: Must be attention-grabbing and specific. Format: a curiosity hook or bold claim about the app. Examples:
  - "Perplexity: The AI Search That Actually Shows Its Sources"
  - "I Let an AI Agent Review This App — Here's What It Found"
  - "This Free App Might Replace Your Browser (Honest Review)"
  Do NOT use generic titles like "App Review" or "iPhone App Review #1".

- **Description**: Two parts:
  1. **App review paragraph** (3-5 sentences): What the app does, what stood out, honest verdict. Use the opening hook and verdict from `experience/notes.json` scriptHooks.
  2. **Understudy credit paragraph**: This video was produced by Understudy (https://github.com/anthropics/understudy), a teachable desktop agent that can learn and automate real GUI workflows. The entire review pipeline — from finding the app to filming the walkthrough to editing this video — was executed autonomously by Understudy through iPhone Mirroring.

- **Tags**: Include the app name, "iphone", "app review", "ai", "understudy", "gui agent", "automation".

- Draw title/description from `experience/notes.json` scriptHooks (openingHook, oneSentenceVerdict, titleCandidates), `experience/review-brief.md`, and `post/video-plan.md`.

Copy hygiene rule:

- Do not quote App Store boilerplate as the YouTube title. Prefer the natural-language phrasing from the exploration handoff.

Resume rule:

- If `publish/youtube.json` and `publish/preview.md` already exist and match the current run well enough, reuse them.
- Do not keep looping on metadata generation when the only missing required artifact is `publish/result.json`.

Real-publish handoff rule:

- As soon as `publish/youtube.json` and `publish/preview.md` are present and `publishNow=true`, the very next step must be the real publish flow or blocker resolution.
- Do not spend another round on extra shell-only analysis, file re-reads, or plan narration before attempting the actual upload.

## Step 3: Handle the preview-only path

If `publishNow` is not explicitly `true`:

- update `manifest.json` to `status: "awaiting_confirm"` and `phase: "publishing"`
- append an approval event explaining that the preview is ready and the final publish is still pending
- write `publish/result.json` with `status: "preview_only"` as the last expected artifact
- print the preview and stop

This is the default branch.

## Step 4: Handle the real publish path

If `publishNow=true`, continue instead of stopping.

Review-gate rule before any real upload attempt:

- If `review/video-feedback.json` exists and says `publishReadiness` is `needs_revision` or `blocked`, do **not** open YouTube Studio as a publish attempt.
- In that case, keep `publish/youtube.json` and `publish/preview.md`, update `manifest.json` to a truthful blocked state, and write `publish/result.json` with `status: "blocked"` plus a clear blocker such as `review_gate_not_ready`.
- If the review says `revisionMode: "edit"` or `revisionMode: "explore"`, mention that exact next step in `publish/preview.md` and in the blocked result instead of hiding it.

Do not stop this stage after writing only `publish/youtube.json` and
`publish/preview.md`. The stage is not complete until `publish/result.json`
exists and matches the final manifest state.

Prefer the browser route first, but do not assume a clean managed Playwright tab
can publish a logged-in YouTube account.

Connection rule:

- Follow the **Chrome Extension Relay Bootstrap** procedure in `iphone-mirroring-basics` to establish the extension relay before any browser work.
- If already attached through the extension relay, continue with `browserConnectionMode: "extension"` for the rest of the stage.
- Do not silently stay in a clean managed browser when the visible page is clearly a Google sign-in wall.

Use the browser route to:

1. open YouTube Studio upload
2. upload `post/final-video.mp4`
3. fill title, description, tags, and thumbnail from `publish/youtube.json`
4. set visibility from `publishVisibility` with `unlisted` as the safe default
5. complete the final publish step

Field-priority rule:

- Treat title, description, audience selection, visibility, and the final publish confirmation as the required fields.
- Treat tags and custom thumbnail as best-effort refinements. If Shorts-specific UI, account limitations, or hidden `Show more` sections make those fields expensive to reach, skip them truthfully instead of stalling the whole run.
- Never keep grinding on hidden optional fields when the required publish path is already reachable.

Title / description fill rule:

- When using GUI fallback, do not rely on one optimistic `replace:true` action for text fields.
- Prefer this sequence for both title and description:
  1. click into the field
  2. `command+a`
  3. if old text is still visibly present, send `Backspace`
  4. paste the prepared value from `publish/youtube.json`
  5. visually verify that the field now shows the intended new text rather than a concatenation with stale content
- If the field still shows concatenated old text such as a partial old filename or leftover title, clear it once more before continuing.

After each important browser mutation, verify the visible state changed as expected.

Publish-completion rule:

- After the final publish action such as `Save`, `Publish`, or the last visibility confirmation, do not stop on the click itself.
- Stay in the publish surface until you have observed one of the real success signals below:
  - a modal or toast that clearly says `Video published`
  - a visible watch/share link for the uploaded video
  - the uploaded video appearing in YouTube Studio content with a published state that matches the requested visibility
- If you see a success modal, treat that modal as the source of truth for finalization instead of continuing to click around blindly.
- Once success is visible, immediately capture the final link, persist the final state to `manifest.json`, write `publish/result.json`, and only then close the modal or leave the page.
- Do not keep looping on extra `Next` / `Save` / `Publish` clicks after a success signal is already on screen.

If the browser route looks dead, interrupted, or clearly unusable after metadata
is already prepared, pivot immediately to the fallback order below. Do not end
the stage with only the preview artifacts written.

If the browser route lands on a login blocker, pivot instead of giving up immediately.

Treat any of the following as a login blocker that requires a route change or an
explicit blocked result:

- Google sign-in UI such as an email or phone field
- browser status that says the extension relay is unreachable or no attached tab is available
- a managed blank tab hint that tells you to click the Understudy extension on the user's tab first

Login fallback order:

1. Try to attach the user's existing Chrome session.
2. If attachment is not yet active, use the GUI route to activate Google Chrome, bring a signed-in YouTube Studio tab to the front or open `https://studio.youtube.com`, and click the Understudy extension on that tab so the browser tool can continue in `extension` mode.
3. If the extension path is still unavailable after one bounded install + attach pass, stop with a truthful blocker instead of converting the main upload into a GUI-only flow.
4. Only write a `blocked` result after you have verified there is no usable signed-in session, the extension relay cannot be attached, or YouTube itself blocks the publish for policy/review/permissions reasons.

Finalization rule for every exit path:

1. Decide whether the final stage state is `published` or `blocked`.
2. Update `manifest.json` to the same final state first.
3. Write `publish/result.json` last.
4. Run the stop checklist and only then return the final summary.

Never return a final answer, stop the child session, or abandon the stage while
`publish/result.json` is still missing.

GUI assist rules:

- Keep using the same metadata from `publish/youtube.json`; do not rewrite the title, description, tags, thumbnail, or visibility ad hoc.
- Use GUI only to activate Chrome, sign in if needed, load the extension, pin/click the extension on the intended tab, or reveal the already-attached Studio tab.
- Once the extension relay is attached, return to the browser tool for the real upload work instead of continuing in GUI by default.

Success finalization checklist:

1. Observe the publish-success state.
2. Record:
   - `visibility`
   - `publishedAt`
   - `studioUrl`
   - `watchUrl` if visible
3. Update `manifest.json` first:
   - `status: "published"`
   - `phase: "published"`
   - `artifacts.youtubeUrl`
   - `timestamps.publishedAt`
4. Write `publish/result.json` second with the same final state.
5. Close the success dialog or return to a neutral Studio screen.
6. Return the concise final summary.

If the flow succeeds, write `publish/result.json` with at least:

```json
{
  "status": "published",
  "visibility": "unlisted",
  "studioUrl": "https://studio.youtube.com/...",
  "watchUrl": "https://www.youtube.com/watch?v=...",
  "publishedAt": "2026-03-22T01:23:45Z"
}
```

Update `manifest.json` to:

- `status: "published"`
- `phase: "published"`
- `artifacts.youtubeUrl`
- `timestamps.publishedAt`

Write `publish/result.json` only after that manifest update has been persisted.

If the flow is blocked by login, verification, policy review, or permissions:

- update the manifest to `status: "blocked"`
- keep the preview artifacts
- write `publish/result.json` with `status: "blocked"` and a clear `blocker` as the final expected artifact
- stop without pretending the publish completed

## Stop Checklist

```bash
ROOT_DIR="<resolved root dir>"
test -f "$ROOT_DIR/publish/youtube.json"
test -f "$ROOT_DIR/publish/preview.md"
test -f "$ROOT_DIR/publish/result.json"
python3 -c "import json, pathlib; d=json.loads(pathlib.Path('$ROOT_DIR/manifest.json').read_text()); assert d.get('status') in {'awaiting_confirm','published','blocked'}; print('ok')"
```

Print whether this run ended in `preview_only`, `published`, or `blocked`, and
include the final URL when publication succeeded.
