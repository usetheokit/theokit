/**
 * Fold the canonical event stream into what a chat screen shows: messages, reasoning, tool cards
 * with a status, and an error. Pure and terminal-final. Use `foldTurnLifecycle` for the turn's
 * lifecycle instead.
 */
import type { AgentOutputEvent } from '../agent-output-event.js'
import { readToolResult, type ToolResultView } from '../tool-result/read-tool-result.js'

export interface TranscriptTool {
  readonly callId: string
  readonly name: string
  readonly input: unknown
  readonly status: 'pending' | 'running' | 'success' | 'failed'
  readonly result?: ToolResultView
}

export interface TranscriptItem {
  /** Stable across folds: derived from order (`message_0`) or the tool's `callId`. */
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

const EMPTY_ITEMS: readonly TranscriptItem[] = Object.freeze([])
export const EMPTY_TRANSCRIPT: TranscriptState = Object.freeze({
  items: EMPTY_ITEMS,
  status: 'idle' as const,
})

/** States whose last item must not be appended to (a tool call closed it, though it stays last). */
const closed = new WeakSet<TranscriptState>()

function next(
  state: TranscriptState,
  items: readonly TranscriptItem[],
  close = false,
): TranscriptState {
  const s: TranscriptState = { ...state, items, status: 'streaming' }
  if (close) closed.add(s)
  return s
}

function append(state: TranscriptState, kind: 'message' | 'reasoning', text: string) {
  const last = state.items.at(-1)
  if (last?.kind === kind && !closed.has(state)) {
    const items = [...state.items.slice(0, -1), { ...last, text: (last.text ?? '') + text }]
    return next(state, items)
  }
  return next(state, [...state.items, { id: `${kind}_${state.items.length}`, kind, text }])
}

function upsertTool(
  state: TranscriptState,
  callId: string,
  patch: (prev: TranscriptTool | undefined) => TranscriptTool,
): TranscriptState {
  const i = state.items.findIndex((it) => it.kind === 'tool' && it.tool?.callId === callId)
  if (i < 0) {
    const tool = patch(undefined)
    return next(state, [...state.items, { id: callId, kind: 'tool', tool }], true)
  }
  const items = state.items.map((it, j) => (j === i ? { ...it, tool: patch(it.tool) } : it))
  return next(state, items, true)
}

function failOpenTools(items: readonly TranscriptItem[]): readonly TranscriptItem[] {
  return items.map((it) =>
    it.tool && (it.tool.status === 'pending' || it.tool.status === 'running')
      ? { ...it, tool: { ...it.tool, status: 'failed' as const } }
      : it,
  )
}

/** Pure. Never mutates `state`; returns `state` itself when the event changes nothing. */
export function foldTranscript(state: TranscriptState, event: AgentOutputEvent): TranscriptState {
  if (state.status === 'done' || state.status === 'error') return state
  switch (event.type) {
    case 'text':
      return append(state, 'message', event.text)
    case 'reasoning':
      return append(state, 'reasoning', event.text)
    case 'partial-tool-call':
      return upsertTool(state, event.callId, (p) => ({
        callId: event.callId,
        name: event.name,
        input: event.input,
        status: p?.status ?? 'pending',
        ...(p?.result ? { result: p.result } : {}),
      }))
    case 'tool-call':
      return upsertTool(state, event.callId, (p) => ({
        ...p,
        callId: event.callId,
        name: event.name,
        input: event.input,
        status: 'running',
      }))
    case 'tool-result':
      return upsertTool(state, event.callId, (p) => ({
        callId: event.callId,
        name: p?.name ?? event.name,
        input: p?.input,
        status: event.isError === true ? 'failed' : 'success',
        result: readToolResult(event.result),
      }))
    case 'finish':
      return { ...state, items: failOpenTools(state.items), status: 'done' }
    case 'error': {
      const error = {
        message: event.message,
        ...(event.code === undefined ? {} : { code: event.code }),
      }
      const item: TranscriptItem = {
        id: `error_${state.items.length}`,
        kind: 'error',
        text: event.message,
      }
      return { items: [...failOpenTools(state.items), item], status: 'error', error }
    }
    default:
      return state
  }
}
