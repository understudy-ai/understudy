---
name: video-review-feedback
description: >-
  Stage 4 helper: extract keyframes from the rendered short and prepare a
  model-agnostic feedback packet under `review/`, then produce a first-pass
  visual review from the keyframes whenever the current run can inspect images.
metadata:
  understudy:
    emoji: "🧪"
    requires:
      bins: ["ffmpeg", "ffprobe"]
---

# video-review-feedback

## Goal

Prepare a clean review packet for `post/final-video.mp4` without coupling the
core runtime to one specific evaluation model, and preferably leave behind one
truthful first-pass review result under `review/video-feedback.json`.

This skill packages the optional review lane. It should:

1. extract a small fixed set of keyframes and a contact sheet
2. write a natural-language review request that can be pasted into any capable model
3. write a strict JSON template so later stages know what feedback shape to expect
4. write a tiny operator handoff note under `review/README.md`
5. use the current run's own visual reasoning path to produce a first-pass `review/video-feedback.json` whenever image inspection is available
6. optionally summarize an existing `review/video-feedback.json` if one was already produced elsewhere
7. treat that review as a real gate: if the cut is obviously not ready, do one bounded repair loop when the missing fix is still feasible inside the current run

Operator handoff rule:

- The expected manual path is: upload `post/final-video.mp4` when supported, otherwise upload the contact sheet plus the 8 keyframes to any strong multimodal model, ask it to answer in the template shape, then save that real answer as `review/video-feedback.json`.
- Keep this model-agnostic. Do not hardcode one evaluation provider into the runtime or pretend feedback exists before someone actually produces it.
- If the video is re-edited later, regenerate this whole packet before trusting the old contact sheet or keyframes. The packet should always describe the current MP4 on disk.
- Upload-mode rule:
  - if the external model supports direct video input, prefer uploading `post/final-video.mp4`
  - otherwise upload `review/keyframes/contact-sheet.jpg` plus the 8 individual keyframes
  - if the model supports only still images and limited context, start with the contact sheet, then add the 2-3 frames most relevant to the suspected issue
- Browser-assisted external-review rule:
  - if a strong multimodal model surface is already authenticated or easily reachable in the browser, prefer using it for the real review pass instead of limiting yourself to internal still-frame inspection
  - when that surface supports direct video upload, make it the first-choice review route because pacing, motion, and product dominance are judged more truthfully from the MP4 than from stills alone
  - on the first browser call for that path, explicitly request `browserConnectionMode: "auto"`
  - if the extension relay is already attached to the intended tab, continue with `browserConnectionMode: "extension"`
  - keep the provider/model choice generic and save the real returned JSON as `review/video-feedback.json`
- Revision-loop rule:
  - if the returned JSON says the cut needs revision, the expected next move is Stage 3 -> Stage 4 again
  - if the returned JSON says the real problem is missing evidence, the expected next move is Stage 2 -> Stage 3 -> Stage 4
- Internal-auto-review rule:
  - after extracting the contact sheet and keyframes, prefer using `vision_read` on `review/keyframes/contact-sheet.jpg` plus 2-3 representative frames to produce a first-pass `review/video-feedback.json`
  - keep this review honest and specific; do not fabricate readiness just to fill the file
  - if the current run cannot perform a credible image review, still leave the packet for an external reviewer and report that limitation
- Real-edit gate:
  - if `post/video-edit-note.md` says the video came from a fallback preview renderer, missing-real-export recovery, or any other contingency path the user did not explicitly approve, do not treat that video as publish-ready
  - in that case, the review should explicitly call for one more truthful local re-edit rather than praising the preview render for being merely reviewable
