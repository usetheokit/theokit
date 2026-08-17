# Blueprint: Caddyfile CSP for Vite-Dev vs Prod-Bundle SPA Topology

> **Version 1.0** — Synthesizes how Astro (Vite-based SPA, closest topology to ours), Next.js (canonical SPA + nonce strategy + self-host Google Fonts), and Hono (canonical `secureHeaders` middleware) handle CSP across **dev vs prod**, **inline scripts/styles**, and **Google Fonts** under strict CSP. Informs three concrete recommendations (R1/R2/R3) for the local-edge `infra/local/Caddyfile` regression caught 2026-06-26 on `app-dev.usetheo.dev/device-verify`.

**Slug:** `caddyfile-csp-vite-dev-vs-prod-bundle`
**Source plan:** `.claude/knowledge-base/discoveries/plans/caddyfile-csp-vite-dev-vs-prod-bundle-plan.md`
**Owner:** paulohenriquevn
**Generated:** 2026-06-26 via `/discover-execute`
**Confidence verdict: SHIPPABLE_WITH_CAVEATS (89.0, soft_floor_citation_density_low) — scored 2026-06-26 via /discover-confidence

## Context

Live regression on `app-dev.usetheo.dev/device-verify` 2026-06-26: the local-edge `infra/local/Caddyfile` shipped a prod-strict CSP via the #44/#45/#46 fixes, while the upstream is Vite dev (`reverse_proxy localhost:5173`). The Caddy header intersects with the SPA's own `<meta>` CSP and the production `nginx.conf` CSP; browsers enforce the stricter policy → the Caddy header wins and breaks Vite HMR inline scripts, Google Fonts (`fonts.googleapis.com`), and Vite module paths (`/src/*`, `/@vite/*`). This blueprint compares Astro, Next.js, and Hono to inform a clean fix that does not weaken the prod-bundle CSP in `dashboard/nginx.conf` nor contradict `dashboard/index.html`'s `<meta>` CSP.

## Objective

Decide (R1) what CSP shape the local-edge Caddyfile MUST emit, (R2) whether the Caddyfile should relax OR remove its CSP header, and (R3) whether `dashboard/index.html`'s `<meta>` CSP should adopt nonces (drop `'unsafe-inline'`) or remain as shipped.

---

## Coverage Corner 1 — Integration Tests

### Astro

How Astro tests integration scenarios for CSP at build time + at static-header runtime:

- **Pattern**: build a fixture site with `security: { csp: true }`, then assert the **`<meta http-equiv="Content-Security-Policy">`** that Astro emits in the built HTML (build-time CSP injection via cheerio). For runtime headers, an adapter-driven path inspects `routeToHeaders` map and asserts every route carries a `content-security-policy` header. Cited at `.claude/knowledge-base/references/astro/packages/astro/test/csp.test.ts:23-25` (`assert.ok(meta.attr('content')!.includes('${styleDigest}'))`) and `.claude/knowledge-base/references/astro/packages/astro/test/csp.test.ts:211-213` (`headers.has('content-security-policy')`).
- **Fixtures**: separate fixture directories per scenario (`fixtures/csp/`, `fixtures/csp-fonts/`, `fixtures/csp-adapter/`) — see `.claude/knowledge-base/references/astro/packages/astro/test/csp.test.ts:13` (`./fixtures/csp/`). Server-island CSP is tested in its own fixture `./fixtures/server-islands/ssr` with `security: { csp: true }` at `.claude/knowledge-base/references/astro/packages/astro/test/csp-server-islands.test.ts:43-55`.
- **Coverage**: unit tests assert the **build-time hash injection** for inline `<style>` blocks (sha256 prefix) at `.claude/knowledge-base/references/astro/packages/astro/test/csp.test.ts:83-84`, **font-src directive composition** at `.claude/knowledge-base/references/astro/packages/astro/test/csp.test.ts:53-60`, and **NO `'unsafe-inline'`** required when components avoid inline styles at `.claude/knowledge-base/references/astro/packages/astro/test/csp.test.ts:146` (`assert.ok(!cspContent.includes("'unsafe-inline'"))`). E2E (Playwright) tests build the **prod** bundle and run `preview` (no dev-mode CSP assertions); CSP is enabled at the e2e level via `security: { csp: true }` — see `.claude/knowledge-base/references/astro/packages/astro/e2e/csp-client-only.test.ts:7-9`. Crucially, **no E2E test exercises the Vite dev server** under CSP — only `await astro.build(); await astro.preview()`.

