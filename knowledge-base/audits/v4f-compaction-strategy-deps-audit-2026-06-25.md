# Deps Audit: v4f-compaction-strategy

**Date:** 2026-06-25
**Mode:** plan-bound:v4f-compaction-strategy
**Verdict:** PASS
**Hard caps triggered:** [] (none)

## Summary
- Ecosystems detected: npm (pnpm workspace)
- Plan-declared dependency changes: 1 (`@theokit/sdk` version bump; no NEW package, no removal)
- Vulnerabilities found: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW
- Outdated: n/a (the bump catches the lockfile UP to the highest in-range, 2.9.0)
- Allowlist hits: 0 active, 0 expired
- Auditor coverage: { npm-audit: ran (workspace `vulnerabilities: {}` — zero), osv-scanner: available (`/home/paulo/go/bin/osv-scanner`), registry-check: ran (`npm view @theokit/sdk@2.9.0` → 2.9.0 exists) }

## Vulnerabilities (sorted by severity)

(none — `npm audit` reports `vulnerabilities: {}` across the theokit workspace; `@theokit/sdk` is a first-party scoped package with no public advisory.)

## Outdated (non-vulnerable)

- `@theokit/sdk` installed at 2.5.0 while 2.9.0 is the highest version inside the already-declared `^2.5.0` range. This is NOT an outdated-MAJOR finding (same major, in-range minor catch-up). The plan's Phase 0 (T0.1) performs the lockfile catch-up + peer-floor tighten deliberately. No diff suggestion needed beyond the plan's own T0.1.

## Plan validation (Mode 2)

| Plan dep | Section | Registry match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `@theokit/sdk` `^2.9.0` (peer `>=2.9.0`) | Changed (bump) | yes — 2.9.0 published | yes — npm audit `{}`, no CVE | yes — alternatives (a) reimplement→rejected G2, (b) keepRecent-only→rejected semantics, (c) bump→chosen | OK |
| `zod` (workspace pin) | Existing | yes (already a dep) | yes | n/a (existing) | OK |
| (no NEW package) | New | — | — | — | OK — only the runtime import path `@theokit/sdk/compaction` is new; the package is already a dependency |
| (none) | Removed | — | — | — | OK |

Structural checks (golden-rule hard caps):
- `## Dependencies` section present ✓
- declared version pinned (`^2.9.0` / peer `>=2.9.0`) ✓ — no `plan_dep_version_unset`
- Rule 9 rationale non-empty with ≥ 1 rejected alternative ✓ (three: reimplement / keepRecent-only / bump) — no `plan_new_dep_no_rule9_evaluation`
- declared version exists on registry ✓ — no `plan_dep_not_on_registry`
- no CRITICAL/HIGH CVE on the declared dep ✓ — no `cve_critical_*` / `cve_high_*`

## Recommended next steps

1. No manifest diff to apply beyond the plan's T0.1 (peer `>=2.5.0`→`>=2.9.0`, dev `^2.5.0`→`^2.9.0`, `pnpm update @theokit/sdk`).
2. Phase 0 DoD already gates the bump's blast radius (run BOTH `@theokit/agents` AND `theokit` suites — the SDK is shared with `packages/theo`).
3. Proceed to `/plan-confidence v4f-compaction-strategy`.

## Note (honest auditor coverage)

`npm audit` is the authoritative GitHub-Advisory source here and reports zero vulnerabilities workspace-wide; `osv-scanner` is installed and available as the cross-ecosystem cross-check. `@theokit/sdk` being a first-party scoped package, no public CVE database tracks it — the meaningful risk is API/type drift across 2.5→2.9, which is a TYPE-compat concern validated by the plan's Phase 4 typecheck + the dual-suite regression gate, NOT a CVE concern.
