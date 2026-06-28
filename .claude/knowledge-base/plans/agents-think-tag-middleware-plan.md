---
slug: agents-think-tag-middleware
milestone_id: M2
created_at: 2026-06-28
goal: Add an opt-in <think>-tag extraction middleware to @theokit/agents that converts inline <think>…</think> in the text stream into thinking StreamEvents, so non-native-reasoning models (qwen/deepseek-class) surface reasoning.
---

# Plan: `@theokit/agents` `<think>`-tag reasoning middleware

> **Version 1.1** (edge-case-plan absorbed 2026-06-28: EC-1 MUST-FIX delimiter-prefix-then-mismatch → flush as text; EC-2/EC-3 SHOULD-TEST mode-persists-across-tool-event + non-string-content guard; EC-4 documented buffer-bounded) — M2 of the reasoning-visibility roadmap (`theocode/.claude/knowledge-base/ROADMAP-reasoning-visibility.md`, ADR-3 of blueprint `code-assistant-reasoning-ux`). Add an opt-in bridge middleware to `@theokit/agents` that converts inline `<think>…</think>` segments in the assistant **text** stream into `thinking` StreamEvents. M1 (shipped, `@theokit/agents@0.22.0`) added the `reasoningEffort` enable knob for **native-reasoning** providers; M2 covers the other half — models that emit reasoning **inline as `<think>` tags** (theocode's default `qwen3-coder` does exactly this), which the effort knob alone cannot surface.

## Goal

> Convert inline `<think>…</think>` in the text stream into `thinking` events, measured by `test_extractor_interleaved_think_blocks` (text→thinking→text order preserved across a multi-block input) + `test_think_stream_emits_thinking_events_for_text_delta` (a `text_delta` carrying `<think>` yields `thinking` StreamEvents) — both green via `pnpm --filter @theokit/agents test`.

## Context

The M1 live diagnosis confirmed two enable paths for reasoning: (a) **native** — a provider param (`ModelSelection.params [{id:'thinking'}]`, shipped in M1); (b) **inline tags** — the model writes `<think>reasoning</think>answer` directly in its text output. Open models routed through the user's gateway (qwen3-coder = theocode's default, deepseek-r1-class) use (b). Without an extraction step, that reasoning arrives as ordinary `text_delta` and renders as part of the answer (or is dropped by a UI that only renders `thinking` events). The deep-research blueprint (9 frameworks) shows the universal fix: a streaming `<think>` extractor (Aider `reasoning_tags.py`, Vercel AI SDK `extract-reasoning-middleware.ts`) placed framework-side so every consumer benefits. `@theokit/agents` already EMITS `thinking` StreamEvents (`bridge/event-translator.ts:155` for native; `:178` for `thinking-delta`); this plan adds the inline-tag producer for that same event.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Why it exists today | Invariants to preserve |
|---|---|---|---|
| `packages/agents/src/bridge/think-tag-extractor.ts` | 0 (NEW) | — | NEW module: pure incremental extractor + stream transform; < 500 LoC (G6); no `@theokit/agents`→core import (G1) |
| `packages/agents/src/bridge/sdk-adapter.ts` | 498 | Bridges compiled decorators → SDK; yields `StreamEvent`s via `mergeDeltaStream` loop (`:475-477`); `createSdkAgentStream` factory + `RuntimeOverrides` | `createSdkAgentStream` signature + #44 merge/dedup + dispose/usage paths unchanged; **stays < 500 LoC (G6)** — the extractor lives in its own module; transform applied by wrapping the merge loop |
| `packages/agents/src/bridge/agent-compiler.ts` | ~150 | `compileAgent()` → `CompiledAgentOptions`; carries `@Agent` config | additive field; existing compiled output unchanged |
| `packages/agents/src/loop/agent-runner.ts` | ~300 | `AgentRunner.run/builder`; `AgentRunnerRunOptions`; forwards into `RuntimeOverrides` | additive field; both on-ramps forward identically (mirror M1 `reasoningEffort`) |
| `packages/agents/src/types.ts` | ~70 | `AgentOptions` (`@Agent` config) + `ReasoningEffort` (M1) | additive optional field |
| `packages/agents/src/bridge/index.ts` | ~73 | bridge barrel | additive exports with consumers (G7) |
| `packages/agents/tests/unit/think-tag-extractor.test.ts` | 0 (NEW) | — | n/a |
| `packages/agents/tests/unit/think-tag-stream.test.ts` | 0 (NEW) | — | n/a |
| `packages/agents/tests/integration/sdk-adapter-think-tags.test.ts` | 0 (NEW) | — | n/a |
| `packages/agents/tests/unit/agent-compiler.test.ts` | ~210 | compiler unit tests | additive tests |

