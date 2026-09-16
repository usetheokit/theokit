"""Cross-validation of BACKLOG.md against the git history that closed it.

What /review's cross-validation agent does, run mechanically: for every closed item, does the
commit named as its fix exist, and does its diff touch the code the item is about?

This is the gate the 2026-08-08 review RECOMMENDED after finding B-007's `fixed_in` commit never
touched the file its evidence named. Running it over the remediation that came out of that review
is the point.

Scoping, stated because a first version got it wrong: only `packages/**` paths count as "the code
the item is about". The `evidence:` line cites the REVIEW REPORT, which no fix should touch, and
`docs/` references are documentation the item talks about rather than code it changes. Counting
those produced 36 false findings — the exact fabrication this check exists to catch.

## What the headline counts, and why it used to count the wrong thing

Measured 2026-09-10: this printed `consistent : 124` while only 24 of those items had a fix checked
against a source path they name. The other 100 named no path at all, took a branch that appended
them to `ok` with the note "no source path named", and the note was never printed — the reporting
loop iterated problems only. So the second of the two questions in the paragraph above was asked of
a fifth of the items and answered for all of them.

"We checked this fix against the code it claims to touch" and "this fix exists" are different
claims, and only the first is what a reader takes `consistent` to mean. They are separate lines
now. The number went down; nothing about the repository got worse.

## A citation that stopped resolving is a finding, not a filter

The same run dropped relocated paths silently: `named = {n for n in named if Path(n).exists()}`,
with no comment and no report. Two repository-wide moves had gone through under it — B-162's
per-package `tests/` mirror and the 2026-09-10 theme fold — leaving 9 items naming a path that no
longer resolves, 5 of which lost their ONLY path and were then counted consistent having verified
nothing. The path-anchored citation rotted and the gate reported health rather than reporting the
rot. `tools/check-english-only.mjs` records the identical failure one file over, about its own
line-anchored exemption.

They are reported now, under their own heading. Deliberately NOT fatal: a stale citation says the
record needs re-anchoring, not that the fix was wrong, and reddening a required check over the
former would train people to ignore it. `exit_code` is the one place that decision lives, so
changing it is a one-line argument rather than a rewrite.

## Why there are functions here at all

Until 2026-09-10 this file was 86 lines with zero `def`, no `__main__` guard and a terminating
`sys.exit` at module scope — so importing it ran it and exited the interpreter. It was a required
status check that was untestable by construction, which is why the two branches above went
unexercised long enough to be found by review instead of by a test. `tools/test_check_backlog_crossval.py`
covers them now, and `pnpm run crossval` runs those tests ahead of the check.
"""
import re
import subprocess
import sys
import pathlib
from dataclasses import dataclass, field

SHA = re.compile(r"[0-9a-f]{7,40}")

#: `fixed_in:` must START a line — see `.prettierignore`, which excludes BACKLOG.md because a
#: reflow once moved three of these off column 0 and turned 0 problems into 3.
FIXED_IN = re.compile(r"^fixed_in: (.+)$", re.M)


@dataclass
class Report:
    """What the run looked at, in the states a reader actually needs told apart."""

    #: (bid, files touched, detail) — a fix checked against a source path the item itself names.
    verified: list = field(default_factory=list)
    #: (bid, files touched, reason) — the commit exists; nothing checked what it touched.
    unverified: list = field(default_factory=list)
    #: (bid, [paths]) — paths the item names that no longer resolve on disk.
    stale_paths: list = field(default_factory=list)
    #: (bid, what, detail) — the failures. The only category that decides the exit code.
    problems: list = field(default_factory=list)
    #: (bid, reason) — no local commit to check, by design.
    skipped: list = field(default_factory=list)


def closed_items(text):
    """`(bid, block)` for every item whose checkbox is ticked."""
    for block in re.split(r"\n(?=## B-\d+ — )", text):
        m = re.match(r"## (B-\d+) — (.*?)\s+\[(.)\]", block)
        if m and m.group(3) == "x":
            yield m.group(1), block


def sha_candidates(raw):
    """Every sha-shaped token in a `fixed_in:` value, split on commas AND whitespace.

    Two coverage gaps measured 2026-09-03, both of which made this gate report health over items it
    had not looked at:

      - `x.strip().split()[0]` took the FIRST token of each comma-separated part, so a
        space-separated pair (`2eb9c26 ea99717`) had its second commit silently dropped. Five items
        were in that shape.
      - The skip was `"theokit" in raw`, a substring test. B-094's `fixed_in` reads
        `c969e25 (TheoCode) · @theokit/agents@7.5.0 · …` — a LOCAL commit plus the upstream releases
        it shipped with — and the whole item was skipped because the word appeared.

    An item is skipped now only when it has no local commit to check, which is what "no local commit
    by design" claimed all along.
    """
    return [t for t in re.split(r"[,\s·]+", raw) if SHA.fullmatch(t)]


def named_source_paths(block):
    """The `packages/**` source files an item's own text names, evidence line excluded."""
    body = re.sub(r"^evidence:.*$", "", block, flags=re.M)
    named = set(re.findall(r"`(packages/[\w./-]+\.(?:ts|tsx))", body))
    named |= {
        f"packages/{p}"
        for p in re.findall(r"`((?:agent|cli|tui|shared)/src/[\w./-]+\.tsx?)", body)
    }
    return named


