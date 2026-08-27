/**
 * Node `IncomingMessage` / `ServerResponse` stubs for tests that drive the controller dispatcher.
 *
 * Extracted because two test files had grown near-identical copies, and Sonar was right to call it
 * duplication rather than coincidence: they are the same object with the same contract, and a change
 * to one — the `Readable` requirement below is exactly such a change — has to reach both or one of
 * them silently stops exercising the code it names.
 */
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** What a recording response captured: the status line and every byte handed to it. */
export interface RecordedResponse {
  res: ServerResponse
  /** Bytes as written, never decoded — a test about binary must not round-trip through a string. */
  chunks: Buffer[]
  status: () => number
}

/**
 * A `ServerResponse` that records rather than sends.
 *
 * `destroy` is present because the dispatcher calls it on a mid-stream failure; a stub without it
 * turns a handled error into an unhandled rejection that reads as an unrelated test failure.
 */
export function recordingResponse(): RecordedResponse {
  const chunks: Buffer[] = []
  let status = 0
  const res = Object.assign(new Readable({ read() {} }), {
    writeHead(code: number) {
      status = code
      return res
    },
    setHeader: () => res,
    write(chunk?: unknown) {
      if (chunk !== undefined) chunks.push(Buffer.from(chunk as Uint8Array))
      return true
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) chunks.push(Buffer.from(chunk as Uint8Array))
      return res
    },
    destroy: () => res,
  }) as unknown as ServerResponse
  return { res, chunks, status: () => status }
}

/**
 * An `IncomingMessage` carrying `body`.
 *
 * A real `Readable`, not an `EventEmitter`: `incomingMessageToWebRequest` calls `Readable.toWeb`,
 * which rejects anything else with a `TypeError` before the code under test is reached. A stub that
 * cannot get that far measures nothing, which is how the first version of one of these passed.
 */
export function nodeRequest(opts: {
  method?: string
  url: string
  headers?: Record<string, string>
  body?: string
}): IncomingMessage {
  const body = opts.body ?? '{}'
  return Object.assign(Readable.from([Buffer.from(body)]), {
    method: opts.method ?? 'POST',
    url: opts.url,
    headers: { host: 'localhost:3000', 'content-type': 'application/json', ...opts.headers },
  }) as unknown as IncomingMessage
}
