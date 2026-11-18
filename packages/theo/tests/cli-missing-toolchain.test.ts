import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  cpSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { requireToolchain } from '../src/cli/require-toolchain.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let sandbox = ''
let cli = ''

beforeAll(() => {
  if (!existsSync(join(ROOT, 'dist/cli/index.js')))
    throw new Error('dist/cli/index.js is not built')
  sandbox = mkdtempSync(join(tmpdir(), 'theokit-cli-no-toolchain-'))
  const theo = join(sandbox, 'node_modules', 'theokit')
  mkdirSync(join(theo, 'node_modules'), { recursive: true })
  cpSync(join(ROOT, 'dist'), join(theo, 'dist'), { recursive: true })
  cpSync(join(ROOT, 'package.json'), join(theo, 'package.json'))
  // Everything theokit installs for itself except the optional toolchain peers.
  for (const name of readdirSync(join(ROOT, 'node_modules'))) {
    if (name === '.bin' || name === '@vitejs' || ['vite', 'typescript'].includes(name)) continue
    symlinkSync(
      realpathSync(join(ROOT, 'node_modules', name)),
      join(theo, 'node_modules', name),
      'dir',
    )
  }
  cli = join(theo, 'dist/cli/index.js')
})

afterAll(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true })
})

describe('requireToolchain', () => {
  it('names the missing package and the install command', () => {
    const dir = mkdtempSync(join(tmpdir(), 'theokit-toolchain-'))
    try {
      expect(() => requireToolchain(['theokit-not-installed-pkg'], dir)).toThrow(
        /"theokit-not-installed-pkg".*npm install --save-dev theokit-not-installed-pkg/s,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes when the packages resolve', () => {
    expect(() => requireToolchain(['vite', 'typescript'], process.cwd())).not.toThrow()
  })
})

describe('the built CLI without the optional peers', () => {
  it.each([['dev'], ['build'], ['agent', 'some-agent', 'hello']])(
    '`theokit %s` exits non-zero naming vite and the install command',
    (...args) => {
      const res = spawnSync(process.execPath, [cli, ...args], {
        cwd: sandbox,
        encoding: 'utf8',
        // pnpm puts its hoisted store on NODE_PATH, which would resolve the toolchain.
        env: { ...process.env, NODE_PATH: '' },
        timeout: 30_000,
      })
      expect(res.status).not.toBe(0)
      expect(res.stderr).toContain('"vite"')
      expect(res.stderr).toContain('npm install --save-dev vite')
    },
  )
})
