---
type: Review
title: Review: partial-tool-call stream event
description: Merge review for the partial-tool-call stream slice, with the cross-repo follow-up it filed.
tags: [review, streaming]
status: stable
generated: { by: theokit-agent/unrecorded, at: 2026-07-03T00:00:00Z }
migrated: { by: claude-opus-5/okf-skill, at: 2026-08-06T00:00:00Z, from: knowledge-base/reviews/agents-partial-tool-call-stream-review-2026-07-02.md }
sources:
  - id: origin
    resource: knowledge-base/reviews/agents-partial-tool-call-stream-review-2026-07-02.md
    title: Original document in the pre-wiki tree, preserved verbatim
    last_modified: 2026-07-03
---

# Review: agents-partial-tool-call-stream

**Date:** 2026-07-02 · **Commit:** `8842bc6` · **Closes:** theokit-sdk#70
**Verdict:** READY_TO_MERGE · Findings: 0 BLOCKER / 0 HIGH / 0 MEDIUM / 3 INFO

## Cross-validation (independent gate re-run)

| Task | Verdict |
|---|---|
| T1.1 — PartialToolCallEvent + union + `isPartialToolCall` + export | fully-implemented |
| T2.1 — translate `partial-tool-call` + tests | fully-implemented |

## Gates re-run by the reviewer

- `vitest run tests/unit/event-translator.test.ts` → 28 passed
- `vitest run` (agents suite) → 521 passed | 3 skipped (524), 64 files
- `pnpm build` (tsup ESM + DTS) → success, 0 type errors
- `eslint` (4 changed files) → clean
- pre-push hook (build + typecheck) → passed on push
- file sizes 187/222/80 ≤ 500

## Correctness

- Emits exactly ONE `partial_tool_call` per SDK `partial-tool-call` update; `input = toolCall.args ?? {}`.
- D1 invariant proven (`test_partial_tool_call_emits_no_tool_call`); `tool-call-started`/`completed` byte-identical.
- Additive/non-breaking; `minor` changeset correct.

## INFO (plan-wording, not defects)

- I-1 typecheck/lint script names in DoD don't exist → satisfied via tsup DTS + root eslint.
- I-2 CHANGELOG via changeset (repo is changeset-driven).
- I-3 D1 test inline predicate vs guard — functionally identical.

READY_TO_MERGE. Shipped to theokit@develop; releases in next @theokit/agents. Cross-repo: fix in `theokit`, issue in `theokit-sdk#70`.

# Related
* [agents-partial-tool-call-stream](/plans/agents-partial-tool-call-stream.md) — the implementation plan.

