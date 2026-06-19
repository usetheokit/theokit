# Progress Log — {plan-slug}

<!--
WHAT: Chronological action log for the active plan.
WHY: Per-action granularity that complements per-phase audit reports
     (edge-case-{date}.md, confidence-{date}.json, deps-audit-{date}.md).
     Audit reports answer "what was the verdict at phase boundary X".
     This file answers "what did I just do, and what happened".
WHEN: Update after every Edit/Write to source files OR after every phase
     transition (T0 → T1, T2.1 → T2.2). PostToolUse hook nudges this.

CONVENTION:
- One H2 per session: `## Session: YYYY-MM-DD`
- Inside each session, H3 per phase or per coherent action group
- Inside each group: bullet list of actions in chronological order
- Errors logged inline with their resolution (or `(unresolved)` marker)
- File MUST NOT exceed 2000 lines — rotate to progress-archive-{N}.md if it does
-->

## Session: YYYY-MM-DD

### Phase T0.x — {title}

- **Started:** YYYY-MM-DD HH:MM (UTC)
- **Status:** in_progress | complete | blocked
- **Actions:**
  - Did X (file:line if applicable)
  - Encountered Y → resolved via Z
  - Ran command `npm test` → result: passes (12 tests)
- **Files modified:** `src/foo.ts:12-45`, `tests/foo.test.ts (NEW)`
- **Decisions made:** chose A over B because C (see plan ADR D7)
- **Next:** proceed to T0.x+1

### Phase T0.x+1 — {title}

(same shape)

---

## Coexistence with per-phase audit reports

This file is NOT a replacement for per-phase deterministic audits:

| Artifact | When written | What it captures |
|---|---|---|
| `progress.md` (THIS file) | Continuously, after each Edit/Write | Granular action log: what was done + immediate observations |
| `.claude/knowledge-base/reviews/{slug}-edge-cases-plan-{date}.md` | Once per `/edge-case-plan` invocation | Classified edges (MUST FIX / SHOULD TEST / DOCUMENT) |
| `.claude/knowledge-base/reviews/{slug}-plan-confidence-{date}.md.json` | Once per `/plan-confidence` invocation | Structural M2 score + verdict |
| `.claude/knowledge-base/audits/{slug}-deps-audit-{date}.md` | Once per `/deps-audit` invocation | CVE/Rule 9 verdict |
| `.claude/knowledge-base/reviews/{slug}-implement-validate-{date}.md` | Once per `/implement` final validation | Test/typecheck/lint/coverage gates |
| `.claude/knowledge-base/reviews/{slug}-review-{date}.md` | Once per `/review` invocation | 4-7 specialized reviewers' consolidated report |

`progress.md` lives ALONGSIDE these — it's the **per-action narrative**;
they are **per-phase verdicts**. PR reviewers consult both.
