#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import os
import re
import sys
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageStat

from app_name_helper import derive_review_alias

W = 1080
H = 1920

BG_TOP = (13, 33, 56)
BG_BOTTOM = (8, 14, 28)
PANEL = (18, 29, 47)
PANEL_ALT = (28, 40, 64)
WHITE = (247, 250, 252)
TEXT = (226, 232, 240)
MUTED = (148, 163, 184)
DARK = (18, 24, 38)
CYAN = (91, 207, 222)
AMBER = (255, 181, 94)
RED = (255, 123, 108)
BORDER = (86, 103, 132)
BLACK = (8, 12, 18)

FONT_PATHS = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Supplemental/NotoSansCJK.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/HelveticaNeue.ttc",
]

CATEGORY_TRANSLATIONS = {
    "生產力": "Productivity",
    "生产力": "Productivity",
    "效率": "Productivity",
    "相片與影片": "Photo & Video",
    "相片和影片": "Photo & Video",
    "照片與影片": "Photo & Video",
    "照片和视频": "Photo & Video",
    "攝影與錄影": "Photo & Video",
    "摄影与录像": "Photo & Video",
    "教育": "Education",
    "工具程式": "Utilities",
    "工具": "Utilities",
    "參考": "Reference",
    "参考": "Reference",
    "生活風格": "Lifestyle",
    "生活方式": "Lifestyle",
    "健康與健身": "Health & Fitness",
    "健康健美": "Health & Fitness",
    "圖書": "Books",
    "書籍": "Books",
    "音樂": "Music",
    "音乐": "Music",
    "娛樂": "Entertainment",
    "娱乐": "Entertainment",
    "商業": "Business",
    "商务": "Business",
    "購物": "Shopping",
    "购物": "Shopping",
    "新聞": "News",
    "新闻": "News",
    "導航": "Navigation",
    "导航": "Navigation",
    "旅遊": "Travel",
    "旅游": "Travel",
    "財經": "Finance",
    "财经": "Finance",
    "美食佳飲": "Food & Drink",
    "美食佳饮": "Food & Drink",
    "醫藥": "Medical",
    "医疗": "Medical",
    "圖形和設計": "Graphics & Design",
    "图形和设计": "Graphics & Design",
    "社交網路": "Social Networking",
    "社交网络": "Social Networking",
}


def choose_font_path() -> str | None:
    for path in FONT_PATHS:
        if os.path.exists(path):
            return path
    return None


FONT_PATH = choose_font_path()


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if FONT_PATH:
        return ImageFont.truetype(FONT_PATH, size)
    return ImageFont.load_default()


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", value).strip()


def contains_cjk(value: str | None) -> bool:
    return bool(value and re.search(r"[\u3400-\u4dbf\u4e00-\u9fff]", value))


INCOMPLETE_ENDINGS = {
    "about",
    "a",
    "an",
    "and",
    "among",
    "as",
    "at",
    "around",
    "across",
    "because",
    "before",
    "but",
    "by",
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
    "through",
    "to",
    "toward",
    "under",
    "via",
    "whether",
    "with",
    "without",
}


def latin_char_count(value: str | None) -> int:
    return len(re.findall(r"[A-Za-z]", clean_text(value)))


def cjk_char_count(value: str | None) -> int:
    return len(re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff]", clean_text(value)))


def looks_incomplete(value: str | None) -> bool:
    text = clean_text(value)
    if not text:
        return True
    if text.lower().startswith(("and ", "or ", "but ", "because ", "so ")):
        return True
    if text.endswith(("-", "—", "–", "/", "(", ":", ",")):
        return True
    tokens = re.findall(r"[A-Za-z']+", text.lower())
    return bool(tokens and tokens[-1] in INCOMPLETE_ENDINGS)


def sentence_case(value: str | None) -> str:
    text = clean_text(value)
    if not text:
        return ""
    return text[:1].upper() + text[1:]


def prefer_readable_review_copy(value: str | None, fallback: str, *, max_cjk_chars: int) -> str:
    text = clean_text(value)
    backup = clean_text(fallback)
    if text and contains_cjk(text) and (cjk_char_count(text) > max_cjk_chars or latin_char_count(text) <= 3) and latin_char_count(text) < max(8, cjk_char_count(text) * 2):
        return backup or text
    if looks_incomplete(text):
        return backup or text
    return text or backup


def split_sentences(text: str) -> list[str]:
    text = clean_text(text)
    if not text:
        return []
    parts = re.split(r"(?<=[.!?。！？])\s+|\n+", text)
    return [clean_text(part) for part in parts if clean_text(part)]


def word_count(text: str) -> int:
    return len([token for token in clean_text(text).split(" ") if token])


def compact_text(
    value: str | None,
    *,
    max_chars: int,
    max_words: int,
    fallback: str = "",
) -> str:
    text = clean_text(value)
    if not text:
        return fallback

    for sentence in split_sentences(text):
        if len(sentence) <= max_chars and word_count(sentence) <= max_words:
            return sentence

    if word_count(text) <= 1:
        return text[:max_chars].rstrip(" ,;:") if len(text) > max_chars else text

    for sentence in split_sentences(text):
        clauses = [
            clean_text(part)
            for part in re.split(r"\s*(?:[,:;]\s+|\s+[-\u2013\u2014]\s+|\s+\bbut\b\s+|\s+\bbecause\b\s+|\s+\bso\b\s+)\s*", sentence, flags=re.IGNORECASE)
            if clean_text(part)
        ]
        fitting = [
            clause
            for clause in clauses
            if len(clause) <= max_chars and word_count(clause) <= max_words and not looks_incomplete(clause)
        ]
        if fitting:
            return max(fitting, key=lambda clause: (len(clause), word_count(clause)))

    words = text.split(" ")
    trimmed = " ".join(words[:max_words]).strip()
    if len(trimmed) > max_chars:
        trimmed = trimmed[:max_chars].rstrip(" ,;:")
    if trimmed != text:
        trimmed = trimmed.rstrip(".!?,;:。！？")
    if looks_incomplete(trimmed):
        return fallback or text
    return trimmed or fallback


