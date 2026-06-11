---
name: auto-plan
description: End-to-end autonomous orchestrator for cycle-discover + cycle-plan + cycle-implement + cycle-code-quality + cycle-review + cycle-release. Single entry-point chains the whole pipeline from idea to a release PR awaiting human approval. Default is full-pipeline; --plan-only retains the legacy discover+plan behavior. Depth (none/light/full) is derived deterministically from a confidence score against repo state — no interactive prompts. MUST-FIX items from /edge-case-plan are auto-injected into the plan before /plan-confidence re-scores. Inspired by planning-with-files v2.43.0 autonomy + composes Claude Code primitives (/plan-goal, /plan-loop) absorbed 2026-05-26.
user-invocable: true
allowed-tools: Read Write Edit Bash Glob Grep Skill
---

# `/auto-plan` — Autonomous cycle orchestrator (full pipeline)

End-to-end autonomous orchestration of the 6-cycle pipeline: `cycle-discover` → `cycle-plan` → `cycle-implement` → `cycle-code-quality` → `cycle-review` → `cycle-release`. Replaces the 9+ slash manual sequence with a single invocation that:

1. **Assesses confidence** deterministically against repo state (references, patterns skills, ADRs, CLAUDE.md, completed plans, user context).
2. **Derives depth** from the confidence band (no interactive prompts — overridable via CLI flag).
3. **Chains skills autonomously** through every cycle, gating each transition on the downstream cycle's pre-conditions.
4. **Auto-injects MUST-FIX items** from `/edge-case-plan` into the plan before `/plan-confidence` re-scores — eliminating the manual "human absorbs MUST FIX" step.
5. **Pauses ONLY at the human-approval gate** of the release PR (Unbreakable Rule 4).

## When to invoke

- User wants to take a feature from idea to release PR without invoking the pipeline cycles manually.
- User wants a confidence-checked plan-only mode for incremental work (`--plan-only`).
- User wants the discover phase auto-triggered when prior art is thin.

Do NOT invoke when:

- Plan already exists and just needs `/implement` — invoke `/implement` directly.
- Current branch is not `develop` — switch to `develop` first (`git switch develop`). `main` is release-only per Unbreakable Rule 4.
- Context is < 50 chars AND no related artifacts exist in repo — orchestrator will refuse (LOW confidence).

## Argument parsing

```
/auto-plan                                   # ROADMAP-DRIVEN: read ROADMAP.md, pick next eligible milestone
/auto-plan M<N>                              # ROADMAP-DRIVEN: target specific milestone (M0..M8)
/auto-plan {topic-slug}                      # AD-HOC: full pipeline with a free-form slug (no roadmap link)
/auto-plan {topic-slug} --plan-only          # legacy: stop after plan; user runs /implement manually
/auto-plan {topic-slug} --depth=none         # skip discover; depth is auto-derived from confidence band otherwise
/auto-plan {topic-slug} --depth=light
/auto-plan {topic-slug} --depth=full
/auto-plan {topic-slug} --no-release         # full pipeline but stop after /review; do not open release PR
/auto-plan {topic-slug} --bump=patch|minor|major  # forwarded to /release (otherwise auto-derived from CHANGELOG)
/auto-plan {topic-slug} --force-override     # bypass refusal even at LOW confidence
```

**Slug resolution order:**

1. If no arg AND `ROADMAP.md` exists → roadmap-driven mode: select next eligible milestone (see Step 0).
2. If arg matches `^M[0-8]$` AND `ROADMAP.md` exists → roadmap-driven mode targeting that milestone.
3. Otherwise → ad-hoc mode with the arg as free-form slug. Emit `INFO ad-hoc: no milestone_id will be persisted; release will skip checkbox flip`.

If no arg AND `ROADMAP.md` is MISSING → refuse with `BLOCKED roadmap-init-required: run /roadmap-init {project-slug} first, or invoke /auto-plan {topic-slug} for ad-hoc work`.

## Process

### Step 0 — Select milestone (roadmap-driven mode only)

Skip this step in ad-hoc mode.

```bash
# 0.1  Pick target milestone
if [ -z "$ARG" ] || [[ "$ARG" =~ ^M[0-8]$ ]]; then
  TARGET_MILESTONE=$(python3 skills/auto-plan/scripts/select_next_milestone.py \
    --roadmap ROADMAP.md \
    ${ARG:+--prefer "$ARG"} \
    --json)
fi
```

`select_next_milestone.py` returns one of:

