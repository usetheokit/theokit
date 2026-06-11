# Discover-Improve Halt-Loop Prompt

You are mid-improvement of a blueprint, iteration {ITERATION}. The user invoked `/discover-improve {BLUEPRINT_SLUG}` after `/discover-confidence` returned a verdict below `{TARGET_VERDICT}`.

**Blueprint:** `{BLUEPRINT_PATH}`
**Target verdict:** `{TARGET_VERDICT}` (default: `SHIPPABLE_WITH_CAVEATS`, score ≥ 70)
**Confidence rubric:** `.claude/skills/discover-confidence/templates/rubric-blueprint.md`

## Your contract for this iteration

### Phase A — Deterministic fixes (apply FIRST every iteration)

Run `python3 .claude/skills/discover-improve/scripts/apply_fixes.py {BLUEPRINT_PATH}`. This:

1. Replaces weak imperatives (should/could/may/might) with `must` in prose (skips code blocks and citation tables).
2. Strips loopholes ("if possible", "as appropriate", "when applicable", "where feasible").
3. Detects fabricated citations (paths in `.claude/knowledge-base/references/{...}` that don't exist on disk) and marks them with `<!-- BLOCKED: path not found in .claude/knowledge-base/references/ -->`.
4. Reports diff to stdout.

Then re-score:

```
python3 .claude/skills/discover-confidence/scripts/run_blueprint_score.py {BLUEPRINT_PATH} --no-warn
```

If verdict ≥ `{TARGET_VERDICT}`, jump to step "Emit promise".

### Phase B — LLM-driven fixes (apply only if Phase A insufficient)

For each detractor in the latest `reasons`:

1. **Empty coverage corner** — read the discovery plan to find the research question(s) mapped to that corner. If credible answers exist in already-collected blueprint content elsewhere, REFACTOR them into the empty corner. If no credible answer exists, add:
   ```markdown
   <!-- ADR: Corner X deferred. Original plan declared Qy for this corner; halt-loop blocked at iteration Z. See plan ADR Dn. -->
   ```
   The `<!-- ADR: ... -->` marker satisfies the completeness check as long as it includes a real reason.

2. **Per-project asymmetry** — one project dominates content. Trim repetitive paragraphs in the dominant project's subsections; do NOT pad the under-represented projects with fabricated detail.

3. **Low citation density** — paragraphs without citations should EITHER receive a real `.claude/knowledge-base/references/{...}` citation OR be rewritten as opinion ("the synthesis suggests...") rather than claim.

4. **Structural_risk detractors** — fix specific smells listed in reasons by rewriting the affected sentence.

Then re-score with `run_blueprint_score.py`.

### Emit promise

When verdict ≥ `{TARGET_VERDICT}`, emit the promise marker AT THE VERY END of your response — **plain text, isolated on its own line, NO backticks, NO fenced code blocks, NO markdown wrapping**. Ralph-loop's regex matches the literal sequence outside of inline code; wrapping breaks detection.

Correct emission (place exactly this on its own line at end of response):

<promise>BLUEPRINT_IMPROVED</promise>

You may precede the marker with: initial verdict → final verdict, changes applied per category, remaining issues that need human review (don't auto-fix what you can't honestly fix — leave a TODO). The marker must be the last content of the response.

If no-improvement is detected for 2 consecutive iterations (same score, same `reasons`):

- HALT this iteration. Do NOT emit `<promise>BLUEPRINT_IMPROVED</promise>` — the target was NOT reached.
- Write an explicit BLOCKED report listing the remaining issues and why automated improvement is stuck.
- Surface the BLOCKED report to the human. The completion promise is reserved for genuine target hits on disk.

## Inviolable rules

- NEVER touch files outside `{BLUEPRINT_PATH}`.
- NEVER modify the upstream discovery plan. To revise the plan, the user must invoke `/discover-plan` again.
- NEVER modify `.claude/knowledge-base/references/` (boundary-check hook enforces).
- NEVER fabricate a citation. If a path doesn't exist, mark it BLOCKED and move on.
- NEVER emit the promise while a hard cap is still active. INVALID verdict cannot be auto-improved past 49 without resolving the underlying structural defect (empty corner / fabricated citation).
- NEVER emit the completion promise as a graceful exit from a stop condition — when a blocker fires, HALT and surface a BLOCKED report without promise.
- NEVER emit `<promise>BLUEPRINT_IMPROVED</promise>` without re-running `run_blueprint_score.py` in this iteration AFTER your last edit. The promise asserts a measurable fact (verdict ≥ `{TARGET_VERDICT}`); emitting it speculatively (without verification) is fabrication.
- NEVER spawn a nested ralph-loop inside this iteration. NEVER modify `.claude/ralph-loop.local.md` directly. If you observe `ralph-loop.local.md` with `active: true` referencing a DIFFERENT slug, HALT and surface the conflict.

## When to give up honestly

If a hard cap fires that cannot be resolved without human input:

- Fabricated citation with no plausible replacement → BLOCKED, recommend `/discover-execute` to re-run that question
- Empty corner with no relevant existing content → BLOCKED, recommend `/discover-plan` to re-plan or accept lower verdict

HALT without emitting the promise. Write a BLOCKED report itemizing the unresolvable issues. The user reads the report and decides. The completion promise is reserved for genuine target hits — emitting it on a blocker would let downstream cycles treat the blueprint as auto-improved.
