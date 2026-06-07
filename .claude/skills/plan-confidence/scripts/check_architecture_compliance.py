"""Architecture & pattern compliance check (M2 deterministic).

Reads `.claude/rules/` (project-specific source of truth) and verifies the
plan REFERENCES or INTEGRATES with the rules found there. If `.claude/rules/`
is missing or empty, falls back to defaults in
`.claude/skills/plan-confidence/defaults/`.

This is a SOFT check (no hard cap). Signal: compliance_ratio in [0, 1].

Heuristics for compliance (each contributes weight):
1. Plan body mentions at least one rule file by name (e.g., "architecture.md",
   "domain-boundary.md", "testing.md").
2. Plan DoD mentions size/complexity/lint check (code-audit alignment).
3. ADRs reference principles (SOLID, DRY, KISS, YAGNI, integration-first, ...).
4. Plan body mentions LoC budget OR file size limit.

Score = sum(weights) / total_possible, clamped to [0, 1].
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

# Module-level paths (project-rooted via run_structural.py caller passing absolute paths).
SKILL_ROOT = Path(__file__).parent.parent
DEFAULTS_DIR = SKILL_ROOT / "defaults"

# Principle keywords that, when cited in a plan, count as compliance signal.
COMPLIANCE_PRINCIPLES = (
    # SOLID
    "SRP",
    "Single Responsibility",
    "OCP",
    "Open/Closed",
    "LSP",
    "Liskov",
    "ISP",
    "Interface Segregation",
    "DIP",
    "Dependency Inversion",
    "SOLID",
    # Other principles
    "DRY",
    "KISS",
    "YAGNI",
    "Clean Code",
    "integration-first",
    "TDD",
    "RED-GREEN-REFACTOR",
)

# Plan-level signals that DoD aligns with quality gates.
DOD_QUALITY_SIGNALS = (
    "complexity",
    "lint",
    "ruff",
    "clippy",
    "mypy",
    "code-audit",
    "LoC",
    "lines",
    "size",
    "check-sizes",
    "check-complexity",
)

# Size budget references
SIZE_BUDGET_PATTERNS = (
    r"\b\d{2,4}\s*(?:loc|lines?|linhas?)\b",
    r"\b(?:max|≤|<=|<)\s*\d{2,4}\b",
    r"file\s+size",
    r"loc\s+limit",
    r"budget",
)


@dataclass(frozen=True)
class ComplianceReport:
    project_rules_found: tuple[str, ...] = field(default_factory=tuple)
    fallback_to_defaults: bool = False
    rules_referenced_in_plan: tuple[str, ...] = field(default_factory=tuple)
    principles_cited: tuple[str, ...] = field(default_factory=tuple)
    has_dod_quality_signal: bool = False
    has_size_budget_signal: bool = False
    compliance_score: float = 0.0  # 0.0-1.0
    reasons: tuple[str, ...] = field(default_factory=tuple)


def _resolve_rules_dir(plan_path: Path) -> tuple[Path, bool]:
    """Find `.claude/rules/` for the project containing `plan_path`.

    Returns (rules_dir, fallback_to_defaults).
    Walks up from plan_path looking for `.claude/rules/`. If not found OR
    found but empty (no .md files), falls back to bundled defaults.
    """
    current = plan_path.resolve().parent
    while current != current.parent:
        candidate = current / ".claude" / "rules"
        if candidate.exists() and any(candidate.glob("*.md")):
            return candidate, False
        current = current.parent
    return DEFAULTS_DIR, True


def _list_rule_names(rules_dir: Path) -> list[str]:
    """List rule filenames in the rules dir (e.g., 'architecture.md')."""
    return sorted(p.name for p in rules_dir.glob("*.md"))


def _read_plan(plan_path: Path) -> str:
    return plan_path.read_text(encoding="utf-8-sig")


def _find_rule_mentions(plan_content: str, rule_names: list[str]) -> list[str]:
    """Find which rule files are mentioned by name in the plan."""
    found: list[str] = []
    for name in rule_names:
        # Match the rule name as a word (case-insensitive)
        if name.lower() in plan_content.lower():
            found.append(name)
    return found


def _find_principle_citations(plan_content: str) -> list[str]:
    """Find which engineering principles are cited in the plan."""
    found: list[str] = []
    content_lower = plan_content.lower()
    for principle in COMPLIANCE_PRINCIPLES:
        if principle.lower() in content_lower:
            found.append(principle)
    # De-duplicate while preserving order
    seen: set[str] = set()
    deduped: list[str] = []
    for p in found:
        key = p.lower()
        if key not in seen:
            seen.add(key)
            deduped.append(p)
    return deduped


def _has_dod_quality_signal(plan_content: str) -> bool:
    """Check if Global DoD section mentions quality gates."""
    # Find the Global Definition of Done section
    m = re.search(r"##\s+Global Definition of Done", plan_content, re.IGNORECASE)
    if m is None:
        # Some plans use just "## DoD" or scattered DoD per task; check whole plan
        body = plan_content
    else:
        # Read until next H2
        start = m.end()
        nxt = re.search(r"^##\s+", plan_content[start:], re.MULTILINE)
        body = plan_content[start : start + nxt.start()] if nxt else plan_content[start:]
    body_lower = body.lower()
    return any(sig.lower() in body_lower for sig in DOD_QUALITY_SIGNALS)


def _has_size_budget_signal(plan_content: str) -> bool:
    """Check if the plan mentions any size/LoC budget."""
    content_lower = plan_content.lower()
    return any(
        re.search(pattern, content_lower, re.IGNORECASE) for pattern in SIZE_BUDGET_PATTERNS
    )


def check_architecture_compliance(plan_path: Path) -> ComplianceReport:
    """Verify the plan REFERENCES the project rules in `.claude/rules/`.

    Soft check — produces a compliance_score in [0, 1].
    """
    content = _read_plan(plan_path)
    rules_dir, fallback = _resolve_rules_dir(plan_path)
    project_rules = _list_rule_names(rules_dir)

    rules_referenced = _find_rule_mentions(content, project_rules)
    principles_cited = _find_principle_citations(content)
    dod_signal = _has_dod_quality_signal(content)
    size_signal = _has_size_budget_signal(content)

    # Compliance scoring: weighted sum
    # - 40%: plan references at least 1 rule file by name (proves agent READ them)
    # - 30%: plan cites at least 1 engineering principle
    # - 15%: DoD has quality gate signal
    # - 15%: size budget signal present
    weight_rule_ref = 0.40 if rules_referenced else 0.0
    weight_principle = 0.30 if principles_cited else 0.0
    weight_dod = 0.15 if dod_signal else 0.0
    weight_size = 0.15 if size_signal else 0.0
    compliance_score = weight_rule_ref + weight_principle + weight_dod + weight_size

    reasons: list[str] = []
    if rules_referenced:
        reasons.append(f"References {len(rules_referenced)} project rule(s): {rules_referenced[:3]}")
    else:
        reasons.append(f"Plan does NOT reference any rule in `{rules_dir.relative_to(SKILL_ROOT.parent.parent.parent) if not fallback else 'defaults/'}`")
    if principles_cited:
        reasons.append(f"Cites {len(principles_cited)} principle(s): {principles_cited[:3]}")
    else:
        reasons.append("Plan does NOT cite engineering principles (SOLID, DRY, KISS, YAGNI, ...)")
    if dod_signal:
        reasons.append("Global DoD references quality gates (lint/complexity/size)")
    else:
        reasons.append("Global DoD does NOT mention quality gates")
    if size_signal:
        reasons.append("Plan mentions file-size budget")
    else:
        reasons.append("Plan does NOT mention LoC / file-size budget")
    if fallback:
        reasons.append("FALLBACK: project has no `.claude/rules/`; using default principles")

    return ComplianceReport(
        project_rules_found=tuple(project_rules),
        fallback_to_defaults=fallback,
        rules_referenced_in_plan=tuple(rules_referenced),
        principles_cited=tuple(principles_cited),
        has_dod_quality_signal=dod_signal,
        has_size_budget_signal=size_signal,
        compliance_score=round(compliance_score, 3),
        reasons=tuple(reasons),
    )
