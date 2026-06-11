"""Conditional failure-scenarios check for /to-plan plans (SOTA upgrade Phase 2).

Happy-path tests do NOT prove resilience: production outages mostly happen at
the I/O boundary (timeouts, 5xx bursts, connection reset, rate-limit, partial
writes, queue ack timeout). A plan that touches non-deterministic external I/O
SHOULD declare a `## Failure scenarios` section listing ≥ 1 scenario per
external dependency: failure mode + how the test reproduces it + expected
recovery behavior.

This checker is CONDITIONAL: it only enforces the section when the plan
contains external-I/O signals. Plans whose code touches no external I/O
(pure logic, refactor, UI markup) are unaffected.

Soft cap stable id: `soft_floor_failure_scenarios_missing` (cap 89; sunset
2026-09-07 — after which promotes to hard cap 70 via ADR).

Detection rule:

  1. Scan a stable set of sections — Baseline Context (file table, callers,
     architecture boundaries), Prior Art & Related Work, ADRs, and Phase prose
     (Objective + Why this step + Evidence + Deep Dives + Files to edit).
  2. Look for external-I/O signals: HTTP clients, database drivers, message
     queues, gRPC, sockets, object stores.
  3. If signals found, the plan MUST have a `## Failure scenarios` section
     with at least one populated row (table data row OR bulleted scenario)
     OR the explicit escape `(none — no external I/O touched)`.

Fenced code blocks are masked before scanning so example documentation does
not pollute signal counts.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

FENCED_CODE_RE = re.compile(r"^(```|~~~)[^\n]*\n.*?^\1", re.MULTILINE | re.DOTALL)

SCAN_HEADINGS = (
    "Baseline Context",
    "Prior Art & Related Work",
    "ADRs",
    "Drawbacks & Risks",
)

EXTERNAL_IO_SIGNALS = (
    # HTTP clients — Python / JS / Go / Java / Rust
    r"\brequests\.\w+\(",
    r"\bhttpx\.",
    r"\bfetch\(",
    r"\baxios\.",
    r"\bhttp\.Client\b",
    r"\bnet/http\b",
    r"\breqwest::",
    r"\bOkHttp\b",
    r"\bRestTemplate\b",
    r"\bWebClient\b",
    # Database drivers / ORMs
    r"\bpsycopg(?:2)?\b",
    r"\bsqlalchemy\b",
    r"\bSQLAlchemy\b",
    r"\bprisma\b",
    r"\bmongoose\b",
    r"\bdatabase/sql\b",
    r"\bsqlx::",
    r"\bdiesel::",
    r"\bjdbc:",
    r"\bMongoDB\b",
    r"\bPostgres\b",
    r"\bMySQL\b",
    r"\bSQLite\b",
    r"\bRedis\b",
    r"\bElasticsearch\b",
    # Queue / streaming
    r"\bCelery\b",
    r"\bRabbitMQ\b",
    r"\bKafka\b",
    r"\bNATS\b",
    r"\bSQS\b",
    r"\bSNS\b",
    r"\bPubSub\b",
    r"\bRedis Streams\b",
    # RPC / sockets / streaming
    r"\bgRPC\b",
    r"\bWebSocket\b",
    r"\bsocket\.\w+\(",
    r"\btonic::",
    # Object stores / cloud APIs
    r"\bS3\b",
    r"\bGCS\b",
    r"\bAzure Blob\b",
    r"\bboto3\b",
    r"\bcloudfront\b",
    # Generic external-service indicators
    r"\bexternal API\b",
    r"\bthird-party API\b",
    r"\bvendor API\b",
    r"\bremote service\b",
    r"\bdownstream service\b",
    r"\bupstream service\b",
)

EXTERNAL_IO_RE = re.compile("|".join(EXTERNAL_IO_SIGNALS), re.IGNORECASE)

ESCAPE_MARKERS = (
    r"\(none\s*[—\-–]+\s*no\s+external\s+I/O\s+touched\)",
)
ESCAPE_RE = re.compile("|".join(ESCAPE_MARKERS), re.IGNORECASE)


@dataclass(frozen=True)
class FailureScenariosReport:
    """Structural report for failure-scenarios enforcement."""

    external_io_detected: bool
    signals_sample: tuple[str, ...] = field(default_factory=tuple)
    section_present: bool = False
    explicit_none: bool = False
    scenarios_count: int = 0
    is_complete: bool = True
    reasons: tuple[str, ...] = field(default_factory=tuple)


def _strip_code(content: str) -> str:
    def blank(m: re.Match[str]) -> str:
        return re.sub(r"[^\n]", " ", m.group(0))

    return FENCED_CODE_RE.sub(blank, content)


def _extract_section(content: str, heading: str) -> str | None:
    pattern = re.compile(rf"^##\s+{re.escape(heading)}(?=\b|$)", re.MULTILINE)
    m = pattern.search(content)
    if m is None:
        return None
    start = m.end()
    next_h2 = re.search(r"^##\s+", content[start:], re.MULTILINE)
    end = (start + next_h2.start()) if next_h2 else len(content)
    return content[start:end]


def _scan_for_signals(content: str) -> list[str]:
    """Return unique external-I/O signal raw matches in content."""
    seen: list[str] = []
    seen_norm: set[str] = set()
    for m in EXTERNAL_IO_RE.finditer(content):
        raw = m.group(0)
        norm = raw.lower().strip()
        if norm in seen_norm:
            continue
        seen_norm.add(norm)
        seen.append(raw)
    return seen


def _count_scenarios(section: str) -> int:
    """Count populated rows: table data rows OR scenario bullets.

    Header + separator rows of markdown tables are skipped.
    A bullet starting with `- ` and containing at least 3 words is counted.
    """
    rows = 0
    seen_separator = False
    for line in section.splitlines():
        s = line.strip()
        if s.startswith("|") and s.endswith("|"):
            inner = s[1:-1]
            if re.match(r"^[\s\-:|]+$", inner):
                seen_separator = True
                continue
            if not seen_separator:
                # header
                continue
            cells = [c.strip() for c in inner.split("|")]
            # Real data row: at least 2 non-empty cells AND total content > 20 chars
            non_empty = [c for c in cells if c]
            if len(non_empty) >= 2 and sum(len(c) for c in non_empty) >= 20:
                rows += 1
        elif s.startswith("-") and len(s.split()) >= 3:
            # bulleted scenario — count if has substantive content
            content_after_dash = s.lstrip("-").strip()
            if len(content_after_dash) >= 20:
                rows += 1
    return rows


def check_failure_scenarios(plan_path: Path) -> FailureScenariosReport:
    """Inspect plan_path and produce a FailureScenariosReport."""
    content = plan_path.read_text(encoding="utf-8-sig")
    stripped = _strip_code(content)

    # Step 1 — gather corpus (sections + all phase prose).
    corpus_parts: list[str] = []
    for heading in SCAN_HEADINGS:
        sec = _extract_section(stripped, heading)
        if sec is not None:
            corpus_parts.append(sec)
    # also scan everything between `## Phase N` headers and the next `## Coverage Matrix` / `## Final Phase`
    phase_blocks = re.findall(
        r"^##\s+Phase\s+\d+.*?(?=^##\s+(?:Coverage Matrix|Failure scenarios|Global Definition|Final Phase|$))",
        stripped,
        re.MULTILINE | re.DOTALL,
    )
    corpus_parts.extend(phase_blocks)
    corpus = "\n".join(corpus_parts)

    signals = _scan_for_signals(corpus)
    if not signals:
        return FailureScenariosReport(
            external_io_detected=False,
            is_complete=True,
            reasons=("no external-I/O signals detected; check skipped",),
        )

    failure_section = _extract_section(stripped, "Failure scenarios")
    section_present = failure_section is not None

    if not section_present:
        return FailureScenariosReport(
            external_io_detected=True,
            signals_sample=tuple(signals[:5]),
            section_present=False,
            is_complete=False,
            reasons=(
                f"plan declares external-I/O signals ({len(signals)} unique) "
                "but `## Failure scenarios` section is missing — happy-path tests "
                "do not prove resilience under timeout/5xx/connection reset",
            ),
        )

    explicit_none = bool(ESCAPE_RE.search(failure_section))
    scenarios = _count_scenarios(failure_section)

    reasons: list[str] = []
    is_complete = True

    if explicit_none:
        # Author claims no external I/O after all; trust the explicit declaration.
        # The signals detected may be examples or third-party references in prose.
        return FailureScenariosReport(
            external_io_detected=True,
            signals_sample=tuple(signals[:5]),
            section_present=True,
            explicit_none=True,
            scenarios_count=scenarios,
            is_complete=True,
            reasons=(
                "external-I/O signals detected but plan declares explicit "
                "'(none — no external I/O touched)'; trusted",
            ),
        )

    if scenarios == 0:
        is_complete = False
        reasons.append(
            "`## Failure scenarios` section is present but has zero populated rows; "
            "every external dependency needs ≥ 1 failure scenario (mode + reproduction + expected behavior)"
        )

    return FailureScenariosReport(
        external_io_detected=True,
        signals_sample=tuple(signals[:5]),
        section_present=True,
        explicit_none=False,
        scenarios_count=scenarios,
        is_complete=is_complete,
        reasons=tuple(reasons),
    )
