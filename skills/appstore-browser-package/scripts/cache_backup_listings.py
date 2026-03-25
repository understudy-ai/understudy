#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

from fetch_app_store_listing import (
    build_copy_localization,
    build_listing,
    clean_text,
    fetch_html,
    with_query_param,
)


def load_json(path: Path) -> Any:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", clean_text(value).lower()).strip("-")
    return slug or "backup"


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch cached App Store listings for already-preserved backup candidates.")
    parser.add_argument("root_dir", help="Artifacts root directory for the active playbook run.")
    parser.add_argument("--copy-language", default="", help="Optional copy localization language override.")
    parser.add_argument("--region", default="", help="Optional App Store region override.")
    parser.add_argument("--selected-date", default="", help="Optional selectedDate override.")
    parser.add_argument(
        "--selection-source",
        default="backup_preserved_from_browser_package",
        help="Fallback selectionSource for cached backup listings.",
    )
    args = parser.parse_args()

    root = Path(args.root_dir).expanduser().resolve()
    candidates = load_json(root / "topic" / "candidates.json")
    primary_listing = load_json(root / "topic" / "app-store-listing.json") or {}

    if not isinstance(candidates, list):
        raise SystemExit("Missing or invalid topic/candidates.json")

    copy_language = (
        clean_text(args.copy_language)
        or clean_text((primary_listing.get("copyLocalization") or {}).get("language"))
        or "en"
    )
    region = clean_text(args.region) or clean_text(primary_listing.get("regionHint"))
    selected_date = clean_text(args.selected_date) or clean_text(primary_listing.get("selectedDate"))

    tmp_dir = root / "topic" / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    created: list[str] = []
    skipped: list[str] = []
    failed: list[dict[str, str]] = []

    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        rank = candidate.get("rank")
        if isinstance(rank, (int, float)) and int(rank) <= 1:
            continue
        name = clean_text(candidate.get("name"))
        url = clean_text(candidate.get("appStoreUrl"))
        if not name or not url:
            skipped.append(name or f"rank-{rank}")
            continue
        try:
            page_html = fetch_html(url)
            listing = build_listing(page_html, url)
            listing["selectionSource"] = clean_text(candidate.get("selectionSource")) or clean_text(args.selection_source)
            if selected_date:
                listing["selectedDate"] = selected_date
            if region:
                listing["regionHint"] = region
            if copy_language:
                try:
                    localized_html = fetch_html(with_query_param(url, "l", copy_language))
                    localized_listing = build_listing(localized_html, url)
                    copy_localization = build_copy_localization(localized_listing, copy_language)
                    if len(copy_localization) > 1:
                        listing["copyLocalization"] = copy_localization
                except Exception:
                    pass
            output_path = tmp_dir / f"backup-{slugify(name)}.json"
            output_path.write_text(json.dumps(listing, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            created.append(str(output_path.relative_to(root)))
        except Exception as error:  # pragma: no cover - best-effort cache helper
            failed.append({"name": name, "error": str(error)})

    print(
        json.dumps(
            {
                "created": created,
                "skipped": skipped,
                "failed": failed,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