- Auto-repair rule:
  - do not stop at "needs revision" when the remaining problem is obviously fixable in one bounded pass
  - if the review says the issue is mainly editing, pacing, framing, text density, browser contamination, or mixed-language overlay quality, reopen the edit, revise once, regenerate the packet, and review again
  - do not use a fake placeholder export as the bounded repair path when the current requirement is a real local edit; the repair loop should stay on the real edit route
  - if `post/final-video.mp4` is missing or the only available MP4 is a known preview/fallback stand-in, do not synthesize a new fake-final video just to keep the pipeline moving; record the blocked truth and send the run back to a real local export
  - if the review says the issue is missing evidence and one extra safe proof beat is still realistically collectible while the app remains installed, capture that extra beat once, update the Stage 2 handoff, re-edit, then regenerate this packet
  - if the missing fix would require a large re-exploration or risky guessing, stop truthfully instead of pretending the repair happened
  - if the cut is mainly failing because packaging is compensating for thin proof, prefer `revisionMode: "explore"` over another generous edit-only pass

## Inputs

- `artifactsRootDir` or `EPISODE_DIR`
- `post/final-video.mp4`
- `post/video-plan.md`
- `post/video-edit-note.md` if it exists
- `experience/review-brief.md`
- `experience/notes.json`
- `topic/app-store-listing.json`

## Fast Path

This is the default successful Stage 4 flow.

1. Verify `post/final-video.mp4` exists and is the current real edit.
2. Extract one compact review packet:
   - `review/keyframes/manifest.json`
   - 8 keyframes
   - `review/keyframes/contact-sheet.jpg`
   - `review/README.md`
3. Prefer a direct MP4 review in an already-available browser multimodal surface when possible.
4. Otherwise review the contact sheet plus 2-3 representative frames yourself and write `review/video-feedback.json`.
5. Judge the video like a real gate, not a formality:
   - hook speed
   - product dominance in frame
   - iPhone-led proof depth
   - text density and readability
   - browser / desktop contamination
   - whether a human viewer could answer what the app is for, what happened during the main action, and what changed or blocked next
6. If the current MP4 is only a fallback preview render rather than a real local export, do not grade it as a near-final cut. Treat the next move as one more true local re-edit.
7. If the verdict is clearly fixable in one bounded pass, do one repair loop:
   - `revisionMode: "edit"` for framing, pacing, text, packaging, or export quality
   - `revisionMode: "explore"` when the real problem is missing evidence
8. After one bounded repair pass, accept the new verdict and stop looping.

Missing-export rule:

- If there is no real `post/final-video.mp4`, do not fabricate one here.
- Still write the template, README, and feedback request if useful, but the truthful final verdict should stay `blocked` until Stage 3 produces a real export.

Default readiness bar:

- `ready` should be rare
- first useful proof should usually land by about `<= 6s`
- the product should read large, not tiny inside a decorative shell
- the cut should feel iPhone-native and human-tested, not browser-led or packaging-led
- the export should stay true `9:16`; if the MP4 drifts into an original-ratio or oversized odd aspect, treat that as `needs_revision` even when the story itself is promising

## Step 1: Resolve the root and verify the source video

Resolve `ROOT_DIR` the same way as the other app-review stages.

Create:

```bash
ROOT_DIR="<resolved root dir>"
mkdir -p "$ROOT_DIR/review/keyframes"
test -f "$ROOT_DIR/post/final-video.mp4"
```

Read:

- `post/video-plan.md`
- `post/video-edit-note.md` if it exists
- `experience/review-brief.md`
- `experience/notes.json`
- `topic/app-store-listing.json`

The point is to give the external reviewer enough context to judge whether the
video is honest, readable, and compelling.

Technical gate:

- If `ffprobe` or the helper warns that the export is not vertically `9:16`, call that out directly in `review/video-feedback.json`.
- A mismatched aspect ratio is an edit/export problem, not a publishable quirk.

## Step 2: Extract the review frames

Prefer the workspace helper:

```bash
python3 skills/video-review-feedback/scripts/extract_review_frames.py "$ROOT_DIR"
```

Expected outputs:

- `review/keyframes/manifest.json`
- `review/keyframes/01-*` through `review/keyframes/08-*`
- `review/keyframes/contact-sheet.jpg`
- `review/README.md`

