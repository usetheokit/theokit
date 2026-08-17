# Deps Audit: theokit-http-decorators-v0-1-0

**Date:** 2026-06-08
**Mode:** plan-bound:theokit-http-decorators-v0-1-0
**Plan version analyzed:** v1.1
**Verdict:** `INVALID_PLAN_DEPS`
**Hard caps triggered:** [`plan_dependencies_section_missing`]

## Summary

- Ecosystems detected: npm (root workspace + 5 packages via `pnpm-workspace.yaml`)
- Workspace deps audited: 1511 total (pnpm audit)
- Vulnerabilities found in workspace: **0 CRITICAL, 8 HIGH, 6 MODERATE, 0 LOW**
- Plan declared deps not yet checkable: **PLAN HAS NO `## Dependencies` SECTION**
- Outdated deps: not enumerated (skipped because primary verdict is INVALID_PLAN_DEPS — plan must be fixed first)
- Allowlist hits: 0 active, 0 expired
- Auditor coverage:
  - `pnpm audit`: ran successfully
  - `osv-scanner`: SKIPPED — binary not installed (would cross-check npm advisory dataset; soft signal only since `pnpm audit` covers the same GitHub Advisory data)
  - `npm audit`: SKIPPED at workspace root — root has no `package-lock.json` (uses `pnpm-lock.yaml`); per-package npm audit not run because pnpm audit suffices
  - `pip-audit`: N/A (no Python manifests)
  - `cargo audit`: N/A (no Rust manifests)
  - `govulncheck`: N/A (no Go manifests)

## Verdict rationale

Plan `theokit-http-decorators-v0-1-0` v1.1 does not include a `## Dependencies` section as required by `rules/deps-audit-golden-rule.md § 5 Severity rubric` and `rules/cycle-plan.md` cycle-plan canonical template. The plan declares deps INFORMALLY in:
- `## Baseline Context § Files that will be touched` row for `packages/http-decorators/package.json (NEW)`
- ADR D1's Consequences ("`reflect-metadata` ~3KB gzipped peer dep")
- T1.1 Pseudo-code (full `package.json` JSON with peerDependencies)

These are SCATTERED informal references — not the structured `## Dependencies` table that `/deps-audit` cross-references against audit output per `golden-rule.md § 5 Step 4`.

**Stable identifier:** `plan_dependencies_section_missing` → caps plan-confidence score at 49 (INVALID_PLAN_DEPS).

## Workspace baseline (informational — NOT plan-bound)

All 14 vulnerabilities are in TRANSITIVE deps of the existing workspace (NOT in the deps the new `@theokit/http-decorators` package will declare directly). They are out-of-scope for this audit but listed here for situational awareness:

| Severity | Package | Range | Fixed in | CVE | Reachable via |
|---|---|---|---|---|---|
| HIGH | `valibot` | `>=0.31.0 <1.2.0` | `>=1.2.0` | CVE-2025-66020 | Transitive (likely TheoKit deps) |
| HIGH | `wrangler` | `>=4.0.0 <4.59.1` | `>=4.59.1` | CVE-2026-0933 | Cloudflare adapter (existing) |
| HIGH | `minimatch` | `>=10.0.0 <10.2.1` | `>=10.2.1` | CVE-2026-26996 | Transitive |
| HIGH | `minimatch` | `>=10.0.0 <10.2.3` | `>=10.2.3` | CVE-2026-27903 | Transitive |
| HIGH | `minimatch` | `>=10.0.0 <10.2.3` | `>=10.2.3` | CVE-2026-27904 | Transitive |
| HIGH | `undici` | `>=7.0.0 <7.24.0` | `>=7.24.0` | CVE-2026-1528 | Transitive (Node fetch family) |
| HIGH | `undici` | `>=7.0.0 <7.24.0` | `>=7.24.0` | CVE-2026-1526 | Transitive |
| HIGH | `undici` | `>=7.0.0 <7.24.0` | `>=7.24.0` | CVE-2026-2229 | Transitive |
| MODERATE | `esbuild` | `<=0.24.2` | `>=0.25.0` | (no CVE-id, GHSA only) | tsup dep (dev) |
| MODERATE | `undici` | `>=7.0.0 <7.18.2` | `>=7.18.2` | CVE-2026-22036 | Transitive |
| MODERATE | `undici` | `>=7.0.0 <7.24.0` | `>=7.24.0` | CVE-2026-1525 | Transitive |
| MODERATE | `undici` | `>=7.0.0 <7.24.0` | `>=7.24.0` | CVE-2026-1527 | Transitive |
| MODERATE | `ws` | `>=8.0.0 <8.20.1` | `>=8.20.1` | CVE-2026-45736 | Transitive (G8 streaming uses ws) |
| MODERATE | `uuid` | `<11.1.1` | `>=11.1.1` | CVE-2026-41907 | Transitive |

**None of these affect the new package's DECLARED peer deps** (`reflect-metadata ^0.2.2`, `zod ^3.22.0`, `theokit >= 0.2.0`). These workspace vulnerabilities are pre-existing and out-of-scope for `theokit-http-decorators-v0-1-0` per `cycle-plan.md` scope discipline — but the human SHOULD open a separate hygiene plan to bump the affected workspace deps (e.g., a `/to-plan workspace-cve-cleanup-2026-06-08` cycle).

