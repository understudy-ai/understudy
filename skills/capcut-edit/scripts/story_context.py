#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


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


def choose_list(*candidates: Any) -> list[str]:
    for candidate in candidates:
        items = as_list(candidate)
        if items:
            return items
    return []


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def read_markdown_sections(path: Path) -> dict[str, list[str]]:
    if not path.exists():
        return {}
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for raw_line in path.read_text().splitlines():
        line = raw_line.rstrip()
        heading = re.match(r"^#{1,6}\s+(.*)$", line)
        if heading:
            current = clean_text(heading.group(1)).lower()
            sections.setdefault(current, [])
            continue
        if current is None:
            continue
        stripped = clean_text(re.sub(r"^[-*+]\s+", "", line))
        if stripped:
            sections[current].append(stripped)
    return sections


def join_lines(lines: list[str]) -> str:
    return clean_text(" ".join(lines))


def split_sentences(lines: list[str]) -> list[str]:
    joined = join_lines(lines)
    if not joined:
        return []
    parts = re.split(r"(?<=[.!?。！？])\s+|(?<=;)\s+", joined)
    return [clean_text(part) for part in parts if clean_text(part)]


def discover_relative_paths(root: Path, *patterns: str) -> list[str]:
    discovered: list[str] = []
    for pattern in patterns:
        for path in sorted(root.glob(pattern)):
            if path.is_file():
                discovered.append(str(path.relative_to(root)))
    return discovered


def infer_demo_depth(
    explicit: str,
    review_sections: dict[str, list[str]],
    story_sections: dict[str, list[str]],
    *,
    screenshot_count: int,
    clip_count: int,
) -> str:
    normalized = clean_text(explicit).lower()
    if normalized in {"deep", "partial", "shallow"}:
        return normalized

    signal = " ".join(
        join_lines(lines)
        for lines in [
            review_sections.get("what i tried", []),
            review_sections.get("what worked", []),
            review_sections.get("what got in the way", []),
            review_sections.get("why it matters", []),
            review_sections.get("must show in video", []),
            story_sections.get("primary loop", []),
            story_sections.get("secondary proof", []),
            story_sections.get("claims i can defend", []),
            story_sections.get("claims to avoid", []),
            story_sections.get("screenshot map", []),
            story_sections.get("video angle", []),
        ]
    ).lower()

    shallow_markers = [
        "shallow",
        "partial",
        "thin proof",
        "only verified",
        "only reached",
        "did not complete",
        "did not land",
        "not proven",
        "before the payoff",
        "dashboard-only",
        "tool hub",
        "timeout",
    ]
    if any(marker in signal for marker in shallow_markers):
        return "shallow" if screenshot_count <= 4 and clip_count == 0 else "partial"

    deep_markers = [
        "saved",
        "reopen",
        "revisit",
        "history",
        "search",
        "tag",
        "filter",
        "result",
        "source",
        "preview",
        "export",
        "retry",
        "limit",
        "pricing",
        "secondary proof",
    ]
    if clip_count > 0 and screenshot_count >= 4:
        return "deep"
    if screenshot_count >= 5 and any(marker in signal for marker in deep_markers):
        return "deep"
    if screenshot_count >= 4:
        return "partial"
    return "shallow"


