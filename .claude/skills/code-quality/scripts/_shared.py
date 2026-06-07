"""Cross-detector utilities for the /code-quality skill.

Centralizes parsing of config files, allowlist matching with sunset logic,
Finding dataclass with invariants, atomic writes, safe JSON parsing, and
path/symbol normalization helpers.

Per plan v1.3 § T0.4 — consumed by all detectors (Phase 1-4) plus the
orchestrator (Phase 5). Edge-case absorptions documented inline with EC-N
markers.
"""
from __future__ import annotations

import enum
import fnmatch
import json
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# EC-10 — file enumeration skip list
# ---------------------------------------------------------------------------

DEFAULT_SKIP_DIRS: frozenset[str] = frozenset(
    {
        ".git",
        ".claude",  # meta-tooling — /code-quality audits the PRODUCT, not its own skills
        "node_modules",
        ".venv",
        "venv",
        "__pycache__",
        "target",  # Rust + Java
        "dist",
        "build",
        "out",
        "referencia",  # read-only zone per cycle-discover.md
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        ".hypothesis",
        "vendor",  # Go vendored deps
        ".cache",
    }
)


# ---------------------------------------------------------------------------
# Finding dataclass + invariants (EC-12)
# ---------------------------------------------------------------------------


@dataclass
class Finding:
    """Single detection result emitted by a Detector method.

    Invariants (per EC-12):
      - `file_path` MUST be repo-relative (never absolute) — enforced by __post_init__.
      - `allowlist_key` MUST have its symbol portion sanitized (pipes escaped) —
        enforced by __post_init__.
    """

    detector: str  # "d1_dead_code" / "d2_symbol_fab" / "d3_orphan_export" / "d4_mutation"
    language: str
    severity: str  # "HARD" / "SOFT_CAP" / "SOFT_FLOOR" / "INFO"
    file_path: str
    symbol_or_line: str
    message: str
    allowlist_key: str

    def __post_init__(self) -> None:
        assert not self.file_path.startswith("/"), (
            f"Finding.file_path must be repo-relative, got absolute: {self.file_path}"
        )
        # allowlist_key format: {language}|{file_path}|{finding_type}|{sanitized_symbol}
        # MUST have exactly 3 unescaped pipes (4 segments). More pipes => symbol unsanitized.
        unescaped = self.allowlist_key.replace("\\|", "\x00")  # mask escapes
        pipe_count = unescaped.count("|")
        assert pipe_count == 3, (
            f"Finding.allowlist_key must have exactly 3 unescaped pipes "
            f"(symbol must be sanitized); got {pipe_count} in {self.allowlist_key!r}"
        )


@dataclass
class AllowlistEntry:
    ecosystem: str
    file_path: str
    finding_type: str
    symbol: str
    reason: str
    sunset_date: date


class AllowlistMatch(enum.Enum):
    ACTIVE = "active"
    EXPIRED = "expired"
    NOT_LISTED = "not_listed"


# ---------------------------------------------------------------------------
# Config file loaders
# ---------------------------------------------------------------------------

_VALID_STATUSES = frozenset({"ENABLED", "DISABLED", "DEFER"})


def load_languages_config(rule_file: Path) -> dict[str, dict[str, str]]:
    """Parse .claude/rules/code-quality-languages.txt.

    Format: LANGUAGE | MANIFEST-MARKER | STATUS | NOTES
    Returns: {language: {"manifest": ..., "status": ..., "notes": ...}}
    """
    config: dict[str, dict[str, str]] = {}
    for raw_line in rule_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 3:
            raise ValueError(f"languages.txt malformed line: {raw_line!r}")
        language, manifest, status = parts[0], parts[1], parts[2]
        notes = parts[3] if len(parts) > 3 else ""
        if status not in _VALID_STATUSES:
            raise ValueError(
                f"languages.txt invalid STATUS {status!r} for {language}; "
                f"must be one of {_VALID_STATUSES}"
            )
        config[language] = {"manifest": manifest, "status": status, "notes": notes}
    return config


