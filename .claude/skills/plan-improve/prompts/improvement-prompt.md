You are running a self-improvement loop on a plan-confidence M2 plan. Your job: raise the plan's verdict to `{TARGET_VERDICT}` or better, iterating until done.

**Plan slug:** `{PLAN_SLUG}`
**Plan path:** `{PLAN_PATH}`
**Target verdict:** `{TARGET_VERDICT}` (one of SHIPPABLE_WITH_CAVEATS, SHIPPABLE)
**Completion phrase to emit when done:** `<promise>PLAN_IMPROVED</promise>`

## Step 0 — MANDATORY: Read `.claude/rules/` BEFORE editing

Before applying ANY fix, read the project's architecture rules:

```bash
ls .claude/rules/ 2>/dev/null
```

Every edit you make to the plan SHALL be compatible with these rules. If a rule conflicts with an improvement you'd otherwise apply, DO NOT apply that improvement — instead, leave a TODO comment explaining the conflict.

Fallback: if `.claude/rules/` is missing or empty, use defaults at `.claude/skills/plan-confidence/defaults/` (SOLID, DRY, Clean Code, LoC ~500, testing).

When Phase B (LLM-driven ADR alternatives) runs, the alternatives you propose SHALL respect:
- dependency direction and module boundaries (per `architecture.md` if present)
- file size budgets (per `architecture.md § Module hygiene` or `.claude/skills/plan-confidence/defaults/loc-limits.md` as fallback)
- testing conventions (per `testing.md` or `.claude/skills/plan-confidence/defaults/testing.md` as fallback)

If a proposed alternative would violate any rule, choose another alternative OR leave a TODO comment marking the conflict.

## Loop algorithm per iteration

### Step 1 — Score the current plan

Run:

```bash
python3 .claude/skills/plan-confidence/scripts/run_structural.py "{PLAN_PATH}" --no-warn
```

Read the JSON output. Note:
- `verdict` — current band
- `final_score_after_caps`
- `hard_caps_triggered`
- `reasons` (per dimension, lists top contributors and detractors)
- `sub_reports.spec_smells.total_hits` and `by_category`
- `sub_reports.adr_completeness.missing_alternatives`
- `sub_reports.tdd_in_bugfix.missing_tdd`

### Step 2 — Check completion

If `verdict in {SHIPPABLE, SHIPPABLE_WITH_CAVEATS}` AND no critical issue requires more work, emit the promise marker AT THE VERY END of your response — **plain text, isolated on its own line, NO backticks, NO fenced code blocks, NO markdown wrapping**. Ralph-loop's regex matches the literal sequence outside of inline code; wrapping breaks detection.

Correct emission (place exactly this on its own line at end of response):

<promise>PLAN_IMPROVED</promise>

You may precede the marker with a 5-line summary of what changed across iterations, but the marker must be the last content of the response.

### Step 3 — Apply deterministic fixes (Phase A)

If verdict is below target, run the automated fix script:

```bash
python3 .claude/skills/plan-improve/scripts/apply_fixes.py "{PLAN_PATH}"
```

This applies three SAFE deterministic transformations:
1. **Weak imperatives** (should/could/may/might → must)
2. **Loopholes removed** (if possible, when applicable, …)
3. **TDD template injected** in any bug-fix task missing a `#### TDD` block

These run only in PROSE (skip fenced code blocks and `### T-id` headers).

### Step 4 — Apply semantic fixes (Phase B, only if needed)

If after Phase A the verdict still does not meet target, address the issues that require human/LLM understanding:

**ADRs missing alternatives** (cap 70):
- For each ID in `sub_reports.adr_completeness.missing_alternatives`, OPEN the ADR section.
- Locate the `### D<N> — Title` block.
- In the `- **Rationale:**` line, append a sentence in the form:
  `Rejected alternative: <alternative-X> — discarded because <reason-Y>.`
- Use your understanding of the plan's domain to propose a realistic alternative. DO NOT fabricate. If you cannot find a credible alternative, DO NOT add fake text — instead, leave a TODO comment like `<!-- TODO: human review for D<N> alternatives -->` and continue.

**Unmapped Coverage Matrix gaps** (cap 49 INVALID):
- These are gaps without a task reference AND without an out-of-scope marker.
- DO NOT invent tasks. Instead, for each unmapped gap, mark it explicitly with `N/A — D<adr-id> out-of-scope (deferred to v2)` if you can justify deferral from existing ADRs, OR leave a `<!-- TODO: human must add task or mark out-of-scope -->` comment.
- Re-running the scorer should reclassify deferred entries via the `deferred_gaps` counter (see ADR D8 / #2 fix).

### Step 5 — Re-score

Run the scorer again (Step 1). If improved, continue. If not improved (same or lower score), STOP and emit the promise marker per the Step 2 emission discipline (plain text, isolated line, end of response). Precede with an honest summary of remaining issues and why the loop could not fix them automatically.

## Invariants you SHALL NOT violate

1. **DO NOT delete content from the plan.** Only ADD or transform smell-words into stronger forms.
2. **DO NOT touch ADRs you don't understand.** If you cannot articulate the alternative semantically, leave a TODO comment.
3. **DO NOT modify the Coverage Matrix table headers.** Only data rows.
4. **DO NOT touch fenced code blocks.** They contain examples/tests; smell words there are legitimate.
5. **DO NOT modify task headers (`### T<N>.<M>`).** Title content is sacred.
6. **DO NOT touch other plans.** Only the slug you were given.
7. **DO NOT touch git history or commit changes.** Edits stay in working tree.
8. **DO NOT emit `<promise>PLAN_IMPROVED</promise>` falsely.** Only when the target verdict is genuinely met (re-run `run_structural.py` AFTER your last edit in this iteration — the promise asserts a measurable fact; emitting it speculatively is fabrication) OR you've exhausted all automatic fixes and need human intervention.
9. **DO NOT spawn a nested ralph-loop inside this iteration. DO NOT modify `.claude/ralph-loop.local.md` directly.** If you observe `ralph-loop.local.md` with `active: true` referencing a DIFFERENT slug, HALT and surface the conflict (concurrent loops on overlapping state is an anti-pattern in `rules/loop-engine-convention.md`).

## What "EXTREMELY reliable" means in this loop

- You must run the scorer BEFORE and AFTER each iteration's edits.
- You must log what you changed per iteration (a brief bullet list per iteration).
- You must not exceed `{MAX_ITERATIONS}` total iterations.
- If you hit max iterations without reaching target, emit the promise with an honest status report.

Start by running Step 1 now.
