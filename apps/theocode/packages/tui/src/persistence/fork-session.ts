export interface ForkResult {
  newId: string
  copied: boolean
  /** `false` when the fork was written but the live session was NOT moved onto it. */
  switched?: boolean
}

export interface ForkDeps {
  newId: () => string
  fork: (from: string, to: string) => ForkResult | Promise<ForkResult>
  current: () => string
  commit: (id: string) => void
  /**
   * Asked after the copy finishes. The fork is async, so the user may have started a turn, run
   * `/new` or resumed another session meanwhile; a late commit would then redirect their work.
   */
  shouldCommit?: () => boolean
}

export async function forkCurrentSessionWith(deps: ForkDeps): Promise<ForkResult> {
  const from = deps.current()
  const candidate = deps.newId()
  const out = await deps.fork(from, candidate)
  if (!out.copied) return { newId: from, copied: false }
  if (deps.current() !== from || deps.shouldCommit?.() === false) {
    return { newId: out.newId, copied: true, switched: false }
  }
  deps.commit(out.newId)
  return out
}
