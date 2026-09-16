/**
 * B-077 — the facts a memory store holds.
 *
 * `countMemoryFacts` already parsed exactly this and returned only the length, so the facts were
 * one `.length` away from being readable and nobody could read them. This returns the list; the
 * count is derived from it, so the two cannot disagree about what a fact is.
 */
const FACT_LINE = /^\s*[-*] (.+)$/

/** The `## Facts` section's bullets, in file order. */
export function memoryFacts(memoryMd: string): string[] {
  const afterFacts = memoryMd.split('## Facts')[1]
  if (afterFacts === undefined) return []
  const nextHeading = afterFacts.search(/^#{1,6}\s/m)
  const section = nextHeading === -1 ? afterFacts : afterFacts.slice(0, nextHeading)
  return section
    .split('\n')
    .map((line) => FACT_LINE.exec(line)?.[1]?.trim())
    .filter((fact): fact is string => fact !== undefined && fact.length > 0)
}

/**
 * The store with fact `index` (1-based, as displayed) removed.
 *
 * Returns `undefined` when the index names no fact, so the caller reports "there is no fact 7"
 * rather than writing the file back unchanged and claiming success.
 */
export function withFactRemoved(memoryMd: string, index: number): string | undefined {
  const facts = memoryFacts(memoryMd)
  const target = facts[index - 1]
  if (target === undefined) return undefined
  let removed = false
  const kept = memoryMd.split('\n').filter((line) => {
    if (removed) return true
    const match = FACT_LINE.exec(line)?.[1]?.trim()
    if (match === target) {
      removed = true
      return false
    }
    return true
  })
  return kept.join('\n')
}
