# Discover Edge Case Review — caddyfile-csp-vite-dev-vs-prod-bundle

Date: 2026-06-26
Discovery plan analyzed: `.claude/knowledge-base/discoveries/plans/caddyfile-csp-vite-dev-vs-prod-bundle-plan.md` v1.0
Research questions analyzed: 7 (Q1-Q7) + 4 ADRs (D1-D4)
Edge cases found: 6 (MUST FIX: 3, SHOULD TEST: 1, DOCUMENT: 2, IGNORE: discarded)

## MUST FIX

### EC-1: Q3 method is unreliable — `ast-grep --lang json` is finicky for string-content matches

- **Affected question:** Q3 (Dependencies corner)
- **Family:** Method
- **Scenario:** Plan says `ast-grep run --pattern '"csp"' --lang json` over `package.json` files. `ast-grep`'s JSON parser handles structural AST queries well, but matching string-literal CONTENT inside `dependencies` / `devDependencies` value strings via a quoted pattern is fragile (the matcher targets keys, not values, and the quoting interacts with the shell). During Fase B this Fase A query will likely return zero hits with no clear diagnostic, triggering the per-question stop condition after 3 retries and BLOCKING Q3 unnecessarily.
- **Impact:** Coverage Corner "Dependencies" (Q3 is its only question) goes BLOCKED. `discover-confidence` would see empty Dependencies corner → INVALID hard cap fires → plan score capped at 49.
- **Suggested fix:** Replace Fase A with `Grep 'csp\|content-security' /home/paulo/theo-cloud/theokit/.claude/knowledge-base/references/next.js/packages/next/package.json` (plain Grep on the single canonical file — already verified to exist). If zero matches, Read `package.json` end-to-end + report "no CSP-named dep" as the canonical answer (CSP logic lives in source, not a sub-package).

### EC-2: Q4 cited path under-covers — canonical Astro CSP lives in `packages/astro/src/core/csp/`, NOT in `integrations/node/`

