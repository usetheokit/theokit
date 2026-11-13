import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { bootstrapSurface } from '../../src/bootstrap/index.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

it('installs the SDK home, the credential store and the hook project dir into the given env', () => {
  const root = mkdtempSync(join(tmpdir(), 'bootstrap-surface-'))
  dirs.push(root)
  const env: Record<string, string | undefined> = { THEOCODE_HOME: join(root, 'th') }
  bootstrapSurface({ env, cwd: root, home: root, onWarn: () => {} })
  expect(env.THEOKIT_AUTH_HOME).toBe(join(root, 'th'))
  expect(env.THEOKIT_HOME).toBeTruthy()
  expect(env.CLAUDE_PROJECT_DIR).toBe(root)
})
