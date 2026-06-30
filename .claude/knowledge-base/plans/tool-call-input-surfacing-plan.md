---
slug: tool-call-input-surfacing
created_at: 2026-06-30
goal: Populate the @theokit/agents tool_call StreamEvent input from the SDK message's args field so consumer tool cards show the command (theokit#58)
---

# Plan: Tool-call input surfacing (theokit#58)

## Goal

Fix `@theokit/agents`' `translateToolCallEvent` so the emitted `tool_call` StreamEvent's `input` is populated from the SDK message's real `args` field — verified by a RED→GREEN unit test asserting `translateSdkEvent({type:'tool_call', status:'running', args:{command:'x'}})` yields a `tool_call` whose `input` deep-equals `{command:'x'}` (today `{}`).

## Context

theokit#58: agent tool cards render blank because the surfaced `tool_call` event carries `input: {}`. Discovery (`knowledge-base/discoveries/blueprints/tool-call-input-surfacing-blueprint.md`, SHIPPABLE_WITH_CAVEATS 89) established — via a live `TC-DIAG` capture on Node 24 + real OpenRouter, corroborated by the SDK type — that the live path is the `run.stream()` SDKMessage `running` branch in `packages/agents/src/bridge/event-translator.ts:106-109`, whose args arrive complete in **`msg.args`**, but the code reads `msg.input ?? msg.arguments` (both `undefined`) → `{}`. The blueprint's chosen decision (read `msg.args` first) is implemented here as ADR D1 below; the blueprint's earlier completed-patch hypothesis (with dedup relaxation) was refuted by the live capture and is NOT implemented (YAGNI).

This plan complies with: `rules/architecture.md` (bridge is the only SDK→event adapter; G8 Web Standards — unchanged), `rules/testing.md` (RED regression test before fix; cover edge + negative cases), `rules/system-design-guardrails.md` G2 (SDK is the only runtime — pure mapping, no new runtime) + G7 (every export has a test), and `rules/error-handling.md` (defensive fallbacks, no swallowing).

## Baseline Context

### Files that will be touched

| File | LoC | Last touch | Why it exists / role |
|---|---|---|---|
| `packages/agents/src/bridge/event-translator.ts` | 203 | `git log -1` (bridge SDK→AgentStreamEvent translator) | Translates SDK `SDKMessage` + `InteractionUpdate` into `AgentStreamEvent`. The `translateToolCallEvent` `running` branch (`:106-109`) is the defect site. |
| `packages/agents/tests/unit/event-translator.test.ts` | (existing) | bridge test suite | Regression baseline; has tool_call cases incl. the #42 `running` case (`:124-140`) and #44 update cases. New RED test added here. |

### Current callers / dependents (from blueprint + grep)

- `translateToolCallEvent` is dispatched by `translateSdkEvent` (`event-translator.ts:153 case 'tool_call'`), which is consumed by `createSdkAgentStream` / `mergeDeltaStream` in `packages/agents/src/bridge/sdk-adapter.ts:276-311`. theocode's `runCodeAgent` consumes that stream and re-maps via `server/runtime/agents-event-translator.ts:46` (`args: asRecord(e.input)`).
- SDK type: `SDKToolUseMessage = { type:'tool_call'; call_id; name; status; args?: unknown; result? }` (`node_modules/@theokit/sdk/dist/run-D22b53SU.d.ts:479-486`). Field is `args`.
- Live ground truth (TC-DIAG): `running` SDKmsg has `args={"command":"echo TCDIAG-ARGS-77"}`, `input=undefined`, `arguments=undefined`.

### Domain glossary

- **SDKMessage path** — `run.stream()` yields `SDKMessage`; `translateSdkEvent` translates it. The LIVE path for tools.
- **onDelta path** — `translateInteractionUpdate` handles low-level `InteractionUpdate` (`tool-call-started`/`partial-tool-call`/`tool-call-completed`); NOT used for tools in the observed config.
- **`AgentToolCallEvent`** — `{ type:'tool_call', callId, toolName, input }` (`agent-stream-events.ts`).

