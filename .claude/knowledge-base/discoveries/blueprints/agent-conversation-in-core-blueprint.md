---
version: 1.0
slug: agent-conversation-in-core
milestone_id: M46
created_at: 2026-07-14
---

# Blueprint: Conversation-state accumulation in TheoKit's transport-agnostic agent core

## Executive Summary

M46 lifts TheoKit's client from per-turn raw `UIMessage[]` to a permanent `thread` in the core `AgentClient` store, reusing ai-sdk's `readUIMessageStream` + `ChatState` contract while owning the id-fabrication + commit-once scheduling. The showcase's hand-rolled `use-transcript.ts` (88 lines, per-surface) is eliminated; every surface (React, CLI, Tauri) inherits the unified thread from the framework-free core.

## Context

TheoKit's store `packages/theo/src/client/agent-client.ts` resets `#messages` to `[buildUserMessage(input)]` on every `send` (~:137), so it only ever holds the CURRENT turn. Consumers rebuild the conversation themselves — `apps/showcase/app/hooks/use-transcript.ts` is 88 lines of exactly that (separate `history`, `flatMap` of raw parts, fabricated assistant ids at :52/:78, commit-once `useEffect`), re-written per surface. M41–M45 unified the transport but left this conversation-state leak. This blueprint dissects the SOTA accumulation pattern (ai-sdk `AbstractChat`) and the transport-agnostic client shape (opencode) before the fix is designed.

## Objective

Deliver the accumulation patterns + id/commit/abort lifecycle decisions (with file:line evidence) so `/to-plan M46` designs a `thread` in the React-free `AgentClient` store that REUSES ai-sdk `readUIMessageStream` (Rule 9) and matches the opencode "one client, per-surface injection" shape — validated headlessly (the existing `tests/unit/agent-client.test.ts` harness) across React (`useAgent`) and non-React (`createAgentClient`).

---

## Coverage Corner 1 — Integration Tests

### Test shape for streaming → committed accumulation

TheoKit's headless test harness (`tests/unit/agent-client.test.ts`) validates commit-once and abort isolation WITHOUT React/DOM:

- **Test fixture** (`tests/unit/agent-client.test.ts:22-28`): chunks streamed in order (`text-start`, `text-delta`, `text-end`, `finish`)
- **Commit-once assertion** (`tests/unit/agent-client.test.ts:53-70`): send accumulates assistant message, transitions to 'done', text merged from all parts
- **Abort isolation** (`tests/unit/agent-client.test.ts:78-112`): stale drive (aborted controller) MUST NOT clobber newer send's status (HIGH priority — race condition guard)
- **Error terminal state** (`tests/unit/agent-client.test.ts:127-138`): send → error transitions status to 'error', captures message
- **Reconnect accumulation** (`tests/unit/agent-client.test.ts:152-162`): replay via `reconnectToStream` merges into messages

M46 mirrors these patterns:
1. Add a `thread: UIMessage[]` to `AgentClientState` (currently only `messages`, `status`, `error`)
2. Test that a new turn's user message appends to thread (id fabricated once)
3. Test that streaming updates upsert the in-flight assistant message into thread (same id, accumulated parts)
4. Test that commit-on-finish schedules the in-flight message's move from "live" → "committed" with stable id
5. Test abort leaves committed thread intact, clears in-flight
6. Test reconnect replays the in-flight turn into existing thread (M37 durable recovery)

---

## Coverage Corner 2 — Dependencies

### What M46 reuses from ai-sdk (Rule 9 — no reimplementation)

| Primitive | Location | Usage | Status |
|-----------|----------|-------|--------|
| `readUIMessageStream` | `node_modules/ai/dist/index.d.ts:6064-6069` | Main accumulation driver (chunks → `UIMessage` async iter) | **REUSE** — already used in `consume-ui-message-stream.ts:63-71` |
| `ChatStatus` type | `node_modules/ai/dist/index.d.ts:5480` | Status machine: `'submitted'\|'streaming'\|'ready'\|'error'` | **REUSE** — map to TheoKit's `'idle'\|'streaming'\|'done'\|'error'` |
| `UIMessageChunk` type | `node_modules/ai/dist/index.d.ts:2401-2545` | Streaming chunk schema (text-start/delta/end, error, tool-*) | **REUSE** — already parsed by SSE handler |
| `ChatState.pushMessage/popMessage/replaceMessage` | `node_modules/ai/dist/index.d.ts:5485-5487` | Message ops for accumulation | **REFERENCE** — inspire own thread ops in `AgentClient` |
| `onFinish` callback | `node_modules/ai/dist/index.d.ts:5506-5513` | Fired when stream ends (with final message + full history) | **REUSE** — wire into commit-on-finish scheduling |