def _touched_by_fix(bid, raw, candidates, *, commit_exists, files_touched):
    """`(records, touched)` — the union of files the fix commits touched, or the problem records
    that explain why it could not be read. `touched is None` means classification stops here."""
    records, touched, missing = [], set(), False
    for s in candidates:
        if not commit_exists(s):
            records.append(("problems", (bid, "`fixed_in` names a commit that does not exist", s)))
            missing = True
            continue
        touched |= files_touched(s)
    if missing:
        return records, None
    if not touched:
        return [("problems", (bid, "`fixed_in` commit(s) touched no files", raw))], None
    return records, touched


def _check_named_paths(bid, block, touched, *, path_exists):
    """`records` for the named-source-path half: stale citations, then the verdict."""
    records = []
    named = named_source_paths(block)
    live = {n for n in named if path_exists(n)}
    stale = sorted(named - live)
    if stale:
        # Reported for its own sake. An item can have a perfectly good fix and a citation that
        # has since moved; the record is what rotted, and this gate exists to protect it.
        records.append(("stale_paths", (bid, stale)))

    if not named:
        records.append(("unverified", (bid, len(touched), "no source path named")))
        return records
    if not live:
        # The compound case, and the one that used to be invisible: the filter emptied the set
        # and the item fell through to the branch above, counted consistent having checked
        # nothing.
        records.append(
            ("unverified", (bid, len(touched), f"every source path it names has moved or been deleted: {', '.join(stale)}"))
        )
        return records

    hit = {n for n in live if any(n in tf for tf in touched)}
    if not hit:
        records.append(
            ("problems", (bid, "fix touched NONE of the source paths its own text names", ", ".join(sorted(live))))
        )
    else:
        records.append(("verified", (bid, len(touched), f"{len(hit)}/{len(live)} named source paths touched")))
    return records


def classify_item(bid, block, *, commit_exists, files_touched, path_exists):
    """`(report field, entry)` records for one closed item — the loop only dispatches them.

    Extracted from `cross_validate`'s loop body (Decompose Conditional): each classification used
    to be a guard branch in one nine-way body, and every new outcome grew the same function.
    """
    fx = FIXED_IN.search(block)
    if not fx:
        return [("problems", (bid, "closed with no `fixed_in`", "nothing records which commit closed it"))]
    raw = fx.group(1)

    candidates = sha_candidates(raw)
    if not any(commit_exists(s) for s in candidates):
        return [("skipped", (bid, "decision-only or upstream — no local commit by design"))]

    records, touched = _touched_by_fix(
        bid, raw, candidates, commit_exists=commit_exists, files_touched=files_touched
    )
    if touched is None:
        return records
    return records + _check_named_paths(bid, block, touched, path_exists=path_exists)


def cross_validate(text, *, commit_exists, files_touched, path_exists):
    """The decision, as a function of the registry and the history.

    The three collaborators are injected because the alternative is a test that describes this
    repository's current BACKLOG.md and goes red the day somebody closes an item — a test of the
    contents rather than of the rule.
    """
    report = Report()
    for bid, block in closed_items(text):
        for category, entry in classify_item(
            bid, block, commit_exists=commit_exists, files_touched=files_touched, path_exists=path_exists
        ):
            getattr(report, category).append(entry)
    return report


def render(report):
    """The lines the gate prints. Separate from the decision so a test can read them."""
    seen = len(report.verified) + len(report.unverified) + len(report.problems)
    lines = [
        f"closed items cross-validated : {seen}",
        f"  verified against a named source path : {len(report.verified)}",
        f"  commit exists, nothing else checked  : {len(report.unverified)}",
        f"  problems                             : {len(report.problems)}",
        f"  skipped (decision/upstream)          : {len(report.skipped)}",
    ]
    if report.stale_paths:
        lines += [
            "",
            f"  {len(report.stale_paths)} item(s) name a source path that no longer resolves.",
            "  The fix may be fine; the citation is not. Re-anchor it on the path the file moved to,",
            "  or say in the item that the file was deleted. A path-anchored citation that stopped",
            "  resolving is information about the record, which is what this gate protects.",
        ]
        for bid, paths in report.stale_paths:
            lines.append(f"    {bid}  {', '.join(paths)}")
    for bid, what, detail in report.problems:
        lines += ["", f"  {bid}  {what}", f"        {detail[:160]}"]
    return lines


def exit_code(report):
    """Only a problem fails the gate.

    An unverified item and a stale citation are both "we did not check this", which is not "this is
    wrong". Reddening a required status check over the difference would teach everyone to merge
    through it — the failure mode `.github/workflows/ci.yml` records in its own header about wiring
    a gate in red.
    """
    return 1 if report.problems else 0


def main():
    text = pathlib.Path("BACKLOG.md").read_text(encoding="utf-8")

    def git(*args):
        return subprocess.run(args, capture_output=True, text=True).stdout

    report = cross_validate(
        text,
        commit_exists=lambda sha: git("git", "cat-file", "-t", sha).strip() == "commit",
        files_touched=lambda sha: set(git("git", "show", "--name-only", "--format=", sha).split()),
        path_exists=lambda p: pathlib.Path(p).exists(),
    )
    print("\n".join(render(report)))
    return exit_code(report)


if __name__ == "__main__":
    sys.exit(main())
