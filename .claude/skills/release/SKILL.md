---
name: release
version: 0.1.0
requires: [review]
description: Cuts a semver-tagged release from develop → main after /review returns READY_TO_MERGE. Auto-derives version from CHANGELOG sections (major/minor/patch), rewrites [Unreleased] under the new version header, commits chore(release), opens a PR develop→main with rendered release notes, and waits for human approval (the only manual gate — Unbreakable Rule 4). On merge, creates an annotated tag and a GitHub release. Single entry-point for cycle-release. Use after /review {slug} returned READY_TO_MERGE.
user-invocable: true
allowed-tools: Read Glob Grep Bash Write Edit Skill
argument-hint: "[bump-level: patch|minor|major] (optional — auto-derived from CHANGELOG when omitted)"
---

# Release — develop → main with semver tag

Single entry-point for [`cycle-release`](../../rules/cycle-release.md). Automates the release ritual end-to-end while keeping the human approval at PR merge — the only manual step Unbreakable Rule 4 mandates.

## Cycle contract

This skill is **the only phase** of [`cycle-release`](../../rules/cycle-release.md). The cycle rule is the **source of truth** for pre-conditions, verdicts (`RELEASED` / `PR_OPEN_AWAITING_APPROVAL` / `BLOCKED`), hard gates (PR approval mandatory; no direct main commits; annotated-tag-only), stop conditions, and anti-patterns. **Read `cycle-release.md` before invoking.**

## When to trigger

User invokes `/release [bump-level]` when:

- A `/review {slug}` run emitted `READY_TO_MERGE` recently (audit at `knowledge-base/reviews/{slug}-review-{date}.md`).
- The working branch is `develop` with commits ahead of `main`.
- `CHANGELOG.md` has content in `[Unreleased]`.
- `gh` CLI is authenticated.

Refuse to start when any pre-condition declared in `cycle-release.md § Pre-conditions` fails.

## Argument

`{bump-level}` is optional. When omitted, the skill derives the bump deterministically from `CHANGELOG.md § [Unreleased]`:

| Trigger in [Unreleased] | Bump |
|---|---|
| `### Removed` non-empty OR `### Changed` entry starts with `BREAKING:` | `major` |
| `### Added` non-empty AND no major trigger | `minor` |
| Only `### Fixed` / `### Security` entries | `patch` |

If derivation is ambiguous, the skill pauses and asks the human ONCE.

## Workflow

### Step 1 — Pre-condition validation (refuse if any fails)

```bash
# Branch is develop
[ "$(git branch --show-current)" = "develop" ]
# Clean tree
[ -z "$(git status --porcelain)" ]
# Latest /review verdict is READY_TO_MERGE
LATEST_REVIEW=$(ls -t knowledge-base/reviews/*-review-*.md 2>/dev/null | head -1)
grep -q '^\*\*Verdict:\*\* READY_TO_MERGE' "$LATEST_REVIEW"
# CHANGELOG [Unreleased] has content
python3 skills/release/scripts/changelog_section_nonempty.py --section Unreleased
# gh CLI authenticated
gh auth status >/dev/null 2>&1
# No release PR already open
[ -z "$(gh pr list --base main --head develop --state open --json number)" ]
```

If any HARD check fails, refuse with the missing piece surfaced honestly.

### Step 2 — Detect current version and compute next

```bash
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
NEXT_VERSION=$(python3 skills/release/scripts/compute_next_version.py \
  --current "$LAST_TAG" \
  --bump "${ARGUMENTS:-auto}" \
  --changelog CHANGELOG.md)
```

If `compute_next_version.py` returns `AMBIGUOUS`, AskUserQuestion ONCE (major / minor / patch) and re-run with the chosen value.

If a tag for `$NEXT_VERSION` already exists, halt — never overwrite a published tag.

### Step 3 — Rewrite CHANGELOG

```bash
python3 skills/release/scripts/promote_unreleased.py \
  --changelog CHANGELOG.md \
  --version "$NEXT_VERSION" \
  --date "$(date -u +%Y-%m-%d)"
```

This script:
1. Moves the current `[Unreleased]` body under a new `## [{version}] - {date}` section.
2. Leaves a fresh empty `## [Unreleased]` at the top.
3. Preserves Keep-a-Changelog category ordering (`Added` → `Changed` → `Deprecated` → `Removed` → `Fixed` → `Security`).

