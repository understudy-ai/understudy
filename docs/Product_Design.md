# Product Design

[中文版](./Product_Design.zh-CN.md)

Updated: 2026-03-12

## One-line Definition

> **Understudy is a teachable desktop agent.** It operates your computer like a human colleague — GUI, browser, shell, file system — learns from demonstrations, turns successful paths into reusable skills, and keeps improving how it executes work.

## Core Architecture: Five Layers

Every design decision in Understudy serves one of five progressive layers. Each layer depends on the one below it, forming a complete path from "can do" to "proactively does."

```
Layer 1  Native GUI capability          → operate software like a person
   ↓
Layer 2  Learn from demonstrations      → watch once, learn, validate, correct
   ↓
Layer 3  Remember successful paths      → reduce randomness and relearning
   ↓
Layer 4  Get faster over time           → upgrade from GUI to better routes
   ↓
Layer 5  Proactive autonomy             → notice and act without blocking the user
```

## Layer 1: Native GUI Capability

**Goal:** Complete real GUI tasks — open apps, click controls, type text, drag, scroll, and verify outcomes.

### Execution Routes

| Route | Implementation | Best for |
|-------|---------------|----------|
| `browser` | Playwright-managed browser + Chrome extension relay | Websites, authenticated web flows |
| `gui_*` | Screenshot grounding + native input events | macOS desktop apps, arbitrary native UI |

### GUI Tool Surface

`gui_read`, `gui_click`, `gui_right_click`, `gui_double_click`, `gui_hover`, `gui_click_and_hold`, `gui_drag`, `gui_scroll`, `gui_type`, `gui_keypress`, `gui_hotkey`, `gui_screenshot`, `gui_wait`

These tools live alongside `bash`, `browser`, `web_fetch`, and `web_search`, selected by the planner/orchestrator.

### Execution Discipline

Every GUI action follows the same loop:

```
observe → resolve target → execute action → re-observe → verify → trace
```

Core rules: GUI actions execute serially. Important steps always re-observe the UI. Verification requires fresh post-action observations. Every step emits evidence and trace data.

### Grounding

Dual-model architecture: the main model decides *what* to do. A separate grounding provider decides *where* on screen to do it. This separation means the planning model doesn't need pixel-perfect coordinate prediction, and the grounding model doesn't need task context.

```
Main model: "Click the Submit button"
  → Screenshot (window mode -l<windowId> / display mode -D<displayIndex>)
    → HiDPI normalization (Retina physical pixels → logical pixels) + adaptive scaling (≤2000×2000, ≤4.5MB)
      → Grounding model predicts: bounding box + click point + confidence
        → Map coordinates from model space to original image space (modelToOriginalScale)
          → Click point stabilization (small control edge bias >22% corrected to center; text fields ensure click in 18% safe interior)
            → [Small target ≤160px / dense area ≤2% of image] Crop and enlarge (≥360×320px, 5× bbox) for refinement pass
              → [Complex mode] Generate simulation overlay (SVG: crosshair + bbox + action badge) → validator model confirms
                → Rejected → generate guide image marking failed position → retry (up to 3 rounds)
              → Transform coordinates to display space (captureRect + scaleX/Y) → CGEvent native execution
                → Post-action screenshot → verify result
```

**Three coordinate spaces:** Physical pixels (raw screenshot PNG dimensions) → logical points (macOS display coordinates, what CGEvent expects) → model pixels (scaled version sent to the grounding model). scaleX/Y bridges physical to logical; modelToOriginalScale bridges model to physical.

**Two grounding modes:**
- `single` — predict and return, for unambiguous targets
- `complex` — after prediction, generate a simulation overlay; a validator model (same model, different prompt) confirms; rejected candidates are marked in a guide image, retried up to 3 rounds

**Cross-attempt feedback:** The runtime maintains a `groundingFeedback` Map in memory, keyed by `[app, scope, action, target]`, retaining up to 2 failure records for 2 minutes. The next grounding request for the same target carries these failures so the model avoids repeating mistakes. Records are cleared on success.

