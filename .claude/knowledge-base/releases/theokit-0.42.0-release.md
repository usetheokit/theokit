# Release — theokit@0.42.0 · @theokit/agents@0.41.0

**Date:** 2026-07-15
**Verdict:** PR_OPEN_AWAITING_APPROVAL
**Mechanism:** changesets (per-package), NOT single-tag `vX.Y.Z`
**Source review:** `.claude/knowledge-base/reviews/sdk-4-migration-review-2026-07-15.md` (READY_TO_MERGE)
**PR:** https://github.com/usetheodev/theokit/pull/134
**Bump:** minor — theokit 0.41.0 → 0.42.0 · @theokit/agents 0.40.0 → 0.41.0
**Roadmap checkbox:** skipped — plan has no `milestone_id` (ad-hoc migration)

## Release prep commits (on develop)

- `0f0d986b` docs(review): sdk-4-migration READY_TO_MERGE audit (release traceability)
- `30ecfbd6` chore(release): theokit@0.42.0 · @theokit/agents@0.41.0

## Content (from consumed changeset)

Adopt `@theokit/sdk@^4.0.1` — native `.jsonl` transcript persistence (auto, no storage adapter).
Breaking-in-0.x: `.conversationStorage()` + `@Conversation` removed. Transcript rooted at
`<projectRoot>/.data/agent-sessions`.

## Post-merge steps (human — manual)

1. Approve + merge PR #134 (`develop → main`).
2. `pnpm release` (= `pnpm build && changeset publish`) — publishes theokit@0.42.0 + @theokit/agents@0.41.0 to npm.
3. Per-package tags cut by `changeset publish`.
4. `pnpm verify:published` to confirm no `workspace:` leak.

## Pre-existing loose end (out of scope for this release)

The prior `theokit@0.41.0 · @theokit/agents@0.40.0` release commit (53e3582d) is on `main`
but its tags were never cut (last tags: `theokit@0.40.0` / `@theokit/agents@0.39.0`). If those
versions were never published, `changeset publish` after this merge will publish 0.41.0 → 0.42.0
in sequence. Surfaced for human awareness; not fixed here (would be a separate action).
