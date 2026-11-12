import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { bootstrapSurface } from '../../src/bootstrap/index.js'

describe('#1893 — bootstrapSurface', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  const tmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'bootstrap-surface-'))
    dirs.push(d)
    return d
  }

  it('installs the SDK home variables and CLAUDE_PROJECT_DIR into the given environment', () => {
    const home = tmp()
    const cwd = tmp()
    const env: Record<string, string | undefined> = {}
    bootstrapSurface({ env, cwd, home, onWarn: () => {} })
    expect(env.THEOKIT_HOME).toBeTypeOf('string')
    expect(env.THEOKIT_AUTH_HOME).toBeTypeOf('string')
    expect(env.CLAUDE_PROJECT_DIR).toBe(cwd)
  })

  it('derives the SDK home from THEOCODE_HOME', () => {
    const root = tmp()
    const env: Record<string, string | undefined> = { THEOCODE_HOME: root }
    bootstrapSurface({ env, cwd: tmp(), home: tmp(), onWarn: () => {} })
    expect(env.THEOKIT_AUTH_HOME).toContain(root)
  })
})
