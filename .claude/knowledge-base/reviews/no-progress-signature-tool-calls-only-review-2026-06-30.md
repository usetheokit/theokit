# Review — no-progress-signature-tool-calls-only (theokit#53)

**Date:** 2026-06-30
**Verdict:** READY_TO_MERGE
**Commits reviewed:** `3c2bf61` (fix + tests) · `249f4f6` (review hardening)
**Specialist agents:** architecture · tests · wiring+cross-validation (3 parallel, independent)

## Severity matrix (consolidated)

| Severity | Count | Status |
|---|---|---|
| BLOCKER | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 0 | — |
| LOW | 3 | **all FIXED in `249f4f6`** |
| INFO | 2 | addressed / accepted |

## Findings & disposition

### LOW-1 (architecture) — empty-toolCalls TOOL_CALLS round → false no_progress — FIXED
`deriveFinishReason` path 2 (`done.finishReason==='tool-calls'`) can yield a TOOL_CALLS round with an empty tool-call set → `roundSignature('')`; two consecutive would collide into a false `no_progress`. Path 2 is dormant ("if a future SDK adapter sets it"), so latent — but the plan's "not reachable" claim overstated the invariant.
→ **Fixed:** added `&& r.toolCalls.length > 0` guard to the no_progress check (`run-reflective-loop.ts:510`) + regression test `empty-toolCalls TOOL_CALLS rounds do NOT collide into a false no_progress`. The plan's edge-case claim is now genuinely enforced, not relied-upon-as-dormant.

### LOW-2 (tests) — harness comment said "unique input" but varies tool NAME — FIXED
`runtime-overrides.test.ts` header/inline comments said the mock varies "a UNIQUE input per round"; the mechanism varies the tool NAME (`t-${i}`).
→ **Fixed:** comments corrected to "UNIQUE tool name per round" (`249f4f6`).

### LOW-3 (cross-validation) — plan cites call-site `:512`, actual `:511` — ACCEPTED
Cosmetic line drift in the planning artifact (the call-site moved by one line when the signature collapsed from 3-line to 1-line). No behavioral impact; the plan is a historical record. Accepted, not edited.

### INFO-1 (tests) — empty-toolCalls edge previously uncovered — ADDRESSED
Now covered by the LOW-1 regression test.

### INFO-2 (wiring) — wiring triad + D1/D2/D3 + changeset all confirmed present — POSITIVE
Caller (single call-site `:511`), integration tests (reflective-loop-wiring + runtime-overrides, both on-ramps), runtime metric (`[THEO_AGENT_MAINLOOP_RUNTIME_APPLIED]` carries `terminal: 'no_progress'`). `responseText` NOT orphaned (still consumed at 4 sites). No new dependency. Changeset present.

## Dimension verdicts (per agent)

- **architecture:** PASS — SRP intact, loop owns terminal decision (no G1/G2 violation), TOOL_CALLS gate + K=2 preserved, responseText not orphaned, metric observable. (LOW-1 raised → fixed.)
- **tests:** PASS — RED→GREEN verified real (old `${calls}|${text}` key git-confirmed), deterministic, both lenses covered, harness change honest (weakens nothing). (LOW-2 + INFO-1 → fixed.)
- **wiring+cross-validation:** PASS — all 3 wiring pillars confirmed, plan↔impl↔tests consistent, no drift beyond the cosmetic LOW-3.

## Gate evidence (post-hardening)

- Full `@theokit/agents` suite: **486 passed, 3 skipped, 0 failed**.
- `tsc --noEmit -p packages/agents/tsconfig.test.json`: exit 0.
- `eslint` (changed files, `--max-warnings=0`): exit 0.
- `pnpm --filter @theokit/agents build` (tsup DTS): success.
- `/code-quality`: FAIL_SOFT — 0 HARD; only `symbol_fab_unverifiable_typescript` (TS-introspection auditor limitation), dismissed via ADR `0001-no-progress-cq-ts-introspection-soft-cap-dismissal`.

## Verdict

**READY_TO_MERGE** — 0 BLOCKER / 0 HIGH / 0 MEDIUM. All 3 LOW findings were FIXED (not merely documented). The change closes theokit#53 at root cause (signature keys on tool-calls only, mirroring opencode's `doom_loop`), is covered by 4 deterministic regression tests (proven RED→GREEN), preserves all existing behavior (full suite green), adds no dependency, and the one latent fragility surfaced in review was hardened proactively.
