# Discover Edge Case Review — tool-call-input-surfacing

Date: 2026-06-30
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/tool-call-input-surfacing-plan.md
Research questions analyzed: 7
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 2)

All cited paths were physically verified before the plan was written (opencode ×3, codex ×3, in-repo ×4, SDK `updates.d.ts`) — no fabricated-citation edge case exists. No coverage corner is empty. Question count (7) ≤ 15. The hard caps of `/discover-plan-confidence` are therefore not at risk; the edges below are execution-quality refinements.

## MUST FIX

(none — the plan's paths resolve, all four corners are covered, and no question is unanswerable as written)

## SHOULD TEST

### EC-1: Q1 reads the RESOLVED SDK version, which may differ from the agents peer floor
- **Affected question:** Q1
- **Family:** Reference path / Citation
- **Scenario:** `node_modules/@theokit/sdk` currently resolves to `@theokit/sdk@2.9.0`, but `packages/agents/package.json` declares peer `>=2.11.2` (devDep `^2.11.2`). `/discover-execute` reads `updates.d.ts` from whatever the symlink resolves to. If the committed-args field path changed between 2.9.0 and 2.11.x, the blueprint could record a shape the implement phase won't see.
- **Suggested halt-loop checkpoint:** Before answering Q1, record the exact resolved SDK version (`readlink -f node_modules/@theokit/sdk`) in the answer, and assert the three update variants exist in THAT file; if the resolved version < the agents peer floor, also read the peer-floor version's `updates.d.ts` from the pnpm store and note any field-path delta.

### EC-2: Q7 depends on Q1's variant names
- **Affected question:** Q7
- **Family:** Dependency
- **Suggested halt-loop checkpoint:** Answer Q1 before Q7 — Q7's "cross-ref Q1's variants vs the resolved SDK version" is undefined until Q1 names the variant + field that carries committed args.

## DOCUMENT

### EC-3: opencode arg-assembly is likely provider-shaped (anthropic `partial_json`), not OpenAI/OpenRouter `tool_calls`
- **Accepted risk:** theocode uses OpenRouter (OpenAI-style `tool_calls`), while opencode's incremental path surfaced in scouting was anthropic `partial_json`. The transferable concept is the *mechanism* (buffer keyed by call id → parse JSON once complete → surface), not the provider wire detail. The blueprint MUST extract the mechanism and explicitly note the provider-specifics are illustrative, not prescriptive. Recorded as an ADR note in the plan (D4).

### EC-4: codex's arg-assembly algorithm lives in Rust (out-of-scope); the TS schema gives only the protocol SHAPE
- **Accepted risk:** `codex-rs/app-server-protocol/schema/typescript/` is protocol *definitions* (types: deltas vs final function-call), not the assembly *logic* (Rust core, explicitly out-of-scope per the plan's Out-of-Scope table). Q5 therefore yields the protocol shape (how codex models deltas vs the final assembled call) as the second independent comparison point — NOT an algorithm. If the assembly logic is not expressible from the TS schema, mark that facet BLOCKED rather than diving into Rust. Recorded as an ADR note in the plan (D4).

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 1 | 0 | 1 | 0 |
| Q2 | 1 (shared w/ Q3) | 0 | 0 | 1 |
| Q3 | — | 0 | 0 | — |
| Q4 | 0 | 0 | 0 | 0 |
| Q5 | 1 | 0 | 0 | 1 |
| Q6 | 0 | 0 | 0 | 0 |
| Q7 | 1 | 0 | 1 | 0 |

**Verdict:** DISCOVERY PLAN OK (fold the 2 SHOULD TEST items into Halt-loop Checkpoints and the 2 DOCUMENT items into a new ADR D4 → bump to v1.1)
