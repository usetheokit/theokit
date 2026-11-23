import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs'
import { dirname } from 'node:path'

export interface TeeOutputOptions {
  readonly file: string
  /** Defaults to stdout and stderr of this process. */
  readonly streams?: readonly NodeJS.WriteStream[]
  /** The file is rotated before it would grow past this many bytes. */
  readonly maxBytes: number
  /** How many rotated files (`file.1` newest .. `file.<keep>`) are kept. */
  readonly keep: number
}

/** Mirror process output into a 0600 file, bounded by `maxBytes`, with `keep` older files. Returns a restore function. */
export function teeOutput(options: TeeOutputOptions): () => void {
  const { file, maxBytes, keep } = options
  if (!Number.isInteger(maxBytes) || maxBytes < 1)
    throw new RangeError('maxBytes must be a positive integer')
  if (!Number.isInteger(keep) || keep < 0)
    throw new RangeError('keep must be a non-negative integer')
  const streams = options.streams ?? [process.stdout, process.stderr]
  mkdirSync(dirname(file), { recursive: true })

  const open = (): number => {
    const fd = openSync(file, 'a', 0o600)
    chmodSync(file, 0o600)
    return fd
  }
  let fd = open()
  let size = 0
  try {
    size = fstatSync(fd).size
  } catch {
    size = 0
  }

  const rotate = (): void => {
    closeSync(fd)
    if (keep === 0) rmSync(file, { force: true })
    else {
      rmSync(`${file}.${keep}`, { force: true })
      for (let i = keep - 1; i >= 1; i--) {
        if (existsSync(`${file}.${i}`)) renameSync(`${file}.${i}`, `${file}.${i + 1}`)
      }
      renameSync(file, `${file}.1`)
    }
    fd = open()
    size = 0
  }

  const append = (chunk: Buffer): void => {
    let rest = chunk
    while (rest.length > 0) {
      if (size >= maxBytes) rotate()
      const room = maxBytes - size
      const part = rest.subarray(0, room)
      writeSync(fd, part)
      size += part.length
      rest = rest.subarray(part.length)
    }
  }

  const restores = streams.map((stream) => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- restored by assignment below
    const original = stream.write as (...a: unknown[]) => boolean
    stream.write = function (this: unknown, chunk: unknown, ...rest: unknown[]): boolean {
      try {
        const encoding = Buffer.isEncoding(rest[0] as string) ? (rest[0] as BufferEncoding) : 'utf8'
        append(
          typeof chunk === 'string'
            ? Buffer.from(chunk, encoding)
            : Buffer.from(chunk as Uint8Array),
        )
      } catch {
        // A full disk must not stop the process from writing to its real stream.
      }
      return original.call(stream, chunk, ...rest)
    }
    return () => {
      stream.write = original
    }
  })

  return () => {
    for (const restore of restores) restore()
    closeSync(fd)
  }
}
