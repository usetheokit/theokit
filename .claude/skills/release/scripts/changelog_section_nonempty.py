#!/usr/bin/env python3
"""Check that a CHANGELOG section has at least one entry (line starting with '- ').

Usage:
    python3 changelog_section_nonempty.py --section Unreleased [--changelog CHANGELOG.md]

Exit codes:
    0 — section has at least one bullet entry
    1 — section is empty or absent
    2 — file not found / parse error
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


def section_has_entries(changelog: Path, section: str) -> bool:
    if not changelog.exists():
        print(f"changelog file not found: {changelog}", file=sys.stderr)
        sys.exit(2)

    text = changelog.read_text(encoding="utf-8")
    pattern = re.compile(
        rf"^##\s+\[{re.escape(section)}\][^\n]*\n(.*?)(?=^##\s+\[|\Z)",
        re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(text)
    if not match:
        return False

    body = match.group(1)
    for line in body.splitlines():
        if line.strip().startswith("- "):
            return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Check that a CHANGELOG section is non-empty.")
    parser.add_argument("--changelog", type=Path, default=Path("CHANGELOG.md"))
    parser.add_argument("--section", required=True, help="Section name (e.g. 'Unreleased' or '1.2.0').")
    args = parser.parse_args()

    if section_has_entries(args.changelog, args.section):
        return 0
    print(f"section [{args.section}] is empty or absent in {args.changelog}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