### Architecture boundaries affected

The change is confined to the bridge translator (`packages/agents/src/bridge/`), the single legitimate SDK→event adapter (G2). No layer crossing, no new export, no Node API.

## Prior Art & Related Work

- Blueprint `knowledge-base/discoveries/blueprints/tool-call-input-surfacing-blueprint.md` (this discovery) — the Empirical Correction (live TC-DIAG) + the chosen-decision ADR, plus the opencode/codex comparison.
- opencode `tool-stream.ts` (assemble-by-id-then-parse) — informs the rejected fallback, not the chosen fix.
- Sibling streaming-DX fixes #40/#41/#42 (`packages/agents/src/bridge/event-translator.ts` history) — same translator, same class of tool-card observability bug.

## ADRs

### D1 — Read `msg.args` first in the running branch (implements the blueprint's chosen decision)

**Decision:** In `translateToolCallEvent`'s `status === 'running'` branch, resolve `input: msg.args ?? msg.input ?? msg.arguments ?? {}` (lead with the real SDK field `args`; keep the prior two as defensive cross-shape fallbacks).

**Rationale:** The SDK `SDKToolUseMessage` field is `args` (`run-D22b53SU.d.ts:486`), live-confirmed populated; the prior `msg.input ?? msg.arguments` never matched the SDK shape. One-field correction; no architecture change.

**Alternatives considered:** (a) The blueprint's earlier completed-event patch + relax `sdk-adapter.ts` dedup: REJECTED — the live capture proved the patched path (onDelta) isn't used for tools; it adds a second event + dedup carve-out for zero benefit (KISS/YAGNI). (b) Full opencode-style `partial-tool-call` buffering: REJECTED — args are already complete on the running message; buffering re-derives what the SDK hands over. (c) Replace fallbacks entirely with just `msg.args`: REJECTED — keeping the defensive fallbacks is cheap and guards cross-realm/alternate shapes (error-handling.md).

**Consequences:** Card fills with the real command; #42 (single running card) + #44 (order) preserved; no new dep; no dedup change. The `tool-call-started` onDelta branch is left reading `update.toolCall.args` (already correct) for providers that use it.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` | `>=2.11.2` (peer; resolved 2.9.0) | npm | Provides `SDKToolUseMessage.args` — the field the fix reads. Type-only import already present (`event-translator.ts:8`). |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | The fix is pure bridge mapping over an existing typed field — no library solves "read the right field"; adding one would violate KISS. | n/a |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## Dependency Graph

- Phase 1 (fix + unit test) has no internal blockers.
- Phase 2 (integration test) depends on Phase 1.
- Final Phase (Integration Validation) depends on Phases 1-2.

## Phase 1 — Fix the running-branch field + RED unit test

### Task T1.1 — RED→GREEN: running tool_call surfaces `msg.args` as `input`

#### Why this step
The defect is `translateToolCallEvent` reading the wrong field; the regression test must capture the exact bug (running message with `args` populated → emitted `input` empty) before the fix, per `rules/testing.md`. Reasoning: a unit test on the pure translator is the fastest deterministic proof (no SDK/LLM), and it locks the behavior so #40/#41/#42-style future edits can't regress it.

#### Files to edit
- `packages/agents/tests/unit/event-translator.test.ts` — add RED test(s).
- `packages/agents/src/bridge/event-translator.ts` — GREEN: running branch `input: msg.args ?? msg.input ?? msg.arguments ?? {}`.

#### Deep file dependency analysis
`translateToolCallEvent` (`event-translator.ts:80-109`) is called by `translateSdkEvent` (`:153`), consumed by `sdk-adapter.ts:276-311`. Changing only the `input` resolution expression is backward-compatible: callers receive the same `AgentToolCallEvent` shape with a now-populated `input`. The existing #42 test (`event-translator.test.ts:124-140`) asserts the running branch with `msg.input` — verify it still passes (the fallback chain keeps `msg.input` honored) OR update it to the SDK-true `args` field.

