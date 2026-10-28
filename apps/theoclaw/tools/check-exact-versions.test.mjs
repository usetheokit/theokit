import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { exactVersionViolations, runCli } from './check-exact-versions.mjs'

const CLI = fileURLToPath(new URL('./check-exact-versions.mjs', import.meta.url))
const APP_MANIFEST = fileURLToPath(new URL('../package.json', import.meta.url))

const REFUSED = [
  '^1.0.0',
  '~1.0.0',
  '>=1.0.0',
  '*',
  'latest',
  'workspace:^',
  'workspace:~',
  'file:../lib',
  'link:../lib',
  'npm:other@1.0.0',
  'git+https://github.com/owner/repo.git',
  'github:owner/repo',
]
const ACCEPTED = ['1.0.0', '0.2.1', '1.0.0-rc.1', '2.0.0-beta.3.x', 'workspace:*']

const scratch = []
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function manifestFile(text) {
  const dir = mkdtempSync(join(tmpdir(), 'exact-versions-'))
  scratch.push(dir)
  const path = join(dir, 'package.json')
  writeFileSync(path, text)
  return path
}

function runOn(path) {
  const out = []
  const err = []
  const code = runCli({ path, write: (line) => out.push(line), writeError: (line) => err.push(line) })
  return { code, out, err }
}

describe('exactVersionViolations', () => {
  it.each(REFUSED)('refuses the non-exact form %s', (specifier) => {
    expect(exactVersionViolations({ dependencies: { a: specifier } })).toEqual([
      { section: 'dependencies', name: 'a', specifier },
    ])
  })

  it.each(ACCEPTED)('accepts %s', (specifier) => {
    expect(exactVersionViolations({ devDependencies: { a: specifier } })).toEqual([])
  })

  it('reads dependencies, devDependencies and optionalDependencies', () => {
    const manifest = {
      dependencies: { a: '^1.0.0' },
      devDependencies: { b: '~2.0.0' },
      optionalDependencies: { c: '>=3.0.0' },
      peerDependencies: { d: '^4.0.0' },
    }
    expect(exactVersionViolations(manifest).map((v) => v.section)).toEqual([
      'dependencies',
      'devDependencies',
      'optionalDependencies',
    ])
  })

  it('refuses a specifier that is not a string', () => {
    expect(exactVersionViolations({ dependencies: { a: 1 } })).toEqual([
      { section: 'dependencies', name: 'a', specifier: '1' },
    ])
  })

  it('treats an absent section as empty', () => {
    expect(exactVersionViolations({ name: 'x' })).toEqual([])
  })
})

describe('check-exact-versions CLI', () => {
  it('prints one line per violation and exits 1', () => {
    const path = manifestFile(JSON.stringify({ dependencies: { a: '^1.0.0', b: '1.0.0' } }))
    const { code, out } = runOn(path)
    expect(code).toBe(1)
    expect(out).toEqual(['dependencies a ^1.0.0'])
  })

  it('exits 0 and prints nothing on an exact manifest', () => {
    const path = manifestFile(JSON.stringify({ dependencies: { a: '1.0.0' } }))
    const { code, out } = runOn(path)
    expect(code).toBe(0)
    expect(out).toEqual([])
  })

  it('exits 2 naming a manifest it cannot parse', () => {
    const path = manifestFile('{')
    const result = spawnSync(process.execPath, [CLI, path], { encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain(`cannot read ${path}`)
  })

  it('exits 2 naming a manifest that is not a JSON object', () => {
    const path = manifestFile('null')
    const { code, err } = runOn(path)
    expect(code).toBe(2)
    expect(err.join('\n')).toContain(`cannot read ${path}: not a JSON object`)
  })

  it('exits 2 naming a manifest that does not exist', () => {
    const path = join(tmpdir(), 'exact-versions-absent', 'package.json')
    const { code, err } = runOn(path)
    expect(code).toBe(2)
    expect(err.join('\n')).toContain(`cannot read ${path}`)
  })

  it('exits 2 naming a dependency section that is not an object', () => {
    const path = manifestFile(JSON.stringify({ dependencies: '^1.0.0' }))
    const { code, err } = runOn(path)
    expect(code).toBe(2)
    expect(err.join('\n')).toContain('dependencies is not an object')
  })

  it('exits 2 naming a dependency section that is null', () => {
    const path = manifestFile(JSON.stringify({ devDependencies: null }))
    const { code, err } = runOn(path)
    expect(code).toBe(2)
    expect(err.join('\n')).toContain('devDependencies is not an object')
  })
})

describe('the app manifest', () => {
  it('the app manifest has no range', () => {
    const result = spawnSync(process.execPath, [CLI, APP_MANIFEST], { encoding: 'utf8' })
    expect(result.stdout).toBe('')
    expect(result.status).toBe(0)
  })
})
