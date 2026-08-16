/* eslint-disable security/detect-non-literal-fs-filename --
 * Session lifecycle over the transcript root. Every path here is built from `transcriptRoot()` plus
 * a session id or an `encodeProjectDir` hash — never from HTTP input. The variable filename IS the
 * feature: a module whose job is listing and deleting sessions cannot address them by literal.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { atomicWriteText, transcriptRoot } from '@theokit/sdk/persistence'

import { ensureSecureDir } from '../hooks/secure-store.js'

import { projectDirFor } from './project-index.js'

/**
 * M71 — the resumable-session pointer: which session does `theokit agent` continue?
 *
 * ## The guarantee, and why it belongs here
 *
 * `atomicWriteText` is a pass-through the layer already publishes, and every caller that wanted a
 * session pointer had to compose the same three things around it: pick the path, write atomically,
 * and decide what to do when the write fails. The third is where they diverged — and a pointer that
 * REJECTS is the wrong shape for what it points at.
 *
 * Losing the pointer costs the user a `--continue`. Failing the run costs them the run. So these
 * functions never reject: {@link loadOrCreateSessionId} falls back to a fresh id, and
 * {@link persistSessionId} reports whether it persisted instead of throwing. The caller keeps
 * working with a session either way.
 *
 * That is a deliberate exception to fail-fast, and it is narrow: the failure is not swallowed, it is
 * RETURNED (`{ persisted: false }`). A caller that cares can surface it; one that does not still has
 * a usable session. Swallowing would be the anti-pattern — reporting is not.
 */

/** Name of the pointer file inside the project directory. */
const POINTER = 'last-session'

/** Where the pointer for `cwd` lives. */
export function sessionPointerPath(cwd: string, root: string = transcriptRoot()): string {
  return join(projectDirFor(cwd, root), POINTER)
}

/**
 * The session id to resume for `cwd`, or a freshly minted one when there is nothing to resume.
 *
 * Never rejects. A missing, empty or unreadable pointer all mean the same thing to the caller —
 * "start a new session" — and distinguishing them would only give the caller three ways to write
 * the same branch.
 *
 * @param mintId how to create an id when there is nothing to resume. Injected (DIP) so the caller
 * owns id shape and the tests are deterministic — a `crypto.randomUUID()` baked in here would make
 * every assertion about the fresh path unwritable.
 */
export function loadOrCreateSessionId(
  cwd: string,
  mintId: () => string,
  root: string = transcriptRoot(),
): { readonly sessionId: string; readonly resumed: boolean } {
  try {
    const existing = readFileSync(sessionPointerPath(cwd, root), 'utf8').trim()
    if (existing.length > 0) return { sessionId: existing, resumed: true }
  } catch {
    // No pointer, or unreadable — both mean "nothing to resume".
  }
  return { sessionId: mintId(), resumed: false }
}

/**
 * Point `cwd` at `sessionId`, atomically.
 *
 * Delegates to `atomicWriteText`, so a reader never observes a half-written pointer.
 *
 * The first draft reached for `atomicWriteTempTarget` instead, which was a misreading worth
 * recording: that function does not GENERATE a temp name, it RECOGNISES one and answers which final
 * file it belongs to. It is the collector's question ("is this scratch, and whose?"), not the
 * writer's. Its return type — `string | undefined` — is what said so, and the typechecker refused
 * the misuse before it could ship.
 *
 * Returns `{ persisted }` instead of throwing (see the module docblock). The failure is reported,
 * not hidden.
 *
 * ASYNC because `atomicWriteText` is. The first draft called it synchronously and returned
 * `{ persisted: true }` before the bytes landed — so the function reported a success that had not
 * happened yet, and a read immediately after found nothing. The tests caught it; a caller would
 * have caught it as an intermittently missing `--continue`.
 */
export async function persistSessionId(
  cwd: string,
  sessionId: string,
  root: string = transcriptRoot(),
): Promise<{ readonly persisted: boolean }> {
  const target = sessionPointerPath(cwd, root)
  try {
    // T2.4 — `ensureSecureDir`, not a bare recursive mkdir. This directory lives under the
    // transcript root, and `assertSecureModes` refuses a group- or world-writable parent because
    // that tree decides which commands may run. A bare mkdir takes the umask, so under `umask 002`
    // this code produced the very shape the store's own check rejects — and the helper additionally
    // repairs a directory another process already created loose, which a `mode:` argument cannot.
    ensureSecureDir(target)
    // Same upstream `.d.ts` gap as in `session-lifecycle.ts`: declared in the barrel, absent from
    // the module's declaration file, so the symbol arrives unresolved. It is a real async function
    // (measured), and awaiting it is what the first draft got wrong.
    await (atomicWriteText as (p: string, c: string) => Promise<unknown>)(target, `${sessionId}\n`)
    return { persisted: true }
  } catch {
    return { persisted: false }
  }
}
