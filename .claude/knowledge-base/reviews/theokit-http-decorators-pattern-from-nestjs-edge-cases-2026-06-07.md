# Discover Edge Case Review — theokit-http-decorators-pattern-from-nestjs

**Date:** 2026-06-07
**Discovery plan analyzed:** `.claude/knowledge-base/discoveries/plans/theokit-http-decorators-pattern-from-nestjs-plan.md` (v1.0)
**Research questions analyzed:** 6
**Edge cases found:** 7 (MUST FIX: 3, SHOULD TEST: 2, DOCUMENT: 2)

## MUST FIX

### EC-1: Citation typo — `fastify/lib/handleRequest.js` does not exist (correct is `handle-request.js`)

- **Affected question:** Q1
- **Family:** Citation / Reference path
- **Scenario:** During `/discover-execute`, the agent will `Read .claude/knowledge-base/references/fastify/lib/handleRequest.js` per the plan's Method, get a `file not found` error, then either fabricate ("se a alguma versão tem esse arquivo") or skip the question. Fabrication trips the `discover-confidence` hard cap.
- **Impact:** Q1's evidence chain breaks. Without Fastify's real routing internals as comparative reference, the blueprint's "NestJS dispatch model vs alternative" section loses 1 of 2 anchors.
- **Suggested fix:** rename citation in plan v1.1 § 6 Coverage Matrix Q1 row from `fastify/lib/handleRequest.js` → `fastify/lib/handle-request.js` (kebab-case). Same fix in § 5 Q1 Method bullet. The file IS present per `ls fastify/lib/`.

### EC-2: NestJS spec input may be truncated mid-content; no fallback declared

- **Affected question:** Q1, Q2, Q3 (all 3 Techniques questions cite "user-provided spec" as primary source)
- **Family:** Method
- **Scenario:** The original `/discover-plan` argument that pasted the NestJS Controllers chapter starts mid-word with `outing#` (truncation of `Routing#`). If the source was truncated at the start, it may also be truncated at the end — sections like Pipes interaction or library-specific `passthrough` may be incomplete. During `/discover-execute`, the agent will hit gaps in the spec and have no documented fallback.
- **Impact:** Q1/Q2/Q3 answers depend on completeness of the user-provided text. Missing sections → fabricated answers OR honest gaps that make the blueprint less actionable.
- **Suggested fix:** in plan v1.1 § 5 Q1/Q2/Q3 Method, add fallback: *"If user-provided spec is missing a referenced section (Pipes interaction, Guards composition, etc.), add `docs.nestjs.com` to `.claude/rules/discover-web-allowlist.txt` and `WebFetch https://docs.nestjs.com/controllers` for that specific section. Cite the URL + section anchor in the blueprint."* This is a 2-line allowlist change + opt-in per question.

### EC-3: Plan Q5 cites `packages/theo/tsconfig.json` for decorator config — verified EMPTY for `experimentalDecorators` and `emitDecoratorMetadata`; reflect-metadata not in any deps tree

- **Affected question:** Q5
- **Family:** Reference path / Interpretation
- **Scenario:** Pre-validation (this edge-case-review step) confirmed: `grep -E "experimentalDecorators|emitDecoratorMetadata" packages/theo/tsconfig.json` → ZERO hits. `grep -l "reflect-metadata" packages/theo/package.json package.json` → ZERO hits. So Q5's "Expected answer shape" table will have ALL rows showing "required state: add to tsconfig + install reflect-metadata as peer dep". The plan didn't pre-flag this — the agent will discover it during execute and possibly mis-interpret as a blocker.
- **Impact:** Q5 may be answered as "MAJOR project change required" when actually it's just "consumer-app-side tsconfig change + peer-dep declaration in the new `@theokit/http-decorators` package — NO change to packages/theo/ itself". The blueprint's recommendation could go in the wrong direction (TheoKit core changes vs new-package-only changes).
- **Suggested fix:** in plan v1.1 § 5 Q5, pre-record the validated state: *"`packages/theo/tsconfig.json` does NOT enable decorators today and SHOULD NOT (decorators belong only to the new opt-in `@theokit/http-decorators` package, which will declare them in its own tsconfig + require consumer-app-side enablement). The blueprint must frame consumer-app migration, NOT core-tsconfig changes."* — 3-line clarification.

## SHOULD TEST

