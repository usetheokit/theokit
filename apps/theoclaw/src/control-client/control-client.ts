import { ControlConnectionError, createControlClient as openClient } from '@theokit/agents/control'

import type { TurnEvent } from '../control-plane/turn.js'

let arrivalClock = 0

/** The next stamp of the arrival clock, shared by frames and the TUI's notices so their order is true arrival order. */
export function nextArrival(): number {
  return ++arrivalClock
}

/** A frame the instance sends on `/control` for a session turn, stamped by the client when it came off the socket. */
export type ControlFrame = (
  | { readonly type: 'event'; readonly event: TurnEvent; readonly session: string }
  | { readonly type: 'done'; readonly session: string }
  | { readonly type: 'interrupted'; readonly session: string }
  | { readonly type: 'error'; readonly code: string; readonly session?: string }
  | { readonly type: 'interrupt_ok' | 'steer_ok' | 'no_turn'; readonly session: string }
) & { readonly arrivedAt?: number }

/** The connection to the instance failed or ended in a way a surface reports. Never carries the token. */
export class TheoClawControlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TheoClawControlError'
  }
}

export interface ControlClient {
  /** Send `message` on `session` and yield that turn's frames, ending with its final frame. */
  chat(message: string, session: string): AsyncIterable<ControlFrame>
  /** Ask the instance to stop the session's running turn. */
  interrupt(session: string): void
  /** Ask the instance to inject `message` into the session's running turn. */
  steer(session: string, message: string): void
  close(): Promise<void>
}

/** The framework's refusal as the app's error, which no message of ever carries the token. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof ControlConnectionError) throw new TheoClawControlError(error.message)
    throw error
  }
}

/**
 * The client both surfaces use (FR-007, plan D1): the framework's `createControlClient` on the
 * running instance's `/control` socket with the owner token. It builds no agent; a turn is the
 * instance's, on the named session. The app adds the arrival stamp of each frame, drops the answers
 * to an interrupt or steer sent for another turn, and keeps `interrupt` and `steer` quiet once the
 * connection is gone.
 */
export async function connectControlClient(options: { readonly url: string; readonly token: string }): Promise<ControlClient> {
  const client = await guarded(() => openClient({ url: options.url, authorization: `Bearer ${options.token}`, stamp: nextArrival, dropAcknowledgements: true }))
  return {
    async *chat(message, session) {
      const frames = client.chat(message, session)[Symbol.asyncIterator]()
      try {
        for (;;) {
          const next = await guarded(() => frames.next())
          if (next.done === true) return
          yield next.value as ControlFrame
        }
      } finally {
        await frames.return?.()
      }
    },
    interrupt: (session) => {
      try {
        client.interrupt(session)
      } catch {
        // A closed connection has no turn to stop.
      }
    },
    steer: (session, message) => {
      try {
        client.steer(session, message)
      } catch {
        // A closed connection has no turn to steer.
      }
    },
    close: () => client.close(),
  }
}
