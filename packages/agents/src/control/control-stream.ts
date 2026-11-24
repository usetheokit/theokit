/**
 * Adapts one turn of a control client's frames to the stream a TUI folds (`AgentStreamSource` of
 * `@theokit/tui`, matched structurally: this package takes no dependency on the TUI).
 */

/** A line for the user that is not the assistant's text or a tool: what a surface adds around the turn. */
export interface ControlStreamNotice {
  readonly variant: 'warning' | 'error'
  readonly text: string
}

/** The events the source yields; each is a member of the TUI's `AgentStreamEvent`. */
export type ControlStreamEvent =
  | { readonly type: 'text-delta'; readonly text: string }
  | {
      readonly type: 'tool_call'
      readonly call_id: string
      readonly name?: string
      readonly status: 'running' | 'completed' | 'error'
    }
  | { readonly type: 'notice'; readonly variant: 'warning' | 'error'; readonly text: string }
  | { readonly type: 'interrupted' }

/** The part of a control frame the adapter reads; `arrivedAt` is the stamp a client puts on a frame as it comes off the socket. */
export interface ControlStreamFrame {
  readonly type: string
  readonly event?: { readonly type: string }
  readonly code?: string
  readonly arrivedAt?: number
}

/** The part of a control client the adapter uses (`createControlClient`'s result fits it). */
export interface ControlStreamClient {
  chat(message: string, session: string): AsyncIterable<ControlStreamFrame>
  interrupt(session: string): void
  steer(session: string, message: string): void
}

/** Notices the surface raises while a turn runs; the stream places each where the turn has reached when it takes it. */
export interface ControlStreamInbox {
  /** The queued notices that arrived before `before` (a stamp from `stamp`), oldest first; the rest stay queued. */
  take(before?: number): ControlStreamNotice[]
  /** Resolves once a notice is queued. */
  wait(): Promise<void>
  /** A stamp on the clock the frames' `arrivedAt` uses, for a frame that has none. */
  stamp(): number
}

let defaultClock = 0

/**
 * A `ControlStreamInbox` a surface posts notices to. Pass the same `stamp` the control client uses, so
 * notices and frames share one arrival clock; without one it counts on its own.
 */
export function createControlStreamInbox(options?: { readonly stamp?: () => number }): ControlStreamInbox & {
  post(notice: ControlStreamNotice): void
} {
  const stamp = options?.stamp ?? ((): number => ++defaultClock)
  let queue: { notice: ControlStreamNotice; at: number }[] = []
  let wake: (() => void) | undefined
  return {
    post(notice) {
      queue.push({ notice, at: stamp() })
      const w = wake
      wake = undefined
      w?.()
    },
    take(before = Number.POSITIVE_INFINITY) {
      const taken = queue.filter((item) => item.at < before)
      queue = queue.filter((item) => item.at >= before)
      return taken.map((item) => item.notice)
    },
    wait() {
      if (queue.length > 0) return Promise.resolve()
      return new Promise<void>((resolve) => {
        wake = resolve
      })
    },
    stamp,
  }
}

export interface ControlStreamOptions {
  /** Notices from the surface, placed in the stream by arrival order. Without one, the stream has only its own notices. */
  readonly inbox?: ControlStreamInbox
  /** Notices still queued when the stream ends (or posted after `interrupted`, where the fold has ended). */
  readonly onNotice?: (notice: ControlStreamNotice) => void
  /** Runs once when the stream is finished or closed. */
  readonly onEnd?: () => void
}

/** A stream source for the TUI, bound to one session: calling it opens the turn. */
export interface ControlStreamSource {
  (): AsyncGenerator<ControlStreamEvent>
  /** Stops the session's running turn; a closed connection has none, so it is quiet. */
  interrupt(): void
  /** Injects `message` into the session's running turn; quiet once the connection is gone. */
  steer(message: string): void
}

function quiet(work: () => void): void {
  try {
    work()
  } catch {
    // A closed connection has no turn to stop or steer.
  }
}