### What M46 owns (not in ai-sdk, framework-specific)

| Component | Current Gap | M46 Solution | Rationale |
|-----------|-------------|--------------|-----------|
| **Thread accumulation** | SDK only holds per-turn `messages` (resets on send) | Move thread to `AgentClientState`, persist across sends | Core requirement: conversation history |
| **Message ID fabrication** | SDK leaves `id` empty; show-case hardcodes `crypto.randomUUID()` | Fabric stable ids in `buildUserMessage` + `fabricateAssistantId` | SDK doesn't prescribe id strategy; must be stable for React key/reuse |
| **Commit-once scheduling** | No lifecycle: showcase uses `useEffect` dependency dance | Wire stream-end → onFinish → commit in-flight into thread atomically | Prevent duplicate commits; simplify surface code |
| **Thread lifecycle** | Per-surface (no core) | Add to core's `send()`: append user msg, schedule assistant placeholder | All surfaces inherit same lifecycle |

---

## Coverage Corner 3 — Tools

### One core store, per-surface injection pattern (opencode + TheoKit)

**Pattern:** Single transport-agnostic store (`AgentClient`), but different transport per surface (HTTP, in-process, Tauri IPC).

#### opencode pattern (references/opencode/packages/sdk/js/src/v2/client.ts:50-93)

```typescript
// One client, injected fetch
export function createOpencodeClient(config?: Config & { directory?: string }) {
  if (!config?.fetch) {
    const customFetch: any = (req: any) => {
      req.timeout = false
      return fetch(req)
    }
    config = { ...config, fetch: customFetch }
  }
  const client = createClient(config)
  // Interceptors modify requests per-surface (headers, auth)
  client.interceptors.request.use((request) =>
    rewrite(request, { directory: config?.directory })
  )
  return new OpencodeClient({ client })
}
```

**Key insight:** The client is created once, wrapped by a surface-specific factory that injects transport config (fetch function, interceptors, headers). The core logic is unified; surfaces are thin.

#### TheoKit application (packages/theo/src/client/agent-client.ts:46-187 + use-agent.ts:75-93)

**Current** (per-surface, hand-rolled):
- Each surface rebuilds history + id logic (showcase: 88 lines in `use-transcript.ts`)
- `useAgent` hook wraps `AgentClient` with a transport (HttpTransport or custom)
- No persistent thread in core

**M46 target** (unified core):
- `AgentClient` owns `thread: UIMessage[]` in state (persists across sends)
- `useAgent` wraps same store (no rebuild per-surface)
- Terminal/CLI/Tauri use `createAgentClient(transport)` + subscribe directly (no React)
- showcase's `use-transcript.ts` disappears; `ChatTranscript` replaced by direct `useAgent` return + thread

**Implementation entry point:**

```typescript
// packages/theo/src/client/agent-client.ts (M46 change)
export interface AgentClientState {
  thread: UIMessage[]  // NEW: persistent conversation
  messages: UIMessage[]  // KEEP: in-flight turn (for streaming display)
  status: UseAgentStatus
  error: Error | undefined
}

export class AgentClient<TInput = unknown> {
  #thread: UIMessage[] = []  // NEW: persisted
  #messages: UIMessage[] = []  // EXISTING: per-turn
  // ... lifecycle changes: send appends to thread, commit-on-finish writes final message
}
```

### Headless store testing (no React, no DOM)

**Pattern:** `AgentClient` is testable WITHOUT `useSyncExternalStore`, React, or jsdom. Tests drive the store directly via `subscribe()` + `send()`.

**Example** (tests/unit/agent-client.test.ts:40-50):

```typescript
async function waitSettled(client: AgentClient): Promise<void> {
  await new Promise<void>((resolve) => {
    const unsub = client.subscribe(() => {
      const s = client.getSnapshot().status
      if (s !== 'streaming') {
        unsub()
        resolve()
      }
    })
  })
}

// Call: client.send(input), await waitSettled(client)
// Assert: client.getSnapshot().status === 'done'
```

