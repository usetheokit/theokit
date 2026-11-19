import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
const read = (f: string): string => readFileSync(new URL(f, root), 'utf8')

type Baseline = { entries: Record<string, { names: Record<string, { tier: string }> }> }

function fromBaseline(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [entry, { names }] of Object.entries(
    (JSON.parse(read('public-surface-baseline.json')) as Baseline).entries,
  )) {
    const exp = Object.entries(names)
      .filter(([, v]) => v.tier === 'experimental')
      .map(([n]) => n)
      .sort()
    if (exp.length > 0) out[entry] = exp
  }
  return out
}

function fromReadme(): Record<string, string[]> {
  const m = /<!-- experimental-exports:start -->([\s\S]*?)<!-- experimental-exports:end -->/.exec(
    read('README.md'),
  )
  if (!m) throw new Error('README.md has no experimental-exports section')
  const out: Record<string, string[]> = {}
  for (const line of (m[1] ?? '').split('\n')) {
    const l = /^- `@theokit\/agents(\/[^`]*)?`: (.+)$/.exec(line.trim())
    if (!l) continue
    const names = [...(l[2] ?? '').matchAll(/`([^`]+)`/g)].map((x) => x[1] as string).sort()
    out[l[1] ? `.${l[1]}` : '.'] = names
  }
  return out
}

describe('experimental exports', () => {
  it('the README list matches the experimental names of the surface baseline, per entry', () => {
    expect(fromReadme()).toEqual(fromBaseline())
  })
})
