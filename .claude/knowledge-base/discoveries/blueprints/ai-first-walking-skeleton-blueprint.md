# Blueprint: AI-First Walking Skeleton (M0)

> **Exec summary.** To make `@ai-sdk/react`'s `useChat` render a theokit agent's streaming **text** with zero custom adapter, the server must emit exactly five UIMessageChunk types in order — `start` → `text-start` → `text-delta*` → `text-end` → `finish` — each serialized as one `data: {json}\n\n` SSE frame followed by a terminal `data: [DONE]\n\n`, under the header set `content-type: text/event-stream` + `x-vercel-ai-ui-message-stream: v1`. The chunk schema is a `z.strictObject` union (extra keys are rejected), so the frame chunks (`start`/`finish`) and the shared text-block `id` across `text-start`/`text-delta`/`text-end` are load-bearing (EC-3). The clone under `references/ai-sdk` IS the npm `latest` line (`ai@7.0.14` / `@ai-sdk/react@4.0.15`) — **zero version↔protocol skew** (EC-1 resolved favorably). The translation belongs at a **new** `StreamEvent[] → UIMessageChunk[]` seam fed by the already-deduped bridge stream, NOT a new branch inside `translateSdkEvent`/`translateInteractionUpdate` (EC-4), so `mergeDeltaStream`'s dedup is untouched. The test shape mirrors ai-sdk's `convertReadableStreamToArray` + `toEqual` and theokit's `translateSdkEvent(...) .toEqual([...])`, split per EC-2 into a deterministic fixture CI gate + a manual real-provider smoke.
>
> Verdict: (to be scored by /discover-confidence)

---

## Coverage Corner 1 — Integration Tests

Answers **Q5** (ai-sdk fixture/assertion pattern to mirror) and **Q6** (theokit RED test shape).

### Q5 — The ai-sdk fixture + assertion pattern

The producer's canonical test for the text stream is `to-ui-message-stream.test.ts`. The pattern is: build a fixture **array** of input parts, convert it to a `ReadableStream`, pipe through the transform under test, collect back to an array, and assert the **exact ordered chunk array** with `toEqual`.

- Fixture construction + drive + collect: `convertArrayToReadableStream(parts)` → `toUIMessageStream({ stream, tools: undefined })` → `convertReadableStreamToArray(...)` — `.claude/knowledge-base/references/ai-sdk/packages/ai/src/ui-message-stream/to-ui-message-stream.test.ts:61-66`.
- The golden text fixture (input parts): `start`, `start-step`, `text-start id:'t1'`, two `text-delta` (`'Hello'`, `', world!'`), `text-end`, `finish-step`, `finish` — `to-ui-message-stream.test.ts:28-59`.
- The golden assertion (output chunks) is exact-array `toEqual` — `to-ui-message-stream.test.ts:68-77`:
  ```
  [ { type:'start' }, { type:'start-step' },
    { type:'text-start', id:'t1' },
    { type:'text-delta', id:'t1', delta:'Hello' },
    { type:'text-delta', id:'t1', delta:', world!' },
    { type:'text-end', id:'t1' },
    { type:'finish-step' }, { type:'finish', finishReason:'stop' } ]
  ```
- The `id` flows through unchanged (`text-start`/`text-delta`/`text-end` all carry `id:'t1'`) and `delta` carries the text — the assertion proves the delta rename (`part.text` → `chunk.delta`) at `to-ui-message-chunk.ts:70-79`.
- Helper import origin (test-only utilities): `@ai-sdk/provider-utils/test` — `to-ui-message-stream.test.ts:1-4`. Our integration test will hand-build the equivalent array collector (theokit has no such helper) or assert on the SSE byte string directly.

**Mirror for M0:** feed a fixed `StreamEvent[]` (or `AgentStreamEvent[]`) fixture into the new translator, collect the emitted `UIMessageChunk[]`, and assert the exact ordered array with `toEqual`. Add a second wire-level assertion on the serialized SSE bytes (`data: {json}\n\n … data: [DONE]\n\n`).

