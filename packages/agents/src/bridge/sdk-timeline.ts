import type { StreamEvent } from './agent-sse-handler.js'
import {
  type SdkMessage,
  translateInteractionUpdate,
  translateSdkEvent,
} from './event-translator.js'

/**
 * theokit#140 — consume the SDK's ONE ordered timeline.
 *
 * This replaces `mergeDeltaStream` + `createDeltaSink` + `isDuplicatedByDelta` + `MergeState`, which
 * existed for a single reason: neither of the two surfaces the bridge fused was complete on its own.
 * `onDelta` carried tokens and tool lifecycle but no `run_started`/`system`; `run.stream()` carried
 * complete messages but arrived post-completion. Reconciling them needed dedup, the dedup needed to
 * recognise "the same thing" across two namespaces, and that recognition is where #47 (ordering),
 * #138 (`callId` namespace) and the timestamp-fallback bug came from.
 *
 * `run.events()` (SDK 4.38.0) removed the ordering half: both kinds are appended by the loop as they
 * happen, so ARRIVAL ORDER IS MODEL ORDER and there is no sort left to do. `textAlreadyStreamed`
 * (SDK 4.40.0) removed the other half: the producer states whether a message's text already crossed
 * as deltas, so the consumer reads a boolean instead of comparing content.
 *
 * What remains here is translation, which is all this layer was ever supposed to do.
 */

/** The SDK's timeline event, structurally typed so this module needs no value import from the SDK. */
export interface SdkTimelineEvent {
  readonly kind: 'message' | 'delta'
  readonly message?: SdkMessage
  readonly update?: unknown
  /** #140 — set by the SDK when this message's text already crossed as `kind: 'delta'`. */
  readonly textAlreadyStreamed?: boolean
}

/**
 * Translate one timeline event into zero or more `StreamEvent`s.
 *
 * The text drop is the whole dedup, and it is a read rather than a comparison. The message is still
 * translated — it carries tool calls the deltas do not repeat — so dropping the message wholesale
 * would trade a duplicate for a hole.
 */
/**
 * Tool lifecycle points already emitted, keyed by every id the same call answers to.
 *
 * #140 — this is the ONE piece of the old `MergeState` that survives, and it survives because it is
 * correct, not because it was missed. Measured: neither tool source is complete.
 *
 *   msg:tool_call     -> agent_id, args, call_id, name, run_id, status (+result when completed)
 *   delta:tool-call-* -> callId, modelCallId, toolCall{name, args, result}
 *
 * The delta is richer in identity — only it carries `modelCallId` — but the MESSAGE is the only
 * reporter of a tool failure the delta merely opened (`tool-call-started` with no matching
 * completion). Preferring either one silently loses the other's cases, so both are read and the
 * SECOND report of a lifecycle point is dropped.
 *
 * What is gone is the part that was wrong: dedup by comparing CONTENT. An id is what the producer
 * assigned; text is what a consumer guessed two things had in common — and that guess is where #138
 * and the timestamp fallback came from. An id-less event never matches, so it double-renders
 * visibly rather than vanishing (fail-loud, unchanged from the original design's intent).
 */
interface ToolSeen {
  readonly started: Set<string>
  readonly completed: Set<string>
  /**
   * #140 — reasoning has the same delta+message pair as text, and no id to key on. The SDK names
   * the text case (`textAlreadyStreamed`); it does not name this one, so the layer keeps the
   * category flag the old `MergeState` used (`sawThinkingDelta`).
   *
   * This is NOT the thing the issue set out to delete. A category flag records "a reasoning delta
   * happened"; it never compares two payloads to decide they are the same. Content comparison is
   * what produced #138 and the timestamp fallback, and that is gone. Promoting this to the producer
   * would be a third contract field — worth doing only with the same measurement the first two got.
   */
  sawThinkingDelta: boolean
}

/** Every id under which this call may be reported. Empty ⇒ unidentifiable ⇒ never deduped. */
function idsOf(e: StreamEvent, raw: unknown): string[] {
  const ids: string[] = []
  const callId = typeof e.callId === 'string' ? e.callId : ''
  if (callId !== '') ids.push(callId)
  const model = (raw as { modelCallId?: unknown } | null | undefined)?.modelCallId
  if (typeof model === 'string' && model !== '' && model !== callId) ids.push(model)
  return ids
}

/** Which lifecycle bucket an event belongs to, or `undefined` when it is not a tool event. */
function bucketFor(e: StreamEvent, seen: ToolSeen): Set<string> | undefined {
  if (e.type === 'tool_call') return seen.started
  if (e.type === 'tool_result') return seen.completed
  return undefined
}

/** Drop a tool event whose lifecycle point was already reported by the other source. */
function dedupeTools(events: StreamEvent[], raw: unknown, seen: ToolSeen): StreamEvent[] {
  return events.filter((e) => {
    if (e.type === 'thinking') {
      // The delta arrives first; the complete message repeats it. Drop the repeat, keep the first.
      if (seen.sawThinkingDelta) return false
      seen.sawThinkingDelta = true
      return true
    }
    const bucket = bucketFor(e, seen)
    if (bucket === undefined) return true
    const ids = idsOf(e, raw)
    if (ids.length === 0) return true
    if (ids.some((id) => bucket.has(id))) return false
    for (const id of ids) bucket.add(id)
    return true
  })
}

/** Fresh per-turn state. One run's ids must never suppress another's. */
export function createToolSeen(): ToolSeen {
  return { started: new Set<string>(), completed: new Set<string>(), sawThinkingDelta: false }
}

export function translateTimelineEvent(
  ev: SdkTimelineEvent,
  runId: string,
  seen: ToolSeen,
): StreamEvent[] {
  if (ev.kind === 'delta') {
    if (ev.update === undefined) return []
    const events = translateInteractionUpdate(
      ev.update as Parameters<typeof translateInteractionUpdate>[0],
    )
    return dedupeTools(events, ev.update, seen)
  }
  if (ev.message === undefined) return []
  const events = translateSdkEvent(ev.message, runId)
  // Only the text is a duplicate the producer can name. Tool events on this message go through the
  // id-keyed pass — the flag answers one question, and widening it by guessing would reintroduce
  // exactly the inference it replaced.
  const kept =
    ev.textAlreadyStreamed === true ? events.filter((e) => e.type !== 'text_delta') : events
  return dedupeTools(kept, ev.message, seen)
}
