# Release: theokit@0.39.1

- **Date:** 2026-07-14
- **Type:** patch (hotfix)
- **Input verdict:** hotfix for a regression shipped in `theokit@0.39.0` (M47), caught in a real-browser dogfood (not a milestone — ROADMAP already COMPLETE).
- **Bump derivation:** patch — only `### Fixed` entries.

## What shipped

Fix `ReferenceError: agentHandle is not defined` in the browser when binding an agent by handle (`import { chat } from '@theo/agents'; useAgent(chat)`).

Root cause: the generated `@theo/agents` runtime module did `export { useAgent, agentHandle } from 'theokit/client'` and then called `agentHandle('/api/agents/<name>')`. A re-export (`export { x } from '…'`) creates **no local binding**, so the handle constructor threw at module evaluation and the whole chat surface fell into the error boundary. Fix: `import { agentHandle }` (local binding); re-export only `useAgent`. Extracted into a pure `generateAgentsRuntimeModule(agentNames)`.

## Evidence

- 8/8 unit tests green (regression `test_agentHandle_is_imported_not_reexported` + empty-manifest + one-handle-per-agent), tsc + eslint clean.
- **Real browser (Chrome DevTools MCP):** fresh chat renders (no error boundary), message sent → agent streamed a reply ("browser works"), zero console errors. This is the exact path missed by curl + the `.d.ts`-only unit test in 0.39.0.
- Built + published dist confirmed to emit `import { agentHandle } from 'theokit/client'` (not the re-export).
- `pnpm verify:published` → `theokit@0.39.1: no workspace: leak`.

## Pipeline

- Commits on `develop`: `083ad1e5` (fix) + `5de90718` (chore(release)).
- Release PR: [#128](https://github.com/usetheodev/theokit/pull/128) develop→main — human-approved + merged (merge commit `2a5deca6`).
- npm: `theokit@0.39.1` published (manual — GitHub Actions billing blocked; `provenance` stripped in working-tree only for the local publish, then `git restore`d so the versioned state keeps CI provenance).
- git tag: `theokit@0.39.1` (created by `changeset publish`, pushed).
- GitHub release: https://github.com/usetheodev/theokit/releases/tag/theokit%400.39.1
- Scope: only `theokit` bumped (0.39.0 → 0.39.1); no peer cascade (the `onlyUpdatePeerDependentsWhenOutOfRange` guard held). Templates synced to `^0.39.1`.

## Downstream

- `apps/showcase` bumped to `theokit@^0.39.1` and re-installed from npm — the temporary dist overlay is gone (symlink now points at the `0.39.1` pnpm store); the installed dist carries the fix.

## Lesson

Curl + a `.d.ts`-only unit test do not exercise the generated **runtime** virtual module. An ESM re-export that is then *called* locally is a `ReferenceError` only at browser module-eval time. Real-browser dogfood is the gate that caught it — reinforces [[feedback_real_browser_dogfood]].