- `{"milestone_id": "M<N>", "name": "...", "objective": "...", "dod": [...], "depends_on": ["M<K>", ...]}` — picked eligible milestone (lowest ID with all dependencies `[x]`).
- `{"verdict": "ROADMAP_COMPLETE"}` — every milestone is `[x]`. Refuse to start a new cycle; surface to human: "ROADMAP delivered. Declare V2 or stop."
- `{"verdict": "ROADMAP_BLOCKED", "wall": [...]}` — `[ ]` milestones remain but each one's dependencies are still `[ ]`. Surface the dependency wall.
- `{"verdict": "PREFER_NOT_ELIGIBLE", "reason": "..."}` — user passed `M<N>` but `M<N>` is not eligible (already `[x]` OR dependencies not satisfied). Refuse with the reason.

Outputs from this step feed Step 2 (derive depth) and Step 3 (chain execution): `slug` is derived from the milestone name (kebab-case), and the milestone metadata is written into the plan frontmatter in Phase P.

### Step 1 — Assess confidence (deterministic, ~0 LLM tokens)

Run:

```bash
python3 .claude/skills/auto-plan/scripts/assess_confidence.py {topic-slug} \
  --context-length={len(user_provided_context_in_chars)} --json
```

Parse JSON output. Note `score`, `verdict`, `recommended_depth`, `signals`.

### Step 2 — Derive depth deterministically (no interactive prompts)

Depth is now derived from the confidence band, NOT asked. Eliminates one `AskUserQuestion` per invocation and makes `/auto-plan` resumable from any context.

| Confidence band | Auto-derived depth | Note |
|---|---|---|
| `HIGH` (≥ 95) | `none` | Skip discover; user context is already 95% confident. |
| `MED-HIGH` (70-94) | `light` | 2-3 discover questions; ≤ 60min budget. |
| `MED-LOW` (30-69) | `full` | Standard discover-plan defaults (5-10 questions). Soft warning that cap may land at SHIPPABLE_WITH_CAVEATS. |
| `LOW` (< 30) | (refused) | **Refuse** with suggested next actions, UNLESS `--force-override` flag present. If forced, proceed with `full` + log "OVERRIDE: user proceeded against low-confidence recommendation" in the eventual plan's `## Accepted Risks` section. |

CLI `--depth=` flag overrides the auto-derivation. CLI `--plan-only` clamps mode to plan-only regardless of confidence.

The deterministic derivation removes the legacy `AskUserQuestion` step. If the user disagrees with the auto-derived depth, they re-invoke with `--depth=...`.

### Step 3 — Chain execution

Based on chosen depth + mode (full-pipeline OR `--plan-only`):

#### Phase D — Discover (only if `depth != none`)

```
Skill(/discover-plan {topic-slug})
Skill(/discover-edge-cases {topic-slug})
Skill(/discover-execute {topic-slug})       # ralph-loop halt-loop
Skill(/discover-confidence {topic-slug})
# If verdict < SHIPPABLE_WITH_CAVEATS:
Skill(/discover-improve {topic-slug})       # ralph-loop halt-loop
Skill(/discover-confidence {topic-slug})    # re-score
```

For `light` depth: instruct `/discover-plan` to target 2-3 questions per project (narrower scope), so the discovery loop converges on fewer questions.

For `full` depth: standard `/discover-plan` defaults (5-10 questions per `cycle-discover.md v1.1`).

If `/discover-confidence` after improve still < SHIPPABLE_WITH_CAVEATS → halt with honest report; do NOT proceed to plan phase.

#### Phase P — Plan (always)

```
Skill(/to-plan {topic-slug} [--milestone M<N>])   # --milestone forwarded only in roadmap-driven mode
Skill(/edge-case-plan {topic-slug})
# AUTO-INJECT MUST-FIX items into the plan (no AskUserQuestion):
Bash(python3 skills/auto-plan/scripts/inject_must_fix.py \
       --plan knowledge-base/plans/{slug}-plan.md \
       --edge-cases knowledge-base/reviews/{slug}-edge-cases-*.md)
# INJECT milestone_id into plan frontmatter (roadmap-driven mode only):
Bash(python3 skills/auto-plan/scripts/inject_milestone_id.py \
       --plan knowledge-base/plans/{slug}-plan.md \
       --milestone-id M<N>)
Skill(/deps-audit {topic-slug})
Skill(/plan-confidence {topic-slug})
# If verdict < SHIPPABLE:
Skill(/plan-improve {topic-slug})           # ralph-loop, max 10 iterations
Skill(/plan-confidence {topic-slug})         # re-score
```