#### TDD
- RED: `test_running_tool_call_surfaces_args_as_input` — `translateSdkEvent({type:'tool_call', call_id:'c1', name:'shell_exec', status:'running', args:{command:'echo hi'}}, 'run1')` → expect one event `{type:'tool_call', callId:'c1', toolName:'shell_exec', input:{command:'echo hi'}}`. Fails today (input `{}`).
- GREEN: change the running branch to `input: msg.args ?? msg.input ?? msg.arguments ?? {}`.
- Negative case: `test_running_tool_call_absent_args_is_empty_object` — running message with NO `args`/`input`/`arguments` → `input` deep-equals `{}` (no throw; defensive).
- Edge case: `test_running_tool_call_args_takes_precedence_over_legacy_fields` — message with BOTH `args:{a:1}` and `input:{b:2}` → `input` equals `{a:1}` (args wins).
- REFACTOR: none expected (single expression).

#### Concurrency tests
(none — single-threaded pure function; no shared state, no async)

#### Acceptance criteria
- `npx vitest run packages/agents/tests/unit/event-translator.test.ts` passes including the 3 new cases (RED before, GREEN after).
- The #42 existing running test (`:124-140`) still passes.
- `input` is the SDK `args` object verbatim (deep-equal), not a re-serialized/stringified form.

#### DoD
- `npx vitest run packages/agents/tests/unit/event-translator.test.ts` exits 0.
- `npx tsc --noEmit -p packages/agents/tsconfig.json` (or test tsconfig) clean.
- CHANGELOG `[Unreleased] § Fixed` updated.

## Phase 2 — Integration test through the adapter

### Task T2.1 — adapter emits a populated-input tool_call end-to-end

#### Why this step
T1.1 tests the pure translator; the wiring boundary (`sdk-adapter.ts` merge/dedup) is what the unit test mocks. An integration test feeding a running `tool_call` SDKMessage through `createSdkAgentStream`/`mergeDeltaStream` and asserting the consumer receives `tool_call` with populated `input` (and is not dropped by dedup) proves the fix survives the real emit path. Reasoning: closes the "unit green but pipeline drops it" gap (`rules/testing.md` integration tier; wiring triad pillar b).

#### Files to edit
- `packages/agents/tests/integration/sdk-adapter-streaming.test.ts` (existing) OR a new `tests/integration/` file — add a case driving a mock SDK stream with a running `tool_call` carrying `args`, asserting the emitted `AgentStreamEvent` `tool_call.input` is populated.

#### Deep file dependency analysis
`createSdkAgentStream` (`sdk-adapter.ts`) + `mergeDeltaStream` (`:276-311`) + the dedup (`isDuplicatedByDelta`, `:253-265`). Use the existing mock-stream harness (`tests/unit/mock-stream.test.ts` / `createMockAgentStream`) per G2 (no real LLM). Assert exactly one `tool_call` with populated `input` reaches the consumer.

#### TDD
- RED/GREEN: `test_adapter_emits_tool_call_with_populated_input` — mock SDK stream yields a running `tool_call` (`args:{command:'ls'}`) then a completed result; assert the consumer sees a `tool_call` event with `input:{command:'ls'}` (passes only with the T1.1 fix).
- Negative case: a running `tool_call` with no args → consumer sees `input:{}` (no throw, no dropped stream).

#### Failure scenarios
See `## Failure scenarios`.

#### Acceptance criteria
- The integration test passes with the fix and fails without it (toggle-verified).
- No duplicate `tool_call` for the same `callId` is introduced (dedup unchanged).

#### DoD
- `npx vitest run packages/agents/tests/integration/sdk-adapter-streaming.test.ts` exits 0.

## Failure scenarios

| External dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| SDK message shape drift | `args` absent / renamed on a future SDK | Unit negative-case feeds a running message with no `args`/`input`/`arguments` | `input` defaults to `{}` — no throw, stream continues (defensive `?? {}`) |
| Non-object args | `args` is a primitive/string | Unit case with `args:"raw"` | `input` carries the value as-is (consumer/`asRecord` handles coercion); no crash |

