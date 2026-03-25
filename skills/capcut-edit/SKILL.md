---
name: capcut-edit
description: >-
  Stage 5: Compose a vertical tutorial-style review video from the iPhone
  install context, exploration notes, and captured proof. Default to
  assembling the final cut in local CapCut with iPhone-led visuals, using
  helper scripts for planning, local voiceover, and subtitle prep.
metadata:
  understudy:
    emoji: "🎬"
    requires:
      bins: ["ffmpeg"]
---

# capcut-edit

## Rules

1. Use the active run root: prefer `artifactsRootDir`, otherwise `EPISODE_DIR`.
2. Read Stage 1 and Stage 4 artifacts from disk before generating anything.
3. The output should feel like a real edited walkthrough for English-speaking viewers, not like a code-generated placeholder or a packaging-heavy fallback.
4. Default to local `CapCut.app` for the main edit. If a local CapCut app is installed, treat it as the primary route and confirm it can open before considering any fallback. Only if local CapCut is unavailable or clearly unusable should you prefer CapCut web through the browser tool with `browserConnectionMode: "auto"` first and `browserConnectionMode: "extension"` after the relay is attached.
5. Do not use the deterministic ffmpeg compositor as the main demo path unless the user explicitly asks for a fallback preview render. Helper scripts may still assist with planning or voiceover.
6. Legacy shell helpers such as `render_review_cards.py` or `build_review_video.py` are preview-only contingency tools. In the current real-edit lane, do not use them as a substitute for a blocked CapCut run. If local and web CapCut both fail, the truthful outcome is a blocked Stage 5, not a quietly downgraded fake-final video.
7. Do not update `manifest.json` to `edited` until `ffprobe` confirms the MP4 is structurally valid.
8. Use a CJK-capable font or CapCut text style fallback when mixed-language app names must appear. Do not accept tofu / square boxes for Chinese or mixed-language app names.
9. Prefer short, high-contrast, mobile-readable text. Rewrite the message into punchy lines instead of shrinking long paragraphs into unreadable blocks.
10. The final visual source should be iPhone-led. Browser App Store screenshots are planning artifacts, not default final-video assets.
11. If `say` is available, generate a local voiceover from the exploration notes and also generate a subtitle file from the same narration. Prefer the workspace helpers so voice choice, mixed-language sanitization, subtitle timing, and TTS pacing stay consistent. If local TTS is unavailable or fails, continue with subtitle prep and report the missing voiceover honestly.
12. The video should feel like a deliberate tutorial-style review, not a screenshot dump. Every beat must advance the story.
13. The final copy should read like a viewer-facing review, not like operator notes about a pipeline run.
14. Keep the story generic to the selected app. Do not hardcode AI-app assumptions into fallback text for a planner, utility, game, or creator tool.
15. Before Stage 5 finishes, run one internal visual QA pass against the exported video. If the cut still feels browser-led, text-led, visually cheap, too static, too card-like, or shallower than the proved iPhone usage, revise it before you call the stage done.
16. Do not stretch thin evidence into a fake-polished short. If Stage 4 only left a launch tour, one remote loading state, or one static wall with no changed-state / revisit proof, the correct next move is deeper exploration, not prettier packaging.
17. Do not read helper script source just to learn how to use it. Run the helper directly when the skill already defines the contract, and only inspect source if the helper fails.
18. Prove the CapCut route early. After the planning and voiceover assets exist, open CapCut before generating any fallback visual assets. Do not quietly drift into shell rendering because it feels faster.
19. Product proof must dominate the frame. On proof beats, the app UI should usually occupy most of the visible canvas after CapCut crop/zoom. A tiny iPhone floating in a large dark card is not acceptable.
20. Use the short Latin alias as the default headline identity. If the localized full app name is CJK-heavy or visually awkward, let the product UI carry that truth and keep the overlay English-first instead of forcing brittle mixed-language text.
21. Unless the user explicitly asked for a preview-only fallback, a blocked CapCut path should fail the stage truthfully rather than silently substituting a shell-composited final video.
22. The standard macOS Open panel is part of the local CapCut route, not a blocker by itself. If clicking `Import` opens the system file picker, continue the local edit there instead of stopping.
23. Prefer importing one tiny prepared folder over browsing the whole run tree inside CapCut. The local edit should feel like using a clean asset bin, not like hunting through artifacts.
24. If local CapCut is open and usable, explicitly drive the import panel, timeline build, and export flow to completion. Do not stop after proving CapCut merely launched.
25. Treat narration budget as a real gate before editing: prefer roughly `12-18` lines, about `220-420` spoken words, and roughly `150-210s` of voiceover. If the generated narration or `voiceover-meta.json` falls far outside that lane, rewrite it before opening CapCut.
26. Prefer a fresh blank project for the current run. Do not reuse an unrelated recent CapCut draft just because it is already open; stale assets and stale timelines are more dangerous than spending one extra step to create a clean project.
27. Before local import, prepare one short-path source folder for this run under `/tmp` or another equally short deterministic path, and use that tiny folder as the only import source. Do not browse deep artifact trees once the short path exists.
28. Treat CapCut home / draft gallery as a distinct state with localized cues. A big `Start creating` / `开始创作` hero, left nav such as `Home` / `首页` or `Templates` / `模板`, and recent draft cards near the bottom means you are still on the home surface, not in a real editor.
29. If CapCut home shows a clearly current draft card whose visible title matches the current app alias, `projectName`, or `runSlug` from `post/capcut-import-manifest.json`, open that draft once before creating another project. If no clear current draft exists, create a fresh project immediately instead of hovering on the gallery.
30. A visible `录屏` / screen-record starter tile is still part of the home surface. Do not mistake that starter tile for evidence that the current edit is already open.
31. Before each major Stage 5 action, make sure CapCut is frontmost again. If Finder or iPhone Mirroring stole focus, reactivate CapCut, re-observe the scene, and continue from the real current state instead of reasoning from stale memory.
28. Stage 5 is not complete when only `post/video-plan.md` and `post/assets/narration.txt` exist. In the real-edit lane, the stage must end with a real CapCut export plus `post/capcut-edit-note.md`, or fail truthfully.
28. If the macOS Open panel or Finder is showing a folder that contains previous-run outputs such as `final-video.mp4`, `capcut-project`, `manifest.json`, `publish`, `topic`, or any other parent-level run tree, treat that as the wrong location immediately. Redirect back to the prepared short import folder before importing anything.
29. Prefer importing the actual asset files, not the enclosing directory itself. A folder tile like `assets` or `capcut-import` inside the media bin is a warning that you imported a directory object instead of the intended screenshots / clips / audio.
30. Treat an inherited unknown CapCut draft as unsafe state. If CapCut is already open inside an old editor with stale media, stale timeline items, or unclear project identity before the current run really starts editing, quit it once and relaunch cleanly instead of trying to rescue mystery state.
31. Do not generate `title-card`, `scorecard`, `verdict`, or other preview-card PNGs before the real CapCut route has either imported the actual assets or been proven blocked. Pre-rendered cards are repair/fallback tools, not the default path.
32. When `SHORT_IMPORT_DIR` exists, the default local import route is Finder list view -> `cmd+a` -> drag the selected files into the visible CapCut media bin. Do not choose the Open panel first unless Finder drag is clearly unavailable.
33. If one local import route returns you to an empty media bin, switch routes immediately instead of spending another long loop inside the same file-picker flow.
34. A real-edit run is not allowed to stop after “CapCut opened” or “the Open panel appeared.” The minimum honest success bar is: media imported, timeline assembled, export completed, and `ffprobe` verified.
35. Treat tiny-phone card aesthetics as a real failure, not a style preference. The default visual language for this demo is product-first, close-cropped, and proof-led.
36. The iPhone App Store detail frame is context-only, not a default hero asset. Use it only when the context materially improves honesty or comprehension, keep it extremely brief, and never let it displace a stronger in-app beat.
37. The strongest default edit is: hook from the real first screen, one clearly useful in-app proof, one task/result/friction beat, one revisit/limit/trust beat, then the verdict on top of the strongest proof frame.
38. If Stage 4 already proved the app well enough, skip the listing/context beat entirely and spend that time on deeper in-app proof.
39. Avoid a fixed matte or color shell that repeats across runs. Pick a simple visual language that supports the current app proof, and vary it when a generic template would become more memorable than the app itself.
40. On thin runs, context should merge into the opening or verdict rather than becoming a full extra slide.
41. The product should still feel human-tested. Prefer proof that shows something you actually opened, changed, saved, revisited, or got blocked by on the iPhone over abstract marketing copy.
42. The final video should be overwhelmingly iPhone-native. Apart from a rare half-beat from the iPhone App Store detail screen when it truly helps, avoid browser-page visuals and avoid any decorative card system that makes the app feel smaller than the review packaging.
43. If the proof set is too thin to support a strong real CapCut cut, escalate back to deeper exploration instead of compensating with extra scorecards, paragraphs, or verdict cards.
44. Keep the audio path bounded. If `voiceover.aiff` was imported with the rest of the media, do not switch to the Audio tab or reopen import just to “manage audio better”. Use the already-imported media item directly from the main media bin whenever possible.
45. Voiceover is helpful but not worth a loop. The allowed local-audio policy is: one clean import of all assets, one direct attempt to place the voiceover on the audio track if it is present, one bounded re-import of only the audio file if it is missing, then finish silently and record that limitation honestly instead of bouncing between `素材`, `音频`, and repeated import dialogs.
46. Do not let voiceover or caption polish dominate the run. But in this demo lane the happy path should still leave both spoken narration and readable subtitles, not just silent proof cards.
47. English-first viewer rule: default the overlays and narration to concise English even when the App Store region is localized. Let the product UI carry the localized truth; do not force awkward mixed-language marketing copy into the captions.
48. Proof-first framing rule: on at least the core proof and outcome beats, the app UI should usually occupy about `70-85%` of the visible vertical frame after crop or zoom. If the phone still reads as a small card inside a template shell, revise the framing before exporting.
49. Human-review depth rule for editing: the finished cut should usually answer four viewer questions with visible evidence, not narration alone: what is this app for, what happens when I try the main thing, what changes or blocks next, and who should still care after that result.

