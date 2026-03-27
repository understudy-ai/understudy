---
name: app-review-cleanup
description: >-
  Cleanup stage: Remove the reviewed app from the iPhone, capture a clean home screen,
  and finalize the run state without leaving stale episode locks behind.
metadata:
  understudy:
    emoji: "🧹"
    requires:
      bins: ["screencapture"]
---

# app-review-cleanup

## Rules

1. Start from the selected app recorded in `manifest.json`.
2. Finish on the iPhone home screen with the app removed.
3. Do not run `pnpm demo:reset` from inside this stage; that command is for the operator after the playbook finishes because it can kill the current agent session.
4. Once the final clean-home screenshot exists and passes a local file check, do **not** spend another round on image inspection. Move directly into manifest/update/stop-checklist work and finish the stage.
5. Treat this stage as the final manifest normalizer for the natural-language pipeline. If earlier stages already produced their artifacts but forgot to mark themselves `completed`, fix that here instead of leaving the episode looking alive.
6. If the selected app was already gone by the time cleanup starts, that is not a blocker. Capture the truthful clean home screen, normalize the manifest, and finish.

## Inputs

- `artifactsRootDir` or `EPISODE_DIR`
- `manifest.json` with `selectedApp`

## Step 1: Resolve the root and load the selected app

Resolve `ROOT_DIR`.

If any later `python3` block reads `ROOT_DIR` from `os.environ`, export it
immediately after resolving it. Do not rely on an unexported shell variable.

Read `manifest.json` and extract:

- selected app name
- App Store URL if present
- current run status before cleanup

## Step 2: Delete the app from the iPhone

Activate iPhone Mirroring, return to the home screen, and verify the home screen
is visible.

Record the iPhone Mirroring window bounds from the latest GUI tool result and
reuse them for all screenshots in this stage.

Bounds rule: use the **Screenshot Capture** section in `iphone-mirroring-basics` for window bounds discovery and the CoreGraphics Swift fallback.

Long-press the selected app icon, choose the remove/delete flow, and confirm the
final delete dialog.

After each mutating step, verify the new state with a follow-up observation.

Use Spotlight as a fallback verification step if needed: after deletion, the app
should no longer appear as an installed result.

Cleanup boundary rules:

- Do not open generic iOS Settings as part of app-removal verification.
- If a long-press or overflow tap unexpectedly routes into Settings, App Info, or another unrelated system page, treat that as a misroute, back out once, return to the home screen, and retry the direct remove/delete path.
- Once you have one strong proof that the app is gone, such as the icon disappearing from the home screen or Spotlight no longer showing it as installed, stop escalating verification. Capture the clean end state and finish.

## Step 3: Capture the clean end state

Capture:

- `topic/screenshots/99-Clean-Home-Screen.png`

Use a window-bounded `screencapture -x -R"x,y,w,h"` capture and crop away the
window chrome before saving the final PNG.

Practical capture rule:

- If the latest successful `gui_observe`, `gui_click`, or `gui_type` result already includes `capture_rect`, reuse it directly.
- Do not stop to rediscover bounds before the final screenshot if the GUI result already exposed them.
- Capture to a temporary raw file first, then crop to the final path in one deterministic local shell step.
- Use the **Screenshot Capture** section in `iphone-mirroring-basics` for the crop insets, the CoreGraphics Swift window bounds template, and the preferred Pillow crop pattern.
- Capture to a real temporary file outside the artifacts tree first, then crop to the final path.
- Export all shell variables before invoking any `python3` block that reads from `os.environ`.
- Save the cropped result to `topic/screenshots/99-Clean-Home-Screen.png`, verify the file exists, and print its final dimensions.
- After that verification passes, do **not** call the `image` tool on the final PNG. Continue immediately to Step 4.

## Step 4: Release lightweight state and update the manifest

If `$HOME/understudy-episodes/active-episode.json` exists, remove it.

Optionally append the reviewed app to `$HOME/understudy-episodes/reviewed-apps.json`
with name, App Store URL, and cleanup timestamp so later selection can avoid easy repeats.

Update `manifest.json`:

- always set `phase: "cleaned"`
- set `timestamps.cleanedAt`
- set `currentStage: null`
- if Stage 5 already prepared a preview-only package, keep `status: "awaiting_confirm"`
- if Stage 5 already published successfully, keep `status: "published"`
- if Stage 5 is blocked, keep `status: "blocked"`
- otherwise set `status: "completed"`
- also set `selectedApp.installed: false`
- ensure `artifacts.topicScreenshots` contains `topic/screenshots/99-Clean-Home-Screen.png`
- normalize `stages.stage1` through `stages.stage5` from artifact truth when needed
- set `stages.cleanup.status: "completed"`
- when the run is waiting only on a human publish confirmation, set `pendingHumanAction: "confirm_youtube_upload"`

Finalize rule:

- As soon as `99-Clean-Home-Screen.png` exists, run one shell block that removes the active-episode lock, updates `reviewed-apps.json` if you are keeping that registry, updates `manifest.json`, and prints the final manifest status.
- Do not insert another GUI step, screenshot step, or image-inspection step between the successful final crop and this manifest-update shell block.

Preferred one-shot shell pattern:

