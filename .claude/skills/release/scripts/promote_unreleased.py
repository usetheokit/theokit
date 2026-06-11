#!/usr/bin/env python3
"""Promote CHANGELOG [Unreleased] body to a versioned section; leave [Unreleased] empty.

Preserves Keep-a-Changelog category ordering:
  Added → Changed → Deprecated → Removed → Fixed → Security

Usage:
    python3 promote_unreleased.py --changelog CHANGELOG.md --version 1.2.0 --date 2026-06-04

Exit codes:
    0 — rewrite successful
    1 — [Unreleased] section absent or empty
    2 — file not found / parse error
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


CATEGORY_ORDER = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"]


def main() -> int:
    parser = argparse.ArgumentParser(description="Promote CHANGELOG [Unreleased] to a versioned section.")
    parser.add_argument("--changelog", type=Path, default=Path("CHANGELOG.md"))
    parser.add_argument("--version", required=True, help="Semver string without leading 'v' (e.g. '1.2.0').")
    parser.add_argument("--date", required=True, help="ISO date (YYYY-MM-DD).")
    args = parser.parse_args()

    if not args.changelog.exists():
        print(f"file not found: {args.changelog}", file=sys.stderr)
        return 2

    text = args.changelog.read_text(encoding="utf-8")
    pattern = re.compile(
        r"(?P<head>^##\s+\[Unreleased\][^\n]*\n)(?P<body>.*?)(?=^##\s+\[|\Z)",
        re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(text)
    if not match:
        print("no [Unreleased] section found", file=sys.stderr)
        return 1

    body = match.group("body")
    if not any(line.strip().startswith("- ") for line in body.splitlines()):
        print("[Unreleased] is empty", file=sys.stderr)
        return 1

    # Re-order categories to canonical order; preserve unrecognized headings at the end.
    sections: dict[str, list[str]] = {}
    current: str | None = None
    leading_blank: list[str] = []
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("### "):
            current = stripped[4:].strip()
            sections.setdefault(current, [])
        elif current is None:
            leading_blank.append(line)
        else:
            sections[current].append(line)

    ordered_lines: list[str] = []
    for cat in CATEGORY_ORDER:
        if cat in sections and any(l.strip().startswith("- ") for l in sections[cat]):
            ordered_lines.append(f"### {cat}")
            ordered_lines.extend(sections[cat])
            ordered_lines.append("")
            del sections[cat]
    # Preserve any unrecognized categories.
    for cat, lines in sections.items():
        if any(l.strip().startswith("- ") for l in lines):
            ordered_lines.append(f"### {cat}")
            ordered_lines.extend(lines)
            ordered_lines.append("")

    new_versioned_body = "\n".join(ordered_lines).rstrip() + "\n\n"

    fresh_unreleased = (
        "## [Unreleased]\n"
        "\n"
        "### Added\n"
        "\n"
        "### Changed\n"
        "\n"
        "### Deprecated\n"
        "\n"
        "### Removed\n"
        "\n"
        "### Fixed\n"
        "\n"
        "### Security\n"
        "\n"
    )

    versioned_header = f"## [{args.version}] - {args.date}\n\n"

    new_text = (
        text[: match.start()]
        + fresh_unreleased
        + versioned_header
        + new_versioned_body
        + text[match.end():]
    )

    args.changelog.write_text(new_text, encoding="utf-8")
    print(f"promoted [Unreleased] -> [{args.version}] in {args.changelog}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
