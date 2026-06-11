# Plan: Absorb plugin-openapi into core — serve Scalar API docs at /api/docs

> **Version 1.0** (2026-06-11) — Absorver `@theokit/plugin-openapi` do sibling `theokit-plugins` para `packages/theo/src/server/openapi/`, servindo Scalar UI em `GET /api/docs` e o JSON spec em `GET /api/docs/openapi.json`. Zero npm deps (Scalar via CDN). Core já emite o spec — falta servir.

## Goal

> Ship built-in OpenAPI docs UI at `/api/docs` in the TheoKit dev server so that every app with `defineRoute()` gets auto-generated interactive API documentation, measured by `GET /api/docs` returning 200 with Scalar HTML AND `GET /api/docs/openapi.json` returning valid JSON in a new E2E test.

## Context

TheoKit already generates OpenAPI 3.x specs at build time via `vite-plugin/openapi-emit/` (4 files, Zod→OpenAPI converter). But the spec file (`.theo/openapi.json`) is not served — developers must open it manually or use external tools.

FastAPI serves `/docs` built-in. NestJS ships `@nestjs/swagger`. A framework that generates API specs but doesn't show them is incomplete.

`@theokit/plugin-openapi` in the sibling repo (`theokit-plugins/`) already solves this: mounts Scalar UI via CDN (zero npm deps), serves the JSON spec with error envelopes (503/413/500), has XSS-safe HTML escaping, CSP headers for the CDN host. 367 LoC, battle-tested with 9 edge cases absorbed.

**Decision:** Absorb the plugin's serving logic into core. The emit logic already exists — we add the serving layer.

**NOT absorbing plugin-cors** — core already has a 213-LoC CORS handler at `server/http/cors.ts` (shipped 2026-06-06). Plugin-cors is an alternative, not a gap.

## Baseline Context

### Files that will be touched

| File | LoC | Last commit | Why it exists | Invariants |
|---|---|---|---|---|
| `packages/theo/src/server/openapi/serve-docs.ts` (NEW) | 0 | — | Scalar UI HTML renderer + JSON spec server | — |
| `packages/theo/src/server/openapi/index.ts` (NEW) | 0 | — | Barrel export | — |
| `packages/theo/src/server/index.ts` | ~80 | `e7a98af` (2026-06-06) | Server barrel | Must re-export openapi/ |
| `packages/theo/src/vite-plugin/openapi-emit/emit.ts` | 246 | `485aa4d` (2026-06-02) | OpenAPI spec emitter | Writes `.theo/openapi.json` |
| `theokit-plugins/.../plugin-openapi/src/` | 367 | — | Source to absorb | render-html.ts, serve-openapi-json.ts, options.ts |
| `tests/unit/openapi-serve-docs.test.ts` (NEW) | 0 | — | OpenAPI serving tests | — |

### Current callers

- `vite-plugin/openapi-emit/emit.ts` — writes `.theo/openapi.json` at build time. No runtime caller today.
- `server/index.ts` — barrel re-export point for new module.
- No consumer imports an openapi serving module from core today.

### Domain glossary

- **Scalar** — OSS API docs viewer (like Swagger UI but modern). Loaded via CDN `<script>` tag.
- **OpenAPI spec** — JSON file at `.theo/openapi.json` describing all routes, schemas, and endpoints.
- **CSP** — Content-Security-Policy header allowing the CDN host for Scalar assets.

### Architecture boundaries

- New module `server/openapi/` — leaf module within `packages/theo/src/server/`. Follows existing pattern (auth/, cache/, cron/ are all leaf modules). Per `architecture.md` v3: server modules may import from `core/` only.

## Prior Art & Related Work

- **Source:** `theokit-plugins/packages/plugin-openapi/src/` — 367 LoC, 4 files, 9 edge cases absorbed
- **FastAPI** — serves `/docs` (Swagger UI) and `/redoc` built-in at dev time
- **NestJS** — `@nestjs/swagger` module, core team maintained

## Objective

- [ ] Create `server/openapi/serve-docs.ts` with `createOpenApiHandler()` returning a request handler
- [ ] Serve Scalar UI HTML at `GET /api/docs` (CDN-loaded, zero npm deps)
- [ ] Serve `.theo/openapi.json` at `GET /api/docs/openapi.json` with error envelopes (503/413/500)
- [ ] XSS-safe HTML rendering (escape title, URLs)
- [ ] CSP header for CDN host
- [ ] Export from `theokit/server` barrel
- [ ] 10+ tests GREEN

