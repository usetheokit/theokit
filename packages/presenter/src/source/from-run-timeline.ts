import type { InteractionUpdate } from '@theokit/sdk'

import type { AgentOutputEvent } from '../agent-output-event.js'

import { fromInteractionUpdate, fromSdkMessage } from './from-sdk.js'

/** Structural copy of the SDK's RunTimelineEvent, so this module needs no value import from the SDK. */
export interface RunTimelineEventLike {
  readonly kind: 'message' | 'delta'
  readonly message?: { readonly type: string }
  readonly update?: unknown
  readonly textAlreadyStreamed?: boolean
}

const TOOL_RESULT = 'tool-result'

interface PendingResult {
  ids: string[]
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

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * The ids each translated tool event answers to, read from the ORIGINAL report (the translator
 * invents a `tc-<time>` id when the source has none, and that must never be used to dedupe).
 * One entry per tool-call / tool-result event, in the order the translator emits them.
 */
function sourceIds(raw: unknown, fromDelta: boolean): string[][] {
  const r = raw as Record<string, unknown>
  const one = (...ids: string[]): string[][] => [[...new Set(ids.filter((i) => i !== ''))]]
  if (fromDelta) return one(str(r.callId), str(r.modelCallId))
  if (r.type === 'tool_call') return one(str(r.call_id))
  const content = (r.message as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content)) return []
  return content
    .filter((b) => (b as { type?: unknown } | null)?.type === 'tool_use')
    .map((b) => one(str((b as { id?: unknown }).id))[0] ?? [])
}

function isToolLifecycle(e: AgentOutputEvent): boolean {
  return e.type === 'tool-call' || e.type === TOOL_RESULT || e.type === 'partial-tool-call'
}

/** A second report of a held result can only add a failure; the held output text is kept. */
function mergeIntoPending(
  e: AgentOutputEvent,
  ids: readonly string[],
  state: RunTimelineState,
): void {
  const held = state.pending.find((p) => p.ids.some((id) => ids.includes(id)))
  if (held === undefined) return
  // Record the aliases this report adds, so a later report under either id still matches.
  for (const id of ids) if (!held.ids.includes(id)) held.ids.push(id)
  if (e.type !== TOOL_RESULT || !e.isError || held.event.type !== TOOL_RESULT) return
  held.event = { ...held.event, isError: true }
}

function bucketFor(e: AgentOutputEvent, state: RunTimelineState): Set<string> | undefined {
  if (e.type === 'tool-call') return state.started
  if (e.type === TOOL_RESULT) return state.completed
  return undefined
}

function dedupe(
  events: AgentOutputEvent[],
  raw: unknown,
  fromDelta: boolean,
  state: RunTimelineState,
): AgentOutputEvent[] {
  const sources = sourceIds(raw, fromDelta)
  let toolIndex = 0
  return events.filter((e) => {
    if (e.type === 'reasoning') {
      if (fromDelta) {
        state.sawThinkingDelta = true
        return true
      }
      // The coarse thinking message repeats the deltas that already crossed.
      return !state.sawThinkingDelta
    }
    const bucket = bucketFor(e, state)
    if (bucket === undefined) return true
    const ids = sources[toolIndex++] ?? []
    if (ids.length === 0) return true
    if (ids.some((id) => bucket.has(id))) {
      for (const id of ids) bucket.add(id)
      mergeIntoPending(e, ids, state)
      return false
    }
    for (const id of ids) bucket.add(id)
    if (e.type === TOOL_RESULT) {
      state.pending.push({ ids: [...ids], event: e })
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

/**
 * Dedupe `translated`, then release the results held BEFORE this event only when something that
 * must follow them is actually going out (a discarded repeat releases nothing).
 */
function step(
  translated: AgentOutputEvent[],
  raw: unknown,
  fromDelta: boolean,
  state: RunTimelineState,
): AgentOutputEvent[] {
  const prior = [...state.pending]
  const emitted = dedupe(translated, raw, fromDelta, state)
  if (prior.length === 0 || emitted.every(isToolLifecycle)) return emitted
  state.pending = state.pending.slice(prior.length)
  return [...prior.map((p) => p.event), ...emitted]
}

/** Translate one timeline event, in arrival order. */
export function fromRunTimelineEvent(
  event: RunTimelineEventLike,
  state: RunTimelineState,
): AgentOutputEvent[] {
  if (event.kind === 'delta') {
    if (event.update === undefined) return []
    return step(fromInteractionUpdate(event.update as InteractionUpdate), event.update, true, state)
  }
  if (event.message === undefined) return []
  const all = fromSdkMessage(event.message)
  // Only the text is a duplicate the producer names; tool calls on the same message are kept.
  const kept = event.textAlreadyStreamed === true ? all.filter((e) => e.type !== 'text') : all
  return step(kept, event.message, false, state)
}