### Q6 — The theokit RED test shape to mirror

The existing bridge translator is unit-tested in `packages/agents/tests/unit/event-translator.test.ts`. The pattern: call the pure translator with a literal fixture message and assert the exact event array with `toEqual`.

- Header comment mandates reading the REAL SDK shapes, not inferring — `event-translator.test.ts:1-14`.
- Canonical text case: `translateSdkEvent({ type:'assistant', …, message:{ role:'assistant', content:[{ type:'text', text:'Hello world' }] } }, RUN)` → `expect(events).toEqual([{ type:'text_delta', content:'Hello world' }])` — `event-translator.test.ts:22-34`.
- `toMatchObject` is used for partial shapes (tool results) — `event-translator.test.ts:69-76`; `toEqual` for exact arrays (text) — `event-translator.test.ts:33`. The new translator's RED test uses **`toEqual`** (the chunk sequence is exact and ordered).

**RED skeleton for the new translator (write BEFORE any GREEN code — `testing.md` §3):**
```
it('test_text_deltas_map_to_uimessage_chunk_sequence', () => {
  const chunks = translateToUIMessageStream([
    { type: 'run_started', runId: 'r', agentName: 'a' },
    { type: 'text_delta', content: 'Hello' },
    { type: 'text_delta', content: ' world' },
    { type: 'done', result: '', usage: {…}, durationMs: 0 },
  ], { textId: 't1' })            // id injected for determinism
  expect(chunks).toEqual([
    { type: 'start' },
    { type: 'text-start', id: 't1' },
    { type: 'text-delta', id: 't1', delta: 'Hello' },
    { type: 'text-delta', id: 't1', delta: ' world' },
    { type: 'text-end', id: 't1' },
    { type: 'finish' },
  ])
})
```
Negative case (per `testing.md` §4.1): assert a `run_started` with no `text_delta` still frames a valid empty text block or omits it deterministically. Determinism: the text-block `id` MUST be injectable (fixture passes `'t1'`), never `crypto.randomUUID()` inside the assertion path (EC-2 / `testing.md` §3).

---

## Coverage Corner 2 — Dependencies

Answers **Q4** (pinned `ai` + `@ai-sdk/react` versions) with the EC-1 version↔protocol note.

### Q4 — Version decision

| Package | Clone version (read for schema) | npm `latest` dist-tag (2026-07-02) | Recommended pin | Source |
|---|---|---|---|---|
| `ai` | `7.0.14` | `7.0.14` | `^7.0.14` | clone `references/ai-sdk/packages/ai/package.json` (`"version": "7.0.14"`); `npm view ai dist-tags` → `latest: 7.0.14` |
| `@ai-sdk/react` | `4.0.15` | `4.0.15` | `^4.0.15` | clone `references/ai-sdk/packages/react/package.json` (`"name": "@ai-sdk/react"`, `"version": "4.0.15"`); `npm view @ai-sdk/react dist-tags` → `latest: 4.0.15` |
| `react` (peer) | — | — | `^18 || ^19` (peerDep of `@ai-sdk/react`) | `npm view @ai-sdk/react peerDependencies` → `react: "^18 || ~19.0.1 || ~19.1.2 || ^19.2.1"` |

