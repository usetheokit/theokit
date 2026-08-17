"""Research-coverage checker for /discover-execute blueprints (M2 deterministic).

Verifies that all 4 coverage corners are populated:
  1. Integration Tests
  2. Dependencies
  3. Tools
  4. Techniques

An empty corner triggers an empty_corner_{name} hard cap (≤49).
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any


CORNERS = [
    ("tests", r"##\s+Coverage\s+Corner\s+1\s*(?:—|-)\s*Integration\s+Tests"),
    ("deps", r"##\s+Coverage\s+Corner\s+2\s*(?:—|-)\s*Dependencies"),
    ("tools", r"##\s+Coverage\s+Corner\s+3\s*(?:—|-)\s*Tools"),
    ("techniques", r"##\s+Coverage\s+Corner\s+4\s*(?:—|-)\s*Techniques"),
]

PLACEHOLDER_RE = re.compile(r"<!--\s*TBD[\s:].*?-->", re.IGNORECASE | re.DOTALL)
DEFERRED_RE = re.compile(r"<!--\s*DEFERRED[\s:].*?-->", re.IGNORECASE | re.DOTALL)
HEADER_RE = re.compile(r"^#{1,6}\s+.*$", re.MULTILINE)

MIN_CONTENT_CHARS = 50  # Rough threshold: corner is populated if ≥50 non-trivial chars


def _extract_section(content: str, pattern: str) -> str | None:
    """Extract H2 section content (from header to next H2 or EOF)."""
    section_re = re.compile(f"^{pattern}\\s*$", re.MULTILINE | re.IGNORECASE)
    match = section_re.search(content)
    if not match:
        return None
    start = match.end()
    next_h2 = re.search(r"^##\s+", content[start:], re.MULTILINE)
    end = start + next_h2.start() if next_h2 else len(content)
    return content[start:end]


def _is_populated(section_content: str) -> bool:
    """Section is populated when it has real content beyond placeholders and headers.

    Recognizes <!-- DEFERRED: reason --> markers as intentional emptiness (counts as populated).
    """
    # If a DEFERRED marker is present, treat as populated (intentional deferral)
    if DEFERRED_RE.search(section_content):
        return True

    # Strip TBD placeholders
    stripped = PLACEHOLDER_RE.sub("", section_content)
    # Strip header lines
    no_headers = HEADER_RE.sub("", stripped)
    # Strip code fences (keep content inside)
    no_fences = re.sub(r"^```[^\n]*$", "", no_headers, flags=re.MULTILINE)
    content = no_fences.strip()
    return len(content) >= MIN_CONTENT_CHARS


def check_research_coverage(blueprint_path: Path) -> dict[str, Any]:
    content = blueprint_path.read_text(encoding="utf-8-sig")
    corners_status: list[dict[str, Any]] = []
    empty_corners: list[str] = []
    populated_count = 0

    for name, pattern in CORNERS:
        section = _extract_section(content, pattern)
        if section is None:
            corners_status.append({"corner": name, "present": False, "populated": False})
            empty_corners.append(name)
        else:
            populated = _is_populated(section)
            corners_status.append({"corner": name, "present": True, "populated": populated})
            if populated:
                populated_count += 1
            else:
                empty_corners.append(name)

    contributors = [
        f"Corner '{c['corner']}' populated" for c in corners_status if c["populated"]
    ][:3]
    detractors = [
        f"Corner '{c['corner']}' empty or missing" for c in corners_status if not c["populated"]
    ][:3]

    return {
        "corners_populated": populated_count,
        "corners_total": 4,
        "corners_status": corners_status,
        "empty_corners": empty_corners,
        "contributors": contributors,
        "detractors": detractors,
    }
