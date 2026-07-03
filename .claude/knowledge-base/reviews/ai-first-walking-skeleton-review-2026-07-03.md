# Review — ai-first-walking-skeleton (M0)

Date: 2026-07-03
Slug: ai-first-walking-skeleton · milestone: M0
Delta: git range `61b86b1^..HEAD` (14 files, +573) · commits `61b86b1 044c772 f15a0ef f50b1ec 8c654b4`

## Verdict: **READY_TO_MERGE**

No BLOCKER, no HIGH open. All Round-1 findings resolved in `8c654b4` and confirmed in Round 2.

## Agents spawned (parallel)

| Agent | Focus | Round 1 verdict |
|---|---|---|
| cross-validation | plan ↔ implementation ↔ tests, line-by-line | READY (6/6 Coverage-Matrix rows backed by passing code; correct ai-sdk consumer transport used; scope discipline EC-1 honored) |
| code-reviewer | architecture, guardrails (G1/G2/G3/G6/G8), error-handling | NEEDS_FIXES (1 BLOCKER + 1 HIGH + 3 MEDIUM) |

## Findings → resolution

| # | Sev | Finding | Resolution (commit `8c654b4`) |
|---|---|---|---|
| 1 | **BLOCKER** | Fixture route double-read: `request.json()` after `defineRoute` already consumed the body → `TypeError: body stream already read` on every POST | Handler now uses the typed `body` arg; no `request.json()`. `chat.ts:48-56` |
| 2 | **HIGH** | Zod schema didn't cover `parts` (accessed but unvalidated) → G3/type-safety violation | Zod schema expanded to `messages[].{role, parts?[].{type,text?}}`; `as` cast removed. `chat.ts:38-47` |
| 3 | MEDIUM | Silent `catch` swallowed stream errors (error-handling.md §5) | Errors SURFACED as ai-sdk `{type:'error', errorText}` chunk (both error-event and thrown-iterable); `finish` still always last; no re-throw; no `console.log` (G9). `ui-message-stream-translator.ts:50-68` |
| 4 | MEDIUM | Response builder error path untested | Added `test_source_that_throws_mid_stream_still_terminates_with_done` asserting `[DONE]` flush under a throwing source. `tests/unit/ui-message-stream-response.test.ts` |
| 5 | MEDIUM | `ai` only devDep — published consumers can't resolve `UIMessageChunk` in the public signatures | `ai` added as OPTIONAL `peerDependency` (`>=7.0.0` + `peerDependenciesMeta.ai.optional`) in both `@theokit/agents` and `theokit`, devDep kept |

Deferred (non-blocking, tracked for M1): fuller producer header set (`cache-control`/`x-accel-buffering`) for proxy no-buffering; the transport `catch` at `ui-message-stream-response.ts:40-44` is a justified boundary swallow (guarantees `[DONE]`), documented.

## Hard gates (all PASS)

- Tests green: `@theokit/agents` 531 passed | 3 skipped (66 files); theo SSE 5 passed.
- typecheck: agents + root — no errors.
- No new secrets; branch `develop` (never `main`); **0** `Co-Authored-By` trailers.
- CHANGELOG `[Unreleased]` updated (Added + Fixed, tagged `theokit-ai-first M0`).
- Backward-compat: old `AgentEvent` SSE path untouched; barrel exports additive.

## Goal metric — MET

The deterministic integration test (`ui-message-stream-e2e.test.ts`) drives a fixed SDKMessage stream → `translateToUIMessageStream` → `uiMessageStreamResponse` → the REAL ai-sdk consumer (`parseJsonEventStream` + `readUIMessageStream`) and asserts the reconstructed `message.parts` text === `"Hello, world"` + the `x-vercel-ai-ui-message-stream: v1` header — **no custom adapter, no live LLM**.

## Next

READY_TO_MERGE → the release cut (develop→main PR + M0 checkbox flip) is the human-gated `/release` step, intentionally NOT performed here (stop condition = READY_TO_MERGE).