`inject_must_fix.py` parses the `## MUST FIX` section of the edge-case report and appends each item as a sub-task (or ADR-deferred note) into the plan. The user does NOT have to absorb them manually. `/plan-confidence` is re-run after injection to validate the augmented plan.

`inject_milestone_id.py` writes the `milestone_id: M<N>` field into the plan's YAML frontmatter (per `cycle-roadmap § Plan metadata contract`). In ad-hoc mode this script is skipped — the plan frontmatter carries no `milestone_id` and `cycle-release` will skip the checkbox flip with WARN.

#### Phase A — Attest (always, post-plan)

```
Bash(scripts/attest-plan.sh {topic-slug})
```

Locks the SHA256 so UserPromptSubmit hook can validate.

#### Phase I — Implement (full-pipeline only; SKIPPED when `--plan-only`)

```
Skill(/implement {topic-slug})              # ralph-loop halt-loop until IMPLEMENTATION_COMPLETE
```

The `/implement` skill itself runs the consolidated validation gate at Step 5 — `run_validation.py` invokes `/code-quality` internally via `cq_invoke` (per ADR 0002) — and, when Step 5 returns `FAIL`, drives a mandatory fix-loop at Step 5.5 with promise `VALIDATION_GATE_PASSED` (see `skills/implement/SKILL.md`). A separate orchestrator call is not needed. After `/implement` returns, branch on the final reported state:

- Step 4 promise = `IMPLEMENTATION_COMPLETE` (no BLOCKED) AND Step 5/5.5 promise = `VALIDATION_GATE_PASSED` (no BLOCKED) AND final code-quality verdict ∈ {`PASS`, `PASS_WITH_CAVEATS`} → proceed to Phase R.
- Either loop emitted a BLOCKED report OR final code-quality verdict ∈ {`FAIL_SOFT`, `FAIL_HARD`, `INVALID`} → halt with `BLOCKED` and surface findings. `/review` and `/release` MUST NOT run.

#### Phase R — Review (full-pipeline only; SKIPPED when `--plan-only`)

```
Skill(/review {topic-slug})
```

- review verdict = `READY_TO_MERGE` → proceed to Phase Rel (unless `--no-release`).
- review verdict = `NEEDS_FIXES` → loop once back to `/implement` for targeted fixes, then re-run `/review`. After 1 loop attempt, halt with `BLOCKED`.
- review verdict = `NEEDS_DEEPER` → halt; loop back to `/to-plan` requires fresh human decision.

#### Phase Rel — Release (full-pipeline only; SKIPPED when `--plan-only` OR `--no-release`)

```
Skill(/release [--bump={forwarded}])
```

`/release` opens a develop→main PR and pauses for human approval. The orchestrator emits final verdict:

- `RELEASED` — PR was already merged when this chain ran (`/release` resumed after merge).
- `PR_OPEN_AWAITING_APPROVAL` — PR is open; cycle is complete on the orchestrator's side. Human approves the PR through GitHub UI to finalize.

### Step 4 — Deliver

Print summary:

```
=== /auto-plan complete ===
Topic: {slug}
Mode: {full-pipeline | plan-only}
Depth chosen: {none|light|full}
Confidence at start: {score}/100 ({verdict})

Discover phase:     {SKIP | SHIPPABLE_WITH_CAVEATS {score} | SHIPPABLE {score}}
Plan phase:         {SHIPPABLE_WITH_CAVEATS {score} | SHIPPABLE {score} | NEEDS_HUMAN}
Implement phase:    {SKIP | IMPLEMENTATION_COMPLETE | BLOCKED}
Code-quality:       {SKIP | PASS | PASS_WITH_CAVEATS | FAIL_SOFT | FAIL_HARD | INVALID}
Review phase:       {SKIP | READY_TO_MERGE | NEEDS_FIXES | NEEDS_DEEPER}
Release phase:      {SKIP | RELEASED | PR_OPEN_AWAITING_APPROVAL}

Final plan: knowledge-base/plans/{slug}-plan.md
Implementation: knowledge-base/implementations/{slug}-implementation.md
Code-quality audit: knowledge-base/audits/{slug}-code-quality-*.md
Review: knowledge-base/reviews/{slug}-review-*.md
Release: knowledge-base/releases/v{version}-release.md (if released)
Attestation hash: {sha256}

Next step:
  - plan-only       → /implement {slug} when ready
  - full + no-release → manual /release when ready
  - PR_OPEN_AWAITING_APPROVAL → approve the PR on GitHub
  - RELEASED        → start a new cycle
```

