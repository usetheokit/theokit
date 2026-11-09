import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

interface TeeStream {
  write: (chunk: never, ...rest: never[]) => boolean
}

/**
 * B-718: where there is no systemd user unit (the container, the foreground), `theoclaw logs` reads
 * `THEOCLAW_LOG_FILE`, so the process appends what it writes to that file. Installed before the
 * output mask wraps the streams, so what reaches the file is already masked; `logs` masks again
 * on read. A file that cannot be written stops the mirror once and never the process.
 */
export function teeToLogFile(env: NodeJS.ProcessEnv, streams: readonly TeeStream[]): void {
  const file = env.THEOCLAW_LOG_FILE?.trim()
  if (file === undefined || file === '') return
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  } catch {
    return
  }
  let working = true
  for (const stream of streams) {
    const original = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean
    ;(stream as { write: unknown }).write = (chunk: unknown, ...rest: unknown[]): boolean => {
      if (working) {
        try {
          appendFileSync(file, typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array), { mode: 0o600 })
        } catch {
          working = false
        }
      }
      return original(chunk, ...rest)
    }
  }
}