**Debounced wait:** `gui_wait`'s `probeForTarget()` requires 2 consecutive consistent positive or negative grounding results before declaring the condition met, preventing single spurious results from causing false positives.

Each verification returns structured status: `observed`, `resolved`, `action_sent`, `condition_met`, `not_found`, or `timeout`. This signal drives learning — a `condition_met` trace enables Layer 3 crystallization; a `not_found` triggers retry, fallback, or user handoff.

### Personalized UI Memory

Currently each grounding prediction is independent, retaining no history. Next step: persist grounding experience as personalized UI memory:

- **Element feature library** — remember visual characteristics, relative positions, and hierarchy of frequently used elements in each app
- **Layout model** — accumulate understanding of app interface layouts; infer new element positions when window size changes
- **Successful path cache** — for the same target, reuse the last successful grounding strategy (capture mode, scope hint, grounding mode)
- **Gets better with use** — for frequently used apps, grounding speed and accuracy improve over time; no more recognizing the same button from scratch

## Layer 2: Learn from Demonstrations

**Goal:** A user demonstrates a complete task once. Understudy extracts a reusable skill from that demonstration.

### Teach Model

A demonstration teaches a **task-shaped skill**, not a random list of clicks:

- **Atomic skill** — single capability: click, scroll, type, call API, send message
- **Task skill** — complete task composed from atomic skills, route choices, and verification
- **Teach draft** — editable draft form of a task skill
- **Published task skill** — promoted workspace skill for reuse

### Teach Flow

```
/teach start
  → Dual-track recording starts simultaneously:
    1. screencapture -x -v -D<display> -k → .mov video (with click markers)
    2. swift -e <inline script> → global event monitor (NSEvent.addGlobalMonitorForEvents)
       Captures: all mouse events, all keyboard events, app switches (NSWorkspace notification)
       Each event queries Accessibility API for semantic context: app name, window title,
       target element (role, title, description, identifier, value)
       Throttling: mouse moves 250ms/28px, drags 140ms/18px
  → User performs the complete task with mouse and keyboard

/teach stop "file the weekly expense report"
  → SIGINT stops dual-track recording → outputs .mov + events.json
  → Evidence pack construction (see below) → AI analysis → teach draft
  → Enters clarification dialogue

(Multi-turn natural language interaction, refining the task card: title, objective, parameter slots, steps, success criteria)

/teach confirm [--validate]
  → Checks for remaining open questions
  → Locks the task card; --validate also triggers replay validation

/teach validate <draftId>
  → Replays the learned task as an actual agent prompt
  → Analyzes execution trace: distinguishes blocking failures from recoverable failures (those followed by action_sent/condition_met recovery points don't count as failures)
  → Validation states: validated / requires_reset / failed / unvalidated

/teach publish <draftId> [skill-name]
  → Generates three-layer SKILL.md (see "Generalization" below)
  → Writes to <workspaceDir>/skills/<skill-name>/SKILL.md
  → Can run immediately after /teach confirm; replay validation is optional before or after publish
  → Hot-refreshes system prompts of all active sessions bound to the same workspace
```

**Privacy note:** demonstration artifacts are stored locally by default, but teach analysis and GUI grounding may send selected screenshots, keyframes, or other image evidence to the configured model provider.

### What It Is NOT

This is not a coordinate macro recorder. Understudy learns:

- **Intent** — "File the expense report," not "click at (340, 892)"
- **Parameters** — which values are fixed vs. which change each time (parameter slots `parameterSlots`)
- **Success criteria** — how to verify the task actually worked
- **Route options** — each step annotates preferred / fallback / observed routes, preferring non-GUI execution
- **Composability** — how steps compose into a complete task, referencing existing workspace skills

### Evidence Pack

`buildDemonstrationEvidencePack()` is video-first, not blind fixed-FPS frame sampling:

1. **Scene detection** — `ffmpeg -vf select='gt(scene,0.12)'` detects visual change points, minimum 900ms gap
2. **Event clustering** — clusters events by time gap (<1100ms), scores by event type (drag 60 / pointer 42 / keyboard 34 / scroll 24) and importance weighting
3. **Three-source merge** — event-guided windows + scene-guided windows + context windows (at 10%/50%/90% of duration), merged and deduplicated
4. **Adaptive budget** — allocates based on complexity (duration + event count + scene count + app variety): up to 18 episodes, 64 keyframes
5. **Semantic keyframes** — up to 6 per episode (before_action / action / settled / after_action / context ×2), retries at -250ms and -1000ms offsets on extraction failure
6. **AI analysis** — keyframes + representative events (up to 24) + capability snapshot (available tools + workspace skills) sent to model, returns structured JSON

Evidence pack decouples product contract from provider contract — analysis backend is swappable.

### Generalization

The published SKILL.md is a three-layer abstraction, not a coordinate recording:

1. **Intent procedure** (`## Staged Workflow`) — natural language steps. Instructions explicitly tell the agent: "Learn the workflow, not the tool sequence"
2. **Route options** (`## Tool Route Options`) — each step annotates `preferred` / `fallback` / `observed` routes. Preference order: skill → browser → shell → gui. Execution policy defaults to `toolBinding: "adaptive"`, `stepInterpretation: "fallback_replay"`
3. **GUI replay hints** (`## Detailed GUI Replay Hints`) — last resort only. Failure policy requires: `gui_read` before each action to confirm target visibility; target descriptions come from the current screenshot, not recorded coordinates; replan on route divergence rather than blind replay

UI redesigns, window resizing, even switching to a similar app — as long as the semantic target still exists, the skill works.

### Validation and Correction

Current implementation: create teach draft → multi-turn clarification dialogue → optional replay validation (actual execution + trace analysis) → publish.

Full Layer 2 target: replay the learned task → verify outcome → correct if needed → replay again until proven learned.

## Layer 3: Remember Successful Paths

**Goal:** Stop rediscovering the same solution from scratch.

**Current implementation:** workflow crystallization turns repeated day-to-day usage into real workspace skills. It is no longer just "save one successful trace." The system now tries to infer complete work episodes from ordinary conversation history, cluster repeated episodes, and synthesize a teach-style staged skill.

### Progressive Crystallization

| Stage | Meaning | LLM Cost | User Experience |
|-------|---------|----------|-----------------|
| Stage 0 | Full exploration | 100% | "The AI is figuring it out" |
| Stage 1 | Remembered path with verification | ~70% | "Faster than last time" |
| Stage 2 | Deterministic substeps | ~30% | "It knows the routine" |
| Stage 3 | Mostly crystallized | ~5% | "One-click" |
| Stage 4 | Proactive triggering | ~5% | "Did it before I asked" |

### Current Workflow Crystallization Pipeline

```
normal prompt turn
  → compact turn record
    → day-level segmentation
      → episode summarization
        → cross-history clustering
          → skill synthesis
            → publish workspace SKILL.md
              → hot-refresh active sessions
                → notify the user
```

#### 1. Compact turn record

Every successful workspace turn is persisted into a day-scoped ledger entry. The compact turn keeps:

- `timestamp`, `sessionId`, `runId`
- `userText`, `assistantText`
- compact execution evidence for later phases: parameter hints, success signals, uncertainties, route signature, tool-chain summary

This keeps the segmentation input small while retaining enough evidence for later summarization.

#### 2. Segmentation: dialogue-only boundary detection

Segmentation intentionally uses only ordered `user` / `assistant` dialogue. It does **not** consume raw tool traces directly.

Reason: the segmentation question is "where does one real job begin and end?" Tool logs are useful evidence, but they tend to bloat context and distract the model from boundary detection.

Output: one or more `segments`, each with:

- `startTurnIndex`
- `endTurnIndex`
- `completion` (`complete` or `partial`)

#### 3. Episode summarization: bring execution evidence back

After boundaries are fixed, the summarizer sees the segment plus compressed execution evidence and produces an `episode`:

- `title`
- `objective`
- `summary`
- `parameterHints`
- `successSignals`
- `uncertainties`
- `keyTools`
- `routeSignature`
- `triggers`
- `completion`

This is the stage that turns "two adjacent turns" into "one reusable work episode."

