import { readFileSync } from 'node:fs'

import { atomicWriteJson } from '@theokit/sdk/persistence'

import { TheoClawConfigError } from '../control-plane/errors.js'

/** What `sessions.json` holds: a counter per session key, never a message. */
interface SessionsFile {
  readonly version: 1
  readonly generations: Readonly<Record<string, number>>
}

function isGenerationMap(value: unknown): value is Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every((count) => Number.isInteger(count) && (count as number) >= 0)
}

function readSessionsFile(file: string): Map<string, number> {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return new Map()
    throw new TheoClawConfigError(`${file} cannot be read (${code ?? 'unknown error'})`, { variable: 'THEOCLAW_WORKSPACE' })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = undefined
  }
  const stored = parsed as Partial<SessionsFile> | undefined
  const generations = stored?.generations
  if (stored?.version !== 1 || !isGenerationMap(generations)) {
    throw new TheoClawConfigError(`${file} is not a sessions file TheoClaw wrote; move it aside to start every conversation afresh`, {
      variable: 'THEOCLAW_WORKSPACE',
    })
  }
  return new Map(Object.entries(generations))
}

/**
 * The generation of each session key: `/new` and `/reset` move a key to its next generation, and
 * the agent id embeds it, so a reset is a new agent id with an empty history (plan D3). An unseen
 * key is at generation 0. Loaded from `sessions.json`, the generations survive a restart; each
 * move rewrites the file through a temporary file and a rename, mode 0600, one write at a time.
 */
export class Generations {
  readonly #counts: Map<string, number>
  #writing: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly file?: string,
    counts: ReadonlyMap<string, number> = new Map(),
  ) {
    this.#counts = new Map(counts)
  }

  /**
   * The generations stored in `file`, or none when it does not exist. A file that is not one this
   * class wrote is refused with a `TheoClawConfigError` naming it, and left as it is.
   */
  static load(file: string): Generations {
    return new Generations(file, readSessionsFile(file))
  }

  current(key: string): number {
    return this.#counts.get(key) ?? 0
  }

  /**
   * Move `key` to its next generation, persist it, and return it. The move counts only once the
   * file holds it: a write that fails leaves the generation where it was, in memory and on disk.
   */
  next(key: string): Promise<number> {
    const moved = this.#writing.then(async () => {
      const generation = this.current(key) + 1
      if (this.file !== undefined) {
        const counts = { ...Object.fromEntries(this.#counts), [key]: generation }
        const data: SessionsFile = { version: 1, generations: counts }
        await atomicWriteJson(this.file, data, { mode: 0o600 })
      }
      this.#counts.set(key, generation)
      return generation
    })
    this.#writing = moved.catch(() => undefined)
    return moved
  }
}
