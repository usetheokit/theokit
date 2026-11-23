/**
 * The standalone consumer (`standalone/`, #2276) installs TheoCode's manifests from the registry,
 * with its own lockfile and no link to the repository workspace. These checks keep its manifests
 * in step with the real ones.
 */
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { syncStandalone } from './sync-standalone.mjs'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => JSON.parse(readFileSync(join(app, p), 'utf8'))
const manifests = [
  'package.json',
  ...['agent', 'cli', 'shared', 'tui'].map((n) => `packages/${n}/package.json`),
]
const depsOf = (m) => ({ ...m.dependencies, ...m.devDependencies })

describe('standalone consumer manifests', () => {
  it.each(manifests)('%s declares the same dependency names as the real manifest', (p) => {
    const real = read(p)
    const standalone = read(`standalone/${p}`)
    expect(Object.keys(depsOf(standalone)).sort()).toEqual(Object.keys(depsOf(real)).sort())
    expect(standalone.name).toBe(real.name)
  })

  it.each(manifests)(
    '%s has no workspace protocol and takes @theokit packages from the registry',
    (p) => {
      const real = depsOf(read(p))
      for (const [name, range] of Object.entries(depsOf(read(`standalone/${p}`)))) {
        expect(range, name).not.toMatch(/^workspace:/)
        if (name.startsWith('@theokit/')) expect(range, name).toMatch(/^[~^]?\d/)
        // `workspace:*` links this checkout; the standalone manifest names the release a registry consumer gets (#2243).
        if (real[name] !== 'workspace:*')
          expect(range, name).toBe(real[name].replace(/^workspace:/, ''))
      }
    },
  )

  it('pins one exact released @theokit/agents in every standalone manifest', () => {
    const pins = manifests.map((p) => depsOf(read(`standalone/${p}`))['@theokit/agents'])
    expect(new Set(pins.filter(Boolean)).size).toBe(1)
    for (const pin of pins.filter(Boolean)) expect(pin).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('has its own lockfile and workspace root, with no workspace references in the lockfile', () => {
    expect(existsSync(join(app, 'standalone/pnpm-workspace.yaml'))).toBe(true)
    const lock = readFileSync(join(app, 'standalone/pnpm-lock.yaml'), 'utf8')
    expect(lock).not.toContain('workspace:')
    expect(lock).toContain("'@theokit/agents':")
  })
})

describe('standalone released.json synchronization', () => {
  const released = read('standalone/released.json')

  it('is exact, and matches every pin in the real standalone manifests and lockfile', () => {
    for (const v of Object.values(released)) expect(v).toMatch(/^\d+\.\d+\.\d+$/)
    expect(syncStandalone(join(app, 'standalone'))).toEqual([])
  })

  const copy = () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-standalone-'))
    for (const f of [...manifests, 'released.json', 'pnpm-lock.yaml'].map((p) => `${p}`)) {
      mkdirSync(dirname(join(dir, f)), { recursive: true })
      cpSync(join(app, 'standalone', f), join(dir, f))
    }
    return dir
  }

  it('detects a drifted manifest pin and repairs it with write', () => {
    const dir = copy()
    try {
      const path = join(dir, 'packages/cli/package.json')
      const m = JSON.parse(readFileSync(path, 'utf8'))
      m.dependencies['@theokit/agents'] = '1.0.0'
      writeFileSync(path, JSON.stringify(m))
      expect(syncStandalone(dir).join('\n')).toContain('packages/cli/package.json: @theokit/agents')
      expect(syncStandalone(dir, { write: true }).join('\n')).not.toContain('package.json')
      expect(syncStandalone(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits non-zero from --write while the lockfile or a pin is still wrong', () => {
    const dir = copy()
    try {
      writeFileSync(
        join(dir, 'released.json'),
        JSON.stringify({ ...released, '@theokit/sdk': '9.9.9' }),
      )
      const run = () =>
        execFileSync(
          process.execPath,
          [join(app, 'tools/sync-standalone.mjs'), '--write', '--root', dir],
          {
            stdio: 'pipe',
          },
        )
      expect(run).toThrow(/no importer specifier @theokit\/sdk@9.9.9/)
      // the manifests were still rewritten to the new pin
      expect(
        JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).devDependencies['@theokit/sdk'],
      ).toBe('9.9.9')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('detects a lockfile that lacks the released pin, and a non-exact release', () => {
    const dir = copy()
    try {
      writeFileSync(
        join(dir, 'released.json'),
        JSON.stringify({ ...released, '@theokit/sdk': '9.9.9' }),
      )
      const out = syncStandalone(dir).join('\n')
      expect(out).toContain('pnpm-lock.yaml: no importer specifier @theokit/sdk@9.9.9')
      writeFileSync(
        join(dir, 'released.json'),
        JSON.stringify({ ...released, '@theokit/sdk': '^5.32.0' }),
      )
      expect(syncStandalone(dir).join('\n')).toContain('not an exact version')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// The release runs `pnpm install --frozen-lockfile` here before Version Packages, and a lockfile
// edited by hand fails it there, after the promotion: the patchedDependencies section was dropped
// (4b6d720f), a snapshot kept @theokit/sdk 12.0.0 after the bump to 13.0.0 (c128dcf5), and
// create-theokit was pinned to a version never published, with no package entry (eb5ac75b).
describe('the standalone lockfile is one pnpm would accept frozen', () => {
  const lock = readFileSync(join(app, 'standalone', 'pnpm-lock.yaml'), 'utf8')
  const workspace = readFileSync(join(app, 'standalone', 'pnpm-workspace.yaml'), 'utf8')
  const packages = lock.slice(lock.indexOf('\npackages:\n'))

  it('records every patch pnpm-workspace.yaml declares', () => {
    const declared = [...workspace.matchAll(/^ {2}'([^']+)': (patches\/\S+)$/gm)]
    expect(declared.length).toBeGreaterThan(0)
    for (const [, name, path] of declared) {
      expect(lock, `${name} is patched in pnpm-workspace.yaml`).toContain(
        `\npatchedDependencies:\n`,
      )
      expect(lock).toContain(`  '${name}':\n    hash: `)
      expect(lock).toContain(`    path: ${path}\n`)
    }
  })

  it('has a package entry for every version released.json names', () => {
    for (const [name, version] of Object.entries(read('standalone/released.json'))) {
      const key = name.startsWith('@') ? `'${name}@${version}':` : `${name}@${version}:`
      expect(packages, `${name}@${version} has no entry under packages:`).toContain(`\n  ${key}\n`)
    }
  })

  it('names in each snapshot the same version of a package its key resolves against', () => {
    const stale = [
      ...lock.matchAll(/^ {2}'[^']+\(@theokit\/sdk@(\S+?)\(ws[^\n]*\n(?: {4}.*\n)*/gm),
    ]
      .filter(([block, keyed]) => {
        const named = /'@theokit\/sdk': (\S+?)\(/.exec(block)?.[1]
        return named !== undefined && named !== keyed
      })
      .map(([block]) => block.split('\n')[0])
    expect(stale).toEqual([])
  })
})
