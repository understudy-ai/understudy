#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path
from typing import Any


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def spoken_word_estimate(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9']+", clean_text(text)))


def split_subtitle_line(text: str, *, max_chars: int = 42) -> str:
    cleaned = clean_text(text)
    if not cleaned or len(cleaned) <= max_chars:
        return cleaned

    clauses = [clean_text(part) for part in re.split(r"(?<=[,;:])\s+|\s+(?:but|and|so|because)\s+", cleaned) if clean_text(part)]
    if len(clauses) >= 2:
        left = clauses[0]
        right = " ".join(clauses[1:])
        if len(left) <= max_chars and len(right) <= max_chars:
            return f"{left}\n{right}"

    words = cleaned.split()
    best_index = 0
    best_score = None
    for index in range(2, len(words) - 1):
        left = " ".join(words[:index])
        right = " ".join(words[index:])
        if len(left) > max_chars or len(right) > max_chars:
            continue
        score = abs(len(left) - len(right))
        if best_score is None or score < best_score:
            best_score = score
            best_index = index
    if best_index:
        return f"{' '.join(words[:best_index])}\n{' '.join(words[best_index:])}"
    return cleaned


def format_srt_timestamp(seconds: float) -> str:
    millis = max(0, int(round(seconds * 1000)))
    hours = millis // 3_600_000
    millis %= 3_600_000
    minutes = millis // 60_000
    millis %= 60_000
    secs = millis // 1000
    millis %= 1000
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def resolve_duration_seconds(root: Path, lines: list[str]) -> float:
    voiceover_meta = read_json(root / "post" / "assets" / "voiceover-meta.json")
    duration = voiceover_meta.get("durationSec")
    if isinstance(duration, (int, float)) and duration > 0:
        return float(duration)

    manifest = read_json(root / "post" / "video-edit-manifest.json")
    runtime_target = clean_text(manifest.get("runtimeTarget"))
    if runtime_target:
        numbers = [int(value) for value in re.findall(r"\d+", runtime_target)]
        if len(numbers) >= 2:
            return float(numbers[0] + numbers[1]) / 2.0

    total_words = sum(spoken_word_estimate(line) for line in lines)
    estimated = total_words / 2.4 if total_words else 150.0
    return max(120.0, min(240.0, estimated))


def allocate_line_durations(lines: list[str], total_duration: float) -> list[float]:
    weights = [max(1, spoken_word_estimate(line)) for line in lines]
    total_weight = sum(weights) or len(lines) or 1
    base_gap = 0.18
    available = max(total_duration - base_gap * max(len(lines) - 1, 0), float(len(lines)) * 2.2)
    durations = [available * weight / total_weight for weight in weights]
    clamped = [min(18.0, max(2.4, value)) for value in durations]
    clamped_total = sum(clamped)
    if clamped_total <= 0:
        return [max(2.4, total_duration / max(len(lines), 1)) for _ in lines]
    scale = available / clamped_total
    return [value * scale for value in clamped]


def build_cues(lines: list[str], total_duration: float) -> list[dict[str, Any]]:
    durations = allocate_line_durations(lines, total_duration)
    gap = 0.18
    current = 0.0
    cues: list[dict[str, Any]] = []
    for index, (line, duration) in enumerate(zip(lines, durations), start=1):
        start = current
        end = start + duration
        cues.append({
            "index": index,
            "start": start,
            "end": end,
            "text": split_subtitle_line(line),
        })
        current = end + gap
    return cues


def write_srt(path: Path, cues: list[dict[str, Any]]) -> None:
    lines: list[str] = []
    for cue in cues:
        lines.extend([
            str(cue["index"]),
            f"{format_srt_timestamp(cue['start'])} --> {format_srt_timestamp(cue['end'])}",
            cue["text"],
            "",
        ])
    path.write_text("\n".join(lines))


def main(root_dir: str) -> None:
    root = Path(root_dir).expanduser().resolve()
    assets = root / "post" / "assets"
    narration_path = assets / "voiceover-script.txt"
    if not narration_path.exists():
        narration_path = assets / "narration.txt"
    if not narration_path.exists():
        raise SystemExit(f"Missing narration file: {narration_path}")

    raw_lines = [clean_text(line) for line in narration_path.read_text().splitlines() if clean_text(line)]
    if not raw_lines:
        raise SystemExit(f"Narration file is empty: {narration_path}")

    total_duration = resolve_duration_seconds(root, raw_lines)
    cues = build_cues(raw_lines, total_duration)
    subtitle_path = assets / "subtitles.srt"
    write_srt(subtitle_path, cues)

    summary = {
        "sourceFile": str(narration_path),
        "outputFile": str(subtitle_path),
        "lineCount": len(raw_lines),
        "durationSec": round(cues[-1]["end"], 2) if cues else 0,
    }
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: build_subtitles.py <artifacts-root-dir>")
    main(sys.argv[1])
