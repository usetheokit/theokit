# Review — ai-first-canonical-protocol (M1)

Date: 2026-07-04
Slug: ai-first-canonical-protocol · milestone: M1
Delta: git range `fde3e52^..HEAD` (5 files) · commits `fde3e52 63a2c4a cff6770 ca7ab66 c48cdee`

## Verdict: **READY_TO_MERGE**

No BLOCKER, no HIGH open. All Round-1 findings resolved in `c48cdee` and confirmed by static trace in Round 2.

## Agents spawned (parallel)

| Agent | Focus | Round 1 verdict |
|---|---|---|
| cross-validation | plan ↔ impl ↔ tests, line-by-line (9 claims, 7 Coverage-Matrix rows) | READY (all confirmed; only INFO: `errorText: output` is cleaner than `String(output)` since output is typed string) |
| code-reviewer | architecture, guardrails, state-machine correctness | NEEDS_FIXES (2 HIGH + 1 MEDIUM test-coverage gaps + 1 LOW — production code correct) |

## Findings → resolution

| # | Sev | Finding | Resolution (commit `c48cdee`) |
|---|---|---|---|
| 1 | HIGH | No test for an `error` event mid-open-reasoning (reasoning branch of the error path) | Added `test_error_event_mid_open_reasoning_...` — asserts error chunk → reasoning-end → finish |
| 2 | HIGH | No test for a thrown iterable mid-open-reasoning (catch path) | Added `test_thrown_iterable_mid_open_reasoning_...` — closes reasoning block, no throw past boundary |
| 3 | MEDIUM | No test for `reasoning → tool → reasoning` = 2 distinct blocks | Added `test_reasoning_tool_reasoning_produces_two_distinct_blocks` — 2 reasoning-start/-end, distinct ids |
| 4 | LOW | `closeOpenBlock` left `state.reasoningId` stale after close | `state.reasoningId = null` added (`ui-message-stream-translator.ts:65`) — latent-defect hardening |

## Hard gates (all PASS)

- Tests green: `@theokit/agents` **547 passed | 3 skipped** (66 files; M0 baseline 531 → +16: 11 unit T1.1/T1.2 + 2 e2e + 3 review-gap tests).
- typecheck: `tsconfig.test.json` exit 0. eslint on changed files: 0 warnings.
- No new secrets; branch `develop`; **0** `Co-Authored-By` trailers.
- CHANGELOG `[Unreleased] § Added` updated (tag `theokit-ai-first M1`); ADR 0036 present.
- Backward-compat: M0 text/error chunks byte-unchanged; translator signature + barrel exports unchanged; no new dependency.
- Guardrails: G2 (pure mapping), G3 (no any/as), G6 (generator 49 LoC ≤50; helpers extracted), G8 (crypto.randomUUID).

## Goal metric — MET

The deterministic integration test (`ui-message-stream-e2e.test.ts`) drives `[tool_call, tool_result, thinking, done]` → translator → `uiMessageStreamResponse` → the REAL ai-sdk consumer (`readUIMessageStream`) and asserts the parsed `UIMessage.parts` contain the tool part (located by `toolCallId`, `type: dynamic-tool`, `state: output-available`, `input {q:'ai'}`, `output 'result-text'`, `toolName 'search'`) + a reasoning part text `'hmm'` — no custom adapter, no live LLM, no assistant-ui.

## Key technical decision

**EC-1 (`dynamic: true`):** theokit tools are runtime-discovered → the tool chunks carry `dynamic: true` so the ai@7 consumer routes to `updateDynamicToolPart` (`process-ui-message-stream.ts:626`), producing a `dynamic-tool` part whose `toolName` survives. An orphan `tool_result` (no prior `tool_call`) synthesizes `tool-input-available` first (the consumer throws otherwise, `:115`). ADR 0036 keeps `UIMessageStream` canonical (reject AG-UI: pre-1.0 + rxjs).

## Next

READY_TO_MERGE → the release cut (develop→main PR + M1 checkbox flip + Changeset) is the human-gated `/release` step, intentionally NOT performed here (stop condition = READY_TO_MERGE).
