# Release — unified agent surface (M2)

**Date:** 2026-07-04
**Verdict:** PR_OPEN_AWAITING_APPROVAL
**Flow:** Changesets (per-package tags; CI publishes on Version Packages merge)
**Source review:** .claude/knowledge-base/reviews/unified-agent-surface-review-2026-07-04.md (READY_TO_MERGE)
**Changeset:** .changeset/unified-agent-surface-m2.md (@theokit/agents minor, theokit minor)
**Bumps:** @theokit/agents 0.28.0 → 0.29.0 · theokit 0.12.1 → 0.13.0
**Feature PR:** https://github.com/usetheodev/theokit/pull/68 (develop → main) — MERGED (6f9462f)
**Version Packages PR:** https://github.com/usetheodev/theokit/pull/69 (changeset-release/main → main) — OPEN, awaiting approval
**Milestone:** M2 (plan frontmatter milestone_id: M2)

## Next steps (post-approval)

1. Human approves + merges PR #68 (develop → main).
2. Changesets bot opens the "Version Packages" PR (bumps package.json + per-package CHANGELOGs, consumes the changeset).
3. On Version Packages merge, CI publishes `@theokit/agents@0.29.0` + `theokit@0.13.0`.
   - Known infra blockers (issue #64): Actions-cannot-open-PRs + npm trusted-publisher binding
     required manual Version Packages PR + manual publish for M0/M1. Same may apply here.
4. Post-merge: flip ROADMAP M2 [ ] → [x] + write roadmap-runs/M2-2026-07-04.md.
