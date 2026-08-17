---
name: roadmap-init
version: 0.1.0
requires: []
description: Bootstrap a new project from a one-line idea into a macro ROADMAP.md + a curated set of SOTA reference repositories cloned under knowledge-base/references/. Runs a 7-question Socratic interview (problem → users → in-scope → out-of-scope → constraints → success criterion → north-star metric), then researches state-of-the-art peers via web search, gates them by license (warns on GPL/AGPL/BUSL/no-license), clones the approved ones with shallow blob-filter clones, and writes ROADMAP.md (M0-M8 cap, checkbox per milestone) at the repo root. Use ONLY at project inception, BEFORE any /grill-me, /discover-plan, /to-plan or /implement work. REFUSES to run if ROADMAP.md already exists.
user-invocable: true
allowed-tools: Read Glob Grep Bash Write WebSearch WebFetch AskUserQuestion
argument-hint: "{topic-slug}"
---

# `/roadmap-init` — Bootstrap a project with macro ROADMAP + SOTA references

Take a one-line idea (e.g. *"build an internal AI Gateway like Vercel's"*) and produce two things, in one session:

1. **`ROADMAP.md`** at the repo root — macro vision, scope (in/out), constraints, north-star metric, and M0-M8 milestones with checkbox status.
2. **`knowledge-base/references/`** populated with shallow-cloned SOTA peer repositories that subsequent cycles (`/discover-plan`, `/to-plan`, downstream review tools) will consult.

This skill is **intentionally isolated**: it is not part of any `cycle-*.md`, no other skill cites it, and it is invoked exactly once at project inception. Its outputs become passive input for the rest of the pipeline.

## When to invoke

Invoke `/roadmap-init {topic-slug}` when ALL of:

- The repo is at **project inception** — there is no `ROADMAP.md` at root and `knowledge-base/references/` is empty (or only has unrelated peers).
- The user has a **one-line idea** but no scope document, no architecture decisions locked, and no chosen reference projects.
- The intent is to **build something new** (not maintain or extend an existing system — for new features in an existing system, use `/grill-me` → `/to-plan` directly).

DO NOT invoke when:

- `ROADMAP.md` already exists at root. (This skill refuses.)
- The user wants to add a feature to an existing roadmap. (Use `/grill-me` → `/to-plan`.)
- The scope is already locked in a spec or RFC. (Skip ahead to `/discover-plan` or `/to-plan`.)
- The user only wants to study one specific reference. (Use `/discover-plan` directly.)

## Process

### Step 0 — Pre-flight (MANDATORY, fail-fast)

Verify in order. If ANY check fails, stop and report:

```bash
# 0.1  ROADMAP.md must not exist
test -f ROADMAP.md && echo "FATAL: ROADMAP.md already exists — refuse" && exit 1

# 0.2  knowledge-base/references must exist and be writable
test -d knowledge-base/references || { echo "FATAL: knowledge-base/references missing"; exit 1; }
test -w knowledge-base/references || { echo "FATAL: knowledge-base/references not writable"; exit 1; }

# 0.3  required tooling
git --version >/dev/null   || { echo "FATAL: git missing"; exit 1; }
gh --version >/dev/null    || { echo "WARN: gh CLI missing — license detection will fall back to WebFetch"; }
gh auth status >/dev/null 2>&1 || { echo "WARN: gh not authenticated — license-gate will rely on WebFetch only"; }

# 0.4  grill persistence target writable
mkdir -p knowledge-base/grills 2>/dev/null
test -w knowledge-base/grills || { echo "FATAL: knowledge-base/grills not writable — cannot persist grill answers"; exit 1; }
```

If `ROADMAP.md` exists: print "Project already initialized. Use `/grill-me {feature}` for new features." and stop.

### Step 1 — Resolve the topic

Take `{topic-slug}` as input. If no slug is passed, ask the user for a one-sentence description of what they want to build, then derive a kebab-case slug (e.g. *"build an AI gateway like Vercel"* → `ai-gateway-vercel-like`).

Record the slug; it tags every artifact written by this skill.

### Step 2 — Socratic interview (7 questions, ONE per turn)

Apply the same protocol as `/grill-me`: **one question per turn**, each question carries a **recommended answer + reasoning**, wait for confirmation/override before advancing.

Ask the questions in this exact order — each later question depends on earlier answers:

| # | Question | Why it must be answered now |
|---|---|---|
| 1 | What is the **root problem** this project solves, and for whom does it hurt today? | Without a sharp problem statement, every later milestone is arbitrary. |
| 2 | Who are the **primary users** (role, internal vs external, single team vs many)? | Defines the surface area and the boundary of "done". |
| 3 | What is **in scope** for V1 (must-have to call this project alive)? | Anchors M0 (walking skeleton) and the early milestones. |
| 4 | What is **explicitly out of scope** (tempting but not for this project)? | Out-of-scope decisions are more valuable than in-scope ones — they prevent feature creep. |
| 5 | What are the **hard constraints** (stack, compliance, deadline, team size, runtime targets)? | These bound the solution space; design choices that violate them are dead-on-arrival. |
| 6 | What is the **measurable success criterion** for V1 ship (a number, a behavior, a benchmark)? | Roadmap without a target line is a wish list. |
| 7 | What is the **north-star metric** that, when it moves, the team knows the project is winning? | Differs from #6 — #6 is "shipped", #7 is "winning". |

Question template:

```
**Question N/7**: <one specific question>

**Recommended answer**: <best guess + 2-3 lines of reasoning>

(awaiting your confirmation, override, or refinement)
```

#### 2.X — Persist after every answer (MANDATORY)

After EACH answered question — before asking the next one — append to `knowledge-base/grills/{slug}-roadmap-grill.md`. The grill file is the source of truth for Step 5; if the session crashes, the next invocation can resume from where it stopped.

On the FIRST answer of the session, create the file with this header:

```yaml
---
slug: {{SLUG}}
date: YYYY-MM-DD
generated_by: roadmap-init
questions_answered: 0
unresolved_dims: []
status: in_progress
---

# Roadmap grill: {{SLUG}}

```

After every answer, append the Q&A block AND update the frontmatter counters in-place:

```markdown
### Q{N}/7: <dimension label>

**Question:** <verbatim question asked>

**Recommended:** <recommendation given to user>

**User answer:** <captured answer>
```

Set frontmatter `status: completed` only after Step 5 finishes successfully. Set `status: aborted` if the user stops early — and list unanswered dimensions in `unresolved_dims:`.

**Resumability:** at Step 1, if `knowledge-base/grills/{slug}-roadmap-grill.md` exists with `status: in_progress`, offer to resume from the last answered question instead of starting over.

Stop early ONLY if the user explicitly says "enough, write the roadmap" — but record which of the 7 dimensions remained unanswered (those become explicit `TBD` blocks in `ROADMAP.md`).

### Step 3 — SOTA discovery

Now the problem is sharp. Find state-of-the-art peers.

#### 3.1  Search

Run a `WebSearch` for the problem space. Build queries from the user's answers — NOT from the slug. Example for AI Gateway: `"open source AI gateway LLM proxy"`, `"LLM observability proxy"`, `"AI model router production"`.

Collect 8-12 candidate projects. For each, capture:

- Name
- GitHub URL (or other source repo)
- One-line description (from README)
- License (best-effort from GitHub API via `gh api repos/{owner}/{repo} --jq .license.spdx_id` — fallback to WebFetch on the repo page)
- Last release / last commit date
- Star/fork count (signal of adoption, NOT of quality)
- Why it is relevant to THIS user's problem (from the 7 grill answers)

#### 3.2  Curate to 5-8

Present the curated shortlist to the user as a table with **why each one is here** and **what to study in it**. The user approves, removes, or adds candidates. NEVER clone more than 8 — references that nobody reads are pure noise.

```
| Peer            | License    | Last release | Why it's here                          | What to study                                |
|-----------------|------------|--------------|----------------------------------------|----------------------------------------------|
| LiteLLM         | MIT        | 2026-05-30   | Multi-provider routing, your main use  | Provider abstraction, fallback chains        |
| Portkey Gateway | MIT        | 2026-05-12   | Production observability for LLM calls | Tracing, caching, retry strategy             |
| ...             | ...        | ...          | ...                                    | ...                                          |
```

### Step 4 — License gate + clone

For each approved peer:

#### 4.1  License gate

If license is `GPL-*`, `AGPL-*`, `BUSL-*`, `SSPL-*`, `null`, or unidentifiable → ALERT the user with `AskUserQuestion`:

```
Peer "{name}" has license "{spdx}". Cloning is fine for study, but copying code into
your codebase may be legally restricted.

[ ] Clone anyway (study-only intent acknowledged)
[ ] Skip this peer
```

Record the user's intent flag in `_catalog.md` (see Step 5).

#### 4.2  Clone

Shallow + blob-filter to keep disk usage low and clone time short:

```bash
git clone --depth 1 --filter=blob:none <repo-url> knowledge-base/references/<peer-name>/
```

Use the peer's lower-case kebab-case name (e.g. `litellm`, `portkey-gateway`).

#### 4.3  Maintain a clone ledger (MANDATORY)

