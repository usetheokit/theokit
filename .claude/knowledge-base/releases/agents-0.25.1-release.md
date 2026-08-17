# Release @theokit/agents@0.25.1

**Date:** 2026-06-30
**Verdict:** PR_OPEN_AWAITING_APPROVAL
**Type:** patch (bug fix) — changesets flow
**Issue:** https://github.com/usetheodev/theokit/issues/58
**PR:** https://github.com/usetheodev/theokit/pull/59 (develop → main)
**Source review:** knowledge-base/reviews/tool-call-input-surfacing-review-2026-06-30.md (READY_TO_MERGE)

## What shipped
Fix `tool_call` StreamEvent surfacing empty `input` (`{}`) → blank tool cards (theokit#58).
`event-translator.ts` now reads the real SDK field: `input: msg.args ?? msg.input ?? msg.arguments ?? {}`.

## Evidence (Node 24, real OpenRouter)
- Before: `{"type":"tool_call","name":"shell_exec","args":{}}`
- After:  `{"type":"tool_call","name":"shell_exec","args":{"command":"echo FIX58-EVIDENCE"}}`
- Tests: 514 @theokit/agents pass (6 new). tsc clean, eslint clean, /code-quality FAIL_SOFT (TS-introspection soft cap dismissed).

## Commits
- 77672ab fix(agents): tool_call input reads msg.args (#58)
- 493fc48 test(agents): non-object args passthrough + review report
- 9f5b5e2 chore(release): @theokit/agents@0.25.1

## Post-merge steps (on "merged")
1. `pnpm build` (agents) → `cd packages/agents && npm publish --no-provenance` (manual; Actions billing path).
2. Tag `@theokit/agents@0.25.1` (annotated) at the merge commit; push.
3. `gh release create @theokit/agents@0.25.1`.
4. theocode adopts: `pnpm update @theokit/agents` (range pulls 0.25.1) → live UI evidence (tool card shows the command). theokit@0.11.6 consumes ^0.25.0 → picks up 0.25.1 on install (no theokit re-release).