## Inputs

- `artifactsRootDir` or `EPISODE_DIR`
- `topic/app-store-listing.json`
- `topic/selection-notes.md`
- `experience/notes.json`
- `experience/story-beats.md` if it exists
- `review/video-feedback.json` if it already exists from an earlier critique pass
- `topic/screenshots/*.png`
- `experience/screenshots/*.png`
- `experience/clips/*.mov`

## Fast Path

This is the default successful Stage 5 flow.

1. Read Stage 1 and Stage 4 artifacts first. The cut should be driven by real iPhone proof, not by browser pages or generic cards.
2. Write `post/video-plan.md`, `post/capcut-shot-list.md`, `post/capcut-import-manifest.json`, `post/assets/narration.txt`, and the voiceover / subtitle prep artifacts.
3. Keep the story English-first, concise, and proof-first:
   - about `150-210s`
   - about `12-18` narration lines
   - real proof should arrive early instead of hiding behind a long intro
   - browser/store context is optional and usually brief
4. Preferred beat ladder:
   - opening hook on the first real iPhone frame
   - how to start
   - first useful proof
   - core task setup
   - core task execution
   - outcome or friction
   - optional secondary proof
   - hidden detail or best practice
   - limit / audience fit
   - verdict as an overlay on the strongest proof frame
5. Open local `CapCut.app` early. The real success bar is:
   - media imported
   - timeline assembled
   - export completed
   - `ffprobe` passes on `post/final-video.mp4`
6. Build and import only a short prepared folder, not the whole run tree.
7. Keep the product large in frame on proof beats. The app UI should usually occupy roughly `70-85%` of the visible frame after crop/zoom.
8. Write `post/capcut-edit-note.md` after export, then update `manifest.json`.

Default visual rules:

- use iPhone captures as the main story
- use browser screenshots only when one tiny context beat is truly necessary
- avoid scorecard-heavy or verdict-card-heavy packaging
- if the proof is thin, go back to Stage 4 instead of compensating with more text
- if CapCut cannot complete a real export, fail truthfully instead of quietly shipping a shell-composited fake final

## Step 1: Resolve the root and read the source material

Resolve `ROOT_DIR`.

If a later inline Python block reads `ROOT_DIR` from `os.environ`, explicitly
run `export ROOT_DIR` first. Do not assume a shell variable is automatically
visible to Python subprocesses.

Read these inputs:

- `topic/app-store-listing.json`
- `topic/selection-notes.md`
- `experience/notes.json`
- `experience/story-beats.md` if it exists
- `experience/review-brief.md` if it exists

Use Stage 1 for:

- app name
- subtitle / App Store description
- App Store positioning context
- `topic/screenshots/02-iPhone-App-Store-Detail.png`
- `topic/screenshots/03-Home-Screen-With-App.png`

Localization rule:

- If `topic/app-store-listing.json` includes `copyLocalization`, prefer that localized copy package for viewer-facing English headlines, support lines, and narration scaffolding.
- Keep the regional listing fields as source truth for what was actually installed, but do not let a localized Chinese subtitle or description force awkward mixed-language copy into the final video.

Store-copy hygiene rule:

- If `topic/app-store-listing.json` contains an obviously bad `subtitle` that reads like App Store shell chrome rather than a real product positioning line, ignore that subtitle for the video and derive a cleaner short positioning line from the verified description, visible detail screenshot, or selection notes instead.

Use Stage 4 for:

- highlights
- pain points
- scorecard
- opening hook
- tension line
- payoff line
- verdict
- video plan / narration lines when present

Visual-source rule:

- Use Stage 1 browser screenshots `00-Browser-Today-Recommendation.png` and `01-Browser-App-Detail.png` as planning-only research artifacts.
- Do **not** let those browser-page captures appear in the main final video unless the iPhone App Store screenshot is missing or unusable.
- The main video should be built from iPhone-captured material: iPhone App Store detail, home screen, in-app exploration screenshots, and any Stage 4 live iPhone clips.
- If `experience/clips/01-Core-Loop.mov` or another Stage 4 clip exists, treat that motion proof as more valuable than inventing extra text panels.