## Coverage Matrix

| # | Goal claim / requirement | Task | Test |
|---|---|---|---|
| 1 | Running `tool_call` surfaces `msg.args` as `input` | T1.1 | `test_running_tool_call_surfaces_args_as_input` |
| 2 | Absent args → `{}` (no throw) | T1.1 | `test_running_tool_call_absent_args_is_empty_object` |
| 3 | `args` precedence over legacy fields | T1.1 | `test_running_tool_call_args_takes_precedence_over_legacy_fields` |
| 4 | Populated input survives the adapter pipeline (not dropped by dedup) | T2.1 | `test_adapter_emits_tool_call_with_populated_input` |
| 5 | No new dependency (validated in final gate) | T3.1 | Dependencies section — NEW = (none) |
| 6 | #42 running card preserved | T1.1 | existing event-translator running-case still green |
| 7 | Full validation + live evidence (card shows command) | T3.1 | `npx vitest run packages/agents/` + live smoke |

**Coverage: 7/7 requirements mapped (100%)**

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| SDK `args` field is "NOT stable" per its own doc comment (`run-D22b53SU.d.ts:485`) — a future SDK could rename it | Medium | Lead with `args` but keep `msg.input ?? msg.arguments` fallbacks; type is `unknown` so consumer parses defensively; integration test pins behavior | implementer |
| EC-1: resolved SDK 2.9.0 < agents peer floor 2.11.2 — tests validate against 2.9.0 | Low | The `args` field + `SDKToolUseMessage` shape are identical in both; note the skew; reconcile install in a follow-up (out of scope for the bug fix) | implementer |
| The onDelta `tool-call-started` path (left unchanged) could be the live path for a different provider and still emit empty args | Low | That path already reads the correct field (`update.toolCall.args`); if a provider streams via `partial-tool-call`, that is a separate enhancement (the blueprint's deferred partial-buffering fallback), not this bug | deferred |

## Unresolved Questions

- Does theocode's UI also need to render `tool_result` output in the tool card? (Observed: card showed neither command nor result.) — OUT OF SCOPE for theokit#58 (framework `tool_call.input`); if the result still doesn't render after this fix + adoption, file a separate theocode UI issue. Tracked as a Phase-final live-smoke observation, not a task here.

## Final Phase — Integration Validation

### Task T3.1 — Full validation + live evidence

#### Why this step
"Eat your own cooking": the plan is not done until the agents suite is green, types/lint pass, and a live run in theocode shows the tool card rendering the real command (the user-visible proof of 100% functionality).

#### Acceptance criteria
- `npx vitest run packages/agents/` (bridge unit + integration) green on Node 22.
- `npx tsc --noEmit` clean for agents; `npx eslint packages/agents --max-warnings=0` clean.
- `/code-quality tool-call-input-surfacing` verdict ∈ {PASS, PASS_WITH_CAVEATS}.
- **Live evidence:** after publishing + theocode adopting the fixed `@theokit/agents`, a real tool prompt on Node 24 shows the `tool_call` SSE event carrying `args:{command:…}` (was `{}`) AND the theocode UI card shows the command — screenshot/curl captured.

#### DoD
- All gates green; live evidence recorded in the implementation summary.

## Global Definition of Done

- All tasks' DoD met; Coverage Matrix 100%.
- `/plan-confidence tool-call-input-surfacing` ≥ SHIPPABLE_WITH_CAVEATS.
- `/implement` emits `IMPLEMENTATION_COMPLETE`; `run_validation.py` exits 0.
- `/code-quality` ∈ {PASS, PASS_WITH_CAVEATS}; `/review` = READY_TO_MERGE.
- File-size budget respected (event-translator.ts stays < 500 LoC).
- CHANGELOG `[Unreleased] § Fixed` entry referencing theokit#58.