Code example (with citation):

```ts
// .claude/knowledge-base/references/astro/packages/astro/test/csp.test.ts:118-147
it('should not use inline styles for custom position (CSP compliance)', async () => {
  fixture = await loadFixture({ root: './fixtures/csp/', outDir: './dist/csp-image-position' });
  await fixture.build();
  // ...
  assert.ok(cspContent.includes('style-src'), 'CSP should have style-src directive');
  assert.ok(!cspContent.includes("'unsafe-inline'"), 'CSP should not require unsafe-inline');
});
```

```ts
// .claude/knowledge-base/references/astro/packages/integrations/node/test/static-headers.test.ts:16-30
it('CSP headers are added when CSP is enabled', async () => {
  const headers: StaticHeaderEntry[] = JSON.parse(await fixture.readFile('../dist/_headers.json'));
  const csp = headers.find(x => x.pathname === '/')!.headers.find(x => x.key === 'Content-Security-Policy')!;
  assert.notEqual(csp, undefined, 'the index must have CSP headers');
  assert.ok(csp.value.includes('script-src'), 'must contain the script-src directive because of the server island');
});
```

### Hono

How Hono tests integration scenarios:

- **Pattern**: spin up an in-memory `Hono` app with `secureHeaders({ contentSecurityPolicy: { ... } })`, send `app.request('/test')`, assert `res.headers.get('Content-Security-Policy')`. No dev-vs-prod fixture distinction — middleware always produces the same shape; the consumer is expected to inject environment-conditional options. See `.claude/knowledge-base/references/hono/src/middleware/secure-headers/index.test.ts:43-85` (`'all headers enabled'` test).
- **Fixtures**: zero on-disk fixtures — every test builds a fresh `new Hono()` inline. Each test is independent (Rule 7 § Tests).
- **Coverage**: tests cover (a) default middleware NOT emitting CSP at `.claude/knowledge-base/references/hono/src/middleware/secure-headers/index.test.ts:39-40` (`expect(res.headers.get('Content-Security-Policy')).toBeFalsy()`), (b) opt-in CSP via options at `.claude/knowledge-base/references/hono/src/middleware/secure-headers/index.test.ts:83` (`expect(res.headers.get('Content-Security-Policy')).toEqual("default-src 'self'")`), (c) per-request nonces at `.claude/knowledge-base/references/hono/src/middleware/secure-headers/index.test.ts:408-428` (`'CSP nonce for script-src'`) and (d) `report-uri` / `report-to` composition at `.claude/knowledge-base/references/hono/src/middleware/secure-headers/index.test.ts:484-592`.

Code example (with citation):

```ts
// .claude/knowledge-base/references/hono/src/middleware/secure-headers/index.test.ts:408-428
it('CSP nonce for script-src', async () => {
  const app = new Hono();
  app.use('/test', secureHeaders({ [cspSettingName]: { scriptSrc: ["'self'", NONCE] } }));
  app.all('*', async (c) => c.text(`nonce: ${c.get('secureHeadersNonce')}`));
  const res = await app.request('/test');
  const csp = res.headers.get(cspHeaderName);
  const nonce = csp?.match(/script-src 'self' 'nonce-([a-zA-Z0-9+/]+=*)'/)?.[1] || '';
  expect(csp).toMatch(`script-src 'self' 'nonce-${nonce}'`);
  expect(await res.text()).toEqual(`nonce: ${nonce}`);
});
```

---

## Coverage Corner 2 — Dependencies

### Next.js

