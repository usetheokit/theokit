/**
 * The two-source merge — the machinery that reconciles the SDK's live `onDelta` callback with the
 * complete messages `run.stream()` replays after completion.
 *
 * Extracted from `sdk-adapter.ts` because that file sat over the 500-line budget (G6) and its own
 * header said the split was owed. This is the seam that made the cut obvious: every symbol here
 * exists ONLY to reconcile the two surfaces, and only four of them are used outside.
 *
 * It is also, deliberately, the subject of theokit#140 in one place. That issue argues the dual
 * source is the wrong architecture — neither surface is complete alone, `onDelta` has no
 * `run_started`/`system` and `run.stream()` is batched and post-completion, so the entire dedup
 * apparatus below exists purely to paper over the gap, and it is the documented root of the #47
 * ordering bug and the answer-hold regression. The fix that issue proposes lives upstream: a single
 * ordered `run.events()` iterator in the SDK, which would delete this file rather than improve it.
 * Until the SDK offers it, this module is the containment.
 */
import type { InteractionUpdate } from '@theokit/sdk'

import type { StreamEvent } from './agent-sse-handler.js'
import {
  translateInteractionUpdate,
  translateSdkEvent,
  type SdkMessage,
} from './event-translator.js'

/** #40: tagged item flowing through the merge queue — an incremental delta or a complete SDK message. */
export type MergeItem = { kind: 'delta'; event: StreamEvent } | { kind: 'sdk'; msg: SdkMessage }

/** Minimal single-producer/single-consumer async queue (#40 — merge onDelta tokens with run.stream()). */
export interface AsyncQueue<T> {
  push: (item: T) => void
  close: () => void
  [Symbol.asyncIterator]: () => AsyncIterator<T>
}

export function createAsyncQueue<T>(): AsyncQueue<T> {
  const items: T[] = []
  let wake: (() => void) | null = null
  let closed = false
  return {
    push(item: T) {
      items.push(item)
      if (wake) {
        wake()
        wake = null
      }
    },
    close() {
      closed = true
      if (wake) {
        wake()
        wake = null
      }
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (items.length > 0) {
          const next = items.shift()
          if (next !== undefined) yield next
        }
        if (closed) return
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    },
  }
}

/**
 * #44 dedup state — text/thinking by category flag (no per-event id); tool by callId Set, so a
 * `run.stream()` tool result whose callId onDelta only reported as `tool-call-started` (e.g. a tool
 * ERROR surfaced only via the stream) is NOT suppressed. `sawError` short-circuits the real-usage done.
 */
export interface MergeState {
  sawTextDelta: boolean
  sawThinkingDelta: boolean
  emittedToolCallIds: Set<string>
  emittedToolResultIds: Set<string>
  sawError: boolean
  /** #142 — tipo do ultimo evento emitido, para saber se o stream ja terminou num frame terminal. */
  lastEventType: string
}

/** Read a StreamEvent's `callId` as a string (the union is index-typed `unknown`). */
function streamCallId(ev: StreamEvent): string {
  return typeof ev.callId === 'string' ? ev.callId : ''
}

/**
 * #138 — TODOS os ids sob os quais a MESMA chamada de tool pode ser reconhecida.
 *
 * O SDK dá dois por chamada: o `callId` dele e o `modelCallId` que o provider gerou. Os dois
 * caminhos do merge veem namespaces DIFERENTES — `onDelta` entrega o `callId`, e `run.stream()`
 * entrega o `ToolUseBlock.id`, que é o `modelCallId`. A dedup registrava um e consultava o outro:
 * nunca casava, e a mesma chamada renderizava DUAS vezes (o duplo card que o #47 perseguia).
 *
 * A leitura acontece AQUI, no sink, onde o `InteractionUpdate` cru ainda está à mão — e não como
 * um campo a mais no `StreamEvent`. O id do modelo é detalhe da correlação entre as duas fontes,
 * não parte do contrato que o consumidor renderiza; carregá-lo no evento público obrigaria todo
 * consumidor a conhecer uma distinção que só o merge precisa fazer.
 */
function idsDaMesmaChamada(ev: StreamEvent, update: unknown): string[] {
  const ids: string[] = []
  const call = streamCallId(ev)
  if (call !== '') ids.push(call)
  // `InteractionUpdate` e uma UNIAO: so as tres variantes de tool-call carregam `modelCallId`.
  // Tipar o parametro como `{ modelCallId?: unknown }` faz o TS recusar a uniao inteira, entao a
  // leitura e defensiva — e correta para as variantes que nao tem o campo (nenhum id extra).
  const model = (update as { modelCallId?: unknown } | null | undefined)?.modelCallId
  if (typeof model === 'string' && model !== '' && model !== call) ids.push(model)
  return ids
}

/**
 * #44 — skip a run.stream() content event ONLY when onDelta already drove that exact (category, id).
 * Tool dedup is keyed by callId; an empty/missing callId never matches (returns false) so two distinct
 * id-less tool events cannot collide and wrongly suppress each other (favours a visible double-emit
 * over silent loss — fail-loud).
 */
