---
name: roadmap-feature
description: 'Add a new feature to an existing ROADMAP.md as the next M<N+1> milestone — without renumbering anything that came before. Reads the existing roadmap, detects the next free milestone ID, runs a 4-question focused grill (why now / dependencies / DoD / risks), cross-checks against the existing "Explicitly out of scope" section, optionally clones additional SOTA references when the feature needs peers not already covered, and appends one new `## M<N+1> — [ ]` block to ROADMAP.md plus a `[Unreleased] § Added` entry to CHANGELOG.md. Sister skill of /roadmap-init — same isolation contract, opposite trigger (refuses if ROADMAP.md does NOT exist). Cap is open at M9, M10, M11… extend freely.'
user-invocable: true
allowed-tools: Read Glob Grep Bash Write Edit WebSearch WebFetch AskUserQuestion
argument-hint: "{feature-slug}"
---

# `/roadmap-feature` — Amend an existing roadmap with one new milestone

Take a one-line feature description for a system that ALREADY has a roadmap (e.g. *"add per-user rate limit to the AI Gateway"*) and append it as the next `M<N+1>` milestone in `ROADMAP.md`, with full DoD, dependencies, and risk capture — without touching any milestone that came before.

This skill is the sibling of `/roadmap-init`. Same isolation contract: not part of any cycle, never invoked mid-cycle, no other skill cites it. **Opposite pre-condition:** refuses if `ROADMAP.md` does NOT exist.

## When to invoke

Invoke `/roadmap-feature {feature-slug}` when ALL of:

- `ROADMAP.md` exists at the repo root (created previously by `/roadmap-init`).
- The user has a **new feature** that was NOT in the original roadmap and was NOT explicitly carved out as out-of-scope (or, if it was, the user is consciously revisiting that decision).
- The feature is small enough to be ONE milestone (one DoD, one release cut). For multi-milestone features, run this skill once per milestone OR re-scope the roadmap (`ROADMAP-v2.md`).
- The system is in **active development** — adding milestones to a deprecated project is busywork.

DO NOT invoke when:

- `ROADMAP.md` does not exist. (This skill refuses. Run `/roadmap-init` first.)
- The feature is a hotfix or one-line fix. Use `/auto-plan {topic-slug}` ad-hoc mode — it ships without touching the roadmap.
- The feature is a refactor with no user-visible change. Same: ad-hoc mode.
- The feature would require renaming, reordering, or renumbering existing milestones. Renumber-able roadmaps lose audit trail — cut a new roadmap version instead.
- Every milestone in the roadmap is already `[x]` AND no new strategic intent has been declared. The roadmap is exhausted — discuss V2 with stakeholders before adding milestones.

## Process

### Step 0 — Pre-flight (MANDATORY, fail-fast)

```bash
# 0.1  ROADMAP.md must exist (opposite of roadmap-init)
test -f ROADMAP.md || { echo "FATAL: ROADMAP.md missing — run /roadmap-init first"; exit 1; }

# 0.2  knowledge-base/grills must be writable (grill persistence)
mkdir -p knowledge-base/grills 2>/dev/null
test -w knowledge-base/grills || { echo "FATAL: knowledge-base/grills not writable"; exit 1; }

# 0.3  required tooling
git --version >/dev/null   || { echo "FATAL: git missing"; exit 1; }
gh --version >/dev/null    || { echo "WARN: gh CLI missing — license detection will fall back to WebFetch"; }
gh auth status >/dev/null 2>&1 || { echo "WARN: gh not authenticated — license-gate will rely on WebFetch only"; }

# 0.4  Parse ROADMAP.md must succeed
python3 -c "
import re, sys
content = open('ROADMAP.md').read()
ms = re.findall(r'^## (M\d+) — \[(.)\]', content, re.MULTILINE)
if not ms: sys.exit('FATAL: ROADMAP.md has no parseable milestones')
print('OK', len(ms), 'milestones found')
"

# 0.5  CHANGELOG.md must exist (Unbreakable Rule 6 — every roadmap change is logged)
test -f CHANGELOG.md || { echo "FATAL: CHANGELOG.md missing"; exit 1; }
```

If `ROADMAP.md` is missing: print `Project not initialized. Run /roadmap-init {project-slug} first.` and stop. If parse fails: surface the parse error so the human can fix the malformed roadmap before continuing.

### Step 1 — Resolve the feature slug

Take `{feature-slug}` as input. If no slug is passed, ask the user for a one-sentence description and derive a kebab-case slug (e.g. *"add per-user rate limit"* → `per-user-rate-limit`).

**Refuse if the slug collides with an existing milestone name** (case-insensitive substring match on milestone headers). Surface the colliding milestone and ask the user to either: (a) re-slug the feature, (b) work within the existing milestone via `/auto-plan`, or (c) cancel.

### Step 2 — Detect next milestone ID

Read `ROADMAP.md`, extract every `## M<N> — ...` header, take `max(N) + 1`. This is the new milestone's ID.

Print to user:

```
Existing milestones: M0 [x], M1 [x], M2 [x], M3 [ ], M4 [ ], M5 [ ], M6 [ ], M7 [ ], M8 [ ]
Next free ID:       M9
This feature will be added as M9.
```

