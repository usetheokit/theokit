/**
 * Control-socket frames as a TUI stream source: the adapter a remote terminal needs between
 * `createControlClient` and `useAgentStream`. The event shape is structural (it matches
 * `AgentStreamEvent` of `@theokit/tui`), so this package takes no dependency on the TUI.
 */
import type { ControlClient } from './control-client.js'

/** One event of a turn in the vocabulary of `useAgentStream`. */
export interface ControlStreamEvent {
  type: string
  text?: string
  message?: string
  call_id?: string
  name?: string
  status?: string
  error?: string
}

/** A frame the converter reads: only the event frames carry anything it draws. */
export interface ControlStreamFrame {
  readonly type: string
  readonly event?: { readonly type: string; readonly [key: string]: unknown }
}

/**
 * A stateful converter from a turn's event frames to stream events. It remembers the tool calls it has
 * announced: a result whose call is unknown draws nothing. Frames that are not text or tool events give `undefined`.
 */
export function createControlFrameConverter(): (
  frame: ControlStreamFrame,
) => ControlStreamEvent | undefined {
  const calls = new Set<string>()
  return (frame) => {
    if (frame.type !== 'event' || frame.event === undefined) return undefined
    const { event } = frame
    if (event.type === 'text_delta') return { type: 'text-delta', text: String(event.content) }
    if (event.type === 'tool_call') {
      calls.add(String(event.callId))
      return {
        type: 'tool_call',
        call_id: String(event.callId),
        name: String(event.toolName),
        status: 'running',
      }
    }
    if (event.type === 'tool_result' && calls.has(String(event.callId))) {
      return {
        type: 'tool_call',
        call_id: String(event.callId),
        status: event.isError === true ? 'error' : 'completed',
      }
    }
    return undefined
  }
}

/** A stream source for one turn on one session, with the session's interrupt and steer. */
export interface ControlStreamSource {
  /** Opens the turn: `useAgentStream` calls this once when it mounts. */
  (): AsyncGenerator<ControlStreamEvent>
  /** Asks the instance to stop the session's running turn. */
  interrupt(): void
  /** Asks the instance to inject `message` into the session's running turn. */
  steer(message: string): void
}

/**
 * Sends `message` on `session` and returns the turn as a stream source. The stream ends at `done`; an
 * `interrupted` or `error` frame, or an error event inside the turn, ends it with a terminal `error` event, and a
 * failed connection rejects. Closing the iterator early stops reading the turn but does not interrupt it.
 */
export function createControlStreamSource(
  client: ControlClient,
  session: string,
  message: string,
): ControlStreamSource {
  async function* run(): AsyncGenerator<ControlStreamEvent> {
    const convert = createControlFrameConverter()
    for await (const frame of client.chat(message, session)) {
      const event = convert(frame)
      if (event !== undefined) {
        yield event
        continue
      }
      if (frame.type === 'done') return
      if (frame.type === 'interrupted') {
        yield { type: 'error', error: 'interrupted' }
        return
      }
      if (frame.type === 'error') {
        yield { type: 'error', error: `the turn ended: ${frame.code}` }
        return
      }
      if (frame.type === 'event' && frame.event.type === 'error') {
        yield { type: 'error', error: `the turn failed (${frame.event.code})` }
        return
      }
    }
  }
  const source = (): AsyncGenerator<ControlStreamEvent> => run()
  return Object.assign(source, {
    interrupt: (): void => {
      client.interrupt(session)
    },
    steer: (text: string): void => {
      client.steer(session, text)
    },
  })
}
