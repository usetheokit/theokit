#!/usr/bin/env python3
"""Inject `milestone_id: M<N>` into a plan's YAML frontmatter.

Per the cycle-roadmap contract, the plan at knowledge-base/plans/{slug}-plan.md
MUST carry `milestone_id` in its frontmatter so cycle-release can flip the
correct ROADMAP.md checkbox after merge.

This script is idempotent: if `milestone_id` already equals the requested
value, the file is left unchanged. If it equals a different value, the script
ABORTS rather than silently rewriting — the user must resolve the conflict
manually (a plan should never change milestones mid-flight).

Usage:
    python3 inject_milestone_id.py --plan knowledge-base/plans/foo-plan.md --milestone-id M3

Exit codes:
    0 — milestone_id present (added, or already matched, no change needed)
    1 — milestone_id ALREADY SET to a different value (conflict; refuse to overwrite)
    2 — file not found / parse error / invalid milestone_id format
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml

MILESTONE_RE = re.compile(r"^M\d+$")


def inject(plan_text: str, milestone_id: str) -> tuple[str, str]:
    """Return (new_text, status) where status ∈ {added, matched, conflict:<existing>, no-frontmatter}."""
    if not MILESTONE_RE.match(milestone_id):
        raise ValueError(f"invalid milestone_id (expected M<N>): {milestone_id!r}")

    parts = plan_text.split("---", 2)
    if len(parts) < 3 or parts[0].strip():
        # No frontmatter — create one
        new_meta = {"milestone_id": milestone_id}
        new_text = "---\n" + yaml.safe_dump(new_meta, sort_keys=False).strip() + "\n---\n" + plan_text
        return new_text, "no-frontmatter"

    raw_meta = parts[1]
    body = parts[2]
    meta = yaml.safe_load(raw_meta) or {}

    existing = meta.get("milestone_id")
    if existing == milestone_id:
        return plan_text, "matched"
    if existing is not None and existing != milestone_id:
        return plan_text, f"conflict:{existing}"

    meta["milestone_id"] = milestone_id
    new_meta_text = yaml.safe_dump(meta, sort_keys=False).strip()
    return f"---\n{new_meta_text}\n---{body}", "added"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--milestone-id", required=True, help="Milestone identifier (e.g. M3).")
    args = parser.parse_args()

    if not args.plan.exists():
        print(f"file not found: {args.plan}", file=sys.stderr)
        return 2

    try:
        new_text, status = inject(args.plan.read_text(encoding="utf-8"), args.milestone_id)
    except (yaml.YAMLError, ValueError) as exc:
        print(f"parse error: {exc}", file=sys.stderr)
        return 2

    if status.startswith("conflict:"):
        existing = status.split(":", 1)[1]
        print(
            f"refuse to overwrite: milestone_id already set to {existing!r}; requested {args.milestone_id!r}",
            file=sys.stderr,
        )
        return 1

    if status == "matched":
        print(f"no-op: milestone_id already {args.milestone_id}")
        return 0

    args.plan.write_text(new_text, encoding="utf-8")
    print(f"injected milestone_id={args.milestone_id} (status: {status})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
