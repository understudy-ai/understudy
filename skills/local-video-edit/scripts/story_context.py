#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

VISUAL_REF_RE = re.compile(
    r"(?:topic|experience)/(?:screenshots|clips)/[A-Za-z0-9._/-]+|"
    r"\d{2}-[A-Za-z0-9._-]+\.(?:png|jpe?g|webp|mov|mp4)",
    re.IGNORECASE,
)


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


def normalize_visual_ref(root: Path, ref: str) -> str:
    text = clean_text(ref).strip("`'\"")
    if not text:
        return ""
    candidates = [text]
    if "/" not in text:
        candidates.extend(
            [
                f"experience/screenshots/{text}",
                f"experience/clips/{text}",
                f"topic/screenshots/{text}",
            ]
        )
    elif not text.startswith(("experience/", "topic/")):
        candidates.extend(
            [
                f"experience/screenshots/{Path(text).name}",
                f"experience/clips/{Path(text).name}",
                f"topic/screenshots/{Path(text).name}",
            ]
        )
    seen: set[str] = set()
    for candidate in candidates:
        normalized = candidate.lstrip("./")
        if normalized in seen:
            continue
        seen.add(normalized)
        if (root / normalized).exists():
            return normalized
    return ""


def extract_visual_refs(root: Path, lines: list[str]) -> dict[str, set[str]]:
    refs: dict[str, set[str]] = {}
    for raw_line in lines:
        line = clean_text(raw_line)
        if not line:
            continue
        for match in VISUAL_REF_RE.findall(line):
            normalized = normalize_visual_ref(root, match)
            if not normalized:
                continue
            refs.setdefault(normalized, set()).add(line)
    return refs


def visual_tags(rel_path: str) -> set[str]:
    path = Path(rel_path)
    lower = rel_path.lower()
    stem = path.stem.lower()
    tags: set[str] = set()
    if lower.startswith("experience/screenshots/"):
        tags.add("screenshot")
        tags.add("in_app")
    if lower.startswith("experience/clips/"):
        tags.add("clip")
        tags.add("in_app")
        tags.add("motion")
    if lower.startswith("topic/screenshots/"):
        tags.add("context")
        if "browser" in lower:
            tags.add("browser")
        if "app-store" in lower or "store" in lower:
            tags.add("store")

    if any(token in stem for token in ["first-screen", "welcome", "main-screen", "home", "launch"]):
        tags.update({"hook", "entry"})
    if any(token in stem for token in ["core", "loop", "crop", "editor", "edit", "auto"]):
        tags.add("core")
    if any(token in stem for token in ["outcome", "save", "success", "export", "result", "after-save"]):
        tags.add("outcome")
    if any(token in stem for token in ["detail", "history", "edits", "secondary", "proof", "stack"]):
        tags.add("secondary")
    if any(token in stem for token in ["friction", "survey", "limit", "pricing", "prompt", "error", "permission", "settings"]):
        tags.update({"limit", "friction"})
    if "detail" in stem and "app-store" in lower:
        tags.update({"context", "store"})
    if not tags:
        tags.add("misc")
    return tags


