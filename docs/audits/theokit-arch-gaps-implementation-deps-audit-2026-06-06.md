# Deps Audit: theokit-arch-gaps-implementation

**Date:** 2026-06-06
**Mode:** plan-bound (`theokit-arch-gaps-implementation`)
**Plan analyzed:** `docs/plans/theokit-arch-gaps-implementation-plan.md` (v1.2)
**Auditor:** `pnpm audit --json` (npm ecosystem)
**Verdict:** **FAIL_INSECURE** — 1 CRITICAL CVE em direct dep bloqueia gate

## Hard caps triggered

- `plan_dep_critical_cve` — vitest <4.1.0 (GHSA-5xrq-8626-4rwp)

## Summary

| Metric | Value |
|---|---|
| Ecosystems detected | npm (TS-only project) |
| Auditors run | `pnpm audit --json` ✓ ; `osv-scanner` SKIPPED (binary not installed) |
| Total advisories | 8 |
| Severity breakdown | 1 CRITICAL · 3 HIGH · 4 MODERATE · 0 LOW |
| Direct dep affected (Plan-listed) | 1 (vitest) |
| Transitive affected | 7 (esbuild, minimatch×3, vite, postcss, uuid) |
| Allowlist hits | 0 active · 0 expired |

## Vulnerabilities

### CRITICAL — vitest <4.1.0 (direct, plan-listed)

| Field | Value |
|---|---|
| GHSA | GHSA-5xrq-8626-4rwp |
| Package | vitest |
| Vulnerable range | <4.1.0 |
| Patched | ≥4.1.0 |
| Title | When Vitest UI server is listening, arbitrary file can be read and executed |
| Path | `.>vitest` (direct in packages/theo); `..__theo-ui>vitest` (transitive via @theokit/ui) |
| Severity source | npm Advisory DB (GHSA) |

**Diff suggestion:**
```diff
- "vitest": "^3.x.x"
+ "vitest": "^4.1.0"
```

**Plan reference:** Plan declara `vitest` na `## Dependencies > Existing` com nota "bump to ≥4.1.0 OBRIGATÓRIO em T0.2". `Phase 0 T0.2` adicionado em plan v1.2 para resolver antes de Phase 1.

### HIGH × 3 — minimatch <10.2.3 (transitive via eslint-plugin-sonarjs)

| Field | Value |
|---|---|
| GHSAs | GHSA-3ppc-4f35-3m26, GHSA-7r86-cg39-jmmj, GHSA-23c5-xmqv-rm74 |
| Package | minimatch |
| Vulnerable range | ≥10.0.0, <10.2.3 (latest CVE); subset <10.2.1 (GHSA-3ppc) |
| Patched | ≥10.2.3 |
| Title | ReDoS via multiple patterns (wildcards, extglobs, matchOne backtracking) |
| Path | `.>eslint-plugin-sonarjs>minimatch` |

**Diff suggestion (TRANSITIVE — not direct dep):**
```diff
# In package.json (root or packages/theo):
+ "pnpm": {
+   "overrides": {
+     "minimatch@>=10.0.0 <10.2.3": "10.2.3"
+   }
+ }
```

OR upgrade `eslint-plugin-sonarjs` para versão que use minimatch ≥10.2.3 (verificar via `pnpm why minimatch`).

**Plan reference:** Não direct, mas tooling lint usado por acceptance criteria de várias tasks (`pnpm lint` exit 0). Não bloqueia gate hoje (HIGH transitive cap 89), mas honest framing pede mitigation.

### MODERATE × 4 (transitive)

| GHSA | Package | Path | Patched |
|---|---|---|---|
| GHSA-67mh-4wv8-2f99 | esbuild <=0.24.2 | `.>drizzle-kit>esbuild`, `.>drizzle-kit>@esbuild-kit/esm-loader>@esbuild-kit/core-utils>esbuild` | ≥0.25.0 |
| GHSA-4w7w-66w2-5vf9 | vite <=6.4.1 | `..__theo-ui>vite` | ≥6.4.2 |
| GHSA-qx2v-qp2m-jg93 | postcss <8.5.10 | `..__theo-ui>geist>next>postcss` | ≥8.5.10 |
| GHSA-w5hq-g745-h8pq | uuid <11.1.1 | `.>autocannon>hyperid>uuid` | ≥11.1.1 |

Não bloqueiam plan gate (MODERATE transitive → não dispara `plan_dep_medium_cve` se não declared na seção). Recomendação: `pnpm dedupe` + verificar se @theokit/ui (sibling) pode upstream-bump vite.

## Outdated (non-vulnerable)

| Package | Current | Latest | Semver delta | Notes |
|---|---|---|---|---|
| `typescript` | `^5.0.0` | `6.0.3` | MAJOR | Plan NÃO bumpa. Defer to dedicated dep-upgrade. |
| `vite` | `^6.0.0` | `8.0.16` | MAJOR | Plan T2.6 mexe em vite-plugin mas mantém major 6. Bumpar para 8 seria escopo additional. |
| `zod` | `^3.24.0` | `4.4.3` | MAJOR | Plan T2.3 split schemas mantém Zod 3 (config schema atual). Bump zod 4 = breaking, separate plan. |
| `tsx` | `^4.19.0` | `4.22.4` | MINOR | Safe bump, opcional. |

