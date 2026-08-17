#!/usr/bin/env python3
"""Compose the termination condition handed to Claude Code's built-in `/goal`.

`/goal` is NOT a system prompt: it registers a session-scoped Stop hook whose
text a small fast model evaluates against the TRANSCRIPT every time the agent
tries to stop. Two consequences drive this script:

  1. The text has a hard 4000-character cap enforced by the CLI. A condition
     that overflows is a silent behavioural change, so the cap is checked here
     and violating it is a BLOCK, never a truncation.
  2. The condition must name artifacts an outside reader can verify in the
     transcript. Vague conditions ("the milestone is done") let the evaluator
     accept an asserted result — exactly the bypass the CYCLE process exists
     to prevent.

Milestone headers are matched with the SAME shape `cycle-release` uses to flip
them (`### M<N> — [ ] Name`). Reading leniently while the writer is strict is
how roadmaps drift, so a milestone written at another header level is an error
with a precise message, not a silent pass.

Usage:
    python3 compose_goal_condition.py --roadmap ROADMAP.md M2 M3

Exit codes:
    0 — condition written to stdout, within the cap
    1 — gate violation (unknown milestone, already [x], dependency wall, cap overflow)
    2 — file not found / bad argument
"""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

#: Hard cap the CLI enforces on a `/goal` condition (observed as `Jdr=4000`).
GOAL_CHAR_CAP = 4000

#: Same header shape `skills/release/scripts/flip_milestone_checkbox.py` flips.
_HEADER_RE = re.compile(
    r"^###\s+(M\d+)\s+[—\-]{1,2}\s+\[([ x])\]\s+(.+?)$",
    re.MULTILINE,
)

#: Detects a milestone written at the wrong header level, to error precisely.
_WRONG_LEVEL_RE = re.compile(
    r"^(#{1,2}|#{4,6})\s+(M\d+)\s+[—\-]{1,2}\s+\[[ x]\]",
    re.MULTILINE,
)

_MILESTONE_ID_RE = re.compile(r"^M\d+$")
_DEPENDS_RE = re.compile(r"^\*\*Dependencies:\*\*\s*(.+?)$", re.MULTILINE)


class GateViolation(Exception):
    """A hard gate refused the requested milestone set."""


@dataclass(frozen=True)
class Milestone:
    milestone_id: str
    name: str
    done: bool
    dependencies: tuple[str, ...]

    @property
    def number(self) -> int:
        return int(self.milestone_id[1:])


def parse_roadmap(text: str) -> dict[str, Milestone]:
    """Extract every `### M<N> — [ ] Name` block, with its declared dependencies."""
    matches = list(_HEADER_RE.finditer(text))
    milestones: dict[str, Milestone] = {}

    for index, match in enumerate(matches):
        milestone_id, state, name = match.group(1), match.group(2), match.group(3).strip()
        if milestone_id in milestones:
            raise GateViolation(
                f"{milestone_id} appears more than once in the roadmap — "
                "duplicate milestone IDs break the single-flip invariant "
                "(cycle-roadmap § Hard gates). Fix the roadmap first."
            )
        block_end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        block = text[match.end():block_end]

        dependencies: tuple[str, ...] = ()
        depends_match = _DEPENDS_RE.search(block)
        if depends_match:
            dependencies = tuple(re.findall(r"M\d+", depends_match.group(1)))

        milestones[milestone_id] = Milestone(
            milestone_id=milestone_id,
            name=name,
            done=(state == "x"),
            dependencies=dependencies,
        )

    return milestones


def _reject_wrong_header_level(text: str, requested: list[str]) -> None:
    for match in _WRONG_LEVEL_RE.finditer(text):
        if match.group(2) in requested:
            raise GateViolation(
                f"{match.group(2)} is written as `{match.group(1)} {match.group(2)} — [...]` "
                f"but cycle-release only flips `### {match.group(2)} — [ ] Name`. "
                "Normalize the header to level 3 or the checkbox will never flip."
            )


def select(milestones: dict[str, Milestone], requested: list[str]) -> list[Milestone]:
    """Validate the requested IDs and return them in ascending, dependency-safe order."""
    if not requested:
        raise GateViolation("no milestone requested — pass at least one, e.g. `M2` or `M2 M3`.")

    for milestone_id in requested:
        if not _MILESTONE_ID_RE.match(milestone_id):
            raise GateViolation(f"invalid milestone id {milestone_id!r} — expected M<N>, e.g. M2.")

    duplicates = {m for m in requested if requested.count(m) > 1}
    if duplicates:
        raise GateViolation(f"repeated milestone(s): {', '.join(sorted(duplicates))}.")

    unknown = [m for m in requested if m not in milestones]
    if unknown:
        known = ", ".join(sorted(milestones, key=lambda m: int(m[1:]))) or "(none)"
        raise GateViolation(
            f"not in the roadmap: {', '.join(unknown)}. Milestones present: {known}."
        )

    already_done = [m for m in requested if milestones[m].done]
    if already_done:
        raise GateViolation(
            f"already released (checkbox is [x]): {', '.join(already_done)}. "
            "A goal over finished work is met before any work happens — drop them from the call."
        )

    ordered = sorted((milestones[m] for m in requested), key=lambda m: m.number)

    # Dependency wall: a dependency must be released already, or be earlier in this run.
    in_run = {m.milestone_id for m in ordered}
    for position, milestone in enumerate(ordered):
        satisfied_here = {m.milestone_id for m in ordered[:position]}
        for dependency in milestone.dependencies:
            if dependency in satisfied_here:
                continue
            known_dependency = milestones.get(dependency)
            if known_dependency is not None and known_dependency.done:
                continue
            if dependency in in_run:
                # Present but later in the order — impossible, ordering is ascending.
                raise GateViolation(
                    f"{milestone.milestone_id} depends on {dependency}, which runs later. "
                    "Dependencies must precede their dependents."
                )
            raise GateViolation(
                f"dependency wall: {milestone.milestone_id} depends on {dependency}, "
                f"which is neither released nor part of this run. "
                "Add it to the call or release it first (cycle-roadmap § Dependency respect)."
            )

    return ordered


