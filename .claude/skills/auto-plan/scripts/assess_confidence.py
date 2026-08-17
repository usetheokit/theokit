#!/usr/bin/env python3
"""Confidence assessment heuristic for /auto-plan orchestrator.

Deterministic (no LLM). Scans repo state for signals that the requested topic
has enough prior art for plan-only mode vs needs full discover.

Signals + weights:
  - References match (knowledge-base/references/{project}/ matches keyword)              +30 each match (cap +30)
  - Tools match (knowledge-base/tools/{tool}/ matches keyword OR alias)                  +25 each match (cap +25)
  - Patterns skill (skills/*-patterns/ description contains keyword)                     +25 each match (cap +25)
  - ADR match (knowledge-base/adrs/ title contains keyword)                              +20 cumulative (cap +20)
  - ROADMAP.md mention (slug verbatim +20; ≥2 keywords +10)                              +20 OR +10
  - CLAUDE.md roadmap mention (slug or keywords appear)                                  +10
  - Completed plan match (knowledge-base/plans/completed/ name contains keyword)         +10 each (cap +20)
  - User context length (passed via --context-length flag)                               +5 (>200 chars) OR +10 (>1000)
  - Baseline                                                                             +10 (always)

Categories explained:
  - references/ = projects SIMILAR to ours, kept as architectural inspiration — "how did they solve it?"
  - tools/      = tools we DEPEND ON at runtime/test (read-only study material) — "how to use it?"

The TOOL_ALIASES map below is INTENTIONALLY EMPTY. Each project may populate
it with its own short→canonical mappings (e.g., {"k8s": "kubernetes",
"pg": "postgresql"}). Without aliases the script still works — it just won't
recognize abbreviations as keyword hits against tool directory names.

Final score is sum, capped at 100.

Verdict bands:
  >= 95   : HIGH      — recommend "none" (skip discover)
  70-94   : MED-HIGH  — recommend "light" (2-3 questions)
  30-69   : MED-LOW   — recommend "full" (5-10 questions); warn cap likely SHIPPABLE_WITH_CAVEATS
  < 30    : LOW       — REFUSE unless --force-override; suggest context+manual discover

Usage:
  python3 assess_confidence.py <topic-slug> [--context-length=N] [--json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


def tokenize_slug(slug: str) -> list[str]:
    """Split kebab-case slug into keyword tokens, filtering stopwords."""
    raw = re.split(r"[-_.]", slug.lower())
    stopwords = {
        "v0", "v1", "v2", "v3", "v4", "v5",
        "the", "and", "for", "of", "in", "on", "with",
        "a", "b", "c", "0", "1", "2",
    }
    return [t for t in raw if t and t not in stopwords and len(t) > 1]


# Tool aliases — populated per-project. Keys are short/colloquial names that may
# appear in slugs; values are the canonical directory names under
# knowledge-base/tools/. Leave empty by default.
TOOL_ALIASES: dict[str, str] = {}


def score_references(repo: Path, keywords: list[str]) -> tuple[int, list[str]]:
    """+30 if any reference project matches a keyword."""
    refs_dir = repo / "knowledge-base" / "references"
    if not refs_dir.is_dir():
        return 0, []
    signals = []
    for child in refs_dir.iterdir():
        if not child.is_dir() or child.name.startswith("."):
            continue
        for kw in keywords:
            if kw in child.name.lower():
                signals.append(f"references/{child.name}/")
                break
    return (30 if signals else 0), signals


def score_tools(repo: Path, keywords: list[str]) -> tuple[int, list[str]]:
    """+25 if any tool/{name} matches a keyword or its alias."""
    tools_dir = repo / "knowledge-base" / "tools"
    if not tools_dir.is_dir():
        return 0, []
    signals = []
    for child in tools_dir.iterdir():
        if not child.is_dir() or child.name.startswith("."):
            continue
        for kw in keywords:
            # Direct match (keyword in dir name)
            if kw in child.name.lower():
                signals.append(f"tools/{child.name}/")
                break
            # Alias match (keyword maps to a canonical tool name that matches dir)
            alias = TOOL_ALIASES.get(kw)
            if alias and alias in child.name.lower():
                signals.append(f"tools/{child.name}/ (via alias '{kw}'→'{alias}')")
                break
    return (25 if signals else 0), signals


def score_roadmap_md(repo: Path, keywords: list[str], slug: str) -> tuple[int, list[str]]:
    """+20 if slug appears verbatim in ROADMAP.md; +10 if ≥2 keywords hit."""
    roadmap = repo / "ROADMAP.md"
    if not roadmap.is_file():
        return 0, []
    text = roadmap.read_text(errors="ignore").lower()
    if slug.lower() in text:
        return 20, [f"slug '{slug}' in ROADMAP.md"]
    hits = [kw for kw in keywords if kw in text]
    if len(hits) >= 2:
        return 10, [f"keywords {hits} in ROADMAP.md"]
    return 0, []


def score_patterns_skills(repo: Path, keywords: list[str]) -> tuple[int, list[str]]:
    """+25 if any *-patterns skill description matches a keyword."""
    skills_dir = repo / "skills"
    if not skills_dir.is_dir():
        return 0, []
    signals = []
    for skill_dir in skills_dir.glob("*-patterns"):
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.is_file():
            continue
        text = skill_md.read_text(errors="ignore").lower()
        # Read frontmatter `description:` line only
        match = re.search(r"^description:\s*(.+?)$", text, re.MULTILINE)
        if not match:
            continue
        desc = match.group(1)
        for kw in keywords:
            if kw in desc:
                signals.append(f"{skill_dir.name}")
                break
    return (25 if signals else 0), signals


def score_adrs(repo: Path, keywords: list[str]) -> tuple[int, list[str]]:
    """+20 if any ADR title/filename matches a keyword."""
    adrs_dir = repo / "knowledge-base" / "adrs"
    if not adrs_dir.is_dir():
        return 0, []
    signals = []
    for adr in adrs_dir.glob("ADR-*.md"):
        name = adr.name.lower()
        for kw in keywords:
            if kw in name:
                signals.append(adr.name)
                break
    return (20 if signals else 0), signals


def score_claude_md(repo: Path, keywords: list[str], slug: str) -> tuple[int, list[str]]:
    """+10 if slug or keywords appear in CLAUDE.md roadmap."""
    claude_md = repo / "CLAUDE.md"
    if not claude_md.is_file():
        return 0, []
    text = claude_md.read_text(errors="ignore").lower()
    # Look in roadmap section specifically
    roadmap_start = text.find("## roadmap")
    if roadmap_start < 0:
        roadmap_start = text.find("# roadmap")
    roadmap_text = text[roadmap_start:] if roadmap_start >= 0 else text
    if slug.lower() in roadmap_text:
        return 10, [f"slug '{slug}' in roadmap"]
    hits = [kw for kw in keywords if kw in roadmap_text]
    if hits:
        return 10, [f"keywords {hits} in roadmap"]
    return 0, []


def score_completed_plans(repo: Path, keywords: list[str]) -> tuple[int, list[str]]:
    """+10 each completed plan matching a keyword (cap +20)."""
    plans_dir = repo / "knowledge-base" / "plans" / "completed"
    if not plans_dir.is_dir():
        return 0, []
    signals = []
    for plan in plans_dir.glob("*-plan.md"):
        name = plan.name.lower()
        for kw in keywords:
            if kw in name:
                signals.append(plan.name)
                break
    score = min(len(signals) * 10, 20)
    return score, signals


def score_user_context(context_length: int) -> tuple[int, list[str]]:
    """+5 if context > 200 chars; +10 if > 1000."""
    if context_length > 1000:
        return 10, [f"user context: {context_length} chars (rich)"]
    if context_length > 200:
        return 5, [f"user context: {context_length} chars (moderate)"]
    return 0, []


def verdict_from_score(score: int) -> tuple[str, str, str]:
    """Map score -> (verdict, recommended_depth, reasoning)."""
    if score >= 95:
        return ("HIGH", "none", "Sufficient prior art; skip discover.")
    if score >= 70:
        return ("MED-HIGH", "light", "Some prior art; 2-3 focused research questions recommended.")
    if score >= 30:
        return ("MED-LOW", "full", "Limited prior art; full discover (5-10 questions) recommended. Cap likely SHIPPABLE_WITH_CAVEATS without it.")
    return ("LOW", "full", "Insufficient signals. REFUSE without --force-override.")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("slug", help="Topic slug (kebab-case)")
    ap.add_argument("--context-length", type=int, default=0,
                    help="Length of user-provided context (passed by orchestrator)")
    ap.add_argument("--extra-keywords", default="",
                    help="Comma-separated extra keywords from user context "
                         "(e.g., tech stack inferred from ROADMAP.md row)")
    ap.add_argument("--json", action="store_true", help="Output structured JSON")
    ap.add_argument("--repo", default=".", help="Repo root (default: cwd)")
    args = ap.parse_args()

    repo = Path(args.repo).resolve()
    base_keywords = tokenize_slug(args.slug)
    extra = [k.strip().lower() for k in args.extra_keywords.split(",") if k.strip()]
    # Combined keyword list (de-duped, order preserved)
    seen = set()
    keywords = []
    for k in base_keywords + extra:
        if k not in seen:
            seen.add(k)
            keywords.append(k)

    baseline = 10
    ref_score, ref_sigs = score_references(repo, keywords)
    tools_score, tools_sigs = score_tools(repo, keywords)
    pat_score, pat_sigs = score_patterns_skills(repo, keywords)
    adr_score, adr_sigs = score_adrs(repo, keywords)
    rm_score, rm_sigs = score_roadmap_md(repo, keywords, args.slug)
    cm_score, cm_sigs = score_claude_md(repo, keywords, args.slug)
    cp_score, cp_sigs = score_completed_plans(repo, keywords)
    uc_score, uc_sigs = score_user_context(args.context_length)

    total = min(
        baseline + ref_score + tools_score + pat_score + adr_score
        + rm_score + cm_score + cp_score + uc_score,
        100,
    )
    verdict, depth, reasoning = verdict_from_score(total)

    report = {
        "slug": args.slug,
        "keywords_extracted": keywords,
        "score": total,
        "verdict": verdict,
        "recommended_depth": depth,
        "reasoning": reasoning,
        "signals": {
            "baseline": baseline,
            "references": {"score": ref_score, "matches": ref_sigs},
            "tools": {"score": tools_score, "matches": tools_sigs},
            "patterns_skills": {"score": pat_score, "matches": pat_sigs},
            "adrs": {"score": adr_score, "matches": adr_sigs},
            "roadmap_md": {"score": rm_score, "matches": rm_sigs},
            "claude_md_roadmap": {"score": cm_score, "matches": cm_sigs},
            "completed_plans": {"score": cp_score, "matches": cp_sigs},
            "user_context": {"score": uc_score, "matches": uc_sigs},
        },
    }

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"Topic: {args.slug}")
        print(f"Keywords: {keywords}")
        print()
        print(f"Score: {total}/100  -> {verdict} ({depth} discover recommended)")
        print(f"Reasoning: {reasoning}")
        print()
        print("Signals:")
        print(f"  baseline                  +{baseline}")
        for name, key in [
            ("references               ", "references"),
            ("tools                    ", "tools"),
            ("patterns skills          ", "patterns_skills"),
            ("ADRs                     ", "adrs"),
            ("ROADMAP.md               ", "roadmap_md"),
            ("CLAUDE.md roadmap        ", "claude_md_roadmap"),
            ("completed plans          ", "completed_plans"),
            ("user context             ", "user_context"),
        ]:
            sig = report["signals"][key]
            sign = "+" if sig["score"] else " "
            print(f"  {name} {sign}{sig['score']}  {sig['matches']}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
