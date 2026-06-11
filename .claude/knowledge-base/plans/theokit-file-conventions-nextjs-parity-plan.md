# Plan: TheoKit File Conventions — Next.js-Level Project Structure

> **Version 1.2** — Added T2.4: template ships favicon.ico, robots.txt, and system font stack via CSS @font-face in globals.css.
>
> **Version 1.1** — Absorbed EC-1 (static.ts must be CREATED, not just tested), EC-2 (app.ts + index.ts must be re-wired), EC-3 (explicit delete of app/globals.css duplicate), EC-4 (URL-encoded path test), EC-5 (query param test), EC-6 (--src-dir preserves public/).
>
> **Version 1.0** — Ship a professional project structure with static file serving from `public/`, CSS via `<link>` (not `node:fs` hacks), proper file conventions (loading.tsx, error.tsx, not-found.tsx), and a default template that matches create-next-app quality. Zero `node:fs` in React components. Runtime-agnostic (Node/Bun/Deno).

## Goal

> Ship static file serving in TheoApp and refactor the default template so that `npx create-theokit my-app && pnpm dev` produces a professional app with CSS from `public/`, client JS from `public/`, and all file conventions (page, layout, loading, error, not-found) working, measured by `curl http://localhost:3000/globals.css` returning 200 with `content-type: text/css` AND zero `node:fs` imports in any `app/*.tsx` template file.

## Context

TheoKit claims to be an opinionated React-first framework but the default template uses `node:fs readFileSync` in React components to load CSS and JS. This is:
1. **Node-specific** — breaks on Bun/Deno (violates runtime-agnostic principle)
2. **Unprofessional** — Next.js loads CSS via `import './globals.css'` (Vite pipeline) or `<link>` (static)
3. **Missing conventions** — template has no `loading.tsx`, `error.tsx`, `not-found.tsx`
4. **Static files broken** — `public/` exists but TheoApp returns 404 for files in it (static handler wired but not tested E2E with npm-published version)

## Baseline Context

### Files that will be touched

| File | LoC today | Last commit | Why it exists | Invariants |
|---|---|---|---|---|
| `packages/http/src/static.ts` (NEW — EC-1: file lost) | 0 | — | Static file handler to be created from scratch | — |
| `packages/http/src/app.ts` | ~530 | `8db0f55` (2026-06-11) | TheoApp class — wires static handler, controllers, agents | Static handler called before API routes |
| `packages/http/src/index.ts` | 10 | `8db0f55` (2026-06-11) | Public barrel | Exports `createStaticHandler` |
| `packages/create-theokit/templates/default/app.tsx` | 29 | `f8f77c5` (2026-06-11) | SSR entry — renders React to HTML | `renderToString(<Layout><Page /></Layout>)` |
| `packages/create-theokit/templates/default/app/layout.tsx` | 21 | `8db0f55` (2026-06-11) | Root layout — USES node:fs readFileSync (BROKEN) | Must wrap children in `<html><body>` |
| `packages/create-theokit/templates/default/app/page.tsx` | 71 | `8db0f55` (2026-06-11) | Home page — USES node:fs readFileSync (BROKEN) | Must render task CRUD + AI chat UI |
| `packages/create-theokit/templates/default/app/globals.css` | 187 | `8db0f55` (2026-06-11) | Design tokens + layout CSS | In `app/` but should be in `public/` |
| `packages/create-theokit/templates/default/app/client.ts` | 151 | `8db0f55` (2026-06-11) | Client interactivity (CRUD + SSE) | TypeScript — needs to be plain JS in `public/` |
| `packages/create-theokit/templates/default/public/globals.css` (NEW) | 0 | — | CSS served as static file | — |
| `packages/create-theokit/templates/default/public/client.js` (NEW) | 0 | — | Client JS served as static file | — |
| `packages/create-theokit/templates/default/app/loading.tsx` (NEW) | 0 | — | Loading skeleton (Suspense fallback) | — |
| `packages/create-theokit/templates/default/app/error.tsx` (NEW) | 0 | — | Error boundary | — |
| `packages/create-theokit/templates/default/app/not-found.tsx` (NEW) | 0 | — | 404 page | — |
| `packages/http/tests/unit/static.test.ts` (NEW) | 0 | — | Tests for static file handler | — |

