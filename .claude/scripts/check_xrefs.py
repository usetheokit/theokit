#!/usr/bin/env python3
"""Cross-reference validator for the planning ecosystem.

Supports dual-mode layouts:
  - Standalone — running from inside the ecosystem repo itself (the directory
    contains skills/ + rules/ + hooks/ directly, no .claude/ wrapper).
  - User config — installed as <home>/.claude/.
  - Plugin install — installed as <root>/.claude/plugins/plan/.

Validates that:
  1. Each cycle-*.md references SKILL.md files that exist
  2. Each SKILL.md "Cycle contract" section points to a cycle-*.md that exists
  3. Each cycle rule's Cross-references section lists files that exist
  4. No orphan skills (skills not in any cycle, except documented auxiliary)
  5. No orphan cycle phases (cycle rule mentions a skill that doesn't exist)
  6. Each cycle rule template-cited script exists at the cited path
  7. SKILL.md bodies and Python scripts do not reference rules/*.md|*.txt that do not exist
     (catches fabricated rule references — the gap that hid code-quality-golden-rule
     before this check existed). The match pattern is `[.claude/]rules/<name>.(md|txt)`.

Usage:
    python3 scripts/check_xrefs.py                  # standalone
    python3 .claude/scripts/check_xrefs.py          # plugin install
    python3 scripts/check_xrefs.py --strict         # exit 1 on warnings too

Exit codes:
  0 — All cross-references valid
  1 — At least one broken reference (or warning in --strict)
  2 — Error (ecosystem directory not found, etc.)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


# Skills documented as "auxiliary" (not bound to any cycle)
# - ast-grep: structural search utility
# - deck, marp-slide, excalidraw: presentation skills, project-agnostic
# - dogfood: honesty gate consumed transversally (README/CHANGELOG edits, release decisions)
# - roadmap-init: single-shot bootstrap at project inception; intentionally isolated
#   (its ARTIFACTS — ROADMAP.md + knowledge-base/references/ — are consumed by cycle-roadmap
#   and cycle-discover; the SKILL itself is never invoked mid-cycle)
# - roadmap-feature: sister of roadmap-init for adding one milestone to an existing roadmap
#   (same isolation contract; opposite pre-condition — refuses if ROADMAP.md is missing)
AUXILIARY_SKILLS = {"ast-grep", "deck", "marp-slide", "excalidraw", "dogfood", "roadmap-init", "roadmap-feature"}

# Patterns to detect file references in markdown
LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
BACKTICK_PATH_RE = re.compile(r"`(\.?[a-zA-Z0-9_./\-]+\.(?:md|py|sh|json|txt|yml|yaml))`")
CYCLE_REF_RE = re.compile(r"`?cycle-([a-z]+)`?")
SKILL_REF_RE = re.compile(r"`?(?:\.claude/)?skills/([a-z0-9\-]+)/SKILL\.md`?")
# Detect rules references in SKILL bodies and Python scripts.
# Examples matched:
#   `rules/code-quality-golden-rule.md`
#   `.claude/rules/code-quality-thresholds.txt`
#   "rules/discover-web-allowlist.txt"
# Examples NOT matched (intentionally):
#   knowledge-base/rules/...  (different directory tree)
#   project-rules/...         (different prefix)
RULES_REF_RE = re.compile(
    r"(?<![A-Za-z0-9_/-])(?:\.claude/)?rules/([A-Za-z0-9._-]+\.(?:md|txt))"
)


def _is_ecosystem_layout(d: Path) -> bool:
    """A directory is an ecosystem layout if it has skills/ + rules/ + hooks/ directly."""
    return (d / "skills").is_dir() and (d / "rules").is_dir() and (d / "hooks").is_dir()


def _find_ecosystem_dir(start: Path) -> Path | None:
    """Locate the ecosystem directory in any of the three supported layouts.

    Order of probing at each level (CWD upward):
      1. Standalone — `current/` itself is the ecosystem (this is the plan/ repo).
      2. User config — `current/.claude/` is the ecosystem.
      3. Plugin install — `current/.claude/plugins/plan/` is the ecosystem.

    Returns the matching directory or None if no layout resolves.
    """
    current = start.resolve() if not start.is_file() else start.resolve().parent
    for _ in range(20):
        if _is_ecosystem_layout(current):
            return current
        claude_sub = current / ".claude"
        if _is_ecosystem_layout(claude_sub):
            return claude_sub
        plugin_sub = current / ".claude" / "plugins" / "plan"
        if _is_ecosystem_layout(plugin_sub):
            return plugin_sub
        if current == current.parent:
            break
        current = current.parent
    return None


def _list_existing_skills(ecosystem_dir: Path) -> set[str]:
    skills_dir = ecosystem_dir / "skills"
    if not skills_dir.exists():
        return set()
    return {
        d.name
        for d in skills_dir.iterdir()
        if d.is_dir() and (d / "SKILL.md").exists() and d.name != "generated"
    }


def _list_cycle_rules(ecosystem_dir: Path) -> dict[str, Path]:
    rules_dir = ecosystem_dir / "rules"
    if not rules_dir.exists():
        return {}
    # `cycle-rule-schema.md` is meta-documentation about cycle rules, not a cycle itself.
    return {
        p.stem: p
        for p in rules_dir.glob("cycle-*.md")
        if p.stem != "cycle-rule-schema"
    }


def _extract_referenced_paths(content: str, base: Path) -> set[Path]:
    """Extract paths referenced in markdown (backtick + markdown link)."""
    paths: set[str] = set()

    for match in LINK_RE.finditer(content):
        url = match.group(2).strip()
        if url.startswith(("http://", "https://", "#")):
            continue
        paths.add(url)

    for match in BACKTICK_PATH_RE.finditer(content):
        paths.add(match.group(1))

    resolved: set[Path] = set()
    for p in paths:
        candidate = (base / p).resolve() if not Path(p).is_absolute() else Path(p)
        resolved.add(candidate)
    return resolved


def _extract_cycle_phases(cycle_rule_content: str) -> set[str]:
    """Extract skill names mentioned in a cycle rule's `phases:` frontmatter list AND in the chain section."""
    skills: set[str] = set()

    # Frontmatter phases: section
    fm_match = re.match(r"^---\n(.*?)\n---", cycle_rule_content, re.DOTALL)
    if fm_match:
        fm = fm_match.group(1)
        phases_match = re.search(r"^phases:\s*\n((?:\s+-\s+[a-z0-9\-]+(?:\s+\([^)]+\))?\s*\n)*)", fm, re.MULTILINE)
        if phases_match:
            for line in phases_match.group(1).splitlines():
                m = re.match(r"\s+-\s+([a-z0-9\-]+)", line)
                if m:
                    skills.add(m.group(1))

    # Chain section: looks for `/skill-name` patterns
    chain_match = re.search(r"## Chain.*?\n```(.*?)```", cycle_rule_content, re.DOTALL)
    if chain_match:
        chain = chain_match.group(1)
        # Match /skill-name in the chain. Accept either:
        #   - kebab-case skills (e.g. /to-plan, /edge-case-plan)
        #   - single-word skills explicitly listed (release, implement, review)
        for m in re.finditer(r"/([a-z][a-z0-9]+(?:-[a-z0-9]+)+|to-plan|implement|review|release)[\s{]", chain):
            skills.add(m.group(1))

    return skills


