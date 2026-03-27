#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
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
DOTENV_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$")
ELEVENLABS_VOICE_NAME_PREFERENCES = [
    "Roger",
    "George",
    "Brian",
    "Will",
    "Daniel",
    "Adam",
    "Charlie",
    "Chris",
    "Rachel",
    "Sarah",
    "Laura",
    "Jessica",
]


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def read_dotenv(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    env: dict[str, str] = {}
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = DOTENV_RE.match(raw_line)
        if not match:
            continue
        key = match.group(1).strip()
        value = match.group(2).strip()
        if value.startswith(("'", '"')) and value.endswith(("'", '"')) and len(value) >= 2:
            value = value[1:-1]
        env[key] = value
    return env


def combined_env(root: Path) -> dict[str, str]:
    env = dict(os.environ)
    candidates = [
        root / ".env",
        Path(__file__).resolve().parents[3] / ".env",
        Path.cwd() / ".env",
    ]
    for path in candidates:
        if path.exists():
            for key, value in read_dotenv(path).items():
                env.setdefault(key, value)
    return env


def derive_alias(name: str, app_store_url: str = "") -> str:
    return derive_review_alias(name, app_store_url)


def parse_voices() -> list[dict[str, str]]:
    if not Path("/usr/bin/say").exists():
        return []
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
        if total_words > 220 or avg_words > 16:
            return 154
        return 162 if avg_words > 12 else 168
    if total_words > 340 or avg_words > 22:
        return 146
    if total_words > 260 or avg_words > 17:
        return 152
    if total_words > 180 or avg_words > 14:
        return 160
    if total_words < 72:
        return 180
    return 168


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
                "json",
                str(path),
            ],
            text=True,
        ).strip()
    except Exception:
        return None
    try:
        payload = json.loads(output)
        format_info = payload.get("format") if isinstance(payload, dict) else None
        duration = format_info.get("duration") if isinstance(format_info, dict) else None
        return float(duration) if duration is not None else None
    except (ValueError, TypeError, json.JSONDecodeError):
        return None


def afinfo_duration(path: Path) -> float | None:
    try:
        output = subprocess.check_output(["afinfo", str(path)], text=True, stderr=subprocess.STDOUT)
    except Exception:
        return None
    match = re.search(r"estimated duration:\s*([0-9]+(?:\.[0-9]+)?)\s*sec", output)
    if not match:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


def first_env(env: dict[str, str], *names: str) -> str:
    for name in names:
        value = clean_text(env.get(name, ""))
        if value:
            return value
    return ""


def elevenlabs_headers(api_key: str) -> dict[str, str]:
    return {
        "xi-api-key": api_key,
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
    }


def choose_elevenlabs_voice(voices: list[dict[str, object]], *, mode: str, preferred_id: str, preferred_name: str) -> tuple[str, str] | None:
    normalized: list[tuple[str, str]] = []
    for voice in voices:
        voice_id = clean_text(str(voice.get("voice_id") or voice.get("voiceId") or ""))
        name = clean_text(str(voice.get("name") or ""))
        if voice_id:
            normalized.append((voice_id, name))
    if not normalized:
        return None
    if preferred_id:
        for voice_id, name in normalized:
            if voice_id == preferred_id:
                return voice_id, name or "custom"
    if preferred_name:
        for voice_id, name in normalized:
            if name.lower() == preferred_name.lower():
                return voice_id, name
    priorities = ELEVENLABS_VOICE_NAME_PREFERENCES if mode == "en" else ["Lily", "Rachel", "Jessica", "Roger", "George"]
    for target in priorities:
        for voice_id, name in normalized:
            if name.lower() == target.lower():
                return voice_id, name
    return normalized[0]


