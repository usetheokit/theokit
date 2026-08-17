# Discovery Plan: Caddyfile CSP for Vite-Dev vs Prod-Bundle SPA Topology

> **Version 1.1** — A live regression on 2026-06-26 (`app-dev.usetheo.dev/device-verify`) revealed that the local-edge Caddyfile (`infra/local/Caddyfile`) shipped a prod-strict CSP via the #44/#45/#46 fixes (release-blockers-2026-06-25-set) while the upstream is a Vite dev server (`reverse_proxy localhost:5173`). The CSP intersects with the SPA's own `<meta>` CSP and the production `nginx.conf` CSP, breaking Vite HMR inline scripts, Google Fonts, and Vite module paths (`/src/*`, `/@vite/*`). This discovery investigates how SPA frameworks separate the dev-mode CSP from the prod-bundle CSP, the canonical CSP nonce / hash strategy for inline scripts, the Google-Fonts allow-list patterns, and the environment-conditional CSP middleware shape — to inform a clean Caddyfile fix that does not regress the live-edge demo (`task cloud:caddy:up`) AND does not weaken the prod-bundle CSP shipped in `dashboard/nginx.conf`. The resulting blueprint will compare three references: `next.js` (Vercel — canonical SPA prod-bundle + nonce), `astro` (Vite-based — closest topology to ours), and `hono` (middleware shape — canonical `secureHeaders` reference).
>
> **v1.1 (2026-06-26)** absorbs 3 MUST FIX from edge-case review at `.claude/knowledge-base/reviews/caddyfile-csp-vite-dev-vs-prod-bundle-edge-cases-2026-06-26.md`: EC-1 (Q3 method swap ast-grep → Grep), EC-2 (Q4 add canonical astro CSP source `core/csp/config.ts`), EC-3 (Q7 add canonical Next.js self-host font packages). All edits are scoped to the Research Questions table; ADRs / Coverage Matrix / Halt-loop / Acceptance Criteria unchanged.

**Slug:** `caddyfile-csp-vite-dev-vs-prod-bundle`
**Owner:** paulohenriquevn
**Created:** 2026-06-26
**Updated:** 2026-06-26 (v1.1 edge-case absorption)
**Time budget:** 4h (per-project breakdown in ADR D1)
**Reference clone date:** 2026-06-26 (`git clone --depth=1` from upstream `main` of vercel/next.js, withastro/astro, honojs/hono) — see EC-5 in edge-case review

## Context

Live regression captured 2026-06-26 against `app-dev.usetheo.dev/device-verify` (operator local Caddy edge per `infra/local/Caddyfile:1-19`). Browser console errors:

1. `Executing inline script violates ... 'script-src 'self''. Either the 'unsafe-inline' keyword, a hash (...), or a nonce (...) is required`
2. `Loading the stylesheet 'https://fonts.googleapis.com/css2?...' violates ... "style-src 'self' 'unsafe-inline'"`
3. `Failed to load resource: 404 ()` on `main.tsx` + `client` (the `handle /src/*` + `handle /@vite/*` blocks shipped in #46)

**Root cause classification:** the 3 fixes were correct **for the prod-bundle path** (`dashboard/Dockerfile` multistage → `nginxinc/nginx-unprivileged:1.28-alpine3.21` serving `dist/` with `nginx.conf` CSP) but the local-edge Caddyfile path is **Vite dev** (`reverse_proxy localhost:5173`). The Caddy CSP header intersects with the page's own `<meta>` CSP (browsers enforce the stricter); the Caddy header wins and breaks Vite HMR.

Internal evidence read pre-discovery (per `.claude/rules/cycle-discover.md § Do NOT trigger` exception is partly applicable — 4 of 7 questions below are answerable internally; the other 3 require external comparison):

- `infra/local/Caddyfile:92-107` — block `app-dev.usetheo.dev` with `header { ... Content-Security-Policy ... }` (the bug surface)
- `dashboard/index.html:6` — `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; ...">` (canonical SPA CSP, allows inline scripts + Google Fonts)
- `dashboard/nginx.conf:21-25` — `add_header Content-Security-Policy "default-src 'self'; script-src 'self'; ..."` (prod-container CSP — STRICTER than `index.html`; allows no inline)
- `dashboard/vite.config.ts:8-32` — `devCspRelax()` Vite plugin (`apply: 'serve'`) that injects dev origins into `form-action` + `connect-src` ONLY in dev (canonical in-repo precedent for environment-conditional CSP)
- `dashboard/Dockerfile:1-25` — multistage prod-bundle (nginx-served) shipped to `ghcr.io/usetheodev/theo-cloud:develop` per `infra/helmfile/values/dev-public/theo-cloud.yaml.gotmpl:14`

Project rule applicable: `.claude/rules/architecture.md § Cross-Project Rule 9` — internals (Vite, Tailwind, Next.js) belong in DEEP DIVE; this knowledge-base file IS DEEP DIVE per `public-copy.md § Scope`.

## Objective

**One sentence:** Produce a blueprint that recommends a canonical CSP shape for the local-edge Caddyfile that (a) does NOT break Vite HMR + Google Fonts + Vite paths, (b) does NOT weaken the prod-bundle `dashboard/nginx.conf` CSP, and (c) does NOT contradict `dashboard/index.html`'s `<meta>` CSP shipped to the browser.

Measurable success criteria for the blueprint:

- [ ] All 7 research questions answered with citations to `knowledge-base/references/{next.js,astro,hono}/`
- [ ] Cross-cutting comparison table populated for all 3 in-scope reference projects (next.js + astro + hono)
- [ ] Recommendations section provides 3 concrete decision proposals: (R1) what CSP shape the Caddyfile MUST emit; (R2) whether to relax the Caddyfile CSP OR remove it entirely; (R3) whether `dashboard/index.html`'s `<meta>` CSP should adopt nonces (eliminate `'unsafe-inline'`) or stay as-is
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS (per `discover-blueprint-golden-rule.md § 5`)

## In-Scope / Out-of-Scope

### In-Scope (per reference project)

| Project | In-scope subdirectories | Reason |
|---|---|---|
| `knowledge-base/references/next.js/` | `packages/next/src/server/render.tsx`, `packages/next/src/server/image-optimizer.ts`, `packages/next/src/server/app-render/app-render.tsx` | Canonical SPA prod-bundle + nonce-per-request CSP strategy. The 3 files are the only ones in the next.js source tree that grep-matched `Content-Security-Policy` (Q5 + Q6 + Q7 cite them) |
| `knowledge-base/references/astro/` | `packages/astro/test/csp.test.ts`, `packages/astro/test/csp-server-islands.test.ts`, `packages/astro/e2e/csp-server-islands.test.ts`, `packages/astro/e2e/csp-client-only.test.ts`, `packages/integrations/node/src/index.ts`, `packages/integrations/node/test/static-headers.test.ts` | Vite-based SPA framework with the closest topology to ours (Vite dev → prod build → headers). Has both unit + e2e CSP test fixtures (Q1) AND a node integration that sets static headers (Q4) |
| `knowledge-base/references/hono/` | `src/middleware/secure-headers/index.ts`, `src/middleware/secure-headers/secure-headers.ts`, `src/middleware/secure-headers/index.test.ts`, `src/middleware/secure-headers/permissions-policy.ts` | Canonical `secureHeaders` middleware shape (Q2 + Q6). Tiny surface (~520 files total in repo), easy to read end-to-end within the 30min sub-budget |

### Out-of-Scope (explicit)

| Project / Subdir | Why excluded |
|---|---|
| `knowledge-base/references/next.js/test/` | Test fixtures total ~29506 files; primary citation targets are source files. Test paths cited via explicit grep hits only |
| `knowledge-base/references/next.js/packages/next-codemod/` | Codemod tool, not framework CSP |
| `knowledge-base/references/astro/packages/integrations/{vercel,netlify}/` | Adapter-specific, lift to follow-up discovery if needed |
| `knowledge-base/references/nitro/` | Cloned but grep for `Content-Security-Policy` / `csp` / `nonce` in `nitro/src` returned ZERO matches. ADR D3 explicitly defers nitro from primary scope |
| `knowledge-base/references/fastify/` | Cloned but core repo lacks `@fastify/helmet` (separate package not in our refs). ADR D3 defers fastify from primary scope |
| `knowledge-base/references/{codex,opencode,nemo-guardrails,openguardrails-agentfw,workers-sdk}/` | Not SPA-CSP-relevant (agent/runtime/CLI projects) |
| Vercel CLI / Vercel platform refs in the `theo` subrepo | Different scope (build platform, not SPA framework). Already inspected; CSP code only in test fixtures |
| Theo's own `theo-cloud/dashboard/**` source | Internal — answers via Grep/Read in the implementation phase, NOT discovery |

## ADRs

### D1 — Time budget + stop conditions

**Decision:** next.js: 2h, astro: 1.5h, hono: 30min. Total 4h.

**Rationale:** next.js is the canonical SPA prod-bundle reference + has the largest source surface (29506 files) so deepest dive. astro is the closest Vite-based topology (closest analog to ours) + has both unit and e2e CSP test fixtures so high-value medium-depth dive. hono is small (520 files, single `src/middleware/secure-headers/` dir) and provides middleware-shape reference — fast read, high signal.

**Alternatives considered:**
- Equal 1.5h split across 3 → biased toward less-relevant next.js depth; astro is the closer topology analog so deserves equal weight, not more
- Single project deep-dive (next.js only) → would miss astro's Vite-specific CSP test fixtures + hono's clean middleware shape
- No time budget → halt-loop would over-invest in next.js's deep source tree

**Stop condition — per question (mandatory):** When a question's Fase A returns empty matches after 3 consecutive retries with different query variants (pattern → kind-based → alternate path → broader scope), mark the question BLOCKED with reason "Fase A exhausted — no hotspots found" and continue to the next.

**Stop condition — per project (mandatory):** When a project's time budget is exhausted with N questions still pending, mark all remaining questions for that project as BLOCKED with reason "budget exhausted" and continue with the next project. If every remaining project is in the same state, emit `<promise>BLUEPRINT_BLOCKED</promise>` (NOT `BLUEPRINT_COMPLETE`).

**Anti-pattern:** NEVER fabricate Fase B answers to close a question whose Fase A was exhausted. Honest BLOCKED with reason is required (Unbreakable Rule 3).

**Consequences:** The halt-loop will stop iterating on a project when its budget is exhausted, even if some questions remain blocked. The blueprint will surface blocked questions explicitly in the `## Blocked questions (if any)` section.

### D2 — Investigation depth

**Decision:** Read each grep-matched file end-to-end (Fase B) ONLY when Fase A returns ≤ 5 hotspots per question. When Fase A returns > 5, sub-bucket by AST-kind (function vs class vs comment vs string-literal) and Read only the top-3 most-relevant buckets.

**Rationale:** next.js's `app-render.tsx` is 2000+ LoC; reading end-to-end exceeds the per-question sub-budget. Bucket-then-Read keeps the investigation scoped while preserving correctness.

**Alternatives considered:**
- Read every grep hit end-to-end → blows time budget, drowns signal in noise
- Read only the first hit per question → arbitrary, may miss the canonical path

**Consequences:** Some questions will produce ADR-style decision-grade evidence; others will be best-effort. The blueprint MUST mark which is which per question.

### D3 — Reference projects deferred

**Decision:** nitro + fastify cloned but DEFERRED from primary investigation scope.

**Rationale:** Pre-validation grep returned ZERO matches for `Content-Security-Policy` / `csp` / `nonce` in `nitro/src`. fastify's CSP middleware lives in `@fastify/helmet` (separate npm package, not in our refs clone). Forcing either into a question would either fabricate a no-coverage answer (Rule 3 violation) or pad with off-topic hotspots from elsewhere in the repo.

**Alternatives considered:**
- Clone `@fastify/helmet` separately → adds 1 more ref repo to manage; the canonical helmet pattern is already represented by hono's `secureHeaders`
- Force questions into nitro anyway → produces low-quality answers that risk failing the discover-confidence rubric

**Consequences:** Coverage Corner mapping has fewer reference projects per corner. Each corner still has ≥ 1 question (validation per `discover-plan-golden-rule.md § 1`).

### D4 — Why DISCOVER runs despite the `Do NOT trigger` exception

**Decision:** Run DISCOVER even though `cycle-discover.md § Pre-conditions` lists "Questions answered by reading your own README/ARCHITECTURE" as a NOT-trigger case.

**Rationale:** Per sponsor mandate (`feedback_cycle_max_rigor_no_skip_2026_06_26` 2026-06-26): cycle phases run with maximum rigor, no skips. The internal-only portion is documented as Baseline Context (read pre-plan) per the SOTA template; the external comparison portion is what DISCOVER actually adds. The 7 research questions are framed so they cannot be answered from `theo-cloud/dashboard/**` alone — they require comparing how Next.js / Astro / Hono handle the same problem.

**Alternatives considered:**
- Honest-skip per the `Do NOT trigger` exception → faster but violates the new sponsor mandate
- Force-run with zero refs cloned → fabricated citations, INVALID hard cap

**Consequences:** DISCOVER produces a real blueprint with cross-project comparison evidence. The 4h time investment is justified because the external comparison materially shapes R1/R2/R3 recommendations.

## Research Questions

Numbered list. Each question maps to a Coverage Corner (tests / deps / tools / techniques). Each declares BOTH phases of the investigation upfront.

| # | Question | Corner | Reference project(s) | Fase A (broad — ast-grep map) | Fase B (deep — Read at each hotspot) | Expected answer shape |
|---|---|---|---|---|---|---|
| Q1 | What CSP shape does astro's integration test fixture assert? Does it test dev-mode-relaxed CSP separately from prod-strict CSP? | tests | `knowledge-base/references/astro/packages/astro/test/csp.test.ts`, `knowledge-base/references/astro/packages/astro/test/csp-server-islands.test.ts`, `knowledge-base/references/astro/packages/astro/e2e/csp-server-islands.test.ts`, `knowledge-base/references/astro/packages/astro/e2e/csp-client-only.test.ts` | SKIP Fase A — exact file paths known. Glob the 4 test files directly | Read each test file end-to-end; capture each `expect(*.headers['content-security-policy'])` assertion + the mode (unit/e2e, dev/prod fixture) it ran under | Table: test file → CSP assertion(s) → mode (dev/prod) → notable directives (script-src / style-src / nonce / hash) |
| Q2 | What permissions-policy + CSP shapes does hono's secureHeaders middleware test? Does the test cover environment-conditional shapes? | tests | `knowledge-base/references/hono/src/middleware/secure-headers/index.test.ts`, `knowledge-base/references/hono/src/middleware/secure-headers/permissions-policy.ts` | SKIP Fase A — single test file known. Glob both paths | Read `index.test.ts` end-to-end; capture every `describe`/`it` covering CSP/permissions. Read `permissions-policy.ts` to see options schema | Table: test name → header asserted → option shape used (defaults vs override) → whether dev/prod modes are differentiated |
| Q3 | What CSP-related deps does next.js declare? Is the CSP implementation in `packages/next` core OR in a sub-package? | deps | `knowledge-base/references/next.js/packages/next/package.json`, `knowledge-base/references/next.js/packages/next/src/` | `Grep 'csp\|content-security' knowledge-base/references/next.js/packages/next/package.json` (plain Grep on canonical file — replaces v1.0's unreliable `ast-grep --lang json`); if zero matches → Read `package.json` end-to-end + report "no CSP-named dep" as the canonical answer | Read `package.json` end-to-end; grep matched source files in `packages/next/src/` for `import.*csp` to determine source location | Version + sub-package name + import paths used by core |
| Q4 | How does Astro's centralized CSP config differ between dev and prod? Does the node integration override it? Does the integration set a CSP that is dev-relaxed by default? | tools | **Primary (canonical CSP source):** `knowledge-base/references/astro/packages/astro/src/core/csp/config.ts`, `knowledge-base/references/astro/packages/astro/src/core/csp/` (dir); **Secondary (adapter-specific runtime headers):** `knowledge-base/references/astro/packages/integrations/node/src/index.ts`, `knowledge-base/references/astro/packages/integrations/node/test/static-headers.test.ts` | `Grep -rln 'mode\|development\|production' knowledge-base/references/astro/packages/astro/src/core/csp/` (mode-conditional discovery); then SKIP for secondary paths (known) | Read `core/csp/config.ts` end-to-end first to find the canonical option shape + any dev/prod branching; THEN read `integrations/node/src/index.ts` to capture the adapter's static-header injection; capture whether either layer is conditional on `import.meta.env.DEV` or similar | Conditional shape (if any) in EITHER core CSP config OR adapter integration + the exact header dictionary set in prod vs dev |
| Q5 | How does next.js generate per-request CSP nonces in `render.tsx`? Where is the nonce written into the HTML stream + into the response header? | techniques | `knowledge-base/references/next.js/packages/next/src/server/render.tsx`, `knowledge-base/references/next.js/packages/next/src/server/app-render/app-render.tsx` | `ast-grep run --pattern 'nonce' --lang typescript knowledge-base/references/next.js/packages/next/src/server/` — narrow to render.tsx + app-render.tsx | Read each nonce hit + its surrounding 10-30 lines to capture: (a) where nonce is generated (req-scoped vs static), (b) where it's injected into `<script nonce=...>`, (c) whether the response header is set in parallel | Step-by-step sequence: nonce-source → nonce-into-html → nonce-into-csp-header |
| Q6 | How does hono's secureHeaders compose the CSP value? Does it support environment-conditional shapes (relax in dev, strict in prod) OR is the consumer responsible for branching? | techniques | `knowledge-base/references/hono/src/middleware/secure-headers/index.ts`, `knowledge-base/references/hono/src/middleware/secure-headers/secure-headers.ts` | SKIP Fase A — exact paths known. Glob both | Read both files end-to-end (small surface). Capture the option schema for `contentSecurityPolicy` + whether `if (process.env.NODE_ENV ...)` branching exists in the middleware OR is a consumer concern | Option schema + dev/prod branching shape (middleware-internal vs consumer-responsibility) |
| Q7 | How does astro / next.js handle Google Fonts under a strict-CSP regime? Self-hosted via build-time fetch OR allowlist `https://fonts.googleapis.com`? | techniques | **Primary (canonical Next.js self-host strategy):** `knowledge-base/references/next.js/packages/font/`, `knowledge-base/references/next.js/packages/next/font/`; **Secondary (next.js SSR header path):** `knowledge-base/references/next.js/packages/next/src/server/render.tsx`; **Astro side:** `knowledge-base/references/astro/packages/astro/test/csp.test.ts`, `knowledge-base/references/astro/packages/astro/e2e/csp-client-only.test.ts` | Grep `fonts.googleapis.com\|fonts.gstatic.com\|google\|gstatic` recursively across primary paths (next.js font packages — canonical self-host strategy lives there post-v13, NOT in render.tsx); Grep `font-src` directive shape in astro test files | Read each match in 10-line context. CRITICAL: Next.js since v13 self-hosts Google Fonts at build time (downloads to `/_next/static/media/`) — readers must verify this in the `font` package source, NOT infer from server/render.tsx (which would mislead toward an allowlist conclusion). Identify whether the canonical strategy is self-host (build-time download) OR allowlist | Strategy table: framework → strategy (self-host / allowlist / both) → CSP directive shape + concrete file:line evidence per framework |

## Coverage Matrix

Every Coverage Corner MUST have at least one Research Question mapped to it. If a corner is empty, an ADR MUST justify deferral.

| Corner | Questions mapped | Status |
|---|---|---|
| Integration tests | Q1, Q2 | Covered |
| Dependencies | Q3 | Covered |
| Tools | Q4 | Covered |
| Techniques | Q5, Q6, Q7 | Covered |

**Coverage: 4/4 corners covered (100%)**

## Halt-loop Checkpoints

For `/discover-execute`: what intermediate state MUST hold before the loop can mark a question DONE.

| Checkpoint | Assertion | Action if fails |
|---|---|---|
| Before answering Qx | `knowledge-base/references/{project}/{path}` declared in Fase A exists | Mark Qx BLOCKED with reason "path not found", continue to next |
| Per-question Fase A budget | Fase A returned at least one hotspot OR 3 query-variant retries attempted | After 3 retries with empty results, mark Qx BLOCKED with reason "Fase A exhausted"; continue |
| After answering Qx | Blueprint section under Qx has at least one citation in the form `knowledge-base/references/{project}/{path}:{line}` | Re-iterate Qx (1 retry max) |
| Mid-loop sanity | Total citations to `knowledge-base/references/` ≥ 14 (2 per question × 7 questions) | Add citations to under-cited paragraphs (1 retry max) |
| Per-project time budget | Project time budget not exhausted | When exhausted, mark all remaining Qx for that project BLOCKED with reason "budget exhausted"; advance to next project |
| Before promising complete | All 4 coverage corners have populated sections AND at least 1 ADR section synthesizes decisions | Refuse `BLUEPRINT_COMPLETE`, continue iterating |
| Post-promise sanity (Step 7) | Re-verify every `knowledge-base/references/` citation resolves via `Path.exists()` | If any fails, downgrade promise to `BLUEPRINT_BLOCKED` + surface |

## Acceptance Criteria

Observable conditions for "this discovery is done":

- [ ] All 7 research questions answered OR explicitly marked BLOCKED with reason
- [ ] All 4 coverage corners have populated sections in the blueprint
- [ ] Every citation in the blueprint points to a real `knowledge-base/references/{...}` path (`Path.exists()` true)
- [ ] At least one ADR section in the blueprint synthesizes decisions taken (R1 + R2 + R3 recommendations)
- [ ] Time budget respected per project (next.js ≤ 2h, astro ≤ 1.5h, hono ≤ 30min, total ≤ 4h)
- [ ] `/discover-confidence` verdict ≥ SHIPPABLE_WITH_CAVEATS
- [ ] Blueprint saved at `knowledge-base/discoveries/blueprints/caddyfile-csp-vite-dev-vs-prod-bundle-blueprint.md`

## Global Definition of Done

- [ ] All cycle-discover phases completed: plan → edge-cases → plan-confidence → execute → confidence (→ improve if NEEDS_REVISION → confidence re-score)
- [ ] Final `/discover-confidence` verdict recorded in the blueprint header
- [ ] No fabricated citations (per `discover-blueprint-golden-rule.md § 1` hard cap)
- [ ] Coverage Matrix 100% covered (per `discover-plan-golden-rule.md § 1` hard cap)
- [ ] ADRs reference at least one principle from project rules: KISS (simplest CSP shape that works), SRP (CSP per topology not per-environment overload), Don't Reinvent (use established CSP middleware patterns vs custom shapes)
- [ ] Blueprint downstream-consumable by `/to-plan` for the implementation phase (caddyfile-csp-fix slug)
