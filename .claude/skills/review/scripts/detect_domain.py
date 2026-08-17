#!/usr/bin/env python3
"""Detect primary + secondary domains from a plan + git diff.

Heuristic: count keyword hits per domain in (a) the plan markdown, (b) file paths
changed in the diff, (c) registered *-patterns skills' frontmatter descriptions.

Output: JSON with primary domain (highest confidence), 0-3 secondaries, and
the matched keywords for audit.

Exit codes:
  0 — Domain detected with confidence ≥ 0.5 for primary
  1 — No domain detected (no keyword hits) — confidence too low; report as "unknown"
  2 — Error (plan not found, etc.)

The DOMAINS dictionary below is intentionally agnostic across common software
engineering concerns. Projects may extend it by editing this file (no per-project
mechanism — the script is consumed by /review which is itself agnostic).
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path


# Domain dictionary — agnostic keyword sets per domain
DOMAINS: dict[str, list[str]] = {
    "auth": [
        "authentication", "authorization", "JWT", "OAuth", "OIDC", "session token",
        "password hash", "argon2", "bcrypt", "CSRF", "login", "logout",
        "RBAC", "ACL", "permission",
    ],
    "api-design": [
        "REST", "GraphQL", "OpenAPI", "endpoint", "status code",
        "200", "201", "400", "401", "403", "404", "500",
        "Content-Type", "Accept", "POST /", "GET /",
        "API contract", "request schema", "response schema",
    ],
    "frontend": [
        "React", "Vue", "Svelte", "Angular", "JSX", "TSX",
        "useState", "useEffect", "hook", "component", "props",
        "Tailwind", "CSS", "aria-", "accessibility", "a11y",
        "client-side", "browser",
    ],
    "database": [
        "schema", "migration", "ALTER TABLE", "CREATE TABLE", "DROP TABLE",
        "INDEX", "FOREIGN KEY", "transaction", "ACID",
        "ORM", "query builder", "connection pool",
        "Alembic", "Flyway", "Liquibase",
    ],
    "cli-tooling": [
        "argparse", "click", "commander", "cobra", "CLI", "command-line",
        "subcommand", "stdin", "stdout", "exit code", "argument parsing",
    ],
    "observability": [
        "metric", "counter", "histogram", "gauge",
        "tracing", "span", "OpenTelemetry", "Prometheus", "Grafana",
        "log", "logger", "structured logging", "audit trail", "alerting",
    ],
    "testing": [
        "unit test", "integration test", "e2e test", "fixture",
        "mock", "stub", "spy", "fake", "test double",
        "coverage", "TDD", "BDD", "snapshot test", "property test",
        "pyramid",
    ],
    "infrastructure": [
        "Docker", "Kubernetes", "Helm", "Terraform", "IaC",
        "CI/CD", "pipeline", "deployment", "release",
        "cloud", "AWS", "GCP", "Azure", "container",
    ],
    "concurrency": [
        "goroutine", "async", "await", "Promise", "Future",
        "thread", "mutex", "lock", "race condition", "deadlock",
        "channel", "actor", "message passing", "atomic",
    ],
    "security": [
        "vulnerability", "CVE", "exploit", "injection",
        "XSS", "CSRF", "SQL injection", "SSRF", "IDOR",
        "secret", "credential", "encryption", "hashing",
        "TLS", "SSL", "certificate", "OWASP",
    ],
    "data-pipeline": [
        "ETL", "ingestion", "transform", "pipeline",
        "stream", "batch", "Kafka", "RabbitMQ", "queue",
        "producer", "consumer", "event sourcing",
    ],
}


def _find_project_root(start: Path) -> Path:
    current = start.resolve() if not start.is_file() else start.resolve().parent
    for _ in range(20):
        if (current / "rules").exists() or (current / ".git").exists():
            return current
        if current == current.parent:
            break
        current = current.parent
    return start.resolve() if not start.is_file() else start.resolve().parent


def _read_plan(plan_path: Path) -> str:
    if not plan_path.exists():
        raise FileNotFoundError(f"Plan not found at {plan_path}")
    return plan_path.read_text(encoding="utf-8-sig")


def _git_diff_filenames(project_root: Path, diff_base: str) -> list[str]:
    try:
        result = subprocess.run(
            ["git", "-C", str(project_root), "diff", "--name-only", f"{diff_base}..HEAD"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if result.returncode != 0:
            return []
        return [line.strip() for line in result.stdout.splitlines() if line.strip()]
    except (subprocess.SubprocessError, FileNotFoundError):
        return []


def _patterns_skills_text(project_root: Path) -> str:
    skills_dir = project_root / "skills"
    if not skills_dir.exists():
        return ""
    blocks: list[str] = []
    for d in skills_dir.glob("*-patterns/"):
        skill_md = d / "SKILL.md"
        if skill_md.exists():
            content = skill_md.read_text(encoding="utf-8-sig")
            # Frontmatter only — cheap scan
            fm_end = content.find("\n---\n", 4)
            if fm_end > 0:
                blocks.append(content[:fm_end])
    return "\n".join(blocks)


def count_domain_hits(text: str, file_paths: list[str]) -> dict[str, dict[str, int | list[str]]]:
    """Count keyword hits per domain. Returns domain → {hits: N, matched: [keywords]}."""
    results: dict[str, dict[str, int | list[str]]] = defaultdict(lambda: {"hits": 0, "matched": []})
    combined = text + "\n" + "\n".join(file_paths)
    combined_lower = combined.lower()
    for domain, keywords in DOMAINS.items():
        for kw in keywords:
            kw_lower = kw.lower()
            count = combined_lower.count(kw_lower)
            if count > 0:
                results[domain]["hits"] = int(results[domain]["hits"]) + count
                matched_list = results[domain]["matched"]
                assert isinstance(matched_list, list)
                if kw not in matched_list:
                    matched_list.append(kw)
    return dict(results)


def rank_domains(hits: dict[str, dict[str, int | list[str]]]) -> tuple[str | None, list[str], dict[str, float]]:
    """Return (primary, secondaries, confidence_per_domain)."""
    if not hits:
        return None, [], {}
    total_hits = sum(int(h["hits"]) for h in hits.values())
    if total_hits == 0:
        return None, [], {}

    sorted_by_hits = sorted(hits.items(), key=lambda kv: int(kv[1]["hits"]), reverse=True)
    confidence = {d: int(h["hits"]) / total_hits for d, h in hits.items()}
    primary = sorted_by_hits[0][0]
    # Secondaries: any domain with confidence ≥ 0.15 except primary, max 3
    secondaries = [
        d for d, c in confidence.items()
        if d != primary and c >= 0.15
    ][:3]
    return primary, secondaries, confidence


def main() -> int:
    parser = argparse.ArgumentParser(description="Detect primary + secondary domains from a plan + diff.")
    parser.add_argument("--plan", type=Path, required=True, help="Path to plan markdown")
    parser.add_argument("--diff-base", default="develop", help="Git base ref for diff (default: develop)")
    parser.add_argument("--project-root", type=Path, default=None)
    args = parser.parse_args()

    try:
        project_root = args.project_root if args.project_root else _find_project_root(args.plan)
        plan_text = _read_plan(args.plan)
    except FileNotFoundError as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 2

    file_paths = _git_diff_filenames(project_root, args.diff_base)
    patterns_text = _patterns_skills_text(project_root)

    full_text = plan_text + "\n" + patterns_text
    hits = count_domain_hits(full_text, file_paths)
    primary, secondaries, confidence = rank_domains(hits)

    matched_keywords: list[str] = []
    if primary and primary in hits:
        primary_matched = hits[primary]["matched"]
        assert isinstance(primary_matched, list)
        matched_keywords = primary_matched

    output = {
        "primary_domain": primary if primary and confidence.get(primary, 0) >= 0.20 else "unknown",
        "secondary_domains": secondaries,
        "confidence": {d: round(c, 3) for d, c in confidence.items()},
        "domain_keywords_matched": matched_keywords,
        "total_hits": sum(int(h["hits"]) for h in hits.values()),
        "files_in_diff": len(file_paths),
    }

    print(json.dumps(output, indent=2))

    if output["primary_domain"] == "unknown":
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
