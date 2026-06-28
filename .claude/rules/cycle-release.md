# Cycle: RELEASE

Source of Truth for the release-cut cycle. Runs after `cycle-review` emits `READY_TO_MERGE`; produces a merge of `develop` into `main` and a semver tag. Human stays in the loop ONLY at PR-approval — every other step is automated.

## Purpose

Take an approved implementation from `READY_TO_MERGE` to a released, tagged version on `main`. Eliminates the manual release ritual (merge, version bump, tag, push, GitHub release notes) while keeping the human-controlled merge approval — Unbreakable Rule 4 (never commit directly to `main`).

## Pre-conditions

- `cycle-review` emitted verdict `READY_TO_MERGE` (audit at `knowledge-base/reviews/{slug}-review-{date}.md`).
- Working branch is `develop` (never `main` — `main` is release-only).
- No uncommitted changes (`git status --porcelain` empty).
- CHANGELOG `[Unreleased]` section has ≥ 1 entry — otherwise the release has nothing to announce.
- The `gh` CLI is authenticated (`gh auth status` exits 0).
- (Optional) CI is green on `develop` — verified with `gh run list --branch develop --limit 1`.

Do NOT trigger when:

- No commits since the last release tag (nothing to release).
- A release PR is already open (`gh pr list --base main --head develop --state open` non-empty).
- `cycle-review` verdict is not `READY_TO_MERGE`.

## Chain

```
/release {bump-level?}
     ↓ detect last semver tag (git describe --tags --abbrev=0; fall back to v0.0.0)
     ↓ determine next version (bump-level OR auto-derive from CHANGELOG sections)
     ↓ rewrite CHANGELOG: move [Unreleased] body under [{next-version}] - {date}
     ↓ commit "chore(release): {next-version}" on develop
     ↓ open PR develop → main with the rendered release notes as body
     ↓ wait for human approval (hard gate — Unbreakable Rule 4 mandate)
     ↓ on merge: create annotated tag {next-version} pointing at the merge commit
     ↓ push tag; gh release create
     ↓ POST-MERGE checkbox flip — see § Post-merge ROADMAP.md checkbox flip
```

## Phase contracts

| Phase | Input | Output | Hard gate |
|---|---|---|---|
| detect-version | last semver tag | parsed semver tuple | tag matches `v?\d+\.\d+\.\d+` OR fall back to v0.0.0 |
| bump | parsed version + bump-level | next version string | bump-level ∈ {patch, minor, major} OR derivable from CHANGELOG |
| changelog-rewrite | CHANGELOG.md | CHANGELOG with [Unreleased] empty and a new versioned section | [Unreleased] had ≥ 1 entry before the rewrite |
| pr-open | release branch state | PR URL | `gh pr create` exit 0; PR body = release notes |
| tag-cut (post-merge) | merged commit on main | annotated tag + GitHub release | `git tag --verify` resolves AND tag points at the merge commit |
| roadmap-checkbox-flip (post-merge) | plan frontmatter `milestone_id` + ROADMAP.md | ROADMAP.md edited: `## M<N> — [ ] ...` → `## M<N> — [x] ...`; commit `chore(roadmap): mark M<N> done`; roadmap-runs file updated | plan declared `milestone_id`; matching milestone exists in ROADMAP.md; current state is `[ ]` (idempotent — if already `[x]`, skip with INFO) |

## Post-merge ROADMAP.md checkbox flip

Closes the `cycle-roadmap` super-loop. Runs after Step 7 (tag-cut) succeeds.

Algorithm:

1. Read `milestone_id` from `knowledge-base/plans/{slug}-plan.md` frontmatter.
   - **If missing:** emit `WARN roadmap-checkbox: plan has no milestone_id — skipping flip (ad-hoc release)`. Continue cycle as `RELEASED`. This is the documented escape hatch for hotfixes and off-roadmap work — never block the release on roadmap metadata.
2. Read `ROADMAP.md`; locate the header `## M<N> — [ ] <name>` exactly.
   - **If not found:** emit `WARN roadmap-checkbox: M<N> not found in ROADMAP.md — skipping flip`. Surface the mismatch to the human.
   - **If already `[x]`:** emit `INFO roadmap-checkbox: M<N> already [x] — no-op`. Continue.
3. In-place edit: replace `## M<N> — [ ] <name>` with `## M<N> — [x] <name>`. NEVER use fuzzy matching; the slot is the literal milestone header.
4. Commit on `develop` (NOT `main` — Unbreakable Rule 4): `chore(roadmap): mark M<N> done (v<NEXT_VERSION>)`.
5. Append to `knowledge-base/roadmap-runs/{milestone-id}-{date}.md`:
   - `status: completed`
   - `checkbox_flipped_at: <ISO timestamp>`
   - `flip_commit_sha: <sha>`
   - Link to the release log.

