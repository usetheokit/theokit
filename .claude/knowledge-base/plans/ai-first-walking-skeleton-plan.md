---
slug: ai-first-walking-skeleton
milestone_id: M0
created_at: 2026-07-03
goal: Emit a theokit agent's text stream as an ai-sdk UIMessageStream consumed by useChat without a custom adapter
---

# Plan: AI-First Walking Skeleton (M0 — UIMessageStream ↔ bridge)

> **Version 1.1** (edge-cases EC-1..EC-5 absorbed 2026-07-03) — The thinnest end-to-end slice of the `theokit-ai-first` initiative: translate a `@theokit/sdk` agent text stream into the Vercel ai-sdk `UIMessageStream` protocol (text only) and expose it over SSE so `@ai-sdk/react`'s `useChat` renders it **without a custom adapter**. Proves the new architecture spine (SDK `run.stream()` → bridge translator → SSE → `useChat`) before M1 widens it to tool/reasoning parts. Grounded in the SHIPPABLE blueprint `ai-first-walking-skeleton-blueprint`.

## Goal

> Enable a TheoKit agent app to stream text to `@ai-sdk/react`'s `useChat` **without a custom adapter**, measured by a deterministic integration test asserting `useChat`'s parsed message text equals the agent's emitted text over the canonical UIMessageStream chunk sequence.

## Context

M0 of `ROADMAP.md` (`theokit-ai-first`). Today the theokit agent path emits a **proprietary** `AgentEvent` SSE (`packages/theo/src/server/define/define-agent-endpoint.ts:90` `data: ${JSON.stringify(event)}\n\n`) with no `x-vercel-ai-ui-message-stream: v1` header and no `[DONE]` terminal — so `useChat` cannot consume it, and the ecosystem's chat UIs (assistant-ui, ai-elements) are unreachable. The discovery blueprint (`.claude/knowledge-base/discoveries/blueprints/ai-first-walking-skeleton-blueprint.md`, SHIPPABLE_WITH_CAVEATS) established the exact chunk sequence, wire contract, pinned versions, and the single bridge translation point. This plan implements the text-only slice. Scope is deliberately narrow (Unbreakable Rule 11 — YAGNI): tool/reasoning/file parts belong to M1.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | LoC today | Last commit (sha + date) | Why it exists today | Invariants to preserve |
|---|---|---|---|---|
| `packages/agents/src/bridge/ui-message-stream-translator.ts` (NEW) | 0 | — | (to be created — the SDK-stream→UIMessageChunk translator) | — |
| `packages/agents/tests/unit/ui-message-stream-translator.test.ts` (NEW) | 0 | — | (to be created — RED unit test) | — |
| `packages/agents/src/bridge/agent-stream-events.ts` | 187 | `8842bc6` (2026-07-02) | The `AgentStreamEvent` union (incl. `TextDeltaEvent`, `RunStartedEvent`, `DoneEvent`, `ErrorEvent`) the translator consumes | Union unchanged — translator only READS it; no variant added/removed |
| `packages/agents/src/index.ts` | 16 | `9c04863` (2026-06-28) | Public barrel of `@theokit/agents` | New export appended; existing exports byte-unchanged |
| `packages/agents/package.json` | 62 | `0208e82` (2026-06-30) | Package manifest | Add `ai` as **devDependency** only (type + test schema); no runtime dep growth (sdk-runtime.md) |
| `packages/theo/package.json` | (manifest) | — | `theokit` package manifest | Add `ai` as **devDependency** only (EC-2 — T2 imports the type); no runtime dep growth |
| `packages/theo/src/server/define/ui-message-stream-response.ts` (NEW) | 0 | — | (to be created — SSE Response builder for UIMessageChunks) | — |
| `packages/theo/tests/unit/ui-message-stream-response.test.ts` (NEW) | 0 | — | (to be created — RED endpoint test) | — |
| `packages/theo/src/server/define/index.ts` | (barrel) | — | server/define public barrel | New export appended; existing unchanged |
| `fixtures/ui-message-stream-skeleton/` (NEW) | 0 | — | (to be created — walking-skeleton fixture app: agent endpoint + `useChat` page) | — |
| `packages/agents/tests/integration/ui-message-stream-e2e.test.ts` (NEW) | 0 | — | (to be created — deterministic integration test) | — |
| `CHANGELOG.md` | (large) | — | Workspace changelog | New `[Unreleased] § Added` entry |

### Current callers / dependents

