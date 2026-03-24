# iPhone App Review Demo Design

Updated: 2026-03-23

Related product doc: [iPhone_App_Review_Demo_PRD.md](./iPhone_App_Review_Demo_PRD.md)

## One-Line Definition

> Build a continuously operated iPhone app review pipeline on top of Understudy: select an app, install and explore it through iPhone Mirroring, capture evidence, assemble a publishable video, and prepare it for real publication.

## Why iPhone Mirroring

Compared with a Mac App Store demo, iPhone Mirroring is the stronger showcase:

1. The app pool is larger and more visually interesting.
2. Mobile products make better short-form review content.
3. The mirrored phone is still a macOS window, so it fits Understudy's desktop GUI execution model.
4. It creates a more compelling "real product review" story without changing the orchestration environment.

It also introduces the right technical pressure:

1. denser GUI targets
2. longer exploratory sessions
3. more permissions, onboarding, and interruptions
4. a stronger need for runtime media capture outside `/teach`

## Demo Goal

Technically, this demo should prove four things at the same time:

1. `teach` can produce a mixed scripted + agentic production pipeline.
2. `teach` can also produce a pure agentic worker contract for open-ended app exploration.
3. the hardest middle section can run as a long-lived, budgeted child session
4. the pipeline can operate as a queue of episodes instead of only one-off runs

## Existing Foundation In The Repo

The current codebase already gives us a strong base:

- teach flow: `/teach start|stop|confirm|validate|publish`
- task drafts support `kind: "skill"` and `skillDependencies`
- teach analysis can already reference existing skills
- child sessions exist via `sessions_spawn` and `subagents`
- scheduling exists via `schedule`
- approval exists via `require_approval`
- GUI execution already supports grounded clicks, drags, scrolling, typing, verification, and refinement

Useful anchors:

- teach interaction entry: `apps/cli/src/commands/chat-interactive-teach.ts`
- task draft schema: `packages/core/src/task-drafts.ts`
- teach analysis and publish flow: `packages/gateway/src/session-runtime.ts`
- child session management: `packages/gateway/src/session-runtime.ts`
- scheduling tools: `packages/tools/src/schedule/schedule-tool.ts`
- scheduling backend: `packages/tools/src/schedule/schedule-service.ts`
- trust engine: `packages/core/src/trust-engine.ts`
- GUI execution matrix: `docs/GUI_Action_Matrix.md`

## Capability Assessment

### Already reusable

- teach lifecycle
- skill publishing
- GUI action stack and grounding
- child sessions and steering
- scheduler wakeups and run history
- tool-level approvals

### Present as raw ingredients, but not yet productized

- skill-in-skill through task draft references
- workflow crystallization
- teach recording
- route preference and route guard behavior

### Missing for this demo

- runtime media pipeline
- iPhone Mirroring GUI profile
- segment-aware teach
- pure agentic teach mode
- episode manifest / queue / resume
- semantic approval gates
- a visible learning and progression layer

## Teach Modes Needed

This demo needs teach to support two distinct products.

### 1. Pipeline teach

This is the main demo path:

- a full workflow
- scripted topic selection
- agentic app exploration
- scripted post-production and publish preparation

### 2. Pure agentic teach

This is the deeper capability the demo should point to:

- the user teaches how to handle an open-ended class of work
- the result is a worker contract, not a replay trace
- the worker can be reused inside other pipelines

For this demo, the most important example is:

- `app-explore`

That worker should be understandable as both:

- one stage inside the app review pipeline
- a standalone taught capability for exploring unfamiliar iPhone apps

## Proposed Architecture

Split the system into six modules:

1. `Pipeline Orchestrator`
   - owns episode lifecycle and phase transitions
2. `Topic Selector`
   - scripted stage for App Store browsing and selection
3. `Experience Worker`
   - agentic child session for app installation and exploration
4. `Media Pipeline`
   - runtime recording, screenshot bookmarks, markers, and clip indexing
5. `Post-production Worker`
   - scripted template assembly for cover, scorecard, edit project, and export
6. `Publish Gate`
   - prepares previews and enforces final human confirmation

## Episode Data Model

Each review should have an explicit episode directory:

