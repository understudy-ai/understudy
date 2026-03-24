#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

from app_name_helper import derive_review_alias

ENGLISH_VOICE_PREFERENCES = [
    "Samantha",
    "Ava",
    "Allison",
    "Eddy (英语（美国）)",
    "Flo (英语（美国）)",
    "Daniel",
    "Karen",
    "Moira",
    "Alex",
    "Fred",
]

CHINESE_VOICE_PREFERENCES = [
    "Flo (中文（中国大陆）)",
    "Eddy (中文（中国大陆）)",
    "Flo (中文（台湾）)",
    "Eddy (中文（台湾）)",
]

CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
LATIN_RE = re.compile(r"[A-Za-z]")
VOICE_LINE_RE = re.compile(r"^(?P<name>.+?)\s{2,}(?P<locale>[a-z]{2}_[A-Z]{2})\s+#")
DECIMAL_RE = re.compile(r"(?<!\d)(\d+)\.(\d+)(?!\d)")
ACRONYM_RE = re.compile(r"\b([A-Z]{2,5})(?=\b|[-/0-9])")


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def derive_alias(name: str, app_store_url: str = "") -> str:
    return derive_review_alias(name, app_store_url)


def parse_voices() -> list[dict[str, str]]:
    output = subprocess.check_output(["/usr/bin/say", "-v", "?"], text=True)
    voices: list[dict[str, str]] = []
    for line in output.splitlines():
        match = VOICE_LINE_RE.match(line.rstrip())
        if not match:
            continue
        voices.append({
            "name": match.group("name"),
            "locale": match.group("locale"),
        })
    return voices


def choose_voice(voices: list[dict[str, str]], mode: str) -> tuple[str, str]:
    locale_prefix = "zh_" if mode == "zh" else "en_"
    preferences = CHINESE_VOICE_PREFERENCES if mode == "zh" else ENGLISH_VOICE_PREFERENCES

    for preferred in preferences:
        for voice in voices:
            if voice["name"] == preferred:
                return voice["name"], voice["locale"]

    for voice in voices:
        if voice["locale"].startswith(locale_prefix):
            return voice["name"], voice["locale"]

    if not voices:
        raise SystemExit("No macOS voices available from `say -v ?`.")
    return voices[0]["name"], voices[0]["locale"]


def count_script_chars(lines: list[str]) -> tuple[int, int]:
    joined = "\n".join(lines)
    return len(CJK_RE.findall(joined)), len(LATIN_RE.findall(joined))


def spoken_word_estimate(text: str) -> int:
    return len(re.findall(r"[A-Za-z0-9']+", text))


def sanitize_common(text: str) -> str:
    replacements = {
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2013": "-",
        "\u2014": ", ",
        "\u2026": "...",
        "\u00a0": " ",
        "&": " and ",
        "+": " plus ",
        "/": " or ",
    }
    for source, target in replacements.items():
        text = text.replace(source, target)
    return clean_text(text)


def normalize_spoken_english(text: str) -> str:
    text = DECIMAL_RE.sub(lambda match: f"{match.group(1)} point {match.group(2)}", text)
    text = re.sub(r"(?<=[A-Za-z])-(?=\d)", " ", text)
    text = ACRONYM_RE.sub(lambda match: " ".join(match.group(1)), text)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"([,.;:!?])(?=[A-Za-z])", r"\1 ", text)
    text = re.sub(r"\s+", " ", text)
    return clean_text(text)


def sanitize_for_english_tts(text: str, full_name: str, alias: str) -> str:
    text = sanitize_common(text)
    if full_name and alias and full_name != alias:
        text = text.replace(full_name, alias)
    text = re.sub(r"[^\x00-\x7F]+", " ", text)
    return normalize_spoken_english(text)


def sanitize_for_chinese_tts(text: str, full_name: str, alias: str) -> str:
    text = sanitize_common(text)
    if full_name and alias and full_name != alias and full_name in text and not CJK_RE.search(text):
        text = text.replace(full_name, alias)
    return clean_text(text)


