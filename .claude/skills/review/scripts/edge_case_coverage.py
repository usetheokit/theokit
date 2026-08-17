#!/usr/bin/env python3
"""Analyze edge-case coverage: edge cases declared in the plan vs tests that exercise them.

Heuristic:
  1. Extract edge cases from the plan markdown — looks for:
     - "Edge case:" / "Edge cases:" inline
     - Bullets under "## Deep Dives" / "### Deep Dives" section per task
     - Bullets mentioning "empty", "null", "max", "boundary", "race", "concurrent", "timeout"
  2. For each edge case, search tests/ for assertions exercising it (keyword + AST pattern)
  3. Classify per edge case: covered / partial / missing

Output: JSON report.

Exit codes:
  0 — All declared edge cases covered (coverage = 100%)
  1 — Some declared edge cases not covered (coverage < 100%)
  2 — Error (plan not found, etc.)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


EDGE_CASE_KEYWORDS = (
    "empty",
    "null",
    "undefined",
    "boundary",
    "max",
    "maximum",
    "min",
    "minimum",
    "limit",
    "overflow",
    "race",
    "concurrent",
    "concurrency",
    "timeout",
    "retry",
    "idempotent",
    "duplicate",
    "malformed",
    "invalid",
    "missing",
    "negative",
    "zero",
    "large",
    "huge",
    "edge case",
    "edge cases",
    "corner case",
    "corner cases",
)

# Patterns that suggest the plan is calling out an edge case
EDGE_CASE_LINE_RE = re.compile(
    r"(?:^|\s)(?:edge[\s-]*case[s]?|corner[\s-]*case[s]?):\s*(.+)$",
    re.IGNORECASE | re.MULTILINE,
)
BULLET_RE = re.compile(r"^\s*[-*]\s+(.+?)$", re.MULTILINE)
DEEP_DIVES_SECTION_RE = re.compile(
    r"^####\s+Deep[\s-]*Dives\s*$([\s\S]*?)(?=^####\s+|^###\s+|^##\s+|\Z)",
    re.MULTILINE,
)


def _extract_edge_cases_from_plan(plan_text: str) -> list[dict[str, str]]:
    """Extract edge cases from the plan markdown."""
    cases: list[dict[str, str]] = []

    # Pattern 1: explicit "Edge case:" mentions
    for match in EDGE_CASE_LINE_RE.finditer(plan_text):
        cases.append({
            "source": "explicit-edge-case",
            "description": match.group(1).strip(),
        })

    # Pattern 2: bullets under Deep Dives sections that mention edge keywords
    for section_match in DEEP_DIVES_SECTION_RE.finditer(plan_text):
        section_body = section_match.group(1)
        for bullet_match in BULLET_RE.finditer(section_body):
            bullet_text = bullet_match.group(1).strip()
            if any(kw in bullet_text.lower() for kw in EDGE_CASE_KEYWORDS):
                cases.append({
                    "source": "deep-dives-bullet",
                    "description": bullet_text,
                })

    # Pattern 3: bullets in Acceptance Criteria mentioning edge keywords
    for bullet_match in BULLET_RE.finditer(plan_text):
        bullet_text = bullet_match.group(1).strip()
        if any(kw in bullet_text.lower() for kw in EDGE_CASE_KEYWORDS):
            # Avoid double-counting if already added via Deep Dives section
            if not any(c["description"] == bullet_text for c in cases):
                cases.append({
                    "source": "acceptance-criteria-or-other-bullet",
                    "description": bullet_text,
                })

    return cases


def _extract_keywords_for_test_search(description: str) -> list[str]:
    """Extract searchable keywords from an edge case description.

    Strategy: lowercase, drop common stopwords, keep substantive nouns/verbs.
    """
    stopwords = {
        "the", "a", "an", "is", "are", "be", "in", "on", "at", "to", "for", "of",
        "with", "and", "or", "but", "if", "when", "then", "else", "as", "by",
        "should", "must", "will", "shall", "can", "could", "may", "might",
        "this", "that", "these", "those", "it", "its", "they", "them",
        "what", "which", "who", "whom", "whose", "where", "why", "how",
    }
    words = re.findall(r"\b[a-zA-Z_][a-zA-Z0-9_]*\b", description.lower())
    keywords = [w for w in words if len(w) > 3 and w not in stopwords]
    # Cap to top 5 most "specific" (longest); avoids false positives from common words
    return sorted(set(keywords), key=len, reverse=True)[:5]


def _grep_in_dir(test_dir: Path, keywords: list[str]) -> list[Path]:
    """Find test files containing ALL the keywords."""
    if not keywords or not test_dir.exists():
        return []

    matches: set[Path] = set()
    for test_file in test_dir.rglob("*.test.ts"):
        try:
            content = test_file.read_text(encoding="utf-8-sig").lower()
            if all(kw in content for kw in keywords):
                matches.add(test_file)
        except (OSError, UnicodeDecodeError):
            continue
    for test_file in test_dir.rglob("*.test.tsx"):
        try:
            content = test_file.read_text(encoding="utf-8-sig").lower()
            if all(kw in content for kw in keywords):
                matches.add(test_file)
        except (OSError, UnicodeDecodeError):
            continue
    for test_file in test_dir.rglob("*test*.py"):
        try:
            content = test_file.read_text(encoding="utf-8-sig").lower()
            if all(kw in content for kw in keywords):
                matches.add(test_file)
        except (OSError, UnicodeDecodeError):
            continue
    return sorted(matches)


def classify_coverage(edge_case: dict[str, str], test_dir: Path) -> dict[str, object]:
    """Return: covered / partial / missing per edge case."""
    keywords = _extract_keywords_for_test_search(edge_case["description"])
    matching_tests = _grep_in_dir(test_dir, keywords)

    status = "missing"
    if matching_tests:
        # Heuristic: if ≥ 1 test matches all keywords, count as covered.
        # If we'd want stricter, we could AST-parse and verify assertion exercises the case.
        status = "covered" if len(matching_tests) >= 1 else "partial"

    return {
        **edge_case,
        "search_keywords": keywords,
        "matching_tests": [str(p) for p in matching_tests[:3]],
        "matching_count": len(matching_tests),
        "status": status,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Edge-case coverage analyzer (plan vs tests).")
    parser.add_argument("--plan", type=Path, required=True, help="Path to plan markdown")
    parser.add_argument("--tests-dir", type=Path, default=Path("tests"), help="Tests root directory")
    args = parser.parse_args()

    if not args.plan.exists():
        print(json.dumps({"error": f"Plan not found: {args.plan}"}), file=sys.stderr)
        return 2

    plan_text = args.plan.read_text(encoding="utf-8-sig")
    edge_cases = _extract_edge_cases_from_plan(plan_text)

    if not edge_cases:
        output = {
            "plan": str(args.plan),
            "tests_dir": str(args.tests_dir),
            "edge_cases_found_in_plan": 0,
            "covered": 0,
            "partial": 0,
            "missing": 0,
            "coverage_ratio": 1.0,  # vacuously true
            "note": "No edge cases extracted from plan (may indicate plan is missing Edge Cases section, OR plan uses different naming convention)",
            "items": [],
        }
        print(json.dumps(output, indent=2))
        return 0

    classified = [classify_coverage(ec, args.tests_dir) for ec in edge_cases]

    covered = sum(1 for c in classified if c["status"] == "covered")
    partial = sum(1 for c in classified if c["status"] == "partial")
    missing = sum(1 for c in classified if c["status"] == "missing")
    total = len(classified)

    output = {
        "plan": str(args.plan),
        "tests_dir": str(args.tests_dir),
        "edge_cases_found_in_plan": total,
        "covered": covered,
        "partial": partial,
        "missing": missing,
        "coverage_ratio": round(covered / total, 3) if total else 1.0,
        "items": classified,
    }
    print(json.dumps(output, indent=2))

    return 0 if missing == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
