# Release — @theokit/agents@0.25.0 + theokit@0.11.5

**Date:** 2026-06-30
**Verdict:** PR_OPEN_AWAITING_APPROVAL
**Source review:** .claude/knowledge-base/reviews/tool-dialect-tag-stripper-review-2026-06-30.md (READY_TO_MERGE)
**PR:** https://github.com/usetheodev/theokit/pull/55
**Release-prep commit:** 81d72ae (chore(release): @theokit/agents@0.25.0 + theokit@0.11.5)
**Mechanism:** changesets (`changeset version` consumed `.changeset/agents-tool-dialect-stripper.md` → minor bump agents 0.24.1→0.25.0; cascade patch theokit 0.11.4→0.11.5 + fixtures + create-theokit template via updateInternalDependencies + sync:templates)
**milestone_id:** none (ad-hoc / off-roadmap fix — Step 7.5 checkbox flip skipped by design)

## Bumps

| Package | From | To | Why |
|---|---|---|---|
| @theokit/agents | 0.24.1 | 0.25.0 | minor — tool-dialect stripper feature (theocode#32) |
| theokit (packages/theo) | 0.11.4 | 0.11.5 | patch — dep range ^0.24.0 → ^0.25.0 (minor bump out of range) |
| fixtures/services-{both,node-basic,python-basic} | — | patch | cascade (depend on theokit) |
| create-theokit default template | — | — | sync:templates ^0.11.4 → ^0.11.5 |

## Pending (post-merge — resume via /release or "merged")

1. Human approves + merges PR #55 (develop→main).
2. Tag the merge commit (annotated) + GitHub release.
3. Publish to npm (manual via token per project_theokit_manual_npm_publish, OR changesets CI).
4. theocode adopts @theokit/agents@0.25.0 (enable stripToolDialect on the qwen path) → closes theocode#32.
