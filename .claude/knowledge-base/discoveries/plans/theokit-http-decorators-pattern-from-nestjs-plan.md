# Discovery Plan: TheoKit HTTP Decorators Pattern (NestJS as primary reference)

> **Version 1.1** — Investigate NestJS Controllers decorator pattern (`@Controller`, `@Get`/`@Post`/etc., `@Body`/`@Param`/`@Query`, DTOs) and map every surface to either an equivalent on top of TheoKit's `defineRoute` OR an explicit out-of-scope decision. Blueprint enables downstream `/to-plan @theokit/http-decorators` to start immediately.

**Slug:** `theokit-http-decorators-pattern-from-nestjs`
**Owner:** paulohenriquevn
**Created:** 2026-06-07
**Revised:** 2026-06-07 (v1.1 absorbed 3 MUST FIX + 2 SHOULD TEST + 2 DOCUMENT from edge-case review at `.claude/knowledge-base/reviews/theokit-http-decorators-pattern-from-nestjs-edge-cases-2026-06-07.md`)
**Time budget:** 6h (per-project breakdown in ADR D1)

## Context

The macro `../CLAUDE.md` § "Backend DX packages" declares a planned package:

> ⏳ **P3 after P2** — `@theokit/http-decorators` (`@Controller`/`@Get`/`@Post`/Guards/Interceptors em CIMA do `defineRoute`, opt-in para times NestJS)

**Trigger evidence:** the user passed the canonical NestJS Controllers chapter as input to `/discover-plan` — the complete spec for `@Controller()`, HTTP-method decorators (`@Get`/`@Post`/`@Put`/`@Delete`/`@Patch`/`@Options`/`@Head`/`@All`), parameter decorators (`@Req`/`@Body`/`@Query`/`@Param`/`@Headers`/`@Ip`/`@HostParam`), `@HttpCode`, `@Header`, `@Redirect`, route wildcards, sub-domain routing, DTOs (classes), async/Observable handlers, library-specific `@Res` with `passthrough`, full resource sample, module wiring.

**Why now:** TheoKit's current backend layer (`packages/theo/src/server/define/`) is fully **factory-function-based** (`defineRoute`, `defineAction`, etc.). NestJS uses a fundamentally **different model**: TypeScript decorators + class-based controllers + reflect-metadata. Per `.claude/rules/architecture.md` v3.1 INVARIANT #3, public API must flow through barrels — the new `@theokit/http-decorators` package must respect that.

## Objective

**Produce a blueprint** that maps every NestJS controller pattern (per user-provided spec) to either (a) an equivalent surface implementable on top of TheoKit's `defineRoute` via `@theokit/http-decorators`, OR (b) an explicit "incompatible / out of scope" decision with rationale.

- [ ] All research questions in this plan answered with citations to `.claude/knowledge-base/references/` (or user-provided spec text)
- [ ] Cross-cutting comparison table populated: NestJS decorator → TheoKit `defineRoute` equivalent
- [ ] Recommendations section enumerates v0.1.0 API surface (which NestJS decorators in vs out)
- [ ] Bundle delta + tsconfig migration cost measured
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| **NestJS user-provided spec** (full Controllers chapter pasted in `/discover-plan` argument iter 79) | Entire Controllers chapter — `@Controller`, all 8 HTTP method decorators, parameter decorators, `@HttpCode`/`@Header`/`@Redirect`, route wildcards, sub-domain routing, async/Observable, DTOs, library-specific approach | Authoritative spec for migrating-team expectations per ADR-D1 |
| `.claude/knowledge-base/references/fastify/` | `lib/handle-request.js`, `lib/route.js`, `lib/request.js`, `lib/reply.js`, `lib/decorate.js` | Comparative routing-dispatch + decorate() conceptual sibling per ADR-D2 |
| `.claude/knowledge-base/references/hono/` | `src/hono.ts` chain pattern as negative reference | Alternative routing model — what TheoKit avoids by design |
| TheoKit current source (`packages/theo/src/server/define/`) | `define-route.ts`, `define-action.ts`, `define-middleware.ts`, `http/middleware-runner.ts`, `http/action-execute.ts`, `cli/commands/generate.ts`, `tsconfig.json`, `package.json` | Bridge surface to mirror; current factory-function API to wrap |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| NestJS Modules/Providers/DI chapter | Per ADR-D4 — `@theokit/http-decorators` ships HTTP-decorator slice only; DI delegated to `@theokit/di` |
| NestJS Pipes/Guards/Interceptors deep-dive chapters | Per ADR-D5 — light treatment in v0.1.0 (1 paragraph + "v0.2.0+ follow-up discovery") |
| NestJS Microservices, GraphQL, WebSockets-NestJS, Caching | Out of HTTP-decorator scope |
| `nest` repo (tsoa, routing-controllers) source clones | Per ADR-D1 — user-provided spec is authoritative; cloning these repos consumes iteration budget for marginal info |
| `.claude/knowledge-base/references/*/build/`, `dist/`, `.venv/` | Build artifacts |
| Any project NOT cloned into `.claude/knowledge-base/references/` (except user-provided spec) | Per Cross-Project Rule — never claim a project feature without reading its source |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** NestJS user-provided spec: 2h. `fastify/lib/`: 1h. `hono/` (negative ref): 30min. TheoKit `define-*.ts` re-read: 1h. Write blueprint: 1.5h. **Total: 6h.**

