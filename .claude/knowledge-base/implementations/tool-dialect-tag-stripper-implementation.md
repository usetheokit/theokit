# Implementation Summary — tool-dialect-tag-stripper (theocode#32)

**Plan:** `.claude/knowledge-base/plans/tool-dialect-tag-stripper-plan.md` (v1.1, plan-confidence SHIPPABLE 90)
**Branch:** `develop`
**Status:** IMPLEMENTATION_COMPLETE
**Commits:** `6a815a3` (Phase 1 / T1.1) · `5a0b4c2` (Phase 2 / T2.1+T2.2)

## What shipped

An opt-in `@theokit/agents` stream transform that strips a model's leaked Hermes tool-call dialect
(`<function=…></tool_call>` XML) out of the visible assistant text, so theocode#32's raw-XML-in-the-answer
no longer renders. STRIP, never PARSE (ADR D1); opt-in default-off (D2); reuses the `think-tag-extractor`
incremental-splitter shape with zero new dependency (D3).

## Tasks → commits → wiring triad

| Task | Commit | Files | Wiring (a) caller | Wiring (b) integration test |
|---|---|---|---|---|
| T1.1 — stripper core | `6a815a3` | `tool-dialect-stripper.ts` (NEW), `tool-dialect-stripper.test.ts` (NEW, 10 tests), `CHANGELOG.md` | (wired in T2.2) | unit tests exercise the splitter |
| T2.1 — type/compile surface | `5a0b4c2` | `types.ts`, `agent-compiler.ts`, `sdk-adapter.ts` (RuntimeOverrides), `agent-runner.ts` | — | `test_agent_config_stripToolDialect_compiles` |
| T2.2 — wire transform | `5a0b4c2` | `sdk-adapter.ts` (import + resolve + compose), `sdk-adapter-tool-dialect.test.ts` (NEW, 8 tests) | `createSdkAgentStream` (production) | `test_stream_strips_dialect_when_enabled` + 7 more |

## Wiring triad — final state

- **(a) Static caller:** `stripToolDialectStream` ← `createSdkAgentStream` (via `applyTextTransforms`), `sdk-adapter.ts`. `createToolDialectStripper` ← `stripToolDialectStream`. PASS.
- **(b) Integration test:** `sdk-adapter-tool-dialect.test.ts` drives `AgentRunner.stream` with the flag on/off/per-run-override + parseThinkTags composition + cross-event straddle (EC-4) + non-string guard (EC-1) + error-flush (EC-2). PASS.
- **(c) Runtime metric:** N/A — feature declares no new metric; the existing `[THEO_AGENT_*]` metrics are unchanged.

## Decisions honored

- **D1 STRIP-not-PARSE:** the stripper only emits surviving text; it never constructs a `tool_call` from the leak (avoids re-introducing the theokit#53 spin).
- **D2 opt-in default-off:** `stripToolDialect` threads through `AgentConfig` → `CompiledAgent` → `RuntimeOverrides`/`AgentRunStreamOptions`, resolved `override ?? compiled ?? false`, mirroring `parseThinkTags` exactly.
- **D3 reuse + no new dep:** `tool-dialect-stripper.ts` imports only the in-repo `StreamEvent` type; the `heldPrefixLength` incremental-splitter shape mirrors `think-tag-extractor.ts`. Zero registry dependency (confirmed by `/deps-audit` PASS).

## Edge cases (from edge-case-plan v1.1) — all covered

EC-1 non-string `text_delta` guard, EC-2 lossless flush on source error (try/finally), EC-3 adjacent leaks, EC-4 cross-event straddle — each has a dedicated test. EC-5 (within-leak embedded `</tool_call>`) documented as an accepted best-effort-scanner limit.

## Refactors during implementation (REFACTOR phase)

`createSdkAgentStream` was at 127 lines at HEAD (pre-existing, over the 120 budget). To land the wiring without exceeding the budget, extracted three cohesive module-level helpers — `buildSdkTools`, `applyTextTransforms`, `resolveTextTransformFlags` — bringing the function back under 120. A first attempt to also extract the inline SDK `Agent` type to a named alias was reverted (it tripped a latent `SdkMessage` vs SDK `SDKMessage` assignability mismatch under stricter named-type checking; the inline type is the tsc-clean form).

## Validation

See `.claude/knowledge-base/reviews/tool-dialect-tag-stripper-implement-validate-2026-06-30.md`. All runnable gates PASS (504 tests, tsc 0, lint 0, wiring a+b, CHANGELOG); coverage gate SKIPPED due to a pre-existing monorepo vitest version skew (vitest@3.2.6 vs coverage-v8@4.1.9) unrelated to this change — covered qualitatively by exhaustive branch-level test design.

## Next

`/review tool-dialect-tag-stripper` → specialist agents; then theocode adopts the bumped `@theokit/agents` (enable `stripToolDialect` on the qwen path) to close theocode#32.