If `experience/story-beats.md` exists, treat it as the strongest natural-language truth guard for:

- what the main review claim really is
- which screenshots map to which proof beats
- which tempting claims the video should avoid
- which frame should open the short, which frame carries the climax, and which mood should close it

If `review/video-feedback.json` already exists from an earlier review pass, use it as a revision input, not as a fiction source:

- fix concrete issues such as copy that is too long, repetitive frames, unreadable chips, broken CJK rendering, awkward verdict phrasing, or pacing that obviously drags
- do **not** invent new product depth that Stage 4 never proved just because an earlier reviewer asked for a more exciting video
- if a requested fix would require deeper exploration or new evidence, keep the video honest and mention the unresolved gap instead of fabricating coverage

Also check whether these optional screenshots exist and use them when helpful:

- `experience/screenshots/04-Outcome-Or-Friction.png`
- `experience/screenshots/05-Secondary-Feature.png`
- `experience/screenshots/06-Pricing-Or-Limit.png`

If Stage 4 produced `videoPlan`, treat it as the source of truth for the story
angle and narration ordering.

Video spec contract for this stage:

- vertical short, `1080x1920`
- normal playback frame rate, preferably `30 fps`
- final container: H.264 MP4 with AAC audio when voiceover exists
- ideal runtime `150-210s`, acceptable `120-240s`
- default to `8-14` beats when the evidence is solid, with a chapter-like flow instead of one compressed burst
- default beat order: opening overlay on the first real iPhone frame, first impression, core task, outcome, optional secondary proof, closing verdict overlay; if a promise/context line is still needed, fuse it into the opening or a sub-2s half-beat instead of giving it a full slide by default
- do **not** assume separate `title`, `scorecard`, and `verdict` cards are all needed; most runs should not spend three separate beats on packaging
- `12-18` narration lines, roughly `220-420` spoken words total
- voiceover should sound like one guided walkthrough or deep-dive, not a checklist being read aloud
- every beat must still make sense with audio muted
- keep on-screen copy mobile-readable at arm's length: one headline, one short support line, and no dense paragraph blocks
- the opening should communicate the hook quickly from a real iPhone-led frame; do not waste it on labels or generic setup copy
- most of the runtime should belong to proof, not packaging: first impression, core task, outcome, and secondary proof should together own more time than any setup or verdict overlays
- when Stage 4 gave you a strong fifth screenshot, use it; a convincing walkthrough usually beats a shorter but thinner cut
- store/listing context should usually be brief; when it genuinely helps, keep it concise and do not let it delay the first real in-app proof
- proof beats should visually feel screenshot-led or clip-led: the product should dominate, and the text should clarify rather than replace the proof
- when Stage 4 gave you a usable clip, at least one core proof beat should feel motion-led rather than static-card-led
- a clip-backed or clearly useful proof beat should normally arrive by about `3-6s`, not after the whole setup is already over
- on proof beats, crop or zoom until the app UI usually occupies at least about 70% of the visible vertical frame
- the default edit should feel like close product proof with light captions, not a navy presentation card with a small centered phone

Beat-by-beat content contract:

- `opening overlay` -> hook plus app identity on top of the first real iPhone frame; no dead title wall and no paragraph block
- optional `promise/context` -> what the listing promised or what the viewer needs to know in one concise sentence, only when that context genuinely strengthens the story
- `first impression` -> what the first useful screen proved about speed, friction, or clarity
- `core task` -> the one action sequence the run genuinely reached
- `outcome` -> the strongest payoff or the clearest limitation
- optional `secondary proof` -> persistence, settings, history, citations, pricing, revisit, or another distinct depth beat
- `verdict overlay` -> who it is for, who should avoid it, and why the take landed there, preferably riding on the strongest outcome/proof frame
- only use a dedicated score or summary beat when the evidence is already deep enough that the summary clarifies the proof instead of replacing it
- if the outcome frame already carries the honest takeaway, place the verdict there and skip any separate scorecard or verdict card
- every beat should answer one viewer question only. If a beat is trying to explain promise, task, friction, and verdict at once, split or rewrite it shorter.
- every proof beat should visually answer "what changed?" If the screenshot and the caption do not together show a change, pick a better frame or rewrite the beat.
- default copy budget per beat:
  - headline: roughly 3-6 words
  - support line: roughly 6-14 words
  - anything longer should be rewritten, not shrunk

Narration-to-beat contract:

- Default to roughly one narration line per beat.
- If one beat carries no spoken line, it still needs a visually obvious reason to exist.
- Do not let the narration describe a deeper flow than the matching beat actually shows.

Write `post/video-plan.md` before rendering cards. This should be the natural-language production brief for the final video and should include:

- video spec and target runtime
- target runtime
- language choice for on-screen copy and narration
- story angle
- slide order
- one-line purpose for each slide
- screenshot-to-slide mapping when multiple in-app screenshots exist
- headline and support-copy draft for each slide
- narration lines in order
- voiceover notes such as target tone, target pace, and whether the final narration should stay English-only
- the expected closing verdict
- claims the video is allowed to make confidently
- claims the video should avoid implying

Recommended `post/video-plan.md` structure:

- `# Video Spec`
- `# Runtime`
- `# Language`
- `# Story Angle`
- `# Slide Order`
- `# Slide Drafts`
- `# Narration`
- `# Voiceover`
- `# Closing Verdict`
- `# Claims To Make`
- `# Claims To Avoid`
- `# Revision Notes` when `review/video-feedback.json` already exists and you are applying fixes

Preferred planning helper:

- Before drafting by hand, prefer running `python3 skills/capcut-edit/scripts/build_video_plan.py "$ROOT_DIR"` to generate a deterministic natural-language baseline for both `post/video-plan.md` and `post/assets/narration.txt`.
- That helper should also leave `post/capcut-shot-list.md` and `post/capcut-import-manifest.json` so the CapCut pass is driven by a concrete beat order rather than ad hoc file hunting.
- Then inspect the generated plan and only make bounded edits when the helper missed a clearer story angle or a better screenshot mapping.
- Keep the helper output natural-language. Do not replace it with raw JSON or a terse internal checklist.

Language-plan contract for `# Language`:

- explicitly name `on-screen copy language`
- explicitly name `narration language`
- name the short app alias that narration should speak
- if localized full app text appears on-screen, explain where and why it is still readable
- if you are choosing English-first copy to avoid broken CJK rendering, say that directly

Contingency card-renderer rule:

- `skills/capcut-edit/scripts/render_review_cards.py "$ROOT_DIR"` is a fallback helper for preview assets only.
- Do **not** use that helper as the default Stage 5 route or as a quiet shortcut when the local CapCut route is still available.
- Only reach for rendered cards when you already proved local and web CapCut are unavailable or the user explicitly asked for a preview-only fallback.
- If two candidate screenshots for different beats are visually near-duplicates, adjust the chosen screenshot set before building the final video. The short should show progression, not the same phone screen twice with different captions.
- Preserve semantic mapping when you adjust screenshots. Do not fix duplication by quietly turning the `core task` beat into a settings or model-picker beat unless the run truly never reached a better task moment.

