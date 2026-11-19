import { maskSecrets } from '../channels/channel-loop.js'
import { createStreamMask } from '../channels/stream-mask.js'
import type { TurnEvent } from './turn.js'

/** Where one turn's events go, masked; `flush` releases the text still held as a `text_delta`. */
export interface EventMask {
  readonly emit: (event: TurnEvent) => void
  readonly flush: () => void
}

/**
 * Every string in `value`, nested objects and arrays included, masked; the shape is kept. Walked,
 * not round-tripped through JSON, so the escaping of what a client receives does not change.
 */
function maskValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') return maskSecrets(value, secrets)
  if (Array.isArray(value)) return value.map((item) => maskValue(item, secrets))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskValue(item, secrets)]))
  }
  return value
}

/**
 * One turn's event mask (B-398 FR-007): a `text_delta` goes through a stream mask, which holds back
 * what could still grow into a configured value; any other event first releases what is held, as
 * a `text_delta` of its own, so the client keeps the model's order (EC-2), and is then emitted with
 * every string in it masked. A value split across a tool event is two releases, each masked alone.
 */
export function createEventMask(secrets: readonly string[], emit: (event: TurnEvent) => void): EventMask {
  const stream = createStreamMask(secrets)
  const flush = (): void => {
    const held = stream.flush()
    if (held !== '') emit({ type: 'text_delta', content: held })
  }
  return {
    emit: (event) => {
      if (event.type === 'text_delta' && typeof event.content === 'string') {
        const released = stream.push(event.content)
        if (released !== '') emit({ ...event, content: released })
        return
      }
      flush()
      emit(maskValue(event, secrets) as TurnEvent)
    },
    flush,
  }
}
