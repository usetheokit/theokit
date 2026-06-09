# Discover Edge Case Review — theokit-decorator-client-bridge

**Date:** 2026-06-09
**Discovery plan analyzed:** `.claude/knowledge-base/discoveries/plans/theokit-decorator-client-bridge-plan.md` (v1.0)
**Research questions analyzed:** 6
**Edge cases found:** 4 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: Q1 Evidence path `app-typed-client.test.ts` does not exist at the cited location

- **Affected question:** Q1
- **Family:** Citation / Reference path
- **Scenario:** Plan cites `packages/theo/src/vite-plugin/app-typed-client.test.ts` as evidence. File does NOT exist at that path. The actual G1 test files are at `tests/unit/app-typed-client-plugin.test.ts` + `tests/unit/fixture-typed-client.test.ts` + `tests/type/app-client-proxy.test-d.ts`.
- **Impact:** `/discover-execute` will attempt to Read the cited path, get file-not-found, and either fabricate an answer or mark Q1 BLOCKED.
- **Suggested fix:** Replace Q1 evidence path `packages/theo/src/vite-plugin/app-typed-client.test.ts` → `tests/unit/app-typed-client-plugin.test.ts` + `tests/unit/fixture-typed-client.test.ts` (both verified to exist). Also add `tests/type/app-client-proxy.test-d.ts` as secondary evidence for type-test patterns.

## SHOULD TEST

### EC-2: Q6 "≤ 30 LoC delta" may be unrealistic if decorator controllers lack `filePath` for the import-path codegen

- **Affected question:** Q6
- **Suggested halt-loop checkpoint:** Before drafting the pseudo-code for Q6, verify that `ManifestRoute.filePath` is ONLY used for import-path generation in `generateClientDts()` (import aliasing for type extraction). If it's also used for file-existence checks or module-loading, the bridge needs a virtual-module approach instead of a real-file path — which adds scope beyond 30 LoC.

### EC-3: Q4 ManifestRoute ↔ WalkResult mapping may surface that WalkResult groups multiple methods per controller class, while ManifestRoute is one-entry-per-file

- **Affected question:** Q4
- **Suggested halt-loop checkpoint:** After producing the mapping table, verify: does `generateClientDts()` handle multiple `ManifestRoute` entries with the SAME `filePath` but DIFFERENT `routePath`+`methods`? If not, the bridge must split WalkResult[] into one ManifestRoute per (verb, fullPath) pair — each pointing to a synthetic filePath.

## DOCUMENT

### EC-4: Hono client (Q5) uses pure TS type inference with zero codegen — TheoKit's codegen model is fundamentally different

- **Accepted risk:** Q5 studies Hono's `hc<AppType>()` which is type-level-only (no `.d.ts` emission; types flow through generic parameters). TheoKit's G1 uses `.d.ts` codegen (file-on-disk). The two models are architecturally different — Q5 will yield DX insights (naming conventions, `$get()` vs `.get()` style) but NOT an implementable pattern. ADR D3 already acknowledges this. The risk: time spent on Q5 (2h budget) may yield thin actionable output. Acceptable because even 2-3 naming/DX insights justify the 2h against a reference that has zero fabrication risk (clone exists at `.claude/knowledge-base/references/hono/src/client/`).

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 1 | 1 (EC-1 path) | 0 | 0 |
| Q2 | 0 | 0 | 0 | 0 |
| Q3 | 0 | 0 | 0 | 0 |
| Q4 | 1 | 0 | 1 (EC-3 multi-method) | 0 |
| Q5 | 1 | 0 | 0 | 1 (EC-4 model diff) |
| Q6 | 1 | 0 | 1 (EC-2 filePath scope) | 0 |

**Verdict:** **DISCOVERY PLAN NEEDS ADJUSTMENT** (1 MUST FIX item — EC-1 wrong test file path)

## Next steps

1. **Bump plan to v1.1**: fix Q1 evidence path (EC-1).
2. **Add halt-loop checkpoints**: EC-2 (Q6 filePath scope check) + EC-3 (Q4 multi-method handling).
3. **Run `/discover-execute theokit-decorator-client-bridge`** on v1.1.
