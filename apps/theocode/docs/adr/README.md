# Architecture Decision Records

Versioned, so a clone gets them. Decision rationale in this repository used to live in three
places that do not travel or are not decision-indexed: `.claude/records/adrs/` (gitignored by
declared policy — records under `.claude` reach one machine only), `CHANGELOG.md` entries, and
rule files. The 2026-09-10 architecture review measured 54,570 LOC across `packages/` + `tools/`
with more than 12 feature domains and no browsable ADR index in the git tree, and this directory
is the fix: the subset of decisions a consumer of the open-source repository needs, one file per
decision.

## Format

One Markdown file per decision, numbered, never renumbered. Superseded decisions stay, marked
`Superseded by NNNN` — the record of why something changed is worth more than a clean list.

```markdown
# NNNN — Imperative title

- Status: accepted | superseded by NNNN
- Date: YYYY-MM-DD

## Context
## Decision
## Consequences
```

## Index

- [0001 — Keep architecture decision records in the versioned tree](0001-versioned-adr-home.md)
- [0002 — Feature-first placement and one meaning per name](0002-feature-first-placement-and-naming.md)
