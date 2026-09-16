import { TheokitAgentError } from '@theokit/agents'
import { readFileSync, statSync } from 'node:fs'
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
  let size: number
  try {
    size = statSync(path).size
  } catch {
    throw new ImageAttachError(`image not found: ${path}`, 'not_found')
  }
  if (size > MAX_IMAGE_BYTES) {
    throw new ImageAttachError(
      `image too large: ${path} is ${(size / 1024 / 1024).toFixed(1)} MiB (max ${MAX_IMAGE_BYTES / 1024 / 1024} MiB)`,
      'too_large',
    )
  }
  // B-051 — the read runs AFTER the stat succeeded and can still fail: EACCES on a file you may
  // stat but not read, EISDIR on a directory named like an image, EMFILE under a wide sweep. This
  // was the one path that left the declared ImageAttachError contract, so a caller catching the
  // typed error let it through untyped.
  try {
    return { data: readFileSync(path).toString('base64'), mimeType }
  } catch (err) {
    throw new ImageAttachError(
      `image unreadable: ${path} — ${(err as Error).message}`,
      'unreadable',
    )
  }
}
