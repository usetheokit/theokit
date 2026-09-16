import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The live-session pointer: `<cwd>/.theokit/tui-session` holds the id of the session a running TUI
 * is writing to.
 *
 * B-003/B-016 — this path and its read posture used to be re-derived at four call sites with three
 * different error postures, and the two on the deletion path were the ones that got it wrong. The
 * pointer file is TheoCode's own concept (the SDK owns `transcriptRoot`/`transcriptPath`/
 * `encodeProjectDir`), so it is correctly ours to own — it was simply owned four times.
 */
export function pointerPath(cwd: string): string {
  return join(cwd, '.theokit', 'tui-session')
}

/**
 * Read the id of the live session for `cwd`, or `undefined` when there is none.
 *
 * Fail-fast on anything other than "the file is not there". What this function returns is a deletion
 * decision: `undefined` tells the caller no session is live, so swallowing an EACCES/EIO removes the
 * live session from the protected set without a trace. Refusing to GC is the safe direction — the
 * cost is a run that does not collect, against a run that deletes a transcript being written.
 *
 * `readFn` is injected so the refusal path is testable without provoking a real permissions error.
 */
export function readPointerId(
  cwd: string,
  readFn: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): string | undefined {
  let raw: string
  try {
    raw = readFn(pointerPath(cwd))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(
      `cannot read the live-session pointer at ${pointerPath(cwd)} — refusing to GC (would risk ` +
        `the live session): ${(err as Error).message}`,
      // The message already carries the text; `cause` carries the STACK and the errno object. This
      // error is raised to refuse a deletion, and whoever reads it needs to know which syscall on
      // which path failed — interpolating `.message` answers what, and only the cause answers where.
      { cause: err },
    )
  }
  const id = raw.trim()
  return id === '' ? undefined : id
}
