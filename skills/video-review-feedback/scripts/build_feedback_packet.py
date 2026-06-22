#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

VIDEO_EDIT_SCRIPT_DIR = Path(__file__).resolve().parents[2] / "local-video-edit" / "scripts"
if str(VIDEO_EDIT_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(VIDEO_EDIT_SCRIPT_DIR))

from app_name_helper import derive_review_alias
from story_context import load_story_notes

CATEGORY_TRANSLATIONS = {
    "生產力": "Productivity",
    "教育": "Education",
    "工具程式": "Utilities",
    "參考": "Reference",
    "生活風格": "Lifestyle",
    "健康與健身": "Health & Fitness",
}


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def compact(value: Any, *, max_chars: int, fallback: str = "") -> str:
    text = clean_text(value)
    if not text:
        return fallback
    if len(text) <= max_chars:
        return text
    clipped = text[:max_chars].rstrip(" ,;:")
    return f"{clipped}..."


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def read_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text().strip()


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def as_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [clean_text(item) for item in value if clean_text(item)]


def first_non_empty(*values: Any) -> str:
    for value in values:
        text = clean_text(value)
        if text:
            return text
    return ""


def copy_localization(listing: dict[str, Any]) -> dict[str, Any]:
    return as_dict(listing.get("copyLocalization"))


def readable_category(*values: Any) -> str:
    for value in values:
        text = clean_text(value)
        if not text:
            continue
        return CATEGORY_TRANSLATIONS.get(text, text)
    return "unknown"


def probe_video_summary(video_path: Path) -> dict[str, Any]:
    if not video_path.exists():
        return {}
    try:
        output = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration,size:stream=index,codec_type,duration,width,height",
                "-of",
                "json",
                str(video_path),
            ],
            text=True,
        )
    except Exception:
        return {}

    payload = json.loads(output)
    streams = payload.get("streams")
    stream_list = streams if isinstance(streams, list) else []

    def parse_duration(raw: Any) -> float | None:
        try:
            value = float(raw)
        except (TypeError, ValueError):
            return None
        return value if value > 0 else None

    format_info = payload.get("format")
    format_duration = parse_duration(format_info.get("duration") if isinstance(format_info, dict) else None)
    size_bytes = int(format_info.get("size")) if isinstance(format_info, dict) and clean_text(format_info.get("size")).isdigit() else None

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
    duration_gap = None
    if video_duration and audio_duration:
        duration_gap = round(abs(audio_duration - video_duration), 2)

    warnings: list[str] = []
    if duration_gap and duration_gap > 0.75:
        warnings.append(
            f"Audio/video duration mismatch: video {video_duration:.2f}s vs audio {audio_duration:.2f}s."
        )

    width_value = video_stream.get("width") if isinstance(video_stream, dict) else None
    height_value = video_stream.get("height") if isinstance(video_stream, dict) else None
    try:
        width = int(width_value) if width_value is not None else None
        height = int(height_value) if height_value is not None else None
    except (TypeError, ValueError):
        width = None
        height = None

    if width and height:
        if height <= width:
            warnings.append(f"Export is not vertical: resolution is {width}x{height}.")
        expected_ratio = 1080 / 1920
        actual_ratio = width / height
        if abs(actual_ratio - expected_ratio) > 0.03:
            warnings.append(
                f"Export aspect ratio drifts from 9:16: resolution is {width}x{height}."
            )

    return {
        "formatDurationSec": round(format_duration, 2) if format_duration else None,
        "videoDurationSec": round(video_duration, 2) if video_duration else None,
        "audioDurationSec": round(audio_duration, 2) if audio_duration else None,
        "durationGapSec": duration_gap,
        "sizeBytes": size_bytes,
        "videoWidth": width,
        "videoHeight": height,
        "warnings": warnings,
    }


def feedback_template() -> dict[str, Any]:
    return {
        "summary": "string",
        "sourceRoute": "local_compositor | fallback_preview | unknown",
        "publishReadiness": "ready | needs_revision | blocked",
        "needsDeeperExploration": False,
        "revisionMode": "none | edit | explore",
        "readyAfterOneMoreEditPass": False,
        "timing": {
            "productVisibleBySec": 0,
            "firstUsefulProofBySec": 0,
        },
        "visualRisks": {
            "browserOrDesktopIntrusion": "none | minor | major",
            "textDensity": "clean | borderline | crowded",
            "cjkRenderingOk": True,
            "productFrameDominance": "strong | mixed | weak",
            "packagingOverhang": "none | minor | major",
        },
        "scores": {
            "hook": 0,
            "clarity": 0,
            "evidenceHonesty": 0,
            "reviewDepth": 0,
            "humanReviewDepth": 0,
            "motionVariety": 0,
            "iphoneAuthenticity": 0,
            "visualLegibility": 0,
            "productFraming": 0,
            "proofVsPackagingBalance": 0,
            "pacing": 0,
            "voiceover": 0,
        },
        "topIssues": [
            {
                "issue": "string",
                "whyItMatters": "string",
                "suggestedFix": "string",
            }
        ],
        "frameSpecificNotes": [
            {
                "frame": "01 or slide role",
                "note": "string",
            }
        ],
        "onePassFixPlan": [
            "string",
        ],
        "metadataAdvice": {
            "titleAdjustment": "string",
            "descriptionAdjustment": "string",
        },
    }