## Step 2: Lock the visual direction before rendering

Use one deliberate visual system across all rendered cards:

- dark navy / ink base, not pure black
- one warm accent color and one cool secondary accent
- large safe margins for mobile
- high-contrast text only
- rounded screenshot frames with subtle depth instead of full-bleed raw captures

Language strategy:

- Default to concise English review copy for the main headlines and narration, even when the App Store page is localized in Chinese.
- Keep the localized full app name only as a supporting line when it adds context and fits cleanly.
- Do not dump long raw localized App Store copy onto the card. Translate or paraphrase it into short review language.
- If the final narration would be mixed-language and awkward for local TTS, prefer an all-English narration rather than garbled bilingual speech.
- If the selected app has no clean English alias, keep the headline generic and place the localized full name on a smaller support line rather than forcing broken transliteration.
- If a card draft would become a CJK-heavy paragraph or a chip that is visually cramped, rewrite the message into a shorter English paraphrase instead of shrinking the font.
- If the selected app has mixed-language branding, keep the spoken alias short and stable across every slide. Do not alternate between the localized full name, partial transliteration, and the English alias.

Typography and text rules:

- Preferred font search order:
  - `/System/Library/Fonts/Hiragino Sans GB.ttc`
  - `/System/Library/Fonts/STHeiti Medium.ttc`
  - `/System/Library/Fonts/Supplemental/Arial Unicode.ttf`
  - `/System/Library/Fonts/HelveticaNeue.ttc`
- Use the first existing font path that can render both English and CJK text.
- If the full app name is long or localized, derive a short hero alias from the brand token before `:`, `：`, `-`, `(`, or `|`. Example: use `CapCut` as the hero title and place the localized full name on a smaller supporting line.
- If the localized display name has no clean Latin token, derive the spoken / hero alias from the App Store URL slug instead of forcing unreadable CJK-heavy title bars or broken TTS.
- Never put near-white text on a white panel. On light panels, use near-black text such as `#121826`.
- Keep hero titles to at most 2 lines, body copy to at most 3 short lines, and label rows to single-line scanability.
- Keep headlines to roughly 3-6 words and support lines to roughly 8-16 words.
- Support copy must read like a complete thought, not a clipped sentence fragment. If a line ends on words like `whether`, `because`, `with`, or `the`, rewrite it shorter before rendering.
- Treat bottom chips, footer bands, and short badges as ultra-short text surfaces. Keep them to roughly 2-5 words whenever possible.
- If a sentence does not fit cleanly, rewrite it shorter. Do not simply shrink the font until it becomes unreadable.
- Do not leave decorative empty panels or placeholder boxes in the final cards. Every large panel must either contain clearly readable content or be removed.
- Do not use ellipsis as the default overflow solution on the main cards. Rewrite the sentence shorter first.
- If any rendered card still shows tofu / square boxes or awkward mixed-language wrapping, rewrite the affected line into cleaner English and re-render before finalizing.

Approved layout rule:

- Use only simple, readable compositions:
  - hero layout -> large title, one strong hook band, one supporting proof area
  - screenshot-led layout -> one dominant framed screenshot plus short takeaway text
  - scorecard layout -> score first, rows second, one compact takeaway
  - verdict layout -> short headline, what happened, best-for / avoid-if guidance
- Avoid tiny sidebars or small inset text boxes that force awkward wrapping. If a hook does not fit in one compact box, promote it to a wider band or a dedicated text block.
- Do not add decorative icon tiles, empty floating pills, or tiny lower-corner hook boxes that carry less information than a real screenshot or a readable sentence.
- At least 4 of the 7 slides should be screenshot-led rather than text-led.
- When the source screenshot is narrow or portrait-heavy, use a layout that still lets the screenshot feel large and intentional. A tiny phone floating inside a huge dark box is not good enough.

## Step 3: Lock the CapCut shot list and visual plan

Before opening CapCut, decide the exact visual set you will edit with. The
default Phase 1 short should be iPhone-led and screenshot-driven, not browser-
page-driven.

Preferred visual pool:

- `topic/screenshots/02-iPhone-App-Store-Detail.png` only for a very brief promise/context beat when the in-app proof still needs it
- `topic/screenshots/03-Home-Screen-With-App.png` when the opening benefits from a literal home-screen launch cue
- `experience/clips/01-Core-Loop.mov` for the main real-use beat when it exists
- `experience/clips/02-Secondary-Proof.mov` for a follow-up depth beat when it exists
- `experience/screenshots/01-First-Screen.png`
- `experience/screenshots/02-Main-Screen.png`
- `experience/screenshots/03-Core-Task.png`
- `experience/screenshots/04-Outcome-Or-Friction.png`
- `experience/screenshots/05-Secondary-Feature.png` when it materially deepens the story
- `experience/screenshots/06-Pricing-Or-Limit.png` when the limit genuinely shapes the verdict

Do **not** use browser-page screenshots `00` or `01` in the main video unless
the iPhone App Store screenshot is missing or broken.

Shot-list contract:

- choose 6-8 beats max
- at least 5 beats should come from home screen or in-app captures; the iPhone App Store detail frame is optional context, not core proof
- by about 10-12 seconds, the viewer should already have seen the first useful in-app proof
- if a Stage 4 clip exists, prefer showing real motion before relying on a text-heavy scorecard or verdict beat
- if a Stage 4 core clip exists, default to opening on that real motion or a trim from that same clip instead of spending the first beat on a static setup card
- if the current shot list still feels like context plus static menus, go back and pick stronger in-app proof before editing
- if the story only works because of a long context or store beat, the proof set is still too thin; do not compensate with more setup

CapCut-first composition contract:

- create the hook, proof, and verdict directly in CapCut with editable text overlays and screenshot motion
- do not rely on fully code-rendered title / scorecard / verdict PNGs as the primary edit path
- if you ever find yourself about to render the whole timeline from shell helpers because it is faster, stop; in this real-edit lane that is not an acceptable substitute for the CapCut path
- use subtle motion on stills: crop, pan, slow push, or a deliberate hold instead of dead-static slides
- when live iPhone clips exist, let those clips own the core-task or payoff beats and use screenshots to support, not replace, the motion proof
- use simple transitions only: quick dissolve, fade, or one restrained move transition
- avoid sticker clutter, meme overlays, generic stock footage, or non-product filler
- a proof beat should usually begin on the product itself, not on a full-screen text card
- allow at most one text-first beat in the whole cut; everything else should feel product-first or product-backed
- if the only way to explain a beat is with a long card, the beat probably belongs back in Stage 4 exploration rather than Stage 5 packaging

Timeline contract:

1. opening overlay on the first real iPhone frame
2. optional quick promise/context half-beat only when the in-app proof still needs it
3. first useful screen
4. core task / real attempt
5. outcome / payoff / friction
6. optional secondary proof
7. closing verdict overlay or compact summary when it still helps

