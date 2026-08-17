# Release — clean break: remove the proprietary agent surface (M3)

**Date:** 2026-07-04
**Verdict:** RELEASED
**Flow:** Changesets (manual — blockers #1/#3 of issue #64)
**Source review:** .claude/knowledge-base/reviews/clean-break-proprietary-surface-review-2026-07-04.md (READY_TO_MERGE)
**Changeset:** .changeset/clean-break-proprietary-surface.md (theokit: MAJOR)
**Bump:** theokit 0.13.0 → 0.14.0 (BREAKING). @theokit/agents unaffected.
**Feature PR:** https://github.com/usetheodev/theokit/pull/70 — MERGED (f6c4686)
**Version Packages PR:** https://github.com/usetheodev/theokit/pull/71 — MERGED (7673aeb)
**Published (manual — blocker #3):** theokit@0.14.0
**Milestone:** M3 (plan frontmatter milestone_id: M3)

## Next steps (post-approval) — same manual flow as M2

1. Human approves + merges PR #70.
2. Changesets pushes `changeset-release/main` (bumps theokit → 0.14.0); the "Version Packages"
   PR is opened MANUALLY (blocker #1 — Actions cannot open PRs).
3. Human approves + merges the Version Packages PR.
4. The Release workflow's `changeset publish` will 404 (blocker #3 — npm OIDC trusted-publisher
   not bound), so publish `theokit@0.14.0` MANUALLY (automation token; `.npmrc` in /tmp; remove
   provenance; publish; restore; rm token).
5. Post-merge: flip ROADMAP M3 [ ] → [x] + roadmap-runs/M3.