def load_thresholds(rule_file: Path) -> dict[str, Any]:
    """Parse key=value thresholds; coerce int / float / bool / str."""
    thresholds: dict[str, Any] = {}
    for raw_line in rule_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"thresholds.txt malformed line: {raw_line!r}")
        key, raw_value = line.split("=", 1)
        key = key.strip()
        raw_value = raw_value.strip()
        thresholds[key] = _coerce_value(raw_value)
    return thresholds


def _coerce_value(raw: str) -> Any:
    low = raw.lower()
    if low == "true":
        return True
    if low == "false":
        return False
    try:
        return int(raw)
    except ValueError:
        pass
    try:
        return float(raw)
    except ValueError:
        pass
    return raw


# ---------------------------------------------------------------------------
# Allowlist parsing (EC-4 — strict date validation)
# ---------------------------------------------------------------------------

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_VALID_ECOSYSTEMS = frozenset({"python", "typescript", "rust", "go"})
_VALID_FINDING_TYPES = frozenset({"dead_code", "symbol_fab", "orphan_export", "mutation_low"})


def load_allowlist(rule_file: Path) -> list[AllowlistEntry]:
    """Parse pipe-separated allowlist with strict sunset date validation.

    Format: ECOSYSTEM|FILE-PATH|FINDING-TYPE|SYMBOL-OR-LINE|REASON|SUNSET-DATE

    Per EC-4: malformed sunset dates raise ValueError. The golden rule's
    `allowlist_malformed_entry` HARD Finding is emitted by the orchestrator
    (run_code_quality.py) when load_allowlist raises — it does NOT silently
    drop malformed entries.
    """
    entries: list[AllowlistEntry] = []
    for line_num, raw_line in enumerate(rule_file.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) != 6:
            raise ValueError(
                f"allowlist.txt line {line_num}: malformed entry (expected 6 pipe-separated "
                f"fields, got {len(parts)}): {raw_line!r}"
            )
        ecosystem, file_path, finding_type, symbol, reason, sunset_str = parts
        if ecosystem not in _VALID_ECOSYSTEMS:
            raise ValueError(
                f"allowlist.txt line {line_num}: invalid ECOSYSTEM {ecosystem!r}"
            )
        if finding_type not in _VALID_FINDING_TYPES:
            raise ValueError(
                f"allowlist.txt line {line_num}: invalid FINDING-TYPE {finding_type!r}"
            )
        if not reason:
            raise ValueError(f"allowlist.txt line {line_num}: REASON is empty")
        if not _ISO_DATE_RE.match(sunset_str):
            raise ValueError(
                f"allowlist.txt line {line_num}: malformed sunset date {sunset_str!r} "
                f"(expected YYYY-MM-DD)"
            )
        try:
            sunset = datetime.strptime(sunset_str, "%Y-%m-%d").date()
        except ValueError as e:
            raise ValueError(
                f"allowlist.txt line {line_num}: malformed sunset date {sunset_str!r}: {e}"
            ) from e
        entries.append(
            AllowlistEntry(
                ecosystem=ecosystem,
                file_path=file_path,
                finding_type=finding_type,
                symbol=symbol,
                reason=reason,
                sunset_date=sunset,
            )
        )
    return entries


def is_allowlisted(
    finding: Finding, allowlist: list[AllowlistEntry], today: date
) -> AllowlistMatch:
    """Match a Finding against the allowlist; return ACTIVE / EXPIRED / NOT_LISTED."""
    for entry in allowlist:
        # Patch 2026-05-30 — file_path uses fnmatch (literal-match still works when entry has no wildcards;
        # glob patterns like `examples/**/lib/*.ts` now match real findings). Symbol stays substring-match
        # for backward compat (entries without `*` continue to work as before; entries with `*` now glob).
        symbol_match = (
            fnmatch.fnmatch(finding.symbol_or_line, f"*{entry.symbol}*")
            if any(c in entry.symbol for c in "*?[")
            else entry.symbol in finding.symbol_or_line
        )
        if (
            entry.ecosystem == finding.language
            and fnmatch.fnmatch(finding.file_path, entry.file_path)
            and finding.detector.startswith("d") and _detector_to_finding_type(finding.detector) == entry.finding_type
            and symbol_match
        ):
            if today <= entry.sunset_date:
                return AllowlistMatch.ACTIVE
            return AllowlistMatch.EXPIRED
    return AllowlistMatch.NOT_LISTED


