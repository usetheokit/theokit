# Discover Edge Case Review — tool-dialect-tag-sanitizer

Date: 2026-06-30
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/tool-dialect-tag-sanitizer-plan.md
Research questions analyzed: 5
Edge cases found: 4 (MUST FIX: 1, SHOULD TEST: 2, DOCUMENT: 1)

> Methodology: every cited `knowledge-base/references/{...}` path + every line anchor in
> the plan was verified empirically (`ls`, `wc -l`, `grep -n`, `cat`) before flagging. Only
> claims that are verifiable AND wrong are raised (anti-pattern #3: citation paranoia avoided).

## MUST FIX

### EC-1: Q2 reference path is a thin route re-export — the tool-call mapping it claims to hold lives elsewhere
- **Affected question:** Q2
- **Family:** Reference path
- **Scenario:** Q2 targets `.claude/knowledge-base/references/opencode/packages/llm/src/protocols/openai-compatible-chat.ts` and runs `grep -n "tool_call\|toolCall\|function"`. That file is an 876-byte route definition that delegates everything via `protocol: OpenAIChat.protocol` to `./openai-chat`. The grep returns **zero** matches (verified). Per the plan's own halt-loop checkpoint ("Per-question Fase A: ≥1 hotspot OR 3 retries → after 3 empty → BLOCKED"), Q2 is marked BLOCKED ("Fase A exhausted").
- **Impact:** Q2 is the linchpin of the STRIP-vs-PARSE decision — it is the corner that establishes "native `tool_calls` is the parsed contract, and the leaked `<function=…>` text dialect is the deviation (so STRIP, don't re-parse)". A BLOCKED Q2 leaves that rationale uncited in the blueprint, weakening the central ADR exactly where `/discover-confidence` will look for it.
- **Suggested fix:** Repoint Q2's reference path + hotspots to `.../protocols/openai-chat.ts` (verified: 46 matches — assistant `tool_calls` schema `:74`, delta `OpenAIChatToolCallDelta` `:146`, the `lowerToolCall` accumulator `:234`/`:247`/`:254`); keep `openai-compatible-chat.ts` only as a one-line note that the OpenAI-compatible route reuses `OpenAIChat.protocol` end-to-end.

## SHOULD TEST

### EC-2: Q4 codex grep pattern is narrower than what the file actually exposes
- **Affected question:** Q4
- **Suggested halt-loop checkpoint:** Q4 greps `tool\|function\|FunctionCall\|ToolCall` in `codex-rs/protocol/src/openai_models.rs`. The structured-tool-call evidence that actually exists is `ToolMode` (`:299`), `supports_parallel_tool_calls` (`:379`), and the tool-type config enums (`:265`/`:275`/`:283`) — not a literal `FunctionCall`/`ToolCall` *call* struct. Add a checkpoint: "if the narrow grep yields only config-type hits, broaden to `Tool|tool` and confirm the structured (JSON, non-text) representation before marking Q4 done — do NOT mark BLOCKED on the narrow pattern alone." The question IS answerable (codex represents tools structurally, never as a text dialect); only the grep pattern risks a false BLOCKED.

### EC-3: transform.ts is 1543 lines — "Read each hotspot end-to-end" (D2) risks blowing the 1.0h opencode budget
- **Affected question:** Q1, Q3, Q5 (all three target the same 1543-line file)
- **Suggested halt-loop checkpoint:** Add to the per-project budget checkpoint: "bound each Read to the hotspot function range (`sanitizeSurrogates` `:25-30`, `normalizeMessages` `:65-130`, call-site `:432`), NOT the whole 1543-line file." D2 says "Read each hotspot end-to-end" — without an explicit range bound, a literal full-file Read on a 1543-line module three times over (Q1/Q3/Q5) would consume the opencode budget before codex (Q4) runs. The hotspots are already line-anchored in the plan, so the fix is a one-line scope reminder.

## DOCUMENT

### EC-4: the authoritative pattern is in-repo (`think-tag-extractor.ts`), not under references/ — blueprint must cite it as in-repo `file:line`, never as `Blueprint §` or a references/ path
- **Affected question:** N/A (cross-cutting, ADR D1)
- **Accepted risk:** The plan correctly grounds the design on the in-repo `packages/agents/src/bridge/think-tag-extractor.ts` precedent and its Acceptance Criteria already allow in-repo `packages/...` citations. The residual risk is purely a citation-form trap at `/discover-confidence` time: its `fabricated_citation` hard cap validates `knowledge-base/references/{...}` paths, and (per the no-progress-signature run gotcha) the `Blueprint §"X"` reference form mis-resolves against repo-root blueprints. The blueprint produced by `/discover-execute` MUST cite the think-tag precedent by its **full in-repo path with slashes** (`packages/agents/src/bridge/think-tag-extractor.ts:NN`), never as `Blueprint §` and never under a references/ prefix. This is a known, accepted convention — recorded here so `/discover-execute` honors it rather than re-discovering it.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 1 (shared) | 0 | 1 (EC-3) | 0 |
| Q2 | 1 | 1 (EC-1) | 0 | 0 |
| Q3 | 1 (shared) | 0 | 1 (EC-3) | 0 |
| Q4 | 1 | 0 | 1 (EC-2) | 0 |
| Q5 | 1 (shared) | 0 | 1 (EC-3) | 0 |
| cross | 1 | 0 | 0 | 1 (EC-4) |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT

> One MUST FIX (EC-1: Q2 reference path). The fix is a path swap to a sibling file that
> demonstrably contains the mapping (verified 46 matches) — not a scope expansion, not a
> new question. The two SHOULD TEST items are halt-loop checkpoints (grep-broadening + Read
> range-bounding), and EC-4 is an accepted citation-form convention. After bumping the plan
> to v1.1 with EC-1 absorbed, proceed to `/discover-plan-confidence`.
