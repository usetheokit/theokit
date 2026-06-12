# Plan: Migrate Default Template to Full Framework (`theokit`)

> **Version 1.0** — Migrate the `create-theokit` default template from standalone `@theokit/http` (no hydration, vanilla JS) to the full `theokit` framework (Vite, React hydration, file-based routing, SSR streaming). Zero `public/client.js`. React components handle all interactivity. Rails-style project structure.

## Goal

> Migrate the default template from `@theokit/http` standalone to `theokit` full framework so that `npx create-theokit my-app && theokit dev` produces a full-stack app with React hydration, file-based routing, SSR streaming, and controllers + agents wired via Vite, measured by `theokit dev` serving a working app with client-side React interactivity (onClick, useState) AND `public/client.js` deleted.

## Context

The template currently uses `@theokit/http` directly with `renderToString` (static HTML) + `public/client.js` (vanilla JS for interactivity). This contradicts TheoKit's identity as an opinionated React-first framework. The full `theokit` framework already has: Vite dev server, React hydration via `hydrateRoot`, SSR streaming via `renderToPipeableStream`, file-based routing, and API middleware. The template should use these, not workarounds.

## Baseline Context

### Files that will be touched

| File | LoC today | Last commit | Why it exists | Invariants |
|---|---|---|---|---|
| `packages/create-theokit/templates/default/package.json.tmpl` | 35 | `f7266ab` | Template deps — currently `@theokit/http` standalone | Must switch to `theokit` as main dep |
| `packages/create-theokit/templates/default/app.tsx` | 25 | `f7266ab` | Entry point — `TheoApp.create({ root })` with React SSR | Must become `theokit dev` compatible (no manual SSR) |
| `packages/create-theokit/templates/default/app/page.tsx` | ~70 | `816ac6c` | Home page — static HTML with script ref | Must use React components with interactivity |
| `packages/create-theokit/templates/default/app/layout.tsx` | 15 | `816ac6c` | Root layout — `<link>` refs | Must work with Vite CSS pipeline |
| `packages/create-theokit/templates/default/public/client.js` | 150 | `816ac6c` | Vanilla JS interactivity — TO DELETE | — |
| `packages/create-theokit/templates/default/index.html` (NEW) | 0 | — | Vite entry HTML (required by theokit dev) | — |
| `packages/create-theokit/templates/default/theo.config.ts` (NEW) | 0 | — | Framework config (required by theokit dev) | — |
| `packages/create-theokit/templates/default/server/routes/` (NEW) | 0 | — | API routes via `defineRoute` (theokit pattern) | — |
| `packages/create-theokit/templates/default/app/components/` (NEW) | 0 | — | React components with interactivity | — |

### Domain glossary

- **Hydration** — React takes over server-rendered HTML and attaches event handlers (onClick, useState work)
- **File-based routing** — `app/page.tsx` → `/`, `app/tasks/page.tsx` → `/tasks`
- **defineRoute** — theokit's typed route definition (`theokit/server/define`)
- **theokit dev** — Vite-powered dev server with HMR, SSR, and API middleware

### Architecture boundaries

- Template switches from `@theokit/http` (direct dep) to `theokit` (full framework)
- `@theokit/http` and `@theokit/agents` become transitive deps (used internally by theokit)
- `server/controllers/` pattern still works (theokit supports both `defineRoute` and `@Controller`)
- `index.html` required by Vite — TheoKit's `transformIndexHtml` hook injects entry client + devtools

## Prior Art & Related Work

- **Next.js** — `create-next-app` generates full framework project, never standalone React
- **Remix** — `create-remix` generates full framework project with `root.tsx` + `routes/`
- **Ruby on Rails** — `rails new` generates complete MVC structure, never standalone Rack

## Objective

- [ ] `package.json` deps: `theokit` replaces `@theokit/http` + `@theokit/agents`
- [ ] `scripts.dev` changes from `npx tsx --watch app.tsx` to `theokit dev`
- [ ] `scripts.build` changes from `npx tsup app.tsx` to `theokit build`
- [ ] `scripts.start` changes from `node dist/app.js` to `theokit start`
- [ ] `index.html` created (Vite entry — `<div id="root">` + script tag)
- [ ] `theo.config.ts` created with `defineConfig({ port: 3000 })`
- [ ] `app.tsx` deleted (theokit manages the entry point internally)
- [ ] `public/client.js` deleted (React hydration replaces vanilla JS)
- [ ] `app/page.tsx` rewritten as interactive React component (useState, useEffect, fetch)
- [ ] `app/globals.css` imported in `app/layout.tsx` (Vite CSS pipeline, not `<link>`)
- [ ] `server/routes/tasks.ts` created alongside `server/controllers/` (shows both patterns)
- [ ] `theokit dev` starts and serves the app with hydration working

## ADRs

### D1 — Template uses `theokit` full framework, not `@theokit/http` standalone

**Decision:** The default template installs `theokit` as the main dependency. `@theokit/http` and `@theokit/agents` are consumed internally by the framework.

