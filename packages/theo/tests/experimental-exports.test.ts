import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const read = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8')

interface Baseline {
  entries: Record<string, { names: Record<string, { tier: string }> }>
}

function fromBaseline(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  const entries = (JSON.parse(read('../public-surface-baseline.json')) as Baseline).entries
  for (const [entry, { names }] of Object.entries(entries)) {
    const exp = Object.entries(names)
      .filter(([, v]) => v.tier === 'experimental')
      .map(([n]) => n)
      .sort((a, b) => a.localeCompare(b))
    if (exp.length > 0) out[entry === '.' ? 'theokit' : `theokit${entry.slice(1)}`] = exp
  }
  return out
}

export function parseReadme(text: string): Record<string, string[]> {
  const start = '<!-- experimental-exports:start -->'
  const a = text.indexOf(start)
  const b = text.indexOf('<!-- experimental-exports:end -->')
  if (a < 0 || b < a) throw new Error('README.md has no experimental-exports section')
  const out: Record<string, string[]> = {}
  for (const raw of text.slice(a + start.length, b).split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('- `theokit')) continue
    const [head = '', list = ''] = line.slice(3).split('`: ')
    out[head] = list
      .split('`')
      .filter((_, k) => k % 2 === 1)
      .sort((x, y) => x.localeCompare(y))
  }
  return out
}

describe('theokit experimental exports', () => {
  it('the root README list matches the experimental names of the surface baseline, per entry', () => {
    expect(parseReadme(read('../../../README.md'))).toEqual(fromBaseline())
  })

  it('fails when the list and the baseline disagree', () => {
    const drifted = [
      '<!-- experimental-exports:start -->',
      '- `theokit/server/cost/sqlite`: `Other`',
      '<!-- experimental-exports:end -->',
    ].join('\n')
    expect(parseReadme(drifted)).not.toEqual(fromBaseline())
  })

  it('the tag reaches the built declarations of every experimental name', () => {
    const dist = fileURLToPath(new URL('../dist/', import.meta.url))
    const files = (readdirSync(dist, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.d.ts'))
      .map((f) => readFileSync(join(dist, f), 'utf8'))
    const exp = Object.values(fromBaseline()).flat()
    expect(exp.length).toBeGreaterThan(0)
    for (const name of new Set(exp)) {
      // A docblock holding the tag, directly above the declaration (it may sit in a shared chunk).
      const tagged = new RegExp(
        String.raw`@experimental(?:(?!\*/)[\s\S])*\*/\s*(?:export\s+)?(?:declare\s+)?(?:class|interface|function|const|type)\s+${name}\b`,
      )
      expect(
        files.some((f) => tagged.test(f)),
        `${name} lost @experimental in dist`,
      ).toBe(true)
    }
  })
})