def _detector_to_finding_type(detector: str) -> str:
    """Map detector identifier to the allowlist FINDING-TYPE column."""
    mapping = {
        "d1_dead_code": "dead_code",
        "d2_symbol_fab": "symbol_fab",
        "d3_orphan_export": "orphan_export",
        "d4_mutation": "mutation_low",
    }
    return mapping.get(detector, "")


# ---------------------------------------------------------------------------
# safe_parse_json (EC-1) — never let JSONDecodeError bubble
# ---------------------------------------------------------------------------


def safe_parse_json(stdout: str, tool_name: str) -> tuple[Any | None, Finding | None]:
    """Wrap json.loads with explicit error handling.

    Returns:
        (parsed_data, None) on success.
        (None, Finding(severity=SOFT_CAP, allowlist_key=auditor_output_malformed_{tool}))
            on JSONDecodeError. Orchestrator must isolate per detector — never crash
            the loop because one tool emitted bad JSON.
    """
    try:
        return json.loads(stdout), None
    except (json.JSONDecodeError, ValueError) as e:
        return (
            None,
            Finding(
                detector="d1_dead_code",  # caller may override; default conservative
                language="",
                severity="SOFT_CAP",
                file_path="",
                symbol_or_line=f"{tool_name} stdout (len={len(stdout)})",
                message=f"Failed to parse {tool_name} JSON output: {e}",
                allowlist_key=f"|auditor|auditor_output_malformed_{tool_name}|tool",
            ),
        )


# ---------------------------------------------------------------------------
# write_atomic (EC-9)
# ---------------------------------------------------------------------------


