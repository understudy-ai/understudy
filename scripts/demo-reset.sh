#!/usr/bin/env bash
# One-shot cleanup: kill stale Understudy processes, clear episode locks,
# cancel non-terminal episodes/playbook runs, and return the device to a known
# home-screen state. Run this before starting a fresh pipeline run.
set -euo pipefail

echo "=== Demo Reset ==="

WORKSPACE_ROOT="${PWD}"

# 1. Kill stale Understudy processes, including old agent children, orphaned
# understudy-cli runs, and demo gateways left behind by prior validation runs.
PATTERNS=(
  "understudy.mjs agent"
  "understudy-cli"
  "run-node.mjs gateway"
  "scripts/e2e/understudy-playbook.mjs"
)

PID_FILE="$(mktemp)"
SURVIVORS_FILE="$(mktemp)"
trap 'rm -f "$PID_FILE" "$SURVIVORS_FILE"' EXIT

for pattern in "${PATTERNS[@]}"; do
  pgrep -f "$pattern" || true
done | awk 'NF { print $1 }' | sort -u > "$PID_FILE"

KILLED=0
while IFS= read -r pid; do
  [[ -z "${pid}" ]] && continue
  [[ "$pid" == "$$" ]] && continue
  if kill "$pid" 2>/dev/null; then
    KILLED=$((KILLED + 1))
    echo "$pid" >> "$SURVIVORS_FILE"
  fi
done < "$PID_FILE"

if [[ -s "$SURVIVORS_FILE" ]]; then
  sleep 1
  while IFS= read -r pid; do
    [[ -z "${pid}" ]] && continue
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done < "$SURVIVORS_FILE"
fi

echo "Killed $KILLED stale Understudy process(es)"

# 1.5 Return iPhone Mirroring to the home screen when available.
if osascript -e 'tell application "System Events" to (name of processes) contains "iPhone Mirroring"' >/dev/null 2>&1; then
  osascript <<'APPLESCRIPT' >/dev/null 2>&1 || true
tell application "iPhone Mirroring" to activate
delay 0.2
tell application "System Events"
  keystroke "1" using command down
end tell
APPLESCRIPT
  echo "Returned iPhone Mirroring to the home screen"
  if [ -f "$WORKSPACE_ROOT/scripts/gui/remove-home-apps.mjs" ]; then
    node "$WORKSPACE_ROOT/scripts/gui/remove-home-apps.mjs" --strict=0 || true
  fi
else
  echo "iPhone Mirroring not running"
fi

# 1.6 Close CapCut so the next run does not inherit stale drafts or stale media bins.
if osascript -e 'tell application "System Events" to (name of processes) contains "CapCut"' >/dev/null 2>&1; then
  osascript -e 'tell application "CapCut" to quit' >/dev/null 2>&1 || true
  sleep 1
  pkill -x CapCut 2>/dev/null || true
  echo "Closed CapCut"
else
  echo "CapCut not running"
fi

# 2. Remove active episode lock
LOCK="$HOME/understudy-episodes/active-episode.json"
if [ -f "$LOCK" ]; then
  rm -f "$LOCK"
  echo "Removed active-episode.json lock"
else
  echo "No active lock"
fi

# 3. Cancel all non-terminal episodes and workspace playbook runs. Also
# normalize stale child-session states on already-terminal runs.
WORKSPACE_ROOT="$WORKSPACE_ROOT" python3 - <<'PY'
import json
import os
import time
from pathlib import Path

now_ms = int(time.time() * 1000)
workspace_root = Path(os.environ["WORKSPACE_ROOT"]).resolve()

episode_terminal = {'published', 'blocked', 'partial', 'completed', 'failed', 'cancelled'}
run_terminal = {'completed', 'failed', 'cancelled'}
child_terminal = {'completed', 'failed', 'cancelled', 'skipped'}

episodes_dir = Path.home() / 'understudy-episodes'
episode_cancelled = 0
if episodes_dir.is_dir():
    for ep_dir in sorted(episodes_dir.iterdir()):
        if not ep_dir.is_dir() or not ep_dir.name.startswith('ep-'):
            continue
        manifest = ep_dir / 'manifest.json'
        if not manifest.exists():
            continue
        data = json.loads(manifest.read_text())
        if data.get('status') not in episode_terminal:
            data['status'] = 'cancelled'
            data['phase'] = 'cancelled'
            manifest.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
            episode_cancelled += 1
            print(f'  Cancelled episode {ep_dir.name}')
else:
    print('No episodes directory')

runs_dir = workspace_root / '.understudy' / 'playbook-runs'
playbook_cancelled = 0
playbook_normalized = 0
if runs_dir.is_dir():
    for run_dir in sorted(runs_dir.iterdir()):
        if not run_dir.is_dir():
            continue
        run_path = run_dir / 'run.json'
        if not run_path.exists():
            continue
        data = json.loads(run_path.read_text())
        changed = False
        status = data.get('status')
        if status not in run_terminal:
            data['status'] = 'cancelled'
            for stage in data.get('stages') or []:
                if stage.get('status') == 'running':
                    stage['status'] = 'failed'
                    stage['updatedAt'] = now_ms
                    changed = True
                elif stage.get('status') == 'pending':
                    stage['status'] = 'skipped'
                    stage['updatedAt'] = now_ms
                    changed = True
            for child in data.get('childSessions') or []:
                if child.get('status') not in child_terminal:
                    child['status'] = 'cancelled'
                    child['updatedAt'] = now_ms
                    changed = True
            playbook_cancelled += 1
            print(f'  Cancelled playbook run {run_dir.name}')
            changed = True
        else:
            for child in data.get('childSessions') or []:
                if child.get('status') not in child_terminal:
                    child['status'] = status
                    child['updatedAt'] = now_ms
                    changed = True
            if changed:
                playbook_normalized += 1
                print(f'  Normalized child sessions for {run_dir.name}')
        if changed:
            data['updatedAt'] = now_ms
            run_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
else:
    print('No playbook runs directory')

print(f'Cancelled {episode_cancelled} non-terminal episode(s)')
print(f'Cancelled {playbook_cancelled} non-terminal playbook run(s)')
print(f'Normalized {playbook_normalized} terminal playbook run(s)')
PY

echo "=== Reset complete ==="
