# iPhone App Review Demo PRD

Updated: 2026-03-18

Related technical design: [iPhone_App_Review_Demo_Design.md](./iPhone_App_Review_Demo_Design.md)

## One-Line Definition

> Understudy is a teachable iPhone App Review Studio. You demonstrate one full production run once, it learns the production line, and then it keeps finding apps, trying them, producing videos, and getting better with each episode.

## What This Demo Must Prove

This demo is not trying to prove that "AI can post videos." It is trying to make Understudy's product identity obvious:

1. It can be taught, not merely prompted.
2. It can operate arbitrary GUI software, not just browsers and APIs.
3. A taught workflow can contain a genuinely agentic middle section.
4. Teach should also be able to produce a pure agentic worker, not only scripted replay or mixed workflows.
5. Repeated execution should turn into learning, reuse, and visible improvement.

If the demo works, the audience should leave with one sentence in mind:

> Understudy is not another assistant that happens to do things. It is a desktop agent you can personally teach, and one that gets more capable as it keeps doing the job.

## Product Positioning

This demo should not compete on generic agent platform claims like:

- we also have subagents
- we also have scheduling
- we can also publish content
- we can also use skills

Those are supporting ingredients, not the product story.

The real positioning is:

- OpenClaw feels more like a personal AI assistant / gateway / nodes platform.
- Understudy should feel like a teachable desktop coworker.

The hero of this demo is therefore not "always-on assistant behavior." The hero is "I showed it how to do a real desktop job, and now it can take that work over."

## Product Shape

The demo should deliberately have two layers.

### Layer 1: The content product

This is what the outside world sees first:

- a real YouTube or Xiaohongshu account
- a repeatable stream of short iPhone app review videos
- consistent visual style, title style, scorecard style, and pacing
- output quality that feels publishable, even if still template-driven

This layer proves that Understudy can create a real outcome, not merely move a cursor around.

### Layer 2: The Understudy showcase

This is the "behind the scenes" product demo:

- Understudy opens iPhone Mirroring
- browses the App Store and picks a candidate
- launches a dedicated experience worker
- installs and explores an unfamiliar app
- records footage, screenshots, and structured findings
- assembles a cover, scorecard, and edited draft
- prepares platform publishing pages
- pauses at a preview gate before final publishing

This layer proves that the content product is not hand-assembled behind the scenes.

The demo only works if both layers exist at the same time:

- without Layer 1, it looks like a technical toy
- without Layer 2, it looks like a generic automation tool

## Teach As A Product Surface

This demo should make teach feel broader than "record a deterministic workflow."

Understudy should visibly support two teach outcomes:

1. `Pipeline teach`
   - a full production line with scripted stages and one agentic middle section
2. `Pure agentic teach`
   - a reusable worker contract for uncertain work such as "explore an unfamiliar iPhone app and bring back review artifacts"

For this demo, the main path is still pipeline teach. But the product story should make it clear that the app-experience worker is not just a hardcoded special case. It represents a more general teach outcome: a user can teach Understudy how to approach an open-ended class of work, not only how to replay fixed clicks.

## Operating Model

This product should not feel like a daily cron job with a flashy UI. It should feel like a small content studio with an episode queue.

The intended behavior is:

- there is a queue of candidate episodes
- one episode runs at a time
- when one episode finishes, the system decides whether to start the next eligible one
- policy decides cadence, execution windows, and risk tolerance

For the product story, "continuous" therefore means "one after another under policy," not "fire at a fixed time no matter what."

## Operator Controls

Even though the automation is the hero, the operator should still have a small but clear control surface.

At minimum, the product should expose:

- episode cadence cap
  - for example, max episodes per day or per week
- allowed execution windows
  - for example, only daytime or only weekdays
- topic preferences
  - category allowlist, avoid list, novelty bias, price sensitivity
- target platforms
  - YouTube, Xiaohongshu, or both
- risk profile
  - whether login-heavy, permission-heavy, or subscription-heavy apps are allowed
- publishing rule
  - always require final human confirmation before publish

These settings matter because they make the system feel like an operable product, not just an internal demo pipeline.

## Rollout Strategy

This demo should be built in five deliberate stages instead of trying to jump straight to the final autonomous studio.

### Stage 0: Validate iPhone Mirroring and text-only review

Before attempting the full production loop, prove the hardest dependency first: reliable GUI control of an iPhone through iPhone Mirroring.

