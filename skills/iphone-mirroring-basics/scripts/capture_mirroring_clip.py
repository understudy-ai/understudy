#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from crop_mirroring_screenshot import (
    INSET_BOTTOM,
    INSET_LEFT,
    INSET_RIGHT,
    INSET_TOP,
)


SCRIPT_DIR = Path(__file__).resolve().parent
GET_BOUNDS_SCRIPT = SCRIPT_DIR / "get_mirroring_bounds.swift"


def resolve_binary(name: str) -> str:
    candidate = shutil.which(name)
    if candidate:
        return candidate
    local = Path.home() / ".local" / "bin" / name
    if local.exists():
        return str(local)
    raise FileNotFoundError(f"{name} not found")


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


def crop_filter() -> str:
    width_scale = 1.0 - INSET_LEFT - INSET_RIGHT
    height_scale = 1.0 - INSET_TOP - INSET_BOTTOM
    return (
        f"crop="
        f"w=floor(iw*{width_scale:.6f}):"
        f"h=floor(ih*{height_scale:.6f}):"
        f"x=floor(iw*{INSET_LEFT:.6f}):"
        f"y=floor(ih*{INSET_TOP:.6f})"
    )


def transcode_crop(raw_path: str, output_path: Path) -> None:
    ffmpeg = resolve_binary("ffmpeg")
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-i",
            raw_path,
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-vf",
            crop_filter(),
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "copy",
            "-movflags",
            "+faststart",
            str(output_path),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def record_raw_clip(raw_path: str, duration: int, window_id: int | None, rect: tuple[int, int, int, int]) -> None:
    x, y, width, height = rect
    capture_cmd = ["screencapture", "-x"]
    if window_id is not None:
        capture_cmd.extend(["-l", str(window_id)])
    else:
        capture_cmd.append(f"-R{x},{y},{width},{height}")
    capture_cmd.extend(["-V", str(duration), raw_path])
    try:
        subprocess.run(capture_cmd, check=True)
    except subprocess.CalledProcessError:
        subprocess.run(
            ["screencapture", "-x", f"-R{x},{y},{width},{height}", "-V", str(duration), raw_path],
            check=True,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Record and crop the iPhone Mirroring window into a clean clip.")
    parser.add_argument("output_path", help="Final cropped clip path")
    parser.add_argument("--duration", type=int, default=15, help="Clip duration in seconds")
    parser.add_argument("--bounds-json", default="", help="Optional JSON bounds override")
    args = parser.parse_args()

    duration = max(1, min(int(args.duration), 60))
    output_path = Path(args.output_path).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    x, y, width, height, window_id = resolve_bounds(args.bounds_json)

    fd, raw_fd_path = tempfile.mkstemp(prefix="understudy-mirroring-", suffix=".mov")
    os.close(fd)
    os.unlink(raw_fd_path)
    raw_path = raw_fd_path

    try:
        record_raw_clip(raw_path, duration, window_id, (x, y, width, height))
        try:
            transcode_crop(raw_path, output_path)
        except Exception:
            shutil.copy2(raw_path, output_path)
        print(str(output_path))
        return 0
    finally:
        try:
            os.unlink(raw_path)
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
