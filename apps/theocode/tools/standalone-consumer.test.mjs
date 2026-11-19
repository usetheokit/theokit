/**
 * The standalone consumer (`standalone/`, #2276) installs TheoCode's manifests from the registry,
 * with its own lockfile and no link to the repository workspace. These checks keep its manifests
 * in step with the real ones.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const app = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => JSON.parse(readFileSync(join(app, p), 'utf8'))
const manifests = ['package.json', ...['agent', 'cli', 'shared', 'tui'].map((n) => `packages/${n}/package.json`)]
const depsOf = (m) => ({ ...m.dependencies, ...m.devDependencies })

describe('standalone consumer manifests', () => {
  it.each(manifests)('%s declares the same dependency names as the real manifest', (p) => {
    const real = read(p)
    const standalone = read(`standalone/${p}`)
    expect(Object.keys(depsOf(standalone)).sort()).toEqual(Object.keys(depsOf(real)).sort())
    expect(standalone.name).toBe(real.name)
  })

  it.each(manifests)('%s has no workspace protocol and takes @theokit packages from the registry', (p) => {
    const real = depsOf(read(p))
    for (const [name, range] of Object.entries(depsOf(read(`standalone/${p}`)))) {
      expect(range, name).not.toMatch(/^workspace:/)
      if (name.startsWith('@theokit/')) expect(range, name).toMatch(/^[~^]?\d/)
      if (real[name] !== 'workspace:*') expect(range, name).toBe(real[name])
    }
  })

  it('has its own lockfile and workspace root, with no workspace references in the lockfile', () => {
    expect(existsSync(join(app, 'standalone/pnpm-workspace.yaml'))).toBe(true)
    const lock = readFileSync(join(app, 'standalone/pnpm-lock.yaml'), 'utf8')
    expect(lock).not.toContain('workspace:')
    expect(lock).toContain("'@theokit/agents':")
  })
})
