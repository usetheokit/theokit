import { WIRE_APPROVAL_DETAIL_PART, type WireChunk } from './chunk-schema.js'
import { WireStreamError } from './parse-wire-stream.js'
import type { WireMessage, WireToolApproval } from './types.js'

/**
 * Chunks → reconstructed assistant messages. Replaces `ai`'s `readUIMessageStream`.
 *
 * ## The default this file changes, on purpose
 *
 * `ai`'s reader swallows an `error` chunk unless the caller passes BOTH `onError` and
 * `terminateOnError` — the trap documented at `consume-ui-message-stream.ts:68-75` (theokit#136):
 * a provider 401/429 arrived as data, was dropped, and the turn settled as `done` with no message.
 * Owning the reader means the correct behaviour is simply the DEFAULT: an error chunk rejects.
 * That is the one simplification this reimplementation actually buys.
 *
 * Emits a snapshot per reconstruction step so a caller (`useAgent`) can render while streaming.
 * `start` and `finish` do not produce snapshots — matching the oracle, measured.
 */

interface OpenState {
  message: WireMessage
  /** Text/reasoning block ids → index of the part being appended to. */
  readonly blocks: Map<string, number>
  /** Tool call ids → index of the tool part. */
  readonly tools: Map<string, number>
  /**
   * Approval ids → what the `data-approval` part said the gate is asking (theokit#394).
   *
   * Held aside rather than applied on arrival because the detail part names an APPROVAL and the
   * part it belongs to is found by TOOL CALL — the two ids are only equal by coincidence
   * (`hitl-call-correlation.ts` calls the equality a race, and the approval frame carries both
   * precisely because it cannot be assumed). The producer emits the detail immediately before the
   * frame that resolves it, so the map holds at most the gates of one round.
   */
  readonly approvalDetails: Map<string, Omit<WireToolApproval, 'id'>>
}

function snapshot(message: WireMessage): WireMessage {
  return structuredClone(message)
}

function open(messageId: string | undefined): OpenState {
  // The oracle yields `id: ''` when `start` carries no messageId — NOT a generated uuid. Inventing
  // one here would show up as a diff in the differential test and, worse, would make a consumer
  // that keys on message id see a different value than the ai-sdk path produced.
  return {
    message: { id: messageId ?? '', role: 'assistant', parts: [] },
    blocks: new Map(),
    tools: new Map(),
    approvalDetails: new Map(),
  }
}

/** The failure the server reported inside the stream. Thrown, never swallowed (theokit#136). */
function raiseStreamError(chunk: WireChunk): never {
  const text = (chunk as { errorText?: unknown }).errorText
  throw new WireStreamError(
    typeof text === 'string' && text.length > 0 ? text : 'agent stream failed without a message',
  )
}

