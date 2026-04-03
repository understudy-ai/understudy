#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse


EXPECTED_TOPIC_SCREENSHOTS = [
    "topic/screenshots/00-Browser-Today-Recommendation.png",
    "topic/screenshots/01-Browser-App-Detail.png",
    "topic/screenshots/02-iPhone-App-Store-Detail.png",
    "topic/screenshots/03-Home-Screen-With-App.png",
    "topic/screenshots/03-Home-Screen-Blocked-No-App.png",
]

PASSWORD_TARGET = "visible Apple ID password field"
WINDOW_SCOPE = "iPhone Mirroring window"
SEARCH_FOCUS_HINT = "visible App Store search text entry field after entering the Search surface"
NON_QUERY_ALIASES = {
    "free",
    "get",
    "open",
    "install",
    "cloud",
    "download",
    "preview",
}
GENERIC_SLUG_TOKENS = {
    "app",
    "apps",
    "for",
    "iphone",
    "ipad",
    "ios",
}
OPTIONAL_TRAILING_ALIAS_TOKENS = {
    "app",
    "apps",
    "pdf",
}
GENERIC_QUERY_DESCRIPTOR_TOKENS = {
    "ai",
    "app",
    "apps",
    "camera",
    "editor",
    "editors",
    "filters",
    "ipad",
    "iphone",
    "photo",
    "photos",
    "tool",
    "tools",
    "video",
    "videos",
}


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def clean(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).split()).strip()


def clean_backup_query(value: Any) -> str:
    return clean(value).strip("|").strip()


def contains_non_ascii(value: str) -> bool:
    return any(ord(ch) > 127 for ch in clean(value))


def choose_search_type_strategy(query: str) -> str:
    return "clipboard_paste" if contains_non_ascii(query) else "system_events_keystroke_chars"


def describe_search_input_strategy(query: str) -> str:
    if choose_search_type_strategy(query) == "clipboard_paste":
        return "Use clipboard_paste as the primary route because this frozen device query contains non-ASCII text."
    return "Use system_events_keystroke_chars as the primary route because live iPhone Mirroring search-field testing showed the slower per-character path is more reliable than physical_keys for ASCII App Store queries."


def looks_like_long_note(value: str) -> bool:
    return len(clean(value).split()) >= 6


def looks_like_query_alias(value: str) -> bool:
    text = clean(value)
    if not text or text.startswith("http"):
        return False
    if re.search(r"[$€£¥]|^\d+(?:[.,]\d+)?$", text):
        return False
    if looks_like_long_note(text):
        return False
    lower = text.lower()
    if lower in NON_QUERY_ALIASES:
        return False
    if any(marker in lower for marker in ("may ", "might ", "could ", "risk", "prompt", "block", "require ")):
        return False
    return True


def normalized_text_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", clean(value).lower()).strip()