def write_atomic(target: Path, content: str | bytes) -> None:
    """Write `content` to `target` atomically (tempfile + rename).

    POSIX guarantees `os.replace` atomicity within the same filesystem. Concurrent
    writers see either the OLD or NEW state — never a partial truncation.
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    mode = "wb" if isinstance(content, bytes) else "w"
    encoding = None if isinstance(content, bytes) else "utf-8"
    with tempfile.NamedTemporaryFile(
        mode=mode,
        dir=str(target.parent),
        delete=False,
        prefix=f".{target.name}.",
        suffix=".tmp",
        encoding=encoding,
    ) as tmp:
        tmp.write(content)
        tmp.flush()
        os.fsync(tmp.fileno())
        tmp_path = Path(tmp.name)
    os.replace(tmp_path, target)


# ---------------------------------------------------------------------------
# Path + symbol helpers (EC-12)
# ---------------------------------------------------------------------------


def make_relative(path: Path, repo_root: Path) -> str:
    """Return path relative to repo_root using forward slashes."""
    rel = path.resolve().relative_to(repo_root.resolve())
    return rel.as_posix()


def sanitize_symbol(symbol: str) -> str:
    """Escape pipe characters in symbol names for unambiguous allowlist_key parsing."""
    return symbol.replace("|", "\\|")


def to_rel_path(p: Path) -> str:
    """Strip leading slash so absolute paths satisfy Finding's repo-relative invariant.

    Detectors invoked with `tmp_path` from tests pass absolute paths; production
    orchestrator (T5.1) passes already-relative paths so this is a no-op there.
    """
    s = p.as_posix()
    return s.lstrip("/") if s.startswith("/") else s


# ---------------------------------------------------------------------------
# JSON summary emission
# ---------------------------------------------------------------------------

_SCHEMA_VERSION = "0.1.0"


def emit_json_summary(
    findings: list[Finding],
    verdict: str,
    hard_caps_triggered: list[str],
) -> dict[str, Any]:
    """Build the JSON object emitted by /code-quality for /plan-confidence consumption."""
    severity_counts: dict[str, int] = {"HARD": 0, "SOFT_CAP": 0, "SOFT_FLOOR": 0, "INFO": 0}
    by_detector: dict[str, dict[str, int]] = {}
    soft_caps: list[str] = []
    languages_set: set[str] = set()
    for f in findings:
        severity_counts[f.severity] = severity_counts.get(f.severity, 0) + 1
        by_detector.setdefault(f.detector, {})
        by_detector[f.detector][f.language] = by_detector[f.detector].get(f.language, 0) + 1
        if f.severity == "SOFT_CAP" and f.allowlist_key:
            tail = f.allowlist_key.rsplit("|", 1)[-1]
            if tail and tail not in soft_caps:
                soft_caps.append(tail)
        if f.language:
            languages_set.add(f.language)

    return {
        "verdict": verdict,
        "score_cap": _verdict_to_cap(verdict),
        "hard_caps_triggered": hard_caps_triggered,
        "soft_caps_triggered": soft_caps,
        "findings_by_detector": by_detector,
        "severity_counts": severity_counts,
        "languages_audited": sorted(languages_set),
        "schema_version": _SCHEMA_VERSION,
    }


def _verdict_to_cap(verdict: str) -> int:
    return {
        "PASS": 100,
        "PASS_WITH_CAVEATS": 89,
        "FAIL_SOFT": 70,
        "FAIL_HARD": 49,
        "INVALID": 49,
    }.get(verdict, 49)


def compute_verdict(findings: list[Finding]) -> tuple[str, list[str]]:
    """Compute the verdict + stable_identifiers list from a list of Findings.

    Returns:
        (verdict, hard_caps_triggered) — where verdict is one of
        PASS / PASS_WITH_CAVEATS / FAIL_SOFT / FAIL_HARD / INVALID.

    Cap precedence (smallest cap wins):
      1. Any HARD finding -> FAIL_HARD (49)
      2. Else any SOFT_CAP -> FAIL_SOFT (70)
      3. Else any SOFT_FLOOR -> PASS_WITH_CAVEATS (89)
      4. Else -> PASS (100)
    """
    severities = {f.severity for f in findings}
    stable_ids: list[str] = []
    for f in findings:
        sid = _finding_to_stable_identifier(f)
        if sid and sid not in stable_ids:
            stable_ids.append(sid)

    if "HARD" in severities:
        return "FAIL_HARD", [sid for sid in stable_ids if not sid.startswith("soft_")]
    if "SOFT_CAP" in severities:
        return "FAIL_SOFT", stable_ids
    if "SOFT_FLOOR" in severities:
        return "PASS_WITH_CAVEATS", stable_ids
    return "PASS", []


def _finding_to_stable_identifier(f: Finding) -> str:
    """Map a Finding to the stable identifier from code-quality-golden-rule.md."""
    if f.detector == "d1_dead_code" and f.severity == "HARD":
        return f"dead_code_unallowlisted_{f.language}"
    if f.detector == "d1_dead_code" and f.severity == "SOFT_CAP":
        # auditor_unavailable lives in allowlist_key tail
        tail = f.allowlist_key.rsplit("|", 1)[-1]
        return tail if tail.startswith(("auditor_", "soft_")) else f"soft_cap_{f.language}"
    if f.detector == "d2_symbol_fab" and f.severity == "HARD":
        return f"symbol_fabrication_{f.language}"
    if f.detector == "d2_symbol_fab" and f.severity == "SOFT_FLOOR":
        return f"symbol_fab_unverifiable_{f.language}"
    if f.detector == "d3_orphan_export" and f.severity == "SOFT_CAP":
        return f"soft_cap_orphan_export_{f.language}"
    if f.detector == "d4_mutation" and f.severity == "SOFT_CAP":
        return f"soft_cap_mutation_score_low_{f.language}"
    if f.detector == "d4_mutation" and f.severity == "SOFT_FLOOR":
        return f"soft_floor_mutation_score_medium_{f.language}"
    return ""


__all__ = [
    "DEFAULT_SKIP_DIRS",
    "AllowlistEntry",
    "AllowlistMatch",
    "Finding",
    "compute_verdict",
    "emit_json_summary",
    "is_allowlisted",
    "load_allowlist",
    "load_languages_config",
    "load_thresholds",
    "make_relative",
    "safe_parse_json",
    "sanitize_symbol",
    "to_rel_path",
    "write_atomic",
]
