#!/usr/bin/env python3
"""Apply deterministic discover-improve fixes to a blueprint.

Idempotent. Same input always produces same output. Cost: $0.

Fixes applied (in order):
  1. Weak imperatives in prose: should/could/may/might → must/can
  2. Loopholes stripped: "if possible", "as appropriate", "when applicable", "where feasible"
  3. Fabricated citations: paths in `.claude/knowledge-base/references/{...}` that don't exist on disk are
     marked with `<!-- BLOCKED: path not found in .claude/knowledge-base/references/ -->`

Code blocks (```...```) are skipped — fixes only apply to prose.
"""
from __future__ import annotations

import argparse
import json as _json
import re
import sys
from pathlib import Path
from typing import Any


CITATION_RE = re.compile(r".claude/knowledge-base/references/[A-Za-z0-9_\-./]+")
LINE_SUFFIX_RE = re.compile(r":\d+(:\d+)?$")
WEAK_IMPERATIVES_RE = re.compile(
    r"\b(should|could|may|might)\b",
    re.IGNORECASE | re.UNICODE,
)
LOOPHOLES_RE = re.compile(
    r"\b(if possible|as appropriate|when applicable|where feasible)\b",
    re.IGNORECASE | re.UNICODE,
)
FENCED_CODE_RE = re.compile(r"^```[^\n]*\n.*?^```", re.MULTILINE | re.DOTALL)
BLOCKED_MARKER_RE = re.compile(r"<!--\s*BLOCKED:.*?-->", re.IGNORECASE | re.DOTALL)


REPLACEMENT_MAP = {
    "should": "must",
    "could": "can",
    "may": "must",
    "might": "must",
}


def _find_project_root(start: Path) -> Path:
    current = start.resolve().parent if start.is_file() else start.resolve()
    while current != current.parent:
        if (current / ".claude").exists() or (current / ".git").exists():
            return current
        current = current.parent
    return start.resolve().parent if start.is_file() else start.resolve()


def _split_code_and_prose(content: str) -> list[tuple[bool, str]]:
    """Split content into alternating (is_code, chunk) tuples."""
    chunks: list[tuple[bool, str]] = []
    last = 0
    for match in FENCED_CODE_RE.finditer(content):
        if match.start() > last:
            chunks.append((False, content[last : match.start()]))
        chunks.append((True, match.group(0)))
        last = match.end()
    if last < len(content):
        chunks.append((False, content[last:]))
    return chunks


def _fix_weak_imperatives(prose: str) -> tuple[str, int]:
    counter = 0

    def replacer(m: re.Match[str]) -> str:
        nonlocal counter
        word = m.group(0)
        repl = REPLACEMENT_MAP.get(word.lower())
        if repl is None:
            return word
        counter += 1
        return repl

    fixed = WEAK_IMPERATIVES_RE.sub(replacer, prose)
    # Clean trailing/double spaces left when a weak word was replaced with ""
    fixed = re.sub(r"  +", " ", fixed)
    return fixed, counter


def _fix_loopholes(prose: str) -> tuple[str, int]:
    counter = 0

    def replacer(_m: re.Match[str]) -> str:
        nonlocal counter
        counter += 1
        return ""

    fixed = LOOPHOLES_RE.sub(replacer, prose)
    # Clean double spaces left by removed phrases
    fixed = re.sub(r"  +", " ", fixed)
    # Clean ", ," patterns left when removed from lists
    fixed = re.sub(r",\s*,", ",", fixed)
    return fixed, counter


def _mark_fabricated_citations(content: str, blueprint_path: Path) -> tuple[str, int]:
    project_root = _find_project_root(blueprint_path)
    counter = 0

    # Build a per-path existence cache
    seen: dict[str, bool] = {}

    def is_real(cit: str) -> bool:
        if cit in seen:
            return seen[cit]
        path_only = LINE_SUFFIX_RE.sub("", cit)
        exists = (project_root / path_only).exists()
        seen[cit] = exists
        return exists

    # Find each citation NOT already followed by a BLOCKED marker, and mark it.
    out_parts: list[str] = []
    last = 0
    for match in CITATION_RE.finditer(content):
        # Append text before the match
        out_parts.append(content[last : match.start()])
        cit = match.group(0)
        # Check if a BLOCKED marker already follows this citation within ~80 chars
        following = content[match.end() : match.end() + 80]
        already_blocked = bool(BLOCKED_MARKER_RE.search(following))

        if not already_blocked and not is_real(cit):
            out_parts.append(f"{cit} <!-- BLOCKED: path not found in .claude/knowledge-base/references/ -->")
            counter += 1
        else:
            out_parts.append(cit)
        last = match.end()
    out_parts.append(content[last:])
    return "".join(out_parts), counter


def apply_fixes(blueprint_path: Path, dry_run: bool = False) -> dict[str, Any]:
    original = blueprint_path.read_text(encoding="utf-8-sig")
    chunks = _split_code_and_prose(original)

    weak_count = 0
    loop_count = 0
    new_chunks: list[str] = []

    for is_code, chunk in chunks:
        if is_code:
            new_chunks.append(chunk)
            continue
        fixed, wc = _fix_weak_imperatives(chunk)
        fixed, lc = _fix_loopholes(fixed)
        new_chunks.append(fixed)
        weak_count += wc
        loop_count += lc

    new_content = "".join(new_chunks)
    new_content, fab_count = _mark_fabricated_citations(new_content, blueprint_path)

    changed = new_content != original
    if not dry_run and changed:
        blueprint_path.write_text(new_content, encoding="utf-8")

    return {
        "blueprint": str(blueprint_path),
        "weak_imperatives_fixed": weak_count,
        "loopholes_stripped": loop_count,
        "fabricated_citations_marked": fab_count,
        "changed": changed,
        "dry_run": dry_run,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply deterministic discover-improve fixes.")
    parser.add_argument("blueprint", type=Path, help="path to blueprint .md")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    if not args.blueprint.exists():
        print(f"Blueprint not found: {args.blueprint}", file=sys.stderr)
        return 2

    result = apply_fixes(args.blueprint, dry_run=args.dry_run)

    if args.json:
        print(_json.dumps(result, indent=2))
    else:
        print(f"Blueprint: {result['blueprint']}")
        print(f"Weak imperatives fixed: {result['weak_imperatives_fixed']}")
        print(f"Loopholes stripped: {result['loopholes_stripped']}")
        print(f"Fabricated citations marked: {result['fabricated_citations_marked']}")
        print(f"Changed: {result['changed']}")
        if result["dry_run"]:
            print("(dry-run: no changes written)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
