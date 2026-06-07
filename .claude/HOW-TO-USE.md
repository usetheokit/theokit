# How to use this planning ecosystem

A stack-agnostic, domain-agnostic pipeline for taking a feature from **idea → discovery → plan → code → merge**, with Claude Code as the active agent at every cycle. Each cycle has hard gates, anti-patterns, rollback, and an audit trail documented in `rules/cycle-*.md`.

```
DISCOVER → PLAN → IMPLEMENT → CODE-QUALITY → REVIEW → RELEASE
   ↓         ↓        ↓             ↓            ↓        ↓
(knowledge  (plans/) (commits +   (dead-code/  (gate    (develop→main
 -base/    →         tests)      fabrication/  tighter)  PR + semver
 discoveries/)                    wiring)               tag)
```

Each arrow is an **unbreakable chain** — you don't skip a cycle, you don't advance past an INVALID verdict.

## Which cycle, when

| Question | Cycle | Entry point |
|---|---|---|
| "How does <project X> handle <Y>?" | `cycle-discover` | `/discover-plan {topic-slug}` |
| "I want to do X but haven't articulated requirements yet" | `cycle-plan` Phase 0 | `/grill-me {topic-slug}` |
| "Let's design feature Y" | `cycle-plan` | `/to-plan` |
| "Build the feature per the plan" | `cycle-implement` | `/implement {plan-slug}` |
| "Audit dead code + fabricated APIs post-implement" | `cycle-code-quality` | `/code-quality` |
| "Review before merge" | `cycle-review` | `/review {plan-slug}` |
| "Cut a release (develop → main + tag)" | `cycle-release` | `/release [bump-level]` |
| "Just locate something in the code" | (no cycle) | Glob/Grep directly OR `/ast-grep` for structural queries |
| "Confidence assessment + end-to-end autonomous chain" | `cycle-auto-plan` | `/auto-plan {topic-slug}` |

## Quick start

### 1. Investigate underlying technology

Before writing code, investigate prior art:

```
/discover-plan {topic-slug}
  → produces knowledge-base/discoveries/plans/{slug}-plan.md
/discover-edge-cases {slug}
  → MUST-FIX absorbed into the plan
/discover-plan-confidence {slug}
  → plan-gate: structural score of the discovery plan itself; INVALID returns to /discover-plan
/discover-execute {slug}
  → halt-loop investigates (sources per rules/discover-web-allowlist.txt and clones in knowledge-base/references/)
/discover-confidence {slug}
  → blueprint score; if ≥ SHIPPABLE_WITH_CAVEATS:
/discover-improve {slug}        [optional — only if score is NEEDS_REVISION]
/skill-writer {slug}
/skill-validator {slug}
/skill-register {slug}
  → first-class skill consumed by /to-plan in future plans
```

### 2. Plan a feature

Optional Phase 0 — when requirements are vague:

```
/grill-me {topic-slug}
  → interview-driven requirements resolution (one question at a time, codebase-first)
  → produces knowledge-base/grills/{slug}-grill.md with verdict
  → READY_FOR_PLAN → proceed to /to-plan; NEEDS_SPLIT → split topic; NEEDS_DISCOVERY → run /discover-plan first
```

Then the plan chain:

```
/to-plan "{one-sentence feature description}"
  → Step 0 reads rules/ AND skills/*-patterns/ (auto-discovery)
  → produces knowledge-base/plans/{slug}-plan.md
/edge-case-plan {slug}
  → MUST-FIX absorbed
/deps-audit {slug}
  → audits dependencies + CVEs before the plan advances
/plan-confidence {slug}
  → score; if low:
/plan-improve {slug}
/plan-confidence {slug}  [re-score]
  → if ≥ SHIPPABLE_WITH_CAVEATS: plan ready for /implement
```

### 3. Implement

```
git switch -c feature/my-feature   # or stay on develop (Unbreakable Rule 4)
/implement {plan-slug}
  → halt-loop task by task: RED → GREEN → REFACTOR → WIRING → COMMIT
  → wiring triad enforced: caller + integration test + runtime metric
  → produces commits + knowledge-base/implementations/{slug}-implementation.md
  → final validation: tests + linters + coverage + wiring summary
```

### 4. Review before merge