Outdated MAJORs aceitáveis hoje (sem CVE atual no current range); cap não dispara per golden rule (`plan_dep_major_outdated_unpinned` só fires se sem ADR pinning — ADR D1 do `architecture.md` v3.1 documenta as escolhas de stack).

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `typescript` | Existing | yes (^5.0.0) | yes | n/a (existing) | OK |
| `vite` | Existing | yes (^6.0.0) | MODERATE transitive (em @theokit/ui only) | n/a | OK_WITH_NOTE |
| `vitest` | Existing | **CRITICAL CVE** | **NO** | n/a | **BLOCKER** |
| `zod` | Existing | yes (^3.24.0) | yes | n/a | OK |
| `tsx` | Existing | yes (^4.19.0) | yes | n/a | OK |
| `eslint-plugin-sonarjs` | Existing (transitive) | n/a direct | HIGH minimatch trans | n/a | OK_WITH_NOTE |
| `dependency-cruiser` | Existing | yes | yes | n/a | OK |
| `ts-morph` | NEW | n/a (to add ^28.0.0) | yes (no CVE) | yes (jscodeshift+@babel rejected) | OK |
| `publint` | NEW | n/a (to add ^0.3.21) | yes (no CVE) | yes (arethetypeswrong + custom Node rejected) | OK |
| `wrangler` | NEW | n/a (to add ^4.98.0) | yes (no CVE) | yes (miniflare + workerd standalone rejected) | OK |

**Plan validation result:** 1 BLOCKER (vitest CRITICAL) → cap em FAIL_INSECURE (49) até T0.2 absorvido.

Plan v1.2 absorveu T0.2 para bumpar vitest ≥4.1.0 antes de Phase 1 — **status: BLOCKER mitigated em ADR/plan; aguarda implementation**.

## Recommended next steps (ordem)

1. **OBRIGATÓRIO antes de Phase 1:** apply T0.2 — bump vitest `^4.1.0` em `packages/theo/package.json`. Run `pnpm install` + `pnpm test packages/theo` para verificar zero regression.
2. **SHOULD (após T0.2):** Re-run `/deps-audit theokit-arch-gaps-implementation` para confirm CRITICAL CVE resolvida — verdict deve subir para PASS_WITH_CAVEATS (3 HIGH transitive cap 89).
3. **OPTIONAL (mitigation HIGH transitive):** add `pnpm.overrides` para forçar `minimatch@^10.2.3` em eslint-plugin-sonarjs transitive path. Validation via `pnpm why minimatch`.
4. **OPTIONAL (mitigation MODERATE):** `pnpm dedupe` reduz dups esbuild/vite/postcss/uuid; coordenar com @theokit/ui (sibling) para upstream bumps.
5. **Proceed para `/plan-confidence theokit-arch-gaps-implementation`** após (1) e re-audit.

## Allowlist proposals (only if bump impossível)

NÃO RECOMENDADO para vitest CRITICAL — golden rule § Anti-pattern 10 exige sunset ≤30d para CRITICAL allowlists, e o bump é trivialmente aplicável.

Se necessário só para HIGH minimatch (transitive lockstep com eslint-plugin-sonarjs):

```
npm | minimatch | >=10.0.0,<10.2.3 | GHSA-3ppc-4f35-3m26,GHSA-7r86-cg39-jmmj,GHSA-23c5-xmqv-rm74 | 2026-09-04 | Transitive via eslint-plugin-sonarjs. ReDoS scope: lint-only, never reaches request boundary. Sunset 90d aguardando upstream bump.
```

(Aplicar manualmente em `.claude/rules/deps-audit-allowlist.txt` se decidido — fora do escopo desta skill read-only.)

## Auditor coverage

| Auditor | Status | Notes |
|---|---|---|
| `pnpm audit --json` | ran | 8 advisories returned |
| `npm audit --json` | NOT RE-RUN | redundante com pnpm audit (mesma fonte GHSA) |
| `osv-scanner --lockfile=pnpm-lock.yaml` | SKIPPED | binary not installed; recommendation: `brew install osv-scanner` for cross-check |
| `npm outdated --json` | inferred via `npm view` | manual checks for typescript/vite/zod/tsx — não JSON output |

**Honesty note:** auditor coverage NOT 100% (osv-scanner missing). Mitigation: pnpm audit consume GHSA/npm Advisory que é o source mais autoritative para npm ecosystem. Auditor gap aceitável (cap 70 só se HIGH/CRIT untestable — não é caso aqui porque pnpm audit detectou CRITICAL).

## Verdict summary

**FAIL_INSECURE (49) — plan_dep_critical_cve fire**

Mitigation path documented em plan v1.2 T0.2. Re-run `/deps-audit` após T0.2 esperar PASS_WITH_CAVEATS (cap 89 por HIGH transitive remainders).
