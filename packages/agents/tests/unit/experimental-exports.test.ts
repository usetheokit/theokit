import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
const read = (f: string): string => readFileSync(new URL(f, root), 'utf8')

interface Baseline {
  entries: Record<string, { names: Record<string, { tier: string }> }>
}

function fromBaseline(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [entry, { names }] of Object.entries(
    (JSON.parse(read('public-surface-baseline.json')) as Baseline).entries,
  )) {
    const exp = Object.entries(names)
      .filter(([, v]) => v.tier === 'experimental')
      .map(([n]) => n)
      .sort((a, b) => a.localeCompare(b))
    if (exp.length > 0) out[entry] = exp
  }
  return out
}

function fromReadme(): Record<string, string[]> {
  const text = read('README.md')
  const start = '<!-- experimental-exports:start -->'
  const a = text.indexOf(start)
  const b = text.indexOf('<!-- experimental-exports:end -->')
  if (a < 0 || b < a) throw new Error('README.md has no experimental-exports section')
  const out: Record<string, string[]> = {}
  const prefix = '- `@theokit/agents'
  for (const raw of text.slice(a + start.length, b).split('\n')) {
    const line = raw.trim()
    if (!line.startsWith(prefix)) continue
    const [head = '', list = ''] = line.slice(prefix.length).split('`: ')
    const sub = head.replace(/`$/, '')
    out[sub === '' ? '.' : `.${sub}`] = list
      .split('`')
      .filter((_, k) => k % 2 === 1)
      .sort((x, y) => x.localeCompare(y))
  }
  return out
}

describe('experimental exports', () => {
  it('the README list matches the experimental names of the surface baseline, per entry', () => {
    expect(fromReadme()).toEqual(fromBaseline())
  })
})
