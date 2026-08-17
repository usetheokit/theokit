---
type: Quality Gate
title: Phase 0 typecheck pre-flight gate (EC-203)
description: The gate that keeps non-SDK TypeScript errors at zero and isolates SDK-rooted ones, plus the run record it accumulated.
tags: [gate, typescript, ci, audit]
status: stable
generated: { by: process:typecheck-clean-gate, at: 2026-08-05T00:00:00Z }
migrated: { by: claude-opus-5/okf-skill, at: 2026-08-06T00:00:00Z, from: *.md }
sources:
  - id: gate-test
    resource: tests/integration/typecheck-clean-gate.test.ts
    title: The test that enforces and records this gate
    last_modified: 2026-08-05
  - id: run-records
    resource: the 15 phase-0-typecheck-pre-flight-YYYY-MM-DD.md records generated between 2026-07-05 and 2026-08-05
    title: Generated pre-flight run records, folded into the table below
---

The workspace must typecheck with **zero** TypeScript errors that are not rooted in
`@theokit/sdk`. SDK-rooted errors are counted and recorded separately rather than
suppressed, so a regression in our own code can never hide behind a dependency's.

# The gate

Enforced by `tests/integration/typecheck-clean-gate.test.ts`, which runs the real
`pnpm typecheck` rather than trusting a cached result. Three assertions, each a
distinct failure the gate exists to catch:

- **Zero total errors.** `pnpm typecheck` reports no `error TS` anywhere in the workspace.
- **SDK-rooted isolation (EC-203).** Errors matching the SDK surface — the
  `examples/full-stack-agent/server/tools` path, `toJSONSchema`, `ZodObject` — are counted
  into a dated pre-flight record. The gate is *no new SDK errors*, which is why the record is
  kept even while the count sits at zero.
- **No suppression directives.** No `// @ts-ignore` in `packages/theo/src` or `tests/`, and no
  orphan `@ts-expect-error` (an unnecessary one becomes a lint error, so an obsolete
  suppression cannot linger unnoticed).

# Run record

Each run writes a dated record. Every run so far has been clean on both counts.

| Date | SDK-rooted errors | Total TS errors |
|------|------------------:|----------------:|
| 2026-07-05 | 0 | 0 |
| 2026-07-06 | 0 | 0 |
| 2026-07-11 | 0 | 0 |
| 2026-07-12 | 0 | 0 |
| 2026-07-13 | 0 | 0 |
| 2026-07-14 | 0 | 0 |
| 2026-07-15 | 0 | 0 |
| 2026-07-16 | 0 | 0 |
| 2026-07-24 | 0 | 0 |
| 2026-07-27 | 0 | 0 |
| 2026-07-28 | 0 | 0 |
| 2026-08-02 | 0 | 0 |
| 2026-08-03 | 0 | 0 |
| 2026-08-04 | 0 | 0 |
| 2026-08-05 | 0 | 0 |

# Where the records live

The dated records are a **generated artifact**, not authored knowledge: the test rewrites
today's record on every run. They are therefore written outside this bundle, to
`.audit/typecheck/` (gitignored), because a generated file dropped into an OKF bundle would
carry no frontmatter and break the bundle's one hard rule.[^gate-test] Until 2026-08-06 they
accumulated in; the 15 records written there are folded into the table
above.[^run-records]

# Related
* [theokit-sdk-integration](/architecture/theokit-sdk-integration.md) — the seam whose errors this gate isolates.
* [sdk-agents](/agents/sdk-agents.md) — the surface that consumes the SDK types the gate watches.

[^gate-test]: `tests/integration/typecheck-clean-gate.test.ts`
[^run-records]: The generated pre-flight records, 2026-07-05 to 2026-08-05