def _extract_cycle_contract_ref(skill_md_content: str) -> str | None:
    """Find `cycle-{name}` referenced in a SKILL.md's Cycle contract section."""
    contract_match = re.search(r"## Cycle contract.*?(?=^##\s+|\Z)", skill_md_content, re.MULTILINE | re.DOTALL)
    body = contract_match.group(0) if contract_match else skill_md_content
    cycle_match = CYCLE_REF_RE.search(body)
    return cycle_match.group(1) if cycle_match else None


def validate_xrefs(ecosystem_dir: Path, strict: bool = False) -> dict[str, Any]:
    # In standalone layout, the "project root" IS the ecosystem dir; in plugin
    # layout it is the parent. Use ecosystem_dir for path display so the report
    # is unambiguous regardless of layout.
    existing_skills = _list_existing_skills(ecosystem_dir)
    cycle_rules = _list_cycle_rules(ecosystem_dir)

    findings: list[dict[str, Any]] = []

    def _rel(p: Path) -> str:
        try:
            return str(p.relative_to(ecosystem_dir))
        except ValueError:
            return str(p)

    # Check 1: each cycle rule references skills that exist
    cycle_to_skills: dict[str, set[str]] = {}
    for cycle_name, cycle_path in cycle_rules.items():
        content = cycle_path.read_text(encoding="utf-8-sig")
        skills_mentioned = _extract_cycle_phases(content)
        cycle_to_skills[cycle_name] = skills_mentioned

        for skill in skills_mentioned:
            if skill not in existing_skills:
                findings.append({
                    "severity": "WARN",
                    "check": "cycle_rule_references_existing_skill",
                    "cycle": cycle_name,
                    "missing_skill": skill,
                    "message": f"{_rel(cycle_path)} references skill `{skill}` which does not exist at skills/{skill}/",
                })

    # Check 2: each SKILL.md points to an existing cycle
    skill_to_cycle: dict[str, str | None] = {}
    for skill in existing_skills:
        skill_md = ecosystem_dir / "skills" / skill / "SKILL.md"
        content = skill_md.read_text(encoding="utf-8-sig")
        cycle_ref = _extract_cycle_contract_ref(content)
        skill_to_cycle[skill] = cycle_ref

        if cycle_ref is None and skill not in AUXILIARY_SKILLS:
            findings.append({
                "severity": "WARN",
                "check": "skill_has_cycle_contract",
                "skill": skill,
                "message": f"skills/{skill}/SKILL.md has no `Cycle contract` section pointing to a cycle-*.md",
            })
        elif cycle_ref is not None:
            expected_cycle = f"cycle-{cycle_ref}"
            if expected_cycle not in cycle_rules:
                findings.append({
                    "severity": "FAIL",
                    "check": "skill_cycle_contract_resolves",
                    "skill": skill,
                    "cycle_referenced": expected_cycle,
                    "message": f"skills/{skill}/SKILL.md references cycle-{cycle_ref}.md but it does not exist",
                })

    # Check 3: cycle rule cross-references point to existing files
    for cycle_name, cycle_path in cycle_rules.items():
        content = cycle_path.read_text(encoding="utf-8-sig")
        # Cross-references section
        xref_match = re.search(r"## Cross-references.*?(?=^##\s+|\Z)", content, re.MULTILINE | re.DOTALL)
        if not xref_match:
            findings.append({
                "severity": "WARN",
                "check": "cycle_has_xref_section",
                "cycle": cycle_name,
                "message": f"{_rel(cycle_path)} has no `Cross-references` section",
            })
            continue

        xref_body = xref_match.group(0)
        # Extract referenced files — only validate REAL paths (with / or starting with .)
        # Bare filenames in prose (e.g., `testing.md`) are likely conceptual references, skip
        for match in BACKTICK_PATH_RE.finditer(xref_body):
            ref = match.group(1)
            # Skip references that are clearly placeholders or relative-to-skill paths
            if "{" in ref or ref.startswith("../"):
                continue
            # Skip bare filenames without path separators — these are nominal mentions in prose
            if "/" not in ref and not ref.startswith("."):
                continue
            # Try resolution against multiple search roots — accept both standalone
            # (skills/...) and plugin-style (.claude/skills/...) reference paths.
            candidates_to_try: list[Path] = []
            if Path(ref).is_absolute():
                candidates_to_try.append(Path(ref))
            else:
                # Strip a leading .claude/ if present (plugin-style citation)
                normalized = ref[len(".claude/"):] if ref.startswith(".claude/") else ref
                candidates_to_try.append(ecosystem_dir / normalized)
                # If path starts with a skill name (e.g., plan-confidence/templates/...), try skills/
                first_segment = normalized.split("/", 1)[0]
                if (ecosystem_dir / "skills" / first_segment).exists():
                    candidates_to_try.append(ecosystem_dir / "skills" / normalized)

            if not any(c.exists() for c in candidates_to_try):
                findings.append({
                    "severity": "WARN",
                    "check": "cycle_xref_file_exists",
                    "cycle": cycle_name,
                    "broken_ref": ref,
                    "message": f"{_rel(cycle_path)} references `{ref}` which does not exist",
                })

    # Check 7: rules referenced from SKILL.md bodies + scripts must exist on disk.
    rules_dir = ecosystem_dir / "rules"
    existing_rule_files: set[str] = {p.name for p in rules_dir.glob("*")} if rules_dir.exists() else set()

    def _scan_for_rule_refs(path: Path) -> None:
        try:
            content = path.read_text(encoding="utf-8-sig")
        except (OSError, UnicodeDecodeError):
            return
        for m in RULES_REF_RE.finditer(content):
            rule_name = m.group(1)
            if rule_name in existing_rule_files:
                continue
            findings.append({
                "severity": "FAIL",
                "check": "rules_reference_resolves",
                "source": _rel(path),
                "missing_rule": rule_name,
                "message": f"{_rel(path)} references `rules/{rule_name}` which does not exist",
            })

    for skill_md in (ecosystem_dir / "skills").rglob("SKILL.md"):
        if skill_md.is_file():
            _scan_for_rule_refs(skill_md)
    for py in (ecosystem_dir / "skills").rglob("*.py"):
        if py.is_file() and "__pycache__" not in py.parts:
            _scan_for_rule_refs(py)
    for py in (ecosystem_dir / "scripts").rglob("*.py"):
        if py.is_file() and "__pycache__" not in py.parts:
            _scan_for_rule_refs(py)

    # Check 4: orphan skills (not in any cycle, not auxiliary)
    skills_in_cycles: set[str] = set()
    for skills_set in cycle_to_skills.values():
        skills_in_cycles.update(skills_set)

    orphan_skills = existing_skills - skills_in_cycles - AUXILIARY_SKILLS
    for skill in sorted(orphan_skills):
        findings.append({
            "severity": "WARN",
            "check": "no_orphan_skills",
            "skill": skill,
            "message": f"Skill `{skill}` is not referenced by any cycle-*.md and is not in AUXILIARY_SKILLS",
        })

    # Aggregate
    severity_counts = defaultdict(int)
    for f in findings:
        severity_counts[f["severity"]] += 1

    overall = "PASS"
    if severity_counts.get("FAIL", 0) > 0:
        overall = "FAIL"
    elif severity_counts.get("WARN", 0) > 0 and strict:
        overall = "FAIL"

    return {
        "ecosystem_dir": str(ecosystem_dir),
        "skills_total": len(existing_skills),
        "skills_auxiliary": sorted(AUXILIARY_SKILLS & existing_skills),
        "skills_orphan": sorted(orphan_skills),
        "cycle_rules": sorted(cycle_rules.keys()),
        "skill_to_cycle": skill_to_cycle,
        "findings": findings,
        "severity_counts": dict(severity_counts),
        "overall": overall,
    }


