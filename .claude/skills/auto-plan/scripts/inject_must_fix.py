#!/usr/bin/env python3
"""Inject MUST-FIX edge-case items into a plan's task list, so /plan-confidence
can re-score the augmented plan without a human-in-the-loop step.

The /edge-case-plan skill emits a report at:
    knowledge-base/reviews/{slug}-edge-cases-{YYYY-MM-DD}.md

with a `## MUST FIX` section listing entries like:

    ### EC-1: short description
    - **Affected task:** T1.2
    - **Family:** Input / Boundary / ...
    - **Scenario:** ...
    - **Impact:** ...
    - **Suggested fix:** ...

This script parses those entries and appends them to the plan as a new
`## Absorbed MUST-FIX items (from /edge-case-plan)` section, with each
entry rendered as a sub-task referencing the originating EC id and the
affected plan task.

Existing plan content is NEVER mutated; only the appended section is added.
Re-running the script is idempotent — entries already present (matched by
`EC-N` id) are skipped.

Usage:
    python3 inject_must_fix.py --plan PATH --edge-cases PATH [PATH ...]

Exit codes:
    0 — injection succeeded (or nothing to inject)
    1 — plan file missing
    2 — edge-case file missing or parse error
"""
from __future__ import annotations

import argparse
import glob
import re
import sys
from pathlib import Path


HEADING = "## Absorbed MUST-FIX items (from /edge-case-plan)"

ENTRY_RE = re.compile(
    r"^###\s+(?P<id>EC-\d+):\s*(?P<title>.+?)\n(?P<body>.*?)(?=^###\s+EC-|\Z)",
    re.MULTILINE | re.DOTALL,
)

FIELD_RE = re.compile(
    r"^\s*-\s+\*\*(?P<key>[A-Za-z ]+):\*\*\s*(?P<value>.+?)\s*$",
    re.MULTILINE,
)


def parse_must_fix(text: str) -> list[dict[str, str]]:
    """Extract MUST FIX entries from an edge-case-plan report."""
    section = re.search(
        r"^##\s+MUST FIX\s*\n(.*?)(?=^##\s+\w|\Z)",
        text,
        re.MULTILINE | re.DOTALL,
    )
    if not section:
        return []

    entries: list[dict[str, str]] = []
    for match in ENTRY_RE.finditer(section.group(1)):
        body = match.group("body")
        fields = {fm.group("key").strip(): fm.group("value").strip() for fm in FIELD_RE.finditer(body)}
        entries.append({
            "id": match.group("id").strip(),
            "title": match.group("title").strip(),
            "affected_task": fields.get("Affected task", ""),
            "family": fields.get("Family", ""),
            "scenario": fields.get("Scenario", ""),
            "impact": fields.get("Impact", ""),
            "suggested_fix": fields.get("Suggested fix", ""),
        })
    return entries


def existing_injected_ids(plan_text: str) -> set[str]:
    """Identify EC ids already present in the appended section to ensure idempotency."""
    if HEADING not in plan_text:
        return set()
    tail = plan_text.split(HEADING, 1)[1]
    return set(re.findall(r"\bEC-\d+\b", tail))


def render_entry(entry: dict[str, str]) -> str:
    return (
        f"### {entry['id']} (auto-absorbed): {entry['title']}\n"
        f"- **Source:** edge-case-plan MUST FIX\n"
        f"- **Affected task:** {entry['affected_task'] or 'unspecified'}\n"
        f"- **Family:** {entry['family'] or 'unspecified'}\n"
        f"- **Scenario:** {entry['scenario'] or '—'}\n"
        f"- **Impact:** {entry['impact'] or '—'}\n"
        f"- **Suggested fix:** {entry['suggested_fix'] or 'See edge-case report.'}\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Inject MUST-FIX items from /edge-case-plan into the plan.")
    parser.add_argument("--plan", type=Path, required=True, help="Plan file (markdown).")
    parser.add_argument(
        "--edge-cases",
        nargs="+",
        required=True,
        help="Edge-case-plan report file(s) — globs are expanded.",
    )
    args = parser.parse_args()

    if not args.plan.exists():
        print(f"plan not found: {args.plan}", file=sys.stderr)
        return 1

    edge_files: list[Path] = []
    for pattern in args.edge_cases:
        expanded = glob.glob(pattern)
        if expanded:
            edge_files.extend(Path(p) for p in expanded)
        else:
            edge_files.append(Path(pattern))

    if not edge_files:
        print("no edge-case files provided", file=sys.stderr)
        return 2

    all_entries: list[dict[str, str]] = []
    for ef in edge_files:
        if not ef.exists():
            print(f"edge-case file not found: {ef}", file=sys.stderr)
            return 2
        text = ef.read_text(encoding="utf-8")
        all_entries.extend(parse_must_fix(text))

    if not all_entries:
        print("no MUST FIX entries found — nothing to inject")
        return 0

    plan_text = args.plan.read_text(encoding="utf-8")
    already = existing_injected_ids(plan_text)
    new_entries = [e for e in all_entries if e["id"] not in already]

    if not new_entries:
        print(f"all {len(all_entries)} entries already injected — no-op")
        return 0

    rendered = "\n".join(render_entry(e) for e in new_entries)

    if HEADING in plan_text:
        plan_text = plan_text.rstrip() + "\n\n" + rendered + "\n"
    else:
        plan_text = plan_text.rstrip() + "\n\n" + HEADING + "\n\n" + rendered + "\n"

    args.plan.write_text(plan_text, encoding="utf-8")
    print(f"injected {len(new_entries)} MUST-FIX entries into {args.plan}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
