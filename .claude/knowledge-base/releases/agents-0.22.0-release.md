# Release — @theokit/agents@0.22.0 (+ theokit@0.11.1)

**Date:** 2026-06-28
**Verdict:** RELEASED (published to npm via manual fallback)
**Vehicle:** changesets `changeset version` (develop) → Version PR #48 merged → **manual `npm publish`** (CI publish is non-functional for this repo — OIDC E404)
**Source review:** `.claude/knowledge-base/reviews/agents-reasoning-effort-review-2026-06-28.md` (READY_TO_MERGE)
**Version PR:** https://github.com/usetheodev/theokit/pull/48 (develop → main, MERGED)
**Lockfile-sync PR:** https://github.com/usetheodev/theokit/pull/49 (develop → main, post-publish housekeeping)
**Version commit:** `80e7ecd` chore(release): version packages — @theokit/agents@0.22.0

## Published (live on npm)

| Package | Version | Verified |
|---|---|---|
| `@theokit/agents` | 0.22.0 | `npm view @theokit/agents@0.22.0 version` → 0.22.0 |
| `theokit` | 0.11.1 | `npm view theokit@0.11.1 version` → 0.11.1 |

## What happened (honest record)

1. PR #48 merged, but the **CI Release run failed** at `pnpm install --frozen-lockfile` — `changeset version` (commit 80e7ecd) bumped the package.json specifiers (`theo → @theokit/agents@^0.22.0`) but the lockfile was **not regenerated** before commit (prep defect).
2. The CI npm publish is independently non-functional (OIDC **E404** `PUT registry.npmjs.org/theokit`, also seen in runs #46/#47) → releases here are **manual** (per `reference_theokit_changesets_release_flow`).
3. Chicken-and-egg: `theo` consumes `@theokit/agents` from the **registry** (pnpm 9, not workspace-linked), and the fixtures/templates consume `theokit` from the registry, so the lockfile could not resolve `^0.22.0` / `^0.11.1` until those versions were published.
4. Manual publish in topological order: `@theokit/agents@0.22.0` first (`npm publish --no-provenance --access public`), then `theokit@0.11.1`. Both dry-run-verified first.
5. Lockfile regenerated (`pnpm install --lockfile-only`); `pnpm install --frozen-lockfile` now passes. Committed (35f412f) → PR #49.
6. npm token scrubbed from `~/.npmrc` (verified: `npm whoami` → ENEEDAUTH; zero token occurrences in repo).

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
