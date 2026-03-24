---
name: app-explore
description: >-
  Stage 2: Launch the installed app from the iPhone home screen, explore enough
  of it to produce a believable review package, and return to the home screen.
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
7. The goal is not merely to prove the app opens. The goal is to gather enough truthful evidence for a short review that feels like a human actually used the app.
8. If you only verified menus and did not complete a meaningful task, explicitly mark the exploration as shallow in `experience/notes.json` and `experience/review-brief.md` instead of writing an overconfident review.
9. Do not drift into random taps. If two consecutive mutating actions fail to deepen the same coverage plan, pause, restate the plan mentally, and either retry with a clearer target or back out to a stronger surface.
10. Screenshot quality matters. Do not save near-duplicate states as if they were different proof beats when a more distinct surface is still reachable.
11. A strong run should usually prove one primary loop plus one secondary confirmation surface from the same product story. Treat that as the default target unless the app blocks early.
12. Prefer one user-caused state change over passive browsing. A good review run should usually show something you actually created, changed, submitted, saved, toggled, or revisited.
13. For organizer, planner, calendar, to-do, journaling, note, or utility apps, prefer a reversible synthetic demo object over passive inspection. Safe examples include a clearly fake local event, reminder, note, or list item such as `Demo Lunch`, `Test Task`, or another obviously temporary sample.
14. A strong "deep enough" run should usually prove at least two linked state changes in the same product loop, such as create -> saved view, ask -> answer/source view, edit -> preview/export, or toggle -> resulting behavior. Avoid ending on one isolated tap if a second confirming beat is still safely reachable.
15. Treat 5 screenshots as the preferred target, not 4. The 5th image should usually be a persistence, history, settings, pricing/limit, or secondary-feature proof beat that makes the review feel used rather than merely opened.
16. If the app yields one meaningful object or result, try to revisit, reopen, or reframe that same object once before stopping. Saved-state proof is usually more valuable than one extra random menu.
17. Proof-ladder rule: aim to leave Stage 2 with four clear beats in order when the app allows it:
   - first useful screen
   - primary action in progress
   - result / saved / visible consequence
   - one revisit / persistence / trust / limit / settings proof beat
18. Do not let Stage 2 end with "pretty but thin" evidence. If the current screenshots still look like launch screen plus adjacent menus, keep pushing toward one real result, revisit, or limitation beat.
19. A run should usually be marked `deep` only when it reaches that extra proof beat or an equally strong revisit / persistence moment. If the app felt promising but you stopped before the extra proof beat, prefer `partial` over flattering yourself.
20. Prefer at least one short live iPhone clip of the core loop or payoff when the task is dynamic enough to benefit from motion. A strong Stage 3 cut should not be forced to rely on still screenshots alone when a safe 8-14 second clip was reachable.
21. Any live clip must come from the real Stage 2 attempt, not from a later browser reenactment or unrelated desktop filler.
22. Do not stop with a "looks nice" package. Before leaving Stage 2, ask whether the current evidence could cut into a genuinely watchable English-first short with at least three visually distinct iPhone-led proof beats; if not, keep digging or mark the run thin.
23. Prefer readable, English-friendly demo objects for local creation flows. A short fake title like `Demo lunch`, `Pay rent`, or `Test task` is usually more video-usable than scribbles, emoji-only filler, or long localized sample text.
24. Stage 2 is collecting a video-ready proof set, not just screenshots. Default target: one hook-friendly opening frame, one motion-friendly proof beat, one changed-state or revisit beat, and one audience / limit / trust beat.
25. If the app is collaboration-first, sync-first, or network-first, exhaust the local personal loop before touching invites, sharing, or account-backed flows.
26. If one more short clip or a fifth screenshot was safely reachable and would clearly deepen the final edit, prefer capturing it now over leaving Stage 3 to compensate with extra packaging.
27. A human-like review run should usually answer four viewer questions with direct evidence: what is this app for, how do I start, what happens when I do the main thing, and what sticks or limits the experience afterward.
28. Before calling a run `deep`, confirm the evidence set contains all of these:
   - one opening frame
   - one action-in-progress beat
   - one changed-state or visible-result beat
   - one revisit / trust / limit / persistence beat