## ADRs

### D1 — Absorb as request handler function (not TheoPlugin)

**Decision:** Ship as a pure function `createOpenApiHandler(opts): (req: Request) => Response | null` that the vite-plugin wires into the dev server. Not as a TheoPlugin.

**Rationale:** The core already has the emit pipeline in vite-plugin. The serving logic is a dev-time concern (like HMR). Wiring it as a plugin forces consumers to `defineConfig({ plugins: [openapi()] })` — but this should be automatic in dev mode. Per KISS — a function the vite-plugin calls is simpler than a plugin lifecycle.

**Alternatives:**
- *Keep as TheoPlugin* — rejected: forces explicit opt-in for a feature every dev wants. FastAPI doesn't require you to install a plugin for `/docs`.

### D2 — Scalar via CDN (not bundled)

**Decision:** Load Scalar from `cdn.jsdelivr.net` via `<script>` tag. Zero npm dependency.

**Rationale:** Scalar is 2MB+ bundled. CDN load adds ~200ms on first visit but zero bundle impact. The plugin repo already validated this approach. Per YAGNI — bundling Scalar would add a massive dep for a dev-only feature.

**Alternatives:**
- *Bundle Scalar as npm dep* — rejected: 2MB+ added to theokit package size for dev-only feature.

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| CDN unavailable → Scalar UI blank page | Low | Fallback text: "Install Scalar locally or check CDN connectivity" | Dev |
| `.theo/openapi.json` not emitted yet on first dev start | Medium | Return 503 with message "Start the dev server and visit a route first" | Dev |

## Unresolved Questions

(none — the plugin repo already solved all edge cases including fresh-boot 503, filesize cap, trailing-slash matching, GET-only)

## Dependency Graph

```
Phase 1 (Absorb) ──▶ Phase 2 (Integration Validation)
```

---

## Phase 1: Absorb plugin-openapi into core

**Objective:** Create `server/openapi/serve-docs.ts` by adapting the plugin source.

### T1.1 — Create openapi serving module

#### Objective
Adapt `plugin-openapi/src/{render-html,serve-openapi-json,options}.ts` into a single `serve-docs.ts` file (~120 LoC) that exports `createOpenApiHandler()`.

#### Why this step

**Action:** Port the 3 functional files from the plugin (render-html, serve-openapi-json, options validation) into one module. The TheoPlugin wrapper code is dropped — we export a pure function instead.

**Reasoning:** Per D1, a function is simpler than a plugin. The vite-plugin already controls the dev server — it can call this function directly. The 367 LoC of the plugin includes ~100 LoC of TheoPlugin boilerplate that we don't need.

#### Evidence
- `plugin-openapi/src/render-html.ts:1-83` — Scalar HTML template with XSS escaping
- `plugin-openapi/src/serve-openapi-json.ts:1-96` — file reader with 503/413/500 envelopes
- `plugin-openapi/src/options.ts:1-86` — Zod schema for config validation

#### Files to edit
```
packages/theo/src/server/openapi/serve-docs.ts (NEW) — adapted from plugin source
packages/theo/src/server/openapi/index.ts (NEW) — barrel
packages/theo/src/server/index.ts — add re-export
tests/unit/openapi-serve-docs.test.ts (NEW) — serving tests
```

#### Deep file dependency analysis
- `serve-docs.ts` (NEW) — no existing callers. Imports `node:fs` + `node:path` (same as plugin).
- `server/index.ts` — adds `export * from './openapi/index.js'`; no collision with existing exports.

#### Pseudo-code

