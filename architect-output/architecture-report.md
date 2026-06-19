# Codebase Architecture Report — TheoKit framework core

**Target:** `packages/theo/src` · **Mode:** full · **Date:** 2026-06-19
**Scope:** 325 TS/TSX files · 37,289 LOC · 11 top-level modules

## Executive summary

TheoKit's core is a **healthy, well-organized package-by-feature framework**. The dependency graph is **fully acyclic** (0 circular dependencies across all 325 files and within the 186-file `server/`), the public surface is exposed through clean subpath exports, and the extensibility seams (deploy adapters, runtime backends) use **ADR-backed Adapter, Registry, and Strategy/DIP patterns that are correctly applied — not pattern theater**.

The issues found are *tidying*, not *rescue*: a large-but-cohesive `server/` umbrella with a grab-bag root, one infrastructure leak into the `core/` "domain" layer, and 96 deep cross-module imports that bypass the `./server` barrel. None is critical; all recommended fixes are **behavior-preserving moves and re-wiring**.

> **Architecture score: 84 / 100 — Verdict: Refactor Lightly**

## Score card (7 dimensions, weighted)

| # | Dimension | Score | Weight | Key finding |
|---|---|---|---|---|
| 1 | Folder Clarity | 17/20 (85%) | 20 | Clear top-level intent; only `server/` root needs tidying |
| 2 | Cohesion | 15/20 (75%) | 20 | Subdirs cohesive; loss is at package-root grab-bags |
| 3 | Coupling | 17/20 (85%) | 20 | Acyclic graph is a strength; deep-reach into `server/` internals is the one lever |
| 4 | Pattern Fit | 14/15 (93%) | 15 | Patterns are load-bearing and documented, not theater |
| 5 | Testability | 9/10 (90%) | 10 | In-memory backend impls give cheap mock seams |
| 6 | Scalability | 8/10 (80%) | 10 | Extensible at seams; request-pipeline duplication is the scaling tax |
| 7 | Onboarding Clarity | 4/5 (80%) | 5 | Good signposting; sheer size of `server/` raises entry cost |
| | **Overall** | **84.0/100** | 100 | **Refactor Lightly** |

## Current structure

```
packages/theo/src/
├── core/        (1,137 LOC, 13 files)  domain — pure contracts (+ 1 FS leak)
├── config/      (1,056 LOC, 16 files)  application — config load + Zod schema
├── router/      (  773 LOC,  6 files)  application — page-route scanning
├── client/      (1,301 LOC, 12 files)  application — theoFetch typed client
├── server/     (15,334 LOC,140 files)  infrastructure — the runtime (17 subdirs)
├── vite-plugin/ (4,214 LOC, 27 files)  infrastructure — build/dev integration
├── cli/         (4,445 LOC, 29 files)  infrastructure — theo commands
├── devtools/    (3,999 LOC, 38 files)  infrastructure — React overlay
├── adapters/    (1,997 LOC, 14 files)  infrastructure — 9 deploy targets
├── cache/       (1,482 LOC, 13 files)  infrastructure — route cache engine
└── services/    (1,528 LOC, 16 files)  infrastructure — polyglot services + services.json
```

Architectural style: **package-by-feature** with a thin pure-contracts domain (`core/contracts`), an application layer (`config`/`router`/`client`), and an infrastructure layer dominated by `server/` (41% of LOC). Public API via subpath exports (`.`, `./server`, `./server/auth`, `./server/http`, …).

## Strengths (positive findings — preserve these)

1. **Zero circular dependencies** — `madge --circular` on the whole tree and within `server/` both return clean. The Acyclic Dependencies Principle holds. *Add `madge --circular` to CI to keep it that way.*
2. **Correct layer direction** — `core/` (domain) imports no sibling infrastructure; `config`/`router`/`client` import no infra internals.
3. **ADR-backed extensibility seams** — `DeployAdapter` port + typed `Record<BuildTarget, …>` registry (OCP, exhaustive, lazy import, ADR-D1); `JobBackend`/rate-limit/observability/cache **Strategy/DIP** backends with in-memory + production impls (ADR-0002).
4. **Cohesive `server/` subdirs** — each maps to one concern (`http`, `auth`, `security`, `rate-limit`, `observability`, `jobs`, `cron`, `webhook`, `agent`, `scan`).
5. **`server/_internal` correctly hidden** from public subpath exports and from cross-module imports.

## Concrete problems (with file evidence)

| Sev | Finding | Evidence | Fix (behavior) |
|---|---|---|---|
| medium | **Deep-reach coupling** — 96 imports of `../server/<subdir>/<file>` bypass the `./server` barrel (52 from `vite-plugin`) | `vite-plugin/action-middleware.ts:5-12` imports `server/http/action-execute`, `server/observability/logger`, `server/scan/action-scan` directly | Add `server/internal-api.ts` re-export; rewire (none) |
| medium | **`server/` root grab-bag** — 7 loose files mix concerns beside 17 subdirs | `server/web-handler.ts` (639 LOC, largest file), `body-parser.ts`, `body-parser-web.ts`, `transformer.ts`, `serialization.ts` | Move into `server/http`, `server/body`, `server/serialize` (none) |
| medium | **Infra-in-domain** — `core/` mixes pure contracts with FS I/O | `core/validate-structure.ts:5` imports `node:fs`/`node:path` | Relocate out of `core/` (none) |
| medium | **Duplicated request pipelines** — Node vs Web paths drift | `server/http/execute.ts` (Node) vs `server/web-handler.ts:197` (`paramsRaw={}` "no params yet"); two body parsers | **Deferred / risky** — owned by active plan |
| low | **Naming** — 3 `manager`/`helpers` suffixes + generic `_internal` | `channel-manager.ts`, `storage-manager.ts`, `process-spawn-helpers.ts` | Rename to behavior names (none) |

