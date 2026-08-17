#!/usr/bin/env python3
"""Select the next eligible milestone from ROADMAP.md for cycle-roadmap.

Parses milestone headers (`### M<N> — [<status>] <name>`), extracts each
milestone's objective, definition-of-done bullets, and declared dependencies,
then picks the lowest-N milestone whose status is `[ ]` and whose dependencies
are all `[x]`.

Output is a single JSON line on stdout suitable for piping into the auto-plan
orchestrator's Step 0.

Usage:
    python3 select_next_milestone.py --roadmap ROADMAP.md --json
    python3 select_next_milestone.py --roadmap ROADMAP.md --prefer M3 --json

Verdicts (in `verdict` field unless a concrete milestone is picked):
    - milestone selected   → returns {"milestone_id", "name", "objective", "dod", "depends_on"}
    - ROADMAP_COMPLETE     → every milestone is [x]
    - ROADMAP_BLOCKED      → [ ] milestones remain but each has an unchecked dep
    - PREFER_NOT_ELIGIBLE  → --prefer was passed but that milestone is not eligible

Exit codes:
    0 — eligible milestone found
    1 — ROADMAP_COMPLETE or ROADMAP_BLOCKED or PREFER_NOT_ELIGIBLE
    2 — file not found / parse error
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# Matches `### M<N> — [<status>] <name>` (em-dash is U+2014, also accept ASCII --)
HEADER_RE = re.compile(r"^###\s+M(\d+)\s+[—\-]{1,2}\s+\[([x\s\-])\]\s+(.+?)\s*$", re.MULTILINE)

OBJECTIVE_RE = re.compile(r"^\*\*Objective:\*\*\s*(.+?)\s*$", re.MULTILINE)
DOD_BLOCK_RE = re.compile(r"\*\*Definition of done[^*]*\*\*\s*\n((?:- \[[ x]\] .+\n?)+)", re.MULTILINE)
DOD_BULLET_RE = re.compile(r"^- \[[ x]\]\s+(.+?)\s*$", re.MULTILINE)
DEPS_LINE_RE = re.compile(r"^\*\*Dependencies:\*\*\s*(.+?)\s*$", re.MULTILINE)
DEP_ID_RE = re.compile(r"\bM(\d+)\b")


@dataclass
class Milestone:
    """One parsed milestone block."""

    id: str  # "M0", "M1", …
    n: int  # numeric form for sort
    status: str  # "x" | " " | "-"
    name: str
    objective: str = ""
    dod: list[str] = field(default_factory=list)
    depends_on: list[str] = field(default_factory=list)

    @property
    def done(self) -> bool:
        return self.status == "x"

    @property
    def cancelled(self) -> bool:
        return self.status == "-"

    @property
    def unchecked(self) -> bool:
        return self.status == " "


def parse_roadmap(text: str) -> list[Milestone]:
    """Parse a ROADMAP.md text into an ordered list of Milestone records."""
    headers = list(HEADER_RE.finditer(text))
    if not headers:
        raise ValueError("no milestone headers found (expected `### M<N> — [<status>] <name>`)")

    milestones: list[Milestone] = []
    for idx, match in enumerate(headers):
        start = match.end()
        end = headers[idx + 1].start() if idx + 1 < len(headers) else len(text)
        body = text[start:end]

        ms = Milestone(
            id=f"M{match.group(1)}",
            n=int(match.group(1)),
            status=match.group(2),
            name=match.group(3).strip(),
        )

        obj = OBJECTIVE_RE.search(body)
        if obj:
            ms.objective = obj.group(1).strip()

        dod_block = DOD_BLOCK_RE.search(body)
        if dod_block:
            ms.dod = [b.strip() for b in DOD_BULLET_RE.findall(dod_block.group(1))]

        deps_line = DEPS_LINE_RE.search(body)
        if deps_line:
            raw = deps_line.group(1)
            if "none" not in raw.lower():
                ms.depends_on = sorted({f"M{m}" for m in DEP_ID_RE.findall(raw)})

        milestones.append(ms)

    milestones.sort(key=lambda m: m.n)
    return milestones


def select(milestones: list[Milestone], prefer: str | None = None) -> dict:
    """Pick the next eligible milestone, or return a verdict dict."""
    done_ids = {m.id for m in milestones if m.done}
    unchecked = [m for m in milestones if m.unchecked]

    if not unchecked:
        return {"verdict": "ROADMAP_COMPLETE"}

    def is_eligible(m: Milestone) -> bool:
        return all(dep in done_ids for dep in m.depends_on)

    eligible = [m for m in unchecked if is_eligible(m)]

    if prefer:
        target = next((m for m in milestones if m.id == prefer), None)
        if target is None:
            return {"verdict": "PREFER_NOT_ELIGIBLE", "reason": f"{prefer} not present in roadmap"}
        if target.done:
            return {"verdict": "PREFER_NOT_ELIGIBLE", "reason": f"{prefer} already [x]"}
        if target.cancelled:
            return {"verdict": "PREFER_NOT_ELIGIBLE", "reason": f"{prefer} cancelled"}
        if not is_eligible(target):
            missing = [dep for dep in target.depends_on if dep not in done_ids]
            return {
                "verdict": "PREFER_NOT_ELIGIBLE",
                "reason": f"{prefer} depends on unchecked milestone(s): {','.join(missing)}",
            }
        return _to_payload(target)

    if not eligible:
        wall = [
            {"id": m.id, "blocked_by": [dep for dep in m.depends_on if dep not in done_ids]}
            for m in unchecked
        ]
        return {"verdict": "ROADMAP_BLOCKED", "wall": wall}

    return _to_payload(min(eligible, key=lambda m: m.n))


def _to_payload(m: Milestone) -> dict:
    return {
        "milestone_id": m.id,
        "name": m.name,
        "objective": m.objective,
        "dod": m.dod,
        "depends_on": m.depends_on,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--roadmap", type=Path, default=Path("ROADMAP.md"))
    parser.add_argument("--prefer", help="Target a specific milestone (e.g. M3); fail if not eligible.")
    parser.add_argument("--json", action="store_true", help="Emit JSON (default; reserved for future formats).")
    args = parser.parse_args()

    if not args.roadmap.exists():
        print(f"file not found: {args.roadmap}", file=sys.stderr)
        return 2

    try:
        milestones = parse_roadmap(args.roadmap.read_text(encoding="utf-8"))
    except ValueError as exc:
        print(f"parse error: {exc}", file=sys.stderr)
        return 2

    result = select(milestones, prefer=args.prefer)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if "milestone_id" in result else 1


if __name__ == "__main__":
    sys.exit(main())