**Rationale:** TheoKit is opinionated. An opinionated framework template uses the framework, not its internals. Next.js templates install `next`, not `react-dom/server`. Rails templates install `rails`, not `rack`.

**Alternative rejected:** Keep `@theokit/http` standalone. Rejected: no hydration, no Vite, no HMR, forces vanilla JS for interactivity — contradicts "React-first".

### D2 — Keep both defineRoute AND @Controller in the template

**Decision:** Template shows BOTH patterns: `server/routes/tasks.ts` (defineRoute) and `server/controllers/tasks.controller.ts` (@Controller decorators). Both coexist.

**Rationale:** Rails-style convention. The dev sees both approaches and picks one. TheoKit supports both — showing only one hides a feature.

**Alternative rejected:** Only show @Controller. Rejected: `defineRoute` is simpler for beginners and doesn't require decorators/reflect-metadata.

### D3 — CSS via import, not `<link>`

**Decision:** `layout.tsx` imports CSS via `import './globals.css'` (processed by Vite), not `<link href="/globals.css">`.

**Rationale:** With Vite, CSS imports are bundled, tree-shaken, HMR-updated. `<link>` requires static file serving and doesn't benefit from the build pipeline. Next.js uses `import './globals.css'` in `layout.tsx`.

**Alternative rejected:** Keep `<link>` refs. Rejected: misses Vite HMR for CSS, slower dev experience.

### D4 — app.tsx deleted — framework manages entry

**Decision:** Remove `app.tsx` from the template. `theokit dev` manages the server entry internally (like `next dev`).

**Rationale:** The dev shouldn't manually call `TheoApp.create()`, `renderToString()`, or `app.listen()`. The framework does this. `theo.config.ts` is the config surface — like `next.config.js`.

**Alternative rejected:** Keep app.tsx as thin wrapper. Rejected: any manual SSR code is a maintenance burden and breaks when the framework SSR pipeline changes.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `theokit` is a heavier dependency than `@theokit/http` | Low | Full framework includes what the dev needs — no extra installs | Framework |
| `theokit dev` may have bugs not seen in standalone mode | Medium | Run full E2E test: scaffold → theokit dev → HTTP requests | Template |
| CSS import requires Vite — no standalone CSS serving | Low | Template is opinativo — Vite IS the dev tool | Framework |
| `reflect-metadata` still needed for @Controller decorators | Low | Framework imports it internally — dev never sees it | Framework |

## Unresolved Questions

- Q1: Should `index.html` be at root or in `public/`? Vite expects root. TheoKit's `transformIndexHtml` hook expects root. Answer: root.
- Q2: Should `app.tsx` be deleted or converted to `theo.config.ts`? Answer: deleted — `theo.config.ts` is the new entry point.

## Dependency Graph

```
Phase 1 (package.json + config) ──▶ Phase 2 (frontend + routes) ──▶ Phase 3 (delete old + E2E)
```

---

## Phase 1: Package Config + Framework Wiring

**Objective:** Switch template deps, add `theo.config.ts`, add `index.html`, update scripts.

### T1.1 — Switch dependencies and scripts

#### Objective
Replace `@theokit/http` + `@theokit/agents` with `theokit` in package.json. Update scripts to use `theokit` CLI.

#### Why this step
The template must install the full framework. Scripts must use `theokit dev/build/start` instead of `tsx/tsup/node`.

#### Files to edit
```
packages/create-theokit/templates/default/package.json.tmpl — deps + scripts
```

#### TDD
```
RED:     test_scaffold_package_has_theokit_dep() — package.json has "theokit" in dependencies
RED:     test_scaffold_scripts_use_theokit_cli() — scripts.dev === "theokit dev"
GREEN:   Update package.json.tmpl
VERIFY:  pnpm --filter create-theokit test
```

#### Acceptance Criteria
- [ ] `"theokit": "^0.4.0"` in dependencies
- [ ] `@theokit/http` and `@theokit/agents` removed from dependencies (transitive)
- [ ] `scripts.dev` = `"theokit dev"`
- [ ] `scripts.build` = `"theokit build"`
- [ ] `scripts.start` = `"theokit start"`

---

### T1.2 — Create theo.config.ts and index.html

#### Objective
Add `theo.config.ts` (framework config) and `index.html` (Vite entry) to the template.

#### Why this step
`theokit dev` requires `theo.config.ts` (validateProjectStructure checks). Vite requires `index.html` as entry. TheoKit's `transformIndexHtml` hook injects the React entry client and devtools.

#### Files to edit
```
packages/create-theokit/templates/default/theo.config.ts (NEW)
packages/create-theokit/templates/default/index.html (NEW)
```

#### TDD
```
RED:     test_scaffold_has_theo_config() — theo.config.ts exists after scaffold
RED:     test_scaffold_has_index_html() — index.html exists after scaffold
GREEN:   Create both files
VERIFY:  pnpm --filter create-theokit test
```

#### Acceptance Criteria
- [ ] `theo.config.ts` with `defineConfig({ port: 3000 })`
- [ ] `index.html` with `<div id="root">` and `<script type="module" src="/@theo/entry-client">`

