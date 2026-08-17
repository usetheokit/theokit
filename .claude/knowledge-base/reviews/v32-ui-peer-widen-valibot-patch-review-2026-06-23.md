# Review — v32-ui-peer-widen-valibot-patch (V3-2)

**Date:** 2026-06-23 · **Slug:** v32-ui-peer-widen-valibot-patch
**Commits reviewed:** theo-ui `21b48ed` (valibot bump) + theokit `65266c1` (peer widen) on `develop`
**Reviewers:** 2 independent fresh-eyes agents (CVE/security · peer-resolution/regression/test-quality)
**Verdict:** **READY_TO_MERGE** (2 PASS lenses, 0 BLOCKER, 0 HIGH, 0 MEDIUM; 1 LOW cosmetic, no action).

## Overview
V3-2 fixes two coupled gaps (F-V2-2G-1 + F-V2-2G-4) across two repos: (1) `theokit`'s optional `@theokit/ui` peer was `^0.14.0`, causing an `ERESOLVE` against `@theokit/ui@0.18.x` and pinning consumers to 0.14.x; (2) `@theokit/ui@0.18.1` carried a HIGH transitive `valibot` advisory (GHSA-vqpr-j7v3-hqw9, ReDoS). Fix: widen theokit's peer to `^0.14.0 || ^0.18.0` (additive) + bump theo-ui's valibot `^0.42.1`→`^1.4.1` (clears the CVE). Manifest-only in theokit; one dep version + the proven theme-schema test in theo-ui. Empirical probe before/after: ERESOLVE present → gone for 0.18.x; valibot HIGH present → gone.

## Lens verdicts

### CVE / security correctness — PASS
`pnpm why valibot` → single `valibot@1.4.1` (no 0.42.x anywhere); `pnpm audit | grep valibot` → nothing (advisory cleared, not just bumped under the affected ceiling — 1.4.1 is outside `>=0.31.0 <1.2.0`). No new valibot CVE from the bump (the remaining ws/vite/esbuild advisories are pre-existing devDep transitives, out of scope). Behavior-safe: every consumed valibot API exists + behaves identically in 1.x; the security-relevant negative tests (CSS-injection color rejection, `javascript:`/`data:` URL rejection) verifiably STILL reject under the major (independently reproduced). Oracle `src/themes/schema.test.ts` 9/9 green, source unmodified.

### Peer resolution / regression / test quality — PASS
Independent dry-run installs of the packed local theo: `@theokit/ui@0.18.1` resolves (ERESOLVE gone), `@0.14.4` resolves (no regression), `@0.16.0` correctly ERESOLVEs (proves the OR-range discriminates — not a disguised open `*`; ADR D1 honored). The hand-rolled `rangeAccepts` helper (parsimony — no `semver` dep) is correct + non-tautological: accepts 0.14.x/0.18.x, rejects 0.15-0.17/0.13/1.x, and `^0.18.0` does NOT false-accept 0.19.0 (correct 0.x caret minor-pinning). `ui-peer-range.test.ts` 3/3 green, eslint clean, frozen-lockfile clean. No template/fixture peer drift (`sync:templates` wrote 0 files — `@theokit/ui` is external to the workspace; the template's own `^0.14.0` dependency is a scaffolded-app concern, not theo's peer).

## LOW finding — no action
- (security lens) Prompt-vs-code API-list drift: the plan listed `regex`/`minLength` as used valibot APIs, but `schema.ts` uses `v.check(...)` with raw `RegExp.test`. Cosmetic; both APIs exist in 1.4.1 anyway. No defect.

## Validation (all green)
theo-ui: valibot `^1.4.1`; `src/themes/schema.test.ts` 9/9; `pnpm audit` no valibot advisory. theokit: peer `^0.14.0 || ^0.18.0`; `ui-peer-range.test.ts` 3/3; eslint `--max-warnings=0` clean; `pnpm install --frozen-lockfile` clean; dry-run resolution proven for 0.18.x + 0.14.x (+ 0.16.0 correctly excluded). Both repos on `develop`. changeset `theokit` (minor) + theo-ui CHANGELOG Security entry.

## Conclusion
The slice meets its Goal: theocode can adopt `@theokit/ui@0.18.x` without `--force` (ERESOLVE eliminated) AND the transitive `valibot` HIGH is gone — both verified by independent before/after probes. Additive peer widen (no consumer breaks, regression-guarded), CVE-clearing bump (XSS-rejecting validation preserved), zero new dependency, no public-API change. **Verdict: READY_TO_MERGE.**

## Loop-closure follow-up (out of this slice)
Per ROADMAP-v3 V3-2: after both repos release (theo-ui with valibot fix → theokit with widened peer), theocode bumps `@theokit/ui@0.18.x` (resolves without `--force`) and its `npm audit` shows no valibot HIGH. That adoption happens in the theocode repo.