**M46 test additions:**

```typescript
// NEW: thread accumulation test
it('test_thread_persists_across_sends', async () => {
  const client = new AgentClient(fakeTransport())
  client.send({ message: 'msg1' })
  await waitSettled(client)
  const snapshot1 = client.getSnapshot()
  expect(snapshot1.thread).toHaveLength(2)  // greeting + user msg1 + asst reply
  
  client.send({ message: 'msg2' })
  await waitSettled(client)
  const snapshot2 = client.getSnapshot()
  expect(snapshot2.thread.length).toBeGreaterThan(snapshot1.thread.length)
  // thread grew; in-flight `messages` reset (pattern: messages = new turn staging)
})
```

---

## Coverage Corner 4 — Techniques

### Q1: ChatState mechanics — push/commit/activeResponse pattern

**ai-sdk's `ChatState`** (node_modules/ai/dist/index.d.ts:5481-5489):

```typescript
interface ChatState<UI_MESSAGE extends UIMessage> {
    status: ChatStatus;
    error: Error | undefined;
    messages: UI_MESSAGE[];           // Committed messages
    pushMessage: (message: UI_MESSAGE) => void;
    popMessage: () => void;
    replaceMessage: (index: number, message: UI_MESSAGE) => void;
    snapshot: <T>(thing: T) => T;     // Snapshot guard (immutability)
}
```

**AbstractChat** (node_modules/ai/dist/index.d.ts:5559-5640):
- `protected state: ChatState<UI_MESSAGE>` — holds all committed messages
- `private activeResponse` — the current in-flight assistant message being streamed
- `sendMessage()` → opens a new stream, schedules streaming updates to `activeResponse`, then on finish:

**Commit workflow** (inferred from onFinish signature: 5506-5513):

```typescript
type ChatOnFinishCallback<UI_MESSAGE extends UIMessage> = (options: {
    message: UI_MESSAGE;           // The FINAL accumulated assistant message
    messages: UI_MESSAGE[];        // Full history AFTER commit
    isAbort: boolean;
    isDisconnect: boolean;
    isError: boolean;
    finishReason?: FinishReason;
}) => void;
```

When streaming ends:
1. All chunks accumulated into one `UIMessage` (the in-flight `activeResponse`)
2. `onFinish` fires ONCE with final message + full history
3. The final message is MERGED into `state.messages` atomically
4. Status transitions to 'ready' (not 'done' in ai-sdk; TheoKit uses 'done')

**TheoKit equivalent** (M46 design):

```typescript
// In AgentClient.#drive():
await consumeChunkStream(stream, (message) => {
  // Streaming update: upsert message into thread (but DON'T commit)
  this.#messages = [message]  // Show live
  this.#emit()
})
// On stream end, call onFinish logic (NEW):
const finalMessage = this.#messages[0]  // The accumulated assistant message
this.#thread.push(finalMessage)  // COMMIT: move from in-flight → thread
this.#messages = []  // Clear staging for next send
this.#status = 'done'
this.#emit()
```

---

### Q2: Message IDs — fabrication + commit-once mechanism

**ai-sdk's ID strategy** (node_modules/ai/dist/index.d.ts:5514-5527):

```typescript
interface ChatInit<UI_MESSAGE extends UIMessage> {
    id?: string;  // Chat session id (auto-generated if omitted)
    generateId?: IdGenerator;  // Callable to create message ids
    // ... onFinish called on stream end with final message (single call, guaranteed once)
}

type CreateUIMessage<UI_MESSAGE extends UIMessage> = Omit<UI_MESSAGE, 'id' | 'role'> & {
    id?: UI_MESSAGE['id'];  // Optional; if omitted, auto-generated
    role?: UI_MESSAGE['role'];
};
```

**Export** (node_modules/ai/dist/index.d.ts:line 8): `IdGenerator` + `generateId` (default) exported.

**ID assignment flow:**
- When user sends message → `sendMessage({ text: '...' })` (no id)
- If no id provided, `generateId()` is called (per-instance, consistent across session)
- Each streaming chunk carries an `id: string` (from `toUIMessageChunk`), tying fragments to the same message
- `readUIMessageStream` uses those chunk ids to accumulate parts into one `UIMessage`