Text-overlay contract inside CapCut:

- one short headline plus one short support line per beat
- keep the main story in English, aimed at an English-speaking viewer
- use the short app alias consistently
- if localized text appears, keep it secondary and visually clean
- do not let text cover the exact product proof the viewer needs to see
- score and verdict beats may use more text than the proof beats, but they still need to stay mobile-readable at a glance
- default text budget:
  - headline: roughly `2-5` words
  - support line: roughly `5-11` words
  - if the copy does not fit inside that budget, rewrite it shorter instead of shrinking the font or adding a paragraph

## Step 4: Write the narration package

Use `post/video-plan.md` to lock the story first, then write
`post/assets/narration.txt` with roughly `12-18` short spoken lines and about
`220-420` words total.

The narration should follow this arc:

1. hook
2. how to start / what the app is trying to do
3. what happened on first launch
4. how the main workflow is entered
5. what core task or tool was actually reached
6. what changed or got saved next
7. one secondary proof or hidden detail
8. one best practice, trust signal, or less-obvious behavior
9. one payoff or friction point
10. one audience / limit beat
11. concise verdict
12. closing recommendation if the story still needs it

Narration rules:

- Prefer spoken, natural review phrasing over formal prose.
- Use the short app alias in narration if the localized full name would sound awkward in TTS.
- Do not fabricate deeper coverage than Stage 4 actually achieved.
- Keep each spoken line independently readable; avoid caption fragments.
- Aim for roughly `10-28` words per line.
- Prefer one strong claim or contrast per line. A good line usually sounds like a reviewer talking, not like a product spec being recited.
- If the run stayed shallow, make the friction or blocker the story rather than pretending you reached deeper value.
- If the app name is localized or mixed-language, let the narration say the short alias and keep the full localized name on-screen only when it renders cleanly.
- Prefer straight ASCII punctuation in narration text when using local TTS. Avoid fancy quotes, uncommon unicode punctuation, or awkward mixed-language sentences that commonly sound broken in `say`.
- Prefer one clear clause per spoken line. If a line needs two commas and a dash to fit, it is probably too dense for local TTS.
- If the evidence is thin, shorten the structure honestly, but do not pad the runtime with empty hype.
- When the App Store promise still matters but the cut does not justify a separate context beat, weave that promise into the hook or verdict rather than forcing an extra store line.

If `/usr/bin/say` exists, prefer the workspace helper:

```bash
python3 skills/capcut-edit/scripts/build_voiceover.py "$ROOT_DIR"
```

That helper should:

- read `post/assets/narration.txt`
- derive a short TTS-safe alias from `topic/app-store-listing.json` when the full localized name would sound awkward
- write `post/assets/voiceover-script.txt`
- write `post/assets/voiceover.aiff`
- write `post/assets/voiceover-meta.json`
- keep the script stable enough that a subtitle file can be generated from the same lines

Only if the helper script is missing or broken, fall back to raw `say`:

```bash
say -v Samantha -r 185 -o "$ROOT_DIR/post/assets/voiceover.aiff" -f "$ROOT_DIR/post/assets/narration.txt"
```

Voice selection rule:

- If the narration is predominantly English, prefer `Samantha` or another clear English voice.
- If you intentionally write predominantly Chinese narration, first check `say -v ?` for an available Chinese voice and use it only if the voice sounds clearly usable. Otherwise fall back to English narration rather than producing broken mixed-language TTS.
- Before synthesizing voiceover, quickly scan `post/assets/narration.txt` for mixed-language lines that would sound garbled. Rewrite those lines first instead of accepting poor TTS pronunciation.
- If the helper chooses English TTS mode, prefer English narration plus a short Latin alias for the app name over leaving stray CJK fragments in the spoken script.

Voiceover budget check:

- Before opening CapCut, inspect `post/assets/narration.txt` and `post/assets/voiceover-meta.json` when the file exists.
- If the narration drifts far outside the target lane, rewrite it and regenerate the voiceover before editing.
- Prefer one spoken idea per sentence chunk. If the narration sounds like a dense wall of prose instead of a guided walkthrough, it is too heavy.
- Treat `durationSec < 120`, `durationSec > 240`, `wordCount < 180`, `wordCount > 460`, `lineCount < 10`, or `lineCount > 20` as a revision trigger rather than a harmless warning.

## Step 4.25: Generate the subtitle package

After the narration and optional voiceover exist, also generate:

- `post/assets/subtitles.srt`

Preferred helper:

```bash
python3 skills/capcut-edit/scripts/build_subtitles.py "$ROOT_DIR"
```

Subtitle rules:

- Build subtitles from the same narration lines that produced the voiceover so the spoken story and the on-screen text stay aligned.
- Prefer readable sentence chunks over word-by-word karaoke fragments.
- Keep subtitle text English-first, concise, and free of brittle mixed-language lines that would be hard to style in CapCut.
- The subtitle file is a production aid for CapCut. It should help the editor import or reproduce captions quickly, not become a second separate script with different wording.

## Step 4.5: Prepare the CapCut import pack

Before you touch the local CapCut import flow, stage one tiny folder that
matches the intended beat order. This keeps the GUI work short and deliberate.

Create:

- `post/capcut-import/`

Put only the chosen assets there:

- the screenshots and clips you actually plan to use
- `post/assets/voiceover.aiff` when it exists

Import-pack rules:

- Prefer numbered filenames that roughly follow the beat order.
- If one screenshot will be reused twice in the edit, import it once.
- If both clips and screenshots exist, still keep the folder compact. Do not dump every artifact into CapCut "just in case".
- Prefer one prepared folder over repeated browsing across `topic/`, `experience/`, and `post/assets/`.
- Prepared still-image assets should already be rendered as `1080x1920` proof panels with the iPhone screen cropped large inside the frame. Treat them as near-final visual plates, not as raw screenshots that need to be shrunk back down.
- If you are editing with a still-only proof set, the import folder should usually still contain no more than about 6-8 visual assets plus the voiceover.
- Do not include the iPhone App Store detail screenshot in the import pack unless you already decided the cut truly needs that brief context beat.

Short-path import contract:

- After `post/capcut-import/` is ready, also mirror that tiny file set into one short deterministic local folder for GUI import, for example:

```bash
SHORT_IMPORT_DIR="/tmp/understudy-capcut-import-$(basename "$(dirname "$ROOT_DIR")")"
rm -rf "$SHORT_IMPORT_DIR"
mkdir -p "$SHORT_IMPORT_DIR"
cp -R "$ROOT_DIR/post/capcut-import/." "$SHORT_IMPORT_DIR/"
printf '%s\n' "$SHORT_IMPORT_DIR" > "$ROOT_DIR/post/capcut-import-path.txt"
```