**Rationale:** NestJS spec is the primary investigative anchor (3 of 6 questions cite it directly); deepest dive there. Fastify gets a conceptual sibling read. Hono is just a negative-reference paragraph. TheoKit re-read confirms current API surface to mirror.

**Alternatives considered:** equal split (4×1.5h), nest-repo deep clone instead of spec-only.

**Stop condition — per question (mandatory):** When a question's investigation produces no concrete answer after 3 query variants OR after its share of time-budget, mark BLOCKED with reason "exhausted — no concrete pattern found" and continue.

**Stop condition — per project (mandatory):** When project time budget exhausted with N questions still pending, mark all remaining for that project BLOCKED. If every remaining project's questions are `done` OR `blocked`, emit `<promise>BLUEPRINT_BLOCKED</promise>` (NOT `BLUEPRINT_COMPLETE`).

**Anti-pattern:** NEVER fabricate decorator semantics or bridge code to close a BLOCKED question.

**Consequences:** halt-loop stops iterating when budget exhausted; blueprint surfaces blocked questions explicitly.

### D2 — Investigation depth

**Decision:** User-provided spec: Read end-to-end. Fastify: targeted Read of 5 files. Hono: 1-paragraph mention only. TheoKit: targeted Read of 8 files.

**Rationale:** Mixed depth justified by anchor importance. Avoids treating Hono (negative ref) with the same depth as NestJS (primary).

**Alternatives considered:** uniform deep-read across all (would blow the budget); pure grep-based (would miss decorator-semantic nuance).

**Consequences:** trade-off: less fastify implementation depth in exchange for completing NestJS mapping.

### D3 — Stage-3 vs Legacy decorators investigation cap

**Decision:** Investigate BOTH TS 5.x Stage-3 decorators AND legacy `experimentalDecorators` + `emitDecoratorMetadata`. Time-budget 30min on this specifically — if Stage-3 doesn't support reflect-metadata-style type emit (needed for DTO inference), DEFER full Stage-3 investigation and pick Legacy for v0.1.0.

**Rationale:** TS Stage-3 is the future; `emitDecoratorMetadata` enables NestJS-style `@Body() body: CreateCatDto` runtime DTO injection. If Stage-3 can't do that yet (likely in mid-2026), v0.1.0 ships Legacy + documented migration path.