#### 4. Clustering: recurring work patterns

Only `complete` episodes are clustered across workspace history. The current implementation is LLM-first:

- cluster by intent and outcome first
- then use execution evidence as supporting signal
- allow literal parameter differences across runs

Output: recurring `clusters` with `episodeIds`, `title`, `objective`, `summary`, and `parameterSchema`.

#### 5. Skill synthesis: produce a teach-style skill

Promotable clusters are synthesized into a real workflow skill, not prompt-only memory. The output shape is intentionally close to teach:

- `title`, `objective`, `summary`
- `triggers`
- `parameterSlots`
- `stages`
- `routeOptions`
- `successCriteria`
- `failurePolicy`

Important constraint: stages should describe **functional work**, not low-level GUI replay. The skill can mention GUI only as a route option or fallback.

### User Experience

Layer 3 is designed to feel mostly passive:

- the user just keeps using Understudy normally
- no explicit `/teach` flow is required
- analysis runs asynchronously after successful turns
- the first visible moment is usually a notification that a crystallized workflow skill was published

Once published, the new skill is loaded through the normal workspace skills path and hot-refreshed into active sessions. From the agent's perspective, a crystallized skill behaves like any other workspace skill.

### Memory Outputs

- **Atomic skills** — single capability units
- **Task skills** — composed complete tasks
- **Scheduled skills** — task skills with trigger conditions
- **Editable skill graphs** — user-adjustable composition

For the current Layer 3 implementation, the main output is a published workspace task skill (`SKILL.md`) synthesized from repeated complete episodes.

### Safety Model

- Only verified experience hardens into long-term memory
- Failed experience does not poison the memory layer
- All learned outputs are versioned and rollback-capable

### Current Boundaries

- Segmentation, clustering, and synthesis are currently LLM-first rather than rule-first.
- Promotion thresholds are still heuristic.
- Layer 3 currently hardens repeated workflows into reusable skills; Layer 4-style automatic route replacement is still narrower and more conservative.

## Layer 4: Get Faster Over Time

**Goal:** The same task should not always run through the slowest GUI path.

### Route Pyramid

The same app feature can be accomplished in multiple ways. Take "send a Slack message" as an example:

```
Fastest ▲
        │  ① API call          Hit the Slack REST API directly (milliseconds)
        │  ② CLI tool          slack-cli send ... (seconds)
        │  ③ Browser           Locate input, type, send in Slack's web app (seconds)
        │  ④ GUI               Screenshot-ground, click, type in the Slack desktop client (seconds~10s)
Slowest ▼
```

GUI is the universal fallback — any app with an interface can be operated. But a task that's already been learned shouldn't always take the slowest path. Understudy discovers faster implementations of the same feature through daily execution, upgrading after verification.

### Current Route Selection Mechanisms

#### 1. System Prompt Preference

The `## Tool Routing` section in every session's system prompt explicitly tells the model:

```
direct tool/API > Shell/CLI > browser > GUI
```

This is the baseline steering: the planner is instructed to prefer higher-level routes whenever available, falling back to GUI only when no faster alternative exists. This preference is always active, regardless of whether a skill has been taught or crystallized.

#### 2. Route Guard Policy

The route guard (`route-guard-policy`) tracks consecutive failures per route category. Currently tracked routes: `gui`, `browser`, `web`, `shell`, `process`.

How it works:

- Every tool call result is classified into its route category
- Failed results increment a per-route failure counter
- Successful results reset the counter for that route
- When a route accumulates **2 or more consecutive failures**, the policy injects a guidance prompt into the next model turn, suggesting the agent try a different route

This is a reactive safety mechanism — it doesn't proactively search for better routes, but it prevents the agent from stubbornly retrying a failing path.

#### 3. Teach Route Annotations

When a skill is created through `/teach`, the published SKILL.md annotates each step with route metadata:

- `preferred` — the fastest known route for this step
- `fallback` — backup route if the preferred one fails
- `observed` — the route actually used during the demonstration

The execution policy defaults to `toolBinding: "adaptive"` and `stepInterpretation: "fallback_replay"`, meaning:

- The agent tries the preferred route first
- On failure, it falls back through the route list
- GUI is always the last resort
- At no point does the agent blindly replay recorded coordinates

This is where Layer 2 (teach) directly feeds Layer 4 (route optimization): the demonstration captures not just *what* to do, but *what routes are available* for each step.

#### 4. Browser Auto-Fallback

The browser tool operates in three modes: `auto`, `extension`, and `managed`.

In `auto` mode (default):

1. Try CDP connection to Chrome extension (preserves the user's logged-in sessions)
2. If extension is unavailable or connection fails, fall back to managed Playwright browser
3. Managed browser launches in a clean context (no existing sessions)

This fallback chain is transparent to the agent — it just calls the `browser` tool, and the runtime handles mode selection.

#### 5. GUI Capability Matrix

Not all GUI tools are always available. The runtime dynamically enables/disables tool subsets based on:

- **Accessibility permission** — required for input-driving tools (click, type, drag, scroll)
- **Screen Recording permission** — required for screenshot-based tools (grounding, read, screenshot)
- **Grounding provider** — required for visual target resolution

If a permission is missing, the corresponding tools are hidden from the model's tool list entirely, not just blocked at execution time. This prevents the agent from planning around tools it can't use.

### Relationship Between Layer 3 and Layer 4

Layer 3 crystallization and Layer 4 route optimization are complementary:

- **Layer 3** identifies *what work is repeated* and extracts it into a reusable skill
- **Layer 4** identifies *how each step of that work can be executed faster*

In practice, a crystallized skill from Layer 3 starts with whatever routes were observed during the original work. Over time, Layer 4 mechanisms (route guard, preference steering, teach annotations) push the same skill toward faster execution paths.

The current boundary: Layer 3 can crystallize a skill, but the routes inside that skill are still mostly inherited from observation rather than actively optimized. Full route optimization within crystallized skills is a future goal.

### Upgrade Policy

1. Discover a faster route → record it, don't switch yet
2. Repeated success + verification → promote to default
3. Any failure → fall back immediately
4. Remain explainable to the user

### Future Direction: Automatic Route Discovery

The current implementation relies on the model's own knowledge and the route annotations from teach/crystallization. The next step is active route discovery:

- **API probing** — for a given app, automatically search for CLI tools, REST APIs, or MCP tool surfaces that can accomplish the same task
- **Route verification** — run the same task through the new route and compare outcomes with the known-good path
- **Gradual promotion** — only promote a new route to default after N consecutive verified successes
- **Rollback on failure** — any single failure on a promoted route immediately demotes it back to the previous stable route

This is not yet implemented. The current system is intentionally conservative: it steers toward faster routes when they are already known, but does not autonomously search for routes the model has never seen.

### Current Boundaries

- Route optimization is guidance and safe preference ordering today, not a fully autonomous optimizer.
- The agent can prefer a known faster route, but does not yet search for novel routes automatically.
- Automatic route promotion (discover → verify → promote to default) is designed but not yet fully implemented.
- Route guard is reactive (responds to failures) rather than proactive (seeks improvements).
- Cross-layer integration between Layer 3 crystallization and Layer 4 route upgrading is still being refined.

## Layer 5: Proactive Autonomy

**Goal:** The system observes and understands human work patterns long-term, proactively suggests next actions, and executes autonomously in an isolated workspace without disrupting the user.

### Long-term Observation and Work Understanding

The core of Layer 5 isn't "execute on command" — it's "understand what you're doing."

- **Passive observation** — with user authorization, continuously observes desktop operations. Not recording every click, but recognizing work patterns: what time you process email, which tools you use for weekly reports, which operations always recur
- **Pattern discovery** — automatically extracts recurring patterns from observation data, understanding dependencies and trigger conditions between tasks (e.g., "every time user receives X-type email, they do Y operation")
- **Preference learning** — accumulates understanding of tool preferences, work rhythm, and communication habits, building a personalized work profile

### Proactive Suggestions

Based on accumulated observation and understanding, proactively suggests what to do next:

- **Task reminders** — "You usually file the weekly report on Friday afternoon. Want to start now?"
- **Follow-up suggestions** — "The attachment in this email hasn't been processed yet. Want me to organize it?"
- **Workflow optimization** — "You do this operation manually three times a day. Want me to automate it?"
- **Non-intrusive delivery** — suggestions pushed via notifications or messaging channels, no pop-up interruptions; only executed after user confirms

### Isolated Workspace

The AI executes tasks in its own workspace, without occupying the user's screen and input devices:

| Phase | Implementation | User Experience |
|-------|---------------|-----------------|
| Current | Controlled foreground window + app focus | AI completes tasks reliably |
| Near-term | macOS second desktop / headless window | User can switch to view AI work, no interference |
| Long-term | Docker + VNC / cloud VM | AI works 24/7, runs even when user is away |

Isolated workspace means: while you write code on your main desktop, Understudy can organize email, update docs, and follow up on tasks on another desktop — each doing their own thing, without interference.

### Cross-app Orchestration

The isolated workspace unlocks true multi-app parallel operation. Currently in foreground mode, the agent can only focus on one app at a time. In an isolated desktop, Understudy can:

- **Operate multiple apps simultaneously** — email client, spreadsheet, calendar, chat tools open in parallel, switching and passing data between them as needed
- **Coordinate data flow** — extract info from email into a spreadsheet, update calendar events, send results via Slack
- **Complex workflow orchestration** — multi-step tasks spanning multiple apps execute as a cohesive whole, not broken into separate single-app operations

### Progressive Trust Model

Each skill starts at the most conservative level. Promotion requires sustained success. Users can demote or revoke at any time.

| Level | Behavior |
|-------|----------|
| `manual` | User triggers every run (default) |
| `suggest` | AI suggests, user confirms before execution |
| `auto_with_confirm` | AI executes, user reviews result |
| `full_auto` | AI executes + verifies, notifies only on exceptions |

Promotion criteria: N consecutive successful executions of the same skill + no user corrections + verification passed. Any single failure triggers immediate demotion.

## Design Principles

### Interaction Principles

| Principle | Meaning |
|-----------|---------|
| Teachable, not prompt-once | Shape skills through demonstration and correction |
| Restrained notifications | Only interrupt when necessary |
| Transparent but not verbose | Decision process viewable, not forced |
| Progressive trust | Autonomy levels only go up manually |
| Safe degradation | Any failure falls back to more conservative methods |

### Learning Principles

| Principle | Meaning |
|-----------|---------|
| Replay validation is optional | Run replay validation before or after publish when you need extra confidence |
| Progressive crystallization | Learning is continuous and gradual |
| Rollback-capable | All learning results can be version-reverted |
| No pollution | Only verified successes enter memory |

## Current Status

**Implemented and passing acceptance:**

- Layers 1–3 (operate, learn, remember) implemented and tested
- 13 GUI tools with grounding (30/30 benchmark)
- Teach-by-demonstration with video-first evidence analysis
- Workspace skills with publish flow
- Session persistence, execution traces, memory
- 8 channel adapters, scheduled jobs, subagent delegation
- Built-in skill library

**Honest about what's not done:**

- Layer 4 route discovery — route preferences, route guard, teach route annotations, and browser auto-fallback implemented; active route promotion and automatic route discovery are future work
- Layer 5 passive observation — demonstration recorder can capture global events, but continuous background observation and pattern discovery not yet implemented
- Layer 5 proactive suggestions — scheduled triggers available, observation-based proactive suggestions not yet shipped
- Layer 5 isolated workspace — currently executes in foreground window, second desktop/headless approach is planned
- Layer 5 autonomy level management — four-level model designed, runtime level management and promotion/demotion logic not yet implemented
- Layer 1 personalized UI memory — currently each grounding prediction is independent, persisting experience (element features, layout model, successful paths) is planned
- Layer 5 cross-app orchestration — depends on isolated workspace, currently single-app focused per operation, multi-app parallel control is planned
- Task skill graph — output is still procedural SKILL.md, not composable graph
- Cross-platform GUI — macOS-centric today
- Automatic crystallization from Stage 0 → Stage 3 still being refined