function isDuplicatedByDelta(ev: StreamEvent, state: MergeState): boolean {
  if (ev.type === 'text_delta') return state.sawTextDelta
  if (ev.type === 'thinking') return state.sawThinkingDelta
  if (ev.type === 'tool_call') {
    const id = streamCallId(ev)
    return id !== '' && state.emittedToolCallIds.has(id)
  }
  if (ev.type === 'tool_result') {
    const id = streamCallId(ev)
    return id !== '' && state.emittedToolResultIds.has(id)
  }
  return false
}

/**
 * #44: merge real-time content events (queued via onDelta — text/tool/thinking in chronological
 * arrival order) with the complete SDK messages from `run.stream()`. Deltas are yielded as they
 * arrive; the pump opens `run.stream()` (post-completion) for structural events (`run_started`/`done`)
 * + the no-onDelta fallback, deduped per-category (`isDuplicatedByDelta`) so nothing double-emits.
 * The `done` SDK event stays suppressed (real-usage `done` emitted by the caller after `run.wait()`);
 * errors set `state.sawError`. `openStream` is a thunk so the consumer drains CONCURRENTLY with
 * `send()` (the run only resolves after the loop completes). Extracted to keep the generator within G6.
 */
export async function* mergeDeltaStream(
  queue: AsyncQueue<MergeItem>,
  openStream: () => Promise<AsyncGenerator<SdkMessage>>,
  runId: string,
  state: MergeState,
): AsyncGenerator<StreamEvent> {
  // The catch is attached AT CREATION (not deferred to `await pump`): the consumer loop below is
  // paced by the external puller (SSE backpressure), so a send()/stream() rejection could otherwise
  // sit unhandled across macrotask gaps and crash the process (Node unhandledRejection). The captured
  // error is re-thrown after the drain so it still surfaces in the caller's try/catch as one error event.
  let pumpError: { thrown: unknown } | undefined
  const pump = (async () => {
    try {
      const stream = await openStream()
      for await (const msg of stream) queue.push({ kind: 'sdk', msg })
    } finally {
      queue.close()
    }
  })().catch((thrown: unknown) => {
    pumpError = { thrown }
  })
  // #47-followup — stream ALL deltas (text / tool / thinking) LIVE in arrival order. The tool
  // lifecycle (`tool-call-started` + `tool-call-completed`) is now emitted via `onDelta` from the SDK's
  // tool-dispatch, which runs BETWEEN LLM rounds — so a tool call and its result arrive in the queue at
  // their true chronological position, BEFORE the post-tool answer text. That removes the need to HOLD
  // the answer (the earlier #47 fix), which had regressed text-ONLY turns to batch-at-completion. The
  // `run.stream()` (pump) replay of the same tool call/result is deduped by callId (`isDuplicatedByDelta`
  // + the sink's `emittedTool*Ids`), so nothing double-renders and text streams token-by-token again.
  for await (const item of queue) {
    if (item.kind === 'delta') {
      state.lastEventType = item.event.type // #142 — o chamador precisa saber se ja terminou
      yield item.event
      continue
    }
    for (const out of translateSdkEvent(item.msg, runId)) {
      if (out.type === 'done') continue // suppressed; the real-usage done is emitted by the caller
      if (isDuplicatedByDelta(out, state)) continue // #44 per-category/callId dedup vs onDelta
      if (out.type === 'error') state.sawError = true
      state.lastEventType = out.type // #142
      yield out
    }
  }
  await pump // settled (handled at creation); re-throw any captured error into the generator's try/catch
  if (pumpError) throw pumpError.thrown
}

/**
 * #44 — build the onDelta sink: a fresh per-run dedup `MergeState` + the callback that routes every
 * content update (text/tool/thinking) into the merge queue in chronological arrival order, recording
 * per-category flags + per-callId Sets so the run.stream() fallback is deduped without losing
 * stream-only tool results. Extracted to keep `createSdkAgentStream` within the function-size budget.
 */
export function createDeltaSink(queue: AsyncQueue<MergeItem>): {
  state: MergeState
  onDelta: (d: { update: InteractionUpdate }) => void
} {
  const state: MergeState = {
    sawTextDelta: false,
    sawThinkingDelta: false,
    emittedToolCallIds: new Set<string>(),
    emittedToolResultIds: new Set<string>(),
    sawError: false,
    lastEventType: '',
  }
  const onDelta = (d: { update: InteractionUpdate }) => {
    for (const event of translateInteractionUpdate(d.update)) {
      if (event.type === 'text_delta') state.sawTextDelta = true
      else if (event.type === 'thinking') state.sawThinkingDelta = true
      else if (event.type === 'tool_call') {
        for (const id of idsDaMesmaChamada(event, d.update)) state.emittedToolCallIds.add(id)
      } else if (event.type === 'tool_result') {
        for (const id of idsDaMesmaChamada(event, d.update)) state.emittedToolResultIds.add(id)
      }
      queue.push({ kind: 'delta', event })
    }
  }
  return { state, onDelta }
}
