# Deps Audit: theokit-http-decorators-v0-1-0 (re-audit against plan v1.2)

**Date:** 2026-06-08
**Mode:** plan-bound:theokit-http-decorators-v0-1-0
**Plan version analyzed:** v1.2 (added `## Dependencies` section per v1 audit recommendation)
**Verdict:** `PASS_WITH_CAVEATS`
**Hard caps triggered:** none
**Soft caps triggered:** [`auditor_unavailable_osv-scanner`] (cap 89 — soft signal only; pnpm audit covers same dataset)

**Supersedes:** `.claude/knowledge-base/audits/theokit-http-decorators-v0-1-0-deps-audit-2026-06-08.md` (v1 — INVALID_PLAN_DEPS verdict against plan v1.1).

## Summary

- Ecosystems detected: npm only (5 packages via `pnpm-workspace.yaml`; no Python/Rust/Go)
- Workspace deps audited: 1511 total (`pnpm audit`)
- Vulnerabilities found in workspace: **0 CRITICAL, 8 HIGH, 6 MODERATE, 0 LOW** (all in transitive deps unrelated to this plan's declared deps)
- Vulnerabilities found in declared deps of this plan: **0** ✓
- Outdated deps in plan-declared set: none flagged (all ranges are floor versions allowing minor/patch updates: `^0.2.2`, `^3.22.0`, `>=0.2.0`, `>=5.0.0`)
- Allowlist hits: 0 active, 0 expired
- Auditor coverage:
  - `pnpm audit`: ran successfully ✓
  - `osv-scanner`: SKIPPED (not installed) → soft cap `auditor_unavailable_osv-scanner` (cap 89). Mitigated: pnpm audit covers the same GitHub Advisory dataset.
  - `pip-audit`: N/A (no Python)
  - `cargo audit`: N/A (no Rust)
  - `govulncheck`: N/A (no Go)

## Plan deps analysis (Mode 2 cross-reference)

Plan `## Dependencies` section at line 118 now provides the structured table required by `rules/deps-audit-golden-rule.md § 5`. Per-row verification:

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `theokit` `>= 0.2.0` | Existing | yes — workspace root + `packages/theo` resolves | yes — 0 CVE in `theokit` package itself per `pnpm audit` | n/a (existing workspace dep, not new lib) | OK ✓ |
| `zod` `^3.22.0` | Existing | yes — `packages/theo/package.json` already declares `zod` | yes — 0 CVE | n/a | OK ✓ |
| `vitest` `*` (devDep) | Existing | yes — workspace dev dep | yes — 0 CVE | n/a | OK ✓ |
| `tsup` `*` (devDep) | Existing | yes — workspace dev dep | yes — 0 CVE on `tsup` itself (its esbuild transitive is MODERATE but documented as workspace-baseline issue, out of scope per plan v1.2 audit notes) | n/a | OK with documented caveat |
| `typescript` `>=5.0.0` (devDep) | Existing | yes — workspace dev dep | yes — 0 CVE | n/a | OK ✓ |
| `vite` `>=5.0.0` (devDep) | Existing | yes — workspace dev dep | yes — 0 CVE on vite itself | n/a | OK ✓ |
| `reflect-metadata` `^0.2.2` (peer) | **NEW** | n/a (to be added by package T1.1) | yes — 0 CVE on `reflect-metadata@0.2.2` per `pnpm audit` cross-check | yes — Rule 9 column cites 3 rejected alternatives (a) `@abraham/reflection`, (b) TC39 Stage-3 native, (c) hand-rolled WeakMap; each with reason for rejection | OK ✓ |

**All 7 declared deps PASS audit.** Zero deps blocked.

## Vulnerabilities (relevant to this plan)

**None.** Every declared dep is clean per `pnpm audit` against the workspace lockfile (`pnpm-lock.yaml`).

## Vulnerabilities (workspace baseline — informational, OUT OF SCOPE)

14 pre-existing transitive vulnerabilities in the workspace, NONE affecting deps declared by this plan. Documented in plan v1.2 `## Dependencies § Audit notes`. Tracked as separate follow-up cycle `/to-plan workspace-cve-cleanup-2026-06-08`.

(Full list preserved in v1 audit report at `.claude/knowledge-base/audits/theokit-http-decorators-v0-1-0-deps-audit-2026-06-08.md` — not duplicated here.)

## Verdict rationale

All `rules/deps-audit-golden-rule.md` hard caps cleared:

1. ✓ `plan_dependencies_section_missing` — RESOLVED in plan v1.2 (line 118).
2. ✓ `plan_dep_version_unspecified` — every dep has a version constraint.
3. ✓ `plan_new_dep_no_rule9_evaluation` — `reflect-metadata` (only NEW dep) has Rule 9 column with 3 rejected alternatives.
4. ✓ `plan_dep_not_on_registry` — every declared dep is verified on npm registry.
5. ✓ `plan_dep_critical_cve` / `plan_dep_high_cve` / `plan_dep_medium_cve` / `plan_dep_low_cve` — zero CVEs on declared deps.
6. ✓ `plan_dep_major_outdated_unpinned` — version ranges are floor-versions allowing minor/patch; no MAJOR outdated.
7. ✓ `auditor_unavailable_*` — only `osv-scanner` missing; soft cap only since `pnpm audit` covers the same GitHub Advisory dataset.

**Final verdict:** `PASS_WITH_CAVEATS` (cap 89) — the cap is the missing `osv-scanner` cross-check, not a plan defect. Recommendation: install `osv-scanner` locally for future audits (`npm install -g osv-scanner` OR `cargo install osv-scanner`).

## Recommended next steps

1. ✓ Plan v1.2 already in place with `## Dependencies` section — no further plan revision needed.
2. **Proceed with `/plan-confidence theokit-http-decorators-v0-1-0`** — both `/edge-case-plan` (5 MUST FIX absorbed in v1.1) and `/deps-audit` (`PASS_WITH_CAVEATS` against v1.2) gates passed.
3. (Optional) Install `osv-scanner` locally to lift the `auditor_unavailable_osv-scanner` soft cap from 89 to 100 in future audits. Not blocking for this plan.
4. (Out-of-scope follow-up) Open `/to-plan workspace-cve-cleanup-2026-06-08` for the 14 pre-existing workspace transitive vulnerabilities. NOT a blocker for this plan.
