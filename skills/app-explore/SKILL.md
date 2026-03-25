---
name: app-explore
description: >-
  Stage 4: Launch the installed app from the iPhone home screen, explore it
  deeply enough to support a believable walkthrough-style review, and return to
  the home screen.
metadata:
  understudy:
    emoji: "🧭"
    requires:
      bins: ["screencapture"]
---

# app-explore

## Rules

1. Start from the iPhone home screen and finish on the iPhone home screen.
2. Read `skills/iphone-mirroring-basics/SKILL.md` before the first GUI action and follow its semantic recovery rules instead of relying on device-specific coordinates.
3. Prefer bounded deep coverage over wandering. Reach at least one meaningful core task and, when safe, one linked secondary proof beat from the same product loop.
4. Verify every mutating GUI action with a follow-up observation.
5. Use the active run root: prefer `artifactsRootDir`, otherwise `EPISODE_DIR`.
6. Exploration should be category-aware. A creator tool, utility app, and slow-paced strategy game should not be explored with the same coverage plan.
7. The goal is not merely to prove the app opens. The goal is to gather enough truthful evidence for a tutorial-style or hidden-details-style video that feels like a human actually learned the app.
8. The App Store listing is a planning input, not just metadata. Read the subtitle, description, expected core task, and Stage 1 selection notes, then choose a coverage plan that tries to verify or falsify those promised behaviors on-device.
9. Prefer the smallest marketed promise that can be truthfully tested on iPhone. Do not default to a generic category loop when the listing clearly positions the app around a narrower story.
10. If the listing promises a specific workflow, artifact, or payoff, make that promise the starting hypothesis for `primaryLoop` or explain in `fallbackStory` why it could not be tested.
11. If you only verified menus and did not complete a meaningful task, explicitly mark the exploration as shallow in `experience/notes.json` and `experience/review-brief.md` instead of writing an overconfident review.
12. Do not drift into random taps. If two consecutive mutating actions fail to deepen the same coverage plan, pause, restate the plan mentally, and either retry with a clearer target or back out to a stronger surface.
13. Screenshot quality matters. Do not save near-duplicate states as if they were different proof beats when a more distinct surface is still reachable.
14. A strong run should usually prove one primary loop plus one secondary confirmation surface from the same product story. Treat that as the default target unless the app blocks early.
15. Prefer one user-caused state change over passive browsing. A good review run should usually show something you actually created, changed, submitted, saved, toggled, or revisited.
16. For organizer, planner, calendar, to-do, journaling, note, or utility apps, prefer a reversible synthetic demo object over passive inspection. Safe examples include a clearly fake local event, reminder, note, or list item such as `Demo Lunch`, `Test Task`, or another obviously temporary sample.
17. A strong "deep enough" run should usually prove at least two linked state changes in the same product loop, such as create -> saved view, ask -> answer/source view, edit -> preview/export, or toggle -> resulting behavior. Avoid ending on one isolated tap if a second confirming beat is still safely reachable.
18. Treat 5 screenshots as the preferred target, not 4. The 5th image should usually be a persistence, history, settings, pricing/limit, or secondary-feature proof beat that makes the review feel used rather than merely opened.
19. If the app yields one meaningful object or result, try to revisit, reopen, or reframe that same object once before stopping. Saved-state proof is usually more valuable than one extra random menu.
20. Proof-ladder rule: aim to leave Stage 4 with four clear beats in order when the app allows it:
   - first useful screen
   - primary action in progress
   - result / saved / visible consequence
   - one revisit / persistence / trust / limit / settings proof beat
21. Do not let Stage 4 end with "pretty but thin" evidence. If the current screenshots still look like launch screen plus adjacent menus, keep pushing toward one real result, revisit, or limitation beat.
22. A run should usually be marked `deep` only when it reaches that extra proof beat or an equally strong revisit / persistence moment. If the app felt promising but you stopped before the extra proof beat, prefer `partial` over flattering yourself.
23. Prefer at least one short live iPhone clip of the core loop or payoff when the task is dynamic enough to benefit from motion. A strong Stage 5 cut should not be forced to rely on still screenshots alone when a safe clip was reachable.
24. Any live clip must come from the real Stage 4 attempt, not from a later browser reenactment or unrelated desktop filler.
25. Do not stop with a "looks nice" package. Before leaving Stage 4, ask whether the current evidence could cut into a genuinely watchable roughly `3 minute` English-first walkthrough or deep-dive video with a beginning, middle, and end; if not, keep digging or mark the run thin.
26. Prefer readable, English-friendly demo objects for local creation flows. A short fake title like `Demo lunch`, `Pay rent`, or `Test task` is usually more video-usable than scribbles, emoji-only filler, or long localized sample text.
27. Stage 4 is collecting a video-ready proof set, not just screenshots. Default target: one hook-friendly opening frame, one onboarding/start beat, one main-task progression beat, one changed-state or revisit beat, one less-obvious detail beat, and one audience / limit / trust beat.
28. If the app is collaboration-first, sync-first, or network-first, exhaust the local personal loop before touching invites, sharing, or account-backed flows.
29. If one more short clip or a fifth screenshot was safely reachable and would clearly deepen the final edit, prefer capturing it now over leaving Stage 5 to compensate with extra packaging.
30. A human-like review run should usually answer four viewer questions with direct evidence: what is this app for, how do I start, what happens when I do the main thing, and what sticks or limits the experience afterward.
31. Before calling a run `deep`, confirm the evidence set contains all of these:
   - one opening frame
   - one action-in-progress beat
   - one changed-state or visible-result beat
   - one revisit / trust / limit / persistence beat
