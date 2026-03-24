---
name: appstore-device-search-detail
description: >-
  Dedicated worker for the device-side App Store search path: move from the
  mirrored iPhone home/App Store surface to the exact locked App Store detail
  page and capture `02-iPhone-App-Store-Detail.png`.
metadata:
  understudy:
    emoji: "🔎"
    artifactKind: "worker"
    requires:
      bins: ["screencapture"]
---

# appstore-device-search-detail

## Goal

Use the frozen browser-produced device action plan to reach the exact App Store
detail page for the locked candidate on the mirrored iPhone, then capture
`topic/screenshots/02-iPhone-App-Store-Detail.png` and stop before any install
tap.

## Operating Contract

- Preferred execution path: once `ROOT_DIR` is resolved and the frozen plan files are present, run `node skills/appstore-device-search-detail/scripts/drive_device_detail.mjs --artifacts-root-dir "$ROOT_DIR"` first. If it returns `status: "ok"` and `topic/screenshots/02-iPhone-App-Store-Detail.png` exists, stop immediately instead of replaying the same flow manually.
- Manual GUI reasoning is the fallback, not the default, for this worker. Only stay in free-form GUI mode when that helper returns a truthful blocker or when a very specific local fix is needed.
- Read `skills/iphone-mirroring-basics/SKILL.md` before the first GUI action and follow its semantic recovery rules instead of relying on coordinate memory.
- Read `manifest.json`, `topic/device-action-plan.json`, and `topic/device-action-plan.md` first. Lock the current winner name, developer, and `deviceSearchQuery` before any GUI action.
- Treat `topic/device-action-plan.json` as the authority for the exact first `searchAction`, the required search-field focus rule, and the exact fallback `searchSubmitAction`.
- First focus rule: after reaching the Search surface, click the visible App Store search text entry field once so the caret is genuinely focused on-device. Use the latest visible field description for that click if needed, but that click must land on the real editable field rather than the bottom Search destination chrome.
- Placeholder-navigation rule: if the clicked control still shows placeholder copy such as `Games, Apps and more` or truncated `Games,...`, that click only entered the Search surface. The next action must be `gui_observe`, then one new focus click on the real editable field before replaying the frozen `searchAction`.
- Prefilled-field normalization rule: if the focused editable field already contains non-placeholder text before the first exact search call, do not trust `replace:true` alone to normalize it. If that visible text already substantially matches the current candidate or `resultRowTitleHints` and the matching suggestion/result is recoverable, use the result path without retyping. Otherwise, clear that stale field once before the first exact `searchAction`, then replay the frozen `searchAction` and observe.
- First search cycle rule: immediately after that focus click, replay the frozen `searchAction` exactly. Do not improvise the query, `typeStrategy`, `replace`, or `submit`.
- After that exact search `gui_type`, the only allowed next tool call is `gui_observe`.
- After a placeholder-navigation click, the only allowed next tool call is also `gui_observe`.
- Before the first post-type observation, do not issue another `gui_type`, `gui_click`, `gui_key`, or `gui_scroll`.
- The frozen search `gui_type` is intentionally targetless once focus is placed in the field. Do not invent a fresh typing target label such as `active App Store search field` to justify another typing attempt.
- If the frozen `searchAction` for the current candidate uses `clipboard_paste`, treat that as the primary route for this candidate rather than a fallback.
- A target description that still looks like the bottom Search destination or a bottom control showing placeholder copy is not a valid typing focus target.
- A target description that still shows placeholder copy like `Games, Apps and more` / `Games,...` is navigation-only evidence, not permission to type yet.
- Horizontal-scroll rule: a narrow iPhone search field may only show the tail of a correctly entered query, such as `...otes ai`, after the caret moves to the end. If that visible tail still matches the end of the frozen query and matching suggestions/results are present, treat the query as landed instead of clearing it.
- Post-type stabilization rule: if the first post-type observation still shows an active search field with a clear `x`, a caret, or matching suggestions/results, presume the exact search action landed unless the field clearly shows unrelated replacement text. In that state, prefer result tap or one frozen submit before any reset.
- If the first post-type observation shows the full correct query and also shows the matching suggestion or result row, tap that row once and immediately `gui_observe`.
- If the first post-type observation shows the full correct query but not yet a usable result row, replay the frozen `searchSubmitAction` once and immediately `gui_observe`.
- If a suggestion tap opens a search results list instead of the app detail page, stay on the same candidate: tap the app result row whose title best matches `detailPageVerification.resultRowTitleHints` and whose developer text matches when visible, then immediately `gui_observe` again.
- Clear/reset gate: do not tap the search-field clear `x` on the first post-type cycle while the field remains active and the visible text is either the full query, a matching tail, or an ambiguous horizontally scrolled fragment. A clean reset is only allowed after the post-type observation clearly proves the query is missing/replaced with unrelated text and no matching suggestion/result is recoverable, or after one frozen submit path still leaves no usable result.
- If the first post-type observation shows the query missing, garbled, or clearly replaced by unrelated text with no matching suggestion/result, spend one clean reset: clear the field, re-focus the visible search entry field, replay the exact frozen `searchAction`, and observe again.
- Do not choose a second `gui_type` while the same correct full query is still visibly present in the field. That state calls for result tap, explicit submit, or clean reset, not retyping.
- When tapping a search suggestion or app result, click the row body, not the `Get`, `Open`, or price button.
- After tapping the matching suggestion or result row, the only allowed next tool call is `gui_observe`.
- Between result-row tap and detail-page confirmation, do not detour into extra shell research, browser work, or long artifact rereads.
- Closeout rule: as soon as the correct App Store detail page is verified, the next work is immediate success closeout only. Reuse the latest GUI `capture_rect`, save `topic/screenshots/02-iPhone-App-Store-Detail.png`, update `manifest.json`, append one checkpoint, verify the files, and stop. Do not keep browsing the same detail page or burn more observations on a page that is already verified.
- Do not tap `Get`, `Install`, or `Open` in this worker.
- If one clean reset still does not reach the correct detail page, stop truthfully and return a blocker instead of improvising more loops.

