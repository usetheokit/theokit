import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOOLCHAIN = ['vite', '@vitejs/plugin-react', 'typescript', 'tsx']
const ENTRIES = ['dist/server/agent/index.js', 'dist/server/webhook/index.js']
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
  peerDependencies: Record<string, string>
  peerDependenciesMeta: Record<string, { optional?: boolean }>
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
  // Everything theokit has installed for itself except the toolchain (and the `@vitejs` scope).
  for (const name of readdirSync(join(ROOT, 'node_modules'))) {
    if (name === '.bin' || name === '@vitejs' || TOOLCHAIN.includes(name)) continue
    symlinkSync(
      realpathSync(join(ROOT, 'node_modules', name)),
      join(theoDir, 'node_modules', name),
      'dir',
    )
  }
})

afterAll(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true })
})

describe('theokit/server entries do not need the build toolchain', () => {
  it('declares the toolchain as optional peers, not dependencies', () => {
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