No upper cap. The roadmap extends freely (M9, M10, M11…). If the roadmap is growing beyond ~15 milestones total, the skill prints an advisory: *"Roadmap has 15+ milestones. Consider cutting a ROADMAP-v2.md."* — advisory, not blocking.

### Step 3 — Out-of-scope cross-check (MANDATORY)

Read the `### Explicitly out of scope` section of `ROADMAP.md`. For each item, build a keyword set (1-3 significant nouns).

After Step 4 Q1 captures the feature description, run a keyword overlap check between the feature description and each out-of-scope item. If overlap exists, alert the user with `AskUserQuestion`:

```
Feature description matches out-of-scope item:

  "{out_of_scope_text}"

This item was explicitly declared off-limits when the roadmap was written. How to proceed?

  [ ] Remove from out-of-scope — the original decision is being revisited (skill edits ROADMAP.md)
  [ ] Continue anyway — overlap is coincidental, feature is something else (record the false-positive in grill log)
  [ ] Cancel — re-evaluate the feature before adding it
```

Persist the decision (`removed_from_out_of_scope: <text>` or `out_of_scope_overlap_false_positive: <text>`) in the grill log. If the user chose to remove, Step 6 will also strip the item from the `### Explicitly out of scope` section.

Keyword overlap is a heuristic, not a guarantee — false positives happen. The check exists to surface the question, not to decide. The human decides.

### Step 4 — Focused grill (4 questions, ONE per turn)

Same protocol as `/grill-me` and `/roadmap-init`: one question per turn, each with recommended answer + reasoning, persist after each answer.

| # | Question | Why it must be answered |
|---|---|---|
| 1 | What is this feature and why is it being added NOW (what changed)? | "Why now" surfaces urgency — schedule pressure vs strategic shift vs user request. Affects priority and risk tolerance. |
| 2 | Which existing milestone(s) must be `[x]` before this feature can start? | Without explicit deps, `cycle-roadmap` cannot schedule this milestone correctly. Default suggestion: the most recent `[x]` milestone — user overrides if more are required. |
| 3 | What is the verifiable Definition of Done (3-5 bullets)? | DoD is the contract for `cycle-release` to flip the checkbox. Vague DoD = milestone that never completes. |
| 4 | What are the top 2 NEW risks this feature introduces? | Existing risks already documented in the roadmap; this captures only what's new. Empty answer is suspicious — every non-trivial feature carries some risk. |

#### 4.X — Persistence after every answer (MANDATORY)

Append to `knowledge-base/grills/{feature-slug}-feature-grill.md` after each answered question. Same shape as `/roadmap-init`'s persistence protocol but with `generated_by: roadmap-feature`. On `status: completed` at Step 6 success; `status: aborted` if user stops early.

### Step 5 — SOTA delta (OPTIONAL)

```
knowledge-base/references/ currently has N peers (catalog: _catalog.md).
Does this feature need reference peers NOT already covered by the existing set?

  [ ] Yes — search and add (mini SOTA pass: 3-5 new candidates, license gate, clone)
  [ ] No — existing references are sufficient
```

If **No** → skip to Step 6.

If **Yes** → run a mini SOTA discovery (max 5 candidates, otherwise same protocol as `/roadmap-init` Step 3-4):

1. `WebSearch` queries built from the Step 4 Q1 answer.
2. Curate to 3-5; present table with reasoning.
3. License gate (warn on GPL/AGPL/BUSL/no-license).
4. Shallow clone (`--depth 1 --filter=blob:none`) into `knowledge-base/references/<peer-name>/`.
5. APPEND (do NOT replace) to `knowledge-base/references/_catalog.md` — new entries only, with `added_by: roadmap-feature` and `added_for_milestone: M<N+1>`.

NEVER touch existing entries in `_catalog.md`. NEVER delete a cloned peer.

### Step 6 — Amend ROADMAP.md (single edit, single commit)

This step makes ALL roadmap edits in ONE operation — no partial state on disk:

#### 6.1  Build the milestone block in-memory

Use `templates/feature-amendment-template.md`. Substitute placeholders from grill answers + `added_by`/`date` metadata. Run the same `{{`-free assertion as `/roadmap-init` Step 5.0 before writing.

#### 6.2  Locate insertion point in ROADMAP.md

Insert the new `## M<N+1> — [ ] <name>` block **immediately before** the `---` separator that precedes the `## State-of-the-art references` section. Pattern: find the last `### M<X>` block, walk to its closing `---`, insert after.

If the structural anchor (`## State-of-the-art references`) is missing or moved, ABORT — surface the malformed roadmap to the human. NEVER guess insertion point.

#### 6.3  If out-of-scope removal was approved (Step 3)

Strip the matched line from the `### Explicitly out of scope` section. Add a one-line note at the bottom of that section: `> Note: "{text}" was removed on YYYY-MM-DD when M<N+1> was added (see CHANGELOG).`

#### 6.4  If SOTA delta added new peers (Step 5)

Append rows to the `## State-of-the-art references` table at the bottom of the roadmap, with `Supports milestone(s)` column referencing `M<N+1>`.