```text
artifacts/app-review/episodes/<episode-id>/
  manifest.json
  topic/
    candidates.json
    selection-notes.md
    screenshots/
  experience/
    recording-full.mov
    clips/
    screenshots/
    notes.json
    checkpoints.jsonl
  post/
    cover.key
    scorecard.png
    capcut-project/
    final-video.mp4
  publish/
    youtube.json
    xiaohongshu.json
    preview.md
```

`manifest.json` should at least include:

- `episodeId`
- `status`
- `selectedApp`
- `phase`
- `platforms`
- `budgets`
- `artifacts`
- `approvalEvents`
- `timestamps`

This manifest should become the shared source of truth for scheduler, orchestrator, child session, and publish steps.

## Three-Stage Execution Design

### Stage 1: Topic Selection (scripted)

Goal: pick one app worth reviewing from the iPhone App Store.

Suggested flow:

1. Open iPhone Mirroring and verify the target window.
2. Open the App Store.
3. Browse Today, Apps, Search, or category surfaces.
4. Capture screenshots for candidate cards and detail pages.
5. Extract fields such as:
   - app name
   - category
   - rating
   - price or IAP hint
   - whether the app was already reviewed
6. Score candidates and pick one.
7. Write `topic/candidates.json` and `selection-notes.md`.

This stage should be highly teachable and mostly deterministic.

### Stage 2: Experience (agentic)

This is the core of the demo. It should run as a contract-driven child session, not as a huge replay trace.

#### Inputs

- episode manifest
- selected app metadata
- user preference profile
- experience budget
- approval policy

#### Outputs

- full recording
- recommended clips
- highlight screenshots
- structured experience notes
- score suggestion
- exception and risk summary

#### Child session mode

Use the existing child session system as a long-lived worker:

- `mode=session`, not only `mode=run`
- the orchestrator waits or steers only at checkpoints
- the child session owns its own checkpoint and budget state
- the session can pause, resume, and accept steering messages

#### Internal worker phases

1. `bootstrap`
2. `install`
3. `onboarding`
4. `feature_discovery`
5. `evidence_harvest`
6. `evaluation`
7. `teardown`

#### Coverage policy

The worker should not try to tap every possible button. It should satisfy coverage goals:

- complete onboarding when feasible
- identify the main value proposition
- finish 3-5 core tasks
- capture 1-3 highlights
- capture 0-2 pain points
- output what the final video should say

#### Budgets

Top-level budgets:

- time budget, for example 45 minutes
- action budget, for example 80 mutating GUI or tool calls

Phase budgets:

- `install`: up to 10 minutes
- `onboarding`: up to 10 minutes
- `feature_discovery`: up to 20 minutes
- `evaluation`: up to 5 minutes

When a budget is exhausted, the worker should:

1. avoid an immediate hard failure
2. enter summarize-and-exit mode
3. preserve partial artifacts
4. mark the episode as `partial` or `blocked`

#### Approval checkpoints

Approvals should be semantic, not just tool-name based:

- payment or subscription requests
- Apple ID or account confirmation
- system permission prompts
- irreversible actions such as posting, messaging, or inviting friends

When triggered:

1. the child session pauses
2. the event is recorded in `approvalEvents`
3. the orchestrator prepares a user-facing preview
4. execution resumes only after confirmation

### Stage 3: Post-production and Publish (scripted)

Goal: turn experience artifacts into a publishable draft.

Suggested flow:

1. Read `experience/notes.json`.
2. Generate title, scorecard, and script hooks from templates.
3. Open Keynote and update cover and rating pages.
4. Open a CapCut template project and replace assets.
5. Export the video.
6. Generate YouTube and Xiaohongshu copy.
7. Open publishing surfaces and fill in content.
8. stop at final confirmation.

For v0, the goal is not fully intelligent editing. The goal is reliable template assembly.

## Trust Model

Trust should be stage-specific:

| Stage | Default trust | Why |
|------|---------------|-----|
| Topic selection | `full_auto` | low risk and stable |
| Experience | `auto_with_confirm` | uncertainty, permissions, and UI variation |
| Post-production | `full_auto` | template-based and reversible |
| Publish preview | `manual confirm` | always require human sign-off before external posting |

Promotion should also be granular:

- install flows can become trusted independently
- permission handling can become trusted independently
- onboarding handling can become trusted independently
- post-production can become trusted independently

## Scheduling Model