def infer_source_route(video_edit_note_text: str) -> str:
    note = clean_text(video_edit_note_text).lower()
    if not note:
        return "unknown"
    if "local compositor" in note or "repo-local render pipeline" in note:
        return "local_compositor"
    if "fallback preview" in note or "preview renderer" in note or "shell compositor" in note:
        return "fallback_preview"
    return "unknown"


def write_feedback_request(
    root: Path,
    listing: dict[str, Any],
    notes: dict[str, Any],
    video_plan_text: str,
    review_brief_text: str,
    video_edit_note_text: str,
    video_probe: dict[str, Any],
) -> None:
    review_dir = root / "review"
    keyframe_dir = review_dir / "keyframes"
    request_path = review_dir / "feedback-request.md"

    app = as_dict(notes.get("app"))
    findings = as_dict(notes.get("findings"))
    hooks = as_dict(notes.get("scriptHooks"))
    video_plan = as_dict(notes.get("videoPlan"))
    media = as_dict(notes.get("media"))
    copy_listing = copy_localization(listing)
    alias = derive_review_alias(
        first_non_empty(copy_listing.get("name"), listing.get("name"), app.get("name"), "This app"),
        first_non_empty(listing.get("appStoreUrl"), app.get("appStoreUrl"), ""),
    )
    source_route = infer_source_route(video_edit_note_text)
    primary_name = clean_text(first_non_empty(listing.get("name"), app.get("name"), alias))
    display_name = first_non_empty(
        copy_listing.get("name"),
        alias if primary_name and primary_name != alias else "",
        primary_name,
        alias,
    )

    assets = [
        "- Prefer uploading `post/final-video.mp4` when the reviewer supports direct video input.",
        "- Otherwise upload `review/keyframes/contact-sheet.jpg` plus the eight extracted keyframes under `review/keyframes/`.",
        "- If the model only supports still images with limited context, start with the contact sheet and add the 2-3 frames most relevant to the suspected issue.",
    ]

    must_show = as_list(findings.get("mustShowInVideo"))
    if not must_show:
        must_show = as_list(as_dict(notes.get("coverage")).get("evidenceMoments"))
    available_clips = as_list(media.get("clips"))
    available_screenshots = as_list(media.get("screenshots"))

    request_lines = [
        "# Goal",
        f"Review this short vertical app-review video for **{alias}** and judge whether it is honest, readable, and strong enough to publish.",
        "",
        "# Context",
        f"- App: `{display_name}`",
        f"- Category: `{readable_category(copy_listing.get('category'), listing.get('category'), app.get('category'))}`",
        f"- Story angle: {first_non_empty(video_plan.get('storyAngle'), hooks.get('openingHook'), 'A short review built from one real first-run test.')}",
        f"- Main verdict so far: {first_non_empty(hooks.get('oneSentenceVerdict'), 'The current cut should stay honest about what the run did and did not prove.')}",
        f"- Current source route guess: `{source_route}`",
        f"- Available source proof: `{len(available_clips)}` clip(s), `{len(available_screenshots)}` screenshot(s)",
        "",
        "# Assets To Review",
        *assets,
        "",
        "# Technical Export Summary",
        f"- Format duration: `{clean_text(video_probe.get('formatDurationSec')) or 'unknown'}s`",
        f"- Video duration: `{clean_text(video_probe.get('videoDurationSec')) or 'unknown'}s`",
        f"- Audio duration: `{clean_text(video_probe.get('audioDurationSec')) or 'unknown'}s`",
        f"- Resolution: `{clean_text(video_probe.get('videoWidth')) or '?'}x{clean_text(video_probe.get('videoHeight')) or '?'}`",
        *(f"- Technical warning: {warning}" for warning in as_list(video_probe.get("warnings"))),
        "",
        "# What The Video Claims Or Implies",
        f"- Opening hook: {compact(hooks.get('openingHook'), max_chars=180, fallback='Judge whether the opening hook lands quickly.')}",
        f"- Tension line: {compact(hooks.get('tensionLine'), max_chars=180, fallback='Judge whether the central question or tradeoff is clear.')}",
    ]

    if must_show:
        request_lines.append("- Key proof moments that should still be visible and legible:")
        for item in must_show[:5]:
            request_lines.append(f"  - {item}")

    request_lines.extend(
        [
            "",
            "# What To Judge",
            "- Hook strength in the first 2-3 seconds.",
            "- Whether the video truthfully reflects what Stage 1 and Stage 2 actually proved.",
            "- Whether the cut feels like a real iPhone test instead of mostly static packaging or setup.",
            "- Whether the review depth feels like a human actually used the app, not just opened it.",
            "- Whether the cut answers the human-viewer questions: what this app is for, what happened when the main action was attempted, and what result or limit shaped the verdict.",
            "- Whether the screenshots are visually distinct enough, or whether frames are repetitive.",
            "- Whether the same proof frame is being reused across core-task, outcome, and verdict beats with only the caption changing.",
            "- Whether the on-screen copy is concise, mobile-readable, and free of broken Chinese / CJK rendering.",
            "- Whether the pacing gives enough time to the proof slides instead of over-spending on setup.",
            "- Whether the narration sounds natural and matches the visible slides.",
            "- Whether the export looks technically coherent, including audio/video duration alignment.",
            "- Whether the ending verdict is clear, useful, and properly scoped to the evidence.",
            "- When the first real product view appears and when the first useful proof beat appears.",
            "- Whether browser or desktop chrome is intruding into the product story.",
            "- Whether the product framing is too small relative to the canvas and whether the product stays visually dominant during the proof beats.",
            "- Whether packaging, context, score, or verdict beats are taking more attention than the actual tested app.",
            "- Whether the story would still mostly make sense if the setup/context beat disappeared, or whether the edit is still leaning on packaging because the product proof is too thin.",
            "- Whether the edit is publish-ready, needs revision, or actually needs deeper exploration before another edit pass.",
            "",
            "# Review Instructions",
            "- Do not praise the video for things it did not prove.",
            "- Prefer concrete edit instructions over vague taste comments.",
            "- Call out misleading claims, unreadable text, awkward voiceover, weak pacing, repetitive frames, broken typography, or a cut that feels too static.",
            "- Call out when the edit underuses available product motion or spends too much time on title, promise, or score packaging.",
            "- If source clips or richer in-app proof were available but the cut still leans on setup/context or static packaging, call that out explicitly.",
            "- If one weak proof frame is being stretched into multiple beats by changing only the caption, say whether the fix is a tighter edit collapse or a true exploration gap.",
            "- When the problem is really missing evidence, say that directly instead of suggesting cosmetic fixes only.",
            "- Identify issues by specific frame number or slide role whenever possible.",
            "- Prefer actionable guidance like `shorten title card to 3.0s`, `swap frame 04`, or `rewrite the verdict headline`.",
            "- If the current source route is `fallback_preview`, do not treat the cut as publishable final output. Prefer `publishReadiness=blocked` and `revisionMode=edit` until a true local re-edit exists, unless the user explicitly asked for a preview render.",
            "- Set `revisionMode=edit` when one more strong edit pass should be enough.",
            "- Set `needsDeeperExploration=true` when the main problem is missing product proof rather than editing polish.",
            "- Set `revisionMode=explore` only when the edit is mainly blocked by missing product evidence.",
            "- Fill `timing.productVisibleBySec` and `timing.firstUsefulProofBySec` with honest estimates from the current cut.",
            "- Use `visualRisks.browserOrDesktopIntrusion`, `visualRisks.textDensity`, `visualRisks.productFrameDominance`, and `visualRisks.packagingOverhang` to make framing and packaging problems explicit.",
            "- Keep `scores.humanReviewDepth`, `scores.productFraming`, and `scores.proofVsPackagingBalance` honest. These should not be inflated just because the edit looks polished.",
            "- Keep `onePassFixPlan` short, concrete, and realistically doable in one revision pass.",
            "",
            "# Required Output Format",
            "Return JSON first using the shape in `review/video-feedback.template.json`.",
            "If the model cannot stay JSON-only, put the JSON first and any short prose after it.",
        ]
        )

    if video_edit_note_text:
        request_lines.extend(
            [
                "",
                "# Existing Edit Notes",
                "Use this to understand what the editor tried, but still judge the rendered video on its own terms:",
                "If these notes say the current MP4 came from a fallback preview renderer or another contingency path, do not mark the cut ready. Ask for a true local re-edit instead.",
                "```md",
                video_edit_note_text.strip(),
                "```",
            ]
        )

    if video_plan_text:
        request_lines.extend(
            [
                "",
                "# Existing Video Plan",
                "Use this only as context, not as ground truth if the cut itself looks misleading:",
                "```md",
                video_plan_text.strip(),
                "```",
            ]
        )

    if review_brief_text:
        request_lines.extend(
            [
                "",
                "# Existing Review Brief",
                "Use this to understand the intended story, but still judge the rendered video on its own terms:",
                "```md",
                review_brief_text.strip(),
                "```",
            ]
        )

    request_path.write_text("\n".join(request_lines).rstrip() + "\n")


