import type { AgentStreamEvent } from '@theokit/tui'

import type { ControlClient, ControlFrame } from '../control-client/control-client.js'

/** The longest session id the instance accepts (`^[A-Za-z0-9_-]{1,64}$`). */
const MAX_SESSION_LENGTH = 64

/** `/new`'s session: `<base>-<n>`, the base shortened so the whole id stays within 64 characters. */
export function nextSessionId(base: string, n: number): string {
  const suffix = `-${n}`
  return `${base.slice(0, MAX_SESSION_LENGTH - suffix.length)}${suffix}`
}

/** When each connection's last turn is over: the client runs one chat at a time, so the next turn waits for it. */
const turnsOver = new WeakMap<ControlClient, Promise<void>>()

/**
 * Adapt one turn of `client.chat` to the `stream` that `AgentSession` runs. The control frames are the
 * turn's boundary: the stream ends at `done`, `interrupted` or `error` (the last raises a notice), and a
 * failed connection ends it with the reason as a notice. An error event inside the turn does not end it, so
 * it is a notice too (the framework's `error` is terminal). Aborting `signal` (Esc) sends the instance an
 * interrupt for `session`; the screen marks the turn interrupted and stops reading at once, so the stream
 * reads on to the turn's last frame (which frees the connection) and the next turn starts after it.
 */
export async function* controlStream(
  client: ControlClient,
  text: string,
  session: string,
  signal: AbortSignal,
): AsyncGenerator<AgentStreamEvent> {
  const previous = turnsOver.get(client)
  let over!: () => void
  turnsOver.set(client, new Promise<void>((resolve) => (over = resolve)))
  await previous
  const interrupt = (): void => client.interrupt(session)
  signal.addEventListener('abort', interrupt, { once: true })
  if (signal.aborted) interrupt()
  const known = new Set<string>()
  const iterator = client.chat(text, session)[Symbol.asyncIterator]()
  try {
    for (;;) {
      const result = await iterator.next()
      if (result.done === true) return
      const frame = result.value
      if (frame.type === 'event') {
        const { event } = frame
        if (event.type === 'text_delta') {
          yield { type: 'text-delta', text: String(event.content) }
        } else if (event.type === 'tool_call') {
          known.add(String(event.callId))
          yield {
            type: 'tool_call',
            call_id: String(event.callId),
            name: String(event.toolName),
            status: 'running',
          }
        } else if (event.type === 'tool_result') {
          // A result whose call is unknown draws nothing (the framework would make a card named `tool`).
          if (known.has(String(event.callId)))
            yield {
              type: 'tool_call',
              call_id: String(event.callId),
              status: event.isError === true ? 'error' : 'completed',
            }
        } else if (event.type === 'error') {
          yield { type: 'notice', variant: 'error', text: `the turn failed (${String(event.code)})` }
        }
      } else if (frame.type === 'done' || frame.type === 'interrupted') {
        return
      } else if (frame.type === 'error') {
        yield { type: 'notice', variant: 'error', text: `the turn ended: ${frame.code}` }
        return
      }
    }
  } catch (error) {
    yield {
      type: 'notice',
      variant: 'error',
      text: error instanceof Error ? error.message : String(error),
    }
  } finally {
    signal.removeEventListener('abort', interrupt)
    // The screen stopped reading after Esc: finish the turn here so the connection is free for the next one.
    if (signal.aborted) await drain(iterator)
    void iterator.return?.(undefined)?.catch?.(() => undefined)
    over()
  }
}

/** Read frames until the turn's last one (or the end of the stream); a failed connection ends it too. */
async function drain(iterator: AsyncIterator<ControlFrame>): Promise<void> {
  try {
    for (;;) {
      const result = await iterator.next()
      if (result.done === true) return
      const { type } = result.value
      if (type === 'done' || type === 'interrupted' || type === 'error') return
    }
  } catch {
    // The connection is gone: nothing is left to wait for.
  }
}
