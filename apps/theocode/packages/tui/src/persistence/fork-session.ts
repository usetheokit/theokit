export interface ForkDeps {
  newId: () => string
  fork: (
    from: string,
    to: string,
  ) => { newId: string; copied: boolean } | Promise<{ newId: string; copied: boolean }>
  current: () => string
  commit: (id: string) => void
}

export async function forkCurrentSessionWith(
  deps: ForkDeps,
): Promise<{ newId: string; copied: boolean }> {
  const candidate = deps.newId()
  const from = deps.current()
  const out = await deps.fork(from, candidate)
  // The session may have moved while the copy was pending: adopting it would repoint the user
  // away from where they now are.
  if (!out.copied || deps.current() !== from) return { newId: deps.current(), copied: false }
  deps.commit(out.newId)
  return out
}