32. If one of those beats is still missing, keep exploring when it is safe or mark the run `partial` rather than flattering it.
33. Prefer one extra edit / revisit on the same object over touching a second unrelated feature. Human-seeming reviews usually come from one coherent story, not scattered taps.
34. If the main remote-first action fails, deliberately harvest the fallback proof from the same object or thread: retry state, model picker, saved history, citations, paywall/limit, settings/trust surface, or another honest follow-up beat. Do not simply give up after the first miss.
35. If the current evidence still cannot support a tutorial-like structure with a clear start, main workflow, result, and one less-obvious detail or limitation, the run is not publication-ready yet. Keep digging or record that limitation explicitly.
36. If the app exposed any meaningful motion beat and no short live clip was captured, treat that as a missing proof decision you must justify explicitly before leaving Stage 4.
37. For note, planner, reminder, journaling, and organizer apps, default to a typed create -> saved list/notebook/calendar view -> reopen/search/tag/revisit ladder instead of stopping at one freshly opened editor.
38. For note and planner apps, a truly strong run usually shows at least one readable fake object title plus one persistence surface such as a list view, tag, notebook/folder, calendar slot, search result, or detail reopen.
39. If the app belongs to the broad notes / planner family and you left without proving persistence or revisit, the run is usually `partial`, not `deep`, even if the design looked polished.
40. Human-review depth rule: before leaving Stage 4, try to prove not only that the app can start a task, but also how it feels after one small decision. A useful extra beat is often edit, rename, move, filter, sort, search, tag, pin, or reopen on the same object rather than a second unrelated feature.
41. Blank-canvas anti-pattern: do not let notes, journaling, sketch, or whiteboard apps finish on one beautiful but empty editor. Push to one readable object plus one saved / reopened / organized surface.
42. Motion-proof rule for depth: if the strongest truthful beat involves visible typing, processing, reordering, or a changed-state transition and you still leave without any short live clip, assume Stage 5 will look flatter and write that limitation explicitly instead of claiming the run was strong.
43. Evidence self-sufficiency rule: if the final video would still need Stage 1 store context or browser explanation just to make the app understandable, Stage 4 is not deep enough yet. Push until the iPhone-captured proof can explain the story on its own.
44. Sound-off rule: prefer proof beats that still read with minimal narration. The viewer should usually be able to infer the task, result, or limitation directly from the iPhone frames themselves.
45. Organizer / watchlist fallback rule: if a media lookup, import, sync, or network-backed add flow stalls, do not stop at create -> save -> reopen on an empty container. Push one more safe local organizing action on the same object, such as assign group/category, rename, pin, sort, move, add one readable local child item, or revisit it through search/filter.
46. Deep-label gate for organizer-style apps: do not call the run `deep` unless you proved either create/use -> saved/result -> revisit -> one more local organizing action, or an equally strong motion-backed proof beat on the same object.
47. Treat Stage 4 like a human making a teachable mini-tutorial, not a QA smoke test. By the end, one coherent viewer-friendly story should exist: how to start, what to do first, what changed, and what was surprisingly useful, limiting, or non-obvious.
48. Actively look for at least one truthful detail the App Store listing did not make obvious or barely mentioned, such as a hidden affordance, smart default, friction point, persistence behavior, shortcut, trust setting, or limitation that only appears after real use.
49. Prefer `6-10` distinct screenshots when the app safely supports it, not just the minimum package. If the current evidence still feels thin, keep pushing for one extra revisit, settings, trust, limit, or hidden-detail beat before leaving Stage 4.
50. If you discover a useful detail that was absent from the listing, capture both the surface itself and one nearby frame that shows why it matters in practice, so Stage 5 can narrate it like a human insight instead of a generic feature list.
51. Closeout gate: once you have a coherent create/use -> visible result -> revisit/extra-proof story, at least the required `01-04` screenshots, and one short live clip or an equally strong fifth screenshot, stop digging and move straight to structured notes. Do not start a second unrelated feature tour just because more taps are available.
52. Anti-drift rule: after the evidence floor is met, every extra action must clearly improve one of these only: saved-state proof, hidden detail, trust/limit, or a stronger closing verdict. If not, end the exploration and write the handoff files.
53. Shell restraint rule: outside bounded screenshot/clip capture and final artifact writing, do not use `bash` to reason about the live app state. If the next decision depends on what is on screen, prefer `gui_observe`.

## Inputs

- `artifactsRootDir` or `EPISODE_DIR`
- `manifest.json` with `selectedApp`
- optional `targetApp` override, but the manifest is the source of truth once Stage 1 finishes

## Exploration Architecture: 3 Focused Rounds

The exploration must be deep enough to fill a 3-minute video. To achieve this
within a single agent context, the exploration is structured as **3 focused
rounds** with note-writing checkpoints between them.

### Round 1: First impressions + primary task (screenshots 01-05)

1. Open the app from the home screen.
2. Capture `01-First-Screen.png` — what greets you on launch.
3. Handle onboarding/permissions (see Step 4 below).
4. Navigate to the main working surface. Capture `02-Main-Screen.png`.
5. Complete the app's **primary task** end-to-end:
   - For photo editors: import photo → apply one edit → see result
   - For note apps: create a note → type content → see it saved
   - For search/AI: ask a question → get an answer
   - For utilities: do the main thing the app promises
6. Capture `03-Core-Task.png` (task in progress) and `04-Core-Result.png` (result).
7. Capture one short live clip of the core task if motion helps.
8. Capture `05-Detail.png` — drill into the result (source panel, edit details, settings of the result).

**Checkpoint**: Write partial `experience/notes.json` with Round 1 findings.

### Round 2: Secondary feature + discovery (screenshots 06-10)

9. Try a **different feature or mode** than what you did in Round 1:
   - For photo editors: use a different tool (e.g., if you used filters in R1, use manual adjust in R2)
   - For note apps: organize, search, tag, or use a different note type
   - For search/AI: try a follow-up, a different mode, or save/bookmark
10. Capture `06-Secondary-Task.png` and `07-Secondary-Result.png`.
11. **Discover something non-obvious**: explore settings, pricing, hidden features, limits.
12. Capture `08-Discovery.png` (hidden feature or surprise).
13. Check for persistence: leave the screen and come back. Did your work survive?
14. Capture `09-Settings.png` and `10-Revisit.png`.

**Checkpoint**: Update `experience/notes.json` with Round 2 findings.

### Round 3: Limits + polish (screenshots 11-15)

