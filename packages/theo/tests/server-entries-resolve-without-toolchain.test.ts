import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOOLCHAIN = ['vite', '@vitejs/plugin-react', 'typescript']
const ENTRIES = ['dist/server/agent/index.js', 'dist/server/webhook/index.js']
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
  peerDependencies: Record<string, string>
  peerDependenciesMeta: Record<string, { optional?: boolean }>
}

/** Find an installed package's real directory, walking up from `from` like Node does. */
function findPackage(name: string, from: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(candidate)) return realpathSync(candidate)
    if (dirname(dir) === dir) return undefined
  }
}

/** Copy `roots` and everything they depend on into `dest` as real directories, minus the toolchain. */
function copyClosure(roots: string[], dest: string): void {
  const done = new Set<string>()
  const visit = (name: string, from: string): void => {
    if (done.has(name) || TOOLCHAIN.includes(name)) return
    const src = findPackage(name, from)
    if (!src) return // an optional peer that is not installed
    done.add(name)
    const target = join(dest, name)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(src, target, {
      recursive: true,
      filter: (f) => !relative(src, f).split(sep).includes('node_modules'),
    })
    const manifest = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    for (const dep of Object.keys({ ...manifest.peerDependencies, ...manifest.dependencies })) {
      visit(dep, src)
    }
  }
  for (const root of roots) visit(root, ROOT)
}

let sandbox = ''
let theoDir = ''

/** An install of theokit whose node_modules holds its runtime dependencies and none of the toolchain. */
beforeAll(() => {
  for (const entry of ENTRIES) {
    if (!existsSync(join(ROOT, entry)))
      throw new Error(`${entry} is not built: run the theokit build first`)
  }
  sandbox = mkdtempSync(join(tmpdir(), 'theokit-no-toolchain-'))
  theoDir = join(sandbox, 'node_modules', 'theokit')
  mkdirSync(join(theoDir, 'node_modules'), { recursive: true })
  cpSync(join(ROOT, 'dist'), join(theoDir, 'dist'), { recursive: true })
  cpSync(join(ROOT, 'package.json'), join(theoDir, 'package.json'))
  // A flat copy (no symlinks) of the entries' dependency closure, so resolution cannot escape
  // into the workspace or the pnpm store, where the toolchain is installed.
  copyClosure(['@theokit/agents', 'zod'], join(theoDir, 'node_modules'))
})

afterAll(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true })
})

describe('theokit/server entries do not need the build toolchain', () => {
  it('declares the toolchain as optional peers, not dependencies', () => {
    expect(pkg.dependencies.tsx).toBeDefined()
    for (const name of TOOLCHAIN) {
      expect(pkg.dependencies[name], name).toBeUndefined()
      expect(pkg.peerDependencies[name], name).toBeDefined()
      expect(pkg.peerDependenciesMeta[name]?.optional, name).toBe(true)
    }
  })

  it('the sandbox really has no toolchain', () => {
    for (const name of TOOLCHAIN)
      expect(existsSync(join(theoDir, 'node_modules', name)), name).toBe(false)
  })

  it.each(ENTRIES)('%s imports in an install without the toolchain', (entry) => {
    const res = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(join(theoDir, entry))})`],
      { cwd: sandbox, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } },
    )
    expect(res.stderr).toBe('')
    expect(res.status).toBe(0)
  })
})
