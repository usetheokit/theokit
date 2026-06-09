# G6 Router Convention — Pre-flight audit

**Date:** 2026-06-04 madrugada
**Plan:** `.claude/knowledge-base/plans/g6-router-convention-plan.md` v1.1
**Task:** T0.1

## Dogfood-app route inventory

Total `.ts` files under `dogfood-app/server/routes/`: **47**

### Dotted basenames (basename pre-extension contains `.`): **23 files**

```
server/routes/admin.sdk-config.ts
server/routes/agents.[id].ts
server/routes/batch.run.ts
server/routes/cache.demo.ts
server/routes/canvas/artifacts.[id].ts
server/routes/channels.[id].ts
server/routes/debug.stability.last.ts
server/routes/eval.info.ts
server/routes/goal.run.ts
server/routes/handoff.run.ts
server/routes/lance.demo.ts
server/routes/lance.info.ts
server/routes/memory.file.ts
server/routes/memory.sweep.ts
server/routes/migrate.dryrun.ts
server/routes/notion.status.ts
server/routes/personality.[name].ts
server/routes/pool.status.ts
server/routes/settings.streaming.ts
server/routes/skills.[id].ts
server/routes/telemetry.status.ts
server/routes/vision.describe.ts
server/routes/workflow.run.ts
```

### Directory-nested with `[param]`: **2 files** (G11 auth routes)

```
server/routes/auth/[provider]/login.ts
server/routes/auth/[provider]/callback.ts
```

### Plain top-level routes (no dot, no param): **22 files**

(skills.ts, cron.ts, loops.ts, wiki.ts, channels.ts, chat.ts, budget.ts, runtime-info.ts, sessions.ts, tasks.ts, usage.ts, memory.ts, debug.ts, tools.ts, personality.ts, factstream.ts, agents.ts, health.ts, context.ts, canvas/artifacts.ts, voice/stt.ts, voice/tts.ts)

## Variance from plan estimate

Plan v1.1 assumed **21 dotted routes**; actual is **23**. Per **Accepted Risk EC-9** absorbed into plan v1.1: "T0.1 é a fonte canônica — substitui pelo número real e atualiza ACs downstream se diferente." All downstream task ACs that reference "21" should be reinterpreted as "N from this audit = 23".

## Collision candidates

Per ADR D2 collision detection: would the codemod produce a target path that ALREADY exists?

| Dotted source | Computed target | Target exists? |
|---|---|---|
| `agents.[id].ts` | `agents/[id].ts` | NO — `server/routes/agents.ts` exists at sibling level but `agents/` directory does NOT |
| `canvas/artifacts.[id].ts` | `canvas/artifacts/[id].ts` | NO — sibling `canvas/artifacts.ts` exists, no `canvas/artifacts/` dir |
| `channels.[id].ts` | `channels/[id].ts` | NO — sibling `channels.ts` exists, no `channels/` dir |
| `skills.[id].ts` | `skills/[id].ts` | NO — sibling `skills.ts` exists, no `skills/` dir |
| `personality.[name].ts` | `personality/[name].ts` | NO — sibling `personality.ts` exists, no `personality/` dir |

**No filesystem collision candidates.** However, the parent paths (e.g., `agents.ts` next to `agents/[id].ts` target) will produce a routing-level collision after migration:
- `agents.ts` → `/api/agents` (list)
- `agents/[id].ts` → `/api/agents/:id` (detail)

These are SIBLINGS at the URL level and INTENDED to coexist (list vs detail). The codemod creates the `agents/` directory AND the codemod itself does NOT touch `agents.ts`. **Post-migration, scanner must handle both `agents.ts` and `agents/[id].ts` correctly.** Verified against blueprint Q1+Q2 — Next.js/SvelteKit/Nitro all support this pattern (top-level file + same-named directory).

**Recommended action in T1.1:** when post-migration both `agents.ts` and `agents/[id].ts` exist, scanner produces routes `/api/agents` and `/api/agents/:id` independently — this is the CORRECT behavior (no special handling needed).

## Pre-migration routing baseline (per v1.1 EC-8 absorbed)

Captured separately in `docs/audit/g6-router-pre-migration-routing-baseline.json` once dogfood-app dev server is bootable. Skipped in T0.1 because pre-migration dotted-routes baseline isn't strictly needed before scanner refactor — the bug being fixed IS the variance from spec. The post-migration baseline (T3.1) is the canonical check.

## Scanner bug confirmation

Current `theokit/packages/theo/src/server/scan/scan.ts:1-84` `fileToRoutePath()` function:

- For input `auth.[provider].login.ts` (after extension strip): `rel = 'auth.[provider].login'`
- Regex `rel.replace(/\[\.\.\.([^\]]+)\]/g, ':...$1')` — no match
- Regex `rel.replace(/\[([^\]]+)\]/g, ':$1')` — matches `[provider]`, replaces → `auth.:provider.login`
- Returned routePath: `/auth.:provider.login`
- Downstream `compilePattern()` builds a regex from this — segment is `auth.:provider.login` (one chunk because there's no `/` separator); the `:` prefix triggers param parsing INSIDE the chunk but the surrounding `auth.` and `.login` are literal → final pattern requires URL `/auth.:provider.login` literally, NOT `/api/auth/foo/login`.

**Confirmed bug class:** trailing dotted (`agents.[id].ts` → produces `/agents.:id`) is ALSO broken — not just middle position. The dogfood-app's "working" routes for these are coincidentally aligned with the scanner output, but `params.id` extraction is dependent on `compilePattern`'s regex shape (must verify in T1.1 test).
