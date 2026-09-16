"""Tests for the backlog cross-validation gate.

Why this file exists. `check-backlog-crossval.py` is one of five required status checks on
`develop` and `main`, and it had no test — measured 2026-09-10. That was not an oversight anybody
could have fixed in an afternoon: the script was 86 lines with zero `def`, zero `class`, no
`__main__` guard and a terminating `sys.exit` at module scope, so importing it RAN it and killed
the interpreter. It was untestable by construction. The twelve `.mjs` checkers beside it have
eleven tests between them, and the two that lacked one were refactored on 2026-09-10 for exactly
this reason — the decision extracted from the process. This one was left behind.

Two branches nobody exercised are what the tests below pin, and both made the gate report health
over items it had not looked at:

  - an item whose text names no source path was appended to `ok` and counted "consistent" —
    100 of 124 on 2026-09-10;
  - a named path that had been relocated was dropped by an `.exists()` filter with no note, so
    five items whose ONLY citation had rotted were counted consistent having verified nothing.

Naming: `test_*.py` rather than the repository's `*.test.mjs` shape, because `unittest` discovery
imports a test module by name and `check-backlog-crossval.test` is not an importable identifier.
Run by `pnpm run crossval`, ahead of the check itself.
"""
import importlib.util
import pathlib
import unittest

_SPEC = importlib.util.spec_from_file_location(
    "check_backlog_crossval",
    pathlib.Path(__file__).with_name("check-backlog-crossval.py"),
)
crossval = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(crossval)


def item(bid, checkbox="x", body=""):
    return f"## {bid} — a title  [{checkbox}]\n{body}\n"


def run(text, *, commits=None, touched=None, existing=()):
    """The check, over a fabricated registry and a fabricated history.

    Injected rather than measured against this repository's own git: a test that asserted on the
    real BACKLOG.md would be a description of today's contents, and would go red the day somebody
    closed an item.
    """
    commits = commits or {}
    touched = touched or {}
    return crossval.cross_validate(
        text,
        commit_exists=lambda sha: sha in commits,
        files_touched=lambda sha: set(touched.get(sha, ())),
        path_exists=lambda p: p in set(existing),
    )