export async function* readMessageStream(
  chunks: ReadableStream<WireChunk>,
): AsyncGenerator<WireMessage> {
  let state: OpenState | null = null

  for await (const chunk of chunks as unknown as AsyncIterable<WireChunk>) {
    // Error rejects ALWAYS — including before any `start`, where `state` is still null. Guarding on
    // state first would swallow an auth failure that happens before a single token is produced.
    if (chunk.type === 'error') raiseStreamError(chunk)

    if (chunk.type === 'start') {
      // A second `start` closes the message in flight instead of dropping it on the floor.
      if (state !== null) yield snapshot(state.message)
      const messageId = (chunk as { messageId?: string }).messageId
      state = open(messageId)
      // Measured against the oracle: `start` emits an (empty) snapshot ONLY when it carries an
      // explicit `messageId`. A bare `start` emits nothing. The asymmetry looks arbitrary, and it
      // is — but a consumer keyed on snapshot count would see the difference, so the mirror
      // reproduces it rather than tidying it up.
      if (messageId !== undefined) yield snapshot(state.message)
      continue
    }

    // `finish` does not close the message — measured against the oracle. A chunk arriving after it
    // keeps appending to the same message (`'a'` + `'B'` → `'aB'`), which is what the resumable
    // path (`Last-Event-ID` reconnect) depends on.
    //
    // It emits nothing EXCEPT when it carries `messageMetadata`. Dropping the whole chunk is what
    // the `remove-ai-dependency` migration did, and it silently removed a documented behaviour:
    // `@theokit/agents` attaches per-turn usage there so a surface can show real tokens for the
    // turn it just streamed, and the reconstructed message stopped carrying it. Measured in a
    // consumer (TheoCode B-090): an assistant message in a live thread had keys
    // `["id","role","parts"]` and no `metadata`, so the TUI's token readout never rendered.
    //
    // The snapshot is REQUIRED, not cosmetic: `finish` is usually the last chunk, and this loop
    // emits nothing after the stream ends — attaching without yielding would leave the field
    // unreachable. Metadata-free finishes still emit nothing, so every differential case that
    // measured "finish emits nothing" is unaffected.
    if (chunk.type === 'finish') {
      const metadata = (chunk as { messageMetadata?: unknown }).messageMetadata
      if (metadata === undefined) continue
      state ??= open(undefined)
      ;(state.message as { metadata?: unknown }).metadata = metadata
      yield snapshot(state.message)
      continue
    }

    // A content chunk with no `start` before it opens the message implicitly. The oracle does this,
    // and TheoKit code relies on it: the in-process transport pushes `data-message` chunks with no
    // `start` at all. Requiring `start` produced zero output for that path — caught by
    // `agent-client-coalescing.test.ts`, not by the differential, whose cases all began with one.
    //
    // This also removes the null-message TypeError (EC-3) at its source: there is no state in which
    // a content chunk meets a missing message.
    state ??= open(undefined)

    if (applyChunk(state, chunk)) yield snapshot(state.message)
  }
}

/** A part while it is still being built. The public `WireMessagePart` is readonly by design. */
type MutablePart = Record<string, unknown> & { type: string }

/**
 * Fold one chunk into the open message. Returns whether it produced an observable change.
 *
 * Split by family (block / tool / data) rather than one flat switch: the flat version measured a
 * cyclomatic complexity of 18 against a ceiling of 15, and the families genuinely differ — blocks
 * accumulate text under an id, tools mutate a part in place, data parts append.
 */
function applyChunk(state: OpenState, chunk: WireChunk): boolean {
  const parts = state.message.parts as unknown as MutablePart[]
  switch (chunk.type) {
    case 'text-start':
    case 'reasoning-start':
    case 'text-delta':
    case 'reasoning-delta':
    case 'text-end':
    case 'reasoning-end':
      return applyBlock(state, parts, chunk)

    case 'tool-input-available':
    case 'tool-approval-request':
    case 'tool-output-available':
    case 'tool-output-error':
      return applyTool(state, parts, chunk)

    case WIRE_APPROVAL_DETAIL_PART:
      rememberApprovalDetail(state, chunk)
      // Never a snapshot of its own: this part exists to be merged into the approval that follows.
      return false

    default:
      return applyDataPart(parts, chunk)
  }
}

/**
 * Stash a `data-approval` part for the approval frame that follows it (theokit#394).
 *
 * A detail nobody claims simply expires with the message, and an approval frame that arrives without
 * one still reconstructs carrying its id and nothing else — which is exactly what an ai-sdk server's
 * stream looks like. So a malformed detail is dropped rather than raised: it can only ever subtract
 * from a prompt, never break the gate.
 */
function rememberApprovalDetail(state: OpenState, chunk: WireChunk): void {
  const data = (chunk as { data?: Record<string, unknown> }).data
  const approvalId = data?.approvalId
  if (typeof approvalId !== 'string') return
  state.approvalDetails.set(approvalId, {
    ...(typeof data?.question === 'string' ? { question: data.question } : {}),
    ...(typeof data?.timeoutMs === 'number' ? { timeoutMs: data.timeoutMs } : {}),
  })
}

/** Text and reasoning runs: `*-start` opens a part, `*-delta` appends, `*-end` seals it. */
function applyBlock(state: OpenState, parts: MutablePart[], chunk: WireChunk): boolean {
  const id = (chunk as { id: string }).id
  if (chunk.type === 'text-start' || chunk.type === 'reasoning-start') {
    state.blocks.set(id, parts.length)
    const kind = chunk.type === 'text-start' ? 'text' : 'reasoning'
    parts.push({ type: kind, text: '', state: 'streaming' })
    return true
  }

  const at = state.blocks.get(id)
  // A delta for an id we never opened: dropped rather than guessed at. Opening a part here would
  // invent a block the producer never announced.
  if (at === undefined) return false

  if (chunk.type === 'text-end' || chunk.type === 'reasoning-end') {
    parts[at].state = 'done'
    return true
  }
  const part = parts[at]
  part.text = (typeof part.text === 'string' ? part.text : '') + (chunk as { delta: string }).delta
  return true
}

