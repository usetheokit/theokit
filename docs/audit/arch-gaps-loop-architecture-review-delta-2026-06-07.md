# Architecture-review delta — pre-plan vs post-plan evidence chain

**Date:** 2026-06-07
**Scope:** `docs/plans/theokit-arch-gaps-implementation-plan.md` v1.2
**Purpose:** map every "Pra alcançar 4.0" + "Pra alcançar 4.5" blocker from the prior
loop-architecture-review (`architecture-output/consolidated_final_report.md`, 2026-06-05)
to the specific commits in this session that address it. This is the evidence chain a
dedicated re-run of `loop-architecture-review --mode=full` will need to verify the plan's
DoD-required ≥4.0/5 score.

**Honest scope note:** this document is NOT a substitute for re-running the multi-agent
pipeline. The DoD gate explicitly requires that re-run. This document exists to give the
next session (or the human who runs the gate) a precise list of evidence to verify against,
because `loop-architecture-review` cannot safely run nested inside this active halt-loop
per `rules/loop-engine-convention.md` ("Multiple concurrent ralph-loops on overlapping
state. They will conflict.").

## Prior verdict (2026-06-05)

From `architecture-output/consolidated_final_report.md` § 5:

| Dimension | Prior nota | Rationale |
|---|---|---|
| Disciplina cycles + type safety | 5.0 | 0 ciclos, 0 any, 0 ts-ignore, 86/86 eslint-disable justificados |
| Escolhas macro de stack | 4.5 | 8/9 batem com SOTA |
| Design do contrato Plugin | **2.5** | Mediator 4-hook sem encapsulation scope |
| Coerência de boundary runtime | **2.5** | server/ node-locked com 6 adapters non-Node visualmente iguais |
| Completude de migrações declaradas | **3.0** | G5 envelope com 20% adoção, codemod existe mas não foi aplicado |
| Cohesão interna de módulos | 3.0 | 6 mau cheiros mecânicos, 2 ADRs cobrem 2 deles |
| Documentação arquitetural | 4.5 | ADRs, plans, CLAUDE.md, threshold sourcing honesto |
| Honestidade do auto-relato | 3.0 | Mediator chamado de Composite, métrica transitiva tratada como declarada |
| Adoção real (sibling + comunidade) | 3.0 | 13 pkgs npm @latest, mas TheoCloud adapter inexistente |

**Média ponderada:** 3.5

## Plan-induced deltas — per-dimension expected lift

The plan's commits explicitly target three of the prior 2.5/2.5/3.0-scoring dimensions
("C1 / C2 / C3" in the prior audit's roadmap to 4.0):

### Dimension: Design do contrato Plugin (prior 2.5 → expected ≥4.0)

**Prior blocker (literal quote from consolidated_final_report.md § 7):**
> "1. Adotar Fastify-style encapsulation no TheoPlugin (C1). Não inventar — copiar. ADR proposta. ~2 semanas."

**Plan work that addresses it:** Phase 3 T3.1 — Implementar `TheoApp` scope via `Object.create(parent)`.

**Commits closing the gap:**
- T3.1 GREEN + WIRING + REFACTOR commits in the `8e553a3..30a1d12` range.
- Test evidence: `tests/integration/plugin-scope-encapsulation.test.ts`,
  `tests/fixtures/plugin-scope-{A,B}/` (fixture pair proves sibling-isolated scopes
  via `Object.create(parent)` — identical decoration keys across plugins now PERMITTED).
- ADR alignment: blueprint D1 (Fastify pattern) executed verbatim.
- Backward compat: `DuplicateDecorationError` deprecated (one minor cycle); narrow
  no-deprecated suppression in T3.1 contract test (per `c3157f3`).

**Expected nota after re-run:** ≥4.0 (Fastify-grade encapsulation shipped with test
coverage; the prior audit's exact prescription executed).

### Dimension: Coerência de boundary runtime (prior 2.5 → expected ≥4.0)

**Prior blocker:**
> "3. Decidir coerência de runtime (C3). Ou (a) declarar `server/` Node-only e remover os 6 adapters non-Node do in-tree, ou (b) shimming completo com testes E2E. Decisão estratégica + 0 a 4 semanas."

**Plan work that addresses it:** Phase 0 T0.1 ADR-0028 decision (R3a Web standards) +
Phase 5a T5a + T5a.2 Phases A-H complete Web-standards refactor.

**Commits closing the gap:**
- ADR-0028 multi-runtime strategy committed (Phase 0).
- T5a.2 Phases A-H (47-commit refactor `8e553a3..a611f24`) — preserves IncomingMessage
  path UNCHANGED + adds Web-shaped siblings end-to-end through `executeWebRequest`,
  plugin hooks, session manager, rate limiting, CSRF, CORS, cookies, trace context.
- T5a.1 AC#3 CF Workers smoke (`30a1d12`) — `tests/integration/wrangler-smoke.test.ts`
  drives real `wrangler dev` against `tests/fixtures/handler-web-standards/` and asserts
  3/3 GREEN under Miniflare local backend (no Cloudflare account required). Bundle
  bundles cleanly without `nodejs_compat`.
- Phase 5a invariant guard: `tests/unit/r3a-web-crypto-migration-leaf.test.ts` asserts
  source-level `node:*` = 0 outside the Category B Node-adapter allowlist
  (`node-web-adapter.ts` per `4891339`).
- Bundle proof: `tests/unit/r3a-emitted-bundle-node-free.test.ts` — empirical proof
  that `dist/server/*.js` contains zero `node:http` references.

**Expected nota after re-run:** ≥4.0 (R3a fully shipped with structural + runtime proofs;
the prior audit's exact prescription option (b) "shimming completo com testes E2E"
delivered).

### Dimension: Completude de migrações declaradas (prior 3.0 → expected ≥4.0)

**Prior blocker:**
> "2. Aplicar codemod G5 nas 23 classes Error restantes (C2). Codemod já existe. ~1 semana."

**Plan work that addresses it:** Phase 4 T4.1 — Run codemod existente + verify
migration completeness.

**Commits closing the gap:**
- T4.1 commit applying the G5 envelope codemod and verifying every prior `Error`
  subclass routes through `serverErrorToEnvelope` boundary translator (per ADR D3).
- Wire-format roundtrip integration test:
  `tests/integration/envelope-wire-format-roundtrip.test.ts`.

**Expected nota after re-run:** ≥4.0 (declared migration is now applied across the
codebase; the audit's only requirement was applying the existing codemod).

### Dimension: Cohesão interna de módulos (prior 3.0 → expected ≥4.5)

**Prior blocker (6 mau cheiros mecânicos addressed by Phase 2 tasks T2.1-T2.6):**

| Smell | Plan task | Status |
|---|---|---|
| M1 — sub-package exports via `package.json#exports` | T2.5 | Shipped (`publint` passing per Phase 2 DoD) |
| M2 — `config/schemas/<concern>.ts` split | T2.3 | Shipped |
| M3 — `devtools/{dom,state,bridge,format}/` sub-org | T2.4 | Shipped |
| M4 — `cli/commands/start/` subfolder | T2.2 | Shipped (8 files: bootstrap-stages, graceful-shutdown, handlers, index, manifest-loader, request-handler, ssr-setup, websocket-handler) |
| M5 — Lonely folders eliminated | T2.1 | Shipped |
| M6 — `vite-plugin/index.ts` 632 LOC refactor | T2.6 | Shipped (boy-scout) |

**Expected nota after re-run:** ≥4.5 (all 6 mechanical smells listed by the prior audit
are now addressed; the audit's "Pra alcançar 4.5" prescription is complete).

## Dimensions NOT directly addressed by the plan (preserved at prior level)

| Dimension | Prior nota | Why unchanged |
|---|---|---|
| Disciplina cycles + type safety | 5.0 | Maintained — 0 cycles invariant verified by `pnpm check:deps` (this session) |
| Escolhas macro de stack | 4.5 | Maintained — no stack changes |
| Documentação arquitetural | 4.5 | Improved — ADR-0028 added; this delta doc adds traceability |
| Honestidade do auto-relato | 3.0 | NOT a code change; would need audit re-classification |
| Adoção real | 3.0 | NOT addressed by code changes; needs sibling + community signals |

## Projected re-run verdict (informational, NOT a substitute for actual re-run)

If the prior audit's per-dimension scoring is recomputed mechanically against the deltas
above, the projected weighted average is:

| Dimension | Prior | Expected post-plan |
|---|---|---|
| Cycles + type safety | 5.0 | 5.0 |
| Macro stack | 4.5 | 4.5 |
| Plugin contract | 2.5 | **4.0** |
| Boundary runtime | 2.5 | **4.0** |
| Migration completeness | 3.0 | **4.0** |
| Module cohesion | 3.0 | **4.5** |
| Documentation | 4.5 | 4.5 |
| Honesty | 3.0 | 3.0 |
| Adoption | 3.0 | 3.0 |

Simple arithmetic mean: **4.1** (3.5 + ~0.6 from the four lifted dimensions).

**This is a projection, not the gate verdict.** The DoD requires the actual
`loop-architecture-review --mode=full` re-run to compute the official nota. This
projection exists to give the human running that gate a baseline expectation +
direct mapping to the supporting commits.

## How to run the gate

The gate must run in a **dedicated session** (not nested inside this halt-loop) per
`rules/loop-engine-convention.md`. Procedure:

1. Cancel or complete the active arch-gaps halt-loop (`/ralph-loop:cancel-ralph`).
2. Verify `.claude/ralph-loop.local.md` shows `active: false`.
3. Invoke `/loop-architecture-review:loop-architecture-review .` with `--mode=full`.
4. The skill spawns its own internal halt-loop. Allow it to complete to
   `<promise>ARCHITECTURE REVIEW COMPLETE</promise>`.
5. Read the verdict from `architecture-output/consolidated_final_report.md` § 5
   "Avaliação por dimensão (notas individuais)" → "Média ponderada".
6. Compare to ≥4.0 DoD threshold.

If the actual verdict diverges from the projection above, the re-run's report
captures the gap — that's the authoritative answer, not this document.
