import { randomUUID } from 'node:crypto'

import { sessionHasWriter, transcriptPath, transcriptRoot } from '@theokit/agents/persistence'

function forkIdForBusySession(original: string): string {
  return `${original}-fork-${randomUUID().slice(0, 8)}`
}

export async function consumeWithForkIfBusy(
  initialSessionId: string,
  open: (sessionId: string) => AsyncIterable<unknown>,
  consume: (chunk: unknown) => void,
  warning: (line: string) => void,
): Promise<string> {
  const first = await consumeDetectingContention(open(initialSessionId), consume)
  if (!first.contended) return initialSessionId

  const newId = forkIdForBusySession(initialSessionId)
  warning(
    `[exec] session ${initialSessionId} is being written by another process — forking to ${newId}\n`,
  )
  const second = await consumeDetectingContention(open(newId), consume, { emit: true })
  if (second.contended) {
    throw new Error(`[exec] the forked session ${newId} is busy too`)
  }
  return newId
}

interface PassResult {
  contended: boolean
}

const STRUCTURAL = new Set(['start', 'start-step', 'finish', 'finish-step'])

async function consumeDetectingContention(
  stream: AsyncIterable<unknown>,
  consume: (chunk: unknown) => void,
  opts: { emit?: boolean } = {},
): Promise<PassResult> {
  const held: unknown[] = []
  let released = false
  let contended = false

  for await (const chunk of stream) {
    if (isSessionContention(chunk)) {
      contended = true
      continue
    }
    if (released) {
      consume(chunk)
      continue
    }
    if (opts.emit !== true && isStructural(chunk)) {
      held.push(chunk)
      continue
    }
    released = true
    for (const r of held) consume(r)
    held.length = 0
    consume(chunk)
  }

  if (!contended) {
    for (const r of held) consume(r)
  }
  return { contended }
}

function isStructural(chunk: unknown): boolean {
  if (typeof chunk !== 'object' || chunk === null) return false
  const kind = (chunk as { type?: unknown }).type
  return typeof kind === 'string' && STRUCTURAL.has(kind)
}

function isSessionContention(chunk: unknown): boolean {
  if (typeof chunk !== 'object' || chunk === null) return false
  const c = chunk as { type?: unknown; errorCode?: unknown }
  return c.type === 'error' && c.errorCode === 'session_busy'
}

export function availableIdOrFork(sessionId: string, cwd: string): string {
  const target = transcriptPath(transcriptRoot(), cwd, sessionId)
  return sessionHasWriter(target) ? forkIdForBusySession(sessionId) : sessionId
}