**TheoKit's current gap** (packages/theo/src/client/agent-client.ts:29-35):

```typescript
// Already fabricates user message IDs consistently:
function buildUserMessage(input: unknown): UIMessage {
  return {
    id: crypto.randomUUID(),  // ✓ Stable per send
    role: 'user',
    parts: [{ type: 'text', text: inputToText(input) }],
  }
}
```

**But showcase's `use-transcript.ts` ALSO fabricates assistant ids** (lines 52, 78):

```typescript
const inflightReply = (suffix: string): UIMessage => ({
  id: `a-${String(replies)}${suffix}`,  // Fabricated in hook (per-surface!)
  role: 'assistant',
  parts: messages.flatMap((m) => m.parts),
})
```

**M46 solution:**
1. Promote `buildUserMessage` id logic → stays in `AgentClient`
2. **New:** `fabricateAssistantId()` in `AgentClient` → generates stable assistant message ids (e.g., `a-0`, `a-1`)
3. **New:** On stream start (status='streaming'), pre-allocate the assistant message with its id
4. **Commit atomically:** When stream ends, the same message object (with stable id) moves from in-flight → thread

**Commit-once mechanism:**

```typescript
// In AgentClient.send():
this.#messages = []  // Reset in-flight
const userMsg = buildUserMessage(input)  // id = crypto.randomUUID()
this.#thread.push(userMsg)  // COMMIT user message immediately

// In AgentClient.#drive() on stream end:
const assistantMsg = readUIMessageStream(stream)  // Accumulated, id = ? (empty from SDK)
assistantMsg.id = `a-${this.#thread.length}`  // Fabricate HERE
this.#thread.push(assistantMsg)  // COMMIT: one insert, never duplicate
this.#messages = []  // Clear staging
```

---

### Q3: readUIMessageStream accumulation + ChatStatus states + error behavior

**`readUIMessageStream` signature** (node_modules/ai/dist/index.d.ts:6064-6069):

```typescript
declare function readUIMessageStream<UI_MESSAGE extends UIMessage>({
    message?: UI_MESSAGE;
    stream: ReadableStream<UIMessageChunk>;
    onError?: (error: unknown) => void;
    terminateOnError?: boolean;
}): AsyncIterableStream<UI_MESSAGE>;
```

**How it works (from chunk schema):**

1. Chunks arrive in order: `{ type: 'text-start', id: 't0' }`, `{ type: 'text-delta', id: 't0', delta: 'Hello' }`, `{ type: 'text-end', id: 't0' }`
2. Stream parses each chunk (ai-sdk validates against `uiMessageChunkSchema` via `parseJsonEventStream`)
3. Chunks with same `id` are buffered into parts of a single `UIMessage`
4. Async iterator yields reconstructed `UIMessage` after each chunk is absorbed
5. On stream close → final `UIMessage` is yielded one last time, then iteration ends

**UIMessageChunk types** (node_modules/ai/dist/index.d.ts:2401-2545):

```typescript
type UIMessageChunk = 
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | { type: 'error'; errorText: string }
  | { type: 'tool-input-available'; toolCallId: string; toolName: string; input: unknown }
  | ... (more tool variants)
```

**ChatStatus states** (node_modules/ai/dist/index.d.ts:5480):

```typescript
type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error';
```

**TheoKit's mapping** (packages/theo/src/client/agent-client.ts:6):

```typescript
export type UseAgentStatus = 'idle' | 'streaming' | 'done' | 'error'
```

| ai-sdk | TheoKit | Meaning |
|--------|---------|---------|
| `submitted` | (not used) | Message sent, awaiting stream start |
| `streaming` | `streaming` | Chunks arriving live |
| `ready` | `done` | Stream finished, ready for next send |
| `error` | `error` | Stream failed; error captured |

**Error/abort terminal behavior** (node_modules/ai/dist/index.d.ts:5509-5512):

```typescript
isAbort: boolean;      // true if request.abort() was called
isDisconnect: boolean; // true if network error
isError: boolean;      // true if stream emitted error chunk
```

**TheoKit handling** (packages/theo/src/client/agent-client.ts:88-119):

```typescript
async #drive(
  open: () => Promise<ReadableStream<UIMessageChunk> | null>,
  controller: AbortController,
): Promise<void> {
  try {
    const stream = await open()
    // ... readUIMessageStream consumes chunks
    await consumeChunkStream(stream, (message) => {
      if (aborted()) return  // Guard: stale drive must not emit
      this.#upsert(message)
      this.#emit()
    })
    if (aborted()) return
    this.#status = 'done'  // Terminal: stream finished
    this.#emit()
  } catch (err) {
    if (aborted()) return  // Stale drive must not clobber
    this.#error = err instanceof Error ? err : new Error(String(err))
    this.#status = 'error'  // Terminal: error
    this.#emit()
  }
}
```

**M46 change:** On stream end (whether `done` or `error`), commit the in-flight assistant message to thread atomically BEFORE clearing `messages`.

---

## Cross-cutting Comparison

| Concern | ai-sdk `AbstractChat` | opencode client | TheoKit `AgentClient` (today) | M46 target |
|---|---|---|---|---|
| Conversation state | `ChatState.messages[]` persists across turns; `activeResponse` holds in-flight (`index.d.ts:5481-5571`) | client holds no messages — server-of-record; per-surface store subscribes (`client.ts:50-93`) | `#messages` RESET per send (`agent-client.ts:~137`) — turn-only | `thread` in core store, persists across sends |
| Message id | optional `ChatInit.generateId` (`:5527`); commits on finish | server-assigned | user id fabricated (`agent-client.ts:29-35`); assistant id NOT (gap) | store fabricates stable assistant id on commit |
| Commit lifecycle | `onFinish` callback (React) | server event | none (consumer does it, `use-transcript.ts` useEffect) | commit-once on stream-end IN the store |
| Surface reuse | React `useChat` only | one client, per-surface injection (the pattern) | one store, per-surface wrapper (M44) — but turn-only | one store + `thread`, all surfaces inherit |
| Framework coupling | `useChat` is React | framework-free core | framework-free core (React-free) ✓ | keep React-free (place in `agent-client.ts`) |