29. If one of those beats is still missing, keep exploring when it is safe or mark the run `partial` rather than flattering it.
30. Prefer one extra edit / revisit on the same object over touching a second unrelated feature. Human-seeming reviews usually come from one coherent story, not scattered taps.
31. If the main remote-first action fails, deliberately harvest the fallback proof from the same object or thread: retry state, model picker, saved history, citations, paywall/limit, settings/trust surface, or another honest follow-up beat. Do not simply give up after the first miss.
32. If the current evidence still cannot support at least three visually distinct iPhone-led proof beats in the final short, the run is not publication-ready yet. Keep digging or record that limitation explicitly.
33. If the app exposed any meaningful motion beat and no short live clip was captured, treat that as a missing proof decision you must justify explicitly before leaving Stage 2.
34. For note, planner, reminder, journaling, and organizer apps, default to a typed create -> saved list/notebook/calendar view -> reopen/search/tag/revisit ladder instead of stopping at one freshly opened editor.
35. For note and planner apps, a truly strong run usually shows at least one readable fake object title plus one persistence surface such as a list view, tag, notebook/folder, calendar slot, search result, or detail reopen.
36. If the app belongs to the broad notes / planner family and you left without proving persistence or revisit, the run is usually `partial`, not `deep`, even if the design looked polished.
37. Human-review depth rule: before leaving Stage 2, try to prove not only that the app can start a task, but also how it feels after one small decision. A useful extra beat is often edit, rename, move, filter, sort, search, tag, pin, or reopen on the same object rather than a second unrelated feature.
38. Blank-canvas anti-pattern: do not let notes, journaling, sketch, or whiteboard apps finish on one beautiful but empty editor. Push to one readable object plus one saved / reopened / organized surface.
39. Motion-proof rule for depth: if the strongest truthful beat involves visible typing, processing, reordering, or a changed-state transition and you still leave without any short live clip, assume Stage 3 will look flatter and write that limitation explicitly instead of claiming the run was strong.
40. Evidence self-sufficiency rule: if the final short would still need Stage 1 store context or browser explanation just to make the app understandable, Stage 2 is not deep enough yet. Push until the iPhone-captured proof can explain the story on its own.
41. Sound-off rule: prefer proof beats that still read with minimal narration. The viewer should usually be able to infer the task, result, or limitation directly from the iPhone frames themselves.
42. Organizer / watchlist fallback rule: if a media lookup, import, sync, or network-backed add flow stalls, do not stop at create -> save -> reopen on an empty container. Push one more safe local organizing action on the same object, such as assign group/category, rename, pin, sort, move, add one readable local child item, or revisit it through search/filter.
43. Deep-label gate for organizer-style apps: do not call the run `deep` unless you proved either create/use -> saved/result -> revisit -> one more local organizing action, or an equally strong motion-backed proof beat on the same object.

## Inputs

- `artifactsRootDir` or `EPISODE_DIR`
- `manifest.json` with `selectedApp`
- optional `targetApp` override, but the manifest is the source of truth once Stage 1 finishes

## Fast Path

This is the default successful Stage 2 flow.

1. Read `manifest.json`, `topic/app-store-listing.json`, and `topic/selection-notes.md`.
2. Lock one tiny truthful coverage plan:
   - `primaryLoop`: the smallest real task that proves the app was used
   - `extraProofBeat`: one revisit / persistence / trust / limit beat from the same story
3. Re-open iPhone Mirroring from the home screen and launch the installed app.
4. Default evidence target:
   - one hook-friendly first useful screen
   - one action-in-progress beat
   - one changed-state or saved-result beat
   - one revisit / persistence / trust / limit beat
   - one short live clip when motion would clearly help the final short
5. Default screenshot package:
   - `experience/screenshots/01-First-Screen.png`
   - `experience/screenshots/02-Main-Screen.png`
   - `experience/screenshots/03-Core-Task.png`
   - `experience/screenshots/04-Outcome-Or-Friction.png`
   - optional `05-Secondary-Feature.png`
   - optional `06-Pricing-Or-Limit.png`
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

If there is no changed state, no saved result, and no revisit beat, the run is
not deep enough. Mark it `partial` or `shallow` instead of pretending it is strong.

