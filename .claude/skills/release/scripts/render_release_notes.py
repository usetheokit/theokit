#!/usr/bin/env python3
"""Render release notes from a versioned CHANGELOG section.

Usage:
    python3 render_release_notes.py --changelog CHANGELOG.md --version 1.2.0
        # → prints the rendered notes to stdout

Exit codes:
    0 — printed notes
    1 — version section not found
    2 — file not found
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Render release notes from CHANGELOG.")
    parser.add_argument("--changelog", type=Path, default=Path("CHANGELOG.md"))
    parser.add_argument("--version", required=True, help="Semver string without leading 'v'.")
    args = parser.parse_args()

    if not args.changelog.exists():
        print(f"file not found: {args.changelog}", file=sys.stderr)
        return 2

    text = args.changelog.read_text(encoding="utf-8")
    pattern = re.compile(
        rf"^##\s+\[{re.escape(args.version)}\][^\n]*\n(.*?)(?=^##\s+\[|\Z)",
        re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(text)
    if not match:
        print(f"version section [{args.version}] not found in {args.changelog}", file=sys.stderr)
        return 1

    body = match.group(1).rstrip() + "\n"
    print(f"# Release v{args.version}\n")
    print(body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
