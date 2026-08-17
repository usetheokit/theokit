# Release theokit@0.11.0

**Date:** 2026-06-28
**Verdict:** RELEASED
**Cycle:** agents-thinking-event-contract (Cycle 1 — thinking-visibility radar fix)
**Source review:** `.claude/knowledge-base/reviews/agents-thinking-event-contract-review-2026-06-28.md` (READY_TO_MERGE)
**Feature PR:** https://github.com/usetheodev/theokit/pull/46 (merged — merge `8588e1d`)
**Version PR:** https://github.com/usetheodev/theokit/pull/47 (merged — merge `1b21aa8`)
**Published:** `theokit@0.11.0` on npm (dist-tag `latest`), verified `npm view theokit version` → 0.11.0
**Bump:** minor (0.10.1 → 0.11.0), via changeset `agents-thinking-event-contract` (`theokit: minor`)

## What shipped

- `AgentThinkingEvent` (`{ type: 'thinking'; content: string; id? }`) — additive fifth variant of the `AgentEvent` wire contract, exported from `theokit/client`. Non-breaking; mirrors `@theokit/agents` `ThinkingEvent`. Lets agent apps carry the model's reasoning end-to-end. (`packages/theo`)

## Publish path (OIDC fallback)

The changesets Release workflow could NOT complete the release autonomously:
1. On the feature-PR merge, the changesets action failed to open the "Version Packages" PR — *"GitHub Actions is not permitted to create or approve pull requests"*. → Opened the Version PR (#47) manually (`pnpm version-packages` on develop, commit `a653f16`).
2. On the Version-PR merge, the publish step failed — *"No NPM_TOKEN found, but OIDC is available - using npm trusted publishing"* → `pnpm changeset publish` exited 1 (OIDC trusted-publishing E404, the known per-package limitation; same as `@theokit/agents` 0.21.x).
3. **Manual publish fallback** (per `project_theokit_manual_npm_publish`): token in `~/.npmrc` → `pnpm build` → `cd packages/theo && npm publish --no-provenance --access public` → `+ theokit@0.11.0`. Token scrubbed immediately after (verified `grep -c` = 0, `npm whoami` → ENEEDAUTH).

## Follow-up

- **Infra:** the `theokit` package OIDC trusted-publishing returns E404 — same broken state as `@theokit/agents`. Manual token publish is the standing fallback until the npm trusted-publisher binding is fixed for these packages.
- **Cycle 2 (theocode):** now unblocked — bump `theokit@^0.11.0`, map `@theokit/agents` thinking → `AgentThinkingEvent` in `toAgentEvent`, render dim/expandable "Pensando…/Pensou por Ns", persist.
