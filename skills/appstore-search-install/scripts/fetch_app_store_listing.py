#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
IMAGE_URL_RE = re.compile(r"https://is\d-ssl\.mzstatic\.com/image/thumb/[^\"' )]+")
IMAGE_VARIANT_RE = re.compile(r"^(?P<base>.+?)/(?P<width>\d+)x(?P<height>\d+)[^/]*\.(?P<ext>webp|jpg|jpeg|png)$", re.IGNORECASE)


def fetch_html(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.read().decode("utf-8", "ignore")


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", html.unescape(str(value))).strip()


def first_non_empty(*values: Any) -> str:
    for value in values:
        text = clean_text(value)
        if text:
            return text
    return ""


def with_query_param(url: str, key: str, value: str) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    if value:
        query[key] = value
    else:
        query.pop(key, None)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def collect_json_objects(value: Any) -> list[dict[str, Any]]:
    objects: list[dict[str, Any]] = []
    if isinstance(value, dict):
        objects.append(value)
        graph = value.get("@graph")
        if isinstance(graph, list):
            for item in graph:
                objects.extend(collect_json_objects(item))
    elif isinstance(value, list):
        for item in value:
            objects.extend(collect_json_objects(item))
    return objects


def extract_json_ld_objects(page_html: str) -> list[dict[str, Any]]:
    blocks: list[str] = []
    cursor = 0
    lower_html = page_html.lower()
    while True:
        start = lower_html.find("<script", cursor)
        if start < 0:
            break
        tag_end = lower_html.find(">", start)
        if tag_end < 0:
            break
        tag = lower_html[start : tag_end + 1]
        close = lower_html.find("</script>", tag_end)
        if close < 0:
            break
        if "application/ld+json" in tag:
            blocks.append(page_html[tag_end + 1 : close])
        cursor = close + len("</script>")
    objects: list[dict[str, Any]] = []
    for block in blocks:
        payload = html.unescape(block).strip()
        if not payload:
            continue
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError:
            continue
        objects.extend(collect_json_objects(parsed))
    return objects


def software_application_object(objects: list[dict[str, Any]]) -> dict[str, Any]:
    for obj in objects:
        obj_type = obj.get("@type")
        types = [obj_type] if isinstance(obj_type, str) else obj_type if isinstance(obj_type, list) else []
        normalized = {clean_text(item) for item in types if clean_text(item)}
        if "SoftwareApplication" in normalized:
            return obj
    return {}


def regex_search(page_html: str, patterns: list[str], *, dotall: bool = False) -> str:
    flags = re.IGNORECASE | (re.DOTALL if dotall else 0)
    for pattern in patterns:
        match = re.search(pattern, page_html, flags=flags)
        if match:
            return clean_text(match.group(1))
    return ""


def image_urls_from_object(obj: dict[str, Any]) -> list[str]:
    urls: list[str] = []
    for key in ("screenshot", "image"):
        value = obj.get(key)
        if isinstance(value, str):
            value = [value]
        if not isinstance(value, list):
            continue
        for item in value:
            url = clean_text(item)
            if url.startswith("http") and url not in urls:
                urls.append(url)
    return urls


def variant_key(url: str) -> str:
    match = IMAGE_VARIANT_RE.match(url)
    if match:
        return match.group("base")
    return url


def variant_rank(url: str) -> tuple[int, int]:
    match = IMAGE_VARIANT_RE.match(url)
    if not match:
        return (0, 0)
    width = int(match.group("width"))
    height = int(match.group("height"))
    ext = match.group("ext").lower()
    format_bonus = {"jpg": 2, "jpeg": 2, "png": 1, "webp": 0}.get(ext, 0)
    return (width * height, format_bonus)


def extract_gallery_urls(page_html: str) -> list[str]:
    lower_html = page_html.lower()
    screenshot_index = lower_html.find("screenshot")
    candidate_html = page_html[screenshot_index : screenshot_index + 50000] if screenshot_index >= 0 else page_html
    raw_urls = [clean_text(match.group(0)) for match in IMAGE_URL_RE.finditer(candidate_html)]

    ordered_keys: list[str] = []
    best_variants: dict[str, str] = {}
    best_ranks: dict[str, tuple[int, int]] = {}
    for url in raw_urls:
        if "AppIcon-" in url:
            continue
        key = variant_key(url)
        if key not in ordered_keys:
            ordered_keys.append(key)
        rank = variant_rank(url)
        if key not in best_variants or rank > best_ranks[key]:
            best_variants[key] = url
            best_ranks[key] = rank

    return [best_variants[key] for key in ordered_keys[:8] if key in best_variants]


def float_or_none(value: Any) -> float | None:
    text = clean_text(value)
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def build_listing(page_html: str, url: str) -> dict[str, Any]:
    objects = extract_json_ld_objects(page_html)
    app = software_application_object(objects)
    offers = app.get("offers") if isinstance(app.get("offers"), dict) else {}
    aggregate = app.get("aggregateRating") if isinstance(app.get("aggregateRating"), dict) else {}
    author = app.get("author") if isinstance(app.get("author"), dict) else {}
    object_images = image_urls_from_object(app)

    name = first_non_empty(
        app.get("name"),
        regex_search(page_html, [r'"name":"([^"]+)"']),
        regex_search(page_html, [r'<meta[^>]+property="og:title"[^>]+content="([^"]+)"']),
    )
    escaped_name = re.escape(name) if name else ""
    subtitle = first_non_empty(
        regex_search(
            page_html,
            [rf'"title":"{escaped_name}".{{0,1200}}?"subtitle":"([^"]+)"'] if escaped_name else [],
            dotall=True,
        ),
        regex_search(
            page_html,
            [rf'"title":"{escaped_name}".{{0,1200}}?"developerTagline":"([^"]+)"'] if escaped_name else [],
            dotall=True,
        ),
    )
    developer = first_non_empty(
        author.get("name"),
        regex_search(page_html, [r'"artistName":"([^"]+)"', r'"sellerName":"([^"]+)"']),
    )
    category = first_non_empty(
        app.get("applicationCategory"),
        regex_search(page_html, [r'"applicationCategory":"([^"]+)"', r'"genre":"([^"]+)"']),
    )
    rating = float_or_none(first_non_empty(aggregate.get("ratingValue"), regex_search(page_html, [r'"ratingValue":"?([0-9.]+)"?'])))
    description = first_non_empty(
        app.get("description"),
        regex_search(page_html, [r'<meta[^>]+name="description"[^>]+content="([^"]+)"', r'<meta[^>]+property="og:description"[^>]+content="([^"]+)"']),
    )
    icon_url = first_non_empty(
        object_images[0] if object_images else "",
        regex_search(page_html, [r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"']),
    )
    screenshot_urls = extract_gallery_urls(page_html)

    price_value = clean_text(offers.get("price"))
    price_currency = clean_text(offers.get("priceCurrency"))
    if price_value in {"0", "0.0", "0.00"}:
        price_text = "Free"
        is_free = True
    elif price_value:
        price_text = f"{price_currency} {price_value}".strip()
        is_free = False
    else:
        offer_text = regex_search(page_html, [r'"price":"([^"]+)"', r'"priceFormatted":"([^"]+)"'])
        normalized = offer_text.lower()
        is_free = normalized in {"free", "免費", "免费"}
        price_text = offer_text or ("Free" if is_free else "")

    listing = {
        "name": name,
        "developer": developer,
        "category": category,
        "rating": rating,
        "priceText": price_text,
        "free": is_free,
        "subtitle": subtitle,
        "description": description,
        "appStoreUrl": url,
        "iconUrl": icon_url,
        "imageUrls": screenshot_urls or ([icon_url] if icon_url else object_images),
        "fetchedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    }
    return listing


def build_copy_localization(localized_listing: dict[str, Any], language: str) -> dict[str, Any]:
    payload = {"language": clean_text(language)}
    for key in ("name", "developer", "category", "subtitle", "description"):
        text = clean_text(localized_listing.get(key))
        if text:
            payload[key] = text
    return payload


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Fetch structured App Store listing metadata.")
    parser.add_argument("url", help="Exact apps.apple.com detail URL")
    parser.add_argument("--region", dest="region", default="", help="Optional App Store region hint for compatibility")
    parser.add_argument("--selection-source", dest="selection_source", default="", help="Optional selectionSource value")
    parser.add_argument("--selected-date", dest="selected_date", default="", help="Optional selectedDate value")
    parser.add_argument("--browser-evidence", dest="browser_evidence", action="append", default=[], help="Optional browser evidence artifact path")
    parser.add_argument("--copy-language", dest="copy_language", default="en-US", help="Optional localization used for viewer-facing copy fields")
    parser.add_argument("--out", dest="out_path", default="", help="Optional output JSON path")
    args = parser.parse_args(argv)

    page_html = fetch_html(args.url)
    listing = build_listing(page_html, args.url)
    if args.selection_source:
        listing["selectionSource"] = args.selection_source
    if args.selected_date:
        listing["selectedDate"] = args.selected_date
    if args.browser_evidence:
        listing["browserEvidence"] = args.browser_evidence
    if clean_text(args.region):
        listing["regionHint"] = clean_text(args.region)

    copy_language = clean_text(args.copy_language)
    if copy_language:
        try:
            localized_html = fetch_html(with_query_param(args.url, "l", copy_language))
            localized_listing = build_listing(localized_html, args.url)
            copy_localization = build_copy_localization(localized_listing, copy_language)
            if len(copy_localization) > 1:
                listing["copyLocalization"] = copy_localization
        except Exception:
            # Viewer-facing localization is helpful for later English-first review
            # copy, but Stage 1 should not fail when the localized fetch is absent.
            pass

    payload = json.dumps(listing, ensure_ascii=False, indent=2) + "\n"
    if args.out_path:
        with open(args.out_path, "w", encoding="utf-8") as handle:
            handle.write(payload)
    else:
        sys.stdout.write(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