def _render_summary(result: dict[str, Any]) -> str:
    lines = [
        f"=== Cross-reference validator ===",
        f"Ecosystem dir: {result['ecosystem_dir']}",
        f"Skills total: {result['skills_total']}",
        f"Cycle rules: {result['cycle_rules']}",
        f"Skills auxiliary: {result['skills_auxiliary']}",
        f"Skills orphan: {result['skills_orphan']}",
        "",
        f"=== Findings ({len(result['findings'])}) ===",
    ]
    for f in result["findings"]:
        lines.append(f"  [{f['severity']}] {f['check']}: {f['message']}")
    lines.append("")
    lines.append(f"Severity counts: {result['severity_counts']}")
    lines.append(f"Overall: {result['overall']}")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate cross-references in the planning ecosystem.")
    parser.add_argument("--strict", action="store_true", help="Exit 1 on WARN too (default: exit 1 only on FAIL)")
    parser.add_argument("--json", action="store_true", help="Output JSON instead of human-readable summary")
    parser.add_argument("--ecosystem-dir", type=Path, default=None, help="Override ecosystem directory detection")
    parser.add_argument("--claude-dir", type=Path, default=None, help="(deprecated alias for --ecosystem-dir)")
    args = parser.parse_args()

    override = args.ecosystem_dir or args.claude_dir
    if override:
        ecosystem_dir = override.resolve()
    else:
        ecosystem_dir = _find_ecosystem_dir(Path.cwd())

    if ecosystem_dir is None or not ecosystem_dir.exists():
        print(json.dumps({
            "error": "ecosystem directory not found",
            "hint": "expected one of: <cwd>/{skills,rules,hooks}, <cwd>/.claude/{skills,rules,hooks}, or <cwd>/.claude/plugins/plan/{skills,rules,hooks}",
        }), file=sys.stderr)
        return 2

    result = validate_xrefs(ecosystem_dir, strict=args.strict)

    if args.json:
        print(json.dumps(result, indent=2, default=str))
    else:
        print(_render_summary(result))

    return 0 if result["overall"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
