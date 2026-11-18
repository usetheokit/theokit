/**
 * The public-surface gate (#1963): fixture packages with hand-written `.d.ts` files, so the cases
 * do not depend on a build.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

interface Baseline {
  package: string
  entries: Record<
    string,
    {
      internals: Record<string, string>
      names: Record<string, { tier: string; declaration: string; deprecatedSince: string | null }>
    }
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
  for (const [file, text] of Object.entries(extra)) {
    if (file !== 'b') writeFileSync(join(dir, 'dist', file), text)
  }
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
    expect(s.entries['.']?.names.e?.tier).toBe('experimental')
    expect(s.entries['.']?.names.d?.deprecatedSince).toBe('2026-10-01')
    expect(s.entries['.']?.names.f).toMatchObject({ tier: 'stable', deprecatedSince: null })
    expect(s.entries['.']?.names.Opts?.declaration).toContain('a: string')
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

  it('sees a change to an unexported type that an exported name uses', () => {
    const src = (inner: string) =>
      `interface Inner { ${inner} }\nexport type Outer = Inner\nexport {}\n`
    const prev = surface(src('a: string'))
    expect(prev.entries['.']?.internals['dist/index.d.ts#Inner']).toContain('a: string')
    expect(run(prev, surface(src('a: string; b?: number')))).toEqual([])
    expect(run(prev, surface(src('a: number')))).toEqual([
      expect.stringContaining('referenced type dist/index.d.ts#Inner changed'),
    ])
    expect(run(prev, surface(src('a: string; b: number')), true)).toEqual([])
  })

  it('sees a change to an exported experimental type that a stable export uses', () => {
    const src = (inner: string) =>
      `/** @experimental */\nexport interface Exp { ${inner} }\nexport type Outer = Exp\n`
    const prev = surface(src('a: string'))
    expect(prev.entries['.']?.internals['dist/index.d.ts#Exp']).toContain('a: string')
    expect(run(prev, surface(src('a: string; b?: number')))).toEqual([])
    expect(run(prev, surface(src('a: number')))).toEqual([
      expect.stringContaining('referenced type dist/index.d.ts#Exp changed'),
    ])
  })

  it('keys referenced declarations by source file, so same-named types do not overwrite each other', () => {
    const src = (inner: string) => ({
      'one.d.ts': 'export interface Shared { a: string }\n',
      'two.d.ts': `export interface Shared { ${inner} }\n`,
    })
    const index = `import { Shared as A } from './one'\nimport { Shared as B } from './two'\nexport type Out = [A, B]\n`
    const prev = surface(index, src('b: string'))
    const keys = Object.keys(prev.entries['.']?.internals ?? {})
    expect(keys).toEqual(['dist/one.d.ts#Shared', 'dist/two.d.ts#Shared'])
    // A change to the second one is not hidden by the first one with the same name.
    expect(run(prev, surface(index, src('b: number')))).toEqual([
      expect.stringContaining('referenced type dist/two.d.ts#Shared changed'),
    ])
    expect(run(prev, surface(index, src('b: string; c?: number')))).toEqual([])
  })

  it('keys a declaration in a hashed chunk without the hash, so a rebuild does not drift', () => {
    const at = (hash: string) =>
      surface(`import { C } from './chunk-${hash}'\nexport type Out = C\n`, {
        [`chunk-${hash}.d.ts`]: 'export interface C { a: string }\n',
      })
    expect(Object.keys(at('aubY9WIa').entries['.']?.internals ?? {})).toEqual(['dist/chunk.d.ts#C'])
    expect(at('aubY9WIa')).toEqual(at('Zz09_-xY'))
  })

  it('keeps `types.d.ts` and `types-internal.d.ts` distinct, since only a hash suffix is stripped', () => {
    const index = `import { Shared as A } from './types'\nimport { Shared as B } from './types-internal'\nexport type Out = [A, B]\n`
    const files = {
      'types.d.ts': 'export interface Shared { a: string }\n',
      'types-internal.d.ts': 'export interface Shared { b: string }\n',
    }
    expect(Object.keys(surface(index, files).entries['.']?.internals ?? {})).toEqual([
      'dist/types-internal.d.ts#Shared',
      'dist/types.d.ts#Shared',
    ])
  })

  it('fails a stable value export turned into a type-only export', () => {
    const prev = surface('declare class K {}\nexport { K }\n')
    const next = surface('declare class K {}\nexport type { K }\n')
    expect(prev.entries['.']?.names.K).toMatchObject({ runtime: true })
    expect(run(prev, next)).toEqual([expect.stringContaining('type-only')])
    expect(run(prev, next, true)).toEqual([])
  })

  it('treats reordered overloads and members as breaking', () => {
    const fns = (a: string, b: string) =>
      `export declare function f(${a}): void\nexport declare function f(${b}): void\n`
    const prev = surface(fns('x: string', 'x: number'))
    expect(run(prev, surface(fns('x: number', 'x: string')))).toHaveLength(1)
    const ifc = (a: string, b: string) => `export interface I { ${a}; ${b} }\n`
    const p2 = surface(ifc('a(x: string): void', 'a(x: number): void'))
    expect(run(p2, surface(ifc('a(x: number): void', 'a(x: string): void')))).toHaveLength(1)
    expect(run(p2, surface(ifc('a(x: string): void', 'a(x: number): void; b?: 1')))).toEqual([])
  })

  it('treats reordered overloads of a referenced unexported function as breaking', () => {
    const src = (a: string, b: string) =>
      `declare function g(${a}): void\ndeclare function g(${b}): void\nexport declare const h: typeof g\nexport {}\n`
    const prev = surface(src('x: string', 'x: number'))
    expect(run(prev, surface(src('x: number', 'x: string')))).toEqual([
      expect.stringContaining('referenced type dist/index.d.ts#g changed'),
    ])
  })

  it('reads a major declaration from changeset frontmatter', () => {
    expect(gate.declaresMajor(["---\n'@x/pkg': major\n---\n\nx"], '@x/pkg')).toBe(true)
    expect(gate.declaresMajor(["---\n'@x/pkg': minor\n---\n"], '@x/pkg')).toBe(false)
    expect(gate.declaresMajor(["---\n'@x/other': major\n---\n"], '@x/pkg')).toBe(false)
  })
})

describe('public surface gate CLI', () => {
  const REPO = resolve(import.meta.dirname, '..', '..')
  const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))

  function repo(): string {
    const root = mkdtempSync(join(tmpdir(), 'surface-cli-'))
    dirs.push(root)
    mkdirSync(join(root, 'scripts'))
    mkdirSync(join(root, '.changeset'))
    mkdirSync(join(root, 'packages', 'pkg', 'dist'), { recursive: true })
    copyFileSync(path, join(root, 'scripts', 'check-public-surface.mjs'))
    symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules'))
    writeFileSync(
      join(root, 'packages', 'pkg', 'package.json'),
      JSON.stringify({ name: '@x/pkg', exports: { '.': { types: './dist/index.d.ts' } } }),
    )
    git(root, 'init', '-q', '-b', 'main')
    return root
  }
  function git(root: string, ...args: string[]) {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixture repo, fixed argv
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: root,
      env: ENV,
      encoding: 'utf8',
    })
    expect(r.status, r.stderr).toBe(0)
  }
  function gate(root: string, ...args: string[]) {
    return spawnSync(
      process.execPath,
      [join(root, 'scripts', 'check-public-surface.mjs'), ...args],
      { cwd: root, env: ENV, encoding: 'utf8' },
    )
  }
  function setDts(root: string, text: string) {
    writeFileSync(join(root, 'packages', 'pkg', 'dist', 'index.d.ts'), text)
  }
  function commit(root: string, msg: string) {
    git(root, 'add', '-A')
    git(root, 'commit', '-q', '-m', msg)
  }
  /** main holds a baseline with `f` and `g`; a branch removes `g` and may add a changeset. */
  function removal(changeset?: string, changesetOnMain = false): string {
    const root = repo()
    setDts(root, 'export declare function f(): void\nexport declare function g(): void\n')
    expect(gate(root, 'pkg', '--write').status).toBe(0)
    if (changesetOnMain && changeset) writeFileSync(join(root, '.changeset', 'old.md'), changeset)
    commit(root, 'base')
    git(root, 'checkout', '-q', '-b', 'pr')
    setDts(root, 'export declare function f(): void\n')
    expect(gate(root, 'pkg', '--write').status).toBe(0)
    if (changeset && !changesetOnMain) writeFileSync(join(root, '.changeset', 'new.md'), changeset)
    commit(root, 'pr')
    return root
  }
  const MAJOR = "---\n'@x/pkg': major\n---\n\nx\n"

  it('passes when nothing changed, and fails on drift from the committed baseline', () => {
    const root = repo()
    setDts(root, 'export declare function f(): void\n')
    gate(root, 'pkg', '--write')
    commit(root, 'base')
    expect(gate(root, '@x/pkg', '--base', 'main').status).toBe(0)
    setDts(root, 'export declare function f(): void\nexport declare function h(): void\n')
    expect(gate(root, 'pkg', '--base', 'main').status).toBe(1)
  })

  it('fails a removal without a major changeset in the range', () => {
    const r = gate(removal(), 'pkg', '--base', 'main')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('.:g')
  })

  it('passes a removal when a changeset added in the range declares major', () => {
    expect(gate(removal(MAJOR), 'pkg', '--base', 'main').status).toBe(0)
  })

  it('ignores a major changeset that was already on the base', () => {
    expect(gate(removal(MAJOR, true), 'pkg', '--base', 'main').status).toBe(1)
  })

  it('exits 2 for an unknown package and for an unreadable base', () => {
    const root = removal(MAJOR)
    expect(gate(root, 'nope', '--base', 'main').status).toBe(2)
    expect(gate(root, 'pkg', '--base', 'missing-ref').status).toBe(2)
  })
})