def unique_nonempty(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for raw_value in values:
        value = clean(raw_value)
        if not value:
            continue
        key = normalized_text_key(value)
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(value)
    return result


def prettify_alias_token(token: str) -> str:
    if not token:
        return ""
    if token.isdigit():
        return token
    if token.lower() in {"ai", "pdf", "vpn", "vr"}:
        return token.upper()
    return token.capitalize()


def short_ascii_alias_from_url(app_store_url: str) -> str:
    url = clean(app_store_url)
    if not url.startswith("http"):
        return ""
    path = urlparse(url).path
    if "/app/" not in path:
        return ""
    slug = unquote(path.split("/app/", 1)[1].split("/id", 1)[0])
    tokens = [
        token
        for token in re.findall(r"[A-Za-z0-9]+", slug)
        if token and token.lower() not in GENERIC_SLUG_TOKENS
    ]
    if not tokens:
        return ""
    alias_tokens = [prettify_alias_token(token) for token in tokens[:3]]
    while len(alias_tokens) > 1 and alias_tokens[-1].lower() in OPTIONAL_TRAILING_ALIAS_TOKENS:
        alias_tokens.pop()
    return " ".join(alias_tokens)


def short_name_alias(name: str) -> str:
    text = clean(name)
    if not text:
        return ""
    for separator in (":", " - ", " — ", " – "):
        if separator not in text:
            continue
        head = clean(text.split(separator, 1)[0])
        if 1 <= len(head.split()) <= 3:
            return head
    return ""


def should_promote_alias(query: str, alias: str) -> bool:
    query_tokens = clean(query).split()
    alias_tokens = clean(alias).split()
    if not query_tokens or not alias_tokens:
        return False
    if normalized_text_key(query) == normalized_text_key(alias):
        return False
    return (
        len(alias_tokens) < len(query_tokens)
        and query_tokens[: len(alias_tokens)] == alias_tokens
        and all(token.lower() in GENERIC_QUERY_DESCRIPTOR_TOKENS for token in query_tokens[len(alias_tokens):])
    )


def refined_device_search_query(
    query: str,
    *,
    name: str,
    app_store_url: str,
    price_text: str,
) -> str:
    current_query = clean(query)
    alias_candidates = unique_nonempty(
        [
            short_name_alias(name),
            clean(price_text) if looks_like_query_alias(price_text) else "",
            short_ascii_alias_from_url(app_store_url),
        ]
    )
    if not current_query:
        return alias_candidates[0] if alias_candidates else clean(name)
    if looks_like_long_note(current_query):
        return alias_candidates[0] if alias_candidates else current_query
    for alias in alias_candidates:
        if should_promote_alias(current_query, alias):
            return alias
    return current_query


def build_result_row_title_hints(
    *,
    name: str,
    device_search_query: str,
    app_store_url: str,
    price_text: str,
) -> list[str]:
    return unique_nonempty(
        [
            device_search_query,
            clean(price_text) if looks_like_query_alias(price_text) else "",
            short_ascii_alias_from_url(app_store_url),
            name,
        ]
    )


def query_tail_hint(query: str) -> str:
    text = clean(query)
    if len(text) <= 8:
        return text
    return text[-8:]


def parse_backup(value: str, rank: int) -> dict[str, Any]:
    parts = [clean(part) for part in value.split("||")]
    while len(parts) < 8:
        parts.append("")
    record = {
        "rank": rank,
        "name": parts[0],
        "developer": parts[1],
        "category": parts[2],
        "appStoreUrl": parts[3],
        "priceText": parts[4],
        "deviceSearchQuery": parts[5],
        "whyItFitsSlowGui": parts[6],
        "majorRisk": parts[7],
    }
    app_store_url = clean(record.get("appStoreUrl"))
    price_text = clean(record.get("priceText"))
    device_search_query = clean(record.get("deviceSearchQuery"))
    why_it_fits = clean(record.get("whyItFitsSlowGui"))
    category = clean(record.get("category"))
    name = clean(record.get("name"))

    malformed_url_slot = bool(app_store_url) and not app_store_url.startswith("http")
    query_looks_like_risk = len(device_search_query.split()) >= 6 and any(
        marker in device_search_query.lower()
        for marker in ("may ", "might ", "could ", "risk", "prompt", "block", "require ")
    )
    price_slot_looks_like_fit = looks_like_long_note(price_text)
    missing_fit = not why_it_fits

    # Accept a common shortened backup encoding emitted by workers where the
    # query lands in the URL slot and the fit/risk notes shift left.
    if malformed_url_slot and query_looks_like_risk and price_slot_looks_like_fit and missing_fit:
        record["appStoreUrl"] = ""
        record["priceText"] = ""
        record["deviceSearchQuery"] = app_store_url
        record["whyItFitsSlowGui"] = price_text
        record["majorRisk"] = device_search_query

    # Accept another shortened encoding where query/fit/risk slide into the
    # URL/price/query slots, but the risk note does not contain obvious risk
    # marker words.
    if (
        malformed_url_slot
        and looks_like_query_alias(app_store_url)
        and price_slot_looks_like_fit
        and missing_fit
    ):
        record["appStoreUrl"] = ""
        record["priceText"] = ""
        record["deviceSearchQuery"] = app_store_url
        record["whyItFitsSlowGui"] = price_text
        if clean(device_search_query):
            record["majorRisk"] = device_search_query

    price_slot_looks_like_query = looks_like_query_alias(price_text)
    query_slot_looks_like_fit = looks_like_long_note(device_search_query)
    missing_risk = not clean(record.get("majorRisk"))

    # Accept a variant where appStoreUrl is empty, the price slot actually
    # contains the short device query alias, and fit/risk slide right.
    if (
        not clean(record.get("appStoreUrl"))
        and price_slot_looks_like_query
        and query_slot_looks_like_fit
        and missing_risk
    ):
        record["priceText"] = ""
        record["deviceSearchQuery"] = price_text
        record["whyItFitsSlowGui"] = device_search_query
        if clean(why_it_fits):
            record["majorRisk"] = why_it_fits

    category_looks_like_query = bool(category) and (
        category.lower() == name.lower() or len(category.split()) <= 3
    )
    url_slot_looks_like_fit = looks_like_long_note(app_store_url) and not app_store_url.startswith("http")
    price_slot_looks_like_risk = looks_like_long_note(price_text) and any(
        marker in price_text.lower()
        for marker in ("may ", "might ", "could ", "risk", "prompt", "block", "require ")
    )
    missing_query = not clean(record.get("deviceSearchQuery"))

    # Accept an even shorter backup encoding where only name, query, fit, and
    # risk are preserved and they accidentally slide into category/url/price.
    if category_looks_like_query and url_slot_looks_like_fit and price_slot_looks_like_risk and missing_query:
        record["category"] = ""
        record["appStoreUrl"] = ""
        record["priceText"] = ""
        record["deviceSearchQuery"] = category or name
        record["whyItFitsSlowGui"] = app_store_url
        record["majorRisk"] = price_text

    category_with_pipe_looks_like_query = clean(category).startswith("|") and looks_like_query_alias(
        clean(category).lstrip("|")
    )

    # Accept malformed variants where the intended query leaks into the
    # category slot with a leading `|`, while fit/risk notes slide into the
    # URL/price slots.
    if (
        category_with_pipe_looks_like_query
        and url_slot_looks_like_fit
        and missing_query
    ):
        record["category"] = ""
        record["appStoreUrl"] = ""
        record["priceText"] = ""
        record["deviceSearchQuery"] = clean(category).lstrip("|")
        record["whyItFitsSlowGui"] = app_store_url
        if clean(price_text):
            record["majorRisk"] = price_text

    if not clean(record.get("deviceSearchQuery")):
        fallback_query = clean(record.get("name"))
        if fallback_query:
            record["deviceSearchQuery"] = fallback_query

    record["deviceSearchQuery"] = refined_device_search_query(
        clean_backup_query(record.get("deviceSearchQuery", "")),
        name=record.get("name", ""),
        app_store_url=record.get("appStoreUrl", ""),
        price_text=record.get("priceText", ""),
    )

    return record


def topic_screenshots(root: Path, existing_artifacts: dict[str, Any]) -> list[str]:
    current = existing_artifacts.get("topicScreenshots")
    screenshots = [
        item for item in current if isinstance(item, str) and (root / item).exists()
    ] if isinstance(current, list) else []
    for rel_path in EXPECTED_TOPIC_SCREENSHOTS:
        if (root / rel_path).exists() and rel_path not in screenshots:
            screenshots.append(rel_path)
    return screenshots


def listing_promise_lines(
    *,
    subtitle: str,
    description: str,
    expected_core_task: str,
) -> list[str]:
    candidates = unique_nonempty(
        [
            clean(subtitle),
            *[
                fragment
                for fragment in re.split(r"(?:\s*[•]\s*|\s*---\s*)", clean(description))
                if 4 <= len(clean(fragment).split()) <= 18
            ],
            clean(expected_core_task),
        ]
    )
    filtered: list[str] = []
    for candidate in candidates:
        lower = candidate.lower()
        if any(
            marker in lower
            for marker in (
                "terms of use",
                "privacy policy",
                "charged to your apple id",
                "automatically renew",
                "subscription",
                "cancel your subscriptions",
            )
        ):
            continue
        filtered.append(candidate)
    return filtered[:4]


def render_notes(
    winner: dict[str, Any],
    *,
    chosen_surface: str,
    why_win: str,
    risk: str,
    beats_backups: str,
    backups: list[dict[str, Any]],
    listing_subtitle: str,
    listing_description: str,
) -> str:
    backup_lines = []
    for backup in backups:
        label = clean(backup.get("name")) or "Unnamed backup"
        fit = clean(backup.get("whyItFitsSlowGui")) or "Backup candidate preserved for install fallback."
        major_risk = clean(backup.get("majorRisk"))
        line = f"- {label}: {fit}"
        if major_risk:
            line += f" Risk: {major_risk}"
        backup_lines.append(line)
    if not backup_lines:
        backup_lines.append("- No strong backup survived the shortlist, so the run is locked to the chosen winner.")

    promise_lines = listing_promise_lines(
        subtitle=listing_subtitle,
        description=listing_description,
        expected_core_task=winner["expectedCoreTask"],
    )
    if not promise_lines:
        promise_lines.append(winner["expectedCoreTask"])

    lines = [
        "# Stage 1 selection notes",
        "",
        "## Chosen app",
        f"- {winner['name']} by {winner['developer']}",
        f"- Surface: {chosen_surface or 'Current App Store editorial/category surface'}",
        "",
        "## Why this app won",
        f"- {why_win}",
        f"- Expected core task: {winner['expectedCoreTask']}",
        "",
        "## Locked device search query",
        f"- `{winner['deviceSearchQuery']}`",
        "",
        "## App Store promises to verify on-device",
        "- Treat these as listing hypotheses for Stage 2, not as proven truths yet.",
        *[f"- {line}" for line in promise_lines],
        "",
        "## Risks seen on the listing page",
        f"- {risk}",
        "",
        "## Why it beats the backups",
        f"- {beats_backups}",
        "",
        "## Backup shortlist",
        *backup_lines,
        "",
    ]
    return "\n".join(lines)


def build_search_action(query: str) -> dict[str, Any]:
    type_strategy = choose_search_type_strategy(query)
    return {
        "tool": "gui_type",
        "app": "iPhone Mirroring",
        "scope": WINDOW_SCOPE,
        "value": clean(query),
        "typeStrategy": type_strategy,
        "replace": True,
        "submit": False,
    }


def build_search_submit_action() -> dict[str, Any]:
    return {
        "tool": "gui_key",
        "app": "iPhone Mirroring",
        "scope": WINDOW_SCOPE,
        "key": "Enter",
    }


def choose_password_type_strategy(env_var_name: str) -> str:
    _ = clean(env_var_name) or "UNDERSTUDY_APPLE_ID_PASSWORD"
    return "system_events_keystroke_chars"


def describe_password_input_strategy(env_var_name: str) -> str:
    _ = clean(env_var_name) or "UNDERSTUDY_APPLE_ID_PASSWORD"
    return "Use system_events_keystroke_chars as the single frozen password-entry route because live iPhone Mirroring secure-field testing showed the slower per-character path is more reliable than a single full-string keystroke."


def build_password_action(env_var_name: str) -> dict[str, Any]:
    return {
        "tool": "gui_type",
        "app": "iPhone Mirroring",
        "target": PASSWORD_TARGET,
        "scope": WINDOW_SCOPE,
        "secretEnvVar": clean(env_var_name) or "UNDERSTUDY_APPLE_ID_PASSWORD",
        "typeStrategy": choose_password_type_strategy(env_var_name),
        "replace": False,
        "submit": False,
    }


def render_device_plan_markdown(
    candidates: list[dict[str, Any]],
    *,
    allow_password_from_env: bool,
    apple_id_password_env_var: str,
) -> str:
    lines = [
        "# Device action plan",
        "",
        "Treat this file as the frozen execution contract for Stage 1 device work.",
        "",
        "## Global rules",
        "- Start and finish each install attempt from a confirmed home-screen boundary when possible.",
        "- Before the first query for a candidate, click the visible App Store search text entry field once so the caret focus is real on-device.",
        "- If that visible control still shows placeholder copy such as `Games, Apps and more` or truncated `Games,...`, treat that click as Search-surface navigation only. The next action must be `gui_observe`, not the frozen search `gui_type` yet.",
        "- For App Store query replacement, reuse the exact targetless `gui_type` block shown under the current candidate after that focus click.",
        "- Do not change `typeStrategy`, `replace`, or `submit` on the search call.",
        "- If the frozen `searchAction` for a candidate uses `clipboard_paste`, that is the primary route for that candidate rather than a fallback.",
        "- A narrow iPhone search field may horizontally scroll and show only the tail of a correctly landed query. If that visible tail still matches the frozen query ending and matching suggestions/results are present, treat the query as landed rather than clearing it immediately.",
        "- Do not use a combined `gui_type ... submit:true` search entry.",
        "- After the search `gui_type`, do one `gui_observe` before any separate Search / Enter submit.",
        "- After the exact search `gui_type`, the only allowed next tool call is `gui_observe`.",
        "- After the first correct search `gui_type`, do not issue a second `gui_type` until that observation is complete.",
        "- If the first post-type observation still shows the full correct query but no matching suggestion or result yet, use the frozen `searchSubmitAction` once, then observe again.",
        "- The search `gui_type` is intentionally targetless. Do not improvise a fresh target label such as `active App Store search field` or `the bottom active search field with a blinking cursor` for that typing step.",
        "- Use the latest observation text only for the focus click, not to rewrite the frozen query payload.",
        "- After the exact search `gui_type`, do not click back into that same field before the post-type observation is complete.",
        "- A target description that still reads like a bottom navigation Search destination or a bottom control showing placeholder copy is never the typing focus target.",
        "- If you pivot to a backup, reopen this file and use that backup candidate's exact block.",
        "- After tapping the matching suggestion or app result row, the next action must be `gui_observe` to confirm the detail page before any shell/read work.",
        "",
        "## Frozen focus rule",
        f"- Focus hint: `{SEARCH_FOCUS_HINT}`",
        "- The focus click may use the exact visible description from the latest observation, but it must still target the same visible search text entry field on the Search surface.",
        "- The focus click exists only to place the caret before the frozen targetless `gui_type`. Do not use it as a justification for extra typing loops.",
        "",
        "## Frozen search submit action",
        "- Use this only after the required post-type observation proves the full query is visible but results still need the explicit keyboard submit.",
        "",
        "```text",
        "gui_key",
        '  app:"iPhone Mirroring"',
        f'  scope:"{WINDOW_SCOPE}"',
        '  key:"Enter"',
        "```",
        "",
        "## Password flow",
        f"- allowAppleIdPasswordFromEnv: {'true' if allow_password_from_env else 'false'}",
        f"- appleIdPasswordEnvVar: `{clean(apple_id_password_env_var) or 'UNDERSTUDY_APPLE_ID_PASSWORD'}`",
    ]

    if allow_password_from_env:
        password_type_strategy = choose_password_type_strategy(apple_id_password_env_var)
        lines.extend(
            [
                "- Authorized password entry is a single bounded attempt.",
                f"- Password-entry strategy: {describe_password_input_strategy(apple_id_password_env_var)}",
                "- Use the exact payload below, then click the visible primary confirmation button once, then observe immediately.",
                "",
                "```text",
                "gui_type",
                '  app:"iPhone Mirroring"',
                f'  target:"{PASSWORD_TARGET}"',
                f'  scope:"{WINDOW_SCOPE}"',
                f'  secretEnvVar:"{clean(apple_id_password_env_var) or "UNDERSTUDY_APPLE_ID_PASSWORD"}"',
                f'  typeStrategy:"{password_type_strategy}"',
                "  replace:false",
                "  submit:false",
                "```",
                "",
            ]
        )
    else:
        lines.extend(
            [
                "- Password entry is not authorized in this run. Any Apple ID password sheet is an install blocker for the current candidate.",
                "",
            ]
        )

    for candidate in candidates:
        name = clean(candidate.get("name")) or "Unnamed app"
        developer = clean(candidate.get("developer")) or "Unknown developer"
        query = clean(candidate.get("deviceSearchQuery"))
        risk = clean(candidate.get("majorRisk")) or "No extra risk note recorded."
        fit = clean(candidate.get("whyItFitsSlowGui")) or "No extra fit note recorded."
        rank = candidate.get("rank") or "?"
        type_strategy = choose_search_type_strategy(query)
        lines.extend(
            [
                f"## Candidate {rank}: {name} by {developer}",
                f"- lockedDeviceSearchQuery: `{query}`",
                f"- searchInputStrategy: `{type_strategy}`",
                f"- searchInputReason: {describe_search_input_strategy(query)}",
                f"- queryTailHint: `{candidate.get('queryTailHint') or query}`",
                f"- resultRowTitleHints: {', '.join(f'`{hint}`' for hint in candidate.get('resultRowTitleHints', [])) or '`(none)`'}",
                f"- whyItFitsSlowGui: {fit}",
                f"- majorRisk: {risk}",
                f"- focusSearchFieldHint: `{SEARCH_FOCUS_HINT}`",
                "- exactSearchCall:",
                "```text",
                "gui_type",
                '  app:"iPhone Mirroring"',
                f'  scope:"{WINDOW_SCOPE}"',
                f'  value:"{query}"',
                f'  typeStrategy:"{type_strategy}"',
                "  replace:true",
                "  submit:false",
                "```",
                "- before the exactSearchCall, click the visible search text entry field once so the query goes into the live caret focus.",
                "- the focus click must target the real editable field on the Search surface, not the bottom Search destination or a bottom placeholder control.",
                "- if the clicked control still shows placeholder copy like `Games, Apps and more` / `Games,...`, treat that click as navigation only and `gui_observe` before trying the exactSearchCall.",
                "- if that focused field already contains remembered non-placeholder text from an earlier search, do not trust `replace:true` alone. If the visible text already strongly matches the current candidate and the matching suggestion/result is recoverable, use that result path without retyping; otherwise clear the stale field once before the exactSearchCall.",
                "- after the exactSearchCall runs, the only allowed next tool is `gui_observe`; do not use another `gui_type`, a `gui_key` submit, a field `gui_click`, or `gui_scroll` before that observation.",
                "- after the exactSearchCall runs, the next action must be `gui_observe`; do not click back into the same field or retype the query before that observation.",
                "- if the active field only shows the tail of the query such as `...otes AI` but that tail still matches `queryTailHint` and matching suggestions/results are present, treat the query as landed and continue instead of clearing it.",
                "- if the first post-type observation still shows an active field with a clear `x`, a caret, or matching suggestions/results, presume the query landed unless the text was clearly replaced with unrelated content; prefer result tap or one frozen submit before any clear/reset.",
                "- do not tap the search-field clear `x` on the first post-type cycle while the visible text is the full query, a matching tail, or an ambiguous horizontally scrolled fragment.",
                "- if a suggestion tap opens a results list instead of the detail page, use the visible app result row whose title best matches the frozen `resultRowTitleHints`, then observe again before deciding the detail-page attempt failed.",
                "- verify the on-device detail page title against the browser-selected app before tapping Get / Install.",
                "",
            ]
        )

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Write Stage 1 browser selection artifacts from the locked App Store winner.")
    parser.add_argument("root_dir", help="Artifacts root directory for the active playbook run.")
    parser.add_argument("--device-search-query", required=True, help="Locked query or alias to use in iPhone Mirroring.")
    parser.add_argument("--expected-core-task", required=True, help="Primary first-use task expected in Stage 2.")
    parser.add_argument("--why-win", required=True, help="Short reason the winner fits the demo.")
    parser.add_argument("--risk", required=True, help="Main risk still visible from the listing or first-run guess.")
    parser.add_argument("--beats-backups", required=True, help="Why the winner beats the preserved backup candidates.")
    parser.add_argument("--chosen-surface", default="", help="Short note describing the browser surface that produced the winner.")
    parser.add_argument("--selection-source", default="", help="Optional override for selectionSource.")
    parser.add_argument(
        "--allow-apple-id-password-from-env",
        action="store_true",
        help="Freeze a single bounded secret-env password attempt into the device action plan.",
    )
    parser.add_argument(
        "--apple-id-password-env-var",
        default="UNDERSTUDY_APPLE_ID_PASSWORD",
        help="Env var name to reference from the device action plan when password entry is authorized.",
    )
    parser.add_argument(
        "--backup",
        action="append",
        default=[],
        help="Optional backup encoded as name||developer||category||appStoreUrl||priceText||deviceSearchQuery||whyItFitsSlowGui||majorRisk",
    )
    args = parser.parse_args()

    root = Path(args.root_dir).expanduser().resolve()
    listing_path = root / "topic" / "app-store-listing.json"
    manifest_path = root / "manifest.json"
    candidates_path = root / "topic" / "candidates.json"
    notes_path = root / "topic" / "selection-notes.md"
    device_plan_json_path = root / "topic" / "device-action-plan.json"
    device_plan_md_path = root / "topic" / "device-action-plan.md"

    listing = load_json(listing_path)
    if not listing:
        raise SystemExit(f"Missing or invalid listing JSON: {listing_path}")

    manifest = load_json(manifest_path)
    existing_artifacts = manifest.get("artifacts") if isinstance(manifest.get("artifacts"), dict) else {}
    selection_mode = clean(manifest.get("selectionMode"))
    default_selection_source = "fixed_target_app_metadata" if selection_mode == "fixed_target_app_metadata" else "editorial"
    selection_source = clean(args.selection_source) or clean(listing.get("selectionSource")) or default_selection_source

    winner_device_search_query = refined_device_search_query(
        args.device_search_query,
        name=clean(listing.get("name")),
        app_store_url=clean(listing.get("appStoreUrl")),
        price_text=clean(listing.get("priceText")),
    )

    winner = {
        "rank": 1,
        "name": clean(listing.get("name")),
        "developer": clean(listing.get("developer")),
        "category": clean(listing.get("category")),
        "appStoreUrl": clean(listing.get("appStoreUrl")),
        "priceText": clean(listing.get("priceText")),
        "free": bool(listing.get("free")),
        "selectionSource": selection_source,
        "deviceSearchQuery": winner_device_search_query,
        "expectedCoreTask": clean(args.expected_core_task),
        "majorRisk": clean(args.risk),
        "whyItFitsSlowGui": clean(args.why_win),
    }
    backups = [parse_backup(item, index + 2) for index, item in enumerate(args.backup)]
    candidates = [winner, *backups]

    device_plan_candidates = []
    for candidate in candidates:
        query = clean(candidate.get("deviceSearchQuery"))
        type_strategy = choose_search_type_strategy(query)
        device_plan_candidates.append(
            {
                "rank": candidate.get("rank"),
                "name": clean(candidate.get("name")),
                "developer": clean(candidate.get("developer")),
                "deviceSearchQuery": query,
                "searchInputStrategy": type_strategy,
                "searchInputReason": describe_search_input_strategy(query),
                "queryTailHint": query_tail_hint(query),
                "majorRisk": clean(candidate.get("majorRisk")),
                "whyItFitsSlowGui": clean(candidate.get("whyItFitsSlowGui")),
                "searchAction": build_search_action(query),
                "searchSubmitAction": build_search_submit_action(),
                "detailPageVerification": {
                    "titleContains": clean(candidate.get("name")),
                    "developerContains": clean(candidate.get("developer")),
                    "resultRowTitleHints": build_result_row_title_hints(
                        name=clean(candidate.get("name")),
                        device_search_query=query,
                        app_store_url=clean(candidate.get("appStoreUrl")),
                        price_text=clean(candidate.get("priceText")),
                    ),
                },
                "resultRowTitleHints": build_result_row_title_hints(
                    name=clean(candidate.get("name")),
                    device_search_query=query,
                    app_store_url=clean(candidate.get("appStoreUrl")),
                    price_text=clean(candidate.get("priceText")),
                ),
            }
        )
    primary_device_plan_candidate = device_plan_candidates[0] if device_plan_candidates else {}

    password_env_var = clean(args.apple_id_password_env_var) or "UNDERSTUDY_APPLE_ID_PASSWORD"
    device_action_plan = {
        "version": 2,
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "frozen": True,
        "selectedCandidateRank": primary_device_plan_candidate.get("rank"),
        "selectedCandidateName": primary_device_plan_candidate.get("name"),
        "selectedCandidateDeveloper": primary_device_plan_candidate.get("developer"),
        "deviceSearchQuery": primary_device_plan_candidate.get("deviceSearchQuery"),
        "searchInputStrategy": primary_device_plan_candidate.get("searchInputStrategy"),
        "searchInputReason": primary_device_plan_candidate.get("searchInputReason"),
        "queryTailHint": primary_device_plan_candidate.get("queryTailHint"),
        "searchAction": primary_device_plan_candidate.get("searchAction"),
        "searchSubmitAction": primary_device_plan_candidate.get("searchSubmitAction"),
        "detailPageVerification": primary_device_plan_candidate.get("detailPageVerification"),
        "resultRowTitleHints": primary_device_plan_candidate.get("resultRowTitleHints"),
        "searchContract": {
            "focusSearchFieldHint": SEARCH_FOCUS_HINT,
            "scope": WINDOW_SCOPE,
            "replace": True,
            "submit": False,
            "allowedTypeStrategies": ["system_events_keystroke_chars", "clipboard_paste"],
            "queryEntryRule": "Use each candidate's exact frozen searchAction payload, including its typeStrategy. ASCII queries may intentionally use system_events_keystroke_chars as the primary route, and non-ASCII frozen queries may intentionally use clipboard_paste.",
            "placeholderNavigationRule": "If the visible search control still shows placeholder copy such as 'Games, Apps and more' or truncated 'Games,...', that click only enters the Search surface. Observe first, then reacquire the real editable field before replaying the frozen searchAction.",
            "prefilledFieldNormalizationRule": "If the focused editable field already contains non-placeholder remembered text before the first exact searchAction, do not trust replace:true alone. If that text already strongly matches the candidate and the matching suggestion/result is recoverable, use the result path without retyping; otherwise clear the stale field once before the first exact searchAction.",
            "horizontalScrollFieldRule": "A narrow iPhone search field may horizontally scroll and only show the tail of a correctly entered query. If the visible tail still matches the current candidate's queryTailHint and matching suggestions/results are present, treat the query as landed instead of clearing it.",
            "postTypeStabilizationRule": "If the first post-type observation still shows an active field with a clear x, a caret, or matching suggestions/results, presume the frozen query landed unless the text was clearly replaced with unrelated content. Prefer result tap or one frozen submit before any clear/reset.",
            "postPlaceholderClickNextAction": "gui_observe",
            "nextActionAfterSearchType": "gui_observe",
            "allowedToolNamesBeforePostTypeObserve": ["gui_observe"],
            "searchSubmitAction": build_search_submit_action(),
            "forbidden": [
                "typing before the visible App Store search field has been focused on the Search surface",
                "replaying the frozen searchAction immediately after clicking a placeholder search control that still shows Games, Apps and more-style copy",
                "gui_type submit:true as the primary query replacement path",
                "gui_key submit before the post-type gui_observe",
                "gui_scroll before the post-type gui_observe",
                "overriding the candidate's frozen searchAction.typeStrategy on device-side query replacement",
                "a second gui_type before the post-type gui_observe is complete",
                "re-clicking the same search field before the post-type gui_observe is complete",
                "rewriting the frozen targetless searchAction into a targeted gui_type within the same search cycle",
                "typing into a bottom Search navigation destination or placeholder control instead of the real editable field",
                "typing over remembered non-placeholder stale field content without first deciding whether to use the visible matching result or clearing the stale field once",
                "tapping the search-field clear x on the first post-type cycle while the visible text still matches the frozen query, queryTailHint, or an ambiguous horizontally scrolled fragment",
            ],
            "resetRequiredBeforeRetype": True,
            "sameFieldRetypeRequires": "A gui_observe proving the prior query was missing or replaced with unrelated text and that no matching suggestion/result remained recoverable, followed by one bounded clear/reset of the field and one fresh focus click on the visible search entry field.",
            "submitRequiresPostTypeObserve": True,
            "clearResetRequires": "Only clear/reset after the post-type observation proves the query was missing or replaced with unrelated text and no matching suggestion/result is recoverable, or after one frozen submit path still leaves no usable result.",
            "preTypeClearAllowedWhen": "The first focused editable field already contains remembered non-placeholder text that is not already a usable match to the frozen candidate/resultRowTitleHints.",
        },
        "detailPageContract": {
            "nextActionAfterResultTap": "gui_observe",
            "requiredBeforeShellOrRead": "Confirm the App Store detail page first, then capture 02-iPhone-App-Store-Detail evidence before shell/read detours.",
            "forbidden": [
                "shell/read detours immediately after tapping the matching suggestion or app result row",
                "claiming detail-page progress before a gui_observe confirms the app detail page",
            ],
        },
        "passwordPolicy": {
            "allowAppleIdPasswordFromEnv": bool(args.allow_apple_id_password_from_env),
            "appleIdPasswordEnvVar": password_env_var,
            "maxAttemptsPerCandidate": 1 if args.allow_apple_id_password_from_env else 0,
            "passwordAction": build_password_action(password_env_var) if args.allow_apple_id_password_from_env else None,
            "passwordInputReason": describe_password_input_strategy(password_env_var) if args.allow_apple_id_password_from_env else "",
            "nextStepAfterSubmit": "Observe immediately and classify success vs blocker from the visible sheet state.",
        },
        "candidates": device_plan_candidates,
    }

    candidates_path.write_text(json.dumps(candidates, indent=2, ensure_ascii=False) + "\n")
    notes_path.write_text(
        render_notes(
            winner,
            chosen_surface=clean(args.chosen_surface),
            why_win=clean(args.why_win),
            risk=clean(args.risk),
            beats_backups=clean(args.beats_backups),
            backups=backups,
            listing_subtitle=clean(listing.get("subtitle")),
            listing_description=clean(listing.get("description")),
        ),
        encoding="utf-8",
    )
    device_plan_json_path.write_text(json.dumps(device_action_plan, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    device_plan_md_path.write_text(
        render_device_plan_markdown(
            device_plan_candidates,
            allow_password_from_env=bool(args.allow_apple_id_password_from_env),
            apple_id_password_env_var=password_env_var,
        )
        + "\n",
        encoding="utf-8",
    )

    timestamps = manifest.get("timestamps") if isinstance(manifest.get("timestamps"), dict) else {}
    timestamps.setdefault(
        "created",
        datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    )
    timestamps["selectionLocked"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    selected_app = {
        "name": clean(listing.get("name")),
        "developer": clean(listing.get("developer")),
        "category": clean(listing.get("category")),
        "rating": listing.get("rating"),
        "priceText": clean(listing.get("priceText")),
        "free": bool(listing.get("free")),
        "appStoreUrl": clean(listing.get("appStoreUrl")),
        "subtitle": clean(listing.get("subtitle")),
        "description": clean(listing.get("description")),
        "selectionSource": selection_source,
        "deviceSearchQuery": winner_device_search_query,
        "expectedCoreTask": clean(args.expected_core_task),
        "installed": False,
    }

    manifest.update(
        {
            "status": "discovering",
            "phase": "discovering",
            "selectedApp": selected_app,
            "timestamps": timestamps,
            "artifacts": {
                **existing_artifacts,
                "topicScreenshots": topic_screenshots(root, existing_artifacts),
                "deviceActionPlan": "topic/device-action-plan.json",
                "deviceActionPlanMarkdown": "topic/device-action-plan.md",
            },
        }
    )
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

    print(
        json.dumps(
            {
                "listingPath": str(listing_path),
                "candidatesPath": str(candidates_path),
                "notesPath": str(notes_path),
                "devicePlanJsonPath": str(device_plan_json_path),
                "devicePlanMarkdownPath": str(device_plan_md_path),
                "manifestPath": str(manifest_path),
                "winner": winner["name"],
                "backups": len(backups),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
