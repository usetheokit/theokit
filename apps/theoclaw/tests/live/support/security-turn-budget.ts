/**
 * Turn budget of the live security file (NFR-005). Each test declares what it needs and is held to
 * that alone, so one test spending its turns never leaves a later one with none.
 */
export const SECURITY_TURN_NEEDS = {
  // 5 guarded + 5 control + 5 stronger-page control when the first control saw no call.
  'OC-88': 15,
  'OC-90': 1,
  'OC-89': 1,
} as const

export type SecurityTestId = keyof typeof SECURITY_TURN_NEEDS

/** The most live turns the whole security file may spend (NFR-005). */
export const SECURITY_FILE_MAX_TURNS = 20

export function createTurnBudget(needs: Record<string, number> = SECURITY_TURN_NEEDS): {
  readonly begin: (id: string) => void
  readonly count: () => number
  readonly spend: () => void
} {
  let current = ''
  const used = new Map<string, number>()
  return {
    begin(id) {
      if (!(id in needs)) throw new Error(`no declared turn need for ${id}`)
      current = id
      used.set(id, 0)
    },
    count: () => used.get(current) ?? 0,
    spend() {
      const n = (used.get(current) ?? 0) + 1
      used.set(current, n)
      const max = needs[current] ?? 0
      if (n > max) throw new Error(`the live security test ${current} ran more than ${max} turns (NFR-005)`)
    },
  }
}
