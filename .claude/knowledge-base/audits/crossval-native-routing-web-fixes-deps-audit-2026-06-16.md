# Deps Audit: crossval-native-routing-web-fixes

**Date:** 2026-06-16
**Mode:** plan-bound:crossval-native-routing-web-fixes
**Verdict (as-is):** `INVALID_PLAN_DEPS` — plan has no `## Dependencies` section (golden-rule hard cap #4)
**Verdict (on the merits / after adding the section):** `PASS_WITH_CAVEATS` (89) — one LOW CVE on a touched peer dep (`react-router`); no new deps, no version changes
**Hard caps triggered:** `plan_missing_dependencies_section`

## Summary

- **Ecosystems detected:** npm only (`pnpm-lock.yaml`). No Python / Rust / Go manifests in the auditable surface (`pyproject.toml`/`Cargo.toml`/`go.mod` absent; `knowledge-base/references/` excluded by contract).
- **Plan dependency posture:** the plan introduces **ZERO new dependencies** and changes **ZERO versions**. It touches existing deps only: `better-sqlite3` (Phase 1 subject), `react-router` (Phase 2 target), and reads but does not modify `zod`/`ws`/`unstorage`.
- **Repo standing vulnerabilities (whole tree, NOT plan-introduced):** 5 low / 13 moderate / 20 high (38 total) — concentrated in dev/build/transitive deps (`esbuild`, `undici`, `vite`, `minimatch`, `wrangler`, `valibot`, `form-data`, `ws`, `js-yaml`, `uuid`, `dompurify` via `@theokit/ui`→`mermaid`).
- **Auditor coverage:** `pnpm audit`: **ran** (authoritative for npm, GitHub Advisory data). `osv-scanner`: **SKIPPED — binary not installed** (cross-check layer unavailable; noted, not fabricated). `pip-audit`/`cargo`/`govulncheck`: not applicable (no manifests).

## Plan-touched dependencies — the only ones that gate THIS plan

| Plan dep | Phase | Ecosystem | Declared | CVE on this dep? | Severity | Verdict |
|---|---|---|---|---|---|---|
| `better-sqlite3` | 1 (native preflight) | npm | `^12.10.0` (root devDep) | **none** | — | OK ✅ |
| `react-router` | 2 (dynamic routing) | npm | `^7.0.0` (peerDep) | CVE-2026-53663 | **LOW** | PASS_WITH_CAVEATS |
| `zod` | 2/3 (schemas) | npm | `^4.0.0` (peerDep) | none | — | OK ✅ |
| `unstorage` | — (read only) | npm | `^1.10.0` (peerDep) | none | — | OK ✅ |

**Key result:** the Phase 1 subject (`better-sqlite3`) is **clean** — the native-bindings fix does not pull a vulnerable dep. The only CVE on a plan-touched dep is LOW.

## Vulnerabilities on plan-touched deps (sorted by severity)

### CVE-2026-53663 — LOW (npm: react-router, peerDep `^7.0.0`)
- **Title:** React Router — Potential CSRF via PUT/PATCH/DELETE document requests.
- **Fixed in:** `>=7.15.1`
- **Path:** consumer app → `react-router` (peerDependency — the consumer controls the installed version).
- **Plan reference:** Phase 2 (T2.1/T2.2) emits react-router `:param`/`*` syntax; it does NOT pin or change the `react-router` version. The CVE is a pre-existing peer-dep posture, LOW severity, and CSRF on document requests is already mitigated framework-side by the CSRF gate (`server/security/csrf.ts`).
- **Diff suggestion (peerDep range — advisory only, consumer-applied):**
  ```diff
  - "react-router": "^7.0.0"
  + "react-router": "^7.15.1"
  ```
- **Recommendation:** bump the peerDep floor to `^7.15.1` in a SEPARATE dependency-hygiene change (not this plan — out of scope; this plan adds no deps). Acceptable to defer: LOW + peer-controlled + framework CSRF gate in place.

## Repo standing posture (informational — NOT a gate on this plan)

These 20 HIGH / 13 MODERATE findings are the repository's existing dependency debt. **None is introduced by this plan and none is on a plan-declared dep**, so per the golden rule they do not cap this plan. They SHOULD be addressed in a dedicated dependency-hygiene pass (recommend a separate `/to-plan deps-hygiene-sweep`). Highest-signal HIGHs:

| Dep | Severity | CVE | Fixed in | Note |
|---|---|---|---|---|
| `vite` | HIGH | CVE-2026-53571 (`server.fs.deny` bypass on Windows) | >=6.4.3 / >=7.3.5 | dev-server; Windows-specific |
| `undici` | HIGH ×3 | CVE-2026-1528/1526/2229 (WebSocket overflow / memory / validation) | >=7.24.0 | transitive |
| `minimatch` | HIGH ×3 | CVE-2026-26996/27903/27904 (ReDoS) | >=10.2.3 | transitive |
| `ws` | HIGH | CVE-2026-48779 (memory-exhaustion DoS) | >=8.21.0 | framework peer; **not touched by this plan** (Phase 3 is HTTP, not WebSocket) — bump peer floor in the hygiene sweep |
| `form-data` | HIGH | CVE-2026-12143 (CRLF injection) | >=4.0.6 | transitive |
| `wrangler` | HIGH | CVE-2026-0933 (OS command injection) | >=4.59.1 | dev tooling (CF adapter) |
| `valibot` | HIGH | CVE-2025-66020 (ReDoS) | >=1.2.0 | transitive |
| `esbuild` | HIGH/LOW | GHSA-gv7w-rqvm-qjhr / GHSA-g7r4-m6w7-qqqr | >=0.28.1 | build/dev |

> **Honesty note:** because `osv-scanner` is not installed, the cross-ecosystem cross-check did not run. `pnpm audit` (the authoritative npm auditor) DID run, so npm coverage is real — but a second source did not confirm. Install `osv-scanner` for defense-in-depth before a release-gating audit.

## Plan validation (Mode 2)

| Check | Result |
|---|---|
| `## Dependencies` section present | **NO** → `plan_missing_dependencies_section` (hard cap #4) |
| New deps introduced | none |
| Version changes introduced | none |
| Plan-touched deps with CRITICAL/HIGH CVE | none (`react-router` is LOW; `better-sqlite3` clean) |
| Rule 9 evaluation needed | n/a (no NEW deps) |

## Recommended next steps

1. **Add a `## Dependencies` section to the plan** declaring "no new dependencies" + the existing touched deps with their audit status (resolves `plan_missing_dependencies_section`, flipping the structural verdict from `INVALID_PLAN_DEPS` to `PASS_WITH_CAVEATS`). This is a plan revision (v1.2), separate from this read-only audit.
2. Optionally bump the `react-router` peerDep floor to `^7.15.1` in a separate dependency-hygiene change (LOW; not required to proceed).
3. File a separate `/to-plan deps-hygiene-sweep` for the 20 HIGH standing findings (out of scope for this plan).
4. Re-run `/deps-audit crossval-native-routing-web-fixes` after step 1 to confirm `PASS_WITH_CAVEATS`, then proceed to `/plan-confidence`.
