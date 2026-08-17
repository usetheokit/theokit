# Release — @theokit/agents@0.23.0 (+ theokit@0.11.2)

**Date:** 2026-06-28
**Verdict:** PUBLISHED (npm live) · PR_OPEN_AWAITING_APPROVAL (main-sync)
**Vehicle:** changesets `changeset version` (develop) → **manual `npm publish`** (CI OIDC publish E404s for this repo) → Version PR for main-sync
**Source review:** `.claude/knowledge-base/reviews/agents-think-tag-middleware-review-2026-06-28.md` (READY_TO_MERGE)
**Version PR:** https://github.com/usetheodev/theokit/pull/50 (develop → main)
**Version commit:** `5735b2f` chore(release): version packages — @theokit/agents@0.23.0

## Published (live on npm)

| Package | Version | Verified |
|---|---|---|
| `@theokit/agents` | 0.23.0 | `npm view @theokit/agents@0.23.0 version` → 0.23.0 |
| `theokit` | 0.11.2 | `npm view theokit@0.11.2 version` → 0.11.2 |

State at release: `origin/main` + npm were at agents 0.22.0 / theo 0.11.1 — no skew.

## Flow (M1 lessons applied — single PR, no CI failure)

1. `pnpm version-packages` → agents 0.22.0→0.23.0 (M2 changeset, minor); theo 0.11.1→0.11.2 (dependent patch); template/fixture range synced to `theokit@^0.11.2`.
2. Built `@theokit/agents`; manual publish in topological order — `@theokit/agents@0.23.0` then `theokit@0.11.2` (dry-run-verified). CI OIDC publish is non-functional here (E404, per `reference_theokit_changesets_release_flow`).
3. Regenerated `pnpm-lock.yaml` AFTER publish (both versions resolvable) and committed it **with** the version bump (M1 lesson — avoids the CI `frozen-lockfile` failure). `pnpm install --frozen-lockfile` passes.
4. Opened ONE Version PR #50 (develop→main) for main-sync — unlike M1 which needed a follow-up lockfile PR.
5. npm token used only in a temporary `~/.npmrc`, scrubbed after (verified: `npm whoami` → ENEEDAUTH; zero token occurrences in repo).

## Pending (human-gated, Unbreakable Rule 4)

- Human merges PR #50 → `main` reflects the released state. The packages are already live on npm, so no publish step remains; the CI Release run on merge will (as known) fail at OIDC publish but the versions are already published (no-op) and the install step now passes (lockfile synced).

## Notes

- No `ROADMAP.md` checkbox flip: M2 is tracked in `theocode/.claude/knowledge-base/ROADMAP-reasoning-visibility.md` (informal, cross-repo), not a `theokit/ROADMAP.md` milestone with `milestone_id` frontmatter wired to `cycle-release`.
- M3 (theocode consume + live proof) is now unblocked — both M1 (`@theokit/agents@0.22.0`) and M2 (`@theokit/agents@0.23.0`) are on npm.
