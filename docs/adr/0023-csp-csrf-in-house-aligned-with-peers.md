# 0023. CSP + CSRF stay in-house — aligned with Next.js, SvelteKit, Astro, Remix

* Status: accepted
* Date: 2026-06-02
* Deciders: [TheoKit team]
* Tags: [security, csp, csrf, dependencies, in-house, rule-9-exception]

## Context and Problem Statement

The 0.3.0 cutover ships strict CSRF + CSP enforce defaults (commits `3ee9dac`, `cc464c0`, `f13b371`, `380a3fc`, `1442a0a`). All security primitives are implemented in-house under `packages/theo/src/server/security/`:

```
packages/theo/src/server/security/
├── csrf.ts
├── csrf-multi-header.ts        # Sec-Fetch-Site → Origin → Referer chain
├── csrf-warn-dispatch.ts       # csrf.warn telemetry with code + docsUrl
├── csrf-readiness-store.ts     # warn-mode counters
├── csrf-readiness-endpoint.ts  # /__theo/csrf-readiness JSON
├── csrf-disallowed-routes.ts   # per-route escalation
├── wildcard-origin.ts          # allowedOrigins matcher
├── csp-report.ts               # CSP violation handler
├── security-headers.ts         # CSP/X-* headers
└── index.ts
```

Under monorepo CLAUDE.md Inquebrável §9 (Não Reinvente a Roda), we are obligated to evaluate whether a mature off-the-shelf library would resolve this surface before shipping in-house. The candidates considered:

- **`csurf`** (Express CSRF) — npm-historic, deprecated as of 2022.
- **`helmet`** (security headers) — widely adopted Express middleware.
- **`csp-header`** / **`csp-builder`** — directive builders.
- **`content-security-policy-builder`** — CSP serialization helpers.

The question: should TheoKit adopt any of these instead of (or alongside) the in-house implementation?

## Decision Drivers

* §9 demands we use mature OSS rather than rebuild — but §9 also permits in-house when "the abstraction is so thin that the dependency costs more than the implementation".
* Cross-product invariant: TheoKit's bundle budget is 350 KB gzipped. Every transitive dep counts.
* Convergent peer-framework practice (4 mature frameworks investigated) is a powerful signal — if Next.js/SvelteKit/Astro/Remix all chose the same path, that path is the de facto industry standard for this surface.
* The 0.3.0 cutover blueprint (`.claude/knowledge-base/discoveries/blueprints/theokit-0-3-0-enforcement-cutover-blueprint.md` Q3, SHIPPABLE_WITH_CAVEATS 89/100) executed the confirming-negative empirically.

## Considered Options

1. **Adopt `helmet` for security headers + in-house CSRF**
2. **Adopt `csurf` for CSRF + in-house CSP**
3. **Adopt both `helmet` and a CSRF lib**
4. **In-house everything (current state)**

## Decision Outcome

**Chosen option: 4 — in-house everything.**

The 0.3.0 cutover blueprint Q3 ran `grep -lE '"csurf"|"helmet"|"csp-' references/{next.js,sveltekit,astro,remix}/**/package.json` against the 4 mature framework cores (cloned under `.claude/knowledge-base/references/`). Result: **0 hits across all 4 cores**. Three regex variants tried; same negative result.

| Framework | Runtime CSP/CSRF dep | Implementation locus |
|---|---|---|
| **Next.js** | None | In-house — `references/next.js/examples/with-strict-csp/middleware.js:1` is user-side example (NOT a framework default) |
| **SvelteKit** | None | In-house — `references/sveltekit/packages/kit/test/apps/options/svelte.config.js:8` shows `kit.csp.directives` config consumed at SSR boundary |
| **Astro** | None | In-house — `references/astro/packages/astro/CHANGELOG.md:1530` shows `experimental.csp` → `security.csp` rename, all in-house |
| **Remix** | None | In-house — `references/remix/packages/csrf-middleware/src/lib/csrf.ts:1` confirms zero runtime deps for CSRF logic (uses `@remix-run/fetch-router` types + `@remix-run/session` only) |

