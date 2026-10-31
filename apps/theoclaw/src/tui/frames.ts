import type { ControlFrame } from '../control-client/control-client.js'

/** One line of the transcript: what the owner sent, what the assistant wrote, a tool it called. */
export type TranscriptEntry =
  | { readonly kind: 'user'; readonly text: string }
  | { readonly kind: 'assistant'; readonly text: string }
  | { readonly kind: 'tool'; readonly callId: string; readonly name: string; readonly status: 'running' | 'success' | 'failed' }
  | { readonly kind: 'notice'; readonly variant: 'warning' | 'error'; readonly text: string }

/** What the TUI draws: the transcript and whether a turn is running. Pure data, so the view stays a view. */
export interface TuiView {
  readonly transcript: readonly TranscriptEntry[]
  readonly running: boolean
}

export const INITIAL_VIEW: TuiView = { transcript: [], running: false }

/** The longest session id the instance accepts (`^[A-Za-z0-9_-]{1,64}$`). */
const MAX_SESSION_LENGTH = 64

/** `/new`'s session: `<base>-<n>`, the base shortened so the whole id stays within 64 characters. */
export function nextSessionId(base: string, n: number): string {
  const suffix = `-${n}`
  return `${base.slice(0, MAX_SESSION_LENGTH - suffix.length)}${suffix}`
}

/** The owner sent `text`: it joins the transcript and a turn starts. */
export function startTurn(view: TuiView, text: string): TuiView {
  return { transcript: [...view.transcript, { kind: 'user', text }], running: true }
}

function appendText(transcript: readonly TranscriptEntry[], text: string): readonly TranscriptEntry[] {
  const last = transcript.at(-1)
  if (last?.kind === 'assistant') return [...transcript.slice(0, -1), { kind: 'assistant', text: last.text + text }]
  return [...transcript, { kind: 'assistant', text }]
}

function settleTool(transcript: readonly TranscriptEntry[], callId: string, failed: boolean): readonly TranscriptEntry[] {
  return transcript.map((entry) =>
    entry.kind === 'tool' && entry.callId === callId ? { ...entry, status: failed ? 'failed' : 'success' } : entry,
  )
}

/** Fold one event of the running turn into the transcript; text deltas append as they arrive. */
function applyEvent(view: TuiView, event: Extract<ControlFrame, { type: 'event' }>['event']): TuiView {
  switch (event.type) {
    case 'text_delta':
      return { ...view, transcript: appendText(view.transcript, String(event.content)) }
    case 'tool_call':
      return { ...view, transcript: [...view.transcript, { kind: 'tool', callId: String(event.callId), name: String(event.toolName), status: 'running' }] }
    case 'tool_result':
      return { ...view, transcript: settleTool(view.transcript, String(event.callId), event.isError === true) }
    case 'error':
      return { ...view, transcript: [...view.transcript, { kind: 'notice', variant: 'error', text: `the turn failed (${String(event.code)})` }] }
    default:
      return view
  }
}

/** Fold one frame of the running turn into the view. */
export function applyFrame(view: TuiView, frame: ControlFrame): TuiView {
  switch (frame.type) {
    case 'event':
      return applyEvent(view, frame.event)
    case 'done':
      return { ...view, running: false }
    case 'interrupted':
      return { transcript: [...view.transcript, { kind: 'notice', variant: 'warning', text: 'interrupted' }], running: false }
    case 'error':
      return { transcript: [...view.transcript, { kind: 'notice', variant: 'error', text: `the turn ended: ${frame.code}` }], running: false }
    default:
      return view
  }
}

/** The connection failed mid-turn: the turn ends with the reason. */
export function failTurn(view: TuiView, reason: string): TuiView {
  return { transcript: [...view.transcript, { kind: 'notice', variant: 'error', text: reason }], running: false }
}
