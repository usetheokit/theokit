import { randomUUID } from 'node:crypto'

import type { WireChunk as UIMessageChunk } from '@theokit/presenter/wire'
import { WIRE_ERROR_CODE_PART } from '@theokit/presenter/wire'
import { TheokitAgentError } from '@theokit/sdk/errors'
import { sessionHasWriter, transcriptPath, transcriptRoot } from '@theokit/sdk/persistence'

const SESSION_BUSY = 'session_busy'
const STRUCTURAL = new Set(['start', 'start-step', 'finish', 'finish-step'])

export interface ForkIfBusyOptions {
  /** Called once when the first attempt hit session_busy. */
  readonly onFork?: (from: string, to: string) => void
  /** Default: `${id}-fork-${randomUUID().slice(0, 8)}`. */
  readonly forkId?: (id: string) => string
  /**
   * Checked before the first attempt; default:
   * `sessionHasWriter(transcriptPath(transcriptRoot(), process.cwd(), id))`.
   */
  readonly isBusy?: (id: string) => boolean
}

/** The fork id was busy too: one retry is the whole policy. */
export class ForkedSessionBusyError extends TheokitAgentError {
  override readonly name = 'ForkedSessionBusyError'
  constructor(
    readonly fromId: string,
    readonly toId: string,
  ) {
    super(`Session "${fromId}" is busy and its fork "${toId}" is busy too; not retrying again.`, {
      code: 'session_busy_after_fork',
      isRetryable: false,
    })
  }
}

function isBusyCodePart(chunk: UIMessageChunk): boolean {
  if (chunk.type !== WIRE_ERROR_CODE_PART) return false
  const data = (chunk as { data?: unknown }).data
  return typeof data === 'object' && data !== null && (data as { code?: unknown }).code === SESSION_BUSY
}

/**
 * Run one turn; if the session is busy (another process is writing it), run the turn once on a fork
 * id instead. Structural chunks are held until the first content chunk so a contended first attempt
 * emits nothing. Contention is the `data-error-code {code:'session_busy'}` part followed by an
 * `error` chunk. A busy signal after content was already emitted cannot be retracted and is passed
 * through. `sessionId` settles once the stream finishes (or fails); consume `chunks` first.
 */
export function streamTurnForkingIfBusy(
  sessionId: string,
  open: (sessionId: string) => AsyncIterable<UIMessageChunk>,
  options: ForkIfBusyOptions = {},
): { readonly chunks: AsyncIterable<UIMessageChunk>; readonly sessionId: Promise<string> } {
  const isBusy =
    options.isBusy ??
    ((id: string) => sessionHasWriter(transcriptPath(transcriptRoot(), process.cwd(), id)))
  const forkId = options.forkId ?? ((id: string) => `${id}-fork-${randomUUID().slice(0, 8)}`)

  let resolveId!: (id: string) => void
  let rejectId!: (e: unknown) => void
  const idPromise = new Promise<string>((resolve, reject) => {
    resolveId = resolve
    rejectId = reject
  })
  idPromise.catch(() => undefined)

  /** Yields the attempt's chunks; returns true when it ended in swallowed contention. */
  async function* attempt(id: string): AsyncGenerator<UIMessageChunk, boolean> {
    let released = false
    const held: UIMessageChunk[] = []
    let pending: UIMessageChunk | undefined
    for await (const chunk of open(id)) {
      if (pending !== undefined) {
        if (chunk.type === 'error') return true
        // Not contention after all: the held code part is ordinary content.
        released = true
        yield* held.splice(0)
        yield pending
        pending = undefined
      }
      if (released) {
        yield chunk
      } else if (STRUCTURAL.has(chunk.type)) {
        held.push(chunk)
      } else if (isBusyCodePart(chunk)) {
        pending = chunk
      } else {
        released = true
        yield* held.splice(0)
        yield chunk
      }
    }
    yield* held
    if (pending !== undefined) yield pending
    return false
  }

  async function* run(): AsyncGenerator<UIMessageChunk> {
    try {
      let id = sessionId
      const fork = (): void => {
        const to = forkId(id)
        options.onFork?.(id, to)
        id = to
      }
      const preflight = isBusy(id)
      if (preflight) fork()
      let busy = yield* attempt(id)
      if (busy && !preflight) {
        fork()
        busy = yield* attempt(id)
      }
      if (busy) throw new ForkedSessionBusyError(sessionId, id)
      resolveId(id)
    } catch (e) {
      rejectId(e)
      throw e
    } finally {
      rejectId(new Error('streamTurnForkingIfBusy: stream closed before the turn completed'))
    }
  }

  return { chunks: run(), sessionId: idPromise }
}
