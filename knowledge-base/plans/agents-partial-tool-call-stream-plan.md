---
slug: agents-partial-tool-call-stream
created_at: 2026-07-02
goal: Expose the SDK's partial-tool-call as a typed AgentStreamEvent so consumers can stream tool-input progressively.
---

# Plan: `@theokit/agents` — surface `partial-tool-call` as a typed stream event

> **Version 1.0** — `AgentRunner.stream()` currently DROPS the SDK's `PartialToolCallUpdate` (`translateInteractionUpdate` routes it to `default → []`), so downstream apps cannot render tool arguments progressively as the model generates them (visible "dead air" for large Write/Edit bodies). This plan adds a typed `PartialToolCallEvent` (`type:'partial_tool_call'`) to the `AgentStreamEvent` union, translates the SDK's `partial-tool-call` update into it, and exports it + a type-guard — WITHOUT duplicating the existing `tool_call` event (distinct lifecycle points: partial args stream → `partial_tool_call`; args committed → `tool_call`; result → `tool_result`). Closes usetheodev/theokit-sdk#70. Mirrors ai-sdk's `tool-input-start/delta/available`.

## Goal

> "Add a typed `PartialToolCallEvent` to `@theokit/agents` and translate the SDK `partial-tool-call` update into it, so a consumer receives progressive tool-input, measured by `pnpm --filter @theokit/agents test` passing (incl. a new RED→GREEN test asserting `translateInteractionUpdate({type:'partial-tool-call', …})` emits exactly one `partial_tool_call` event) with `typecheck` and `lint` clean."

## Context

Issue usetheodev/theokit-sdk#70 (filed 2026-07-02): the `@theokit/sdk` already emits the tool-call lifecycle `partial-tool-call → tool-call-started → tool-call-completed` (`packages/sdk/src/types/updates.ts:51-82`), but `@theokit/agents`' `translateInteractionUpdate` deliberately ignores `partial-tool-call` (`event-translator.ts:178` comment: "incremental args would duplicate the tool_call"). That reasoning is stale: emitting a **distinct** event type (not another `tool_call`) does not duplicate — it fills the arg-streaming window that `tool-call-started` (args committed) closes. Discovered via a theocode↔ai-sdk cross-codebase analysis (2026-07-02); the `/to-plan` feasibility gate on the theocode side confirmed the gap lives in this framework layer.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/bridge/agent-stream-events.ts` | ~175 | `16e24a3` (2026-07-02) | Defines the typed `AgentStreamEvent` union + interfaces + type-guards | Existing 14 variants + guards unchanged; only ADD a variant + guard |
| `packages/agents/src/bridge/event-translator.ts` | ~235 | `16e24a3` (2026-07-02) | Translates SDK `SDKMessage`/`InteractionUpdate` → `StreamEvent[]` | `tool-call-started`→`tool_call` and `tool-call-completed`→`tool_result` MUST stay byte-identical; NO second `tool_call` emitted for partials |
| `packages/agents/src/bridge/index.ts` | — | — | Public barrel of the bridge surface | Export the new interface + guard alongside `ToolCallEvent`/`isToolCall` |
| `packages/agents/tests/unit/event-translator.test.ts` | — | — | Unit tests for the translator (25 passing today) | Existing 25 stay green; ADD the partial-tool-call case |

### Current callers / dependents

- **Symbol:** `translateInteractionUpdate(update)` in `event-translator.ts:180` — Callers (production): `packages/agents/src/bridge/sdk-adapter.ts` (the real-time `onDelta` path). Callers (tests): `tests/unit/event-translator.test.ts`, `tests/integration/sdk-adapter-translation.test.ts`. External: yes — it feeds the public `AgentStreamEvent` stream consumed by every downstream app (theocode included).
- **Symbol:** `AgentStreamEvent` union in `agent-stream-events.ts:136` — Callers: every consumer of `AgentRunner.stream()`. Adding a NON-breaking union member (new `type` literal) is backward-compatible: existing `switch`/guards fall through their `default` unchanged.

### Domain glossary

