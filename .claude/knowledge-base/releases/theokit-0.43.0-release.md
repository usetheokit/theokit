# Release — theokit@0.43.0 · @theokit/agents@0.42.0 (M48)

**Date:** 2026-07-15
**Verdict:** RELEASED
**Mechanism:** changesets (per-package)
**Milestone:** M48 (roadmap-driven — checkbox flips post-merge)
**Source review:** `.claude/knowledge-base/reviews/ecosystem-integration-guarantee-review-2026-07-15.md` (READY_TO_MERGE)
**PR:** https://github.com/usetheodev/theokit/pull/135
**Bump:** minor — theokit 0.42.0 → 0.43.0 · @theokit/agents 0.41.0 → 0.42.0

## Content (from consumed changeset)

M48 ecosystem integration guarantee for the `@theokit/sdk` seam: contract test (consumer + producer),
`CustomTool` type gate (tools now see `ctx.threadId`/`ctx.messages`), boot-time `SdkIncompatibleError`
fail-fast, closed peer ranges, seam manifest doc, parity audit.

## Cross-repo

Sibling `theokit-sdk` develop: `c529bfd2` (producer contract test + `prepublishOnly`) + `17168648`
(seam doc mirror). Pushed to its `develop`.

## Post-merge steps (human — manual)

1. Approve + merge PR #135 (`develop → main`).
2. `pnpm release` (build + `changeset publish`) — publishes theokit@0.43.0 + @theokit/agents@0.42.0 (with a ROTATED npm token; the prior tokens are compromised).
3. Flip `ROADMAP.md` M48 `[ ]` → `[x]` (plan declares `milestone_id: M48`) + append the roadmap-run file. M48 is the LAST milestone → this yields **ROADMAP_COMPLETE**.
4. `pnpm verify:published`.

## Note

theokit@0.42.0 (M sdk-4 migration) is on `main` but not yet published (prior loose end). `changeset publish`
after this merge publishes the pending versions in sequence.

## Published (2026-07-15)

- `theokit@0.43.0` — npm `latest` (published with `--no-provenance`; publishConfig `provenance:true` needs CI OIDC, unavailable locally).
- `@theokit/agents@0.42.0` — npm (via `changeset publish`).
- `pnpm verify:published`: no `workspace:` leak. Git tags `theokit@0.43.0` + `@theokit/agents@0.42.0` pushed.
- Auth: existing `~/.npmrc` (`usetheodev`) — the pasted plaintext token was NOT used (compromised; rotate).
- Version gap: npm 0.40.0 → 0.43.0 (0.41.0/0.42.0 never published — prior loose end).
