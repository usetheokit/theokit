# Discover Edge Case Review — devtools-viewer

Date: 2026-06-11
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/devtools-viewer-plan.md
Research questions analyzed: 6
Edge cases found: 1 (MUST FIX: 0, SHOULD TEST: 1, DOCUMENT: 0)

## SHOULD TEST

### EC-1: Next.js dev-overlay test dir has only 1 test file — may not cover route display

- **Affected question:** Q4
- **Family:** Reference path
- **Scenario:** Q4 asks "Does Next.js DevOverlay have tests for its route display?" The directory `.claude/knowledge-base/references/next.js/test/e2e/app-dir/dev-overlay/` contains only 1 test file (portal-not-affect-parent). It tests DOM isolation, not route display. Q4 may produce a thin answer ("no route display tests found").
- **Suggested halt-loop checkpoint:** Before answering Q4, also grep `test/e2e/` for other dev-overlay test files outside the `dev-overlay/` dir (Next.js may scatter overlay tests across feature dirs). Fallback: mark Q4 answer as "(limited — Next.js tests overlay DOM, not route content)" and proceed.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 0 | 0 | 0 | 0 |
| Q2 | 0 | 0 | 0 | 0 |
| Q3 | 0 | 0 | 0 | 0 |
| Q4 | 1 | 0 | 1 | 0 |
| Q5 | 0 | 0 | 0 | 0 |
| Q6 | 0 | 0 | 0 | 0 |

**Verdict:** DISCOVERY PLAN OK

All 6 reference paths verified to exist. Only EC-1 notes that Q4's Next.js test coverage may be thinner than expected — handled by fallback annotation. Plan is ready for `/discover-execute`.
