#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
from pathlib import Path

from crop_mirroring_screenshot import crop_mirroring


SCRIPT_DIR = Path(__file__).resolve().parent
GET_BOUNDS_SCRIPT = SCRIPT_DIR / "get_mirroring_bounds.swift"


def parse_bounds(raw: str) -> tuple[int, int, int, int, int | None]:
    payload = json.loads(raw)
    x = int(payload["x"])
    y = int(payload["y"])
    width = int(payload["width"])
    height = int(payload["height"])
    if width <= 0 or height <= 0:
        raise ValueError("capture bounds must be positive")
    window_id_raw = payload.get("windowId")
    window_id = int(window_id_raw) if window_id_raw is not None else None
    return x, y, width, height, window_id


def resolve_bounds(explicit_bounds_json: str) -> tuple[int, int, int, int, int | None]:
    if explicit_bounds_json.strip():
        return parse_bounds(explicit_bounds_json)

    env_bounds = os.environ.get("BOUNDS_JSON", "").strip()
    if env_bounds:
        return parse_bounds(env_bounds)

    result = subprocess.run(
        ["swift", str(GET_BOUNDS_SCRIPT)],
        check=True,
        capture_output=True,
        text=True,
    )
    return parse_bounds(result.stdout)


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture and crop the iPhone Mirroring window in one step.")
    parser.add_argument("output_path", help="Final cropped screenshot path")
    parser.add_argument("--bounds-json", default="", help="Optional JSON bounds override: {\"x\":..,\"y\":..,\"width\":..,\"height\":..}")
    args = parser.parse_args()

    output_path = Path(args.output_path).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    x, y, width, height, window_id = resolve_bounds(args.bounds_json)

    fd, raw_path = tempfile.mkstemp(prefix="understudy-mirroring-", suffix=".png")
    os.close(fd)

    try:
        capture_cmd = ["screencapture", "-x"]
        if window_id is not None:
            capture_cmd.extend(["-l", str(window_id)])
        else:
            capture_cmd.append(f"-R{x},{y},{width},{height}")
        capture_cmd.append(raw_path)
        try:
            subprocess.run(capture_cmd, check=True)
        except subprocess.CalledProcessError:
            subprocess.run(
                ["screencapture", "-x", f"-R{x},{y},{width},{height}", raw_path],
                check=True,
            )
        crop_mirroring(raw_path, str(output_path))
        print(str(output_path))
        return 0
    finally:
        try:
            os.unlink(raw_path)
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
