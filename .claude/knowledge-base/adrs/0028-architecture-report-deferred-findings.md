# ADR 0028 — Architecture-report cleanup: deferred findings (server-root tidy, renames, Node/Web convergence)

**Status:** Accepted
**Date:** 2026-06-19
**Deciders:** project owner

## Context

The codebase-architecture audit (`architect-output/architecture-report.md`,
84/100 "Refactor Lightly") produced a 6-step migration plan. Steps 1, 3, 4 were
implemented (ADR 0027 + commits `2016fdf`, `1d71d59`, `9ec56a3`). This ADR records
the **deliberate, reviewed deferral** of Steps 2, 5, 6 after reconciling each
against the authoritative `.claude/rules/architecture.md`, the enforced
`.dependency-cruiser.cjs`, the size budgets in `system-design-guardrails.md`
(G6/G11/G13), and the actual blast radius measured in the tree.

Deferral here is a **resolution**, not an omission: each item was evaluated and
consciously declined with evidence. A finding's correct outcome can be "do not
act" when the change is net-negative.

## Decision

### Step 2 — tidy `server/` root grab-bag → **DEFERRED**

Moving the 5 loose `server/*.ts` files (`web-handler`, `body-parser`,
`body-parser-web`, `transformer`, `serialization`) into subdirs is declined now.

Evidence it is net-negative:

- **Blast radius ≈ 35 sites**, of which **18 are test files** that deep-import
  these modules (`tests/**/{body-parser,transformer,web-handler,serialization}`).
  That breadth is evidence these are *stable, widely-depended-upon surface*, not
  loose clutter.
- **`transformer.ts` is cross-module** (imported by `vite-plugin` ×5 + `cli` ×2).
  Moving it into a subdir makes those imports *deeper*, worsening architecture.md
  Invariant 3, not improving it.
- **`web-handler.ts` (639 LoC)** was just modified by the active
  `crossval-native-routing-web-fixes` plan (params + middleware, commits
  `2408a91`/`169d105`). Moving it adds needless merge risk on a hot file.
- The move is **cosmetic** — it does NOT fix the real underlying issue the file
  trips (G6: `web-handler.ts` 639 LoC > 500-LoC BLOCK). That needs *splitting*,
  which is risky deep surgery explicitly out of the report's scope, and the
  report's own verdict cautions: "do NOT split `server/` on LOC alone …
  `module_loc_max=2000` is folklore."

Re-evaluation trigger: when `web-handler.ts` is split for the Node→Web
convergence (Step 6 below), relocate the resulting smaller files into
`server/http/` in the same change (the moves become free once that file is
already being rewritten).

### Step 5 — rename `manager`/`helpers` files → **DECLINED (false positives)**

On inspection the three flagged names are correct domain concepts, not catch-all
god-modules:

- **`storage-manager`** — a public, entrenched subsystem (`StorageManager`).
  22 import sites including fixtures (`storage-manager-recipe/`), barrel-export
  tests, and CHANGELOG-guard tests (`changelog-storage-manager.test.ts`).
  Renaming is a **breaking public-API change**, not a cosmetic tidy.
- **`channel-manager`** — a cohesive realtime channel registry. "Manager" here
  is a legitimate registry role, not a grab-bag.
- **`process-spawn-helpers`** — its own header says "Pure helpers extracted from
  `process-spawn.ts` for unit testability". A sibling `process-spawn.ts` already
  exists, so the report's suggested rename (`→ process-spawn.ts`) would **collide**.
  The "helpers" suffix is the meaningful distinction.

The report tagged this step "optional, low / rename when convenient" with
`severity_source=heuristic`. The heuristic fired false positives.

### Step 6 — converge Node + Web request pipelines → **DEFERRED (owned elsewhere)**

The report's own verdict marks this `risky`/`high` and "should not be rushed".
It is owned by the active `crossval-native-routing-web-fixes` plan, which already
shipped the params + middleware work on the Web path. No action here.

## Alternatives considered

1. **Grind through Step 2's 35-site move anyway (rejected).** Pure checkbox
   completion at the cost of churn on hot files and 18 test rewrites, with zero
   enforced-invariant benefit. Violates KISS / G11 (YAGNI) / G13.
2. **Cherry-pick only `transformer` through `internal-api` (rejected).** Touching
   one cross-module deep import while leaving the other 145 is inconsistent; the
   broad barrel-enforcement decision is itself a documented YAGNI deferral (see
   the plan's reconciliation table).
3. **Rename `storage-manager` behind a deprecation alias (rejected).** A
   breaking rename of a public subsystem to satisfy a heuristic naming flag is
   not justified by any current pain.

## Consequences

- `server/` root keeps 7 files; cohesion score stays as-is (the report's "medium-
  heuristic" finding is accepted, not actioned).
- Public names (`StorageManager`, `ChannelManager`) unchanged — no consumer break.
- The high-value structural work (privacy boundary, core purity, internal-api
  decoupling) shipped; the cosmetic/heuristic remainder is documented here so it
  is not silently dropped.
- `architect-output/architecture-report.md` annotated with per-step disposition.
