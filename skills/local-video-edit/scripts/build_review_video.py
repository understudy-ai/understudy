#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

FPS = 30
CRF = "18"
PRESET = "medium"
BEAT_RENDER_SPECS = {
    "opening-overlay": {"card": "title-card.png", "duration": 1.8, "priority": 0.78, "prefer_proof": False},
    "context-beat": {"card": "store-promise-card.png", "duration": 2.0, "priority": 0.84, "prefer_proof": False},
    "first-impression": {"card": "first-impression-card.png", "duration": 3.2, "priority": 0.92, "prefer_proof": True},
    "core-task": {"card": "core-task-card.png", "duration": 5.4, "priority": 1.26, "prefer_proof": True},
    "outcome": {"card": "outcome-card.png", "duration": 5.6, "priority": 1.32, "prefer_proof": True},
    "secondary-proof": {"card": "secondary-proof-card.png", "duration": 4.6, "priority": 1.1, "prefer_proof": True},
    "verdict": {"card": "verdict-card.png", "duration": 2.1, "priority": 0.74, "prefer_proof": True},
}
LEGACY_SLIDE_SPECS = [
    ("title-card.png", 1.8),
    ("store-promise-card.png", 2.0),
    ("first-impression-card.png", 4.0),
    ("core-task-card.png", 5.0),
    ("outcome-card.png", 5.0),
    ("secondary-proof-card.png", 4.0),
    ("verdict-card.png", 2.2),
]
SLIDE_PRIORITY = {
    "title-card.png": 0.76,
    "store-promise-card.png": 0.82,
    "first-impression-card.png": 0.96,
    "core-task-card.png": 1.24,
    "outcome-card.png": 1.26,
    "secondary-proof-card.png": 1.06,
    "verdict-card.png": 0.72,
}
CARD_ROLE_BY_NAME = {
    "title-card.png": "opening-overlay",
    "store-promise-card.png": "context-beat",
    "first-impression-card.png": "first-impression",
    "core-task-card.png": "core-task",
    "outcome-card.png": "outcome",
    "secondary-proof-card.png": "secondary-proof",
    "verdict-card.png": "verdict",
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
    duration = payload.get("format", {}).get("duration") if isinstance(payload, dict) else None
    if duration is None:
        raise ValueError(f"ffprobe did not report duration for {path}")
    return float(duration)


def audio_duration(path: Path) -> float:
    try:
        return ffprobe_duration(path)
    except Exception:
        pass
    try:
        output = subprocess.check_output(["afinfo", str(path)], text=True, stderr=subprocess.STDOUT)
    except Exception as exc:
        raise ValueError(f"Could not determine audio duration for {path}") from exc
    match = re.search(r"estimated duration:\s*([0-9]+(?:\.[0-9]+)?)\s*sec", output)
    if not match:
        raise ValueError(f"afinfo did not report duration for {path}")
    return float(match.group(1))


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


def read_json(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text())
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def slide_role(path: Path) -> str:
    name = path.name
    role = CARD_ROLE_BY_NAME.get(name)
    if role:
        return role
    if name.startswith("proof-"):
        stem = Path(name).stem[len("proof-") :]
        for beat_id in BEAT_RENDER_SPECS:
            if stem.startswith(beat_id):
                return beat_id
    if name.startswith("extra-"):
        return "secondary-proof"
    return "generic-proof" if path.suffix.lower() in {".mov", ".mp4"} else "generic-card"


def prepare_source_asset(root: Path, assets: Path, source: str, beat_id: str) -> Path | None:
    raw = source.strip()
    if not raw:
        return None
    src = root / raw
    if not src.exists():
        return None
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(raw).name)
    if src.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
        dest = assets / f"proof-{beat_id}-{Path(safe_name).stem}.png"
        if not dest.exists():
            _prepare_phone_slide(src, dest)
        return dest if dest.exists() else None
    if src.suffix.lower() in {".mov", ".mp4"}:
        dest = assets / f"proof-{beat_id}-{safe_name}"
        if not dest.exists():
            shutil.copy2(src, dest)
        return dest if dest.exists() else None
    return None


