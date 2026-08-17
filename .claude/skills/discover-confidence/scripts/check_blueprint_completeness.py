"""Mandatory-section + ADR checker for /discover-execute blueprints (M2 deterministic).

Verifies that the blueprint contains all mandatory sections AND has at least one ADR.
Missing sections cap the score at 70 (SHIPPABLE_WITH_CAVEATS at most).
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any


# Each entry: (display name, regex matching the header)
MANDATORY_SECTIONS = [
    ("Header", r"^#\s+Blueprint:"),
    ("Context", r"^##\s+Context"),
    ("Objective", r"^##\s+Objective"),
    ("Coverage Corner 1", r"^##\s+Coverage\s+Corner\s+1"),
    ("Coverage Corner 2", r"^##\s+Coverage\s+Corner\s+2"),
    ("Coverage Corner 3", r"^##\s+Coverage\s+Corner\s+3"),
    ("Coverage Corner 4", r"^##\s+Coverage\s+Corner\s+4"),
    ("Cross-cutting Comparison", r"^##\s+Cross-cutting\s+Comparison"),
    ("ADRs", r"^##\s+ADRs"),
    ("Recommendations", r"^##\s+Recommendations"),
]

ADR_HEADER_RE = re.compile(r"^###\s+D\d+\s*(?:—|-)", re.MULTILINE)


def check_blueprint_completeness(blueprint_path: Path) -> dict[str, Any]:
    content = blueprint_path.read_text(encoding="utf-8-sig")

    present: list[str] = []
    missing: list[str] = []

    for name, pattern in MANDATORY_SECTIONS:
        if re.search(pattern, content, re.MULTILINE | re.IGNORECASE):
            present.append(name)
        else:
            missing.append(name)

    # Count ADRs in the ## ADRs section
    adrs_match = re.search(r"^##\s+ADRs\b", content, re.MULTILINE | re.IGNORECASE)
    if adrs_match:
        start = adrs_match.end()
        next_h2 = re.search(r"^##\s+", content[start:], re.MULTILINE)
        adrs_body = content[start : start + next_h2.start()] if next_h2 else content[start:]
        adr_count = len(ADR_HEADER_RE.findall(adrs_body))
    else:
        adr_count = 0

    total_required = len(MANDATORY_SECTIONS)
    found = len(present)

    contributors = [f"{found}/{total_required} mandatory sections present"]
    if adr_count > 0:
        contributors.append(f"{adr_count} ADR(s) found in ADRs section")

    detractors: list[str] = []
    for m in missing[:3]:
        detractors.append(f"Missing section: {m}")
    if adr_count == 0:
        detractors.append("No ADRs found under '## ADRs' section")

    return {
        "total_required": total_required,
        "found": found,
        "present": present,
        "missing_mandatory": missing,
        "adr_count": adr_count,
        "contributors": contributors,
        "detractors": detractors,
    }