Self-sufficient-proof rule:

- By the time Stage 2 ends, the iPhone-led evidence should already carry the story without leaning on browser screenshots or long App Store paraphrases.
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

Keep that plan coherent. The goal is not to tap everything. The goal is to return with enough linked evidence for Stage 3 to make a convincing review.

Before leaving this planning moment, also lock one simple claim boundary:

- `claimsICanDefend`: 2-4 short truths the video is allowed to say confidently
- `claimsToAvoid`: 2-4 tempting but unproven claims the video should not imply

This keeps Stage 3 honest when the exploration stayed partial.

Also lock one proof ladder before touching the app:

- `openingBeat`: the first screen or moment that proves the app is usable
- `primaryActionBeat`: the one action the run must truthfully complete or attempt
- `resultBeat`: the strongest visible consequence of that action
- `extraProofBeat`: one revisit, persistence, trust, settings, pricing, history, or deeper-feature beat that would make the review feel used rather than merely opened

If you cannot name those four beats, simplify the plan before entering the app.

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

## Step 4: Handle lightweight blockers, stop on hard blockers

Safe to dismiss or accept when appropriate:

- tracking dialogs -> choose the non-tracking option
- notification prompts -> choose `Don't Allow` unless the app is unusable without it
- lightweight onboarding next/skip/continue flows
- terms/accept screens that do not create accounts or spend money
- low-risk first-party OS permissions needed to reach one bounded core task:
  - photo library -> prefer `Selected Photos...` or the smallest limited-access option when available
  - camera -> allow only when the app's core experience clearly needs it and you can still keep the run local and non-posting
  - microphone -> only when it is the minimal requirement for one safe, reversible creation step

Permission-depth rule:

- Do not treat every OS permission prompt as an automatic blocker.
- If granting one bounded, low-risk local permission would unlock the app's first meaningful workflow, prefer granting it once and continue the exploration.
- Prefer the least-privileged option the system offers, and avoid broad/full access when a limited choice exists.
- After granting a permission, immediately verify that the newly unlocked surface really appeared; if not, do not keep granting more permissions blindly.
- Record both requested and granted permissions truthfully in `experience/notes.json`.

Stop and report a blocker for:

- login or account creation required to reach the core experience
- payment or subscription required
- irreversible sharing/posting/invite flows
- sensitive permission flows you cannot safely judge from the prompt
- permission ladders that keep escalating beyond the minimum needed for one bounded task

## Step 5: Explore enough to support a strong video, not just a proof-of-life

Cover these minimum beats:

- the first useful screen after launch
- the main navigation or primary working surface
- one real core task in progress
- one payoff, result, export surface, deeper feature, or real friction point
- one trust, history, saved-state, settings, or limit surface when that extra beat materially strengthens the review
- when safe, one extra screenshot that proves persistence, revisitability, or a second meaningful proof beat from the same loop

Coverage ladder:

- Before free-form tapping, decide on the smallest believable loop that would let a viewer say "yes, someone really tried this."
- Aim to capture:
  - entry -> what the app promises on first launch
  - proof -> one actual task or attempt, not just menus
  - consequence -> the result, saved state, answer, export surface, or honest blocker
  - context -> one secondary surface such as history, settings, sources, deck view, preferences, or pricing/limit, when that extra beat materially strengthens the review
- If the app is promising and safe, prefer 2-3 linked actions in one coherent loop over a single tap plus narration.
- If the app blocks early, keep pushing only toward the clearest truthful friction story. Do not pad the run with random menu taps.
- Preferred target: one complete primary loop plus one secondary confirmation surface. Accept a single-loop-only run only when the app blocks early, the deeper path becomes unsafe, or the remaining actions would be pure guessing.
- Preferred target: one complete primary loop, one secondary confirmation surface, and one revisit / persistence / limit beat when that third beat is still safe and visually distinct.
- Strong-review target: if the app is calm enough to support it, aim for five linked proof moments rather than four:
  1. first useful screen
  2. one deliberate action
  3. one visible changed state
  4. one revisit / persistence / trust / limit beat
  5. one short motion beat or one extra clearly different proof frame that makes the final short feel tested rather than narrated
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
  - if that create -> saved -> revisit ladder is visually clear, prefer capturing it as the primary short live clip rather than leaving Stage 3 with only still screenshots
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
  - when safe, add one tiny second action on the same note such as check one item, rename it, move it, pin it, tag it, or reopen it from search. That small follow-up often creates the human-review depth the final short needs.
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
- Publication-readiness check: before leaving the app, mentally ask whether Stage 3 could make a strong 25-35 second English-first short with mostly product proof and only light packaging. If the answer is no, push for one more result, revisit, motion, or limit beat when safe.