- Keep `SHORT_IMPORT_DIR` small and file-only. It should contain just the numbered screenshots / clips plus `voiceover.aiff` when present, not the surrounding `post/` tree.
- `SHORT_IMPORT_DIR` must be unique per run. Do not reuse one generic `/tmp/...-artifacts` folder name across multiple runs, because stale imports become hard to distinguish.
- Use that short path for Finder and Open-panel import work. The purpose is to remove long-path ambiguity, stale-run confusion, and accidental parent-folder imports.
- If the short-path folder somehow contains exports, project bundles, run metadata, or non-curated leftovers, clean it and rebuild it before opening CapCut.

Preferred import-pack helper:

```bash
python3 skills/capcut-edit/scripts/prepare_capcut_import.py "$ROOT_DIR"
```

That helper should:

- read `post/capcut-import-manifest.json`
- write the curated file-only folder `post/capcut-import/`
- mirror it into a short deterministic import path under `/tmp`
- write `post/capcut-import-path.txt`

If the helper is unavailable or broken, fall back to the manual shell copy flow above.

## Step 5: Assemble and export the final video in CapCut

Default edit route:

1. if CapCut is already open in an unknown or stale draft state, quit it once and relaunch; otherwise open local `CapCut.app`
2. verify CapCut actually opened and a workable project surface is visible before importing assets
3. create a fresh clean vertical `9:16` project for the current run unless an already-open editor is unmistakably the same current run and already contains only the intended assets
4. import the chosen iPhone screenshots, Stage 4 clips, `post/assets/voiceover.aiff` if it exists, and the subtitle package when CapCut supports it
5. build the proof-first `8-14` beat timeline directly in CapCut
6. export to `post/final-video.mp4`

Primary-route enforcement:

- If local CapCut opened successfully, stay on that route. Do not quietly abandon it and jump to shell rendering just because a helper script exists.
- If local CapCut fails, write one short factual note about the blocker, then try CapCut web before considering the legacy shell preview path.
- Only after both local CapCut and CapCut web are clearly blocked may you consider `render_review_cards.py` plus `build_review_video.py`, and that preview fallback is allowed only when the user explicitly accepts a preview render instead of a real CapCut edit. Otherwise fail the stage truthfully.

CapCut state contract:

- Distinguish these states explicitly before every major action:
  1. CapCut home / draft gallery
  2. CapCut editor with an empty media bin
  3. macOS Open panel spawned by CapCut
  4. Finder window showing `post/capcut-import`
- Localized home/gallery cues usually include a large `开始创作` / `Start creating` hero, left navigation such as `首页` / `Home` and `模板` / `Templates`, plus recent draft cards or starter tiles near the bottom.
- Localized editor cues usually include a visible import button such as `导入` / `Import`, a media bin, a timeline ruler, or a preview monitor. If those are not visible, you are probably not in the editor yet.
- If the CapCut home / draft gallery is visible, enter or resume one editable project and then stop reopening the home surface.
- If the home / draft gallery is visible and one draft card clearly matches the current app alias, `projectName`, or `runSlug` from `post/capcut-import-manifest.json`, open that draft once before creating another project.
- If the home / draft gallery is visible and no clearly current draft is present, use the large `开始创作` / `Start creating` action to enter a fresh project promptly instead of lingering on the gallery.
- If the CapCut editor is already visible, do not click `开始创作` again unless you truly returned to the home / draft gallery.
- If a `录屏` / screen-record starter tile is visible, classify that as home/gallery, not as an already-open current project.
- If Finder is frontmost but a timeline ruler, media sidebar, parameter panel, or empty media bin from CapCut is visibly sitting behind it, treat that as `editor already open`, not as `home`.
- If the editor media bin already contains the intended screenshots / clips / audio, do not re-import them. Move on to timeline assembly.
- If the editor is visible but the media bin is still empty after one import attempt, switch routes immediately instead of repeating the same click blindly.

Fresh-project hygiene contract:

- Prefer a project name derived from the current run or app alias so it is easy to distinguish from older drafts.
- If CapCut opens an older draft with stale screenshots, stale exports, unrelated timelines, or a confusing mixed media bin, do not try to salvage it by layering new assets on top.
- Instead, return to the draft gallery if needed and create one fresh project for this run, or clear the stale media bin before continuing.
- The current run should never knowingly edit inside a project whose visible contents belong to another episode or older artifact root.
- If the visible project name, breadcrumb, or media-bin contents still look like an older generic draft such as `0322 (3)` or another obviously unrelated prior draft, classify that state as stale immediately.
- In that stale-draft case, a bounded reset is acceptable: quit CapCut once, relaunch it, and create the fresh project instead of trying to nurse the inherited draft back into correctness.

Window-layout contract:

- Before any cross-window import, make CapCut and Finder simultaneously visible on the same display.
- Prefer a large CapCut editor window and one narrow Finder source window. The destination media bin must stay visibly uncovered during the drag.
- If Finder is covering most of the CapCut media bin, resize or move Finder first. Do not attempt a blind drag into an obscured destination.
- On macOS, it is acceptable to use one bounded `osascript` / System Events window resize step to place CapCut large and Finder narrow if manual resizing would waste time.
- Re-check the scene after resizing: Finder should show the prepared asset files, and CapCut should still show an empty import area or media bin that is clearly reachable.

Preferred local import route:

- Prefer the shortest stable route into a non-empty media bin, not the most "official" button path.
- Default to the Finder drag route from `SHORT_IMPORT_DIR` first because a pre-curated short folder plus cross-window drag is usually more stable than driving a deep file-picker path.
- If Finder can open `SHORT_IMPORT_DIR` cleanly, do that before clicking CapCut `导入`. Treat the Open panel as a secondary path, not the preferred one.
- If the CapCut `导入` button cleanly opens the macOS Open panel and the file picker is already in the correct small folder, you may continue there.
- If the `导入` button does not produce a usable Open panel promptly, switch to the Finder drag route instead of looping on the same button.
- The Finder drag route is a first-class local CapCut path, not a fallback embarrassment.
- Import completeness gate: before leaving the import step, compare the visible media bin against `post/capcut-import-manifest.json`. If the manifest expects multiple assets and you can only see one tile, the import is incomplete.
- One-thumbnail anti-pattern: if the media bin shows only a single file such as `01-opening-overlay.png` while the curated folder contains more screenshots or audio, assume you imported only the first item. Re-import the remaining curated files before touching the timeline.
- Use the same manifest for state grounding too:
  - `projectName`, `draftKeywords`, and `runSlug` help identify whether a visible CapCut draft looks current or stale
  - `expectedImportCount` and `expectedRoles` define the minimum imported asset set
  - `timelineChecklist` defines the minimum beats that must really land on the timeline before the edit counts as underway

Standard macOS Open-panel contract:

- Treat this as the secondary route when the prepared Finder drag route is not already easier.
- After clicking `导入` / `Import`, expect the normal macOS Open panel.
- Do not stop because a system file picker appeared; that means the local CapCut route is working.
- Prefer the shortest deterministic path:
  1. use `cmd+shift+g`
  2. type the exact path to `SHORT_IMPORT_DIR`
  3. press `Return`
