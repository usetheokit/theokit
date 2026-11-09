import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
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

const MAX_FACT_LENGTH = 500

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
  return [...new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1))]
}

/**
 * Append-only files under one directory shared by every surface: `turns.jsonl` (what was said, in
 * any session) and `facts.jsonl` (what a reviewer decided to keep). Sharing the directory is what
 * lets a session from one surface find another's.
 */
export class MemoryStore {
  readonly #turns: string
  readonly #facts: string

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.#turns = join(dir, 'turns.jsonl')
    this.#facts = join(dir, 'facts.jsonl')
  }

  appendTurn(turn: StoredTurn): void {
    appendFileSync(this.#turns, `${JSON.stringify(turn)}\n`)
  }

  /** Turns of every surface that mention the query's words, best match first, newest first on a tie. */
  search(query: string, limit = 5): SessionHit[] {
    const wanted = terms(query)
    if (wanted.length === 0) return []
    const hits: SessionHit[] = []
    for (const turn of readLines<StoredTurn>(this.#turns)) {
      const have = new Set(terms(`${turn.user} ${turn.assistant}`))
      const score = wanted.filter((word) => have.has(word)).length
      if (score > 0) hits.push({ ...turn, score })
    }
    return hits.sort((a, b) => b.score - a.score || b.at.localeCompare(a.at)).slice(0, limit)
  }

  /** Keeps a fact once; returns false for an empty fact or one already kept. */
  saveFact(fact: string): boolean {
    const clean = fact.trim().slice(0, MAX_FACT_LENGTH)
    if (clean === '' || this.facts().includes(clean)) return false
    appendFileSync(this.#facts, `${JSON.stringify({ fact: clean })}\n`)
    return true
  }

  facts(): string[] {
    return readLines<{ fact: string }>(this.#facts).map((row) => row.fact)
  }

  /** The system-prompt section a new session opens with; empty when nothing is kept. */
  recallSection(): string {
    const facts = this.facts()
    return facts.length === 0 ? '' : `## Remembered facts\n\n${facts.map((fact) => `- ${fact}`).join('\n')}`
  }
}
