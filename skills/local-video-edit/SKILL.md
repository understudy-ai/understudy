---
name: local-video-edit
description: >-
  Stage 4: Compose a vertical tutorial-style review video from the captured
  iPhone evidence using the repo-local render pipeline. This skill is fully
  local and does not depend on any GUI editor.
metadata:
  understudy:
    emoji: "🎬"
    requires:
      bins: ["ffmpeg"]
---

# local-video-edit

## Goal

Turn the Stage 1-3 evidence into a truthful, watchable vertical review video
using only repo-local helpers plus `ffmpeg`.

## Rules

1. Use the active run root: prefer `artifactsRootDir`, otherwise `EPISODE_DIR`.
2. Read the stage artifacts from disk before generating anything.
3. The happy path is fully local. Do not open a GUI editor for this stage.
4. Prefer `python3 skills/local-video-edit/scripts/run_local_edit_pipeline.py "$ROOT_DIR"` over ad hoc chained shell commands.
5. The local pipeline is:
   `build_video_plan.py` -> `build_voiceover.py` -> `build_subtitles.py` -> `render_review_cards.py` -> `build_review_video.py` -> `ffprobe`
6. A successful run must end with:
   - `post/video-plan.md`
   - `post/video-shot-list.md`
   - `post/video-edit-manifest.json`
   - `post/assets/narration.txt`
   - `post/assets/voiceover-script.txt` when voiceover text is generated
   - `post/assets/voiceover.aiff` when local TTS succeeds
   - `post/assets/voiceover-meta.json` when voiceover metadata exists
   - `post/assets/subtitles.srt`
   - `post/video-edit-note.md`
   - `post/final-video.mp4`
7. `post/final-video.mp4` is not complete until `ffprobe` confirms it is structurally valid.
8. Use iPhone-led proof as the main visual source. Browser screenshots are planning artifacts, not default hero assets.
9. If a real Stage 3 motion clip exists, the local compositor should use it instead of quietly collapsing to a still-image slideshow.
10. Subtitle quality matters. Keep captions mobile-readable, and include a subtitle track in the final MP4 when technically safe.
11. Keep the story generic to the selected app. Do not hardcode AI-app, note-app, or creator-app assumptions into the copy.
12. If the current evidence is too thin for a believable review, report that honestly instead of compensating with extra packaging.
13. Do not hand-edit narration after audio and subtitles exist unless you also regenerate the downstream artifacts.
14. Avoid silent long-running shell chains. If a helper can be quiet for a while, run it through the heartbeat pipeline instead.
15. Select visuals by proof strength, not by fixed screenshot numbers. Prefer the strongest real receipts first: working motion clip, saved result, visible edit history, export/result confirmation, and only then lighter context frames.
16. `mustShowInVideo`, `evidenceMoments`, `thumbnailCandidates`, `hiddenDetails`, and `limitations` should actively influence the chosen visuals. Do not ignore them just because an older canonical filename exists.
17. Keep packaging light. Title, context, and verdict can use rendered cards, but the main middle beats should stay attached to the real screenshots or clips that prove the claim.
18. If `review/video-feedback.json` already exists and it calls for `revisionMode: "edit"`, rerun the local pipeline in proof-first mode: remove browser/context contamination, shorten packaging beats, and keep the closing verdict attached to real proof instead of a full-screen text card.
19. When a motion clip comes from a desktop recording of iPhone Mirroring, crop the phone surface itself so browser chrome does not leak into the final proof beat.
20. A fresh export invalidates any old review packet. Delete stale `review/video-feedback.json` and extracted keyframes after a successful rerender so Stage 5 does not trust an out-of-date gate.
21. Prefer ElevenLabs v3 voiceover when a key is configured in `.env` or the environment. Only fall back to `edge-tts` or macOS `say` when ElevenLabs is unavailable or fails.
22. Keep proof beats visually stable. Do not add aggressive pan/zoom motion that makes the phone feel like it is shaking.

## Inputs

- `artifactsRootDir` or `EPISODE_DIR`
- `topic/app-store-listing.json`
- `topic/selection-notes.md`
- `experience/notes.json`
- `experience/review-brief.md` if it exists
- `experience/story-beats.md` if it exists
- `experience/screenshots/*.png`
- `experience/clips/*.mov`
- `review/video-feedback.json` if it already exists

## Fast Path

1. Resolve `ROOT_DIR`.
2. Run:

```bash
python3 skills/local-video-edit/scripts/run_local_edit_pipeline.py "$ROOT_DIR"
```

3. Verify:

```bash
test -f "$ROOT_DIR/post/final-video.mp4"
test -f "$ROOT_DIR/post/video-edit-note.md"
ffprobe -v error "$ROOT_DIR/post/final-video.mp4" >/dev/null
```

4. Update `manifest.json` only after the output files exist and the MP4 has been verified.

## Output Notes

- `post/video-plan.md` is the high-level story and beat plan.
- `post/video-shot-list.md` is the beat-by-beat production order for the local render.
- `post/video-edit-manifest.json` is the structured render manifest consumed by downstream helpers.
- `post/video-edit-note.md` is the short render summary for later review/publish stages.

## Failure Policy

- If local voiceover fails, continue with subtitles when possible and record the missing audio honestly.
- If the video render fails once, fix the underlying asset or narration issue and retry once.
- If the MP4 still cannot be produced truthfully, fail the stage rather than inventing a placeholder export.
