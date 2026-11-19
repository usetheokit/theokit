import {
  type AgentEvent,
  type AgentStreamEvent,
  agentStreamReducer,
  initialAgentStreamState,
} from '@theokit/tui'

import { type ControlClient, type ControlFrame, nextArrival } from '../control-client/control-client.js'

/** One line of the transcript: what the owner sent, what the assistant wrote, a tool it called. */
export type TranscriptEntry =
  | { readonly kind: 'user'; readonly text: string }
  | { readonly kind: 'assistant'; readonly text: string }
  | {
      readonly kind: 'tool'
      readonly callId: string
      readonly name: string
      readonly status: 'running' | 'success' | 'failed'
    }
  | { readonly kind: 'notice'; readonly variant: 'warning' | 'error'; readonly text: string }

/** What the TUI draws: the transcript and whether a turn is running. Pure data, so the view stays a view. */
export interface TuiView {
  readonly transcript: readonly TranscriptEntry[]
  readonly running: boolean
}

export const INITIAL_VIEW: TuiView = { transcript: [], running: false }

/** A line for the owner that is not text or a tool of the assistant: what TheoClaw adds at the frame level. */
export interface TuiNotice {
  readonly variant: 'warning' | 'error'
  readonly text: string
}

/** A notice raised inside a turn, placed after the first `after` events the framework had folded then. */
export interface TurnNotice extends TuiNotice {
  readonly after: number
}

/** One row of a turn: a folded framework event, or a notice at the place it was raised. */
export type TurnEntry =
  | { readonly kind: 'event'; readonly event: AgentEvent }
  | ({ readonly kind: 'notice' } & TuiNotice)

/** Interleave a turn's folded events with the notices raised inside it, keeping the order they happened in. */
export function turnEntries(
  events: readonly AgentEvent[],
  notices: readonly TurnNotice[],
): readonly TurnEntry[] {
  const entries: TurnEntry[] = []
  const pushNotices = (match: (n: TurnNotice) => boolean): void => {
    for (const n of notices)
      if (match(n)) entries.push({ kind: 'notice', variant: n.variant, text: n.text })
  }
  events.forEach((event, index) => {
    pushNotices((n) => n.after === index)
    entries.push({ kind: 'event', event })
  })
  pushNotices((n) => n.after >= events.length)
  return entries
}

/** The longest session id the instance accepts (`^[A-Za-z0-9_-]{1,64}$`). */
const MAX_SESSION_LENGTH = 64

/** `/new`'s session: `<base>-<n>`, the base shortened so the whole id stays within 64 characters. */
export function nextSessionId(base: string, n: number): string {
  const suffix = `-${n}`
  return `${base.slice(0, MAX_SESSION_LENGTH - suffix.length)}${suffix}`
}

/** Notices the app raises while a turn runs; the stream places each at the point it has reached when it takes it. */
export interface TurnInbox {
  post(n: TuiNotice): void
  /** The posted notices that arrived before `before` (a stamp from `stamp`), oldest first; the rest stay queued. */
  take(before?: number): TuiNotice[]
  /** Resolves once a notice is queued. */
  wait(): Promise<void>
  /** A stamp on the inbox's clock, to order something else's arrival against the posts. */
  stamp(): number
}

export function createTurnInbox(): TurnInbox {
  let queue: { n: TuiNotice; seq: number }[] = []
  let wake: (() => void) | undefined
  return {
    post(n) {
      queue.push({ n, seq: nextArrival() })
      wake?.()
      wake = undefined
    },
    take(before = Number.POSITIVE_INFINITY) {
      const taken = queue.filter((item) => item.seq < before)
      queue = queue.filter((item) => item.seq >= before)
      return taken.map((item) => item.n)
    },
    wait() {
      if (queue.length > 0) return Promise.resolve()
      return new Promise<void>((resolve) => {
        wake = resolve
      })
    },
    stamp: nextArrival,
  }
}

