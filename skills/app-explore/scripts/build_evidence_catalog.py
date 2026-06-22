#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def as_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [clean_text(item) for item in value if clean_text(item)]


def is_partial_run(notes: dict[str, Any]) -> bool:
    coverage = as_dict(notes.get("coverage"))
    findings = as_dict(notes.get("findings"))
    script_hooks = as_dict(notes.get("scriptHooks"))
    text_blob = " ".join([
        clean_text(coverage.get("demoDepth")),
        " ".join(as_list(coverage.get("coverageGaps"))),
        " ".join(as_list(findings.get("limitations"))),
        clean_text(script_hooks.get("oneSentenceVerdict")),
    ]).lower()
    if clean_text(coverage.get("demoDepth")).lower() in {"partial", "shallow"}:
        return True
    return any(token in text_blob for token in ["sign in", "login", "log in", "permission", "blocked", "wall"])


def choose_proof_priority(paths: list[Path]) -> list[str]:
    weighted: list[tuple[int, str]] = []
    for path in paths:
        name = path.name.lower()
        score = 0
        if any(token in name for token in ["save", "saved", "result", "export", "success"]):
            score += 5
        if any(token in name for token in ["core", "loop", "task", "history"]):
            score += 4
        if any(token in name for token in ["detail", "secondary", "friction", "limit"]):
            score += 3
        if name.endswith(".mov"):
            score += 2
        weighted.append((score, str(path.relative_to(path.parents[2]))))
    return [entry for _score, entry in sorted(weighted, key=lambda item: (-item[0], item[1]))]


def main(root_dir: str) -> int:
    root = Path(root_dir).expanduser().resolve()
    notes = read_json(root / "experience" / "notes.json")
    screenshots = sorted((root / "experience" / "screenshots").glob("*.png"))
    clips = sorted((root / "experience" / "clips").glob("*.mov"))

    partial_run = is_partial_run(notes)
    min_screenshots = 4 if partial_run else 10
    min_clips = 0 if partial_run else 2

    payload = {
        "partialRun": partial_run,
        "minimums": {
            "screenshots": min_screenshots,
            "clips": min_clips,
        },
        "counts": {
            "screenshots": len(screenshots),
            "clips": len(clips),
        },
        "meetsEvidenceFloor": len(screenshots) >= min_screenshots and len(clips) >= min_clips,
        "screenshots": [str(path.relative_to(root)) for path in screenshots],
        "clips": [str(path.relative_to(root)) for path in clips],
        "proofPriority": choose_proof_priority([*clips, *screenshots])[:8],
    }

    output_path = root / "experience" / "evidence-catalog.json"
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")

    if not payload["meetsEvidenceFloor"]:
        raise SystemExit(
            f"Evidence floor not met: found {len(screenshots)} screenshot(s) and {len(clips)} clip(s); "
            f"need at least {min_screenshots} screenshot(s) and {min_clips} clip(s)."
        )

    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: build_evidence_catalog.py <artifacts-root-dir>")
    raise SystemExit(main(sys.argv[1]))