Live-clip rule:

- Create `experience/clips/` when you are about to capture the most important motion beat.
- Preferred clip paths:
  - `experience/clips/01-Core-Loop.mov`
  - `experience/clips/02-Secondary-Proof.mov`
- Only record 1-2 clips max. Keep them short and deliberate rather than recording the whole exploration.
- Preferred clip length is roughly `8-14s`. Do not let a clip run so long that the main action gets buried.
- Start the clip only when the app is already on the ready screen right before the important action. Avoid wasting the first seconds on app launch or hesitant setup.
- Use the display that currently contains the iPhone Mirroring window. Prefer the latest GUI-reported `capture_display.index`; if it is unavailable, fall back to display `1`.
- Practical shell path for a short motion beat is a backgrounded macOS screen recording such as:

```bash
mkdir -p "$ROOT_DIR/experience/clips"
CLIP_PATH="$ROOT_DIR/experience/clips/01-Core-Loop.mov"
rm -f "$CLIP_PATH"
nohup screencapture -x -v -D1 -V12 "$CLIP_PATH" >/tmp/understudy-stage2-clip.log 2>&1 &
sleep 1
```

- Replace `-D1` with the actual display index when the GUI output exposed a different display.
- After starting the recorder, immediately perform the already-planned action sequence. Do not open random extra menus just because recording is running.
- After the clip window elapses, verify the file exists and `ffprobe` can read it. If recording fails once, continue the run with screenshots only and note that the motion proof is missing.
- If the recorded clip includes more desktop context than desired, Stage 3 should crop the clip to the iPhone region inside CapCut rather than discarding the motion proof entirely.
- Prefer the core-task clip first. Capture `02-Secondary-Proof.mov` only when the extra beat is visually distinct and still safe.
- If the app clearly supported one meaningful animated proof beat and you skipped the clip anyway, do not flatter the run later. Record that the final edit will likely feel more static because motion proof was left uncaptured.
- If the first clip only shows setup and not payoff, try to capture a second short clip for the strongest visible result, follow-up, or revisit beat so Stage 3 is not forced into three static proof cards in a row.
- Before ending Stage 2 without any clip, explicitly ask whether the final short would now feel too static or too card-led. If yes and one safe motion beat is still reachable, capture it now rather than leaving Stage 3 to fake energy with extra text.

Capture at least these screenshots with window-bounded `screencapture` and crop
away the window chrome before saving:

- `experience/screenshots/01-First-Screen.png`
- `experience/screenshots/02-Main-Screen.png`
- `experience/screenshots/03-Core-Task.png`
- `experience/screenshots/04-Outcome-Or-Friction.png`

Practical capture rule:

- If the latest successful `gui_observe`, `gui_click`, or `gui_type` result already includes `capture_rect`, reuse it directly.
- Do not stop to rediscover bounds before each screenshot if the GUI result already exposed them.
- Prefer screenshots that prove what happened, not just that a screen existed.
- Before saving the last required screenshot, quickly sanity-check that the set tells a viewer a progression: first useful screen -> task in progress -> result / blocker / secondary proof. If two captures are too similar, replace one before finishing.

Optional extras:

- `experience/screenshots/05-Secondary-Feature.png`
- `experience/screenshots/06-Pricing-Or-Limit.png`

Target screenshot rule:

