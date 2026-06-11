"""Acceptance Criteria + DoD executability check.

For each Acceptance Criterion (and each DoD bullet) in a plan, scores whether
the criterion is executable on three axes:

  (1) Observable verb     — uses an action that has a verifiable outcome
                            (not improve / optimize / enhance / clean up /
                            refactor without object / leverage / make better).
  (2) Measurable object   — has a number, a boolean behavior, a specific
                            output, OR cites a command whose exit code
                            answers the question.
  (3) Oracle              — names HOW to verify success: a command, an
                            assertion shape, a metric to read, a UI signal,
                            a comparison to a reference value.

A criterion scores 0..3 (one point per axis). The detector aggregates per-plan:

  - vague_ratio          = criteria with score == 0   / total
  - acceptable_ratio     = criteria with score >= 2   / total
  - executable_ratio     = criteria with score == 3   / total

Soft cap (verdict ≤ 70 / SHIPPABLE_WITH_CAVEATS) when:
  - vague_ratio        > 0.10  (more than 10% completely vague)
  OR acceptable_ratio  < 0.80  (less than 80% reach axes 1+2)

Returns ExecutabilityReport. The detector is intentionally heuristic and
honest about it: linguistic patterns CAN produce false positives. The output
lists every criterion with its score so a human can override in plan-improve.

Background: this detector exists to close the "plan vagueness propagation"
hole described in the architecture review — a vague Acceptance Criterion
silently survives plan-confidence today, then /implement's TDD invents a
threshold and wiring gives PASS to an artificial caller. See companion
gate in skills/implement/scripts/check_tdd_shape.py.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

# Section headers we scan for criteria. Plans use either "Acceptance Criteria"
# or "Definition of Done" or both; we treat their bullets equivalently.
SECTION_HEADER_RE = re.compile(
    r"^####?\s+(Acceptance\s+Criteria|Definition\s+of\s+Done|Global\s+DoD)\s*$",
    re.MULTILINE | re.IGNORECASE,
)
NEXT_HEADER_RE = re.compile(r"^#{1,4}\s+\S", re.MULTILINE)
BULLET_RE = re.compile(r"^\s*[-*]\s+(?:\[[ x]\]\s+)?(.+?)\s*$", re.MULTILINE)

# Vague verb patterns — substring matches break on object-in-the-middle
# ("Make the API better" doesn't contain "make better"), so we use regex.
# Each pattern matches the phrase in any criterion text (case-insensitive).
VAGUE_VERB_PATTERNS = (
    r"\b(?:improve|enhance|optimize|leverage|streamline|polish)\b",
    r"\bclean[\s-]?up\b",
    r"\brefactor\b",
    # "make X better/faster/robust/cleaner/…" where X is 0-3 words in between
    r"\bmake\b(?:\s+\w+){0,3}\s+(?:better|faster|robust|cleaner|smoother|nicer|prettier|easier)\b",
    # "be performant/reliable/robust/fast"
    r"\bbe\s+(?:performant|reliable|robust|fast|secure)\b",
    # "handle X gracefully" / "handle gracefully"
    r"\bhandle(?:\s+\w+){0,2}\s+gracefully\b",
    # "ensure quality/correctness/reliability/safety"
    r"\bensure\s+(?:quality|correctness|reliability|safety|robustness)\b",
    # "work properly" / "work correctly" / "behave correctly" / "look(s) good"
    r"\b(?:work|behave)s?\s+(?:properly|correctly|reliably|well)\b",
    r"\blooks?\s+good\b",
    # "as appropriate" / "where applicable" / "as needed" / "where relevant"
    r"\b(?:as|where)\s+(?:appropriate|needed|relevant|applicable)\b",
    # "should work" without a concrete what-does-it-do
    r"\bshould\s+work\b(?!\s+(?:with|when|for|in|by|after|before))",
)

# Tokens that indicate a MEASURABLE objective.
# Numbers, comparison operators, units, boolean shapes, file/command refs.
MEASURABLE_PATTERNS = (
    r"\b\d+(?:\.\d+)?\s*(?:ms|s|µs|us|ns|MB|GB|KB|%|req/s|rps|qps|fps|px)\b",  # number + unit
    r"\b(?:P50|P95|P99|p50|p95|p99)\b",                                         # percentile names
    r"[<>]=?\s*\d",                                                             # comparison operators
    r"\bexit\s+(?:code\s+)?[01]\b",                                             # exit code semantics
    r"\breturn(?:s)?\s+(?:true|false|0|1|null|None|nil)\b",                     # boolean/sentinel return
    r"\bequals?\s+\S",                                                          # equality assertion
    r"\bcontains?\s+\S",                                                        # containment assertion
    r"`[^`]+`",                                                                 # backtick-quoted code/command
)

# Tokens that indicate an ORACLE — how to know the criterion passed.
ORACLE_PATTERNS = (
    r"\bpytest\b|\bnpm test\b|\bgo test\b|\bcargo test\b",   # test command names
    r"\bassert(?:Equals?|True|False|Raises|That|In|NotEqual)\b",  # assertion APIs (handles assertEqual/assertEquals)
    r"\bcurl\b|\bhttp(?:s)?://\S",                            # HTTP call as observable
    r"`[^`]+`",                                               # backtick-quoted oracle
    r"\bgiven\b.+\bwhen\b.+\bthen\b",                         # GWT style
    r"\bmetric\s+\S+\s+(?:emits|is|shows|reports)\b",         # metric observation
    r"\blog\s+(?:entry|line|message)\s+(?:contains|matches)", # log oracle
    r"\b(?:returns?|outputs?|prints?|writes?|emits?)\s+\S",   # output verb + object
    r"\bP50|P95|P99\b.+[<>=]",                                # latency oracle
    r"\bcoverage\s+(?:>=|≥|>|=)\s*\d+",                       # coverage oracle
)


@dataclass(frozen=True)
class CriterionScore:
    """Per-criterion result. score = 0..3 (count of axes satisfied)."""

    text: str
    has_observable_verb: bool
    has_measurable_object: bool
    has_oracle: bool

    @property
    def score(self) -> int:
        return int(self.has_observable_verb) + int(self.has_measurable_object) + int(self.has_oracle)


@dataclass(frozen=True)
class ExecutabilityReport:
    total_criteria: int
    vague_count: int           # score == 0
    weak_count: int            # score == 1
    acceptable_count: int      # score == 2
    executable_count: int      # score == 3
    vague_ratio: float
    acceptable_ratio: float    # criteria with score >= 2
    executable_ratio: float    # criteria with score == 3
    criteria: tuple[CriterionScore, ...] = field(default_factory=tuple)

    @property
    def soft_cap_triggered(self) -> bool:
        """Heuristic-grade gate: >10% vague OR <80% reach acceptable."""
        if self.total_criteria == 0:
            return False
        return self.vague_ratio > 0.10 or self.acceptable_ratio < 0.80


def _has_observable_verb(text: str) -> bool:
    """True unless the criterion contains a vague-verb pattern.

    Note: the compensation case (vague verb + concrete oracle, e.g.
    'Improve P95 to <200ms') is intentionally NOT handled here — that
    case still fails axis (1), but compensates by passing axes (2) and
    (3), reaching score >= 2 which the aggregate considers acceptable.
    """
    if not any(ch.isalpha() for ch in text):
        return False
    for pattern in VAGUE_VERB_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return False
    return True


def _has_measurable_object(text: str) -> bool:
    for pattern in MEASURABLE_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return True
    return False


def _has_oracle(text: str) -> bool:
    for pattern in ORACLE_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return True
    return False


def _extract_criteria(content: str) -> list[str]:
    """Pull bullets out of every Acceptance Criteria / DoD section.

    A criterion is one bullet line under one of the target headers. Sections
    end at the next header of any level. We accept H3 / H4 to handle both
    plan-level and task-level criteria.
    """
    criteria: list[str] = []
    for section_match in SECTION_HEADER_RE.finditer(content):
        body_start = section_match.end()
        next_header = NEXT_HEADER_RE.search(content, pos=body_start)
        body_end = next_header.start() if next_header else len(content)
        body = content[body_start:body_end]
        for bullet in BULLET_RE.finditer(body):
            line = bullet.group(1).strip()
            if line:
                criteria.append(line)
    return criteria


def check_criterion_executability(plan_path: Path) -> ExecutabilityReport:
    content = plan_path.read_text(encoding="utf-8-sig")
    criteria_text = _extract_criteria(content)

    scored = tuple(
        CriterionScore(
            text=text,
            has_observable_verb=_has_observable_verb(text),
            has_measurable_object=_has_measurable_object(text),
            has_oracle=_has_oracle(text),
        )
        for text in criteria_text
    )

    total = len(scored)
    if total == 0:
        return ExecutabilityReport(
            total_criteria=0,
            vague_count=0,
            weak_count=0,
            acceptable_count=0,
            executable_count=0,
            vague_ratio=0.0,
            acceptable_ratio=1.0,  # vacuously acceptable (no criteria to grade)
            executable_ratio=1.0,
            criteria=(),
        )

    by_score = [0, 0, 0, 0]  # index = score 0..3
    for c in scored:
        by_score[c.score] += 1

    vague = by_score[0]
    weak = by_score[1]
    acceptable = by_score[2]
    executable = by_score[3]

    return ExecutabilityReport(
        total_criteria=total,
        vague_count=vague,
        weak_count=weak,
        acceptable_count=acceptable,
        executable_count=executable,
        vague_ratio=vague / total,
        acceptable_ratio=(acceptable + executable) / total,
        executable_ratio=executable / total,
        criteria=scored,
    )
