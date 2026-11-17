import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { legacyTranscriptPath } from '@theokit/agents/persistence'

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

/** The session ids `sessions gc` must keep: every registry id given, plus the TUI pointer's. */
export function liveSessionIds(cwd: string, registryIds: readonly string[] = []): string[] {
  const pointer = readPointerId(cwd)
  return pointer === undefined ? [...registryIds] : [...registryIds, pointer]
}

/**
 * The `protectedIds` provider `theocode sessions gc` hands to the framework's `planTranscriptGC` and
 * `runTranscriptGC`: the TUI pointer, plus every non-archived registry session in `registryIds`.
 *
 * The framework derives protection from its own pointer convention and cannot see
 * `<cwd>/.theokit/tui-session` (#1905), so the pointer is passed in until it moves there. A read
 * error from `readPointerId` propagates on purpose: the framework turns a throwing provider into
 * `GCProtectionUnavailableError` and refuses the run.
 */
export function gcProtectedIds(
  cwd: string,
  registryIds: readonly string[] = [],
): () => ReadonlyMap<string, string> {
  return () => {
    const out = new Map<string, string>()
    for (const id of registryIds) out.set(id, 'registered session')
    const pointer = readPointerId(cwd)
    if (pointer !== undefined) out.set(pointer, 'TUI live-session pointer')
    return out
  }
}

interface PlanLike {
  readonly cwd: string
  readonly root: string
  readonly candidates: readonly { readonly id: string | undefined; readonly transcript: string }[]
  readonly kept: readonly { readonly id: string | undefined; readonly reason: string }[]
}

/**
 * Move out of `candidates` every transcript NAMED after a live session id, and every one whose id is
 * unreadable.
 *
 * The framework maps a protected id to the current (hashed) transcript path only. 4.x named the file
 * after the id itself and an upgraded machine has both side by side, so a live session's legacy
 * `<id>.jsonl` would be collectable. Withholding the extra name is the safe direction: a name that
 * matches nothing keeps a file, a name that is missing deletes one, and there is no undo.
 */
export function withholdLegacyNamed<P extends PlanLike>(plan: P, liveIds: readonly string[]): P {
  // The SDK's own id -> legacy path map: it sanitises the id (`a.b` is filed as `a-b.jsonl`), so a
  // stem comparison against the raw id would miss exactly those sessions.
  const legacy = new Set(liveIds.map((id) => legacyTranscriptPath(plan.root, plan.cwd, id)))
  // #106 — a transcript whose id could not be read is kept too: "I could not read this" is not
  // "this belongs to nobody", and the framework collects it as an unnameable orphan.
  const held = plan.candidates.filter((c) => c.id === undefined || legacy.has(c.transcript))
  if (held.length === 0) return plan
  return {
    ...plan,
    candidates: plan.candidates.filter((c) => !held.includes(c)),
    kept: [
      ...plan.kept,
      ...held.map((c) => ({
        id: c.id,
        reason:
          c.id === undefined
            ? 'session id unreadable — not shown to belong to nobody'
            : 'legacy-named transcript of a live session',
      })),
    ],
  }
}