**Alternatives considered:** Stage-3-only (bleeding edge, may not work); Legacy-only (without TC39 comparison, can't claim future-readiness).

**Consequences:** blueprint's Recommendations section commits to ONE decorator strategy + documents the migration path.

### D4 — Out-of-scope: NestJS Providers/DI/Modules

**Decision:** Explicitly NOT in-scope: NestJS `@Injectable` + `@Module` + provider DI surface. `@theokit/http-decorators` ships HTTP-decorator slice ONLY. Users wanting DI pair with `@theokit/di` (already shipped per macro CLAUDE.md).

**Rationale:** Scoping discipline (Rule 1 — 95% confidence). User's input is Controllers chapter, not Modules/Providers. Mirroring Module + DI container in v0.1.0 balloons scope.

**Alternatives considered:** include DI as Q7-Q9 (violates 5-10 question budget); fork `@theokit/di` to add Module surface (out of scope for this discovery).

**Consequences:** v0.1.0 ships HTTP-layer only. DI surface follow-up `/discover-plan` if/when demand surfaces.

### D5 — NestJS Pipes/Guards/Interceptors light treatment in v0.1.0

**Decision:** Pipes, Guards, Interceptors get ≤1 paragraph each in blueprint + explicit "v0.1.0: out; v0.2.0+: follow-up `/discover-plan`" decision. Q3 maps Guards conceptually to `defineMiddleware`, no more.

**Rationale:** Per EC-6 from edge-case review. Each surface deserves its own discovery cycle. Trying to cover all in this plan would burn 6h budget on incomplete answers.

**Alternatives considered:** include as Q7-Q9 (total > 10 violates question budget per cycle-discover sweet spot 5-10).

**Consequences:** blueprint v0.1.0 scope is HTTP routing + DTO bridge + basic middleware mapping. v0.2.0 follow-up plans Pipes/Guards/Interceptors deep-dive.

### D6 — Stage-3 vs Legacy: v0.1.0 LIKELY ships Legacy + documented Stage-3 migration path

**Decision:** Time-budget Stage-3 investigation at 30min (per D3). If `emitDecoratorMetadata`-style type emit isn't available in Stage-3 (likely mid-2026), v0.1.0 ships with Legacy `experimentalDecorators` + documented migration path. Stage-3 deep investigation deferred to follow-up `/discover-plan` once TC39 advances.

**Rationale:** Per EC-7. Stage-3 decorators don't fully support reflect-metadata-style runtime type emit needed for `@Body() body: CreateCatDto`. NestJS itself uses Legacy in 2026; teams expect Legacy semantics.

**Alternatives considered:** wait for Stage-3 readiness (delays v0.1.0 indefinitely); ship dual-mode (doubles surface area).

**Consequences:** v0.1.0 picks Legacy; a v0.2.0+ release re-evaluates Stage-3 when TC39 + TS support stabilize.

## Research Questions

Numbered list. Each maps to a Coverage Corner (tests / deps / tools / techniques). Each has explicit method.

| # | Question | Corner | Reference project(s) | Method (concrete) | Expected answer shape |
|---|---|---|---|---|---|
| Q1 | How does NestJS internally dispatch a decorator-marked method to an HTTP handler call? | techniques | User-provided NestJS spec + `.claude/knowledge-base/references/fastify/lib/` | Read user-provided spec end-to-end; Grep `.claude/knowledge-base/references/fastify/lib/handle-request.js` + `lib/route.js` for routing-dispatch internals; cross-reference `packages/theo/src/server/define/define-route.ts`. **Fallback (per EC-2):** if spec is incomplete (e.g., `@HostParam` semantics), add `docs.nestjs.com` to `.claude/rules/discover-web-allowlist.txt` and `WebFetch https://docs.nestjs.com/controllers#<anchor>`. | Diagram: NestJS decorator stack → `Reflect.getMetadata` → handler invocation; mapping table NestJS decorator → TheoKit `defineRoute` field; 5 worked examples (GET / POST / PUT / DELETE / GET-with-param) |
| Q2 | How would DTO classes (NestJS) translate to Zod schemas (TheoKit)? | techniques | User-provided NestJS spec + `packages/theo/src/server/http/action-execute.ts` | Read spec DTO section + `CreateCatDto` + Pipes' `metatype` runtime access; Read `action-execute.ts:1-100` to understand Zod consumption today; decide (a) auto-bridge DTO→Zod via reflect-metadata vs (b) user provides both. **Fallback per EC-2:** WebFetch `https://docs.nestjs.com/techniques/validation` if class-validator semantics missing in user-provided spec. | Decision tree (auto vs explicit) with cost/benefit; worked sample: `class CreateCatDto { @IsString() name; @Min(0) age; }` → `z.object({ name: z.string(), age: z.number().min(0) })`; honest limitation: class-validator decorator semantics don't map 1:1 to Zod |
| Q3 | How do NestJS Guards + Interceptors compose with TheoKit's existing `defineMiddleware`? | techniques | User-provided spec + `packages/theo/src/server/define/define-middleware.ts` + `packages/theo/src/server/http/middleware-runner.ts` | Read spec mentions of Guards/Interceptors (light per ADR-D5); Read `define-middleware.ts` + `middleware-runner.ts` (Chain of Responsibility per Phase 3 arch-review); map Guards (auth check, boolean) ↔ TheoKit middleware (mutation, returns Response or next). | Sequence diagram: NestJS Guards → Interceptors (pre) → Pipes → Handler → Interceptors (post) → Filters; equivalent: TheoKit middleware chain → handler → middleware (post) → error middleware; bridge proposal: `@UseGuards(AuthGuard)` → `defineMiddleware({ name: 'auth-guard', handler })` |
| Q4 | How does NestJS test controllers + what's the equivalent for TheoKit? | tests | User-provided NestJS spec + `tests/integration/api-middleware-coverage.test.ts` + `tests/integration/onda5-mandatory.test.ts` | Read spec for TestingModule + supertest convention; Read TheoKit existing controller-test pattern (Node `http.createServer` + native fetch); identify difference. | Side-by-side test code: NestJS controller test vs TheoKit `defineRoute` test; decision: does `@theokit/http-decorators` need own test harness? Recommendation per Rule 9 (not reinvent) |
| Q5 | What's the runtime + dev dep cost of supporting NestJS-style decorators? | deps | `packages/theo/tsconfig.json` + `packages/theo/package.json` | **Pre-validated per EC-3:** `experimentalDecorators` + `emitDecoratorMetadata` are NOT in `packages/theo/tsconfig.json`; `reflect-metadata` is NOT in any deps tree. New `@theokit/http-decorators` package OWNS decorator config in its OWN tsconfig (NOT core changes). Bundle impact of `reflect-metadata` ~3KB minified. Stage-3 investigation per ADR-D3+D6 (30min cap). | Table: dep / current state / required state / bundle delta; decision: peer dep vs direct dep; tsconfig consumer-side migration guide |
| Q6 | What CLI tooling does NestJS ship (`nest g controller [name]`) + TheoKit equivalent? | tools | User-provided spec + `packages/theo/src/cli/commands/generate.ts` | Read spec mention of `nest g controller [name]`; Read TheoKit `generate.ts` (current verbs: route/action/page/ws); decide: extend `theokit generate` with `controller` verb OR ship as separate `@theokit/http-decorators-cli` package. | CLI extension proposal: `theokit generate controller cats` → emits `server/controllers/cats.controller.ts` with `@Controller('cats')` class skeleton + 1 sample `@Get()`; template location proposal |

## Coverage Matrix

Every Coverage Corner MUST have at least one Research Question mapped to it.

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q4 | Covered |
| Dependencies | Q5 | Covered |
| Tools | Q6 | Covered |
| Techniques | Q1, Q2, Q3 | Covered |

**Coverage: 4/4 corners covered (100%)**

Question budget: 6 total (sweet spot 5-10 per cycle-discover.md) ✅. Max 3/corner: techniques=3 ✅. Min 1/corner: ALL 4 ✅.

## Halt-loop Checkpoints

For `/discover-execute`: what intermediate state MUST hold before the loop can mark a question DONE.

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | every cited `.claude/knowledge-base/references/{...}` path exists | Mark Qx BLOCKED with reason "path not found" |
| Before Q3 (per EC-4) | Q1's NestJS dispatch pipeline diagram is ≥ 70% complete in blueprint draft | BLOCK Q3 — Q3 needs Q1's pipeline as shared vocabulary |
| 90-min NestJS deep-read checkpoint (per EC-5) | Q1+Q2+Q3 collectively ≥ 70% answered | If Q2 still at "decision tree branch a vs b" without worked sample, REDUCE Q2 scope to "explicit-only DTO+Zod (NO auto-bridge)"; auto-bridge becomes follow-up discovery |
| After answering Qx | blueprint section under Qx has at least one citation | Re-iterate Qx (1 retry max) |
| Mid-loop sanity | total citations ≥ N / 200 words of blueprint prose | Add citations to under-cited paragraphs (1 retry max) |
| Per-project time budget | project budget not exhausted | Mark remaining Qx BLOCKED; advance to next project |
| Before promising complete | all 4 coverage corners have populated sections | Refuse promise; continue iterating |

## Acceptance Criteria

Observable conditions for "this discovery is done":

- [ ] All 6 research questions answered OR explicitly marked BLOCKED with reason
- [ ] All 4 coverage corners (tests/deps/tools/techniques) have populated sections in blueprint
- [ ] Every citation in blueprint points to a real `.claude/knowledge-base/references/{...}` path OR a `docs.nestjs.com` URL (per EC-2 fallback)
- [ ] At least 2 ADR sections in blueprint synthesize decisions taken (one for decorator strategy, one for bridge mechanism)
- [ ] Time budget 6h respected per project breakdown in D1
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `.claude/knowledge-base/discoveries/blueprints/theokit-http-decorators-pattern-from-nestjs-blueprint.md`

## Global Definition of Done

- [ ] All phases completed (plan → edge-cases → confidence-plan → execute → confidence → improve if needed → confidence re-score)
- [ ] Final `/discover-confidence` verdict recorded in blueprint header
- [ ] No fabricated citations (hard cap from `discover-confidence-golden-rule.md`)
- [ ] Coverage Matrix 100% covered (4/4 corners — per `cycle-discover.md` non-negotiable)
- [ ] At least 2 ADRs in blueprint reference project rules (`.claude/rules/architecture.md` v3.1 INVARIANT #3 barrel-only, `.claude/rules/type-safety.md` "Zod is the Single Source of Truth")
