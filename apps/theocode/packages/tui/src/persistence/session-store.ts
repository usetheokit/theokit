import { existsSync, readFileSync } from 'node:fs'

import { atomicWriteText } from '@theokit/agents/persistence'

import { enqueue } from '../terminal-io/index.js'
import { fireAndForget } from './fire-and-forget.js'

/**
 * B-031 — the guarantee lives HERE, so no caller can get it wrong.
 *
 * B-013 wrapped two call sites in `fireAndForget` and its own docstring said "the two persistence
 * calls". There were five: `/new`, `/clear`, `/fork`, the Esc interrupt and the backtrack confirm
 * all handed a bare `void` to a promise whose rejection is uncaught BY CONSTRUCTION — `enqueue`
 * attaches its catch to the tail it stores, not to the promise it returns — under `node >=22`,
 * where the default is `--unhandled-rejections=throw`.
 *
 * Wrapping the three that were missed would have left a sixth call site to be discovered later.
 * There is no longer an exported persist function that CAN reject: the raw write is private, and
 * what leaves this module already degrades and reports. Killing the session because a pointer could
 * not be written is disproportionate — the session still works, it just will not be resumable —
 * and swallowing it is Unbreakable Rule 8.
 */
export function persistSessionId(
  file: string,
  id: string,
  report?: (message: string) => void,
): Promise<void> {
  return fireAndForget(
    writeSessionId(file, id),
    'the session pointer',
    ...(report === undefined ? [] : ([report] as const)),
  )
}

/** The raw write. Private: it rejects, and the whole point of B-031 is that no export does. */
function writeSessionId(file: string, id: string): Promise<void> {
  return enqueue(file, () => atomicWriteText(file, id))
}

export function loadOrCreateSessionId(file: string, generate: () => string): string {
  if (existsSync(file)) {
    const stored = readFileSync(file, 'utf8').trim()
    if (stored) return stored
  }
  const id = generate()
  void persistSessionId(file, id)
  return id
}
