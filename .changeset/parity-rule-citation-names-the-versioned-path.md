---
'@theokit/agents': patch
---

Docblock-only: the three-target parity rule is cited at the path this repository versions.

The comment in `in-process-turn.ts` pointed at the kit-relative form of that path <!-- rule-citation-ok: naming the stale form here is what the entry is about -->, which resolves
nowhere for anyone who clones — `.claude/` is gitignored. The document it means is
`docs/program/three-target-parity.md`, tracked and 102 lines. No behaviour changes and no export
moves; the patch exists because the changeset gate reads a changed publishable package and cannot
tell a comment from a contract, which is the right default for it to have.