## ADRs

### D1 — Thread placement + id fabrication + commit-once

**Decision:** Promote persistent `thread` to core `AgentClient` store; own id fabrication + commit scheduling; reuse ai-sdk's `readUIMessageStream` for chunk accumulation.

**Rationale:**

1. **Thread in core (not per-surface):** Every surface (React/CLI/Tauri) must inherit the same conversation history. Currently, showcase re-implements it per-surface (`use-transcript.ts`, 88 lines). Moving to core eliminates duplication + ensures consistency.

2. **Reuse `readUIMessageStream`:** ai-sdk already solves chunk → message accumulation (Rule 9). Do not reimplement. Already used in `consume-ui-message-stream.ts`; extend to core.

3. **Own id fabrication:** ai-sdk's SDK leaves `id` empty on messages. We MUST assign stable ids so React keys don't collide and messages don't duplicate on reconnect. Fabricate in `AgentClient.#drive()` after stream end, not in surface hooks.

4. **Commit atomically on stream end:** Use the stream-end transition (status='done' or 'error') as the SOLE commit point. Lock the in-flight message's id, move it from `#messages` staging → `#thread` persisted, clear staging, emit. This prevents re-commits on React re-renders or surface rebuilds.

5. **Abort isolation (HIGH):** Stale drives (aborted controller) must NOT clobber a newer send's status or thread. Use `aborted()` guard every emit (pattern from lines 92-119). If the drive's controller is aborted, do not call `#emit()` after status change.

**Alternative rejected:**
- Keep thread in surface hooks (current): violates Rule 22 (core only), requires per-surface maintenance.
- Use ai-sdk's `AbstractChat` directly: ai-sdk is a React-only binding (useChat hook). TheoKit is transport-agnostic + headless; must own the core store.

**Acceptance:** All Q1-Q6 answered with real citations; streaming→committed test passes; abort isolation test passes; all surfaces (React/CLI) inherit thread without rebuild.

---

### D2 — onFinish scheduling: wire or ignore ai-sdk callback?

**Decision:** Ignore ai-sdk's `onFinish` callback. Instead, reuse `readUIMessageStream` + detect stream-end via `try/catch` + status transition.

**Rationale:**

