---
name: discover-improve
version: 0.1.0
requires: [discover-confidence]
description: Iteratively improve a blueprint's discover-confidence score by applying deterministic fixes + LLM-driven semantic fixes via a halt-loop (ralph-loop-style autonomous iteration). Mirrors /plan-improve but for blueprints.
user-invocable: true
allowed-tools: Read Glob Grep Bash Write Edit Skill
argument-hint: "{blueprint-slug} [--target SHIPPABLE_WITH_CAVEATS]"
---

# Discover-Improve — Iterative Blueprint Score Lifter

Reads a blueprint, scores it with `/discover-confidence`, applies deterministic + semantic fixes, re-scores, and repeats until the blueprint reaches the target verdict.

Sibling of `/plan-improve` — same architecture (ralph-loop halt-loop + deterministic Phase A + LLM Phase B), different fix categories tailored to **blueprints** (not implementation plans).

**Architecture:** wraps the `ralph-loop` plugin's autonomous-iteration mechanism with a blueprint-specific prompt template.

**ADR reference:** see `.claude/skills/discover-confidence/SKILL.md` for the scoring contract.

## Cycle contract

This skill is **phase 5** of [`cycle-discover`](../../rules/cycle-discover.md). The cycle rule is the source of truth for chain order (invoked when `/discover-confidence` verdict < SHIPPABLE_WITH_CAVEATS; followed by `/discover-confidence` re-score; if verdict reaches SHIPPABLE_WITH_CAVEATS, skill-distillation tail begins), hard limits, anti-patterns, and rollback. **Read `cycle-discover.md` before invoking this skill.** This SKILL.md retains phase-specific detail (Phase A deterministic fixes for blueprints, Phase B LLM fixes, fix categories tailored to blueprint shape).

## When to Trigger

User explicitly invokes `/discover-improve {slug}` after seeing a low score from `/discover-confidence` and wanting the system to attempt auto-improvement.

## Workflow

### Step 1 — Argument parsing

Accept:

- `/discover-improve {slug}`
- `/discover-improve {slug} --target SHIPPABLE`

Where `{slug}` is the basename of a blueprint file in `.claude/knowledge-base/discoveries/blueprints/`.

Defaults:

- `--target`: `SHIPPABLE_WITH_CAVEATS` (the realistic ceiling for auto-improvement)

The loop runs until EITHER the target verdict is reached on disk OR a genuine stop condition fires (see § Stop conditions). There is no iteration cap — premature termination would let downstream cycles treat a sub-target blueprint as improved.

### Step 2 — Resolve blueprint path

Resolve to `.claude/knowledge-base/discoveries/blueprints/{slug}-blueprint.md`.

### Step 3 — Build the improvement prompt

Read `.claude/skills/discover-improve/prompts/improvement-prompt.md` and substitute:

- `{BLUEPRINT_SLUG}` — the slug
- `{BLUEPRINT_PATH}` — the resolved path
- `{TARGET_VERDICT}` — target band

### Step 4 — Pre-flight guard (concurrent-loop safety)

Before invoking ralph-loop, verify `.claude/ralph-loop.local.md` (if present in project root) does NOT have `active: true`. Concurrent ralph-loops on overlapping state is a documented anti-pattern (`rules/loop-engine-convention.md § Anti-patterns`). If a stale state file from a prior loop is observed `active`, HALT and surface to human rather than spawning a concurrent loop.

### Step 5 — Invoke ralph-loop (shell-safe positional + flags)

**Read `.claude/rules/loop-engine-convention.md § How to invoke ralph-loop:ralph-loop safely` BEFORE this step.** The ralph-loop positional argument is shell-evaluated; inlining a multi-section driver prompt (backticks / fenced code blocks / `$(...)`) breaks loop startup with a bash parse error. Use the file-referenced pattern.

1. Write the substituted prompt from Step 3 to `.claude/halt-loop-prompts/discover-improve-{blueprint-slug}.md` (gitignored).
2. Invoke `ralph-loop:ralph-loop` with:
   - Positional prompt (no shell metachars): `Read .claude/halt-loop-prompts/discover-improve-{blueprint-slug}.md and follow its instructions for this halt-loop iteration.`
   - `--completion-promise 'BLUEPRINT_IMPROVED'`

The ralph-loop plugin:

- Writes `.claude/ralph-loop.local.md` (state file)
- Activates the Stop hook
- Feeds the positional prompt back to Claude on each session-exit attempt (Claude re-reads the driver file each iteration)
- Detects `<promise>BLUEPRINT_IMPROVED</promise>` to terminate

### Step 6 — Post-promise sanity check

After the loop emits `<promise>BLUEPRINT_IMPROVED</promise>`, run ONCE before the report:

```bash
python3 .claude/skills/discover-confidence/scripts/run_blueprint_score.py {BLUEPRINT_PATH} --no-warn
```

Compare the emitted verdict against `--target`. If the post-promise verdict is BELOW `--target`, the loop emitted the marker speculatively — surface as **PROMISE INTEGRITY VIOLATION** and re-invoke. NEVER accept the promise at face value when score-on-disk does not match.

### Step 7 — Report

After the loop terminates AND sanity check passes:

- Initial verdict vs final verdict (post-sanity-check)
- Total changes per category
- Remaining issues that required human review
- Diff of all modifications (`git diff` against working tree)

## Stop conditions