## Plan deps analysis (Mode 2 — BLOCKED on missing section)

Cannot complete the per-row table mandated by `golden-rule.md § 5 Step 4` because the plan has no `## Dependencies` section to parse. Inferred-but-unverifiable deps based on Pseudo-code in T1.1 `package.json` block:

| Inferred dep | Declared version (informal, from T1.1 pseudo) | Audit status | Rule 9 docs | Status |
|---|---|---|---|---|
| `theokit` | `>= 0.2.0` (peer) | clean (no CVE) | n/a — TheoKit itself (root workspace) | informally OK but not in plan section |
| `reflect-metadata` | `^0.2.2` (peer) | clean (no CVE in `pnpm audit`) | Pattern D1 in patterns skill cites it; not in plan Rule-9 column | informally OK but not in plan section |
| `zod` | `^3.22.0` (peer) | clean (no CVE) | TheoKit-wide canonical schema lib per `.claude/rules/type-safety.md` | informally OK but not in plan section |
| `vitest` | `*` (devDep, from T1.1) | clean | TheoKit-wide test runner | informally OK but not in plan section |
| `tsup` | `*` (devDep, from T1.1) | clean (tsup→esbuild transitive MODERATE applies to workspace dev only) | TheoKit-wide build tool | informally OK but not in plan section |

Even though the inferred deps are clean per audit, the golden rule requires the `## Dependencies` section to ENABLE Mode 2 cross-reference. Without that structured section, `/plan-confidence` cannot verify the audit↔plan correspondence.

## Recommended diff (apply to plan v1.2)

Add the following section to `.claude/knowledge-base/plans/theokit-http-decorators-v0-1-0-plan.md` between `## Prior Art & Related Work` and `## Objective`:

```markdown
## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `theokit` | `>= 0.2.0` (peer) | npm | The framework being extended; bridge consumes `defineRoute` + `defineMiddleware` from `theokit/server` barrel per Pattern D6. |
| `zod` | `^3.22.0` (peer) | npm | Canonical schema lib per `.claude/rules/type-safety.md` ("Zod is the Single Source of Truth"). DTO `static schema` convention per Pattern D2 requires Zod. |
| `vitest` | `*` (devDep) | npm | TheoKit-wide test runner per `.claude/rules/testing.md`. |
| `tsup` | `*` (devDep) | npm | TheoKit-wide build tool used by every package in `packages/*`. |
| `typescript` | `>=5.0.0` (devDep) | npm | Required for Legacy decorators (`experimentalDecorators`) per ADR D1; TS 5.0+ stable across TheoKit since 0.1.0. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale (libs evaluated) | Why this one |
|---|---|---|---|---|
| `reflect-metadata` | `^0.2.2` (peer) | npm | **Evaluated alternatives:** (a) `@abraham/reflection` — smaller (1KB) but lacks `Reflect.getMetadata` shape NestJS expects, breaks migration compat; (b) TC39 Stage-3 native Reflect (`Reflect.getMetadata` proposal) — not yet in any JS runtime as of 2026-06-08; (c) hand-rolled WeakMap-based metadata — violates Rule 9 "Don't Reinvent". | Canonical TC39 Metadata Reflection API polyfill required by Legacy `experimentalDecorators` + `emitDecoratorMetadata` per ADR D1. Same lib NestJS uses (mid-2026 baseline). ~3KB gzipped. Active maintenance (Microsoft / TypeScript team). |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | This is a NEW package; no removals. |

### Audit notes

- `pnpm audit` against the workspace returned 0 vulnerabilities affecting any DECLARED peer dep of `@theokit/http-decorators` v0.1.0 (`reflect-metadata`, `zod`, `theokit`).
- 14 unrelated workspace-transitive vulnerabilities exist (`valibot`, `wrangler`, `minimatch`, `undici`, `ws`, `uuid`, `esbuild`) — these are pre-existing and out-of-scope per `cycle-plan.md` scope discipline. Recommend follow-up `/to-plan workspace-cve-cleanup-2026-06-08`.
- `osv-scanner` not installed locally; auditor coverage cap is `auditor_unavailable_osv-scanner` (soft warning only — `pnpm audit` covers the same GitHub Advisory dataset).
```

## Recommended next steps

1. Apply the diff above to plan v1.2 (NEW section between `## Prior Art & Related Work` and `## Objective` at line ~115). This unblocks `INVALID_PLAN_DEPS`.
2. Re-run `/deps-audit theokit-http-decorators-v0-1-0` to confirm verdict flips to `PASS` (expected — declared deps are clean per workspace audit).
3. Proceed with `/plan-confidence theokit-http-decorators-v0-1-0` — both edge-case-review and deps-audit gates passed.
4. (Optional but recommended) `npm install -g osv-scanner` for stronger cross-validation on future audits — not blocking for this plan since `pnpm audit` covers npm advisories.
5. (Out-of-scope follow-up) `/to-plan workspace-cve-cleanup-2026-06-08` to address the 14 pre-existing workspace transitive vulnerabilities (8 HIGH + 6 MODERATE). NOT a blocker for this plan.