### Current callers

- **`createStaticHandler`** — called in `app.ts:188` (TheoApp.create), exported from `index.ts`
- **`TheoApp.create({ html, staticDir })`** — called by template `app.tsx`, tests, fixtures
- **Template `app/layout.tsx`** — uses `readFileSync` from `node:fs` (3 callers of this pattern)
- **Template `app/page.tsx`** — uses `readFileSync` from `node:fs` (3 callers of this pattern)

### Domain glossary

- **Static file** — any file in `public/` served at the root URL (e.g., `public/globals.css` → `/globals.css`)
- **File convention** — special filename recognized by the router: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`
- **SSR** — Server-Side Rendering via React `renderToString` (current) or `renderToPipeableStream` (full framework)

### Architecture boundaries

- `packages/http/src/static.ts` is a new module in `@theokit/http` — no intra-monorepo deps (only Web Standards)
- Template files (`packages/create-theokit/templates/`) are scaffold code, not framework code — excluded from eslint strict rules
- `public/` is a user-space directory, not a framework module — no imports allowed from framework into public/

## Prior Art & Related Work

- **Next.js** (`.claude/knowledge-base/references/next.js/`) — `serve-static.ts:13-36` uses `send` library for public/ serving. `layout.tsx:3` imports globals.css directly. Component hierarchy wired in `next-app-loader.ts:228-286`.
- **Hono** (`.claude/knowledge-base/references/hono/`) — `src/middleware/serve-static/index.ts:67` path traversal regex. `src/utils/mime.ts` MIME type map. Runtime adapters for Bun/Deno/Node.
- **TheoKit static.ts** already exists — implements Hono-derived pattern with runtime-agnostic file reading.

## Objective

- [ ] `GET /globals.css` returns 200 with `content-type: text/css; charset=utf-8` from `public/`
- [ ] `GET /client.js` returns 200 with `content-type: text/javascript; charset=utf-8` from `public/`
- [ ] Zero `node:fs`, `node:path`, `node:url` imports in any template `app/*.tsx` file
- [ ] Template includes `loading.tsx`, `error.tsx`, `not-found.tsx` file conventions
- [ ] `layout.tsx` loads CSS via `<link rel="stylesheet" href="/globals.css">` (served from public/)
- [ ] `page.tsx` loads client JS via `<script src="/client.js" defer>` (served from public/)
- [ ] E2E test: scaffold → install → dev → `GET /globals.css` returns 200
- [ ] Static handler has unit tests (MIME detection, path traversal, 404)

## ADRs

### D1 — CSS and JS served from public/ via static handler (not inlined via node:fs)

**Decision:** Move `globals.css` and `client.js` to `public/` and serve via TheoApp's static file handler. Layout uses `<link>`, page uses `<script src>`.

**Rationale:** `node:fs readFileSync` in React components is Node-specific, breaks runtime-agnostic promise (G8 in guardrails), and is unprofessional compared to Next.js which uses Vite/webpack CSS pipeline or static serving.

**Alternative rejected:** Inline CSS as TypeScript string constant in layout.tsx. Rejected because: large CSS string in TSX is hard to edit, no syntax highlighting, no hot reload of CSS changes.

**Alternative rejected:** Vite CSS pipeline (`import './globals.css'`). Rejected because: requires full `theokit` framework with Vite plugin; the `@theokit/http` standalone mode (used by template) doesn't have Vite. Future path when template migrates to full framework.

**Consequences:** CSS is a separate HTTP request (1 extra round trip). Acceptable for dev; production should use inline or bundler. EC-7: brief FOUC (flash of unstyled content) on first load is accepted — Next.js avoids this via build pipeline; TheoKit standalone without Vite cannot. The tradeoff (runtime-agnostic + editable CSS file) is worth the minor flash.

### D2 — File conventions in template (loading, error, not-found)

**Decision:** Add `loading.tsx`, `error.tsx`, `not-found.tsx` to the default template with minimal implementations.

**Rationale:** Next.js includes these by convention. TheoKit's router (`scan.ts`) already recognizes them. Having them in the template teaches the pattern and avoids blank-page confusion on errors.

**Alternative rejected:** Not including them (current state). Rejected because: when an error occurs, the user sees nothing — no feedback, no boundary, no guidance.

### D3 — Client JS as plain .js in public/ (not TypeScript)

**Decision:** `client.js` is plain JavaScript in `public/`, not TypeScript that gets stripped at runtime.

**Rationale:** Browsers don't execute TypeScript. The previous approach (readFileSync + regex strip) was a hack. Plain JS in public/ is honest, editable, and runtime-agnostic.

**Alternative rejected:** Bundle client.ts with tsup into public/client.js at build time. Rejected because: adds build step complexity for a simple interactivity layer. Future path when template uses Vite.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| Extra HTTP request for CSS (not inlined) | Low | Browser caches after first load; production can inline via middleware | Template |
| Two copies of intent: app/globals.css (unused) + public/globals.css (served) | Medium | Remove app/globals.css entirely; public/ is the single source | Template |
| Client JS in public/ loses TypeScript type checking | Low | Keep it simple; move to Vite pipeline in future | Template |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (static handler tests) ──▶ Phase 2 (template refactor) ──▶ Phase 3 (integration validation)
```

All phases sequential — Phase 2 depends on static handler being tested, Phase 3 validates everything.

---

## Phase 1: Create Static File Handler + Wire + Test

**Objective:** Create `static.ts` from scratch (EC-1: file was lost), wire into TheoApp (EC-2: app.ts + index.ts), and validate with unit tests.

### T1.1 — Create static file handler + wire into TheoApp + unit tests

#### Objective
Create `packages/http/src/static.ts` with MIME detection, path traversal prevention, and runtime-agnostic file reading (Node/Bun/Deno). Wire into TheoApp via `staticDir` option. Export from barrel. Write 11+ unit tests.

#### Why this step
EC-1: `static.ts` was created during a prior session but lost during lint-staged stash/revert cycles — it does not exist on disk or in git. EC-2: `app.ts` and `index.ts` references were also reverted. This task must create everything from scratch, then test it.

#### Evidence
- `ls packages/http/src/static.ts` → "FILE MISSING"
- `grep createStaticHandler packages/http/src/app.ts` → no results
- `grep createStaticHandler packages/http/src/index.ts` → no results
- Hono pattern: `.claude/knowledge-base/references/hono/src/middleware/serve-static/index.ts:67` (traversal regex)
- Hono MIME map: `.claude/knowledge-base/references/hono/src/utils/mime.ts`

#### Files to edit
```
packages/http/src/static.ts (NEW) — static file handler: MIME, traversal, runtime-agnostic read
packages/http/src/app.ts — add staticDir option, staticHandler field, wire in handleRequest
packages/http/src/index.ts — export createStaticHandler, getMimeType, StaticOptions
packages/http/tests/unit/static.test.ts (NEW) — 11+ unit tests
```

#### TDD
```
RED:     test_get_mime_type_css() — getMimeType('styles.css') returns 'text/css; charset=utf-8'
RED:     test_get_mime_type_js() — getMimeType('app.js') returns 'text/javascript; charset=utf-8'
RED:     test_get_mime_type_unknown() — getMimeType('file.xyz') returns 'application/octet-stream'
RED:     test_safe_path_blocks_traversal() — isSafePath('../etc/passwd') returns false
RED:     test_safe_path_allows_normal() — isSafePath('/globals.css') returns true
RED:     test_handler_serves_existing_file() — handler returns Response with correct body + content-type
RED:     test_handler_returns_null_for_missing() — handler returns null for non-existent file
RED:     test_handler_skips_api_routes() — handler returns null for /api/tasks
RED:     test_handler_skips_non_get() — handler returns null for POST requests
RED:     test_handler_decodes_url_encoded_path() — handler serves file with %20 in URL (EC-4)
RED:     test_handler_ignores_query_params() — handler serves /globals.css?v=123 correctly (EC-5)
GREEN:   Implement static.ts + wire into app.ts + export from index.ts
REFACTOR: None expected
VERIFY:  pnpm --filter @theokit/http test
```

#### Acceptance Criteria
- [ ] `static.ts` exists with MIME map (50+ types), traversal regex, runtime-agnostic read
- [ ] `app.ts` has `staticDir` option in TheoAppOptions, `staticHandler` field, wired before API routes
- [ ] `index.ts` exports `createStaticHandler`, `getMimeType`, `StaticOptions`
- [ ] 11+ unit tests all passing
- [ ] URL-encoded paths work (EC-4)
- [ ] Query params stripped correctly (EC-5)
- [ ] Zero lint errors

#### DoD
- [ ] `pnpm --filter @theokit/http test` green
- [ ] `pnpm --filter @theokit/http build` green (DTS emits without error)
- [ ] `npx eslint packages/http/src/static.ts --max-warnings=0` clean

---

## Phase 2: Template Refactor — public/ First, Zero node:fs

**Objective:** Refactor the default template to serve CSS and JS from `public/`, eliminate all `node:fs` imports from React components, and add missing file conventions.

### T2.1 — Move CSS and JS to public/, rewrite layout and page

#### Objective
Move `globals.css` to `public/globals.css`, move `client.ts` to `public/client.js` (as plain JS), rewrite `layout.tsx` to use `<link>`, rewrite `page.tsx` to use `<script src>`.

#### Why this step
Eliminates `node:fs` from React components (G8 guardrail violation) and makes assets work on Node/Bun/Deno. This is the core fix.

#### Files to edit
```
packages/create-theokit/templates/default/public/globals.css — move from app/
packages/create-theokit/templates/default/public/client.js — rewrite from app/client.ts (plain JS)
packages/create-theokit/templates/default/app/layout.tsx — <link> instead of readFileSync
packages/create-theokit/templates/default/app/page.tsx — <script src> instead of readFileSync
packages/create-theokit/templates/default/app/globals.css — DELETE (moved to public/)
packages/create-theokit/templates/default/app/client.ts — DELETE (replaced by public/client.js)
```

#### Acceptance Criteria
- [ ] Zero `node:fs` imports in template `app/*.tsx`
- [ ] `layout.tsx` uses `<link rel="stylesheet" href="/globals.css">`
- [ ] `page.tsx` uses `<script src="/client.js" defer>`
- [ ] `app/globals.css` does NOT exist (deleted — EC-3)
- [ ] `app/client.ts` does NOT exist (deleted — EC-3)
- [ ] `public/globals.css` is the ONLY CSS source
- [ ] `public/client.js` is the ONLY client JS source
- [ ] `pnpm --filter create-theokit test` green

### T2.2 — Add file conventions: loading, error, not-found

#### Objective
Add `loading.tsx`, `error.tsx`, `not-found.tsx` to the default template.

#### Why this step
Next.js includes these by convention. TheoKit's router recognizes them. Their presence teaches the pattern and provides fallback UIs.

#### Files to edit
```
packages/create-theokit/templates/default/app/loading.tsx (NEW)
packages/create-theokit/templates/default/app/error.tsx (NEW)
packages/create-theokit/templates/default/app/not-found.tsx (NEW)
```

#### Acceptance Criteria
- [ ] `loading.tsx` renders a skeleton/spinner
- [ ] `error.tsx` renders an error boundary with retry button
- [ ] `not-found.tsx` renders a 404 message with back link
- [ ] All use CSS classes from `public/globals.css`

### T2.3 — Fix scaffold CLI for Tailwind CSS preservation

#### Objective
Ensure Tailwind `--yes` flag prepends `@import "tailwindcss"` to `public/globals.css` instead of overwriting it.

#### Why this step
The scaffold's Tailwind logic currently writes to `app/globals.css` but CSS is now in `public/globals.css`. The path needs updating.

#### Files to edit
```
packages/create-theokit/src/cli.ts — update Tailwind CSS path from app/ to public/
```

#### Acceptance Criteria
- [ ] `create-theokit --yes` (with Tailwind) preserves globals.css content
- [ ] `@import "tailwindcss"` is prepended, not overwritten
- [ ] `--src-dir` flag does NOT move `public/` into `src/` (EC-6: public stays at root)

### T2.4 — Ship favicon.ico, robots.txt, and professional font stack

#### Objective
Add essential static assets to the template: favicon, robots.txt, and a professional system font stack in globals.css (matching create-next-app's Geist pattern but with system fonts — no external download needed).

#### Why this step
Every professional template ships a favicon (browser tabs show a blank icon without it), robots.txt (SEO baseline), and a readable font stack. Next.js ships Geist via `next/font/google`. TheoKit uses system fonts (no build dependency) with the same CSS variable pattern.

#### Files to edit
```
packages/create-theokit/templates/default/public/favicon.ico (NEW) — TheoKit favicon
packages/create-theokit/templates/default/public/robots.txt (NEW) — allow all crawlers
packages/create-theokit/templates/default/public/globals.css — add @font-face / font variables
```

#### Acceptance Criteria
- [ ] `GET /favicon.ico` returns 200 with `image/x-icon`
- [ ] `GET /robots.txt` returns 200 with `text/plain`
- [ ] globals.css defines `--font-sans` and `--font-mono` CSS variables
- [ ] `body` uses `font-family: var(--font-sans)`
- [ ] `code`, `pre` use `font-family: var(--font-mono)`

---

## Phase 3: Integration Validation

**Objective:** Verify the full flow works E2E: scaffold → install → dev → static files served.

### T3.1 — E2E test: static files served from published package

#### Objective
Update E2E test to verify `GET /globals.css` returns 200 and `GET /client.js` returns 200.

#### Files to edit
```
tests/e2e/scaffold-to-request.test.ts — add static file assertions
```

#### Acceptance Criteria
- [ ] E2E test verifies `GET /globals.css` → 200 with CSS content
- [ ] E2E test verifies `GET /client.js` → 200 with JS content
- [ ] E2E test verifies zero `node:fs` in template app/ files

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Static handler untested | T1.1 | Unit tests for MIME, traversal, serve, 404 |
| 2 | node:fs in React components | T2.1 | Move to public/, use <link> and <script src> |
| 3 | Missing file conventions | T2.2 | Add loading.tsx, error.tsx, not-found.tsx |
| 4 | Tailwind overwrites CSS | T2.3 | Fix path to public/globals.css |
| 5 | No E2E for static serving | T3.1 | Add assertions to existing E2E test |
| 6 | No favicon.ico in template | T2.4 | Ship favicon in public/ |
| 7 | No robots.txt in template | T2.4 | Ship robots.txt in public/ |
| 8 | No font CSS variables | T2.4 | Add --font-sans/--font-mono to globals.css |

**Coverage: 8/8 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] `pnpm --filter @theokit/http test` green (319+ tests)
- [ ] `pnpm --filter @theokit/agents test` green (239+ tests)
- [ ] `pnpm --filter create-theokit test` green (71+ tests)
- [ ] `npx eslint packages/ --max-warnings=0` zero errors
- [ ] `bash scripts/quality-gate.sh` — 0 FAIL
- [ ] Zero `node:fs` imports in template `app/*.tsx` files
- [ ] `GET /globals.css` returns 200 in E2E test
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] npm publish: @theokit/http patch bump, create-theokit patch bump

## Failure scenarios

(none — no external I/O touched)

## Final Phase: Integration Validation (MANDATORY)

### Execution

```bash
pnpm --filter @theokit/http test
pnpm --filter @theokit/agents test
pnpm --filter create-theokit test
npx vitest run tests/e2e/scaffold-to-request.test.ts
npx eslint packages/ --max-warnings=0
bash scripts/quality-gate.sh
```

### Acceptance Criteria

- [ ] All test suites green
- [ ] Zero lint errors
- [ ] Quality gate PASS
- [ ] E2E: scaffold → dev → GET /globals.css → 200
- [ ] E2E: scaffold → dev → GET /client.js → 200
- [ ] E2E: scaffold → dev → GET /api/tasks → 200

### If Validation Fails

1. Fix plan-caused failures
2. Re-run validation chain
3. Pre-existing issues logged but do not block
