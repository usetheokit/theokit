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
  /**
   * Changes whenever the session is used or replaced in a way a pending copy would miss (a new turn
   * starts). Compared before and after the copy; omitted means only the session id is compared.
   */
  epoch?: () => number
}

export async function forkCurrentSessionWith(deps: ForkDeps): Promise<ForkResult> {
  const candidate = deps.newId()
  const from = deps.current()
  const epoch = deps.epoch?.()
  const out = await deps.fork(from, candidate)
  if (!out.copied) return { newId: deps.current(), copied: false }
  // The session may have moved, or a new turn started on it, while the copy was pending: adopting
  // the copy would repoint the user away from where they are, or drop that turn from the transcript.
  if (deps.current() !== from || deps.epoch?.() !== epoch) {
    return { newId: deps.current(), copied: false, stale: true }
  }
  deps.commit(out.newId)
  return out
}