## Design pattern assessment

| Pattern | Where | Verdict |
|---|---|---|
| Adapter + Registry | `adapters/types.ts` + `adapters/registry.ts` (9 targets) | ✅ present_correct — OCP, TS-exhaustive, lazy import (ADR-D1) |
| Strategy / DIP backends | `server/jobs/job-backend.ts`, `rate-limit/`, `observability/adapter-registry.ts`, `cache/storage-adapter.ts` | ✅ present_correct — neutral interfaces, in-memory + prod impls (ADR-0002) |
| Factory DSL (`defineXxx`) | `server/define/` (8 factories) | ✅ present_correct — minimal, coherent public surface |
| Unified request pipeline | `server/http/execute.ts` vs `server/web-handler.ts` | ⚠️ missing_beneficial — Node/Web duplication (intentionally deferred) |

No misapplied or cargo-culted patterns detected.

## Incremental migration plan (all behavior-preserving except step 6)

| # | Step | Type | Behavior | Risk | Validation |
|---|---|---|---|---|---|
| 1 | Pin acyclic graph in CI | test_verification | none | low | `madge --circular packages/theo/src` |
| 2 | Tidy `server/` root into subdirs | move | none | low | `vitest run && tsc --noEmit` |
| 3 | Extract `core/validate-structure.ts` → contracts-only `core/` | move | none | low | `vitest run && tsc --noEmit` + grep purity |
| 4 | `server/internal-api.ts` barrel + rewire 52 vite-plugin imports | boundary_enforcement | none | medium | `vitest run && tsc --noEmit` + grep no deep imports |
| 5 | Rename `manager`/`helpers` files (optional) | rename | none | low | `vitest run && tsc --noEmit` |
| 6 | Converge Node + Web pipelines (**deferred**) | pattern_extraction | risky | high | full suite + adapter integration + per-runtime smoke |

## Validation checklist

- [ ] `npx madge --circular --extensions ts,tsx packages/theo/src` → no cycles (and added to CI)
- [ ] `npx tsc --noEmit` green after each move
- [ ] `npx vitest run` green after each step
- [ ] `grep -rL node:fs packages/theo/src/core` confirms `core/` purity after step 3
- [ ] No `../server/<subdir>/<file>` imports remain in `vite-plugin/` after step 4

## Final verdict

**Refactor Lightly (84/100).** This is a mature, well-factored framework core. Spend effort on the three behavior-preserving tidies (steps 2–4) and on locking the acyclic invariant in CI (step 1). Do **not** impose Clean/Hexagonal layering or split `server/` on LOC alone — that would be pattern theater on an already-healthy codebase. The single deeper structural issue (Node/Web pipeline duplication) is correctly owned by the active `crossval-native-routing-web-fixes` plan and should not be rushed.

## Disposition (resolved 2026-06-19 — plan `architecture-report-cleanup`)

Each migration step was reconciled against the authoritative `.claude/rules/architecture.md` + enforced `.dependency-cruiser.cjs` + size budgets (G6/G11/G13) before acting.

| Step | Disposition | Evidence |
|---|---|---|
| 1 — pin acyclic graph in CI | ✅ **Resolved** (re-scoped) | Acyclic already CI-enforced via `dependency-cruiser no-circular` (`architecture-guards.yml`); added `no-cross-module-internal-import` (the unenforced privacy half of Invariant 3). Commit `2016fdf`. |
| 3 — core purity | ✅ **Done** | `validate-structure.ts` moved `core/`→`config/`; guard test `core-purity.test.ts`; ADR 0027. Commit `1d71d59`. |
| 4 — decouple vite-plugin from server internals | ✅ **Done** | `server/internal-api.ts` contract; 9 vite-plugin modules rewired; contract test. Commit `9ec56a3`. |
| 2 — tidy server/ root grab-bag | ⏸️ **Deferred** (net-negative) | ≈35-site churn (18 test files), worsens `transformer` cross-module depth, touches hot 639-LoC `web-handler.ts`, doesn't fix the real G6 LoC issue. ADR 0028. |
| 5 — rename manager/helpers | ⏸️ **Declined** (false positives) | `storage-manager` is public+test-guarded (breaking rename); `channel-manager` is a legit registry; `process-spawn-helpers` distinguishes from sibling `process-spawn.ts`. ADR 0028. |
| 6 — converge Node/Web pipelines | ⏸️ **Deferred** | risky/high per this report's own verdict; owned by active `crossval-native-routing-web-fixes` plan (params+middleware already shipped). ADR 0028. |

---
*Generated by loop-codebase-architect · evidence persisted in `architect-output/codebase-architect.db`*