Every file in any `#### Files to edit` block appears here.

### Current callers / dependents

- **`StreamEvent`** (`bridge/agent-sse-handler.ts:10`): `{ type: string; [key: string]: unknown }` — events are `{type:'text_delta',content}`, `{type:'thinking',content}`, `{type:'tool_call',...}`, `{type:'done',...}`, `{type:'error',...}`. The transform reads `type`/`content` only.
- **`createSdkAgentStream`** (`sdk-adapter.ts:341-355`): returns a factory `(message, sessionId) => AsyncIterable<StreamEvent>`; the iterator yields events via `for await (const event of mergeDeltaStream(queue, openStream, runId, state)) yield event` (`:475-477`), then a terminal `done` (`:483`). State (the extractor) is per-iterator ⇒ per-round (fresh each `getOrCreate`).
- **`RuntimeOverrides`** (`sdk-adapter.ts:77-`): per-run surface; M1 added `reasoningEffort?`; resolution `overrides.X ?? compiled.X` at `:347-349`.
- **`CompiledAgentOptions`** (`agent-compiler.ts`): carries `reasoningEffort?` (M1) populated from `walkResult.agentConfig`; `AgentOptions` (`types.ts`) is the `@Agent` config (has `reasoningEffort?`).
- **`AgentRunnerRunOptions`** (`agent-runner.ts:48-`): per-run options; M1 added `reasoningEffort?` forwarded into `RuntimeOverrides` at the `createSdkAgentStream(...)` call (`:203-`).
- **`event-translator.ts`**: emits `{type:'thinking',content}` from native SDK thinking (`:155-157`) + `thinking-delta` (`:178-179`); emits text as `{type:'text_delta',content}` (`:62,:177`). The middleware is downstream of this (operates on the assembled StreamEvent stream), so native thinking passes through untouched.
- **`streamFactory` override (V4-R)** (`agent-runner.ts`): when a consumer injects a custom round-stream factory, they own the stream — the middleware (which lives inside `createSdkAgentStream`) does not apply (documented; consumer's responsibility).

### Domain glossary

- **`<think>` tag** — the de-facto inline-reasoning delimiter emitted by qwen/deepseek-class models: `<think>reasoning…</think>visible answer`. Tag name fixed to `think` (the standard); not configurable in M2 (YAGNI — extend if a model uses another tag).
- **`parseThinkTags`** — the new opt-in boolean knob (`@Agent({ parseThinkTags: true })` + per-run override), default `false`. Mirrors M1 `reasoningEffort` precedence (run > compiled > default).
- **incremental extractor** — a pure stateful splitter that consumes text chunks (deltas) and emits typed segments (`text` | `thinking`), buffering a partial delimiter that straddles a chunk boundary (the streaming-correctness core; Aider/Vercel pattern).
- **stream transform** — `extractThinkTagStream(source): AsyncGenerator<StreamEvent>` — applies the extractor to `text_delta` events, passes all other events through unchanged.

### Architecture boundaries affected

- **G2 / `sdk-runtime.md`:** respected — no LLM call, no loop/storage reimplementation; a pure text transform over the already-assembled StreamEvent stream. The SDK remains the runtime.
- **G1 (dependency direction):** unchanged — the new module imports only the local `StreamEvent` type (no core, no `@theokit/sdk` runtime).
- **G6 (≤ 500 LoC):** the extractor + transform live in their own module; `sdk-adapter.ts` gains only the resolve line + a one-line wrap (stays < 500).
- **G7 (every export has a consumer):** `createThinkTagExtractor` + `extractThinkTagStream` are consumed by `createSdkAgentStream` + unit tests.
- **G10 (honest enforcement):** `parseThinkTags` actually wraps the stream when true; when false it is a no-op (passthrough) — not a silent metadata-only flag.

## Prior Art & Related Work

- **Blueprint** `code-assistant-reasoning-ux` ADR-3 (the `<think>` middleware) — references **Aider** `reasoning_tags.py:14-64` (a non-streaming `<think>` split for full responses) and **Vercel AI SDK** `extract-reasoning-middleware.ts:17-250` (the streaming buffer pattern: `tagName`, partial-tag buffering across chunks, `text-delta`→`reasoning` part transform). These two reference clones are NOT in this repo's `.claude/knowledge-base/references/` (the clones present are astro/codex/fastify/hono/nitro/next.js/opencode/workers-sdk/guardrails); the patterns are characterized from the blueprint + the well-known public implementations, not cited as in-repo paths (no fabricated `references/` citation).
- **M1 (shipped, `@theokit/agents@0.22.0`)**: `reasoningEffort` + `buildModelSelection` — the native-reasoning enable. M2 is its inline-tag complement; both feed the same `thinking` StreamEvent.
- **In-repo**: `event-translator.ts:155-179` (the `thinking` StreamEvent the transform re-uses); `sdk-adapter.ts:475-477` (the merge loop the transform wraps).

## Objective

- [ ] A pure `createThinkTagExtractor()` → `{ write(chunk): Segment[]; end(): Segment[] }` that incrementally splits `<think>…</think>` from text, buffering a delimiter that straddles a chunk boundary, preserving interleaved order. `Segment = { kind: 'text' | 'thinking'; content: string }`.
- [ ] A pure `extractThinkTagStream(source: AsyncIterable<StreamEvent>): AsyncGenerator<StreamEvent>` that maps `text_delta`→(`text_delta` | `thinking`) via the extractor and passes every other event through unchanged, flushing the extractor at stream end.
- [ ] `parseThinkTags?: boolean` added to `@Agent` config (`AgentOptions`/`CompiledAgentOptions`), `AgentRunnerRunOptions`, and `RuntimeOverrides` (additive, optional, default `false`).
- [ ] `createSdkAgentStream` wraps the merged event stream with `extractThinkTagStream` **only when** `overrides.parseThinkTags ?? compiled.parseThinkTags` is true (precedence mirrors M1); unset ⇒ byte-identical to current behavior.
- [ ] No behavior change when `parseThinkTags` is unset/false (the wrap is not applied; existing tests stay green).
- [ ] `createThinkTagExtractor` + `extractThinkTagStream` exported from the bridge barrel (G7).
- [ ] theokit released (the consumable version for M3 theocode) — post-cycle.

## ADRs

### D1 — A pure incremental extractor as the testable core (not an ad-hoc regex over the joined stream)
- **Decision:** implement `createThinkTagExtractor()` as a stateful incremental splitter (`write(chunk)`/`end()`) returning typed `Segment[]`, buffering a partial delimiter across chunk boundaries.
- **Rationale:** the stream arrives as many small `text_delta` deltas; a `<think>` open/close tag can straddle two deltas (`"<thi"` then `"nk>"`). A regex over a single joined string cannot run incrementally without re-buffering the whole turn and breaks live streaming. The incremental extractor is the Vercel AI SDK pattern (`extract-reasoning-middleware`) and is exhaustively unit-testable as a pure function (no async, no I/O) — mirrors M1's pure `buildModelSelection`.
- **Alternatives considered:** (a) buffer the entire turn, then regex-split — REJECTED (defeats live streaming; the whole point is incremental reasoning display). (b) a third-party stream-parser dep — REJECTED (Rule 9: the splitter is ~40 lines; a dep is heavier than the code; Vercel/Aider both hand-roll it).
- **Consequences:** one new pure function with exhaustive unit tests (chunk-straddle, interleaved, unclosed, no-tag, empty).

### D2 — A stream transform over `StreamEvent`, downstream of `event-translator`, touching only `text_delta`
- **Decision:** `extractThinkTagStream(source)` passes every non-`text_delta` event through unchanged; for `text_delta` it runs `event.content` through the extractor and emits `{type:'thinking',content}` / `{type:'text_delta',content}` per segment in order; at source end it flushes the extractor (trailing buffer as the current mode's content).
- **Rationale:** operating on the assembled `StreamEvent` stream (not raw SDK messages) means native `thinking` events (already emitted by `event-translator`) pass through untouched, and tool/done/error events are never mangled. Order is preserved because segments are emitted in arrival order. Empty segments are dropped (avoid `{content:''}` noise).
- **Alternatives considered:** transform raw `SdkMessage`/`InteractionUpdate` inside `event-translator` — REJECTED (would interleave with the #44 merge/dedup logic and the native-thinking path; harder to test; the StreamEvent layer is the clean seam).
- **Consequences:** one new pure async-generator with unit tests using a fake `AsyncIterable<StreamEvent>`.

### D3 — Opt-in via `parseThinkTags` (default OFF), NOT default-on
- **Decision:** the middleware applies only when `parseThinkTags` is true (`@Agent` config or per-run override); default `false`.
- **Rationale:** a code assistant (theocode) can legitimately emit literal `<think>` in answer text or code blocks; default-on would silently reclassify that as reasoning (data corruption). The industry pattern is opt-in/per-model: Vercel ships `extractReasoningMiddleware` as an explicit model wrapper; Aider enables it per model config. M3 (theocode) will enable it for its qwen default. Default-off is also backward-compatible (zero behavior change for existing agents).
- **Alternatives considered:** default-on "so every consumer benefits" — REJECTED (silent mis-parse risk for code content; surprises existing consumers; violates least-astonishment). A model allowlist in the framework — REJECTED (Rule 9 drift; the consumer knows its model).
- **Consequences:** additive optional boolean across 3 option types; precedence `run > compiled > false` (mirror M1 `reasoningEffort`).

### D4 — Integration point: wrap the merge loop inside `createSdkAgentStream`; `streamFactory` override bypasses
- **Decision:** in `createSdkAgentStream`'s iterator, when enabled, route the `mergeDeltaStream(...)` output through `extractThinkTagStream` before yielding; the terminal `done`/`error` events are unaffected. A consumer-injected `streamFactory` (V4-R) owns its own stream and is not wrapped.
- **Rationale:** this is the single place every SDK-backed round flows through; wrapping here applies the transform per-round (fresh extractor state per iterator) for both `delegate()` and `AgentRunner` on-ramps. The `streamFactory` override is an explicit "I own the transport" escape (documented), so not wrapping it is correct.
- **Alternatives considered:** wrap inside `run-reflective-loop` (per-round) — REJECTED (the loop is transport-agnostic; the SDK-specific concern belongs in the SDK adapter). Wrap at the SSE handler — REJECTED (too late; the reflective loop aggregates rounds from the StreamEvents before SSE, so it would see unsplit text).
- **Consequences:** a one-line conditional wrap in the adapter; `sdk-adapter.ts` stays < 500 LoC (the logic lives in the new module).

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| A model emitting literal `<think>` in legitimate answer/code text would be mis-parsed as reasoning | Medium | Opt-in (D3, default off) — only enabled by a consumer who knows its model emits reasoning tags; documented | agents |
| A `<think>` tag straddling a chunk boundary could split incorrectly if buffering is wrong | Medium | The incremental extractor buffers any tail that is a prefix of the active delimiter; exhaustive chunk-straddle unit tests (split at every offset of `<think>`/`</think>`) | agents |
| Unclosed `<think>` at stream end (truncated turn) | Low | `end()` flushes the remaining buffer in the current mode (mid-thinking ⇒ thinking) — reasoning is still surfaced, never dropped; tested | agents |
| Tag name hardcoded to `think` (some models may use another) | Low | `<think>` is the de-facto standard (qwen/deepseek); YAGNI — the extractor takes the tag as an internal constant, single change point if a real second case appears (Rule of 3) | agents |
| New optional field threaded across 3 option types | Low | Additive `?:`; existing callers unaffected; type + unit tests; identical pattern to M1 `reasoningEffort` | agents |

## Unresolved Questions

- (none — every decision is resolved at plan time). The tag name is fixed to `think` (D-glossary; single change point in the extractor if a second tag is ever needed); the unclosed-tag-at-end behavior is decided (flush as current mode, D1); the opt-in default is decided (D3). M3 (theocode) owns the consumer-side enable + the live proof against qwen3-coder.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| `@theokit/sdk` | installed (peer) | npm | Only the runtime that produces the StreamEvents; M2 adds no new SDK usage. No version change. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | — | — | The `<think>` splitter is ~40 lines of pure string logic; Aider and Vercel both hand-roll it rather than take a dep — a stream-parser dependency is heavier than the code and adds a transitive surface. | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | — | — |

## Dependency Graph

```
Phase 1 (pure extractor + unit tests) ──▶ Phase 2 (stream transform over StreamEvent + unit tests) ──▶ Phase 3 (parseThinkTags config threading + adapter wiring + integration test) ──▶ Final (Integration Validation + release)
```

Phase 1 is a prerequisite for Phase 2 (the transform calls the extractor); Phase 2 for Phase 3 (the adapter wraps with the transform). Sequential.

---

## Phase 1: Pure incremental `<think>` extractor

### T1.1 — Add `createThinkTagExtractor` (pure, incremental, chunk-straddle-safe)

#### Objective
A pure `createThinkTagExtractor()` in a new `bridge/think-tag-extractor.ts` returning `{ write(chunk: string): Segment[]; end(): Segment[] }`, where `Segment = { kind: 'text' | 'thinking'; content: string }`, that splits `<think>…</think>` incrementally and buffers a delimiter straddling a chunk boundary.

#### Why this step (action + reasoning)
1. Introduces the testable streaming-correctness core (D1) — the part that must handle a tag split across deltas.
2. Necessary before Phase 2 (the stream transform consumes it); a pure synchronous function is exhaustively unit-testable without any async/stream harness (mirrors M1's `buildModelSelection`).

#### Evidence
`StreamEvent` text arrives as many `text_delta` deltas (`sdk-adapter.ts:475-477` merge loop; `event-translator.ts:62,177`); a `<think>` tag can straddle two deltas. Vercel `extract-reasoning-middleware` + Aider `reasoning_tags` establish the buffer pattern (blueprint ADR-3).

#### Files to edit
```
packages/agents/src/bridge/think-tag-extractor.ts — (NEW) export type Segment + createThinkTagExtractor()
packages/agents/tests/unit/think-tag-extractor.test.ts — (NEW) RED exhaustive unit tests
```

#### Deep file dependency analysis
Pure, no imports beyond a local `Segment` type. No existing signature changes. Consumed by `extractThinkTagStream` (Phase 2) + unit tests (G7). The tag name is an internal constant `'think'`.

#### TDD
```
RED: test_extractor_passthrough_no_tags — write('hello world') → [{text,'hello world'}]; end() → []
RED: test_extractor_single_think_block — write('<think>reason</think>answer') → [{thinking,'reason'},{text,'answer'}]
RED: test_extractor_interleaved_think_blocks — 'a<think>r1</think>b<think>r2</think>c' → text a, thinking r1, text b, thinking r2, text c (order preserved)
RED: test_extractor_open_tag_split_across_chunks — write('a<thi')→[{text,'a'}] (buffer holds '<thi'); write('nk>r</think>z')→[{thinking,'r'},{text,'z'}]
RED: test_extractor_close_tag_split_across_chunks — write('<think>re')→[{thinking,'re'}]; write('as</thi')→[{thinking,'as'}]; write('nk>end')→[{text,'end'}]
RED: test_extractor_unclosed_think_flushed_as_thinking_on_end — write('x<think>partial'); end() → [{thinking,'partial'}] (truncated reasoning still surfaced)
RED: test_extractor_empty_think_block_emits_nothing — write('<think></think>ok') → [{text,'ok'}] (no empty thinking segment)
RED: test_extractor_lone_lt_is_text — write('a < b </think? c') → [{text,'a < b </think? c'}] (non-matching '<' is text)
RED: test_extractor_adjacent_blocks — '<think>a</think><think>b</think>' → thinking a, thinking b
RED: test_extractor_partial_tag_prefix_then_mismatch — write('a<thinkers>b') → [{text,'a<thinkers>b'}]; split form write('a<thin'),write('kers>b') → text 'a<thinkers>b' (EC-1: a buffered delimiter-prefix that cannot extend to the full tag is flushed as text, re-scanning from the next possible '<')
GREEN: implement the incremental splitter (mode + buffer; emit on delimiter; hold ONLY a tail that is still a viable prefix of the active delimiter; on divergence flush the non-matching portion as the current mode's content and re-scan from the next '<'; flush in end())
VERIFY: pnpm --filter @theokit/agents test think-tag-extractor
```

#### Concurrency tests (only when applicable)
(none — single-threaded) — a pure synchronous splitter; one extractor instance per stream (no shared state).

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/agents test think-tag-extractor` exits 0 (all 10 tests green).
- [ ] Chunk-straddle proven — `test_extractor_open_tag_split_across_chunks` + `test_extractor_close_tag_split_across_chunks` green.
- [ ] Prefix-mismatch proven — `test_extractor_partial_tag_prefix_then_mismatch` green (EC-1).
- [ ] Pass: lint — `npx eslint packages/agents/src/bridge/think-tag-extractor.ts` exits 0.
- [ ] Pass: size — `wc -l packages/agents/src/bridge/think-tag-extractor.ts` ≤ 500.

#### DoD
- [ ] `npx tsc --noEmit -p packages/agents/tsconfig.test.json` 0 errors; eslint clean on the file.

---

## Phase 2: Stream transform over `StreamEvent`

### T2.1 — Add `extractThinkTagStream` (passthrough non-text; split text_delta; flush at end)

#### Objective
A pure `extractThinkTagStream(source: AsyncIterable<StreamEvent>): AsyncGenerator<StreamEvent>` in the same module: non-`text_delta` events pass through unchanged; `text_delta` events run through a per-stream `createThinkTagExtractor`, emitting `{type:'thinking',content}` / `{type:'text_delta',content}` per segment; on source end, flush the extractor (trailing segments before returning).

#### Why this step (action + reasoning)
1. Wraps the pure extractor (T1.1) into the StreamEvent seam (D2) — the unit consumed by the adapter.
2. Operating at the StreamEvent layer keeps native `thinking`/tool/done/error events untouched and is testable with a fake async iterable (no SDK).

#### Evidence
`StreamEvent` shape (`agent-sse-handler.ts:10`); the merge loop the transform will wrap (`sdk-adapter.ts:475-477`); native thinking + text events from `event-translator.ts:62,155,177`.

#### Files to edit
```
packages/agents/src/bridge/think-tag-extractor.ts — add export async function* extractThinkTagStream(source)
packages/agents/tests/unit/think-tag-stream.test.ts — (NEW) RED unit tests with a fake AsyncIterable<StreamEvent>
```

#### Deep file dependency analysis
- Imports the local `StreamEvent` type (`from './agent-sse-handler.js'`) + the T1.1 extractor (same module). No existing signature changes.
- A fresh `createThinkTagExtractor()` per call (per-stream state). Non-`text_delta` events (`thinking`, `tool_call`, `done`, `error`, `run_started`) are yielded verbatim. Empty segments dropped.

#### TDD
```
RED: test_think_stream_passes_through_non_text_events — input [thinking, tool_call, done] → identical output (no transform)
RED: test_think_stream_emits_thinking_events_for_text_delta — text_delta '<think>r</think>a' → [thinking 'r', text_delta 'a']
RED: test_think_stream_splits_tag_across_two_text_deltas — text_delta 'a<thi' then 'nk>r</think>b' → [text_delta 'a', thinking 'r', text_delta 'b']
RED: test_think_stream_preserves_interleaved_tool_event_order — [text_delta 'pre<think>r</think>', tool_call X, text_delta 'post'] → [text_delta 'pre', thinking 'r', tool_call X, text_delta 'post']
RED: test_think_stream_flushes_unclosed_thinking_at_end — [text_delta 'x<think>partial'] (source ends) → [text_delta 'x', thinking 'partial']
RED: test_think_stream_native_thinking_untouched — a native {type:'thinking'} event passes through unchanged (not re-extracted)
RED: test_think_stream_thinking_persists_across_tool_event — [text_delta '<think>r1', tool_call X, text_delta 'r2</think>done'] → [thinking 'r1', tool_call X, thinking 'r2', text_delta 'done'] (EC-2: mode persists across a non-text event)
RED: test_think_stream_handles_nonstring_content — a {type:'text_delta'} with content undefined/empty yields no thinking + does not throw (EC-3: guard typeof content === 'string' before write)
GREEN: implement the async generator over source using a per-stream extractor + end()-flush (guard non-string content)
VERIFY: pnpm --filter @theokit/agents test think-tag-stream
```

#### Concurrency tests (only when applicable)
(none — single-threaded) — sequential async iteration; per-call extractor instance, no shared mutable state across streams.

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/agents test think-tag-stream` exits 0 (all 8 tests green).
- [ ] Interleaving with non-text events proven — `test_think_stream_preserves_interleaved_tool_event_order` + `test_think_stream_thinking_persists_across_tool_event` green.
- [ ] Native thinking untouched — `test_think_stream_native_thinking_untouched` green.
- [ ] Pass: lint — `npx eslint packages/agents/src/bridge/think-tag-extractor.ts` exits 0.

#### DoD
- [ ] `npx tsc --noEmit -p packages/agents/tsconfig.test.json` 0 errors.

---

## Phase 3: `parseThinkTags` config + adapter wiring

### T3.1 — Thread `parseThinkTags` through the surfaces + wrap the adapter stream

#### Objective
`parseThinkTags?: boolean` on `AgentOptions` (`@Agent` config) → `CompiledAgentOptions`, `AgentRunnerRunOptions`, `RuntimeOverrides`; `createSdkAgentStream` resolves `overrides.parseThinkTags ?? compiled.parseThinkTags` and, when true, wraps the merge-loop output with `extractThinkTagStream`; barrel exports the two new functions.

#### Why this step (action + reasoning)
1. Connects the declarative + per-run opt-in to the transform — the actual M2 feature, end-to-end (D3/D4).
2. Depends on T2.1's transform. One task keeps the threading coherent (type + resolve + wrap), exactly mirroring M1's T2.1.

#### Evidence
M1 precedent for the identical threading: `reasoningEffort` on `AgentOptions` (`types.ts`), `CompiledAgentOptions` (`agent-compiler.ts`), `AgentRunnerRunOptions` (`agent-runner.ts`), `RuntimeOverrides` + resolve (`sdk-adapter.ts:347-349`); the merge loop to wrap (`sdk-adapter.ts:475-477`).

#### Files to edit
```
packages/agents/src/types.ts — AgentOptions gains parseThinkTags?: boolean
packages/agents/src/bridge/agent-compiler.ts — CompiledAgentOptions gains parseThinkTags?; carry walkResult.agentConfig.parseThinkTags in compileAgent
packages/agents/src/bridge/sdk-adapter.ts — RuntimeOverrides gains parseThinkTags?; resolve const parseThinkTags = overrides.parseThinkTags ?? compiled.parseThinkTags; wrap the merge loop when true
packages/agents/src/loop/agent-runner.ts — AgentRunnerRunOptions gains parseThinkTags?; forward into createSdkAgentStream overrides
packages/agents/src/bridge/index.ts — export createThinkTagExtractor + extractThinkTagStream + type Segment
packages/agents/tests/integration/sdk-adapter-think-tags.test.ts — (NEW) RED: fake Agent emits text_delta with <think>, assert thinking events out when enabled, and bare passthrough when disabled
packages/agents/tests/unit/agent-compiler.test.ts — RED: @Agent({parseThinkTags:true}) → compiled.parseThinkTags===true
```

#### Deep file dependency analysis
- Additive optional fields — no existing caller breaks (identical shape to M1 `reasoningEffort`).
- The adapter wrap: `const events = parseThinkTags ? extractThinkTagStream(mergeDeltaStream(...)) : mergeDeltaStream(...)` then `for await (const event of events) yield event`. The terminal `done` (`:483`) is yielded after, unaffected.
- The integration test reuses the M1 capture-mock harness (`runtime-overrides.test.ts` pattern): a fake `@theokit/sdk` whose `send` drives `onDelta` with a `text-delta` carrying `<think>…</think>`; assert the runner's stream contains a `thinking` event when `parseThinkTags:true`, and only `text_delta` when false.

#### TDD
```
RED: test_agent_config_parseThinkTags_compiles — @Agent({parseThinkTags:true}) → compileAgent().parseThinkTags===true (and undefined when unset)
RED: test_stream_extracts_think_when_enabled — runner with parseThinkTags:true, model emits 'a<think>r</think>b' → stream yields a thinking 'r' event + text_delta 'a'/'b'
RED: test_stream_no_extract_when_disabled — same input, parseThinkTags unset → NO thinking event; '<think>' stays in text_delta (backward-compat)
RED: test_run_override_parseThinkTags_beats_compiled — compiled false + run override true ⇒ extraction applies
GREEN: thread the field + resolve + conditional wrap + barrel exports
REFACTOR: keep sdk-adapter.ts < 500 LoC (logic stays in think-tag-extractor.ts)
VERIFY: pnpm --filter @theokit/agents test sdk-adapter-think-tags ; pnpm --filter @theokit/agents test agent-compiler
```

#### Concurrency tests (only when applicable)
(none — single-threaded) — option threading + per-stream wrap; the per-iterator extractor state is not shared across rounds/streams.

#### Failure scenarios
| Dependency | Failure mode | Test | Expected |
|---|---|---|---|
| SDK stream | text arrives with an unclosed `<think>` then the run ends/errors | covered by T2.1 `test_think_stream_flushes_unclosed_thinking_at_end` + the adapter's existing error path | buffered reasoning flushed as a thinking event; the terminal `error`/`done` still emitted (no swallow) |

#### Acceptance Criteria
- [ ] `pnpm --filter @theokit/agents test sdk-adapter-think-tags` exits 0 (enabled-extracts + disabled-passthrough + override tests green).
- [ ] `pnpm --filter @theokit/agents test agent-compiler` exits 0 (config-compile test green).
- [ ] Backward-compat — with `parseThinkTags` unset, the existing streaming tests stay green and `<think>` text is NOT transformed (`test_stream_no_extract_when_disabled`).
- [ ] Pass: lint — `npx eslint packages/agents` exits 0 on touched files.
- [ ] Pass: size (G6 metric — code LoC excl. blanks+comments) — `grep -vE '^\s*$|^\s*//|^\s*/\*|^\s*\*' packages/agents/src/bridge/sdk-adapter.ts | wc -l` ≤ 500. (Raw `wc -l` may exceed 500 due to JSDoc; G6 explicitly excludes comments.)

#### DoD
- [ ] `pnpm --filter @theokit/agents test` green (no regression).
- [ ] `npx tsc --noEmit -p packages/agents/tsconfig.test.json` 0 errors.
- [ ] CHANGELOG `[Unreleased]` updated (Unbreakable Rule 6).

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | Incremental `<think>` split, chunk-straddle-safe | T1.1 | `createThinkTagExtractor` (D1) |
| 2 | Interleaved order preserved (text↔thinking) | T1.1, T2.1 | extractor emits in arrival order; stream transform preserves event order (D2) |
| 3 | `text_delta`→`thinking` event conversion in the stream | T2.1 | `extractThinkTagStream` (D2) |
| 4 | Non-text events (native thinking/tool/done) untouched | T2.1 | passthrough branch (D2) |
| 5 | Declarative opt-in (`@Agent`) | T3.1 | `AgentOptions`/`CompiledAgentOptions.parseThinkTags` (D3) |
| 6 | Per-run override opt-in | T3.1 | `AgentRunnerRunOptions`/`RuntimeOverrides.parseThinkTags` + precedence (D3) |
| 7 | Adapter applies transform only when enabled | T3.1 | conditional wrap of the merge loop (D4) |
| 8 | Backward-compat (disabled ⇒ no transform) | T3.1 | default false; disabled-passthrough test |
| 9 | Unclosed-tag-at-end flushed (no dropped reasoning) | T1.1, T2.1 | `end()` flush (D1/D2) |

**Coverage: 9/9 implementation gaps covered (100%)** — (the theokit release for M3 consumption is the post-cycle `cycle-release` step, tracked in Global DoD + Final Phase, not an implementation gap.)

## Global Definition of Done

- [ ] All phases completed.
- [ ] All tests passing — `pnpm --filter @theokit/agents test` green.
- [ ] Zero type errors — `npx tsc --noEmit -p packages/agents/tsconfig.test.json`.
- [ ] Zero lint warnings — `npx eslint packages/agents` on touched files.
- [ ] File-size budget (G6 — code LoC excl. blanks+comments) — `sdk-adapter.ts` ≤ 500 (measured 344; raw `wc -l` 510 is JSDoc-heavy and not the G6 metric); `think-tag-extractor.ts` ≤ 500.
- [ ] CHANGELOG.md updated under `[Unreleased]` (Unbreakable Rule 6).
- [ ] Backward compatibility — unset `parseThinkTags` ⇒ no transform; existing streaming tests green.
- [ ] **Runtime-metric proof** — the integration test asserts a `thinking` event is produced from `<think>` text when enabled (observable behavior); live proof against qwen3-coder is M3 (theocode).
- [ ] **Plan archived** — after `/review` READY_TO_MERGE + PR merged, move to `knowledge-base/plans/completed/`.
- [ ] theokit released (changeset minor) so M3 can consume.

## Failure scenarios (when I/O external)

The transform has no external I/O — it is a pure function over the already-assembled StreamEvent stream. The only adjacent boundary is `@theokit/sdk` (driven by a fake Agent in tests, unchanged from M1). The single new edge — an unclosed `<think>` when the stream ends — is handled by the extractor's `end()` flush (T1.1/T2.1) and verified; the terminal `done`/`error` events are emitted unchanged.

## Final Phase: Integration Validation (MANDATORY)

### Execution
```
pnpm --filter @theokit/agents test                              # full agents suite
npx tsc --noEmit -p packages/agents/tsconfig.test.json          # 0 errors
npx eslint packages/agents                                       # touched files clean
# G6 size (code LoC excl. blanks+comments) ≤ 500 for both modules:
grep -vcE '^\s*$|^\s*//|^\s*/\*|^\s*\*' packages/agents/src/bridge/sdk-adapter.ts          # 344 ≤ 500
grep -vcE '^\s*$|^\s*//|^\s*/\*|^\s*\*' packages/agents/src/bridge/think-tag-extractor.ts  # ≤ 500
```

### Acceptance Criteria
- [ ] Full agents suite green (existing tests + new extractor/stream/integration/config tests).
- [ ] tsc 0; eslint clean on touched files; both modules ≤ 500 code-LoC (G6 metric excl. blanks+comments).
- [ ] extractor (10) + stream (8) + integration/config (4) tests all green.
- [ ] After READY_TO_MERGE: changeset (`@theokit/agents` minor) + release so theocode M3 consumes it.

### If Validation Fails
1. Separate plan-caused failures from the documented pre-existing agents-test baseline.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
