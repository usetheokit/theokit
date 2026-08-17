# Resume After Recovered Blocker

Detailed protocol for resuming `/implement` after a legitimate cancellation. Linked from `SKILL.md § Step 4`.

## Why this protocol exists

Sometimes ralph-loop is cancelled mid-flight by a legitimate blocker:
- Real-tree dep audit surfaces a HIGH CVE requiring plan revision.
- The boundary-check hook rejects an import needing an inline rewrite.
- The dev environment is missing a binary.
- A plan-defect halt requires returning to `cycle-plan`.

After the human + the skill cooperatively resolve the blocker (plan v1.x → v1.(x+1), env fix, etc.), the skill MUST re-invoke ralph-loop with the corrected state — NOT continue driving the remaining tasks manually.

## Why manual continuation is forbidden

Driving Phase N+1, N+2, ... outside the halt-loop loses:
- The audit trail (`halt-loop-prompts/` + ralph state file)
- The per-iteration restart safety (Stop hook + iteration counter)
- The promise-marker termination contract (when is "done" actually done?)
- The discipline against ad-hoc scope creep ("just one more task while you're here")

## Resume protocol (6 steps)

1. **Verify the blocker is resolved.** Plan is at the correct version; the project's dependency manifest reflects bumped deps; env vars are set; whatever caused the original cancel is fixed.

2. **Refresh the SEPA brief** at `agents/implement-{slug}-{date}/sepa.md` — re-concatenate the now-corrected plan + ADRs + audits. The SEPA's per-iteration value depends on having current context.

3. **Reset the progress JSON.** Top-level `previous_halt` field records the original halt reason + resolution date; the BLOCKED task that was the trigger gets status=`pending` again with `retries` incremented and `previous_blocked_reason` preserved.

4. **Verify halt-loop driver file still exists** at `halt-loop-prompts/implement-{slug}.md`. If gitignored + wiped, regenerate per Step 3 of the main SKILL.

5. **Re-invoke ralph-loop with the SAME flags** as the original invocation (same `--completion-promise`; no iteration cap — the iteration counter resumes from where progress JSON left off, NOT from 1).

6. The fresh iteration reads `.progress-{slug}.json`, picks the formerly-BLOCKED task (now `pending`), and proceeds. SEPA's per-iteration brief includes the recovered state.

## What NOT to do

**NEVER drive the remaining tasks manually after a recovered blocker.** Per § Halt-loop invariants in the main SKILL, the skill never asks the user for permission between tasks while pending tasks remain — re-invoking ralph-loop is the canonical resume path.