def slide_specs_from_manifest(root: Path, assets: Path) -> list[tuple[Path, float]]:
    manifest = read_json(root / "post" / "video-edit-manifest.json")
    beats = manifest.get("beats")
    if not isinstance(beats, list):
        return []

    specs: list[tuple[Path, float]] = []
    used_sources: set[str] = set()
    for beat in beats:
        if not isinstance(beat, dict):
            continue
        beat_id = str(beat.get("id") or "").strip()
        config = BEAT_RENDER_SPECS.get(beat_id)
        if not config:
            continue
        source = str(beat.get("source") or "").strip()
        allow_reuse = str(beat.get("reusePrevious") or "").strip().lower() == "true"
        asset: Path | None = None
        if config.get("prefer_proof") and source and (allow_reuse or source not in used_sources):
            asset = prepare_source_asset(root, assets, source, beat_id)
            if asset is not None:
                if not allow_reuse:
                    used_sources.add(source)
        if asset is None:
            card_name = str(config.get("card") or "").strip()
            card_path = assets / card_name if card_name else None
            if card_path and card_path.exists():
                asset = card_path
        if asset is None and source and (allow_reuse or source not in used_sources):
            asset = prepare_source_asset(root, assets, source, beat_id)
            if asset is not None:
                if not allow_reuse:
                    used_sources.add(source)
        if asset is None:
            continue
        specs.append((asset, float(config.get("duration") or 4.0)))
    return specs


def slide_specs_for_assets(root: Path, assets: Path) -> list[tuple[Path, float]]:
    manifest_specs = slide_specs_from_manifest(root, assets)
    if manifest_specs:
        return manifest_specs

    specs: list[tuple[Path, float]] = []
    for name, duration in LEGACY_SLIDE_SPECS:
        if not (assets / name).exists():
            continue
        specs.append((assets / name, duration))

    # Discover additional phone screenshots that weren't used by rendered cards.
    # These get inserted before the closing verdict to add visual evidence.
    experience_dir = assets.parent.parent / "experience" / "screenshots"
    if experience_dir.exists():
        # Rendered cards already cover: first-impression, core-task, outcome, secondary-proof
        # Find screenshots beyond those that aren't already represented
        used_prefixes = {"01-", "02-", "03-", "04-"}  # covered by base cards
        extra_shots = sorted([
            f for f in experience_dir.glob("*.png")
            if not any(f.name.startswith(p) for p in used_prefixes)
        ])
        # Insert extras before the closing verdict
        insert_idx = len(specs)
        for i, (path, _) in enumerate(specs):
            if path.name == "verdict-card.png":
                insert_idx = i
                break

        for shot in extra_shots[:8]:  # cap at 8 extra to keep video reasonable
            # Copy to assets dir for the ffmpeg pipeline
            dest = assets / f"extra-{shot.name}"
            if not dest.exists():
                _prepare_phone_slide(shot, dest)
            if dest.exists():
                specs.insert(insert_idx, (dest, 3.5))
                insert_idx += 1

    clip_dir = assets.parent.parent / "experience" / "clips"
    if clip_dir.exists():
        clips = sorted([path for path in clip_dir.glob("*.mov") if path.is_file()]) + sorted(
            [path for path in clip_dir.glob("*.mp4") if path.is_file()]
        )
        if clips:
            insert_idx = len(specs)
            for i, (path, _) in enumerate(specs):
                if path.name == "outcome-card.png":
                    insert_idx = i
                    break
            for clip in clips[:2]:
                dest = assets / f"proof-{clip.name}"
                if not dest.exists():
                    shutil.copy2(clip, dest)
                try:
                    duration = max(4.8, min(9.5, ffprobe_duration(dest)))
                except Exception:
                    duration = 6.5
                specs.insert(insert_idx, (dest, duration))
                insert_idx += 1

    return specs