The single-flip invariant (`cycle-roadmap § Hard gates`) MUST hold: exactly one checkbox flipped per release. A release whose plan declares `milestone_id: M3` MUST NOT also flip M4 — even if both were implemented in the same commit set. Slot one milestone per release; bundling violates traceability.

## Verdicts

- `RELEASED` — PR merged, tag created, GitHub release published. Cycle complete.
- `PR_OPEN_AWAITING_APPROVAL` — chain paused at the human-approval gate. Resume automatically once the PR merges.
- `BLOCKED` — pre-condition failed OR a hard gate fired during the chain. Surface to human.

## Bump-level derivation

When the user does not pass `{bump-level}` explicitly:

- `major` — `[Unreleased] § Removed` is non-empty OR any `[Unreleased] § Changed` entry begins with `BREAKING:`.
- `minor` — `[Unreleased] § Added` is non-empty AND no major triggers.
- `patch` — only `[Unreleased] § Fixed` / `Security` entries.

If the rule cannot pick deterministically, the chain pauses and the human chooses.

## Hard gates

- **PR approval gate (LOCKED)** — the merge step ALWAYS waits for a human-approved PR. Auto-merging into `main` violates Unbreakable Rule 4.
- **No direct commits to `main`** — even from this skill. Every change reaches `main` via the PR opened above.
- **Tag must be annotated** (`git tag -a`) and pushed only after merge to `main` — never on `develop`.
- **CHANGELOG must have content** — refuse if `[Unreleased]` is empty after stripping headers.
- **Single-flip invariant** — at most ONE ROADMAP.md checkbox flipped per `RELEASED` verdict. Per `cycle-roadmap § Hard gates`.
- **No silent flip** — the roadmap-runs file MUST be appended with the flip commit SHA. A flip without a run-file entry is forbidden.

## Stop conditions

- `gh pr create` fails → halt; surface stderr.
- PR is closed without merge → halt; record the rationale in `knowledge-base/releases/{version}-release.md`.
- Tag already exists for the computed version → halt; ask the human to pick the next version explicitly.

## Anti-patterns

- Auto-merging the release PR. Always human-gated.
- Editing `[Unreleased]` directly during the release chain — entries should be in place beforehand (CHANGELOG discipline is Unbreakable Rule 6).
- Producing a release without a corresponding `cycle-review` audit. Released artifacts must be traceable to a `READY_TO_MERGE` verdict.
- Skipping the GitHub release creation step. Downstream consumers (changelogs, dependency updates) read GitHub releases, not local tags.
- Cutting a release while `cycle-code-quality` reports unaddressed `FAIL_HARD` findings. The review gate already enforces this; never bypass.
- **Fuzzy-matching the milestone for the checkbox flip.** Plan declares `milestone_id: M3` → flip M3, never M4 even if names look similar. Slot is the literal `## M<N>` header.
- **Flipping multiple checkboxes from one release.** Each release maps to exactly one milestone via plan `milestone_id`. Bundling milestones into one release corrupts traceability — split releases instead.
- **Flipping a checkbox without writing the roadmap-runs file.** The flip must be auditable: which release, which SHA, when.
- **Blocking the release if `milestone_id` is missing.** Ad-hoc work (hotfixes, off-roadmap fixes) is by design — emit WARN, continue as RELEASED, skip the flip.

## Output

- `knowledge-base/releases/{version}-release.md` — record of the release run: input verdict, computed version, PR URL, merge commit, tag, GitHub release URL.
- `[Unreleased]` empty (until the next change lands).
- `git tag v{version}` annotated, pushed.
- GitHub release published.
- `ROADMAP.md` edited: `## M<N> — [ ]` → `[x]` when the plan declared `milestone_id` (skipped with WARN otherwise).
- `knowledge-base/roadmap-runs/{milestone-id}-{date}.md` appended with `status: completed`, `checkbox_flipped_at`, `flip_commit_sha` (only when the flip ran).

## Cross-references

- Schema for cycle rules: `cycle-rule-schema.md`
- Skill: `skills/release/SKILL.md`
- Upstream: `cycle-review.md` (consumes its `READY_TO_MERGE` verdict)
- Macro super-loop: `rules/cycle-roadmap.md` — defines the single-flip invariant + the roadmap-runs file contract
- Conventions: `architecture.md`, `public-copy.md` (release notes lint), `audit-trail-rotation.md`, `git-safety.md`
- Unbreakable rules consumed: Rule 4 (no commit to `main`; release is the only path — see `git-safety.md`), Rule 6 (CHANGELOG discipline)
