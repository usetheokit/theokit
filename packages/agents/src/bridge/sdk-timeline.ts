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
/** A `tool_result` held for one more report of the same call. */
interface PendingToolResult {
  readonly ids: readonly string[]
  event: StreamEvent
}

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
 * completion). Preferring either one silently loses the other's cases, so both are read and only ONE
 * event per lifecycle point leaves.
 *
 * usetheokit/theokit#388 corrected WHICH one that is for a completion. "The second report is
 * dropped" was true and wrong at the same time: the two reports are the same lifecycle point, so
 * dedup was right, but they are not equally informative — only the message carries the exit code,
 * and it is always the one that arrives second (`dispatchSingleCall` awaits the completion delta,
 * then pushes the completed message). So a failed call left as a successful one. A completion is now
 * HELD for one report instead of emitted immediately, and the second report contributes its exit
 * code to it. Still one event on the wire; now it is the informed one.
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
   * usetheokit/theokit#388 — results held back until the OTHER source has had its say.
   *
   * Both sources report the same completion, and neither one alone is the whole report: the delta
   * carries the rendered, model-facing output the wire has always shown, and the message carries the
   * exit code that says whether the call worked. Emitting the first and dropping the second put the
   * failure text in the SUCCESS field; emitting both would put the same call on the wire twice,
   * which is #361 reopened. So the first report waits, the second contributes what it knows, and
   * exactly one event leaves.
   */
  pending: PendingToolResult[]
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

/** Whether an event belongs to a tool's lifecycle — the ones that must not force a held result out. */
function isToolLifecycleEvent(e: StreamEvent): boolean {
  return e.type === 'tool_call' || e.type === 'tool_result' || e.type === 'partial_tool_call'
}

/**
 * #388 — fold a second report of an already-held result into the one still waiting.
 *
 * The HELD event's `output` survives, because that is the field the first reporter is better at: on
 * the shipped SDK the delta arrives first carrying `renderToolResult()` — the string the model was
 * shown — while the message carries `{stdout, stderr, exitCode}`, which serializes to a JSON blob no
 * consumer ever rendered. Only `isError` is contributed, and by OR: whichever source knows the call
 * failed is believed, in either arrival order, and neither can talk the other out of it.
 *
 * A no-op when nothing is held for this call — the first report already shipped, and the second was
 * going to be dropped either way.
 */
function mergeIntoPending(e: StreamEvent, ids: readonly string[], seen: ToolSeen): void {
  if (e.type !== 'tool_result' || !e.isError) return
  const held = seen.pending.find((p) => p.ids.some((id) => ids.includes(id)))
  if (held?.event.type !== 'tool_result') return
  held.event = { ...held.event, isError: true }
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
    if (ids.some((id) => bucket.has(id))) {
      // #388 — a second report is still a report. It is never emitted, but while the first one is
      // held it may still say something the first could not.
      mergeIntoPending(e, ids, seen)
      return false
    }
    for (const id of ids) bucket.add(id)
    if (e.type === 'tool_result') {
      // #388 — hold it. `releasePendingToolResults` puts it on the wire as soon as anything that
      // must follow it is ready to go, and `flushPendingToolResults` covers the run that ends here.
      seen.pending.push({ ids, event: e })
      return false
    }
    return true
  })
}

/**
 * #388 — the held results that may now go, given what this timeline event turned into.
 *
 * A tool lifecycle event does NOT release them: `mapWithConcurrency` dispatches up to four calls of
 * a round at once, so another call's `tool-call-started` can land between a call's two reports, and
 * releasing on it would spend the hold before the report that carries the exit code arrives.
 * Anything else does release them, which is what keeps a result ahead of the text that follows it.
 *
 * An event that translates to NOTHING releases nothing, for the same reason: there is no ordering to
 * preserve against an event that never reaches the wire.
 */
function releasePendingToolResults(translated: StreamEvent[], seen: ToolSeen): StreamEvent[] {
  if (seen.pending.length === 0) return []
  if (translated.length === 0 || translated.every(isToolLifecycleEvent)) return []
  return flushPendingToolResults(seen)
}

/**
 * #388 — every result still being held, in arrival order. Called when the timeline is exhausted: a
 * run whose last act was a tool call has nothing left to release the hold, and a held result that
 * never ships is the hole this design exists to avoid.
 */
export function flushPendingToolResults(seen: ToolSeen): StreamEvent[] {
  const out = seen.pending.map((p) => p.event)
  seen.pending = []
  return out
}

/** Fresh per-turn state. One run's ids must never suppress another's. */
export function createToolSeen(): ToolSeen {
  return {
    started: new Set<string>(),
    completed: new Set<string>(),
    pending: [],
    sawThinkingDelta: false,
  }
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
    // #388 — released BEFORE this event's own output, because a held result was reported earlier
    // than whatever is releasing it. The wire order a consumer reads is unchanged.
    const released = releasePendingToolResults(events, seen)
    return [...released, ...dedupeTools(events, ev.update, seen)]
  }
  if (ev.message === undefined) return []
  const events = translateSdkEvent(ev.message, runId)
  // Only the text is a duplicate the producer can name. Tool events on this message go through the
  // id-keyed pass — the flag answers one question, and widening it by guessing would reintroduce
  // exactly the inference it replaced.
  const kept =
    ev.textAlreadyStreamed === true ? events.filter((e) => e.type !== 'text_delta') : events
  const released = releasePendingToolResults(kept, seen)
  return [...released, ...dedupeTools(kept, ev.message, seen)]
}