class CrossValidate(unittest.TestCase):
    def test_an_item_whose_fix_touched_a_path_it_names_is_verified(self):
        text = item("B-001", body="fixed_in: aaaaaaa\nsee `packages/agent/src/thing.ts`")
        report = run(
            text,
            commits={"aaaaaaa": True},
            touched={"aaaaaaa": ["packages/agent/src/thing.ts"]},
            existing=["packages/agent/src/thing.ts"],
        )
        self.assertEqual([b for b, *_ in report.verified], ["B-001"])
        self.assertEqual(report.problems, [])

    def test_an_item_naming_no_source_path_is_not_counted_as_verified(self):
        """The 100-of-124 case. Its commit exists; nothing checked WHAT the commit touched."""
        text = item("B-002", body="fixed_in: bbbbbbb\na decision, no code path named")
        report = run(text, commits={"bbbbbbb": True}, touched={"bbbbbbb": ["README.md"]})
        self.assertEqual(report.verified, [])
        self.assertEqual([b for b, *_ in report.unverified], ["B-002"])

    def test_a_named_path_that_no_longer_exists_is_reported(self):
        """The silent `.exists()` filter. A citation that stopped resolving is information about
        the record, which is the thing this gate exists to protect."""
        text = item("B-003", body="fixed_in: ccccccc\nsee `packages/tui/src/theme.ts`")
        report = run(
            text,
            commits={"ccccccc": True},
            touched={"ccccccc": ["packages/tui/src/theme/theme.ts"]},
            existing=[],
        )
        self.assertEqual([b for b, _ in report.stale_paths], ["B-003"])
        self.assertEqual(report.stale_paths[0][1], ["packages/tui/src/theme.ts"])

    def test_an_item_whose_only_named_path_moved_is_not_counted_as_verified(self):
        """The compound of the two above, and the one that mattered: five items landed in
        `consistent` because the filter emptied their path set and the empty set fell through to
        the no-path-named branch."""
        text = item("B-004", body="fixed_in: ddddddd\nsee `packages/agent/src/gone.ts`")
        report = run(text, commits={"ddddddd": True}, touched={"ddddddd": ["packages/agent/src/other.ts"]})
        self.assertEqual(report.verified, [])
        self.assertEqual([b for b, *_ in report.unverified], ["B-004"])

    def test_a_fix_touching_none_of_the_paths_it_names_is_a_problem(self):
        """The original defect this gate was built for: B-007's `fixed_in` commit never touched
        the file its evidence named."""
        text = item("B-005", body="fixed_in: eeeeeee\nsee `packages/agent/src/named.ts`")
        report = run(
            text,
            commits={"eeeeeee": True},
            touched={"eeeeeee": ["packages/cli/src/elsewhere.ts"]},
            existing=["packages/agent/src/named.ts"],
        )
        self.assertEqual([b for b, *_ in report.problems], ["B-005"])

    def test_a_closed_item_with_no_fixed_in_is_a_problem(self):
        report = run(item("B-006", body="nothing here"))
        self.assertEqual([b for b, *_ in report.problems], ["B-006"])

    def test_a_fabricated_sha_beside_a_real_one_is_a_problem(self):
        """Two shas, one of which resolves. The other is named as a fix and is not one."""
        text = item("B-007", body="fixed_in: aaaaaaa, fffffff\n`packages/a/src/b.ts`")
        report = run(text, commits={"aaaaaaa": True}, touched={"aaaaaaa": ["packages/a/src/b.ts"]})
        self.assertEqual([b for b, *_ in report.problems], ["B-007"])
        self.assertIn("does not exist", report.problems[0][1])

    def test_a_fix_whose_commits_touched_no_files_is_a_problem(self):
        """A commit that exists but shows an empty diff verified nothing — an empty merge or a
        mis-cited sha. This branch had no test when the 2026-09-10 architecture review measured
        the function's path deficit; it is pinned before the classification was extracted."""
        text = item("B-014", body="fixed_in: aaaaaaa\n`packages/a/src/b.ts`")
        report = run(text, commits={"aaaaaaa": True})
        self.assertEqual([b for b, *_ in report.problems], ["B-014"])
        self.assertIn("touched no files", report.problems[0][1])

    def test_a_sha_that_resolves_in_no_local_history_is_skipped_not_flagged(self):
        """MEASURED before it was asserted, because the first draft of this test asserted the
        opposite. Two closed items are in this shape — B-053 `94fd582e (theokit)` and B-093
        `bd5352fa (theokit)` — and both name a real commit in the UPSTREAM repository. A sha-shaped
        token that no local history knows is an upstream reference, which is what the skip has
        always meant; flagging it would turn two correct records into a red required check."""
        report = run(item("B-011", body="fixed_in: 94fd582e (theokit)\n`packages/a/src/b.ts`"))
        self.assertEqual([b for b, *_ in report.skipped], ["B-011"])
        self.assertEqual(report.problems, [])

    def test_an_item_with_no_local_commit_is_skipped_not_counted(self):
        """Upstream-only or decision-only items. Skipped is a third state, and it has always been
        reported separately from consistent."""
        report = run(item("B-008", body="fixed_in: @theokit/agents@7.5.0"))
        self.assertEqual([b for b, *_ in report.skipped], ["B-008"])
        self.assertEqual(report.verified, [])
        self.assertEqual(report.problems, [])

    def test_an_open_item_is_not_cross_validated(self):
        report = run(item("B-009", checkbox=" ", body="fixed_in: aaaaaaa"))
        self.assertEqual(report.verified + report.unverified, [])
        self.assertEqual(report.problems, [])

    def test_the_evidence_line_is_not_read_as_a_source_path(self):
        """Scoping the first version got wrong: `evidence:` cites the REVIEW REPORT, which no fix
        should touch. Counting it produced 36 false findings."""
        text = item(
            "B-010",
            body="fixed_in: aaaaaaa\nevidence: `packages/agent/src/cited.ts`\nno other path",
        )
        report = run(
            text,
            commits={"aaaaaaa": True},
            touched={"aaaaaaa": ["packages/other.ts"]},
            existing=["packages/agent/src/cited.ts"],
        )
        self.assertEqual(report.problems, [])
        self.assertEqual([b for b, *_ in report.unverified], ["B-010"])


class Rendering(unittest.TestCase):
    def test_the_headline_separates_verified_from_unverified(self):
        """The reporting half of the finding. `consistent : 124` answered "how many items did we
        see", while a reader takes it for "how many fixes did we check against their own code"."""
        text = item("B-001", body="fixed_in: aaaaaaa\n`packages/a/src/b.ts`") + item(
            "B-002", body="fixed_in: bbbbbbb\nno path"
        )
        report = run(
            text,
            commits={"aaaaaaa": True, "bbbbbbb": True},
            touched={"aaaaaaa": ["packages/a/src/b.ts"], "bbbbbbb": ["README.md"]},
            existing=["packages/a/src/b.ts"],
        )
        out = "\n".join(crossval.render(report))
        self.assertIn("verified against a named source path : 1", out)
        self.assertIn("commit exists, nothing else checked  : 1", out)

    def test_stale_citations_are_printed_not_only_counted(self):
        """The note "no source path named" existed in the data and was never printed, because the
        reporting loop iterated problems only."""
        text = item("B-003", body="fixed_in: ccccccc\n`packages/tui/src/theme.ts`")
        report = run(text, commits={"ccccccc": True}, touched={"ccccccc": ["packages/tui/src/theme/theme.ts"]})
        out = "\n".join(crossval.render(report))
        self.assertIn("B-003", out)
        self.assertIn("packages/tui/src/theme.ts", out)


class ExitCode(unittest.TestCase):
    def test_a_problem_fails_the_gate(self):
        report = run(item("B-006", body="no fixed_in"))
        self.assertEqual(crossval.exit_code(report), 1)

    def test_an_unverified_item_does_not_fail_the_gate(self):
        """Deliberate, and stated so it can be argued with: "we did not check this" is not "this
        is wrong". Making it fatal would red a required check over items whose fixes are fine."""
        report = run(item("B-002", body="fixed_in: bbbbbbb\nno path"), commits={"bbbbbbb": True},
                     touched={"bbbbbbb": ["README.md"]})
        self.assertEqual(crossval.exit_code(report), 0)


if __name__ == "__main__":
    unittest.main()
