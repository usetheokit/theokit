# Git Safety

Source of Truth for the forbidden git commands and their safe substitutes
(Unbreakable Rule 4). The list lives here as a document so the corpus states the
contract even if the runtime hook is disabled; `hooks/validate-command.sh` enforces
the mechanizable subset.

## § 1 — Branching model

- All work happens on `develop` (single-trunk). Features, fixes, refactors, docs, chores — every change commits to `develop`. No feature branches by default.
- `main` is protected. It receives **release merges only** (a `develop → main` PR + a semver tag on merge). Never commit to, merge into, rebase, reset, or cherry-pick onto `main` locally.

## § 2 — Forbidden commands and substitutes

| Forbidden | Why | Use instead |
|---|---|---|
| `git checkout` | Ambiguous (branch vs file); easy to discard work | `git switch <branch>` / `git restore <path>` |
| `git revert` | Hides history behind an auto-commit | A new explicit commit that reverses the change |
| `git push --force` / `-f` | Rewrites shared history | `git push --force-with-lease` only when explicitly authorized, and never on `main`/`develop` |
| `git reset --hard` | Destroys uncommitted work irrecoverably | `git stash` or `git reset --soft` |
| Any mutation of `main` (commit/merge/rebase/reset/cherry-pick) | `main` is release-only | Do the work on `develop`; cut the release via PR |

`git push --force` is forbidden on `main` and `develop` unconditionally; force-push
is tolerated only on disposable, never-shared branches.

## § 3 — Enforcement

- `hooks/validate-command.sh` (PreToolUse) blocks the mechanizable subset: `checkout`, `revert`, `push --force`/`-f`, `reset --hard` on any branch, and `commit`/`merge`/`rebase`/`reset`/`cherry-pick` when `HEAD` is `main`. Exit code 2 = blocked.
- `push` is intentionally NOT blocked on `main` — release legitimately pushes a tag; the dangerous variant (`push --force`) is already blocked globally.

## § 4 — Anti-patterns

- Reaching for `git checkout` out of habit — the hook blocks it; retrain to `switch`/`restore`.
- "I'll just fast-forward `main` locally" — `main` advances only through a merged PR.
- Force-pushing to recover from a bad rebase on a shared branch — use `--force-with-lease`, and never on `main`/`develop`.

## Cross-references

- Schema for cycle rules: `cycle-rule-schema.md`
- Hook: `../hooks/validate-command.sh`
- Cycles that cite this: `cycle-implement.md`, `cycle-release.md`, `cycle-review.md`
