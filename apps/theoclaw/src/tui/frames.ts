import { type ControlStreamEvent, type ControlStreamSource, createControlStreamSource } from '@theokit/agents/control'
import type { AgentStreamEvent } from '@theokit/tui'

import { type ControlClient, type ControlFrame, nextArrival } from '../control-client/control-client.js'

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
 * One turn of `client.chat` as the framework's control stream source (`createControlStreamSource`), with its
 * `interrupt` and `steer` bound to the session. The control frames are the turn's boundary: the stream ends at
 * `done`, `interrupted` or `error` (the last also raises a notice), and a failed connection ends it with the
 * reason as a notice. `interrupted` is the framework's own event: it marks the unfinished tools cancelled and adds
 * its "Interrupted by user" notice. `onEnd` runs once when the stream is finished or closed.
 *
 * Notices raised inside the turn are `notice` events, so they sit in the stream's order; text after a
 * notice opens a new message. Notices from the app arrive through `inbox` and are placed the same way, as
 * soon as they are posted. The framework ends the fold at `interrupted`, so a notice posted after it
 * (and any left when the turn ends) goes to `notice`, which draws it below the turn.
 */
export function controlTurn(
  client: ControlClient,
  text: string,
  session: string,
  notice: (n: TuiNotice) => void,
  onEnd: () => void,
  inbox: TurnInbox = createTurnInbox(),
): ControlStreamSource {
  // The frames in the order they arrived against the app's notices, as the adapter's `frames` transform.
  async function* ordered(
    frames: AsyncIterable<ControlFrame>,
  ): AsyncGenerator<ControlFrame | { readonly type: 'notice'; readonly variant: 'warning' | 'error'; readonly text: string }> {
    const iterator = frames[Symbol.asyncIterator]()
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
        for (const n of inbox.take(arrival?.seq)) yield { type: 'notice', ...n }
        if (arrival === undefined) continue
        arrivals.shift()
        if ('error' in arrival) throw arrival.error
        if (arrival.result.done === true) return
        yield arrival.result.value
      }
    } finally {
      void iterator.return?.(undefined)?.catch?.(() => undefined)
    }
  }

  const inner = createControlStreamSource(client, session, text, { frames: ordered })
  async function* run(): AsyncGenerator<ControlStreamEvent> {
    try {
      yield* inner()
    } catch (error) {
      yield { type: 'notice', variant: 'error', text: error instanceof Error ? error.message : String(error) }
    } finally {
      for (const n of inbox.take()) notice(n)
      onEnd()
    }
  }
  return Object.assign(() => run(), { interrupt: inner.interrupt, steer: inner.steer })
}

/** `controlTurn` opened: the stream itself. */
export function controlStream(...args: Parameters<typeof controlTurn>): AsyncGenerator<AgentStreamEvent> {
  return controlTurn(...args)() as AsyncGenerator<ControlStreamEvent, void, undefined> as AsyncGenerator<AgentStreamEvent>
}