def load_story_notes(root: Path, *, listing: dict[str, Any] | None = None) -> dict[str, Any]:
    listing = listing or read_json(root / "topic" / "app-store-listing.json")
    notes = read_json(root / "experience" / "notes.json")
    manifest = read_json(root / "manifest.json")
    selected_app = as_dict(manifest.get("selectedApp"))

    review_sections = read_markdown_sections(root / "experience" / "review-brief.md")
    story_sections = read_markdown_sections(root / "experience" / "story-beats.md")

    app = as_dict(notes.get("app"))
    setup = as_dict(notes.get("setup"))
    coverage = as_dict(notes.get("coverage"))
    findings = as_dict(notes.get("findings"))
    audience_fit = as_dict(notes.get("audienceFit"))
    media = as_dict(notes.get("media"))
    scorecard = as_dict(notes.get("scorecard"))
    script_hooks = as_dict(notes.get("scriptHooks"))
    video_plan = as_dict(notes.get("videoPlan"))

    discovered_screenshots = discover_relative_paths(root, "experience/screenshots/*.png")
    discovered_clips = discover_relative_paths(root, "experience/clips/*.mov", "experience/clips/*.mp4")

    must_show = choose_list(
        findings.get("mustShowInVideo"),
        review_sections.get("must show in video"),
        story_sections.get("screenshot map"),
    )
    claim_lines = choose_list(story_sections.get("claims i can defend"))
    avoid_lines = choose_list(story_sections.get("claims to avoid"))

    media = {
        **media,
        "clips": choose_list(media.get("clips"), discovered_clips),
        "screenshots": choose_list(media.get("screenshots"), discovered_screenshots),
    }

    demo_depth = infer_demo_depth(
        first_non_empty(coverage.get("demoDepth"), notes.get("depth")),
        review_sections,
        story_sections,
        screenshot_count=len(as_list(media.get("screenshots"))),
        clip_count=len(as_list(media.get("clips"))),
    )

    coverage = {
        **coverage,
        "demoDepth": demo_depth,
        "primaryLoop": first_non_empty(
            coverage.get("primaryLoop"),
            join_lines(story_sections.get("primary loop", [])),
            join_lines(review_sections.get("what i tried", [])),
        ),
        "secondaryProof": first_non_empty(
            coverage.get("secondaryProof"),
            join_lines(story_sections.get("secondary proof", [])),
            join_lines(review_sections.get("what worked", [])),
        ),
        "fallbackStory": first_non_empty(
            coverage.get("fallbackStory"),
            join_lines(review_sections.get("what got in the way", [])),
            join_lines(review_sections.get("why it matters", [])),
        ),
        "proofLadder": choose_list(
            coverage.get("proofLadder"),
            [
                join_lines(story_sections.get("opening frame", [])),
                first_non_empty(
                    join_lines(story_sections.get("motion beat", [])),
                    join_lines(story_sections.get("primary loop", [])),
                ),
                first_non_empty(
                    join_lines(story_sections.get("climax frame", [])),
                    join_lines(review_sections.get("what got in the way", [])),
                ),
                first_non_empty(
                    join_lines(story_sections.get("audience or limit beat", [])),
                    join_lines(story_sections.get("closing frame", [])),
                ),
            ],
        ),
        "coverageGaps": choose_list(
            coverage.get("coverageGaps"),
            split_sentences(review_sections.get("what got in the way", [])),
        ),
        "evidenceMoments": choose_list(
            coverage.get("evidenceMoments"),
            must_show,
        ),
    }

    findings = {
        **findings,
        "highlights": choose_list(
            findings.get("highlights"),
            split_sentences(review_sections.get("what worked", [])),
        ),
        "painPoints": choose_list(
            findings.get("painPoints"),
            split_sentences(review_sections.get("what got in the way", [])),
        ),
        "surprises": choose_list(
            findings.get("surprises"),
            split_sentences(review_sections.get("why it matters", [])),
        ),
        "mustShowInVideo": must_show,
    }

    audience_fit = {
        **audience_fit,
        "bestFor": first_non_empty(
            audience_fit.get("bestFor"),
            join_lines(review_sections.get("best for", [])),
        ),
        "avoidIf": first_non_empty(
            audience_fit.get("avoidIf"),
            join_lines(review_sections.get("avoid if", [])),
        ),
    }

    script_hooks = {
        **script_hooks,
        "openingHook": first_non_empty(
            script_hooks.get("openingHook"),
            join_lines(review_sections.get("hook", [])),
            join_lines(story_sections.get("video angle", [])),
        ),
        "tensionLine": first_non_empty(
            script_hooks.get("tensionLine"),
            join_lines(review_sections.get("what got in the way", [])),
            join_lines(review_sections.get("why it matters", [])),
        ),
        "payoffLine": first_non_empty(
            script_hooks.get("payoffLine"),
            join_lines(review_sections.get("what worked", [])),
            join_lines(story_sections.get("climax frame", [])),
        ),
        "oneSentenceVerdict": first_non_empty(
            script_hooks.get("oneSentenceVerdict"),
            join_lines(story_sections.get("video angle", [])),
            join_lines(review_sections.get("why it matters", [])),
        ),
    }

    video_plan = {
        **video_plan,
        "storyAngle": first_non_empty(
            video_plan.get("storyAngle"),
            join_lines(story_sections.get("video angle", [])),
            script_hooks.get("oneSentenceVerdict"),
        ),
    }

    app = {
        **app,
        "name": first_non_empty(
            app.get("name"),
            listing.get("name"),
            selected_app.get("name"),
        ),
        "category": first_non_empty(
            app.get("category"),
            listing.get("category"),
            selected_app.get("category"),
        ),
        "appStoreUrl": first_non_empty(
            app.get("appStoreUrl"),
            listing.get("appStoreUrl"),
            selected_app.get("appStoreUrl"),
        ),
        "appStoreRating": app.get("appStoreRating")
        if app.get("appStoreRating") not in {None, ""}
        else first_non_empty(listing.get("rating"), selected_app.get("rating")),
    }

    normalized = {
        **notes,
        "app": app,
        "setup": setup,
        "coverage": coverage,
        "findings": findings,
        "audienceFit": audience_fit,
        "media": media,
        "scorecard": scorecard,
        "scriptHooks": script_hooks,
        "videoPlan": video_plan,
        "summary": first_non_empty(
            notes.get("summary"),
            join_lines(review_sections.get("why it matters", [])),
            join_lines(story_sections.get("video angle", [])),
        ),
        "depth": first_non_empty(notes.get("depth"), demo_depth),
        "claimsICanDefend": choose_list(notes.get("claimsICanDefend"), claim_lines),
        "claimsToAvoid": choose_list(notes.get("claimsToAvoid"), avoid_lines),
        "availableEvidence": {
            "clips": as_list(media.get("clips")),
            "screenshots": as_list(media.get("screenshots")),
        },
    }
    return normalized
