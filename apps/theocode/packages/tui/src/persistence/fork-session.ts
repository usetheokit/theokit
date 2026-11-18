export interface ForkResult {
  newId: string
  copied: boolean
  /** `false` when the copy was made but the live session changed meanwhile, so it was not adopted. */
  switched?: boolean
}

export interface ForkDeps {
  newId: () => string
  fork: (from: string, to: string) => Promise<{ newId: string; copied: boolean }>
  current: () => string
  commit: (id: string) => void
  /** Extra veto checked after the fork finishes (e.g. a turn started meanwhile). */
  shouldCommit?: () => boolean
}

export async function forkCurrentSessionWith(deps: ForkDeps): Promise<ForkResult> {
  const from = deps.current()
  const out = await deps.fork(from, deps.newId())
  if (!out.copied) return { newId: deps.current(), copied: false }
  // The fork is async: if the user moved to another session, or a turn began, adopting the copy
  // would replace the live session with a stale one.
  if (deps.current() !== from || deps.shouldCommit?.() === false) {
    return { newId: out.newId, copied: true, switched: false }
  }
  deps.commit(out.newId)
  return out
}
