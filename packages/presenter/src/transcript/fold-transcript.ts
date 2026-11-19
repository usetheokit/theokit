import type { AgentOutputEvent } from '../agent-output-event.js'
import { readToolResult, type ToolResultView } from '../tool-result/read-tool-result.js'

/** One tool card: keyed by `callId`, with the status the turn has reached for it. */
export interface TranscriptTool {
  readonly callId: string
  readonly name: string
  readonly input: unknown
  readonly status: 'pending' | 'running' | 'success' | 'failed'
  readonly result?: ToolResultView
}

/** One thing the screen shows. `id` is stable across folds: `message_0` (from order) or the tool's `callId`. */
export interface TranscriptItem {
  readonly id: string
  readonly kind: 'message' | 'reasoning' | 'tool' | 'error'
  readonly text?: string
  readonly tool?: TranscriptTool
}

export interface TranscriptState {
  readonly items: readonly TranscriptItem[]
  readonly status: 'idle' | 'streaming' | 'done' | 'error'
  readonly error?: { readonly message: string; readonly code?: string }
}

export const EMPTY_TRANSCRIPT: TranscriptState = Object.freeze({
  items: Object.freeze([]),
  status: 'idle',
})

function streaming(state: TranscriptState, items: readonly TranscriptItem[]): TranscriptState {
  return { ...state, items, status: 'streaming' }
}

/** Append to the last item when it is an open item of `kind`, else open a new one. */
function appendText(
  state: TranscriptState,
  kind: 'message' | 'reasoning',
  text: string,
): TranscriptState {
  if (text === '') return state
  const last = state.items.at(-1)
  if (last?.kind === kind) {
    const items = [...state.items.slice(0, -1), { ...last, text: (last.text ?? '') + text }]
    return streaming(state, items)
  }
  return streaming(state, [...state.items, { id: `${kind}_${state.items.length}`, kind, text }])
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  const rb = b as Record<string, unknown>
  return ka.every(
    (k) => Object.hasOwn(rb, k) && sameValue((a as Record<string, unknown>)[k], rb[k]),
  )
}

/**
 * Create or update the card for `callId`. `closesMessage` (a `tool-call`) moves an existing card behind
 * a message that is still open, so text that follows opens a new message. An update that changes
 * nothing returns `state` itself.
 */
function upsertTool(
  state: TranscriptState,
  callId: string,
  update: (prev: TranscriptTool | undefined) => TranscriptTool | undefined,
  closesMessage = false,
): TranscriptState {
  const index = state.items.findIndex((i) => i.kind === 'tool' && i.id === callId)
  const prev = index === -1 ? undefined : state.items[index]?.tool
  const next = update(prev)
  if (next === undefined) return state
  const moves = closesMessage && index !== -1 && state.items.at(-1)?.kind === 'message'
  if (prev && !moves && sameValue(prev, next)) return state
  const item: TranscriptItem = { id: callId, kind: 'tool', tool: next }
  if (index === -1) return streaming(state, [...state.items, item])
  if (moves) return streaming(state, [...state.items.filter((_, i) => i !== index), item])
  return streaming(
    state,
    state.items.map((it, i) => (i === index ? item : it)),
  )
}

function failOpenTools(items: readonly TranscriptItem[]): readonly TranscriptItem[] {
  return items.map((item) =>
    item.tool && (item.tool.status === 'pending' || item.tool.status === 'running')
      ? { ...item, tool: { ...item.tool, status: 'failed' as const } }
      : item,
  )
}

/** Pure. Never mutates `state`; returns `state` itself when the event changes nothing. */
export function foldTranscript(state: TranscriptState, event: AgentOutputEvent): TranscriptState {
  if (state.status === 'done' || state.status === 'error') return state
  switch (event.type) {
    case 'text':
      return appendText(state, 'message', event.text)
    case 'reasoning':
      return appendText(state, 'reasoning', event.text)
    case 'partial-tool-call':
      return upsertTool(state, event.callId, (prev) => {
        if (!prev) {
          return { callId: event.callId, name: event.name, input: event.input, status: 'pending' }
        }
        return prev.status === 'pending'
          ? { ...prev, name: event.name, input: event.input }
          : undefined
      })
    case 'tool-call':
      return upsertTool(
        state,
        event.callId,
        () => ({ callId: event.callId, name: event.name, input: event.input, status: 'running' }),
        true,
      )
    case 'tool-result':
      return upsertTool(state, event.callId, (prev) => ({
        callId: event.callId,
        name: prev?.name ?? event.name,
        input: prev?.input,
        status: event.isError === true ? 'failed' : 'success',
        result: readToolResult(event.result),
      }))
    case 'finish':
      return { ...state, items: failOpenTools(state.items), status: 'done' }
    case 'error': {
      const error =
        event.code === undefined
          ? { message: event.message }
          : { message: event.message, code: event.code }
      const items = [
        ...failOpenTools(state.items),
        { id: `error_${state.items.length}`, kind: 'error' as const, text: event.message },
      ]
      return { items, status: 'error', error }
    }
    case 'status':
      return state
  }
}
