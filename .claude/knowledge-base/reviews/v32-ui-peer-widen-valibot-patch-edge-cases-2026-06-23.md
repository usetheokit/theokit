# Edge Case Review — v32-ui-peer-widen-valibot-patch

Date: 2026-06-23 · Tasks analyzed: 2 (T1.1, T2.1) · Edge cases: 2 (MUST FIX: 0, SHOULD TEST: 0, DOCUMENT: 2)

## DOCUMENT

### EC-1: valibot is the SOLE constraint — bump is conflict-free
- `npm ls valibot` in theo-ui: `@theokit/ui@0.18.1 └── valibot@0.42.1` (single node). No other dep/peer pins valibot <1.0, so `^1.4.1` introduces no new resolution conflict. deps-audit: valibot@1.4.1 = 0 vulnerabilities. Accepted (no action).

### EC-2: peer range `^0.14.0 || ^0.18.0` intentionally excludes 0.15-0.17
- ADR D1: theocode jumps 0.14→0.18; the explicit OR-range is the validated surface (not an open range). A hypothetical consumer on 0.16 is excluded by design (those minors were never the target). Accepted (documented in D1).

## Note — safeParse shape compat (covered by oracle, not a separate edge)
theo-ui uses `result.success` / `result.issues` / `result.issues[].message` (schema.ts:126-128, theme-provider.tsx:281-284). valibot 1.x keeps this shape; `src/themes/schema.test.ts` (positive + negative incl. CSS-injection color + javascript: URL) is the oracle that catches any 1.x divergence in T1.1 GREEN.

**Verdict:** PLAN OK (no MUST-FIX; 2 DOCUMENT accepted).