- **partial-tool-call** — SDK `InteractionUpdate` carrying incrementally-growing `toolCall.args` as the model streams a tool call's arguments (before they are committed).
- **tool-call-started** — SDK update when the tool call's args are COMMITTED (final); the agents layer maps it to the `tool_call` event.
- **AgentStreamEvent** — the typed, public discriminated union `AgentRunner.stream()` yields.
- **translateInteractionUpdate** — the pure fn mapping ONE SDK `InteractionUpdate` → zero-or-more `StreamEvent`s in arrival order.

### Architecture boundaries affected

The change stays inside the `@theokit/agents` bridge layer (SDK→AgentStreamEvent adapter). It ADDS a union member + a translation case — no new dependency, no cross-package edge. `@theokit/sdk` already ships `PartialToolCallUpdate` (consumed here as a type import), so no SDK change is required.

## Prior Art & Related Work

- **Issue:** usetheodev/theokit-sdk#70 — the tracked request, with file:line evidence + suggested fix.
- **SDK source:** `packages/sdk/src/types/updates.ts:63-70` (`PartialToolCallUpdate`), `:170-172` (union already includes it).
- **Reference design:** ai-sdk (`vercel/ai`) `packages/ai/src/ui-message-stream/ui-message-chunks.ts` — the `tool-input-start` / `tool-input-delta` / `tool-input-available` triad; this plan implements the "delta" surface for theokit.
- **Existing translator precedent:** `event-translator.ts:107-113` (#42 — emits `tool_call` at tool start so the UI shows a running card) — the partial event complements it, it does not replace it.

## Objective

- [ ] Sub-goal 1 — `PartialToolCallEvent` interface added to `agent-stream-events.ts` + to the `AgentStreamEvent` union + `isPartialToolCall` guard.
- [ ] Sub-goal 2 — `translateInteractionUpdate` handles `case 'partial-tool-call'` → emits ONE `partial_tool_call` event carrying `callId`/`toolName`/`input`; stale "intentionally ignored" comment removed/corrected.
- [ ] Sub-goal 3 — new interface + guard exported from `bridge/index.ts`.
- [ ] Sub-goal 4 — RED→GREEN unit test proves the translation; existing 25 translator tests + full agents suite + typecheck + lint stay green.

## ADRs

### D1 — Emit a DISTINCT `partial_tool_call` event, not another `tool_call`

- **Decision:** the SDK `partial-tool-call` update maps to a NEW event type `partial_tool_call`, separate from `tool_call`.
- **Rationale:** the historical "would duplicate the tool_call" concern (`event-translator.ts:178`) only holds if partials reuse the `tool_call` type. A distinct type sits at a distinct lifecycle point (args-streaming) that `tool-call-started` (args-committed) closes — mirroring ai-sdk's `tool-input-delta` vs `tool-input-available`. Consumers opt in; existing consumers ignore the unknown type (backward-compatible).
- **Alternatives considered:** (a) reuse `tool_call` with a `partial:true` flag — rejected: overloads one type, breaks the "one `tool_call` per call" invariant existing consumers rely on (e.g. UI running-card dedup); (b) keep ignoring it — rejected: that IS the bug (#70).
- **Consequences:** adds one union member (non-breaking); consumers gain progressive tool-input; the running-card + result flow is untouched.

### D2 — Shape `partial_tool_call` to mirror `tool_call` (callId, toolName, input)

- **Decision:** `{ type:'partial_tool_call'; callId:string; toolName:string; input:unknown }`.
- **Rationale:** parity with `ToolCallEvent` (`agent-stream-events.ts:15`) minimizes consumer cognitive load and lets a UI reuse the same accessors; `input` carries the partial `toolCall.args` (the SDK's incremental payload).
- **Alternatives considered:** an `inputTextDelta:string` raw-delta field (ai-sdk style) — rejected for v1: the SDK's `PartialToolCallUpdate.toolCall.args` is already a (growing) structured value, not a raw text delta; exposing `input` (the current partial args) is the faithful, no-transform surface. A raw-delta variant can be added later if the SDK exposes one.
- **Consequences:** consumers render the latest partial args; no lossy transform.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| A naive consumer that renders EVERY `partial_tool_call` as a new card would duplicate UI | Medium | It is a distinct type consumers opt into by `id`-correlation (same `callId` as the later `tool_call`); documented in the interface JSDoc | implementer |
| The SDK may emit many partials per call (chatty stream) | Low | Pure passthrough — no buffering added here; downstream can throttle. No perf regression in the translator (O(1) per update) | implementer |
| Union growth could theoretically break an exhaustive `switch` with no default in a strict consumer | Low | All in-repo consumers use `default`/guards; adding a union member is a MINOR (non-breaking) semver change, noted in CHANGELOG | implementer |

## Unresolved Questions

- Q1 — should `partial_tool_call` also fire a leading `tool_call` with empty args at first-partial (ai-sdk `tool-input-start`)? Deferred: `tool-call-started` already provides the committed `tool_call`; a separate "start" is out of scope for #70 (the delta is the ask). Documented as a follow-up.
- Q2 — does `sdk-adapter.ts` need a change, or does it already forward whatever `translateInteractionUpdate` returns? (Resolved during T1.1 read: it maps 1:1, so no change expected — verify.)

## Dependency Graph

```
Phase 1 (types + guard) ──▶ Phase 2 (translate + export) ──▶ Phase 3 (Integration Validation)
```

Sequential: the translator case (Phase 2) depends on the `PartialToolCallEvent` type (Phase 1). Small enough that both land in one commit, but ordered for TDD clarity.

---

## Phase 1: type + guard

**Objective:** add the typed `PartialToolCallEvent` to the union + a guard, so the translator has a type to emit.

### T1.1 — Add `PartialToolCallEvent` + union member + `isPartialToolCall`

#### Objective
Add the interface, extend the `AgentStreamEvent` union, add the type-guard, mirroring `ToolCallEvent`/`isToolCall`.

#### Why this step (action + reasoning)

1. **What this step does** — adds `interface PartialToolCallEvent` next to `ToolCallEvent`, appends `| PartialToolCallEvent` to the union, adds `isPartialToolCall`.
2. **Why it is necessary now** — the translator (Phase 2) must return a TYPED event; the type must exist first (D1/D2). Non-breaking union growth (Baseline § callers).

#### Evidence
`agent-stream-events.ts:15-22` (`ToolCallEvent`), `:136-150` (union), `:156-158` (`isToolCall`). SDK partial shape: `packages/sdk/src/types/updates.ts:63-70`.

#### Files to edit
```
packages/agents/src/bridge/agent-stream-events.ts — add interface + union member + guard
packages/agents/src/bridge/index.ts — export PartialToolCallEvent + isPartialToolCall
```

#### Deep file dependency analysis
- `agent-stream-events.ts` (Baseline row): additive only; existing 14 variants + 6 guards untouched. Downstream: every `AgentStreamEvent` consumer — safe (new literal, default-fall-through).
- `index.ts`: barrel re-export; add the two names next to the tool-call exports.

#### Deep Dives
- **Invariant:** existing union members + guards byte-identical. **Edge case:** the new guard must narrow correctly (`e.type === 'partial_tool_call'`).

#### Tasks
1. Add `interface PartialToolCallEvent { type:'partial_tool_call'; callId:string; toolName:string; input:unknown }` with JSDoc noting the same `callId` correlates to the later `tool_call`.
2. Append `| PartialToolCallEvent` to `AgentStreamEvent`.
3. Add `export function isPartialToolCall(e: AgentStreamEvent): e is PartialToolCallEvent`.
4. Export both from `bridge/index.ts`.

#### TDD

RED: add a `.test-d`-style / runtime assertion in `event-translator.test.ts` (Phase 2 covers the behavior); for the type layer, the GREEN of T2.1's test transitively requires this type — a standalone type test is optional. The executable RED lives in T2.1 (`it('test_partial_tool_call_update_is_translated')` asserting `expect(events).toEqual([{ type:'partial_tool_call', callId:'c1', toolName:'write_file', input:{ path:'a.ts' } }])`).

GREEN: implement steps 1-4 so the emitted object typechecks against `PartialToolCallEvent`.

REFACTOR: None expected.

VERIFY: `pnpm --filter @theokit/agents typecheck`

#### Concurrency tests (only when applicable)

(none — single-threaded) — pure type + guard additions, no shared state.

#### Acceptance Criteria
- [ ] `grep -q "partial_tool_call" packages/agents/src/bridge/agent-stream-events.ts` returns 0 (interface present).
- [ ] `isPartialToolCall` exported: `grep -q "isPartialToolCall" packages/agents/src/bridge/index.ts` returns 0.
- [ ] Pass: typecheck — `pnpm --filter @theokit/agents typecheck` exits 0.
- [ ] Pass: size — changed files ≤ 500 lines (`wc -l` on both).

#### DoD
- [ ] `pnpm --filter @theokit/agents typecheck` clean.
- [ ] `pnpm --filter @theokit/agents lint` clean.
- [ ] Union member is additive (existing tests unaffected).

---

## Phase 2: translate + export

**Objective:** translate the SDK `partial-tool-call` update into the new event (TDD).

### T2.1 — Handle `case 'partial-tool-call'` in `translateInteractionUpdate`

#### Objective
Emit ONE `partial_tool_call` event from the SDK `partial-tool-call` update; correct the stale comment.

#### Why this step (action + reasoning)

1. **What this step does** — replaces the `default → []` swallow of `partial-tool-call` with an explicit `case` emitting the typed partial event; fixes the docstring at `:176-178`.
2. **Why it is necessary now** — this IS the fix for #70; it depends on the T1.1 type (D1).

#### Evidence
`event-translator.ts:180-210` (`translateInteractionUpdate`), `:176-178` (the stale "intentionally ignored" comment), `:186-193` (`tool-call-started` precedent shape). SDK: `updates.ts:63-70`.

#### Files to edit
```
packages/agents/src/bridge/event-translator.ts — add case 'partial-tool-call' + fix comment
packages/agents/tests/unit/event-translator.test.ts — RED test first (TDD)
```

#### Deep file dependency analysis
- `event-translator.ts` (Baseline row): the `tool-call-started`/`tool-call-completed`/`text-delta`/`thinking-delta` cases stay byte-identical; only the `default` loses `partial-tool-call` (now an explicit case). Downstream: `sdk-adapter.ts` forwards the returned array unchanged (Q2) — no change there.

#### Deep Dives
- **Invariant:** exactly ONE `partial_tool_call` per `partial-tool-call` update; NO extra `tool_call` (D1 — no duplication). **Edge case:** `toolCall.args` undefined → `input: {}` (mirror `tool-call-started`'s `?? {}`). **Edge case:** existing 25 tests must stay green (regression net).

#### Pseudo-code / Signatures
```pseudocode
case 'partial-tool-call':
  return [{
    type: 'partial_tool_call',
    callId: update.callId,
    toolName: update.toolCall.name,
    input: update.toolCall.args ?? {},
  }]

# Example
input:  { type:'partial-tool-call', callId:'c1', toolCall:{ name:'write_file', args:{ path:'a.ts' } }, modelCallId:'m1' }
output: [{ type:'partial_tool_call', callId:'c1', toolName:'write_file', input:{ path:'a.ts' } }]
```

#### Tasks
1. Write the RED test `test_partial_tool_call_update_is_translated` in `event-translator.test.ts` asserting the exact output above; run it → FAIL (today `default → []`).
2. Add the `case 'partial-tool-call'` to `translateInteractionUpdate`.
3. Replace the `:176-178` docstring "intentionally ignored" note with the new behavior.
4. Add a second RED assertion: `test_partial_tool_call_does_not_duplicate_tool_call` — the partial update emits ZERO `tool_call` events (D1 invariant).

#### TDD
RED: `it('test_partial_tool_call_update_is_translated')` — `const out = translateInteractionUpdate(partialUpdate); expect(out).toEqual([{ type:'partial_tool_call', callId:'c1', toolName:'write_file', input:{ path:'a.ts' } }])` — FAILS before the case exists (returns `[]`).
RED: `it('test_partial_tool_call_emits_no_tool_call')` — `const calls = out.filter(isToolCallType); expect(calls).toHaveLength(0)`.
GREEN: add the case; both pass.
REFACTOR: None expected.
VERIFY: `pnpm --filter @theokit/agents test -- event-translator`

#### Concurrency tests (only when applicable)
(none — single-threaded) — pure synchronous translation.

#### Acceptance Criteria
- [ ] RED proven: `pnpm --filter @theokit/agents test -- event-translator` exits non-zero on the new test BEFORE the case is added (captured in the implementation log).
- [ ] GREEN: `pnpm --filter @theokit/agents test -- event-translator` → all (25 + new) pass.
- [ ] D1 invariant test passes (zero `tool_call` from a partial update).
- [ ] Pass: lint — `pnpm --filter @theokit/agents lint` zero warnings on changed files.

#### DoD
- [ ] Full agents suite green: `pnpm --filter @theokit/agents test`.
- [ ] `pnpm --filter @theokit/agents typecheck` clean.
- [ ] CHANGELOG (agents package) updated under `[Unreleased]` (MINOR — additive union member).
- [ ] Commit `feat(agents): surface partial-tool-call as PartialToolCallEvent (closes theokit-sdk#70)`.

---

## Coverage Matrix

| # | Gap / Requirement (issue #70) | Task(s) | Resolution |
|---|---|---|---|
| 1 | SDK `partial-tool-call` dropped by the agents layer | T2.1 | Explicit `case` emits `partial_tool_call` |
| 2 | No typed event for partial tool-input | T1.1 | `PartialToolCallEvent` added to the union + guard |
| 3 | Must not duplicate `tool_call` (stale-comment concern) | T2.1 (D1 test) | Distinct type; invariant test proves zero extra `tool_call` |
| 4 | Public surface must export it | T1.1 | `bridge/index.ts` exports interface + guard |
| 5 | No regression to existing translation | T2.1 | 25 existing translator tests stay green |

**Coverage: 5/5 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases complete.
- [ ] `pnpm --filter @theokit/agents test` green (25 existing + new).
- [ ] `pnpm --filter @theokit/agents typecheck` zero errors.
- [ ] `pnpm --filter @theokit/agents lint` zero warnings.
- [ ] Files ≤ 500 lines.
- [ ] CHANGELOG `[Unreleased]` updated (additive, MINOR).
- [ ] Backward-compat: union growth is non-breaking; existing consumers unaffected.
- [ ] Issue theokit-sdk#70 referenced in the commit + PR; cross-repo note (fix lives in `theokit`, issue tracked in `theokit-sdk`).

## Failure scenarios (when I/O external)

```
(none — no external I/O touched)
```
Pure in-process translation of a discriminated union; no HTTP/DB/queue.

## Final Phase: Integration Validation (MANDATORY)

**Objective:** validate the new event flows end-to-end through the translator + adapter, with the full agents suite green.

### Execution
```
pnpm --filter @theokit/agents test          # 25 existing translator + new partial tests + full suite
pnpm --filter @theokit/agents typecheck     # zero type errors
pnpm --filter @theokit/agents lint          # zero warnings
grep -n "partial-tool-call" packages/agents/src/bridge/event-translator.ts   # case present, stale comment gone
```

### Acceptance Criteria
- [ ] Full agents suite green: `pnpm --filter @theokit/agents test` exits 0 (unit + integration).
- [ ] Zero type/lint errors: `pnpm --filter @theokit/agents typecheck` and `pnpm --filter @theokit/agents lint` exit 0.
- [ ] `partial_tool_call` emitted for a `partial-tool-call` update AND zero duplicate `tool_call` (D1).
- [ ] `bridge/index.ts` exports `PartialToolCallEvent` + `isPartialToolCall`.

### If Validation Fails
1. Identify plan-caused vs pre-existing (the repo has in-flight audit-trail churn — unrelated).
2. Fix plan-caused failures; re-run.
3. Pre-existing issues documented in the PR, not blockers.
