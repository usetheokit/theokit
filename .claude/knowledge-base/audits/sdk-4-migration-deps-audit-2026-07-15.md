# Deps Audit: sdk-4-migration

**Date:** 2026-07-15
**Mode:** plan-bound:sdk-4-migration
**Verdict:** PASS_WITH_CAVEATS
**Hard caps triggered:** [] (none)

## Summary
- Ecosystems detected: npm (pnpm workspace)
- Plan-declared deps audited: 2 (`@theokit/sdk ^4.0.1`, `@theokit/sdk-tools ^0.11.0`) — both first-party (usetheodev)
- Vulnerabilities on DECLARED deps: **0** (CRITICAL 0, HIGH 0, MEDIUM 0, LOW 0)
- Vulnerabilities in the pre-existing transitive tree (NOT introduced/changed by this plan): 6 (HIGH 1, MODERATE 4, LOW 1)
- Auditor coverage: `pnpm audit`: **UNAVAILABLE** (registry endpoint retired — HTTP 410, per npm's bulk-advisory migration) — reported as a gap, not fabricated clean; `osv-scanner`: **ran** (authoritative cross-ecosystem source, exit 1 = findings present).

## Plan validation (Mode 2)

| Plan dep | Section | Registry match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `@theokit/sdk` | Changed `>=3.7.0 → ^4.0.1` | yes (4.0.1 live on npm) | yes — 0 CVE | Reuse (native transcript replaces theokit's storage; theokit REMOVES code) | OK |
| `@theokit/sdk-tools` | Unchanged `^0.11.0` | yes | yes — 0 CVE | Reuse (`todolist`) | OK |

The plan's dependency change (a first-party version bump + a subsystem REMOVAL) introduces **no new attack surface** and **no CVE**. This satisfies the golden rule's hard caps (no CRITICAL/HIGH on a declared dep).

## Pre-existing transitive findings (OUT OF SCOPE for this plan — flagged for a follow-up deps-hygiene pass)

None of these is rooted in the plan's dependency change; they are present in the current 3.x tree and are unrelated to the SDK-4 migration. Listed for honesty (golden rule anti-pattern #3 — never hide a finding), NOT as a blocker for this plan.

| Severity | Package | Advisory | Note |
|---|---|---|---|
| HIGH | `valibot@0.42.1` | GHSA-vqpr-j7v3-hqw9 | Transitive (validation lib). Pre-existing; not a theokit-declared dep. NOT introduced by SDK-4. |
| MODERATE | `esbuild@0.18.20` / `0.19.12` | GHSA-67mh-4wv8-2f99 | Build-tool transitive; dev-time. |
| MODERATE | `js-yaml@3.14.2` | GHSA-h67p-54hq-rp68 | Transitive. |
| MODERATE | `uuid@8.3.2` | GHSA-w5hq-g745-h8pq | Transitive (deprecated version). |
| LOW | `esbuild@0.27.7` | GHSA-g7r4-m6w7-qqqr | Transitive. |

**Caveat driving PASS_WITH_CAVEATS (cap 89, not a block):** the HIGH `valibot` finding exists in the tree. It is NOT a declared dep of this plan and NOT introduced by the SDK-4 bump, so it does not cap THIS plan below PASS on the golden-rule's declared-dep rule. It is surfaced so it is not silently lost; remediation belongs in a standalone `/deps-audit` hygiene pass (or a `renovate`/bump task), NOT in sdk-4-migration (scope discipline — the migration must not absorb unrelated transitive bumps).

## Recommended next steps
1. Proceed to `/plan-confidence` — the plan's declared deps are CVE-clean; no diff to apply to the plan's dependency set.
2. Open a SEPARATE deps-hygiene task for the 6 pre-existing transitive findings (esp. HIGH `valibot`) — do NOT bundle into this migration.
3. Note the `pnpm audit` endpoint retirement — CI/local audits should standardize on `osv-scanner` going forward.