/**
 * Adapt one turn of `client.chat` to an `AgentStreamSource`. The control frames are the turn's boundary:
 * the stream ends at `done`, `interrupted` or `error` (the last two also raise a notice), and a failed
 * connection ends it with the reason as a notice. The framework has no interrupted state, so an
 * interrupted turn is also folded by the local reducer below, and `onInterrupted` gets that transcript
 * (the unfinished tools stay running next to the notice). `onEnd` runs once when the stream is finished or closed.
 *
 * A notice is placed by how many events the framework reducer holds at that moment, which this adapter
 * knows by folding the events it yields with the same reducer; text after a notice opens a new message.
 * Notices from the app arrive through `inbox` and are placed the same way, as soon as they are posted.
 */
export async function* controlStream(
  client: ControlClient,
  text: string,
  session: string,
  notice: (n: TurnNotice) => void,
  onEnd: () => void,
  inbox: TurnInbox = createTurnInbox(),
  onInterrupted?: (transcript: readonly TranscriptEntry[]) => void,
): AsyncGenerator<AgentStreamEvent> {
  let mirror = initialAgentStreamState
  let local = startTurn(INITIAL_VIEW, text)
  const emit = (event: AgentStreamEvent): AgentStreamEvent => {
    mirror = agentStreamReducer(mirror, event)
    return event
  }
  const raise = (n: TuiNotice): void => notice({ ...n, after: mirror.events.length })
  const iterator = client.chat(text, session)[Symbol.asyncIterator]()
  try {
    // Frames are pulled as soon as they come and ordered by the stamp the client took when the frame came off
    // the socket (the delivery boundary), not by when this loop resumes, so a notice posted later is placed after
    // every frame that had arrived by then, however late the stream resumes. A frame without a stamp gets one here.
    type Arrival =
      | { readonly seq: number; readonly result: IteratorResult<ControlFrame> }
      | { readonly seq: number; readonly error: unknown }
    const arrivals: Arrival[] = []
    let wakeFrames: (() => void) | undefined
    const arrive = (arrival: Arrival): void => {
      arrivals.push(arrival)
      wakeFrames?.()
      wakeFrames = undefined
    }
    void (async () => {
      try {
        for (;;) {
          const result = await iterator.next()
          arrive({ seq: (result.done === true ? undefined : result.value.arrivedAt) ?? inbox.stamp(), result })
          if (result.done === true) return
        }
      } catch (error) {
        arrive({ seq: inbox.stamp(), error })
      }
    })()
    for (;;) {
      if (arrivals.length === 0)
        await Promise.race([new Promise<void>((resolve) => (wakeFrames = resolve)), inbox.wait()])
      // A notice woke the loop: a frame stamped before it may still be on its way through the iterator's promises,
      // so let those settle before taking, or the notice would be placed ahead of a frame that arrived first.
      if (arrivals.length === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const arrival = arrivals[0]
      for (const n of inbox.take(arrival?.seq)) {
        local = addNotice(local, n.variant, n.text)
        raise(n)
        // An empty assistant message closes the open one, so later text starts a new message below the notice.
        yield emit({ type: 'assistant', message: '' })
      }
      if (arrival === undefined) continue
      arrivals.shift()
      if ('error' in arrival) throw arrival.error
      if (arrival.result.done === true) return
      const frame = arrival.result.value
      local = applyFrame(local, frame)
      if (frame.type === 'event') {
        const { event } = frame
        if (event.type === 'text_delta') {
          yield emit({ type: 'text-delta', text: String(event.content) })
        } else if (event.type === 'tool_call') {
          yield emit({
            type: 'tool_call',
            call_id: String(event.callId),
            name: String(event.toolName),
            status: 'running',
          })
        } else if (event.type === 'tool_result') {
          const id = `tool-${String(event.callId)}`
          // A result whose call is unknown draws nothing (the framework would make a card named `tool`).
          if (mirror.events.some((item) => item.kind === 'tool' && item.id === id)) {
            yield emit({
              type: 'tool_call',
              call_id: String(event.callId),
              status: event.isError === true ? 'error' : 'completed',
            })
          }
        } else if (event.type === 'error') {
          // An error event inside the turn does not end it, and the framework's `error` is terminal: a notice instead.
          raise({ variant: 'error', text: `the turn failed (${String(event.code)})` })
          yield emit({ type: 'assistant', message: '' })
        }
      } else if (frame.type === 'done') {
        return
      } else if (frame.type === 'interrupted') {
        raise({ variant: 'warning', text: 'interrupted' })
        // Notices posted after this frame arrived are still queued: they belong after the warning, in the frozen transcript too.
        for (const n of inbox.take()) {
          local = addNotice(local, n.variant, n.text)
          raise(n)
        }
        onInterrupted?.(local.transcript.slice(1))
        return
      } else if (frame.type === 'error') {
        raise({ variant: 'error', text: `the turn ended: ${frame.code}` })
        return
      }
    }
  } catch (error) {
    raise({ variant: 'error', text: error instanceof Error ? error.message : String(error) })
  } finally {
    for (const n of inbox.take()) raise(n)
    void iterator.return?.(undefined)?.catch?.(() => undefined)
    onEnd()
  }
}

/**
 * The local reducer, kept for an interrupted turn: the framework has no interrupted state (its reducer fails
 * the unfinished tools when the stream ends), so `controlStream` also folds the frames here and hands this
 * transcript over when the turn is interrupted. To be filed in usetheokit/theokit-tui.
 */
/** The owner sent `text`: it joins the transcript and a turn starts. */
export function startTurn(view: TuiView, text: string): TuiView {
  return { transcript: [...view.transcript, { kind: 'user', text }], running: true }
}

function appendText(
  transcript: readonly TranscriptEntry[],
  text: string,
): readonly TranscriptEntry[] {
  const last = transcript.at(-1)
  if (last?.kind === 'assistant')
    return [...transcript.slice(0, -1), { kind: 'assistant', text: last.text + text }]
  return [...transcript, { kind: 'assistant', text }]
}

function settleTool(
  transcript: readonly TranscriptEntry[],
  callId: string,
  failed: boolean,
): readonly TranscriptEntry[] {
  return transcript.map((entry) =>
    entry.kind === 'tool' && entry.callId === callId
      ? { ...entry, status: failed ? 'failed' : 'success' }
      : entry,
  )
}

/** Fold one event of the running turn into the transcript; text deltas append as they arrive. */
function applyEvent(
  view: TuiView,
  event: Extract<ControlFrame, { type: 'event' }>['event'],
): TuiView {
  switch (event.type) {
    case 'text_delta':
      return { ...view, transcript: appendText(view.transcript, String(event.content)) }
    case 'tool_call':
      return {
        ...view,
        transcript: [
          ...view.transcript,
          {
            kind: 'tool',
            callId: String(event.callId),
            name: String(event.toolName),
            status: 'running',
          },
        ],
      }
    case 'tool_result':
      return {
        ...view,
        transcript: settleTool(view.transcript, String(event.callId), event.isError === true),
      }
    case 'error':
      return {
        ...view,
        transcript: [
          ...view.transcript,
          { kind: 'notice', variant: 'error', text: `the turn failed (${String(event.code)})` },
        ],
      }
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
      return {
        transcript: [
          ...view.transcript,
          { kind: 'notice', variant: 'warning', text: 'interrupted' },
        ],
        running: false,
      }
    case 'error':
      return {
        transcript: [
          ...view.transcript,
          { kind: 'notice', variant: 'error', text: `the turn ended: ${frame.code}` },
        ],
        running: false,
      }
    default:
      return view
  }
}

/** A line for the owner that is not part of any turn: the view is otherwise unchanged. */
export function addNotice(view: TuiView, variant: 'warning' | 'error', text: string): TuiView {
  return { ...view, transcript: [...view.transcript, { kind: 'notice', variant, text }] }
}

/** The connection failed mid-turn: the turn ends with the reason. */
export function failTurn(view: TuiView, reason: string): TuiView {
  return {
    transcript: [...view.transcript, { kind: 'notice', variant: 'error', text: reason }],
    running: false,
  }
}
