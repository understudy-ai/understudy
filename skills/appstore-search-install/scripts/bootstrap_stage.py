#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

EXPECTED_TOPIC_SCREENSHOTS = [
    "topic/screenshots/00-Browser-Today-Recommendation.png",
    "topic/screenshots/01-Browser-App-Detail.png",
    "topic/screenshots/02-iPhone-App-Store-Detail.png",
    "topic/screenshots/03-Home-Screen-With-App.png",
    "topic/screenshots/03-Home-Screen-Blocked-No-App.png",
]


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def main() -> int:
    parser = argparse.ArgumentParser(description="Bootstrap Stage 1 artifact folders and manifest.")
    parser.add_argument("root_dir", help="Artifacts root directory for the active playbook run.")
    parser.add_argument("--selection-mode", default="today_editorial_free_app")
    args = parser.parse_args()

    root = Path(args.root_dir).expanduser().resolve()
    (root / "topic" / "screenshots").mkdir(parents=True, exist_ok=True)
    (root / "experience" / "screenshots").mkdir(parents=True, exist_ok=True)
    (root / "post" / "assets").mkdir(parents=True, exist_ok=True)
    (root / "publish").mkdir(parents=True, exist_ok=True)
    (root / "experience" / "checkpoints.jsonl").touch()

    episode_id = root.parent.name if root.name == "artifacts" and root.parent.name else root.name

    manifest_path = root / "manifest.json"
    manifest = load_json(manifest_path)
    timestamps = manifest.get("timestamps") if isinstance(manifest.get("timestamps"), dict) else {}
    timestamps.setdefault(
        "created",
        datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    )
    existing_artifacts = manifest.get("artifacts") if isinstance(manifest.get("artifacts"), dict) else {}
    existing_screenshots = existing_artifacts.get("topicScreenshots")
    if isinstance(existing_screenshots, list):
        topic_screenshots = [
            str(item)
            for item in existing_screenshots
            if isinstance(item, str) and (root / item).exists()
        ]
    else:
        topic_screenshots = []
    disk_screenshots = [path for path in EXPECTED_TOPIC_SCREENSHOTS if (root / path).exists()]
    for path in disk_screenshots:
        if path not in topic_screenshots:
            topic_screenshots.append(path)

    manifest.update(
        {
            "episodeId": manifest.get("episodeId") or episode_id,
            "status": "discovering",
            "phase": "discovering",
            "selectionMode": args.selection_mode,
            "selectedApp": manifest.get("selectedApp") if isinstance(manifest.get("selectedApp"), dict) else None,
            "timestamps": timestamps,
            "artifacts": {
                **existing_artifacts,
                "topicScreenshots": topic_screenshots,
            },
        }
    )
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

    print(
        json.dumps(
            {
                "root": str(root),
                "manifest": str(manifest_path),
                "selectionMode": args.selection_mode,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
