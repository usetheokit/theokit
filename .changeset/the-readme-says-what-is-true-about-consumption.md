---
"@theokit/agents": patch
---

Two rows of the foreign-surfaces table were false, and a test now checks the class they
belong to.

`agent-memory/` read *"Measured 2026-09-15: no consumer does yet"* while `apps/theocode`
imported `applySubagentMemory` and applied it in `delegation/role-discovery.ts:84-85`. The
measurement was true when taken — the consumer could not call it, because the function was
not in the version it pinned, and its own source says so: *"the one line that wires it does
not compile here yet"*. The integration was written, tested, and left disconnected, waiting
on a publish. Nothing about either side changed; the consumer moved into this repository and
the import resolved.

`themes/*.json` read *"nobody reads it, in any of the three packages"* and never said which
three. Naming them took one edit and the sentence failed immediately: `apps/theocode`
resolves `~/.claude/themes/` in `tui/src/theme/custom-theme.ts`, with three reads in that one
file. It is the same shape as `keybindings.json` — out of scope HERE, read by the consumer —
which this section had explicitly denied.

**A claim nobody can check is not a weaker claim; it is a claim that has never been tested.**

`an-absence-is-a-decision-or-it-is-a-gap.test.ts` now confronts any row asserting an absence
of consumption with the consumer's own source, and fails naming both. It reads TABLE ROWS
rather than the file — the first version matched the prose explaining the old claim, which is
the mistake that file already records one block below. Positive controls on both rows: each
restored claim fails the test with the reason.
