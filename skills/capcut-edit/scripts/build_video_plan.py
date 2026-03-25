#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

from app_name_helper import contains_cjk, derive_review_alias
from story_context import load_story_notes


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


def sentence_from_list(value: Any, fallback: str = "") -> str:
    items = as_list(value)
    if items:
        return items[0]
    return fallback


def first_non_empty(*values: Any) -> str:
    for value in values:
        text = clean_text(value)
        if text:
            return text
    return ""


SCREENSHOT_REF_RE = re.compile(
    r"`?(?:topic|experience)/screenshots/[A-Za-z0-9._/-]+|`?\d{2}-[A-Za-z0-9._-]+\.png`?",
    re.IGNORECASE,
)
CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
LATIN_RE = re.compile(r"[A-Za-z]")
CLAUSE_SPLIT_RE = re.compile(r"\s*(?:[,:;]\s+|\s+[-\u2013\u2014]\s+|\s+\bbut\b\s+|\s+\bbecause\b\s+|\s+\bso\b\s+)\s*", re.IGNORECASE)
INCOMPLETE_ENDINGS = {
    "a",
    "an",
    "and",
    "as",
    "at",
    "because",
    "before",
    "but",
    "for",
    "from",
    "if",
    "in",
    "into",
    "of",
    "on",
    "or",
    "so",
    "that",
    "the",
    "their",
    "this",
    "to",
    "via",
    "whether",
    "with",
}


