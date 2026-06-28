# Release — @theokit/agents@0.22.0 (+ theokit@0.11.1)

**Date:** 2026-06-28
**Verdict:** PR_OPEN_AWAITING_APPROVAL
**Vehicle:** changesets (`changeset version` on develop → Version PR → CI `changeset publish` on merge to main)
**Source review:** `.claude/knowledge-base/reviews/agents-reasoning-effort-review-2026-06-28.md` (READY_TO_MERGE)
**PR:** https://github.com/usetheodev/theokit/pull/48 (develop → main)
**Version commit:** `80e7ecd` chore(release): version packages — @theokit/agents@0.22.0

## Versions

| Package | From | To | Bump | Reason |
|---|---|---|---|---|
| `@theokit/agents` | 0.21.2 | 0.22.0 | minor | `agents-reasoning-effort` changeset (M1) |
| `theokit` (`theo`) | 0.11.0 | 0.11.1 | patch | dependent — bumped to `@theokit/agents@^0.22.0` |
| fixtures/services-* + create-theokit template | — | — | range sync | `pnpm sync:templates` → `theokit ^0.11.1` |

State at release time: `origin/main` and npm both at agents 0.21.2 / theo 0.11.0 — no version skew.

## Pending (human-gated)

1. Human reviews + merges PR #48 (Unbreakable Rule 4 — no self-merge).
2. On merge, CI (`release.yml`, changesets publish, OIDC provenance) publishes `@theokit/agents@0.22.0` + `theokit@0.11.1` to npm.
3. If CI OIDC publish E404s (known failure mode), fall back to manual `npm publish --no-provenance --access public` per `reference_theokit_changesets_release_flow` / `project_theokit_manual_npm_publish` (scrub token after).

## Notes

- No `ROADMAP.md` checkbox flip applies: M1 is tracked in `theocode/.claude/knowledge-base/ROADMAP-reasoning-visibility.md` (informal, cross-repo), not a `theokit/ROADMAP.md` milestone with `milestone_id` frontmatter wired to `cycle-release`'s flip step.
- `@theokit/agents` releases via changesets, NOT the `/release` semver-tag flow (per `reference_theokit_changesets_release_flow`).