- `ai` and `@ai-sdk/react` are versioned **independently** (`ai` is on major 7, `@ai-sdk/react` on major 4) — do NOT assume a shared major. The `latest` dist-tags pair them: `ai@7.0.14` ↔ `@ai-sdk/react@4.0.15`.
- **EC-1 (version↔protocol skew) — RESOLVED FAVORABLY.** The plan warned the clone numbers (`ai@7.0.14`/`@ai-sdk/react@4.0.15`) were "likely internal workspace numbers". They are NOT: `npm view` returns those exact numbers as `latest`. The chunk schema (Q1) and wire headers (Q3) were read from `references/ai-sdk` at `ai@7.0.14` / `@ai-sdk/react@4.0.15`, which IS the published line we pin. **Zero re-read required; zero skew risk.**
- **EC-6 / D4 — assistant-ui is conceptual only, different major.** `references/assistant-ui/packages/react-ai-sdk/package.json:54-58` pins `@ai-sdk/react: "^3.0.211"` + `ai: "^6.0.209"` — the **v6/v3** line (`npm view` confirms dist-tags `ai-v6: 6.0.219`, `@ai-sdk/react` `ai-v6: 3.0.221`). This is one major behind the pin. Use assistant-ui to corroborate the `message.parts` **concept** only; it is NOT a byte-exact wire reference for `ai@7`.
- Other dist-tags exist and MUST NOT be pinned for M0: `alpha` (`ai@5.0.0-alpha.15`), `beta`/`canary` (`7.0.0-*`), `ai-v5` (`5.0.210`). Only `latest` is the stable line.

**Decision:** pin `"ai": "^7.0.14"` and `"@ai-sdk/react": "^4.0.15"` as app-level deps of the M0 skeleton (they are NOT deps of the framework core — the consumer app installs them; the framework only needs to emit the wire format). `/deps-audit` runs against these in the plan phase.

---

## Coverage Corner 3 — Tools

Answers **Q7** (skeleton home + endpoint wiring + the two EC-2 test artifacts).

### Q7 — Where the walking skeleton lives + how it is wired

**Skeleton home.** The closest live pattern is the fixture `fixtures/use-agent-stream-react/` — it already carries the full agent slice: `app/page.tsx` (client), `server/routes/agent.ts` (endpoint), `theo.config.ts`. The M0 skeleton is a sibling of this — either an added fixture `fixtures/agent-uimessagestream/` or a UIMessageStream variant inside a new example — that swaps the proprietary writer for the UIMessageStream writer and swaps the client from `useAgentStream` to `@ai-sdk/react`'s `useChat`.

- Current endpoint (proprietary path): `fixtures/use-agent-stream-react/server/routes/agent.ts:3-9` — `defineAgentEndpoint({ async *handler(){ yield { type:'message', content:… } } })`. Note the yielded `AgentEvent` is `{ type:'message', content }` (theokit-proprietary), NOT a UIMessageChunk.
- The endpoint builder returns a `Response` whose SSE headers are `SSE_HEADERS = { 'content-type':'text/event-stream', 'cache-control':'no-cache, no-transform', connection:'keep-alive' }` — `packages/theo/src/server/define/define-agent-endpoint.ts:84-88`. **This set lacks `x-vercel-ai-ui-message-stream: v1`** (the M0 writer must add it — see Q3).
- The writer frames each event as `data: ${JSON.stringify(event)}\n\n` (`encodeSSE`) — `define-agent-endpoint.ts:90-92` — and has **no `[DONE]` terminal** (`controller.close()` with no flush — `define-agent-endpoint.ts:260-263`). The M0 writer must append `data: [DONE]\n\n` before close (see Q3).
- The generator is primed to its first yield before headers commit (cookie flush) — `define-agent-endpoint.ts:191-207` — a shape the M0 writer keeps.
- Current client for the proprietary path (to be REPLACED by `useChat`): `packages/theo/src/client/use-agent-stream.ts:73-76` — `useAgentStream(path, options)`, fetch + ReadableStream, NOT EventSource (D7).

**Endpoint-wiring steps for M0:**
1. New writer (or a `defineAgentEndpoint` mode) that emits `UI_MESSAGE_STREAM_HEADERS` (Q3) instead of `SSE_HEADERS`, frames each `UIMessageChunk` as `data: {json}\n\n`, and flushes `data: [DONE]\n\n` on close.
2. New translator `translateToUIMessageStream(events, { textId })` (Q2) feeding that writer.
3. Client page uses `useChat({ transport: new DefaultChatTransport({ api: '/api/agent' }) })` (default transport parses the wire — Q3).