15. Find at least one honest **limitation or friction point**:
    - Paywall? Feature lock? Missing undo? Confusing UI?
16. Capture `11-Friction.png`.
17. If time permits, try one more feature or compare before/after.
18. Capture `12+` as needed.
19. Return to home screen. Capture a final state if relevant.

**Checkpoint**: Write final `experience/notes.json`, `review-brief.md`, `story-beats.md`.

### Context efficiency rules

- After every gui_click or gui_type, do ONE gui_observe. Never observe twice without acting.
- Batch 2-3 screenshots in a single shell block.
- Do NOT re-read skill files mid-exploration.
- Minimize shell output (pipe through `head` or `tail`).
- If context is getting long, **stop and write notes immediately**.

### Screenshot naming convention

Use descriptive names that tell the story:

```
01-First-Screen.png          — what you see on launch
02-Main-Screen.png           — the primary working surface
03-Core-Task.png             — primary task in progress
04-Core-Result.png           — result of the primary task
05-Detail.png                — drill-down into result/detail
06-Secondary-Task.png        — a different feature in action
07-Secondary-Result.png      — result of the secondary feature
08-Discovery.png             — something non-obvious/hidden
09-Settings.png              — settings, pricing, or trust surface
10-Revisit.png               — persistence proof (came back, it's still there)
11-Friction.png              — an honest limitation or pain point
12-Comparison.png            — before/after or side-by-side
13-Extra-Feature.png         — bonus feature
14-Export.png                — save/export/share flow
15-Closing.png               — final state or summary view
```

## Fast Path (summary)

1. Read manifest, listing, selection-notes.
2. Plan 3 scenarios based on the app's category and features.
3. Open app, execute Round 1 (screenshots 01-05, partial notes).
4. Execute Round 2 (screenshots 06-10, update notes).
5. Execute Round 3 (screenshots 11+, final notes + review-brief + story-beats).
6. Return to home screen.

Default evidence target: **12-15 screenshots**, **1-2 clips**, **3 completed scenarios**.

## Execution model

When called from a pipeline, the **caller should spawn each round as a
separate child session** using `sessions_spawn`. This gives each round a
fresh context window and allows auto-compaction to run between rounds.

- Round 1 child: "Execute Round 1 of app-explore. Artifacts: <path>. Open the app, do primary task, capture 01-05, write partial notes."
- Round 2 child: "Execute Round 2 of app-explore. Artifacts: <path>. Continue in the app, secondary feature, capture 06-10, update notes."
- Round 3 child: "Execute Round 3 of app-explore. Artifacts: <path>. Find limitations, capture 11+, write final notes + review-brief + story-beats."

If running in a single session (not recommended for deep apps), follow the
context management rules and write notes incrementally.

5. Default screenshot package:
   - `experience/screenshots/01-First-Screen.png`
   - `experience/screenshots/02-Main-Screen.png`
   - `experience/screenshots/03-Core-Task.png`
   - `experience/screenshots/04-Outcome-Or-Friction.png`
   - `experience/screenshots/05-Revisit-Or-Hidden-Detail.png`
   - `experience/screenshots/06-Trust-Or-Limit.png`
   - optional `07-Secondary-Feature.png`
   - optional `08-Settings-Or-Pricing.png`
6. Write:
   - `experience/notes.json`
   - `experience/review-brief.md`
   - `experience/story-beats.md`
   - at least two lines into `experience/checkpoints.jsonl`
7. Return to the iPhone home screen before stopping.

Default category ladder:

- planner / calendar / reminder / notes / organizer:
  create one short fake object, save it, then reopen, search, tag, filter, rename, pin, or otherwise revisit it once
- organizer / watchlist / collection apps with network-backed catalog search:
  attempt the marketed add/search flow once, but if it stalls, pivot to a local collection-management loop on the same object: create a readable container, save it, reopen it, then do one more organizing action such as group, rename, sort, pin, move, or add one clearly fake local child item
- utility / reference:
  do one bounded task, then show the result plus one trust/settings/history beat
- AI / search:
  do one concrete prompt, then show the answer plus one trust/follow-up/source/history beat
- creator / editor:
  reach a real working surface, do one bounded edit or preview step, then show the result or honest blocker

If there is no changed state, no saved result, no revisit beat, and no
teachable extra detail, the run is not deep enough. Mark it `partial` or
`shallow` instead of pretending it is strong.

Self-sufficient-proof rule:

- By the time Stage 4 ends, the iPhone-led evidence should already carry the story without leaning on browser screenshots or long App Store paraphrases.
- If the app still only makes sense after a long setup explanation, keep exploring until the task and result become visible on-device, or mark the run thin.

## Human-Review Depth Floor

Before leaving the app, make sure the current evidence could honestly answer these four viewer questions with direct iPhone proof:

1. what is this app for?
2. what happened when I tried the main thing?
3. what visibly changed, saved, or failed next?
4. what extra trust / revisit / limit beat makes this feel tested instead of merely opened?

If one of those answers is still missing, the next move is usually one more bounded proof beat, not a prettier description.

## Step 1: Resolve the root and read the app context

Resolve `ROOT_DIR` the same way as Stage 1.

Read these files before touching the GUI:

- `skills/iphone-mirroring-basics/SKILL.md`
- `manifest.json`
- `topic/app-store-listing.json`
- `topic/selection-notes.md`

Use the selected app name from the manifest unless there is an explicit mismatch
you need to report.

Before opening the app, lock a tiny coverage plan from the browser listing:

- `primaryLoop`: the smallest truthful task that would make a viewer believe the app was really used
- `secondaryProof`: one follow-up surface that confirms depth, saved state, trust, settings, limit, or consequence
- `fallbackStory`: the honest friction story you will tell if the primary loop stalls early
- `listingPromises`: 2-4 specific claims or workflows implied by the App Store subtitle, description, `expectedCoreTask`, and Stage 1 notes
- `mustVerifyFirst`: the single strongest listing promise you will try to verify or falsify first on-device

Keep that plan coherent. The goal is not to tap everything. The goal is to return with enough linked evidence for Stage 5 to make a convincing review.

