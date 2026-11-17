export interface ForkDeps {
  newId: () => string
  fork: (from: string, to: string) => { newId: string; copied: boolean }
  current: () => string
  commit: (id: string) => void
}

export function forkCurrentSessionWith(deps: ForkDeps): { newId: string; copied: boolean } {
  const candidate = deps.newId()
  const out = deps.fork(deps.current(), candidate)
  if (!out.copied) return { newId: deps.current(), copied: false }
  deps.commit(out.newId)
  return out
}