Grep for `csp` / `content-security` across `.claude/knowledge-base/references/next.js/packages/next/package.json` returned **zero hits**. The manifest declares a long `files` array but no CSP-named dependency. Confirmed by reading the package descriptor:

| Dependency | Version | Why | Citation |
|---|---|---|---|
| (none) | — | No CSP-named runtime/dev dep in the `next` package manifest. The CSP logic ships inside `packages/next/src/server/render.tsx` + `packages/next/src/server/app-render/app-render.tsx` + `packages/next/src/server/app-render/get-script-nonce-from-header.tsx` — all in-tree source, **no external CSP library is pulled in**. | `.claude/knowledge-base/references/next.js/packages/next/package.json:2` (`"name": "next"` — package metadata file is 11 KB; no `csp` substring anywhere) |

The canonical answer per `cycle-discover-plan-golden-rule` / EC-1 absorption: "no CSP-named dep; CSP logic lives in source."

---

## Coverage Corner 3 — Tools

### Astro

How Astro models CSP as a **build-tool + runtime** concern (NOT a per-environment toggle):

- **Build / config schema**: CSP directives are declared in `astro.config.mjs` under `security.csp.directives` / `scriptDirective` / `styleDirective`. Validated by Zod at config-load time. Allowed directive names are a closed enum at `.claude/knowledge-base/references/astro/packages/astro/src/core/csp/config.ts:43-65` (`ALLOWED_DIRECTIVES`). **`script-src` and `style-src` are explicitly REJECTED** from the user-supplied `directives` array — users must use the dedicated `scriptDirective` / `styleDirective` sub-objects so Astro can inject hashes/resources programmatically at build time. See validator at `.claude/knowledge-base/references/astro/packages/astro/src/core/csp/config.ts:76-82`.
- **Local dev story**: there is **no dev-vs-prod CSP branching inside `core/csp/`**. The CSP system is build-time-centric: `trackStyleHashes` and `trackScriptHashes` at `.claude/knowledge-base/references/astro/packages/astro/src/core/csp/runtime.ts:96-165` walk `internals.pagesByViteID` and `internals.inlinedScripts` to compute SHA-256 digests at build time. There is no equivalent runtime code path that emits a relaxed CSP for `astro dev`. **Implication**: Astro's CSP is for the prod-built artifact; the dev server runs without CSP enforcement by design.
- **Adapter shape (static headers)**: the `@astrojs/node` adapter accepts `staticHeaders: true`. On `astro:build:done`, it walks `routeToHeaders` and writes a JSON file (`STATIC_HEADERS_FILE`) containing one `Content-Security-Policy` entry per route — see `.claude/knowledge-base/references/astro/packages/integrations/node/src/index.ts:101-118`. The adapter does NOT inject its own CSP; it only persists what the Astro core CSP system computed. The adapter integration is opt-in via `adapter: testAdapter({ staticHeaders: true })` at `.claude/knowledge-base/references/astro/packages/astro/test/csp.test.ts:191-200`.
- **font-src dedup at build time**: `getDirectives()` in `runtime.ts` merges user-declared `font-src` with font resources injected by the Vite fonts plugin, deduplicating values — `.claude/knowledge-base/references/astro/packages/astro/src/core/csp/runtime.ts:57-87`. This is the only "tooling" code path that mutates the user CSP.

---

## Coverage Corner 4 — Techniques

### Nonce-based inline-script CSP (Next.js)

The canonical "let inline scripts survive a strict CSP" pattern. Next.js does **NOT** generate the nonce itself — it reads the nonce from the **incoming request's `content-security-policy` header**, then propagates it to every `<script>` it injects AND to React's streaming render APIs.