The `primaryLoop` should usually come from `mustVerifyFirst`, not from a generic category template. If the listing says the app is for watchlists, categories, pinned items, podcast queues, or another specific value prop, start there before drifting into generic settings or menus.

Before leaving this planning moment, also lock one simple claim boundary:

- `claimsICanDefend`: 2-4 short truths the video is allowed to say confidently
- `claimsToAvoid`: 2-4 tempting but unproven claims the video should not imply

This keeps Stage 5 honest when the exploration stayed partial.

Also lock one proof ladder before touching the app:

- `openingBeat`: the first screen or moment that proves the app is usable
- `primaryActionBeat`: the one action the run must truthfully complete or attempt
- `resultBeat`: the strongest visible consequence of that action
- `extraProofBeat`: one revisit, persistence, trust, settings, pricing, history, or deeper-feature beat that would make the review feel used rather than merely opened

If you cannot name those four beats, simplify the plan before entering the app.

If the browser listing and the in-app surfaces disagree, prefer the truthful on-device story, but record that mismatch explicitly in `fallbackStory` or `claimsToAvoid`.

Update `manifest.json` to:

- `status: "exploring"`
- `phase: "exploring"`

## Step 2: Re-open iPhone Mirroring and verify the home screen

```bash
open -a "iPhone Mirroring"
sleep 2
```

Then:

```text
gui_observe app:"iPhone Mirroring" captureMode:"window"
```

If the phone is not already on the home screen, use:

```text
gui_key key:"1" modifiers:["command"]
```

Note the window bounds for all screenshots in this stage.

Bounds rule for every later iPhone screenshot in this stage:

- Treat the latest GUI tool result `capture_rect` (or `pre_action_capture.capture_rect`) as the authoritative iPhone Mirroring window bounds.
- Persist that `{x,y,width,height}` tuple mentally and reuse it for every later `screencapture -R...` call in this stage.
- Also remember the latest GUI-reported `capture_display.index` when available. That display index is the preferred source for any short screen recording clip in this stage.
- If the GUI tool text does not expose numeric bounds you can directly reuse, use a deterministic CoreGraphics fallback via `swift` to enumerate on-screen windows and extract the bounds for `iPhone Mirroring` / `iPhone镜像`.
- Prefer a short inline `swift` script with `CGWindowListCopyWindowInfo`; do **not** rely on Python `Quartz` bindings here.
- Do **not** query `iPhone Mirroring` window bounds with AppleScript such as `tell application "iPhone Mirroring" to get bounds of front window`; that path is flaky.
- If GUI observation alone is insufficient, the only approved shell fallback is the CoreGraphics `swift` lookup above.

## Step 3: Open the app from the home screen

Tap the selected app icon on the home screen.

If the tap misses once, retry with stronger grounding. If the icon is still not
obvious, use Spotlight as a fallback to launch it, then continue. Do not guess
home-grid coordinates across different iPhone layouts.

Do not claim success until a follow-up observation shows app UI instead of the
home screen.

## Step 4: Handle blockers, retry on transient failures

Safe to dismiss or accept:

- tracking dialogs → non-tracking option
- notification prompts → `Don't Allow` unless needed for core experience
- onboarding next/skip/continue flows
- terms/accept screens that do not create accounts or spend money
- low-risk OS permissions: photo library (prefer limited), camera/microphone only when core experience needs it

Permission limit: grant at most 2 OS permissions per run. If a third is requested, stop granting and record the limitation.

**Photo/file picker rule:**

Many apps (photo editors, document scanners, video tools) require selecting a
file to start. This is not a blocker — handle it:

- When a photo picker appears, grant "Allow Full Access" or "Select Photos" access.
- Choose any available photo from the library — the iPhone always has sample/wallpaper photos or previously taken screenshots. Any image works for testing the editing workflow.
- If the picker shows "Recents", tap the first available photo.
- If the app asks to take a photo instead, prefer choosing from the existing library.
- If the library is empty, use the camera to take a quick photo of anything (desk, screen), then continue.
- Record which photo was used but do not waste time finding the "perfect" test image.

**Network and transient error retry rule:**

- If a core task fails due to timeout, network error, or "try again later", do NOT treat it as a terminal blocker.
- Retry the same action once. If it fails again, try a DIFFERENT query or approach.
- For AI/search apps: if the first query times out, try a simpler/shorter query (e.g., "best coffee shops" instead of a complex question).
- For network-dependent apps: wait 5 seconds, then retry once before recording the failure.
- Only mark the run as blocked after 2 different attempts have both failed.
- Record both the failure and the retry outcome truthfully — "first query timed out, second query succeeded" is a valid and interesting review finding.

Stop and report a blocker for:

- login or account creation required for the core experience
- payment or subscription required
- irreversible sharing/posting/invite flows
- sensitive permissions you cannot judge safely
- 2 different core-task attempts both failed

## Step 5: Explore deeply — cover the app's real feature surface

The goal is a thorough walkthrough that a viewer would find genuinely informative, not a smoke test. The evidence must support a **3-minute video with real substance**.

### Minimum coverage requirements (hard floor)

You must complete **at least 3 distinct functional scenarios**, not just one task:

1. **Primary task**: Complete the app's main value proposition end-to-end (e.g., for a search app: ask → get answer → read sources)
2. **Secondary task**: Try a different feature or variation (e.g., follow-up question, different mode, import/export, organize)
3. **Discovery task**: Find something the App Store listing did NOT make obvious (e.g., a hidden setting, a smart default, a limitation, an easter egg, voice mode, widget, sharing)

### Screenshot target: 10-15 distinct screens

Do NOT stop at 4-6 screenshots. Aim for **10-15** that tell a complete story:

- `01-First-Screen.png` — what greets you on launch
- `02-Main-Screen.png` — the primary working surface / navigation
- `03-Core-Task.png` — the main task in progress
- `04-Core-Result.png` — the result / answer / output
- `05-Source-Or-Detail.png` — drill-down into a result (e.g., source panel, detail view, citation)
- `06-Secondary-Task.png` — a different feature or mode
- `07-Secondary-Result.png` — result of the secondary task
- `08-Discovery.png` — something non-obvious (hidden feature, setting, limit)
- `09-Settings-Or-Trust.png` — settings, privacy, account, or pricing surface
- `10-Revisit-Or-History.png` — history, saved items, collections, bookmarks

Optional extras: `11-Friction.png`, `12-Comparison.png`, `13-Limit.png`, etc.

Capture every screenshot with the **same consistent method**: use the latest `capture_rect` from the GUI tool, capture the full window, crop with the standard proportional insets from `iphone-mirroring-basics`. Verify each saved PNG has consistent dimensions (all should be approximately the same pixel size, e.g., ~300x650 or the 2x equivalent).

### Coverage depth rules

- **Do not leave after one failed attempt**. If the core task fails (timeout, error, empty result), try again with a different input.
- **Do not stop at surface-level screens**. Tap into results, open detail views, scroll down, check secondary tabs.
- **Do not count navigation as exploration**. Moving between tabs is not a "feature explored". Using a feature and seeing its output is.
- **Prefer depth over breadth**: 3 features explored thoroughly beats 6 features glanced at.
- **Test persistence**: create something, leave the screen, come back. Did it save?
- **Test limits**: find at least one honest limitation, paywall, or friction point.
- After completing the minimum 3 scenarios, check: could a viewer watching only these screenshots understand what the app does, how it works, and whether they should download it? If not, keep exploring.
- Preferred target: one complete primary loop plus one secondary confirmation surface. Accept a single-loop-only run only when the app blocks early, the deeper path becomes unsafe, or the remaining actions would be pure guessing.
- Preferred target: one complete primary loop, one secondary confirmation surface, and one revisit / persistence / limit beat when that third beat is still safe and visually distinct.
- Strong-review target: if the app is calm enough to support it, aim for five linked proof moments rather than four:
  1. first useful screen
  2. one deliberate action
  3. one visible changed state
  4. one revisit / persistence / trust / limit beat
  5. one short motion beat or one extra clearly different proof frame that makes the final video feel tested rather than narrated
- Distinct-evidence rule: the required screenshots should normally show different moments, not the same state with tiny wording changes. If `03-Core-Task` and `04-Outcome-Or-Friction` would look almost identical, actively seek a more distinct secondary proof surface before ending the run.
- Do not end with four equally shallow screenshots. If the current evidence set still looks like "launch screen plus three nearby menus," keep digging for one stronger proof or one clearer blocker.
- Revisit rule: if the app lets you safely reopen the thing you just created, returned, saved, summarized, or configured, do that once before ending. A quick revisit beat is usually worth more than another settings detour.

Before tapping deeper, form a simple category-aware coverage plan from the App
Store listing and the first live screen.

Coverage templates:

- Creator / photo / video / design apps:
  - reach the actual editor, canvas, project composer, or tool hub
  - complete one mini workflow such as new project -> choose/import asset or blank canvas -> apply one tool/effect/edit -> reach preview/export/share/save surface if safe
  - prefer built-in templates, blank-canvas modes, or sample/demo content before demanding a full personal-media import
  - if the workflow is blocked only by a low-risk local permission such as limited photo access, grant it once and continue so you can prove a real editing step
  - if import is still blocked after the safest reasonable permission choice or because no local asset is available, still reach the deepest safe editing surface and show one concrete tool interaction
- AI / search / reference / assistant apps:
  - if the first screen already exposes a ready input box, do not burn time on profile/settings taps first; ask the concrete question immediately
  - prefer a short ASCII-friendly prompt of roughly 3-8 words so iPhone Mirroring text entry is faster and less error-prone
  - prefer one deliberate paste-or-type attempt with a short ASCII phrase over a long natural-language paragraph
  - enter one concrete, easy-to-evaluate prompt or question
  - wait for the real answer or result surface, not just the input box
  - inspect one trust or follow-up surface such as sources, related questions, thread history, copy/share, saved result, or model/tool switch
  - when the first answer succeeds, try one follow-up or one source/open-details interaction so the review can show both usefulness and depth
  - capture the strongest visible proof that the app delivered something useful, plus one limitation if it appears
  - if the app exposes tappable starter prompts, suggestions, or examples, prefer those over fragile free-form typing after one failed text-entry attempt
  - if text entry is visibly fragile, do not keep retrying the keyboard as the whole story; pivot quickly to a visible starter prompt, suggestion chip, example question, or other tap-driven first proof path when the app offers one
  - if the first useful output lands, immediately try to expose one secondary trust beat such as sources, follow-up chips, related links, saved history, or a model/tool switch before leaving the thread
  - if mirrored typing fails once but a visible starter prompt or example chip can still drive the same core loop truthfully, use that prompt before concluding the search flow was untestable
  - if the answer succeeds, do not stop at the answer bubble alone. Prefer one additional proof such as citations, source cards, thread history, copy/share, follow-up composer, or a visible model/tool switch
  - if the first answer stalls, errors, or stays ambiguous after a bounded wait, pivot once to a secondary proof surface from the same loop instead of freezing the story there: model picker, retry state, thread history, sources placeholder, follow-up composer, share/copy actions, or a nearby settings / trust surface
  - for stalled or failed first-answer runs, make `03-Core-Task` show the real attempt in progress and make `04-Outcome-Or-Friction` show a visibly later or different consequence surface rather than the same screenshot twice
- Utility / productivity / reference apps:
  - create, import, or configure one real object
  - change one meaningful setting or complete one primary lookup / scan / organization flow
  - capture the saved result or completed state
  - when safe, re-open or revisit that object once so the review can prove persistence rather than one transient screen
- Passive / ambience / idle / decorative apps:
  - do not stop at "it looks cute" or "music is playing"
  - find one real configurable loop such as choosing a room, changing one object, saving a placement, unlocking a collection, changing one mode, or revisiting a stored state
  - if the app never exposes a meaningful changed state beyond passive watching, mark the run as `shallow` and make the lack of depth the honest story
