import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { categoryOf, countCodeLines, declaredNames, frameworkExports, measure, SIGNALS, verdict } from './measure-app-joinery.mjs'

const CLI = fileURLToPath(new URL('./measure-app-joinery.mjs', import.meta.url))
const scratch = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function app(files) {
  const root = mkdtempSync(join(tmpdir(), 'joinery-'))
  scratch.push(root)
  mkdirSync(join(root, 'src'), { recursive: true })
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, 'src', name), body)
  return root
}

describe('measure-app-joinery', () => {
  it('counts code lines, not blanks or comments', () => {
    expect(countCodeLines('// a\n\n/* b\n c */\nconst x = 1\n/** d */ const y = 2\n')).toBe(2)
  })

  it('resolves this app and reports a number for gap and presenter, both 0', () => {
    const result = measure()
    expect(result.resolved).toBeGreaterThan(50)
    expect(result.totals.total).toBeGreaterThan(0)
    expect(result.joined).toBeGreaterThan(5)
    expect(result.totals.gap).toBe(0)
    expect(result.totals.presenter).toBe(0)
  })

  it('the CLI exits 1 on this app and names the framework symbols it re-declares', () => {
    const run = spawnSync(process.execPath, [CLI], { encoding: 'utf8' })
    expect(run.status).toBe(1)
    expect(run.stderr).toMatch(/joined: \d+ {2}total: \d+ {2}gap: 0 {2}presenter: 0/)
    for (const name of ['createControlClient', 'createDevicePairing', 'attachControlSocket', 'resolveSecretRefs']) {
      expect(run.stderr).toContain(`duplicate ${name} `)
    }
    // #2598 moved hookFingerprint to the framework; the app imports it, so it is no longer a duplicate.
    expect(run.stderr).not.toContain('duplicate hookFingerprint ')
  })

  it('exits 2 on a directory with no source files (cannot pass vacuously)', () => {
    const result = measure(app({}))
    expect(result.resolved).toBe(0)
    expect(verdict(result).code).toBe(2)
    expect(verdict(measure(join(tmpdir(), 'joinery-does-not-exist'))).code).toBe(2)
  })

  it('exits 1 naming the file when a gap or presenter file has lines', () => {
    const root = app({ 'glue.ts': 'export const a = 1\nexport const b = 2\n', 'ok.ts': 'export const c = 3\n' })
    const rules = [{ pattern: /glue\.ts$/, category: 'gap', reason: 'test' }]
    const out = verdict(measure(root, rules))
    expect(out.code).toBe(1)
    expect(out.report).toContain('gap 2 src/glue.ts')
    const presenter = verdict(measure(root, [{ pattern: /ok\.ts$/, category: 'presenter', reason: 'test' }]))
    expect(presenter.code).toBe(1)
  })

  it('does not fail on mixed or app lines', () => {
    const root = app({ 'a.ts': 'export const a = 1\n' })
    expect(verdict(measure(root, [{ pattern: /a\.ts$/, category: 'mixed', reason: 'test' }])).code).toBe(0)
  })
})

describe('signals are not vacuous', () => {
  const samples = {
    gap: [
      "res.setHeader('content-type', 'text/event-stream')",
      'res.write(`data: ${JSON.stringify(x)}`)',
      "app.post('/chat', handler)",
      'class ServiceContainer {}',
      'const providers = new Map<string, Provider>()',
    ],
    presenter: ["const red = '\\u001b[31m'", 'function renderReply(r) {}', 'function formatAgentMessage(m) {}'],
  }
  for (const [category, texts] of Object.entries(samples)) {
    for (const text of texts) {
      it(`${category}: ${text}`, () => {
        expect(categoryOf('src/x.ts', text, [], SIGNALS)).toBe(category)
      })
    }
  }

  it('a file carrying a signal turns a measured app red', () => {
    const root = app({ 'sse.ts': "res.setHeader('content-type', 'text/event-stream')\n", 'ok.ts': 'export const c = 3\n' })
    const out = verdict(measure(root))
    expect(out.code).toBe(1)
    expect(out.report).toContain('gap 1 src/sse.ts')
  })

  it('plain code stays app', () => {
    expect(categoryOf('src/x.ts', 'export const a = 1', [], SIGNALS)).toBe('app')
  })
})

describe('framework-name duplicates', () => {
  function appWithDep(files, exportsMap = { '.': { types: './dist/index.d.ts' }, './sub': { types: './dist/sub.d.ts' } }) {
    const root = app(files)
    const pkg = join(root, 'node_modules', '@theokit', 'fw')
    mkdirSync(join(pkg, 'dist'), { recursive: true })
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@theokit/fw', exports: exportsMap }))
    writeFileSync(join(pkg, 'dist', 'index.d.ts'), 'export declare function alpha(): void\nexport { beta } from "./sub.js"\n')
    writeFileSync(join(pkg, 'dist', 'sub.d.ts'), 'export declare class Gamma {}\nexport declare function beta(): void\n')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { '@theokit/fw': '1.0.0' } }))
    return root
  }

  it('reads exports of every subpath', () => {
    const names = frameworkExports(appWithDep({}))
    expect([...names.keys()].sort()).toEqual(['Gamma', 'alpha', 'beta'])
    expect(names.get('Gamma')).toEqual(['@theokit/fw/sub'])
  })

  it('finds function and class declarations, not other statements', () => {
    expect(declaredNames('export function a() {}\nclass B {}\nconst c = () => {}\nfunction d() { function e() {} }')).toEqual(['a', 'B', 'd'])
  })

  it('reports a same-named declaration and exits 1', () => {
    const root = appWithDep({ 'a.ts': 'export function alpha() {}\n', 'b.ts': 'export class Gamma {}\n', 'c.ts': 'export function other() {}\n' })
    const out = verdict(measure(root))
    expect(out.code).toBe(1)
    expect(out.report).toContain('duplicate alpha src/a.ts')
    expect(out.report).toContain('duplicate Gamma src/b.ts')
    expect(out.report).not.toContain('src/c.ts')
  })

  it('an allow-list entry with a reason silences it', () => {
    const root = appWithDep({ 'a.ts': 'export function alpha() {}\n' })
    const allowed = [{ path: 'src/a.ts', symbol: 'alpha', reason: 'wraps the framework call with app policy' }]
    expect(verdict(measure(root, undefined, undefined, undefined, allowed)).code).toBe(0)
    expect(verdict(measure(root, undefined, undefined, undefined, [{ path: 'src/a.ts', reason: ' ' }])).code).toBe(1)
  })

  it('throws when a declared dependency cannot be measured', () => {
    const root = appWithDep({})
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { '@theokit/missing': '1.0.0' } }))
    expect(() => frameworkExports(root)).toThrow(/cannot resolve/)
  })
})
