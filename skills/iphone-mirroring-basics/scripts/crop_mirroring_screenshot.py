#!/usr/bin/env python3
"""Crop iPhone Mirroring chrome from a raw screenshot.

Removes the window chrome (title bar, borders) using proportional insets
that adapt to any iPhone Mirroring window size.

Usage:
    python3 crop_mirroring_screenshot.py <raw_path> <output_path>

The proportional insets were measured from the iPhone Mirroring window chrome
on macOS 15 (Sequoia). They represent the title bar height, left/right borders,
and bottom border as fractions of the total window dimensions:

    left   = 2.53% of width   (window left border)
    top    = 5.32% of height  (title bar + top border)
    right  = 1.90% of width   (window right border)
    bottom = 1.29% of height  (window bottom border)
"""
from __future__ import annotations

import sys
from pathlib import Path

# Proportional insets: fraction of window dimension to crop on each side.
# Measured from macOS 15 iPhone Mirroring chrome.
INSET_LEFT = 0.0253
INSET_TOP = 0.0532
INSET_RIGHT = 0.0190
INSET_BOTTOM = 0.0129


def crop_mirroring(raw_path: str, output_path: str) -> None:
    try:
        from PIL import Image
    except ImportError:
        # Fallback: use sips (macOS built-in) for a simpler center crop
        import subprocess

        subprocess.run(
            ["cp", raw_path, output_path], check=True
        )
        print(f"Warning: Pillow not available, copied raw image to {output_path}")
        return

    img = Image.open(raw_path)
    w, h = img.size
    left = round(w * INSET_LEFT)
    top = round(h * INSET_TOP)
    right = round(w * INSET_RIGHT)
    bottom = round(h * INSET_BOTTOM)
    cropped = img.crop((left, top, w - right, h - bottom))
    cropped.save(output_path)
    print(f"Cropped {w}x{h} -> {cropped.size[0]}x{cropped.size[1]} -> {output_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <raw_path> <output_path>", file=sys.stderr)
        sys.exit(1)
    crop_mirroring(sys.argv[1], sys.argv[2])