This is a 4/4 convergent confirming-negative across the canonical TS/JS frameworks. The in-house path IS the industry pattern for this surface.

**Why none of them adopt the libs:**
- `csurf` (Express-coupled) does not fit fetch-handler / Web Standards runtimes.
- `helmet` ships an unscoped headers bundle; modern frameworks want per-route control + nonce-aware serialization.
- `csp-header` / `csp-*` libs solve a thin serialization problem that any framework can absorb in < 100 LoC.

## Consequences

### Positive

* **Bundle stays lean.** No transitive deps for security primitives — saves ~30-50 KB gzipped (helmet + csp-header + transitives).
* **Framework owns security correctness.** No vendor escape hatch where a dep update breaks our threat model. The team is accountable end-to-end.
* **First-of-kind contracts are possible.** `CsrfReadinessStore` (`packages/theo/src/server/security/csrf-readiness-store.ts`) + `CsrfReadinessTab` (devtools) ship warn-mode telemetry that no peer framework offers. Building these on top of a 3rd-party dep would have meant fighting the dep's abstraction.
* **Convergent peer pattern documented.** Future contributors can cite this ADR + blueprint Q3 instead of re-litigating the in-house decision.

### Negative

* **Team owns the CVE response surface.** If a CSRF bypass technique emerges (e.g., a novel Sec-Fetch-Site interpretation), we patch it ourselves — no Renovate / Dependabot bumps cover it.
* **Single-maintainer risk on security correctness.** Mitigated by `tests/unit/csrf-*.test.ts` + `tests/e2e/ssr-nonce.spec.ts` + the upcoming `tests/e2e/csp-blocks-external-script.spec.ts` (T2.1 of the 0.3.0 cutover plan).
* **No community pattern library.** Apps wanting "do what Next.js does" must read TheoKit source rather than `npm install helmet`.

### Neutral

* Future Onda 3+ telemetry export (OTel/Sentry adapters) ships a thin custom layer rather than `prom-client` style — same convergent-negative applies, no peer framework adopted a "csp-metrics" library either.

## Re-evaluation triggers

This decision can be revisited ONLY IF all three hold:

1. Two or more of {Next.js, SvelteKit, Astro, Remix} adopt a runtime dep for CSRF or CSP and document the choice in their CHANGELOG.
2. A TheoKit security CVE response window misses its target (we can't patch within 7 days of disclosure) because the in-house code's complexity exceeds team capacity.
3. A specific dep emerges with peer-validated correctness audits (e.g., a NIST-reviewed CSP serializer).

Until all three hold, the in-house path stands.

## References

* **Blueprint (evidence source):** `.claude/knowledge-base/discoveries/blueprints/theokit-0-3-0-enforcement-cutover-blueprint.md` Q3 (confirming-negative across 4 frameworks).
* **Cutover plan:** `.claude/knowledge-base/plans/theokit-0-3-0-enforcement-cutover-plan.md` v1.1 ADR D3.
* **Migration guide cross-link:** `docs/migration/0.2-to-0.3.md#rollback` (Opt-out via config flag subsection).
* **Code locus:** `packages/theo/src/server/security/` (all in-house security primitives).
* **Monorepo Inquebrável §9:** `Não Reinvente a Roda` — this ADR documents the §9 exception under the "abstraction is too thin to justify the dep" clause.
* **Convergent peer source paths (verified at blueprint execute time):**
  - `references/next.js/examples/with-strict-csp/middleware.js:1`
  - `references/sveltekit/packages/kit/test/apps/options/svelte.config.js:8`
  - `references/astro/packages/astro/CHANGELOG.md:1530`
  - `references/remix/packages/csrf-middleware/src/lib/csrf.ts:1`