**EC-2 — the TWO test artifacts:**
1. **Deterministic CI gate** (the only thing CI runs). A unit/integration test that feeds a fixed `StreamEvent[]` fixture (mocked `run.stream()` — no live LLM) through `translateToUIMessageStream` + the SSE writer, asserting (a) the exact `UIMessageChunk[]` via `toEqual` and (b) the serialized SSE bytes including the `[DONE]` terminal and the `x-vercel-ai-ui-message-stream: v1` response header. Home: `packages/agents/tests/unit/ui-message-stream-translator.test.ts` (mirrors `event-translator.test.ts`) + a theo-side endpoint test asserting `Response.headers`. Deterministic per `testing.md` §3 — text-block `id` injected, no `Date.now()`/RNG in the asserted path.
2. **Real-provider smoke** (recorded as DoD evidence, NEVER a CI dependency). A manual run of the skeleton fixture against a live `@theokit/sdk` provider where `useChat` renders the streamed text end-to-end, captured as dogfood evidence. This satisfies the ROADMAP "real provider" clause without introducing a flaky live-LLM CI gate (D4).

---

## Coverage Corner 4 — Techniques

Answers **Q1** (exact ordered TEXT chunk sequence incl. frame chunks — EC-3), **Q3** (wire contract — header + framing + `[DONE]`), and **Q2** (single bridge translation point — EC-4).

### Q1 — Exact ordered UIMessageChunk sequence for streaming TEXT (EC-3)

The chunk union is defined twice in `ui-message-chunks.ts`: a runtime `z.strictObject` Zod union (used by the consumer to validate) at `:23-215`, and the TS type at `:226-398`. `strictObject` (e.g. `:26`, `:31`, `:37`) means **any extra key fails validation** — chunks must be minimal.

The minimal ordered sequence `useChat` needs to render pure streaming text, with the message-frame chunks (EC-3) that a text-only list would omit:

| # | Chunk | Required fields | Zod schema cite | TS type cite | Producer branch cite |
|---|---|---|---|---|---|
| 1 | `start` (message frame open) | none (`messageId?` optional) | `ui-message-chunks.ts:186-190` | `ui-message-chunks.ts:381-385` | `to-ui-message-chunk.ts:343-356` (emitted when `sendStart` — default true) |
| 2 | `text-start` | `id` | `ui-message-chunks.ts:26-30` | `ui-message-chunks.ts:230-234` | `to-ui-message-chunk.ts:60-68` |
| 3 | `text-delta` (repeat N×) | `id`, `delta` | `ui-message-chunks.ts:31-36` | `ui-message-chunks.ts:235-240` | `to-ui-message-chunk.ts:70-79` (`delta: part.text`) |
| 4 | `text-end` | `id` | `ui-message-chunks.ts:37-41` | `ui-message-chunks.ts:241-245` | `to-ui-message-chunk.ts:81-89` |
| 5 | `finish` (message frame close) | none (`finishReason?` optional) | `ui-message-chunks.ts:191-204` | `ui-message-chunks.ts:386-390` | `to-ui-message-chunk.ts:358-371` (emitted when `sendFinish` — default true) |

