export const SENTINEL = -1 as const

export function stepBacktrack(current: number, userTurnCount: number): number | null {
  if (userTurnCount <= 0) return null
  if (current === SENTINEL) return userTurnCount - 1
  return Math.max(0, current - 1)
}