Track every peer in an in-memory ledger with one of three lifecycle values. This ledger is the contract between Step 4 and Step 5 — Step 5 reads `lifecycle` to decide which file each peer appears in.

| `lifecycle` | When assigned | Where it appears in Step 5 |
|---|---|---|
| `cloned` | `git clone` exit code 0 AND folder exists under `knowledge-base/references/` | ROADMAP.md "References" table **and** `_catalog.md` main section |
| `skipped` | Rejected at license gate (Step 4.1, user chose "skip") | `_catalog.md` "Skipped peers" table only — NEVER in ROADMAP.md |
| `clone_failed` | License gate passed but `git clone` returned non-zero | `_catalog.md` "Skipped peers" table with `reason="clone_failed: <stderr summary>"` — NEVER in ROADMAP.md |

If a clone fails (network, auth, deleted repo) → mark `clone_failed` in the ledger and continue with the others. Do NOT abort the whole skill on one failed clone. Do NOT silently include a `clone_failed` peer in the ROADMAP.md References table.

Before Step 5 starts, verify the ledger invariant: every `cloned` entry MUST correspond to an existing folder under `knowledge-base/references/`. If verification fails (folder missing despite `lifecycle=cloned`), downgrade to `clone_failed` with reason `clone_succeeded_but_folder_missing` and re-check.

### Step 5 — Write artifacts

Write two files. NEVER write either of them before Step 4 finishes — partial roadmaps are worse than no roadmap.

#### 5.0  Placeholder substitution protocol (MANDATORY)

The templates under `templates/` use `{{PLACEHOLDER}}` Mustache-style markers. They are NOT consumed by any external template engine — substitution is done in-memory by this skill before the single `Write` call.

Protocol:

1. **Read** `templates/roadmap-template.md` into a string variable.
2. **Build a substitution map** in memory from: (a) grill answers persisted in `knowledge-base/grills/{slug}-roadmap-grill.md`, (b) the Step 4.3 clone ledger, (c) static values (date, slug, generator name). Every key in the map MUST correspond to a placeholder in the template.
3. **Substitute every `{{KEY}}`** with its mapped value. If a grill dimension was left unanswered (user stopped early), replace its placeholders with `TBD — resolve before starting <affected-milestone>` rather than leaving `{{...}}` raw.
4. **Assertion before Write:** scan the final string for the literal substring `{{`. If found, ABORT — do not call Write. Print which placeholders remained and stop the skill with status `incomplete`. Same protocol for `_catalog.md`.
5. **Then** call `Write` once per file. Never call `Write` with a partially-substituted template.

The same protocol applies to `_catalog.md`. Build its substitution map from the clone ledger, not from the grill.

This is the single most common failure mode for template-driven skills: shipping a file with `{{V1_SHIP_CRITERION}}` literally in it because one branch of the code forgot to fill it. The assertion catches it deterministically.

#### 5.1  `ROADMAP.md` (project root)

Use `templates/roadmap-template.md`. Fill ALL placeholders from the grill answers (Step 2) and the curated peer list (Step 3). Apply these rules:

- **M0 is always a walking-skeleton milestone** — end-to-end thinnest slice that proves the architecture (one provider, one endpoint, one consumer). Borrowed from this project's own `cycle-implement` doctrine.
- **At most 9 milestones (M0-M8).** If 7 grill answers imply more than 9, the scope is too large — split the project, do not inflate the roadmap. State this explicitly to the user before writing.
- **Each milestone has:** objective (1 sentence), definition of done (3-5 verifiable bullets), dependencies on prior milestones, top 2 risks.
- **Checkbox in header:** `## M0 — [ ] Walking skeleton`. The user flips to `[x]` as work lands.
- **References section at the bottom** maps each peer to the milestones that will draw from it. **Include ONLY peers with `lifecycle=cloned` from the Step 4.3 ledger.** Peers with `lifecycle=skipped` or `lifecycle=clone_failed` MUST NOT appear here — they exist only in `_catalog.md`.

#### 5.2  `knowledge-base/references/_catalog.md`

Use `templates/references-catalog-template.md`. Two sections, sourced directly from the Step 4.3 ledger:

- **Main section:** one entry per peer with `lifecycle=cloned`. Includes repo URL, license, license-gate decision (`clone-anyway-study-only` or `auto-approved-permissive`), last release date, motivation, what to study, which `ROADMAP.md` milestone(s) it supports.
- **Skipped peers table:** every peer with `lifecycle=skipped` OR `lifecycle=clone_failed`. The `reason` column distinguishes them (`license: <spdx>` vs `clone_failed: <stderr>`). This makes the decision auditable and prevents re-attempting the same dead repos on the next project.

