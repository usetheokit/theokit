import { BadRequestException, PayloadTooLargeException } from '../exceptions/index.js'

export interface ReadCappedFormDataOptions {
  /** Hard cap on the raw body in bytes. Required: there is no safe default for uploads. */
  maxBytes: number
}

const FORM_TYPES = new Set(['multipart/form-data', 'application/x-www-form-urlencoded'])

/**
 * Read a multipart/form-data or application/x-www-form-urlencoded body, refusing it as soon as
 * more than `maxBytes` have arrived. A declared Content-Length over the cap is refused before
 * the first read.
 *
 * Throws PayloadTooLargeException (413) when the cap is passed.
 * Throws BadRequestException (400) when the content type is not a form type or the body does not parse.
 */
export async function readCappedFormData(
  request: Request,
  options: ReadCappedFormDataOptions,
): Promise<FormData> {
  const { maxBytes } = options
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new TypeError('readCappedFormData: maxBytes must be a non-negative finite number')
  }

  const contentType = request.headers.get('content-type') ?? ''
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (!FORM_TYPES.has(mime)) {
    throw new BadRequestException('Expected a multipart/form-data or form-urlencoded body')
  }

  const declared = request.headers.get('content-length')
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > maxBytes) {
    throw new PayloadTooLargeException(
      `Request body exceeds the limit of ${maxBytes} bytes (declared ${Number(declared)} bytes)`,
    )
  }

  if (request.body === null) {
    throw new BadRequestException('Request body is empty')
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        // Not awaited: some stream implementations never settle cancel() while a read is pending.
        void reader.cancel().catch(() => undefined)
        throw new PayloadTooLargeException(
          `Request body exceeds the limit of ${maxBytes} bytes (seen ${total} bytes)`,
        )
      }
      chunks.push(value)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // the lock may already be released by cancel()
    }
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return await new Response(bytes, { headers: { 'content-type': contentType } }).formData()
  } catch (cause) {
    throw new BadRequestException('Request body could not be parsed as form data', {
      cause: cause instanceof Error ? cause : undefined,
    })
  }
}
