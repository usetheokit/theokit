#!/usr/bin/env python3
"""Extract the acceptance criteria a released milestone must satisfy in the live system.

The criteria are NOT invented by this cycle. They are the milestone's own
`**Definition of done (all must hold):**` bullets in `ROADMAP.md` — the
user-facing promise written at roadmap time, and exactly what the `[x]`
checkbox claims once flipped. Deriving them anywhere else would let the
acceptance run grade itself against a target it chose after seeing the result.

Emits JSON on stdout so the verdict step consumes structured criteria rather
than re-parsing prose:

    {"milestone_id": "M2", "milestone_name": "Streaming",
     "criteria": [{"id": "AC1", "source": "roadmap-dod", "text": "..."}]}

Usage:
    python3 extract_acceptance_criteria.py --roadmap ROADMAP.md --milestone M2

Exit codes:
    0 — criteria written to stdout
    1 — gate violation (milestone absent, DoD section absent or empty)
    2 — file not found / bad argument
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

#: Same header shape cycle-release flips and cycle-goal validates.
_HEADER_RE = re.compile(
    r"^###\s+(M\d+)\s+[—\-]{1,2}\s+\[([ x])\]\s+(.+?)$",
    re.MULTILINE,
)

#: `**Definition of done (all must hold):**` — the parenthetical is optional.
_DOD_HEADING_RE = re.compile(r"^\*\*Definition of done[^*]*:\*\*\s*$", re.MULTILINE)

#: A checkbox bullet inside the DoD block.
_DOD_BULLET_RE = re.compile(r"^-\s+\[([ x])\]\s+(.+?)\s*$", re.MULTILINE)

#: Any other `**Bold label:**` line — marks the end of the DoD block.
_NEXT_LABEL_RE = re.compile(r"^\*\*[^*]+:\*\*", re.MULTILINE)

_MILESTONE_ID_RE = re.compile(r"^M\d+$")


class GateViolation(Exception):
    """A hard gate refused the extraction."""


def _milestone_block(roadmap_text: str, milestone_id: str) -> tuple[str, str]:
    """Return (milestone_name, block_text) for the requested milestone."""
    matches = list(_HEADER_RE.finditer(roadmap_text))
    for index, match in enumerate(matches):
        if match.group(1) != milestone_id:
            continue
        end = matches[index + 1].start() if index + 1 < len(matches) else len(roadmap_text)
        return match.group(3).strip(), roadmap_text[match.end():end]

    known = ", ".join(m.group(1) for m in matches) or "(none)"
    raise GateViolation(
        f"{milestone_id} is not in the roadmap. Milestones present: {known}."
    )


def extract(roadmap_text: str, milestone_id: str) -> dict[str, object]:
    """Pull the milestone's Definition-of-done bullets as acceptance criteria."""
    if not _MILESTONE_ID_RE.match(milestone_id):
        raise GateViolation(f"invalid milestone id {milestone_id!r} — expected M<N>.")

    name, block = _milestone_block(roadmap_text, milestone_id)

    heading = _DOD_HEADING_RE.search(block)
    if heading is None:
        raise GateViolation(
            f"{milestone_id} has no `**Definition of done:**` section. "
            "Acceptance has nothing to validate against — the milestone's promise was never written. "
            "Add it to ROADMAP.md before releasing."
        )

    tail = block[heading.end():]
    next_label = _NEXT_LABEL_RE.search(tail)
    dod_block = tail[: next_label.start()] if next_label else tail

    bullets = [text.strip() for _state, text in _DOD_BULLET_RE.findall(dod_block)]
    if not bullets:
        raise GateViolation(
            f"{milestone_id} declares a Definition of done with no `- [ ]` bullets. "
            "An empty promise cannot be accepted or rejected."
        )

    return {
        "milestone_id": milestone_id,
        "milestone_name": name,
        "criteria": [
            {"id": f"AC{index}", "source": "roadmap-dod", "text": text}
            for index, text in enumerate(bullets, start=1)
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--roadmap", type=Path, default=Path("ROADMAP.md"))
    parser.add_argument("--milestone", required=True, help="Milestone id, e.g. M2.")
    args = parser.parse_args()

    if not args.roadmap.exists():
        print(f"file not found: {args.roadmap}", file=sys.stderr)
        return 2

    try:
        payload = extract(args.roadmap.read_text(encoding="utf-8"), args.milestone)
    except GateViolation as exc:
        print(f"NOT_VALIDATED cycle-acceptance: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