- **Symbol:** `translateToUIMessageStream` (NEW) — no existing callers; wired by the theo-side response builder (T2) and the fixture (T3).
- **Symbol:** `AgentStreamEvent` union in `packages/agents/src/bridge/agent-stream-events.ts:149-165` — **read-only** here. Production callers: `sdk-adapter.ts` (`mergeDeltaStream`), `event-translator.ts`. Test callers: `event-translator.test.ts`. This plan adds a NEW consumer (the translator) that reads the ALREADY-deduped `AgentStreamEvent` stream; it does NOT modify the union (no downstream break).
- **External (public API consumed by other repos):** `@theokit/agents` barrel adds one export; additive, non-breaking (existing consumers ignore it).

### Domain glossary

- **UIMessageChunk** — an ai-sdk stream frame (`start`, `text-start`, `text-delta`, `text-end`, `finish`, …) that `useChat` parses; a `z.strictObject` in `ai` (`.claude/knowledge-base/references/ai-sdk/packages/ai/src/ui-message-stream/ui-message-chunks.ts`).
- **AgentStreamEvent** — theokit's internal, already-deduped bridge event (`RunStartedEvent`/`TextDeltaEvent`/`DoneEvent`/`ErrorEvent`), the translator's input.
- **mergeDeltaStream** — `sdk-adapter.ts:307-342` — merges the onDelta path with the buffered `run.stream()` path and dedups; the translator runs DOWNSTREAM of it, so it never re-introduces a dedup carve-out (EC-4).
- **UIMessageStream wire** — SSE with `content-type: text/event-stream` + `x-vercel-ai-ui-message-stream: v1` header, `data: {json}\n\n` framing, `data: [DONE]\n\n` terminal.

### Architecture boundaries affected

- `rules/architecture.md` — the `bridge` (`packages/agents/src/bridge/`) is the only SDK→event adapter; the new translator lives there (pure mapping). The SSE Response builder lives in `packages/theo/src/server/` (transport layer). Clean split: agents = translate to chunks, theo = HTTP transport. No inner→outer import; no new layer crossing.
- `rules/sdk-runtime.md` + `rules/system-design-guardrails.md` G2 — `@theokit/sdk` stays the only runtime; the translator is a pure function over an existing event stream, not a parallel runner. `ai` enters as a **type/test-only** devDependency, never a runtime dependency of the agent path.

## Prior Art & Related Work

- **Internal blueprint** — `.claude/knowledge-base/discoveries/blueprints/ai-first-walking-skeleton-blueprint.md` (Coverage Corners 1-4 + ADRs): the chunk sequence, wire contract, pinned versions, translation point, and the EC-1..EC-6 resolutions.
- **Reference project** — `.claude/knowledge-base/references/ai-sdk/packages/ai/src/ui-message-stream/ui-message-chunks.ts` (chunk union + Zod schema), `to-ui-message-stream.ts` (text chunking), `json-to-sse-transform-stream.ts` (framing + `[DONE]`), `ui-message-stream-headers.ts` (headers), `packages/react/src/use-chat.ts` (consumer).
- **Reference project (consumer corroboration)** — `.claude/knowledge-base/references/assistant-ui/packages/react-ai-sdk/src/ui/utils/convertMessage.ts` (how a real UI maps `message.parts`) — conceptual only (EC-6: pins a different `@ai-sdk/react` major).
- **Own-repo prior art** — `packages/agents/tests/unit/event-translator.test.ts:22-122` (the RED-test shape to mirror); `tool-call-input-surfacing` plan (dedup lesson feeding EC-4).
- **Patterns skills** — `theokit-http-decorators-pattern-from-nestjs-patterns` does NOT apply (it targets `@theokit/http` decorator bridges, not the UIMessageStream/bridge surface); no override needed.

## Objective

- [ ] Sub-goal 1 — `translateToUIMessageStream(events, { textId })` emits the exact ordered chunk sequence for text (`start → text-start → text-delta* → text-end → finish`), validated against ai-sdk's `uiMessageChunkSchema`.
- [ ] Sub-goal 2 — a theo-side helper serializes chunks to an SSE `Response` with the `x-vercel-ai-ui-message-stream: v1` header, `data:{json}\n\n` framing, and `data: [DONE]\n\n` terminal.
- [ ] Sub-goal 3 — a deterministic integration test drives a fixed `@theokit/sdk` SDKMessage fixture through translator + SSE and asserts `useChat`'s parsed text equals the emitted text — no custom adapter, no live LLM.
- [ ] Sub-goal 4 — `ai@^7.0.14` / `@ai-sdk/react@^4.0.15` pinned per blueprint; `ai` is a devDependency of `@theokit/agents` (types/tests only).

