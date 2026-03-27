#!/usr/bin/env python3
from __future__ import annotations

import re
from urllib.parse import unquote, urlparse


CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
LATIN_RE = re.compile(r"[A-Za-z]")
SEPARATOR_RE = re.compile(r"[:：\-\(\)\|\u00b7/]")
SLUG_STOPWORDS = {
    "app",
    "apps",
    "for",
    "iphone",
    "ipad",
    "ios",
    "game",
    "games",
    "idle",
    "lofi",
    "widget",
    "widgets",
    "theme",
    "themes",
}


def clean_text(value: str | None) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def contains_cjk(value: str | None) -> bool:
    return bool(value and CJK_RE.search(value))


def contains_latin(value: str | None) -> bool:
    return bool(value and LATIN_RE.search(value))


def alias_from_name(name: str) -> str:
    cleaned = clean_text(name)
    if not cleaned:
        return ""

    for part in [clean_text(piece) for piece in SEPARATOR_RE.split(cleaned)]:
        if part and contains_latin(part):
            return part

    for token in [":", "：", "-", "(", "|"]:
        if token in cleaned:
            candidate = clean_text(cleaned.split(token, 1)[0])
            if candidate:
                return candidate
    return cleaned


def alias_from_url(app_store_url: str) -> str:
    url = clean_text(app_store_url)
    if not url:
        return ""

    parsed = urlparse(url)
    segments = [segment for segment in parsed.path.split("/") if segment]
    if len(segments) < 2:
        return ""

    slug = clean_text(unquote(segments[-2]))
    if not slug:
        return ""

    words = [word for word in re.split(r"[-_]+", slug) if word]
    trimmed: list[str] = []
    for word in words:
        lowered = word.lower()
        if trimmed and lowered in SLUG_STOPWORDS:
            break
        if not trimmed and lowered in {"app", "apps"}:
            continue
        trimmed.append(word)
        if len(trimmed) >= 3:
            break

    if not trimmed:
        trimmed = words[:2]

    if not trimmed:
        return ""

    return " ".join(word[:1].upper() + word[1:] for word in trimmed if word)


def derive_review_alias(name: str, app_store_url: str = "") -> str:
    primary = alias_from_name(name)
    if primary and (contains_latin(primary) or not contains_cjk(primary)):
        return primary

    url_alias = alias_from_url(app_store_url)
    if url_alias:
        return url_alias

    return primary or clean_text(name) or "This app"
