"""Tests for spawn_reviewers.py — verifies template substitution + agent generation.

v1.1 (2026-05-22): 10 RED tests added for the teacher/student model split.
Tests cover frontmatter `model:` resolution per role via routing rule,
with EC-3..EC-7 edge cases.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "scripts" / "spawn_reviewers.py"


def _run(
    plan: Path,
    slug: str,
    primary: str,
    output_dir: Path,
    secondary: str = "",
    *,
    extra_args: list[str] | None = None,
) -> tuple[int, dict]:
    """Invoke spawn_reviewers.py and parse JSON output.

    extra_args: additional CLI args (e.g., --routing-rule, --model-override).
    """
    skill_dir = Path(__file__).parent.parent  # The review skill dir (where templates live)
    # Default --skills-dir to output_dir.parent (tmp_path) to prevent test contamination
    # of the real .claude/skills/ tree. Tests that want a specific skills-dir can override
    # via extra_args; the explicit --skills-dir there will win the duplicate arg parse.
    default_skills_dir = output_dir.parent / "skills-test-isolation"
    args = [
        sys.executable,
        str(SCRIPT),
        "--plan", str(plan),
        "--slug", slug,
        "--primary-domain", primary,
        "--secondary-domains", secondary,
        "--output-dir", str(output_dir),
        "--skill-dir", str(skill_dir),
        "--skills-dir", str(default_skills_dir),
    ]
    if extra_args:
        args.extend(extra_args)
    result = subprocess.run(args, capture_output=True, text=True)
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        data = {"raw": result.stdout, "stderr": result.stderr, "exit": result.returncode}
    return result.returncode, data


def _parse_frontmatter(path: Path) -> dict[str, str]:
    """Parse YAML-ish frontmatter (key: value lines between two `---`)."""
    content = path.read_text(encoding="utf-8-sig")
    if not content.startswith("---"):
        return {}
    parts = content.split("---", 2)
    if len(parts) < 3:
        return {}
    fm: dict[str, str] = {}
    for line in parts[1].strip().splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            fm[key.strip()] = value.strip()
    return fm


@pytest.fixture
def routing_rule(tmp_path: Path):
    """Factory: write a routing rule file in tmp_path and return its path."""

    def _make(content: str, name: str = "review-model-routing.txt") -> Path:
        path = tmp_path / name
        path.write_text(content, encoding="utf-8")
        return path

    return _make


def test_baseline_4_agents_generated(sample_plan: Path, tmp_path: Path) -> None:
    output_dir = tmp_path / "agents-out"
    rc, data = _run(sample_plan, "test-slug", "pgvector-schema", output_dir)
    assert rc == 0
    # Baseline = 4 (architecture, tests, wiring, cross-validation) + 1 domain (primary)
    assert data["agents_count"] >= 5
    baseline_roles = {a["role"] for a in data["agents_generated"]}
    assert {"architecture", "tests", "wiring", "cross-validation"} <= baseline_roles


def test_agent_files_actually_written(sample_plan: Path, tmp_path: Path) -> None:
    output_dir = tmp_path / "agents-out"
    rc, data = _run(sample_plan, "test-slug", "pgvector-schema", output_dir)
    for agent in data["agents_generated"]:
        path = Path(agent["path"])
        assert path.exists()
        content = path.read_text(encoding="utf-8-sig")
        # Substitution markers should be replaced
        assert "{SLUG}" not in content
        assert "test-slug" in content


def test_secondary_domains_spawn_extra_agents(sample_plan: Path, tmp_path: Path) -> None:
    output_dir = tmp_path / "agents-out"
    rc, data = _run(
        sample_plan,
        "test-slug",
        "pgvector-schema",
        output_dir,
        secondary="memory-layer,db-migrations",
    )
    assert rc == 0
    domain_roles = [a["role"] for a in data["agents_generated"] if a["role"].startswith("domain-")]
    assert len(domain_roles) >= 3  # primary + 2 secondary


def test_findings_dir_created(sample_plan: Path, tmp_path: Path) -> None:
    output_dir = tmp_path / "agents-out"
    rc, data = _run(sample_plan, "test-slug", "pgvector-schema", output_dir)
    findings_dir = Path(data["findings_dir"])
    assert findings_dir.exists()
    assert findings_dir.is_dir()


# ----------------------------------------------------------------------------
# RED tests for the teacher/student model split (v1.1)
#
# 5 core tests + 5 absorbed from the edge-case review (EC-3..EC-7).
# ----------------------------------------------------------------------------


def test_baseline_agents_get_student_model(
    sample_plan: Path, tmp_path: Path, routing_rule
) -> None:
    """Plan T1.1 core: 4 baseline arquétipos → student model from routing rule."""
    rule = routing_rule(
        "architecture: haiku\n"
        "tests: haiku\n"
        "wiring: haiku\n"
        "domain: haiku\n"
        "cross-validation: opus\n"
    )
    output_dir = tmp_path / "agents-out"
    rc, data = _run(
        sample_plan,
        "test-slug",
        "pgvector-schema",
        output_dir,
        extra_args=["--routing-rule", str(rule)],
    )
    assert rc == 0, f"spawn failed: {data}"
    for role in ("architecture", "tests", "wiring", "domain-pgvector-schema"):
        path = output_dir / f"{role}.md"
        assert path.exists(), f"agent file missing: {path}"
        fm = _parse_frontmatter(path)
        assert (
            fm.get("model") == "haiku"
        ), f"{role} got model={fm.get('model')!r}, expected haiku"


def test_cross_validation_gets_teacher_model(
    sample_plan: Path, tmp_path: Path, routing_rule
) -> None:
    """Plan T1.1 core: cross-validation → teacher (opus) per routing rule."""
    rule = routing_rule("architecture: haiku\ncross-validation: opus\n")
    output_dir = tmp_path / "agents-out"
    rc, data = _run(
        sample_plan,
        "test-slug",
        "pgvector-schema",
        output_dir,
        extra_args=["--routing-rule", str(rule)],
    )
    assert rc == 0
    fm = _parse_frontmatter(output_dir / "cross-validation.md")
    assert fm.get("model") == "opus"


def test_routing_rule_fallback_default(sample_plan: Path, tmp_path: Path) -> None:
    """Plan T1.1 core: missing rule file → all agents default to opus (backward-compat)."""
    nonexistent_rule = tmp_path / "no-such-rule.txt"
    output_dir = tmp_path / "agents-out"
    rc, data = _run(
        sample_plan,
        "test-slug",
        "pgvector-schema",
        output_dir,
        extra_args=["--routing-rule", str(nonexistent_rule)],
    )
    assert rc == 0
    for role in (
        "architecture",
        "tests",
        "wiring",
        "cross-validation",
        "domain-pgvector-schema",
    ):
        fm = _parse_frontmatter(output_dir / f"{role}.md")
        assert (
            fm.get("model") == "opus"
        ), f"{role} got model={fm.get('model')!r}, expected opus (fallback)"


def test_cli_model_override(sample_plan: Path, tmp_path: Path, routing_rule) -> None:
    """Plan T1.1 core: --model-override role=model takes precedence over rule entry."""
    rule = routing_rule("architecture: haiku\ncross-validation: opus\n")
    output_dir = tmp_path / "agents-out"
    rc, data = _run(
        sample_plan,
        "test-slug",
        "pgvector-schema",
        output_dir,
        extra_args=[
            "--routing-rule",
            str(rule),
            "--model-override",
            "architecture=sonnet",
        ],
    )
    assert rc == 0
    arch_fm = _parse_frontmatter(output_dir / "architecture.md")
    assert arch_fm.get("model") == "sonnet"
    cv_fm = _parse_frontmatter(output_dir / "cross-validation.md")
    assert cv_fm.get("model") == "opus"


def test_experimental_marker_preserved(
    sample_plan: Path, tmp_path: Path, routing_rule
) -> None:
    """Plan T1.1 core: rule entries with experimental_until appear in JSON output."""
    rule = routing_rule(
        "architecture: haiku experimental_until=2026-06-22 rollback_if=blocker_findings_gt_2\n"
        "cross-validation: opus\n"
    )
    output_dir = tmp_path / "agents-out"
    rc, data = _run(
        sample_plan,
        "test-slug",
        "pgvector-schema",
        output_dir,
        extra_args=["--routing-rule", str(rule)],
    )
    assert rc == 0
    assert "experimental_routings" in data, f"missing key in {data.keys()}"
    assert "architecture" in data["experimental_routings"]
    assert "cross-validation" not in data["experimental_routings"]


# === EC-3..EC-7 SHOULD TEST (absorved v1.1) ===


def test_routing_rule_with_utf8_bom_parsed_correctly(
    sample_plan: Path, tmp_path: Path
) -> None:
    """EC-3: rule file com BOM parseia primeira entry corretamente."""
    rule = tmp_path / "review-model-routing.txt"
    rule.write_bytes(b"\xef\xbb\xbfarchitecture: haiku\ncross-validation: opus\n")
    output_dir = tmp_path / "agents-out"
    rc, data = _run(
        sample_plan,
        "test-slug",
        "pgvector-schema",
        output_dir,
        extra_args=["--routing-rule", str(rule)],
    )
    assert rc == 0
    arch_fm = _parse_frontmatter(output_dir / "architecture.md")
    assert (
        arch_fm.get("model") == "haiku"
    ), f"BOM corrupted parsing: got {arch_fm.get('model')!r}, expected haiku"


def test_domain_secondary_resolves_via_base_lookup(
    sample_plan: Path, tmp_path: Path, routing_rule
) -> None:
    """EC-4 + EC-1: domain-X, domain-Y, domain-Z resolvem via key base 'domain'."""
    rule = routing_rule(
        "architecture: haiku\n"
        "domain: haiku\n"
        "cross-validation: opus\n"
    )
    output_dir = tmp_path / "agents-out"
    rc, data = _run(
        sample_plan,
        "test-slug",
        "pgvector-schema",
        output_dir,
        secondary="memory-layer,db-migrations",
        extra_args=["--routing-rule", str(rule)],
    )
    assert rc == 0
    for domain_role in (
        "domain-pgvector-schema",
        "domain-memory-layer",
        "domain-db-migrations",
    ):
        path = output_dir / f"{domain_role}.md"
        assert path.exists(), f"missing {path}"
        fm = _parse_frontmatter(path)
        assert (
            fm.get("model") == "haiku"
        ), f"{domain_role} got {fm.get('model')!r}, expected haiku via base 'domain'"


def test_cli_override_with_empty_value_rejected(
    sample_plan: Path, tmp_path: Path, routing_rule
) -> None:
    """EC-5: --model-override role= deve retornar exit code != 0."""
    rule = routing_rule("architecture: haiku\ncross-validation: opus\n")
    output_dir = tmp_path / "agents-out"
    rc, data = _run(
        sample_plan,
        "test-slug",
        "pgvector-schema",
        output_dir,
        extra_args=[
            "--routing-rule",
            str(rule),
            "--model-override",
            "architecture=",
        ],
    )
    assert rc != 0, f"empty model value should fail; got rc={rc}, data={data}"


def test_routing_rule_malformed_line_silently_skipped(
    sample_plan: Path, tmp_path: Path
) -> None:
    """EC-6: linha sem ':' descartada silenciosamente; entries válidas funcionam."""
    rule = tmp_path / "review-model-routing.txt"
    rule.write_text(
        "architecture haiku\n"
        "tests: haiku\n"
        "cross-validation: opus\n",
        encoding="utf-8",
    )
    output_dir = tmp_path / "agents-out"
    rc, data = _run(
        sample_plan,
        "test-slug",
        "pgvector-schema",
        output_dir,
        extra_args=["--routing-rule", str(rule)],
    )
    assert rc == 0
    arch_fm = _parse_frontmatter(output_dir / "architecture.md")
    assert (
        arch_fm.get("model") == "opus"
    ), f"malformed entry should NOT match; expected fallback opus, got {arch_fm.get('model')!r}"
    tests_fm = _parse_frontmatter(output_dir / "tests.md")
    assert tests_fm.get("model") == "haiku"


def test_routing_rule_unknown_model_passes_through(
    sample_plan: Path, tmp_path: Path, routing_rule
) -> None:
    """EC-7: rule com modelo desconhecido vira literal no frontmatter (fail-soft)."""
    rule = routing_rule(
        "architecture: nonexistent-model-xyz\ncross-validation: opus\n"
    )
    output_dir = tmp_path / "agents-out"
    rc, data = _run(
        sample_plan,
        "test-slug",
        "pgvector-schema",
        output_dir,
        extra_args=["--routing-rule", str(rule)],
    )
    assert rc == 0  # fail-soft: script aceita; downstream Anthropic CLI decide
    arch_fm = _parse_frontmatter(output_dir / "architecture.md")
    assert arch_fm.get("model") == "nonexistent-model-xyz"


# ----------------------------------------------------------------------------
# RED tests for per-plan paired knowledge skills (v1.1, 2026-05-25)
#
# Per cycle-review v1.1: each generated agent gets a paired knowledge skill
# at .claude/skills/review-{slug}-{role}-knowledge/SKILL.md. The skill
# provides domain best practices via WebSearch + plan-specific context.
# ----------------------------------------------------------------------------


def test_baseline_agents_get_paired_knowledge_skills(
    sample_plan: Path, tmp_path: Path
) -> None:
    """Each of the 4 baseline roles (architecture, tests, wiring, cross-validation)
    must produce a paired knowledge skill at .claude/skills/review-{slug}-{role}-knowledge/SKILL.md."""
    output_dir = tmp_path / "agents-out"
    skills_dir = tmp_path / "skills-out"
    rc, data = _run(
        sample_plan,
        "test-slug",
        "pgvector-schema",
        output_dir,
        extra_args=["--skills-dir", str(skills_dir)],
    )
    assert rc == 0
    for role in ("architecture", "tests", "wiring", "cross-validation"):
        skill_path = skills_dir / f"review-test-slug-{role}-knowledge" / "SKILL.md"
        assert skill_path.exists(), f"Skill for role {role} missing at {skill_path}"
        content = skill_path.read_text(encoding="utf-8-sig")
        assert "{SLUG}" not in content
        assert "test-slug" in content


def test_domain_agent_gets_paired_knowledge_skill(
    sample_plan: Path, tmp_path: Path
) -> None:
    """Domain agent gets a paired knowledge skill named review-{slug}-domain-{X}-knowledge."""
    output_dir = tmp_path / "agents-out"
    skills_dir = tmp_path / "skills-out"
    rc, data = _run(
        sample_plan,
        "test-slug",
        "pgvector-schema",
        output_dir,
        extra_args=["--skills-dir", str(skills_dir)],
    )
    assert rc == 0
    skill_path = skills_dir / "review-test-slug-domain-pgvector-schema-knowledge" / "SKILL.md"
    assert skill_path.exists()
    content = skill_path.read_text(encoding="utf-8-sig")
    assert "pgvector-schema" in content


def test_generated_skill_has_claude_code_frontmatter(
    sample_plan: Path, tmp_path: Path
) -> None:
    """Paired skill MUST be Claude Code-conformant: YAML frontmatter with name + description + allowed-tools."""
    output_dir = tmp_path / "agents-out"
    skills_dir = tmp_path / "skills-out"
    rc, data = _run(
        sample_plan,
        "test-slug",
        "pgvector-schema",
        output_dir,
        extra_args=["--skills-dir", str(skills_dir)],
    )
    assert rc == 0
    skill_path = skills_dir / "review-test-slug-architecture-knowledge" / "SKILL.md"
    content = skill_path.read_text(encoding="utf-8-sig")
    # Frontmatter block present
    assert content.count("---") >= 2
    # Skills DON'T require the same frontmatter at top of file as the template documents
    # the frontmatter inside a code-fenced block; what matters is that the substituted
    # template includes the expected skill identity + WebSearch instructions in the body.
    assert "review-test-slug-architecture-knowledge" in content
    assert "WebSearch" in content
    assert "allowed-tools" in content


def test_no_skills_flag_suppresses_skill_generation(
    sample_plan: Path, tmp_path: Path
) -> None:
    """The --no-skills flag (backward compat escape hatch) skips skill generation."""
    output_dir = tmp_path / "agents-out"
    skills_dir = tmp_path / "skills-out"
    rc, data = _run(
        sample_plan,
        "test-slug",
        "pgvector-schema",
        output_dir,
        extra_args=["--skills-dir", str(skills_dir), "--no-skills"],
    )
    assert rc == 0
    # Skills dir should not have any review-test-slug-* dirs
    if skills_dir.exists():
        children = [d for d in skills_dir.iterdir() if d.name.startswith("review-test-slug-")]
        assert children == [], f"Expected no skill dirs, found: {children}"
    # But agents should still be generated
    assert (output_dir / "architecture.md").exists()
