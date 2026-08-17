#!/usr/bin/env python3
"""Structural review of a ROADMAP.md — inconsistencies, clarity, cohesion.

The check catalog is not invented here. It is the union of `roadmap-init`
§ Anti-patterns (12 items) and the annotated failure list in
`skills/roadmap-init/fixtures/bad-roadmap-vague-milestones.md` (18 items), plus
the two downstream contracts a roadmap must satisfy to be executable at all:
`cycle-acceptance` reads each milestone's Definition of done as its acceptance
criteria, and `cycle-release`'s flip only matches `### M<N> — [ ] Name`.

Findings carry a severity AND a `source` label:

    deterministic — the check is exact (a dependency cycle either exists or not)
    heuristic     — the check is a signal, not a proof (wish-words, layer names)

Mixing the two silently is how a reviewer's confident tone outruns what it can
actually know, so the label travels with every finding to the report.

The verdict is DERIVED from the findings, never asserted:

    BLOCKER present → INVALID
    MAJOR present   → NEEDS_REVISION
    MINOR only      → SHIPPABLE_WITH_CAVEATS
    none            → SHIPPABLE

Usage:
    python3 check_roadmap_structure.py --roadmap ROADMAP.md [--json]

Exit codes:
    0 — SHIPPABLE or SHIPPABLE_WITH_CAVEATS
    1 — NEEDS_REVISION or INVALID
    2 — file not found
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

#: Cap from roadmap-init: M0..M8. Above 9 the project must be split, not inflated.
MILESTONE_CAP = 9

#: Header shape cycle-release flips and cycle-acceptance reads.
_HEADER_RE = re.compile(r"^###\s+(M\d+)\s+[—\-]{1,2}\s+\[([ x])\]\s+(.+?)$", re.MULTILINE)

#: A milestone header at any level, with or without a checkbox — to catch malformed ones.
_LOOSE_HEADER_RE = re.compile(r"^(#{1,6})\s+(M\d+)\s*[—\-]{0,2}\s*(\[[ x]\])?\s*(.*?)$", re.MULTILINE)

_DOD_HEADING_RE = re.compile(r"^\*\*Definition of done[^*]*:\*\*\s*$", re.MULTILINE)
_DOD_BULLET_RE = re.compile(r"^-\s+\[[ x]\]\s+(.+?)\s*$", re.MULTILINE)
_NEXT_LABEL_RE = re.compile(r"^\*\*[^*]+:\*\*", re.MULTILINE)
_DEPENDS_RE = re.compile(r"^\*\*Dependencies:\*\*\s*(.+?)$", re.MULTILINE)
#: roadmap-init's template markers are Mustache-style SCREAMING_SNAKE (`{{V1_SHIP_CRITERION}}`).
#: Restricted to that shape on purpose: the good fixture legitimately writes `` `{{name}}` `` inside
#: a code span while explaining how to mark a cancelled milestone, and flagging that would make the
#: reference example of a GOOD roadmap fail its own review.
_PLACEHOLDER_RE = re.compile(r"\{\{[A-Z][A-Z0-9_]*\}\}")

#: Stripped before the placeholder scan — a marker quoted in prose or code is being discussed,
#: not left unfilled.
_CODE_FENCE_RE = re.compile(r"```.*?```", re.DOTALL)
_CODE_SPAN_RE = re.compile(r"`[^`\n]*`")
_HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)

#: Top-level sections roadmap-init writes. A roadmap missing them lost its framing.
REQUIRED_SECTIONS = ("Vision", "Problem", "Users", "Scope", "Constraints", "Success criteria", "Milestones")

#: Wish-words: a DoD bullet built on these has no predicate an outside reader can verify.
#: From roadmap-init anti-pattern 2 and the bad fixture ("improve performance" = vibes).
WISH_WORDS = (
    "improve", "improved", "better", "faster", "fast", "scalable", "robust",
    "clean up", "cleanup", "optimize", "optimise", "enhance", "polish",
    "best practices", "as needed", "etc", "and so on", "reliable", "performant",
)

#: Names that are layers or continuous work, not value deliveries (bad fixture 10, 16).
NON_MILESTONE_NAMES = (
    "backend", "frontend", "database", "logging", "monitoring", "caching",
    "refactor", "refactoring", "testing", "tests", "documentation", "docs",
    "performance", "cleanup", "clean up", "maintenance",
)

#: Digits or a unit make a bullet checkable; their absence is what the heuristic flags.
_MEASURABLE_RE = re.compile(r"\d|\bzero\b|\bnone\b|\bno\b\s", re.IGNORECASE)

BLOCKER, MAJOR, MINOR = "BLOCKER", "MAJOR", "MINOR"
DETERMINISTIC, HEURISTIC = "deterministic", "heuristic"

INVALID = "INVALID"
NEEDS_REVISION = "NEEDS_REVISION"
SHIPPABLE_WITH_CAVEATS = "SHIPPABLE_WITH_CAVEATS"
SHIPPABLE = "SHIPPABLE"


@dataclass
class Finding:
    check: str
    severity: str
    source: str
    where: str
    message: str

    def as_dict(self) -> dict[str, str]:
        return {
            "check": self.check,
            "severity": self.severity,
            "source": self.source,
            "where": self.where,
            "message": self.message,
        }


@dataclass
class Milestone:
    milestone_id: str
    name: str
    done: bool
    block: str
    dod_bullets: list[str] = field(default_factory=list)
    dependencies: tuple[str, ...] = ()
    has_dod_heading: bool = False
    has_dependencies_label: bool = False

    @property
    def number(self) -> int:
        return int(self.milestone_id[1:])


def parse(text: str) -> list[Milestone]:
    """Parse well-formed `### M<N> — [ ] Name` milestone blocks."""
    matches = list(_HEADER_RE.finditer(text))
    milestones: list[Milestone] = []

    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        block = text[match.end():end]

        dod_heading = _DOD_HEADING_RE.search(block)
        bullets: list[str] = []
        if dod_heading:
            tail = block[dod_heading.end():]
            next_label = _NEXT_LABEL_RE.search(tail)
            bullets = [b.strip() for b in _DOD_BULLET_RE.findall(tail[: next_label.start()] if next_label else tail)]

        depends_match = _DEPENDS_RE.search(block)
        dependencies = tuple(re.findall(r"M\d+", depends_match.group(1))) if depends_match else ()

        milestones.append(
            Milestone(
                milestone_id=match.group(1),
                name=match.group(3).strip(),
                done=(match.group(2) == "x"),
                block=block,
                dod_bullets=bullets,
                dependencies=dependencies,
                has_dod_heading=dod_heading is not None,
                has_dependencies_label=depends_match is not None,
            )
        )

    return milestones


def _find_dependency_cycles(milestones: list[Milestone]) -> list[list[str]]:
    """Return every dependency cycle, as ordered id lists."""
    graph = {m.milestone_id: [d for d in m.dependencies] for m in milestones}
    cycles: list[list[str]] = []
    seen_signatures: set[frozenset[str]] = set()

    def walk(node: str, path: list[str], visiting: set[str]) -> None:
        for dependency in graph.get(node, []):
            if dependency in visiting:
                cycle = path[path.index(dependency):] + [dependency]
                signature = frozenset(cycle)
                if signature not in seen_signatures:
                    seen_signatures.add(signature)
                    cycles.append(cycle)
                continue
            if dependency not in graph:
                continue
            walk(dependency, path + [dependency], visiting | {dependency})

    for milestone in milestones:
        walk(milestone.milestone_id, [milestone.milestone_id], {milestone.milestone_id})

    return cycles


def _strip_quoted(text: str) -> str:
    """Remove code fences, code spans and HTML comments — quoted content is discussed, not shipped."""
    for pattern in (_CODE_FENCE_RE, _HTML_COMMENT_RE, _CODE_SPAN_RE):
        text = pattern.sub(" ", text)
    return text


def _check_document(text: str, findings: list[Finding]) -> None:
    for placeholder in sorted(set(_PLACEHOLDER_RE.findall(_strip_quoted(text)))):
        findings.append(Finding(
            "unfilled_placeholder", BLOCKER, DETERMINISTIC, "document",
            f"`{placeholder}` was never filled in. A roadmap shipped with a template "
            "placeholder looks complete and rots silently (roadmap-init anti-pattern 10).",
        ))

    for section in REQUIRED_SECTIONS:
        if not re.search(rf"^#{{1,3}}\s+{re.escape(section)}", text, re.MULTILINE | re.IGNORECASE):
            findings.append(Finding(
                "missing_section", MAJOR, DETERMINISTIC, "document",
                f"No `## {section}` section. The roadmap lost the framing that makes its "
                "milestones interpretable.",
            ))

    out_of_scope = re.search(
        r"^#{1,4}\s+(?:Explicitly out of scope|Out of scope)\s*$(.*?)(?=^#{1,4}\s|\Z)",
        text, re.MULTILINE | re.DOTALL | re.IGNORECASE,
    )
    if out_of_scope:
        body = re.sub(r"<!--.*?-->", "", out_of_scope.group(1), flags=re.DOTALL)
        bullets = [b for b in re.findall(r"^[-*]\s+(.+)$", body, re.MULTILINE) if b.strip()]
        if not bullets:
            findings.append(Finding(
                "empty_out_of_scope", MAJOR, DETERMINISTIC, "Scope § out of scope",
                "Out-of-scope is empty. An uncontrolled boundary is the strongest available "
                "predictor of scope creep (bad-fixture item 5).",
            ))


def _check_malformed_headers(text: str, milestones: list[Milestone], findings: list[Finding]) -> None:
    well_formed = {m.milestone_id for m in milestones}
    for match in _LOOSE_HEADER_RE.finditer(text):
        level, milestone_id, checkbox, _name = match.groups()
        if milestone_id in well_formed:
            continue
        if level != "###":
            findings.append(Finding(
                "wrong_header_level", BLOCKER, DETERMINISTIC, milestone_id,
                f"Written as `{level} {milestone_id}` but cycle-release only flips "
                f"`### {milestone_id} — [ ] Name`. The checkbox would never flip.",
            ))
        elif checkbox is None:
            findings.append(Finding(
                "missing_checkbox", BLOCKER, DETERMINISTIC, milestone_id,
                "No `[ ]` checkbox in the header. Progress is invisible and cycle-acceptance "
                "has nothing to flip (bad-fixture item 14).",
            ))


def _check_milestone_set(
    milestones: list[Milestone], declared_ids: list[str], findings: list[Finding]
) -> None:
    # Cap and M0 are judged on every DECLARED milestone, well-formed or not. A roadmap whose
    # headers are all malformed still has too many milestones, and saying only "nothing parsed"
    # would bury the structural problem behind a formatting one.
    if len(set(declared_ids)) > MILESTONE_CAP:
        findings.append(Finding(
            "milestone_cap_exceeded", BLOCKER, DETERMINISTIC, "document",
            f"{len(set(declared_ids))} milestones, cap is {MILESTONE_CAP} (M0–M8). Above the cap this "
            "is a backlog wearing a roadmap's clothes — split the project (roadmap-init anti-pattern 1).",
        ))

    if declared_ids and "M0" not in declared_ids:
        findings.append(Finding(
            "missing_m0", MAJOR, DETERMINISTIC, "document",
            "No M0. M0 is always the walking skeleton — the thinnest end-to-end slice that proves "
            "the architecture. Without it the first milestone carries hidden integration risk.",
        ))

    unparsed = sorted(set(declared_ids) - {m.milestone_id for m in milestones}, key=lambda i: int(i[1:]))
    if unparsed:
        findings.append(Finding(
            "checks_skipped_behind_malformed_header", MINOR, DETERMINISTIC, ", ".join(unparsed),
            f"{len(unparsed)} milestone(s) could not be parsed, so the per-milestone checks "
            "(Definition of done, dependencies, vague bullets, cohesion) never ran on them. "
            "This report is therefore a FLOOR, not a full accounting — fix the header problems "
            "above and re-run to see what they were hiding.",
        ))

    if not milestones:
        findings.append(Finding(
            "no_milestones", BLOCKER, DETERMINISTIC, "document",
            "No well-formed `### M<N> — [ ] Name` milestone found. Nothing downstream "
            "(cycle-roadmap select, cycle-acceptance, the checkbox flip) can read this roadmap.",
        ))
        return

    seen: dict[str, int] = {}
    for milestone in milestones:
        seen[milestone.milestone_id] = seen.get(milestone.milestone_id, 0) + 1
    for milestone_id, count in seen.items():
        if count > 1:
            findings.append(Finding(
                "duplicate_milestone_id", BLOCKER, DETERMINISTIC, milestone_id,
                f"Declared {count}×. Duplicate ids break the single-flip invariant "
                "(cycle-roadmap § Hard gates).",
            ))

    known = {m.milestone_id for m in milestones}
    done = {m.milestone_id for m in milestones if m.done}

    for milestone in milestones:
        for dependency in milestone.dependencies:
            if dependency == milestone.milestone_id:
                findings.append(Finding(
                    "self_dependency", BLOCKER, DETERMINISTIC, milestone.milestone_id,
                    "Depends on itself.",
                ))
            elif dependency not in known:
                findings.append(Finding(
                    "unknown_dependency", BLOCKER, DETERMINISTIC, milestone.milestone_id,
                    f"Depends on {dependency}, which is not in the roadmap. The select phase "
                    "cannot resolve it and the milestone is permanently ineligible.",
                ))
            elif int(dependency[1:]) > milestone.number:
                findings.append(Finding(
                    "forward_dependency", MAJOR, DETERMINISTIC, milestone.milestone_id,
                    f"Depends on {dependency}, which comes later. Either the order is wrong or the "
                    "ids are — cycle-roadmap picks the lowest eligible id first.",
                ))
            if milestone.done and dependency in known and dependency not in done:
                findings.append(Finding(
                    "released_before_dependency", MAJOR, DETERMINISTIC, milestone.milestone_id,
                    f"Marked `[x]` while its dependency {dependency} is still `[ ]`. One of the two "
                    "checkboxes does not reflect reality.",
                ))

    for cycle in _find_dependency_cycles(milestones):
        findings.append(Finding(
            "dependency_cycle", BLOCKER, DETERMINISTIC, " → ".join(cycle),
            "Dependency cycle. No milestone in it can ever become eligible; the macro loop would "
            "emit ROADMAP_BLOCKED forever.",
        ))


def _check_milestone_quality(milestone: Milestone, findings: list[Finding]) -> None:
    where = milestone.milestone_id

    if not milestone.has_dod_heading:
        findings.append(Finding(
            "missing_definition_of_done", BLOCKER, DETERMINISTIC, where,
            "No `**Definition of done:**`. cycle-acceptance reads those bullets AS its acceptance "
            "criteria — without them the milestone can never be accepted, so its checkbox can never "
            "flip (roadmap-init anti-pattern 2).",
        ))
    elif not milestone.dod_bullets:
        findings.append(Finding(
            "empty_definition_of_done", BLOCKER, DETERMINISTIC, where,
            "Definition of done has no `- [ ]` bullets. An empty promise can be neither accepted "
            "nor rejected.",
        ))

    if not milestone.has_dependencies_label:
        findings.append(Finding(
            "missing_dependencies", MINOR, DETERMINISTIC, where,
            "No `**Dependencies:**` line. Write `none` explicitly — an absent line is ambiguous "
            "between 'no dependencies' and 'nobody thought about it'.",
        ))

    # Exact match only. `startswith` would flag "Backend rate limiting for the quota API",
    # which IS a delivery — and a heuristic that emits MAJOR must err toward silence, or the
    # reviewer trains people to ignore it.
    lowered_name = re.sub(r"[^a-z ]", "", milestone.name.strip().lower()).strip()
    if lowered_name in NON_MILESTONE_NAMES:
        findings.append(Finding(
            "milestone_is_not_a_delivery", MAJOR, HEURISTIC, where,
            f"Named {milestone.name!r} — that is a layer or continuous work, not a value "
            "delivery. Milestones slice vertically through the stack (bad-fixture items 10, 16).",
        ))

    if len(milestone.dod_bullets) == 1:
        findings.append(Finding(
            "thin_definition_of_done", MINOR, HEURISTIC, where,
            "Only one Definition-of-done bullet. Most milestones need more than one observable "
            "condition; a single bullet often hides the rest of the work.",
        ))

    for bullet in milestone.dod_bullets:
        lowered = bullet.lower()
        matched = [w for w in WISH_WORDS if w in lowered]
        if matched and not _MEASURABLE_RE.search(bullet):
            findings.append(Finding(
                "vague_dod_bullet", MAJOR, HEURISTIC, where,
                f"{bullet!r} leans on {matched[0]!r} with no number or threshold. Every bullet must "
                "be verifiable by an outside reader (roadmap-init anti-pattern 2).",
            ))


def review(text: str) -> tuple[str, list[Finding]]:
    """Return (verdict, findings) for a roadmap document."""
    findings: list[Finding] = []
    milestones = parse(text)

    declared_ids = [m.group(2) for m in _LOOSE_HEADER_RE.finditer(text)]

    _check_document(text, findings)
    _check_malformed_headers(text, milestones, findings)
    _check_milestone_set(milestones, declared_ids, findings)
    for milestone in milestones:
        _check_milestone_quality(milestone, findings)

    severities = {f.severity for f in findings}
    if BLOCKER in severities:
        verdict = INVALID
    elif MAJOR in severities:
        verdict = NEEDS_REVISION
    elif MINOR in severities:
        verdict = SHIPPABLE_WITH_CAVEATS
    else:
        verdict = SHIPPABLE

    return verdict, findings


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--roadmap", type=Path, default=Path("ROADMAP.md"))
    parser.add_argument("--json", action="store_true", help="Emit the full report as JSON.")
    args = parser.parse_args()

    if not args.roadmap.exists():
        print(f"file not found: {args.roadmap} — run /roadmap-init first.", file=sys.stderr)
        return 2

    verdict, findings = review(args.roadmap.read_text(encoding="utf-8"))

    if args.json:
        print(json.dumps(
            {"verdict": verdict, "findings": [f.as_dict() for f in findings]},
            ensure_ascii=False, indent=2,
        ))
    else:
        print(verdict)
        for finding in findings:
            print(
                f"  [{finding.severity}/{finding.source}] {finding.where}: "
                f"{finding.check} — {finding.message}",
                file=sys.stderr,
            )

    return 0 if verdict in {SHIPPABLE, SHIPPABLE_WITH_CAVEATS} else 1


if __name__ == "__main__":
    sys.exit(main())