HALT and surface BLOCKED report to the human (do NOT emit `<promise>BLUEPRINT_IMPROVED</promise>`) when ANY of the following structural blockers fires:

1. No-improvement detected for 2 consecutive iterations (same score, same `reasons`).
2. Fabricated citation with no plausible replacement → recommend `/discover-execute` to re-run the source question.
3. Empty coverage corner with no relevant content elsewhere → recommend `/discover-plan` to revise OR accept lower verdict.
4. Hard cap remains active (INVALID at 49) and cannot be lifted via Phase A or Phase B without scope-creeping → surface to human.
5. Post-promise sanity check (Step 6) detects score-disk drift → re-invoke OR HALT after 2 retries.

The promise `<promise>BLUEPRINT_IMPROVED</promise>` is emitted EXCLUSIVELY when the score on disk reaches `--target`. There is no path that emits the promise on a partial improvement. In all blocker cases, downstream phases of `cycle-discover` MUST NOT proceed treating the blueprint as auto-improved. Honest BLOCKED > false IMPROVED (Unbreakable Rule 3).

## Fix categories (4 active in v1)

| Fix | Phase | Mechanism | Risk |
|---|---|---|---|
| Weak imperatives in blueprint prose (should/could/may/might) → must | A — deterministic | regex (skips code blocks + citation tables) | Low |
| Loopholes (if possible, when applicable, ...) | A — deterministic | regex | Low |
| Fabricated citation → mark as `<!-- BLOCKED: path not found in .claude/knowledge-base/references/ -->` | A — deterministic | path existence check | Low |
| Empty coverage corner → mark as `<!-- BLOCKED: corner X has zero content; re-run /discover-execute -->` | A — deterministic | section emptiness check | Low |

**Empty coverage corner is NOT auto-resolved via ADR.** A blueprint missing an entire coverage corner is a structural defect (hard cap 49 INVALID per `discover-blueprint-golden-rule.md`). Auto-laundering it through a Phase B ADR would let `discover-improve` paper over deep-research failure. Instead, Phase A marks the corner explicitly as BLOCKED — the human re-executes that section via `/discover-execute` (or revises the discovery plan).

**Phase A (apply_fixes.py)** runs first. **Phase B (LLM)** runs only if Phase A doesn't reach target.

## Anti-patterns

- The skill NEVER touches files outside `{BLUEPRINT_PATH}` (or the progress file).
- The skill NEVER modifies `.claude/knowledge-base/references/` (boundary-check hook enforces).
- The skill NEVER modifies the upstream discovery plan (use `/discover-plan` to revise the plan).
- The skill NEVER commits or pushes to git.
- The skill NEVER emits `<promise>BLUEPRINT_IMPROVED</promise>` falsely — Step 6 sanity check enforces.
- The skill NEVER spawns concurrent ralph-loops on overlapping state (Step 4 pre-flight guard).
- The skill NEVER emits the completion promise as a graceful exit from a stop condition — when a blocker fires, the skill HALTS without promise. Forbidden per-iteration practices are enumerated in `prompts/improvement-prompt.md § Inviolable rules`.

## Hard limits

- `apply_fixes.py` is DETERMINISTIC — same input always produces same output. Idempotent.
- Phase B LLM iterations use the main model.
- The loop has no iteration cap; it runs until the target verdict is reached on disk OR a stop condition fires. If many iterations pass without convergence and no-progress is detected, the no-improvement stop condition (see § Stop conditions) HALTS the loop honestly without emitting the promise.

## Output

When the loop completes:

```
=== Discover-Improve complete ===
Blueprint: <slug>
Initial verdict: NON_SHIPPABLE (52.0)
Final verdict:   SHIPPABLE_WITH_CAVEATS (74.5)
Iterations:      6

Changes applied:
  weak_imperatives: 14
  loopholes: 3
  fabricated_citations_marked: 2
  empty_corners_resolved_via_adr: 1

Remaining issues (need human):
  - Q5 — Project B citation `project-b/services/memory.py:142` does not exist; mark as BLOCKED but no replacement found.
  - Coverage Matrix row 8 — unmapped gap, marked TODO (loop could not justify deferral).

Diff: <git diff against working tree>
```

## Related

- Scorer: `.claude/skills/discover-confidence/SKILL.md`
- Loop engine: `ralph-loop` plugin (must be enabled in `~/.claude/settings.json`)
- Fix script: `.claude/skills/discover-improve/scripts/apply_fixes.py`
- Prompt template: `.claude/skills/discover-improve/prompts/improvement-prompt.md`
- Sibling skill: `/plan-improve` (same mechanism, applies to implementation plans)

## Limitations (honest)

- **Phase A fixes can over-correct.** Replacing "should" with "must" in a blueprint where "should" is a hedge ("the codebase should be < 50KB") may sound stronger than the evidence warrants. Acceptable trade-off because the rubric penalizes weak imperatives.
- **Phase B (empty-corner deferral) depends on LLM judgment.** The loop instructs Claude to leave TODO comments rather than fabricate, but the line between "credible ADR for deferral" and "fabricated rationale" is judgment-call.
- **Fabricated citations cannot be auto-fixed.** The fix is to MARK them as blocked, not to invent a correct path. Human must re-execute that section of the discovery.
- **Loop terminates** when EITHER target verdict reached on disk (promise emitted) OR a stop condition fires (HALT without promise — see § Stop conditions).