def _prepare_phone_slide(src: Path, dest: Path) -> None:
    """Frame a raw phone screenshot as a 1080x1920 slide with dark background."""
    try:
        from PIL import Image, ImageDraw

        phone = Image.open(src).convert("RGB")
        pw, ph = phone.size

        # Create 1080x1920 dark background
        bg = Image.new("RGB", (1080, 1920), (13, 25, 40))

        # Scale phone image to fit with padding
        max_w, max_h = 900, 1600
        scale = min(max_w / pw, max_h / ph)
        new_w, new_h = int(pw * scale), int(ph * scale)
        phone_resized = phone.resize((new_w, new_h), Image.LANCZOS)

        # Center on background
        x = (1080 - new_w) // 2
        y = (1920 - new_h) // 2
        bg.paste(phone_resized, (x, y))

        # Subtle rounded border
        draw = ImageDraw.Draw(bg)
        draw.rectangle([x - 2, y - 2, x + new_w + 1, y + new_h + 1],
                       outline=(60, 80, 100), width=2)

        bg.save(dest)
    except Exception:
        pass  # If Pillow fails, skip this slide


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
    min_durations: list[float],
    max_durations: list[float],
    priority_weights: list[float],
) -> list[float]:
    durations = [
        min(max(value, min_durations[index]), max_durations[index])
        for index, value in enumerate(durations)
    ]
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
        room = (
            max_durations[index] - durations[index]
            if diff > 0
            else durations[index] - min_durations[index]
        )
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
            room = (
                max_durations[index] - durations[index]
                if remaining > 0
                else durations[index] - min_durations[index]
            )
            if room <= 0:
                continue
            delta = max(-room, min(room, remaining))
            durations[index] += delta
            remaining = round(target_total - sum(durations), 4)
            if abs(remaining) < 0.05:
                break

    return [round(value, 2) for value in durations]


def role_duration_bounds(role: str, path: Path) -> tuple[float, float]:
    is_motion = path.suffix.lower() in {".mov", ".mp4"}
    if role == "opening-overlay":
        return (1.4, 4.2 if is_motion else 3.2)
    if role == "context-beat":
        return (1.2, 2.8)
    if role == "first-impression":
        return (2.2, 4.8 if is_motion else 4.2)
    if role == "core-task":
        return (5.6 if is_motion else 4.4, 15.0 if is_motion else 9.0)
    if role == "outcome":
        return (4.4, 10.5 if is_motion else 8.5)
    if role == "secondary-proof":
        return (3.4, 7.2 if is_motion else 6.0)
    if role == "verdict":
        return (1.5, 3.6 if is_motion else 2.8)
    if is_motion:
        return (4.0, 9.0)
    return (2.4, 5.2)