### Step 4 — Commit the release prep on develop

```bash
git add CHANGELOG.md
git commit -m "chore(release): ${NEXT_VERSION}"
git push origin develop
```

NO `Co-Authored-By` trailer (per `hooks/validate-command.sh`). NO `--amend`. The commit is plain and signed by user policy.

### Step 5 — Open the release PR

```bash
RELEASE_NOTES=$(python3 skills/release/scripts/render_release_notes.py \
  --changelog CHANGELOG.md \
  --version "$NEXT_VERSION")

gh pr create \
  --base main \
  --head develop \
  --title "release: ${NEXT_VERSION}" \
  --body "$RELEASE_NOTES"
```

PR URL is captured; reported back to the user. The chain now pauses at the human-approval gate (verdict `PR_OPEN_AWAITING_APPROVAL`).

### Step 6 — Wait for human approval (the only manual gate)

The skill does NOT auto-merge. The user reviews + approves + merges the PR through GitHub UI / `gh pr merge` of their choice.

When the user resumes by re-invoking `/release --resume {pr-number}` (or by running `/release` again with the same `develop`/`main` state), the skill:

```bash
# Detect merge state
MERGE_STATE=$(gh pr view "$PR_NUMBER" --json state,mergedAt --jq '.state')
[ "$MERGE_STATE" = "MERGED" ] || { echo "PR not merged yet — re-run after merge." ; exit 0 ; }
```

If the PR was closed without merge → emit `BLOCKED` and record the rationale in the release log.

### Step 7 — Tag the merge commit + publish GitHub release

```bash
# Fetch the merge commit
git fetch origin main
MERGE_SHA=$(gh pr view "$PR_NUMBER" --json mergeCommit --jq '.mergeCommit.oid')

# Annotated tag pointing at the merge commit
git tag -a "v${NEXT_VERSION}" "$MERGE_SHA" -m "Release v${NEXT_VERSION}"
git push origin "v${NEXT_VERSION}"

# Publish GitHub release with the rendered notes
gh release create "v${NEXT_VERSION}" \
  --title "v${NEXT_VERSION}" \
  --notes "$RELEASE_NOTES" \
  --target "$MERGE_SHA"
```

### Step 7.5 — Flip ROADMAP.md milestone checkbox (post-merge)

Closes the `cycle-roadmap` super-loop. Runs after the tag + GitHub release are published.

```bash
# Extract the plan slug from the release context (passed from /auto-plan, or derived from the source review)
PLAN_FILE="knowledge-base/plans/${SLUG}-plan.md"

# Read milestone_id from the plan frontmatter
MILESTONE_ID=$(python3 -c "
import sys, yaml
with open('$PLAN_FILE') as f:
    raw = f.read()
parts = raw.split('---', 2)
if len(parts) >= 3:
    meta = yaml.safe_load(parts[1])
    print(meta.get('milestone_id', ''))
")

if [ -z "$MILESTONE_ID" ]; then
  echo "WARN roadmap-checkbox: plan has no milestone_id — skipping flip (ad-hoc release)"
else
  python3 skills/release/scripts/flip_milestone_checkbox.py \
    --roadmap ROADMAP.md \
    --milestone-id "$MILESTONE_ID" \
    --version "$NEXT_VERSION" \
    --plan "$PLAN_FILE" \
    --release-log "knowledge-base/releases/v${NEXT_VERSION}-release.md"
fi
```

`flip_milestone_checkbox.py` MUST:

1. Locate the literal header `## ${MILESTONE_ID} — [ ] <name>` in `ROADMAP.md`. If not found, emit `WARN roadmap-checkbox: $MILESTONE_ID not found in ROADMAP.md — skipping flip` and exit 0.
2. If header is already `[x]`, emit `INFO roadmap-checkbox: $MILESTONE_ID already [x] — no-op` and exit 0 (idempotent).
3. Replace `[ ]` → `[x]` in-place. NEVER use fuzzy matching.
4. Commit on `develop` (NOT `main`): `chore(roadmap): mark $MILESTONE_ID done (v$NEXT_VERSION)`.
5. Append to `knowledge-base/roadmap-runs/${MILESTONE_ID}-$(date -I).md`: `status: completed`, `checkbox_flipped_at`, `flip_commit_sha`, link to release log. Create the file if it does not exist.