```
/code-quality {plan-slug}              # MANDATORY before /review (cycle-code-quality)
  → audits dead code / fabricated symbols / wiring gaps
  → verdict: PASS / PASS_WITH_CAVEATS / FAIL_SOFT / FAIL_HARD / INVALID
  → /review refuses to start if verdict is below PASS_WITH_CAVEATS

/review {plan-slug}
  → detect domain; spawn 5-7 specialist agents (architecture, tests, wiring, cross-validation, domain-specific)
  → run in parallel; consolidate findings by severity (BLOCKER / HIGH / MEDIUM / LOW / INFO)
  → re-validate quality gates with tighter thresholds
  → analyze edge-case coverage
  → verdict: READY_TO_MERGE / NEEDS_FIXES / NEEDS_DEEPER
  → produces knowledge-base/reviews/{slug}-review-{date}.md
  → audit trail in agents/review-{slug}-{date}/
```

### 5. Release (develop → main + semver tag)

```
/release [patch|minor|major]
  → derives next version (auto-bump from CHANGELOG sections when omitted)
  → rewrites [Unreleased] under [{version}] - {date}
  → commits "chore(release): {version}" on develop
  → opens PR develop → main with rendered release notes
  → pauses for human approval (the only manual gate — Unbreakable Rule 4)
  → on merge: creates annotated tag + gh release create
  → records run at knowledge-base/releases/v{version}-release.md
```

## Utility skills (outside the pipeline)

These skills don't belong to any cycle — invoke them ad-hoc when the task calls for it. They never block the pipeline; nothing else consumes their output.

| Skill | Use when | Output |
|---|---|---|
| `/ast-grep` | You need a code query Grep can't express: function signatures, class hierarchies, decorator + function pairs, call sites, type defs. Especially useful inside `knowledge-base/references/` during discovery. | Stdout |
| `/excalidraw` | The user wants a visual diagram (workflow, architecture, concept). Standalone or as input to `/marp-slide` and `/deck`. | `.excalidraw` JSON file |
| `/marp-slide` | The user wants slides only (no full deck with diagrams). | Self-contained `.md` + rendered `.html` + `.pptx` |
| `/deck` | The user wants a full presentation with visuals. Orchestrates `/marp-slide` + `/excalidraw`. | Full deck (HTML + PPTX + diagrams) |

## Commands (parallel utilities)

Commands live in `commands/` and are invoked by slash. They run alongside the cycle pipeline — none of them replaces a cycle.

| Command | What it does | When |
|---|---|---|
| `/plan-attest {slug}` | Computes SHA256 of the active plan file and stores it under `.attestations/{slug}.sha256`. Subsequent `userpromptsubmit-inject.sh` runs verify the live plan against this hash; mismatch blocks prompt injection. | Run after every intentional edit to a plan file. |
| `/plan-goal [extra-condition]` | Derives a goal condition from the active plan (Objective checkboxes + Goal metric + Global DoD) and invokes Claude Code's built-in `/goal`. | When you want `/goal`-driven termination tied to the plan file. |
| `/plan-loop [interval] [prompt]` | Runs a planning-aware tick on top of Claude Code's `/loop`. Default tick re-reads the active plan + recent progress and writes a progress entry. | When you want recurring cadence ("babysit my plan"); pairs with `/plan-goal` for termination. |

These commands are complementary to ralph-loop, not replacements. Skills like `/implement` still use ralph-loop by default; commands provide a lightweight alternative for users who prefer Claude Code's native `/goal` + `/loop` primitives.

## Where things live

