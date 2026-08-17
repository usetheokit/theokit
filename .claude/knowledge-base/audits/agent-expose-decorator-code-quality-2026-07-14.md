# Code-Quality Audit — agent-expose-decorator (M47)

**Date:** 2026-07-14
**Slug:** agent-expose-decorator
**Scope:** M47 change set — commits `494824b`, `344a7a2`, `f863814`, `6ce5f74`, `3fee2a5`, `acdf585`, `84e7fee` (base `50c2ad0`).
**Verdict:** **PASS** (both HARD caps clean by deterministic evidence)
**Score cap:** 100 (no HARD finding)

## Method note (honesty — Rule 3)

The full-repo `run_code_quality.py` (D1 knip whole-tree + D2 npm-registry symbol lookups across the entire
import graph) does not converge in this environment (>13 min, network-bound; documented in the M46 audit).
Rather than claim a verdict from a run that never completed, the two HARD caps were verified
**deterministically and scoped to the M47 change**, with a stronger check substituted for D2.

## HARD cap 1 — `symbol_fabrication_typescript` → CLEAN

Evidence: `pnpm typecheck` (whole workspace) exits 0 — **"Type Errors: no errors"** across the full root
suite (4101 tests passed). A fabricated (undefined) symbol reference is a TypeScript compile error, so a
green workspace `tsc` is an exhaustive symbol-resolution check stronger than D2's heuristic registry lookup.
The M47 code references only real symbols (`InferAgentInput`/`InferAgentToolNames` from `@theokit/agents`,
`InProcessTransport`/`ChannelTransport`/`HttpTransport`, `mountAgent`, `resolveProvider`, reflect-metadata
seams). Zero fabrication. The `typecheck-clean-gate` integration test also asserts this in the suite.

## HARD cap 2 — `dead_code_unallowlisted_typescript` → CLEAN

Evidence:
- The M47 diff adds these public exports, each with production consumers (grep, excluding defs/tests/dist):
  `Expose` (9), `ServeAgent` (2), `AgentHandle` (4), `agentHandle` (3), `isAgentHandle` (2), plus
  `ExposeOptions`/`ExposeEntry` (consumed by the walker + serveAgent seam).
- `npx knip --workspace packages/theo --include exports` and `--workspace packages/http` report **no unused
  export** for any M47 symbol.
- Every new symbol is exercised by ≥ 1 test: `expose-decorator.test.ts`, `walk-metadata-expose.test.ts`,
  `serve-exposed-agent.test.ts`, `expose-agent-dispatch.test.ts`, `agent-handle.test.ts`,
  `agent-handle-binders.test.ts`, `agents-typed-client.test.ts`, `agent-transport-types.test-d.ts`,
  `agent-exposure-reconciliation.test.ts`.

No dead/orphan export introduced.

## Soft caps

- **D3 orphan export** — N/A: every new export has a production caller (above).
- **D4 mutation** — not run (network/tooling-gated). M47 is covered by ~30 new unit/integration/type tests
  + the full 4101-test root suite; the plan declares no `## Critical paths`.

## Additional M47-specific gates (in the suite)

- `agent-exposure-reconciliation.test.ts` — grep gate proves `@theokit/http` (where `@Expose` lives) ships
  NO agent streamer (one runtime = `mountAgent`) — the ADR-M47-3 reconciliation invariant.
- `clean-break-grep-gate.test.ts` — no removed proprietary agent symbols reappear in src.

## Handoff

Both HARD caps clean by deterministic evidence. Verdict ∉ {FAIL_HARD, INVALID} → **cleared to proceed to
`/review`** per `code-quality-golden-rule.md` § 1.
