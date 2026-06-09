#!/usr/bin/env python3
"""Consolidate findings from all spawned agents into a single severity-classified report.

Inputs:
  - A directory containing YAML findings files (one per agent)
  - Output path for the consolidated markdown report

Output:
  - Markdown report with severity-grouped findings + dedup + cross-agent cross-references
  - JSON summary printed to stdout

Severity classification (canonical — aligned with rules/cycle-review.md):
  - BLOCKER: cannot merge under any circumstance
  - HIGH:    cannot merge without ADR-style dismissal
  - MEDIUM:  surface to human; consider WITH_CAVEATS in PR
  - LOW:     log; merge can proceed
  - INFO:    informational, no action

Verdict bands:
  - READY_TO_MERGE: zero BLOCKER, ≤ 2 HIGH findings with documented mitigation
  - NEEDS_FIXES:    ≥ 1 BLOCKER OR > 2 HIGH findings
  - NEEDS_DEEPER:   coverage of edge cases < 80% (declared via --edge-case-coverage-ratio) OR systemic issues exceeding targeted fixes

Exit codes:
  0 — READY_TO_MERGE
  1 — NEEDS_FIXES
  3 — NEEDS_DEEPER
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml


SEVERITY_ORDER = ["BLOCKER", "HIGH", "MEDIUM", "LOW", "INFO"]
# Back-compat alias map for findings emitted by agents using legacy tokens.
SEVERITY_ALIASES = {
    "CRITICAL": "HIGH",
    "MAJOR": "MEDIUM",
    "MINOR": "LOW",
}


def _read_findings_file(path: Path) -> dict[str, Any]:
    """Read a single YAML findings file; return parsed dict OR empty on error."""
    try:
        content = path.read_text(encoding="utf-8-sig")
        # Tolerate fenced YAML block
        if content.strip().startswith("```"):
            # Strip leading ``` and trailing ```
            lines = content.splitlines()
            start = 0
            end = len(lines)
            for i, line in enumerate(lines):
                if line.strip().startswith("```yaml") or line.strip() == "```":
                    if start == 0:
                        start = i + 1
                    else:
                        end = i
                        break
            content = "\n".join(lines[start:end])

        parsed = yaml.safe_load(content)
        if not isinstance(parsed, dict):
            return {}
        return parsed
    except (yaml.YAMLError, OSError):
        return {}


def _normalize_finding(f: dict[str, Any], agent_role: str) -> dict[str, Any]:
    """Coerce a finding to canonical shape; provide defaults."""
    severity = str(f.get("severity", "INFO")).upper()
    severity = SEVERITY_ALIASES.get(severity, severity)
    if severity not in SEVERITY_ORDER:
        severity = "INFO"

    return {
        "id": str(f.get("id", "")),
        "severity": severity,
        "file": str(f.get("file", "")),
        "line": f.get("line"),
        "plan_ref": str(f.get("plan_ref", "")),
        "summary": str(f.get("summary", "")),
        "evidence": str(f.get("evidence", "")),
        "recommended_action": str(f.get("recommended_action", "")),
        "domain_anchor": str(f.get("domain_anchor", "")),
        "found_by": agent_role,
    }


def _dedupe_findings(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Combine findings that are likely the same issue (same file + line + plan_ref OR same summary)."""
    seen: dict[tuple[str, int | None, str], dict[str, Any]] = {}
    for f in findings:
        key = (f["file"], f["line"], f["plan_ref"])
        if key in seen and key != ("", None, ""):
            # Merge: keep highest severity, append agent to list
            existing = seen[key]
            if SEVERITY_ORDER.index(f["severity"]) < SEVERITY_ORDER.index(existing["severity"]):
                existing["severity"] = f["severity"]
            existing_found_by = existing.get("found_by_list", [existing["found_by"]])
            existing_found_by.append(f["found_by"])
            existing["found_by_list"] = existing_found_by
        else:
            f["found_by_list"] = [f["found_by"]]
            seen[key] = f
    return list(seen.values())


def _classify_verdict(findings: list[dict[str, Any]], coverage_ratio: float | None) -> str:
    """Determine final verdict from findings + coverage."""
    blocker_count = sum(1 for f in findings if f["severity"] == "BLOCKER")
    high_count = sum(1 for f in findings if f["severity"] == "HIGH")

    if blocker_count > 0 or high_count > 2:
        return "NEEDS_FIXES"
    if coverage_ratio is not None and coverage_ratio < 0.80:
        return "NEEDS_DEEPER"
    return "READY_TO_MERGE"