Do not extract dozens of frames. The packet should stay compact and easy to
upload to any external model.

After frame extraction, prefer the workspace helper:

```bash
python3 skills/video-review-feedback/scripts/build_feedback_packet.py "$ROOT_DIR"
```

Use ad hoc manual writing only if that helper is missing or broken.

## Step 3: Produce the first-pass visual review

Preferred default path:

1. if an authenticated browser-accessible multimodal reviewer is already available and can take the MP4 directly, prefer that path first and save its real JSON answer as `review/video-feedback.json`
2. otherwise read `review/keyframes/contact-sheet.jpg`
3. read 2-3 representative frames such as:
   - the opening / hook frame
   - the first real in-app proof frame
   - the closing verdict frame or last real proof frame
4. compare those visuals against:
   - `post/video-plan.md`
   - `experience/review-brief.md`
   - `experience/notes.json`
   - `post/video-edit-note.md` when it exists
5. write `review/video-feedback.json` in the template shape when the current run can make a credible judgment

External-review preference rule:

- Prefer direct MP4 review over still-frame-only review whenever that path is already reachable in one bounded browser attempt.
- Use the still-frame/internal-vision path as the truthful fallback when no ready external reviewer is available, when login would consume the whole stage, or when direct upload is clearly unsupported.

What the first-pass review should catch:

- weak or slow hook in the first 2-3 seconds
- cuts that still feel browser-led or packaging-led instead of iPhone-led
- shallow review depth that looks more like launch-screen tourism than real use
- repetitive frames or proof beats that do not visibly advance
- repeated use of the same proof frame for core task, outcome, and verdict packaging without enough visible progression
- text that is too long, too tiny, or visually crowded
- broken Chinese / CJK rendering or awkward mixed-language copy
- verdict packaging that overwhelms the actual product proof
- motion that is missing, underused, or arrives too late
- narration that sounds unnatural or overclaims the evidence
- technical export issues such as audio/video duration mismatch, frozen tail sections, or a suspiciously static end card
- product framing that leaves the iPhone tiny inside a large matte or decorative layout
- cuts where the first real product proof arrives too late or never becomes visually dominant
- text density or browser / desktop contamination that makes the short feel like packaging rather than testing
- cuts where the opening plus store/setup packaging consume the first 4-5 seconds while the strongest proof still has not landed
- cuts that still spend a full dedicated App Store/context beat on setup even though the in-app proof already carries the story cleanly
- cuts where the product stays visually too small and the decorative shell or caption system gets more attention than the tested app itself
- cuts where one weak proof frame is being stretched into multiple beats by changing only the caption instead of the product evidence
- cuts where a viewer still cannot answer the human-review questions `what is this app for`, `what happened when the main action was attempted`, and `what stuck or limited the experience afterward`
- cuts that would stop making sense if the context/setup beat disappeared, which usually means the iPhone proof is still too thin

Ready-baseline rule:

- `publishReadiness: "ready"` should be rare and should only be used when the cut is already strong enough for a real viewer, not just "good enough for a demo".
- A ready cut should usually satisfy all of these:
  - the product is visible immediately or nearly immediately
  - `firstUsefulProofBySec` is roughly `<= 6`
  - `browserOrDesktopIntrusion` is not `major`
  - `textDensity` is not `crowded`
  - `cjkRenderingOk` is `true`
  - `productFrameDominance` is not `weak`
  - `packagingOverhang` is not `major`
  - the product proof still dominates over verdict packaging
  - any App Store/context beat is truly necessary and stays brief rather than becoming its own long setup slide
  - the evidence honesty, review depth, iPhone authenticity, visual legibility, product framing, proof-vs-packaging balance, and pacing scores all feel solid rather than charitable
  - the app is framed large enough that the viewer is mainly reading product proof, not a template shell around the phone