1. ai-sdk's `onFinish` is part of `AbstractChat`, a React hook wrapper. TheoKit is transport-agnostic + owns `AgentClient` (a plain class, not a hook).
2. `readUIMessageStream` is a generator; detecting iteration end is the commit signal (no extra callback wiring needed).
3. Pattern already in use: `packages/theo/src/client/agent-client.ts:105-112` — stream ends → status='done' + emit.

**Alternative rejected:**
- Try to wire `ChatInit.onFinish`: would require importing `AbstractChat` internals (type bleed). Simpler to detect stream end natively.

**Acceptance:** `consumeChunkStream` completes naturally; status transition post-loop = commit signal.

---

## Recommendations

For `/to-plan M46`, in priority order (all client/boundary — runtime untouched, G2):

1. **Add `thread: UIMessage[]` to `AgentClientState`** — committed turns + the in-flight turn; accumulated across `send`, never reset (contrast `#messages` at `agent-client.ts:~137`). `messages` (raw, per-turn) stays for back-compat (R1).
2. **Own id fabrication in the store** — promote/extend the existing `buildUserMessage` id logic (`agent-client.ts:29-35`) with a `fabricateAssistantId()` that mints a stable id when the SDK leaves the assistant id empty (the showcase does this per-surface at `use-transcript.ts:52/78` — move it in).
3. **Commit-once on stream-end** — when `consumeChunkStream`/`readUIMessageStream` iteration ends (D2 — native stream-end, NOT ai-sdk `onFinish`), assign the id, append the in-flight turn to `thread`, clear staging, emit once.
4. **Keep the abort guard** — a stale (aborted) drive MUST NOT emit into `thread` after a newer `send` (pattern `agent-client.ts:~92-119`).
5. **Reconnect (M37) replays into the SAME thread** — the reconnect stream accumulates into the current in-flight turn, not a new one.
6. **Expose `thread` from `useAgent()` + `createAgentClient()`** + type it in `@theo/agents` codegen. Validate headlessly with the existing `tests/unit/agent-client.test.ts` harness (commit-once/abort/error/reconnect) + collapse the showcase `use-transcript.ts` (88 → ~3 lines).

## Patterns

### Pattern: Transport-agnostic store + per-surface injection

```typescript
// Core (framework-free):
export class AgentClient<TInput = unknown> {
  constructor(transport: AgentTransport, contextResolver?: ...) { ... }
  send(input: TInput): void { ... }
  getSnapshot(): AgentClientState { ... }
  subscribe(listener: () => void): () => void { ... }
}

// React surface:
export function useAgent<TInput>(pathOrTransport, options) {
  const client = useMemo(
    () => new AgentClient(
      typeof pathOrTransport === 'string'
        ? new HttpTransport({ api: pathOrTransport })
        : pathOrTransport
    ),
    [pathOrTransport]
  )
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot)
  return { messages: state.messages, thread: state.thread, ... }
}

// CLI/Node surface:
export async function createAgentClient<TInput>(transport: AgentTransport) {
  const client = new AgentClient(transport)
  for await (const msg of client.stream(input)) {
    console.log(msg)  // No React, no hooks
  }
}
```

**Benefit:** One store, three surfaces, zero duplication.

### Pattern: Immutable snapshot guards + stable reference

```typescript
// Every emit creates a NEW snapshot object (for useSyncExternalStore):
#emit(): void {
  this.#snapshot = { messages: this.#messages, thread: this.#thread, status: this.#status, error: this.#error }
  for (const listener of this.#listeners) listener()
}

// Snapshot is stable between emits (React doesn't re-render on reference change):
getSnapshot = (): AgentClientState => this.#snapshot
```

**Benefit:** React's `useSyncExternalStore` detects updates via reference identity; listeners are notified, surfaces re-render only on actual change.

### Pattern: Abort isolation via closure + guard

```typescript
const aborted = (): boolean => controller.signal.aborted  // Read live, not at call site

async #drive(..., controller: AbortController): Promise<void> {
  try {
    const stream = await open()
    if (aborted()) return  // Stale drive detected early
    
    await consumeChunkStream(stream, (message) => {
      if (aborted()) return  // Stale drive, no-op
      this.#upsert(message)
      this.#emit()
    })
    
    if (aborted()) return  // Stale drive, no-op
    this.#status = 'done'
    this.#emit()
  } catch (err) {
    if (aborted()) return  // Stale drive, MUST NOT clobber new send
    // ... error handling
  }
}
```