def elevenlabs_generate(
    *,
    env: dict[str, str],
    lines: list[str],
    mode: str,
    assets: Path,
) -> tuple[bool, str, str, list[str]]:
    warnings: list[str] = []
    api_key = first_env(env, "ELEVENLABS_API_KEY", "ElevenLabs_key", "ELEVENLABS_KEY")
    if not api_key:
        return False, "", "", warnings

    model_id = first_env(env, "ELEVENLABS_MODEL_ID", "ElevenLabs_model_id") or "eleven_v3"
    voice_id = first_env(env, "ELEVENLABS_VOICE_ID", "ElevenLabs_voice_id")
    voice_name = first_env(env, "ELEVENLABS_VOICE_NAME", "ElevenLabs_voice_name")

    selected_voice_id = voice_id
    selected_voice_name = voice_name
    if not selected_voice_id:
        voices_url = "https://api.elevenlabs.io/v1/voices"
        try:
            request = urllib.request.Request(
                voices_url,
                headers={"xi-api-key": api_key, "Accept": "application/json"},
                method="GET",
            )
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
            voices = payload.get("voices") if isinstance(payload, dict) else []
            chosen = choose_elevenlabs_voice(
                voices if isinstance(voices, list) else [],
                mode=mode,
                preferred_id=voice_id,
                preferred_name=voice_name,
            )
            if chosen is not None:
                selected_voice_id, selected_voice_name = chosen
        except Exception as exc:
            warnings.append(f"Could not auto-select ElevenLabs voice ({exc}); falling back unless ELEVENLABS_VOICE_ID is set.")

    if not selected_voice_id:
        return False, "", "", warnings

    synth_url = f"https://api.elevenlabs.io/v1/text-to-speech/{urllib.parse.quote(selected_voice_id)}?output_format=mp3_44100_128"
    payload = {
        "text": "\n".join(lines),
        "model_id": model_id,
    }
    if mode == "en":
        payload["language_code"] = "en"

    request = urllib.request.Request(
        synth_url,
        data=json.dumps(payload).encode("utf-8"),
        headers=elevenlabs_headers(api_key),
        method="POST",
    )
    mp3_tmp = assets / "voiceover-elevenlabs.mp3"
    output_path = assets / "voiceover.aiff"
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            audio = response.read()
        mp3_tmp.write_bytes(audio)
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", str(mp3_tmp), str(output_path)],
            check=True,
            capture_output=True,
        )
        mp3_tmp.unlink(missing_ok=True)
        return True, selected_voice_id, selected_voice_name or "custom", warnings
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        warnings.append(f"ElevenLabs request failed ({exc.code}): {detail[:240]}")
    except Exception as exc:
        warnings.append(f"ElevenLabs synthesis failed ({exc})")
    finally:
        mp3_tmp.unlink(missing_ok=True)
    return False, "", "", warnings