- Treat 4 screenshots as the floor, not the ideal.
- When the app yields a clearly distinct extra proof beat, capture `05-Secondary-Feature.png` by default.
- If a believable `05-Secondary-Feature.png` was reachable but you chose not to capture it, explain that choice in `coverageGaps` and bias the run toward `partial` rather than `deep`.
- When the app exposes a meaningful pricing, quota, paywall, trial, or feature-limit surface that genuinely changes the review verdict, also capture `06-Pricing-Or-Limit.png`.
- The preferred final screenshot set is: first screen, main screen, core task, outcome, plus one distinct secondary proof.
- Deep-run rule: a run should rarely claim `demoDepth: "deep"` unless it also captured either one live motion clip or one clearly distinct fifth screenshot that proves persistence, trust, limit, or a deeper feature.
- Final-edit readiness rule: before leaving Stage 2, ask whether the current evidence could cut into a genuinely watchable 25-35 second short for an English-speaking viewer. If the honest answer is "mostly static screens plus narration," keep pushing for one more motion beat, changed-state screen, or revisit beat when it is still safe.
- If the final evidence still looks like launch -> one task -> one texty conclusion with no persistence or revisit, do not expect Stage 3 packaging to save it. Record it as thin and keep the review honest.
- If the final evidence for an organizer/watchlist app still looks like launch -> create empty container -> reopen empty container, treat that as incomplete depth and keep pushing for one more local organizing action when it is safe.

## Step 6: Write the structured review notes

Also write `experience/review-brief.md` as a human-readable handoff for Stage 3.
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
      "store-promise",
      "first-impression",
      "core-task",
      "outcome-or-friction",
      "secondary-proof",
      "verdict-overlay"
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
- `narrationLines` should be 6-7 short spoken lines that can drive a 24-35 second short.
- Production-language rule: when these notes are feeding a narrated short, prefer concise English-first viewer copy plus a short Latin alias for the app name when available. Keep full localized names only where they add truth and still stay readable.
- `permissionsGranted` should list only the permissions you actually allowed during this run.
- If the exploration stayed shallow, `coverageGaps` must say exactly what deeper task was not completed.
- `evidenceMoments` should identify the 3-5 strongest review receipts, each tied to a visible screen or action.
- `evidenceMoments` should usually name the exact screenshot or surface that proves each claim, so Stage 3 can lift them without guessing.
- Do not leave top-level sections or core sub-sections as placeholder `null` blocks when you already wrote the truth in markdown. Either fill the field truthfully or omit it; `experience/notes.json` should not be an empty shell beside a strong `review-brief.md`.
- `bestFor` and `avoidIf` should be viewer-facing guidance, not internal notes.
- `primaryLoop`, `secondaryProof`, and `fallbackStory` should stay simple and concrete so Stage 3 can turn them into cards without guessing.
- `proofLadder` should read like a 4-step mini storyboard, not a bag of unrelated taps.
- Narration-line rule: each line should sound speakable by local TTS. Avoid mixed-language clutter, long product subtitles, and dense punctuation.
- Natural-language-first rule: `review-brief.md` and `story-beats.md` are the human source of truth, but `notes.json` still needs enough real structure that later helpers can recover the same story without guessing.

Write `experience/review-brief.md` in concise natural language with these sections:

- `# Hook`
- `# What I Tried`
- `# What Worked`
- `# What Got In The Way`
- `# Why It Matters`
- `# Best For`
- `# Avoid If`
- `# Must Show In Video`

Writing guidance for `experience/review-brief.md`:

- Keep it concrete and human-readable, not a JSON dump.
- Mention the exact task you attempted.
- If the run stayed shallow, say so plainly and explain why.
- `Why It Matters` should translate the exploration into one viewer-facing takeaway, not just repeat the hook.
- `Best For` and `Avoid If` should read like review advice that Stage 3 can almost quote directly.
- The `Must Show In Video` section should call out specific screenshots or moments that Stage 3 can translate into cards and narration.
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
- `Screenshot Map` should prefer one sentence per screenshot that explains why that frame belongs in the final short.
- If a live clip exists, add it to the map and say which beat it should own in the final edit.
- `Video Angle` should be the one-sentence thesis Stage 3 should lean on.
- Where the app name is long or localized, prefer the short alias in production-facing lines and keep the full localized name only once when helpful.

Append at least two checkpoint lines to `experience/checkpoints.jsonl`:

- exploration started
- core task reached or blocker recorded
- notes written

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
