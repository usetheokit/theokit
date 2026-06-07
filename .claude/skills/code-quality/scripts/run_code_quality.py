#!/usr/bin/env python3
"""Orchestrator entrypoint for /code-quality skill.

T5.1 implementation: CLI + auto-detect + per-language detector dispatch.

Modes:
  Mode 1 (no plan slug): repo-wide audit; JSON to stdout, no Markdown file.
  Mode 2 (plan slug):    bind audit to the plan's `## Critical paths` (if any);
                         write Markdown audit to .claude/knowledge-base/audits/
                         {slug}-code-quality-{date}.md unless --no-audit-write.

CLI flags:
  {plan-slug} (positional, optional)
  --json-out PATH         (default: stdout; use `-` for stdout explicitly)
  --audit-out PATH        (default: derived from slug + date)
  --no-audit-write        (skip Markdown report; JSON only — used by T6.5 wiring)
  --languages-rule PATH   (default: .claude/rules/code-quality-languages.txt)
  --thresholds-rule PATH  (default: .claude/rules/code-quality-thresholds.txt)
  --allowlist PATH        (default: .claude/rules/code-quality-allowlist.txt)
  --no-network            (disable D2 entirely; single INFO Finding per language — EC-25)
  --repo-root PATH        (default: walk up from cwd looking for .git or .claude)

Exit codes:
  0  PASS or PASS_WITH_CAVEATS (no HARD findings)
  1  FAIL_HARD or INVALID (HARD findings present)
  2  Error (slug not found, malformed config, orchestrator crash)
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

# Make `scripts.*` importable when this file is run directly (not via -m).
_SKILL_ROOT = Path(__file__).resolve().parent.parent
if str(_SKILL_ROOT) not in sys.path:
    sys.path.insert(0, str(_SKILL_ROOT))

from scripts._shared import (  # noqa: E402
    Finding,
    compute_verdict,
    emit_json_summary,
    load_allowlist,
    load_languages_config,
    load_thresholds,
)
from scripts.detectors.go import GoDetector  # noqa: E402
from scripts.detectors.python import PythonDetector  # noqa: E402
from scripts.detectors.rust import RustDetector  # noqa: E402
from scripts.detectors.typescript import TypescriptDetector  # noqa: E402

_DETECTOR_CLASSES = {
    "python": PythonDetector,
    "typescript": TypescriptDetector,
    "rust": RustDetector,
    "go": GoDetector,
}


def _find_repo_root(start: Path) -> Path:
    cur = start.resolve()
    for _ in range(20):
        if (cur / ".claude").exists() or (cur / ".git").exists():
            return cur
        if cur == cur.parent:
            break
        cur = cur.parent
    return start.resolve()


def _resolve_plan_path(slug: str, repo_root: Path) -> Path:
    """EC-6 — strict slug resolution. Refuse discovery plans."""
    candidates = [
        repo_root / ".claude" / "knowledge-base" / "plans" / f"{slug}-plan.md",
        repo_root / ".claude" / "knowledge-base" / "plans" / "completed" / f"{slug}-plan.md",
    ]
    for p in candidates:
        if p.is_file():
            return p
    discovery_alt = (
        repo_root / ".claude" / "knowledge-base" / "discoveries" / "plans" / f"{slug}-plan.md"
    )
    if discovery_alt.is_file():
        raise FileNotFoundError(
            f"plan_not_found: slug {slug!r} matches a discovery plan at {discovery_alt}, "
            f"not an implementation plan. /code-quality validates implementation plans only. "
            f"Use /discover-confidence for discovery plans."
        )
    raise FileNotFoundError(
        f"plan_not_found: looked in plans/{slug}-plan.md and plans/completed/{slug}-plan.md"
    )


def _build_detector(language: str):
    cls = _DETECTOR_CLASSES.get(language)
    if cls is None:
        return None
    return cls()


def _safe_call(label: str, func, *args, language: str = "") -> tuple[list[Finding], Finding | None]:
    """Wrap a detector call; on any exception emit a detector_crash Finding."""
    try:
        return list(func(*args)), None
    except NotImplementedError:
        # Methods explicitly DEFERRED (T3.1, T4.1-T4.3) — return empty.
        return [], None
    except Exception as e:  # noqa: BLE001 — orchestrator isolation
        tb = traceback.format_exc(limit=3).strip().replace("\n", " | ")
        crash = Finding(
            detector="d1_dead_code",
            language=language or "unknown",
            severity="SOFT_CAP",
            file_path=".",
            symbol_or_line=label,
            message=f"detector crash: {type(e).__name__}: {e}; tb={tb[:200]}",
            allowlist_key=f"{language or 'unknown'}|.|dead_code|detector_crash_{label}",
        )
        return [], crash


def _enumerate_source_files(repo_root: Path, language: str) -> list[Path]:
    from scripts._shared import DEFAULT_SKIP_DIRS

    exts = {
        "python": (".py",),
        "typescript": (".ts", ".tsx"),
        "rust": (".rs",),
        "go": (".go",),
    }.get(language, ())
    if not exts:
        return []
    out: list[Path] = []
    for path in repo_root.rglob("*"):
        if any(part in DEFAULT_SKIP_DIRS for part in path.parts):
            continue
        if path.is_file() and path.suffix in exts:
            out.append(path)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Multi-language code-quality gate")
    parser.add_argument("slug", nargs="?", default=None, help="plan slug (Mode 2 binding)")
    parser.add_argument("--json-out", default="-")
    parser.add_argument("--audit-out", default=None)
    parser.add_argument("--no-audit-write", action="store_true")
    parser.add_argument("--languages-rule", default=None)
    parser.add_argument("--thresholds-rule", default=None)
    parser.add_argument("--allowlist", default=None)
    parser.add_argument("--no-network", action="store_true")
    parser.add_argument("--repo-root", default=None)
    args = parser.parse_args(argv)

    repo_root = Path(args.repo_root) if args.repo_root else _find_repo_root(Path.cwd())

    rules_dir = repo_root / ".claude" / "rules"
    languages_rule = Path(args.languages_rule) if args.languages_rule else rules_dir / "code-quality-languages.txt"
    thresholds_rule = Path(args.thresholds_rule) if args.thresholds_rule else rules_dir / "code-quality-thresholds.txt"
    allowlist_rule = Path(args.allowlist) if args.allowlist else rules_dir / "code-quality-allowlist.txt"

    try:
        cfg = load_languages_config(languages_rule)
    except (FileNotFoundError, ValueError) as e:
        print(f"ERROR: cannot load languages config: {e}", file=sys.stderr)
        return 2

    try:
        if thresholds_rule.exists():
            # Side-effect: validates the rule file; detectors use hardcoded defaults in v0.1.
            load_thresholds(thresholds_rule)
    except ValueError as e:
        print(f"ERROR: thresholds malformed: {e}", file=sys.stderr)
        return 2

    try:
        allowlist = load_allowlist(allowlist_rule) if allowlist_rule.exists() else []
    except ValueError as e:
        # EC-4 — surface as HARD Finding instead of crashing.
        allowlist_malformed_finding = Finding(
            detector="d1_dead_code",
            language="unknown",
            severity="HARD",
            file_path=str(allowlist_rule.relative_to(repo_root) if allowlist_rule.is_absolute() else allowlist_rule),
            symbol_or_line="code-quality-allowlist.txt",
            message=f"allowlist_malformed_entry: {e}",
            allowlist_key="unknown|.|dead_code|allowlist_malformed_entry",
        )
        return _emit_and_exit([allowlist_malformed_finding], args, repo_root, plan_path=None)

    # Plan resolution (Mode 2)
    plan_path = None
    if args.slug:
        try:
            plan_path = _resolve_plan_path(args.slug, repo_root)
        except FileNotFoundError as e:
            print(f"ERROR: {e}", file=sys.stderr)
            return 2

    findings: list[Finding] = []

    # Phase 1: D1 + D2 per enabled language
    enabled_languages = [
        lang for lang, meta in cfg.items() if meta["status"] == "ENABLED"
    ]
    languages_audited: list[str] = []
    languages_skipped: dict[str, str] = {}

    for language in enabled_languages:
        manifest_marker = cfg[language]["manifest"]
        manifest_present = (repo_root / manifest_marker).exists()
        detector = _build_detector(language)
        if detector is None:
            languages_skipped[language] = "no detector implementation"
            continue
        if not manifest_present:
            languages_skipped[language] = f"manifest {manifest_marker!r} not found"
            continue
        languages_audited.append(language)

        # D1 — dead code
        d1_findings, d1_crash = _safe_call(
            "d1", detector.detect_dead_code, repo_root, language=language
        )
        if d1_crash:
            findings.append(d1_crash)
        findings.extend(d1_findings)

        # D2 — symbol fabrication (skip when --no-network per EC-25)
        if args.no_network:
            findings.append(
                Finding(
                    detector="d2_symbol_fab",
                    language=language,
                    severity="INFO",
                    file_path=".",
                    symbol_or_line="d2",
                    message="D2 disabled by --no-network flag",
                    allowlist_key=f"{language}|.|symbol_fab|d2_disabled_no_network",
                )
            )
        else:
            source_files = _enumerate_source_files(repo_root, language)
            d2_findings, d2_crash = _safe_call(
                "d2", detector.detect_symbol_fabrication, source_files, language=language
            )
            if d2_crash:
                findings.append(d2_crash)
            findings.extend(d2_findings)

    # Apply allowlist (downgrade severities by 1 level when ACTIVE entry matches)
    findings = _apply_allowlist(findings, allowlist, repo_root)

    return _emit_and_exit(findings, args, repo_root, plan_path,
                          languages_audited=languages_audited,
                          languages_skipped=languages_skipped)


def _apply_allowlist(findings: list[Finding], allowlist: list, repo_root: Path) -> list[Finding]:
    from datetime import date as _date

    from scripts._shared import AllowlistMatch, is_allowlisted

    today = _date.today()
    downgrade = {"HARD": "SOFT_CAP", "SOFT_CAP": "SOFT_FLOOR", "SOFT_FLOOR": "INFO", "INFO": "INFO"}
    out: list[Finding] = []
    for f in findings:
        match = is_allowlisted(f, allowlist, today)
        if match == AllowlistMatch.ACTIVE:
            out.append(
                Finding(
                    detector=f.detector,
                    language=f.language,
                    severity=downgrade.get(f.severity, f.severity),
                    file_path=f.file_path,
                    symbol_or_line=f.symbol_or_line,
                    message=f"{f.message} [allowlisted]",
                    allowlist_key=f.allowlist_key,
                )
            )
        else:
            out.append(f)
    return out


def _emit_and_exit(
    findings: list[Finding],
    args,
    repo_root: Path,
    plan_path: Path | None,
    languages_audited: list[str] | None = None,
    languages_skipped: dict[str, str] | None = None,
) -> int:
    verdict, stable_ids = compute_verdict(findings)
    summary = emit_json_summary(findings, verdict, stable_ids)
    summary["languages_audited"] = languages_audited or []
    summary["languages_skipped"] = list((languages_skipped or {}).keys())
    summary["skip_reasons"] = languages_skipped or {}
    summary["mode"] = "plan-bound" if plan_path else "standalone"
    if plan_path:
        summary["plan_path"] = str(plan_path.relative_to(repo_root))

    # JSON output
    json_text = json.dumps(summary, indent=2, ensure_ascii=False)
    if args.json_out and args.json_out != "-":
        Path(args.json_out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.json_out).write_text(json_text, encoding="utf-8")
    else:
        sys.stdout.write(json_text + "\n")

    # Markdown audit (Mode 2 only, unless --no-audit-write)
    if args.slug and not args.no_audit_write:
        audit_path = (
            Path(args.audit_out)
            if args.audit_out
            else repo_root
            / ".claude"
            / "knowledge-base"
            / "audits"
            / f"{args.slug}-code-quality-{datetime.now(timezone.utc).strftime('%Y-%m-%d')}.md"
        )
        _write_markdown_report(findings, summary, audit_path, args.slug)
        summary["report_path"] = str(audit_path.relative_to(repo_root))

    # Exit code
    if verdict in ("FAIL_HARD", "INVALID"):
        return 1
    return 0


def _write_markdown_report(findings: list[Finding], summary: dict, audit_path: Path, slug: str) -> None:
    """T5.3 — render Markdown report from template skeleton."""
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    by_severity: dict[str, list[Finding]] = {"HARD": [], "SOFT_CAP": [], "SOFT_FLOOR": [], "INFO": []}
    for f in findings:
        by_severity.setdefault(f.severity, []).append(f)

    def _table(items: list[Finding]) -> str:
        if not items:
            return "_No findings._"
        rows = ["| File | Symbol | Severity | Message |", "|---|---|---|---|"]
        for f in items:
            msg = f.message.replace("|", "\\|")
            rows.append(f"| `{f.file_path}` | `{f.symbol_or_line}` | {f.severity} | {msg} |")
        return "\n".join(rows)

    by_detector: dict[str, list[Finding]] = {"d1_dead_code": [], "d2_symbol_fab": [], "d3_orphan_export": [], "d4_mutation": []}
    for f in findings:
        by_detector.setdefault(f.detector, []).append(f)

    content = f"""# Code Quality Audit: {slug}