If any phase blocked → honest report listing what blocked + recommended human action.

## Hard gates (cannot proceed)

1. **Branch != `develop`** → refuse; require working on `develop` (Unbreakable Rule 4 — `main` is release-only).
2. **Uncommitted changes from prior cycle** → refuse; require git status clean OR explicit `--allow-dirty-tree`.
3. **Confidence < 30 without `--force-override`** → refuse with suggested next actions.
4. **`/discover-confidence` final verdict INVALID after improve** → halt; surface blockers; do NOT proceed to plan.
5. **`/plan-confidence` final verdict INVALID after improve** → halt; surface gaps; do NOT deliver as "ready".
6. **`/code-quality` returns FAIL_HARD or INVALID** → halt; do NOT proceed to `/review`. Loop back to `/implement` once; if still failing, surface to human.
7. **`/review` returns NEEDS_DEEPER** → halt; the human re-scopes via a fresh `/to-plan` invocation.
8. **Release PR auto-merge attempt** → forbidden. The human approves the release PR on GitHub. The orchestrator never invokes `gh pr merge` on the release PR.

## Soft gates (proceed with warning)

1. **Cap likely SHIPPABLE_WITH_CAVEATS** at depth=none with confidence < 70 → warn but proceed.
2. **Override of recommended depth via `--depth=`** (user picked `none` when system derived `full`) → proceed; add `## Accepted Risks` entry to plan.
3. **`/code-quality` returns PASS_WITH_CAVEATS** → proceed; surface caveats in the final summary.
4. **`/review` returns NEEDS_FIXES** → ONE retry: loop back to `/implement` for targeted fixes, re-run `/review`. If still NEEDS_FIXES, halt with `BLOCKED`.

## Anti-patterns

1. **NEVER fabricate confidence signals.** The script is deterministic; output is the truth.
2. **NEVER skip /edge-case-plan, /deps-audit, or /code-quality even on HIGH confidence.** Those gates are cheap and catch issues unit tests miss.
3. **NEVER auto-commit produced plan.** Delivery is the file; user decides when to commit.
4. **NEVER claim SHIPPABLE if plan-confidence returned WITH_CAVEATS** — honesty per Unbreakable Rule 3.
5. **NEVER proceed past INVALID verdict** — that's an explicit fail-closed.
6. **NEVER ask the user between phases.** Depth is derived; MUST-FIX is injected; gates pause only on `BLOCKED`. Interactive prompts during the chain defeat the orchestrator's purpose.
7. **NEVER auto-merge the release PR.** Unbreakable Rule 4 mandates human approval at merge.

## Cycle contract

This skill is `phase 0` of the super-cycle that orchestrates `cycle-discover` + `cycle-plan` + `cycle-implement` + `cycle-code-quality` + `cycle-review` + `cycle-release`. The cycle rule SoT is `rules/cycle-auto-plan.md`. Hard gates + soft gates + anti-patterns live there.

## Related

- `rules/cycle-roadmap.md` — macro super-loop that delegates one `cycle-auto-plan` run per milestone
- `rules/cycle-auto-plan.md` — cycle SoT
- `rules/cycle-discover.md` — discover sub-cycle
- `rules/cycle-plan.md` — plan sub-cycle
- `rules/cycle-implement.md` — implement sub-cycle
- `rules/cycle-code-quality.md` — code-quality sub-cycle
- `rules/cycle-review.md` — review sub-cycle
- `rules/cycle-release.md` — release sub-cycle (performs the post-merge ROADMAP.md checkbox flip)
- `commands/plan-goal.md` + `plan-loop.md` — Claude Code primitive composition (alternative autonomy mechanism)
- `scripts/attest-plan.sh` — attestation post-plan
- `skills/auto-plan/scripts/select_next_milestone.py` — Step 0 milestone selector (roadmap-driven mode)
- `skills/auto-plan/scripts/inject_milestone_id.py` — Phase P metadata injector
- `skills/auto-plan/scripts/inject_must_fix.py` — auto-absorption of MUST-FIX items
- Inspired by `planning-with-files` v2.43.0 (MIT, OthmanAdi) — autonomous file-based planning pattern, absorbed 2026-05-26
