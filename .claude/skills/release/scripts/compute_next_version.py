#!/usr/bin/env python3
"""Compute the next semver version from current tag + bump level.

Bump-level resolution:
- Explicit: --bump {major,minor,patch} wins.
- Auto: derive from CHANGELOG.md [Unreleased] sections.
  - major: ### Removed non-empty OR any ### Changed entry starts with 'BREAKING:'
  - minor: ### Added non-empty AND no major trigger
  - patch: only ### Fixed / ### Security entries
  - ambiguous: prints 'AMBIGUOUS' to stdout, exits 3.

Usage:
    python3 compute_next_version.py --current v1.2.3 --bump auto --changelog CHANGELOG.md

Exit codes:
    0 — printed next version (e.g. '1.2.4')
    2 — error (invalid current tag, etc.)
    3 — bump cannot be derived; user must specify
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


SEMVER_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$")


def parse_semver(tag: str) -> tuple[int, int, int]:
    m = SEMVER_RE.match(tag.strip())
    if not m:
        print(f"invalid semver tag: {tag}", file=sys.stderr)
        sys.exit(2)
    return int(m.group(1)), int(m.group(2)), int(m.group(3))


def extract_unreleased_subsections(changelog: Path) -> dict[str, list[str]]:
    text = changelog.read_text(encoding="utf-8")
    match = re.search(
        r"^##\s+\[Unreleased\][^\n]*\n(.*?)(?=^##\s+\[|\Z)",
        text,
        re.MULTILINE | re.DOTALL,
    )
    if not match:
        return {}

    body = match.group(1)
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("### "):
            current = stripped[4:].strip()
            sections.setdefault(current, [])
        elif current and stripped.startswith("- "):
            sections[current].append(stripped[2:].strip())
    return {k: v for k, v in sections.items() if v}


def derive_bump(unreleased: dict[str, list[str]]) -> str | None:
    if not unreleased:
        return None

    removed = unreleased.get("Removed", [])
    changed = unreleased.get("Changed", [])
    added = unreleased.get("Added", [])
    fixed = unreleased.get("Fixed", [])
    security = unreleased.get("Security", [])

    breaking_in_changed = any(c.upper().startswith("BREAKING:") for c in changed)
    if removed or breaking_in_changed:
        return "major"
    if added:
        return "minor"
    if fixed or security:
        return "patch"
    return None


def bump_version(current: tuple[int, int, int], level: str) -> str:
    major, minor, patch = current
    if level == "major":
        return f"{major + 1}.0.0"
    if level == "minor":
        return f"{major}.{minor + 1}.0"
    if level == "patch":
        return f"{major}.{minor}.{patch + 1}"
    print(f"invalid bump level: {level}", file=sys.stderr)
    sys.exit(2)


def main() -> int:
    parser = argparse.ArgumentParser(description="Compute next semver from current tag + bump.")
    parser.add_argument("--current", required=True, help="Current version tag (v1.2.3 or 1.2.3).")
    parser.add_argument(
        "--bump",
        default="auto",
        choices=("auto", "major", "minor", "patch"),
        help="Bump level. 'auto' derives from CHANGELOG.",
    )
    parser.add_argument("--changelog", type=Path, default=Path("CHANGELOG.md"))
    args = parser.parse_args()

    current = parse_semver(args.current)

    if args.bump == "auto":
        if not args.changelog.exists():
            print(f"changelog not found for auto-bump: {args.changelog}", file=sys.stderr)
            return 2
        unreleased = extract_unreleased_subsections(args.changelog)
        derived = derive_bump(unreleased)
        if derived is None:
            print("AMBIGUOUS")
            return 3
        bump = derived
    else:
        bump = args.bump

    next_version = bump_version(current, bump)
    print(next_version)
    return 0


if __name__ == "__main__":
    sys.exit(main())