```typescript
import { readFileSync, statSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

export interface OpenApiDocsOptions {
  docsPath?: string        // default: '/api/docs'
  openapiJsonPath?: string // default: '/api/docs/openapi.json'
  specFilePath?: string    // default: '.theo/openapi.json'
  pageTitle?: string       // default: 'API Reference'
  cdnUrl?: string          // default: jsdelivr Scalar CDN
}

const MAX_SPEC_BYTES = 10 * 1024 * 1024

export function createOpenApiHandler(opts: OpenApiDocsOptions = {}) {
  const docsPath = opts.docsPath ?? '/api/docs'
  const jsonPath = opts.openapiJsonPath ?? '/api/docs/openapi.json'
  const specFile = resolve(opts.specFilePath ?? '.theo/openapi.json')
  const title = opts.pageTitle ?? 'API Reference'
  const cdn = opts.cdnUrl ?? 'https://cdn.jsdelivr.net/npm/@scalar/api-reference'

  return (request: Request): Response | null => {
    const url = new URL(request.url)
    if (request.method !== 'GET') return null

    if (url.pathname === docsPath) {
      return new Response(renderScalarHtml(title, jsonPath, cdn), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }

    if (url.pathname === jsonPath) {
      return serveSpecFile(specFile)
    }

    return null // not our route
  }
}
```

#### Tasks
1. Create `packages/theo/src/server/openapi/serve-docs.ts` with `createOpenApiHandler()`, `renderScalarHtml()`, `serveSpecFile()`
2. Create barrel `packages/theo/src/server/openapi/index.ts`
3. Add re-export in `packages/theo/src/server/index.ts`
4. Write tests

#### TDD
```
RED:   test_docs_returns_scalar_html() — GET /api/docs returns 200 with <script src="...scalar...">
RED:   test_docs_custom_path() — custom docsPath works
RED:   test_json_returns_spec() — GET /api/docs/openapi.json returns valid JSON when file exists
RED:   test_json_503_when_missing() — returns 503 OPENAPI_NOT_EMITTED when spec file absent
RED:   test_json_413_too_large() — returns 413 when spec > 10MB (mock)
RED:   test_non_get_passthrough() — POST /api/docs returns null (passthrough)
RED:   test_xss_safe_title() — title with <script> is escaped in HTML
RED:   test_csp_header() — response includes CSP allowing CDN host
RED:   test_unknown_path_passthrough() — GET /other returns null
RED:   test_default_options() — no options = defaults work
GREEN: Implement serve-docs.ts
VERIFY: cd packages/theo && npx vitest run tests/unit/openapi-serve-docs.test.ts
```

#### Concurrency tests
(none — single-threaded, stateless function)

#### Acceptance Criteria
- [ ] `GET /api/docs` returns Scalar UI HTML
- [ ] `GET /api/docs/openapi.json` returns spec JSON or error envelope
- [ ] XSS-safe rendering (escaped title, URLs)
- [ ] Non-GET methods return null (passthrough)
- [ ] 10+ tests GREEN
- [ ] Pass: lint, size ≤ 200 LoC

#### DoD
- [ ] Tests pass
- [ ] Build succeeds — `turbo run build --filter=theokit`
- [ ] Exported from `theokit/server`

---

## Phase 2: Integration Validation (MANDATORY)

### Execution
```bash
turbo run build --filter='./packages/*' --force
turbo run test --filter='./packages/*'
npx tsc --noEmit
```

### Acceptance Criteria
- [ ] All existing tests GREEN
- [ ] 10+ new openapi serving tests GREEN
- [ ] `createOpenApiHandler` exported from `theokit/server`
- [ ] Zero type errors

---

## Coverage Matrix

| # | Gap / Requirement | Task | Resolution |
|---|---|---|---|
| 1 | Scalar UI at /api/docs | T1.1 | `renderScalarHtml()` via CDN |
| 2 | Spec JSON at /api/docs/openapi.json | T1.1 | `serveSpecFile()` with error envelopes |
| 3 | 503 on missing spec | T1.1 | `OPENAPI_NOT_EMITTED` error |
| 4 | 413 on oversized spec | T1.1 | 10MB cap |
| 5 | XSS-safe HTML | T1.1 | `escapeHtml()` on title + URLs |
| 6 | CSP for CDN | T1.1 | `script-src` allows CDN host |
| 7 | GET-only | T1.1 | Non-GET returns null |
| 8 | Barrel export | T1.1 | `theokit/server` re-export |

**Coverage: 8/8 gaps covered (100%)**

## Global Definition of Done

- [ ] All tests passing
- [ ] Zero type errors
- [ ] `createOpenApiHandler` in `theokit/server` exports
- [ ] CHANGELOG.md updated under `[Unreleased] § Added`
- [ ] plugin-openapi in sibling repo can be marked for deprecation

## Failure scenarios

(none — no external I/O. Spec file read is local filesystem, guarded by existsSync + try-catch.)
