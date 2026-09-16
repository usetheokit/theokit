# 0001 — Keep architecture decision records in the versioned tree

- Status: accepted
- Date: 2026-09-10

## Context

Architectural decisions in this repository were recorded, but nowhere a clone could browse them:
`.claude/records/adrs/` is gitignored by declared policy (personal tooling reaches one machine
only), and the rationale that does travel is spread across `CHANGELOG.md` entries and rule files
with no decision index. The 2026-09-10 architecture review registered this as a structural
finding (folder observation #9): 54,570 lines of TypeScript/Python/shell across more than 12
feature domains, and no `docs/adr/` or `docs/decisions/` in the git tree.

## Decision

`docs/adr/` is the versioned home for architecture decision records. It carries the subset of
decisions a consumer of the open-source repository needs — not the personal maintenance records,
which stay under `.claude/` by the existing policy. Files are numbered once and never renumbered;
a superseded decision stays in place and names its successor.

## Consequences

- A clone gets the decision index; rationale is no longer machine-local.
- The CHANGELOG keeps recording consumer-visible change; ADRs record why the shape is what it is.
- Decisions recorded before this directory existed are not backfilled wholesale — they are added
  when something forces them to be re-read, which is the moment their absence costs something.
