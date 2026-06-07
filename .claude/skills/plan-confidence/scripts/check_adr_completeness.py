"""ADR completeness check: each ADR must list alternatives in Rationale.

A plan has the structure:
  ## ADRs

  ### D1 — Title
  - **Decisão:** ...
  - **Rationale:** ... alternative rejected ... or similar
  - **Consequências:** ...

  ### D2 — Title
  ...

An ADR is "complete" iff its Rationale section explicitly mentions
alternatives (Portuguese: "alternativa", "rejeitada", "rejected", "instead of").

Returns ADRReport with total, with_alternatives, completeness_ratio, missing IDs.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

ADR_HEADER_RE = re.compile(r"^###\s+(D\d+)\s*[—\-–:]", re.MULTILINE)
ADRS_SECTION_RE = re.compile(r"^##\s+ADRs?\s*$", re.MULTILINE)
NEXT_H2_RE = re.compile(r"^##\s+", re.MULTILINE)

# Keywords that indicate alternative-consideration in Rationale (v1.1+ #4 fix: expanded).
ALTERNATIVE_KEYWORDS = (
    # Direct mentions
    "alternativa",
    "alternatives",
    "alternative",
    "rejeitada",
    "rejected",
    "rejeitar",
    # Comparisons
    "instead of",
    "vs.",
    "vs ",
    "em vez de",
    "ao invés de",
    "ao inves de",
    # Trade-off / decision pattern
    "trade-off",
    "tradeoff",
    "trade off",
    "trade-offs",
    # Why-not pattern
    "why not",
    "por que não",
    "por que nao",
    # "Considered X" pattern
    "considered ",
    "considerada",
    "considerado",
    # Alt A/B/C inline
    " alt a",
    " alt b",
    " alt c",
)


@dataclass(frozen=True)
class ADRReport:
    total_adrs: int
    with_alternatives: int
    completeness_ratio: float
    missing_alternatives: tuple[str, ...] = field(default_factory=tuple)


def _extract_adrs_section(content: str) -> str:
    """Extract content from '## ADRs' header to next H2."""
    m = ADRS_SECTION_RE.search(content)
    if m is None:
        return ""
    start = m.end()
    nxt = NEXT_H2_RE.search(content, pos=start)
    end = nxt.start() if nxt else len(content)
    return content[start:end]


def _split_into_adr_blocks(section: str) -> dict[str, str]:
    """Split section into {adr_id: body} dict."""
    blocks: dict[str, str] = {}
    matches = list(ADR_HEADER_RE.finditer(section))
    for i, m in enumerate(matches):
        adr_id = m.group(1)
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(section)
        blocks[adr_id] = section[start:end]
    return blocks


def _has_alternative_mention(adr_body: str) -> bool:
    lower = adr_body.lower()
    return any(kw in lower for kw in ALTERNATIVE_KEYWORDS)


def _has_global_alternatives_section(content_lower: str) -> bool:
    """Detect template-style '## Alternativas Rejeitadas' section with entries."""
    section_headers = (
        "## alternativas rejeitadas",
        "## rejected alternatives",
        "## alternatives considered",
    )
    for header in section_headers:
        alt_pos = content_lower.find(header)
        if alt_pos == -1:
            continue
        after = content_lower[alt_pos : alt_pos + 5000]
        entry_keywords = ("alt a", "alt b", "alt c", "rejeitada por", "rejected by")
        if any(kw in after for kw in entry_keywords):
            return True
    return False


def check_adr_completeness(plan_path: Path) -> ADRReport:
    """ADR is 'complete' if its own body mentions alternatives OR if the plan has
    a global '## Alternativas Rejeitadas' / '## Rejected Alternatives' section.

    v1.1 follow-up: plan template often groups alternatives in a single section,
    not per-ADR; both styles satisfy the intent.
    """
    content = plan_path.read_text(encoding="utf-8-sig")
    adr_section = _extract_adrs_section(content)
    blocks = _split_into_adr_blocks(adr_section)

    total = len(blocks)
    if total == 0:
        return ADRReport(
            total_adrs=0,
            with_alternatives=0,
            completeness_ratio=1.0,
            missing_alternatives=(),
        )

    if _has_global_alternatives_section(content.lower()):
        return ADRReport(
            total_adrs=total,
            with_alternatives=total,
            completeness_ratio=1.0,
            missing_alternatives=(),
        )

    missing: list[str] = []
    with_alt = 0
    for adr_id, body in blocks.items():
        if _has_alternative_mention(body):
            with_alt += 1
        else:
            missing.append(adr_id)

    return ADRReport(
        total_adrs=total,
        with_alternatives=with_alt,
        completeness_ratio=with_alt / total,
        missing_alternatives=tuple(sorted(missing)),
    )
