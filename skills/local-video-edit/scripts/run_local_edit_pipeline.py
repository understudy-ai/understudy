#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import selectors
import subprocess
import sys
import time
from pathlib import Path

HEARTBEAT_SECONDS = 8.0


def emit(payload: dict[str, object]) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def stream_step(step: str, cmd: list[str], *, cwd: Path) -> str:
    started = time.monotonic()
    last_output = started
    emit({"status": "start", "step": step, "command": cmd})
    process = subprocess.Popen(
        cmd,
        cwd=str(cwd),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    if process.stdout is None:
        raise RuntimeError(f"Could not capture stdout for step {step}.")

    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    output_lines: list[str] = []

    try:
        while True:
            events = selector.select(timeout=1.0)
            if events:
                for key, _ in events:
                    line = key.fileobj.readline()
                    if line == "":
                        selector.unregister(key.fileobj)
                        continue
                    last_output = time.monotonic()
                    text = line.rstrip()
                    if text:
                        output_lines.append(text)
                        print(f"[{step}] {text}", flush=True)

            return_code = process.poll()
            if return_code is not None:
                for line in process.stdout:
                    text = line.rstrip()
                    if text:
                        output_lines.append(text)
                        print(f"[{step}] {text}", flush=True)
                if return_code != 0:
                    raise subprocess.CalledProcessError(return_code, cmd, output="\n".join(output_lines))
                emit(
                    {
                        "status": "done",
                        "step": step,
                        "elapsedSec": round(time.monotonic() - started, 1),
                    }
                )
                return "\n".join(output_lines)

            now = time.monotonic()
            if now - last_output >= HEARTBEAT_SECONDS:
                emit(
                    {
                        "status": "running",
                        "step": step,
                        "elapsedSec": round(now - started, 1),
                    }
                )
                last_output = now
    finally:
        selector.close()


def extract_review_verdict(root: Path) -> str:
    brief_path = root / "experience" / "review-brief.md"
    if not brief_path.exists():
        return "The edit stays bounded to the evidence captured during this run."
    for raw_line in brief_path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("- "):
            return line[2:].strip()
        return line
    return "The edit stays bounded to the evidence captured during this run."


def write_edit_note(root: Path, probe: dict[str, object]) -> Path:
    streams = probe.get("streams")
    stream_list = streams if isinstance(streams, list) else []
    format_info = probe.get("format") if isinstance(probe.get("format"), dict) else {}

    width = None
    height = None
    audio_present = False
    for stream in stream_list:
        if not isinstance(stream, dict):
            continue
        codec_name = stream.get("codec_name")
        if isinstance(stream.get("width"), int) and isinstance(stream.get("height"), int):
            width = stream["width"]
            height = stream["height"]
        if isinstance(codec_name, str) and "aac" in codec_name.lower():
            audio_present = True

    subtitles_present = (root / "post" / "assets" / "subtitles.srt").exists()
    verdict = extract_review_verdict(root)
    duration = format_info.get("duration")
    size_bytes = format_info.get("size")

    note_lines = [
        "# Video Edit Note",
        "",
        "- Route: local compositor",
        "- Export path: `post/final-video.mp4`",
        f"- Frame: `{width or '?'}x{height or '?'}`",
        f"- Duration: `{duration}` seconds" if duration else "- Duration: unknown",
        f"- Size: `{size_bytes}` bytes" if size_bytes else "- Size: unknown",
        f"- Voiceover: `{'included' if audio_present else 'not included'}`",
        f"- Subtitles: `{'included' if subtitles_present else 'not included'}`",
        f"- Honest note: {verdict}",
    ]
    note_path = root / "post" / "video-edit-note.md"
    note_path.write_text("\n".join(note_lines) + "\n")
    return note_path


def invalidate_stale_review_packet(root: Path) -> None:
    review_dir = root / "review"
    if not review_dir.exists():
        return
    for path in [
        review_dir / "video-feedback.json",
        review_dir / "video-feedback-summary.md",
        review_dir / "feedback-request.md",
        review_dir / "README.md",
        review_dir / "video-feedback.template.json",
    ]:
        if path.exists():
            path.unlink()
    keyframes_dir = review_dir / "keyframes"
    if keyframes_dir.exists():
        shutil.rmtree(keyframes_dir)


def main(root_dir: str) -> None:
    root = Path(root_dir).expanduser().resolve()
    repo_root = Path(__file__).resolve().parents[3]
    python = sys.executable

    steps = [
        ("video-plan", [python, "skills/local-video-edit/scripts/build_video_plan.py", str(root)]),
        ("voiceover", [python, "skills/local-video-edit/scripts/build_voiceover.py", str(root)]),
        ("subtitles", [python, "skills/local-video-edit/scripts/build_subtitles.py", str(root)]),
        ("review-cards", [python, "skills/local-video-edit/scripts/render_review_cards.py", str(root)]),
        ("review-video", [python, "skills/local-video-edit/scripts/build_review_video.py", str(root)]),
    ]

    for step, cmd in steps:
        stream_step(step, cmd, cwd=repo_root)

    final_video = root / "post" / "final-video.mp4"
    if not final_video.exists():
        raise SystemExit(f"Expected local compositor output at {final_video}")

    probe_stdout = stream_step(
        "ffprobe",
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration,size:stream=codec_name,width,height,r_frame_rate",
            "-of",
            "json",
            str(final_video),
        ],
        cwd=repo_root,
    )
    probe = json.loads(probe_stdout)
    invalidate_stale_review_packet(root)
    note_path = write_edit_note(root, probe)
    emit(
        {
            "status": "success",
            "video": str(final_video),
            "note": str(note_path),
            "reviewInvalidated": str(root / "review"),
        }
    )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: run_local_edit_pipeline.py <artifacts-root-dir>")
    main(sys.argv[1])