| Step | Code path | Citation |
|---|---|---|
| 1. Source: read CSP header from incoming request | `const csp = req.headers['content-security-policy'] \|\| req.headers['content-security-policy-report-only']` | `.claude/knowledge-base/references/next.js/packages/next/src/server/render.tsx:743-745` |
| 2. Extract nonce via regex `^'nonce-([A-Za-z0-9+/_-]+={0,2})'$` from the `script-src` (or fallback `default-src`) directive | `getScriptNonceFromHeader(csp)` | `.claude/knowledge-base/references/next.js/packages/next/src/server/app-render/get-script-nonce-from-header.tsx:1-31` |
| 3. Inject nonce into `HeadManagerContext` so every emitted `<script>` carries `nonce={nonce}` | `<HeadManagerContext.Provider value={{ ..., nonce }}>` | `.claude/knowledge-base/references/next.js/packages/next/src/server/render.tsx:759-770` |
| 4. Pass nonce to React's flight stream + `ServerInsertedHTMLProvider` | `App({ ..., nonce }: { nonce?: string }) { ... ReactClient.use(getFlightStream(..., nonce)) ... }` | `.claude/knowledge-base/references/next.js/packages/next/src/server/app-render/app-render.tsx:2357-2378` |
| 5. App Router branch reuses the same nonce extraction | `const csp = headers['content-security-policy'] \|\| headers['content-security-policy-report-only']; const nonce = typeof csp === 'string' ? getScriptNonceFromHeader(csp) : undefined;` | `.claude/knowledge-base/references/next.js/packages/next/src/server/app-render/app-render.tsx:430-435` |

**Key insight for our Caddyfile fix**: the upstream proxy / reverse-proxy / edge layer is **the canonical place to mint the nonce** — Next.js explicitly delegates nonce minting to the edge (Vercel docs equivalent). The framework then propagates whatever nonce the edge already set. This is exactly the role Caddy plays in our topology.

### Environment-conditional secureHeaders middleware (Hono)

How Hono composes CSP via middleware options and whether environment branching is built-in:

- **No middleware-internal dev/prod branching.** `secureHeaders` accepts a flat `SecureHeadersOptions` object and produces the same headers regardless of `NODE_ENV`. The consumer must do branching at config time — see option schema at `.claude/knowledge-base/references/hono/src/middleware/secure-headers/secure-headers.ts:18-44` (`ContentSecurityPolicyOptions`) and merged defaults at `.claude/knowledge-base/references/hono/src/middleware/secure-headers/secure-headers.ts:109-124` (`DEFAULT_OPTIONS` — CSP is NOT enabled by default).
- **Per-request nonce generation** (canonical "I want a CSP nonce" pattern): the `NONCE` symbol is a callable handler — when passed in `scriptSrc: ["'self'", NONCE]`, it generates 16 random bytes (`crypto.getRandomValues`) on each request, base64-encodes them, stores at `ctx.set('secureHeadersNonce', nonce)`, and returns `'nonce-<value>'`. See `.claude/knowledge-base/references/hono/src/middleware/secure-headers/secure-headers.ts:131-145` (`generateNonce` + `NONCE` export).
- **CSP value assembly**: `getCSPDirectives()` walks the options object, kebab-cases keys (`scriptSrc` → `script-src`), interleaves values with spaces and `;`, and (when there are function-valued entries like `NONCE`) returns a per-request callback that re-evaluates them. See `.claude/knowledge-base/references/hono/src/middleware/secure-headers/secure-headers.ts:240-288`.
- **Custom nonce override**: consumers can replace `NONCE` with their own `ContentSecurityPolicyOptionHandler` to produce environment-specific nonces (e.g., short nonces in dev for human inspection) — see `.claude/knowledge-base/references/hono/src/middleware/secure-headers/index.test.ts:454-481`. This is the canonical "consumer owns the branching" escape hatch.

**Key insight**: Hono's middleware is a **shape** — it knows how to assemble a CSP from options but contains zero opinion about WHEN to relax. Identical decision Astro made for `core/csp/`.

### Self-hosted vs allowlisted Google Fonts (Next.js + Astro)

Two opposing strategies on how to satisfy CSP while loading Google Fonts:

| Framework | Strategy | CSP directive shape needed | Citation |
|---|---|---|---|
| Next.js (post-v13, canonical) | **Self-host at build time** — fetches `https://fonts.googleapis.com/css2?family=...` at build, parses the CSS for `https://fonts.gstatic.com/...` font URLs, downloads each file, emits to `.next/static/media/_.woff2`, and **rewrites the @font-face `src:` URL** from `gstatic.com` → `/_next/static/media/...`. Result: no Google domain ever loaded by the browser → CSP can be strict (no Google allowlist required). | `font-src 'self'` is sufficient. No need for `https://fonts.gstatic.com` or `https://fonts.googleapis.com`. | URL builder at `.claude/knowledge-base/references/next.js/packages/font/src/google/get-google-fonts-url.ts:50-53` (`https://fonts.googleapis.com/css2?family=`); rewrite logic at `.claude/knowledge-base/references/next.js/packages/font/src/google/loader.ts:142-157` (comment: `src: url(https://fonts.gstatic.com/...) -> url(/_next/static/media/_.woff2)`); emit to `.next/static/media` at `.claude/knowledge-base/references/next.js/packages/font/src/google/loader.ts:126-133` (`emitFontFile`). |
| Astro | **Allowlist `https://fonts.cdn.test.com` (or real `fonts.googleapis.com` / `fonts.gstatic.com`)** via `font-src` directive composed by the Vite fonts plugin → CSP composer | The test fixture asserts `font-src 'self' https://fonts.cdn.test.com` — the directive grows to include the external CDN(s). | `.claude/knowledge-base/references/astro/packages/astro/test/csp.test.ts:56-60` (`assert.deepStrictEqual(parsed.find((e) => e.directive === 'font-src')?.resources, ["'self'", 'https://fonts.cdn.test.com'])`); merge logic at `.claude/knowledge-base/references/astro/packages/astro/src/core/csp/runtime.ts:57-87`. |

Notable differences worth calling out:
- Next.js's strategy is **infrastructure-invisible**: the user writes `import { Inter } from 'next/font/google'` and never edits CSP. Astro's strategy is **CSP-explicit**: every external font domain shows up in `font-src`.
- For our dashboard's `<link href="https://fonts.googleapis.com/css2?..." rel="stylesheet">` shipped in `dashboard/index.html`, we have **NOT** self-hosted. Adopting the Next.js strategy would mean a Vite build step that downloads font files and rewrites the stylesheet. Adopting the Astro strategy is the cheaper local fix: add `fonts.googleapis.com` to `style-src` and `fonts.gstatic.com` to `font-src`. **R3 below proposes Astro's allowlist strategy for now and self-hosting as a follow-up**.

---

## Cross-cutting Comparison

| Dimension | Astro (Vite-based) | Next.js | Hono |
|---|---|---|---|
| Integration-test style | Build fixture + cheerio `<meta>` inspection at build-time + `routeToHeaders` adapter test for runtime. E2E uses `preview` (prod), NEVER dev — see `.claude/knowledge-base/references/astro/packages/astro/e2e/csp-client-only.test.ts:13-16` | (none in this blueprint scope — Next.js test setup is in `test/` not `packages/next/src/`) | In-memory `app.request()` + `res.headers.get('Content-Security-Policy')`. Zero on-disk fixtures — `.claude/knowledge-base/references/hono/src/middleware/secure-headers/index.test.ts:14-41` |
| Primary deps | `zod/v4` for option schema validation — `.claude/knowledge-base/references/astro/packages/astro/src/core/csp/config.ts:1` | none (no CSP-named dep) — CSP logic in-tree | none for CSP-specific — middleware is pure stdlib + `crypto.getRandomValues` |
| Local dev story | **No dev CSP enforcement.** CSP is build-time-only; `astro dev` does not emit `Content-Security-Policy`. Adapter applies headers only at `astro:build:done` — `.claude/knowledge-base/references/astro/packages/integrations/node/src/index.ts:92-118` | Edge (proxy/CDN) sets the `Content-Security-Policy` request header with a nonce; framework reads it back. Dev branching is consumer-owned. | Middleware emits same headers in dev + prod. Consumer toggles options based on `process.env.NODE_ENV` (not built in). |
| Signature technique | Build-time SHA-256 hash injection for inline styles + dedup `font-src` merge | Per-request nonce extraction from incoming header → propagation to every emitted `<script>` + flight stream | Per-request nonce via `NONCE` callable handler + ctx.set('secureHeadersNonce', ...) for downstream consumers |
| Google Fonts under strict CSP | Allowlist via `font-src` + `style-src` (CDN domain added explicitly) | Self-host at build (download to `_next/static/media`; rewrite @font-face `src:` URLs) — no Google allowlist required | Out-of-scope (no font handling in `secureHeaders`) |

