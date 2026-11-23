import { join } from 'node:path'

import {
  planTranscriptGC,
  runTranscriptGC,
  startInProcessSweeper,
  type GCSession,
} from '@theokit/agents/session'

import type { Generations } from './generations.js'

/** The newest transcript always survives, whatever its age: the framework's floor. */
const KEEP_LAST = 1
const DAY_MS = 86_400_000

export interface TranscriptGCDeps {
  readonly workspace: string
  readonly generations: Generations
  /** Ids of agents the daemon holds open or has a turn in flight on; none for the command. */
  readonly heldIds?: () => readonly string[]
  readonly now?: () => number
}

export interface TranscriptSweep {
  readonly dryRun: boolean
  /** Ids removed, or that a dry run would remove. */
  readonly removed: readonly string[]
  /** Transcripts removed whose id could not be read, by path. */
  readonly orphaned: readonly string[]
  readonly errors: readonly string[]
}

const GENERATED = /^(?:theoclaw-)?(.*)-g(\d+)$/

/** Why a session id must stay, or undefined when it is a retired generation nobody holds. */
function protection(
  id: string,
  generations: Generations,
  held: ReadonlySet<string>,
): string | undefined {
  if (held.has(id)) return 'held by the running daemon'
  const match = GENERATED.exec(id)
  // An id this app did not generate cannot be tied to a chat: kept.
  if (match === null) return 'not a chat session id; identity unknown'
  if (Number(match[2]) >= generations.current(match[1]!)) return 'the chat is using it'
  return undefined
}

/**
 * One collection of chat transcripts older than `retentionDays`. A transcript is kept when its chat
 * is at that generation (or later), when the daemon holds its agent (a reset with a turn in flight),
 * when its id cannot be read or is not a chat id, and always for the newest one.
 */
export async function collectTranscripts(
  deps: TranscriptGCDeps,
  retentionDays: number,
  apply: boolean,
): Promise<TranscriptSweep> {
  const root = join(deps.workspace, '.theoclaw')
  const now = deps.now?.() ?? Date.now()
  // Asked by each transcript's real file, at planning and again when applying, against the daemon's
  // state as it is then. A transcript with no readable owner cannot be matched to a chat: kept.
  const isProtected = (session: GCSession): string | undefined =>
    session.id === undefined
      ? session.idReadable
        ? 'transcript is not stored under its own id (a fork or a renamed file); owner unknown'
        : 'transcript id unreadable'
      : protection(session.id, deps.generations, new Set(deps.heldIds?.() ?? []))
  const plan = await planTranscriptGC({
    cwd: deps.workspace,
    root,
    keepLast: KEEP_LAST,
    maxAgeDays: retentionDays,
    now,
    isProtected,
  })
  const result = await runTranscriptGC(plan, { apply, isProtected })
  return {
    dryRun: result.dryRun,
    removed: result.removed,
    orphaned: result.orphaned,
    errors: result.errors.map((error) => `${error.id ?? 'unknown'}: ${error.message}`),
  }
}

export interface TranscriptSweeper {
  stop(): Promise<void>
}

/** Collect at start and then every day; a sweep never overlaps the one before it. */
export function startTranscriptSweeper(
  deps: TranscriptGCDeps & {
    readonly retentionDays: number
    readonly write: (line: string) => void
  },
  intervalMs: number = DAY_MS,
): TranscriptSweeper {
  return startInProcessSweeper(intervalMs, async () => {
    try {
      const result = await collectTranscripts(deps, deps.retentionDays, true)
      if (result.removed.length + result.orphaned.length > 0)
        deps.write(
          `theoclaw: removed ${result.removed.length + result.orphaned.length} old chat transcripts`,
        )
      for (const error of result.errors) deps.write(`theoclaw: transcript collection: ${error}`)
    } catch (error: unknown) {
      deps.write(
        `theoclaw: transcript collection failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })
}
