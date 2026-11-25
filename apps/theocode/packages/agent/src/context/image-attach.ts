import { TheokitAgentError } from '@theokit/agents'
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { extname } from 'node:path'

export interface AttachedImage {
  data: string
  mimeType: string
}

export class ImageAttachError extends TheokitAgentError {
  override readonly name = 'ImageAttachError'

  constructor(
    message: string,
    readonly code: 'not_found' | 'too_large' | 'unsupported_type' | 'unreadable',
  ) {
    super(message)
  }
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

export function readImageAttachment(path: string): AttachedImage {
  const mimeType = MIME_BY_EXT[extname(path).toLowerCase()]
  if (mimeType === undefined) {
    throw new ImageAttachError(
      `not an image: ${path} (supported: ${Object.keys(MIME_BY_EXT).join(', ')})`,
      'unsupported_type',
    )
  }
  // One descriptor: fstat refuses an oversized file before any byte is read, and the read itself is
  // bounded at cap + 1 so a file that grows after fstat still cannot allocate past the limit.
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch (err) {
    throw readFailure(path, err)
  }
  try {
    const size = fstatSync(fd).size
    if (size > MAX_IMAGE_BYTES) throw tooLarge(path, size)
    const buf = Buffer.alloc(MAX_IMAGE_BYTES + 1)
    let total = 0
    for (;;) {
      const n = readSync(fd, buf, total, buf.length - total, null)
      if (n === 0) break
      total += n
      if (total > MAX_IMAGE_BYTES) throw tooLarge(path, total)
    }
    return { data: buf.subarray(0, total).toString('base64'), mimeType }
  } catch (err) {
    if (err instanceof ImageAttachError) throw err
    throw readFailure(path, err)
  } finally {
    closeSync(fd)
  }
}

function tooLarge(path: string, size: number): ImageAttachError {
  return new ImageAttachError(
    `image too large: ${path} is ${(size / 1024 / 1024).toFixed(1)} MiB (max ${MAX_IMAGE_BYTES / 1024 / 1024} MiB)`,
    'too_large',
  )
}

// ENOENT is the only "not found"; EACCES, EISDIR, EMFILE and the rest are unreadable.
function readFailure(path: string, err: unknown): ImageAttachError {
  if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
    return new ImageAttachError(`image not found: ${path}`, 'not_found')
  }
  return new ImageAttachError(`image unreadable: ${path} — ${(err as Error).message}`, 'unreadable')
}