def build_visual_candidates(root: Path, notes: dict[str, Any]) -> list[dict[str, Any]]:
    media = as_dict(notes.get("media"))
    coverage = as_dict(notes.get("coverage"))
    findings = as_dict(notes.get("findings"))
    video_plan = as_dict(notes.get("videoPlan"))

    discovered = choose_list(
        media.get("clips"),
        notes.get("availableEvidence", {}).get("clips") if isinstance(notes.get("availableEvidence"), dict) else [],
    ) + choose_list(
        media.get("screenshots"),
        notes.get("availableEvidence", {}).get("screenshots") if isinstance(notes.get("availableEvidence"), dict) else [],
    ) + discover_relative_paths(root, "topic/screenshots/*.png")

    existing_paths: list[str] = []
    seen_paths: set[str] = set()
    for ref in discovered:
        normalized = normalize_visual_ref(root, ref)
        if not normalized or normalized in seen_paths:
            continue
        seen_paths.add(normalized)
        existing_paths.append(normalized)

    mention_groups = {
        "must_show": choose_list(findings.get("mustShowInVideo")),
        "evidence": choose_list(coverage.get("evidenceMoments")),
        "thumbnail": choose_list(video_plan.get("thumbnailCandidates")),
        "hidden_detail": choose_list(findings.get("hiddenDetails")),
        "limitation": choose_list(findings.get("limitations"), findings.get("painPoints")),
    }

    mention_refs: dict[str, set[str]] = {path: set() for path in existing_paths}
    mention_reasons: dict[str, list[str]] = {path: [] for path in existing_paths}
    for kind, lines in mention_groups.items():
        extracted = extract_visual_refs(root, lines)
        for rel_path, refs in extracted.items():
            mention_refs.setdefault(rel_path, set()).add(kind)
            mention_reasons.setdefault(rel_path, []).extend(sorted(refs))

    candidates: list[dict[str, Any]] = []
    for rel_path in existing_paths:
        lower = rel_path.lower()
        tags = visual_tags(rel_path)
        mentions = mention_refs.get(rel_path, set())
        score = 0.0
        if "clip" in tags:
            score += 3.0
        elif "in_app" in tags:
            score += 2.4
        else:
            score += 0.6
        if "core" in tags:
            score += 1.2
        if "outcome" in tags:
            score += 1.3
        if "secondary" in tags:
            score += 1.0
        if "hook" in tags:
            score += 0.8
        if "limit" in tags:
            score += 0.7
        if "context" in tags:
            score -= 0.5
        if "browser" in tags:
            score -= 0.4
        if "must_show" in mentions:
            score += 1.8
        if "evidence" in mentions:
            score += 1.5
        if "thumbnail" in mentions:
            score += 1.7
        if "hidden_detail" in mentions:
            score += 1.0
        if "limitation" in mentions:
            score += 0.9
        if any(token in lower for token in ["save-success", "export-options", "friction-survey", "detail", "core-loop"]):
            score += 0.5
        candidates.append(
            {
                "path": rel_path,
                "kind": "clip" if "clip" in tags else "screenshot",
                "tags": sorted(tags),
                "mentions": sorted(mentions),
                "mentionReasons": mention_reasons.get(rel_path, []),
                "score": round(score, 3),
            }
        )
    return sorted(candidates, key=lambda item: (float(item.get("score", 0.0)), item.get("path", "")), reverse=True)


def pick_visual_candidate(
    candidates: list[dict[str, Any]],
    *,
    include_tags: set[str] | None = None,
    exclude_paths: set[str] | None = None,
    allow_kinds: set[str] | None = None,
    avoid_tags: set[str] | None = None,
    require_include_match: bool = False,
) -> dict[str, Any] | None:
    include_tags = include_tags or set()
    exclude_paths = exclude_paths or set()
    allow_kinds = allow_kinds or set()
    avoid_tags = avoid_tags or set()

    best: dict[str, Any] | None = None
    best_score = float("-inf")
    for candidate in candidates:
        path = clean_text(candidate.get("path"))
        if not path or path in exclude_paths:
            continue
        kind = clean_text(candidate.get("kind"))
        tags = set(candidate.get("tags") or [])
        if allow_kinds and kind not in allow_kinds:
            continue
        score = float(candidate.get("score", 0.0))
        tag_hits = len(tags & include_tags) if include_tags else 0
        if require_include_match and include_tags and tag_hits == 0:
            continue
        if include_tags:
            if tag_hits == 0:
                score -= 1.25
            else:
                score += tag_hits * 0.95
        if avoid_tags:
            score -= len(tags & avoid_tags) * 0.75
        if "context" in tags and include_tags and "context" not in include_tags:
            score -= 0.8
        if score > best_score:
            best = candidate
            best_score = score
    return best