def choose_rate(mode: str, lines: list[str]) -> int:
    total_words = sum(spoken_word_estimate(line) for line in lines)
    avg_words = total_words / max(len(lines), 1)
    if mode == "zh":
        return 168 if avg_words > 12 else 172
    if total_words > 95 or avg_words > 14:
        return 178
    if total_words < 72:
        return 188
    return 183


def ffprobe_duration(path: Path) -> float | None:
    try:
        output = subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            text=True,
        ).strip()
    except Exception:
        return None
    try:
        return float(output)
    except ValueError:
        return None


def main(root_dir: str) -> None:
    root = Path(root_dir).expanduser().resolve()
    assets = root / "post" / "assets"
    narration_path = assets / "narration.txt"
    if not narration_path.exists():
        raise SystemExit(f"Missing narration file: {narration_path}")
    if not Path("/usr/bin/say").exists():
        raise SystemExit("macOS `say` is unavailable on this machine.")

    listing_path = root / "topic" / "app-store-listing.json"
    listing = json.loads(listing_path.read_text()) if listing_path.exists() else {}
    copy_localization = listing.get("copyLocalization") if isinstance(listing.get("copyLocalization"), dict) else {}
    preferred_name = clean_text(str(copy_localization.get("name") or listing.get("name") or ""))
    full_name = preferred_name
    alias = derive_alias(full_name, clean_text(str(listing.get("appStoreUrl") or ""))) if full_name else ""

    raw_lines = [clean_text(line) for line in narration_path.read_text().splitlines() if clean_text(line)]
    if not raw_lines:
        raise SystemExit(f"Narration file is empty: {narration_path}")

    cjk_chars, latin_chars = count_script_chars(raw_lines)
    mode = "zh" if cjk_chars > max(12, latin_chars) else "en"
    voices = parse_voices()
    voice_name, voice_locale = choose_voice(voices, mode)

    sanitized_lines: list[str] = []
    warnings: list[str] = []
    stripped_lines = 0
    for line in raw_lines:
        sanitized = sanitize_for_chinese_tts(line, full_name, alias) if mode == "zh" else sanitize_for_english_tts(
            line,
            full_name,
            alias,
        )
        if not sanitized:
            stripped_lines += 1
            continue
        sanitized_lines.append(sanitized)

    if stripped_lines:
        warnings.append(f"{stripped_lines} line(s) were dropped after TTS sanitization.")
    if mode == "en" and cjk_chars > 0:
        warnings.append("English TTS mode stripped or normalized mixed-language text for clearer speech.")
    if mode == "zh" and latin_chars > cjk_chars:
        warnings.append("Chinese TTS mode was chosen because the narration still contained substantial CJK text.")

    if not sanitized_lines:
        raise SystemExit("TTS sanitization removed every narration line.")

    rate = choose_rate(mode, sanitized_lines)

    script_path = assets / "voiceover-script.txt"
    output_path = assets / "voiceover.aiff"
    meta_path = assets / "voiceover-meta.json"
    script_path.write_text("\n".join(sanitized_lines) + "\n")

    subprocess.run(
        [
            "/usr/bin/say",
            "-v",
            voice_name,
            "-r",
            str(rate),
            "-o",
            str(output_path),
            "-f",
            str(script_path),
        ],
        check=True,
    )

    duration = ffprobe_duration(output_path)
    meta = {
        "voice": voice_name,
        "locale": voice_locale,
        "mode": mode,
        "rate": rate,
        "lineCount": len(sanitized_lines),
        "wordCount": sum(spoken_word_estimate(line) for line in sanitized_lines),
        "durationSec": duration,
        "sourceFile": str(narration_path),
        "scriptFile": str(script_path),
        "outputFile": str(output_path),
        "appName": full_name,
        "alias": alias,
        "cjkChars": cjk_chars,
        "latinChars": latin_chars,
        "warnings": warnings,
    }
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(meta, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: build_voiceover.py <artifacts-root-dir>")
    main(sys.argv[1])