Scope:

- open iPhone Mirroring and verify stable window detection
- navigate the App Store, search for a specified free app
- install and open the app
- capture 3-5 screenshots with metadata
- output a structured markdown review (no video)

At this stage, there is no video production, no post-production, and no publishing surface. The only goal is to confirm that the iPhone Mirroring GUI profile can operate reliably enough to build on.

Acceptance:

- the system can consistently detect, click, scroll, and type within the mirrored phone window
- screenshots are captured and organized into an episode directory
- a readable markdown review is generated from the screenshots and extracted metadata

This stage exists to de-risk the entire plan. If iPhone Mirroring GUI control is unreliable, every later stage is blocked.

### Stage 1: One hand-authored skill that closes the loop

Start with the smallest believable chain:

- open iPhone Mirroring
- install and open a specified free app
- capture a few screenshots
- extract basic app information
- generate the simplest publishable short video
- prepare one publishing surface and pause for final confirmation

At this stage, the goal is not intelligence. The goal is a skill that can run the basic production loop end to end.

### Stage 2: Use teach to generate the same kind of skill

Once the hand-authored skill works, teach the same workflow and refine the draft until it produces an equivalent reusable skill.

The point of this stage is to prove:

- this is not only a manually assembled automation
- Understudy can learn this production line through teach and refine

### Stage 3: Upgrade the app-opening step into a real experience worker

Only after the minimal loop is working should the middle step become agentic:

- instead of only opening the app, it explores the app
- instead of only taking screenshots, it produces findings
- instead of only collecting basic facts, it forms a lightweight review

This is the first stage where the system should feel like it is genuinely trying an unfamiliar product.

### Stage 4: Upgrade the overall quality and autonomy

After the agentic worker exists, improve the rest of the chain:

- autonomous topic selection
- avoid repeated apps
- better video structure and presentation
- better review quality
- stronger publish assets

This is where the system becomes a compelling demo and not just a working automation.

### Stage 5: Turn it into a continuous studio loop

Only after the chain is individually strong should it become continuous:

- one episode completes
- the next eligible episode is selected
- the queue advances under policy

This is the final operating model, not the first milestone.

## Demo Narrative

The cleanest way to tell the story is in four acts.

### Act 1: Show the result first

Open with a real published video on a real account page. Let the audience see:

- the actual platform page
- the title and cover
- 5-10 seconds of the final video

The first reaction should be: "This is a real piece of content."

### Act 2: Reveal that it was taught

Only after the result lands should the demo rewind and show:

- `/teach start`
- a human demonstrating one full production run
- `/teach stop`
- the teach draft
- `/teach publish`

The audience should understand that this was not built as a rigid macro or hand-authored workflow.

This act should also briefly signal that teach is not limited to replay. The review pipeline contains a deliberately agentic experience section, and that section can itself be published as a reusable worker contract.

### Act 3: Show one autonomous episode

This is the core act. It should show one end-to-end episode:

1. an episode is started or resumed
2. iPhone Mirroring opens
3. App Store topic selection runs
4. an experience worker is launched
5. an unfamiliar app is installed and explored
6. footage, screenshots, and notes are produced
7. post-production templates are filled
8. publishing pages are prepared
9. the system pauses at final preview
10. the human confirms and the video is published

The audience should understand that the middle section is not replay. It is live decision-making within a taught production line.

### Act 4: Show improvement

The last act must show that this is not a one-off stunt. This is the act that separates Understudy from every other agent demo.

The improvement must be **visually obvious**, not just numerically provable. Show, do not tell.

Primary format: **side-by-side fast-forward replay.**

Pick one or two concrete moments and show them in split-screen:

- left: run-1 (the first autonomous episode after teach)
- right: run-N (a later episode after repetition)

The best moments to compare are ones where the behavioral difference is visible:

- onboarding: run-1 hesitates and retries at each step; run-N flows through without pausing
- feature discovery: run-1 misses a key feature; run-N finds it directly because it learned the pattern
- error recovery: run-1 gets stuck on an unexpected dialog; run-N handles it immediately from a crystallized route
- overall pacing: run-1 takes 40 minutes; run-N takes 15 minutes for comparable coverage

Supporting overlay: a small metrics badge showing runtime, action count, and retry count can appear alongside the replay, but the numbers must reinforce what the audience already sees, not carry the argument alone.

The final impression should be: "It is learning the job, not merely completing it once."