def write_readme(root: Path, video_probe: dict[str, Any]) -> None:
    readme_path = root / "review" / "README.md"
    lines = [
        "# Review Packet",
        "1. Prefer uploading `post/final-video.mp4` directly to any strong multimodal model.",
        "2. If direct video is unavailable, upload `review/keyframes/contact-sheet.jpg` plus the eight extracted frame images under `review/keyframes/`.",
        "3. Paste the full contents of `review/feedback-request.md` into the model together with those assets.",
        "4. Save the model's real JSON answer as `review/video-feedback.json`.",
        "5. If the JSON says `revisionMode=edit` or `publishReadiness=needs_revision`, rerun Stage 3 and then regenerate this packet before publishing.",
        "6. If the JSON says `needsDeeperExploration=true` or `revisionMode=explore`, rerun Stage 2 first, then Stage 3, then regenerate this packet.",
        "7. Re-run this stage or the helper to regenerate `review/video-feedback-summary.md` after real feedback exists.",
    ]
    warnings = as_list(video_probe.get("warnings"))
    if warnings:
        lines.extend(["", "## Technical Warnings"])
        for warning in warnings:
            lines.append(f"- {warning}")
    readme_path.write_text("\n".join(lines).rstrip() + "\n")


def write_template(root: Path) -> None:
    template_path = root / "review" / "video-feedback.template.json"
    template_path.write_text(json.dumps(feedback_template(), indent=2, ensure_ascii=False) + "\n")