- If those conditions are not met, prefer `needs_revision` or `blocked` instead of overstating readiness.
- A fallback preview render that stands in for a failed real local edit should never be marked `ready` unless the user explicitly asked for a preview-only fallback.

Honesty rule for `review/video-feedback.json`:

- default expectation: write this file in the current run using the extracted keyframes unless image inspection is genuinely unavailable
- if the cut is not ready, say so directly
- if the real problem is missing exploration evidence rather than editing polish, set `needsDeeperExploration=true`
- prefer concrete fixes like `replace frame 04`, `shorten the title beat`, `crop the iPhone area larger`, or `rewrite the verdict line`
- do not fill every score optimistically; low scores are acceptable when the video truly needs work

Revision classification rule:

- Also classify the next move directly inside the JSON:
  - `revisionMode: "none"` when the cut is ready
  - `revisionMode: "edit"` when one more edit pass should be enough
  - `revisionMode: "explore"` when the cut mainly lacks product proof and needs more Stage 2 evidence
- Prefer `revisionMode: "edit"` for problems like slow hook, tiny product framing, repetitive frames, crowded text, weak pacing, browser-heavy visuals, awkward voiceover, or broken CJK rendering.
- Prefer `revisionMode: "edit"` for preview-render substitutions that need a true local re-edit.
- Prefer `revisionMode: "explore"` when the real problem is missing proof, not just weak packaging.
- If the cut is honest but still feels shallow because it lacks a changed-state, revisit, motion, or persistence beat, prefer `revisionMode: "explore"` even when the edit itself could still be polished further.
- If the cut looks polished but still fails the human-review-depth test because the viewer never gets a coherent start -> proof -> result/limit ladder, prefer `revisionMode: "explore"` over another purely aesthetic pass.
- If the cut needs a long context/store/setup bridge just to become understandable, prefer `revisionMode: "explore"` rather than another packaging-heavy edit pass.
- If the cut mainly recycles the same frame for proof, outcome, and verdict because there is not enough distinct evidence, prefer `revisionMode: "explore"` unless one tighter edit pass can honestly collapse those beats instead of pretending they are different.

## Step 3.5: Repair once when the video is clearly fixable

If the first-pass review says the cut is not ready:

1. Read `review/video-feedback.json`.
2. If `revisionMode` is `edit` and the fixes are concrete, perform one bounded repair loop:
   - rerun the local edit pipeline
   - apply the highest-value fixes only
   - re-export `post/final-video.mp4`
   - rerun frame extraction and packet generation
   - overwrite `review/video-feedback.json` with the second-pass judgment
3. If `revisionMode` is `explore` and the missing proof is still small and safe, do one bounded evidence refresh:
   - reopen the installed app
   - capture at most one extra screenshot or short clip that closes the evidence gap
   - update the Stage 2 handoff files truthfully
   - rerun the edit and this review packet once
4. If the repair would require a large restart, unsafe guessing, or more than one bounded pass, stop with the honest not-ready verdict instead of looping forever.
5. After one bounded repair pass, accept the new verdict even if it still says `needs_revision`. Do not enter an unbounded polish loop inside this stage.

## Step 4: Write the model-agnostic review request

Write `review/feedback-request.md`.

This file should be natural language, not raw JSON. It should be something a
human can paste into any strong multimodal model together with:

- `post/final-video.mp4` when the model supports video input
- otherwise `review/keyframes/contact-sheet.jpg`
- plus the 8 extracted keyframes when the model benefits from separate images

Recommended structure:

- `# Goal`
- `# Context`
- `# Assets To Review`
- `# What To Judge`
- `# Required Output Format`

The request should ask the reviewer to evaluate:

- hook strength in the first 2-3 seconds
- whether the video truthfully reflects what Stage 1 and Stage 2 actually proved
- whether the cut feels like a real iPhone test or too much static packaging / setup
- whether the review depth feels human-used rather than launch-screen-deep
- whether screenshots are visually distinct enough
- whether the copy is concise, mobile-readable, and free of broken Chinese / CJK rendering
- whether pacing and hold times feel deliberate instead of static
- whether the narration sounds natural and aligned with the visuals
- whether the ending verdict is clear and useful
- the top 3 issues to fix before publishing widely
- whether the first useful proof arrives early enough, or whether the opening is spending too much time on setup
- whether the video is strong enough to publish as-is, or whether Stage 2 needs deeper exploration before another edit pass

The request should explicitly say:

- do not praise the video for things it did not prove
- prefer concrete edit advice over vague feedback
- call out misleading claims, unreadable text, repetitive frames, awkward voiceover, or broken typography
- call out when the edit underuses available product motion or spends too much time on title / promise / verdict packaging
- return the answer in the JSON template shape first, then optional short prose after it if the chosen model cannot stay JSON-only
- identify issues by specific frame number or slide role whenever possible, so Stage 3 can revise deterministically instead of guessing
- prefer edit instructions like "shorten title card to 3.0s" or "replace the closing verdict frame" over broad advice like "make it snappier"
- when the problem is really missing evidence rather than editing, say that directly instead of suggesting cosmetic fixes only
- set `needsDeeperExploration=true` when more Stage 2 product proof is required before another edit pass

## Step 5: Write the JSON template

Write `review/video-feedback.template.json` with a strict shape such as:

```json
{
  "summary": "string",
  "sourceRoute": "local_compositor | fallback_preview | unknown",
  "publishReadiness": "ready | needs_revision | blocked",
  "needsDeeperExploration": false,
  "revisionMode": "none | edit | explore",
  "readyAfterOneMoreEditPass": false,
  "timing": {
    "productVisibleBySec": 0,
    "firstUsefulProofBySec": 0
  },
  "visualRisks": {
    "browserOrDesktopIntrusion": "none | minor | major",
    "textDensity": "clean | borderline | crowded",
    "cjkRenderingOk": true,
    "productFrameDominance": "strong | mixed | weak",
    "packagingOverhang": "none | minor | major"
  },
  "scores": {
    "hook": 0,
    "clarity": 0,
    "evidenceHonesty": 0,
    "reviewDepth": 0,
    "humanReviewDepth": 0,
    "motionVariety": 0,
    "iphoneAuthenticity": 0,
    "visualLegibility": 0,
    "productFraming": 0,
    "proofVsPackagingBalance": 0,
    "pacing": 0,
    "voiceover": 0
  },
  "topIssues": [
    {
      "issue": "string",
      "whyItMatters": "string",
      "suggestedFix": "string"
    }
  ],
  "frameSpecificNotes": [
    {
      "frame": "01",
      "note": "string"
    }
  ],
  "onePassFixPlan": [
    "string"
  ],
  "metadataAdvice": {
    "titleAdjustment": "string",
    "descriptionAdjustment": "string"
  }
}
```

This is the strict shape for both the automatic first-pass review and any later
external reviewer. If you cannot produce a credible automatic review in this
run, leave `review/video-feedback.json` absent and use only the template.

## Step 6: Optional summary when feedback already exists

If `review/video-feedback.json` already exists, read it and write
`review/video-feedback-summary.md` with:

- the overall verdict
- the highest-priority fixes
- any title/description advice that should influence publication

Keep the summary short and concrete.

## Stop Checklist

```bash
ROOT_DIR="<resolved root dir>"
test -f "$ROOT_DIR/review/keyframes/manifest.json"
test -f "$ROOT_DIR/review/keyframes/contact-sheet.jpg"
test -f "$ROOT_DIR/review/README.md"
test -f "$ROOT_DIR/review/feedback-request.md"
test -f "$ROOT_DIR/review/video-feedback.template.json"
```

Prefer also leaving `review/video-feedback.json`.

Print where the keyframes were written, whether `review/video-feedback.json`
was generated automatically in this run, and whether an external/manual review
is still needed.