#### 6.5  Update CHANGELOG.md `[Unreleased] § Added`

Append:

```markdown
- Roadmap amended: added M<N+1> {name} (`/roadmap-feature {slug}`)
```

If the user removed an item from out-of-scope, also append to `[Unreleased] § Changed`:

```markdown
- Roadmap "out of scope" amended: removed "{text}" (now in scope as M<N+1>)
```

#### 6.6  Single git commit (optional — only if working tree was clean before this run)

If `git status --porcelain` was empty before Step 0 ran, this skill stages and commits the two files in one atomic commit:

```bash
git add ROADMAP.md CHANGELOG.md
git commit -m "chore(roadmap): add M<N+1> {name}"
```

If the working tree had pending changes, SKIP the commit and tell the user: `Files modified: ROADMAP.md, CHANGELOG.md. Tree was dirty — please commit manually.`

### Step 7 — Final report

```
ROADMAP_FEATURE_COMPLETE

slug              : {feature-slug}
new_milestone_id  : M<N+1>
name              : {derived from grill}
dependencies      : {list}
peers_added       : K  (catalog updated, no existing entries touched)
out_of_scope_removed : "{text}" | none
files_modified    : ROADMAP.md, CHANGELOG.md
commit            : <sha> | not-committed (tree was dirty)
grill_log         : knowledge-base/grills/{feature-slug}-feature-grill.md

Next steps (your call — this skill is intentionally not chained):
  - Review the diff before committing if you skipped auto-commit
  - When dependencies are [x], run /auto-plan M<N+1> to deliver it
```

Do NOT auto-invoke any downstream skill.

## Anti-patterns

1. **Renumbering existing milestones.** NEVER. M3 stays M3 forever. Renumbering breaks every plan, run-file, and audit trail that references the old ID. New features go to the end.
2. **Reordering existing milestones.** NEVER. Dependency declarations assume the existing order. Inserting M3.5 between M3 and M4 corrupts every downstream reference.
3. **Editing a `[x]` milestone's body.** Completed milestones are immutable. To "extend" a completed milestone, add a new milestone that depends on it.
4. **Skipping the out-of-scope cross-check.** A feature that contradicts a documented "out of scope" item is a strategic shift — the human MUST explicitly acknowledge it.
5. **Adding a feature without DoD.** No DoD → `cycle-release` cannot flip the checkbox. The milestone will never complete.
6. **Adding a feature without dependencies.** No deps → `cycle-roadmap` cannot schedule. Default to "most recent `[x]` milestone" rather than leaving empty.
7. **Touching existing entries in `_catalog.md` or replacing cloned peers.** SOTA delta is additive only — references are immutable from the moment they enter the catalog.
8. **Skipping CHANGELOG update.** Every roadmap amendment is a project-visible decision and MUST be in `[Unreleased]` per Unbreakable Rule 6.
9. **Guessing the insertion point in ROADMAP.md.** If the structural anchor (`## State-of-the-art references`) is missing, ABORT — never insert in an arbitrary location.
10. **Auto-committing a dirty tree.** If the user had pending changes, the skill MUST NOT bundle them into the roadmap commit. Atomic commits or no commit at all.
11. **Running this skill on a deprecated project.** A roadmap that nobody works on does not benefit from amendments. Talk to stakeholders first.

## What this skill does NOT do

- It does NOT plan how to build the feature — that is `/auto-plan M<N+1>` invoking the standard cycle chain.
- It does NOT decompose the feature into tasks — that is `/to-plan`.
- It does NOT validate technical feasibility — that is `/edge-case-plan` + `/plan-confidence`.
- It does NOT update the roadmap's vision, problem statement, users, constraints, or north-star metric. Those are macro decisions; if they change, write `ROADMAP-v2.md`.
- It does NOT cancel existing milestones. Cancellation is a manual edit (`~~M3 — [-] {name} (cancelled YYYY-MM-DD — reason)~~`) per the roadmap-template's revision protocol.
- It does NOT renumber, reorder, or remove existing milestones. Ever.

## Related

This skill is intentionally **standalone** — it is not part of any cycle and is invoked ad-hoc when a new feature needs to land in the roadmap. Sister of `/roadmap-init`:

| Skill | Pre-condition | Effect |
|---|---|---|
| `/roadmap-init` | `ROADMAP.md` does NOT exist | Creates `ROADMAP.md` from scratch + populates `knowledge-base/references/` |
| `/roadmap-feature` | `ROADMAP.md` DOES exist | Appends one milestone; optionally adds peers |

Both feed the macro super-loop:

- `ROADMAP.md` — read by [`cycle-roadmap`](../../rules/cycle-roadmap.md) to select the next eligible milestone; the milestone added by this skill becomes selectable as soon as its declared dependencies are `[x]`.
- `knowledge-base/references/` — incrementally extended by Step 5 SOTA delta; consumed by `/discover-plan` during downstream cycles.

The 95%-confidence principle (`/home/paulo/.claude/CLAUDE.md § 1`) applies: the 4-question focused grill exists so milestones added mid-project are as rigorous as those written at inception.