The scheduler should not mean "start a new review every day at 9am." It should mean "wake the orchestrator periodically, and let the orchestrator decide whether to start the next episode."

Suggested model:

1. a fixed wake job, for example every 30 minutes
2. the orchestrator reads the queue or ledger
3. if an episode is still active, it exits
4. if the system is idle and within policy, it creates the next episode

Real user settings should be:

- max episodes per day or week
- allowed execution window
- target platforms
- topic preferences
- budget limits

The product-facing control surface should also include:

- category allowlist and avoid list
- novelty versus popularity bias
- permission-risk tolerance
- login-heavy app policy
- publish destinations per episode type

## Continuous Queue Semantics

To match the intended product shape, the system should present itself as an episode queue rather than as isolated scheduled jobs.

Minimum queue semantics:

1. only one active episode at a time
2. multiple queued candidates or planned episodes
3. explicit reasons for not starting the next episode
4. a visible transition from `completed` to `queued next` when policy allows

For the demo, "continuous" should mean back-to-back execution within a bounded window, even before we support fully unattended long-term operation.

## Structured Experience Notes Schema

Stage 2 should emit a stable schema that post-production can consume directly:

```json
{
  "app": {
    "name": "string",
    "category": "string",
    "appStoreUrl": "string"
  },
  "setup": {
    "requiresLogin": true,
    "permissionsRequested": ["camera", "notifications"]
  },
  "coverage": {
    "featuresExplored": [],
    "coreTasksCompleted": []
  },
  "findings": {
    "highlights": [],
    "painPoints": [],
    "surprises": []
  },
  "media": {
    "recommendedClips": [],
    "screenshots": []
  },
  "scorecard": {
    "easeOfUse": 0,
    "design": 0,
    "novelty": 0,
    "retentionPotential": 0,
    "overall": 0
  },
  "scriptHooks": {
    "titleCandidates": [],
    "openingHook": "string",
    "oneSentenceVerdict": "string"
  }
}
```

## New Capabilities Needed

### 1. Runtime media pipeline

The repo already has teach recording, but not a runtime media pipeline for normal execution.

The demo needs:

- recording start and stop
- markers
- screenshot bookmarks
- checkpoint-driven slicing
- clip index generation

Minimum viable implementation:

- reuse `screencapture -v`
- wrap it as a runtime media module instead of ad hoc shell usage

A likely surface:

- `media_record(action=start|mark|stop|clip)`

### 2. iPhone Mirroring GUI profile

The existing GUI stack is already strong, but this demo needs a dedicated profile:

- bind observation and clicks to the mirrored phone window by default
- detect the phone canvas inside the window
- use more aggressive crop and refine logic for small targets
- add better prompt patterns for iOS widgets such as tab bars, back chevrons, sheets, segmented controls, and permission prompts
- add mobile gestures such as swipe, long press, and drag within the phone canvas

Pinch and rotation can wait until later.

### 3. Segment-aware teach and skill-in-skill

The repo already has two prerequisites:

- procedure steps can use `kind: "skill"`
- teach analysis can reference workspace skills

What is missing is a way to publish an agentic segment as a delegation contract instead of a replay trace.

Suggested additions:

- teach segment markers:
  - `scripted`
  - `agentic`
  - `approval_gate`
  - `artifact_boundary`
- user-facing commands such as:
  - `/teach mark scripted "Topic Selection"`
  - `/teach mark agentic "Try The App"`
  - `/teach mark scripted "Post-production"`

An agentic segment should publish:

- objective
- input contract
- output contract
- budget
- approval hooks
- done criteria
- failure policy

The resulting pipeline should be a skill graph rather than one giant skill:

1. `appstore-search-install`
2. `app-explore`
3. `capcut-edit`
4. `video-review-feedback`
5. `youtube-upload`
6. `app-review-cleanup`
7. `app-review-pipeline`

The same teach surface should also support a pure agentic publish path where only the worker contract is produced.

### 4. Long-running execution and recovery

Long tasks should be first-class.

Recommended additions:

- checkpoint journal
- phase-level resume
- partial-success output
- child-session steering
- budget overrun summary

Checkpoint payloads should include:

- current phase
- current screen or task hypothesis
- explored features
- unexplored features
- latest screenshot and timestamp
- remaining budget

### 5. Semantic approval gates

