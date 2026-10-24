import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The live prompt-caching test cannot fail on demand, so its wiring is pinned here, on its text
 * (B-523): a turn-2 cache miss has to name the upstream each turn was routed to, or a routing miss
 * reads exactly like a missing cache directive. Each check is anchored on a call shape, not on a
 * name alone, so an import or a comment does not satisfy it.
 */
const LIVE_FILE = join(__dirname, '../live/live-prompt-caching.test.ts')
const source = readFileSync(LIVE_FILE, 'utf8')

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

/** The body of the file's `afterAll(() => { ... })`, read by matching its braces. */
function afterAllBody(text: string): string {
  const head = 'afterAll(() => {'
  const start = text.indexOf(head)
  if (start === -1) throw new Error(`${LIVE_FILE} has no "${head}" block`)
  let depth = 1
  let index = start + head.length
  while (depth > 0 && index < text.length) {
    if (text[index] === '{') depth += 1
    if (text[index] === '}') depth -= 1
    index += 1
  }
  return text.substring(start + head.length, index - 1)
}

describe('the live prompt-caching test', () => {
  it('installs the recorder on the global fetch before the runner is built', () => {
    expect(source).toMatch(
      /import \{[^}]*\brecordRoutedProviders\b[^}]*\} from '\.\/routed-provider\.js'/,
    )
    const install = source.indexOf('recordRoutedProviders(globalThis)')
    expect(install).toBeGreaterThan(-1)
    expect(install).toBeLessThan(source.indexOf('.build()'))
  })

  it('restores the original fetch in afterAll', () => {
    expect(afterAllBody(source)).toContain('record.restore()')
  })

  it("takes each turn's upstream from upstreamOfTurn, once per turn", () => {
    expect(occurrences(source, 'upstreamOfTurn(')).toBe(2)
  })

  it('passes describeUpstreams as the turn-2 cache assertion message', () => {
    expect(source).toMatch(
      /expect\(turn2\.cacheReadTokens, *describeUpstreams\(turn1Upstream, turn2Upstream\)\)/,
    )
  })

  it('prints every upstream through upstreamLabel', () => {
    const printed = occurrences(source, 'upstream=')
    expect(printed).toBeGreaterThanOrEqual(2)
    expect(occurrences(source, 'upstream=${upstreamLabel(')).toBe(printed)
  })

  it('keeps exactly its two assertions', () => {
    expect(occurrences(source, 'expect(')).toBe(2)
  })
})