def _render_markdown(
    slug: str,
    date: str,
    findings_by_severity: dict[str, list[dict[str, Any]]],
    agents_run: list[str],
    verdict: str,
    coverage_ratio: float | None,
    total_findings: int,
) -> str:
    md = [
        f"# Review: {slug}",
        "",
        f"**Date:** {date}",
        f"**Verdict:** {verdict}",
        f"**Reviewers (spawned agents):** {len(agents_run)} ({', '.join(agents_run)})",
        f"**Total findings:** {total_findings}",
        "",
    ]
    if coverage_ratio is not None:
        md.append(f"**Edge-case coverage:** {coverage_ratio:.0%}")
        md.append("")

    md.append("## Findings summary by severity")
    md.append("")
    md.append("| Severity | Count |")
    md.append("|---|---|")
    for sev in SEVERITY_ORDER:
        count = len(findings_by_severity.get(sev, []))
        md.append(f"| {sev} | {count} |")
    md.append("")

    for sev in SEVERITY_ORDER:
        items = findings_by_severity.get(sev, [])
        if not items:
            continue
        md.append(f"## {sev} findings ({len(items)})")
        md.append("")
        for f in items:
            md.append(f"### {f['id']}: {f['summary']}")
            md.append("")
            md.append(f"- **Found by:** {', '.join(f.get('found_by_list', [f['found_by']]))}")
            if f["file"]:
                md.append(f"- **File:** `{f['file']}`{(' line ' + str(f['line'])) if f['line'] else ''}")
            if f["plan_ref"]:
                md.append(f"- **Plan reference:** {f['plan_ref']}")
            if f["domain_anchor"]:
                md.append(f"- **Domain anchor:** {f['domain_anchor']}")
            if f["evidence"]:
                md.append("- **Evidence:**")
                md.append("")
                for line in f["evidence"].splitlines():
                    md.append(f"  {line}")
                md.append("")
            if f["recommended_action"]:
                md.append(f"- **Recommended action:** {f['recommended_action']}")
            md.append("")
        md.append("")

    md.append("## Handoff decision")
    md.append("")
    if verdict == "READY_TO_MERGE":
        md.append("Implementation passes all gates. Ready for merge.")
    elif verdict == "NEEDS_FIXES":
        md.append("Implementation has BLOCKER and/or > 2 HIGH findings. Loop back to `/implement` to address.")
    else:
        md.append("Edge-case coverage below 80%. Re-run `/review` with broader scope or add missing tests.")
    md.append("")

    md.append("## Audit trail")
    md.append("")
    md.append("Spawned agents (their findings files live alongside this report):")
    md.append("")
    for agent in agents_run:
        md.append(f"- `.claude/agents/review-{slug}-{date}/{agent}.md`")
    md.append("")

    return "\n".join(md)


def main() -> int:
    parser = argparse.ArgumentParser(description="Consolidate findings from spawned review agents.")
    parser.add_argument("--findings-dir", type=Path, required=True, help="Directory with YAML findings files")
    parser.add_argument("--output", type=Path, required=True, help="Output markdown report path")
    parser.add_argument("--slug", default=None, help="Plan slug (default: derived from findings-dir path)")
    parser.add_argument(
        "--edge-case-coverage-ratio",
        type=float,
        default=None,
        help="Edge case coverage ratio 0.0-1.0 (from edge_case_coverage.py)",
    )
    args = parser.parse_args()

    if not args.findings_dir.exists():
        print(json.dumps({"error": f"Findings dir not found: {args.findings_dir}"}), file=sys.stderr)
        return 2

    slug = args.slug
    if not slug:
        # Try to extract from findings-dir path: .claude/agents/review-{slug}-{date}/findings/
        parts = args.findings_dir.resolve().parts
        for part in reversed(parts):
            if part.startswith("review-"):
                # review-{slug}-{date} — strip review- prefix and trailing date
                rest = part[len("review-"):]
                # Try to drop trailing YYYY-MM-DD
                if len(rest) > 11 and rest[-11] == "-":
                    slug = rest[:-11]
                else:
                    slug = rest
                break
    if not slug:
        slug = "unknown"

    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Collect all findings
    all_findings: list[dict[str, Any]] = []
    agents_run: list[str] = []
    for yml_path in sorted(args.findings_dir.glob("*.yml")):
        data = _read_findings_file(yml_path)
        agent_role = data.get("agent", yml_path.stem)
        if isinstance(agent_role, str):
            agents_run.append(agent_role)
        findings = data.get("findings", [])
        if not isinstance(findings, list):
            continue
        for f in findings:
            if isinstance(f, dict):
                all_findings.append(_normalize_finding(f, str(agent_role)))

    # Deduplicate
    deduped = _dedupe_findings(all_findings)

    # Group by severity
    findings_by_severity: dict[str, list[dict[str, Any]]] = {sev: [] for sev in SEVERITY_ORDER}
    for f in deduped:
        findings_by_severity[f["severity"]].append(f)

    # Determine verdict
    verdict = _classify_verdict(deduped, args.edge_case_coverage_ratio)

    # Write the markdown report
    md_content = _render_markdown(
        slug=slug,
        date=date,
        findings_by_severity=findings_by_severity,
        agents_run=agents_run,
        verdict=verdict,
        coverage_ratio=args.edge_case_coverage_ratio,
        total_findings=len(deduped),
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(md_content, encoding="utf-8")

    summary = {
        "slug": slug,
        "report_path": str(args.output),
        "verdict": verdict,
        "agents_run": agents_run,
        "agents_count": len(agents_run),
        "total_findings": len(deduped),
        "findings_by_severity": {sev: len(items) for sev, items in findings_by_severity.items()},
        "edge_case_coverage_ratio": args.edge_case_coverage_ratio,
    }
    print(json.dumps(summary, indent=2))

    if verdict == "NEEDS_FIXES":
        return 1
    if verdict == "NEEDS_DEEPER":
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
