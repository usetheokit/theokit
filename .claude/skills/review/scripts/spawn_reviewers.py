#!/usr/bin/env python3
"""Spawn specialized review agents by instantiating templates with plan-specific context.

For each agent template at `templates/agent-*.md`, perform substitution and write the
result to `.claude/agents/review-{slug}-{date}/{role}.md`. These files are the agent
definitions consumed by the Agent tool (general-purpose subagent_type + prompt content).

Outputs:
  - N files at the output dir
  - JSON to stdout listing the file paths + roles

Exit codes:
  0 — All agent files generated
  1 — At least one template missing or write failed
  2 — Error (plan not found, etc.)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


TEMPLATES = {
    "architecture": "agent-architecture-reviewer.md",
    "tests": "agent-test-reviewer.md",
    "wiring": "agent-wiring-reviewer.md",
    "cross-validation": "agent-cross-validation-reviewer.md",
    "domain": "agent-domain-reviewer.md",
}

# Per-plan paired knowledge skills (Claude Code Skills spec) — cycle-review v1.1 (2026-05-25).
# Each baseline role has a paired knowledge skill template that hydrates plan-specific
# context (ADRs, project rules, diff surface) + instructs WebSearch refresh of community
# best practices. Skills are auto-discovered by Claude Code at `.claude/skills/{name}/SKILL.md`.
SKILL_TEMPLATES = {
    "architecture": "skill-architecture-knowledge.md",
    "tests": "skill-tests-knowledge.md",
    "wiring": "skill-wiring-knowledge.md",
    "cross-validation": "skill-cross-validation-knowledge.md",
    "domain": "skill-domain-knowledge.md",
}

BASELINE_ROLES = ["architecture", "tests", "wiring", "cross-validation"]

# Default fallback model when the routing rule is absent OR a role has no
# entry (preserves pre-split behavior — all agents run on opus).
DEFAULT_MODEL = "opus"


def _load_routing_rule(path: Path) -> dict[str, dict[str, str]]:
    """Parse review-model-routing.txt → {role: {"model": ..., "experimental_until": ..., ...}}.

    Returns empty dict when file missing OR malformed. Caller decides fallback policy.
    Uses utf-8-sig to tolerate BOM-prefixed files (EC-3).
    """
    if not path.exists():
        return {}
    parsed: dict[str, dict[str, str]] = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if ":" not in stripped:
            continue  # malformed entry, silently skipped (EC-6)
        role, rest = stripped.split(":", 1)
        role = role.strip()
        tokens = rest.strip().split()
        if not tokens:
            continue
        entry: dict[str, str] = {"model": tokens[0]}
        for token in tokens[1:]:
            if "=" in token:
                k, v = token.split("=", 1)
                entry[k] = v
        parsed[role] = entry
    return parsed


def _resolve_model(
    role: str,
    rule: dict[str, dict[str, str]],
    overrides: dict[str, str],
    default: str = DEFAULT_MODEL,
) -> tuple[str, bool]:
    """Resolve model for a role with fallback chain: cli override > rule > default.

    Returns (model, is_experimental).

    EC-1 invariant: roles matching pattern '^domain-.+$' collapse to base 'domain'
    when no exact entry exists. Without this, secondary domain agents would
    silently fall back to default opus, nullifying ~40% of expected savings.
    """
    lookup_key = role
    if role.startswith("domain-") and role not in overrides and role not in rule:
        lookup_key = "domain"

    if lookup_key in overrides:
        return overrides[lookup_key], False
    if lookup_key in rule:
        entry = rule[lookup_key]
        is_experimental = "experimental_until" in entry
        return entry["model"], is_experimental
    return default, False


class _ModelOverrideAction(argparse.Action):
    """Parse --model-override role=model repeatedly into a dict.

    Rejects empty model values (EC-5).
    """

    def __call__(  # type: ignore[override]
        self, parser: argparse.ArgumentParser, namespace: argparse.Namespace,
        values: object, option_string: str | None = None,
    ) -> None:
        current: dict[str, str] = getattr(namespace, self.dest, None) or {}
        if not isinstance(values, str) or "=" not in values:
            parser.error(f"--model-override expects 'role=model', got {values!r}")
        role, model = values.split("=", 1)
        role = role.strip()
        model = model.strip()
        if not role or not model:
            parser.error(
                f"--model-override 'role=model' requires non-empty values; got role={role!r}, model={model!r}"
            )
        current[role] = model
        setattr(namespace, self.dest, current)


def _default_routing_rule_path(skill_dir: Path) -> Path:
    """Resolve the canonical routing rule path relative to the skill dir.

    Convention: .claude/rules/review-model-routing.txt at project root.
    """
    return skill_dir.parent.parent / "rules" / "review-model-routing.txt"


def _find_skill_dir(start: Path) -> Path:
    """Find the review skill directory (where templates live)."""
    current = start.resolve()
    for _ in range(20):
        candidate = current / ".claude" / "skills" / "review"
        if candidate.exists():
            return candidate
        if current == current.parent:
            break
        current = current.parent
    raise FileNotFoundError("Could not find .claude/skills/review/")


def substitute(template_content: str, mapping: dict[str, str]) -> str:
    """Replace {KEY} markers with values from mapping."""
    result = template_content
    for key, value in mapping.items():
        result = result.replace("{" + key + "}", value)
    return result


def write_agent_file(skill_dir: Path, template_name: str, output_dir: Path, role: str, mapping: dict[str, str]) -> Path:
    template_path = skill_dir / "templates" / template_name
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {template_path}")

    content = template_path.read_text(encoding="utf-8-sig")
    substituted = substitute(content, mapping)

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{role}.md"
    output_path.write_text(substituted, encoding="utf-8")
    return output_path


def write_skill_file(
    skill_dir: Path,
    template_name: str,
    skills_root: Path,
    slug: str,
    role: str,
    mapping: dict[str, str],
) -> Path:
    """Write paired knowledge skill file (Claude Code Skills spec) alongside the agent.

    Per cycle-review v1.1 (2026-05-25): for each agent generated, a paired knowledge
    skill is written at .claude/skills/review-{slug}-{role}-knowledge/SKILL.md.
    The skill provides domain best practices via WebSearch + plan-specific context.
    """
    template_path = skill_dir / "templates" / template_name
    if not template_path.exists():
        raise FileNotFoundError(f"Skill template not found: {template_path}")

    content = template_path.read_text(encoding="utf-8-sig")
    substituted = substitute(content, mapping)

    skill_output_dir = skills_root / f"review-{slug}-{role}-knowledge"
    skill_output_dir.mkdir(parents=True, exist_ok=True)
    skill_path = skill_output_dir / "SKILL.md"
    skill_path.write_text(substituted, encoding="utf-8")
    return skill_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Spawn specialized review agents for a plan.")
    parser.add_argument("--plan", type=Path, required=True, help="Path to plan markdown")
    parser.add_argument("--slug", required=True, help="Plan slug (used in agent file names)")
    parser.add_argument("--date", default=None, help="Date string (default: today UTC)")
    parser.add_argument("--primary-domain", required=True, help="Primary domain detected")
    parser.add_argument(
        "--secondary-domains",
        default="",
        help="Comma-separated list of secondary domains (max 3)",
    )
    parser.add_argument("--diff-base", default="main", help="Git diff base (default: main)")
    parser.add_argument("--output-dir", type=Path, default=None, help="Where to write agent files")
    parser.add_argument(
        "--skills-dir",
        type=Path,
        default=None,
        help="Where to write paired knowledge skills (default: .claude/skills/). Per cycle-review v1.1.",
    )
    parser.add_argument(
        "--no-skills",
        action="store_true",
        help="Suppress paired skill generation (escape hatch; not recommended). Backward compat for pre-v1.1 invocations.",
    )
    parser.add_argument("--domain-keywords", default="", help="Comma-separated keywords (audit)")
    parser.add_argument("--skill-dir", type=Path, default=None, help="Override skill dir lookup (for tests)")
    parser.add_argument(
        "--routing-rule",
        type=Path,
        default=None,
        help="Path to review-model-routing.txt (default: .claude/rules/review-model-routing.txt)",
    )
    parser.add_argument(
        "--model-override",
        action=_ModelOverrideAction,
        default={},
        metavar="ROLE=MODEL",
        help="Override resolved model for a role (repeatable). Takes precedence over rule entries.",
    )
    args = parser.parse_args()

    if not args.plan.exists():
        print(json.dumps({"error": f"Plan not found: {args.plan}"}), file=sys.stderr)
        return 2

    # Resolve skill dir: explicit override, then walk-up from plan, then walk-up from this script
    if args.skill_dir:
        skill_dir = args.skill_dir
    else:
        try:
            skill_dir = _find_skill_dir(args.plan.resolve().parent)
        except FileNotFoundError:
            skill_dir = _find_skill_dir(Path(__file__).resolve().parent)
    date_str = args.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    output_dir = args.output_dir or (skill_dir.parent.parent / "agents" / f"review-{args.slug}-{date_str}")
    skills_root = args.skills_dir or (skill_dir.parent)  # `.claude/skills/` parent of review/ skill dir

    routing_rule_path = args.routing_rule or _default_routing_rule_path(skill_dir)
    routing_rule = _load_routing_rule(routing_rule_path)
    model_overrides: dict[str, str] = args.model_override or {}

    base_mapping = {
        "SLUG": args.slug,
        "DATE": date_str,
        "PLAN_PATH": str(args.plan),
        "DIFF_BASE": args.diff_base,
        "DOMAIN_KEYWORDS": args.domain_keywords,
    }

    generated: list[dict[str, str]] = []
    errors: list[str] = []
    experimental_routings: list[str] = []

    # Baseline agents + paired knowledge skills (always)
    for role in BASELINE_ROLES:
        try:
            mapping = dict(base_mapping)
            model, is_experimental = _resolve_model(role, routing_rule, model_overrides)
            mapping["MODEL"] = model
            if is_experimental:
                experimental_routings.append(role)
            template_name = TEMPLATES[role]
            path = write_agent_file(skill_dir, template_name, output_dir, role, mapping)
            entry: dict[str, str] = {"role": role, "model": model, "path": str(path)}

            # Per cycle-review v1.1 — write paired knowledge skill alongside the agent
            if not args.no_skills:
                skill_template = SKILL_TEMPLATES.get(role)
                if skill_template is not None:
                    skill_path = write_skill_file(
                        skill_dir, skill_template, skills_root, args.slug, role, mapping
                    )
                    entry["skill_path"] = str(skill_path)
            generated.append(entry)
        except FileNotFoundError as exc:
            errors.append(f"Failed to spawn {role}: {exc}")
        except OSError as exc:
            errors.append(f"Failed to write {role}: {exc}")

    # Domain-specific agents + paired knowledge skills
    domains_to_spawn: list[str] = [args.primary_domain]
    if args.secondary_domains:
        domains_to_spawn.extend(d.strip() for d in args.secondary_domains.split(",") if d.strip())
    # Cap at 4 total domain agents (primary + 3 secondary)
    domains_to_spawn = [d for d in domains_to_spawn if d and d != "unknown"][:4]

    for domain in domains_to_spawn:
        try:
            mapping = dict(base_mapping)
            mapping["DOMAIN"] = domain
            role = f"domain-{domain}"
            model, is_experimental = _resolve_model(role, routing_rule, model_overrides)
            mapping["MODEL"] = model
            if is_experimental and role not in experimental_routings:
                experimental_routings.append(role)
            path = write_agent_file(skill_dir, TEMPLATES["domain"], output_dir, role, mapping)
            entry: dict[str, str] = {"role": role, "domain": domain, "model": model, "path": str(path)}

            # Per cycle-review v1.1 — write paired knowledge skill for domain agent
            if not args.no_skills:
                skill_path = write_skill_file(
                    skill_dir, SKILL_TEMPLATES["domain"], skills_root, args.slug, role, mapping
                )
                entry["skill_path"] = str(skill_path)
            generated.append(entry)
        except FileNotFoundError as exc:
            errors.append(f"Failed to spawn domain-{domain}: {exc}")
        except OSError as exc:
            errors.append(f"Failed to write domain-{domain}: {exc}")

    # Findings directory placeholder so agents have a place to write
    findings_dir = output_dir / "findings"
    findings_dir.mkdir(parents=True, exist_ok=True)
    (findings_dir / ".gitkeep").touch(exist_ok=True)

    output = {
        "plan": str(args.plan),
        "slug": args.slug,
        "date": date_str,
        "primary_domain": args.primary_domain,
        "secondary_domains": [d.strip() for d in args.secondary_domains.split(",") if d.strip()],
        "output_dir": str(output_dir),
        "findings_dir": str(findings_dir),
        "routing_rule_path": str(routing_rule_path),
        "routing_rule_loaded": bool(routing_rule),
        "experimental_routings": experimental_routings,
        "agents_generated": generated,
        "agents_count": len(generated),
        "errors": errors,
    }
    print(json.dumps(output, indent=2))

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
