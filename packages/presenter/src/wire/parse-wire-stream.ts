import { type WireChunk, wireChunkSchema } from './chunk-schema.js'

/**
 * SSE framing → validated `WireChunk`s. Replaces `ai`'s `parseJsonEventStream` + `uiMessageChunkSchema`.
 *
 * The contract it implements is [WHATWG HTML §9.2](https://html.spec.whatwg.org/multipage/server-sent-events.html),
 * not a TheoKit invention — which is what keeps a TheoKit server and an ai-sdk client mutually
 * intelligible after the dependency is gone (plan D1).
 */

/** The terminal frame every TheoKit stream ends with — see `ui-message-stream-response.ts:27`. */
const DONE_SENTINEL = '[DONE]'

/** Default ceiling for a single unterminated frame. Overridable; see the honesty note on Q5. */
const DEFAULT_MAX_FRAME_BYTES = 1_000_000

/** A failure the SERVER reported inside the stream (theokit#136) — never swallowed. */
export class WireStreamError extends Error {
  override readonly name = 'WireStreamError'
}

/** A frame that never terminated. Typed so a caller can tell it from a protocol error. */
export class WireFrameTooLargeError extends Error {
  override readonly name = 'WireFrameTooLargeError'
}

export interface ParseWireStreamOptions {
  readonly maxFrameBytes?: number
  /** Where discarded frames are reported. Defaults to a no-op: a library must not own the console. */
  readonly onWarn?: (message: string) => void
}

/**
 * Normalise CRLF and lone CR to LF **before** any split.
 *
 * Without this the parser is silently blind behind a proxy that rewrites terminators: the buffer
 * never closes an event, nothing is emitted, and the stream ends "cleanly" with zero messages.
 * Silence is the worst failure mode of the three (crash / error / silence), because nothing signals it.
 */
function normalizeEol(text: string): string {
  return text.replace(/\r\n|\r/g, '\n')
}

/** `data:` lines of one event, concatenated with `\n` per the SSE spec; other fields ignored. */
function joinDataLines(event: string): string {
  const out: string[] = []
  for (const line of event.split('\n')) {
    if (line.startsWith(':')) continue // comment (heartbeat)
    if (!line.startsWith('data:')) continue // `event:` / `id:` / `retry:` are not payload
    out.push(line.slice('data:'.length).replace(/^ /, ''))
  }
  return out.join('\n')
}

export function parseWireStream(
  bytes: ReadableStream<Uint8Array>,
  options: ParseWireStreamOptions = {},
): ReadableStream<WireChunk> {
  const maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES
  // Default sink: discard. A library must not own the host's console — the caller opts in.
  const warn = options.onWarn ?? ((): undefined => undefined)

  // `TextDecoderStream`'s writable side is typed `BufferSource` in lib.dom, which does not unify
  // with `Uint8Array` under `pipeThrough`'s invariant pair. The runtime contract is exact; only the
  // declaration is loose.
  const decoder = new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>
  const reader = bytes.pipeThrough(decoder).getReader()
  let buffer = ''

  /** Emit every complete event currently in the buffer. Returns how many chunks were enqueued. */
  const drain = (controller: ReadableStreamDefaultController<WireChunk>): number => {
    let emitted = 0
    let cut = buffer.indexOf('\n\n')
    while (cut !== -1) {
      const event = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      cut = buffer.indexOf('\n\n')

      const payload = joinDataLines(event)
      if (payload === '' || payload === DONE_SENTINEL) continue

      let raw: unknown
      try {
        raw = JSON.parse(payload)
      } catch {
        // A frame we cannot even read is dropped — it cannot be an instruction we must honour.
        warn(`wire: frame with invalid JSON discarded (${payload.slice(0, 60)})`)
        continue
      }

      // The error channel is exempt from leniency (plan D2 § exception). `type` is inspected BEFORE
      // schema validation, so a MALFORMED error frame is still recognised as an error instead of
      // falling into the discard path — otherwise a real 401/429 becomes silence (theokit#136
      // through a side door).
      //
      // It is ENQUEUED, not thrown. Throwing here errors the stream, and erroring a stream discards
      // whatever is already queued — the partial turn the user had already seen would vanish on the
      // way to an error message. The reader raises when it reaches this chunk, which keeps the
      // failure in sequence: text first, then the error.
      if (typeof raw === 'object' && raw !== null && (raw as { type?: unknown }).type === 'error') {
        const text = (raw as { errorText?: unknown }).errorText
        controller.enqueue({
          type: 'error',
          ...(typeof text === 'string' && text.length > 0 ? { errorText: text } : {}),
        })
        emitted += 1
        continue
      }

      const parsed = wireChunkSchema.safeParse(raw)
      if (parsed.success) {
        controller.enqueue(parsed.data)
        emitted += 1
      } else {
        warn(
          `wire: unknown or invalid variant discarded (${String((raw as { type?: unknown }).type)})`,
        )
      }
    }
    return emitted
  }

  return new ReadableStream<WireChunk>({
    /**
     * Loop until this pull produces at least one chunk or the source ends.
     *
     * A `pull` that returns having enqueued nothing is NOT reliably re-invoked by the controller,
     * so a frame that yields no chunk (the `[DONE]` sentinel, a comment, a discarded variant) would
     * hang the consumer on its next `read()`. Measured: the `[DONE]` test timed out at exactly this
     * point. Looping here makes progress a property of the parser, not of the scheduler.
     */
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          return
        }
        buffer += normalizeEol(value)
        if (buffer.length > maxFrameBytes) {
          throw new WireFrameTooLargeError(
            `wire: frame exceeded ${maxFrameBytes} bytes with no terminator; aborting instead of accumulating`,
          )
        }
        if (drain(controller) > 0) return
      }
    },
    async cancel(reason) {
      await reader.cancel(reason)
    },
  })
}
