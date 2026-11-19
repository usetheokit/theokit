import type { AgentStreamEvent } from '@theokit/tui'

import type { ControlClient, ControlFrame } from '../control-client/control-client.js'

/** A line for the owner that is not text or a tool of the assistant: what TheoClaw adds at the frame level. */
export interface TuiNotice {
  readonly variant: 'warning' | 'error'
  readonly text: string
}

/** The longest session id the instance accepts (`^[A-Za-z0-9_-]{1,64}$`). */
const MAX_SESSION_LENGTH = 64

/** `/new`'s session: `<base>-<n>`, the base shortened so the whole id stays within 64 characters. */
export function nextSessionId(base: string, n: number): string {
  const suffix = `-${n}`
  return `${base.slice(0, MAX_SESSION_LENGTH - suffix.length)}${suffix}`
}

/** Translate the events of a turn that `@theokit/tui`'s `agentStreamReducer` folds; anything else draws nothing. */
function toStreamEvent(event: Extract<ControlFrame, { type: 'event' }>['event'], notice: (n: TuiNotice) => void): AgentStreamEvent | undefined {
  switch (event.type) {
    case 'text_delta':
      return { type: 'text-delta', text: String(event.content) }
    case 'tool_call':
      return { type: 'tool_call', call_id: String(event.callId), name: String(event.toolName), status: 'running' }
    case 'tool_result':
      return { type: 'tool_call', call_id: String(event.callId), status: event.isError === true ? 'error' : 'completed' }
    case 'error':
      // An error event inside the turn does not end it: the framework's `error` is terminal, so it stays a notice.
      notice({ variant: 'error', text: `the turn failed (${String(event.code)})` })
      return undefined
    default:
      return undefined
  }
}

/**
 * Adapt one turn of `client.chat` to an `AgentStreamSource`. The control frames are the turn's boundary:
 * the stream ends at `done`, `interrupted` or `error` (the last two also raise a notice), and a failed
 * connection ends it with the reason as a notice. `onEnd` runs once when the stream is finished or closed.
 */
export async function* controlStream(
  client: ControlClient,
  text: string,
  session: string,
  notice: (n: TuiNotice) => void,
  onEnd: () => void,
): AsyncGenerator<AgentStreamEvent> {
  try {
    for await (const frame of client.chat(text, session)) {
      if (frame.type === 'event') {
        const translated = toStreamEvent(frame.event, notice)
        if (translated !== undefined) yield translated
      } else if (frame.type === 'done') {
        return
      } else if (frame.type === 'interrupted') {
        notice({ variant: 'warning', text: 'interrupted' })
        return
      } else if (frame.type === 'error') {
        notice({ variant: 'error', text: `the turn ended: ${frame.code}` })
        return
      }
    }
  } catch (error) {
    notice({ variant: 'error', text: error instanceof Error ? error.message : String(error) })
  } finally {
    onEnd()
  }
}
