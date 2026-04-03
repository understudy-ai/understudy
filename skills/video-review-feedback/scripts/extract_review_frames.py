#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

DEFAULT_FRAME_COUNT = 8
CONTACT_SHEET_COLUMNS = 2
CELL_W = 720
CELL_H = 405
PADDING = 32
LABEL_H = 40
BG = (10, 16, 24)
PANEL = (24, 34, 48)
TEXT = (238, 243, 248)
MUTED = (146, 160, 176)
FRAME_IMAGE_EXT = ".png"
FONT_PATHS = [
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/HelveticaNeue.ttc",
]


def choose_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_PATHS:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


FONT = choose_font(24)
SMALL_FONT = choose_font(20)


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def ffprobe_media(video_path: Path) -> dict[str, object]:
    output = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=index,codec_type,duration,nb_frames,width,height,avg_frame_rate",
            "-of",
            "json",
            str(video_path),
        ],
        text=True,
    )
    payload = json.loads(output)
    streams = payload.get("streams")
    stream_list = streams if isinstance(streams, list) else []

    def parse_duration(raw: object) -> float | None:
        try:
            value = float(raw)
        except (TypeError, ValueError):
            return None
        return value if value > 0 else None

    format_info = payload.get("format")
    format_duration = parse_duration(format_info.get("duration") if isinstance(format_info, dict) else None)

    video_stream = next(
        (stream for stream in stream_list if isinstance(stream, dict) and stream.get("codec_type") == "video"),
        {},
    )
    audio_stream = next(
        (stream for stream in stream_list if isinstance(stream, dict) and stream.get("codec_type") == "audio"),
        {},
    )

    video_duration = parse_duration(video_stream.get("duration") if isinstance(video_stream, dict) else None)
    audio_duration = parse_duration(audio_stream.get("duration") if isinstance(audio_stream, dict) else None)

    chosen_duration = video_duration or format_duration or audio_duration or 0.0
    duration_warning = None
    if video_duration and audio_duration and abs(audio_duration - video_duration) > 0.75:
        duration_warning = (
            f"Audio/video duration mismatch: video={video_duration:.2f}s, audio={audio_duration:.2f}s."
        )

    return {
        "chosenDurationSec": chosen_duration,
        "formatDurationSec": format_duration,
        "videoDurationSec": video_duration,
        "audioDurationSec": audio_duration,
        "videoWidth": video_stream.get("width") if isinstance(video_stream, dict) else None,
        "videoHeight": video_stream.get("height") if isinstance(video_stream, dict) else None,
        "videoFrameCount": video_stream.get("nb_frames") if isinstance(video_stream, dict) else None,
        "durationWarning": duration_warning,
    }


def build_timestamps(duration: float, count: int) -> list[float]:
    if duration <= 0.5:
        return [0.0]
    count = max(1, count)
    margin = min(2.5, max(0.8, duration * 0.05))
    if duration <= margin * 2:
        return [round(duration / 2, 2)]
    usable = duration - margin * 2
    if count == 1:
        return [round(duration / 2, 2)]
    return [round(margin + (usable * index / (count - 1)), 2) for index in range(count)]


def load_slide_timeline(root: Path) -> list[dict[str, object]]:
    manifest_path = root / "post" / "assets" / "video-build" / "manifest.json"
    if not manifest_path.exists():
        return []
    try:
        payload = json.loads(manifest_path.read_text())
    except json.JSONDecodeError:
        return []
    slides = payload.get("slides")
    if not isinstance(slides, list):
        return []
    timeline: list[dict[str, object]] = []
    for item in slides:
        if not isinstance(item, dict):
            continue
        midpoint = item.get("midpointSec")
        slide = item.get("slide")
        if isinstance(midpoint, (int, float)) and slide:
            timeline.append(
                {
                    "slide": str(slide),
                    "timestampSec": round(float(midpoint), 2),
                }
            )
    return timeline


def clamp_timestamp(timestamp: float, duration: float) -> float:
    if duration <= 0:
        return 0.0
    return round(min(max(timestamp, 0.0), max(duration - 0.75, 0.0)), 2)


def extract_frame(video_path: Path, out_path: Path, timestamp: float) -> None:
    run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-ss",
            f"{timestamp:.2f}",
            "-i",
            str(video_path),
            "-frames:v",
            "1",
            str(out_path),
        ]
    )
    if not out_path.exists() or out_path.stat().st_size == 0:
        raise RuntimeError(f"ffmpeg did not produce frame output for {out_path.name} at {timestamp:.2f}s")


def contain_size(src_w: int, src_h: int, dst_w: int, dst_h: int) -> tuple[int, int]:
    ratio = min(dst_w / src_w, dst_h / src_h)
    return max(1, int(src_w * ratio)), max(1, int(src_h * ratio))