---

## Phase 2: Frontend + Routes Rewrite

**Objective:** Rewrite React components with real interactivity, add defineRoute example, import CSS via Vite.

### T2.1 — Rewrite layout.tsx with CSS import

#### Objective
Change `layout.tsx` from `<link>` refs to `import './globals.css'` (Vite pipeline). Move `globals.css` from `public/` back to `app/` (Vite imports from source, not public).

#### Files to edit
```
packages/create-theokit/templates/default/app/layout.tsx — import CSS
packages/create-theokit/templates/default/app/globals.css (MOVE from public/)
packages/create-theokit/templates/default/public/globals.css — DELETE
```

#### Acceptance Criteria
- [ ] `layout.tsx` has `import './globals.css'`
- [ ] No `<link rel="stylesheet">` in layout
- [ ] `app/globals.css` exists, `public/globals.css` deleted

---

### T2.2 — Rewrite page.tsx with React interactivity

#### Objective
Rewrite `page.tsx` as a real interactive React component using `useState`, `useEffect`, `fetch`. No vanilla JS. The component fetches tasks from `/api/tasks`, renders them, and supports create/delete. AI chat uses SSE via `useEffect`.

#### Files to edit
```
packages/create-theokit/templates/default/app/page.tsx — full rewrite with hooks
packages/create-theokit/templates/default/public/client.js — DELETE
```

#### Acceptance Criteria
- [ ] `page.tsx` uses `useState` for task list state
- [ ] `page.tsx` uses `useEffect` for initial fetch
- [ ] `page.tsx` has `onClick` handlers (not vanilla JS event listeners)
- [ ] `public/client.js` deleted
- [ ] No `<script src>` in any template file

---

### T2.3 — Add defineRoute example alongside @Controller

#### Objective
Add `server/routes/health.ts` with `defineRoute` to show both API patterns in the template.

#### Files to edit
```
packages/create-theokit/templates/default/server/routes/health.ts (NEW)
```

#### Acceptance Criteria
- [ ] `defineRoute` example at `server/routes/health.ts`
- [ ] Accessible at `/api/health` when `theokit dev` runs
- [ ] Shows both patterns: `@Controller` (tasks) + `defineRoute` (health)

---

## Phase 3: Cleanup + E2E Validation

**Objective:** Delete old entry point, update tests, validate E2E.

### T3.1 — Delete app.tsx and update scaffold

#### Objective
Remove `app.tsx` from the template (framework manages entry). Update scaffold CLI if it references `app.tsx`.

#### Files to edit
```
packages/create-theokit/templates/default/app.tsx — DELETE
packages/create-theokit/src/cli.ts — remove app.tsx references
```

#### Acceptance Criteria
- [ ] `app.tsx` does not exist in scaffolded project
- [ ] `theokit dev` works without `app.tsx`
- [ ] Scaffold CLI updated

---

### T3.2 — E2E validation: theokit dev serves full-stack app

#### Objective
Validate end-to-end: scaffold → `theokit dev` → React hydration works → API responds.

#### Files to edit
```
tests/e2e/scaffold-to-request.test.ts — update for theokit dev
```

#### Acceptance Criteria
- [ ] `theokit dev` starts without errors
- [ ] `GET /` returns HTML with `<div id="root">`
- [ ] `GET /api/tasks` returns JSON
- [ ] React hydration script present in HTML
- [ ] Zero `public/client.js` in scaffolded project

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Template uses standalone @theokit/http | T1.1 | Switch to theokit |
| 2 | No theo.config.ts or index.html | T1.2 | Create both |
| 3 | CSS via `<link>` not Vite | T2.1 | `import './globals.css'` |
| 4 | Vanilla JS interactivity (client.js) | T2.2 | React hooks (useState, useEffect) |
| 5 | Only @Controller pattern shown | T2.3 | Add defineRoute example |
| 6 | Manual app.tsx entry point | T3.1 | Delete — framework manages |
| 7 | No E2E with theokit dev | T3.2 | Full E2E test |

**Coverage: 7/7 gaps covered (100%)**

## Global Definition of Done

- [ ] `npx create-theokit my-app` generates project with `theokit` as dep
- [ ] `theokit dev` starts and serves the app
- [ ] React hydration works (useState, onClick functional in browser)
- [ ] `GET /api/tasks` returns JSON
- [ ] Zero `public/client.js` in template
- [ ] Zero `app.tsx` in template
- [ ] `pnpm --filter create-theokit test` green
- [ ] `pnpm --filter @theokit/http test` green (no regression)

## Failure scenarios

(none — no external I/O touched)

## Final Phase: Integration Validation (MANDATORY)

### Execution

```bash
pnpm --filter create-theokit test
pnpm --filter @theokit/http test
npx vitest run tests/e2e/scaffold-to-request.test.ts
```

### Acceptance Criteria

- [ ] All test suites green
- [ ] E2E: scaffold → theokit dev → GET / → 200 with React hydration
- [ ] E2E: scaffold → theokit dev → GET /api/tasks → 200 JSON
