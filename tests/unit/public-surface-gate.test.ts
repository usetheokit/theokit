/**
 * The public-surface gate (#1963): fixture packages with hand-written `.d.ts` files, so the cases
 * do not depend on a build.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

interface Baseline {
  package: string
  entries: Record<
    string,
    Record<string, { tier: string; declaration: string; deprecatedSince: string | null }>
  >
}
interface Gate {
  DEPRECATION_WINDOW_DAYS: number
  extractSurface: (dir: string) => Baseline
  comparePolicy: (prev: Baseline, next: Baseline, o: { major: boolean; now: number }) => string[]
  declaresMajor: (texts: string[], pkg: string) => boolean
}

const path: string = resolve(import.meta.dirname, '..', '..', 'scripts', 'check-public-surface.mjs')
const gate = (await import(path)) as Gate

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function surface(dts: string, extra: Record<string, string> = {}): Baseline {
  const dir = mkdtempSync(join(tmpdir(), 'surface-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'dist'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: '@x/pkg',
      exports: { '.': { types: './dist/index.d.ts' }, './b': { types: './dist/b.d.ts' } },
    }),
  )
  writeFileSync(join(dir, 'dist', 'index.d.ts'), dts)
  writeFileSync(join(dir, 'dist', 'b.d.ts'), extra.b ?? 'export declare const b: number\n')
  return gate.extractSurface(dir)
}

const NOW = Date.parse('2026-11-17')
const run = (a: Baseline, b: Baseline, major = false) =>
  gate.comparePolicy(a, b, { major, now: NOW })
const BASE = 'export interface Opts { a: string }\nexport declare function f(): void\n'

describe('public surface gate', () => {
  it('records tier, declaration and deprecatedSince per entry', () => {
    const s = surface(
      `/** @experimental */\nexport declare const e: number\n/** @deprecated since 2026-10-01 use f */\nexport declare const d: number\n${BASE}`,
    )
    expect(Object.keys(s.entries)).toEqual(['.', './b'])
    expect(s.entries['.']?.e?.tier).toBe('experimental')
    expect(s.entries['.']?.d?.deprecatedSince).toBe('2026-10-01')
    expect(s.entries['.']?.f).toMatchObject({ tier: 'stable', deprecatedSince: null })
    expect(s.entries['.']?.Opts?.declaration).toContain('a: string')
  })

  it('fails a removal without major and passes it with major', () => {
    const prev = surface(BASE)
    const next = surface('export interface Opts { a: string }\n')
    expect(run(prev, next)).toHaveLength(1)
    expect(run(prev, next, true)).toEqual([])
  })

  it('passes an added optional property and fails an added required one', () => {
    const prev = surface(BASE)
    expect(run(prev, surface(BASE.replace('a: string', 'a: string; b?: number')))).toEqual([])
    expect(run(prev, surface(BASE.replace('a: string', 'a: string; b: number')))).toHaveLength(1)
  })

  it('treats a demotion as breaking and an experimental removal as free', () => {
    const prev = surface(BASE)
    expect(
      run(
        prev,
        surface(
          BASE.replace('export declare function', '/** @experimental */\nexport declare function'),
        ),
      ),
    ).toHaveLength(1)
    const exp = surface(`/** @experimental */\nexport declare const e: number\n${BASE}`)
    expect(run(exp, surface(BASE))).toEqual([])
  })

  it('refuses a removal 30 days after deprecatedSince even with major, and allows 120', () => {
    const dep = (d: string) =>
      surface(`/** @deprecated since ${d} */\nexport declare const old: number\n${BASE}`)
    expect(gate.DEPRECATION_WINDOW_DAYS).toBe(90)
    expect(run(dep('2026-10-18'), surface(BASE), true)).toHaveLength(1)
    expect(run(dep('2026-07-20'), surface(BASE), true)).toEqual([])
  })

  it('reads a major declaration from changeset frontmatter', () => {
    expect(gate.declaresMajor(["---\n'@x/pkg': major\n---\n\nx"], '@x/pkg')).toBe(true)
    expect(gate.declaresMajor(["---\n'@x/pkg': minor\n---\n"], '@x/pkg')).toBe(false)
    expect(gate.declaresMajor(["---\n'@x/other': major\n---\n"], '@x/pkg')).toBe(false)
  })
})