## Must-Show Product Moments

These moments are non-negotiable if we want the demo to feel like Understudy:

1. A real published video page.
2. `/teach start -> /teach stop -> /teach publish`.
3. A clear boundary between scripted and agentic segments.
4. A visible indication that teach can yield either a pipeline skill or a pure agentic worker.
5. Real App Store browsing inside iPhone Mirroring.
6. A clearly labeled child session / experience worker.
7. Genuine exploration of an unfamiliar iPhone app.
8. A publish preview gate before the final post.
9. A visible run-1 versus run-2 improvement story.

If two or more of those are missing, the product story weakens quickly.

## Signature Moments

Beyond the must-show list above, the demo needs two or three designed moments that create a visceral "wow" reaction. These are not features — they are carefully chosen scenes that stick in the audience's memory.

### The Resilience Moment

During the experience worker's exploration, something unexpected happens — a permission prompt, a paywall, a login wall, or an app crash. The audience sees the worker pause, assess the situation, and navigate around it without human intervention.

Why this works: every agent demo shows the happy path. Showing graceful recovery from the unhappy path is what makes the audience trust that this is real.

Setup: pick a candidate app for the demo that is known to trigger at least one interruption. Do not avoid it. Let the audience see the system handle it live.

### The Learning Moment

A split-screen comparison of the same workflow segment from run-1 and run-N, played at 4-8x speed. The audience should see the difference before any numbers appear on screen.

The best version of this moment:

- run-1: the worker taps around uncertainly, retries a gesture, misses a back button, takes a wrong turn
- run-N: the worker moves through the same flow with visible confidence, fewer pauses, no retries

Why this works: the audience does not need to understand crystallization or route learning. They can see the difference. That is the entire point.

### The Reveal Moment

Act 1 shows the published video. Act 2 rewinds to show `/teach start`. The transition between these two acts is the single most important cut in the entire demo.

Design the transition so the audience feels the gap close:

- one frame: a real video playing on a real platform page
- cut to: a terminal with `/teach start` and the beginning of a human demonstration

The audience should feel: "Wait — that polished video was made by *this* process?"

If this cut does not land, the demo loses its narrative spine.

## The Content Product Itself

The generated videos should feel like a repeatable series, not one-off artifacts.

### Format

- vertical short video
- target length: 30-60 seconds
- optimized first for Xiaohongshu and Shorts-style viewing

### Episode structure

Each episode should follow a stable structure:

1. opening hook
2. app identity and setup
3. 2-3 highlights
4. 1 limitation or pain point
5. a scorecard
6. a one-sentence verdict

### Visual language

The content product should have a stable package:

- fixed cover template
- fixed scorecard template
- fixed subtitle style
- fixed transition rhythm
- fixed ending CTA

The quality bar is not "professional creator polish." The quality bar is "good enough to publish repeatedly."

### Creative brief

The generated videos should feel like a concise editorial review, not like AI slop or generic growth-hacking content.

Creative direction:

- tone
  - curious, clear, slightly opinionated, not overly hype-driven
- cover
  - bold app icon or app screen crop plus a short verdict headline
- scorecard
  - clean review-card layout with fixed metrics and a strong overall score
- subtitles
  - large, high-contrast, easy to scan on mobile, with key phrases emphasized
- motion
  - brisk pacing, quick zooms into relevant UI areas, occasional freeze-frame callouts for highlights or pain points
- annotations
  - arrows, circles, or labels should call out what is interesting on screen rather than decorate the frame
- palette and type
  - simple, product-review oriented, more like editorial software coverage than gamer montage or meme video

The bar for "good-looking" in this demo is:

- instantly readable on mobile
- visually consistent across episodes
- clearly more polished than a raw screen recording
- simple enough to generate reliably from templates

### v0 visual bar

Even the simplest screenshot-first video must cross a minimum visual bar. The audience will judge the content product in the first 2 seconds, and if the video looks like raw ffmpeg output, the entire demo loses credibility.

v0 non-negotiables:

- a designed cover frame with app icon, app name, and a one-line verdict in a fixed layout
- a consistent background color or gradient (not black, not white)
- large, high-contrast subtitle text with a fixed font and shadow
- a scorecard frame with a clean grid layout, not a wall of text
- consistent frame transitions (even simple crossfades count)
- a fixed aspect ratio and resolution (1080x1920 for vertical)

v0 explicitly not required:

- motion graphics or animated transitions
- music or sound design
- CapCut or Keynote integration
- multiple template variants

The principle: v0 should look like "a designer made a minimal template" rather than "an engineer concatenated screenshots."

## The Showcase Layer

The showcase should make three system roles visible:

1. Director
   - the orchestrator knows the current phase of the episode
2. Performer
   - the experience worker explores and operates the iPhone app
3. Producer
   - post-production and publishing assemble the final output

To make the system legible, the showcase should keep a lightweight overlay or status panel visible whenever possible:

- current episode id
- current phase
- selected app
- worker status
- screenshots collected
- clips collected
- remaining budget
- whether the run is waiting for approval

Without that layer, the audience only sees a mouse moving around and misses the structure of the system.

The overlay should also make the continuous-studio model visible when possible:

- queue depth or next candidate
- whether the current episode was scheduled, resumed, or promoted from the queue
- whether the worker is using a previously crystallized route or skill

## Assets To Prepare Before Recording

To keep the demo reliable, prepare these assets before the final recording:

1. at least one real published video
2. the key teach moments
3. one full autonomous episode recording
4. run-1 versus run-2 comparison metrics
5. real account page screenshots
6. a publish preview gate screen
7. a worker state or episode state view

Without those assets, the demo becomes too dependent on live luck.

## Demo Versions

The same product story should support two cuts.

### Version A: Short promo cut

- 60-90 seconds
- used for social, homepage, and teaser surfaces
- highlights result, teach, agentic exploration, and improvement quickly

### Version B: Main stage demo

- 5-8 minutes
- used for launches, investor walkthroughs, and technical showcases
- tells the full product story with real screen flow

This document is primarily aimed at Version B. Version A can be cut down from it.

## What Not To Do

To avoid turning the demo into an infrastructure showcase:

- do not open with terminal logs
- do not spend too much time explaining architecture first
- do not frame subagents or scheduling as the main breakthrough
- do not show only internal state and skip the final content output
- do not attempt a fully live end-to-end episode with no prerecorded backup

## Demo Contingency Plan

Live demos with iPhone Mirroring, real app installs, and GUI automation have many failure modes. The demo must be designed to survive them.

### Pre-recorded safety net

Before the final demo recording or live presentation, capture these backup segments:

1. **Full autonomous episode** — one complete end-to-end recording at normal speed, from topic selection to publish preview
2. **Experience worker highlight reel** — 2-3 minutes of the most visually impressive exploration moments, pre-edited
3. **Side-by-side improvement comparison** — the Act 4 split-screen, fully produced
4. **Publish result** — the real platform page with a real published video

For a live demo, the presenter should be able to cut to any pre-recorded segment if the live system stalls.

### Known failure modes and fallbacks

| Failure | Likelihood | Fallback |
|---------|-----------|----------|
| iPhone Mirroring window fails to open or freezes | Medium | Pre-recorded segment; restart iPhone Mirroring with a 10-second recovery script |
| App Store search returns unexpected results | Medium | Use a pre-selected app name with a known App Store position |
| App requires login or payment during install | Medium | Pre-screen apps; maintain a shortlist of confirmed free, no-login apps |
| GUI click lands on wrong target | High | The system's existing refinement loop handles this; if it loops more than 3 times, the experience worker should skip and note the failure |
| screencapture process fails or produces empty output | Low | Retry once; if still failing, continue without recording and rely on screenshots |
| Post-production template rendering fails | Low | Fall back to a static screenshot collage instead of video |

### Rehearsal checklist

Before any demo recording:

- [ ] iPhone Mirroring opens reliably 3 times in a row
- [ ] App Store navigation succeeds with 2 different apps
- [ ] Screenshot capture produces valid files
- [ ] Video composer produces a playable output
- [ ] The full pipeline completes end-to-end at least once without human intervention
- [ ] Pre-recorded backup segments are ready and accessible
- [ ] The presenter knows exactly where to cut to backup if something stalls

## Success Criteria

The product demo is successful when both statements are obviously true:

1. Understudy can produce a real app review video that is worth publishing.
2. The audience can clearly see that the video came from a taught desktop workflow with an agentic exploration core.

## Next Step

This PRD defines the product target. The engineering counterpart lives in [iPhone_App_Review_Demo_Design.md](./iPhone_App_Review_Demo_Design.md), which should be treated as the implementation plan for making this story real.
