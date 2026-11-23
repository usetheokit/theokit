import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  loadOrCreateSessionId as loadFrameworkSessionId,
  persistSessionId as persistFrameworkSessionId,
  sessionPointerPath,
} from '@theokit/agents/session'

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
  cwd: string,
  id: string,
  report?: (message: string) => void,
  root?: string,
): Promise<void> {
  return fireAndForget(
    writeSessionId(cwd, id, root),
    'the session pointer',
    ...(report === undefined ? [] : ([report] as const)),
  )
}

/**
 * The raw write. Private: it rejects, and the whole point of B-031 is that no export does.
 *
 * The framework's `persistSessionId` reports `{ persisted }` instead of throwing; it is turned back
 * into a rejection HERE so `fireAndForget` reports it through the diagnostic sink. Writes to one
 * pointer stay serialised through `enqueue`, which the framework does not do.
 */
function writeSessionId(cwd: string, id: string, root?: string): Promise<void> {
  const file = sessionPointerPath(cwd, ...(root === undefined ? [] : ([root] as const)))
  return enqueue(file, async () => {
    const { persisted } = await persistFrameworkSessionId(
      cwd,
      id,
      ...(root === undefined ? [] : ([root] as const)),
    )
    if (!persisted) throw new Error(`the write to ${file} failed`)
  })
}

/** The pointer this app wrote before it moved to the framework's `last-session` (#2754). */
function legacyPointerPath(cwd: string): string {
  return join(cwd, '.theokit', 'tui-session')
}

function readLegacyId(cwd: string): string | undefined {
  try {
    const id = readFileSync(legacyPointerPath(cwd), 'utf8').trim()
    return id === '' ? undefined : id
  } catch {
    return undefined
  }
}

/**
 * The session to resume for `cwd`, or a fresh one. The framework pointer wins; the old
 * `<cwd>/.theokit/tui-session` is read only when the framework has none, and its id is then written
 * to the new pointer so later launches never need the old file. A fresh id is persisted too.
 */
export function loadOrCreateSessionId(
  cwd: string,
  generate: () => string,
  root?: string,
): { readonly sessionId: string; readonly resumed: boolean } {
  const rootArg = root === undefined ? [] : ([root] as const)
  const found = loadFrameworkSessionId(cwd, generate, ...rootArg)
  if (found.resumed) return found
  const legacy = readLegacyId(cwd)
  const sessionId = legacy ?? found.sessionId
  void persistSessionId(cwd, sessionId, undefined, root)
  return { sessionId, resumed: legacy !== undefined }
}