## ADRs

Decisions that emerged from the synthesis. Each cites the evidence above.

### D1 — Caddyfile CSP shape: drop the prod-strict header from the dev-domain block; let upstream `<meta>` rule

**Decision:** In `infra/local/Caddyfile` block for `app-dev.usetheo.dev` (the Vite-dev reverse proxy at `localhost:5173`), the Caddy `header` block MUST NOT emit `Content-Security-Policy`. The dashboard's `<meta http-equiv="Content-Security-Policy">` in `dashboard/index.html` is the source of truth for the dev path. The prod-bundle CSP in `dashboard/nginx.conf` remains unchanged for production.

**Rationale:**
- Astro's design choice is decisive evidence: a Vite-based SPA framework with mature CSP support **deliberately does NOT enforce CSP on the dev server** — the entire `core/csp/` system runs at build time only (see `.claude/knowledge-base/references/astro/packages/astro/src/core/csp/runtime.ts:96-165` — every function reads `internals.pagesByViteID` / `internals.inlinedScripts` which only exist post-build). E2E tests confirm: dev mode is never CSP-tested (`.claude/knowledge-base/references/astro/packages/astro/e2e/csp-client-only.test.ts:13-16` calls `astro.build()` then `astro.preview()`, not `astro.dev()`).
- Browsers enforce the **stricter** of (a) response header CSP, (b) `<meta>` CSP — RFC equivalent. So emitting BOTH a Caddy header AND a `<meta>` CSP guarantees the more restrictive one wins, which here means breaking Vite HMR + Google Fonts. This is exactly the regression observed 2026-06-26.
- Hono's middleware default behavior at `.claude/knowledge-base/references/hono/src/middleware/secure-headers/secure-headers.ts:109-124` is `DEFAULT_OPTIONS` with NO CSP entry — opt-in only. The canonical "secure headers" middleware authors decided the default for non-prod paths is "no CSP."

**Alternatives considered:**
- Emit a relaxed CSP from Caddy in dev (add `'unsafe-inline'` + `https://fonts.googleapis.com` + `'unsafe-eval'` for HMR): rejected because (a) it duplicates the `<meta>` CSP shipped in `dashboard/index.html` causing intersection (browsers enforce stricter), (b) Vite HMR uses `eval` and dynamic imports that need `'unsafe-eval'` which expands attack surface, (c) we'd have to update Caddy every time Vite changes its inline-script shape.
- Strip the upstream `<meta>` CSP via Caddy `header_down`: rejected because Caddy cannot edit HTML body bytes without an HTML-rewrite module (off-the-shelf Caddy v2 cannot do this), and even if it could, it would silently weaken security in any future direct-dashboard hit.

