# Review — clean-break-proprietary-surface (M3)

**Date:** 2026-07-04
**Slug:** clean-break-proprietary-surface
**Milestone:** M3 (theokit-ai-first, Eixo B tail)
**Verdict:** READY_TO_MERGE (after 2 review rounds — 2 BLOCKERs found + fixed)

## Scope reviewed

Commits `0faa6ea..HEAD` on `develop`. The M3 clean break: delete the pre-M2 proprietary agent
surface (`AgentEvent`, `useAgentStream`, `defineAgentEndpoint`, `streamAgentRun`,
`createConversationHistory`, the client tool-cards — 10 files, ~1500 LoC), migrate the default
template + fixture to the M2 `agents/chat.ts` + `useAgent` convention, migrate/delete 26 tests,
publish a migration guide, `theokit` major changeset.

## Method

Adversarial review (cto-architect) on the full diff + my own boundary/gate verification. First
round returned NEEDS_FIXES (2 BLOCKERs); all fixed + re-verified.

## Findings + resolutions

| Sev | Finding | Resolution |
|---|---|---|
| BLOCKER (B1) | The `create-theokit` package's OWN test suite (separate from root `tests/`) still asserted `useAgentStream` / `server/routes/chat.ts` — RED | Migrated `scaffold-real.test.ts` (+`agents/chat.ts`, `useAgent`, `@theokit/agents` direct dep) + `bare-transform.test.ts` (removes `agents/chat.ts`). create-theokit 77/77. |
| BLOCKER (B2) | `package.json.tmpl` never declared `@theokit/agents`, which `agents/chat.ts` imports → a scaffolded app fails to resolve it | Added `@theokit/agents ^0.29.0` to the template + `workspace:*` to the fixture; `--bare` strips it (removes the demo agent). |
| MEDIUM (M1) | `layout.tsx` + `README.md.tmpl` still named the deleted `server/routes/chat.ts` | Reworded to `agents/chat.ts` (template + fixture). |
| LOW (L2) | Stale `server/routes/chat.ts` comment in `bare-transform.ts` | Fixed. |
| LOW (L1) | Template `page.tsx` uses `@theokit/ui` APIs pinned to a newer major than the fixture installs (0.14.4) | **PRE-EXISTING** drift (the pre-M3 page had the same); the fixture build already failed on `@usetheo/ui` resolution. Out of M3-removal scope — documented, not fixed. |

## Gates

- **DoD 1 — grep→0:** `grep -rE "AgentEvent|useAgentStream" packages/*/src` = **0** (executable gate test `clean-break-grep-gate.test.ts`).
- **DoD 2 — migration guide:** `docs/migration/0.13-to-0.14-agent-surface.md` — both migrations + removed-exports table (`migration-guide-clean-break.test.ts`).
- **DoD 3 — CHANGELOG BREAKING + template migrated + green:** `CHANGELOG.md § Removed` BREAKING; template + fixture on `agents/chat.ts` + `useAgent`; `theokit: major` changeset.
- **Removal integrity:** workspace `pnpm typecheck` = 0 errors; `theokit` build ESM+DTS green; no orphan exports (knip + manual scan clean); `./server/agent` subpath removed from `package.json` + `tsup.config.ts`; survivors (`defineAgentTool`, `provider-resolver`, `configure-agent-registry`, the M2 surface) intact + consumed.
- **Tests:** 80 M3-root + create-theokit 77 + @theokit/agents 559 green. Two M3 self-regressions found by the gates + fixed (a stray `AgentEvent` test importing a deleted module; a `tsup` entry for the deleted `server/agent/index`).

## Pre-existing failures (NOT M3)

32 failures remain, all pre-existing + unrelated to the agent surface: removed `create-theo`
package (changeset-config, import-validation), missing `docs/migration/0.2-to-0.3.md`
(migration-guide-recipes, docs-migration-0-3-rollback, changelog-0-3), missing `cli/cleanup`
(cli-cleanup-rename), `@usetheo/ui`/`@theokit/ui` peer + fixture-resolution (contract-usetheo-ui,
package-json-peerdep, bundle-budget, devtools-treeshake), web-crypto, wrangler, jobs-crons-docs.
Verified: none reference any deleted agent symbol. Count went 33 (M2 baseline) → 32.

## DoD verification

- [x] `grep -r "AgentEvent|useAgentStream" packages/*/src` returns 0.
- [x] Migration guide published covering `useAgentStream`→`useAgent` + `defineAgentEndpoint`→`defineAgent`.
- [x] CHANGELOG BREAKING/Removed; examples + default template migrated and green (`theokit` major).
