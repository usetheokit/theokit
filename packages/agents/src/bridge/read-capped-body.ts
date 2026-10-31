/** The largest request body the bridge's HTTP surfaces read: 1 MiB, far above any chat or tool request. */
export const MAX_REQUEST_BODY_BYTES = 1_048_576

/** A request body that grew past the cap while it was being read. */
export class BodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`request body exceeds ${maxBytes} bytes`)
    this.name = 'BodyTooLargeError'
  }
}

function concatenate(chunks: readonly Uint8Array[], total: number): Uint8Array<ArrayBuffer> {
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

/**
 * Read the whole body, stopping as soon as it passes `maxBytes`, whether or not the request
 * declared a `content-length` (a chunked body declares none, and a declared one can understate).
 * Past the cap the reader is cancelled and `BodyTooLargeError` is thrown. The bytes are kept as
 * they came, so a signature over the raw body is computed over exactly what the client sent.
 */
export async function readCappedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (request.body === null) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new BodyTooLargeError(maxBytes)
    }
    chunks.push(value)
  }
  return concatenate(chunks, total)
}

/** A capped JSON body: its value, or why it was refused. */
export type CappedJson =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false
      readonly reason: 'too_large' | 'not_json' | 'unreadable'
      readonly message: string
    }

/**
 * The body read through `readCappedBody` and parsed as JSON. Three refusals, so each route answers
 * them in its own envelope: past the cap, not JSON, and a body that could not be read at all (the
 * client went away or sent a broken stream), which is not a JSON error.
 */
export async function readCappedJson(request: Request, maxBytes: number): Promise<CappedJson> {
  let bytes: Uint8Array
  try {
    bytes = await readCappedBody(request, maxBytes)
  } catch (error) {
    if (error instanceof BodyTooLargeError)
      return { ok: false, reason: 'too_large', message: error.message }
    return { ok: false, reason: 'unreadable', message: 'the request body could not be read' }
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown }
  } catch {
    // A SyntaxError is the only thing `JSON.parse` throws on a string; its text adds nothing.
    return { ok: false, reason: 'not_json', message: 'the request body is not JSON' }
  }
}