def select_story_visuals(root: Path, notes: dict[str, Any]) -> dict[str, Any]:
    candidates = build_visual_candidates(root, notes)
    coverage = as_dict(notes.get("coverage"))
    thin_evidence = clean_text(coverage.get("demoDepth")).lower() in {"partial", "shallow"}

    opening = pick_visual_candidate(
        candidates,
        include_tags={"hook", "core", "motion"},
        avoid_tags={"browser"},
    )
    first_impression = pick_visual_candidate(
        candidates,
        include_tags={"hook", "entry"},
        allow_kinds={"screenshot"},
        exclude_paths={clean_text(opening.get("path"))} if opening else set(),
        avoid_tags={"context", "limit"},
    )
    core = pick_visual_candidate(
        candidates,
        include_tags={"core", "motion"},
        exclude_paths={clean_text(first_impression.get("path"))} if first_impression else set(),
        avoid_tags={"browser"},
    )
    used = {
        clean_text(item.get("path"))
        for item in [opening, first_impression, core]
        if item and clean_text(item.get("path"))
    }
    outcome = pick_visual_candidate(
        candidates,
        include_tags={"outcome", "limit"},
        exclude_paths=used,
        avoid_tags={"browser"},
    )
    if outcome is None:
        outcome = pick_visual_candidate(
            candidates,
            include_tags={"secondary", "core"},
            exclude_paths=used,
            avoid_tags={"browser"},
        )
    used = used | ({clean_text(outcome.get("path"))} if outcome else set())
    secondary = pick_visual_candidate(
        candidates,
        include_tags={"secondary", "limit", "outcome"},
        exclude_paths=used,
        avoid_tags={"browser"},
    )
    context = pick_visual_candidate(
        candidates,
        include_tags={"context", "store"},
        allow_kinds={"screenshot"},
        require_include_match=True,
        avoid_tags={"browser"} if not thin_evidence else set(),
    )
    thumbnail = pick_visual_candidate(
        candidates,
        include_tags={"outcome", "core", "hook"},
        avoid_tags={"context", "browser"},
    )

    used_for_gallery = {
        clean_text(item.get("path"))
        for item in [opening, first_impression, core, outcome, secondary]
        if item and clean_text(item.get("path"))
    }
    used_for_gallery.update(
        {
            clean_text(path)
            for path in [
                clean_text(first_impression.get("path")) if first_impression else "",
                clean_text(outcome.get("path")) if outcome else "",
            ]
            if clean_text(path)
        }
    )
    used_for_gallery.update(
        {
            clean_text(path)
            for path in [
                clean_text(core.get("path")) if core else "",
                clean_text(outcome.get("path")) if outcome else "",
                clean_text(secondary.get("path")) if secondary else "",
            ]
            if clean_text(path)
        }
    )
    evidence_gallery = [
        candidate.get("path")
        for candidate in candidates
        if clean_text(candidate.get("path")) not in used_for_gallery and "browser" not in set(candidate.get("tags") or [])
    ][:4]

    def first_screenshot_for(tags: set[str], exclude_paths: set[str]) -> str:
        picked = pick_visual_candidate(
            candidates,
            include_tags=tags,
            allow_kinds={"screenshot"},
            exclude_paths=exclude_paths,
            avoid_tags={"browser"},
        )
        return clean_text(picked.get("path")) if picked else ""

    opening_path = clean_text(opening.get("path")) if opening else ""
    first_path = clean_text(first_impression.get("path")) if first_impression else ""
    core_path = clean_text(core.get("path")) if core else ""
    outcome_path = clean_text(outcome.get("path")) if outcome else ""
    secondary_path = clean_text(secondary.get("path")) if secondary else ""
    context_path = clean_text(context.get("path")) if context else ""

    return {
        "opening": opening_path,
        "firstImpression": first_path or first_screenshot_for({"hook", "entry"}, {opening_path}),
        "coreTask": core_path,
        "coreTaskScreen": (
            core_path if core_path.endswith((".png", ".jpg", ".jpeg", ".webp"))
            else first_screenshot_for({"core", "entry"}, {first_path})
        ),
        "outcome": outcome_path,
        "outcomeScreen": (
            outcome_path if outcome_path.endswith((".png", ".jpg", ".jpeg", ".webp"))
            else first_screenshot_for({"outcome", "limit", "secondary"}, {first_path, core_path})
        ),
        "secondaryProof": secondary_path,
        "secondaryProofScreen": (
            secondary_path if secondary_path.endswith((".png", ".jpg", ".jpeg", ".webp"))
            else first_screenshot_for({"secondary", "limit", "outcome"}, {first_path, core_path, outcome_path})
        ),
        "context": context_path,
        "thumbnail": clean_text(thumbnail.get("path")) if thumbnail else "",
        "evidenceGallery": [clean_text(path) for path in evidence_gallery if clean_text(path)],
        "candidates": candidates,
    }


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
        "titleCandidates": choose_list(
            script_hooks.get("titleCandidates"),
            [
                first_non_empty(join_lines(review_sections.get("hook", [])), app.get("name")),
                first_non_empty(join_lines(story_sections.get("video angle", [])), join_lines(review_sections.get("why it matters", []))),
                first_non_empty(join_lines(review_sections.get("avoid if", [])), join_lines(review_sections.get("best for", []))),
            ],
        ),
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