## Inputs

- `artifactsRootDir`
- `manifest.json`
- `topic/device-action-plan.json`
- `topic/device-action-plan.md`

## Outputs

- `topic/screenshots/02-iPhone-App-Store-Detail.png`
- `manifest.json`
- `experience/checkpoints.jsonl`

## Budget

- `maxMinutes=8`
- `maxActions=36`
- `maxScreenshots=2`

## Allowed Surfaces

- The live `iPhone Mirroring` window
- Shell only for direct artifact reads, `test -f` checks, and targeted JSON/checkpoint writes under the active artifacts root

## Stop Conditions

- The correct App Store detail page is visibly open, title/developer match the locked candidate, and `topic/screenshots/02-iPhone-App-Store-Detail.png` exists.
- Or one clean reset was spent and the worker can state exactly whether the query landed, whether results appeared, and why the detail page still was not reached.

## Decision Heuristics

- Start from the current mirrored surface. If the phone is not clearly live on home/App Store, do one bounded recovery ladder: observe, use `gui_key key:"1" modifiers:["command"]` once if needed, then re-observe.
- Never treat a remembered bottom-center tap as a substitute for semantic Search-surface recovery. Different iPhone layouts and mirrored scales make that habit brittle.
- Reach the dedicated Search surface before typing. Bottom Search destination is only for entering the Search surface, not for repeated re-click loops or as the typing target itself.
- If the only clickable search control still reads like placeholder copy, click it once only to enter Search, then `gui_observe`. Do not type into that placeholder state.
- After the Search surface is visible, prefer one focus click into the real editable search text entry field and then use the frozen targetless `gui_type` rather than trying to ground a separate typing target.
- If the editable field is already populated with remembered search text from an earlier App Store session, normalize that stale state before the first exact search call. Either use the visible matching result immediately when it already fits the frozen candidate, or clear once before typing the frozen query.
- Valid pre-typing focus signals are a visible caret, an existing query, a clear `x`, or suggestions/results tied to the field. Placeholder copy by itself is not enough.
- If the latest observation still only offers a bottom Search destination or bottom placeholder control, do not type yet. Re-observe or re-enter the Search surface once until a real editable field is visible.
- Prefer the matching suggestion row before scrolling. Prefer a direct app result row before broader list exploration.
- If a suggestion routes into a results list, that is still a valid path. Prefer the exact app row that matches the frozen `resultRowTitleHints` over stopping early or drifting to a different candidate.
- If the active field only shows the tail of the frozen query but suggestions/results below already match the candidate, do not spend the clean reset. Use the results path first.
- If the active field still has a clear `x` immediately after the exact search action, treat that as evidence the field accepted input. Do not clear it unless the post-type observation also proves the visible text is unrelated and the result path is empty.
- If the correct full query is visibly present after typing, do not retype it. Either tap the correct row, use the frozen `searchSubmitAction`, or spend the single clean reset.
- Treat punctuation and localization differences in result-row titles as acceptable when the same core title tokens still match the frozen hint set, such as `Goodnotes-AI` vs `Goodnotes AI`.
- If the query contains non-ASCII and the frozen `searchAction` uses `clipboard_paste`, do not downgrade that attempt to `system_events_keystroke_chars` or another ad hoc typing route.
- If a wrong app detail page opens, back out once and spend the remaining clean-reset budget carefully; do not drift into a different candidate.
- Reuse the latest window capture rect for `02` once the correct detail page is verified.
- Before writing `02`, update `manifest.json` with any newly observed on-device detail metadata if it changed, then append one truthful checkpoint to `experience/checkpoints.jsonl`.