```bash
ROOT_DIR="<resolved root dir>"
export ROOT_DIR
python3 - <<'PY'
from __future__ import annotations
import json, os
from datetime import datetime, timezone
from pathlib import Path

root = Path(os.environ["ROOT_DIR"])
manifest_path = root / "manifest.json"
manifest = json.loads(manifest_path.read_text())
previous_status = manifest.get("status")
cleaned_at = datetime.now(timezone.utc).astimezone().isoformat()
result_path = root / "publish" / "result.json"

def has(rel: str) -> bool:
    return (root / rel).exists()

def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}

publish_result = load_json(result_path)
publish_result_status = str(publish_result.get("status") or "").strip().lower()

topic_screenshots = list(manifest.get("artifacts", {}).get("topicScreenshots", []))
final_shot = "topic/screenshots/99-Clean-Home-Screen.png"
if final_shot not in topic_screenshots:
    topic_screenshots.append(final_shot)

manifest.setdefault("artifacts", {})["topicScreenshots"] = topic_screenshots
manifest.setdefault("timestamps", {})["cleanedAt"] = cleaned_at
manifest["phase"] = "cleaned"
manifest.setdefault("selectedApp", {})["installed"] = False

stages = manifest.get("stages")
if not isinstance(stages, dict):
    stages = {}

stage1_done = all(has(rel) for rel in [
    "topic/candidates.json",
    "topic/selection-notes.md",
    "topic/app-store-listing.json",
    "topic/device-action-plan.json",
    "topic/device-action-plan.md",
    "topic/screenshots/00-Browser-Today-Recommendation.png",
    "topic/screenshots/01-Browser-App-Detail.png",
])
stage2_done = all(has(rel) for rel in [
    "topic/screenshots/02-iPhone-App-Store-Detail.png",
    "topic/screenshots/03-Home-Screen-With-App.png",
])
stage3_done = all(has(rel) for rel in [
    "experience/notes.json",
    "experience/review-brief.md",
    "experience/story-beats.md",
    "experience/screenshots/01-First-Screen.png",
    "experience/screenshots/02-Main-Screen.png",
    "experience/screenshots/03-Core-Task.png",
])
stage4_done = all(has(rel) for rel in [
    "post/video-plan.md",
    "post/assets/narration.txt",
    "post/assets/voiceover.aiff",
    "post/assets/subtitles.srt",
    "post/final-video.mp4",
])
stage5_ready = all(has(rel) for rel in [
    "publish/youtube.json",
    "publish/preview.md",
    "publish/result.json",
])

def merged_stage(name: str, *, status: str, extra: dict | None = None) -> dict:
    current = stages.get(name)
    merged = current if isinstance(current, dict) else {}
    merged["status"] = status
    if extra:
        merged.update(extra)
    return merged

if stage1_done:
    stages["stage1"] = merged_stage("stage1", status="completed")
if stage2_done:
    stages["stage2"] = merged_stage("stage2", status="completed")
if stage3_done:
    stages["stage3"] = merged_stage("stage3", status="completed")
if stage4_done:
    stages["stage4"] = merged_stage("stage4", status="completed")
if stage5_ready:
    stage5_status = {
        "preview_only": "awaiting_confirm",
        "published": "published",
        "blocked": "blocked",
    }.get(publish_result_status, "completed")
    stages["stage5"] = merged_stage("stage5", status=stage5_status)

stages["cleanup"] = merged_stage("cleanup", status="completed", extra={
    "cleanedAt": cleaned_at,
    "screenshot": final_shot,
})
manifest["stages"] = stages
manifest["currentStage"] = None

if publish_result_status == "published":
    manifest["status"] = "published"
elif publish_result_status == "blocked":
    manifest["status"] = "blocked"
elif publish_result_status == "preview_only":
    manifest["status"] = "awaiting_confirm"
    manifest["pendingHumanAction"] = "confirm_youtube_upload"
else:
    manifest["status"] = previous_status if previous_status not in {None, "", "running"} else "completed"
    manifest["cleanup"] = {
        "completed": True,
        "cleanedAt": cleaned_at,
        "screenshot": final_shot,
    }
    manifest.pop("pendingHumanAction", None)

manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")

registry_path = Path.home() / "understudy-episodes" / "reviewed-apps.json"
registry_path.parent.mkdir(parents=True, exist_ok=True)
entries = []
if registry_path.exists():
    try:
        data = json.loads(registry_path.read_text())
        if isinstance(data, list):
            entries = data
    except Exception:
        entries = []
entries.append({
    "name": manifest.get("selectedApp", {}).get("name"),
    "appStoreUrl": manifest.get("selectedApp", {}).get("appStoreUrl"),
    "cleanedAt": cleaned_at,
})
registry_path.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({
    "status": manifest.get("status"),
    "phase": manifest.get("phase"),
    "currentStage": manifest.get("currentStage"),
    "cleanedAt": cleaned_at,
}, ensure_ascii=False))
PY
rm -f "$HOME/understudy-episodes/active-episode.json"
```

## Step 5: Operator-side full reset

After the playbook run is fully finished, the operator can run this once from the
workspace root for a hard reset:

```bash
pnpm demo:reset
```

That host-side reset may kill stale agent processes and cancel abandoned runs.
Do not invoke it from this child stage.

## Stop Checklist

```bash
ROOT_DIR="<resolved root dir>"
test -f "$ROOT_DIR/topic/screenshots/99-Clean-Home-Screen.png"
python3 -c "import json, pathlib; d=json.loads(pathlib.Path('$ROOT_DIR/manifest.json').read_text()); assert d.get('phase')=='cleaned'; assert d.get('selectedApp',{}).get('installed') is False; print('ok')"
python3 -c "import json, pathlib; d=json.loads(pathlib.Path('$ROOT_DIR/manifest.json').read_text()); assert d.get('currentStage') in {None, ''}; assert d.get('stages',{}).get('cleanup',{}).get('status')=='completed'; print('ok')"
test ! -f "$HOME/understudy-episodes/active-episode.json"
```

Print the cleaned app name, the final manifest status, and the produced files before stopping. Stop immediately after the checklist passes.
