let submissions = 0

/**
 * Called synchronously whenever the user submits input, before any async work a turn does. A fork
 * still copying the transcript then knows the session was used and must not be adopted.
 */
export function noteSessionActivity(): void {
  submissions += 1
}

/** `stale`: the copy finished but the session had moved on, so it was not adopted. */
export interface ForkResult {
  newId: string
  copied: boolean
  stale?: boolean
}

export interface ForkDeps {
  newId: () => string
  fork: (
    from: string,
    to: string,
  ) => { newId: string; copied: boolean } | Promise<{ newId: string; copied: boolean }>
  current: () => string
  commit: (id: string) => void
}

export async function forkCurrentSessionWith(deps: ForkDeps): Promise<ForkResult> {
  const candidate = deps.newId()
  const from = deps.current()
  const seen = submissions
  const out = await deps.fork(from, candidate)
  if (!out.copied) return { newId: deps.current(), copied: false }
  // The session may have moved, or a new turn started on it, while the copy was pending: adopting
  // the copy would repoint the user away from where they are, or drop that turn from the transcript.
  if (deps.current() !== from || submissions !== seen) {
    return { newId: deps.current(), copied: false, stale: true }
  }
  deps.commit(out.newId)
  return out
}