**Date:** {datetime.now(timezone.utc).strftime('%Y-%m-%d')}
**Mode:** {summary.get('mode', 'standalone')}
**Verdict:** {summary['verdict']}
**Score cap:** {summary['score_cap']}
**Hard caps triggered:** {', '.join(summary['hard_caps_triggered']) or '_none_'}

## Summary

- Languages audited: {', '.join(summary.get('languages_audited', [])) or '_none_'}
- Languages skipped: {', '.join(summary.get('languages_skipped', [])) or '_none_'}
- Total findings: {len(findings)} ({len(by_severity['HARD'])} HARD, {len(by_severity['SOFT_CAP'])} SOFT_CAP, {len(by_severity['SOFT_FLOOR'])} SOFT_FLOOR, {len(by_severity['INFO'])} INFO)

## Findings by detector

### D1 — Dead code
{_table(by_detector['d1_dead_code'])}

### D2 — Symbol fabrication
{_table(by_detector['d2_symbol_fab'])}

### D3 — Cross-package orphan exports
{_table(by_detector['d3_orphan_export'])}

### D4 — Mutation testing
{_table(by_detector['d4_mutation'])}

## Related

- Golden rule: [`.claude/rules/code-quality-golden-rule.md`](../../rules/code-quality-golden-rule.md)
- Allowlist: [`.claude/rules/code-quality-allowlist.txt`](../../rules/code-quality-allowlist.txt)
- Thresholds: [`.claude/rules/code-quality-thresholds.txt`](../../rules/code-quality-thresholds.txt)
"""
    audit_path.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 — EC-30 top-level safety
        print(f"ORCHESTRATOR_CRASH: {type(e).__name__}: {e}", file=sys.stderr)
        traceback.print_exc()
        sys.exit(2)