## Success Closeout

Once the correct detail page is visibly open and the locked title/developer still
match, stop exploring and execute the success closeout immediately.

Closeout order:

1. capture `topic/screenshots/02-iPhone-App-Store-Detail.png`
2. update `manifest.json` with the now-verified device detail metadata
3. append one truthful line to `experience/checkpoints.jsonl`
4. `test -f` the screenshot and stop

Practical capture rule:

- Reuse the latest GUI-reported `capture_rect` or `pre_action_capture.capture_rect`. Do not pause to rediscover bounds with AppleScript.
- Capture a temporary raw file with `screencapture -x -R"x,y,w,h"` and then crop away the iPhone Mirroring chrome with the same proportional crop approach used in other iPhone stages.
- If the latest GUI result does not expose numeric bounds clearly enough, the only approved shell fallback is a short CoreGraphics `swift` lookup for the iPhone Mirroring window bounds.

Preferred one-shot closeout block:

```bash
ROOT_DIR="<resolved root dir>"
RAW="$(mktemp /tmp/device-detail-raw-XXXXXX).png"
FINAL="$ROOT_DIR/topic/screenshots/02-iPhone-App-Store-Detail.png"
BOUNDS_JSON='<latest gui capture_rect as json>'
export ROOT_DIR RAW FINAL BOUNDS_JSON
python3 - <<'PY'
import json, os, subprocess
from pathlib import Path
from PIL import Image

bounds = json.loads(os.environ["BOUNDS_JSON"])
raw = Path(os.environ["RAW"])
final = Path(os.environ["FINAL"])
rect = f'{bounds["x"]},{bounds["y"]},{bounds["width"]},{bounds["height"]}'
subprocess.run(["screencapture", "-x", f"-R{rect}", str(raw)], check=True)

with Image.open(raw) as image:
    width, height = image.size
    left = round(width * 0.0253)
    top = round(height * 0.0532)
    right = width - round(width * 0.0190)
    bottom = height - round(height * 0.0129)
    image.crop((left, top, right, bottom)).save(final)

raw.unlink(missing_ok=True)
print(final)
PY

python3 - <<'PY'
from __future__ import annotations
import json, os
from datetime import datetime, timezone
from pathlib import Path

root = Path(os.environ["ROOT_DIR"])
manifest_path = root / "manifest.json"
checkpoint_path = root / "experience" / "checkpoints.jsonl"
manifest = json.loads(manifest_path.read_text())
selected = manifest.setdefault("selectedApp", {})
selected["installed"] = False
selected.setdefault("deviceVerifiedAt", datetime.now(timezone.utc).astimezone().isoformat())
topic_screenshots = list(manifest.get("artifacts", {}).get("topicScreenshots", []))
shot = "topic/screenshots/02-iPhone-App-Store-Detail.png"
if shot not in topic_screenshots:
    topic_screenshots.append(shot)
manifest.setdefault("artifacts", {})["topicScreenshots"] = topic_screenshots
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\\n")

checkpoint = {
    "stage": "appstore-device-search-detail",
    "timestamp": datetime.now(timezone.utc).astimezone().isoformat(),
    "status": "detail_page_verified",
    "appName": selected.get("name"),
    "developer": selected.get("developer"),
    "screenshot": shot,
}
with checkpoint_path.open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(checkpoint, ensure_ascii=False) + "\\n")
print(json.dumps(checkpoint, ensure_ascii=False))
PY

test -f "$FINAL"
```

Stopping rule:

- After that closeout block succeeds, do not take another GUI action in this worker.
- Do not stare at the verified detail page waiting for a better state. The success boundary is the screenshot plus checkpoint, not one more observation.

## Failure Policy

- If iPhone Mirroring is disconnected, blocked, or not showing a live phone surface after one bounded recovery ladder, stop with a blocker.
- If the Search surface cannot be reached or the editable field cannot be reacquired within the clean-reset budget, stop with a blocker.
- If the only apparent search target remains a bottom Search destination / placeholder control after one clean reset, stop with a blocker instead of typing into the wrong surface.
- If the worker typed into a remembered stale query field without first normalizing that prefilled state, stop and report the blocker instead of compounding it with post-type reset loops.
- If the worker clears an active search field before the query was proven missing/unrelated or before the single frozen submit path was exhausted, that was the wrong branch; stop and report the blocker instead of chaining more recovery loops.
- If the correct detail page still does not appear after one clean reset, stop and return control to the caller for pivot/termination.
- Do not treat a suggestion-driven results list as a terminal miss when the exact app result row is still visibly recoverable within the current bounded attempt.
- Do not claim install progress, do not fabricate `02`, and do not consume password/install budget in this worker.