Tool-level approval exists today, but product-grade approval for this demo needs richer event types:

- publish preview gate
- permission gate
- paywall gate
- risky login gate

Those events should flow into the episode manifest so the orchestrator, UI, and publish pipeline can all reason over the same approval state.

### 6. Learning and progression display

The codebase already has crystallization and route learning concepts, but this demo needs a visible layer that shows:

- run-1 versus run-2 comparisons
- tool count deltas
- retry deltas
- newly crystallized skills
- trust promotion or demotion

## GUI Accuracy Focus

This area deserves explicit investment.

Already reusable:

- `groundingMode: "complex"`
- small-target refinement
- `gui_observe -> gui_click -> gui_observe` discipline
- window and display capture
- post-action verification

Additional iPhone-specific work:

1. mirror-window anchoring
2. phone-canvas crop
3. aggressive defaults for dense UIs
4. iOS control memory
5. finer error classification
6. mobile-first gesture and scroll policy

## Workstreams

### W1. Demo skeleton and pipeline orchestration

Goal:

- a top-level pipeline that can chain selection, experience, post-production, and publish

v0:

- manually triggered pipeline
- visible phase states: `selecting`, `experiencing`, `post`, `awaiting_publish_confirm`

### W2. Runtime media pipeline

Goal:

- capture reusable screenshots, basic app metadata, and later richer footage during normal execution

v0:

- persist screenshots from the run
- define a minimal app-info schema
- write a lightweight artifact manifest for the episode
- support the simplest screenshot-first review flow

v1:

- recording start and stop
- markers
- full recording plus basic clip list

v2:

- `clip`
- checkpoint-aware slicing
- richer media manifest

### W3. iPhone Mirroring GUI profile

Goal:

- make iPhone Mirroring a first-class GUI environment

v0:

- mirror window detection
- phone-canvas click bounds
- more aggressive small-target strategy

v1:

- swipe helper
- iOS control vocabulary
- dedicated default parameters for the mirror profile

v2:

- richer failure recovery
- persistent iOS UI memory

### W4. Experience worker contract

Goal:

- elevate app exploration from a generic subagent into a worker with budgets, phases, and outputs

v0:

- a clear worker prompt contract
- five or more explicit phases
- graceful summarize-and-exit behavior on budget exhaustion

v1:

- phase-aware steering
- richer outputs
- checkpoint-driven resume

### W5. Segment-aware teach / skill-in-skill

Goal:

- let teach represent a pipeline with both scripted and agentic segments, and also publish standalone agentic workers

v0:

- allow manual patching or clarification to express the middle stage as a `skill`

v1:

- `/teach mark scripted|agentic`
- publish agentic segments as worker contract skills
- publish a standalone worker contract from a pure agentic teach flow

v2:

- more segment types, including `approval_gate` and `artifact_boundary`

### W6. Post-production templates

Goal:

- make the generated content look like a repeatable series rather than a one-off export
- even the simplest version must cross a minimum visual bar: "a designer made a minimal template," not "an engineer concatenated screenshots"

v0:

- screenshot-first video composer with designed visual template
- cover frame: app icon + app name + one-line verdict on a consistent background
- scorecard frame: clean grid layout with fixed metrics
- content frames: screenshots with large high-contrast subtitles
- consistent background color or gradient, consistent font, consistent shadow
- simple crossfade transitions between frames
- fixed 1080x1920 vertical output
- ffmpeg-based assembly path
- one stable export format for one target platform

v1:

- cover template
- scorecard template
- subtitle style
- a stable Keynote / CapCut template project

v2:

- multiple templates
- stronger script-hook integration

### W7. Semantic approval gates

Goal:

- turn publish confirmation and risky UI events into product-level approval states

v0:

- final publish confirmation

v1:

- approval for camera, microphone, photos, subscription, posting, or messaging actions

### W8. Learning / progression layer

Goal:

- make Understudy's improvement **visually obvious**, not just numerically provable

v0:

- per-episode metrics ledger: runtime, action count, retry count, human interruption count
- a simple run-over-run comparison table in the episode manifest
- export a comparison summary that post-production can display

v1:

- side-by-side replay data: per-phase timestamps and action logs from run-1 and run-N
- replay viewer or fast-forward generator that can produce a split-screen comparison clip
- crystallized skill signals: which routes were new vs reused
- trust promotion events visible in the episode timeline