## ADRs

### D1 — Translate downstream of `mergeDeltaStream`, in a new `ui-message-stream-translator.ts`

**Decision:** Add a NEW pure function `translateToUIMessageStream(events: AsyncIterable<AgentStreamEvent>, opts): AsyncIterable<UIMessageChunk>` in `packages/agents/src/bridge/`, fed by the ALREADY-deduped `AgentStreamEvent` stream — NOT a new branch inside `translateSdkEvent`/`translateInteractionUpdate`.

**Rationale:** `architecture.md` (bridge is the only SDK→event adapter) + EC-4 from the edge-case review: live text flows via `translateInteractionUpdate` `text-delta` and is deduped by `mergeDeltaStream` (`sdk-adapter.ts:335`). Translating downstream reuses that dedup instead of adding a carve-out (the exact class of bug closed in `tool-call-input-surfacing`).

**Alternatives considered:** (a) Branch inside `translateSdkEvent` — REJECTED: would need a dedup carve-out and couple the wire format to the SDK-message path (EC-4). (b) A parallel runtime that re-runs the model into ai-sdk `streamText` — REJECTED: violates sdk-runtime.md (SDK is the only runtime) and re-implements the loop (YAGNI/Don't-Reinvent).

**Consequences:** the translator is unit-testable in isolation (pure over an event stream); M1 extends it with tool/reasoning chunks without touching the SDK-message path.

### D2 — `ai` is a devDependency of `@theokit/agents` (type + test schema only)

**Decision:** Add `ai@^7.0.14` as a **devDependency** of `@theokit/agents`; import `UIMessageChunk` as `import type` (erased at build) and use `uiMessageChunkSchema` only in tests to validate conformance. `@ai-sdk/react@^4.0.15` + `ai` are runtime deps of the fixture app only.

**Rationale:** sdk-runtime.md + parsimony-ladder rung 4 — the agent runtime must not grow a heavy runtime dependency for a type. `import type` is compile-time only; the schema is a test oracle. Versions are the npm `latest` line, byte-identical to the studied clone (blueprint EC-1: zero skew).

**Alternatives considered:** (a) `ai` as a runtime `dependency` of agents — REJECTED: needless runtime weight; the translator emits plain objects, not `ai` runtime calls. (b) Hand-roll local chunk types — REJECTED: Don't-Reinvent (Rule 9) + would drift from the real schema (the test oracle is the point).

**Consequences:** the agent path ships zero new runtime bytes; conformance is still enforced by the schema in tests.

### D3 — Deterministic fixture test is the CI gate; real-provider run is a recorded smoke

**Decision:** The automated integration test drives a fixed SDKMessage fixture (mocked `run.stream()`) with an injected `textId`; the DoD's "real provider" clause is a separate **manual smoke** recorded as evidence, never a CI dependency.

**Rationale:** `testing.md` §3 (determinism) + EC-2 — a live LLM makes the suite flaky and non-deterministic. Injecting `textId` removes the only non-determinism (the message id).

**Alternatives considered:** (a) Live provider in CI — REJECTED: flaky, non-deterministic, network-coupled. (b) Snapshot of a real run — REJECTED: still couples the assertion to a model's exact wording.

**Consequences:** the gate is reproducible; the "real provider" evidence lives in the implementation summary as a smoke log.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `ai@7.x` is a fast-moving package; the `UIMessageChunk` schema could change in a minor and break the pinned wire | Medium | Pin `^7.0.14`; the schema-conformance test fails loudly on drift; re-pin is a one-line change with a test signal | impl |
| The new translator + old `AgentEvent` SSE path now coexist (clean break is M3, not M0) — two agent wire formats temporarily | Low | Explicitly scoped: M0 adds the new path beside the old; M3 removes the old. Documented in ROADMAP; no shared state between them | impl |
| `useChat` in a JSDOM/node test env may need a fetch/stream polyfill to parse SSE | Medium | Test at the transport layer (`DefaultChatTransport.processResponseStream` / `parseJsonEventStream`) against the Response body, which is node-native — avoids a full DOM `useChat` render if the polyfill is fragile | impl |

## Unresolved Questions

- Q1 — Does the fixture assert via a full React `useChat` render (needs JSDOM + stream polyfill) OR via `DefaultChatTransport`/`parseJsonEventStream` against the Response body? Both prove "no custom adapter"; the transport-level assertion is more robust in node. Resolve in T3 by trying the transport-level path first (D-drawback mitigation).

## Dependencies

New third-party dependencies introduced by this plan (Unbreakable Rule 9 — do not reinvent; adopt the canonical protocol library):

| Package | Version (pinned) | Ecosystem | Scope | Rule 9 justification (why this, not hand-rolled) |
|---|---|---|---|---|
| `ai` | `^7.0.14` | npm | devDependency (`@theokit/agents`, `theokit`) | The canonical `UIMessageChunk` type + `uiMessageChunkSchema` (the protocol we adopt). Hand-rolling chunk types would drift from the real schema and defeat the interop goal. Import-type + test-schema only — zero runtime weight (D2). Confirmed npm `latest`, byte-identical to the studied clone (blueprint EC-1). |
| `@ai-sdk/react` | `^4.0.15` | npm | dependency (fixture app only) | `useChat` — the consumer whose parsing we must satisfy without a custom adapter (the Goal). Reimplementing it is out of scope and defeats the purpose. Confirmed npm `latest`. |

No production dependency of the framework core changes. No transitive CVE-bearing package is added beyond what `ai`/`@ai-sdk/react` already ship (verified in `/deps-audit`).

## Dependency Graph

```
Phase 0 (deps) ──▶ Phase 1 (translator) ──▶ Phase 2 (SSE response) ──▶ Phase 3 (fixture + integration)
                                                                              │
                                                                              ▼
                                                                   Final Phase: Integration Validation
```

Phases are sequential (each consumes the prior). No parallelism at M0's size.

---

## Phase 0: Dependencies

**Objective:** Pin `ai` / `@ai-sdk/react` per the blueprint so the translator can `import type` the chunk type and tests can validate against the real schema.

### T0.1 — Add `ai` devDependency to `@theokit/agents` + `@ai-sdk/react`+`ai` to the fixture

#### Objective
Make `UIMessageChunk` + `uiMessageChunkSchema` importable in agents (type/test) and `useChat` available to the fixture.

#### Why this step (action + reasoning)
1. **What this step does** — adds `ai@^7.0.14` to `packages/agents/package.json` `devDependencies`, and (in T3) `@ai-sdk/react@^4.0.15`+`ai@^7.0.14` to the fixture's `package.json`; runs `pnpm install`.
2. **Why now** — the translator (T1) `import type`s `UIMessageChunk` and its RED test imports `uiMessageChunkSchema`; both fail to resolve without the dep. Version is the npm `latest` line confirmed byte-identical to the studied clone (Blueprint §"Coverage Corner 2", EC-1) — no re-study needed.

#### Evidence
`packages/agents/package.json:62` has no `ai` dep today (`deps ai?: False`). Blueprint §"Coverage Corner 2": `npm view ai version` / `@ai-sdk/react` confirm `^7.0.14`/`^4.0.15` are `latest`.

#### Files to edit
```
packages/agents/package.json — add "ai": "^7.0.14" under devDependencies
packages/theo/package.json — add "ai": "^7.0.14" under devDependencies (EC-2 — T2.1 import type)
```

#### Deep file dependency analysis
`package.json` (Baseline row) — adds one devDependency; no runtime dependency change (D2). No downstream code depends on this line except T1's imports.

#### Deep Dives
- Invariant: `ai` MUST be `devDependencies`, not `dependencies`, for `@theokit/agents` (D2 — sdk-runtime.md, no runtime growth).

#### Tasks
1. Add `"ai": "^7.0.14"` to `packages/agents/package.json` devDependencies.
2. `pnpm install` (workspace root).

#### TDD
```
RED:     ui-message-stream-translator.test.ts imports { uiMessageChunkSchema } from 'ai' — fails to resolve before install.
GREEN:   After adding the dep + install, the import resolves (verified by T1's test running).
REFACTOR: None expected.
VERIFY:  pnpm --filter @theokit/agents test -- ui-message-stream-translator
```

#### Concurrency tests (only when applicable)

`(none — single-threaded)` — a dependency-manifest edit; no shared state, no concurrency.

#### Acceptance Criteria
- [ ] `ai` present in `packages/agents/package.json` devDependencies at `^7.0.14`.
- [ ] `import type { UIMessageChunk } from 'ai'` and `import { uiMessageChunkSchema } from 'ai'` resolve in the agents test.
- [ ] Pass: lint — zero warnings on changed files.

#### DoD
- [ ] `pnpm install` succeeds; `ai` resolvable in `@theokit/agents`.
- [ ] No new entry under agents `dependencies` (only `devDependencies`).

---

## Phase 1: The translator (core)

**Objective:** Pure `AgentStreamEvent` → `UIMessageChunk` translation for text, schema-validated.

### T1.1 — `translateToUIMessageStream(events, { textId })`

#### Objective
Emit `start → text-start{id} → text-delta{id,delta}* → text-end{id} → finish` for a text run; `[start, finish]` for an empty run; a graceful `error`+`finish` when the event stream errors.

#### Why this step (action + reasoning)
1. **What this step does** — creates `packages/agents/src/bridge/ui-message-stream-translator.ts` exporting an async generator that consumes `AgentStreamEvent`s and yields `UIMessageChunk`s with a single shared `id` (injected via `opts.textId` for determinism).
2. **Why now** — this is the crux of M0 (Goal). It is a pure function (D1), so it is fully unit-testable before any HTTP/fixture wiring. Downstream (T2/T3) only transports its output.

#### Evidence
Blueprint §"Coverage Corner 4": chunk sequence + `z.strictObject` schema (`ui-message-chunks.ts:23-215`); golden test shape (`to-ui-message-stream.test.ts:68-77`). Input union: `agent-stream-events.ts:149-165`.

#### Files to edit
```
packages/agents/src/bridge/ui-message-stream-translator.ts — NEW: translateToUIMessageStream
packages/agents/tests/unit/ui-message-stream-translator.test.ts — NEW: RED tests (first)
packages/agents/src/index.ts — export the new symbol
```

#### Deep file dependency analysis
- `ui-message-stream-translator.ts` (NEW) — reads `AgentStreamEvent` (Baseline: read-only union). Emits `UIMessageChunk` (`import type` from `ai`).
- `index.ts` (Baseline row, 16 LoC) — append one export; existing exports unchanged (additive barrel).

#### Deep Dives
- Data structures: each text-* chunk carries the SAME `id` (`opts.textId`); `text-delta` carries `{ id, delta }`. Frame chunks `start`/`finish` carry no id (EC-3).
- Algorithm: on `RunStarted` → emit `start`; on FIRST `TextDelta` → emit `text-start{id}` then `text-delta`; subsequent `TextDelta` → `text-delta`; on `Done` (or stream end after any text) → `text-end{id}` then `finish`; on `Error` → `text-end` (if open) then `finish` (graceful, no throw past the boundary — error-handling.md).
- Invariants: exactly one `start` and one `finish` per run; `text-end` only if a `text-start` was emitted; output validates against `uiMessageChunkSchema`.
- Edge cases: empty stream → `[start, finish]`; error before any text → `[start, finish]` (no orphan `text-end`).

#### Pseudo-code / Signatures
```pseudocode
async function* translateToUIMessageStream(events, { textId }):
  yield { type: 'start' }
  textOpen = false
  try:
    for await ev of events:
      if ev.type == 'text_delta':
        if not textOpen: yield { type:'text-start', id:textId }; textOpen = true
        yield { type:'text-delta', id:textId, delta: ev.content }
      # tool/reasoning: out of scope M0 (ignored — M1)
  catch:
    # graceful — fall through to close
  if textOpen: yield { type:'text-end', id:textId }
  yield { type:'finish' }

# Example
input:  [RunStarted, TextDelta("he"), TextDelta("llo"), Done]  textId="t0"
output: [start, text-start{t0}, text-delta{t0,"he"}, text-delta{t0,"llo"}, text-end{t0}, finish]
```

#### Tasks
1. Write RED tests: happy text, empty stream, error mid-stream, schema-conformance (`uiMessageChunkSchema.parse` on every chunk).
2. Implement the generator (minimal).
3. Export from `index.ts`.

#### TDD
```
RED:     translates_text_run_to_ordered_chunks() — asserts exact chunk sequence for [RunStarted,TextDelta,TextDelta,Done].
RED:     empty_run_emits_start_then_finish() — asserts [start, finish].
RED:     stream_error_closes_gracefully() — asserts open text is closed + finish, no throw.
RED:     every_chunk_validates_against_ui_message_chunk_schema() — uiMessageChunkSchema.parse per chunk INCLUDING the start/finish frame chunks (EC-3), injecting any required frame field (e.g. messageId) deterministically.
GREEN:   Implement translateToUIMessageStream (minimal).
REFACTOR: Extract chunk-builder helpers only if it reduces duplication; else none.
VERIFY:  pnpm --filter @theokit/agents test -- ui-message-stream-translator
```

#### Concurrency tests (only when applicable)

`(none — single-threaded)` — async iteration is a single sequential consumer with no shared mutable state across concurrent tasks (no lock/atomic/channel).

#### Acceptance Criteria
- [ ] Chunk sequence exact for happy/empty/error cases.
- [ ] Every emitted chunk passes `uiMessageChunkSchema.parse`.
- [ ] Pass: complexity ≤ 10; coverage 100% on the new file (critical path); lint clean; file ≤ 500 lines.

#### DoD
- [ ] `pnpm --filter @theokit/agents test` green; `pnpm --filter @theokit/agents typecheck` clean.
- [ ] `translateToUIMessageStream` exported from the barrel.

---

## Phase 2: SSE Response (theo transport)

**Objective:** Serialize `UIMessageChunk`s into a `useChat`-parseable SSE `Response`.

### T2.1 — `uiMessageStreamResponse(chunks)` SSE builder

#### Objective
Produce a `Response` with `content-type: text/event-stream` + `x-vercel-ai-ui-message-stream: v1`, `data:{json}\n\n` per chunk, and a `data: [DONE]\n\n` terminal.

#### Why this step (action + reasoning)
1. **What this step does** — creates `packages/theo/src/server/define/ui-message-stream-response.ts` exporting `uiMessageStreamResponse(chunks: AsyncIterable<UIMessageChunk>): Response` using a `ReadableStream` (mirrors the existing `define-agent-endpoint.ts` encoder pattern, new headers + `[DONE]`).
2. **Why now** — the translator (T1) yields chunks; the client (`useChat`) needs them over the exact wire the transport validates. This is the transport half of the split (D1 — agents translate, theo transports).

#### Evidence
Blueprint §"Coverage Corner 4": headers (`ui-message-stream-headers.ts:1-7`), framing (`json-to-sse-transform-stream.ts:10`), `[DONE]` (`:12-14`), consumer ignores `[DONE]` (`parse-json-event-stream.ts:24-30`). Existing encoder pattern: `define-agent-endpoint.ts:84-268`.

#### Files to edit
```
packages/theo/src/server/define/ui-message-stream-response.ts — NEW: uiMessageStreamResponse
packages/theo/tests/unit/ui-message-stream-response.test.ts — NEW: RED test (first)
packages/theo/src/server/define/index.ts — export the new symbol
```

#### Deep file dependency analysis
- `ui-message-stream-response.ts` (NEW) — Web Standards `Response` + `ReadableStream` (no `node:http` — architecture.md G8). Consumes `UIMessageChunk` (`import type` from `ai`, devDep in theo too if needed).
- `define/index.ts` — append export; existing unchanged.

#### Deep Dives
- Invariant: headers set BEFORE the stream starts (mirrors `define-agent-endpoint.ts` cookie-header note); `[DONE]` flushed after the last chunk; encoder is `data: ${JSON.stringify(chunk)}\n\n`.
- Edge cases: empty chunk iterable → still emits valid headers + `[DONE]`; a throwing iterable → close the stream (no hang).

#### Pseudo-code / Signatures
```pseudocode
function uiMessageStreamResponse(chunks): Response
  stream = new ReadableStream({
    start(controller):
      for await c of chunks: controller.enqueue(encode(`data: ${JSON.stringify(c)}\n\n`))
      controller.enqueue(encode(`data: [DONE]\n\n`)); controller.close()
  })
  return new Response(stream, { headers: {
    'content-type': 'text/event-stream',
    'x-vercel-ai-ui-message-stream': 'v1' } })
```

#### Tasks
1. RED test: assert response headers + body framing + `[DONE]` terminal for a 2-chunk iterable.
2. Implement the builder (minimal).
3. Export from `define/index.ts`.

#### TDD
```
RED:     sets_ui_message_stream_headers() — content-type + x-vercel-ai-ui-message-stream: v1.
RED:     frames_each_chunk_as_sse_data_line() — body contains `data: {json}\n\n` per chunk.
RED:     terminates_with_done_marker() — body ends with `data: [DONE]\n\n`.
GREEN:   Implement uiMessageStreamResponse (minimal).
REFACTOR: Reuse the existing encodeSSE helper if extractable without coupling; else none.
VERIFY:  pnpm --filter theokit test -- ui-message-stream-response
```

#### Concurrency tests (only when applicable)

`(none — single-threaded)` — ReadableStream construction with a single-consumer pull; no shared mutable state (no lock/atomic/channel).

#### Acceptance Criteria
- [ ] Headers exact; framing exact; `[DONE]` present.
- [ ] No `node:http` import (Web Standards — architecture.md G8).
- [ ] Pass: complexity ≤ 10; coverage 100%; lint clean; file ≤ 500 lines.

#### DoD
- [ ] `pnpm --filter theokit test` green; typecheck clean.

---

## Phase 3: Skeleton fixture + integration

**Objective:** Prove the full chain end-to-end, deterministically, with `useChat` and no custom adapter.

### T3.1 — Walking-skeleton fixture + deterministic integration test

#### Objective
Wire `SDKMessage fixture → AgentStreamEvent → translateToUIMessageStream → uiMessageStreamResponse → useChat/transport` and assert the parsed text equals the emitted text.

#### Why this step (action + reasoning)
1. **What this step does** — creates `fixtures/ui-message-stream-skeleton/` (an agent endpoint that emits UIMessageStream from a fixed SDKMessage + a `useChat` page) and `packages/agents/tests/integration/ui-message-stream-e2e.test.ts` that drives the chain with a mocked `run.stream()` and asserts via `DefaultChatTransport`/`parseJsonEventStream` (Q1 resolution) that text round-trips.
2. **Why now** — this is the Goal's metric: `useChat` renders theokit text without a custom adapter. It composes T1 + T2 (D3 — deterministic gate).

#### Evidence
Blueprint §"Coverage Corner 3": skeleton home is a sibling of `fixtures/use-agent-stream-react/`; consumer parse path `default-chat-transport.ts` + `parse-json-event-stream.ts`. Existing sibling fixture confirmed: `fixtures/use-agent-stream-react/`.

#### Files to edit
```
fixtures/ui-message-stream-skeleton/ — NEW: server/agents/echo.ts (emits UIMessageStream) + app page using useChat + package.json (@ai-sdk/react, ai)
packages/agents/tests/integration/ui-message-stream-e2e.test.ts — NEW: deterministic integration test (mock run.stream)
```

#### Deep file dependency analysis
- Fixture (NEW) — consumes `translateToUIMessageStream` (T1) + `uiMessageStreamResponse` (T2) + `@ai-sdk/react` `useChat`.
- Integration test (NEW) — injects a fixed SDKMessage; mocks `run.stream()`; parses the Response through the ai-sdk transport; asserts text equality.

#### Deep Dives
- Invariant (EC-2/D3): NO live LLM in the test; `run.stream()` is mocked to yield a fixed text sequence; `textId` injected for determinism.
- Q1 resolution: assert at the transport layer first (`DefaultChatTransport.processResponseStream` over the Response body) — node-native, no JSDOM; fall back to a full `useChat` render only if a maintainer wants the React-level proof.
- Edge case: assert the parsed UI message's concatenated text parts == the fixture's emitted text exactly.

#### Pseudo-code / Signatures
```pseudocode
test "useChat parses theokit agent text without a custom adapter":
  fixtureEvents = [RunStarted, TextDelta("Hello, "), TextDelta("world"), Done]
  res = uiMessageStreamResponse(translateToUIMessageStream(fixtureEvents, { textId: 't0' }))
  parsed = await collect(DefaultChatTransport.processResponseStream(res.body))  # ai-sdk consumer
  assert concatText(parsed) == "Hello, world"
  assert res.headers.get('x-vercel-ai-ui-message-stream') == 'v1'
```

#### Tasks
1. RED integration test: build the chain from a fixture event stream, parse via the ai-sdk transport, assert text equality + header.
2. Create the fixture app: a **manually-wired** endpoint (a route/handler calling `translateToUIMessageStream` + `uiMessageStreamResponse` directly — NOT the `server/agents/` convention, which is M2 per EC-1) + a `useChat` page + its `package.json`. The "no custom adapter" claim M0 proves is **client-side** (`useChat` needs no adapter).
3. GREEN: ensure T1+T2 satisfy the assertion.
4. Record the manual real-provider smoke (D3) in the implementation summary.

#### TDD
```
RED:     usechat_parses_theokit_text_without_custom_adapter() — text round-trips through the ai-sdk transport.
RED:     response_carries_ui_message_stream_v1_header() — header present end-to-end.
GREEN:   Compose T1+T2 in the fixture; no new production code beyond wiring.
REFACTOR: None expected.
VERIFY:  pnpm --filter @theokit/agents test -- ui-message-stream-e2e
```

#### Concurrency tests (only when applicable)

`(none — single-threaded)` — the stream is consumed once, sequentially; no shared mutable state (no lock/atomic/channel).

#### Acceptance Criteria
- [ ] Integration test green with a mocked provider (deterministic).
- [ ] The fixture exposes an agent via a **manually-wired** endpoint emitting UIMessageStream (the client-side "no custom adapter" proof; the `server/agents/` convention is M2 — EC-1).
- [ ] Manual real-provider smoke recorded in the implementation summary (DoD evidence, not CI).
- [ ] Pass: lint clean; files ≤ 500 lines.

#### DoD
- [ ] `pnpm --filter @theokit/agents test` green (unit + integration).
- [ ] Typecheck + lint clean across changed packages.

---

## Coverage Matrix

| # | Gap / Requirement (Goal sub-goal / blueprint corner) | Task(s) | Resolution |
|---|---|---|---|
| 1 | Text chunk sequence (Sub-goal 1 / Corner 4) | T1.1 | translateToUIMessageStream + schema test |
| 2 | SSE wire contract (Sub-goal 2 / Corner 4) | T2.1 | uiMessageStreamResponse (headers + framing + [DONE]) |
| 3 | useChat consumes without adapter (Sub-goal 3 / Corner 3) | T3.1 | deterministic integration test + fixture |
| 4 | Pin ai/@ai-sdk/react; ai devDep only (Sub-goal 4 / Corner 2) | T0.1, D2 | manifest + import-type + test schema |
| 5 | Translate downstream of dedup (EC-4) | T1.1, D1 | pure fn over deduped AgentStreamEvent |
| 6 | Determinism, no live LLM (EC-2) | T3.1, D3 | mocked run.stream + injected textId |

**Coverage: 6/6 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/agents test && pnpm --filter theokit test` green
- [ ] Zero type errors — `pnpm --filter @theokit/agents typecheck && pnpm --filter theokit typecheck`
- [ ] Zero lint warnings — `pnpm lint` on changed files
- [ ] File-size budget respected (≤ 500 LoC per `rules/architecture.md`)
- [ ] CHANGELOG.md updated under `[Unreleased] § Added`
- [ ] Backward compatibility preserved — additive barrel exports only; old `AgentEvent` SSE path untouched (clean break is M3)
- [ ] Plan-specific: the integration test asserts `useChat`-parsed text == emitted text (the Goal metric)
- [ ] Runtime-metric proof — the integration test observes the full chain producing the `x-vercel-ai-ui-message-stream: v1` framed body non-empty (the wiring fires)
- [ ] Plan archived after `/review` READY_TO_MERGE + merge

## Failure scenarios (when I/O external)

The translator consumes `@theokit/sdk` `run.stream()` (the one external, non-deterministic dependency), mocked in tests.

| Dependency | Failure mode | How the test reproduces it | Expected behavior |
|---|---|---|---|
| `@theokit/sdk` `run.stream()` (LLM stream) | stream throws / aborts mid-text | mocked async iterable that yields 1 `TextDelta` then throws | translator closes the open text (`text-end`) + emits `finish` gracefully; no unhandled throw past the boundary; SSE still terminates with `[DONE]` |

## Final Phase: Integration Validation (MANDATORY)

**Objective:** Validate the full chain in a real (mocked-provider) workload.

### Execution
```
pnpm --filter @theokit/agents test        # unit + integration
pnpm --filter theokit test                # theo-side SSE unit
pnpm --filter @theokit/agents typecheck   # zero type errors
pnpm --filter theokit typecheck
pnpm lint                                  # zero warnings on changed files
```

### Acceptance Criteria
- [ ] All suites green (unit + integration)
- [ ] Coverage ≥ 90% on changed files (translator critical path: 100%)
- [ ] Zero type errors; zero lint warnings
- [ ] Runtime-metric proof — the integration test observes the `v1`-framed SSE body produced end-to-end
- [ ] Failure scenario green — the `run.stream()` mid-stream error row was exercised and the graceful close observed

### If Validation Fails
1. Separate plan-caused failures from pre-existing.
2. Fix all plan-caused failures.
3. Re-run the chain.
4. Log pre-existing issues in the PR description.
