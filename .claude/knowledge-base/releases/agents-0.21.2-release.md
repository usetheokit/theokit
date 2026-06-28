# Release @theokit/agents@0.21.2

**Date:** 2026-06-28
**Verdict:** RELEASED
**Source review:** knowledge-base/reviews/agents-stream-chronological-order-review-2026-06-28.md (READY_TO_MERGE)
**PR:** https://github.com/usetheodev/theokit/pull/45 (develop → main)
**Merge commit:** e572d0b7d519244eb603fadd90f2744823a3ceb0
**Tag:** @theokit/agents@0.21.2
**GitHub release:** https://github.com/usetheodev/theokit/releases/tag/@theokit/agents@0.21.2
**npm:** https://registry.npmjs.org/@theokit/agents/-/agents-0.21.2.tgz (latest)
**Closes:** #44

## What shipped

Fix chronological event ordering in `AgentRunner.stream()` (#44). Tool + thinking events stream through the SDK real-time `onDelta` callback in true arrival order (interleaved with text), consumed concurrently with `send()`, with per-category / per-callId dedup so the `run.stream()` fallback never double-emits and never drops a stream-only tool error. Regression from 0.21.1. No public API change.

## Release mechanism

theokit publishes via **changesets** (per-package versions/tags), not the generic semver `/release` git-tag flow.

1. `pnpm version-packages` consumed the changeset → @theokit/agents 0.21.1 → 0.21.2 (patch) + per-package CHANGELOG.
2. Version PR #45 opened manually (changesets Action cannot create PRs) → human-merged.
3. **CI Release FAILED** on npm OIDC trusted-publishing: `npm error 404 - PUT @theokit/agents` (the trusted-publisher binding at npmjs.com is not active for this package — same class as the 0.21.1 / #43 failure).
4. **Manual token publish** (documented fallback): `npm publish --no-provenance --access public` from `packages/agents`; token placed in `~/.npmrc` and scrubbed in the same command (verified `grep -c _authToken` = 0).

## Cycle evidence

- Full `@theokit/agents` suite: 443 passed | 3 skipped, 0 regressions
- tsc 0 · eslint 0 · sdk-adapter.ts 488 LoC / event-translator.ts 203 (< 500)
- Review: 2 HIGH (unhandled pump rejection; run-ERROR suppression) + 2 MEDIUM fixed and re-verified
- `pnpm install --frozen-lockfile` green (CI install gate)

## Known follow-up

- **CI OIDC trusted-publishing is broken for @theokit/agents** (E404 on PUT) — every release currently requires a manual token publish. Worth configuring the npm trusted-publisher binding (or restoring NPM_TOKEN secret) so the changesets CI can publish unattended. Separate infra issue.
- Bump theocode `@theokit/agents` → `^0.21.2` to pick up the chronological-ordering fix live.
