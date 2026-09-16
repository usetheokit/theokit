export function latestUsage<M, U>(
  thread: readonly M[],
  readFrom: (m: M) => U | undefined,
): U | undefined {
  for (let i = thread.length - 1; i >= 0; i--) {
    const u = readFrom(thread[i]!)
    if (u !== undefined) return u
  }
  return undefined
}
