import { type AgentEvent, type AgentStreamEvent, agentStreamReducer, initialAgentStreamState } from '@theokit/tui'

import type { ControlClient } from '../control-client/control-client.js'

/** A line for the owner that is not text or a tool of the assistant: what TheoClaw adds at the frame level. */
export interface TuiNotice {
  readonly variant: 'warning' | 'error'
  readonly text: string
}

/** A notice raised inside a turn, placed after the first `after` events the framework had folded then. */
export interface TurnNotice extends TuiNotice {
  readonly after: number
}

/** A notice for a running turn; without `after` it sits wherever the turn has reached when it is first drawn. */
export interface PendingNotice extends TuiNotice {
  readonly after?: number
}

/** One row of a turn: a folded framework event, or a notice at the place it was raised. */
export type TurnEntry =
  | { readonly kind: 'event'; readonly event: AgentEvent }
  | ({ readonly kind: 'notice' } & TuiNotice)

/** Interleave a turn's folded events with the notices raised inside it, keeping the order they happened in. */
export function turnEntries(events: readonly AgentEvent[], notices: readonly TurnNotice[]): readonly TurnEntry[] {
  const entries: TurnEntry[] = []
  const pushNotices = (match: (n: TurnNotice) => boolean): void => {
    for (const n of notices) if (match(n)) entries.push({ kind: 'notice', variant: n.variant, text: n.text })
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

/**
 * Adapt one turn of `client.chat` to an `AgentStreamSource`. The control frames are the turn's boundary:
 * the stream ends at `done`, `interrupted` or `error` (the last two also raise a notice), and a failed
 * connection ends it with the reason as a notice. The framework has no interrupted state, so an
 * interrupted turn ends like a finished one (its unfinished tools fold as failed) and the notice says why.
 * `onEnd` runs once when the stream is finished or closed.
 *
 * A notice is placed by how many events the framework reducer holds at that moment, which this adapter
 * knows by folding the events it yields with the same reducer; text after a notice opens a new message.
 */
export async function* controlStream(
  client: ControlClient,
  text: string,
  session: string,
  notice: (n: TurnNotice) => void,
  onEnd: () => void,
): AsyncGenerator<AgentStreamEvent> {
  let mirror = initialAgentStreamState
  const emit = (event: AgentStreamEvent): AgentStreamEvent => {
    mirror = agentStreamReducer(mirror, event)
    return event
  }
  const raise = (n: TuiNotice): void => notice({ ...n, after: mirror.events.length })
  try {
    for await (const frame of client.chat(text, session)) {
      if (frame.type === 'event') {
        const { event } = frame
        if (event.type === 'text_delta') {
          yield emit({ type: 'text-delta', text: String(event.content) })
        } else if (event.type === 'tool_call') {
          yield emit({ type: 'tool_call', call_id: String(event.callId), name: String(event.toolName), status: 'running' })
        } else if (event.type === 'tool_result') {
          const id = `tool-${String(event.callId)}`
          // A result whose call is unknown draws nothing (the framework would make a card named `tool`).
          if (mirror.events.some((item) => item.kind === 'tool' && item.id === id)) {
            yield emit({ type: 'tool_call', call_id: String(event.callId), status: event.isError === true ? 'error' : 'completed' })
          }
        } else if (event.type === 'error') {
          // An error event inside the turn does not end it, and the framework's `error` is terminal: a notice instead.
          raise({ variant: 'error', text: `the turn failed (${String(event.code)})` })
          // An empty assistant message closes the open one, so later text starts a new message below the notice.
          yield emit({ type: 'assistant', message: '' })
        }
      } else if (frame.type === 'done') {
        return
      } else if (frame.type === 'interrupted') {
        raise({ variant: 'warning', text: 'interrupted' })
        return
      } else if (frame.type === 'error') {
        raise({ variant: 'error', text: `the turn ended: ${frame.code}` })
        return
      }
    }
  } catch (error) {
    raise({ variant: 'error', text: error instanceof Error ? error.message : String(error) })
  } finally {
    onEnd()
  }
}
