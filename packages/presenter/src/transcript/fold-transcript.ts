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
  /** Set on a message that a later `tool-call` closed: further text opens a new message. */
  readonly closed?: boolean
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
  if (last?.kind === kind && last.closed !== true) {
    const items = [...state.items.slice(0, -1), { ...last, text: (last.text ?? '') + text }]
    return streaming(state, items)
  }
  return streaming(state, [...state.items, { id: `${kind}_${state.items.length}`, kind, text }])
}

const MAX_COMPARE_DEPTH = 32

function isPlain(v: object): boolean {
  if (Array.isArray(v)) return true
  const proto: unknown = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/** Structural equality for plain objects and arrays only; anything else (Date, Map, cycles) is equal only if identical. */
function sameValue(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (depth >= MAX_COMPARE_DEPTH || !isPlain(a) || !isPlain(b)) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  return ka.every((k) => Object.hasOwn(rb, k) && sameValue(ra[k], rb[k], depth + 1))
}

/**
 * Create or update the card for `callId`, keeping its position. `closesMessage` (a `tool-call`) marks a
 * still-open last message closed, so text that follows opens a new message. An update that changes
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
  const last = state.items.at(-1)
  const closes = closesMessage && index !== -1 && last?.kind === 'message' && last.closed !== true
  if (prev && !closes && sameValue(prev, next)) return state
  const item: TranscriptItem = { id: callId, kind: 'tool', tool: next }
  if (index === -1) return streaming(state, [...state.items, item])
  const items = state.items.map((it, i) => {
    if (i === index) return item
    return closes && it === last ? { ...it, closed: true } : it
  })
  return streaming(state, items)
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
