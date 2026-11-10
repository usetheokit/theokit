import { TheoClawConfigError } from '../control-plane/errors.js'
import { createStreamMask } from './stream-mask.js'

/** The part of a writable stream the mask wraps: `process.stdout` and `process.stderr` both fit. */
export interface MaskableStream {
  write: NodeJS.WriteStream['write']
}

export interface OutputMask {
  /** Emit, masked, what is held back as a possible start of a credential. */
  flush(): void
  /** Flush, then put the original writers back. */
  uninstall(): void
}

type WriteCallback = (error?: Error | null) => void

const wrapped = new WeakSet<MaskableStream>()

/**
 * Bytes are carried as `latin1` text, one character per byte, so the string mask of the channel
 * loop works on exactly the bytes a stream emits, whatever encoding the caller wrote with
 * (`hex`, `base64`) and whether or not they are valid UTF-8.
 */
function asBytes(text: string): Buffer {
  return Buffer.from(text, 'latin1')
}

function toByteText(chunk: string | Uint8Array, encoding: BufferEncoding | undefined): string {
  if (typeof chunk === 'string') return Buffer.from(chunk, encoding ?? 'utf8').toString('latin1')
  return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('latin1')
}

/** Wrap one stream's `write`; `restore` puts it back only while this wrapper is still in place. */
function maskStream(stream: MaskableStream, secrets: readonly string[]): { flush(): void; restore(): void } {
  const original = stream.write
  const mask = createStreamMask(secrets)
  const emit = (masked: string, callback?: WriteCallback): boolean => original.call(stream, asBytes(masked), undefined, callback)
  // A write held back whole still has its callback called at once, before its bytes reach the
  // stream: the caller is told the write was taken, which it was. `stream.end(chunk)` does not go
  // through `write` and is not masked; nothing in the app ends stdout or stderr.
  const wrapper = ((
    chunk: unknown,
    encodingOrCallback?: BufferEncoding | WriteCallback,
    callback?: WriteCallback,
  ): boolean => {
    // Anything but text or bytes goes to the original writer untouched, which refuses it as Node
    // does (ERR_INVALID_ARG_TYPE) instead of being coerced here.
    if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) {
      return original.call(stream, chunk as string, encodingOrCallback as BufferEncoding, callback)
    }
    const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined
    const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback
    return emit(mask.push(toByteText(chunk, encoding)), done)
  }) as NodeJS.WriteStream['write']
  stream.write = wrapper
  wrapped.add(stream)
  let restored = false
  return {
    flush: () => {
      const rest = mask.flush()
      if (rest !== '') emit(rest)
    },
    restore: () => {
      if (restored) return
      restored = true
      if (stream.write === wrapper) {
        stream.write = original
        wrapped.delete(stream)
      }
    },
  }
}

/**
 * Route every write of `streams` through the exact-value mask for the life of the process (D9),
 * so the adapters' own failure lines carry no credential either. A value split across two writes
 * is held back until it can be told apart; `flush()` releases what is held.
 */
export function installOutputMask(
  secrets: readonly string[],
  streams: readonly MaskableStream[] = [process.stdout, process.stderr],
): OutputMask {
  const index = streams.findIndex(
    (stream, position) => wrapped.has(stream) || streams.indexOf(stream) !== position,
  )
  if (index !== -1) {
    throw new TheoClawConfigError(
      `the output mask is already installed on stream ${index} of ${streams.length}; uninstall it first`,
    )
  }
  const secretBytes = secrets
    .filter((secret) => secret.length > 0)
    .map((secret) => toByteText(secret, 'utf8'))
  const installed = streams.map((stream) => maskStream(stream, secretBytes))
  const flush = (): void => installed.forEach((entry) => entry.flush())
  return {
    flush,
    uninstall: () => {
      flush()
      installed.forEach((entry) => entry.restore())
    },
  }
}