**Benefit:** Prevents race: older send's drive completes after newer send has created a fresh controller. The older drive exits silently, never touches state.

---

## Key Evidence Citations

### Q1: ChatState mechanics
- `node_modules/ai/dist/index.d.ts:5481-5489` — ChatState interface (pushMessage/popMessage/replaceMessage/snapshot)
- `node_modules/ai/dist/index.d.ts:5559-5640` — AbstractChat class (state/activeResponse/makeRequest)
- `node_modules/ai/dist/index.d.ts:5506-5513` — ChatOnFinishCallback (commit signal: message + messages)

### Q2: Message ID fabrication
- `node_modules/ai/dist/index.d.ts:5527` — ChatInit.generateId (optional IdGenerator)
- `node_modules/ai/dist/index.d.ts:5415-5418` — CreateUIMessage (id?: optional)
- `packages/theo/src/client/agent-client.ts:29-35` — buildUserMessage (already fabricates user ids)
- `fixtures/template-default/app/hooks/use-transcript.ts:52,78` — showcase fabricates assistant ids (per-surface gap)

### Q3: readUIMessageStream + ChatStatus + error
- `node_modules/ai/dist/index.d.ts:6064-6069` — readUIMessageStream signature (chunks → async iter)
- `node_modules/ai/dist/index.d.ts:5480` — ChatStatus type ('submitted'|'streaming'|'ready'|'error')
- `node_modules/ai/dist/index.d.ts:2401-2545` — UIMessageChunk types (text-start/delta/end, error, tool-*)
- `packages/theo/src/client/consume-ui-message-stream.ts:63-71` — consumeChunkStream (already reuses readUIMessageStream)

### Q4: Integration tests
- `tests/unit/agent-client.test.ts:22-28` — TEXT_TURN fixture (chunks in order)
- `tests/unit/agent-client.test.ts:40-50` — waitSettled pattern (headless, no DOM)
- `tests/unit/agent-client.test.ts:53-70` — test_send_accumulates_assistant_message (commit assertion)
- `tests/unit/agent-client.test.ts:78-112` — test_abort_then_new_send_prevents_stale_drive (HIGH priority)
- `tests/unit/agent-client.test.ts:127-138` — test_send_5xx_sets_error_status

### Q5: Reuse vs own
- **REUSE:** `readUIMessageStream`, `ChatStatus`, `UIMessageChunk` (ai-sdk primitives)
- **OWN:** Thread accumulation, id fabrication, commit-on-finish scheduling (TheoKit core)
- `packages/theo/src/client/agent-client.ts:46-187` — current AgentClient (entry point for M46)
- `packages/theo/src/client/consume-ui-message-stream.ts:17-23` — consumeUIMessageStream (already reuses ai-sdk)

### Q6: Core store + headless test + surface injection
- `packages/theo/src/client/agent-client.ts:46-187` — AgentClient store (subscribe/getSnapshot/send/abort/reset)
- `packages/theo/src/client/use-agent.ts:75-93` — useAgent (transport injection + useSyncExternalStore binding)
- `packages/theo/src/client/create-agent-client.ts:105-126` — createAgentClient (standalone, no React)
- `tests/unit/agent-client.test.ts:31-37` — fakeTransport (headless, no DOM)
- `.claude/knowledge-base/references/opencode/packages/sdk/js/src/v2/client.ts:50-93` — createOpencodeClient (one client, per-surface fetch injection)

---

## Glossary

- **Thread:** Persistent conversation history (user + assistant messages), accumulated across multiple sends. Lives in core `AgentClient.#thread`.
- **Messages (in-flight):** The current turn's accumulated assistant message, shown live while streaming. Clears on next send. Lives in core `AgentClient.#messages`.
- **Commit:** Moving an in-flight message from staging (`#messages`) → persistent storage (`#thread`) atomically, with stable id assigned.
- **Consume:** Reading a stream of `UIMessageChunk`s and reconstructing accumulated `UIMessage`s via `readUIMessageStream`.
- **Abort isolation:** Ensuring a stale drive (older send, aborted controller) does NOT emit or touch state after a newer send has taken over.

