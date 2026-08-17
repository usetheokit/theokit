# Release: @theokit/agents@0.38.1 · create-theokit@1.11.1

- **Date:** 2026-07-14
- **Type:** patch (DX polish, no behavior change)
- **Trigger:** DX discussion — the scaffolded `agents/chat.ts` inlined framework internals (`.skills()` mechanism) in the developer's first file.

## What shipped

Move the `.skills()` mechanism explanation from the scaffold into the API's JSDoc:

- **`@theokit/agents` 0.38.1** — the `agent()` builder's `.skills()` method gained JSDoc explaining progressive disclosure (the `<skills>` block listed every turn + the on-demand `skill_read` tool), discoverable on hover / cmd-click.
- **`create-theokit` 1.11.1** — the scaffold `agents/chat.ts` dropped the 4-line inline mechanism comment; it now reads as intent (`.skills([dailyBriefingSkill])`) with a one-line pointer to hover `.skills`.

## Design decision (recorded)

Kept `agent()` as the public entry (NOT `new AgentBuilder`). `agent()` is a DIP seam: it injects `create`/`getOrCreate` and keeps the module graph acyclic (G6). `new AgentBuilder()` would either leak the internal `deps` or force a global singleton (banned by DIP), reintroduce the module cycle, and be the sole `new`-based API in a framework that is otherwise all `define*`/`create*`/factory. User chose "keep `agent()`".

Correction during implementation: the JSDoc first landed on `@theokit/sdk`'s `AgentBuilder`, but the scaffold's `agent()` resolves to `@theokit/agents`'s own builder (`packages/agents/src/bridge/agent-builder.ts:124`). Reverted the SDK edit (separate repo/publish train) and put the JSDoc on the correct `@theokit/agents` builder.

## Evidence

- tsc + eslint clean on `@theokit/agents`.
- `create-theokit` `scaffold-real.test.ts` 15/15 green (asserts `.skills([dailyBriefingSkill])`, preserved).
- `pnpm verify:published` → both `@theokit/agents@0.38.1` and `create-theokit@1.11.1` free of `workspace:` leak.

## Pipeline

- Commits on `develop`: `d186cb10` (docs) + `895b970d` (chore(release)).
- Release PR: [#129](https://github.com/usetheodev/theokit/pull/129) develop→main — human-approved + merged (merge commit `37f95185`).
- npm: `@theokit/agents@0.38.1` + `create-theokit@1.11.1` published (manual; `create-theokit` provenance stripped in working-tree only, then `git restore`d).
- git tags `@theokit/agents@0.38.1` + `create-theokit@1.11.1` pushed; GitHub releases created.
- Scope: only the 2 packages bumped; `theokit` unchanged at 0.39.1 — no peer cascade (`onlyUpdatePeerDependentsWhenOutOfRange` held).

## Downstream

- `apps/showcase` bumped to `@theokit/agents@^0.38.1` and re-installed from npm; the local scaffold-mirror `chat.ts` already carries the trimmed comment.
