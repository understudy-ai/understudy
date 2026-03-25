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
- if the previous status was `published`, set `status: "completed"`
- otherwise keep the previous non-success status and add `cleanup.completed: true`
- also set `selectedApp.installed: false`
- ensure `artifacts.topicScreenshots` contains `topic/screenshots/99-Clean-Home-Screen.png`

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

topic_screenshots = list(manifest.get("artifacts", {}).get("topicScreenshots", []))
final_shot = "topic/screenshots/99-Clean-Home-Screen.png"
if final_shot not in topic_screenshots:
    topic_screenshots.append(final_shot)

manifest.setdefault("artifacts", {})["topicScreenshots"] = topic_screenshots
manifest.setdefault("timestamps", {})["cleanedAt"] = cleaned_at
manifest["phase"] = "cleaned"
manifest.setdefault("selectedApp", {})["installed"] = False
if previous_status == "published":
    manifest["status"] = "completed"
else:
    manifest["status"] = previous_status
    manifest["cleanup"] = {
        "completed": True,
        "cleanedAt": cleaned_at,
        "screenshot": final_shot,
    }

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
test ! -f "$HOME/understudy-episodes/active-episode.json"
```

Print the cleaned app name, the final manifest status, and the produced files before stopping. Stop immediately after the checklist passes.