/** Tool runs: the input announces the call, the output mutates that same part in place. */
function applyTool(state: OpenState, parts: MutablePart[], chunk: WireChunk): boolean {
  const c = chunk as {
    toolCallId: string
    toolName?: string
    input?: unknown
    output?: unknown
    errorText?: string
    approvalId?: string
  }
  if (chunk.type === 'tool-input-available') {
    state.tools.set(c.toolCallId, parts.length)
    parts.push({
      type: 'dynamic-tool',
      toolName: c.toolName,
      toolCallId: c.toolCallId,
      state: 'input-available',
      input: c.input,
    })
    return true
  }

  const at = state.tools.get(c.toolCallId)
  if (at === undefined) return false
  // usetheokit/theokit#392 — the gate mutates the call's OWN part rather than being dropped.
  //
  // Until this arm existed the chunk fell through to `applyDataPart`, which returned `false`, and a
  // tool parked in an awaited approval sat in `state: 'input-available'` — byte-identical to an
  // ungated tool while it runs. A surface reading the transcript could not tell "working" from
  // "waiting for you", and `approve(approvalId, …)` asked for an id the transcript never carried.
  //
  // `approval-requested` is NOT a state invented here: it is what the ai-sdk's own reader produces
  // for this frame, so the mirror reproduces the oracle instead of coining a fourth vocabulary
  // (`tests/wire/differential.test.ts` covers the shape). The `approval` object is what the
  // settle call needs, next to the `toolName`/`input` the part already holds — which is why the
  // frame does not repeat those two (`chunk-schema.ts`). `question`/`timeoutMs` are merged from
  // the `data-approval` part that preceded it, when the producer sent one (theokit#394).
  //
  // A gate for a call this message never announced is DROPPED, not synthesised into a part: the
  // producer always emits `tool-input-available` first, so an orphan means the transcript is
  // already missing the call, and inventing a part would render an approval for a tool whose name
  // and input nobody has. The oracle drops it too.
  if (chunk.type === 'tool-approval-request') {
    const approvalId = String(c.approvalId)
    Object.assign(parts[at], {
      state: 'approval-requested',
      approval: { id: approvalId, ...state.approvalDetails.get(approvalId) },
    })
    state.approvalDetails.delete(approvalId)
    return true
  }
  if (chunk.type === 'tool-output-error') {
    Object.assign(parts[at], { state: 'output-error', errorText: c.errorText })
    return true
  }
  Object.assign(parts[at], { state: 'output-available', output: c.output })
  return true
}

/**
 * A `data-*` part joins the transcript UNLESS it is `transient` — measured against the oracle,
 * which appends `data-message` and drops `data-checkpoint{transient:true}`.
 *
 * The first cut dropped the whole family as "transport plumbing". That was wrong, and the
 * differential test did not catch it because its case list covered only transcript-bearing
 * variants — the coverage assertion had been written from the same wrong assumption. What caught it
 * was `agent-client-coalescing.test.ts`, whose fixture pushes 30 `data-message` chunks and expects
 * 30 emissions; it saw 2. A gate is only as good as the cases someone thought to add.
 *
 * `tool-approval-request` no longer reaches here — it is folded into the tool part it gates by
 * `applyTool`. It used to fall through to `false` on the reasoning that it "never renders as
 * assistant content", which was half right and wholly costly: the chunk is not a part of its own,
 * but the pause it announces IS the state of a part that renders, and dropping it left the only
 * channel the client store has with no trace of an outstanding decision (usetheokit/theokit#392).
 */
function applyDataPart(parts: MutablePart[], chunk: WireChunk): boolean {
  if (!chunk.type.startsWith('data-')) return false
  const part = chunk as { type: string; data: unknown; transient?: boolean }
  if (part.transient === true) return false
  parts.push({ type: part.type, data: part.data })
  return true
}