/**
 * The source of one turn: `message` sent on `session` when the source is first consumed, so the turn is
 * opened exactly once. The stream ends at `done`, `interrupted` or `error` (the last raises a notice), and
 * a failed connection ends it with the reason as a notice. `interrupted` is the TUI's own event.
 *
 * Frames are ordered against the inbox's notices by the stamp the client took when each came off the socket,
 * not by when the stream resumes, so a notice posted later is placed after every frame that had arrived by then.
 */
export function createControlStreamSource(
  client: ControlStreamClient,
  session: string,
  message: string,
  options: ControlStreamOptions = {},
): ControlStreamSource {
  let clock = 0
  const inbox: ControlStreamInbox = options.inbox ?? {
    take: () => [],
    wait: () => new Promise<void>(() => undefined),
    stamp: () => ++clock,
  }
  const asEvent = (n: ControlStreamNotice): ControlStreamEvent => ({
    type: 'notice',
    variant: n.variant,
    text: n.text,
  })

  async function* stream(): AsyncGenerator<ControlStreamEvent> {
    // The calls opened: a result whose call is unknown draws nothing.
    const calls = new Set<string>()
    const iterator = client.chat(message, session)[Symbol.asyncIterator]()
    try {
      type Arrival =
        | { readonly seq: number; readonly result: IteratorResult<ControlStreamFrame> }
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
            arrive({
              seq: (result.done === true ? undefined : result.value.arrivedAt) ?? inbox.stamp(),
              result,
            })
            if (result.done === true) return
          }
        } catch (error) {
          arrive({ seq: inbox.stamp(), error })
        }
      })()
      for (;;) {
        if (arrivals.length === 0)
          await Promise.race([new Promise<void>((resolve) => (wakeFrames = resolve)), inbox.wait()])
        // A notice woke the loop: a frame stamped before it may still be on its way through the iterator's
        // promises, so let those settle before taking, or the notice would be placed ahead of it.
        if (arrivals.length === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0))
        const arrival = arrivals.at(0)
        for (const n of inbox.take(arrival?.seq)) yield asEvent(n)
        if (arrival === undefined) continue
        arrivals.shift()
        if ('error' in arrival) throw arrival.error
        if (arrival.result.done === true) return
        const frame = arrival.result.value
        if (frame.type === 'event') {
          const event = (frame.event ?? { type: '' }) as Record<string, unknown> & { type: string }
          if (event.type === 'text_delta') {
            yield { type: 'text-delta', text: String(event.content) }
          } else if (event.type === 'tool_call') {
            calls.add(String(event.callId))
            yield {
              type: 'tool_call',
              call_id: String(event.callId),
              name: String(event.toolName),
              status: 'running',
            }
          } else if (event.type === 'tool_result') {
            if (calls.has(String(event.callId))) {
              yield {
                type: 'tool_call',
                call_id: String(event.callId),
                status: event.isError === true ? 'error' : 'completed',
              }
            }
          } else if (event.type === 'error') {
            // An error event inside the turn does not end it, and the TUI's `error` is terminal: a notice instead.
            yield asEvent({ variant: 'error', text: `the turn failed (${String(event.code)})` })
          }
        } else if (frame.type === 'done') {
          return
        } else if (frame.type === 'interrupted') {
          yield { type: 'interrupted' }
          return
        } else if (frame.type === 'error') {
          yield asEvent({ variant: 'error', text: `the turn ended: ${String(frame.code)}` })
          return
        }
      }
    } catch (error) {
      yield asEvent({
        variant: 'error',
        text: error instanceof Error ? error.message : String(error),
      })
    } finally {
      for (const n of inbox.take()) options.onNotice?.(n)
      void Promise.resolve(iterator.return?.(undefined)).catch(() => undefined)
      options.onEnd?.()
    }
  }

  const source = (): AsyncGenerator<ControlStreamEvent> => stream()
  return Object.assign(source, {
    interrupt: () => {
      quiet(() => {
        client.interrupt(session)
      })
    },
    steer: (text: string) => {
      quiet(() => {
        client.steer(session, text)
      })
    },
  })
}