### EC-4: Q3 depends on Q1 (NestJS dispatch model) being answered first

- **Affected question:** Q3
- **Suggested halt-loop checkpoint:** before iterating to Q3 (Guards/Interceptors vs defineMiddleware), validate that Q1's "NestJS request → handler dispatch pipeline" mapping is complete in the blueprint. Q3 builds on that pipeline (Guards run pre-pipeline; Interceptors wrap; Pipes are within). Without Q1's pipeline diagram, Q3's mapping to `defineMiddleware` chain has no shared vocabulary.

### EC-5: Time budget Q1+Q2+Q3 (2h NestJS) may be tight given DTO↔Zod bridge complexity

- **Affected question:** Q2
- **Suggested halt-loop checkpoint:** at the 90-minute mark of NestJS deep-read (covering Q1+Q2+Q3 collectively), checkpoint: are all 3 questions ≥ 70% answered? If Q2 is still at "decision tree branch a vs b" without a worked code sample, escalate via meeting note + reduce Q2 scope to "explicit-only DTO+Zod (NOT auto-bridge)" — the auto-bridge investigation becomes a follow-up discovery. Don't burn into Q4/Q5/Q6 budget.

## DOCUMENT

### EC-6: NestJS Pipes, Guards, Interceptors are separate chapters NOT included in user-provided spec

- **Accepted risk:** the user passed the Controllers chapter; Pipes/Guards/Interceptors are in adjacent NestJS docs chapters. Plan ADR-D4 already explicitly defers NestJS Providers/DI/Modules. We're additionally accepting that Pipes/Guards/Interceptors get LIGHT treatment in this blueprint (1 paragraph + decision "out for v0.1.0, in for v0.2.0") and NOT a deep-dive. If a follow-up discovery wants full Pipes coverage, it gets its own `/discover-plan`.

### EC-7: TC39 Stage-3 decorators (TS 5.x) vs Legacy `experimentalDecorators` decision is time-budgeted to 30min (per plan ADR-D3) — if Stage-3 doesn't support `emitDecoratorMetadata`-style type emit, blueprint will go with Legacy without deep TC39 comparison

- **Accepted risk:** the plan ADR-D3 already caps this investigation at 30min. If Stage-3 isn't ready in mid-2026 (likely), v0.1.0 ships with Legacy decorators + a documented migration path. We accept that the blueprint may give Stage-3 only 1 paragraph + "deferred to v0.2.0 follow-up discovery". This is correct scoping discipline, not a gap.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 (NestJS dispatch internals — Techniques) | 2 | 1 (EC-1 path typo) + 1 (EC-2 spec truncation) | 0 | 0 |
| Q2 (DTO↔Zod bridge — Techniques) | 2 | 1 (EC-2) | 1 (EC-5 budget) | 0 |
| Q3 (Guards/Interceptors vs middleware — Techniques) | 2 | 1 (EC-2) | 1 (EC-4 dependency on Q1) | 1 (EC-6 Pipes/Guards depth) |
| Q4 (Test convention — Tests) | 0 | 0 | 0 | 0 |
| Q5 (Dep cost — Deps) | 1 | 1 (EC-3 tsconfig/dep state pre-recorded) | 0 | 1 (EC-7 Stage-3 cap) |
| Q6 (CLI generator — Tools) | 0 | 0 | 0 | 0 |

**Note on counting:** EC-2 affects 3 questions; counted once per question impact (so 3 column-totals point at the same edge case). True distinct edge cases: 7.

**Verdict:** **DISCOVERY PLAN NEEDS ADJUSTMENT** (3 MUST FIX items)

## Next steps

1. **Bump plan to v1.1**: incorporate EC-1 (path typo), EC-2 (web-allowlist + WebFetch fallback per Q1/Q2/Q3), EC-3 (pre-recorded tsconfig/dep state in Q5).
2. **Add halt-loop checkpoints**: incorporate EC-4 (Q3 depends on Q1 dispatch diagram) + EC-5 (90-min checkpoint at NestJS deep-read).
3. **Add ADR-D5 + D6**: incorporate EC-6 (Pipes/Guards depth deferred to v0.2.0) + EC-7 (Stage-3 vs Legacy decorator strategy).
4. **Run `/discover-plan-confidence`** on v1.1 to verify structural quality before `/discover-execute`.
