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


def load_run_inputs(root: Path) -> dict[str, Any]:
    run_path = root.parent / "run.json"
    run_payload = load_json(run_path)
    inputs = run_payload.get("inputs")
    return inputs if isinstance(inputs, dict) else {}


def main() -> int:
    parser = argparse.ArgumentParser(description="Bootstrap Stage 1 artifact folders and manifest.")
    parser.add_argument("root_dir", nargs="?", help="Artifacts root directory for the active playbook run.")
    parser.add_argument(
        "--artifacts-root",
        "--artifacts-root-dir",
        dest="artifacts_root",
        help="Artifacts root directory for the active playbook run.",
    )
    parser.add_argument("--selection-mode")
    parser.add_argument("--app-store-region", "--region", dest="app_store_region")
    parser.add_argument("--target-app")
    parser.add_argument("--target-app-store-url", "--target-url", dest="target_app_store_url")
    parser.add_argument("--allow-apple-id-password-from-env", action="store_true")
    parser.add_argument("--apple-id-password-env-var")
    args = parser.parse_args()

    root_value = args.artifacts_root or args.root_dir
    if not root_value:
        parser.error("the following arguments are required: root_dir")
    root = Path(root_value).expanduser().resolve()
    (root / "topic" / "screenshots").mkdir(parents=True, exist_ok=True)
    (root / "experience" / "screenshots").mkdir(parents=True, exist_ok=True)
    (root / "post" / "assets").mkdir(parents=True, exist_ok=True)
    (root / "publish").mkdir(parents=True, exist_ok=True)
    (root / "experience" / "checkpoints.jsonl").touch()

    episode_id = root.parent.name if root.name == "artifacts" and root.parent.name else root.name

    run_inputs = load_run_inputs(root)

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

    resolved_selection_mode = (
        args.selection_mode
        or run_inputs.get("selectionMode")
        or manifest.get("selectionMode")
        or "today_editorial_free_app"
    )
    resolved_app_store_region = (
        args.app_store_region
        or run_inputs.get("appStoreRegion")
        or manifest.get("appStoreRegion")
    )
    resolved_target_app = (
        args.target_app
        or run_inputs.get("targetApp")
        or manifest.get("requestedTargetApp")
    )
    resolved_target_app_store_url = (
        args.target_app_store_url
        or run_inputs.get("targetAppStoreUrl")
        or manifest.get("requestedTargetAppStoreUrl")
    )

    manifest.update(
        {
            "episodeId": manifest.get("episodeId") or episode_id,
            "status": "discovering",
            "phase": "discovering",
            "selectionMode": resolved_selection_mode,
            "appStoreRegion": resolved_app_store_region,
            "requestedTargetApp": resolved_target_app,
            "requestedTargetAppStoreUrl": resolved_target_app_store_url,
            "allowAppleIdPasswordFromEnv": bool(args.allow_apple_id_password_from_env),
            "appleIdPasswordEnvVar": args.apple_id_password_env_var or manifest.get("appleIdPasswordEnvVar"),
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
                "selectionMode": resolved_selection_mode,
                "appStoreRegion": resolved_app_store_region,
                "requestedTargetApp": resolved_target_app,
                "requestedTargetAppStoreUrl": resolved_target_app_store_url,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