```
.
├── settings.json                 Permissions + hook wiring
├── settings.local.json           Personal overrides (gitignored)
├── hooks/                        Defensive runtime hooks
├── rules/
│   ├── architecture.md           Layering, DIP, naming
│   ├── testing.md                TDD discipline, pyramid, pairing convention
│   ├── public-copy.md            Voice/tone for README, marketing
│   ├── cycle-discover.md         SoT for the discovery cycle
│   ├── cycle-plan.md             SoT for the planning cycle
│   ├── cycle-implement.md        SoT for the implementation cycle
│   ├── cycle-code-quality.md     SoT for the code-quality cycle
│   ├── cycle-review.md           SoT for the review cycle
│   ├── cycle-release.md          SoT for the release cycle
│   ├── cycle-auto-plan.md        SoT for the auto-orchestrator super-cycle
│   ├── code-quality-golden-rule.md      Locked contract for /code-quality severity rubric
│   ├── code-quality-thresholds.txt      Per-project threshold overrides for /code-quality
│   ├── code-quality-allowlist.txt       Allowlist exemptions with mandatory sunset
│   ├── discover-blueprint-golden-rule.md Locked contract for /discover-confidence hard caps
│   ├── audit-trail-rotation.md   When to archive/delete generated artifacts
│   ├── loop-engine-convention.md Skill vs. Agent vs. ralph-loop
│   ├── discover-web-allowlist.txt Authoritative domains for WebFetch
│   └── code-quality-languages.txt Languages enabled for /code-quality and post-edit-check
├── skills/                       Cycle entry-points + auxiliaries
├── knowledge-base/
│   ├── grills/                   /grill-me outputs (interview logs)
│   ├── plans/                    /to-plan outputs
│   ├── discoveries/
│   │   ├── plans/                /discover-plan outputs
│   │   └── blueprints/           /discover-execute outputs
│   ├── implementations/          /implement working contracts + summaries
│   ├── reviews/                  /plan-confidence, /discover-confidence, /review reports
│   ├── adrs/                     Long-term ADRs (MADR 3.0)
│   ├── audits/                   /deps-audit, /code-quality reports
│   └── references/               Read-only clones of reference projects
├── agents/                       Audit trail of /review and /implement runs
└── scripts/                      Utility scripts
```

## `knowledge-base/references/`

Read-only enforced by `hooks/boundary-check.sh` + `hooks/validate-command.sh`. Holds clones of **reference projects** for domain study.

**Bootstrap mechanism:** the hooks block mv/cp/rm/sed/tee/redirect into `references/` and `tools/` by default. To populate a new clone, create the marker file `.references-bootstrap` at the project root (with rationale inside), run the `git clone` / `mv`, delete the marker, and cite the source in `CHANGELOG.md` when it exists.

## The 4+1 cycle rules — single source of truth

Read the cycle rule BEFORE invoking a skill:

| Rule | Skills it governs | Read when |
|---|---|---|
| `cycle-discover.md` | discover-plan, discover-edge-cases, discover-plan-confidence, discover-execute, discover-confidence, discover-improve, skill-writer, skill-validator, skill-register | Investigating underlying technology or domain reference |
| `cycle-plan.md` | grill-me (opt. Phase 0), to-plan, edge-case-plan, deps-audit, plan-confidence, plan-improve | Designing a feature |
| `cycle-implement.md` | implement | Building the planned feature |
| `cycle-code-quality.md` | code-quality | Auditing dead code / fabricated symbols / wiring gaps post-implement |
| `cycle-review.md` | review | Reviewing before merge |
| `cycle-release.md` | release | Cutting a release after `/review` returned `READY_TO_MERGE` |
| `cycle-auto-plan.md` | auto-plan (orchestrator) | The topic is large and you want an autonomous chain |

Each cycle rule has: Purpose, Trigger conditions, Chain (unbreakable), Phase contracts, Hard gates, Stop conditions, Anti-patterns, Rollback.

## Unbreakable principles (apply everywhere)

From `/home/paulo/.claude/CLAUDE.md`. Apply in every cycle:

1. **95% confidence rule** — never proceed without 95%+ certainty; ask when unsure.
2. **Task completion gate** — finish the current task before starting a new one.
3. **Extreme honesty** — admit ignorance; expose risks; never invent state.
4. **Git rules** — NEVER `git checkout` / `git revert` / `git push --force` / `git reset --hard` / commit directly to `main`.
5. **TDD-first** — failing test before code; bug fix starts with a regression test.
6. **CHANGELOG discipline** — every change in `[Unreleased]`.
7. **Don't reinvent** — mature libraries exist; prefer composition over rewriting.

These rules are enforced by hooks (`hooks/`) and declarative gates in each cycle rule.

## Match the cycle to the shape of the work

Each cycle is heavyweight by design — they trade speed for evidence. Pick the lightest entry point that fits:

| Cycle | Best for | When NOT to use |
|---|---|---|
| `cycle-discover` (full chain) | Investigating prior art / unknown solutions | Question is text-shape (use Read + Grep) |
| `cycle-plan` (full chain) | Clear feature with known shape | Trivial change (single-line; write it) |
| `cycle-implement` (halt-loop) | Building per an approved plan | No plan (run cycle-plan first) |
| `cycle-review` (5-7 agents) | Pre-merge rigorous review | Tiny PR (use built-in `/review`) |
| `/auto-plan` (super-cycle) | Large, well-scoped topic warranting autonomy | Plan already exists (call `/implement` directly) |

