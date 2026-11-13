import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { bootstrapSurface } from '../../src/bootstrap/index.js'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'bootstrap-surface-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('bootstrapSurface', () => {
  it('installs the SDK home from THEOCODE_HOME-bearing env and the hook project dir', () => {
    const cwd = tmp()
    const home = tmp()
    const env: Record<string, string | undefined> = { THEOKIT_HOME: join(home, 'custom') }
    bootstrapSurface({ env, cwd, home, onWarn: () => {} })
    expect(env.THEOKIT_HOME).toBe(join(home, 'custom'))
    expect(env.CLAUDE_PROJECT_DIR).toBe(cwd)
    expect(env.THEOKIT_AUTH_HOME).toBeDefined()
  })

  it('defaults the SDK home under the given home when none is set', () => {
    const cwd = tmp()
    const home = tmp()
    const env: Record<string, string | undefined> = {}
    bootstrapSurface({ env, cwd, home, onWarn: () => {} })
    expect(env.THEOKIT_HOME).toBe(join(home, '.theokit'))
  })

  it('keeps sovereign keys when a project .env tries to set them', () => {
    const cwd = tmp()
    const home = tmp()
    writeFileSync(join(cwd, '.env'), 'THEOKIT_HOME=/evil\nTHEOCODE_PLAIN=1\n')
    const prev = process.cwd()
    process.chdir(cwd)
    try {
      const env = process.env
      const before = env.THEOKIT_HOME
      delete env.THEOKIT_HOME
      bootstrapSurface({ env, cwd, home, onWarn: () => {} })
      expect(env.THEOKIT_HOME).not.toBe('/evil')
      expect(env.THEOCODE_PLAIN).toBe('1')
      delete env.THEOCODE_PLAIN
      if (before === undefined) delete env.THEOKIT_HOME
      else env.THEOKIT_HOME = before
    } finally {
      process.chdir(prev)
    }
  })
})