Per `cycle-release § Single-flip invariant`, at most ONE checkbox flips per release. The script verifies its own diff before committing — if more than one `[ ]` → `[x]` transition would result, it aborts.

### Step 8 — Record the release

Write `knowledge-base/releases/v${NEXT_VERSION}-release.md`:

```markdown
# Release v{NEXT_VERSION}

**Date:** {YYYY-MM-DD}
**Verdict:** RELEASED
**Source review:** {path to /review report}
**PR:** {pr-url}
**Merge commit:** {merge-sha}
**Tag:** v{NEXT_VERSION}
**GitHub release:** {release-url}

## Release notes

{rendered notes}
```

### Step 9 — Recommend next step

```
=== /release complete ===
Version: v{NEXT_VERSION}
PR: {url}
Merge commit: {sha}
Tag: v{NEXT_VERSION}
GitHub release: {url}

Next: nothing — release is published. Start a new cycle with /to-plan or /grill-me.
```

## Hard gates (cannot proceed)

1. **`/review` verdict is not `READY_TO_MERGE`** → refuse. Re-run `/review` first.
2. **PR approval mandatory** — the skill NEVER auto-merges the release PR. Auto-merge violates Unbreakable Rule 4.
3. **Tag must be annotated** (`git tag -a`) — never lightweight tags.
4. **CHANGELOG [Unreleased] non-empty** — empty releases are forbidden.
5. **No duplicate version tags** — if `v{X}` already exists, halt.
6. **Single-flip invariant** — Step 7.5 flips at most ONE checkbox per release. Multi-milestone flips abort the script.

## Soft gates (proceed with note)

1. **CI not green on develop** — warn but proceed; the human catches it at PR approval.
2. **Bump-level ambiguous from CHANGELOG** — AskUserQuestion ONCE per release run.

## Anti-patterns

1. **Auto-merging the release PR** — never. Unbreakable Rule 4.
2. **Skipping `cycle-review`** — every release traces to a `READY_TO_MERGE` audit.
3. **Editing CHANGELOG entries during the release** — discipline lives in the cycles that produce the entries.
4. **Cutting a release with unaddressed FAIL_HARD from `/code-quality`** — the review gate enforces this; never bypass.
5. **`git push --force` on a release tag** — tags are immutable once published; if wrong, deprecate and cut a new version.
6. **Co-Authored-By trailer on the `chore(release)` commit** — blocked by `hooks/validate-command.sh`.
7. **Fuzzy-matching the milestone for the checkbox flip in Step 7.5.** Plan declares `milestone_id: M3` → flip M3 by literal header match, never M4.
8. **Flipping multiple checkboxes from one release.** Each release maps to one milestone via plan `milestone_id`.
9. **Blocking the release if `milestone_id` is missing.** Ad-hoc / hotfix work skips the flip with WARN — never blocks.

## Cycle contract

This skill is `phase 1` (only phase) of `cycle-release`. The cycle rule SoT is `rules/cycle-release.md`. Hard gates + soft gates + anti-patterns live there.

## Related

- Cycle rule (SoT): [`rules/cycle-release.md`](../../rules/cycle-release.md)
- Upstream cycle: [`rules/cycle-review.md`](../../rules/cycle-review.md) — consumes `READY_TO_MERGE` verdict
- Conventions: [`rules/public-copy.md`](../../rules/public-copy.md) — release notes lint
- Hooks enforced: `hooks/validate-command.sh` (git safety + Co-Authored-By block), `hooks/stop-validation.sh` (CHANGELOG hard gate)
- Scripts: `scripts/compute_next_version.py`, `scripts/promote_unreleased.py`, `scripts/render_release_notes.py`, `scripts/changelog_section_nonempty.py`, `scripts/flip_milestone_checkbox.py` (Step 7.5 — pending implementation, see Task #20)
- Macro super-loop: [`rules/cycle-roadmap.md`](../../rules/cycle-roadmap.md) — defines the single-flip invariant + the roadmap-runs file contract that Step 7.5 satisfies