This catalog is the contract `/discover-plan` will read later — it must be machine-greppable.

### Step 6 — Final report

Print a single block to the user:

```
ROADMAP_INIT_COMPLETE

slug              : <slug>
roadmap_file      : ROADMAP.md
milestones        : N (M0-M{N-1})
peers_cloned      : K
peers_skipped     : J  (license gate)
catalog_file      : knowledge-base/references/_catalog.md
unresolved_dims   : <list any of the 7 grill dimensions left as TBD>

Next steps (your call — this skill is intentionally not chained):
  - Refine the roadmap by hand if the milestones feel off
  - Run /discover-plan <peer-name> to deep-dive into a reference
  - Run /grill-me <first-milestone> when you're ready to plan M0
```

Do NOT auto-invoke any downstream skill. The user decides what comes next.

## Anti-patterns

1. **Inflating milestones to look ambitious.** 12 milestones with vague objectives are worse than 5 sharp ones. Cap is 9. Above 9 → split the project.
2. **Vague definitions of done.** "M3: improve performance" is not a milestone — it is a wish. Every DoD bullet must be verifiable by an outside reader.
3. **Cloning peers the user did not approve.** WebSearch returns noise. The user MUST see the shortlist with reasoning before any `git clone` runs.
4. **Skipping the license gate.** AGPL/BUSL repos cloned without explicit acknowledgement become legal landmines if engineers copy code from them later.
5. **Writing `ROADMAP.md` mid-process.** Partial roadmaps get committed and never revisited. Write only after grill + curation + clones all finish.
6. **Adding cycle integration for the SKILL itself.** This SKILL is single-shot at project inception — it is intentionally absent from `cycle-plan.md`, `cycle-discover.md`, `cycle-auto-plan.md`. No other skill should invoke `/roadmap-init` mid-cycle. **However:** the ARTIFACTS this skill produces (`ROADMAP.md` and `knowledge-base/references/`) ARE consumed downstream — `cycle-roadmap` reads `ROADMAP.md` to pick milestones; `cycle-discover` reads `knowledge-base/references/`; `cycle-release` flips checkboxes in `ROADMAP.md`. That is by design. The line is: artifact references are fine, skill invocation references are forbidden.
7. **Auto-running `/discover-plan` or `/grill-me` after.** The user decides what to do with the roadmap. Suggesting next steps is fine; invoking them is not.
8. **Cloning with full history.** `--depth 1 --filter=blob:none` is mandatory. References are for reading, not for git archaeology.
9. **Running on an already-initialized project.** Step 0 must refuse if `ROADMAP.md` exists. Replacing a roadmap is a manual decision, not a skill flow.
10. **Writing files with unfilled `{{placeholders}}`.** Step 5.0 mandates an assertion scan for the literal `{{` before any `Write` call. A roadmap shipped with `{{V1_SHIP_CRITERION}}` in it is worse than no roadmap — it looks complete and rots silently.
11. **Listing failed-clone peers in the ROADMAP References table.** The Step 4.3 ledger is the gate: only `lifecycle=cloned` peers reach `ROADMAP.md`. Anything else corrupts the user's trust in the references list.
12. **Skipping grill persistence between questions.** Step 2.X must append after every answer. Holding 6 answers in conversation context and persisting only at the end means one crash erases the whole session.

## What this skill does NOT do

- It does NOT plan implementation — that is `/to-plan`'s job.
- It does NOT validate technical feasibility of milestones — that is `/edge-case-plan` + `/plan-confidence`.
- It does NOT explore a single reference deeply — that is `/discover-plan`.
- It does NOT track progress over time — checkboxes in `ROADMAP.md` are user-maintained; no automation.
- It does NOT manage features added later — that is `/grill-me` + `/to-plan` working from the existing roadmap as context.
- It does NOT update an existing `ROADMAP.md`. Roadmap revisions are manual.

## Related

This skill is intentionally **standalone** — it is not part of any cycle and is invoked exactly once per project. Its artifacts, however, feed the macro super-loop:

- `knowledge-base/references/` — read by `/discover-plan` when the user wants to investigate a peer.
- `ROADMAP.md` — read by [`cycle-roadmap`](../../rules/cycle-roadmap.md) to select the next eligible milestone; read by `/auto-plan M<N>` to derive a plan with `milestone_id` injected; edited by `cycle-release § Step 7.5` to flip `[ ]` → `[x]` post-merge.

The 95%-confidence principle (`/home/paulo/.claude/CLAUDE.md § 1`) applies: the 7-question interview exists so the roadmap is not written from vague intent.
