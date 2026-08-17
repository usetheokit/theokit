#!/usr/bin/env python3
"""Validate a candidate skill SKILL.md produced by /skill-writer.

5 deterministic checks:
  1. Frontmatter conformance — required fields present, allowed-tools read-only
  2. Citation existence — every `.claude/knowledge-base/references/{path}` exists on disk
  3. No duplication — name does NOT collide with existing first-class skills
  4. Description trigger-phrase clarity — ≥2 "Use when..." phrases + concrete context
  5. No forbidden patterns — no Bash perms, no dangerous shell, no Write/Edit perms

Output: JSON with per-check results + overall verdict (PASS / NEEDS_REVIEW / REJECT).

Exit codes:
  0 — PASS
  1 — REJECT (any FAIL)
  2 — Error (file not found, malformed)
  3 — NEEDS_REVIEW (any WARN, no FAIL)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

import yaml


REQUIRED_FRONTMATTER = (
    "name",
    "description",
    "user-invocable",
    "allowed-tools",
    "generated-from-blueprint",
    "generated-at",
)

# Tools allowed in generated knowledge skills.
# Knowledge skills are read-only Markdown distillations of blueprint findings.
# Anything that writes, executes shell, fetches remote content, or spawns sub-agents
# is forbidden: it expands the trust surface for an artifact that should be inert.
ALLOWED_TOOLS_BASE = frozenset({"Read", "Glob", "Grep"})
# Tools explicitly rejected even though Claude Code accepts them in arbitrary skills.
FORBIDDEN_TOOLS = frozenset({
    "Write", "Edit", "NotebookEdit",
    "WebFetch", "WebSearch",
    "Agent", "Skill",
})

# Bash patterns explicitly forbidden in generated skills (defense in depth — validator)
FORBIDDEN_BASH_TOKENS = ("rm ", "curl ", "wget ", "sudo ", "kubectl ", "docker ", "npm install", "pip install")

CITATION_RE = re.compile(r".claude/knowledge-base/references/[A-Za-z0-9_\-./]+")
LINE_SUFFIX_RE = re.compile(r":\d+(:\d+)?$")
USE_WHEN_RE = re.compile(
    r"\b[Uu]se when\b|\b[Cc]onsult when\b|,\s*when\s+\w+|;\s*when\s+\w+|\bor\s+when\s+\w+"
)
CONCRETE_CONTEXT_RE = re.compile(r"(src/|\.claude/|.claude/knowledge-base/references/|/to-plan|/discover|architecture\.md|testing\.md|public-copy\.md)")
FENCED_BASH_RE = re.compile(r"^```(?:bash|sh)\s*\n(.*?)^```", re.MULTILINE | re.DOTALL)


def _find_project_root(start: Path) -> Path:
    current = start.resolve()
    if current.is_file():
        current = current.parent
    for _ in range(20):
        if (current / ".claude").exists() or (current / ".git").exists():
            return current
        if current == current.parent:
            break
        current = current.parent
    return start.resolve().parent if start.is_file() else start.resolve()


def _parse_frontmatter(content: str) -> tuple[dict[str, Any] | None, str | None]:
    """Returns (parsed_frontmatter, error_reason). One is always None."""
    if not content.startswith("---\n") and not content.startswith("---\r\n"):
        return None, "Missing opening frontmatter delimiter (---)"
    # Find closing ---
    rest = content[4:] if content.startswith("---\n") else content[5:]
    end = rest.find("\n---\n")
    if end == -1:
        end = rest.find("\r\n---\r\n")
        if end == -1:
            return None, "Missing closing frontmatter delimiter (---)"
    fm_text = rest[:end]
    try:
        parsed = yaml.safe_load(fm_text)
        if not isinstance(parsed, dict):
            return None, "Frontmatter is not a mapping"
        return parsed, None
    except yaml.YAMLError as exc:
        return None, f"YAML parse error: {exc}"


def _normalize_allowed_tools(field: Any) -> list[str]:
    """Allowed-tools may be a space-separated string OR a list."""
    if isinstance(field, str):
        return field.split()
    if isinstance(field, list):
        return [str(t) for t in field]
    return []


def check_frontmatter(content: str) -> dict[str, Any]:
    fm, err = _parse_frontmatter(content)
    if fm is None:
        return {"status": "FAIL", "reason": err or "Frontmatter malformed"}

    missing = [f for f in REQUIRED_FRONTMATTER if f not in fm]
    if missing:
        return {"status": "FAIL", "reason": f"Missing required fields: {missing}"}

    tools = _normalize_allowed_tools(fm.get("allowed-tools", ""))
    forbidden: list[str] = []
    for t in tools:
        t_stripped = t.strip()
        if t_stripped in FORBIDDEN_TOOLS:
            forbidden.append(t_stripped)
        elif t_stripped.startswith("Bash"):
            # Generated skills should not use Bash at all
            forbidden.append(t_stripped)
        elif t_stripped and t_stripped not in ALLOWED_TOOLS_BASE:
            # Unknown tool — treat as forbidden by default (allowlist, not denylist)
            forbidden.append(t_stripped)
    if forbidden:
        return {
            "status": "FAIL",
            "reason": f"Forbidden tools in generated skill: {forbidden}. Allowed: {sorted(ALLOWED_TOOLS_BASE)}",
        }

    return {"status": "PASS"}


def check_citations(content: str, project_root: Path) -> dict[str, Any]:
    citations_seen = sorted(set(CITATION_RE.findall(content)))
    if not citations_seen:
        return {"status": "PASS", "verified": 0, "fabricated": 0, "note": "No .claude/knowledge-base/references/ citations to verify"}

    verified: list[str] = []
    fabricated: list[str] = []
    for cit in citations_seen:
        path_only = LINE_SUFFIX_RE.sub("", cit)
        if (project_root / path_only).exists():
            verified.append(cit)
        else:
            fabricated.append(cit)

    if fabricated:
        return {
            "status": "FAIL",
            "reason": f"{len(fabricated)} fabricated citation(s) — first 5: {fabricated[:5]}",
            "verified": len(verified),
            "fabricated": len(fabricated),
        }
    return {"status": "PASS", "verified": len(verified), "fabricated": 0}


def check_no_duplication(name: str, project_root: Path) -> dict[str, Any]:
    skills_dir = project_root / ".claude" / "skills"
    if not skills_dir.exists():
        return {"status": "PASS", "note": "No .claude/skills/ dir exists yet"}

    collisions: list[str] = []
    for entry in skills_dir.iterdir():
        if not entry.is_dir():
            continue
        # Skip the candidate itself (which is under generated/)
        if entry.name == "generated":
            continue
        if entry.name == name:
            collisions.append(str(entry))

    if collisions:
        return {"status": "FAIL", "reason": f"Name collision with existing skill(s): {collisions}"}
    return {"status": "PASS"}


def check_description_clarity(content: str) -> dict[str, Any]:
    fm, _ = _parse_frontmatter(content)
    if fm is None:
        return {"status": "FAIL", "reason": "Cannot check description — frontmatter unparseable"}
    desc = fm.get("description", "") or ""
    if not isinstance(desc, str):
        desc = str(desc)

    use_when_count = len(USE_WHEN_RE.findall(desc))
    has_concrete = bool(CONCRETE_CONTEXT_RE.search(desc))

    warnings: list[str] = []
    if use_when_count < 2:
        warnings.append(
            f"Description has only {use_when_count} 'Use when...'/'Consult when...' trigger phrase(s); need ≥2"
        )
    if not has_concrete:
        warnings.append(
            "Description lacks concrete context (no path / domain term / project rule reference)"
        )

    if warnings:
        return {"status": "WARN", "reason": "; ".join(warnings), "use_when_count": use_when_count, "has_concrete_context": has_concrete}
    return {"status": "PASS", "use_when_count": use_when_count, "has_concrete_context": has_concrete}


def check_no_forbidden_patterns(content: str) -> dict[str, Any]:
    issues: list[str] = []

    # 1. Bash() permissions in frontmatter or body
    if re.search(r"^\s*allowed-tools:.*Bash\(", content, re.MULTILINE):
        issues.append("Bash() permission declared (forbidden in generated skills)")

    # 2. Dangerous shell tokens in fenced code blocks
    for match in FENCED_BASH_RE.finditer(content):
        body = match.group(1)
        for tok in FORBIDDEN_BASH_TOKENS:
            if tok in body:
                issues.append(f"Dangerous shell token in fenced code: '{tok.strip()}'")
                break

    # 3. Write/Edit instructions in body (informational skills should not instruct edits)
    if re.search(r"\b(rm -rf|sudo )\b", content):
        issues.append("Dangerous CLI command found in skill body prose")

    if issues:
        return {"status": "FAIL", "reason": "; ".join(issues)}
    return {"status": "PASS"}


def aggregate_verdict(checks: dict[str, dict[str, Any]]) -> str:
    statuses = [c["status"] for c in checks.values()]
    if "FAIL" in statuses:
        return "REJECT"
    if "WARN" in statuses:
        return "NEEDS_REVIEW"
    return "PASS"


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a candidate skill SKILL.md.")
    parser.add_argument("skill_path", type=Path, help="Path to SKILL.md (or skill directory)")
    args = parser.parse_args()

    p = args.skill_path
    if p.is_dir():
        p = p / "SKILL.md"
    if not p.exists():
        print(json.dumps({"error": f"SKILL.md not found at {p}"}), file=sys.stderr)
        return 2

    content = p.read_text(encoding="utf-8-sig")
    project_root = _find_project_root(p)

    fm, _ = _parse_frontmatter(content)
    name = (fm or {}).get("name", "")

    checks = {
        "frontmatter_conformance": check_frontmatter(content),
        "citation_existence": check_citations(content, project_root),
        "no_duplication": check_no_duplication(name, project_root),
        "description_clarity": check_description_clarity(content),
        "no_forbidden_patterns": check_no_forbidden_patterns(content),
    }

    verdict = aggregate_verdict(checks)

    output = {
        "skill_path": str(p),
        "skill_name": name,
        "verdict": verdict,
        "checks": checks,
    }
    print(json.dumps(output, indent=2))

    if verdict == "REJECT":
        return 1
    if verdict == "NEEDS_REVIEW":
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
