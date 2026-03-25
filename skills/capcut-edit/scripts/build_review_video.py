#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

FPS = 30
CRF = "18"
PRESET = "medium"
BASE_SLIDE_SPECS = [
    ("title-card.png", 2.6),
    ("store-promise-card.png", 2.8),
    ("first-impression-card.png", 4.0),
    ("core-task-card.png", 4.6),
    ("outcome-card.png", 4.6),
    ("secondary-proof-card.png", 4.0),
    ("scorecard.png", 3.0),
    ("verdict-card.png", 3.2),
]
SLIDE_PRIORITY = {
    "title-card.png": 0.76,
    "store-promise-card.png": 0.82,
    "first-impression-card.png": 1.08,
    "core-task-card.png": 1.24,
    "outcome-card.png": 1.26,
    "secondary-proof-card.png": 1.06,
    "scorecard.png": 0.88,
    "verdict-card.png": 0.94,
}


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def ffprobe_duration(path: Path) -> float:
    output = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(path),
        ],
        text=True,
    )
    payload = json.loads(output)
    return float(payload["format"]["duration"])


def ffprobe_export_summary(path: Path) -> dict[str, float | None]:
    output = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration,size:stream=codec_type,duration",
            "-of",
            "json",
            str(path),
        ],
        text=True,
    )
    payload = json.loads(output)
    streams = payload.get("streams")
    stream_list = streams if isinstance(streams, list) else []
    format_info = payload.get("format") if isinstance(payload.get("format"), dict) else {}

    def parse_duration(raw: object) -> float | None:
        try:
            value = float(raw)
        except (TypeError, ValueError):
            return None
        return value if value > 0 else None

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
    format_duration = parse_duration(format_info.get("duration"))
    size_bytes = None
    try:
        size_bytes = float(format_info.get("size"))
    except (TypeError, ValueError):
        size_bytes = None

    return {
        "formatDurationSec": format_duration,
        "videoDurationSec": video_duration,
        "audioDurationSec": audio_duration,
        "durationGapSec": abs(audio_duration - video_duration) if video_duration and audio_duration else None,
        "sizeBytes": size_bytes,
    }


def slide_specs_for_assets(assets: Path) -> list[tuple[str, float]]:
    specs: list[tuple[str, float]] = []
    for name, duration in BASE_SLIDE_SPECS:
        if not (assets / name).exists():
            continue
        specs.append((name, duration))
    return specs


def read_narration_lines(assets: Path) -> list[str]:
    for name in ["voiceover-script.txt", "narration.txt"]:
        path = assets / name
        if path.exists():
            return [line.strip() for line in path.read_text().splitlines() if line.strip()]
    return []


def estimate_line_weight(line: str) -> float:
    words = len(re.findall(r"[A-Za-z0-9']+", line))
    cjk_chars = len(re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff]", line))
    pauses = len(re.findall(r"[,:;.!?]", line))
    return max(1.0, words * 1.0 + (cjk_chars / 3.5) + pauses * 0.4)