def write_summary_if_present(root: Path) -> None:
    feedback_path = root / "review" / "video-feedback.json"
    if not feedback_path.exists():
        return

    feedback = read_json(feedback_path)
    summary_path = root / "review" / "video-feedback-summary.md"
    fix_lines = []
    for item in feedback.get("topIssues", [])[:3]:
        issue = clean_text(as_dict(item).get("issue"))
        fix = clean_text(as_dict(item).get("suggestedFix"))
        if issue or fix:
            fix_lines.append(f"- {issue or 'Issue'}: {fix or 'No suggested fix provided.'}")

    lines = [
        "# Video Feedback Summary",
        f"- Publish readiness: `{clean_text(feedback.get('publishReadiness')) or 'unknown'}`",
        f"- Revision mode: `{clean_text(feedback.get('revisionMode')) or 'unknown'}`",
        f"- Summary: {clean_text(feedback.get('summary')) or 'No summary provided.'}",
        "",
        "## Highest-Priority Fixes",
        *(fix_lines or ["- No concrete issues were listed."]),
        "",
        "## Metadata Advice",
        f"- Title: {clean_text(as_dict(feedback.get('metadataAdvice')).get('titleAdjustment')) or 'No title advice.'}",
        f"- Description: {clean_text(as_dict(feedback.get('metadataAdvice')).get('descriptionAdjustment')) or 'No description advice.'}",
    ]
    summary_path.write_text("\n".join(lines).rstrip() + "\n")


def main(root_dir: str) -> int:
    root = Path(root_dir).expanduser().resolve()
    review_dir = root / "review"
    review_dir.mkdir(parents=True, exist_ok=True)
    (review_dir / "keyframes").mkdir(parents=True, exist_ok=True)

    listing = read_json(root / "topic" / "app-store-listing.json")
    notes = load_story_notes(root, listing=listing)
    video_plan_text = read_text(root / "post" / "video-plan.md")
    video_edit_note_text = read_text(root / "post" / "video-edit-note.md")
    review_brief_text = read_text(root / "experience" / "review-brief.md")
    video_probe = probe_video_summary(root / "post" / "final-video.mp4")

    write_feedback_request(root, listing, notes, video_plan_text, review_brief_text, video_edit_note_text, video_probe)
    write_template(root)
    write_readme(root, video_probe)
    write_summary_if_present(root)

    print(
        json.dumps(
            {
                "request": str(root / "review" / "feedback-request.md"),
                "template": str(root / "review" / "video-feedback.template.json"),
                "readme": str(root / "review" / "README.md"),
                "summary": str(root / "review" / "video-feedback-summary.md") if (root / "review" / "video-feedback-summary.md").exists() else None,
                "videoProbe": video_probe,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: build_feedback_packet.py <artifacts-root-dir>")
    raise SystemExit(main(sys.argv[1]))
