#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops, ImageFilter, ImageOps

TARGET_W = 1080
TARGET_H = 1920
FOREGROUND_MAX_W = 948
FOREGROUND_MAX_H = 1840


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def clean_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def copy_file(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def is_image_path(path: Path) -> bool:
    return path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}


def rgb_delta(left: tuple[int, int, int], right: tuple[int, int, int]) -> int:
    return sum(abs(int(a) - int(b)) for a, b in zip(left, right))


def average_color(samples: list[tuple[int, int, int]]) -> tuple[int, int, int]:
    if not samples:
        return (28, 36, 52)
    channels = list(zip(*samples))
    return tuple(int(sum(channel) / len(channel)) for channel in channels)


def sample_border_color(image: Image.Image) -> tuple[int, int, int]:
    rgb = image.convert("RGB")
    width, height = rgb.size
    step_x = max(1, width // 24)
    step_y = max(1, height // 24)
    samples: list[tuple[int, int, int]] = []

    for x in range(0, width, step_x):
        samples.append(rgb.getpixel((x, 0)))
        samples.append(rgb.getpixel((x, height - 1)))
    for y in range(0, height, step_y):
        samples.append(rgb.getpixel((0, y)))
        samples.append(rgb.getpixel((width - 1, y)))

    inset_x = max(0, width // 40)
    inset_y = max(0, height // 40)
    corner_points = [
        (inset_x, inset_y),
        (width - 1 - inset_x, inset_y),
        (inset_x, height - 1 - inset_y),
        (width - 1 - inset_x, height - 1 - inset_y),
    ]
    samples.extend(rgb.getpixel(point) for point in corner_points)
    return average_color(samples)


def detect_phone_bounds(image: Image.Image) -> tuple[int, int, int, int]:
    rgb = image.convert("RGB")
    width, height = rgb.size
    background = sample_border_color(rgb)
    threshold = 50
    step_x = max(1, width // 180)
    step_y = max(1, height // 280)

    sampled_rows = list(range(0, height, step_y))
    sampled_cols = list(range(0, width, step_x))
    min_column_hits = max(4, int(len(sampled_rows) * 0.62))
    min_row_hits = max(4, int(len(sampled_cols) * 0.52))

    column_hits: list[int] = []
    for x in range(width):
        hits = 0
        for y in sampled_rows:
            if rgb_delta(rgb.getpixel((x, y)), background) > threshold:
                hits += 1
        column_hits.append(hits)

    center_x = width // 2
    left = center_x
    while left > 0 and column_hits[left] >= min_column_hits:
        left -= 1
    right = center_x
    while right < width - 1 and column_hits[right] >= min_column_hits:
        right += 1

    if right - left < int(width * 0.32):
        foreground_columns = [index for index, hits in enumerate(column_hits) if hits >= min_column_hits]
        if foreground_columns:
            left = foreground_columns[0]
            right = foreground_columns[-1]

    relevant_cols = list(range(max(0, left), min(width, right + 1), step_x))
    if not relevant_cols:
        return (0, 0, width, height)

    row_hits: list[int] = []
    for y in range(height):
        hits = 0
        for x in relevant_cols:
            if rgb_delta(rgb.getpixel((x, y)), background) > threshold:
                hits += 1
        row_hits.append(hits)

    center_y = height // 2
    top = center_y
    while top > 0 and row_hits[top] >= min_row_hits:
        top -= 1
    bottom = center_y
    while bottom < height - 1 and row_hits[bottom] >= min_row_hits:
        bottom += 1

    if bottom - top < int(height * 0.5):
        foreground_rows = [index for index, hits in enumerate(row_hits) if hits >= min_row_hits]
        if foreground_rows:
            top = foreground_rows[0]
            bottom = foreground_rows[-1]

    expand_x = max(6, width // 56)
    expand_y = max(6, height // 72)
    left = max(0, left - expand_x)
    top = max(0, top - expand_y)
    right = min(width - 1, right + expand_x)
    bottom = min(height - 1, bottom + expand_y)

    crop_width = right - left + 1
    crop_height = bottom - top + 1
    aspect = crop_width / crop_height if crop_height else 0
    if crop_width < int(width * 0.45) or crop_height < int(height * 0.65) or not (0.28 <= aspect <= 0.72):
        return (0, 0, width, height)
    return (left, top, right + 1, bottom + 1)


def fit_size(size: tuple[int, int], max_width: int, max_height: int) -> tuple[int, int]:
    width, height = size
    scale = min(max_width / width, max_height / height)
    return (
        max(1, int(round(width * scale))),
        max(1, int(round(height * scale))),
    )


def cover_size(size: tuple[int, int], target_width: int, target_height: int) -> tuple[int, int]:
    width, height = size
    scale = max(target_width / width, target_height / height)
    return (
        max(1, int(round(width * scale))),
        max(1, int(round(height * scale))),
    )


def add_dark_tint(image: Image.Image, opacity: int) -> Image.Image:
    overlay = Image.new("RGBA", image.size, (8, 14, 24, opacity))
    return Image.alpha_composite(image.convert("RGBA"), overlay)


def add_vertical_gradient(image: Image.Image) -> Image.Image:
    base = image.convert("RGBA")
    gradient = Image.new("L", (1, TARGET_H))
    for y in range(TARGET_H):
        progress = y / max(1, TARGET_H - 1)
        alpha = int(64 + (46 * abs(progress - 0.5)))
        gradient.putpixel((0, y), alpha)
    mask = gradient.resize((TARGET_W, TARGET_H))
    overlay = Image.new("RGBA", (TARGET_W, TARGET_H), (4, 8, 14, 0))
    overlay.putalpha(mask)
    return Image.alpha_composite(base, overlay)


def render_proof_panel(source: Path, destination: Path) -> None:
    with Image.open(source) as opened:
        original = opened.convert("RGB")

    bounds = detect_phone_bounds(original)
    phone = original.crop(bounds)

    background_size = cover_size(phone.size, TARGET_W, TARGET_H)
    background = phone.resize(background_size, Image.Resampling.LANCZOS)
    background = ImageOps.autocontrast(background, cutoff=1)
    background = background.filter(ImageFilter.GaussianBlur(34))
    background = add_dark_tint(background, opacity=132)
    background = background.crop(
        (
            max(0, (background.width - TARGET_W) // 2),
            max(0, (background.height - TARGET_H) // 2),
            max(0, (background.width - TARGET_W) // 2) + TARGET_W,
            max(0, (background.height - TARGET_H) // 2) + TARGET_H,
        )
    )
    background = add_vertical_gradient(background)

    foreground_size = fit_size(phone.size, FOREGROUND_MAX_W, FOREGROUND_MAX_H)
    foreground = phone.resize(foreground_size, Image.Resampling.LANCZOS).convert("RGBA")

    canvas = background.convert("RGBA")

    shadow = Image.new("RGBA", foreground.size, (0, 0, 0, 0))
    shadow_alpha = Image.new("L", foreground.size, 0)
    shadow_alpha.paste(178, (0, 0, foreground.width, foreground.height))
    shadow.putalpha(shadow_alpha)
    shadow = shadow.filter(ImageFilter.GaussianBlur(26))

    paste_x = (TARGET_W - foreground.width) // 2
    paste_y = max(24, (TARGET_H - foreground.height) // 2)
    canvas.alpha_composite(shadow, (paste_x + 6, paste_y + 18))
    canvas.alpha_composite(foreground, (paste_x, paste_y))

    destination.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(destination, format="PNG")


def main(root_dir: str) -> int:
    root = Path(root_dir).expanduser().resolve()
    post_dir = root / "post"
    manifest_path = post_dir / "capcut-import-manifest.json"
    manifest = read_json(manifest_path)
    import_assets = manifest.get("importAssets")
    if not isinstance(import_assets, list) or not import_assets:
        raise SystemExit(f"Missing or empty import manifest: {manifest_path}")

    capcut_import_dir = post_dir / "capcut-import"
    clean_dir(capcut_import_dir)

    copied: list[dict[str, str]] = []
    for asset in import_assets:
        if not isinstance(asset, dict):
            continue
        source_rel = str(asset.get("source") or "").strip()
        target_name = str(asset.get("targetName") or "").strip()
        role = str(asset.get("role") or "").strip()
        if not source_rel or not target_name:
            continue
        source_path = root / source_rel
        if not source_path.exists():
            raise SystemExit(f"Import source missing: {source_path}")
        target_path = capcut_import_dir / target_name
        prepared = False
        if is_image_path(source_path):
            render_proof_panel(source_path, target_path)
            prepared = True
        else:
            copy_file(source_path, target_path)
        copied.append(
            {
                "role": role,
                "source": source_rel,
                "target": str(target_path.relative_to(root)),
                "prepared": "true" if prepared else "false",
            }
        )

    run_slug = root.parent.name or root.name
    short_import_dir = Path("/tmp") / f"understudy-capcut-import-{run_slug}"
    clean_dir(short_import_dir)
    for item in capcut_import_dir.iterdir():
        if item.is_file():
            copy_file(item, short_import_dir / item.name)

    short_path_file = post_dir / "capcut-import-path.txt"
    short_path_file.write_text(f"{short_import_dir}\n")

    readme_lines = [
        "# CapCut Import Pack",
        "- This folder contains only the curated media that should be imported into CapCut for the current run.",
        "- Image beats are pre-rendered into 1080x1920 proof panels so the iPhone fills the frame before CapCut editing begins.",
        "- Use the numbered filenames as the preferred import order.",
        f"- Short import path: `{short_import_dir}`",
        "",
        "## Files",
    ]
    for item in copied:
        render_note = "prepared proof panel" if item["prepared"] == "true" else "direct copy"
        readme_lines.append(f"- `{Path(item['target']).name}` <- `{item['source']}` ({item['role']}, {render_note})")
    (capcut_import_dir / "README.md").write_text("\n".join(readme_lines).rstrip() + "\n")

    print(
        json.dumps(
            {
                "manifest": str(manifest_path),
                "capcutImportDir": str(capcut_import_dir),
                "shortImportDir": str(short_import_dir),
                "shortPathFile": str(short_path_file),
                "files": copied,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: prepare_capcut_import.py <artifacts-root-dir>")
    raise SystemExit(main(sys.argv[1]))