def scaled_durations(slide_specs: list[tuple[Path, float]], voiceover: Path | None, assets: Path) -> list[float]:
    base_total = sum(duration for _, duration in slide_specs)
    base_durations = [duration for _, duration in slide_specs]
    target_total = base_total
    if voiceover and voiceover.exists():
        min_total = max(len(slide_specs) * 3.0, 25.2)
        target_total = max(min_total, audio_duration(voiceover) + 0.45)
    if not voiceover or not voiceover.exists():
        scale = target_total / base_total
        return [round(duration * scale, 2) for duration in base_durations]

    lines = read_narration_lines(assets)
    base_weights = [
        (duration * SLIDE_PRIORITY.get(path.name, 1.12 if path.suffix.lower() in {".mov", ".mp4"} else 1.0)) / base_total
        for (path, duration) in slide_specs
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
    min_durations: list[float] = []
    max_durations: list[float] = []
    for path, _ in slide_specs:
        role = slide_role(path)
        min_duration, max_duration = role_duration_bounds(role, path)
        min_durations.append(min_duration)
        max_durations.append(max_duration)

    max_total = sum(max_durations)
    if target_total > max_total and max_total > 0:
        proof_indices = [
            index
            for index, (path, _) in enumerate(slide_specs)
            if slide_role(path) in {"core-task", "outcome", "secondary-proof", "generic-proof"}
        ]
        proof_share = (target_total - max_total) / max(1, len(proof_indices))
        for index in proof_indices:
            max_durations[index] = round(max_durations[index] + proof_share, 2)

    return rebalance_with_clamps(
        durations,
        target_total,
        min_durations=[round(value, 2) for value in min_durations],
        max_durations=[round(value, 2) for value in max_durations],
        priority_weights=combined_weights,
    )


def build_segment(slide: Path, out_path: Path, duration: float, index: int) -> None:
    fade_out_start = max(duration - 0.22, 0.01)
    vf = (
        "scale=1100:1956,"
        "crop=1080:1920:x='(iw-1080)/2':y='(ih-1920)/2',"
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


def detect_phone_region(clip: Path) -> tuple[int, int, int, int] | None:
    try:
        from PIL import Image, ImageFilter
    except Exception:
        return None

    with tempfile.TemporaryDirectory(prefix="understudy-phone-crop-") as temp_dir:
        frame_path = Path(temp_dir) / "frame.png"
        try:
            run(
                [
                    "ffmpeg",
                    "-y",
                    "-v",
                    "error",
                    "-ss",
                    "1.0",
                    "-i",
                    str(clip),
                    "-frames:v",
                    "1",
                    str(frame_path),
                ]
            )
        except Exception:
            return None
        if not frame_path.exists():
            return None

        frame = Image.open(frame_path).convert("L")
        width, height = frame.size
        if width <= height:
            return None

        edges = frame.filter(ImageFilter.FIND_EDGES)
        pixels = edges.load()
        y1 = int(height * 0.08)
        y2 = int(height * 0.92)
        x1 = int(width * 0.12)
        x2 = int(width * 0.88)

        col_scores: list[float] = []
        for x in range(width):
            total = 0
            for y in range(y1, y2):
                total += pixels[x, y]
            col_scores.append(total / max(1, y2 - y1))

        min_phone_w = max(90, int(width * 0.10))
        max_phone_w = min(int(width * 0.42), int(height * 0.56))
        center_x = width / 2
        left_candidates = sorted(
            range(x1, int(center_x)),
            key=lambda x: col_scores[x],
            reverse=True,
        )[:20]
        right_candidates = sorted(
            range(int(center_x), x2),
            key=lambda x: col_scores[x],
            reverse=True,
        )[:20]
        best_pair: tuple[int, int] | None = None
        best_score = -1.0
        for left in left_candidates:
            for right in right_candidates:
                span = right - left
                if span < min_phone_w or span > max_phone_w:
                    continue
                center_penalty = abs(((left + right) / 2) - center_x) / max(1.0, width * 0.18)
                score = col_scores[left] + col_scores[right] - center_penalty * 24
                if score > best_score:
                    best_pair = (left, right)
                    best_score = score

        if not best_pair:
            return None

        left, right = best_pair
        row_scores: list[float] = []
        inner_x1 = max(0, left + max(2, (right - left) // 14))
        inner_x2 = min(width, right - max(2, (right - left) // 14))
        for y in range(height):
            total = 0
            for x in range(inner_x1, inner_x2):
                total += pixels[x, y]
            row_scores.append(total / max(1, inner_x2 - inner_x1))

        min_phone_h = max(int((right - left) * 1.5), int(height * 0.38))
        max_phone_h = min(int((right - left) * 2.5), int(height * 0.9))
        center_y = height / 2
        top_candidates = sorted(
            range(int(height * 0.05), int(center_y)),
            key=lambda y: row_scores[y],
            reverse=True,
        )[:20]
        bottom_candidates = sorted(
            range(int(center_y), int(height * 0.96)),
            key=lambda y: row_scores[y],
            reverse=True,
        )[:20]
        best_rows: tuple[int, int] | None = None
        best_row_score = -1.0
        for top in top_candidates:
            for bottom in bottom_candidates:
                span = bottom - top
                if span < min_phone_h or span > max_phone_h:
                    continue
                center_penalty = abs(((top + bottom) / 2) - center_y) / max(1.0, height * 0.16)
                score = row_scores[top] + row_scores[bottom] - center_penalty * 20
                if score > best_row_score:
                    best_rows = (top, bottom)
                    best_row_score = score

        if not best_rows:
            return None

        top, bottom = best_rows
        pad_x = max(10, int((right - left) * 0.08))
        pad_y = max(10, int((bottom - top) * 0.06))
        return (
            max(0, left - pad_x),
            max(0, top - pad_y),
            min(width, right + pad_x),
            min(height, bottom + pad_y),
        )


def crop_box_to_vertical_region(box: tuple[int, int, int, int], *, src_w: int, src_h: int) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = box
    cx = (x1 + x2) / 2
    region_w = max(1.0, x2 - x1)
    region_h = max(1.0, y2 - y1)
    cy = ((y1 + y2) / 2) - (region_h * 0.06)
    target_ratio = 1080 / 1920

    if (region_w / region_h) > target_ratio:
        crop_h = min(region_h * 0.97, src_h)
        crop_w = crop_h * target_ratio
    else:
        crop_w = min(region_w * 1.02, src_w)
        crop_h = crop_w / target_ratio

    crop_w = min(crop_w, src_w)
    crop_h = min(crop_h, src_h)

    left = max(0.0, min(cx - crop_w / 2, src_w - crop_w))
    top = max(0.0, min(cy - crop_h / 2, src_h - crop_h))
    return (
        int(round(left)),
        int(round(top)),
        int(round(crop_w)),
        int(round(crop_h)),
    )


def build_clip_segment(clip: Path, out_path: Path, duration: float, index: int) -> None:
    fade_out_start = max(duration - 0.22, 0.01)
    region = detect_phone_region(clip)
    crop_filter = ""
    if region is not None:
        try:
            probe = json.loads(
                subprocess.check_output(
                    [
                        "ffprobe",
                        "-v",
                        "error",
                        "-show_entries",
                        "stream=width,height",
                        "-of",
                        "json",
                        str(clip),
                    ],
                    text=True,
                )
            )
            stream = next(
                (item for item in probe.get("streams", []) if isinstance(item, dict)),
                {},
            )
            src_w = int(stream.get("width") or 0)
            src_h = int(stream.get("height") or 0)
        except Exception:
            src_w = 0
            src_h = 0
        if src_w > 0 and src_h > 0:
            crop_x, crop_y, crop_w, crop_h = crop_box_to_vertical_region(region, src_w=src_w, src_h=src_h)
            crop_filter = f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y},scale=1080:1920,"
    if not crop_filter:
        crop_filter = (
            "scale=1100:1956:force_original_aspect_ratio=increase,"
            "crop=1080:1920:x='(iw-1080)/2':y='(ih-1920)/2',"
        )
    vf = (
        f"{crop_filter}"
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
            "-stream_loop",
            "-1",
            "-t",
            f"{duration:.2f}",
            "-i",
            str(clip),
            "-an",
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

    slide_specs = slide_specs_for_assets(root, assets)
    slides = [path for path, _ in slide_specs]
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
    for (path, _), duration in zip(slide_specs, durations):
        timeline.append(
            {
                "slide": path.name,
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
        if slide.suffix.lower() in {".mov", ".mp4"}:
            build_clip_segment(slide, segment_path, duration, index)
        else:
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

    subtitles = assets / "subtitles.srt"
    if voiceover.exists():
        stitched_duration = sum(durations)
        cmd = [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(stitched),
            "-i",
            str(voiceover),
        ]
        if subtitles.exists():
            cmd.extend(["-i", str(subtitles)])
        cmd.extend([
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-af",
            f"apad=pad_dur={max(2.0, stitched_duration):.2f}",
        ])
        if subtitles.exists():
            cmd.extend(["-c:s", "mov_text", "-metadata:s:s:0", "language=eng"])
        cmd.extend([
            "-shortest",
            "-movflags",
            "+faststart",
            str(final_video),
        ])
        run(cmd)
    else:
        if subtitles.exists():
            run(
                [
                    "ffmpeg",
                    "-y",
                    "-v",
                    "error",
                    "-i",
                    str(stitched),
                    "-i",
                    str(subtitles),
                    "-c:v",
                    "copy",
                    "-c:s",
                    "mov_text",
                    "-metadata:s:s:0",
                    "language=eng",
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
                "slides": [path.name for path, _ in slide_specs],
                "subtitles": subtitles.exists(),
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
