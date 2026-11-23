import { createCipheriv, createDecipheriv, randomBytes, type DecipherGCM } from 'node:crypto'
import { open, readFile } from 'node:fs/promises'

import { BackupError } from './errors.js'

/** Archive file: `TCBK`, version byte, mode byte, then (mode 1) a 12-byte IV, the body, a 16-byte GCM tag. */
const MAGIC = Buffer.from('TCBK')
const FORMAT_VERSION = 1
const MODE_PLAIN = 0
const MODE_GCM = 1
const HEADER_BYTES = MAGIC.length + 2
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

export interface SealOptions {
  readonly encrypted: boolean
  /** Base64 of the 32-byte key. Required when `encrypted` is true; never put in an error. */
  readonly key?: string
}

/** The key of an encrypted location; a missing or malformed key is a refusal, never plaintext. */
export function keyOf(options: SealOptions): Buffer | undefined {
  if (!options.encrypted) return undefined
  const key = typeof options.key === 'string' ? Buffer.from(options.key, 'base64') : undefined
  if (key?.length !== KEY_BYTES) {
    throw new BackupError('the storage location is encrypted but holds no valid key')
  }
  return key
}

function header(mode: number): Buffer {
  return Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION, mode])])
}

export function newKey(): string {
  return randomBytes(KEY_BYTES).toString('base64')
}

/** The bytes of an archive file for a stream of plain bytes. The header is authenticated as AAD. */
export async function* seal(
  plain: AsyncIterable<Buffer>,
  options: SealOptions,
): AsyncGenerator<Buffer> {
  const key = keyOf(options)
  if (key === undefined) {
    yield header(MODE_PLAIN)
    yield* plain
    return
  }
  const head = header(MODE_GCM)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(head)
  yield Buffer.concat([head, iv])
  for await (const chunk of plain) yield cipher.update(chunk)
  const rest = cipher.final()
  if (rest.length > 0) yield rest
  yield cipher.getAuthTag()
}

/**
 * The plain bytes of an archive file. Authentication of an encrypted archive completes at its end,
 * so the caller must drain the stream and treat everything as unverified until it finishes.
 */
export async function* openSealed(path: string, options: SealOptions): AsyncGenerator<Buffer> {
  const key = keyOf(options)
  const handle = await open(path, 'r').catch((cause: unknown) => {
    throw new BackupError(`cannot read archive ${path}`, { path, cause })
  })
  try {
    const { size } = await handle.stat()
    const head = Buffer.alloc(HEADER_BYTES)
    const read = await handle.read(head, 0, HEADER_BYTES, 0)
    if (read.bytesRead !== HEADER_BYTES || !head.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new BackupError(`${path} is not a backup archive`, { path })
    }
    if (head[MAGIC.length] !== FORMAT_VERSION) {
      throw new BackupError(`${path} has an unsupported archive version`, { path })
    }
    const wantMode = key === undefined ? MODE_PLAIN : MODE_GCM
    if (head[MAGIC.length + 1] !== wantMode) {
      throw new BackupError(`${path} does not match the encryption of its storage location`, {
        path,
      })
    }
    let start = HEADER_BYTES
    let end = size - 1
    let decipher: DecipherGCM | undefined
    if (key !== undefined) {
      if (size < HEADER_BYTES + IV_BYTES + TAG_BYTES) {
        throw new BackupError(`${path} is truncated`, { path })
      }
      const iv = Buffer.alloc(IV_BYTES)
      const tag = Buffer.alloc(TAG_BYTES)
      await handle.read(iv, 0, IV_BYTES, HEADER_BYTES)
      await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES)
      decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAAD(head)
      decipher.setAuthTag(tag)
      start = HEADER_BYTES + IV_BYTES
      end = size - TAG_BYTES - 1
    }
    if (end >= start) {
      const stream = handle.createReadStream({ start, end, autoClose: false })
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        yield decipher === undefined ? chunk : decipher.update(chunk)
      }
    }
    if (decipher !== undefined) {
      try {
        const rest = decipher.final()
        if (rest.length > 0) yield rest
      } catch (cause) {
        throw new BackupError(`${path} failed authentication: wrong key or damaged archive`, {
          path,
          cause,
        })
      }
    }
  } finally {
    await handle.close()
  }
}

const LEGACY_MAGIC = Buffer.from('TCBK1')

/**
 * The plain bytes of an archive written by an older TheoClaw (`.tcb`): the whole file is read and,
 * when encrypted, authenticated (`TCBK1`, IV, GCM tag, body) before any byte is returned.
 */
export async function openLegacy(path: string, options: SealOptions): Promise<Buffer> {
  const key = keyOf(options)
  const data = await readFile(path).catch((cause: unknown) => {
    throw new BackupError(`cannot read archive ${path}`, { path, cause })
  })
  if (key === undefined) {
    if (data.subarray(0, LEGACY_MAGIC.length).equals(LEGACY_MAGIC)) {
      throw new BackupError(`${path} does not match the encryption of its storage location`, {
        path,
      })
    }
    return data
  }
  const body = LEGACY_MAGIC.length + IV_BYTES + TAG_BYTES
  if (data.length < body || !data.subarray(0, LEGACY_MAGIC.length).equals(LEGACY_MAGIC)) {
    throw new BackupError(`${path} does not match the encryption of its storage location`, {
      path,
    })
  }
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      data.subarray(LEGACY_MAGIC.length, LEGACY_MAGIC.length + IV_BYTES),
    )
    decipher.setAuthTag(data.subarray(LEGACY_MAGIC.length + IV_BYTES, body))
    return Buffer.concat([decipher.update(data.subarray(body)), decipher.final()])
  } catch (cause) {
    throw new BackupError(`${path} failed authentication: wrong key or damaged archive`, {
      path,
      cause,
    })
  }
}