v2:

- behavioral diff overlay: highlight specific moments where run-N diverged from run-1 (faster, fewer retries, skipped unnecessary steps)
- auto-generated "what I learned" summary per episode
- cumulative learning dashboard across the episode queue

## Detailed Execution Plan

### Phase 0: iPhone Mirroring validation and text-only review

Goal:

- prove that iPhone Mirroring GUI control is reliable enough to build on, before investing in video production or teach integration

Scope:

- detect and anchor to the iPhone Mirroring window
- navigate the App Store: browse, search, tap into app detail pages
- install a specified free app and open it
- capture 3-5 screenshots with correct phone-canvas cropping
- extract basic app metadata (name, category, rating, price)
- output a structured markdown review and episode directory

Recommended implementation focus:

1. `W3 iPhone Mirroring GUI profile` — window detection, phone-canvas bounds, click targeting
2. `W2 Runtime media pipeline` — screenshot capture and episode directory only
3. basic iOS navigation patterns: back chevron, tab bar, scroll, search field

Deliberate exclusions:

- no video production
- no post-production templates
- no teach integration
- no agentic exploration
- no publishing surface

Acceptance:

- iPhone Mirroring window is detected and anchored reliably across 5 consecutive runs
- App Store search, install, and open succeeds for 3 different free apps
- screenshots are captured with correct phone-canvas cropping (no window chrome)
- a valid episode directory is created with `manifest.json` and `topic/` artifacts
- total GUI action failure rate is below 15%

This phase exists to de-risk the entire plan. If this does not pass acceptance, do not proceed to Phase 1.

### Phase 1: Hand-authored minimal skill

Goal:

- build one manually authored skill that closes the smallest believable loop before teach or agentic exploration

Scope:

- open iPhone Mirroring
- navigate to or search for a specified free app
- install and open the app
- capture 3-5 screenshots
- extract basic app information
- generate the simplest publishable short video
- prepare one publishing surface and pause for final confirmation

Recommended implementation focus:

1. `W3 iPhone Mirroring GUI profile`
2. `W2 Runtime media pipeline` in screenshot-first form
3. `W6 Post-production templates` in simplest-video form
4. `W1 Demo skeleton and pipeline orchestration` as one manually triggered skill

Deliberate simplifications:

- only free apps
- no login-heavy or social-first apps
- one publishing platform first
- screenshot-first video instead of full recording-first editing
- manual final confirmation before publish

Acceptance:

- given an app name or App Store target, one skill can complete the loop end to end
- it produces a basic but real short video
- it reaches publish preview consistently

### Phase 2: Teach-generated equivalent skill

Goal:

- prove that the same minimal loop can be produced through teach and refine, not only by hand-authoring the skill

Scope:

- run teach over the full minimal workflow
- use refine / clarification to correct the draft
- publish the resulting skill
- compare the teach-produced skill with the hand-authored one

Recommended implementation focus:

1. `W5 Segment-aware teach / skill-in-skill` in its no-new-command form
2. refine-time conversion of one or more subtasks into skill references
3. publish and hot-refresh of the resulting workspace skill

Important product decision:

- do not require `/teach mark` at this stage
- use teach refine to shape the draft into the right reusable skill

Acceptance:

- one teach session plus light refinement can yield a working minimal review skill
- the teach-produced skill can replace the hand-authored one for the same constrained flow

### Phase 3: Agentic experience worker

Goal:

- replace "open the app and collect screenshots" with "explore the app and return lightweight review artifacts"

Scope:

- onboarding completion when feasible
- 2-3 core features explored
- highlights and pain points captured
- structured notes output
- budgeted execution

Recommended implementation focus:

1. `W4 Experience worker contract`
2. `W2 Runtime media pipeline` in recording form
3. `W7 Semantic approval gates` for permissions and paywalls
4. `W5 Segment-aware teach / skill-in-skill` as a standalone worker contract path

Acceptance:

- the middle stage can handle an unfamiliar app as a bounded worker
- partial success still returns usable screenshots, notes, and review material

### Phase 4: Chain quality and autonomy upgrades

Goal:

- upgrade the whole chain from "working automation" into a compelling Understudy demo

Scope:

- autonomous topic selection
- deduplication and lightweight editorial planning
- better video structure and review quality
- clearer operator overlays and episode visibility
- stronger reusable assets for cover, subtitles, and verdicts

Recommended implementation focus:

1. `W1 Demo skeleton and pipeline orchestration` for a richer pipeline
2. `W6 Post-production templates` in Keynote / CapCut form
3. topic selection logic plus review history
4. `W8 Learning / progression layer`

Acceptance:

- the system can choose a candidate app on its own
- it avoids obvious repeats
- the generated content feels like a repeatable review series

### Phase 5: Continuous studio loop

Goal:

- turn the pipeline into a continuously advancing episode queue

Scope:

- episode manifest and artifact ledger
- active episode lock
- queue-aware scheduler behavior
- one episode finishes and the next eligible one begins
- policy-based execution windows and rate limits

Recommended implementation focus:

1. queue and manifest support in orchestration
2. `W7 Semantic approval gates`
3. queue-aware scheduling and bounded continuous handoff
4. recovery, reuse, and later trust promotion

Acceptance:

- one episode can finish and hand off to the next safely
- the system avoids concurrent overlap
- repeated runs visibly reuse earlier experience

## Recommended Build Order

Build in this order:

0. iPhone Mirroring GUI profile validation (Phase 0 gate)
1. screenshot-first artifact capture and episode directory
2. simplest video composer with designed visual template
3. hand-authored minimal review skill (end-to-end)
4. teach-generated equivalent skill
5. agentic experience worker with budgets and phases
6. side-by-side improvement replay and comparison tooling
7. autonomous topic selection and better review presentation
8. queue, deduplication, and continuous loop behavior

Why:

- step 0 is a hard gate: if iPhone Mirroring GUI is unreliable, nothing else matters
- steps 1-3 close the smallest production loop
- step 4 proves teach can reproduce what was hand-authored
- step 5 makes the middle stage truly agentic
- step 6 must exist before any demo recording: the improvement story is not optional
- steps 7-8 upgrade quality and add continuous operation

## Highest-Leverage Investments For The New Plan

If only three things can be built first:

1. iPhone Mirroring GUI profile — validated through Phase 0 acceptance criteria
2. screenshot-first artifact and metadata pipeline
3. simplest video composer with a designed visual template (not raw ffmpeg output)

Without those three, there is no reliable minimal skill to teach, upgrade, or loop.

If a fourth investment is possible, it should be:

4. side-by-side improvement replay tooling (W8 v1)

The improvement story is not a nice-to-have. It is the core differentiator of the entire demo. Without visible learning, Understudy is "an agent that does a thing once." With visible learning, it is "a coworker that gets better at the job."

## Demo Reliability

### Pre-recorded segment inventory

Before any demo recording or live presentation, the following segments must exist as pre-recorded backup:

| Segment | Duration | Purpose |
|---------|----------|---------|
| Full autonomous episode | 5-8 min (sped up) | Act 3 backup |
| Experience worker highlights | 2-3 min | The most visually impressive exploration moments |
| Side-by-side improvement | 30-60 sec | Act 4 backup |
| Published result page | 10 sec | Act 1 backup |
| Teach flow | 1-2 min | Act 2 backup |

### App selection for demo

Maintain a curated shortlist of 5-10 apps that are confirmed to work well for the demo:

Criteria:

- free, no login required
- interesting enough to make a compelling review
- has at least one onboarding flow (to show navigation skill)
- has at least one unexpected element (permission prompt, paywall hint) to trigger the resilience moment
- visually appealing (the screenshots will appear in the final video)
- not a game (games require gesture patterns that are harder to demonstrate reliably)

Anti-criteria:

- no social apps requiring account creation
- no apps with mandatory phone verification
- no apps that are primarily web views
- no apps with aggressive ad interstitials in the first minute

### Failure recovery scripts

For each known failure mode, prepare a recovery procedure:

1. **iPhone Mirroring window lost**: `osascript` script to re-activate iPhone Mirroring and re-anchor
2. **App Store navigation stuck**: kill and reopen App Store via home screen
3. **App install hangs**: cancel and retry with a different candidate app from the shortlist
4. **GUI click loop (>3 retries on same target)**: skip the current interaction, log it as a pain point, continue to next phase
5. **screencapture failure**: restart screencapture process; if persistent, continue without recording

These scripts should be tested before every demo session.
