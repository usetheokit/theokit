# Release: theokit@0.40.0 · @theokit/agents@0.39.0 · create-theokit@1.11.2 — adopt @theokit/sdk@3.x

- **Date:** 2026-07-14
- **Type:** minor (theokit + agents) / patch (create-theokit) — BREAKING peer requirement
- **Trigger:** user asked to update TheoKit to consume the newly-published `@theokit/sdk@3.5.0`.

## What shipped

SDK v3.0 removed standalone factory functions in favor of static `X.create()` (SE36). The `@theokit/agents` bridge now binds the new API:

| Before (SDK 2.x) | After (SDK 3.x) |
|---|---|
| `sdk.defineTool` | `sdk.Tool.create` |
| `sdk.defineSkillReadTool` | `sdk.SkillReadTool.create` |
| `withRetry` | `Retry.create` |
| `createSkill` (scaffold) | `Skill.create` |

**Breaking:** `theokit` + `@theokit/agents` now require `@theokit/sdk >= 3.5.0` and `@theokit/sdk-tools >= 0.9.1`. Apps on SDK 2.x run `npx @theokit/codemod-sdk-3-0 --write`.

## Latent bug fixed (no bypass)

`withRunContext` (the adapter's tool-handler wrapper that injects run-context) forwarded only `signal` + `context`, **dropping** the SE12 `ctx.messages` transcript projection — a tool reading the turn transcript would have silently gotten nothing. It now forwards the full `ctx`, and the tool-handler types **track the SDK's canonical `CustomTool['handler']`** instead of a hand-maintained duplicate (the duplicate was the DRY violation that caused the break). `Tool.create` / `SkillReadTool.create` are bound with `.bind()` / arrow (they take no `this`, but the binding is explicit — satisfies `unbound-method` without relying on that).

## Cascade resolved

`compile-project-context.ts` dynamically imports `@theokit/sdk-tools`, which was pinned `^0.2.0` (installed 0.2.0 — the pre-SE36 build that `import { defineTool }`). Bumped to `^0.9.1` (the SE36-migrated build using `Tool.create`).

## Evidence

- `@theokit/agents` 708/708, `create-theokit` 93/93, `@theokit/http` 411/411, root suite 4099 passed (2 stale version-guard/fixture tests updated: `sdk-1-1-0-exports` major 2→3, `create-theo-default-template` fixture synced; 1 unrelated load-timeout flake passes in isolation). typecheck (agents + agents-test + theo) + eslint clean.
- **Real browser (Chrome), PUBLISHED bits** (`@theokit/agents@0.39.0` + `@theokit/sdk@3.5.0` + `theokit@0.40.0`, overlay removed): chat renders; two tool-using turns work end-to-end — Tokyo weather (`weather` tool) and São Paulo time (`current_time` tool) both CALLED → COMPLETED → agent replied. Zero console errors. Exercises `Tool.create`, the tool-call→result→reply loop, `withRunContext` ctx forwarding, and `Run.stream()` under SDK 3.x.

## Pipeline

- Commits on `develop`: `f61b77f3` (migration) + `7cd1f5e2` (release bump).
- Release PR [#130](https://github.com/usetheodev/theokit/pull/130) develop→main — human-approved + merged (`3b342bc8`).
- npm: `@theokit/agents@0.39.0` + `create-theokit@1.11.2` + `theokit@0.40.0` published (manual; provenance stripped in working-tree only for `theo`+`create-theokit`, then `git restore`d).
- Tags + GitHub releases created; `pnpm verify:published` clean (no `workspace:` leak).

## Downstream

- `apps/showcase` bumped to `@theokit/agents@^0.39.0` + `theokit@^0.40.0` + `@theokit/sdk@^3.5.0` + `@theokit/sdk-tools@^0.9.1`, re-installed from npm — the validation overlay is gone; browser-validated on the real published bits.

## Lesson

A major dependency bump cascades: (1) the consumer's own code (factory renames + a real semantic ctx-forwarding bug the type system had masked because a hand-rolled type duplicated the SDK's), (2) test **mocks** that mirror the SDK shape (16 mock sites — invisible to `tsc`, only the runtime suite catches them), (3) **transitive** deps built against the old API (`@theokit/sdk-tools`), and (4) stale version-guard tests + scaffold code/docs. The type-check is necessary but not sufficient — the full runtime suite + real-browser dogfood are what proved it. Hand-maintained duplicates of a dependency's types are the DRY debt that turns a rename into a silent behavior regression.