def build_contact_sheet(frame_entries: list[dict[str, object]], out_path: Path) -> None:
    rows = math.ceil(len(frame_entries) / CONTACT_SHEET_COLUMNS)
    width = PADDING * (CONTACT_SHEET_COLUMNS + 1) + CELL_W * CONTACT_SHEET_COLUMNS
    height = PADDING * (rows + 1) + rows * (CELL_H + LABEL_H)
    sheet = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(sheet)

    for index, entry in enumerate(frame_entries):
        row = index // CONTACT_SHEET_COLUMNS
        col = index % CONTACT_SHEET_COLUMNS
        x = PADDING + col * (CELL_W + PADDING)
        y = PADDING + row * (CELL_H + LABEL_H + PADDING)
        draw.rounded_rectangle((x, y, x + CELL_W, y + CELL_H + LABEL_H), radius=24, fill=PANEL)
        img = Image.open(entry["path"]).convert("RGB")
        new_w, new_h = contain_size(img.width, img.height, CELL_W - 24, CELL_H - 24)
        img = img.resize((new_w, new_h), Image.LANCZOS)
        paste_x = x + (CELL_W - new_w) // 2
        paste_y = y + (CELL_H - new_h) // 2
        sheet.paste(img, (paste_x, paste_y))

        label = f"{entry['frameId']}  {entry['timestampSec']:.2f}s"
        note = Path(str(entry["path"])).name
        draw.text((x + 20, y + CELL_H + 8), label, font=FONT, fill=TEXT)
        draw.text((x + 20, y + CELL_H + 8 + 24), note, font=SMALL_FONT, fill=MUTED)

    sheet.save(out_path, quality=90)


def main(root_dir: str) -> None:
    root = Path(root_dir).expanduser().resolve()
    video_path = root / "post" / "final-video.mp4"
    if not video_path.exists():
        raise SystemExit(f"Missing video: {video_path}")

    review_dir = root / "review"
    frames_dir = review_dir / "keyframes"
    frames_dir.mkdir(parents=True, exist_ok=True)

    media = ffprobe_media(video_path)
    duration = float(media.get("chosenDurationSec") or 0.0)
    if duration <= 0:
        raise SystemExit(f"Could not determine a positive video duration for: {video_path}")
    frame_entries: list[dict[str, object]] = []
    slide_timeline = load_slide_timeline(root)

    if slide_timeline:
        timestamp_entries = slide_timeline
    else:
        timestamp_entries = [
            {"timestampSec": timestamp, "slide": None}
            for timestamp in build_timestamps(duration, DEFAULT_FRAME_COUNT)
        ]

    for index, entry in enumerate(timestamp_entries, start=1):
        frame_id = f"{index:02d}"
        requested_timestamp = float(entry["timestampSec"])
        timestamp = clamp_timestamp(requested_timestamp, duration)
        frame_path = frames_dir / f"{frame_id}-{timestamp:05.2f}s{FRAME_IMAGE_EXT}"
        extracted = False
        candidate_timestamp = timestamp
        for backoff in (0.0, 0.35, 0.75, 1.25, 1.75):
            candidate_timestamp = clamp_timestamp(timestamp - backoff, duration)
            frame_path = frames_dir / f"{frame_id}-{candidate_timestamp:05.2f}s{FRAME_IMAGE_EXT}"
            try:
                extract_frame(video_path, frame_path, candidate_timestamp)
            except Exception:
                continue
            extracted = True
            break
        if not extracted:
            raise RuntimeError(
                f"Unable to extract frame {frame_id} near {requested_timestamp:.2f}s from {video_path.name}"
            )
        frame_entries.append(
            {
                "frameId": frame_id,
                "timestampSec": candidate_timestamp,
                "slide": entry.get("slide"),
                "path": str(frame_path),
            }
        )

    contact_sheet_path = frames_dir / "contact-sheet.jpg"
    build_contact_sheet(frame_entries, contact_sheet_path)

    manifest = {
        "video": str(video_path),
        "durationSec": round(duration, 2),
        "formatDurationSec": round(float(media.get("formatDurationSec") or 0.0), 2)
        if media.get("formatDurationSec")
        else None,
        "videoDurationSec": round(float(media.get("videoDurationSec") or 0.0), 2)
        if media.get("videoDurationSec")
        else None,
        "audioDurationSec": round(float(media.get("audioDurationSec") or 0.0), 2)
        if media.get("audioDurationSec")
        else None,
        "videoWidth": media.get("videoWidth"),
        "videoHeight": media.get("videoHeight"),
        "videoFrameCount": media.get("videoFrameCount"),
        "durationWarning": media.get("durationWarning"),
        "frameCount": len(frame_entries),
        "frames": frame_entries,
        "contactSheet": str(contact_sheet_path),
    }
    manifest_path = frames_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: extract_review_frames.py <artifacts-root-dir>")
    main(sys.argv[1])
