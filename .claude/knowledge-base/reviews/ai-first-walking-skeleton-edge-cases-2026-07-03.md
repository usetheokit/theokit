# Discover Edge Case Review — ai-first-walking-skeleton

Date: 2026-07-03
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/ai-first-walking-skeleton-plan.md
Research questions analyzed: 7
Edge cases found: 6 (MUST FIX: 2, SHOULD TEST: 3, DOCUMENT: 1)

## MUST FIX

### EC-1: Version↔protocol skew — the pinned version must be the one whose chunk schema was studied
- **Affected question:** Q1, Q3, Q4
- **Family:** Dependency / Interpretation
- **Scenario:** Q1/Q3 read the `UIMessageChunk` schema + wire headers from the `references/ai-sdk` clone (`ai@7.0.14` / `@ai-sdk/react@4.0.15` — likely internal workspace numbers). Q4 will pin the **npm-published** stable line (currently `ai@5.x`/`@ai-sdk/react` published), which may serialize a different chunk shape or protocol header value (`x-vercel-ai-ui-message-stream: v1` vs another). If we study v7 and ship against v5, `useChat` silently fails to render.
- **Impact:** The blueprint's chunk sequence + wire contract could describe a version we don't ship, breaking the M0 skeleton after implementation — exactly the "no rework" the goal forbids.
- **Suggested fix:** Add to D3/Q4 a gate: the pinned `@ai-sdk/react` version MUST equal the version whose chunk schema (Q1) + headers (Q3) were read; if the npm-stable line differs from the clone, re-read Q1/Q3 against the pinned version's published types before answering.

### EC-2: Test determinism vs "real provider" DoD — split the automated test from the provider smoke
- **Affected question:** Q7
- **Family:** Method / Scope
- **Scenario:** M0's DoD says the agent emits from a "real provider (Anthropic/OpenRouter)". A green **automated** integration/E2E test cannot depend on a live LLM call (non-deterministic, network-flaky — violates `testing.md` §3 determinism). If Q7 wires the test straight to a real provider, the suite is flaky.
- **Impact:** Either a flaky CI test (rejected) or a non-deterministic "green" that isn't trustworthy evidence.
- **Suggested fix:** Q7 must yield TWO artifacts: (a) a **deterministic** integration test driving the translator+SSE from a fixed `@theokit/sdk` SDKMessage fixture (mock `run.stream()`), asserting `useChat`-shaped chunks; (b) a separate **manual smoke** with a real provider recorded as evidence for the DoD's "real provider" clause. The automated gate is (a); (b) is recorded evidence, not a CI dependency.

## SHOULD TEST

### EC-3: Frame chunks (start/finish + message id) are mandatory, not just text-*
- **Affected question:** Q1
- **Suggested halt-loop checkpoint:** Before marking Q1 done, assert the answer lists the message-frame chunks (`start`, `finish`) and the message `id` field — not only `text-start`/`text-delta`/`text-end`. `useChat` needs the frame to open/close a message; a text-only chunk stream may render nothing.

### EC-4: Which bridge branch carries the text (onDelta vs run.stream)
- **Affected question:** Q2
- **Suggested halt-loop checkpoint:** Q2 must determine whether text flows via `translateInteractionUpdate` (onDelta `text-delta`) or `translateSdkEvent` (run.stream `assistant`) in the observed config, and whether `mergeDeltaStream`'s dedup would drop/duplicate a second (UIMessageStream) emission. Translate at the branch that actually carries the live text, without a dedup carve-out (mirror the lesson from `tool-call-input-surfacing`).

### EC-5: Question order dependency — Q1,Q3,Q4 before Q7 and Q2
- **Affected question:** Q7, Q2
- **Suggested halt-loop checkpoint:** Q7 (test/skeleton) needs the chunk sequence (Q1) + wire (Q3) + pinned version (Q4) answered first; Q2 (translation point) needs Q1's target shape. Add an explicit order note: answer Q1→Q3→Q4, then Q2, then Q7.

## DOCUMENT

### EC-6: assistant-ui pins a different @ai-sdk/react major than the ai-sdk clone
- **Affected question:** Q4
- **Accepted risk:** assistant-ui pins `@ai-sdk/react@^3` / `ai@^6` while the `references/ai-sdk` clone is `@ai-sdk/react@4.0.15` / `ai@7.0.14`. Use assistant-ui as **conceptual** corroboration of the `message.parts` contract (which part types a consumer maps), NOT as a byte-exact reference for the chunk wire of the version we pin. Cross-version parts contracts are stable enough for this; the wire is version-locked to Q1/Q3.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 2 | 1 (EC-1) | 1 (EC-3) | 0 |
| Q2 | 1 | 0 | 1 (EC-4) | 0 |
| Q3 | 1 | 1 (EC-1) | 0 | 0 |
| Q4 | 2 | 1 (EC-1) | 0 | 1 (EC-6) |
| Q5 | 0 | 0 | 0 | 0 |
| Q6 | 0 | 0 | 0 | 0 |
| Q7 | 2 | 1 (EC-2) | 1 (EC-5) | 0 |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT (2 MUST FIX absorbed into plan v1.1)