- If the Go-to-folder helper sheet, path suggestions, or autocomplete UI becomes awkward or sticky, cancel that sub-flow and switch to the Finder drag route instead of fighting the suggestion popup.
- If the panel lands in a folder that shows parent-level run contents such as `manifest.json`, `publish`, `topic`, `post`, `capcut-project`, or `final-video.mp4`, that is the wrong level. Immediately redirect back to `SHORT_IMPORT_DIR`.
- Open the short-path folder, select the actual asset files with `cmd+a`, then click `Open` / `导入`.
- Do not choose the enclosing folder object itself when the panel is capable of selecting the contained files. File selection is more reliable than directory import for this workflow.
- After import, verify the CapCut media bin actually shows the expected thumbnails / clips / waveform before you start building the timeline.
- If the first import attempt misses the audio file or lands in the wrong location, fix the selection immediately instead of building a half-imported timeline.
- Do not treat the appearance of one screenshot thumbnail as success when the manifest expects several files. Count the visible imported items or otherwise verify the full set landed.

Finder drag-route contract:

- Prefer this route by default when the prepared folder already exists.
- Open `SHORT_IMPORT_DIR` in Finder and use that small folder as the drag source.
- Keep Finder and CapCut both visible enough for a cross-window drag, with the CapCut media bin fully or mostly visible.
- Prefer Finder list view where the numbered asset files are easy to target and `cmd+a` is unambiguous.
- Select the intended files in Finder, usually with `cmd+a` because the folder is already curated.
- Do not drag the enclosing folder itself into CapCut when you can drag the selected files directly.
- After selecting the files, do not cover the CapCut destination with another Finder move. Preserve the visible drop target first, then drag.
- Then use `gui_drag` with `captureMode: "display"` to drag the selected files from Finder into the empty media bin / import area in CapCut.
- Name both ends semantically, for example:
  - source: the selected files in the Finder file list for `capcut-import`
  - destination: the empty media bin / import area in the CapCut editor
- After the drop, verify the CapCut media bin is no longer empty and shows the expected thumbnails / audio waveform.
- If the first drag lands on the wrong surface, correct the drop target once immediately. Do not keep dragging blindly.
- If CapCut creates a folder tile instead of immediately showing the imported assets, treat that as a directory-import detour. Open that media folder once, verify the actual numbered files are inside, and if the contents still look wrong or incomplete, re-import the actual files rather than continuing blindly.
- Do not start timeline editing until the media bin visibly contains the intended assets.
- If the Open panel path was awkward or got cancelled, do not treat that as local CapCut failure yet. Return to the Finder drag route in the same fresh project before escalating.
- If CapCut is still open on a fresh editor with an empty media bin, one failed Open-panel attempt is not enough to abandon local CapCut. You still owe the run one direct Finder drag attempt.
- If the media bin is non-empty but still clearly incomplete relative to the manifest, that is also not enough to start editing. Re-import until the opening, core proof, outcome, and voiceover assets are all present when they are expected.

Voiceover placement contract:

- Prefer keeping the voiceover in the same main media bin as the screenshots and clips. A separate audio-library detour is not required when the AIFF already exists as imported media.
- After the media bin is populated, first try to place the voiceover by dragging the imported `voiceover.aiff` item straight onto the audio track area under the main timeline.
- Do not switch to the `音频` / `Audio` tab just because an audio asset exists. Only go there if the main-media route clearly cannot expose the imported audio item.
- If the voiceover item is missing after a successful visual import, do one bounded re-import of just the audio file from `SHORT_IMPORT_DIR`.
- If that second attempt still leaves the audio unavailable, continue with a clean silent cut instead of looping through more import surfaces.

Only if local CapCut is unavailable or clearly broken:

- use CapCut web through the browser tool
- on the first browser call, explicitly request `browserConnectionMode: "auto"`
- once the extension relay is attached to the intended tab, continue in `browserConnectionMode: "extension"`
- keep the same iPhone-only asset policy

CapCut timeline rules:

- keep the finished video roughly `150-210s`, with `120-240s` as the outer acceptable range
- default to `8-14` beats when the proof set is strong enough; extra beats should deepen the walkthrough, not just add packaging
- show real product imagery almost immediately; the first second should already feel product-led rather than a dead title wall
- the opening hook should usually live as overlay text on the first real iPhone frame, not as a standalone full-screen title card
- if the opening and core-task beats reuse the same live clip, trim two different moments from it instead of replaying the same few seconds twice
- the opening plus any optional context beat should stay concise enough that the viewer reaches real product proof quickly
- default beat-duration ladder:
  - opening overlay: about `5-9s`
  - optional context beat: about `5-10s`, and omit it entirely when the first in-app frame already explains the app
  - first impression / how-to-start: about `10-18s`
  - core task setup: about `12-22s`
  - core task / real attempt: about `18-35s`
  - outcome / payoff / friction: about `15-30s`
  - optional secondary proof or hidden detail: about `10-22s`
  - limit / audience-fit beat: about `8-16s`
  - closing verdict overlay: about `6-12s`, preferably riding on the outcome/proof frame rather than becoming its own long static card
- the first useful in-app proof should land early, not at the very end
- the first useful proof should usually land in the early part of the video rather than after a long setup section
- if voiceover exists, align the shot holds and subtitle pacing to the spoken rhythm instead of leaving dead air
- if voiceover is absent, the visual pacing still needs to land by itself; do not compensate for silent export by adding more text
- most of the runtime should belong to first impression, core task, outcome, and optional secondary proof
- when a Stage 4 clip exists, crop or zoom it so the viewer mainly sees the iPhone region rather than unrelated desktop borders
- when a Stage 4 clip exists, let it own a real proof beat early instead of burying it behind multiple still-only setup beats
- do not leave the proof sequence as three static screenshots in a row when a real motion clip from the same loop is available
- prefer a verdict overlay on the strongest outcome/proof frame over a separate static scorecard card
- only use a dedicated scorecard beat when the evidence is already deep enough that the summary clarifies rather than replaces product proof
- do not end with back-to-back packaging beats when the same conclusion could live on the outcome frame itself
- if the strongest proof frame already carries the verdict cleanly, skip the dedicated closing card entirely
- on thin-evidence runs, treat a standalone verdict card as a warning sign, not a default beat; the honest finish is usually one tighter overlay on the outcome frame
- timeline-progress gate: a non-empty media bin is not the same thing as an edit. Do not consider the CapCut build underway until at least the opening, core proof, and outcome materials are actually on the timeline.
- If `post/capcut-import-manifest.json` exposes `timelineChecklist`, treat every listed beat as a real checkpoint. Do not call the edit underway until those specific beats are visually represented on the timeline, not merely available in the bin.
- if no live clip exists, make each still beat visually distinct with different crops, motion direction, framing, or hold length
- if a prepared still already fills the frame cleanly, keep it large and add only light motion; do not scale it down into a second decorative matte
- keep scorecard plus verdict compact when they exist; together they should usually consume less time than the core-task plus outcome proof
- if the total runtime starts drifting long, cut context/setup and summary first; do **not** steal time from the core-task or outcome proof just to preserve packaging
- if the opening is still mostly text after one export, shorten it and start closer to the strongest iPhone proof frame
- if the cut still contains a big dark card with a small centered phone after one export, treat that as a failed framing pass and repair it
- if the first useful proof beat still has not landed by about `5-6s`, shorten setup and move the strongest in-app proof earlier