def strip_artifact_refs(text: str) -> str:
    cleaned = SCREENSHOT_REF_RE.sub("", clean_text(text))
    cleaned = re.sub(r"\b(?:screenshot|screen|frame|slide|shot)\s+shows?\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bthis (?:frame|slide|shot)\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip(" ,.;:-")


def split_sentences(text: str) -> list[str]:
    cleaned = clean_text(text)
    if not cleaned:
        return []
    parts = re.split(r"(?<=[.!?。！？])\s+|\n+", cleaned)
    return [clean_text(part) for part in parts if clean_text(part)]


def split_clauses(text: str) -> list[str]:
    cleaned = clean_text(text)
    if not cleaned:
        return []
    parts = [clean_text(part) for part in CLAUSE_SPLIT_RE.split(cleaned) if clean_text(part)]
    return parts or [cleaned]


def word_count(text: str) -> int:
    return len([token for token in clean_text(text).split() if token])


def cjk_char_count(text: str) -> int:
    return len(CJK_RE.findall(clean_text(text)))


def latin_char_count(text: str) -> int:
    return len(LATIN_RE.findall(clean_text(text)))


def is_cjk_heavy(text: str) -> bool:
    cjk = cjk_char_count(text)
    if cjk == 0:
        return False
    latin = latin_char_count(text)
    latin_words = re.findall(r"[A-Za-z]+", clean_text(text))
    return latin < max(8, cjk * 2) or len(latin_words) <= 3


def looks_incomplete(text: str) -> bool:
    cleaned = clean_text(text)
    if not cleaned:
        return True
    if cleaned.lower().startswith(("and ", "or ", "but ", "because ", "so ")):
        return True
    if cleaned.endswith(("-", "—", "–", "/", "(", ":", ",")):
        return True
    tokens = re.findall(r"[A-Za-z']+", cleaned.lower())
    return bool(tokens and tokens[-1] in INCOMPLETE_ENDINGS)


def compact_text(
    value: Any,
    *,
    max_chars: int,
    max_words: int,
    fallback: str = "",
) -> str:
    text = strip_artifact_refs(clean_text(value))
    if not text:
        return fallback

    for sentence in split_sentences(text):
        if len(sentence) <= max_chars and len(sentence.split()) <= max_words:
            return sentence
        clause_candidates = [
            clause
            for clause in split_clauses(sentence)
            if clause
            and len(clause) <= max_chars
            and word_count(clause) <= max_words
            and not looks_incomplete(clause)
        ]
        if clause_candidates:
            return max(clause_candidates, key=lambda clause: (len(clause), word_count(clause)))

    words = text.split()
    trimmed = " ".join(words[:max_words]).strip()
    if len(trimmed) > max_chars:
        trimmed = trimmed[:max_chars].rstrip(" ,;:")
    if trimmed and trimmed != text:
        trimmed = trimmed.rstrip(".!?,;:。！？")
    if looks_incomplete(trimmed):
        clause_candidates = [
            clause
            for clause in split_clauses(text)
            if clause
            and len(clause) <= max_chars
            and word_count(clause) <= max_words
            and not looks_incomplete(clause)
        ]
        if clause_candidates:
            return max(clause_candidates, key=lambda clause: (len(clause), word_count(clause)))
        if fallback:
            return fallback
    return trimmed or fallback


def english_review_copy(
    value: Any,
    *,
    max_chars: int,
    max_words: int,
    fallback: str,
) -> str:
    backup = compact_text(fallback, max_chars=max_chars, max_words=max_words, fallback=fallback)
    candidate = compact_text(value, max_chars=max_chars, max_words=max_words, fallback=backup)
    if is_cjk_heavy(candidate) or looks_incomplete(candidate):
        return backup
    return candidate


def sentence_case(text: str) -> str:
    cleaned = clean_text(text)
    if not cleaned:
        return ""
    return cleaned[:1].upper() + cleaned[1:]


def short_slug(value: Any, fallback: str = "review-short") -> str:
    tokens = re.findall(r"[A-Za-z0-9]+", clean_text(value))
    if not tokens:
        return fallback
    slug = "-".join(token.lower() for token in tokens[:3]).strip("-")
    return slug[:32] or fallback


def parse_story_sections(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for raw_line in path.read_text().splitlines():
        line = raw_line.rstrip()
        if re.match(r"^#{1,6}\s+", line):
            current = clean_text(re.sub(r"^#{1,6}\s+", "", line)).lower()
            sections.setdefault(current, [])
            continue
        if current is None:
            continue
        stripped = clean_text(line)
        if stripped:
            sections[current].append(stripped)
    return {key: " ".join(values) for key, values in sections.items() if values}


def story_text(sections: dict[str, str], name: str) -> str:
    return strip_artifact_refs(clean_text(sections.get(name.lower()) or ""))


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def copy_localization(listing: dict[str, Any]) -> dict[str, Any]:
    return as_dict(listing.get("copyLocalization"))


def preferred_listing_text(listing: dict[str, Any], key: str) -> str:
    localized = copy_localization(listing)
    return first_non_empty(localized.get(key), listing.get(key))


def listing_signal_text(listing: dict[str, Any]) -> str:
    localized = copy_localization(listing)
    return " ".join(
        clean_text(value)
        for value in [
            localized.get("name"),
            listing.get("name"),
            localized.get("subtitle"),
            listing.get("subtitle"),
            localized.get("description"),
            listing.get("description"),
            localized.get("category"),
            listing.get("category"),
        ]
        if clean_text(value)
    ).lower()


def note_signal_text(notes: dict[str, Any]) -> str:
    coverage = as_dict(notes.get("coverage"))
    findings = as_dict(notes.get("findings"))
    app = as_dict(notes.get("app"))
    hooks = as_dict(notes.get("scriptHooks"))
    parts = [
        app.get("name"),
        app.get("category"),
        coverage.get("primaryLoop"),
        coverage.get("secondaryProof"),
        coverage.get("fallbackStory"),
        *as_list(coverage.get("featuresExplored")),
        *as_list(coverage.get("coreTasksCompleted")),
        *as_list(findings.get("highlights")),
        *as_list(findings.get("painPoints")),
        *as_list(findings.get("surprises")),
        hooks.get("openingHook"),
        hooks.get("oneSentenceVerdict"),
    ]
    return " ".join(clean_text(value) for value in parts if clean_text(value)).lower()


def infer_app_mode(listing: dict[str, Any], notes: dict[str, Any]) -> str:
    signal = f"{listing_signal_text(listing)} {note_signal_text(notes)}"
    if any(token in signal for token in ["photo", "video", "edit", "editor", "creator", "project", "caption", "template", "camera", "media", "timeline", "autocut", "剪輯", "影片", "相片"]):
        return "creator"
    if any(token in signal for token in ["planner", "calendar", "schedule", "reminder", "todo", "to-do", "note", "journal", "notebook", "task", "日曆", "提醒", "筆記"]):
        return "planner"
    if any(token in signal for token in ["search", "answer", "citation", "source", "assistant", "ai", "query", "prompt", "搜索", "答案", "來源", "引用"]):
        return "ai"
    if any(token in signal for token in ["scan", "scanner", "ocr", "document", "clean up", "文檔", "掃描"]):
        return "scanner"
    if any(token in signal for token in ["game", "card", "deck", "board", "strategy", "puzzle"]):
        return "game"
    return "utility"


def infer_demo_depth(notes: dict[str, Any]) -> str:
    """Read demo depth from the already-computed coverage.demoDepth field.

    story_context.load_story_notes() computes this using the richer
    infer_demo_depth that considers review sections, story sections,
    clip count, and screenshot count. This function simply reads that
    pre-computed value so all callers use a single consistent depth signal.
    """
    coverage = as_dict(notes.get("coverage"))
    explicit = clean_text(coverage.get("demoDepth")).lower()
    if explicit in {"deep", "partial", "shallow"}:
        return explicit
    # Fallback: if not pre-computed, use screenshot heuristic
    screenshot_count = len(as_list(as_dict(notes.get("media")).get("screenshots")))
    if screenshot_count >= 5:
        return "deep"
    if screenshot_count >= 4:
        return "partial"
    return "shallow"


def readable_store_headline(listing: dict[str, Any]) -> str:
    subtitle = clean_text(preferred_listing_text(listing, "subtitle"))
    if subtitle and not re.search(r"^(在 App Store 下載|Download .* on the App Store)", subtitle, flags=re.IGNORECASE) and not (contains_cjk(subtitle) and len(subtitle) > 16 and not re.search(r"[A-Za-z]", subtitle)):
        return compact_text(subtitle, max_chars=42, max_words=8, fallback="What the store promises")
    signal = listing_signal_text(listing)
    if any(token in signal for token in ["search", "answer", "citation", "source", "research", "搜索", "答案", "來源", "引用"]):
        return "AI search with sources"
    if any(token in signal for token in ["planner", "calendar", "schedule", "reminder", "todo", "note", "journal", "日曆", "提醒", "筆記"]):
        return "Plan it and revisit it"
    if any(token in signal for token in ["scan", "scanner", "ocr", "document", "clean up", "掃描", "文檔"]):
        return "Scan, clean, and keep"
    if any(token in signal for token in ["edit", "creator", "video", "photo", "design", "filter", "剪輯", "影片", "相片"]):
        return "Create something fast"
    return "What the store promises"


def readable_store_support(listing: dict[str, Any]) -> str:
    description = clean_text(preferred_listing_text(listing, "description"))
    latin_words = re.findall(r"[A-Za-z]+", description)
    if description and not re.search(r"^(在 App Store 下載|Download .* on the App Store)", description, flags=re.IGNORECASE) and not (contains_cjk(description) and len(latin_words) <= 2):
        candidate = compact_text(description, max_chars=108, max_words=18, fallback="The listing sets a clear first-use expectation.")
        if not is_cjk_heavy(candidate):
            return candidate
    signal = listing_signal_text(listing)
    if any(token in signal for token in ["search", "answer", "citation", "source", "research", "搜索", "答案", "來源", "引用"]):
        return "The listing promises fast answers, research help, and stronger trust through sources."
    if any(token in signal for token in ["planner", "calendar", "schedule", "reminder", "todo", "note", "journal", "日曆", "提醒", "筆記"]):
        return "The listing promises one calm create-save-revisit loop instead of a noisy dashboard."
    if any(token in signal for token in ["scan", "scanner", "ocr", "document", "clean up", "掃描", "文檔"]):
        return "The listing promises one bounded capture-cleanup workflow before deeper extras."
    if any(token in signal for token in ["edit", "creator", "video", "photo", "design", "filter", "剪輯", "影片", "相片"]):
        return "The listing promises a fast create-edit-preview flow instead of a passive gallery."
    return "The listing sets a clear first-use expectation before the app even opens."


def include_context_beat(video_plan_notes: dict[str, Any], feedback: dict[str, Any]) -> bool:
    raw = clean_text(first_non_empty(video_plan_notes.get("contextBeat"), feedback.get("contextBeat"))).lower()
    if raw in {"include", "included", "required", "force", "forced", "true", "yes"}:
        return True
    if raw in {"skip", "omit", "none", "false", "no"}:
        return False
    return False


def first_headline(notes: dict[str, Any]) -> str:
    setup = as_dict(notes.get("setup"))
    if bool(setup.get("requiresLogin")):
        return "Setup before the payoff"
    if int(setup.get("onboardingSteps") or 0) <= 1:
        return "Fast first screen"
    return "First screen sets the tone"


def core_headline(listing: dict[str, Any], notes: dict[str, Any], story_sections: dict[str, str]) -> str:
    coverage = as_dict(notes.get("coverage"))
    app_mode = infer_app_mode(listing, notes)
    depth = infer_demo_depth(notes)
    signal = note_signal_text(notes)
    source = first_non_empty(
        story_text(story_sections, "Primary Loop"),
        coverage.get("primaryLoop"),
        "The run reaches one real task.",
    ).lower()
    if app_mode == "creator" and depth == "shallow":
        if any(token in signal for token in ["all tools", "tool hub", "tool menu", "new project", "dashboard"]):
            return "Tool hub, not the real edit"
        return "Still before the real edit"
    if app_mode == "creator":
        if any(token in source or token in signal for token in ["timeline", "trim", "caption", "filter", "preview", "export", "project"]):
            return "Reached the real work surface"
        if any(token in signal for token in ["all tools", "tool hub", "new project", "dashboard", "quick action"]):
            return "Editing tools are upfront"
    if app_mode == "ai" and any(token in source for token in ["query", "ask", "search", "answer"]):
        return "Real query, real processing"
    if any(token in source for token in ["create", "task", "note", "event", "reminder"]):
        return "Created one real item"
    if any(token in source for token in ["edit", "filter", "tool", "effect"]):
        return "One edit proves the tool"
    if any(token in source for token in ["scan", "camera", "ocr"]):
        return "One scan tests the core loop"
    return "Real task, not just menus"


def outcome_headline(listing: dict[str, Any], notes: dict[str, Any], story_sections: dict[str, str]) -> str:
    findings = as_dict(notes.get("findings"))
    coverage = as_dict(notes.get("coverage"))
    app_mode = infer_app_mode(listing, notes)
    depth = infer_demo_depth(notes)
    candidate = first_non_empty(
        story_text(story_sections, "Climax Frame"),
        as_list(findings.get("painPoints"))[:1][0] if as_list(findings.get("painPoints")) else "",
        as_list(coverage.get("evidenceMoments"))[:1][0] if as_list(coverage.get("evidenceMoments")) else "",
    ).lower()
    if app_mode == "creator" and depth == "shallow":
        return "Still one step from proof"
    if "timeout" in candidate or "timed out" in candidate:
        return "First try times out"
    if "paywall" in candidate or "premium" in candidate or "trial" in candidate:
        return "The limit shapes the verdict"
    if "saved" in candidate or "save" in candidate or "revisit" in candidate:
        return "Saved state proves it"
    if any(token in candidate for token in ["permission", "access", "blocked", "blocker", "gate", "gated", "error", "failed", "friction"]):
        return "The friction becomes the story"
    return "What happened next"


def verdict_headline(listing: dict[str, Any], notes: dict[str, Any]) -> str:
    scorecard = as_dict(notes.get("scorecard"))
    coverage = as_dict(notes.get("coverage"))
    app_mode = infer_app_mode(listing, notes)
    depth = infer_demo_depth(notes)
    overall = float(scorecard.get("overall") or 0)
    if app_mode == "creator" and depth == "shallow":
        return "Need a real project test"
    if overall >= 7 and depth == "deep":
        return "Worth trying"
    if overall >= 5:
        return "Promising, with caveats"
    if depth == "shallow":
        return "Too thin to trust"
    return "Not proven yet"


def scorecard_headline(notes: dict[str, Any], story_sections: dict[str, str]) -> str:
    overall = float(as_dict(notes.get("scorecard")).get("overall") or 0)
    outcome_key = outcome_headline({}, notes, story_sections)
    if outcome_key == "First try times out":
        return "Clean start, weak payoff"
    if outcome_key == "The limit shapes the verdict":
        return "Promise beats access"
    if outcome_key == "Saved state proves it":
        return "Proof beats polish"
    if overall >= 7:
        return "A strong first run"
    if overall >= 5:
        return "Good, not effortless"
    return "More proof needed"


def title_headline(listing: dict[str, Any], notes: dict[str, Any], story_sections: dict[str, str], alias: str) -> str:
    overall = float(as_dict(notes.get("scorecard")).get("overall") or 0)
    depth = infer_demo_depth(notes)
    app_mode = infer_app_mode(listing, notes)
    outcome_key = outcome_headline(listing, notes, story_sections)
    category_signal = listing_signal_text(listing)

    if app_mode == "creator" and depth == "shallow":
        return "Polished start, thin proof"
    if outcome_key == "First try times out":
        return "Premium look, partial proof"
    if outcome_key == "The limit shapes the verdict":
        return "Good idea, gated fast"
    if outcome_key == "The friction becomes the story":
        return "Strong start, real friction"
    if outcome_key == "Saved state proves it":
        return f"{alias} actually sticks"
    if overall >= 7 and depth == "deep":
        return f"{alias} earns a spot"
    if any(token in category_signal for token in ["calendar", "planner", "note", "journal", "提醒", "筆記", "日曆"]):
        return "Calm, useful, and clear"
    if overall >= 5:
        return "Promising, with caveats"
    return "Looks good, not proven"


def title_support(notes: dict[str, Any], story_sections: dict[str, str]) -> str:
    coverage = as_dict(notes.get("coverage"))
    setup = as_dict(notes.get("setup"))
    outcome_key = outcome_headline({}, notes, story_sections)
    if infer_app_mode({}, notes) == "creator" and infer_demo_depth(notes) == "shallow":
        return "This pass proves the dashboard and tool hub, but not a real project from import to result."
    if outcome_key == "First try times out":
        return "The premium first impression is real, but the first useful answer never lands."
    if outcome_key == "The limit shapes the verdict":
        return "The idea is clear, but the real limit shows up before the payoff does."
    if outcome_key == "The friction becomes the story":
        return "The first useful path is clear, but the blocker shows up before the payoff does."
    if outcome_key == "Saved state proves it":
        return "One quick first run already proves the value sticks after the first tap."
    if bool(setup.get("requiresLogin")):
        return "The first question is whether setup gets out of the way fast enough."
    if clean_text(coverage.get("demoDepth")) == "deep":
        return "One short iPhone run already proves more than the App Store promise alone."
    return "One short iPhone run decides whether the opening promise actually holds."


def first_support(notes: dict[str, Any], story_sections: dict[str, str]) -> str:
    setup = as_dict(notes.get("setup"))
    if bool(setup.get("requiresLogin")):
        return "Setup appears before the value does, which changes the tone immediately."
    if int(setup.get("onboardingSteps") or 0) <= 1:
        return "The app opens fast, with the main surface ready right away."
    return "The first useful screen quickly shows how much friction is still coming."


def core_support(listing: dict[str, Any], notes: dict[str, Any], story_sections: dict[str, str]) -> str:
    core_key = core_headline(listing, notes, story_sections)
    if core_key == "Tool hub, not the real edit":
        return "This pass reaches the dashboard and tool menu, but not a finished project on the timeline."
    if core_key == "Still before the real edit":
        return "The opening looks polished, but the run still stops before the creator loop proves itself."
    if core_key == "Reached the real work surface":
        return "The run reaches a working creator surface instead of stopping at the landing screen."
    if core_key == "Editing tools are upfront":
        return "The dashboard makes the next project step obvious before any deeper creator work begins."
    if core_key == "Real query, real processing":
        return "One short prompt pushes the app into a live answer flow."
    if core_key == "Created one real item":
        return "One fake demo item is enough to test the real create-save loop."
    if core_key == "One edit proves the tool":
        return "One visible edit proves the tool faster than another menu tour."
    if core_key == "One scan tests the core loop":
        return "One real scan is enough to judge the core workflow honestly."
    return "One deliberate action matters more than another menu tap ever could."


def outcome_support(listing: dict[str, Any], notes: dict[str, Any], story_sections: dict[str, str]) -> str:
    outcome_key = outcome_headline(listing, notes, story_sections)
    if outcome_key == "Still one step from proof":
        return "Without a real project result, the honest verdict stays about first-launch clarity rather than finished output quality."
    if outcome_key == "First try times out":
        return "The request reaches processing, then ends in a visible timeout."
    if outcome_key == "The limit shapes the verdict":
        return "The best feature hits a real limit before the payoff fully lands."
    if outcome_key == "Saved state proves it":
        return "The result still shows up later, which proves the value actually sticks."
    if outcome_key == "The friction becomes the story":
        return "The blocker is visible enough that the video can stay honest about it."
    return "The outcome decides whether the promise feels real or just polished."


def score_support(notes: dict[str, Any], story_sections: dict[str, str]) -> str:
    overall = float(as_dict(notes.get("scorecard")).get("overall") or 0)
    outcome_key = outcome_headline({}, notes, story_sections)
    if outcome_key == "First try times out":
        return "Strong polish and depth cues, but the first useful result never lands."
    if outcome_key == "The limit shapes the verdict":
        return "Clear promise, but the limit arrives before the value fully does."
    if outcome_key == "Saved state proves it":
        return "The calm first impression earns trust because the result actually sticks."
    if overall >= 7:
        return "One real first run is enough to earn the score."
    if overall >= 5:
        return "One real run is enough to keep the take balanced."
    return "The score stays low because the proof stays partial."


def verdict_support(listing: dict[str, Any], notes: dict[str, Any], story_sections: dict[str, str]) -> str:
    audience = as_dict(notes.get("audienceFit"))
    outcome_key = outcome_headline(listing, notes, story_sections)
    if infer_app_mode(listing, notes) == "creator" and infer_demo_depth(notes) == "shallow":
        return "Worth revisiting only after a real project test replaces the dashboard-only proof."
    best_for = clean_text(audience.get("bestFor"))
    if best_for and word_count(best_for) <= 11 and not is_cjk_heavy(best_for):
        return best_for[:1].upper() + best_for[1:]
    if outcome_key == "First try times out":
        return "Looks premium, but first-run reliability still needs better proof."
    if outcome_key == "The friction becomes the story":
        return "Worth trying if the early friction feels acceptable for your workflow."
    if outcome_key == "Saved state proves it":
        return "Easy to recommend when one calm, repeatable loop is what you need."
    return "Who should try it depends on whether this first proof already feels enough."


def default_narration(
    listing: dict[str, Any],
    notes: dict[str, Any],
    story_sections: dict[str, str],
    alias: str,
    *,
    context_beat: bool,
    secondary_beat: bool,
) -> list[str]:
    hooks = as_dict(notes.get("scriptHooks"))
    coverage = as_dict(notes.get("coverage"))
    findings = as_dict(notes.get("findings"))
    setup = as_dict(notes.get("setup"))
    audience = as_dict(notes.get("audienceFit"))
    scorecard = as_dict(notes.get("scorecard"))
    app_mode = infer_app_mode(listing, notes)
    depth = infer_demo_depth(notes)
    overall = float(scorecard.get("overall") or 0)
    signal = first_non_empty(hooks.get("openingHook"), story_text(story_sections, "Video Angle")).lower()
    if app_mode == "creator" and depth == "shallow":
        return [
            f"I opened {alias} to see whether the first run explains itself.",
            "The first screen looks polished, but polish is not enough for a real walkthrough.",
            "So I looked for the fastest path into an actual project.",
            "The dashboard keeps the main tools visible instead of hiding them.",
            "This pass still stops before a full project lands.",
            "So the honest story is onboarding clarity, not output quality yet.",
            "The useful detail is which tools are obvious immediately and which still feel tucked away.",
            "If you already know what you want to make, the app looks promising.",
            "If you need proof of export quality, this run still comes up short.",
            "It needs a deeper second pass before the verdict gets stronger.",
        ]
    if "premium" in signal or "polish" in signal or "clean" in signal:
        opening_line = f"{alias} looks polished from the first screen."
    else:
        opening_line = f"{alias} has to earn its first impression quickly."

    context_line = english_review_copy(
        readable_store_support(listing),
        max_chars=82,
        max_words=13,
        fallback="The promise is clear before the app even opens.",
    )

    if bool(setup.get("requiresLogin")):
        first_line = "First launch asks for setup before the real value shows up."
    elif int(setup.get("onboardingSteps") or 0) <= 1:
        first_line = "First launch stays clean, and the core surface is ready right away."
    else:
        first_line = "The first useful screen quickly shows how much setup is coming."

    core_key = core_headline(listing, notes, story_sections)
    if core_key == "Real query, real processing":
        core_line = f"I sent one real prompt to test whether {alias} could answer fast."
    elif core_key == "Created one real item":
        core_line = "I made one real item to see whether the loop would actually stick."
    elif core_key == "One edit proves the tool":
        core_line = "I pushed one real edit instead of stopping at the landing screen."
    elif core_key == "One scan tests the core loop":
        core_line = "I ran one real scan to see whether the core workflow actually lands."
    else:
        core_line = "I pushed one real task instead of wandering through menus."

    outcome_key = outcome_headline(listing, notes, story_sections)
    if outcome_key == "First try times out":
        outcome_line = "That first request timed out, so the payoff never fully landed."
    elif outcome_key == "The limit shapes the verdict":
        outcome_line = "A limit showed up fast enough to change the score and the verdict."
    elif outcome_key == "Saved state proves it":
        outcome_line = "The saved state is what makes the good first impression feel real."
    elif outcome_key == "The friction becomes the story":
        outcome_line = "The friction showed up clearly enough that it became the honest story."
    else:
        outcome_line = "The outcome is what really decides whether the promise feels real."

    how_to_start_line = sentence_case(english_review_copy(
        first_non_empty(
            coverage.get("primaryLoop"),
            story_text(story_sections, "Primary Loop"),
            "The best way in is the smallest real task the app can complete honestly.",
        ),
        max_chars=108,
        max_words=18,
        fallback="The best way in is the smallest real task the app can complete honestly.",
    ))

    setup_detail_line = sentence_case(english_review_copy(
        first_non_empty(
            coverage.get("proofLadder")[0] if isinstance(coverage.get("proofLadder"), list) and coverage.get("proofLadder") else "",
            story_text(story_sections, "Opening Frame"),
            "The first useful screen should immediately tell you where the app wants you to start.",
        ),
        max_chars=108,
        max_words=18,
        fallback="The first useful screen should immediately tell you where the app wants you to start.",
    ))

    result_followup_line = sentence_case(english_review_copy(
        first_non_empty(
            coverage.get("proofLadder")[2] if isinstance(coverage.get("proofLadder"), list) and len(coverage.get("proofLadder")) > 2 else "",
            coverage.get("secondaryProof"),
            story_text(story_sections, "Climax Frame"),
            "What changed next is the part that proves the task was real.",
        ),
        max_chars=108,
        max_words=18,
        fallback="What changed next is the part that proves the task was real.",
    ))

    best_for = clean_text(audience.get("bestFor"))
    avoid_if = clean_text(audience.get("avoidIf"))
    if best_for and word_count(best_for) <= 12 and not is_cjk_heavy(best_for):
        verdict_line = compact_text(best_for, max_chars=82, max_words=12, fallback=best_for)
    elif overall >= 7:
        verdict_line = "This one feels easy to recommend after a real first run."
    elif overall >= 5:
        verdict_line = "It feels promising, but this run leaves real caveats on the table."
    else:
        verdict_line = "The idea is promising, but the first run does not prove enough yet."

    secondary_line = ""
    if secondary_beat:
        secondary_line = clean_text(
            first_non_empty(
                story_text(story_sections, "Secondary Proof"),
                coverage.get("secondaryProof"),
                as_list(findings.get("surprises"))[:1][0] if as_list(findings.get("surprises")) else "",
            )
        )
        if secondary_line:
            secondary_line = sentence_case(english_review_copy(
                secondary_line,
                max_chars=84,
                max_words=13,
                fallback="One extra proof beat helps the review feel used instead of merely opened.",
            ))
            if secondary_line and not re.match(r"^(I|It|The|This|That|One|A|An)\b", secondary_line):
                secondary_line = compact_text(
                    f"The extra proof is that {secondary_line[:1].lower() + secondary_line[1:]}",
                    max_chars=84,
                    max_words=14,
                    fallback=secondary_line,
                )
        elif overall >= 6:
            secondary_line = "One extra proof beat helps the review feel used instead of merely opened."

    hidden_detail_line = sentence_case(english_review_copy(
        first_non_empty(
            as_list(findings.get("surprises"))[:1][0] if as_list(findings.get("surprises")) else "",
            story_text(story_sections, "Secondary Proof"),
            "One less obvious detail usually decides whether the app feels thoughtful or shallow.",
        ),
        max_chars=108,
        max_words=18,
        fallback="One less obvious detail usually decides whether the app feels thoughtful or shallow.",
    ))

    audience_line = sentence_case(english_review_copy(
        first_non_empty(
            avoid_if,
            best_for,
            story_text(story_sections, "Audience Or Limit Beat"),
            "The limit or audience fit matters as much as the first impression.",
        ),
        max_chars=108,
        max_words=18,
        fallback="The limit or audience fit matters as much as the first impression.",
    ))

    close_line = sentence_case(english_review_copy(
        first_non_empty(
            hooks.get("oneSentenceVerdict"),
            story_text(story_sections, "Video Angle"),
            verdict_line,
        ),
        max_chars=108,
        max_words=18,
        fallback=verdict_line,
    ))

    # Build the base narration
    lines = [opening_line]
    if context_beat:
        lines.append(context_line)
    lines.extend([
        first_line,
        how_to_start_line,
        setup_detail_line,
        core_line,
        result_followup_line,
        outcome_line,
    ])
    if secondary_line:
        lines.append(secondary_line)
    lines.extend([hidden_detail_line, audience_line, verdict_line, close_line])

    # Expansion is no longer done by splicing fragments from findings.
    # The default_narration lines are already the best fallback content.
    # If they're still too short, that's acceptable — a shorter but coherent
    # narration is better than a longer but incoherent one.

    return lines


def sanitize_narration_lines(lines: list[str], full_name: str, alias: str) -> list[str]:
    sanitized: list[str] = []
    for line in lines:
        current = clean_text(line)
        if full_name and alias and full_name != alias:
            current = current.replace(full_name, alias)
        # First pass: only trim extremely long lines (>35 words).
        # Narration lines should average 20-28 words; do not over-truncate.
        if word_count(current) > 35:
            current = compact_text(current, max_chars=200, max_words=35, fallback=current)
        current = re.sub(r"\s+", " ", current).strip(" -")
        if current:
            sanitized.append(current)
    sanitized = sanitized[:18]

    def total_words(items: list[str]) -> int:
        return sum(len(item.split()) for item in items)

    # Only compress if total exceeds the 460-word budget
    if total_words(sanitized) > 460:
        sanitized = [compact_text(item, max_chars=160, max_words=28, fallback=item) for item in sanitized]
    if total_words(sanitized) > 460:
        sanitized = [compact_text(item, max_chars=140, max_words=24, fallback=item) for item in sanitized]
    if total_words(sanitized) > 460:
        sanitized = sanitized[:18]
    return sanitized


MIN_NARRATION_WORDS = 200  # ~75s at 160 WPM — minimum for fallback narration


def narration_too_short(lines: list[str]) -> bool:
    """Check whether narration is too short for a 3-minute target."""
    if not lines:
        return True
    total_words = sum(len(item.split()) for item in lines)
    return total_words < MIN_NARRATION_WORDS


def narration_too_long(lines: list[str]) -> bool:
    if not lines:
        return True
    if len(lines) > 20:
        return True
    total_words = sum(len(item.split()) for item in lines)
    if total_words > 500:
        return True
    return False  # Per-line length is handled by sanitize, not rejection


def raw_narration_too_long(lines: list[str]) -> bool:
    if not lines:
        return True
    if len(lines) > 20:
        return True
    total_words = sum(len(clean_text(item).split()) for item in lines)
    if total_words > 500:
        return True
    return False  # Per-line length handled by sanitize


def build_revision_notes(feedback: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    revision_mode = clean_text(feedback.get("revisionMode"))
    if revision_mode:
        lines.append(f"- Revision mode: {revision_mode}.")
    for item in feedback.get("topIssues", [])[:3]:
        issue = clean_text(as_dict(item).get("issue"))
        fix = clean_text(as_dict(item).get("suggestedFix"))
        if issue or fix:
            lines.append(f"- {issue or 'Issue'}: {fix or 'Needs a concrete edit.'}")
    for item in as_list(feedback.get("onePassFixPlan"))[:4]:
        lines.append(f"- One-pass fix: {item}")
    return lines


def beat_duration_text(
    beat_id: str,
    *,
    thin_evidence: bool,
    core_clip_exists: bool,
    secondary_clip_exists: bool,
) -> str:
    if beat_id == "opening-overlay":
        return "about 5-9s"
    if beat_id == "context-beat":
        return "about 5-10s"
    if beat_id == "first-impression":
        return "about 10-18s"
    if beat_id == "core-task":
        return "about 18-35s" if core_clip_exists else "about 15-26s"
    if beat_id == "outcome":
        return "about 15-30s"
    if beat_id == "secondary-proof":
        return "about 12-22s" if secondary_clip_exists else "about 10-18s"
    if beat_id == "verdict":
        return "about 6-12s"
    return "about 8-14s" if thin_evidence else "about 10-18s"


def beat_framing_text(beat_id: str, *, source: str, reuses_previous: bool) -> str:
    if beat_id == "opening-overlay":
        return "Open on the cleanest iPhone frame, crop tight so the app fills most of the canvas, and use only one short hook overlay."
    if beat_id == "context-beat":
        return "Keep this brief. Use the iPhone App Store detail only as a quick bridge, not as a full-screen marketing card."
    if beat_id == "first-impression":
        return "Use a gentle push or drift so the UI feels alive, and keep the visible product larger than any matte or caption shell."
    if beat_id == "core-task":
        if source.endswith(".mov"):
            return "Lead with the real motion proof. Crop the clip so the iPhone UI dominates the frame and the gesture / processing state is obvious."
        return "Use a close crop with gentle motion so the viewer reads the action, not the surrounding frame."
    if beat_id == "outcome":
        if source.endswith(".mov"):
            return "Land on the payoff or friction moment from the later part of the clip and let the result breathe before any verdict overlay."
        return "Hold long enough for the changed state or blocker to read clearly, and keep the product larger than the captions."
    if beat_id == "secondary-proof":
        return "Treat this as one extra trust / revisit / limit beat from the same story, not as a second unrelated feature tour."
    if beat_id == "verdict":
        if reuses_previous:
            return "Stay on the strongest existing proof frame and add one short verdict overlay instead of cutting to a separate text card."
        return "Keep the verdict attached to a real proof frame. Avoid ending on a dead scorecard or decorative shell."
    return "Keep the product large, the text short, and the motion restrained."


def beat_text_budget_text(beat_id: str) -> str:
    if beat_id == "verdict":
        return "One short verdict headline plus one support line at most."
    if beat_id == "context-beat":
        return "One brief promise line only if the proof still needs the context."
    return "Prefer a 2-5 word headline and a 5-12 word support line."


def beat_trim_hint(
    beat_id: str,
    *,
    source: str,
    core_clip_rel: str,
    secondary_clip_rel: str,
    reuse_previous: bool,
) -> str:
    if not source:
        return "Reuse the strongest previous proof frame without creating a new detached packaging beat."
    if not source.endswith(".mov"):
        if beat_id == "opening-overlay":
            return "Hold the cleanest hook-ready frame first, then add only a short overlay before moving on."
        if beat_id == "verdict" and reuse_previous:
            return "Stay on the strongest outcome frame and add the verdict late, rather than cutting to a new static card."
        return "Use the clearest static frame from this asset and avoid long dead holds."
    if beat_id == "opening-overlay":
        if source == core_clip_rel:
            return "Trim the first 1.0-1.8s where the app is already alive and the main action is about to start."
        if source == secondary_clip_rel:
            return "Trim the first 1.0-1.8s where the secondary motion is immediately understandable."
        return "Open on the first lively second of the clip, not on hesitant setup."
    if beat_id == "core-task":
        if source == core_clip_rel:
            return "Use the clearest middle section of the core clip where the gesture, typing, processing, or transition is unmistakable."
        return "Trim to the most readable part of the action instead of replaying the clip from its opening seconds."
    if beat_id == "outcome":
        if source == core_clip_rel:
            return "Land on the later payoff or blocker moment from the same core clip so the viewer sees a real change, not a repeated start."
        if source == secondary_clip_rel:
            return "Trim to the part of the clip where the result, revisit, or limitation reads most clearly."
        return "Use the part of the clip where the visible result or friction finally lands."
    if beat_id == "secondary-proof":
        return "Use the shortest distinct section that proves revisit, persistence, trust, or limit without restarting the story."
    if beat_id == "verdict":
        return "Attach the verdict to the last 1.5-2.2s of the strongest proof clip instead of adding a separate ending card."
    return "Trim to the shortest readable section that still carries the beat clearly."


def main(root_dir: str) -> int:
    root = Path(root_dir).expanduser().resolve()
    post_dir = root / "post"
    assets_dir = post_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    run_slug = root.parent.name or root.name

    listing = read_json(root / "topic" / "app-store-listing.json")
    notes = load_story_notes(root, listing=listing)
    feedback = read_json(root / "review" / "video-feedback.json")
    story_sections = parse_story_sections(root / "experience" / "story-beats.md")

    app = as_dict(notes.get("app"))
    hooks = as_dict(notes.get("scriptHooks"))
    coverage = as_dict(notes.get("coverage"))
    findings = as_dict(notes.get("findings"))
    audience = as_dict(notes.get("audienceFit"))
    video_plan_notes = as_dict(notes.get("videoPlan"))

    copy_listing = copy_localization(listing)
    full_name = first_non_empty(copy_listing.get("name"), listing.get("name"), app.get("name"), "This app")
    app_store_url = first_non_empty(listing.get("appStoreUrl"), app.get("appStoreUrl"), "")
    alias = derive_review_alias(full_name, app_store_url)
    project_slug = short_slug(alias or full_name)
    project_name = f"{alias} short"
    regional_name = clean_text(first_non_empty(listing.get("name"), app.get("name"), ""))
    localized_name = regional_name if regional_name and regional_name != alias and regional_name != full_name else ""
    core_clip = root / "experience" / "clips" / "01-Core-Loop.mov"
    secondary_clip = root / "experience" / "clips" / "02-Secondary-Proof.mov"
    core_clip_exists = core_clip.exists()
    secondary_clip_exists = secondary_clip.exists()
    demo_depth = infer_demo_depth(notes)
    app_mode = infer_app_mode(listing, notes)

    def rel_if_exists(path: Path) -> str:
        return str(path.relative_to(root)) if path.exists() else ""

    media_screenshots = [
        shot
        for shot in as_list(as_dict(notes.get("media")).get("screenshots"))
        if shot and (root / shot).exists()
    ]

    def media_shot(index: int) -> str:
        return media_screenshots[index] if index < len(media_screenshots) else ""

    first_screen_rel = first_non_empty(
        rel_if_exists(root / "experience" / "screenshots" / "01-First-Screen.png"),
        media_shot(0),
    )
    main_screen_rel = first_non_empty(
        rel_if_exists(root / "experience" / "screenshots" / "02-Main-Screen.png"),
        media_shot(1),
    )
    core_task_rel = first_non_empty(
        rel_if_exists(root / "experience" / "screenshots" / "03-Core-Task.png"),
        media_shot(2),
    )
    outcome_rel = first_non_empty(
        rel_if_exists(root / "experience" / "screenshots" / "04-Outcome-Or-Friction.png"),
        media_shot(3),
    )
    secondary_feature_rel = first_non_empty(
        rel_if_exists(root / "experience" / "screenshots" / "05-Secondary-Feature.png"),
        media_shot(4),
    )
    pricing_limit_rel = first_non_empty(
        rel_if_exists(root / "experience" / "screenshots" / "06-Pricing-Or-Limit.png"),
        media_shot(5),
    )
    store_detail_rel = rel_if_exists(root / "topic" / "screenshots" / "02-iPhone-App-Store-Detail.png")
    core_clip_rel = rel_if_exists(core_clip)
    secondary_clip_rel = rel_if_exists(secondary_clip)

    # Check mustShowInVideo for unassigned screenshots that should get priority
    must_show = as_list(findings.get("mustShowInVideo"))
    must_show_assets = [
        s for s in must_show
        if s and (root / s).exists() and s not in {
            first_screen_rel, main_screen_rel, core_task_rel,
            outcome_rel, core_clip_rel,
        }
    ]
    must_show_secondary = must_show_assets[0] if must_show_assets else ""

    secondary_asset_rel = first_non_empty(must_show_secondary, secondary_clip_rel, secondary_feature_rel, pricing_limit_rel)
    secondary_exists = bool(secondary_asset_rel)
    opening_asset_rel = first_non_empty(core_clip_rel, first_screen_rel, main_screen_rel, core_task_rel, outcome_rel, store_detail_rel)
    first_impression_asset_rel = first_non_empty(main_screen_rel, core_task_rel if core_task_rel != opening_asset_rel else "", outcome_rel if outcome_rel != opening_asset_rel else "")
    first_impression_exists = bool(first_impression_asset_rel and first_impression_asset_rel != opening_asset_rel and not core_clip_exists)
    context_beat = include_context_beat(video_plan_notes, feedback) and bool(store_detail_rel) and demo_depth != "shallow" and not core_clip_exists
    slide_order = ["opening-overlay"]
    if first_impression_exists:
        slide_order.append("first-impression")
    if context_beat:
        slide_order.append("context-beat")
    slide_order.extend(["core-task", "outcome"])
    if secondary_exists:
        slide_order.append("secondary-proof")
    slide_order.append("verdict")

    thin_evidence = demo_depth in {"partial", "shallow"} and not core_clip_exists and not secondary_exists
    runtime_target = (
        "about 130-160 seconds"
        if app_mode == "creator" and demo_depth == "shallow"
        else "about 140-180 seconds"
        if thin_evidence
        else "about 170-210 seconds" if secondary_exists else "about 150-190 seconds"
    )
    story_angle = clean_text(
        first_non_empty(
            video_plan_notes.get("storyAngle"),
            story_text(story_sections, "Video Angle"),
            hooks.get("oneSentenceVerdict"),
            "A tutorial-style review built from one real first-run exploration.",
        )
    ) or "A tutorial-style review built from one real first-run exploration."
    opening_priority = sentence_case(
        english_review_copy(
            first_non_empty(story_text(story_sections, "Opening Frame"), ""),
            max_chars=120,
            max_words=20,
            fallback="Start on the strongest iPhone-led frame, not a dead title wall.",
        )
    )
    motion_beat = clean_text(
        first_non_empty(
            story_text(story_sections, "Motion Beat"),
            as_list(findings.get("mustShowInVideo"))[1] if len(as_list(findings.get("mustShowInVideo"))) > 1 else "",
            coverage.get("primaryLoop"),
        )
    )
    motion_priority = sentence_case(
        english_review_copy(
            motion_beat,
            max_chars=120,
            max_words=20,
            fallback="Create motion from the strongest proof screenshot and keep the crop tight on the app UI." if not core_clip_exists else "Use the main Stage 2 clip as soon as the cut can support it.",
        )
    )
    climax_priority = sentence_case(
        english_review_copy(
            first_non_empty(story_text(story_sections, "Climax Frame"), ""),
            max_chars=120,
            max_words=20,
            fallback="Let the clearest payoff or limitation own the emotional peak of the cut.",
        )
    )
    audience_limit_beat = clean_text(
        first_non_empty(
            story_text(story_sections, "Audience Or Limit Beat"),
            coverage.get("fallbackStory"),
            audience.get("avoidIf"),
        )
    )
    audience_priority = sentence_case(
        english_review_copy(
            audience_limit_beat,
            max_chars=120,
            max_words=20,
            fallback="Use one beat to support the best-for / avoid-if verdict instead of adding more generic packaging.",
        )
    )

    raw_preferred_narration = as_list(video_plan_notes.get("narrationLines"))
    preferred_narration = sanitize_narration_lines(raw_preferred_narration, full_name, alias)
    fallback_narration = sanitize_narration_lines(
        default_narration(
            listing,
            notes,
            story_sections,
            alias,
            context_beat=context_beat,
            secondary_beat=secondary_exists,
        ),
        full_name,
        alias,
    )
    # Selection logic: prefer agent-written narration (higher quality) over
    # the mechanically generated fallback. Only fall back when preferred is
    # empty, broken, or way too long.
    if raw_narration_too_long(raw_preferred_narration) or narration_too_long(preferred_narration):
        narration_lines = fallback_narration
    elif len(preferred_narration) >= 3:
        # Agent wrote something usable — keep it even if short.
        # A coherent 7-line narration is better than 18 lines of fragments.
        narration_lines = preferred_narration
    else:
        narration_lines = fallback_narration
    if len(narration_lines) < 3:
        narration_lines = fallback_narration

    beat_specs: list[dict[str, str]] = []

    def add_beat(
        beat_id: str,
        *,
        purpose: str,
        headline: str,
        support: str,
        source: str = "",
        preferred_asset: str = "",
        reuse_previous: bool = False,
    ) -> None:
        beat_specs.append(
            {
                "id": beat_id,
                "purpose": purpose,
                "headline": headline,
                "support": support,
                "source": source,
                "preferredAsset": preferred_asset or (f"`{source}`" if source else "Reuse the strongest previous proof frame."),
                "reusePrevious": "true" if reuse_previous else "false",
                "duration": beat_duration_text(
                    beat_id,
                    thin_evidence=thin_evidence,
                    core_clip_exists=core_clip_exists,
                    secondary_clip_exists=secondary_clip_exists,
                ),
                "framing": beat_framing_text(
                    beat_id,
                    source=source,
                    reuses_previous=reuse_previous,
                ),
                "trimHint": beat_trim_hint(
                    beat_id,
                    source=source,
                    core_clip_rel=core_clip_rel,
                    secondary_clip_rel=secondary_clip_rel,
                    reuse_previous=reuse_previous,
                ),
                "textBudget": beat_text_budget_text(beat_id),
            }
        )

    if opening_asset_rel:
        add_beat(
            "opening-overlay",
            purpose="Hook on the first real iPhone frame without spending a whole beat on a dead title card.",
            headline=title_headline(listing, notes, story_sections, alias),
            support=title_support(notes, story_sections),
            source=opening_asset_rel,
        )

    if first_impression_exists:
        add_beat(
            "first-impression",
            purpose="Show what the next useful screen proves about setup, speed, or product depth.",
            headline=first_headline(notes),
            support=first_support(notes, story_sections),
            source=first_impression_asset_rel,
        )

    if context_beat:
        add_beat(
            "context-beat",
            purpose="Add one brief store promise bridge only because the in-app proof still benefits from that context.",
            headline=readable_store_headline(listing),
            support=english_review_copy(
                readable_store_support(listing),
                max_chars=84,
                max_words=13,
                fallback="The listing sets one clear expectation before the app opens.",
            ),
            source=store_detail_rel,
        )

    core_source = first_non_empty(core_clip_rel, core_task_rel, main_screen_rel, opening_asset_rel)
    add_beat(
        "core-task",
        purpose="Prove the one real task or attempt the run actually reached.",
        headline=core_headline(listing, notes, story_sections),
        support=core_support(listing, notes, story_sections),
        source=core_source,
    )

    outcome_source = first_non_empty(outcome_rel, core_source, opening_asset_rel)
    add_beat(
        "outcome",
        purpose="Show the clearest payoff, saved state, blocker, or limitation from the same story.",
        headline=outcome_headline(listing, notes, story_sections),
        support=outcome_support(listing, notes, story_sections),
        source=outcome_source,
    )

    if secondary_exists:
        add_beat(
            "secondary-proof",
            purpose="Add one extra trust / revisit / limit beat so the short feels used rather than merely opened.",
            headline="One more proof beat",
            support=english_review_copy(
                first_non_empty(
                    story_text(story_sections, "Secondary Proof"),
                    coverage.get("secondaryProof"),
                    as_list(findings.get("surprises"))[:1][0] if as_list(findings.get("surprises")) else "",
                    "The extra beat should deepen the same story instead of starting a new one.",
                ),
                max_chars=84,
                max_words=13,
                fallback="The extra beat should deepen the same story instead of starting a new one.",
            ),
            source=secondary_asset_rel,
        )

    verdict_source = first_non_empty(outcome_source, secondary_asset_rel, opening_asset_rel)
    add_beat(
        "verdict",
        purpose="Close on who the app is for and the honest takeaway while staying attached to real product proof.",
        headline=verdict_headline(listing, notes),
        support=verdict_support(listing, notes, story_sections),
        source=verdict_source,
        reuse_previous=True,
    )

    narration_groups: list[str] = []
    if beat_specs:
        for index in range(len(beat_specs)):
            start = round(index * len(narration_lines) / len(beat_specs))
            end = round((index + 1) * len(narration_lines) / len(beat_specs))
            group = narration_lines[start:end]
            narration_groups.append(" ".join(group))
    for index, beat in enumerate(beat_specs):
        beat["narration"] = narration_groups[index] if index < len(narration_groups) else ""

    import_assets: list[dict[str, str]] = []
    seen_sources: dict[str, str] = {}
    for beat in beat_specs:
        source = beat.get("source", "")
        if not source:
            continue
        existing_target = seen_sources.get(source)
        if existing_target:
            beat["importAsset"] = existing_target
            continue
        suffix = ".png" if Path(source).suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"} else (Path(source).suffix or ".png")
        target_name = f"{len(import_assets) + 1:02d}-{beat['id']}{suffix}"
        seen_sources[source] = target_name
        beat["importAsset"] = target_name
        import_assets.append(
            {
                "order": str(len(import_assets) + 1),
                "role": beat["id"],
                "source": source,
                "targetName": target_name,
            }
        )

    voiceover_rel = rel_if_exists(root / "post" / "assets" / "voiceover.aiff")
    if voiceover_rel:
        import_assets.append(
            {
                "order": str(len(import_assets) + 1),
                "role": "voiceover",
                "source": voiceover_rel,
                "targetName": f"{len(import_assets) + 1:02d}-voiceover.aiff",
            }
        )

    plan_lines = [
        "# Video Spec",
        "- Format: 1080x1920 vertical MP4, H.264, 30 fps, voiceover-backed, subtitle-ready, and mute-safe.",
        "- Runtime goal: keep the cut in the three-minute walkthrough lane without rushing the proof.",
        f"- Proof asset priority: {f'Open on a trimmed moment from `{core_clip.relative_to(root)}` when that clip gives the fastest honest hook, then keep the rest of the proof iPhone-led.' if core_clip_exists else 'No live proof clip was found, so the cut must rely on strong screenshot motion and honest pacing.'}",
        f"- Evidence posture: {'Keep the cut tighter than usual and avoid padding with extra packaging because the current proof set is still thin.' if thin_evidence else 'Let the proof beats dominate more runtime than the packaging beats.'}",
        "",
        "# Runtime",
        f"Target runtime: {runtime_target}.",
        "",
        "# Language",
        "- On-screen copy language: English-first with a short Latin alias.",
        "- Narration language: English.",
        f"- Spoken app alias: `{alias}`.",
        f"- Localized-name handling: {f'Keep `{localized_name}` only as small support copy when it fits cleanly, and prefer the English App Store localization for viewer-facing copy.' if localized_name and copy_listing else f'Keep `{localized_name}` only as small support copy when it fits cleanly.' if localized_name else 'Keep the alias stable across the whole cut.'}",
        "",
        "# Story Angle",
        story_angle,
        "",
        "# Local CapCut Route",
        f"- Preferred project identity: `{project_name}`. If CapCut home already shows a draft card that clearly matches `{alias}` or `{run_slug}`, open that draft once before creating another project.",
        "- Home/gallery cues: a big `Start creating` / `开始创作` hero, left navigation like `Home` / `首页` or `Templates` / `模板`, plus recent draft cards near the bottom.",
        "- Editor cues: a visible media bin or import area, preview monitor, timeline ruler, or parameter sidebar. Do not confuse the home gallery with a real editor.",
        "- If a `录屏` / screen-record starter tile is visible, that is still the home surface, not proof that the current project is open.",
        "- Once the edit actually starts, do not drift back to the home/gallery loop. The stable next state should be the editor with the current run assets.",
        "",
        "# Shot Priority",
        f"- Opening frame: {opening_priority}",
        f"- Motion beat: {motion_priority}",
        f"- Climax frame: {climax_priority}",
        f"- Audience / limit beat: {audience_priority}",
        "",
        "# CapCut Build Rules",
        "- Start on a real iPhone frame and place the hook as overlay copy there. Do not burn a separate dead title card.",
        "- Default to 8-10 beats when the proof set is thin and 10-14 beats when it is richer.",
        "- Keep the app UI large in frame on proof beats. Crop or zoom until the product, not the matte, is the subject.",
        "- Prefer editable text overlays inside CapCut over pre-baked text cards.",
        "- Use at most one text-first beat. Everything else should feel product-first or product-backed.",
        "- Keep setup compact. Any optional context beat should be a quick bridge, not a long setup wall.",
        "- Default to no dedicated App Store/setup beat unless the in-app proof still needs one short context bridge.",
        "- Let proof own more runtime than packaging. Core task plus outcome should outweigh any summary or verdict overlays.",
        "- Prefer the closing verdict as an overlay on the strongest outcome/proof frame instead of adding a separate scorecard card.",
        "- Thin-evidence rule: if outcome and verdict rely on the same proof frame, keep the verdict as the last caption change on that frame instead of inventing a new visual beat.",
        "- Import the prepared proof assets from `post/capcut-import/`, not the raw Stage 2 screenshots. Those assets should already be 1080x1920 and phone-dominant before you animate or caption them.",
        "- Use full-bleed crop or blur-fill framing when needed. Do not leave a tiny centered phone floating inside a generic dark shell.",
        "- Keep the voiceover and subtitle copy aligned. The edit should feel like one guided walkthrough, not like separate narration and caption scripts fighting each other.",
        "",
        "# Keep Out",
        "- Do not let browser Today or browser detail screenshots become the main visual story when iPhone captures exist.",
        "- Do not leave the iPhone tiny inside a large decorative background.",
        "- Do not use dense mixed-language overlay text when the short alias already carries the identity cleanly.",
        "- Do not solve thin evidence with extra scorecards, paragraphs, or verdict copy.",
        "- Do not add back-to-back packaging beats when the same message could live on a real proof frame.",
        "",
        "# Slide Order",
    ]
    for index, beat in enumerate(beat_specs, start=1):
        plan_lines.append(f"{index}. {beat['id']}")

    plan_lines.extend(["", "# Beat Timing"])
    for beat in beat_specs:
        plan_lines.append(f"- {beat['id']}: {beat['duration']}")

    plan_lines.extend(["", "# Slide Drafts"])
    for beat in beat_specs:
        heading = " ".join(part.capitalize() for part in beat["id"].split("-"))
        plan_lines.extend(
            [
                f"## {heading}",
                f"- Purpose: {beat['purpose']}",
                f"- Preferred asset: {beat['preferredAsset']}",
                f"- Headline: {beat['headline']}",
                f"- Support copy: {beat['support']}",
            ]
        )
        if beat["id"] == "outcome":
            plan_lines.append("- Closing-use note: when the proof set is thin, let this frame carry the closing verdict overlay instead of adding another text-heavy summary card.")
        if beat["id"] == "verdict":
            plan_lines.append("- Preferred layout: keep the verdict attached to the strongest proof frame instead of cutting to a separate card.")

    plan_lines.extend(["", "# Import Order"])
    for asset in import_assets:
        plan_lines.append(f"- `{asset['targetName']}` <- `{asset['source']}` ({asset['role']})")

    plan_lines.extend(["", "# Narration"])
    for index, line in enumerate(narration_lines, start=1):
        plan_lines.append(f"{index}. {line}")

    plan_lines.extend(
        [
            "",
            "# Voiceover",
            "- Tone: warm, direct, review-like, and specific.",
            "- Pace: brisk enough for a short, but leave the proof slides room to breathe.",
            "- Keep the spoken alias stable; do not drift back into unreadable mixed-language branding.",
            "",
            "# Closing Verdict",
            sentence_case(english_review_copy(first_non_empty(hooks.get("oneSentenceVerdict"), audience.get("bestFor"), story_angle), max_chars=128, max_words=22, fallback=story_angle)),
            "",
            "# Claims To Make",
        ]
    )

    claims_to_make = [compact_text(item, max_chars=100, max_words=18) for item in as_list(findings.get("highlights"))[:3]]
    if not claims_to_make:
        claims_to_make = [compact_text(story_angle, max_chars=100, max_words=18, fallback="Keep the verdict scoped to what the run actually proved.")]
    for item in claims_to_make:
        plan_lines.append(f"- {item}")

    plan_lines.extend(["", "# Claims To Avoid"])
    claims_to_avoid = [compact_text(item, max_chars=100, max_words=18) for item in as_list(coverage.get("coverageGaps"))[:3]]
    if not claims_to_avoid:
        claims_to_avoid = ["Do not imply deeper product depth than the visible proof actually shows."]
    for item in claims_to_avoid:
        plan_lines.append(f"- {item}")

    revision_lines = build_revision_notes(feedback)
    if thin_evidence:
        revision_lines.insert(
            0,
            "- Evidence strength: the current Stage 2 package is still thin, so keep the edit short and proof-first. If the cut still feels shallow after one honest pass, go back to exploration instead of padding more cards.",
        )
    if revision_lines:
        plan_lines.extend(["", "# Revision Notes", *revision_lines])

    shot_list_lines = [
        "# CapCut Shot List",
        "- Follow this beat order directly in CapCut so the product stays dominant and the packaging stays brief.",
        "- Reuse the same proof frame for the verdict overlay when possible instead of cutting to a separate text card.",
        "",
    ]
    for index, beat in enumerate(beat_specs, start=1):
        shot_list_lines.extend(
            [
                f"## Beat {index}: {beat['id']}",
                f"- Import asset: `{beat.get('importAsset') or beat.get('source') or 'reuse previous proof frame'}`",
                f"- Source file: `{beat.get('source') or 'reuse previous proof frame'}`",
                f"- Target duration: {beat['duration']}",
                f"- Trim hint: {beat['trimHint']}",
                f"- Framing: {beat['framing']}",
                f"- Text budget: {beat['textBudget']}",
                f"- Headline: {beat['headline']}",
                f"- Support copy: {beat['support']}",
                f"- Narration: {beat.get('narration') or 'No dedicated narration line; keep the beat visually obvious.'}",
                "",
            ]
        )

    import_manifest = {
        "appAlias": alias,
        "runtimeTarget": runtime_target,
        "demoDepth": demo_depth,
        "thinEvidence": thin_evidence,
        "projectName": project_name,
        "projectSlug": project_slug,
        "runSlug": run_slug,
        "visualAssetMode": "prepared_phone_proof_panels",
        "draftKeywords": [
            keyword
            for keyword in [alias, project_name, run_slug, project_slug]
            if clean_text(keyword)
        ],
        "homeSurfaceHints": {
            "galleryLabels": ["开始创作", "Start creating", "首页", "Home", "草稿", "Drafts"],
            "editorLabels": ["导入", "Import", "媒体", "Media", "时间线", "Timeline"],
            "starterTiles": ["录屏", "Screen record"],
        },
        "expectedImportCount": len(import_assets),
        "expectedRoles": [asset["role"] for asset in import_assets],
        "timelineChecklist": ["opening-overlay", "core-task", "outcome"],
        "beats": [
            {
                "order": index + 1,
                "id": beat["id"],
                "importAsset": beat.get("importAsset") or "",
                "source": beat.get("source") or "",
                "duration": beat["duration"],
                "trimHint": beat["trimHint"],
                "framing": beat["framing"],
                "headline": beat["headline"],
                "support": beat["support"],
                "narration": beat.get("narration") or "",
            }
            for index, beat in enumerate(beat_specs)
        ],
        "importAssets": [
            {
                "order": int(asset["order"]),
                "role": asset["role"],
                "source": asset["source"],
                "targetName": asset["targetName"],
            }
            for asset in import_assets
        ],
    }

    (post_dir / "video-plan.md").write_text("\n".join(plan_lines).rstrip() + "\n")
    (assets_dir / "narration.txt").write_text("\n".join(narration_lines).rstrip() + "\n")
    (post_dir / "capcut-shot-list.md").write_text("\n".join(shot_list_lines).rstrip() + "\n")
    (post_dir / "capcut-import-manifest.json").write_text(json.dumps(import_manifest, indent=2, ensure_ascii=False) + "\n")

    print(
        json.dumps(
            {
                "videoPlan": str(post_dir / "video-plan.md"),
                "narration": str(assets_dir / "narration.txt"),
                "shotList": str(post_dir / "capcut-shot-list.md"),
                "importManifest": str(post_dir / "capcut-import-manifest.json"),
                "alias": alias,
                "slides": slide_order,
                "clips": [
                    str(core_clip.relative_to(root)) if core_clip_exists else None,
                    str(secondary_clip.relative_to(root)) if secondary_clip_exists else None,
                ],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: build_video_plan.py <artifacts-root-dir>")
    raise SystemExit(main(sys.argv[1]))
