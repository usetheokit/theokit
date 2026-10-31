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