def derive_alias(name: str, app_store_url: str = "") -> str:
    return derive_review_alias(name, app_store_url)


def clean_store_subtitle(value: str | None) -> str:
    text = clean_text(value)
    if not text:
        return ""
    bad_patterns = [
        r"^在 App Store 下載",
        r"^Download .* on the App Store",
        r"查看螢幕截圖",
        r"評分與評論",
        r"用户貼士",
    ]
    for pattern in bad_patterns:
        if re.search(pattern, text, flags=re.IGNORECASE):
            return ""
    return text


def first_sentence(text: str) -> str:
    text = clean_text(text)
    if not text:
        return ""
    for sep in [". ", "。", "！", "!", "?", "？"]:
        if sep in text:
            return clean_text(text.split(sep, 1)[0])
    return text


def parse_video_plan(video_plan_path: Path) -> dict[str, dict[str, str]]:
    sections: dict[str, dict[str, str]] = {}
    if not video_plan_path.exists():
        return sections
    current: str | None = None
    for raw_line in video_plan_path.read_text().splitlines():
        line = raw_line.strip()
        if line.startswith("## "):
            current = normalize_section_name(line[3:])
            sections.setdefault(current, {})
            continue
        if not current or not line.startswith("- "):
            continue
        if ":" not in line:
            continue
        key, value = line[2:].split(":", 1)
        sections[current][key.strip().lower()] = clean_text(value)
    return sections


def normalize_section_name(value: str) -> str:
    value = value.lower()
    replacements = {
        "title card": "title",
        "opening overlay": "title",
        "store promise": "store",
        "context beat": "store",
        "first impression": "first",
        "core task": "core",
        "outcome": "outcome",
        "secondary proof": "secondary",
        "secondary feature": "secondary",
        "extra evidence": "secondary",
        "scorecard": "score",
        "verdict": "verdict",
    }
    for source, target in replacements.items():
        if source in value:
            return target
    return value


def parse_markdown_sections(path: Path) -> dict[str, str]:
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


def story_text(story_sections: dict[str, str], section: str) -> str:
    return clean_text(story_sections.get(section.lower()) or "")


def make_background() -> Image.Image:
    img = Image.new("RGB", (W, H), BG_BOTTOM)
    pix = img.load()
    for y in range(H):
        ratio = y / (H - 1)
        row = tuple(
            int(BG_TOP[i] * (1 - ratio) + BG_BOTTOM[i] * ratio)
            for i in range(3)
        )
        for x in range(W):
            pix[x, y] = row
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.ellipse((-120, 40, 420, 620), fill=(34, 153, 192, 42))
    draw.ellipse((640, 80, 1260, 720), fill=(255, 169, 84, 34))
    draw.ellipse((720, 1120, 1280, 1760), fill=(111, 84, 255, 26))
    overlay = overlay.filter(ImageFilter.GaussianBlur(68))
    return Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")


def rounded_panel(
    base: Image.Image,
    rect: tuple[int, int, int, int],
    *,
    fill: tuple[int, int, int],
    radius: int = 36,
    border: tuple[int, int, int] | None = BORDER,
    shadow: bool = True,
) -> None:
    x1, y1, x2, y2 = rect
    if shadow:
        shadow_layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
        shadow_draw = ImageDraw.Draw(shadow_layer)
        shadow_draw.rounded_rectangle(
            (x1 + 8, y1 + 10, x2 + 8, y2 + 10),
            radius=radius,
            fill=(0, 0, 0, 90),
        )
        shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(24))
        base.alpha_composite(shadow_layer)
    draw = ImageDraw.Draw(base)
    draw.rounded_rectangle(rect, radius=radius, fill=fill, outline=border, width=2 if border else 0)


def draw_label(draw: ImageDraw.ImageDraw, text: str, x: int, y: int, *, fill=AMBER) -> int:
    font = load_font(26)
    draw.text((x, y), text.upper(), font=font, fill=fill)
    bbox = draw.textbbox((x, y), text.upper(), font=font)
    return bbox[3] - bbox[1]


def wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> list[str]:
    text = clean_text(text)
    if not text:
        return []
    words = text.split(" ")
    if len(words) <= 1:
        return wrap_text_charwise(draw, text, font, max_width)
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        tentative = f"{current} {word}".strip()
        if draw.textbbox((0, 0), tentative, font=font)[2] <= max_width:
            current = tentative
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def wrap_text_charwise(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> list[str]:
    lines: list[str] = []
    current = ""
    for char in text:
        tentative = f"{current}{char}"
        if current and draw.textbbox((0, 0), tentative, font=font)[2] > max_width:
            lines.append(current)
            current = char
        else:
            current = tentative
    if current:
        lines.append(current)
    return lines


def fit_multiline_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    *,
    max_width: int,
    max_height: int,
    preferred_size: int,
    min_size: int,
    max_lines: int,
) -> tuple[ImageFont.ImageFont, list[str], int]:
    for size in range(preferred_size, min_size - 1, -2):
        font = load_font(size)
        lines = wrap_text(draw, text, font, max_width)
        if not lines:
            return font, [], 0
        if len(lines) > max_lines:
            continue
        bbox = draw.textbbox((0, 0), "Ag", font=font)
        line_height = (bbox[3] - bbox[1]) + max(8, size // 6)
        total_height = line_height * len(lines)
        if total_height <= max_height:
            return font, lines, line_height

    font = load_font(min_size)
    lines = wrap_text(draw, text, font, max_width)[:max_lines]
    if lines:
        while draw.textbbox((0, 0), lines[-1], font=font)[2] > max_width and len(lines[-1]) > 3:
            lines[-1] = lines[-1][:-2].rstrip()
        if len(lines[-1]) > 3 and not lines[-1].endswith("..."):
            lines[-1] = f"{lines[-1]}..."
    bbox = draw.textbbox((0, 0), "Ag", font=font)
    line_height = (bbox[3] - bbox[1]) + max(8, min_size // 6)
    return font, lines, line_height


def draw_multiline(
    draw: ImageDraw.ImageDraw,
    text: str,
    *,
    box: tuple[int, int, int, int],
    preferred_size: int,
    min_size: int,
    fill: tuple[int, int, int],
    max_lines: int,
) -> int:
    x, y, width, height = box
    font, lines, line_height = fit_multiline_text(
        draw,
        text,
        max_width=width,
        max_height=height,
        preferred_size=preferred_size,
        min_size=min_size,
        max_lines=max_lines,
    )
    current_y = y
    for line in lines:
        draw.text((x, current_y), line, font=font, fill=fill)
        current_y += line_height
    return current_y


def open_image(path: Path) -> Image.Image:
    return Image.open(path).convert("RGB")


def trim_uniform_border(img: Image.Image) -> Image.Image:
    if img.width < 80 or img.height < 80:
        return img
    bg = Image.new(img.mode, img.size, img.getpixel((0, 0)))
    diff = ImageChops.difference(img, bg).convert("L")
    bbox = diff.getbbox()
    if not bbox:
        return img
    x1, y1, x2, y2 = bbox
    if (x2 - x1) < img.width * 0.58 or (y2 - y1) < img.height * 0.58:
        return img
    pad = max(4, min(img.width, img.height) // 120)
    return img.crop((
        max(0, x1 - pad),
        max(0, y1 - pad),
        min(img.width, x2 + pad),
        min(img.height, y2 + pad),
    ))


def image_difference_score(path_a: Path, path_b: Path) -> float:
    if not path_a.exists() or not path_b.exists():
        return 0.0
    img_a = open_image(path_a).convert("L").resize((64, 64), Image.LANCZOS)
    img_b = open_image(path_b).convert("L").resize((64, 64), Image.LANCZOS)
    diff = ImageChops.difference(img_a, img_b)
    stat = ImageStat.Stat(diff)
    return float(stat.mean[0]) / 255.0


def first_existing(paths: Iterable[Path]) -> Path | None:
    for path in paths:
        if path.exists():
            return path
    return None


def choose_story_screens(root: Path) -> tuple[Path, Path, Path | None]:
    first_screen = root / "experience" / "screenshots" / "01-First-Screen.png"
    main_screen = root / "experience" / "screenshots" / "02-Main-Screen.png"
    core_screen = root / "experience" / "screenshots" / "03-Core-Task.png"
    outcome_screen = root / "experience" / "screenshots" / "04-Outcome-Or-Friction.png"
    secondary_screen = root / "experience" / "screenshots" / "05-Secondary-Feature.png"
    limit_screen = root / "experience" / "screenshots" / "06-Pricing-Or-Limit.png"

    core = first_existing([core_screen, main_screen, first_screen])
    if core is None:
        raise SystemExit("Missing exploration screenshots for core story beats.")

    outcome = None
    for candidate in [outcome_screen, secondary_screen, limit_screen, main_screen, first_screen]:
        if candidate.exists() and candidate != core:
            outcome = candidate
            break
    if outcome is None:
        outcome = core

    secondary = None
    for candidate in [secondary_screen, limit_screen, main_screen, outcome_screen, first_screen]:
        if not candidate.exists() or candidate in {core, outcome}:
            continue
        if image_difference_score(candidate, core) >= 0.06 and image_difference_score(candidate, outcome) >= 0.05:
            secondary = candidate
            break

    return core, outcome, secondary


def contain_size(src_w: int, src_h: int, dst_w: int, dst_h: int) -> tuple[int, int]:
    ratio = min(dst_w / src_w, dst_h / src_h)
    return max(1, int(src_w * ratio)), max(1, int(src_h * ratio))


def cover_size(src_w: int, src_h: int, dst_w: int, dst_h: int) -> tuple[int, int]:
    ratio = max(dst_w / src_w, dst_h / src_h)
    return max(1, int(src_w * ratio)), max(1, int(src_h * ratio))


def paste_framed_image(
    base: Image.Image,
    path: Path,
    rect: tuple[int, int, int, int],
    *,
    radius: int = 40,
    pad: int = 28,
    card_fill: tuple[int, int, int] = BLACK,
) -> None:
    panel = Image.new("RGBA", base.size, (0, 0, 0, 0))
    rounded_panel(panel, rect, fill=card_fill, radius=radius, border=BORDER)
    img = trim_uniform_border(open_image(path))
    x1, y1, x2, y2 = rect
    inner_w = (x2 - x1) - pad * 2
    inner_h = (y2 - y1) - pad * 2

    bg_w, bg_h = cover_size(img.width, img.height, inner_w, inner_h)
    bg = img.resize((bg_w, bg_h), Image.LANCZOS)
    bg_left = max(0, (bg_w - inner_w) // 2)
    bg_top = max(0, (bg_h - inner_h) // 2)
    bg = bg.crop((bg_left, bg_top, bg_left + inner_w, bg_top + inner_h)).filter(ImageFilter.GaussianBlur(26))
    bg_rgba = bg.convert("RGBA")
    bg_rgba.alpha_composite(Image.new("RGBA", (inner_w, inner_h), (6, 12, 18, 122)))
    bg_mask = Image.new("L", (inner_w, inner_h), 0)
    ImageDraw.Draw(bg_mask).rounded_rectangle((0, 0, inner_w, inner_h), radius=max(24, radius - 10), fill=255)
    panel.paste(bg_rgba, (x1 + pad, y1 + pad), bg_mask)

    sharp_margin = max(16, pad // 2)
    sharp_w, sharp_h = contain_size(
        img.width,
        img.height,
        max(1, inner_w - sharp_margin * 2),
        max(1, inner_h - sharp_margin * 2),
    )
    sharp = img.resize((sharp_w, sharp_h), Image.LANCZOS)
    sharp_x = x1 + pad + (inner_w - sharp_w) // 2
    sharp_y = y1 + pad + (inner_h - sharp_h) // 2

    shadow_layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow_layer)
    shadow_draw.rounded_rectangle(
        (sharp_x + 10, sharp_y + 14, sharp_x + sharp_w + 10, sharp_y + sharp_h + 14),
        radius=28,
        fill=(0, 0, 0, 98),
    )
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(18))
    panel.alpha_composite(shadow_layer)

    sharp_mask = Image.new("L", (sharp_w, sharp_h), 0)
    ImageDraw.Draw(sharp_mask).rounded_rectangle((0, 0, sharp_w, sharp_h), radius=26, fill=255)
    panel.paste(sharp, (sharp_x, sharp_y), sharp_mask)
    base.alpha_composite(panel)


def quote_safe(value: str, fallback: str) -> str:
    value = clean_text(value)
    if value and contains_cjk(value) and latin_char_count(value) < max(4, cjk_char_count(value) * 2) and len(value) > 18:
        return fallback
    if looks_incomplete(value):
        return fallback
    return value or fallback


def as_dict(value: object) -> dict[str, object]:
    return value if isinstance(value, dict) else {}


def as_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for item in value:
        text = clean_text(str(item))
        if text:
            items.append(text)
    return items


def first_non_empty(*values: object) -> str:
    for value in values:
        text = clean_text(str(value or ""))
        if text:
            return text
    return ""


def sentence_from_list(value: object, fallback: str) -> str:
    items = as_list(value)
    if items:
        return items[0]
    return fallback


def generic_store_headline(listing: dict[str, object]) -> str:
    subtitle = clean_store_subtitle(str(listing.get("subtitle") or ""))
    if subtitle and contains_cjk(subtitle) and not re.search(r"[A-Za-z]", subtitle):
        return "What the store promises"
    if subtitle:
        return subtitle
    return "What the store promises"


def generic_store_support(listing: dict[str, object]) -> str:
    description = first_sentence(str(listing.get("description") or ""))
    if description and contains_cjk(description) and latin_char_count(description) < max(4, cjk_char_count(description) * 2):
        return "The listing sets a clear product promise before the install even begins."
    if description:
        return prefer_readable_review_copy(
            compact_text(description, max_chars=88, max_words=16, fallback=description),
            "The listing sets a clear product promise before the install even begins.",
            max_cjk_chars=18,
        )
    return "The listing sets a clear product promise before the install even begins."


def generic_title_support(notes: dict[str, object], story_sections: dict[str, str]) -> str:
    hooks = as_dict(notes.get("scriptHooks"))
    fallback = "A quick iPhone review built from one real first-run test."
    return prefer_readable_review_copy(
        compact_text(
        first_non_empty(
            story_text(story_sections, "Video Angle"),
            hooks.get("openingHook"),
            hooks.get("tensionLine"),
            hooks.get("oneSentenceVerdict"),
            generic_score_support(notes, story_sections),
        ),
        max_chars=92,
        max_words=16,
        fallback=fallback,
    ),
        fallback,
        max_cjk_chars=22,
    )


def generic_first_support(notes: dict[str, object], story_sections: dict[str, str]) -> str:
    coverage = as_dict(notes.get("coverage"))
    findings = as_dict(notes.get("findings"))
    fallback = "The first live screen quickly sets the tone for the review."
    return prefer_readable_review_copy(
        compact_text(
        first_non_empty(
            story_text(story_sections, "Opening Frame"),
            sentence_from_list(
                coverage.get("evidenceMoments"),
                sentence_from_list(
                    findings.get("highlights"),
                    fallback,
                ),
            ),
        ),
        max_chars=88,
        max_words=16,
        fallback=fallback,
    ),
        fallback,
        max_cjk_chars=22,
    )


def generic_core_support(notes: dict[str, object], story_sections: dict[str, str]) -> str:
    coverage = as_dict(notes.get("coverage"))
    fallback = "The run reaches a real task instead of stopping at menus."
    return prefer_readable_review_copy(
        compact_text(
        first_non_empty(
            story_text(story_sections, "Primary Loop"),
            sentence_from_list(
                coverage.get("coreTasksCompleted"),
                "",
            ),
            first_non_empty(
                coverage.get("primaryLoop"),
                coverage.get("explorationStrategy"),
                fallback,
            ),
        ),
        max_chars=88,
        max_words=16,
        fallback=fallback,
    ),
        fallback,
        max_cjk_chars=22,
    )


def generic_outcome_support(notes: dict[str, object], story_sections: dict[str, str]) -> str:
    hooks = as_dict(notes.get("scriptHooks"))
    findings = as_dict(notes.get("findings"))
    fallback = "The outcome shows the clearest payoff or limitation from the run."
    return prefer_readable_review_copy(
        compact_text(
        first_non_empty(
            story_text(story_sections, "Climax Frame"),
            hooks.get("payoffLine"),
            hooks.get("oneSentenceVerdict"),
            sentence_from_list(findings.get("painPoints"), ""),
            sentence_from_list(findings.get("highlights"), ""),
            fallback,
        ),
        max_chars=92,
        max_words=16,
        fallback=fallback,
    ),
        fallback,
        max_cjk_chars=22,
    )


def generic_score_support(notes: dict[str, object], story_sections: dict[str, str]) -> str:
    hooks = as_dict(notes.get("scriptHooks"))
    fallback = "A balanced take after one real run."
    return prefer_readable_review_copy(
        compact_text(
        first_non_empty(
            story_text(story_sections, "Closing Frame"),
            hooks.get("oneSentenceVerdict"),
            generic_outcome_support(notes, story_sections),
        ),
        max_chars=72,
        max_words=12,
        fallback=fallback,
    ),
        fallback,
        max_cjk_chars=18,
    )


def generic_secondary_support(notes: dict[str, object], story_sections: dict[str, str]) -> str:
    coverage = as_dict(notes.get("coverage"))
    findings = as_dict(notes.get("findings"))
    fallback = "One extra proof beat adds depth beyond the main task."
    return prefer_readable_review_copy(
        compact_text(
        first_non_empty(
            story_text(story_sections, "Secondary Proof"),
            coverage.get("secondaryProof"),
            sentence_from_list(findings.get("surprises"), ""),
            sentence_from_list(findings.get("highlights"), ""),
            fallback,
        ),
        max_chars=88,
        max_words=16,
        fallback=fallback,
    ),
        fallback,
        max_cjk_chars=22,
    )


def score_footer_chip(notes: dict[str, object]) -> str:
    coverage = as_dict(notes.get("coverage"))
    scorecard = as_dict(notes.get("scorecard"))
    overall = float(scorecard.get("overall") or 0)
    depth = clean_text(str(coverage.get("demoDepth") or ""))
    if depth == "shallow":
        return "Too shallow to judge"
    if overall >= 7:
        return "Worth trying"
    if overall >= 5:
        return "Promising, with caveats"
    return "Not proven yet"


def verdict_chip_text(notes: dict[str, object], drafts: dict[str, dict[str, str]]) -> str:
    hooks = as_dict(notes.get("scriptHooks"))
    return compact_text(
        first_non_empty(
            drafts.get("verdict", {}).get("headline"),
            drafts.get("title", {}).get("headline"),
            hooks.get("oneSentenceVerdict"),
        ),
        max_chars=32,
        max_words=5,
        fallback=score_footer_chip(notes),
    )


def localized_support_name(local_name: str, alias: str) -> str:
    local_name = clean_text(local_name)
    if not local_name or local_name == alias:
        return ""
    if len(local_name) > 30:
        return ""
    compact = compact_text(local_name, max_chars=24, max_words=8, fallback="")
    if contains_cjk(compact) and len(compact) > 18:
        return ""
    return compact


def normalize_category(value: str | None) -> str:
    text = clean_text(value)
    return CATEGORY_TRANSLATIONS.get(text, text)


def normalize_price_text(value: str | None) -> str:
    text = clean_text(value)
    lowered = text.lower()
    if text in {"免費", "免费"} or lowered == "free":
        return "Free"
    return text


def meta_line(listing: dict[str, object]) -> str:
    parts = []
    rating = listing.get("rating")
    if rating:
        try:
            parts.append(f"{float(rating):.1f}★")
        except Exception:
            parts.append(f"{rating}★")
    category = normalize_category(str(listing.get("category") or ""))
    if category:
        parts.append(category)
    price = normalize_price_text(str(listing.get("priceText") or ""))
    if price:
        parts.append(price)
    return " · ".join(parts)


def draw_chip(base: Image.Image, text: str, rect: tuple[int, int, int, int], *, fill=CYAN, text_fill=DARK) -> None:
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    rounded_panel(layer, rect, fill=fill, radius=26, border=None, shadow=False)
    draw = ImageDraw.Draw(layer)
    x1, y1, x2, y2 = rect
    draw_multiline(
        draw,
        text,
        box=(x1 + 28, y1 + 18, (x2 - x1) - 56, (y2 - y1) - 36),
        preferred_size=34,
        min_size=24,
        fill=text_fill,
        max_lines=2,
    )
    base.alpha_composite(layer)


def rating_color(score: float) -> tuple[int, int, int]:
    if score >= 7:
        return CYAN
    if score >= 5:
        return AMBER
    return RED


def render_title_card(root: Path, listing: dict[str, object], notes: dict[str, object], drafts: dict[str, dict[str, str]], story_sections: dict[str, str]) -> None:
    img = make_background().convert("RGBA")
    draw = ImageDraw.Draw(img)
    app_notes = as_dict(notes.get("app"))
    alias = derive_alias(
        str(listing.get("name") or app_notes.get("name") or "This app"),
        str(listing.get("appStoreUrl") or app_notes.get("appStoreUrl") or ""),
    )
    title = quote_safe(drafts.get("title", {}).get("headline"), "Worth trying on iPhone?")
    support = quote_safe(
        drafts.get("title", {}).get("support copy"),
        generic_title_support(notes, story_sections),
    )
    local_name = localized_support_name(str(listing.get("name") or ""), alias)
    meta = meta_line(listing)

    draw_label(draw, "iPhone review", 72, 62)
    draw_multiline(draw, title, box=(72, 118, 936, 144), preferred_size=74, min_size=52, fill=WHITE, max_lines=2)
    draw_multiline(draw, support, box=(72, 254, 850, 88), preferred_size=32, min_size=24, fill=MUTED, max_lines=2)

    if meta:
        draw_chip(img, meta, (72, 346, 516, 430), fill=(238, 244, 249), text_fill=DARK)

    if local_name and local_name != alias:
        draw_multiline(draw, local_name, box=(548, 356, 382, 52), preferred_size=24, min_size=18, fill=TEXT, max_lines=1)

    shot = root / "experience" / "screenshots" / "02-Main-Screen.png"
    if not shot.exists():
        shot = root / "experience" / "screenshots" / "01-First-Screen.png"
    paste_framed_image(img, shot, (124, 468, 956, 1566), radius=42, pad=26)

    draw_multiline(draw, alias, box=(84, 1592, 620, 62), preferred_size=48, min_size=32, fill=WHITE, max_lines=1)

    chip_text = quote_safe(drafts.get("store", {}).get("headline"), generic_store_headline(listing))
    draw_chip(img, chip_text, (72, 1734, 1008, 1828))

    img.convert("RGB").save(root / "post" / "assets" / "title-card.png")


def render_evidence_card(
    root: Path,
    *,
    filename: str,
    label: str,
    title: str,
    support: str,
    screenshot: Path,
    chip_text: str | None = None,
    screenshot_rect: tuple[int, int, int, int] = (70, 360, 1010, 1590),
    chip_rect: tuple[int, int, int, int] = (120, 1660, 960, 1748),
) -> None:
    img = make_background().convert("RGBA")
    draw = ImageDraw.Draw(img)
    draw_label(draw, label, 72, 62)
    draw_multiline(draw, title, box=(72, 118, 936, 118), preferred_size=62, min_size=42, fill=WHITE, max_lines=2)
    draw_multiline(draw, support, box=(72, 236, 900, 84), preferred_size=30, min_size=22, fill=MUTED, max_lines=2)
    paste_framed_image(img, screenshot, screenshot_rect, radius=42, pad=32)
    if chip_text:
        draw_chip(img, chip_text, chip_rect)
    img.convert("RGB").save(root / "post" / "assets" / filename)


def render_secondary_proof(root: Path, notes: dict[str, object], drafts: dict[str, dict[str, str]], screenshot: Path, story_sections: dict[str, str]) -> None:
    render_evidence_card(
        root,
        filename="secondary-proof-card.png",
        label="secondary proof",
        title=quote_safe(drafts.get("secondary", {}).get("headline"), "One more proof beat"),
        support=quote_safe(drafts.get("secondary", {}).get("support copy"), generic_secondary_support(notes, story_sections)),
        screenshot=screenshot,
        chip_text="Extra depth",
    )


def draw_metric_row(base: Image.Image, *, y: int, label: str, score: float) -> None:
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    rounded_panel(layer, (72, y, 1008, y + 118), fill=PANEL_ALT, radius=28, border=BORDER, shadow=False)
    draw = ImageDraw.Draw(layer)
    draw_multiline(draw, label, box=(112, y + 30, 540, 52), preferred_size=34, min_size=26, fill=TEXT, max_lines=1)
    pill_fill = rating_color(score)
    rounded_panel(layer, (854, y + 24, 962, y + 92), fill=pill_fill, radius=22, border=None, shadow=False)
    draw_multiline(draw, f"{score:g}", box=(886, y + 38, 52, 30), preferred_size=34, min_size=24, fill=DARK, max_lines=1)
    base.alpha_composite(layer)


def render_scorecard(root: Path, notes: dict[str, object], drafts: dict[str, dict[str, str]], story_sections: dict[str, str]) -> None:
    img = make_background().convert("RGBA")
    draw = ImageDraw.Draw(img)
    headline = quote_safe(drafts.get("score", {}).get("headline"), "Balanced take")
    support = quote_safe(drafts.get("score", {}).get("support copy"), generic_score_support(notes, story_sections))

    draw_label(draw, "scorecard", 72, 62)
    draw_multiline(draw, headline, box=(72, 118, 936, 124), preferred_size=60, min_size=42, fill=WHITE, max_lines=2)

    scorecard = as_dict(notes.get("scorecard"))
    overall = float(scorecard.get("overall") or 0)
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    rounded_panel(layer, (72, 258, 1008, 530), fill=(242, 246, 251), radius=36, border=None, shadow=False)
    d2 = ImageDraw.Draw(layer)
    draw_multiline(d2, "Overall", box=(120, 308, 220, 46), preferred_size=30, min_size=24, fill=DARK, max_lines=1)
    draw_multiline(d2, f"{overall:.1f}/10", box=(116, 360, 320, 96), preferred_size=86, min_size=60, fill=DARK, max_lines=1)
    draw_multiline(
        d2,
        compact_text(support, max_chars=60, max_words=9, fallback=support),
        box=(584, 334, 316, 116),
        preferred_size=28,
        min_size=20,
        fill=(55, 73, 104),
        max_lines=2,
    )
    img.alpha_composite(layer)

    rows = [
        ("Ease of use", float(scorecard.get("easeOfUse") or 0)),
        ("Design", float(scorecard.get("design") or 0)),
        ("Novelty", float(scorecard.get("novelty") or 0)),
        ("Retention", float(scorecard.get("retentionPotential") or 0)),
    ]
    for index, (label, score) in enumerate(rows):
        draw_metric_row(img, y=592 + index * 138, label=label, score=score)

    why_text = compact_text(
        support,
        max_chars=90,
        max_words=14,
        fallback="The score should summarize what the run actually proved.",
    )
    proof_text = compact_text(
        first_non_empty(
            sentence_from_list(as_dict(notes.get("findings")).get("mustShowInVideo"), ""),
            sentence_from_list(as_dict(notes.get("findings")).get("surprises"), ""),
            story_text(story_sections, "Primary Loop"),
            generic_core_support(notes, story_sections),
            "One real action mattered more than extra menu taps.",
        ),
        max_chars=84,
        max_words=13,
        fallback="One real action mattered more than extra menu taps.",
    )
    proof_text = sentence_case(proof_text)
    draw_labeled_panel(img, rect=(72, 1188, 1008, 1428), label="Why it landed here", body=why_text, accent=AMBER)
    draw_labeled_panel(img, rect=(72, 1472, 1008, 1662), label="Strongest proof", body=proof_text, accent=CYAN)

    footer_text = score_footer_chip(notes)
    draw_chip(img, footer_text, (72, 1734, 1008, 1828))
    img.convert("RGB").save(root / "post" / "assets" / "scorecard.png")


def draw_labeled_panel(
    base: Image.Image,
    *,
    rect: tuple[int, int, int, int],
    label: str,
    body: str,
    accent: tuple[int, int, int],
) -> None:
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    rounded_panel(layer, rect, fill=PANEL_ALT, radius=32, border=BORDER, shadow=False)
    draw = ImageDraw.Draw(layer)
    x1, y1, x2, y2 = rect
    draw_multiline(draw, label, box=(x1 + 36, y1 + 28, 240, 40), preferred_size=28, min_size=22, fill=accent, max_lines=1)
    draw_multiline(draw, body, box=(x1 + 36, y1 + 84, (x2 - x1) - 72, (y2 - y1) - 118), preferred_size=34, min_size=24, fill=TEXT, max_lines=3)
    base.alpha_composite(layer)


def render_verdict(root: Path, notes: dict[str, object], drafts: dict[str, dict[str, str]], story_sections: dict[str, str]) -> None:
    img = make_background().convert("RGBA")
    draw = ImageDraw.Draw(img)
    hooks = as_dict(notes.get("scriptHooks"))
    audience = as_dict(notes.get("audienceFit"))
    findings = as_dict(notes.get("findings"))
    pain_points = as_list(findings.get("painPoints"))
    combined_pain = " ".join(pain_points).lower()
    listing_signal = " ".join(
        clean_text(str(value or ""))
        for value in [
            as_dict(notes.get("app")).get("category"),
            hooks.get("openingHook"),
            hooks.get("tensionLine"),
            hooks.get("oneSentenceVerdict"),
        ]
    ).lower()
    headline = quote_safe(drafts.get("verdict", {}).get("headline"), "Who this fits")
    pain_point = clean_text(sentence_from_list(findings.get("painPoints"), ""))
    if "timeout" in combined_pain:
        what_happened = "Input friction and a timeout blocked the real answer moment."
    elif any(token in combined_pain for token in ["paywall", "premium", "trial"]):
        what_happened = "A real limit showed up before the strongest payoff landed."
    else:
        what_happened = compact_text(
            first_non_empty(story_text(story_sections, "Video Angle"), hooks.get("oneSentenceVerdict"), generic_outcome_support(notes, story_sections)),
            max_chars=84,
            max_words=14,
            fallback="This run showed a real slice of the app, not the whole promise.",
        )
    what_happened = prefer_readable_review_copy(
        sentence_case(what_happened),
        "This run showed a real slice of the app, not the whole promise.",
        max_cjk_chars=24,
    )
    raw_best_for = clean_text(str(audience.get("bestFor") or ""))
    if raw_best_for and not looks_incomplete(compact_text(raw_best_for, max_chars=80, max_words=13, fallback=raw_best_for)):
        best_for = compact_text(
            raw_best_for,
            max_chars=80,
            max_words=13,
            fallback=raw_best_for,
        )
    elif any(token in listing_signal for token in ["search", "answer", "citation", "source", "chat"]):
        best_for = "People who want a clean AI search app with visible model depth."
    elif any(token in listing_signal for token in ["planner", "calendar", "note", "journal", "task"]):
        best_for = "People who want one calm planning loop that still feels polished."
    else:
        best_for = "People who want the app's main value and can live with the tradeoffs shown here."
    best_for = prefer_readable_review_copy(
        sentence_case(best_for),
        "People who want the app's main value and can live with the tradeoffs shown here.",
        max_cjk_chars=22,
    )
    raw_avoid_if = clean_text(str(audience.get("avoidIf") or ""))
    if raw_avoid_if and "/" not in raw_avoid_if and "mirrored" not in raw_avoid_if.lower() and not looks_incomplete(compact_text(raw_avoid_if, max_chars=80, max_words=13, fallback=raw_avoid_if)):
        avoid_if = compact_text(
            raw_avoid_if,
            max_chars=80,
            max_words=13,
            fallback=raw_avoid_if,
        )
    elif any(token in listing_signal for token in ["search", "answer", "citation", "source", "chat"]):
        avoid_if = "Anyone who needs a fast first-try answer with zero input friction."
    else:
        avoid_if = "Anyone who needs a smoother first run than this video proved."
    avoid_if = prefer_readable_review_copy(
        sentence_case(avoid_if),
        "Anyone who needs a smoother first-run experience than this video proved.",
        max_cjk_chars=22,
    )
    if "timeout" in combined_pain and any(token in listing_signal for token in ["search", "answer", "citation", "source"]):
        why_it_matters = "The promise here is fast sourced answers, so a timeout really matters."
    elif any(token in combined_pain for token in ["paywall", "premium", "trial"]):
        why_it_matters = "A great first impression still needs free proof before the verdict feels fair."
    else:
        why_it_matters = compact_text(
            first_non_empty(
                hooks.get("tensionLine"),
                story_text(story_sections, "Video Angle"),
                "The first real result matters more than polish alone.",
            ),
            max_chars=82,
            max_words=14,
            fallback="The first real result matters more than polish alone.",
        )
    why_it_matters = prefer_readable_review_copy(
        sentence_case(why_it_matters),
        "The first real result matters more than polish alone.",
        max_cjk_chars=22,
    )

    draw_label(draw, "verdict", 72, 62)
    draw_multiline(draw, headline, box=(72, 118, 936, 138), preferred_size=60, min_size=42, fill=WHITE, max_lines=2)
    draw_labeled_panel(img, rect=(72, 316, 1008, 552), label="Take", body=what_happened, accent=AMBER)
    draw_labeled_panel(img, rect=(72, 624, 1008, 852), label="Best for", body=best_for, accent=CYAN)
    draw_labeled_panel(img, rect=(72, 924, 1008, 1152), label="Skip if", body=avoid_if, accent=AMBER)
    draw_labeled_panel(img, rect=(72, 1224, 1008, 1452), label="Why it matters", body=why_it_matters, accent=CYAN)

    closing = verdict_chip_text(notes, drafts)
    draw_chip(img, closing, (72, 1704, 1008, 1812), fill=AMBER, text_fill=DARK)
    img.convert("RGB").save(root / "post" / "assets" / "verdict-card.png")


def main(root_dir: str) -> None:
    root = Path(root_dir).expanduser().resolve()
    assets_dir = root / "post" / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    listing = json.loads((root / "topic" / "app-store-listing.json").read_text())
    notes = json.loads((root / "experience" / "notes.json").read_text())
    drafts = parse_video_plan(root / "post" / "video-plan.md")
    story_sections = parse_markdown_sections(root / "experience" / "story-beats.md")
    app_notes = as_dict(notes.get("app"))
    alias = derive_alias(
        str(listing.get("name") or app_notes.get("name") or "App"),
        str(listing.get("appStoreUrl") or app_notes.get("appStoreUrl") or ""),
    )

    store_draft = drafts.get("store", {})
    include_store_card = bool(store_draft)
    store_headline = quote_safe(store_draft.get("headline"), generic_store_headline(listing))
    store_support = quote_safe(store_draft.get("support copy"), generic_store_support(listing))
    store_chip = meta_line(listing)
    core_shot, outcome_shot, secondary_shot = choose_story_screens(root)
    store_shot = root / "topic" / "screenshots" / "02-iPhone-App-Store-Detail.png"
    if not store_shot.exists():
        fallback_store_shot = root / "topic" / "screenshots" / "01-Browser-App-Detail.png"
        store_shot = fallback_store_shot if fallback_store_shot.exists() else store_shot

    render_title_card(root, listing, notes, drafts, story_sections)
    if include_store_card:
        render_evidence_card(
            root,
            filename="store-promise-card.png",
            label="quick context",
            title=store_headline,
            support=store_support,
            screenshot=store_shot,
            chip_text=store_chip,
            screenshot_rect=(72, 372, 1008, 1320),
            chip_rect=(124, 1368, 956, 1456),
        )
    render_evidence_card(
        root,
        filename="first-impression-card.png",
        label="first impression",
        title=quote_safe(drafts.get("first", {}).get("headline"), "First screen sets the tone"),
        support=quote_safe(drafts.get("first", {}).get("support copy"), generic_first_support(notes, story_sections)),
        screenshot=root / "experience" / "screenshots" / "01-First-Screen.png",
        chip_text=alias,
    )
    render_evidence_card(
        root,
        filename="core-task-card.png",
        label="core task",
        title=quote_safe(drafts.get("core", {}).get("headline"), "Real task, not just menus"),
        support=quote_safe(drafts.get("core", {}).get("support copy"), generic_core_support(notes, story_sections)),
        screenshot=core_shot,
        chip_text="Live proof",
    )
    render_evidence_card(
        root,
        filename="outcome-card.png",
        label="outcome",
        title=quote_safe(drafts.get("outcome", {}).get("headline"), "What happened next"),
        support=quote_safe(drafts.get("outcome", {}).get("support copy"), generic_outcome_support(notes, story_sections)),
        screenshot=outcome_shot,
        chip_text="Truthful result",
    )
    if secondary_shot is not None:
        render_secondary_proof(root, notes, drafts, secondary_shot, story_sections)
    render_scorecard(root, notes, drafts, story_sections)
    render_verdict(root, notes, drafts, story_sections)

    produced = [
        "title-card.png",
        "first-impression-card.png",
        "core-task-card.png",
        "outcome-card.png",
    ]
    if include_store_card:
        produced.insert(1, "store-promise-card.png")
    if secondary_shot is not None:
        produced.append("secondary-proof-card.png")
    produced.extend(["scorecard.png", "verdict-card.png"])
    for name in produced:
        print(str(assets_dir / name))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: render_review_cards.py <artifacts-root-dir>")
    main(sys.argv[1])
