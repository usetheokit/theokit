# P#3 Dogfood-App Smoke (T4.1)

**Date:** 2026-06-02 noite
**Task:** T4.1 from `.claude/knowledge-base/plans/p3-plugin-openapi-plan.md` v1.3
**Result:** 🟢 PASS — `/api/docs` renders Scalar UI; `/api/docs/openapi.json` returns 44 paths with `/api/memory` present.

## Setup

1. Added `@usetheo/plugin-openapi` to `dogfood-app/package.json` (`file:` link).
2. Wired `openApiPlugin({ pageTitle: 'Dogfood App — API Reference' })` in `dogfood-app/theo.config.ts`.
3. Rebuilt theokit dist (`pnpm --filter theokit run build`) to ship T1.1 dev-emit hook + this audit's api-middleware change.
4. Force `pnpm install` in dogfood-app to refresh symlinks.
5. Started `theokit dev --port 3100` (zombie servers from earlier runs forced fallback to port 3103).

## Findings + root-cause fix

**Initial smoke (404)**: `GET /api/docs` returned `404 NOT_FOUND` because `api-middleware.ts` sends 404 BEFORE invoking `pluginRunner.runOnRequest`. Plugin's `onRequest` hooks only fired DURING `executeRoute` (after route match), so a plugin handling a path with no `server/routes/` file was dead.

**Root cause:** the TheoApp contract describes `onRequest` as "fires for every request", but the api-middleware only wires it inside the matched-route execution path. plugin-cors works around this via the special-cased `corsHandler.handlePreflight()` at line 249 — but a generalist plugin like `@usetheo/plugin-openapi` has no such escape hatch.

**Fix (this commit)**: extended `api-middleware.ts` to invoke `pluginRunner.runOnRequest(ctx)` BEFORE `matchRoute`, after CORS preflight + rate limit. Plugins that short-circuit the response (set `writableEnded`/`headersSent`) skip the route match. Plugins that don't match fall through to the normal flow. This is the Fastify model (`onRequest` fires for ALL requests) and matches the TheoApp contract.

**Benefit to other plugins**: any future plugin (e.g., `plugin-health` for `/health`, `plugin-metrics` for `/metrics`) gets `onRequest` semantics for free without needing a special-case in core.

## Smoke evidence

### `GET /api/docs` → 200 HTML

```
HTTP=200
CT=text/html; charset=utf-8
Size=429 bytes

<!doctype html>
<html>
  <head>
    <title>Dogfood App — API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
    <script>
      Scalar.createApiReference('#app', { url: "/api/docs/openapi.json" });
    </script>
  </body>
</html>
```

**EC-1 (JSON.stringify embed) verified live**: `url: "/api/docs/openapi.json"` is double-quoted (JSON.stringify output), NOT single-quoted (attribute-escape output). Defense-in-depth XSS guard working as designed.

### `GET /api/docs/openapi.json` → 200 JSON

- 44 paths total (43 routes + 1 from late-binding; dogfood-app actually loaded 1 more than the previous G2 audit captured)
- `/api/memory` present ✅ (proves saveMemory action's body schema flowed through the emit pipeline)
- `openapi: 3.1.0` ✅
- `info.title: 'Dogfood App'` ✅ (from theo.config.ts)
- `servers[0].url: http://localhost:3100` ✅

### Dev-mode emit (P#3 T1.1)

Dev server log shows `[openapi-emit]` lines firing on boot (T1.1 watcher subscription active). One honest skip:
```
[openapi-emit] Skipping routes/eval.info.ts: load failed
  ([vite] The requested module '@usetheo/sdk' does not provide an export named 'Scorers')
```
This is a pre-existing dogfood-app issue unrelated to P#3 (eval route imports a stale SDK export). The skip behavior is correct per T1.1 EC-8 absorbed (best-effort, never crash dev).

## Acceptance criteria checklist

- [x] `dogfood-app/package.json` declares `@usetheo/plugin-openapi`
- [x] `dogfood-app/theo.config.ts` wires `openApiPlugin()`
- [x] theokit dist rebuilt + dogfood-app reinstalled
- [x] `GET /api/docs` → 200 + `text/html` + Scalar embed
- [x] `GET /api/docs/openapi.json` → 200 + JSON + ≥ 40 paths
- [x] `/api/memory` POST present (saveMemory schema flowed through)
- [x] EC-1 JSON.stringify embed verified live (double-quoted JS string)
- [x] EC-7 + EC-6 + EC-3 + EC-5 guards in place (covered by integration tests 16/16 GREEN)
- [x] Audit doc written
- [ ] Chrome MCP visual snapshot — DEFERRED to T5.1 `/dogfood-app full` (single Chrome MCP session captures both /api/docs + the existing 24 GET routes)

## Side-effect commit (theokit core)

This task surfaced a latent gap: `api-middleware.ts` never invoked `pluginRunner.runOnRequest` for unmatched routes. Fix lands in this commit per FAANG root-cause rule (no workarounds). Benefits any future plugin that wants to handle paths outside `server/routes/`.

## Verdict

🟢 **T4.1 PASS** — plugin runtime works end-to-end via real PluginRunner against real theokit dev server. Proceed to T5.1 (final `/dogfood-app full` SHIP-IT).
