import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** One finished turn, kept with the surface it came from (OC-56, Hermes row 3). */
export interface StoredTurn {
  /** The platform or surface: `webchat`, `telegram`, `tui`, `desktop`... */
  readonly surface: string
  readonly sessionKey: string
  readonly user: string
  readonly assistant: string
  readonly at: string
}

export interface SessionHit extends StoredTurn {
  readonly score: number
}

/** The scope of facts the owner told, from any surface; also what the /control agent recalls. */
export const OWNER_SCOPE = 'owner'

/** A file's parsed rows, re-read only when its size changed (another process may have appended). */
class FileRows<T> {
  #size = -1
  #rows: T[] = []
  constructor(
    private readonly file: string,
    private readonly parse: (row: unknown) => T | undefined,
  ) {}

  rows(): readonly T[] {
    const size = existsSync(this.file) ? statSync(this.file).size : 0
    if (size !== this.#size) {
      this.#rows = readLines<unknown>(this.file).flatMap((row) => {
        const parsed = this.parse(row)
        return parsed === undefined ? [] : [parsed]
      })
      this.#size = size
    }
    return this.#rows
  }
}

function readLines<T>(file: string): T[] {
  if (!existsSync(file)) return []
  const out: T[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      out.push(JSON.parse(line) as T)
    } catch {
      // A torn last line (a crash mid-append) is skipped, never fatal.
    }
  }
  return out
}

function terms(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length > 1),
    ),
  ]
}

/**
 * An append-only `turns.jsonl` (what was said, in any session) under one directory shared by every
 * surface, which lets a session from one surface find another's. Facts live in the SDK's memory.
 */
export class MemoryStore {
  readonly #turnsFile: string
  readonly #turns: FileRows<{ turn: StoredTurn; words: Set<string> }>

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.#turnsFile = join(dir, 'turns.jsonl')
    this.#turns = new FileRows(this.#turnsFile, (row) => {
      const turn = row as StoredTurn
      return typeof turn.user === 'string' && typeof turn.assistant === 'string' ? { turn, words: new Set(terms(`${turn.user} ${turn.assistant}`)) } : undefined
    })
  }

  appendTurn(turn: StoredTurn): void {
    appendFileSync(this.#turnsFile, `${JSON.stringify(turn)}\n`)
  }

  /** Turns of every surface that mention the query's words, best match first, newest first on a tie. */
  search(query: string, limit = 5): SessionHit[] {
    const wanted = terms(query)
    if (wanted.length === 0) return []
    const hits: SessionHit[] = []
    for (const { turn, words } of this.#turns.rows()) {
      const score = wanted.filter((word) => words.has(word)).length
      if (score > 0) hits.push({ ...turn, score })
    }
    return hits.sort((a, b) => b.score - a.score || b.at.localeCompare(a.at)).slice(0, limit)
  }
}
