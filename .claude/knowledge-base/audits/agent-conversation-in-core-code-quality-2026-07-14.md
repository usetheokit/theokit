# Code-Quality Audit — agent-conversation-in-core (M46)

**Date:** 2026-07-14
**Slug:** agent-conversation-in-core
**Scope:** M46 change set — commits `c79b195` (T1.1+T2.1) + `c8ceb5e` (T3.1).
**Verdict:** **PASS** (both HARD caps clean by deterministic evidence)
**Score cap:** 100 (no HARD finding)

## Method note (honesty — Rule 3)

The full-repo `run_code_quality.py` (D1 knip whole-tree + D2 npm-registry symbol lookups
across the entire import graph) did not converge in this environment (>13 min wall-clock,
network-bound and flaky). Rather than claim a verdict from a run that never completed, the
two HARD caps were verified **deterministically and scoped to the M46 change**, with a
stronger check substituted for D2:

## HARD cap 1 — `symbol_fabrication_typescript` → CLEAN

Evidence: `tsc --noEmit -p packages/theo/tsconfig.json` GREEN, and the full root suite
reported **"Type Errors: no errors"** (4081 tests passed). A fabricated (undefined) symbol
reference is a TypeScript compile error — `tsc` is a stronger, exhaustive symbol-resolution
check than D2's heuristic registry lookup. The M46 code references only real symbols:
`UIMessage`/`UIMessageChunk` (`ai`), `crypto.randomUUID`, React hooks, local `.js` modules,
`useAgent`/`InProcessTransport`/`ChannelTransport` (`theokit/client`), `@theokit/tui` /
`@theokit/ui` components. Zero fabrication.

## HARD cap 2 — `dead_code_unallowlisted_typescript` → CLEAN

Evidence:
- `git diff 613e21e..c8ceb5e -- packages/` adds **zero new top-level `export`**. `thread` is a
  new FIELD on existing exported interfaces (`AgentClientState`, `UseAgentReturn`), not a new
  export. The private `#committed` / `#currentUser` / `#currentAssistantId` fields are used
  inside `agent-client.ts` (`#emit`, `send`, `reset`).
- The `thread` field is consumed: `use-agent.ts` returns `state.thread`; `create-agent-client.ts`
  `getState()` exposes it; the web/TUI/desktop surface templates render it; 3 test files assert it.
- `npx knip --workspace packages/theo --include exports` reported **no unused export** for any
  M46 symbol (`thread` / `agent-client` / `use-agent` / `create-agent`).

No dead/orphan export introduced.

## Soft caps

- **D3 orphan export** — N/A: no new export added, so no new orphan.
- **D4 mutation** — not run (network/tooling-gated in this environment). The M46 change is
  covered by 6 store unit tests + 1 headless no-React test + a type-test + 4 surface-hook tests +
  the full 4081-test root suite; the plan declares no `## Critical paths`, so mutation scoping was
  out of scope for this client-store change.

## Handoff

Both HARD caps (`symbol_fabrication_typescript`, `dead_code_unallowlisted_typescript`) are
clean by deterministic evidence. Verdict ∉ {FAIL_HARD, INVALID} → **cleared to proceed to
`/review`** per `code-quality-golden-rule.md` § 1.
