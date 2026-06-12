# Edge Case Review — template-full-framework-migration

Date: 2026-06-12
Tasks analyzed: 7 (T1.1, T1.2, T2.1, T2.2, T2.3, T3.1, T3.2)
Edge cases found: 6 (MUST FIX: 3, SHOULD TEST: 2, DOCUMENT: 1)

## MUST FIX

### EC-1: theokit does NOT have @theokit/http as dependency — controllers won't work
- **Affected task:** T1.1
- **Family:** Boundary
- **Scenario:** `theokit` package.json has ZERO dependency on `@theokit/http` or `@theokit/agents`. They are NOT peerDeps either. The template currently imports `@Controller, @Get` from `@theokit/http` and `@Agent, @Tool` from `@theokit/agents`. If the template switches to `theokit` as sole dep, those imports fail — the packages aren't installed.
- **Impact:** `theokit dev` crashes immediately with `Cannot find module '@theokit/http'`.
- **Suggested fix:** Either (a) add `@theokit/http` and `@theokit/agents` as dependencies of `theokit` package.json, OR (b) keep them as explicit deps in the template alongside `theokit`. Option (a) is correct — the framework should bundle its own layers.

### EC-2: theokit dev uses server/routes/ (defineRoute) — does NOT auto-discover server/controllers/
- **Affected task:** T2.3, T3.2
- **Family:** Integration
- **Scenario:** `theokit dev` API middleware (`api-middleware.ts:336`) calls `scanServerRoutes(serverDir)` which scans `server/routes/`. It does NOT auto-discover `server/controllers/` with `@Controller` decorators. The `@theokit/http` `httpDecoratorsPlugin` is a separate Vite plugin that must be explicitly registered in `theo.config.ts` to wire controllers.
- **Impact:** Template controllers (`TasksController`) are invisible — `GET /api/tasks` returns 404 unless `httpDecoratorsPlugin` is configured in `theo.config.ts`.
- **Suggested fix:** `theo.config.ts` must include `httpDecoratorsPlugin({ controllersGlob: 'server/controllers/**/*.controller.ts' })` in plugins array. Add this to T1.2.

### EC-3: Scaffold CLI has hardcoded app.tsx references for --src-dir mode
- **Affected task:** T3.1
- **Family:** State
- **Scenario:** `cli.ts:268-280` has hardcoded references to `app.tsx` for `--src-dir` mode: it renames `app.tsx` to `src/app.tsx` and rewrites scripts to `npx tsx --watch src/app.tsx`. After deleting `app.tsx`, this code crashes or does nothing.
- **Impact:** `--src-dir` flag breaks silently after migration.
- **Suggested fix:** Remove `--src-dir` logic for `app.tsx` (file no longer exists). Update to move `theo.config.ts` and `index.html` if `--src-dir` is used.

## SHOULD TEST

### EC-4: page.tsx with useState/useEffect needs 'use client' or equivalent
- **Affected task:** T2.2
- **Suggested test:** Verify that React components with hooks work in TheoKit's SSR pipeline. In Next.js, components with `useState` need `'use client'` directive. TheoKit may need a similar boundary — OR if all components are client-hydrated by default (like CRA), no directive needed. Test: does a page.tsx with useState render correctly via `theokit dev`?

### EC-5: index.html must NOT be in .gitignore or template _gitignore
- **Affected task:** T1.2
- **Suggested test:** `test_scaffold_index_html_not_gitignored()` — verify that `index.html` is not in `_gitignore` template file. Without it, git ignores the entry HTML and `theokit dev` fails after clone.

## DOCUMENT

### EC-6: theokit dev requires Vite + Node — Bun/Deno as primary dev runtime not supported
- **Accepted risk:** `theokit dev` uses Vite's `createServer()` which is Node-first. Bun can run it (Bun supports Node APIs), but Deno support depends on Vite's Deno compatibility. The standalone `@theokit/http` mode with `bun app.tsx` was runtime-agnostic. The full framework mode is Node/Bun-first. Deno users need `--compat` flag or use standalone mode. This is the same tradeoff Next.js makes — `next dev` is Node-only.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 1 | 1 | 0 | 0 |
| T1.2 | 1 | 0 | 1 | 0 |
| T2.1 | 0 | 0 | 0 | 0 |
| T2.2 | 1 | 0 | 1 | 0 |
| T2.3 | 1 | 1 | 0 | 0 |
| T3.1 | 1 | 1 | 0 | 0 |
| T3.2 | 1 | 0 | 0 | 1 |

**Verdict:** PLAN NEEDS ADJUSTMENT

### Required changes:

1. **EC-1:** T1.1 — add `@theokit/http` and `@theokit/agents` as dependencies of `theokit` package.json (or keep as explicit template deps). Without this, ALL decorator imports fail.
2. **EC-2:** T1.2 — `theo.config.ts` must register `httpDecoratorsPlugin` with `controllersGlob` for controllers to be auto-discovered by `theokit dev`.
3. **EC-3:** T3.1 — `--src-dir` mode references to `app.tsx` must be updated/removed in scaffold CLI.
4. **EC-4:** T2.2 TDD — test if `useState`/`useEffect` work in TheoKit's hydration pipeline (may need `'use client'` or equivalent).
5. **EC-5:** T1.2 TDD — verify `index.html` not in `_gitignore`.
6. **EC-6:** T3.2 — document that `theokit dev` is Node/Bun-first (Deno limited).
