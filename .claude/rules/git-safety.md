# Git Safety

Source of Truth for the forbidden git commands and their safe substitutes
(Unbreakable Rule 4). The list lives here as a document so the corpus states the
contract even if the runtime hook is disabled; `hooks/validate-command.sh` enforces
the mechanizable subset.

## § 1 — Branching model

```
workspace ──PR──> develop ──PR + semver tag──> main
 (work)          (integration)                (release)
```

- **`workspace`** is where work is born. Single, permanent branch — never deleted, never recreated per task. Features, fixes, refactors, docs, chores: every change commits here first.
- **`develop`** integrates work; it never originates it. It advances **only** by promoting `workspace` through a `workspace → develop` PR, plus the push that carries it. Never commit to, rebase, reset, or cherry-pick onto `develop` locally, and never merge anything other than `workspace` into it.
- **`main`** is release-only. It receives a `develop → main` PR plus a semver tag on merge. Never commit to, merge into, rebase, reset, or cherry-pick onto `main` locally.

**Which layer guarantees what** — the two are not interchangeable:

| Guarantee | Enforced by | Scope |
|---|---|---|
| Work *originates* on `workspace` (no direct authoring on develop/main) | `hooks/validate-command.sh` | Local, every machine that installed the hook |
| Promotion *passes through a PR* (no merge that skips review) | Branch protection on the remote | Server-side, unbypassable |

The hook cannot tell a merge that finalizes an approved PR from one that skips it — it only sees `git merge workspace`. A repository without branch protection on `develop` has the origin guarantee but not the review guarantee.

## § 2 — Forbidden commands and substitutes

| Forbidden | Why | Use instead |
|---|---|---|
| `git checkout` | Ambiguous (branch vs file); easy to discard work | `git switch <branch>` / `git restore <path>` |
| `git revert` | Hides history behind an auto-commit | A new explicit commit that reverses the change |
| `git push --force` / `-f` | Rewrites shared history | `git push --force-with-lease` only when explicitly authorized, and never on `main`/`develop` |
| `git reset --hard` | Destroys uncommitted work irrecoverably | `git stash` or `git reset --soft` |
| Any mutation of `main` (commit/merge/rebase/reset/cherry-pick) | `main` is release-only | Do the work on `workspace`; cut the release via PR |
| Authoring or rewriting on `develop` (commit/rebase/reset/cherry-pick) | `develop` integrates, never originates | Commit on `workspace`; promote via `workspace → develop` PR |
| Merging a non-`workspace` branch into `develop` | Bypasses the workspace→develop gate | Land the work on `workspace` first, then promote |

`git push --force` is forbidden on `main`, `develop` and `workspace` unconditionally;
force-push is tolerated only on disposable, never-shared branches.

## § 3 — Enforcement

- `hooks/validate-command.sh` (PreToolUse) blocks the mechanizable subset. Exit code 2 = blocked:
  - Any branch: `checkout`, `revert`, `push --force`/`-f`, `reset --hard`.
  - `HEAD` is `main`: `commit`/`merge`/`rebase`/`reset`/`cherry-pick`.
  - `HEAD` is `develop` (G1): `commit`/`rebase`/`reset`/`cherry-pick`, and `merge` from anything other than `workspace` (`origin/`/`upstream/` prefixes accepted).
  - The inline forms (`git switch main && …`, `git switch develop && …`) are covered too — reading the live branch alone is bypassable in a compound command.
- `push` is intentionally NOT blocked on `main` or `develop` — release legitimately pushes a tag and the promotion has to reach origin; the dangerous variant (`push --force`) is already blocked globally.
- Branch protection on the remote is what makes the PR itself mandatory (see § 1). The hook governs origin, not review.

## § 4 — Anti-patterns

- Reaching for `git checkout` out of habit — the hook blocks it; retrain to `switch`/`restore`.
- "I'll just fast-forward `main` locally" — `main` advances only through a merged PR.
- "It's a one-line fix, I'll commit straight to `develop`" — the size of the change is not the criterion; origin is. It goes on `workspace` like everything else.
- Merging a side branch into `develop` because "it's already reviewed" — if it did not come through `workspace`, the gate did not see it.
- Force-pushing to recover from a bad rebase on a shared branch — use `--force-with-lease`, and never on `main`/`develop`/`workspace`.

## Cross-references

- Schema for cycle rules: `cycle-rule-schema.md`
- Hook: `../hooks/validate-command.sh`
- Cycles that cite this: `cycle-implement.md`, `cycle-release.md`, `cycle-review.md`