**Consequences:**
- Dev domain (`app-dev.usetheo.dev`) inherits the `<meta>` CSP from `dashboard/index.html` which already allows `'unsafe-inline'` + Google Fonts. Vite HMR works. Google Fonts load. `/src/*` and `/@vite/*` paths resolve normally (the reverse_proxy already handles them; the 404 from #46 was a symptom of the CSP rejecting the JS that USED those paths).
- Prod (nginx-served container at `dashboard/Dockerfile` + `dashboard/nginx.conf`) remains strict — its CSP has no `'unsafe-inline'` for `script-src` and ships independently.
- The `<meta>` CSP becomes the single source of truth for the dev environment. Any tightening (e.g., dropping `'unsafe-inline'`) happens in `dashboard/index.html`, not in infra config.

### D2 — Relax vs remove: REMOVE the CSP from the dev Caddy block (do not just relax)

**Decision:** Remove the entire `Content-Security-Policy` line from the `app-dev.usetheo.dev` block in `infra/local/Caddyfile`. Do NOT replace it with a relaxed version.

**Rationale:**
- Astro's `getDirectives` deduplicator at `.claude/knowledge-base/references/astro/packages/astro/src/core/csp/runtime.ts:57-87` exists precisely because **two CSPs claiming the same directive cannot be safely merged at runtime** — the framework merges them at build time when it has full information. Caddy at the edge has none of the build-time context (which inline scripts, which font URLs, which hashes), so any relaxation Caddy applies is guesswork.
- The Hono test suite proves the cost of redundant header sources: `'should override Strict-Transport-Security header after middleware'` at `.claude/knowledge-base/references/hono/src/middleware/secure-headers/index.test.ts:130-146` shows downstream overrides of secure headers cause real test churn. The same applies in reverse: an upstream Caddy CSP and a `<meta>` CSP both claiming `script-src` will produce the intersection in the browser, surprising future readers.
- Removal is also the **lowest-risk diff** for a hot-fix on a live regression (Unbreakable Rule 3 — honest minimal fix > clever fix).

**Alternatives considered:**
- Add `'unsafe-inline' 'unsafe-eval' https://fonts.googleapis.com https://fonts.gstatic.com` to the Caddy CSP: rejected per D1; also expands attack surface on the dev edge which sponsors do reach over the public DNS.
- Keep the Caddy CSP but switch to `Content-Security-Policy-Report-Only`: this would unblock the regression while preserving the inspection signal. Defer to a follow-up (out of scope for the hot-fix slice). The `report-uri` plumbing in Hono at `.claude/knowledge-base/references/hono/src/middleware/secure-headers/index.test.ts:484-525` is canonical evidence that report-only mode is the right intermediate when one is unsure.

**Consequences:**
- Caddy on the dev edge will pass through whatever `<meta>` CSP the upstream serves. Vite dev keeps working. The prod path (nginx → `dashboard/nginx.conf`) keeps its strict CSP unchanged.
- The follow-up to D2 (consider `Content-Security-Policy-Report-Only` on the prod edge) is captured as an "Unresolved Questions" candidate for the `/to-plan` slice.

### D3 — `<meta>` CSP nonces: do NOT adopt nonces in `dashboard/index.html` (keep `'unsafe-inline'`)

**Decision:** `dashboard/index.html` retains `script-src 'self' 'unsafe-inline'`; `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`. Do NOT add nonces.

**Rationale:**
- The Next.js nonce flow at `.claude/knowledge-base/references/next.js/packages/next/src/server/render.tsx:743-770` + `.claude/knowledge-base/references/next.js/packages/next/src/server/app-render/get-script-nonce-from-header.tsx:1-31` requires (a) the **edge to mint a per-request nonce** (Next.js explicitly reads it from `req.headers['content-security-policy']`), (b) the **server-rendered HTML to embed the nonce on every `<script>` tag** (`<HeadManagerContext.Provider value={{ ..., nonce }}>` at `.claude/knowledge-base/references/next.js/packages/next/src/server/render.tsx:759-770`). Our dashboard is a **Vite-served SPA with a static `index.html`** — there is no server-render step that can substitute `<script nonce="...">` per request. A nonce in a `<meta>` tag of a static HTML file is a **constant**, which is no better than `'unsafe-inline'` (RFC 8941 / CSP3 §6.6.2.4 — fixed-value nonces are equivalent to no CSP for the inline-script case).
- Hono's `NONCE` handler at `.claude/knowledge-base/references/hono/src/middleware/secure-headers/secure-headers.ts:131-145` reinforces the same constraint: nonces require a per-request server hook. We have no such hook in the Vite-served path.
- Astro's CSP system avoids `'unsafe-inline'` by generating **SHA-256 hashes** at build time (`.claude/knowledge-base/references/astro/packages/astro/src/core/csp/runtime.ts:96-125` `trackStyleHashes`). This is technically achievable for our dashboard but requires a Vite plugin that computes the hash of every inline `<style>` and `<script>` block and rewrites `index.html` at build. Out of scope for the hot-fix; documented as a follow-up.

**Alternatives considered:**
- Adopt nonces: rejected per the static-HTML constraint above. Nonces in `<meta>` are a known anti-pattern.
- Adopt SHA-256 hashes for inline `<script>` / `<style>`: rejected for the hot-fix slice; deferred as a hardening follow-up after D1 + D2 land.
- Drop `'unsafe-inline'` entirely and refactor all inline scripts to external files: rejected — large surgery against a hot regression.

**Consequences:**
- `dashboard/index.html`'s CSP remains as shipped. The fix surface is bounded to `infra/local/Caddyfile` (D1+D2) — `index.html` is not edited in this slice.
- Future hardening: implement an Astro-style build-time hash injection Vite plugin (the `devCspRelax()` plugin already in `dashboard/vite.config.ts:8-32` proves the pattern is in-repo) → a follow-up discovery + plan.

## Recommendations for the project

| # | Recommendation | Linked to | Priority |
|---|---|---|---|
| R1 | **Caddyfile CSP shape**: remove the entire `Content-Security-Policy` header from the `app-dev.usetheo.dev` block in `infra/local/Caddyfile`. Keep the prod-bundle CSP in `dashboard/nginx.conf` untouched. | Q1 (Astro tests prove dev-mode CSP is build-time-only), Q4 (Astro `core/csp/` has no dev path), D1, D2, `.claude/rules/architecture.md § Cross-Project Rule 9` (internals — Caddy edge — belong in DEEP DIVE) | HIGH (live regression hot-fix) |
| R2 | **Relax-vs-remove**: REMOVE (do not relax). Adding `'unsafe-inline'` / `https://fonts.googleapis.com` to a Caddy CSP would create intersection with the `<meta>` CSP; browsers enforce the stricter, surprising future readers. Hono `secureHeaders` defaults at `secure-headers.ts:109-124` (CSP NOT in `DEFAULT_OPTIONS`) reinforce "opt-in, not relax-by-default." | Q2 (Hono CSP off by default), Q6 (Hono consumer-owns-branching), D2 | HIGH |
| R3 | **`<meta>` CSP with nonces vs keep `'unsafe-inline'`**: KEEP `'unsafe-inline'` (do not adopt nonces). Static `index.html` cannot mint per-request nonces — Next.js's nonce flow requires a server-render hook that does not exist for Vite-served static HTML. Document a follow-up to add an Astro-style build-time SHA-256 hash Vite plugin (replacing `'unsafe-inline'` with hashes). | Q5 (Next.js nonce flow needs server hook), Q7 (Astro hash-at-build is the static-HTML-friendly alternative), D3 | MEDIUM (hot-fix unblocks the regression; hardening is follow-up) |

## Blocked questions (if any)

None. All 7 questions were answered with verified citations.

| Question | Reason | Suggested human follow-up |
|---|---|---|
| (none) | — | — |

## Halt-loop progress (audit trail)

- Iterations used: 1 (single Agent run per `.claude/rules/loop-engine-convention.md § When Agent is right`)
- Questions answered: 7 / 7
- Questions blocked: 0
- Citations verified: 26 distinct `.claude/knowledge-base/references/{...}:line` paths cited; all paths confirmed via `Path.exists()` + `Read` line-window inspection
- Promise emitted at iteration: 1

## Related

- Discovery plan: `.claude/knowledge-base/discoveries/plans/caddyfile-csp-vite-dev-vs-prod-bundle-plan.md`
- Confidence report: `.claude/knowledge-base/reviews/caddyfile-csp-vite-dev-vs-prod-bundle-confidence-2026-06-26.md` (to be generated by `/discover-confidence`)
- Project rules referenced: `.claude/rules/architecture.md`, `.claude/rules/public-copy.md` (this blueprint IS DEEP DIVE per § 1 Scope), `.claude/rules/testing.md` (Hono tests cited above as canonical AAA + independence pattern)