CapCut editing guidance:

- use screenshot motion on every still: gentle push, drift, or crop animation
- keep transitions restrained: dissolve, fade, or one simple move transition
- prefer text overlays inside CapCut over pre-baked paragraph images
- use one deliberate visual system that fits the current app proof. Dark ink/navy may work, but do not default to the same shell every run when it starts to feel like a reusable template.
- let the strongest product proof fill the frame; do not leave the iPhone tiny inside a decorative matte when CapCut crop/zoom can make the product read better
- on proof beats, the product should usually occupy roughly two-thirds or more of the visible vertical frame after crop/zoom
- when a screenshot cannot naturally fill the frame, prefer a blur-fill or edge-extended version of that same screenshot over a generic background card
- do not bury the actual proof under oversized captions or stickers
- score and verdict beats may use text-heavier layouts, but they should still feel like part of the same series and remain easy to scan on mobile
- do not use browser App Store pages as full-screen content in the final cut when the iPhone App Store detail shot exists
- if the clip includes desktop chrome, crop tighter inside CapCut so the iPhone content still feels like the subject
- if a proof beat still feels text-led after the first export, shorten the overlay and let the product motion breathe
- use the iPhone App Store detail frame only as a very quick context beat when it is still needed, not as a default setup card
- the final story should still mostly work if you removed the context beat entirely; if it collapses without that setup, the underlying Stage 4 proof is still too thin
- if the app name looks awkward in mixed-language overlay text, keep the overlay to the short alias and let the visible UI supply the longer localized truth
- prefer headline overlays of roughly `2-5` words and support lines of roughly `5-12` words. Rewrite instead of shrinking.
- only one beat in the whole cut may be mostly text-first. Every other beat should feel product-first or product-backed.
- english-first readability rule: if a caption line becomes brittle, mixed-language, or tofu-prone, shorten it into plain English and let the UI carry the localized truth
- if three adjacent beats would all be stills, vary them with crop direction, hold length, or one inserted motion-led beat so the cut does not flatten.
- if Stage 4 proved a saved-state revisit or a clear limit/paywall/trust beat, include it. Human-seeming reviews need more than launch -> one task -> verdict.
- avoid a reusable “review template” look. The viewer should mainly remember the app proof, not the matte, the frame, or the scorecard shell.
- Keep overlay typography sentence-case, short, and scannable. A readable 2-line English caption beats a clever but cramped multi-line block every time.
- If the localized app name is visually awkward in mixed-language overlay text, show the short alias in the caption and keep the localized full name inside the UI or App Store screenshot only.

Suggested CapCut beat mapping:

1. hook + app alias on the first real iPhone frame
2. how to start / optional quick context from the iPhone App Store detail screen only when it still helps
3. first screen / first impression
4. core task setup
5. core task attempt
6. payoff or friction result
7. optional secondary proof
8. hidden detail / best practice
9. optional limit or trust beat
10. closing verdict overlay / best for / avoid if

Export contract:

- export `1080x1920`
- prefer `30 fps`
- H.264 MP4
- do not accept `original ratio`, desktop-canvas, or any export that drifts away from a true `9:16` vertical frame
- if voiceover exists, include it in the export
- save the exported file exactly at `post/final-video.mp4`
- if CapCut insists on exporting to its own default project directory first, allow that, then move or copy the newest matching MP4 into `post/final-video.mp4` immediately after export
- prefer a short identifiable project name so the exported file is easy to locate if CapCut does not expose a direct save path cleanly

Write `post/capcut-edit-note.md` after export. Keep it short and natural
language. It should record:

- whether the edit used local CapCut or web CapCut
- whether Stage 4 live clips were used and which ones
- which screenshots were used in the final timeline
- whether voiceover was included
- the main visual style choices
- any truthful compromises or remaining limitations

Validation rule:

- After export, run `ffprobe` on `post/final-video.mp4`.
- Treat errors such as `moov atom not found` or `Invalid data found when processing input` as a failed export.
- Only continue if `ffprobe` succeeds and reports a plausible duration, roughly `20 <= duration <= 60`, and a non-trivial file size.
- Also inspect the video and audio stream durations. If the MP4 has a large stream mismatch, roughly greater than `0.75s`, treat the export as technically suspect and re-export before finishing.
- Then generate a quick review packet for your own internal QA:

```bash
python3 skills/video-review-feedback/scripts/extract_review_frames.py "$ROOT_DIR"
```

- Inspect `review/keyframes/contact-sheet.jpg` plus 2-3 representative keyframes. Prefer the opening frame, the first in-app proof frame, and the verdict/score frame.
- Use `vision_read` on the contact sheet and any suspicious frame when the visual verdict is not obvious from a text-only inspection.
- Judge at least these questions before finishing:
  - does the first useful iPhone proof arrive early enough?
  - is the video mostly real iPhone content rather than browser pages or decorative cards?
  - are at least two proof beats visually distinct?
  - is on-screen copy readable and short?
  - are there any broken Chinese / CJK rendering issues?
  - does the cut feel like a human tested the app rather than assembled a packaging template?
- If the cut still feels browser-led, too text-heavy, visually cheap, too static, or shallower than the underlying iPhone proof, reopen CapCut and improve it before calling Stage 5 done.
- If the cut clearly fails for edit-side reasons such as slow hook, tiny product area, repetitive frames, crowded text, or awkward mixed-language overlays, perform one bounded repair pass in CapCut before stopping.
- A ready cut should normally satisfy all of these:
  - product visible immediately or nearly immediately
  - first useful proof arrives by about `5-6s`
  - no major browser / desktop contamination
  - no broken CJK rendering
  - at least 3 visually distinct proof beats
  - score / verdict occupy less attention than the proof section
  - the app UI is large enough in frame that the review feels product-led rather than card-led

## Step 6: Update the manifest

Only after the MP4 passes `ffprobe`, update `manifest.json` to include:

- `status: "edited"`
- `phase: "edited"`
- `artifacts.video: "post/final-video.mp4"`
- `timestamps.postDone`

## Stop Checklist

```bash
ROOT_DIR="<resolved root dir>"
export ROOT_DIR
test -f "$ROOT_DIR/post/video-plan.md"
test -f "$ROOT_DIR/post/assets/narration.txt"
test -f "$ROOT_DIR/post/final-video.mp4"
test -f "$ROOT_DIR/post/capcut-edit-note.md"
ffprobe -v error -show_entries format=duration,size -of json "$ROOT_DIR/post/final-video.mp4"
python3 -c "import json, pathlib; d=json.loads(pathlib.Path('$ROOT_DIR/manifest.json').read_text()); assert d.get('status')=='edited'; print('ok')"
```

Print the rendered file size, duration, whether voiceover was included, whether
the edit used local or web CapCut, and the story angle before stopping.