def narration_weights(slide_count: int, lines: list[str]) -> list[float]:
    if slide_count <= 0:
        return []
    if not lines:
        return [1.0] * slide_count
    weights = [0.6] * slide_count
    line_count = len(lines)
    for index, line in enumerate(lines):
        slide_index = min(
            slide_count - 1,
            max(0, ((index + 1) * slide_count - 1) // line_count),
        )
        weights[slide_index] += estimate_line_weight(line)
    return weights


def rebalance_with_clamps(
    durations: list[float],
    target_total: float,
    *,
    min_duration: float,
    max_duration: float,
    priority_weights: list[float],
) -> list[float]:
    durations = [min(max(value, min_duration), max_duration) for value in durations]
    diff = round(target_total - sum(durations), 4)
    if abs(diff) < 0.05:
        return [round(value, 2) for value in durations]

    adjustable_indices = list(range(len(durations)))
    if not adjustable_indices:
        return [round(value, 2) for value in durations]

    normalized_priorities = [max(weight, 0.01) for weight in priority_weights]
    priority_total = sum(normalized_priorities)
    normalized_priorities = [weight / priority_total for weight in normalized_priorities]

    for index in adjustable_indices:
        room = (max_duration - durations[index]) if diff > 0 else (durations[index] - min_duration)
        if room <= 0:
            continue
        share = diff * normalized_priorities[index]
        delta = max(-room, min(room, share))
        durations[index] += delta

    remaining = round(target_total - sum(durations), 4)
    if abs(remaining) >= 0.05:
        ordered = sorted(
            adjustable_indices,
            key=lambda index: normalized_priorities[index],
            reverse=(remaining > 0),
        )
        for index in ordered:
            room = (max_duration - durations[index]) if remaining > 0 else (durations[index] - min_duration)
            if room <= 0:
                continue
            delta = max(-room, min(room, remaining))
            durations[index] += delta
            remaining = round(target_total - sum(durations), 4)
            if abs(remaining) < 0.05:
                break

    return [round(value, 2) for value in durations]


def scaled_durations(slide_specs: list[tuple[str, float]], voiceover: Path | None, assets: Path) -> list[float]:
    base_total = sum(duration for _, duration in slide_specs)
    base_durations = [duration for _, duration in slide_specs]
    target_total = base_total
    if voiceover and voiceover.exists():
        min_total = max(len(slide_specs) * 3.0, 25.2)
        target_total = max(min_total, ffprobe_duration(voiceover) + 0.45)
    if not voiceover or not voiceover.exists():
        scale = target_total / base_total
        return [round(duration * scale, 2) for duration in base_durations]

    lines = read_narration_lines(assets)
    base_weights = [
        (duration * SLIDE_PRIORITY.get(name, 1.0)) / base_total
        for (name, duration) in slide_specs
    ]
    base_weight_total = sum(base_weights) or 1.0
    base_weights = [weight / base_weight_total for weight in base_weights]
    speech_weights = narration_weights(len(slide_specs), lines)
    speech_total = sum(speech_weights) or 1.0
    speech_weights = [weight / speech_total for weight in speech_weights]

    combined_weights = [
        (base_weights[index] * 0.45) + (speech_weights[index] * 0.55)
        for index in range(len(slide_specs))
    ]
    durations = [target_total * weight for weight in combined_weights]
    # Scale clamps proportionally when the target exceeds the base range
    # so that longer voiceovers (e.g., 3-minute videos) can distribute
    # duration across slides without hitting a hard ceiling.
    slide_count = len(slide_specs)
    min_per_slide = max(2.35, target_total / slide_count * 0.35)
    max_per_slide = max(5.8, target_total / slide_count * 1.65)
    return rebalance_with_clamps(
        durations,
        target_total,
        min_duration=round(min_per_slide, 2),
        max_duration=round(max_per_slide, 2),
        priority_weights=combined_weights,
    )


def crop_expression(index: int, duration: float) -> tuple[str, str]:
    dx = "(iw-1080)"
    dy = "(ih-1920)"
    progress = f"(t/{duration:.2f})"
    variants = [
        (f"({dx})*0.15*{progress}", f"({dy})*0.10*{progress}"),
        (f"({dx})*0.18*(1-{progress})", f"({dy})*0.08*{progress}"),
        (f"({dx})*0.10*{progress}", f"({dy})*0.16*(1-{progress})"),
        (f"({dx})*0.16*(1-{progress})", f"({dy})*0.14*(1-{progress})"),
    ]
    return variants[index % len(variants)]


def build_segment(slide: Path, out_path: Path, duration: float, index: int) -> None:
    fade_out_start = max(duration - 0.22, 0.01)
    crop_x, crop_y = crop_expression(index, duration)
    vf = (
        "scale=1128:2006,"
        f"crop=1080:1920:x='{crop_x}':y='{crop_y}',"
        f"fps={FPS},"
        "format=yuv420p,"
        "fade=t=in:st=0:d=0.14,"
        f"fade=t=out:st={fade_out_start:.2f}:d=0.18"
    )
    run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-loop",
            "1",
            "-t",
            f"{duration:.2f}",
            "-i",
            str(slide),
            "-vf",
            vf,
            "-r",
            str(FPS),
            "-c:v",
            "libx264",
            "-preset",
            PRESET,
            "-crf",
            CRF,
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(out_path),
        ]
    )


