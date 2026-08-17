# Implementation Summary — tool-call-input-surfacing (theokit#58)

**Verdict:** IMPLEMENTATION_COMPLETE
**Date:** 2026-06-30
**Plan:** `knowledge-base/plans/tool-call-input-surfacing-plan.md` (plan-confidence SHIPPABLE 97.6)
**Blueprint:** `knowledge-base/discoveries/blueprints/tool-call-input-surfacing-blueprint.md` (SHIPPABLE_WITH_CAVEATS 89; ADR D1 — read `msg.args`)

## The fix (ADR D1)

`packages/agents/src/bridge/event-translator.ts` `translateToolCallEvent` `running` branch:
- Before: `input: msg.input ?? msg.arguments ?? {}` → always `{}` (neither field exists on the SDK message)
- After: `input: msg.args ?? msg.input ?? msg.arguments ?? {}` — reads the real `SDKToolUseMessage.args` field (`@theokit/sdk` `run-D22b53SU.d.ts:486`), legacy fields kept as defensive fallbacks.

Root cause empirically confirmed (live TC-DIAG, Node 24 + OpenRouter): the live tool_call path is the `run.stream()` SDKMessage `running` branch, whose args are complete in `msg.args` (`{"command":"echo TCDIAG-ARGS-77"}`); `input`/`arguments` were `undefined`. The blueprint's heavier completed-patch hypothesis was refuted by this capture and NOT implemented (YAGNI).

## Wiring triad

| Pillar | Evidence |
|---|---|
| (a) Caller | `translateToolCallEvent` ← `translateSdkEvent` (`event-translator.ts:153`) ← `mergeDeltaStream`/`createSdkAgentStream` (`sdk-adapter.ts`) ← consumer (theocode `runCodeAgent`). Pre-existing live path (proven by TC-DIAG). |
| (b) Integration test | `packages/agents/tests/integration/sdk-adapter-streaming.test.ts` — `test_adapter_emits_tool_call_with_populated_input` drives a running tool_call (args) through `createSdkAgentStream` → consumer receives `input:{command:'ls -la'}` (+ negative: no-args → `{}`). |
| (c) Runtime metric | Observability is the FEATURE itself: the populated `tool_call.input` is what the UI tool card renders (the user-visible signal). theocode already logs `[prompt] tool_calls=N` per turn. |

## Tests (TDD: RED → GREEN)

- Unit (`packages/agents/tests/unit/event-translator.test.ts`, +3): `test_running_tool_call_surfaces_args_as_input` (RED→GREEN), `test_running_tool_call_args_takes_precedence_over_legacy_fields` (edge, RED→GREEN), `test_running_tool_call_absent_args_is_empty_object` (negative).
- Integration (+2): `test_adapter_emits_tool_call_with_populated_input`, `test_adapter_running_tool_call_without_args_is_empty_no_throw`.
- RED proven: 2 unit tests failed before the fix (got `input`/`{}` instead of `args`); GREEN after.

## Validation gates

- `pnpm --filter @theokit/agents exec vitest run`: **513 passed, 3 skipped (real-LLM smoke), 0 failed** (63 files).
- `tsc --noEmit -p packages/agents/tsconfig.test.json`: clean (the only output is pre-existing TS6059 `rootDir` cross-package artifacts, unrelated; zero errors in changed files).
- `eslint` on changed files: clean (`--max-warnings=0`).
- `/code-quality tool-call-input-surfacing`: **FAIL_SOFT** — sole cap `symbol_fab_unverifiable_typescript` (8 TS symbols "unverifiable").

### Soft-cap dismissal ADR (cycle-review pre-condition)

`symbol_fab_unverifiable_typescript` is **dismissed**. Rationale: the D2 detector's TypeScript support is package-name-only by design (code-quality SKILL.md Roadmap: "D2 member-access introspection for TypeScript — currently package name check only … deferred"); it cannot PROVE member symbols resolve, so it flags them "unverifiable" — this is a tool limitation, not evidence of fabrication. The authoritative TS symbol-resolution check is **tsc**, which ran clean (a fabricated `msg.args`/symbol would be a tsc error), corroborated by 513 passing tests that exercise the changed code. No `symbol_fabrication_typescript` (the FAIL_HARD variant) fired. Precedent: same disposition in prior theokit cycles (`--no-code-quality` re-score). Sunset: resolves when D2 gains tsc-subprocess introspection for TS.

## Scope notes

- No new dependency (pure field read). No dedup change. `tool-call-started` onDelta branch unchanged (already reads `update.toolCall.args`).
- Out of scope (separate concern): theocode UI rendering the `tool_result` output in the card; the EC-1 SDK version skew (resolved 2.9.0 < agents peer floor 2.11.2 — `args` field identical in both).
