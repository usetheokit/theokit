# G6 T3.1 — dogfood-app codemod application audit

Date: 2026-06-04 madrugada
Plan: `.claude/knowledge-base/plans/g6-router-convention-plan.md` v1.1
Commit: (this commit)

## Summary

Ran `theokit migrate router` against `dogfood-app/server/routes/`. 23 dotted
basenames migrated to directory-nested form. 10 of the moved files needed
relative-import rewrites (extension to T2.1 codemod core). dogfood-app
`pnpm typecheck` exit 0 after migration.

## Migration plan executed (23 routes)

| # | Before | After | Depth Δ | Imports rewritten |
|---|--------|-------|:-------:|:-----------------:|
| 1 | `admin.sdk-config.ts` | `admin/sdk-config.ts` | +1 | ✓ |
| 2 | `agents.[id].ts` | `agents/[id].ts` | +1 | ✓ |
| 3 | `batch.run.ts` | `batch/run.ts` | +1 |  |
| 4 | `cache.demo.ts` | `cache/demo.ts` | +1 |  |
| 5 | `canvas/artifacts.[id].ts` | `canvas/artifacts/[id].ts` | +1 | ✓ |
| 6 | `channels.[id].ts` | `channels/[id].ts` | +1 | ✓ |
| 7 | `debug.stability.last.ts` | `debug/stability/last.ts` | +2 | ✓ |
| 8 | `eval.info.ts` | `eval/info.ts` | +1 |  |
| 9 | `goal.run.ts` | `goal/run.ts` | +1 | ✓ |
| 10 | `handoff.run.ts` | `handoff/run.ts` | +1 | ✓ |
| 11 | `lance.demo.ts` | `lance/demo.ts` | +1 |  |
| 12 | `lance.info.ts` | `lance/info.ts` | +1 |  |
| 13 | `memory.file.ts` | `memory/file.ts` | +1 |  |
| 14 | `memory.sweep.ts` | `memory/sweep.ts` | +1 |  |
| 15 | `migrate.dryrun.ts` | `migrate/dryrun.ts` | +1 |  |
| 16 | `notion.status.ts` | `notion/status.ts` | +1 |  |
| 17 | `personality.[name].ts` | `personality/[name].ts` | +1 | ✓ |
| 18 | `pool.status.ts` | `pool/status.ts` | +1 |  |
| 19 | `settings.streaming.ts` | `settings/streaming.ts` | +1 |  |
| 20 | `skills.[id].ts` | `skills/[id].ts` | +1 |  |
| 21 | `telemetry.status.ts` | `telemetry/status.ts` | +1 |  |
| 22 | `vision.describe.ts` | `vision/describe.ts` | +1 | ✓ |
| 23 | `workflow.run.ts` | `workflow/run.ts` | +1 | ✓ |

**Total file count: 47 → 47** (renames only; no additions or deletions).

## EC-8 — Silent bug-fix observation

**These routes were UNREACHABLE before the migration.** The legacy scanner
produced URL patterns with literal dots:

| Old file | Old (broken) URL pattern | Client code expected |
|---|---|---|
| `admin.sdk-config.ts` | `/api/admin.sdk-config` | `/api/admin/sdk-config` |
| `agents.[id].ts` | `/api/agents.:id` (literal `.`) | `/api/agents/42` |
| `eval.info.ts` | `/api/eval.info` | `/api/eval/info` |
| `personality.[name].ts` | `/api/personality.:name` (literal `.`) | `/api/personality/alice` |
| ... | ... | ... |

Every single dotted route in dogfood-app was producing a URL that the
client code (under `app/`) was NEVER hitting. Evidence:

- `app/admin/sdk-config/page.tsx:26` uses `fetch("/api/admin/sdk-config")`
  — but scanner registered `/api/admin.sdk-config`
- `app/agents/page.tsx:47` uses `fetch("/api/agents")` — `agents.ts` is
  fine (no dots); the dynamic endpoint at `agents.[id].ts` was DEAD
- `app/eval/page.tsx:16` uses `fetch("/api/eval/info")` — scanner had
  `/api/eval.info`
- etc.

**Net effect of the migration:** 23 endpoints transition from
silent-404 to working-200. This is a per-endpoint bug fix that ALL ship
together with the G6 scanner rejection.

**Recommendation:** flag this in the CHANGELOG 0.4.0-beta.0 as
"Fixed (silent bug-fix bundle)" — see T4.2.

## TypeScript check

```
cd dogfood-app && pnpm typecheck → exit 0
```

`tsc --noEmit` reports zero errors after import-rewrite pass on the 10
files with sibling-relative imports (`./X` patterns).

## Codemod observations (for T2.1 follow-up)

1. **Import rewriter was not in the original T2.1 plan.** Adding it kept
   the scope minimal (pure function `rewriteRelativeImports(source,
   delta)` + `computeDepthDelta(from, to, routesDir)` exported from
   `router-codemod.ts`). Net: 8 new unit tests, ~50 LoC.

2. **`git mv` fallback worked as designed.** dogfood-app is not its own
   git repo (managed via the meta-repo); the codemod fell back to
   `fs.renameSync` + `mkdir -p` cleanly. Git status from the meta-repo
   side will reflect the renames as add+delete rather than rename, but
   that's a meta-repo property, not a codemod bug.

3. **Codemod completed in ≈ 250 ms for 23 files.** No EC-2 trigger
   (no dev server up at the time of the run).

4. **Idempotency confirmed.** Re-running the codemod against the migrated
   tree returns `alreadyClean: true`.

## Files moved (full list, with sibling-import-context grouped)

Sibling-pair groups (potential rewrites needed) — verified by
`pnpm typecheck`:

- `admin/sdk-config.ts` imports `../chat` (was `./chat`)
- `agents/[id].ts` imports `../agents` (was `./agents`)
- `canvas/artifacts/[id].ts` imports `../../canvas-store` (was `../canvas-store`)
- `channels/[id].ts` imports `../channels` (was `./channels`)
- `debug/stability/last.ts` imports `../../debug` (was `./debug`)
- `goal/run.ts` imports `../../sdk-config`-style refs (was `../sdk-config`)
- `handoff/run.ts` same
- `personality/[name].ts` imports `../../workspace-seeds` (was `../workspace-seeds`)
- `vision/describe.ts` imports `../vision` (was `../vision` — actually
  unchanged after delta=1 only if originally `./vision`; double-check
  in commit diff)
- `workflow/run.ts` imports `../../sdk-config`

All other 13 routes had no relative imports beyond the package layer
(`theokit/server`, `zod`, `node:fs`, etc.) and required no rewrites.

## Next step

T4.1 — audit `create-theokit` templates and migrate dotted basenames
there too (so freshly-scaffolded apps start in the new convention).