def main(root_dir: str) -> None:
    root = Path(root_dir).expanduser().resolve()
    assets = root / "post" / "assets"
    if not assets.exists():
        raise SystemExit(f"Missing assets directory: {assets}")

    slide_specs = slide_specs_for_assets(assets)
    slides = [assets / name for name, _ in slide_specs]
    missing = [str(path) for path in slides if not path.exists()]
    if missing:
        raise SystemExit(f"Missing slide assets: {missing}")

    voiceover = assets / "voiceover.aiff"
    durations = scaled_durations(slide_specs, voiceover if voiceover.exists() else None, assets)

    build_dir = assets / "video-build"
    if build_dir.exists():
        shutil.rmtree(build_dir)
    build_dir.mkdir(parents=True, exist_ok=True)

    timeline = []
    cursor = 0.0
    for (name, _), duration in zip(slide_specs, durations):
        timeline.append(
            {
                "slide": name,
                "startSec": round(cursor, 2),
                "durationSec": round(duration, 2),
                "midpointSec": round(cursor + duration / 2, 2),
            }
        )
        cursor += duration
    (build_dir / "manifest.json").write_text(
        json.dumps({"slides": timeline}, indent=2, ensure_ascii=False) + "\n"
    )

    segment_paths: list[Path] = []
    for index, (slide, duration) in enumerate(zip(slides, durations)):
        segment_path = build_dir / f"segment-{index+1:02d}.mp4"
        build_segment(slide, segment_path, duration, index)
        segment_paths.append(segment_path)

    concat_path = assets / "concat.txt"
    concat_lines = ["ffconcat version 1.0"]
    for segment_path in segment_paths:
        concat_lines.append(f"file '{segment_path}'")
    concat_path.write_text("\n".join(concat_lines) + "\n")

    stitched = build_dir / "stitched.mp4"
    final_video = root / "post" / "final-video.mp4"
    if stitched.exists():
        stitched.unlink()
    if final_video.exists():
        final_video.unlink()

    run(
        [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_path),
            "-r",
            str(FPS),
            "-c:v",
            "libx264",
            "-preset",
            PRESET,
            "-crf",
            CRF,
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(stitched),
        ]
    )

    if voiceover.exists():
        stitched_duration = sum(durations)
        run(
            [
                "ffmpeg",
                "-y",
                "-v",
                "error",
                "-i",
                str(stitched),
                "-i",
                str(voiceover),
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
                "-af",
                f"apad=pad_dur={max(2.0, stitched_duration):.2f}",
                "-shortest",
                "-movflags",
                "+faststart",
                str(final_video),
            ]
        )
    else:
        shutil.move(stitched, final_video)

    export_summary = ffprobe_export_summary(final_video)
    duration_gap = export_summary.get("durationGapSec")
    if isinstance(duration_gap, float) and duration_gap > 0.75:
        raise SystemExit(
            f"Exported MP4 has an audio/video duration mismatch of {duration_gap:.2f}s; treat this render as invalid."
        )
    duration = ffprobe_duration(final_video)
    print(
        json.dumps(
            {
                "video": str(final_video),
                "duration": duration,
                "voiceover": voiceover.exists(),
                "slides": [name for name, _ in slide_specs],
                "videoDurationSec": export_summary.get("videoDurationSec"),
                "audioDurationSec": export_summary.get("audioDurationSec"),
                "durationGapSec": export_summary.get("durationGapSec"),
            }
        )
    )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: build_review_video.py <artifacts-root-dir>")
    main(sys.argv[1])
