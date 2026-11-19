import type { InteractionUpdate } from '@theokit/sdk'

import type { AgentOutputEvent } from '../agent-output-event.js'
import { fromInteractionUpdate, fromSdkMessage, type SdkMessage } from './from-sdk.js'

/** Structural copy of the SDK's RunTimelineEvent, so this module needs no value import from the SDK. */
export interface RunTimelineEventLike {
  readonly kind: 'message' | 'delta'
  readonly message?: SdkMessage
  readonly update?: unknown
  readonly textAlreadyStreamed?: boolean
}

interface PendingResult {
  readonly ids: readonly string[]
  event: AgentOutputEvent
}

/** Per-run state. One run's ids must never suppress another's. */
export interface RunTimelineState {
  readonly started: Set<string>
  readonly completed: Set<string>
  pending: PendingResult[]
  sawThinkingDelta: boolean
}

export function createRunTimelineState(): RunTimelineState {
  return { started: new Set(), completed: new Set(), pending: [], sawThinkingDelta: false }
}

/** Every id the call answers to (`callId`, and the delta's `modelCallId`). Empty means never deduped. */
function idsOf(event: AgentOutputEvent, raw: unknown): string[] {
  const ids: string[] = []
  const callId = 'callId' in event && typeof event.callId === 'string' ? event.callId : ''
  if (callId !== '') ids.push(callId)
  const model = (raw as { modelCallId?: unknown } | null | undefined)?.modelCallId
  if (typeof model === 'string' && model !== '' && model !== callId) ids.push(model)
  return ids
}

function isToolLifecycle(e: AgentOutputEvent): boolean {
  return e.type === 'tool-call' || e.type === 'tool-result' || e.type === 'partial-tool-call'
}

/** A second report of a held result can only add a failure; the held output text is kept. */
function mergeIntoPending(
  e: AgentOutputEvent,
  ids: readonly string[],
  state: RunTimelineState,
): void {
  if (e.type !== 'tool-result' || !e.isError) return
  const held = state.pending.find((p) => p.ids.some((id) => ids.includes(id)))
  if (held?.event.type !== 'tool-result') return
  held.event = { ...held.event, isError: true }
}

function dedupe(
  events: AgentOutputEvent[],
  raw: unknown,
  fromDelta: boolean,
  state: RunTimelineState,
): AgentOutputEvent[] {
  return events.filter((e) => {
    if (e.type === 'reasoning') {
      if (fromDelta) {
        state.sawThinkingDelta = true
        return true
      }
      // The coarse thinking message repeats the deltas that already crossed.
      return !state.sawThinkingDelta
    }
    const bucket =
      e.type === 'tool-call'
        ? state.started
        : e.type === 'tool-result'
          ? state.completed
          : undefined
    if (bucket === undefined) return true
    const ids = idsOf(e, raw)
    if (ids.length === 0) return true
    if (ids.some((id) => bucket.has(id))) {
      mergeIntoPending(e, ids, state)
      return false
    }
    for (const id of ids) bucket.add(id)
    if (e.type === 'tool-result') {
      state.pending.push({ ids, event: e })
      return false
    }
    return true
  })
}

/** Release every tool result still held. Call once when the timeline ends. */
export function flushRunTimeline(state: RunTimelineState): AgentOutputEvent[] {
  const out = state.pending.map((p) => p.event)
  state.pending = []
  return out
}

function release(translated: AgentOutputEvent[], state: RunTimelineState): AgentOutputEvent[] {
  if (state.pending.length === 0) return []
  if (translated.length === 0 || translated.every(isToolLifecycle)) return []
  return flushRunTimeline(state)
}

/** Translate one timeline event, in arrival order. */
export function fromRunTimelineEvent(
  event: RunTimelineEventLike,
  state: RunTimelineState,
): AgentOutputEvent[] {
  if (event.kind === 'delta') {
    if (event.update === undefined) return []
    const events = fromInteractionUpdate(event.update as InteractionUpdate)
    return [...release(events, state), ...dedupe(events, event.update, true, state)]
  }
  if (event.message === undefined) return []
  const all = fromSdkMessage(event.message)
  // Only the text is a duplicate the producer names; tool calls on the same message are kept.
  const kept = event.textAlreadyStreamed === true ? all.filter((e) => e.type !== 'text') : all
  return [...release(kept, state), ...dedupe(kept, event.message, false, state)]
}
