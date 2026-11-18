export interface ForkDeps {
  newId: () => string
  fork: (from: string, to: string) => Promise<{ newId: string; copied: boolean }>
  current: () => string
  commit: (id: string) => void
}

export async function forkCurrentSessionWith(deps: ForkDeps): Promise<{ newId: string; copied: boolean }> {
  const candidate = deps.newId()
  const out = await deps.fork(deps.current(), candidate)
  if (!out.copied) return { newId: deps.current(), copied: false }
  deps.commit(out.newId)
  return out
}