- **Affected question:** Q4 (Tools corner)
- **Family:** Reference path
- **Scenario:** Plan cites `packages/integrations/node/src/index.ts` + `packages/integrations/node/test/static-headers.test.ts` for Astro's dev-vs-prod CSP injection. Verified during edge-case review: Astro has a real `packages/astro/src/core/csp/config.ts` directory dedicated to CSP — that is the canonical source. The node integration handles runtime static-header injection (a downstream concern). Citing only the node integration would miss Astro's canonical CSP CONFIG type + the SSR rendering hook that emits the CSP. Blueprint would conclude "Astro CSP is per-adapter only" — false statement leading to wrong R2 recommendation.
- **Impact:** Q4 answers with a partial / misleading shape; R2 recommendation (Caddyfile relax vs remove) loses the strongest analog precedent (Astro's centralized CSP config + adapter-specific overrides).
- **Suggested fix:** Add `knowledge-base/references/astro/packages/astro/src/core/csp/config.ts` to Q4's reference paths column. Add `grep -rl "csp" knowledge-base/references/astro/packages/astro/src/core/csp/` as Fase A. Keep the node integration paths as secondary (adapter-specific evidence).

### EC-3: Q7 cited paths under-cover — canonical Google Fonts handling lives in `next.js/packages/font` (NEW Next.js `next/font` package), NOT in `packages/next/src/server/render.tsx`

- **Affected question:** Q7 (Techniques corner)
- **Family:** Reference path
- **Scenario:** Plan cites only `packages/next/src/server/render.tsx` (next.js side) + 2 astro test files for Q7 ("How does astro / next.js handle Google Fonts under strict-CSP?"). Verified: `next.js/packages/font` AND `next.js/packages/next/font` both exist — the canonical `next/font` package implements the self-hosted Google Fonts strategy (build-time download + serve from `/_next/static/media/`) which is exactly the strategy our regression debate hinges on (self-host vs allowlist `fonts.googleapis.com`). Reading only `render.tsx` misses the entire strategy; the answer would be "Next.js uses `<link rel=stylesheet>` to fonts.googleapis.com" which is the EXACT OPPOSITE of the canonical post-Next-13 approach.
- **Impact:** Q7 conclusion is BACKWARDS, leading to R3 recommendation that contradicts industry canonical (Next.js literally self-hosts Google Fonts since v13). R1 (Caddyfile CSP shape) would also be misled into thinking allowlisting is the right path when the canonical answer is "don't allowlist; self-host at build time".
- **Suggested fix:** Add `knowledge-base/references/next.js/packages/font/src/` AND `knowledge-base/references/next.js/packages/next/font/` to Q7's reference paths. Add as Fase A: `grep -rln "googleapis\|gstatic" knowledge-base/references/next.js/packages/font knowledge-base/references/next.js/packages/next/font` — capture the canonical self-host strategy.

## SHOULD TEST

### EC-4: Q4's "dev vs prod CSP" framing has an implicit assumption that may not hold for Astro

- **Affected question:** Q4
- **Suggested halt-loop checkpoint:** Before declaring Q4 done, assert that the Fase B Read produced evidence of EITHER (a) a dev-mode override (e.g., `if (mode === 'development')` branching in `packages/astro/src/core/csp/`) OR (b) an explicit statement that Astro does NOT differentiate dev vs prod CSP (which is itself a valid answer). If neither shape is found after Fase B, retry with `grep 'mode\|development\|production' knowledge-base/references/astro/packages/astro/src/core/csp/` to surface mode-conditional logic. If still zero, document Astro as "single CSP shape — consumer responsibility to relax in dev" — that is the honest answer.

## DOCUMENT

### EC-5: Reference clone date is implicit — re-clone or upstream churn could silently break citations

- **Accepted risk:** Refs were `git clone --depth=1` on 2026-06-26 (today). Blueprint will cite line-exact references from this clone state. If someone re-clones `theokit/.claude/knowledge-base/references/{next.js,astro,hono}/` later, line numbers will drift and citations may break. The plan does not explicitly note the clone date — the blueprint should. Trade-off: pinning the clone via `git submodule` is heavier than the discovery's value justifies; just record the date.
- **Recommended addition to discovery plan v1.1:** add line under each in-scope row: "Clone date: 2026-06-26 (`git clone --depth=1` from upstream `main`)". Or add a single line to ADR D1.

### EC-6: Per-question time budget is implicit — Q5 (Next.js nonce flow in `render.tsx` + `app-render.tsx`) may need more than the 34min/question average

- **Accepted risk:** Plan declares 4h total / 7 questions = ~34min/question average. Q5 covers nonce generation + injection-into-HTML + injection-into-response-header across 2 large source files (`render.tsx` + `app-render.tsx` are 2000+ LoC combined). Per ADR D2, sub-bucket by AST kind keeps it bounded, but the bucket-then-Read top-3 still consumes ~45-60min realistically. Other questions (Q2 hono, Q6 hono) are 15-20min each — slack absorbs Q5 over-run. Net: ADR D1's 4h budget likely holds, but Q5 may "borrow" from Q2/Q6.
- **Recommended addition to discovery plan v1.1:** explicit per-question budget hint in ADR D1, OR leave as-is and rely on the per-project stop condition to surface budget-exhaustion if Q5 over-runs.

## Summary

| Question / ADR | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|---|---|---|---|---|
| Q1 (astro tests) | 0 | 0 | 0 | 0 |
| Q2 (hono tests) | 0 | 0 | 0 | 0 |
| Q3 (next.js deps method) | 1 | 1 | 0 | 0 |
| Q4 (astro vite config CSP) | 2 | 1 | 1 | 0 |
| Q5 (next.js nonce flow) | 0 | 0 | 0 | 0 |
| Q6 (hono secureHeaders shape) | 0 | 0 | 0 | 0 |
| Q7 (Google Fonts under strict CSP) | 1 | 1 | 0 | 0 |
| ADRs D1-D4 (cross-cutting) | 2 | 0 | 0 | 2 |
| **TOTAL** | **6** | **3** | **1** | **2** |

## Verdict: DISCOVERY PLAN NEEDS ADJUSTMENT

3 MUST FIX items must be absorbed into the discovery plan v1.0 → v1.1 before `/discover-plan-confidence` can be run. All 3 are reference-path or method corrections (not scope rewrites) — narrow, mechanical edits to the Research Questions table.

Specifically, before invoking `/discover-plan-confidence`:

1. **EC-1 fix:** Q3 Fase A — replace `ast-grep --lang json` with `Grep 'csp\|content-security' .../packages/next/package.json`
2. **EC-2 fix:** Q4 reference paths — ADD `knowledge-base/references/astro/packages/astro/src/core/csp/config.ts` as primary; keep node integration as secondary
3. **EC-3 fix:** Q7 reference paths — ADD `knowledge-base/references/next.js/packages/font/src/` AND `knowledge-base/references/next.js/packages/next/font/` as primary; keep `render.tsx` as secondary

SHOULD TEST (EC-4) and DOCUMENT (EC-5, EC-6) items are advisory — absorb into v1.1 if cheap, log otherwise.

No edge cases require rewriting the plan from scratch. The 3 MUST FIX edits are scoped to ≤5 lines in the Research Questions table + 0 changes to ADRs / Coverage Matrix / Halt-loop checkpoints / Acceptance Criteria.