- **EC-3 satisfied:** the sequence includes the message-frame chunks `start` (#1) and `finish` (#5). A text-only list (`text-start`/`text-delta`/`text-end`) without the `start`/`finish` frame is the documented silent-failure mode — `useChat` needs the frame to open/close the assistant message. Confirmed by the golden test asserting `start` first and `finish` last — `to-ui-message-stream.test.ts:68-77`.
- The **`id` correlates the text block**: `text-start`, every `text-delta`, and `text-end` MUST carry the **same** `id` (the test uses `'t1'` throughout — `to-ui-message-stream.test.ts:71-74`). Emit one id per text block and reuse it.
- `toUIMessageStream` defaults `sendStart = true`, `sendFinish = true` — `to-ui-message-stream.ts:26-27` — which is why `start`/`finish` appear without opt-in.
- `start-step`/`finish-step` (`to-ui-message-stream.test.ts:69,75`) are step demarcation chunks emitted by `streamText`; they are OPTIONAL for M0 text rendering (they carry no fields — `ui-message-chunks.ts:180-185` / `:375-380`). M0 may omit them; if emitted they must be exactly `{ type:'start-step' }` / `{ type:'finish-step' }`.
- **Out of M0 scope (M1):** `reasoning-*`, `tool-*`, `source-*`, `file`, `data-*`, `message-metadata`, `abort` chunks all exist in the union (`ui-message-chunks.ts:46-212`) but are NOT emitted for text-only.

### Q3 — The wire contract `DefaultChatTransport` requires (EC-1 note inline)

**Response headers** (producer sets the full set): `content-type: text/event-stream`, `cache-control: no-cache`, `connection: keep-alive`, `x-vercel-ai-ui-message-stream: v1`, `x-accel-buffering: no` — `.claude/knowledge-base/references/ai-sdk/packages/ai/src/ui-message-stream/ui-message-stream-headers.ts:1-7`. Applied to the `Response` at `create-ui-message-stream-response.ts:39-43`.

**Framing:** each chunk is one SSE data frame `data: ${JSON.stringify(part)}\n\n` — `json-to-sse-transform-stream.ts:10`. Then the body is UTF-8 encoded via `TextEncoderStream` — `create-ui-message-stream-response.ts:39`.

**Terminal marker:** on stream end the transform flushes `data: [DONE]\n\n` — `json-to-sse-transform-stream.ts:12-14`.

**What the consumer actually requires vs ignores:**
- `DefaultChatTransport.processResponseStream` pipes the raw body through `parseJsonEventStream({ stream, schema: uiMessageChunkSchema })` then throws on any parse failure — `default-chat-transport.ts:19-35`. So **every frame's JSON must validate against the `strictObject` union** (Q1) or the whole stream throws (`default-chat-transport.ts:28-30`).
- `parseJsonEventStream` decodes text, runs `EventSourceParserStream`, and **explicitly ignores the `[DONE]` data** (`if (data === '[DONE]') return`) — `.claude/knowledge-base/references/ai-sdk/packages/provider-utils/src/parse-json-event-stream.ts:24-30`. `[DONE]` is a terminal courtesy; the consumer does not require it to parse, but the producer contract emits it.
- The HTTP call is `POST` with `Content-Type: application/json` body; it requires `response.ok` and a non-empty `response.body`, else it throws — `http-chat-transport.ts:191-213`. Default `api` is `/api/chat` (override via `DefaultChatTransport({ api })`) — `http-chat-transport.ts:127-128`.
- **Honesty note (EC-1-adjacent):** `DefaultChatTransport` does NOT assert the `x-vercel-ai-ui-message-stream: v1` header value in the parse path — parsing is driven by `EventSourceParserStream` over the body. The header is the documented convention (and required for correct proxy/`no-buffering` behavior) and MUST be emitted, but the load-bearing requirements for `useChat` to render are: (1) a readable SSE body, (2) `data: {json}\n\n` frames, (3) each JSON validating against `uiMessageChunkSchema`, (4) the `start`/`text-*`/`finish` ordering of Q1.

### Q2 — The single bridge translation point (EC-4)

**Where live text flows today.** The bridge produces `StreamEvent`/`AgentStreamEvent` `{ type:'text_delta', content }` from TWO SDK paths that converge:
1. **Real-time (chronological) path** — `translateInteractionUpdate` `text-delta` branch: `update.text ? [{ type:'text_delta', content: update.text }] : []` — `packages/agents/src/bridge/event-translator.ts:181-184`. This is where **live streamed text flows** (the `onDelta` sink).
2. **Post-completion buffered path** — `translateSdkEvent` `assistant` → `translateAssistantEvent`, which reads `msg.message.content[].text` and pushes `{ type:'text_delta', content: b.text }` — `event-translator.ts:52-74`, dispatched at `event-translator.ts:153-157`. This comes from `run.stream()` AFTER completion (all-text-then-all-tools), per the module comment at `event-translator.ts:171-176`.

**The dedup interaction (EC-4).** `mergeDeltaStream` yields the real-time deltas as they arrive and opens `run.stream()` for structural events, deduping the buffered path per-category so text never double-emits — `packages/agents/src/bridge/sdk-adapter.ts:307-342`, specifically `if (isDuplicatedByDelta(out, state)) continue` at `:335` (the `state.sawTextDelta` flag set by the onDelta sink — `sdk-adapter.ts:354-357`). Because both paths already converge to a single, deduped `text_delta` `StreamEvent` stream, the UIMessageStream translation must consume THAT stream — not re-branch inside either SDK translator.

**Decision: a NEW translator at the emit boundary, NOT a branch inside `translateSdkEvent`/`translateInteractionUpdate`.**
- Named point: **`packages/agents/src/bridge/ui-message-stream-translator.ts` → `translateToUIMessageStream(events, { textId })`** (new file/function), consumed by the new UIMessageStream SSE writer (Q7). It maps the deduped `StreamEvent`/`AgentStreamEvent` stream → `UIMessageChunk[]`:
  - first event / `run_started` → emit `start` + `text-start` (with an injected `textId`, one per text block);
  - each `text_delta { content }` → `text-delta { id: textId, delta: content }`;
  - terminal `done` → `text-end { id: textId }` + `finish`.
- **New fn, not extend** — rationale: (a) `architecture.md` — the bridge is the only SDK→event adapter, and the SDK→`StreamEvent` translation is DONE and already deduped; adding UIMessageStream branches inside `translateSdkEvent` would duplicate the dedup concern and risk the `mergeDeltaStream` dedup (`sdk-adapter.ts:335`) dropping or duplicating a UIMessageChunk (the EC-4 checkpoint failure). (b) `sdk-runtime.md` / `system-design-guardrails.md` G2 — `@theokit/sdk` is the only runtime; this is a pure `StreamEvent → wire` mapping with no parallel runtime. (c) It stacks a text-block-`id` + open/closed state that has no home inside the stateless per-message translators.
- **No dedup carve-out needed** — the new translator sits DOWNSTREAM of `isDuplicatedByDelta`, consuming the single already-deduped `text_delta` stream, so exactly one `text-delta` chunk is emitted per delta.

---

## ADRs

### ADR-1 — M0 emits a fixed five-chunk UIMessageStream text sequence

**Decision.** For text-only streaming, emit exactly `start` → `text-start(id)` → `text-delta(id, delta)*` → `text-end(id)` → `finish`, with one shared `id` per text block; omit `start-step`/`finish-step` (optional) and all tool/reasoning/file chunks (M1).

**Rationale.** The `strictObject` union (`ui-message-chunks.ts:23-215`) rejects extra keys, and the golden producer test asserts this exact ordered frame (`to-ui-message-stream.test.ts:68-77`). The message-frame chunks `start`/`finish` (EC-3) are required for `useChat` to open/close the assistant message — a bare `text-*` list renders nothing.

**Alternatives.** (a) Emit only `text-*` (rejected — EC-3: no message frame, nothing renders). (b) Re-use `streamText`'s full part set incl. `start-step`/`finish-step` (rejected for M0 — extra chunks with no text-rendering value; KISS/YAGNI). **Rule:** `architecture.md` (bridge-only adapter), `testing.md` (exact-array RED before GREEN).

### ADR-2 — Wire contract: UIMessageStream headers + `data:{json}\n\n` framing + `[DONE]`

**Decision.** The M0 writer emits `UI_MESSAGE_STREAM_HEADERS` (incl. `x-vercel-ai-ui-message-stream: v1`, `content-type: text/event-stream`), frames each chunk as `data: ${JSON.stringify(chunk)}\n\n`, and flushes `data: [DONE]\n\n` on close — replacing the current `SSE_HEADERS` (`define-agent-endpoint.ts:84-88`, no `[DONE]`).

**Rationale.** `DefaultChatTransport` parses the body with `uiMessageChunkSchema` and throws on any invalid frame (`default-chat-transport.ts:28-30`); the header set is the documented convention (`ui-message-stream-headers.ts:1-7`); `[DONE]` is the terminal courtesy the producer emits and the consumer ignores (`parse-json-event-stream.ts:24-30`).

**Alternatives.** (a) Reuse the existing proprietary `AgentEvent` SSE (rejected — `{type:'message'}` fails `uiMessageChunkSchema`; `useChat` throws). (b) Skip `x-vercel-ai-ui-message-stream` (rejected — needed for proxy/no-buffering correctness and forward-compat, even if not asserted in the parse path). **Rule:** `error-handling.md` (fail-loud on invalid frame is the SDK's behavior we must satisfy).

### ADR-3 — Translate at a new `StreamEvent[] → UIMessageChunk[]` seam, downstream of dedup

**Decision.** Add `translateToUIMessageStream(events, { textId })` (new `packages/agents/src/bridge/ui-message-stream-translator.ts`), fed by the already-deduped `StreamEvent` stream and consumed by the new writer — NOT a branch inside `translateSdkEvent` (`event-translator.ts:153-169`) or `translateInteractionUpdate` (`event-translator.ts:181-222`).

**Rationale.** Live text converges to a single deduped `text_delta` `StreamEvent` via `mergeDeltaStream` + `isDuplicatedByDelta` (`sdk-adapter.ts:307-342`, `:335`). Translating downstream keeps the SDK translators stateless and untouched (EC-4: no dedup carve-out, no double/dropped chunk), respects `architecture.md` (single bridge adapter) and `sdk-runtime.md`/G2 (pure mapping, no parallel runtime).

**Alternatives.** (a) Branch inside `translateSdkEvent`/`translateInteractionUpdate` (rejected — duplicates dedup, risks the EC-4 drop/dup, and has no home for text-block `id` state). (b) Translate inside the SSE writer inline (rejected — untestable in isolation; the new fn is the unit-test seam mirroring `event-translator.test.ts`). **Rule:** `architecture.md`, `sdk-runtime.md`, `testing.md`.

### ADR-4 — Pin `ai@^7.0.14` + `@ai-sdk/react@^4.0.15` (clone == npm latest, zero skew)

**Decision.** Pin `ai: "^7.0.14"` and `@ai-sdk/react: "^4.0.15"` (app-level deps of the skeleton), react `^18 || ^19` peer.

**Rationale (EC-1).** The chunk schema (Q1) and wire headers (Q3) were read from `references/ai-sdk` at `ai@7.0.14`/`@ai-sdk/react@4.0.15`, and `npm view … dist-tags` confirms both are the current `latest` — the studied version IS the shipped version. No re-read against a different published major is needed. assistant-ui's `^6`/`^3` pins (`react-ai-sdk/package.json:54-58`) are one major behind and used for concept corroboration only (EC-6/D4).

**Alternatives.** (a) Pin assistant-ui's `ai@^6`/`@ai-sdk/react@^3` line (rejected — one major behind `latest`; would reintroduce the exact version↔protocol skew EC-1 warns against). (b) Pin `alpha`/`canary` (rejected — unstable; M0 needs the stable line). **Rule:** `deps-audit` gate consumes this pin in the plan phase.

---

## Blocked questions (if any)

None. All seven research questions (Q1–Q7) were answered from real source reads with verified citations; EC-1 was resolved favorably by `npm view` (clone == `latest`), removing the anticipated re-read risk. No question hit the Fase-A-exhausted or budget-exhausted stop conditions (D1).