- Planner / calendar / scheduling / reminder apps:
  - prefer a local reversible sample object such as one demo event, reminder, shared-looking calendar entry, or note with obviously fake text
  - keep the sample object short and readable for an English-speaking viewer when possible, for example `Demo lunch`, `Team call`, or `Pay rent`
  - after creating or editing it, re-open the saved object or return to the calendar/list view so the review proves the state actually stuck
  - when the app allows it, prefer a three-step proof beat from the same object: create -> edit or move once -> revisit from the list/calendar/home surface
  - a truly strong note / planner run usually looks like create -> saved list/notebook/calendar view -> reopen/search/tag/filter/rename/pin on the same object
  - if that create -> saved -> revisit ladder is visually clear, prefer capturing it as the primary short live clip rather than leaving Stage 5 with only still screenshots
  - when collaboration, sharing, or sign-in is optional, stay local and prove the personal planning loop first rather than forcing invites
  - if the app is marketed around shared calendars or partner/family sync, explicitly try the solo local object flow first and only mention the collaboration angle as context unless you safely proved it
  - if search, tags, notebooks, filters, priorities, or list grouping are easy to reach, use one of those as the extra depth beat because it makes the review feel used rather than just created
- Organizer / watchlist / collection apps:
  - if the first promoted flow depends on remote search or metadata, try it once, but treat local organization depth as the stable fallback, not as a last-second consolation prize
  - prefer a clear ladder on the same object: create collection -> saved hub/list view -> reopen -> one extra organizing action such as group, rename, sort, pin, move, or add one clearly fake local child item
  - if the object reopens into an empty state, do not leave immediately when a nearby edit, overflow, group, sort, or add-control is visible and safe
  - a strong organizer run should usually prove not only that a container was created, but also how it can be shaped or revisited after creation
- Blank-canvas note / handwriting / notebook apps:
  - do not let the run collapse into freehand scribbling or a beautiful empty canvas
  - prefer one typed title, checklist item, text block, or obvious fake note so the evidence is readable in the final video
  - after the first note is created, actively look for one persistence surface such as the notes list, notebook/folder view, tag chip, search result, or reopened note
  - if templates, starter note types, folders, tabs, or notebook organization surfaces exist, use those to build a clearer create-save-revisit proof ladder
  - if the app exposes tags, folders, search, pinning, or notebook switching, prefer one of those as the extra proof beat over a second empty editor screenshot
  - when stylus-first drawing is the marketed depth surface, still bias toward one readable structured note plus one notebook / saved-state revisit beat instead of trying to prove brush nuance through mirroring
  - when safe, add one tiny second action on the same note such as check one item, rename it, move it, pin it, tag it, or reopen it from search. That small follow-up often creates the human-review depth the final video needs.
- Scanner / OCR / camera / import-first apps:
  - only continue when one bounded permission unlocks the first meaningful workflow
  - prefer a built-in sample, obvious local demo asset, or one reversible import path over broad library digging
  - if the app reaches a processed / cleaned / organized result, revisit that result once or show the library/history/state where it lands
  - if premium gating blocks the strongest feature, explicitly pivot to the best free proof surface instead of pretending the paywalled step worked
- Lifestyle / education / reading apps:
  - complete one content-entry or guided flow
  - reach the main content surface and one deeper feature or preference
- Games:
  - only continue if the chosen game still fits the slow-GUI criteria from Stage 1
  - complete the first controlled loop such as tutorial, deck setup, first turn, or menu-driven progression step
  - inspect one progression, reward, deck, or economy surface
  - do not treat a twitchy failed tap sequence as adequate coverage

Depth rule:

- Do not stop immediately after confirming that the app opens.
- Do not stop at a top-level dashboard when there is an obvious deeper safe action available.
- Prefer one completed, explainable task over three disconnected menu taps.
- If the first attempt works, try to add one secondary proof surface before leaving, such as saved history, settings relevant to the task, share/copy, or a deeper feature that confirms product depth.
- Favor screenshots that tell a viewer what happened without long narration. A good capture should usually show either a visible input, a visible result, or a visible blocker.
- If the app has obvious starter content, history, saved objects, templates, or settings that validate depth without risky side effects, prefer visiting one of those before ending the run.
- Publication-readiness check: before leaving the app, mentally ask whether Stage 5 could make a strong roughly `3 minute` English-first walkthrough with mostly product proof and only light packaging. If the answer is no, push for one more result, revisit, motion, hidden-detail, or limit beat when safe.

Live-clip rule:

- Create `experience/clips/` when you are about to capture the most important motion beat.
- Preferred clip paths:
  - `experience/clips/01-Core-Loop.mov`
  - `experience/clips/02-Secondary-Proof.mov`
- Record `2-4` clips when the app supports them. Keep them deliberate rather than recording the whole exploration.
- Preferred clip length is roughly `10-25s`. Do not let a clip run so long that the main action gets buried.
- Start the clip only when the app is already on the ready screen right before the important action. Avoid wasting the first seconds on app launch or hesitant setup.
- Use the display that currently contains the iPhone Mirroring window. Prefer the latest GUI-reported `capture_display.index`; if it is unavailable, fall back to display `1`.
- Practical shell path for a short motion beat is a backgrounded macOS screen recording such as:

```bash
mkdir -p "$ROOT_DIR/experience/clips"
CLIP_PATH="$ROOT_DIR/experience/clips/01-Core-Loop.mov"
rm -f "$CLIP_PATH"
DISPLAY_INDEX="${CAPTURE_DISPLAY_INDEX:-1}"
CLIP_DURATION="${CLIP_DURATION:-15}"
nohup screencapture -x -v -D"$DISPLAY_INDEX" -V"$CLIP_DURATION" "$CLIP_PATH" >/tmp/understudy-stage2-clip.log 2>&1 &
sleep 1
```