def main(root_dir: str) -> None:
    root = Path(root_dir).expanduser().resolve()
    assets = root / "post" / "assets"
    narration_path = assets / "narration.txt"
    if not narration_path.exists():
        raise SystemExit(f"Missing narration file: {narration_path}")
    listing_path = root / "topic" / "app-store-listing.json"
    listing = json.loads(listing_path.read_text()) if listing_path.exists() else {}
    copy_localization = listing.get("copyLocalization") if isinstance(listing.get("copyLocalization"), dict) else {}
    preferred_name = clean_text(str(copy_localization.get("name") or listing.get("name") or ""))
    full_name = preferred_name
    alias = derive_alias(full_name, clean_text(str(listing.get("appStoreUrl") or ""))) if full_name else ""

    raw_lines = [clean_text(line) for line in narration_path.read_text().splitlines() if clean_text(line)]
    if not raw_lines:
        raise SystemExit(f"Narration file is empty: {narration_path}")
    env = combined_env(root)

    cjk_chars, latin_chars = count_script_chars(raw_lines)
    mode = "zh" if cjk_chars > max(12, latin_chars) else "en"
    voices = parse_voices()
    voice_name = ""
    voice_locale = ""
    if voices:
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

    # Prefer ElevenLabs v3 when configured, then edge-tts, then macOS say.
    tts_engine = "macos_say"
    model_name = ""
    eleven_voice_id = ""
    eleven_success, eleven_voice_id, eleven_voice_name, eleven_warnings = elevenlabs_generate(
        env=env,
        lines=sanitized_lines,
        mode=mode,
        assets=assets,
    )
    warnings.extend(eleven_warnings)
    if eleven_success:
        tts_engine = "elevenlabs"
        model_name = first_env(env, "ELEVENLABS_MODEL_ID", "ElevenLabs_model_id") or "eleven_v3"
        voice_name = eleven_voice_name
        voice_locale = "en-US" if mode == "en" else "multilingual"
    else:
        edge_tts_voice = "en-US-AndrewMultilingualNeural" if mode == "en" else "zh-CN-YunxiNeural"
        try:
            subprocess.run(["edge-tts", "--version"], capture_output=True, check=True)
            has_edge_tts = True
        except (FileNotFoundError, subprocess.CalledProcessError):
            has_edge_tts = False

        if has_edge_tts:
            mp3_tmp = assets / "voiceover-tmp.mp3"
            edge_cmd = [
                "edge-tts",
                "--voice", edge_tts_voice,
                "--text", "\n".join(sanitized_lines),
                "--write-media", str(mp3_tmp),
            ]
            try:
                subprocess.run(edge_cmd, check=True, capture_output=True, timeout=120)
                subprocess.run(
                    ["ffmpeg", "-y", "-v", "error", "-i", str(mp3_tmp), str(output_path)],
                    check=True, capture_output=True,
                )
                mp3_tmp.unlink(missing_ok=True)
                tts_engine = "edge_tts"
                voice_name = edge_tts_voice
                voice_locale = edge_tts_voice.split("-")[0] + "-" + edge_tts_voice.split("-")[1]
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
                warnings.append(f"edge-tts failed ({exc}), falling back to macOS say")
                mp3_tmp.unlink(missing_ok=True)
                has_edge_tts = False

        if not has_edge_tts or tts_engine == "macos_say":
            if not Path("/usr/bin/say").exists():
                raise SystemExit("No configured TTS backend succeeded and macOS `say` is unavailable on this machine.")
            if not voice_name:
                voice_name, voice_locale = choose_voice(parse_voices(), mode)
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

    if not output_path.exists():
        if not Path("/usr/bin/say").exists():
            raise SystemExit("Voiceover output is missing and macOS `say` is unavailable for fallback synthesis.")
        if not voice_name:
            voice_name, voice_locale = choose_voice(parse_voices(), mode)
        subprocess.run(
            ["/usr/bin/say", "-v", voice_name, "-r", str(rate), "-o", str(output_path), "-f", str(script_path)],
            check=True,
        )

    duration = ffprobe_duration(output_path)
    if duration is None:
        duration = afinfo_duration(output_path)
    if duration is not None and duration < 55:
        warnings.append(f"voiceover duration {duration:.0f}s is below the preferred 55s floor — the cut may feel abrupt.")
    if duration is not None and duration > 160:
        warnings.append(f"voiceover duration {duration:.0f}s exceeds the preferred 160s ceiling — the cut may feel padded.")
    if duration is None:
        warnings.append("Could not measure voiceover duration with ffprobe.")

    meta = {
        "engine": tts_engine,
        "voice": voice_name,
        "voiceId": eleven_voice_id if tts_engine == "elevenlabs" else "",
        "model": model_name if tts_engine == "elevenlabs" else "",
        "locale": voice_locale,
        "mode": mode,
        "rate": rate if tts_engine == "macos_say" else 0,
        "lineCount": len(sanitized_lines),
        "wordCount": sum(spoken_word_estimate(line) for line in sanitized_lines),
        "durationSec": duration,
        "durationShort": bool(duration is not None and duration < 120),
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