The cheapest cycle is the one you don't run. Don't invoke a cycle for work that doesn't justify the rigor.

## Pre-conditions for new contributors

Before invoking any cycle skill, verify:

- [ ] `ralph-loop` plugin enabled (`jq '.enabledPlugins' ~/.claude/settings.json`) — REQUIRED by `/implement`, `/discover-execute`, `/plan-improve`. Without it, those skills refuse to start.
- [ ] Python 3.10+ (`python3 --version`)
- [ ] PyYAML installed (`python3 -c "import yaml"`)
- [ ] `ast-grep` installed for structural queries (`ast-grep --version`)
- [ ] Your project's language toolchain is set up (matches `rules/code-quality-languages.txt`)
- [ ] You've read at least `rules/cycle-{target}.md` and the entry-point's `SKILL.md`

### First-time setup notes

- **`.active_plan`** — optional pointer file at the project root with a single slug. When present, `hooks/userpromptsubmit-inject.sh` resolves THIS plan instead of falling back to the newest by mtime. Useful when multiple plans are in flight. See `.active_plan.example`.
- **`.attestations/`** — created on demand by `/plan-attest`. Do not commit (already excluded by hook behavior).
- **`rules/dogfood-golden-rule.md`** — template shipped; edit § 1 (anchor scenario) before invoking `/dogfood` for the first time.
- **`rules/code-quality-languages.txt`** — empty by default; uncomment the languages your project uses.
- **`rules/discover-web-allowlist.txt`** — empty by default; uncomment authoritative domains your `/discover-execute` needs to reach.

## Common questions

### "When to use /grill-me vs. jumping straight to /to-plan?"

- `/grill-me` if requirements are vague, the decision tree has multiple non-obvious branches, OR the user explicitly asks to be grilled. Output is a Q&A log that `/to-plan` consumes as primary context.
- Skip `/grill-me` if you already wrote a spec, the change is trivial (single-line), it's a pure refactor with no behavior change, or the decision tree has < 3 branches.

A previous run of `/to-plan` that produced a vague plan is a strong signal to re-start with `/grill-me`.

### "When to use /to-plan vs. /discover-plan?"

- `/to-plan` produces an **implementation plan** (what to build, how, in what order).
- `/discover-plan` produces a **discovery plan** (what to investigate in `references/` or on the web).

If you don't know how others solved the problem → `/discover-plan`. If you know the problem and need to plan implementation → `/to-plan`.

### "Can I skip /discover-edge-cases?"

No. The chain is unbreakable. Edge cases caught pre-implementation are 100× cheaper than those caught post-implementation.

### "What if /plan-confidence returns INVALID?"

INVALID = hard cap fired (Coverage Matrix < 100% OR fabricated citation). Return to `/to-plan` to fix structurally. Do NOT go to `/plan-improve` — improve doesn't fix hard caps.

### "How do I roll back a registered patterns skill?"

```bash
mv skills/{name}/ skills/generated/{name}/
# Optionally delete the audit at knowledge-base/reviews/skill-register-*.md
```

The skill goes back to staging. `/to-plan` stops discovering it via Step 0.

### "How do I adapt this to my specific stack and domain?"

The defaults in `rules/` are stack- and domain-agnostic. To specialize:

1. Add a project-specific section at the bottom of relevant rules (e.g., naming conventions, banned framings, internal component names).
2. Populate `rules/code-quality-languages.txt` with the languages you use.
3. Populate `rules/discover-web-allowlist.txt` with the authoritative sources for your domain.
4. Optionally create `rules/dogfood-golden-rule.md` if your project has an anchor scenario that drives go/no-go decisions.

## Maintenance notes

- Cycle rules are SoT. Changes to chain order, anti-patterns, or gates go in the cycle rule, not in SKILL.md.
- SKILL.md files keep only PHASE-SPECIFIC detail. Generic content found there should move to the cycle rule.
- Cross-reference validation: `python3 scripts/check_xrefs.py` (if present).
- Audit trail rotation: see `rules/audit-trail-rotation.md`.

## Where to ask for help

- Global Claude Code conventions: `/home/paulo/.claude/CLAUDE.md`
- Specific cycle: `rules/cycle-{name}.md`
- Specific skill: `skills/{name}/SKILL.md`
