/**
 * Control-socket frames as a TUI stream source: the adapter a remote terminal needs between
 * `createControlClient` and `useAgentStream`. The event shape is structural (it matches
 * `AgentStreamEvent` of `@theokit/tui`), so this package takes no dependency on the TUI.
 */
/** One event of a turn in the vocabulary of `useAgentStream`. */
export interface ControlStreamEvent {
  type: string
  text?: string
  message?: string
  call_id?: string
  name?: string
  status?: string
  error?: string
  variant?: 'warning' | 'error'
}

/** A frame the converter reads: only the event frames carry anything it draws. */
export interface ControlStreamFrame {
  readonly type: string
  readonly event?: { readonly type: string; readonly [key: string]: unknown }
  readonly code?: string
  /** A `notice` frame (added by a `frames` transform) carries a line for the owner. */
  readonly variant?: 'warning' | 'error'
  readonly text?: string
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

/** The part of a control client the adapter uses; its frames may carry more than the framework's (a stamp, say). */
export interface ControlStreamClient<F extends ControlStreamFrame = ControlStreamFrame> {
  chat(message: string, session: string): AsyncIterable<F>
  interrupt(session: string): void
  steer(session: string, message: string): void
}

export interface ControlStreamSourceOptions<F extends ControlStreamFrame = ControlStreamFrame> {
  /**
   * Wraps the turn's frames before they are read: a caller reorders them, drops some, or adds its own. A frame of
   * type `notice` (with `variant` and `text`) becomes a notice event at that place in the stream. The transform runs lazily,
   * one frame at a time, as the stream is read, and its `return` runs when the stream is closed.
   */
  frames?: (frames: AsyncIterable<F>) => AsyncIterable<ControlStreamFrame>
}

/**
 * Sends `message` on `session` and returns the turn as a stream source. The stream ends at `done`; an
 * `interrupted` frame ends it with an `interrupted` event, an `error` frame with an error notice, an error event
 * inside the turn raises an error notice and the turn goes on, and a failed connection rejects. Closing the iterator early stops reading the turn but does not interrupt it.
 */
export function createControlStreamSource<F extends ControlStreamFrame = ControlStreamFrame>(
  client: ControlStreamClient<F>,
  session: string,
  message: string,
  options: ControlStreamSourceOptions<F> = {},
): ControlStreamSource {
  async function* run(): AsyncGenerator<ControlStreamEvent> {
    const convert = createControlFrameConverter()
    const turn = client.chat(message, session)
    for await (const frame of options.frames === undefined ? turn : options.frames(turn)) {
      const event = convert(frame)
      if (event !== undefined) {
        yield event
        continue
      }
      if (frame.type === 'notice') {
        yield { type: 'notice', variant: frame.variant ?? 'warning', text: frame.text ?? '' }
        continue
      }
      if (frame.type === 'done') return
      if (frame.type === 'interrupted') {
        yield { type: 'interrupted' }
        return
      }
      if (frame.type === 'error') {
        yield { type: 'notice', variant: 'error', text: `the turn ended: ${String(frame.code)}` }
        return
      }
      if (frame.type === 'event' && frame.event?.type === 'error') {
        // An error event inside the turn does not end it, and the framework's `error` is terminal: a notice instead.
        yield {
          type: 'notice',
          variant: 'error',
          text: `the turn failed (${String(frame.event.code)})`,
        }
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