- **Always** set `DISPLAY_INDEX` from the latest GUI-reported `capture_display.index` and `CLIP_DURATION` to the appropriate length (10-25s) before recording. Do not copy the example values verbatim.
- After starting the recorder, immediately perform the already-planned action sequence. Do not open random extra menus just because recording is running.
- After the clip window elapses, verify the file exists and `ffprobe` can read it. If recording fails once, continue the run with screenshots only and note that the motion proof is missing.
- If the recorded clip includes more desktop context than desired, Stage 5 should crop the clip to the iPhone region inside CapCut rather than discarding the motion proof entirely.
- Prefer the core-task clip first. Capture `02-Secondary-Proof.mov` only when the extra beat is visually distinct and still safe.
- If the app clearly supported one meaningful animated proof beat and you skipped the clip anyway, do not flatter the run later. Record that the final edit will likely feel more static because motion proof was left uncaptured.
- If the first clip only shows setup and not payoff, try to capture a second short clip for the strongest visible result, follow-up, or revisit beat so Stage 5 is not forced into three static proof cards in a row.
- Before ending Stage 4 without any clip, explicitly ask whether the final video would now feel too static or too card-led. If yes and one safe motion beat is still reachable, capture it now rather than leaving Stage 5 to fake energy with extra text.

### Screenshot capture procedure

For EVERY screenshot:

1. Reuse the latest `capture_rect` from the most recent GUI tool result.
2. Capture the full iPhone Mirroring window: `screencapture -x -R"x,y,w,h" /tmp/raw.png`
3. Crop with the standard proportional insets from `iphone-mirroring-basics`.
4. Save to the target path under `experience/screenshots/`.
5. Verify the file exists and is non-empty.

Consistency rule: all screenshots in one run must use the same capture and crop procedure. Do NOT mix different capture methods (e.g., some from gui_observe images and some from screencapture).

### Incremental notes — write as you go, not at the end

**Critical**: Do not wait until exploration is finished to write notes. The agent
context window can run out during a long exploration. Write incrementally:

1. **After capturing screenshot 04** (primary task result): write a first draft of
   `experience/checkpoints.jsonl` and a partial `experience/notes.json` with what
   you have so far (app info, setup, coverage so far, findings so far). This ensures
   at least partial notes survive even if the run hits a context limit.

2. **After capturing screenshot 07 or completing the second scenario**: update
   `experience/notes.json` with the new findings, tasks, and screenshots.

3. **At the end of exploration**: write the final `experience/notes.json`,
   `experience/review-brief.md`, and `experience/story-beats.md`.

If you sense the context is getting long (many tool calls, long observations),
**stop exploring and write the notes immediately** with whatever evidence you have.
Incomplete notes are infinitely better than no notes at all.

### Depth gate

Before marking exploration complete:

- [ ] At least 3 distinct functional scenarios completed
- [ ] At least 8 screenshots in `experience/screenshots/`
- [ ] At least 1 live clip (or explicit justification)
- [ ] At least 1 honest limitation/friction discovered
- [ ] `experience/notes.json` exists and is valid JSON

Mark `deep` when all are met. Mark `partial` when 3-4 are met. Mark `shallow` only when genuinely blocked.

## Step 6: Finalize the structured review notes

Also write `experience/review-brief.md` as a human-readable handoff for Stage 5.
Also write `experience/story-beats.md` as the tighter natural-language bridge between exploration and video production.

Write `experience/notes.json` with at least:

```json
{
  "app": {
    "name": "string",
    "category": "string",
    "appStoreUrl": "string",
    "appStoreRating": 4.8
  },
  "setup": {
    "requiresLogin": false,
    "permissionsRequested": ["tracking", "notifications"],
    "permissionsGranted": ["selected photos"],
    "onboardingSteps": 2
  },
  "coverage": {
    "explorationStrategy": "string",
    "demoDepth": "deep | partial | shallow",
    "primaryLoop": "string",
    "secondaryProof": "string",
    "fallbackStory": "string",
    "proofLadder": [
      "opening beat",
      "primary action beat",
      "result beat",
      "extra proof beat"
    ],
    "featuresExplored": [],
    "coreTasksCompleted": [],
    "coverageGaps": [],
    "evidenceMoments": []
  },
  "findings": {
    "highlights": [],
    "painPoints": [],
    "surprises": [],
    "mustShowInVideo": []
  },
  "audienceFit": {
    "bestFor": "string",
    "avoidIf": "string"
  },
  "media": {
    "clips": [
      "experience/clips/01-Core-Loop.mov"
    ],
    "screenshots": [
      "experience/screenshots/01-First-Screen.png",
      "experience/screenshots/02-Main-Screen.png",
      "experience/screenshots/03-Core-Task.png",
      "experience/screenshots/04-Outcome-Or-Friction.png"
    ]
  },
  "scorecard": {
    "easeOfUse": 8,
    "design": 7,
    "novelty": 6,
    "retentionPotential": 6,
    "overall": 6.8
  },
  "scriptHooks": {
    "titleCandidates": ["I tried <AppName> on iPhone"],
    "openingHook": "string",
    "tensionLine": "string",
    "payoffLine": "string",
    "oneSentenceVerdict": "string"
  },
  "videoPlan": {
    "storyAngle": "string",
    "recommendedSlideOrder": [
      "opening-overlay",
      "first-impression",
      "context-beat",
      "core-task",
      "outcome",
      "secondary-proof",
      "verdict"
    ],
    "narrationLines": [
      "string"
    ]
  }
}
```

Implementation note:

- The block above is JSON, not Python source.
- If you build the object in a `python3` script, use Python booleans such as `False` / `True`, then write the file with `json.dumps(...)` instead of pasting the JSON block directly into Python.

Be specific and truthful. If coverage is partial, say it in the notes instead of
fabricating certainty.

Writing guidance:

- `openingHook` should be one strong sentence, not a paragraph.
- `tensionLine` should name the central question, tradeoff, or risk.
- `payoffLine` should describe the clearest demonstrated payoff from the exploration.
- `mustShowInVideo` should be 2-4 concrete visuals or moments, not abstractions.
- `narrationLines` should usually be `12-18` lines totaling `280-460 spoken words` (roughly `150-210 seconds` at natural pace). Each line should average `20-28 words` — a complete thought, not a fragment. If the total word count falls below `280`, the video will feel too short and the narration pipeline will trigger a fallback expansion.
- Production-language rule: when these notes are feeding a narrated short, prefer concise English-first viewer copy plus a short Latin alias for the app name when available. Keep full localized names only where they add truth and still stay readable.
- `permissionsGranted` should list only the permissions you actually allowed during this run.
- If the exploration stayed shallow, `coverageGaps` must say exactly what deeper task was not completed.
- `evidenceMoments` should identify the 3-5 strongest review receipts, each tied to a visible screen or action.
- `evidenceMoments` should usually name the exact screenshot or surface that proves each claim, so Stage 5 can lift them without guessing.
- Do not leave top-level sections or core sub-sections as placeholder `null` blocks when you already wrote the truth in markdown. Either fill the field truthfully or omit it; `experience/notes.json` should not be an empty shell beside a strong `review-brief.md`.
- `bestFor` and `avoidIf` should be viewer-facing guidance, not internal notes.
- `primaryLoop`, `secondaryProof`, and `fallbackStory` should stay simple and concrete so Stage 5 can turn them into cards without guessing.
- `proofLadder` should read like a 4-step mini storyboard, not a bag of unrelated taps.
- Narration-line rule: each line should sound speakable by local TTS. Avoid mixed-language clutter, long product subtitles, and dense punctuation.
- Natural-language-first rule: `review-brief.md` and `story-beats.md` are the human source of truth, but `notes.json` still needs enough real structure that later helpers can recover the same story without guessing.

Write `experience/review-brief.md` in concise natural language with these sections:

- `# Hook`
- `# How To Start`
- `# What I Tried`
- `# What Worked`
- `# What Got In The Way`
- `# Less Obvious Detail`
- `# Why It Matters`
- `# Best For`
- `# Avoid If`
- `# Must Show In Video`

Writing guidance for `experience/review-brief.md`:

- Keep it concrete and human-readable, not a JSON dump.
- Mention the exact task you attempted.
- If the run stayed shallow, say so plainly and explain why.
- `Why It Matters` should translate the exploration into one viewer-facing takeaway, not just repeat the hook.
- `Best For` and `Avoid If` should read like review advice that Stage 5 can almost quote directly.
- The `Must Show In Video` section should call out specific screenshots or moments that Stage 5 can translate into cards and narration.
- When a live clip exists, mention the exact clip filename and the moment inside it that carries the best proof.
- Prefer short punchy sentences that can be lifted into an English-first short without major rewriting.

Write `experience/story-beats.md` with these sections:

- `# Primary Loop`
- `# Secondary Proof`
- `# Motion Beat`
- `# Audience Or Limit Beat`
- `# Opening Frame`
- `# Climax Frame`
- `# Closing Frame`
- `# Claims I Can Defend`
- `# Claims To Avoid`
- `# Screenshot Map`
- `# Video Angle`

Writing guidance for `experience/story-beats.md`:

- Keep it short and punchy. This file is a production bridge, not a second full review.
- `Primary Loop` should name the exact action sequence that mattered most.
- `Secondary Proof` should describe the one extra surface that made the review feel deeper.
- `Motion Beat` should name the clip or screenshot moment that deserves the most on-screen time in the final edit.
- `Audience Or Limit Beat` should name the one frame or moment that most clearly supports the `best for` / `avoid if` verdict.
- `Opening Frame` should name the screenshot or moment that makes the strongest first 2-3 second hook.
- `Climax Frame` should name the screenshot or moment that carries the real payoff or friction.
- `Closing Frame` should name the screenshot or panel mood that best supports the final verdict.
- `Claims I Can Defend` should be specific viewer-facing truths backed by visible evidence.
- `Claims To Avoid` should call out what this run did **not** prove, especially when the app felt promising but partial.
- `Screenshot Map` should explicitly tie each saved screenshot filename to the proof beat it shows.
- `Screenshot Map` should prefer one sentence per screenshot that explains why that frame belongs in the final video.
- If a live clip exists, add it to the map and say which beat it should own in the final edit.
- `Video Angle` should be the one-sentence thesis Stage 5 should lean on.
- Where the app name is long or localized, prefer the short alias in production-facing lines and keep the full localized name only once when helpful.

Append at least two checkpoint lines to `experience/checkpoints.jsonl`:

- exploration started
- core task reached or blocker recorded
- notes written

Closeout priority:

- As soon as the evidence floor is met, Step 6 is the highest-priority next work.
- Do not keep tapping through extra app surfaces before `experience/notes.json`, `experience/review-brief.md`, and `experience/story-beats.md` exist.
- If the run already has `01-04` plus one clip or a strong revisit frame, assume Stage 5 would rather receive honest partial notes now than a longer but messier unclosed exploration.

## Step 7: Return to the home screen and stop there

Return to the home screen with:

```text
gui_key key:"1" modifiers:["command"]
```

Verify the home screen is visible.

Update `manifest.json`:

- `status: "explored"`
- `phase: "explored"`
- `timestamps.experienceDone`

## Stop Checklist

```bash
ROOT_DIR="<resolved root dir>"
test -f "$ROOT_DIR/experience/notes.json"
test -f "$ROOT_DIR/experience/review-brief.md"
test -f "$ROOT_DIR/experience/story-beats.md"
test -s "$ROOT_DIR/experience/checkpoints.jsonl"
test -f "$ROOT_DIR/experience/screenshots/01-First-Screen.png"
test -f "$ROOT_DIR/experience/screenshots/02-Main-Screen.png"
test -f "$ROOT_DIR/experience/screenshots/03-Core-Task.png"
test -f "$ROOT_DIR/experience/screenshots/04-Outcome-Or-Friction.png"
python3 -c "import json, pathlib; d=json.loads(pathlib.Path('$ROOT_DIR/manifest.json').read_text()); assert d.get('status')=='explored'; print('ok')"
```

Print what you explored, the main highlight, the main limitation if any, and the
overall score. Stop on the home screen.