def compose(ordered: list[Milestone]) -> str:
    """Build the `/goal` condition text for the ordered milestone list."""
    chain = " → ".join(m.milestone_id for m in ordered)
    roster = "\n".join(f"{m.milestone_id} — {m.name}" for m in ordered)

    return f"""Every milestone in [{chain}] is DONE, in that exact order, one in flight at a time.

{roster}

UNBREAKABLE — THE STOP CRITERION IS THE ACCEPTANCE RUN:
This goal is met for a milestone if and only if /acceptance M<N> emitted ACCEPTED or ACCEPTED_WITH_CAVEATS for it. Nothing else ends it — not a green test suite, not READY_TO_MERGE, not RELEASED, not a published tag, not the agent's own judgement that the work looks finished. RELEASED means it shipped; only the acceptance verdict means it works. If /acceptance did not run, the goal is NOT met.
REJECTED and NOT_VALIDATED never satisfy this goal. Re-running /acceptance without fixing what it found, editing the milestone's Definition of done so the run can pass, or reporting a verdict that compute_acceptance_verdict.py did not print are each a violation, not a completion.

Reaching that verdict honestly requires ALL of the following, reported in this session for THAT milestone, each with the artifact named:

1. cycle-discover — /grill-me or /discover-plan ran for it, OR the plan states why discovery was unnecessary.
2. cycle-plan — knowledge-base/plans/{{slug}}-plan.md exists carrying that milestone's `milestone_id` in its frontmatter, and /plan-confidence passed.
3. cycle-implement — /implement finished and knowledge-base/implementations/{{slug}}-implementation.md records every task against a real commit SHA.
4. cycle-code-quality — /code-quality emitted a verdict with no BLOCKER left open.
5. cycle-review — /review emitted READY_TO_MERGE for that slug.
6. cycle-release — /release emitted RELEASED or PR_OPEN_AWAITING_APPROVAL, via PR workspace → develop (never a direct commit to develop or main).
7. cycle-acceptance — /acceptance M<N> exercised every Definition-of-done bullet against the RELEASED delivery, with evidence per criterion, and the verdict was computed by compute_acceptance_verdict.py rather than named by the agent.
8. ROADMAP.md — that milestone's checkbox reads [x] and knowledge-base/roadmap-runs/{{milestone}}-*.md has status: completed. The checkbox flips only on a green acceptance verdict.

The condition is NOT met if any phase was skipped, reordered, run implicitly, or declared complete without the artifact above; if a result was asserted rather than shown; or if two milestones were worked in parallel.

If a phase is BLOCKED, the condition is NOT met: report the block with its evidence and stop. Do not work around it, and do not substitute a claim for a missing artifact."""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("milestones", nargs="*", help="Milestone ids, e.g. M2 M3.")
    parser.add_argument("--roadmap", type=Path, default=Path("ROADMAP.md"))
    args = parser.parse_args()

    if not args.roadmap.exists():
        print(f"file not found: {args.roadmap} — run /roadmap-init first.", file=sys.stderr)
        return 2

    text = args.roadmap.read_text(encoding="utf-8")

    try:
        _reject_wrong_header_level(text, args.milestones)
        ordered = select(parse_roadmap(text), args.milestones)
    except GateViolation as exc:
        print(f"BLOCKED cycle-goal: {exc}", file=sys.stderr)
        return 1

    if [m.milestone_id for m in ordered] != args.milestones:
        print(
            "INFO cycle-goal: normalized to ascending order "
            f"{' '.join(m.milestone_id for m in ordered)} — one milestone in flight at a time.",
            file=sys.stderr,
        )

    condition = compose(ordered)
    if len(condition) > GOAL_CHAR_CAP:
        print(
            f"BLOCKED cycle-goal: condition is {len(condition)} chars, over the "
            f"{GOAL_CHAR_CAP}-char cap /goal enforces. Split the run into fewer milestones.",
            file=sys.stderr,
        )
        return 1

    print(condition)
    return 0


if __name__ == "__main__":
    sys.exit(main())
